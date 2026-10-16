import { toObjectSchema } from "@/lib/tools/json-schema";
import { catalogEntryToModelInfo, catalogFor, enrichRemoteModel, type RemoteModel } from "../catalog/catalog";
import { ProviderError } from "../errors";
import { joinUrl, readJson, readTextChunks, sendWithRetry } from "../http";
import { parseSSE } from "../sse";
import type {
  ChatEvent,
  ChatMessage,
  ChatProvider,
  ChatRequest,
  ConnectionTestResult,
  FinishReason,
  HttpClient,
  ModelInfo,
  ProviderCapabilities,
  ProviderConfig,
  ProviderKind,
  RequestOptions,
  StreamOptions,
} from "../types";
import {
  ToolCallAccumulator,
  dataUrlOf,
  knownSecrets,
  makeUsage,
  mergeHeaders,
  parseJsonEvent,
  textOfMessage,
  unsupported,
} from "./shared";

type OpenAIContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
      | { type: "input_audio"; input_audio: { data: string; format: string } }
      | { type: "file"; file: { file_id: string } | { filename: string; file_data: string } }
    >;

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: OpenAIContent | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface OpenAIChunk {
  id?: string;
  model?: string;
  error?: { message?: string; code?: string | number };
  choices?: {
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | null;
}

export interface OpenAICompatibleOptions {
  kind: ProviderKind;
  label: string;
  /** OpenAI's newer models require max_completion_tokens. */
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  extraHeaders?: Record<string, string>;
  includeUsage?: boolean;
  mapRemoteModel?: (raw: Record<string, unknown>) => RemoteModel | null;
}

export function mapFinishReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case "stop":
    case "end_turn":
      return "stop";
    case "length":
    case "max_tokens":
      return "length";
    case "tool_calls":
    case "function_call":
      return "tool_calls";
    case "content_filter":
      return "content_filter";
    default:
      return reason ? "unknown" : "stop";
  }
}

const AUDIO_FORMATS: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
};

export function toOpenAIMessages(request: ChatRequest, label: string): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [];
  if (request.system?.trim()) messages.push({ role: "system", content: request.system });

  for (const message of request.messages) {
    if (message.role === "system") {
      messages.push({ role: "system", content: textOfMessage(message) });
      continue;
    }
    if (message.role === "tool") {
      for (const part of message.parts) {
        if (part.type === "tool_result") {
          messages.push({ role: "tool", tool_call_id: part.toolCallId, content: part.content });
        }
      }
      continue;
    }
    if (message.role === "assistant") {
      const toolCalls = message.parts
        .filter((p) => p.type === "tool_call")
        .map((p) => ({ id: p.id, type: "function" as const, function: { name: p.name, arguments: p.arguments } }));
      messages.push({
        role: "assistant",
        content: textOfMessage(message) || (toolCalls.length ? null : ""),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }
    messages.push({ role: "user", content: toUserContent(message, label) });
  }
  return messages;
}

function toUserContent(message: ChatMessage, label: string): OpenAIContent {
  const onlyText = message.parts.every((p) => p.type === "text");
  if (onlyText) return textOfMessage(message);
  const content: Exclude<OpenAIContent, string> = [];
  for (const part of message.parts) {
    switch (part.type) {
      case "text":
        if (part.text) content.push({ type: "text", text: part.text });
        break;
      case "image":
        content.push({ type: "image_url", image_url: { url: dataUrlOf(part) } });
        break;
      case "audio": {
        const format = AUDIO_FORMATS[part.mimeType];
        if (!part.data || !format) throw unsupported(`"${part.mimeType}" audio`, label);
        content.push({ type: "input_audio", input_audio: { data: part.data, format } });
        break;
      }
      case "video":
        throw unsupported("video", label);
      case "file":
        if (part.fileId) content.push({ type: "file", file: { file_id: part.fileId } });
        else content.push({ type: "file", file: { filename: part.name ?? "document.pdf", file_data: dataUrlOf(part) } });
        break;
      default:
        break;
    }
  }
  return content;
}

export class OpenAICompatibleProvider implements ChatProvider {
  readonly kind: ProviderKind;
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    modelListing: true,
    systemPrompt: true,
    vision: true,
    audio: true,
    video: false,
    tools: true,
    reasoning: true,
  };

  constructor(
    protected readonly config: ProviderConfig,
    protected readonly http: HttpClient,
    protected readonly options: OpenAICompatibleOptions,
  ) {
    this.kind = options.kind;
  }

  protected headers(json = true): Record<string, string> {
    const base: Record<string, string> = { Accept: json ? "application/json" : "text/event-stream" };
    if (json) base["Content-Type"] = "application/json";
    if (this.config.apiKey) base.Authorization = `Bearer ${this.config.apiKey}`;
    return mergeHeaders({ ...base, ...this.options.extraHeaders }, this.config);
  }

  protected buildBody(request: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: toOpenAIMessages(request, this.options.label),
      stream: true,
    };
    if (this.options.includeUsage !== false) body.stream_options = { include_usage: true };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.topP !== undefined) body.top_p = request.topP;
    if (request.maxTokens !== undefined) body[this.options.maxTokensField ?? "max_tokens"] = request.maxTokens;
    if (request.stop?.length) body.stop = request.stop;
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: toObjectSchema(tool.parameters) } }));
      if (request.toolChoice) body.tool_choice = request.toolChoice;
    }
    return body;
  }

  async listModels(options: RequestOptions = {}): Promise<ModelInfo[]> {
    const { response, link } = await sendWithRetry(
      this.http,
      joinUrl(this.config.baseUrl, "models"),
      { method: "GET", headers: this.headers() },
      { ...options, knownSecrets: knownSecrets(this.config), retry: { retries: 1 } },
    );
    try {
      const json = await readJson<{ data?: Record<string, unknown>[] }>(response);
      if (!Array.isArray(json.data)) throw new ProviderError("invalid_response", "Model list missing `data`");
      const mapper =
        this.options.mapRemoteModel ??
        ((raw: Record<string, unknown>) => (typeof raw.id === "string" ? { id: raw.id } : null));
      return json.data
        .map(mapper)
        .filter((m): m is RemoteModel => m !== null)
        .map((m) => enrichRemoteModel(this.kind, m))
        .sort((a, b) => a.id.localeCompare(b.id));
    } finally {
      link.dispose();
    }
  }

  async testConnection(options: RequestOptions = {}): Promise<ConnectionTestResult> {
    const started = Date.now();
    const models = await this.listModels(options);
    return { ok: true, latencyMs: Date.now() - started, modelCount: models.length };
  }

  /** Catalog-only fallback for providers whose /models endpoint is unavailable. */
  catalogModels(): ModelInfo[] {
    return catalogFor(this.kind).map(catalogEntryToModelInfo);
  }

  async *streamChat(request: ChatRequest, options: StreamOptions = {}): AsyncGenerator<ChatEvent, void, undefined> {
    const secrets = knownSecrets(this.config);
    const { response, link } = await sendWithRetry(
      this.http,
      joinUrl(this.config.baseUrl, "chat/completions"),
      { method: "POST", headers: { ...this.headers(), Accept: "text/event-stream" }, body: JSON.stringify(this.buildBody(request)) },
      { ...options, knownSecrets: secrets },
    );
    if (!response.body) {
      link.dispose();
      throw new ProviderError("invalid_response", "Empty response body");
    }

    const tools = new ToolCallAccumulator();
    let finish: FinishReason | undefined;
    let started = false;
    let usage = undefined as ReturnType<typeof makeUsage> | undefined;

    for await (const message of parseSSE(readTextChunks(response.body, link, options.idleTimeoutMs, secrets))) {
      const data = message.data.trim();
      if (!data) continue;
      if (data === "[DONE]") break;
      const chunk = parseJsonEvent<OpenAIChunk>(data, this.options.label);
      if (chunk.error) {
        throw new ProviderError("server", chunk.error.message ?? "Provider stream error", { retryable: false });
      }
      if (!started) {
        started = true;
        yield { type: "start", model: chunk.model, responseId: chunk.id };
      }
      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta;
        const reasoning = delta?.reasoning_content ?? delta?.reasoning;
        if (reasoning) yield { type: "reasoning-delta", text: reasoning };
        if (delta?.content) yield { type: "text-delta", text: delta.content };
        for (const call of delta?.tool_calls ?? []) {
          tools.add(call.index, { id: call.id, name: call.function?.name, arguments: call.function?.arguments });
        }
        if (choice.finish_reason) finish = mapFinishReason(choice.finish_reason);
      }
      if (chunk.usage) {
        usage = makeUsage(
          chunk.usage.prompt_tokens,
          chunk.usage.completion_tokens,
          chunk.usage.prompt_tokens_details?.cached_tokens,
          chunk.usage.total_tokens,
        );
        yield { type: "usage", usage };
      }
    }

    yield* tools.drain();
    yield { type: "finish", reason: finish ?? "stop", usage };
  }
}
