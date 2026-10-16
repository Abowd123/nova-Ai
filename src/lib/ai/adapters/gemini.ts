import { toGeminiSchema, toObjectSchema } from "@/lib/tools/json-schema";
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
  UploadInput,
  UploadedFile,
} from "../types";
import { knownSecrets, makeUsage, mergeHeaders, parseJsonEvent, syntheticCallId } from "./shared";
import { uploadGeminiFile } from "../uploads";

type GeminiPart =
  | { text: string; thought?: boolean; thoughtSignature?: string }
  | { inline_data: { mime_type: string; data: string } }
  | { file_data: { mime_type: string; file_uri: string } }
  | { functionCall: { name: string; args: unknown }; thoughtSignature?: string }
  | { functionResponse: { name: string; response: unknown } };

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

function mediaPart(part: { mimeType: string; data?: string; url?: string }): GeminiPart {
  if (part.data) return { inline_data: { mime_type: part.mimeType, data: part.data } };
  if (part.url) return { file_data: { mime_type: part.mimeType, file_uri: part.url } };
  throw new ProviderError("bad_request", "Media part has no data or url");
}

function parseArgs(text: string): unknown {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

export function toGeminiContents(request: ChatRequest): { system?: string; contents: GeminiContent[] } {
  const system: string[] = request.system?.trim() ? [request.system] : [];
  const contents: GeminiContent[] = [];
  const push = (role: GeminiContent["role"], parts: GeminiPart[]) => {
    if (!parts.length) return;
    const last = contents.at(-1);
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  };

  for (const message of request.messages) {
    if (message.role === "system") {
      system.push(message.parts.map((p) => (p.type === "text" ? p.text : "")).join(""));
      continue;
    }
    const parts: GeminiPart[] = [];
    for (const part of message.parts) {
      switch (part.type) {
        case "text":
          if (part.text) parts.push({ text: part.text });
          break;
        case "image":
        case "audio":
        case "video":
        case "file":
          parts.push(mediaPart(part));
          break;
        case "tool_call":
          parts.push({ functionCall: { name: part.name, args: parseArgs(part.arguments) }, ...(part.signature ? { thoughtSignature: part.signature } : {}) });
          break;
        case "tool_result":
          parts.push({ functionResponse: { name: part.name, response: { content: part.content } } });
          break;
        case "reasoning":
          break; // thoughts are not sent back
      }
    }
    push(message.role === "assistant" ? "model" : "user", parts);
  }
  const joined = system.filter(Boolean).join("\n\n");
  return { system: joined || undefined, contents };
}

function mapFinish(reason: string | undefined): FinishReason | undefined {
  switch (reason) {
    case undefined:
    case "":
    case "FINISH_REASON_UNSPECIFIED":
      return undefined;
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
      return "content_filter";
    default:
      return "unknown";
  }
}

interface GeminiChunk {
  error?: { message?: string; status?: string };
  modelVersion?: string;
  responseId?: string;
  promptFeedback?: { blockReason?: string };
  candidates?: {
    content?: { parts?: Array<{ text?: string; thought?: boolean; thoughtSignature?: string; functionCall?: { name: string; args?: unknown } }> };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
    totalTokenCount?: number;
  };
}

export function stripModelPrefix(id: string): string {
  return id.replace(/^models\//, "");
}

export class GeminiProvider implements ChatProvider {
  readonly kind = "gemini" as const;
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    modelListing: true,
    systemPrompt: true,
    vision: true,
    audio: true,
    video: true,
    tools: true,
    reasoning: true,
  };

  constructor(
    private readonly config: ProviderConfig,
    private readonly http: HttpClient,
  ) {}

  uploadFile(input: UploadInput, options?: RequestOptions): Promise<UploadedFile> {
    return uploadGeminiFile(this.config, this.http, input, options);
  }

  /** Key goes in a header, never in the URL (URLs end up in logs and history). */
  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (this.config.apiKey) headers["x-goog-api-key"] = this.config.apiKey;
    return mergeHeaders(headers, this.config);
  }

  async listModels(options: RequestOptions = {}): Promise<ModelInfo[]> {
    const { response, link } = await sendWithRetry(
      this.http,
      joinUrl(this.config.baseUrl, "models?pageSize=1000"),
      { method: "GET", headers: this.headers() },
      { ...options, knownSecrets: knownSecrets(this.config), retry: { retries: 1 } },
    );
    try {
      const json = await readJson<{
        models?: { name?: string; displayName?: string; inputTokenLimit?: number; supportedGenerationMethods?: string[] }[];
      }>(response);
      if (!Array.isArray(json.models)) throw new ProviderError("invalid_response", "Model list missing `models`");
      return json.models
        .filter((m) => typeof m.name === "string" && (m.supportedGenerationMethods ?? []).includes("generateContent"))
        .map((m) =>
          enrichRemoteModel("gemini", {
            id: stripModelPrefix(m.name as string),
            name: m.displayName,
            contextWindow: m.inputTokenLimit ?? null,
          }),
        );
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
    const { system, contents } = toGeminiContents(request);
    const generationConfig: Record<string, unknown> = {};
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    if (request.topP !== undefined) generationConfig.topP = request.topP;
    if (request.maxTokens !== undefined) generationConfig.maxOutputTokens = request.maxTokens;
    if (request.stop?.length) generationConfig.stopSequences = request.stop;
    if (request.reasoning?.enabled) {
      generationConfig.thinkingConfig = {
        includeThoughts: true,
        ...(request.reasoning.budgetTokens ? { thinkingBudget: request.reasoning.budgetTokens } : {}),
      };
    }
    const body: Record<string, unknown> = { contents };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
    if (request.tools?.length) {
      body.tools = [{ functionDeclarations: request.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: toGeminiSchema(toObjectSchema(tool.parameters)) })) }];
      const mode = request.toolChoice === "none" ? "NONE" : request.toolChoice === "required" ? "ANY" : "AUTO";
      body.toolConfig = { functionCallingConfig: { mode } };
    }
    return body;
  }

  async *streamChat(request: ChatRequest, options: StreamOptions = {}): AsyncGenerator<ChatEvent, void, undefined> {
    const secrets = knownSecrets(this.config);
    const model = encodeURIComponent(stripModelPrefix(request.model));
    const { response, link } = await sendWithRetry(
      this.http,
      joinUrl(this.config.baseUrl, `models/${model}:streamGenerateContent?alt=sse`),
      { method: "POST", headers: { ...this.headers(), Accept: "text/event-stream" }, body: JSON.stringify(this.buildBody(request)) },
      { ...options, knownSecrets: secrets },
    );
    if (!response.body) {
      link.dispose();
      throw new ProviderError("invalid_response", "Empty response body");
    }

    let started = false;
    let finish: FinishReason | undefined;
    let usage: TokenUsage | undefined;
    let callIndex = 0;

    for await (const message of parseSSE(readTextChunks(response.body, link, options.idleTimeoutMs, secrets))) {
      if (!message.data.trim()) continue;
      const chunk = parseJsonEvent<GeminiChunk>(message.data, "Gemini");
      if (chunk.error) throw new ProviderError("server", chunk.error.message ?? "Gemini stream error", { retryable: false });
      if (!started) {
        started = true;
        yield { type: "start", model: chunk.modelVersion, responseId: chunk.responseId };
      }
      if (chunk.promptFeedback?.blockReason) {
        finish = "content_filter";
      }
      const candidate = chunk.candidates?.[0];
      for (const part of candidate?.content?.parts ?? []) {
        if (part.functionCall) {
          callIndex += 1;
          yield {
            type: "tool-call",
            id: syntheticCallId(callIndex),
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args ?? {}),
            ...(part.thoughtSignature ? { signature: part.thoughtSignature } : {}),
          };
        } else if (part.text) {
          yield part.thought ? { type: "reasoning-delta", text: part.text } : { type: "text-delta", text: part.text };
        }
      }
      finish = mapFinish(candidate?.finishReason) ?? finish;
      if (chunk.usageMetadata) {
        const u = chunk.usageMetadata;
        usage = makeUsage(
          u.promptTokenCount,
          (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
          u.cachedContentTokenCount,
          u.totalTokenCount,
        );
        yield { type: "usage", usage };
      }
    }
    yield { type: "finish", reason: callIndex > 0 && (!finish || finish === "stop") ? "tool_calls" : (finish ?? "stop"), usage };
  }
}
