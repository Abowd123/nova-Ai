import { encodeImage } from "./encode-core";
import type { EncodeImageRequest, EncodeImageResult, WorkerResponse } from "./worker-protocol";

type EncodeOptions = Omit<EncodeImageRequest, "id" | "type">;

/** Runs image encoding in a Web Worker (OffscreenCanvas); falls back to the main thread. */
export class ImageProcessor {
  private worker: Worker | null = null;
  private failed = false;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (r: EncodeImageResult) => void; reject: (e: Error) => void }>();

  private getWorker(): Worker | null {
    if (this.failed || typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return null;
    if (this.worker) return this.worker;
    try {
      this.worker = new Worker(new URL("./media.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const entry = this.pending.get(event.data.id);
        if (!entry) return;
        this.pending.delete(event.data.id);
        if (event.data.ok) entry.resolve(event.data.result);
        else entry.reject(new Error(event.data.error));
      };
      this.worker.onerror = () => {
        this.failed = true;
        for (const entry of this.pending.values()) entry.reject(new Error("worker-crashed"));
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
      };
      return this.worker;
    } catch {
      this.failed = true;
      return null;
    }
  }

  async encode(options: EncodeOptions): Promise<EncodeImageResult> {
    const worker = this.getWorker();
    if (!worker) return encodeImage(options);
    const id = this.nextId++;
    const transfer: Transferable[] = options.source instanceof Blob ? [] : [options.source as unknown as Transferable];
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ ...options, id, type: "encode-image" } satisfies EncodeImageRequest, transfer);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
