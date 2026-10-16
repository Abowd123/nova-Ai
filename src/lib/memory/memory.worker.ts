/// <reference lib="webworker" />
import { runBenchmark } from "./benchmark";
import { MemoryIndex } from "./memory-index";
import type { IndexRequest, IndexResponse } from "./index-protocol";

declare const self: DedicatedWorkerGlobalScope;

const index = new MemoryIndex();

self.onmessage = (event: MessageEvent<IndexRequest>) => {
  const request = event.data;
  try {
    switch (request.type) {
      case "reset":
        index.clear();
        index.upsert(request.entries);
        self.postMessage({ id: request.id, ok: true, size: index.size } satisfies IndexResponse);
        return;
      case "upsert":
        index.upsert(request.entries);
        self.postMessage({ id: request.id, ok: true, size: index.size } satisfies IndexResponse);
        return;
      case "remove":
        index.remove(request.ids);
        self.postMessage({ id: request.id, ok: true, size: index.size } satisfies IndexResponse);
        return;
      case "search":
        self.postMessage({ id: request.id, ok: true, hits: index.search(request.query) } satisfies IndexResponse);
        return;
      case "size":
        self.postMessage({ id: request.id, ok: true, size: index.size } satisfies IndexResponse);
        return;
      case "benchmark":
        // Separate throwaway index: never touches the user's memories.
        self.postMessage({ id: request.id, ok: true, benchmark: runBenchmark({ count: request.count, dims: request.dims }) } satisfies IndexResponse);
        return;
    }
  } catch (error) {
    self.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : "index-failed" } satisfies IndexResponse);
  }
};
