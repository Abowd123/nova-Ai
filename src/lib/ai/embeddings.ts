import { ProviderError } from "./errors";
import { joinUrl, readJson, sendWithRetry } from "./http";
import { knownSecrets, mergeHeaders } from "./adapters/shared";
import type { HttpClient, ProviderConfig, RequestOptions } from "./types";

export type EmbeddingTask = "document" | "query";

export interface EmbeddingResult {
  vectors: Float32Array[];
  dims: number;
  /** Input tokens billed, when the provider reports it. */
  tokens: number | null;
}

/** Provider-agnostic text embeddings (RAG). */
export interface EmbeddingProvider {
  readonly providerId: string;
  readonly model: string;
  /** Requested output size (null = model default). */
  readonly dimensions: number | null;
  /** Max inputs per request. */
  readonly maxBatch: number;
  embed(texts: string[], options?: RequestOptions & { task?: EmbeddingTask }): Promise<EmbeddingResult>;
}

/** Identifies vectors produced by one provider+model+size: changing any of them requires a reindex. */
export function embeddingModelKey(providerId: string, model: string, dimensions: number | null): string {
  return `${providerId}:${model}:${dimensions ?? "default"}`;
}

const EMBED_TIMEOUT_MS = 60_000;

function toVectors(raw: unknown[][], expected: number): Float32Array[] {
  if (raw.length !== expected) throw new ProviderError("invalid_response", `Expected ${expected} embeddings, got ${raw.length}`);
  const vectors = raw.map((values) => {
    if (!Array.isArray(values) || values.length === 0 || values.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
      throw new ProviderError("invalid_response", "Embedding is not a numeric vector");
    }
    return Float32Array.from(values as number[]);
  });
  const dims = vectors[0]?.length ?? 0;
  if (vectors.some((v) => v.length !== dims)) throw new ProviderError("invalid_response", "Embeddings have mixed dimensions");
  return vectors;
}

/** OpenAI /v1/embeddings — also OpenRouter, Mistral, Together, LM Studio, LocalAI, vLLM, Ollama /v1. */
export class OpenAICompatibleEmbeddings implements EmbeddingProvider {
  readonly maxBatch = 96;
  constructor(
    private readonly config: ProviderConfig,
    private readonly http: HttpClient,
    readonly model: string,
    readonly dimensions: number | null = null,
    private readonly extraHeaders: Record<string, string> = {},
  ) {}

  get providerId(): string {
    return this.config.id;
  }

  body(texts: string[]): Record<string, unknown> {
    return { model: this.model, input: texts, encoding_format: "float", ...(this.dimensions ? { dimensions: this.dimensions } : {}) };
  }

  async embed(texts: string[], options: RequestOptions & { task?: EmbeddingTask } = {}): Promise<EmbeddingResult> {
    if (texts.length === 0) return { vectors: [], dims: 0, tokens: 0 };
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json", ...this.extraHeaders };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    const { response, link } = await sendWithRetry(
      this.http,
      joinUrl(this.config.baseUrl, "embeddings"),
      { method: "POST", headers: mergeHeaders(headers, this.config), body: JSON.stringify(this.body(texts)) },
      { signal: options.signal, timeoutMs: options.timeoutMs ?? EMBED_TIMEOUT_MS, knownSecrets: knownSecrets(this.config) },
    );
    try {
      const json = await readJson<{ data?: { index?: number; embedding?: unknown[] }[]; usage?: { prompt_tokens?: number; total_tokens?: number } }>(response);
      const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      const vectors = toVectors(data.map((d) => d.embedding ?? []), texts.length);
      return { vectors, dims: vectors[0]!.length, tokens: json.usage?.prompt_tokens ?? json.usage?.total_tokens ?? null };
    } finally {
      link.dispose();
    }
  }
}

/** Gemini batchEmbedContents with retrieval task types. */
export class GeminiEmbeddings implements EmbeddingProvider {
  readonly maxBatch = 100;
  constructor(
    private readonly config: ProviderConfig,
    private readonly http: HttpClient,
    readonly model: string,
    readonly dimensions: number | null = null,
  ) {}

  get providerId(): string {
    return this.config.id;
  }

  private get modelPath(): string {
    return this.model.startsWith("models/") ? this.model : `models/${this.model}`;
  }

  body(texts: string[], task: EmbeddingTask): Record<string, unknown> {
    return {
      requests: texts.map((text) => ({
        model: this.modelPath,
        content: { parts: [{ text }] },
        taskType: task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
        ...(this.dimensions ? { outputDimensionality: this.dimensions } : {}),
      })),
    };
  }

  async embed(texts: string[], options: RequestOptions & { task?: EmbeddingTask } = {}): Promise<EmbeddingResult> {
    if (texts.length === 0) return { vectors: [], dims: 0, tokens: 0 };
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (this.config.apiKey) headers["x-goog-api-key"] = this.config.apiKey;
    const { response, link } = await sendWithRetry(
      this.http,
      joinUrl(this.config.baseUrl, `${this.modelPath}:batchEmbedContents`),
      { method: "POST", headers: mergeHeaders(headers, this.config), body: JSON.stringify(this.body(texts, options.task ?? "document")) },
      { signal: options.signal, timeoutMs: options.timeoutMs ?? EMBED_TIMEOUT_MS, knownSecrets: knownSecrets(this.config) },
    );
    try {
      const json = await readJson<{ embeddings?: { values?: unknown[] }[] }>(response);
      const vectors = toVectors((json.embeddings ?? []).map((e) => e.values ?? []), texts.length);
      return { vectors, dims: vectors[0]!.length, tokens: null };
    } finally {
      link.dispose();
    }
  }
}

/** Ollama native /api/embed (batch input). */
export class OllamaEmbeddings implements EmbeddingProvider {
  readonly maxBatch = 64;
  readonly dimensions = null;
  constructor(
    private readonly config: ProviderConfig,
    private readonly http: HttpClient,
    readonly model: string,
  ) {}

  get providerId(): string {
    return this.config.id;
  }

  async embed(texts: string[], options: RequestOptions & { task?: EmbeddingTask } = {}): Promise<EmbeddingResult> {
    if (texts.length === 0) return { vectors: [], dims: 0, tokens: 0 };
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    const { response, link } = await sendWithRetry(
      this.http,
      joinUrl(this.config.baseUrl, "api/embed"),
      { method: "POST", headers: mergeHeaders(headers, this.config), body: JSON.stringify({ model: this.model, input: texts, truncate: true }) },
      { signal: options.signal, timeoutMs: options.timeoutMs ?? EMBED_TIMEOUT_MS, knownSecrets: knownSecrets(this.config) },
    );
    try {
      const json = await readJson<{ embeddings?: unknown[][]; prompt_eval_count?: number }>(response);
      const vectors = toVectors(json.embeddings ?? [], texts.length);
      return { vectors, dims: vectors[0]!.length, tokens: json.prompt_eval_count ?? null };
    } finally {
      link.dispose();
    }
  }
}

export const SUGGESTED_EMBEDDING_MODELS: Record<string, readonly string[]> = {
  openai: ["text-embedding-3-small", "text-embedding-3-large"],
  gemini: ["gemini-embedding-001", "text-embedding-004"],
  openrouter: ["openai/text-embedding-3-small", "qwen/qwen3-embedding-8b"],
  ollama: ["nomic-embed-text", "bge-m3", "mxbai-embed-large"],
  custom: ["text-embedding-3-small", "bge-m3"],
  anthropic: [],
};

/** Anthropic has no embeddings API; everything else is supported. */
export function supportsEmbeddings(kind: ProviderConfig["kind"]): boolean {
  return kind !== "anthropic";
}

export function createEmbeddingProvider(config: ProviderConfig, http: HttpClient, model: string, dimensions: number | null, appUrl?: string): EmbeddingProvider {
  switch (config.kind) {
    case "gemini":
      return new GeminiEmbeddings(config, http, model, dimensions);
    case "ollama":
      return new OllamaEmbeddings(config, http, model);
    case "openrouter":
      return new OpenAICompatibleEmbeddings(config, http, model, dimensions, { "HTTP-Referer": appUrl ?? "https://nova.local", "X-Title": "Nova" });
    case "openai":
    case "custom":
      return new OpenAICompatibleEmbeddings(config, http, model, dimensions);
    case "anthropic":
      throw new ProviderError("unsupported", "Anthropic does not offer an embeddings API", { retryable: false });
  }
}
