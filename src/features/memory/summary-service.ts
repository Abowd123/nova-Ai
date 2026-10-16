import { collectResponse } from "@/lib/ai/collect";
import type { ChatProvider } from "@/lib/ai/types";
import { estimateTokens, truncateToTokens } from "@/lib/context/tokens";
import { SUMMARY_SYSTEM, cleanSummary, summaryUserPrompt, transcriptLine } from "@/lib/memory/prompts";
import { DEFAULT_CONTEXT_SETTINGS, type ConversationSummary, type Message, type ProviderModel } from "@/lib/models";
import type { Repositories } from "@/lib/storage/types";

export interface SummaryServiceDeps {
  repos: Repositories;
  getChatProvider: (providerId: string) => Promise<ChatProvider>;
  /** The conversation's own model (fallback when no cheap summary model is configured). */
  resolveModel: (conversationId: string) => Promise<{ provider: { id: string }; modelId: string; model: ProviderModel | undefined }>;
  onChange?: (conversationId: string) => void;
  /** Cheap sub-agent model used when no summary model is set (context compression). */
  fallbackModel?: () => Promise<{ providerId: string; modelId: string } | null>;
  /** Separate cost tracking for summaries. */
  recordUsage?: (input: { providerId: string; modelId: string; conversationId: string; usage: { inputTokens: number; outputTokens: number } | null }) => Promise<void>;
}

export type SummarySkipReason = "manual" | "nothing_new" | "too_short" | "disabled" | "busy";

export type SummarizeOutcome = { status: "updated"; summary: ConversationSummary } | { status: "skipped"; reason: SummarySkipReason };

/** Messages kept verbatim at the end (never summarized). */
export const KEEP_RECENT = 6;
/** Max transcript tokens sent per summary call; longer backlogs are folded in several rounds. */
const ROUND_TOKENS = 6000;
const MAX_ROUNDS = 6;

function usable(messages: Message[]): Message[] {
  return messages.filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim() && (m.status === "complete" || m.status === "aborted" || m.status === "interrupted"));
}

/**
 * Rolling conversation summaries with a cheap model. A summary the user edited
 * (manualEdit=true) is NEVER overwritten automatically; only an explicit "regenerate" does.
 */
export class SummaryService {
  private readonly running = new Set<string>();

  constructor(private readonly deps: SummaryServiceDeps) {}

  get(conversationId: string): Promise<ConversationSummary | undefined> {
    return this.deps.repos.summaries.get(conversationId);
  }

  private async model(conversationId: string): Promise<{ providerId: string; modelId: string }> {
    const settings = await this.deps.repos.settings.get();
    const context = settings.context ?? DEFAULT_CONTEXT_SETTINGS;
    if (context.summaryProviderId && context.summaryModelId) {
      const provider = await this.deps.repos.providers.get(context.summaryProviderId);
      if (provider?.enabled) return { providerId: provider.id, modelId: context.summaryModelId };
    }
    const cheap = await this.deps.fallbackModel?.().catch(() => null);
    if (cheap) return cheap;
    const resolved = await this.deps.resolveModel(conversationId);
    return { providerId: resolved.provider.id, modelId: resolved.modelId };
  }

  /**
   * Folds messages older than the last KEEP_RECENT into the summary.
   * @param force regenerate from scratch, even over a manual edit (explicit user action).
   */
  async summarize(conversationId: string, options: { force?: boolean; signal?: AbortSignal; keepRecent?: number } = {}): Promise<SummarizeOutcome> {
    if (this.running.has(conversationId)) return { status: "skipped", reason: "busy" };
    this.running.add(conversationId);
    try {
      const existing = await this.deps.repos.summaries.get(conversationId);
      if (existing?.manualEdit && !options.force) return { status: "skipped", reason: "manual" };
      const messages = usable(await this.deps.repos.messages.listByConversation(conversationId));
      const keep = options.keepRecent ?? KEEP_RECENT;
      if (messages.length <= keep) return { status: "skipped", reason: "too_short" };
      const olderThanRecent = messages.slice(0, messages.length - keep);
      const since = options.force ? null : (existing?.coveredUntil ?? null);
      const pending = olderThanRecent.filter((m) => since === null || m.createdAt > since);
      if (pending.length === 0) return { status: "skipped", reason: "nothing_new" };

      const { providerId, modelId } = await this.model(conversationId);
      const provider = await this.deps.getChatProvider(providerId);
      let text = options.force ? null : (existing?.text ?? null);
      let covered = options.force ? 0 : (existing?.coveredMessageCount ?? 0);
      let coveredUntil = since;
      let index = 0;
      for (let round = 0; round < MAX_ROUNDS && index < pending.length; round += 1) {
        const lines: string[] = [];
        let budget = ROUND_TOKENS;
        while (index < pending.length) {
          const message = pending[index]!;
          let line = transcriptLine(message.role, message.content);
          if (estimateTokens(line) > budget) {
            if (lines.length) break;
            line = `${truncateToTokens(line, budget)}…`;
          }
          lines.push(line);
          budget -= estimateTokens(line);
          coveredUntil = message.createdAt;
          covered += 1;
          index += 1;
        }
        const response = await collectResponse(
          provider,
          {
            model: modelId,
            system: SUMMARY_SYSTEM,
            temperature: 0.2,
            maxTokens: 1024,
            messages: [{ role: "user", parts: [{ type: "text", text: summaryUserPrompt(text, lines.join("\n\n")) }] }],
          },
          { signal: options.signal, timeoutMs: 60_000, retry: { retries: 1 } },
        );
        const raw = response.text;
        await this.deps.recordUsage?.({ providerId, modelId, conversationId, usage: response.usage }).catch(() => undefined);
        const cleaned = cleanSummary(raw);
        if (cleaned) text = cleaned;
      }
      if (!text) return { status: "skipped", reason: "nothing_new" };
      // A manual edit made while we were working wins.
      const latest = await this.deps.repos.summaries.get(conversationId);
      if (latest?.manualEdit && !options.force) return { status: "skipped", reason: "manual" };
      const summary = await this.deps.repos.summaries.put(conversationId, {
        text,
        manualEdit: false,
        coveredUntil,
        coveredMessageCount: covered,
        tokens: estimateTokens(text),
        providerId,
        modelId,
      });
      this.deps.onChange?.(conversationId);
      return { status: "updated", summary };
    } finally {
      this.running.delete(conversationId);
    }
  }

  /** Saves a user-written/edited summary (protected from automatic updates from now on). */
  async saveManual(conversationId: string, text: string): Promise<ConversationSummary> {
    const existing = await this.deps.repos.summaries.get(conversationId);
    let coveredUntil = existing?.coveredUntil ?? null;
    let covered = existing?.coveredMessageCount ?? 0;
    if (!existing) {
      const messages = usable(await this.deps.repos.messages.listByConversation(conversationId));
      const older = messages.slice(0, Math.max(0, messages.length - KEEP_RECENT));
      coveredUntil = older.at(-1)?.createdAt ?? null;
      covered = older.length;
    }
    const summary = await this.deps.repos.summaries.put(conversationId, {
      text: text.trim(),
      manualEdit: true,
      coveredUntil,
      coveredMessageCount: covered,
      tokens: estimateTokens(text),
      providerId: existing?.providerId ?? null,
      modelId: existing?.modelId ?? null,
    });
    this.deps.onChange?.(conversationId);
    return summary;
  }

  async remove(conversationId: string): Promise<void> {
    await this.deps.repos.summaries.delete(conversationId);
    this.deps.onChange?.(conversationId);
  }

  /** After a reply: summarize when the history uses more than `summarizeAt` of the window. */
  async maybeAutoSummarize(conversationId: string, estimatedHistoryTokens: number, contextWindow: number): Promise<SummarizeOutcome> {
    const settings = await this.deps.repos.settings.get();
    const context = settings.context ?? DEFAULT_CONTEXT_SETTINGS;
    if (!context.autoSummarize) return { status: "skipped", reason: "disabled" };
    if (estimatedHistoryTokens < contextWindow * context.summarizeAt) return { status: "skipped", reason: "too_short" };
    return this.summarize(conversationId);
  }
}
