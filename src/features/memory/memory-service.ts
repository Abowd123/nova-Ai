import { createEmbeddingProvider, embeddingModelKey, supportsEmbeddings, type EmbeddingProvider } from "@/lib/ai/embeddings";
import { ProviderError, toProviderError } from "@/lib/ai/errors";
import type { HttpClient, ProviderConfig } from "@/lib/ai/types";
import { estimateTokens } from "@/lib/context/tokens";
import { logger } from "@/lib/logger";
import { chunkText } from "@/lib/memory/chunker";
import { createInlineIndexClient, type MemoryIndexClient } from "@/lib/memory/index-client";
import type { IndexEntry, ScopeFilter, SearchHit } from "@/lib/memory/memory-index";
import { memoryHash } from "@/lib/memory/text";
import { DEFAULT_MEMORY_SETTINGS, type Assistant, type MemoryChunk, type MemoryChunkScope, type MemorySettings, type Message } from "@/lib/models";
import { redactSecrets } from "@/lib/security/redact";
import type { MemoryIndexStats, Repositories } from "@/lib/storage/types";

export type RetrievalScope = "none" | "global" | "assistant" | "conversation";

export interface MemoryServiceDeps {
  repos: Repositories;
  getProviderConfig: (providerId: string) => Promise<ProviderConfig>;
  httpFor: (config: ProviderConfig) => HttpClient;
  index?: MemoryIndexClient;
  /** Fired when chunks/index status change (refresh UI queries). */
  onChange?: () => void;
  isOnline?: () => boolean;
  /** Delay before retrying a failed embedding batch caused by network/rate limits. */
  retryDelayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  appUrl?: string;
}

export interface MemoryHit {
  chunk: MemoryChunk;
  score: number;
  semantic: number | null;
  lexical: number;
}

export interface RetrieveResult {
  hits: MemoryHit[];
  retrieval: "semantic" | "text" | "none";
}

export type MemoryErrorCode = "embedding_unsupported" | "not_configured";

export class MemoryError extends Error {
  constructor(
    readonly code: MemoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MemoryError";
  }
}

const QUERY_CACHE = 32;

/** Scope used by a conversation (assistant setting, else app default for plain chats). */
export function scopeFor(assistant: Pick<Assistant, "memoryScope"> | null | undefined, settings: MemorySettings): RetrievalScope {
  if (!settings.enabled) return "none";
  return assistant ? assistant.memoryScope : settings.defaultScope;
}

export function filterFor(scope: Exclude<RetrievalScope, "none">, assistantId: string | null, conversationId: string | null): ScopeFilter {
  return { mode: scope, assistantId, conversationId };
}

function toEntry(chunk: MemoryChunk, vector: Float32Array | null): IndexEntry {
  return {
    id: chunk.id,
    text: chunk.text,
    scope: chunk.scope,
    assistantId: chunk.assistantId,
    conversationId: chunk.conversationId,
    sourceMessageId: chunk.sourceMessageId,
    createdAt: chunk.createdAt,
    vector,
  };
}

/**
 * Local long-term memory: chunks messages, embeds them in the background (batched, resumable,
 * offline-tolerant), keeps a hybrid semantic+keyword index in a Web Worker and serves RAG
 * retrieval. Works without any embedding provider (keyword search only).
 */
export class MemoryService {
  private readonly index: MemoryIndexClient;
  private loadedKey: string | null = null;
  private loading: Promise<void> | null = null;
  private processing: Promise<void> | null = null;
  private retryTimer: unknown = null;
  private embedderCache: { key: string; provider: EmbeddingProvider } | null = null;
  private readonly queryCache = new Map<string, Float32Array>();
  private lastError: string | null = null;

  constructor(private readonly deps: MemoryServiceDeps) {
    this.index = deps.index ?? createInlineIndexClient();
  }

  async settings(): Promise<MemorySettings> {
    return (await this.deps.repos.settings.get().catch(() => null))?.memory ?? DEFAULT_MEMORY_SETTINGS;
  }

  /** "" when no embedding provider is configured (keyword search only). */
  modelKey(settings: MemorySettings): string {
    return settings.embeddingProviderId && settings.embeddingModel.trim() ? embeddingModelKey(settings.embeddingProviderId, settings.embeddingModel.trim(), settings.embeddingDimensions) : "";
  }

  get error(): string | null {
    return this.lastError;
  }

  private async embedder(settings: MemorySettings): Promise<EmbeddingProvider | null> {
    const key = this.modelKey(settings);
    if (!key || !settings.embeddingProviderId) return null;
    if (this.embedderCache?.key === key) return this.embedderCache.provider;
    const config = await this.deps.getProviderConfig(settings.embeddingProviderId);
    if (!supportsEmbeddings(config.kind)) throw new MemoryError("embedding_unsupported", `${config.kind} has no embeddings API`);
    const provider = createEmbeddingProvider(config, this.deps.httpFor(config), settings.embeddingModel.trim(), settings.embeddingDimensions, this.deps.appUrl);
    this.embedderCache = { key, provider };
    return provider;
  }

  /** Times hybrid search over `count` synthetic memories where real searches run (worker). */
  benchmark(count = 10_000, dims = 768) {
    return this.index.benchmark(count, dims);
  }

  /** Call when the worker index was lost (crash) or settings changed. */
  invalidate(): void {
    this.loadedKey = null;
    this.embedderCache = null;
    this.queryCache.clear();
  }

  /** Loads the index for the current embedding model (reindexes when the model changed). */
  async ensureIndex(): Promise<string> {
    const settings = await this.settings();
    const key = this.modelKey(settings);
    if (this.loadedKey === key) return key;
    if (!this.loading) {
      this.loading = (async () => {
        const rows = await this.deps.repos.memory.listForIndex(key);
        await this.index.reset(rows.map((r) => toEntry(r.chunk, r.vector)));
        const changed = this.loadedKey !== null;
        this.loadedKey = key;
        this.queryCache.clear();
        if (key) {
          // Model changed: drop vectors from the old model and embed everything again.
          if (changed) await this.deps.repos.memory.pruneVectors(key);
          this.schedule();
        }
      })().finally(() => {
        this.loading = null;
      });
    }
    await this.loading;
    return key;
  }

  /** Indexes the given messages of a conversation (after a reply). Idempotent thanks to hashes. */
  async indexMessages(conversationId: string, messages: Message[]): Promise<number> {
    const settings = await this.settings();
    if (!settings.enabled || !settings.autoIndex) return 0;
    const conversation = await this.deps.repos.conversations.get(conversationId);
    if (!conversation) return 0;
    const assistant = conversation.assistantId ? await this.deps.repos.assistants.get(conversation.assistantId) : null;
    const scope = scopeFor(assistant, settings);
    if (scope === "none") return 0;
    let created = 0;
    const entries: IndexEntry[] = [];
    for (const message of messages) {
      if ((message.role !== "user" && message.role !== "assistant") || message.status !== "complete") continue;
      const pieces = chunkText(message.content, { targetTokens: settings.chunkTokens, overlapTokens: settings.chunkOverlap });
      for (const piece of pieces) {
        const owner = { scope, assistantId: conversation.assistantId, conversationId };
        const result = await this.deps.repos.memory.create({
          text: piece.text,
          scope,
          assistantId: conversation.assistantId,
          conversationId,
          sourceMessageId: message.id,
          source: "message",
          role: message.role,
          chunkIndex: piece.index,
          tokens: piece.tokens,
          hash: memoryHash(piece.text, owner),
        });
        if (result.created) {
          created += 1;
          entries.push(toEntry(result.chunk, null));
        }
      }
    }
    if (entries.length) {
      await this.ensureIndex();
      await this.index.upsert(entries);
      this.deps.onChange?.();
      this.schedule();
    }
    return created;
  }

  /** Indexes the latest exchange of a conversation. */
  async indexLatestTurn(conversationId: string): Promise<number> {
    const messages = await this.deps.repos.messages.listByConversation(conversationId);
    let lastAssistant = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]!.role === "assistant") {
        lastAssistant = i;
        break;
      }
    }
    if (lastAssistant < 0) return 0;
    let start = lastAssistant;
    while (start > 0 && messages[start - 1]!.role !== "assistant") start -= 1;
    return this.indexMessages(conversationId, messages.slice(start, lastAssistant + 1));
  }

  async addManual(input: { text: string; scope: Exclude<MemoryChunkScope, "conversation">; assistantId: string | null }): Promise<MemoryChunk> {
    const text = input.text.trim();
    const assistantId = input.scope === "assistant" ? input.assistantId : null;
    const { chunk, created } = await this.deps.repos.memory.create({
      text,
      scope: input.scope,
      assistantId,
      source: "manual",
      tokens: estimateTokens(text),
      hash: memoryHash(text, { scope: input.scope, assistantId }),
    });
    if (created) {
      await this.ensureIndex();
      await this.index.upsert([toEntry(chunk, null)]);
      this.schedule();
    }
    this.deps.onChange?.();
    return chunk;
  }

  async update(id: string, patch: { text?: string; scope?: MemoryChunkScope; assistantId?: string | null }): Promise<MemoryChunk> {
    const existing = await this.deps.repos.memory.get(id);
    const text = patch.text?.trim();
    const scope = patch.scope ?? existing?.scope ?? "global";
    const assistantId = patch.assistantId !== undefined ? patch.assistantId : (existing?.assistantId ?? null);
    const next = await this.deps.repos.memory.update(id, {
      ...(text !== undefined ? { text, tokens: estimateTokens(text) } : {}),
      ...(patch.scope ? { scope } : {}),
      ...(patch.assistantId !== undefined ? { assistantId } : {}),
      hash: memoryHash(text ?? existing?.text ?? "", { scope, assistantId, conversationId: existing?.conversationId ?? null }),
    });
    await this.ensureIndex();
    await this.index.upsert([toEntry(next, null)]);
    this.schedule();
    this.deps.onChange?.();
    return next;
  }

  async remove(ids: string[]): Promise<void> {
    await this.deps.repos.memory.delete(ids);
    if (this.loadedKey !== null) await this.index.remove(ids);
    this.deps.onChange?.();
  }

  /** Re-embeds everything with the current model (manual button / model change). */
  async reindex(): Promise<void> {
    await this.deps.repos.memory.resetErrors();
    this.invalidate();
    const key = await this.ensureIndex();
    if (key) await this.deps.repos.memory.pruneVectors(key);
    this.schedule();
    this.deps.onChange?.();
  }

  async stats(): Promise<MemoryIndexStats & { modelKey: string; error: string | null; running: boolean }> {
    const key = this.modelKey(await this.settings());
    return { ...(await this.deps.repos.memory.stats(key)), modelKey: key, error: this.lastError, running: this.processing !== null };
  }

  /** Starts background embedding if needed (single-flight). */
  schedule(): void {
    if (this.processing) return;
    this.processing = this.processPending()
      .catch((error: unknown) => logger.warn("Memory indexing failed", error))
      .finally(() => {
        this.processing = null;
      });
  }

  /** Resolves when the current background run (if any) finishes. */
  async idle(): Promise<void> {
    while (this.processing) await this.processing;
  }

  private retryLater(): void {
    if (this.retryTimer) return;
    const set = this.deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    this.retryTimer = set(() => {
      this.retryTimer = null;
      this.schedule();
    }, this.deps.retryDelayMs ?? 60_000);
  }

  private async processPending(): Promise<void> {
    const settings = await this.settings();
    const key = await this.ensureIndex();
    if (!key) return;
    let provider: EmbeddingProvider | null;
    try {
      provider = await this.embedder(settings);
    } catch (error) {
      this.lastError = error instanceof Error ? redactSecrets(error.message) : "embedding provider unavailable";
      return;
    }
    if (!provider) return;
    for (let round = 0; round < 10_000; round += 1) {
      if (this.deps.isOnline && !this.deps.isOnline()) {
        this.retryLater();
        return;
      }
      if (this.modelKey(await this.settings()) !== key) return; // model changed mid-run: the next ensureIndex restarts
      const batch = await this.deps.repos.memory.listPending(key, provider.maxBatch);
      if (batch.length === 0) {
        this.lastError = null;
        this.deps.onChange?.();
        return;
      }
      try {
        const { vectors } = await provider.embed(
          batch.map((c) => c.text),
          { task: "document", timeoutMs: 120_000 },
        );
        const items = batch.map((chunk, i) => ({ id: chunk.id, vector: vectors[i]! }));
        await this.deps.repos.memory.saveVectors(key, items);
        await this.index.upsert(batch.map((chunk, i) => toEntry(chunk, vectors[i]!)));
        this.lastError = null;
        this.deps.onChange?.();
      } catch (raw) {
        const error = toProviderError(raw);
        this.lastError = redactSecrets(error.message).slice(0, 300);
        if (error.retryable || error.code === "network" || error.code === "timeout" || error.code === "rate_limited" || error.code === "server") {
          this.retryLater();
          return;
        }
        // Permanent failure (bad model, input too long...): park these chunks, continue with the rest.
        await this.deps.repos.memory.markError(batch.map((c) => c.id), this.lastError);
        if (error.code === "unauthorized" || error.code === "forbidden" || error.code === "not_found") return;
      }
    }
  }

  private async queryVector(text: string, settings: MemorySettings, signal?: AbortSignal): Promise<Float32Array | null> {
    if (this.deps.isOnline && !this.deps.isOnline()) return null;
    const provider = await this.embedder(settings).catch(() => null);
    if (!provider) return null;
    const cacheKey = `${this.modelKey(settings)}|${text}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached) return cached;
    try {
      const { vectors } = await provider.embed([text], { task: "query", signal, timeoutMs: 15_000 });
      const vector = vectors[0] ?? null;
      if (vector) {
        this.queryCache.set(cacheKey, vector);
        if (this.queryCache.size > QUERY_CACHE) this.queryCache.delete(this.queryCache.keys().next().value!);
      }
      return vector;
    } catch (error) {
      if (error instanceof ProviderError && error.code === "aborted") throw error;
      logger.warn("Query embedding failed, using keyword search", error);
      return null;
    }
  }

  private async resolveHits(hits: SearchHit[]): Promise<MemoryHit[]> {
    if (!hits.length) return [];
    const chunks = new Map((await this.deps.repos.memory.getMany(hits.map((h) => h.id))).map((c) => [c.id, c]));
    const stale = hits.filter((h) => !chunks.has(h.id)).map((h) => h.id);
    if (stale.length) await this.index.remove(stale); // deleted by a cascade (message/conversation)
    return hits.filter((h) => chunks.has(h.id)).map((h) => ({ chunk: chunks.get(h.id)!, score: h.score, semantic: h.semantic, lexical: h.lexical }));
  }

  /** Free search for the memory screen. */
  async search(text: string, options: { filter?: ScopeFilter; topK?: number; signal?: AbortSignal } = {}): Promise<RetrieveResult> {
    const query = text.trim();
    if (!query) return { hits: [], retrieval: "none" };
    const settings = await this.settings();
    await this.ensureIndex();
    const vector = await this.queryVector(query, settings, options.signal);
    const hits = await this.index.search({
      text: query,
      vector,
      topK: options.topK ?? 30,
      threshold: Math.max(0, settings.threshold - 0.1),
      semanticWeight: settings.semanticWeight,
      filter: options.filter ?? { mode: "all" },
    });
    return { hits: await this.resolveHits(hits), retrieval: vector ? "semantic" : "text" };
  }

  /** RAG retrieval for a request (scope rules + exclusion of messages already in the window). */
  async retrieve(input: {
    query: string;
    assistant: Assistant | null;
    conversationId: string;
    excludeMessageIds: readonly string[];
    signal?: AbortSignal;
  }): Promise<RetrieveResult> {
    const settings = await this.settings();
    const scope = scopeFor(input.assistant, settings);
    const query = input.query.trim();
    if (scope === "none" || !query) return { hits: [], retrieval: "none" };
    await this.ensureIndex();
    if ((await this.index.size()) === 0) return { hits: [], retrieval: "none" };
    const vector = await this.queryVector(query.slice(0, 8000), settings, input.signal);
    const hits = await this.index.search({
      text: query,
      vector,
      topK: settings.topK,
      threshold: settings.threshold,
      semanticWeight: settings.semanticWeight,
      filter: filterFor(scope, input.assistant?.id ?? null, input.conversationId),
      excludeMessageIds: input.excludeMessageIds,
    });
    return { hits: await this.resolveHits(hits), retrieval: vector ? "semantic" : "text" };
  }
}
