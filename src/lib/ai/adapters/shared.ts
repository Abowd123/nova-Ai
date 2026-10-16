import { ProviderError } from "../errors";
import type { ChatEvent, ChatMessage, MessagePart, ProviderConfig, TokenUsage } from "../types";

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0 };
}

export function makeUsage(input?: number, output?: number, cached?: number, total?: number): TokenUsage {
  const inputTokens = Math.max(0, Math.round(input ?? 0));
  const outputTokens = Math.max(0, Math.round(output ?? 0));
  return {
    inputTokens,
    outputTokens,
    cachedTokens: Math.max(0, Math.round(cached ?? 0)),
    totalTokens: Math.max(0, Math.round(total ?? inputTokens + outputTokens)),
  };
}

export function knownSecrets(config: ProviderConfig): string[] {
  return [config.apiKey, ...Object.values(config.headers ?? {})].filter(
    (value): value is string => typeof value === "string" && value.length >= 4,
  );
}

/** Header names users may not override (browser-forbidden or security sensitive). */
const FORBIDDEN_HEADERS = new Set([
  "host",
  "cookie",
  "origin",
  "referer",
  "content-length",
  "connection",
  "transfer-encoding",
  "x-nova-target",
  "x-nova-proxy",
]);

export function isAllowedCustomHeader(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return /^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(lower) && !FORBIDDEN_HEADERS.has(lower) && !lower.startsWith("sec-") && !lower.startsWith("proxy-");
}

export function mergeHeaders(base: Record<string, string>, config: ProviderConfig): Record<string, string> {
  const merged: Record<string, string> = { ...base };
  for (const [name, value] of Object.entries(config.headers ?? {})) {
    if (isAllowedCustomHeader(name)) merged[name] = value;
  }
  return merged;
}

export function dataUrlOf(part: { mimeType: string; data?: string; url?: string }): string {
  if (part.data) return `data:${part.mimeType};base64,${part.data}`;
  if (part.url) return part.url;
  throw new ProviderError("bad_request", "Media part has no data or url");
}

export function textOfMessage(message: ChatMessage): string {
  return message.parts
    .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function unsupported(what: string, provider: string): ProviderError {
  return new ProviderError("unsupported", `${provider} does not support ${what} input`, { retryable: false });
}

export function parseJsonEvent<T>(data: string, provider: string): T {
  try {
    return JSON.parse(data) as T;
  } catch (error) {
    throw new ProviderError("invalid_response", `${provider} sent malformed stream data`, { cause: error });
  }
}

/** Collects index-addressed tool-call fragments (OpenAI streams arguments in pieces). */
export class ToolCallAccumulator {
  private readonly calls = new Map<number, { id: string; name: string; args: string }>();

  add(index: number, fragment: { id?: string; name?: string; arguments?: string }): void {
    const current = this.calls.get(index) ?? { id: "", name: "", args: "" };
    if (fragment.id) current.id = fragment.id;
    if (fragment.name) current.name += fragment.name;
    if (fragment.arguments) current.args += fragment.arguments;
    this.calls.set(index, current);
  }

  drain(): ChatEvent[] {
    const events: ChatEvent[] = [...this.calls.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, call]) => call.name)
      .map(([index, call]) => ({
        type: "tool-call" as const,
        id: call.id || syntheticCallId(index),
        name: call.name,
        arguments: call.args || "{}",
      }));
    this.calls.clear();
    return events;
  }
}

/** Unique id for providers that don't return call ids (Gemini, Ollama): must not repeat across agent steps. */
export function syntheticCallId(index: number): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `call_${random}_${index}`;
}
