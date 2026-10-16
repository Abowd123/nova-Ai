import { mimeForFile, type PythonFile, type PythonProvider, type PythonRunOptions, type PythonRunResult } from "./python-types";
import type { WorkerLike } from "./js-sandbox";

export const PY_WORKER_PATH = "/sandbox/py";
/** Static export (Android app): no dynamic route; the index URL travels in the init message. */
export const PY_WORKER_STATIC_PATH = "/sandbox/py.js";

export interface PyodideDeps {
  indexUrl: () => string;
  createWorker?: (indexUrl: string) => WorkerLike;
  clock?: () => number;
}

interface WorkerMessage {
  type: "progress" | "ready" | "stream" | "done" | "fatal";
  id?: number;
  stage?: "loading" | "packages" | "running";
  detail?: string;
  stream?: "stdout" | "stderr";
  text?: string;
  value?: string;
  error?: { type: string; message: string; traceback?: string };
  files?: { name: string; data: Uint8Array }[];
  truncated?: boolean;
  message?: string;
}

/**
 * Python via Pyodide (CPython compiled to WebAssembly) in a dedicated Worker. The runtime is
 * downloaded lazily on first use (~10 MB, then HTTP-cached) and kept warm between runs.
 * Timeout / Stop terminate the worker (hard interrupt); the next run reloads it.
 */
export class PyodidePythonProvider implements PythonProvider {
  readonly id = "pyodide";
  private worker: WorkerLike | null = null;
  private workerUrl = "";
  private runs = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private indexOverride: string | null = null;

  constructor(private readonly deps: PyodideDeps) {}

  /** Uses another Pyodide distribution from the next run on (Settings → Tools). */
  configure(indexUrl: string): void {
    this.indexOverride = indexUrl;
  }

  isAvailable(): boolean {
    return typeof Worker !== "undefined" || Boolean(this.deps.createWorker);
  }

  reset(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private spawn(indexUrl: string): WorkerLike {
    if (this.worker && this.workerUrl === indexUrl) return this.worker;
    this.reset();
    const create = this.deps.createWorker ?? ((url: string) => new Worker(process.env.NEXT_PUBLIC_STATIC_EXPORT === "1" ? PY_WORKER_STATIC_PATH : `${PY_WORKER_PATH}?index=${encodeURIComponent(url)}`, { name: "nova-python" }) as unknown as WorkerLike);
    this.worker = create(indexUrl);
    this.workerUrl = indexUrl;
    this.worker.postMessage({ type: "init", indexUrl });
    return this.worker;
  }

  /** Runs are serialized: one interpreter, one program at a time. */
  run(code: string, options: PythonRunOptions): Promise<PythonRunResult> {
    const next = this.queue.then(() => this.runNow(code, options));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private runNow(code: string, options: PythonRunOptions): Promise<PythonRunResult> {
    const clock = this.deps.clock ?? (() => Date.now());
    const started = clock();
    const indexUrl = this.indexOverride ?? this.deps.indexUrl();
    const id = ++this.runs;
    let stdout = "";
    let stderr = "";
    return new Promise<PythonRunResult>((resolve) => {
      let worker: WorkerLike;
      try {
        worker = this.spawn(indexUrl);
      } catch (error) {
        resolve({ stdout, stderr, files: [], truncated: false, timedOut: false, cancelled: false, durationMs: 0, error: { type: "RuntimeError", message: error instanceof Error ? error.message : "Could not start Python" } });
        return;
      }
      let settled = false;
      // The timeout covers execution only, not the first download of Pyodide.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const loadTimer = setTimeout(() => finish({ timedOut: true, error: { type: "TimeoutError", message: "Loading Python took too long (check the network / Pyodide URL)" } }, true), 180_000);
      const finish = (patch: Partial<PythonRunResult>, kill = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(loadTimer);
        options.signal?.removeEventListener("abort", onAbort);
        worker.onmessage = null;
        worker.onerror = null;
        if (kill) this.reset();
        resolve({ stdout, stderr, files: [], truncated: false, timedOut: false, cancelled: false, durationMs: clock() - started, ...patch });
      };
      const onAbort = () => finish({ cancelled: true, error: { type: "KeyboardInterrupt", message: "Execution cancelled" } }, true);
      if (options.signal?.aborted) return onAbort();
      options.signal?.addEventListener("abort", onAbort, { once: true });

      worker.onerror = (event) => {
        event.preventDefault?.();
        finish({ error: { type: "RuntimeError", message: event.message ?? "The Python worker crashed" } }, true);
      };
      worker.onmessage = (event) => {
        const msg = event.data as WorkerMessage;
        if (msg.type === "progress") {
          options.onProgress?.(msg.stage ?? "loading", msg.detail);
          if (msg.stage === "running" && !timer) {
            clearTimeout(loadTimer);
            timer = setTimeout(() => finish({ timedOut: true, error: { type: "TimeoutError", message: `Execution timed out after ${Math.round(options.timeoutMs / 1000)} s` } }, true), options.timeoutMs);
          }
          return;
        }
        if (msg.type === "fatal") return finish({ error: { type: "RuntimeError", message: `Could not load Python: ${msg.message ?? "unknown error"}` } }, true);
        if (msg.id !== id) return;
        if (msg.type === "stream" && msg.text) {
          if (msg.stream === "stderr") stderr += msg.text;
          else stdout += msg.text;
          options.onOutput?.(msg.stream ?? "stdout", msg.text);
        } else if (msg.type === "done") {
          const files: PythonFile[] = (msg.files ?? []).map((f) => ({ name: f.name, mimeType: mimeForFile(f.name), data: f.data }));
          finish({ value: msg.value, error: msg.error ? { type: msg.error.type, message: msg.error.message } : undefined, files, truncated: Boolean(msg.truncated) });
        }
      };
      worker.postMessage({
        type: "run",
        id,
        indexUrl,
        code,
        maxOutputChars: options.maxOutputChars,
        files: (options.files ?? []).map((f) => ({ name: f.name, data: f.data })),
      });
    });
  }
}
