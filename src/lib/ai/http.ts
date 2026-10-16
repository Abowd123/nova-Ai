import { ProviderError, errorFromResponse, toProviderError } from "./errors";
import { withRetry } from "./retry";
import type { HttpClient, StreamOptions } from "./types";

export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_IDLE_TIMEOUT_MS = 90_000;

/**
 * A controller linked to an optional parent signal, with a timeout that produces a
 * distinguishable "timeout" (vs. user "aborted") error.
 */
export class LinkedAbort {
  readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private reason: "timeout" | "aborted" | undefined;
  private readonly detach: () => void;

  constructor(parent?: AbortSignal) {
    const onAbort = () => this.abort("aborted");
    if (parent?.aborted) this.abort("aborted");
    parent?.addEventListener("abort", onAbort, { once: true });
    this.detach = () => parent?.removeEventListener("abort", onAbort);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  arm(ms: number | undefined): void {
    this.disarm();
    if (ms && ms > 0 && Number.isFinite(ms)) this.timer = setTimeout(() => this.abort("timeout"), ms);
  }

  disarm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  abort(reason: "timeout" | "aborted"): void {
    if (this.controller.signal.aborted) return;
    this.reason = reason;
    this.disarm();
    this.controller.abort();
  }

  /** Converts an AbortError into the right ProviderError. */
  translate(error: unknown, knownSecrets: string[] = []): ProviderError {
    if (this.controller.signal.aborted) {
      return this.reason === "timeout"
        ? new ProviderError("timeout", "The provider did not respond in time")
        : new ProviderError("aborted", "Request aborted");
    }
    return toProviderError(error, knownSecrets);
  }

  dispose(): void {
    this.disarm();
    this.detach();
  }
}

export interface SendOptions extends StreamOptions {
  knownSecrets?: string[];
}

/**
 * Sends a request with timeout + retry. Retries only happen BEFORE any body is consumed,
 * so a stream is never duplicated. Returns the response plus the live abort link that the
 * caller must dispose after reading the body.
 */
export async function sendWithRetry(
  http: HttpClient,
  url: string,
  init: RequestInit,
  options: SendOptions = {},
): Promise<{ response: Response; link: LinkedAbort }> {
  const secrets = options.knownSecrets ?? [];
  return withRetry(
    async () => {
      const link = new LinkedAbort(options.signal);
      link.arm(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      try {
        const response = await http(url, { ...init, signal: link.signal });
        link.disarm();
        if (!response.ok) throw await errorFromResponse(response, secrets);
        return { response, link };
      } catch (error) {
        const translated = link.translate(error, secrets);
        link.dispose();
        throw translated;
      }
    },
    {
      retries: options.retry?.retries ?? 2,
      baseDelayMs: options.retry?.baseDelayMs,
      maxDelayMs: options.retry?.maxDelayMs,
      signal: options.signal,
    },
  );
}

/** Reads a body as text chunks, enforcing an idle timeout between chunks. */
export async function* readTextChunks(
  body: ReadableStream<Uint8Array>,
  link: LinkedAbort,
  idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS,
  knownSecrets: string[] = [],
): AsyncGenerator<string, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const onAbort = () => {
    reader.cancel().catch(() => undefined);
  };
  link.signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      link.arm(idleTimeoutMs);
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (error) {
        throw link.translate(error, knownSecrets);
      }
      link.disarm();
      if (link.signal.aborted) throw link.translate(undefined, knownSecrets);
      if (result.done) break;
      const text = decoder.decode(result.value, { stream: true });
      if (text) yield text;
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    link.signal.removeEventListener("abort", onAbort);
    link.dispose();
    reader.releaseLock?.();
  }
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new ProviderError("invalid_response", "Provider returned invalid JSON", { cause: error });
  }
}
