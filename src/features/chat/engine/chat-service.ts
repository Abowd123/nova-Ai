import { collectResponse } from "@/lib/ai/collect";
import { ProviderError, isAbortError, toProviderError, type ProviderErrorCode } from "@/lib/ai/errors";
import type { ChatProvider, TokenUsage, ToolCallPartLike } from "./types";
import type { FinishReason, Message, MessagePart, Provider, ProviderModel } from "@/lib/models";
import { DEFAULT_SETTINGS, reasoningOf } from "@/lib/models";
import { logger } from "@/lib/logger";
import { redactSecrets } from "@/lib/security/redact";
import { StorageError } from "@/lib/storage/errors";
import type { Repositories } from "@/lib/storage/types";
import { CONTINUE_PROMPT, buildChatRequest } from "./build-request";
import { MediaError, resolveRequestMedia, type MediaSource } from "./media-resolver";
import { checkAttachment } from "@/lib/media/support";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/media/limits";
import type { Attachment } from "@/lib/models";
import { streamLockName, type StreamLocks } from "./stream-locks";
import type { StreamingSink } from "./streaming-store";
import { TITLE_PROMPT, cleanGeneratedTitle, titleFromText } from "./titles";
import { prepareContext, type ContextSources, type PreparedContext } from "./context-pipeline";
import { estimateMessageTokens, estimateTokens } from "@/lib/context/tokens";
import type { AppSettings, Assistant, MessageContextInfo, ToolResultPart } from "@/lib/models";
import { DEFAULT_TOOL_SETTINGS } from "@/lib/models";
import { toToolSpecs, type ActiveTool } from "@/lib/tools/registry";
import type { ToolRunner } from "@/lib/tools/runner";

export type ChatErrorCode = ProviderErrorCode | "no_model" | "busy" | "storage" | "context_overflow";

export class ChatError extends Error {
  constructor(
    readonly code: ChatErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ChatError";
  }
}

export interface ResolvedModel {
  provider: Provider;
  model: ProviderModel | undefined;
  modelId: string;
}

export interface ChatServiceDeps {
  repos: Repositories;
  getChatProvider: (providerId: string) => Promise<ChatProvider>;
  sink: StreamingSink;
  clock?: () => number;
  /** How often partial output is persisted to IndexedDB while streaming. */
  flushIntervalMs?: number;
  /** Coalesces UI updates (requestAnimationFrame in the browser). */
  schedule?: (callback: () => void) => void;
  onChange?: (conversationId: string) => void;
  locale?: () => string;
  locks?: StreamLocks;
  /** Loads attachment binaries for provider requests. Without it media parts are sent as-is. */
  media?: MediaSource;
  /** Fired once per finished assistant reply (TTS autoplay, notifications). */
  onReplyComplete?: (info: ReplyCompleteInfo) => void;
  /** Memory/lorebook/summary sources. Without it requests are built from history only (pre-1.3 behaviour). */
  context?: ContextSources;
  /** Tool calling (agent loop). Without it tool calls are stored but never executed. */
  tools?: ChatToolsDeps;
  /** Cheap model for titles (sub-agent settings) and auxiliary usage tracking. */
  auxiliary?: AuxiliaryDeps;
}

export interface ChatToolsDeps {
  /** Tools offered for this reply (assistant selection + permissions). */
  resolve(input: { assistant: Assistant | null; settings: AppSettings }): Promise<ActiveTool[]>;
  runner: Pick<ToolRunner, "runCalls">;
  /** Clears live tool state once the reply is over. */
  onRunFinished?(callIds: string[]): void;
}

export interface AuxiliaryDeps {
  /** Model for titles, or null = the conversation model. */
  titleModel(): Promise<{ providerId: string; modelId: string } | null>;
  recordUsage(record: { kind: "title"; providerId: string; modelId: string; conversationId: string; usage: TokenUsage | null }): Promise<void>;
}

export type InputMode = "text" | "voice";

export interface SendOptions {
  attachmentIds?: string[];
  /** Per-attachment override for videos: send the file or extracted frames. */
  videoModes?: Record<string, "native" | "frames">;
  inputMode?: InputMode;
}

export interface ReplyCompleteInfo {
  conversationId: string;
  messageId: string;
  text: string;
  assistantId: string | null;
  inputMode: InputMode;
  /** Estimated tokens of the whole stored history incl. the new reply (auto-summary trigger). */
  historyTokens: number;
  contextWindow: number;
}

export interface ContextPreview {
  breakdown: PreparedContext["result"]["breakdown"];
  ratio: number;
  omittedMessages: number;
  summarizedMessages: number;
  overflow: boolean;
  windowKnown: boolean;
  /** Provider-reported input tokens of the last reply (null when unknown). */
  lastInputTokens: number | null;
  lastContext: MessageContextInfo | null;
}

export function attachmentToPart(attachment: Attachment, videoMode?: "native" | "frames"): MessagePart {
  const base = { mimeType: attachment.mimeType, attachmentId: attachment.id, name: attachment.name };
  switch (attachment.kind) {
    case "image":
      return { type: "image", ...base };
    case "audio":
      return { type: "audio", ...base };
    case "video":
      return { type: "video", ...base, ...(videoMode ? { mode: videoMode } : {}) };
    case "file":
      return { type: "file", ...base };
  }
}

/** Messages older than this with status=streaming are considered abandoned after reload. */
export const STALE_STREAM_MS = 15_000;

function defaultSchedule(callback: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => callback());
  else setTimeout(callback, 16);
}

function buildParts(text: string, reasoning: string, signature: string | undefined, toolCalls: ToolCallPartLike[]): MessagePart[] {
  const parts: MessagePart[] = [];
  if (reasoning || signature) parts.push({ type: "reasoning", text: reasoning, ...(signature ? { signature } : {}) });
  if (text) parts.push({ type: "text", text });
  for (const call of toolCalls) parts.push({ type: "tool_call", ...call });
  return parts;
}

function toChatMessagesTokens(history: Message[]): number {
  let total = 0;
  for (const message of history) {
    if (message.role === "system" || !message.content.trim()) continue;
    total += estimateMessageTokens(message);
  }
  return total;
}

export function userFacingError(error: unknown): { code: ChatErrorCode; message: string } {
  if (error instanceof ChatError) return { code: error.code, message: error.message };
  if (error instanceof StorageError) return { code: "storage", message: error.message };
  const providerError = toProviderError(error);
  return { code: providerError.code, message: redactSecrets(providerError.message).slice(0, 500) };
}

interface ActiveRun {
  controller: AbortController;
  messageId: string;
}

/**
 * Framework-free chat orchestration: builds requests, streams, persists partial output,
 * handles stop/regenerate/edit/continue and crash recovery. React only renders its effects.
 */
export class ChatService {
  private readonly active = new Map<string, ActiveRun>();
  private readonly clock: () => number;
  private readonly flushIntervalMs: number;
  private readonly schedule: (callback: () => void) => void;

  constructor(private readonly deps: ChatServiceDeps) {
    this.clock = deps.clock ?? (() => Date.now());
    this.flushIntervalMs = deps.flushIntervalMs ?? 500;
    this.schedule = deps.schedule ?? defaultSchedule;
  }

  isStreaming(conversationId: string): boolean {
    return this.active.has(conversationId);
  }

  stop(conversationId: string): void {
    this.active.get(conversationId)?.controller.abort();
  }

  stopAll(): void {
    for (const run of this.active.values()) run.controller.abort();
  }

  /** Picks conversation model -> assistant default -> app default -> first enabled model. */
  async resolveModel(conversationId: string): Promise<ResolvedModel> {
    const { repos } = this.deps;
    const [conversation, settings, providers] = await Promise.all([
      repos.conversations.get(conversationId),
      repos.settings.get(),
      repos.providers.list(),
    ]);
    const assistant = conversation?.assistantId ? await repos.assistants.get(conversation.assistantId) : undefined;
    const enabled = providers.filter((p) => p.enabled);
    const pick = (providerId: string | null | undefined, modelId: string | null | undefined): ResolvedModel | undefined => {
      if (!providerId) return undefined;
      const provider = enabled.find((p) => p.id === providerId);
      if (!provider) return undefined;
      const id = modelId ?? provider.defaultModelId ?? provider.models.find((m) => m.enabled)?.id;
      if (!id) return undefined;
      return { provider, model: provider.models.find((m) => m.id === id), modelId: id };
    };
    const resolved =
      pick(conversation?.providerId, conversation?.modelId) ??
      pick(assistant?.defaultProviderId, assistant?.defaultModelId) ??
      pick(settings.defaultProviderId, settings.defaultModelId) ??
      enabled.map((p) => pick(p.id, null)).find(Boolean);
    if (!resolved) throw new ChatError("no_model", "No enabled provider/model. Add one in Settings → Providers.");
    return resolved;
  }

  /**
   * Checks that the conversation's model can receive these attachments. Returns the
   * attachments in order. Throws MediaError for the first unsupported one.
   */
  async checkSendable(conversationId: string, attachmentIds: string[], videoModes: SendOptions["videoModes"] = {}): Promise<Attachment[]> {
    if (attachmentIds.length === 0) return [];
    if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new ChatError("bad_request", `At most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message`);
    const { repos } = this.deps;
    const [resolved, settings, attachments] = await Promise.all([
      this.resolveModel(conversationId),
      repos.settings.get().catch(() => DEFAULT_SETTINGS),
      repos.attachments.getMany(attachmentIds),
    ]);
    const byId = new Map(attachments.map((a) => [a.id, a]));
    const provider = await this.deps.getChatProvider(resolved.provider.id);
    const capabilities = resolved.model?.capabilities ?? { vision: false, audio: false, video: false, tools: false, reasoning: false };
    const ordered: Attachment[] = [];
    for (const id of attachmentIds) {
      const attachment = byId.get(id);
      if (!attachment) throw new MediaError("missing", id);
      const result = checkAttachment(
        attachment,
        { providerKind: resolved.provider.kind, capabilities, canUpload: typeof provider.uploadFile === "function" },
        videoModes[id] ?? settings.media.videoMode,
      );
      if (!result.ok) throw new MediaError(result.problem, attachment.name);
      ordered.push(attachment);
    }
    return ordered;
  }

  async send(conversationId: string, text: string, options: SendOptions = {}): Promise<void> {
    const content = text.trim();
    const attachmentIds = options.attachmentIds ?? [];
    if (!content && attachmentIds.length === 0) return;
    this.assertIdle(conversationId);
    const { repos } = this.deps;
    const conversation = await repos.conversations.get(conversationId);
    if (!conversation) throw new StorageError("NOT_FOUND", `Conversation "${conversationId}" was not found`);
    await this.resolveModel(conversationId); // fail fast before saving anything
    const attachments = await this.checkSendable(conversationId, attachmentIds, options.videoModes);
    const parts: MessagePart[] = [
      ...attachments.map((a) => attachmentToPart(a, a.kind === "video" ? options.videoModes?.[a.id] : undefined)),
      ...(content ? [{ type: "text" as const, text: content }] : []),
    ];
    const message = await repos.messages.create({ conversationId, role: "user", content, parts, attachmentIds, status: "complete" });
    if (attachmentIds.length) await repos.attachments.link(attachmentIds, { conversationId, messageId: message.id });
    if (conversation.titleSource === "default") {
      const title = titleFromText(content || attachments[0]?.name || "");
      if (title) await repos.conversations.update(conversationId, { title, titleSource: "auto" });
    }
    this.deps.onChange?.(conversationId);
    await this.generate(conversationId, undefined, options.inputMode ?? "text");
  }

  /** Re-runs the assistant turn: removes it (and anything after) and streams a new one. */
  async regenerate(assistantMessageId: string): Promise<void> {
    const message = await this.requireMessage(assistantMessageId);
    this.assertIdle(message.conversationId);
    // A reply with tool use spans several messages (assistant → tool → assistant…): restart from its first step.
    let from = message;
    if (message.role !== "user") {
      const all = await this.deps.repos.messages.listByConversation(message.conversationId);
      const index = all.findIndex((m) => m.id === message.id);
      for (let i = index - 1; i >= 0 && all[i]!.role !== "user"; i -= 1) from = all[i]!;
    }
    await this.deps.repos.messages.deleteAfter(from.id, { inclusive: from.role !== "user" });
    this.deps.onChange?.(message.conversationId);
    await this.generate(message.conversationId);
  }

  /** Edits a user turn, drops everything after it and asks again. */
  async editAndResend(userMessageId: string, text: string): Promise<void> {
    const content = text.trim();
    const message = await this.requireMessage(userMessageId);
    if (message.role !== "user") throw new ChatError("bad_request", "Only user messages can be edited");
    if (!content) throw new ChatError("bad_request", "Message is empty");
    this.assertIdle(message.conversationId);
    await this.deps.repos.messages.update(userMessageId, { content });
    await this.deps.repos.messages.deleteAfter(userMessageId);
    this.deps.onChange?.(message.conversationId);
    await this.generate(message.conversationId);
  }

  /** Continues an aborted/interrupted reply in place. */
  async continue(assistantMessageId: string): Promise<void> {
    const message = await this.requireMessage(assistantMessageId);
    if (message.role !== "assistant") throw new ChatError("bad_request", "Only assistant messages can be continued");
    this.assertIdle(message.conversationId);
    await this.generate(message.conversationId, message);
  }

  /** Marks abandoned streams (tab closed / reload) as interrupted, keeping their partial text. */
  async recoverInterrupted(staleMs = STALE_STREAM_MS): Promise<number> {
    const now = this.clock();
    const streaming = await this.deps.repos.messages.listByStatus("streaming");
    const ownIds = new Set([...this.active.values()].map((run) => run.messageId));
    const held = (await this.deps.locks?.heldNames()) ?? null;
    let recovered = 0;
    for (const message of streaming) {
      if (ownIds.has(message.id)) continue;
      if (held) {
        if (held.has(streamLockName(message.id))) continue; // still streaming in another tab
      } else if (message.heartbeatAt !== null && now - message.heartbeatAt < staleMs) {
        continue; // no Web Locks: trust a fresh heartbeat
      }
      await this.deps.repos.messages.update(message.id, { status: "interrupted", heartbeatAt: null, finishReason: "aborted" });
      this.deps.onChange?.(message.conversationId);
      recovered += 1;
    }
    return recovered;
  }

  private assertIdle(conversationId: string): void {
    if (this.active.has(conversationId)) throw new ChatError("busy", "A reply is already being generated");
  }

  private async requireMessage(id: string): Promise<Message> {
    const message = await this.deps.repos.messages.get(id);
    if (!message) throw new StorageError("NOT_FOUND", `Message "${id}" was not found`);
    return message;
  }

  private async generate(conversationId: string, continueFrom?: Message, inputMode: InputMode = "text"): Promise<void> {
    const { repos, sink } = this.deps;
    const controller = new AbortController();
    // Reserve the slot synchronously so double-clicks cannot start two runs.
    this.active.set(conversationId, { controller, messageId: continueFrom?.id ?? "" });

    let messageId = continueFrom?.id;
    let text = continueFrom?.content ?? "";
    let reasoning = continueFrom ? reasoningOf(continueFrom.parts) : "";
    let signature: string | undefined;
    let toolCalls: ToolCallPartLike[] = [];
    let usage: TokenUsage | null = null;
    let finish: FinishReason = "stop";
    let lastFlush = 0;
    let flushing: Promise<unknown> = Promise.resolve();
    let uiPending = false;
    let releaseLock: (() => void) | undefined;
    let completed: ReplyCompleteInfo | null = null;
    let contextInfo: MessageContextInfo | null = null;
    let contextWindow = 0;
    let historyTokens = 0;
    /** Tool calls of a saved assistant step that still need a tool message (kept valid on cancel). */
    let unanswered: ToolCallPartLike[] = [];
    const runCallIds: string[] = [];

    const pushUi = () => {
      if (uiPending || !messageId) return;
      uiPending = true;
      this.schedule(() => {
        uiPending = false;
        if (messageId) sink.update(messageId, text, reasoning);
      });
    };

    const persistPartial = (force = false) => {
      if (!messageId) return;
      const now = this.clock();
      if (!force && now - lastFlush < this.flushIntervalMs) return;
      lastFlush = now;
      const id = messageId;
      const parts = buildParts(text, reasoning, signature, toolCalls);
      flushing = flushing
        .then(() => repos.messages.update(id, { parts, heartbeatAt: now }))
        .catch((error: unknown) => logger.warn("Could not persist partial reply", error));
    };

    try {
      const [conversation, settings, resolved] = await Promise.all([
        repos.conversations.get(conversationId),
        repos.settings.get().catch(() => DEFAULT_SETTINGS),
        this.resolveModel(conversationId),
      ]);
      const assistant = conversation?.assistantId ? await repos.assistants.get(conversation.assistantId) : null;
      const allMessages = await repos.messages.listByConversation(conversationId);
      const history = continueFrom ? allMessages.filter((m) => m.createdAt <= continueFrom.createdAt) : allMessages;

      let request = buildChatRequest({
        history,
        modelId: resolved.modelId,
        model: resolved.model,
        assistant,
        vars: { userName: settings.userName, locale: this.deps.locale?.() ?? settings.locale, now: new Date(this.clock()) },
      });
      const continueTurn = continueFrom ? { role: "user" as const, parts: [{ type: "text" as const, text: CONTINUE_PROMPT }] } : undefined;
      if (this.deps.context) {
        const prepared = await prepareContext(
          { conversationId, history, request, assistant: assistant ?? null, model: resolved.model, settings, extraUserTurn: continueTurn, signal: controller.signal },
          this.deps.context,
        );
        if (prepared.result.overflow && prepared.windowKnown) {
          throw new ChatError("context_overflow", `The message does not fit the model context window (${prepared.info.contextWindow} tokens)`);
        }
        request = prepared.request;
        contextInfo = prepared.info;
      } else if (continueTurn) {
        request.messages.push(continueTurn);
      }
      contextWindow = contextInfo?.contextWindow ?? resolved.model?.contextWindow ?? settings.context?.defaultContextWindow ?? 8192;
      historyTokens = (request.system ? estimateTokens(request.system) : 0) + toChatMessagesTokens(history);

      // Tools: only for models that can call functions (unknown capability = try).
      const toolSettings = settings.tools ?? DEFAULT_TOOL_SETTINGS;
      const canUseTools = resolved.model?.capabilities.tools !== false;
      const activeTools = this.deps.tools && canUseTools ? await this.deps.tools.resolve({ assistant: assistant ?? null, settings }) : [];
      const toolMap = new Map(activeTools.map((a) => [a.tool.name, a]));
      if (activeTools.length) request = { ...request, tools: toToolSpecs(activeTools) };

      if (continueFrom) {
        await repos.messages.update(continueFrom.id, {
          status: "streaming",
          error: null,
          heartbeatAt: this.clock(),
          providerId: resolved.provider.id,
          modelId: resolved.modelId,
          context: contextInfo,
        });
      } else {
        const created = await repos.messages.create({
          conversationId,
          role: "assistant",
          content: "",
          status: "streaming",
          providerId: resolved.provider.id,
          modelId: resolved.modelId,
          heartbeatAt: this.clock(),
          context: contextInfo,
        });
        messageId = created.id;
      }
      releaseLock = await this.deps.locks?.acquire(streamLockName(messageId as string));
      this.active.set(conversationId, { controller, messageId: messageId as string });
      sink.begin({ messageId: messageId as string, conversationId, text, reasoning, startedAt: this.clock() });
      this.deps.onChange?.(conversationId);

      const provider = await this.deps.getChatProvider(resolved.provider.id);
      const timeoutMs = (settings.requestTimeoutSec ?? DEFAULT_SETTINGS.requestTimeoutSec) * 1000;
      if (this.deps.media) {
        request = await resolveRequestMedia(request, this.deps.media, {
          providerId: resolved.provider.id,
          providerKind: resolved.provider.kind,
          capabilities: resolved.model?.capabilities ?? { vision: false, audio: false, video: false, tools: false, reasoning: false },
          provider,
          videoMode: settings.media?.videoMode ?? "auto",
          now: this.clock,
          signal: controller.signal,
        });
      }

      // Agent loop: stream → (tool calls? run them, append results, stream again) until a final answer or maxSteps.
      for (let step = 0; ; step += 1) {
        const id = messageId as string;
        for await (const event of provider.streamChat(request, { signal: controller.signal, timeoutMs })) {
          switch (event.type) {
            case "text-delta":
              text += event.text;
              break;
            case "reasoning-delta":
              reasoning += event.text;
              if (event.signature) signature = event.signature;
              break;
            case "tool-call":
              toolCalls.push({ id: event.id, name: event.name, arguments: event.arguments, ...(event.signature ? { signature: event.signature } : {}) });
              break;
            case "usage":
              usage = event.usage;
              break;
            case "finish":
              finish = event.reason;
              if (event.usage) usage = event.usage;
              break;
            default:
              break;
          }
          if (event.type === "text-delta" || event.type === "reasoning-delta") {
            pushUi();
            persistPartial();
          }
        }

        await flushing;
        const parts = buildParts(text, reasoning, signature, toolCalls);
        const wantsTools = toolCalls.length > 0 && this.deps.tools !== undefined;
        await repos.messages.update(id, { parts, status: "complete", usage, finishReason: wantsTools ? "tool_calls" : finish, heartbeatAt: null, error: null });
        if (!wantsTools) break;

        // --- run the requested tools
        unanswered = toolCalls;
        runCallIds.push(...toolCalls.map((c) => c.id));
        sink.end(id);
        releaseLock?.();
        releaseLock = undefined;
        this.deps.onChange?.(conversationId);
        const overLimit = step + 1 > toolSettings.maxSteps;
        const results: ToolResultPart[] = overLimit
          ? toolCalls.map((call) => ({ type: "tool_result", toolCallId: call.id, name: call.name, content: "Error: tool step limit reached. Answer with what you have.", isError: true, outcome: "error" }))
          : await this.deps.tools!.runner.runCalls(toolCalls, {
              conversationId,
              assistantId: assistant?.id ?? null,
              tools: toolMap,
              signal: controller.signal,
              timeoutMs: toolSettings.timeoutSec * 1000,
              parallel: toolSettings.parallel,
            });
        await repos.messages.create({ conversationId, role: "tool", content: "", parts: results, status: "complete" });
        unanswered = [];
        request = {
          ...request,
          messages: [...request.messages, { role: "assistant", parts }, { role: "tool", parts: results }],
          // Last allowed step: the model must answer in text.
          ...(step + 1 >= toolSettings.maxSteps ? { toolChoice: "none" as const } : {}),
        };
        if (overLimit) break;

        // --- next assistant step
        text = "";
        reasoning = "";
        signature = undefined;
        toolCalls = [];
        usage = null;
        finish = "stop";
        const next = await repos.messages.create({
          conversationId,
          role: "assistant",
          content: "",
          status: "streaming",
          providerId: resolved.provider.id,
          modelId: resolved.modelId,
          heartbeatAt: this.clock(),
        });
        messageId = next.id;
        releaseLock = await this.deps.locks?.acquire(streamLockName(next.id));
        this.active.set(conversationId, { controller, messageId: next.id });
        sink.begin({ messageId: next.id, conversationId, text: "", reasoning: "", startedAt: this.clock() });
        this.deps.onChange?.(conversationId);
      }

      completed = {
        conversationId,
        messageId: messageId as string,
        text,
        assistantId: conversation?.assistantId ?? null,
        inputMode,
        historyTokens: historyTokens + estimateTokens(text) + 4,
        contextWindow,
      };
    } catch (raw) {
      await flushing;
      const aborted = controller.signal.aborted || isAbortError(raw);
      const failure = userFacingError(raw);
      if (unanswered.length) {
        // Keep history valid: every tool call needs a result, even if it never ran.
        await repos.messages
          .create({
            conversationId,
            role: "tool",
            content: "",
            status: "complete",
            parts: unanswered.map((call) => ({
              type: "tool_result" as const,
              toolCallId: call.id,
              name: call.name,
              content: aborted ? "Cancelled by the user." : `Error: ${failure.message}`,
              isError: true,
              outcome: aborted ? ("cancelled" as const) : ("error" as const),
            })),
          })
          .catch((error: unknown) => logger.error("Could not save tool results", error));
      } else if (messageId) {
        await repos.messages
          .update(messageId, {
            parts: buildParts(text, reasoning, signature, toolCalls),
            status: aborted ? "aborted" : "error",
            error: aborted ? null : failure.message,
            finishReason: aborted ? "aborted" : "error",
            heartbeatAt: null,
            usage,
          })
          .catch((error: unknown) => logger.error("Could not save failed reply", error));
      }
      if (!aborted) {
        logger.warn(`Chat request failed (${failure.code})`, failure.message);
        if (raw instanceof ChatError || raw instanceof StorageError) throw raw;
        throw raw instanceof ProviderError ? raw : toProviderError(raw);
      }
    } finally {
      releaseLock?.();
      this.active.delete(conversationId);
      if (messageId) sink.end(messageId);
      if (runCallIds.length) this.deps.tools?.onRunFinished?.(runCallIds);
      this.deps.onChange?.(conversationId);
    }

    if (completed) {
      try {
        this.deps.onReplyComplete?.(completed);
      } catch (error) {
        logger.warn("onReplyComplete handler failed", error);
      }
    }
    void this.maybeGenerateTitle(conversationId).catch(() => undefined);
  }

  /**
   * Estimates the next request (no network: memories are not retrieved, their share comes
   * from the last reply). Powers the context meter and the "won't fit" warning.
   */
  async previewContext(conversationId: string, draft = ""): Promise<ContextPreview> {
    const { repos } = this.deps;
    const [conversation, settings, resolved] = await Promise.all([
      repos.conversations.get(conversationId),
      repos.settings.get().catch(() => DEFAULT_SETTINGS),
      this.resolveModel(conversationId),
    ]);
    const assistant = conversation?.assistantId ? await repos.assistants.get(conversation.assistantId) : null;
    const history = await repos.messages.listByConversation(conversationId);
    const request = buildChatRequest({
      history,
      modelId: resolved.modelId,
      model: resolved.model,
      assistant,
      vars: { userName: settings.userName, locale: this.deps.locale?.() ?? settings.locale, now: new Date(this.clock()) },
    });
    const lastReply = [...history].reverse().find((m) => m.role === "assistant" && m.status === "complete");
    const prepared = await prepareContext({ conversationId, history, request, assistant: assistant ?? null, model: resolved.model, settings, draft, retrieve: false }, this.deps.context ?? {});
    // Retrieval needs the network; assume the next request injects about as much memory as the last one.
    const memoryShare = settings.memory?.enabled ? (lastReply?.context?.memoryTokens ?? 0) : 0;
    const breakdown = { ...prepared.result.breakdown, memory: memoryShare, total: prepared.result.breakdown.total + memoryShare };
    return {
      breakdown,
      ratio: breakdown.window > 0 ? breakdown.total / breakdown.window : 1,
      omittedMessages: prepared.result.omittedMessages,
      summarizedMessages: prepared.result.summarizedMessages,
      overflow: prepared.result.overflow,
      windowKnown: prepared.windowKnown,
      lastInputTokens: lastReply?.usage?.inputTokens || null,
      lastContext: lastReply?.context ?? null,
    };
  }

  /** Refines the heuristic title using the model after the first exchange. Best-effort. */
  async maybeGenerateTitle(conversationId: string): Promise<void> {
    const { repos } = this.deps;
    const [conversation, settings] = await Promise.all([repos.conversations.get(conversationId), repos.settings.get()]);
    if (!conversation || !settings.autoTitle || conversation.titleSource === "manual") return;
    const messages = await repos.messages.listByConversation(conversationId);
    const users = messages.filter((m) => m.role === "user");
    const firstUser = users[0];
    const reply = messages.find((m) => m.role === "assistant" && m.status === "complete" && m.content.trim());
    if (users.length !== 1 || !firstUser || !reply || !firstUser.content.trim()) return;

    const resolved = await this.resolveModel(conversationId);
    const cheap = await this.deps.auxiliary?.titleModel().catch(() => null);
    const providerId = cheap?.providerId ?? resolved.provider.id;
    const modelId = cheap?.modelId ?? resolved.modelId;
    const provider = await this.deps.getChatProvider(providerId);
    let titleUsage: TokenUsage | null = null;
    const response = await collectResponse(
      provider,
      {
        model: modelId,
        system: TITLE_PROMPT,
        maxTokens: 32,
        temperature: 0.2,
        messages: [
          { role: "user", parts: [{ type: "text", text: firstUser.content.slice(0, 2000) }] },
          { role: "assistant", parts: [{ type: "text", text: reply.content.slice(0, 1000) }] },
          { role: "user", parts: [{ type: "text", text: TITLE_PROMPT }] },
        ],
      },
      { timeoutMs: 15_000, retry: { retries: 0 } },
    );
    const raw = response.text;
    titleUsage = response.usage;
    if (cheap) await this.deps.auxiliary?.recordUsage({ kind: "title", providerId, modelId, conversationId, usage: titleUsage }).catch(() => undefined);
    const title = cleanGeneratedTitle(raw);
    const latest = await repos.conversations.get(conversationId);
    if (title && latest && latest.titleSource !== "manual") {
      await repos.conversations.update(conversationId, { title, titleSource: "auto" });
      this.deps.onChange?.(conversationId);
    }
  }
}
