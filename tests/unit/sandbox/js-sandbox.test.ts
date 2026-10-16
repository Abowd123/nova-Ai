// @vitest-environment node
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { JsSandbox, formatJsResult, type WorkerLike } from "@/lib/sandbox/js-sandbox";
import { JS_WORKER_SOURCE, sandboxCsp } from "@/lib/sandbox/js-worker-source";

/** Runs the REAL worker source in a vm context that mimics a DedicatedWorkerGlobalScope. */
class VmWorker implements WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  terminated = false;
  private readonly listeners: ((event: { data: unknown }) => void)[] = [];

  constructor() {
    const scope: Record<string, unknown> = {
      postMessage: (data: unknown) => queueMicrotask(() => !this.terminated && this.onmessage?.({ data: structuredClone(data) })),
      addEventListener: (type: string, fn: (event: { data: unknown }) => void) => {
        if (type === "message") this.listeners.push(fn);
      },
      fetch: () => Promise.resolve("network!"),
      XMLHttpRequest: function XMLHttpRequest() {},
      indexedDB: {},
      performance: {},
      setTimeout,
      queueMicrotask,
    };
    const context = vm.createContext(scope);
    scope.self = context;
    vm.runInContext(JS_WORKER_SOURCE, context);
  }

  postMessage(message: unknown): void {
    for (const listener of this.listeners) listener({ data: message });
  }

  terminate(): void {
    this.terminated = true;
  }
}

const sandbox = () => new JsSandbox({ createWorker: () => new VmWorker(), nonce: () => "nonce-1" });
const opts = { timeoutMs: 500, allowNetwork: false, maxOutputChars: 2000, memoryLimitMb: 64 };

describe("JS sandbox", () => {
  it("captures console output and the last expression value", async () => {
    const result = await sandbox().run("console.log('hi', [1, 2]); console.warn('careful'); 6 * 7", opts);
    expect(result.logs).toEqual([
      { level: "log", text: "hi [1, 2]" },
      { level: "warn", text: "careful" },
    ]);
    expect(result.value).toBe("42");
    expect(result.error).toBeUndefined();
    expect(formatJsResult(result)).toContain("Result: 42");
  });

  it("supports top-level await and returns the final value", async () => {
    const result = await sandbox().run("const v = await Promise.resolve(20);\nv + 1", opts);
    expect(result.value).toBe("21");
  });

  it("blocks network and storage APIs by default", async () => {
    const result = await sandbox().run("[typeof fetch, typeof XMLHttpRequest, typeof indexedDB, typeof postMessage].join(',')", opts);
    expect(result.value).toBe("undefined,undefined,undefined,undefined");
    const allowed = await sandbox().run("typeof fetch", { ...opts, allowNetwork: true });
    expect(allowed.value).toBe("function");
  });

  it("reports errors with their type", async () => {
    const result = await sandbox().run("null.x", opts);
    expect(result.error?.name).toBe("TypeError");
    expect(formatJsResult(result)).toContain("TypeError");
  });

  it("caps output", async () => {
    const result = await sandbox().run("for (let i = 0; i < 1000; i++) console.log('line ' + i)", { ...opts, maxOutputChars: 1000 });
    expect(result.truncated).toBe(true);
    expect(result.logs.reduce((n, l) => n + l.text.length, 0)).toBeLessThanOrEqual(1000);
  });

  it("times out and cancels (hard stop terminates the worker)", async () => {
    const workers: VmWorker[] = [];
    // A worker that never answers simulates `while(true){}` (the host only sees silence).
    const silent = new JsSandbox({
      createWorker: () => {
        const w = { onmessage: null, onerror: null, postMessage() {}, terminate() { (this as { dead?: boolean }).dead = true; } } as unknown as VmWorker;
        workers.push(w);
        return w;
      },
    });
    const timed = await silent.run("while(true){}", { ...opts, timeoutMs: 30 });
    expect(timed.timedOut).toBe(true);
    expect((workers[0] as unknown as { dead?: boolean }).dead).toBe(true);
    const controller = new AbortController();
    const pending = silent.run("while(true){}", { ...opts, signal: controller.signal });
    controller.abort();
    expect((await pending).cancelled).toBe(true);
  });

  it("ignores forged messages without the nonce", async () => {
    const fake = new JsSandbox({
      createWorker: () => {
        const w: WorkerLike = {
          onmessage: null,
          onerror: null,
          postMessage: () => {
            queueMicrotask(() => {
              w.onmessage?.({ data: { nonce: "wrong", type: "done", value: "forged" } });
              w.onmessage?.({ data: { nonce: "n", type: "done", value: "real" } });
            });
          },
          terminate() {},
        };
        return w;
      },
      nonce: () => "n",
    });
    expect((await fake.run("1", opts)).value).toBe("real");
  });

  it("uses a strict CSP for the worker", () => {
    expect(sandboxCsp(false)).toContain("connect-src 'none'");
    expect(sandboxCsp(true)).toContain("connect-src *");
  });
});
