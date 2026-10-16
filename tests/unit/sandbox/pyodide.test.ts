import { describe, expect, it } from "vitest";
import type { WorkerLike } from "@/lib/sandbox/js-sandbox";
import { PyodidePythonProvider } from "@/lib/sandbox/pyodide-provider";
import { formatPythonResult, mimeForFile } from "@/lib/sandbox/python-types";
import { pythonCsp, validPyodideUrl } from "@/lib/sandbox/py-worker-source";

/** Fake Pyodide worker following the real protocol. */
function fakeWorker(script: (msg: { type: string; id?: number; code?: string }, reply: (m: unknown) => void) => void) {
  const created: { url: string; worker: WorkerLike & { dead?: boolean } }[] = [];
  const factory = (url: string) => {
    const worker: WorkerLike & { dead?: boolean } = {
      onmessage: null,
      onerror: null,
      postMessage: (msg) => script(msg as { type: string }, (m) => queueMicrotask(() => worker.onmessage?.({ data: m }))),
      terminate() {
        worker.dead = true;
      },
    };
    created.push({ url, worker });
    return worker;
  };
  return { factory, created };
}

describe("Pyodide provider", () => {
  it("streams output, returns the value and output files", async () => {
    const { factory, created } = fakeWorker((msg, reply) => {
      if (msg.type !== "run") return;
      reply({ type: "progress", stage: "running" });
      reply({ type: "stream", id: msg.id, stream: "stdout", text: "hello\n" });
      reply({ type: "done", id: msg.id, value: "3", files: [{ name: "chart.png", data: new Uint8Array([1, 2]) }] });
    });
    const provider = new PyodidePythonProvider({ indexUrl: () => "https://cdn.test/pyodide/", createWorker: factory });
    const stages: string[] = [];
    const result = await provider.run("print('hello')\n1+2", { timeoutMs: 1000, maxOutputChars: 1000, onProgress: (s) => stages.push(s) });
    expect(result).toMatchObject({ stdout: "hello\n", value: "3", timedOut: false });
    expect(result.files[0]).toMatchObject({ name: "chart.png", mimeType: "image/png" });
    expect(stages).toContain("running");
    // Worker is reused between runs.
    await provider.run("1", { timeoutMs: 1000, maxOutputChars: 1000 });
    expect(created).toHaveLength(1);
    expect(formatPythonResult(result)).toContain("Output files: chart.png (2 bytes)");
  });

  it("reports Python exceptions", async () => {
    const { factory } = fakeWorker((msg, reply) => {
      if (msg.type === "run") reply({ type: "done", id: msg.id, error: { type: "ZeroDivisionError", message: "division by zero" }, files: [] });
    });
    const result = await new PyodidePythonProvider({ indexUrl: () => "https://cdn.test/", createWorker: factory }).run("1/0", { timeoutMs: 1000, maxOutputChars: 1000 });
    expect(result.error).toEqual({ type: "ZeroDivisionError", message: "division by zero" });
  });

  it("times out only after running starts, then kills the worker", async () => {
    const { factory, created } = fakeWorker((msg, reply) => {
      if (msg.type === "run") reply({ type: "progress", stage: "running" });
    });
    const provider = new PyodidePythonProvider({ indexUrl: () => "https://cdn.test/", createWorker: factory });
    const result = await provider.run("while True: pass", { timeoutMs: 30, maxOutputChars: 1000 });
    expect(result.timedOut).toBe(true);
    expect(created[0]!.worker.dead).toBe(true);
    await provider.run("1", { timeoutMs: 30, maxOutputChars: 1000 });
    expect(created).toHaveLength(2);
  });

  it("cancels and reports load failures", async () => {
    const { factory } = fakeWorker((msg, reply) => {
      if (msg.type === "init") reply({ type: "fatal", message: "NetworkError" });
    });
    const provider = new PyodidePythonProvider({ indexUrl: () => "https://cdn.test/", createWorker: factory });
    const result = await provider.run("1", { timeoutMs: 1000, maxOutputChars: 1000 });
    expect(result.error?.message).toContain("Could not load Python");
    const controller = new AbortController();
    controller.abort();
    expect((await provider.run("1", { timeoutMs: 1000, maxOutputChars: 1000, signal: controller.signal })).cancelled).toBe(true);
  });

  it("validates the Pyodide URL and builds a CSP for its origin", () => {
    expect(validPyodideUrl("https://cdn.jsdelivr.net/pyodide/v0.27.7/full")).toBe("https://cdn.jsdelivr.net/pyodide/v0.27.7/full/");
    expect(validPyodideUrl("http://evil.test/")).toBeNull();
    expect(validPyodideUrl("https://x.test/?a=1")).toBeNull();
    expect(validPyodideUrl("javascript:alert(1)")).toBeNull();
    expect(pythonCsp("https://cdn.jsdelivr.net/pyodide/")).toContain("script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net");
    expect(mimeForFile("data.CSV")).toBe("text/csv");
  });
});
