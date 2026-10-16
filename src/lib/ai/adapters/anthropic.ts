import { toObjectSchema } from "@/lib/tools/json-schema";
import { enrichRemoteModel } from "../catalog/catalog";
import { ProviderError } from "../errors";
import { joinUrl, readJson, readTextChunks, sendWithRetry } from "../http";
import { parseSSE } from "../sse";
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
  TokenUsage,
} from "../types";
import { knownSecrets, makeUsage, mergeHeaders, parseJsonEvent, unsupported } from "./shared";

export const ANTHROPIC_VERSION = "2023-06-01";
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string } }
  | { type: "document"; source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string }; title?: string }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicBlock[];
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

/** Anthropic requires alternating roles; consecutive same-role turns are merged. */
export function toAnthropicMessages(request: ChatRequest): { system?: string; messages: AnthropicMessage[] } {
  const systemParts: string[] = request.system?.trim() ? [request.system] : [];
  const messages: AnthropicMessage[] = [];

  const push = (role: AnthropicMessage["role"], blocks: AnthropicBlock[]) => {
    if (blocks.length === 0) return;
    const last = messages.at(-1);
    if (last && last.role === role) last.content.push(...blocks);
    else messages.push({ role, content: blocks });
  };

  for (const message of request.messages) {
    if (message.role === "system") {
      systemParts.push(message.parts.map((p) => (p.type === "text" ? p.text : "")).join(""));
      continue;
    }
    const blocks: AnthropicBlock[] = [];
    for (const part of message.parts) {
      switch (part.type) {
        case "text":
          if (part.text) blocks.push({ type: "text", text: part.text });
          break;
        case "image":
          if (part.data) blocks.push({ type: "image", source: { type: "base64", media_type: part.mimeType, data: part.data } });
          else if (part.url) blocks.push({ type: "image", source: { type: "url", url: part.url } });
          break;
        case "reasoning":
          // Thinking can only be replayed with its signature.
          if (message.role === "assistant" && part.signature) {
            blocks.push({ type: "thinking", thinking: part.text, signature: part.signature });
          }
          break;
        case "tool_call":
          blocks.push({ type: "tool_use", id: part.id, name: part.name, input: safeJson(part.arguments) });
          break;
        case "tool_result":
          blocks.push({ type: "tool_result", tool_use_id: part.toolCallId, content: part.content, ...(part.isError ? { is_error: true } : {}) });
          break;
        case "file":
          if (part.mimeType !== "application/pdf" && part.mimeType !== "text/plain") throw unsupported(`"${part.mimeType}" files`, "Anthropic");
          if (part.data) blocks.push({ type: "document", source: { type: "base64", media_type: part.mimeType, data: part.data }, ...(part.name ? { title: part.name } : {}) });
          else if (part.url) blocks.push({ type: "document", source: { type: "url", url: part.url } });
          else throw unsupported("file references", "Anthropic");
          break;
        case "audio":
          throw unsupported("audio", "Anthropic");
        case "video":
          throw unsupported("video", "Anthropic");
      }
    }
    push(message.role === "assistant" ? "assistant" : "user", blocks);
  }

  const system = systemParts.filter(Boolean).join("\n\n");
  return { system: system || undefined, messages };
}

function mapStopReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    case "refusal":
      return "content_filter";
    default:
      return reason ? "unknown" : "stop";
  }
}

interface AnthropicEvent {
  type: string;
  message?: { id?: string; model?: string; usage?: Record<string, number> };
  index?: number;
  content_block?: { type: string; id?: string; name?: string; text?: string; thinking?: string };
  delta?: { type?: string; text?: string; thinking?: string; partial_json?: string; signature?: string; stop_reason?: string };
  usage?: Record<string, number>;
  error?: { type?: string; message?: string };
}

export class AnthropicProvider implements ChatProvider {
  readonly kind = "anthropic" as const;
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
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "anthropic-version": ANTHROPIC_VERSION,
    };
    if (this.config.apiKey) headers["x-api-key"] = this.config.apiKey;
    // Required by Anthropic for BYOK calls straight from the browser.
    if (this.config.transport === "direct") headers["anthropic-dangerous-direct-browser-access"] = "true";
    return mergeHeaders(headers, this.config);
  }

  async listModels(options: RequestOptions = {}): Promise<ModelInfo[]> {
    const { response, link } = await sendWithRetry(
      this.http,
      joinUrl(this.config.baseUrl, "models?limit=1000"),
      { method: "GET", headers: this.headers() },
      { ...options, knownSecrets: knownSecrets(this.config), retry: { retries: 1 } },
    );
    try {
      const json = await readJson<{ data?: { id?: string; display_name?: string }[] }>(response);
      if (!Array.isArray(json.data)) throw new ProviderError("invalid_response", "Model list missing `data`");
      return json.data
        .filter((m): m is { id: string; display_name?: string } => typeof m.id === "string")
        .map((m) => enrichRemoteModel("anthropic", { id: m.id, name: m.display_name }));
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
    const { system, messages } = toAnthropicMessages(request);
    const maxTokens = request.maxTokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS;
    const body: Record<string, unknown> = { model: request.model, messages, max_tokens: maxTokens, stream: true };
    if (system) body.system = request.promptCache ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : system;
    if (request.reasoning?.enabled) {
      const budget = Math.max(1024, Math.min(request.reasoning.budgetTokens ?? 2048, maxTokens - 1));
      body.thinking = { type: "enabled", budget_tokens: budget };
      // Extended thinking does not allow custom temperature/top_p.
    } else {
      if (request.temperature !== undefined) body.temperature = Math.min(1, request.temperature);
      if (request.topP !== undefined) body.top_p = request.topP;
    }
    if (request.stop?.length) body.stop_sequences = request.stop;
    if (request.tools?.length) {
      const tools: Record<string, unknown>[] = request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: toObjectSchema(tool.parameters) }));
      // Tools come before the system prompt in Anthropic's cache order: mark the last one so they are cached too.
      if (request.promptCache && tools.length) tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: { type: "ephemeral" } };
      body.tools = tools;
      if (request.toolChoice === "required") body.tool_choice = { type: "any" };
      else if (request.toolChoice === "none") body.tool_choice = { type: "none" };
    }
    return body;
  }

  async *streamChat(request: ChatRequest, options: StreamOptions = {}): AsyncGenerator<ChatEvent, void, undefined> {
    const secrets = knownSecrets(this.config);
    const { response, link } = await sendWithRetry(
      this.http,
      joinUrl(this.config.baseUrl, "messages"),
      { method: "POST", headers: { ...this.headers(), Accept: "text/event-stream" }, body: JSON.stringify(this.buildBody(request)) },
      { ...options, knownSecrets: secrets },
    );
    if (!response.body) {
      link.dispose();
      throw new ProviderError("invalid_response", "Empty response body");
    }

    const blocks = new Map<number, { type: string; id?: string; name?: string; json: string }>();
    let input = 0;
    let cached = 0;
    let output = 0;
    let finish: FinishReason = "stop";
    const usage = (): TokenUsage => makeUsage(input + cached, output, cached);

    for await (const message of parseSSE(readTextChunks(response.body, link, options.idleTimeoutMs, secrets))) {
      if (!message.data.trim()) continue;
      const event = parseJsonEvent<AnthropicEvent>(message.data, "Anthropic");
      switch (event.type) {
        case "message_start": {
          const u = event.message?.usage ?? {};
          input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
          cached = u.cache_read_input_tokens ?? 0;
          output = u.output_tokens ?? 0;
          yield { type: "start", model: event.message?.model, responseId: event.message?.id };
          break;
        }
        case "content_block_start": {
          const block = event.content_block;
          if (block && event.index !== undefined) {
            blocks.set(event.index, { type: block.type, id: block.id, name: block.name, json: "" });
            if (block.type === "text" && block.text) yield { type: "text-delta", text: block.text };
          }
          break;
        }
        case "content_block_delta": {
          const delta = event.delta;
          if (delta?.type === "text_delta" && delta.text) yield { type: "text-delta", text: delta.text };
          else if (delta?.type === "thinking_delta" && delta.thinking) yield { type: "reasoning-delta", text: delta.thinking };
          else if (delta?.type === "signature_delta" && delta.signature) yield { type: "reasoning-delta", text: "", signature: delta.signature };
          else if (delta?.type === "input_json_delta" && event.index !== undefined) {
            const block = blocks.get(event.index);
            if (block) block.json += delta.partial_json ?? "";
          }
          break;
        }
        case "content_block_stop": {
          const block = event.index !== undefined ? blocks.get(event.index) : undefined;
          if (block?.type === "tool_use" && block.id && block.name) {
            yield { type: "tool-call", id: block.id, name: block.name, arguments: block.json || "{}" };
          }
          break;
        }
        case "message_delta":
          if (event.delta?.stop_reason) finish = mapStopReason(event.delta.stop_reason);
          if (event.usage?.output_tokens !== undefined) output = event.usage.output_tokens;
          if (event.usage?.input_tokens !== undefined) input = event.usage.input_tokens;
          yield { type: "usage", usage: usage() };
          break;
        case "error": {
          const type = event.error?.type ?? "";
          const code = type === "overloaded_error" ? "server" : type === "rate_limit_error" ? "rate_limited" : type === "authentication_error" ? "unauthorized" : "server";
          throw new ProviderError(code, event.error?.message ?? "Anthropic stream error", { retryable: false });
        }
        default:
          break; // ping, message_stop
      }
    }
    yield { type: "finish", reason: finish, usage: usage() };
  }
}
