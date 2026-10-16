export type LogLevel = "log" | "info" | "warn" | "error" | "debug";

export interface JsLog {
  level: LogLevel;
  text: string;
}

export interface JsRunResult {
  logs: JsLog[];
  /** Formatted final value (last expression, or the returned value with top-level await). */
  value?: string;
  error?: { name: string; message: string; stack?: string };
  truncated: boolean;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
}

export interface JsRunOptions {
  timeoutMs: number;
  allowNetwork: boolean;
  maxOutputChars: number;
  memoryLimitMb: number;
  signal?: AbortSignal;
  onLog?: (log: JsLog) => void;
}

/** Minimal Worker surface (tests pass a fake). */
export interface WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string; preventDefault?: () => void }) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

export interface JsSandboxDeps {
  createWorker: (allowNetwork: boolean) => WorkerLike;
  clock?: () => number;
  nonce?: () => string;
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const JS_WORKER_PATH = "/sandbox/js.js";
export const JS_WORKER_NET_PATH = "/sandbox/js-net.js";

export function browserWorkerFactory(allowNetwork: boolean): WorkerLike {
  return new Worker(allowNetwork ? JS_WORKER_NET_PATH : JS_WORKER_PATH, { name: "nova-js-sandbox" }) as unknown as WorkerLike;
}

/**
 * Runs untrusted JavaScript in a fresh dedicated Worker (no DOM, no cookies, no app storage,
 * no network by default). Every run gets its own worker which is terminated afterwards, so
 * infinite loops, timeouts and "Stop" are hard interrupts.
 */
export class JsSandbox {
  private readonly clock: () => number;

  constructor(private readonly deps: JsSandboxDeps) {
    this.clock = deps.clock ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  }

  run(code: string, options: JsRunOptions): Promise<JsRunResult> {
    const started = this.clock();
    const logs: JsLog[] = [];
    const nonce = (this.deps.nonce ?? randomNonce)();
    return new Promise<JsRunResult>((resolve) => {
      let worker: WorkerLike;
      try {
        worker = this.deps.createWorker(options.allowNetwork);
      } catch (error) {
        resolve({ logs, error: { name: "SandboxError", message: error instanceof Error ? error.message : "Could not start the sandbox" }, truncated: false, timedOut: false, cancelled: false, durationMs: 0 });
        return;
      }
      let settled = false;
      const finish = (patch: Partial<JsRunResult>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
        resolve({ logs, truncated: false, timedOut: false, cancelled: false, durationMs: Math.round(this.clock() - started), ...patch });
      };
      const onAbort = () => finish({ cancelled: true, error: { name: "AbortError", message: "Execution cancelled" } });
      const timer = setTimeout(() => finish({ timedOut: true, error: { name: "TimeoutError", message: `Execution timed out after ${options.timeoutMs} ms` } }), options.timeoutMs);
      if (options.signal?.aborted) return onAbort();
      options.signal?.addEventListener("abort", onAbort, { once: true });

      worker.onmessage = (event) => {
        const data = event.data as { nonce?: string; type?: string; level?: LogLevel; text?: string; value?: string; error?: JsRunResult["error"]; truncated?: boolean } | null;
        // Messages without our nonce were forged by user code: ignore them.
        if (!data || data.nonce !== nonce) return;
        if (data.type === "log" && typeof data.text === "string") {
          const log = { level: data.level ?? "log", text: data.text };
          logs.push(log);
          options.onLog?.(log);
        } else if (data.type === "done") {
          finish({ value: data.value, error: data.error, truncated: Boolean(data.truncated) });
        }
      };
      worker.onerror = (event) => {
        event.preventDefault?.();
        const message = event.message ?? "The sandbox crashed";
        // Out-of-memory kills the worker; browsers report it as an error event.
        const oom = /memory|allocation/i.test(message);
        finish({ error: { name: oom ? "RangeError" : "Error", message: oom ? `Memory limit exceeded: ${message}` : message } });
      };
      worker.postMessage({ type: "run", nonce, code, allowNetwork: options.allowNetwork, maxOutputChars: options.maxOutputChars, memoryLimitMb: options.memoryLimitMb });
    });
  }
}

/** Compact text for the model. */
export function formatJsResult(result: JsRunResult): string {
  const lines: string[] = [];
  if (result.logs.length) lines.push("Console output:", ...result.logs.map((l) => (l.level === "log" || l.level === "info" ? l.text : `[${l.level}] ${l.text}`)));
  if (result.truncated) lines.push("[output truncated]");
  if (result.error) lines.push(`${result.error.name}: ${result.error.message}`);
  else if (result.value !== undefined) lines.push(`Result: ${result.value}`);
  if (!lines.length) lines.push("(no output)");
  return lines.join("\n");
}
