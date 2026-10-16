import { runBenchmark, type BenchmarkResult } from "./benchmark";
import { MemoryIndex, type IndexEntry, type SearchHit, type SearchQuery } from "./memory-index";
import type { IndexRequest, IndexResponse } from "./index-protocol";

type WithoutId<T> = T extends { id: number } ? Omit<T, "id"> : never;

/** Async facade over the memory index; uses a Web Worker when available (search off the main thread). */
export interface MemoryIndexClient {
  reset(entries: IndexEntry[]): Promise<void>;
  upsert(entries: IndexEntry[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  search(query: SearchQuery): Promise<SearchHit[]>;
  size(): Promise<number>;
  /** Times a synthetic index (same thread as real searches). */
  benchmark(count: number, dims: number): Promise<BenchmarkResult>;
  dispose(): void;
}

export function createInlineIndexClient(index = new MemoryIndex()): MemoryIndexClient {
  return {
    reset: async (entries) => {
      index.clear();
      index.upsert(entries);
    },
    upsert: async (entries) => index.upsert(entries),
    remove: async (ids) => index.remove(ids),
    search: async (query) => index.search(query),
    size: async () => index.size,
    benchmark: async (count, dims) => runBenchmark({ count, dims }),
    dispose: () => index.clear(),
  };
}

/**
 * @param onLost called when the worker crashed and the index fell back to an EMPTY inline
 *   index: the owner must reload entries (we don't mirror vectors on the main thread: 10k×1536
 *   floats would double memory use).
 */
export function createWorkerIndexClient(
  options: { factory?: () => Worker; onLost?: () => void } = {},
): MemoryIndexClient {
  const factory = options.factory ?? (() => new Worker(new URL("./memory.worker.ts", import.meta.url), { type: "module" }));
  let worker: Worker | null = null;
  let fallback: MemoryIndexClient | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve: (r: IndexResponse & { ok: true }) => void; reject: (e: Error) => void }>();

  const fail = () => {
    worker?.terminate();
    worker = null;
    fallback = createInlineIndexClient();
    for (const entry of pending.values()) entry.reject(new Error("memory-worker-crashed"));
    pending.clear();
    options.onLost?.();
  };

  const getWorker = (): Worker | null => {
    if (fallback) return null;
    if (worker) return worker;
    if (typeof Worker === "undefined") {
      fallback = createInlineIndexClient();
      return null;
    }
    try {
      worker = factory();
      worker.onmessage = (event: MessageEvent<IndexResponse>) => {
        const entry = pending.get(event.data.id);
        if (!entry) return;
        pending.delete(event.data.id);
        if (event.data.ok) entry.resolve(event.data);
        else entry.reject(new Error(event.data.error));
      };
      worker.onerror = fail;
      return worker;
    } catch {
      fallback = createInlineIndexClient();
      return null;
    }
  };

  const call = (request: WithoutId<IndexRequest>): Promise<IndexResponse & { ok: true }> => {
    const w = getWorker();
    if (!w) throw new Error("no-worker");
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ ...request, id } as IndexRequest);
    });
  };

  return {
    reset: async (entries) => {
      if (getWorker()) await call({ type: "reset", entries });
      else await fallback!.reset(entries);
    },
    upsert: async (entries) => {
      if (getWorker()) await call({ type: "upsert", entries });
      else await fallback!.upsert(entries);
    },
    remove: async (ids) => {
      if (getWorker()) await call({ type: "remove", ids });
      else await fallback!.remove(ids);
    },
    search: async (query) => (getWorker() ? ((await call({ type: "search", query })).hits ?? []) : fallback!.search(query)),
    size: async () => (getWorker() ? ((await call({ type: "size" })).size ?? 0) : fallback!.size()),
    benchmark: async (count, dims) => {
      if (!getWorker()) return fallback!.benchmark(count, dims);
      const result = (await call({ type: "benchmark", count, dims })).benchmark;
      if (!result) throw new Error("benchmark-failed");
      return result;
    },
    dispose: () => {
      worker?.terminate();
      worker = null;
      void fallback?.dispose();
    },
  };
}
