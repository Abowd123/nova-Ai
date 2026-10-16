import type { ChatMessage, ChatRequest } from "@/lib/ai/types";
import { buildContext, contextWindowFor, reserveFor, type ContextMessage, type ContextResult } from "@/lib/context/context-manager";
import { matchLorebooks } from "@/lib/memory/lorebook";
import {
  DEFAULT_CONTEXT_SETTINGS,
  DEFAULT_MEMORY_SETTINGS,
  type AppSettings,
  type Assistant,
  type ConversationSummary,
  type Lorebook,
  type Message,
  type MessageContextInfo,
  type ProviderModel,
} from "@/lib/models";
import { toChatMessages } from "./build-request";

export interface ContextRetriever {
  retrieve(input: {
    query: string;
    assistant: Assistant | null;
    conversationId: string;
    excludeMessageIds: readonly string[];
    signal?: AbortSignal;
  }): Promise<{ hits: { chunk: { id: string; text: string }; score: number }[]; retrieval: "semantic" | "text" | "none" }>;
}

export interface ContextSources {
  retriever?: ContextRetriever;
  summaries?: { get(conversationId: string): Promise<ConversationSummary | undefined> };
  lorebooks?: { list(): Promise<Lorebook[]> };
}

export interface PrepareContextInput {
  conversationId: string;
  history: Message[];
  /** Output of buildChatRequest (its system + params are kept, messages are rebuilt). */
  request: ChatRequest;
  assistant: Assistant | null;
  model: ProviderModel | undefined;
  settings: AppSettings;
  /** Synthetic final user turn (e.g. "continue"). */
  extraUserTurn?: ChatMessage;
  /** Draft text for previews (not stored yet). */
  draft?: string;
  /** false = no network (usage previews while typing). */
  retrieve?: boolean;
  signal?: AbortSignal;
}

export interface PreparedContext {
  request: ChatRequest;
  info: MessageContextInfo;
  result: ContextResult;
  /** Model window is known (overflow is certain, not a guess). */
  windowKnown: boolean;
}

const USABLE = new Set<Message["status"]>(["complete", "aborted", "interrupted"]);

/** Like toChatMessages but keeps ids/timestamps. */
export function toContextMessages(history: Message[], limit: number | null | undefined): ContextMessage[] {
  const usable = history.filter((m) => m.role !== "system" && USABLE.has(m.status));
  const out: ContextMessage[] = [];
  for (const message of usable) {
    const [chat] = toChatMessages([message]);
    if (chat) out.push({ message: chat, id: message.id, createdAt: message.createdAt });
  }
  if (!limit || out.length <= limit) return out;
  const window = out.slice(-limit);
  while (window.length > 1 && window[0]!.message.role === "assistant") window.shift();
  return window;
}

function textOf(message: ChatMessage): string {
  return message.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").trim();
}

/**
 * Builds the final request: lorebook triggers, RAG memories (scope rules, current window
 * excluded), rolling summary and the token budget. Two passes: the first finds which stored
 * messages fit, so retrieval never returns text the model already sees.
 */
export async function prepareContext(input: PrepareContextInput, sources: ContextSources): Promise<PreparedContext> {
  const memorySettings = input.settings.memory ?? DEFAULT_MEMORY_SETTINGS;
  const contextSettings = input.settings.context ?? DEFAULT_CONTEXT_SETTINGS;
  const messages = toContextMessages(input.history, input.assistant?.contextMessageLimit);
  if (input.draft?.trim()) messages.push({ message: { role: "user", parts: [{ type: "text", text: input.draft.trim() }] } });
  if (input.extraUserTurn) messages.push({ message: input.extraUserTurn });

  const window = contextWindowFor(input.model, contextSettings.defaultContextWindow);
  const reserve = reserveFor(input.assistant?.maxTokens, contextSettings.reserveOutputTokens, window);
  const [summary, books] = await Promise.all([
    sources.summaries?.get(input.conversationId).catch(() => undefined),
    sources.lorebooks?.list().catch(() => [] as Lorebook[]),
  ]);
  const lore = matchLorebooks(books ?? [], messages.map((m) => textOf(m.message)), {
    assistantId: input.assistant?.id ?? null,
    conversationId: input.conversationId,
  });
  const base = {
    system: input.request.system,
    lore,
    summary: summary ? { text: summary.text, coveredUntil: summary.coveredUntil } : null,
    messages,
    contextWindow: window,
    reserveOutput: reserve,
    maxToolResultTokens: contextSettings.maxToolResultTokens,
    memoryTokenBudget: memorySettings.tokenBudget,
    templates: { memory: memorySettings.promptTemplate },
  };

  let result = buildContext({ ...base, memories: [] });
  let retrieval: MessageContextInfo["retrieval"] = "none";
  if (input.retrieve !== false && sources.retriever && memorySettings.enabled) {
    // Query = the latest real user turn (a synthetic "continue" prompt carries no meaning).
    const lastUser = [...messages].reverse().find((m) => m.message.role === "user" && m.message !== input.extraUserTurn);
    const query = lastUser ? textOf(lastUser.message) : "";
    const found = await sources.retriever.retrieve({
      query,
      assistant: input.assistant,
      conversationId: input.conversationId,
      excludeMessageIds: result.keptMessageIds,
      signal: input.signal,
    });
    retrieval = found.retrieval;
    if (found.hits.length) {
      result = buildContext({ ...base, memories: found.hits.map((h) => ({ id: h.chunk.id, text: h.chunk.text, score: h.score })) });
    }
  }

  const request: ChatRequest = { ...input.request, system: result.system, messages: result.messages, promptCache: true };
  if (!request.system) delete request.system;
  return {
    request,
    result,
    windowKnown: Boolean(input.model?.contextWindow),
    info: {
      memoryIds: result.usedMemoryIds,
      memoryScores: result.usedMemoryScores,
      lore: result.usedLore,
      summaryUsed: result.summaryUsed,
      omittedMessages: result.omittedMessages,
      estimatedInputTokens: result.breakdown.total,
      memoryTokens: result.breakdown.memory,
      contextWindow: window,
      retrieval: result.usedMemoryIds.length ? retrieval : "none",
    },
  };
}
