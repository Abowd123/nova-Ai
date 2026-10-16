import type { ChatEvent, ChatProvider, ChatRequest, StreamOptions } from "@/lib/ai/types";

export type Script = (request: ChatRequest, options: StreamOptions) => AsyncGenerator<ChatEvent, void, undefined>;

/** Scriptable in-memory provider for chat engine tests. */
export class FakeProvider implements ChatProvider {
  readonly kind = "custom" as const;
  readonly capabilities = {
    streaming: true,
    modelListing: true,
    systemPrompt: true,
    vision: false,
    audio: false,
    video: false,
    tools: true,
    reasoning: true,
  };
  readonly requests: ChatRequest[] = [];

  constructor(public script: Script) {}

  async listModels() {
    return [];
  }

  async testConnection() {
    return { ok: true as const, latencyMs: 1, modelCount: 0 };
  }

  streamChat(request: ChatRequest, options: StreamOptions = {}) {
    this.requests.push(structuredClone(request));
    return this.script(request, options);
  }
}

export function reply(...chunks: string[]): Script {
  return async function* () {
    yield { type: "start" };
    for (const text of chunks) yield { type: "text-delta", text };
    yield { type: "finish", reason: "stop", usage: { inputTokens: 3, outputTokens: chunks.length, cachedTokens: 0, totalTokens: 3 + chunks.length } };
  };
}

/** Emits `first`, then waits for abort. */
export function hang(first: string): Script {
  return async function* (_request, options) {
    yield { type: "text-delta", text: first };
    await new Promise<void>((_resolve, reject) => {
      const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      if (options.signal?.aborted) fail();
      options.signal?.addEventListener("abort", fail, { once: true });
    });
  };
}

export function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (condition()) resolve();
      else if (Date.now() - started > timeoutMs) reject(new Error("waitFor timed out"));
      else setTimeout(tick, 5);
    };
    tick();
  });
}

/** Plays one scripted turn per request: tool calls, or a final text. */
export function turns(...steps: ({ text: string } | { calls: { id: string; name: string; arguments: string }[] })[]): Script {
  let index = 0;
  return async function* () {
    const step = steps[Math.min(index, steps.length - 1)]!;
    index += 1;
    yield { type: "start" };
    if ("text" in step) {
      yield { type: "text-delta", text: step.text };
      yield { type: "finish", reason: "stop", usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0, totalTokens: 15 } };
      return;
    }
    for (const call of step.calls) yield { type: "tool-call", ...call };
    yield { type: "finish", reason: "tool_calls", usage: { inputTokens: 10, outputTokens: 2, cachedTokens: 0, totalTokens: 12 } };
  };
}
