import { ProviderError, toProviderError } from "./errors";

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  onRetry?: (error: ProviderError, attempt: number, delayMs: number) => void;
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ProviderError("aborted", "Request aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ProviderError("aborted", "Request aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Exponential backoff with full jitter; honors Retry-After when the server sends it. */
export function computeBackoff(
  attempt: number,
  options: { baseDelayMs: number; maxDelayMs: number; random: () => number; retryAfterMs?: number },
): number {
  if (options.retryAfterMs !== undefined) return Math.min(options.retryAfterMs, options.maxDelayMs * 4);
  const exponential = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** attempt);
  return Math.round(exponential / 2 + options.random() * (exponential / 2));
}

export async function withRetry<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8000;
  const sleep = options.sleep ?? abortableSleep;
  const random = options.random ?? Math.random;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (raw) {
      const error = toProviderError(raw);
      if (!error.retryable || attempt >= retries || options.signal?.aborted) throw error;
      const delay = computeBackoff(attempt, { baseDelayMs, maxDelayMs, random, retryAfterMs: error.retryAfterMs });
      options.onRetry?.(error, attempt + 1, delay);
      await sleep(delay, options.signal);
    }
  }
}
