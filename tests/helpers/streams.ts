import type { HttpClient } from "@/lib/ai/types";

export function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** Splits text into fixed-size pieces to exercise parsers across chunk boundaries. */
export function chunked(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

export function sse(events: Array<{ event?: string; data: unknown }>, newline = "\n"): string {
  return events
    .map(({ event, data }) => `${event ? `event: ${event}${newline}` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}${newline}${newline}`)
    .join("");
}

export interface RecordedRequest {
  url: string;
  init: RequestInit;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

/** A fake HttpClient that records requests and replays the given responses in order. */
export function recordingHttp(responses: Array<() => Response>): { http: HttpClient; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  let index = 0;
  const http: HttpClient = async (url, init) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    requests.push({ url, init, headers, body: typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null });
    const factory = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (!factory) throw new Error("No response configured");
    return factory();
  };
  return { http, requests };
}

/** A stream that emits `first` and then waits until the request is aborted. */
export function hangingStream(first: string, signal?: AbortSignal | null): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (first) controller.enqueue(encoder.encode(first));
      signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")));
    },
  });
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}
