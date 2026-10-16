import type {
  FinishReason,
  MessagePart,
  ModelCapabilities,
  ProviderKind,
  ProviderTransport,
  TokenUsage,
} from "@/lib/models";
import type { JsonSchema } from "@/lib/tools/types";

export type {
  FinishReason,
  MessagePart,
  ModelCapabilities,
  ProviderKind,
  ProviderTransport,
  TokenUsage,
} from "@/lib/models";

export type ChatRole = "system" | "user" | "assistant" | "tool";

/** Provider-agnostic message. Adapters translate to each wire format. */
export interface ChatMessage {
  role: ChatRole;
  parts: MessagePart[];
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** System prompt kept separate: Anthropic and Gemini take it out-of-band. */
  system?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string[];
  /** Ask reasoning models to stream their thinking when supported. */
  reasoning?: { enabled: boolean; budgetTokens?: number };
  /** The system prompt is a stable prefix: ask providers with explicit caching (Anthropic) to cache it. */
  promptCache?: boolean;
  /** Functions the model may call (agent loop). Order is kept stable for prompt caching. */
  tools?: ToolSpec[];
  /** auto (default) | none = answer without tools (last step) | required. */
  toolChoice?: "auto" | "none" | "required";
}

/** Provider-agnostic function declaration. Adapters convert it to each wire format. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: JsonSchema;
}

export type ChatEvent =
  | { type: "start"; model?: string; responseId?: string }
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string; signature?: string }
  | { type: "tool-call"; id: string; name: string; arguments: string; signature?: string }
  | { type: "usage"; usage: TokenUsage }
  | { type: "finish"; reason: FinishReason; usage?: TokenUsage };

export interface ProviderCapabilities {
  streaming: boolean;
  modelListing: boolean;
  systemPrompt: boolean;
  vision: boolean;
  audio: boolean;
  video: boolean;
  tools: boolean;
  reasoning: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  providerKind: ProviderKind;
  contextWindow: number | null;
  capabilities: ModelCapabilities;
  /** USD per 1M tokens. */
  inputCost: number | null;
  outputCost: number | null;
  source: "catalog" | "remote" | "manual";
}

/** Decrypted runtime config. Lives only in memory, never persisted or logged. */
export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  transport: ProviderTransport;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Max wait for response headers (ms). */
  timeoutMs?: number;
}

export interface StreamOptions extends RequestOptions {
  /** Max silence between stream chunks (ms). */
  idleTimeoutMs?: number;
  retry?: { retries?: number; baseDelayMs?: number; maxDelayMs?: number };
}

export interface ConnectionTestResult {
  ok: true;
  latencyMs: number;
  modelCount: number;
}

/** Provider-side copy of a large file (OpenAI Files API id or Gemini file URI). */
export interface UploadedFile {
  ref: string;
  kind: "file_id" | "uri";
  /** Epoch ms after which the provider deletes it; null = until deleted. */
  expiresAt: number | null;
}

export interface UploadInput {
  blob: Blob;
  name: string;
  mimeType: string;
}

export interface ChatProvider {
  readonly kind: ProviderKind;
  readonly capabilities: ProviderCapabilities;
  listModels(options?: RequestOptions): Promise<ModelInfo[]>;
  testConnection(options?: RequestOptions): Promise<ConnectionTestResult>;
  streamChat(request: ChatRequest, options?: StreamOptions): AsyncGenerator<ChatEvent, void, undefined>;
  /** Optional: uploads media too large to inline. */
  uploadFile?(input: UploadInput, options?: RequestOptions): Promise<UploadedFile>;
}

/** fetch-compatible function; lets us swap direct fetch / server proxy / Capacitor HTTP. */
export type HttpClient = (url: string, init: RequestInit) => Promise<Response>;
