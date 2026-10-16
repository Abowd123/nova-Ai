/// <reference lib="webworker" />
import { encodeImage } from "./encode-core";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    const result = await encodeImage(request);
    self.postMessage({ id: request.id, ok: true, result } satisfies WorkerResponse);
  } catch (error) {
    self.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : "encode-failed" } satisfies WorkerResponse);
  }
};
