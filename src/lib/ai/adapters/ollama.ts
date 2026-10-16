import { toObjectSchema } from "@/lib/tools/json-schema";
import { enrichRemoteModel } from "../catalog/catalog";
import { ProviderError } from "../errors";
import { joinUrl, readJson, readTextChunks, sendWithRetry } from "../http";
import { parseNDJSON } from "../sse";
import type {
  ChatEvent,
  ChatProvider,
  ChatRequest,
  ConnectionTestResult,
  FinishReason,
  HttpClient,
  ModelInfo,
  ProviderCapabilities,
  ProviderConfig,
  RequestOptions,
  StreamOptions,
} from "../types";
import { knownSecrets, makeUsage, mergeHeaders, parseJsonEvent, syntheticCallId, textOfMessage, unsupported } from "./shared";

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: { function: { name: string; arguments: unknown } }[];
}

interface OllamaChunk {
  model?: string;
  error?: string;
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: { function?: { name?: string; arguments?: unknown } }[];
  };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export function toOllamaMessages(request: ChatRequest): OllamaMessage[] {
  const messages: OllamaMessage[] = [];
  if (request.system?.trim()) messages.push({ role: "system", content: request.system });
  for (const message of request.messages) {
    if (message.role === "tool") {
      for (const part of message.parts) {
        if (part.type === "tool_result") messages.push({ role: "tool", content: part.content });
      }
      continue;
    }
    const images: string[] = [];
    for (const part of message.parts) {
      if (part.type === "image") {
        if (!part.data) throw new ProviderError("bad_request", "Ollama needs inline image data", { retryable: false });
        images.push(part.data);
      } else if (part.type === "audio") throw unsupported("audio", "Ollama");
      else if (part.type === "video") throw unsupported("video", "Ollama");
      else if (part.type === "file") throw unsupported("file", "Ollama");
    }
    const toolCalls = message.parts
      .filter((p) => p.type === "tool_call")
      .map((p) => {
        let args: unknown = {};
        try {
          args = JSON.parse(p.arguments || "{}");
        } catch {
          /* keep {} */
        }
        return { function: { name: p.name, arguments: args } };
      });
    messages.push({
      role: message.role,
      content: textOfMessage(message),
      ...(images.length ? { images } : {}),
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    });
  }
  return messages;
}

/** Native Ollama API (/api/chat, NDJSON stream). */
export class OllamaProvider implements ChatProvider {
  readonly kind = "ollama" as const;
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    modelListing: true,
    systemPrompt: true,
    vision: true,
    audio: false,
    video: false,
    tools: true,
    reasoning: true,
  };

  constructor(
    private readonly config: ProviderConfig,
    private readonly http: HttpClient,
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    // Plain Ollama has no auth; hosted/proxied instances often use a bearer token.
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    return mergeHeaders(headers, this.config);
  }

  async listModels(options: RequestOptions = {}): Promise<ModelInfo[]> {
    const { response, link } = await sendWithRetry(
      this.http,
      joinUrl(this.config.baseUrl, "api/tags"),
      { method: "GET", headers: this.headers() },
      { ...options, knownSecrets: knownSecrets(this.config), retry: { retries: 1 } },
    );
    try {
      const json = await readJson<{ models?: { name?: string; model?: string }[] }>(response);
      if (!Array.isArray(json.models)) throw new ProviderError("invalid_response", "Model list missing `models`");
      return json.models
        .map((m) => m.name ?? m.model)
        .filter((id): id is string => typeof id === "string")
        .map((id) => ({ ...enrichRemoteModel("ollama", { id }), inputCost: 0, outputCost: 0 }));
    } finally {
      link.dispose();
    }
  }

  async testConnection(options: RequestOptions = {}): Promise<ConnectionTestResult> {
    const started = Date.now();
    const models = await this.listModels(options);
    return { ok: true, latencyMs: Date.now() - started, modelCount: models.length };
  }

  buildBody(request: ChatRequest): Record<string, unknown> {
    const optionsBody: Record<string, unknown> = {};
    if (request.temperature !== undefined) optionsBody.temperature = request.temperature;
    if (request.topP !== undefined) optionsBody.top_p = request.topP;
    if (request.maxTokens !== undefined) optionsBody.num_predict = request.maxTokens;
    if (request.stop?.length) optionsBody.stop = request.stop;
    const body: Record<string, unknown> = { model: request.model, messages: toOllamaMessages(request), stream: true };
    if (Object.keys(optionsBody).length) body.options = optionsBody;
    if (request.reasoning?.enabled) body.think = true;
    // Ollama has no tool_choice: on the last step tools are simply not offered.
    if (request.tools?.length && request.toolChoice !== "none") {
      body.tools = request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: toObjectSchema(tool.parameters) } }));
    }
    return body;
  }

  async *streamChat(request: ChatRequest, options: StreamOptions = {}): AsyncGenerator<ChatEvent, void, undefined> {
    const secrets = knownSecrets(this.config);
    const { response, link } = await sendWithRetry(
      this.http,
      joinUrl(this.config.baseUrl, "api/chat"),
      { method: "POST", headers: this.headers(), body: JSON.stringify(this.buildBody(request)) },
      { ...options, knownSecrets: secrets },
    );
    if (!response.body) {
      link.dispose();
      throw new ProviderError("invalid_response", "Empty response body");
    }

    let started = false;
    let finish: FinishReason = "stop";
    let usage = undefined as ReturnType<typeof makeUsage> | undefined;
    let calls = 0;

    for await (const line of parseNDJSON(readTextChunks(response.body, link, options.idleTimeoutMs, secrets))) {
      const chunk = parseJsonEvent<OllamaChunk>(line, "Ollama");
      if (chunk.error) throw new ProviderError("server", chunk.error, { retryable: false });
      if (!started) {
        started = true;
        yield { type: "start", model: chunk.model };
      }
      if (chunk.message?.thinking) yield { type: "reasoning-delta", text: chunk.message.thinking };
      if (chunk.message?.content) yield { type: "text-delta", text: chunk.message.content };
      for (const call of chunk.message?.tool_calls ?? []) {
        if (!call.function?.name) continue;
        calls += 1;
        yield { type: "tool-call", id: syntheticCallId(calls), name: call.function.name, arguments: JSON.stringify(call.function.arguments ?? {}) };
      }
      if (chunk.done) {
        finish = calls > 0 ? "tool_calls" : chunk.done_reason === "length" ? "length" : "stop";
        usage = makeUsage(chunk.prompt_eval_count, chunk.eval_count);
        yield { type: "usage", usage };
        break;
      }
    }
    yield { type: "finish", reason: finish, usage };
  }
}
