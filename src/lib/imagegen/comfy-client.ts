import type { ComfyMapping, ComfyWorkflowJson, ImageGenParams } from "@/lib/models";
import { applyParams } from "./comfy-workflow";
import { ImageGenError, type GenerateOptions, type GeneratedImage, type ImageGenCapabilities, type ImageGenResult, type ImageGenerator } from "./types";

export interface ComfyImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

interface WebSocketLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onopen: ((event: unknown) => void) | null;
  close(): void;
}

export interface ComfyDeps {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  WebSocket?: new (url: string) => WebSocketLike;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  clientId?: () => string;
  /** Poll interval when WebSocket is unavailable. */
  pollMs?: number;
}

export function comfyWsUrl(baseUrl: string, clientId: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws`;
  url.search = `clientId=${encodeURIComponent(clientId)}`;
  return url.toString();
}

/**
 * ComfyUI HTTP + WebSocket client: POST /prompt, progress over /ws, outputs from
 * /history/{id}, images from /view. ComfyUI must run with --enable-cors-header for browsers.
 */
export class ComfyClient {
  private readonly fetcher: NonNullable<ComfyDeps["fetch"]>;
  private readonly sleep: NonNullable<ComfyDeps["sleep"]>;

  constructor(
    readonly baseUrl: string,
    private readonly deps: ComfyDeps = {},
  ) {
    this.fetcher = deps.fetch ?? ((url, init) => fetch(url, { ...init, credentials: "omit" }));
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(this.url(path), init);
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") throw new ImageGenError("aborted", "Generation cancelled", { cause: error });
      throw new ImageGenError("network", "Could not reach ComfyUI (is it running with --enable-cors-header?)", { cause: error });
    }
  }

  async systemStats(signal?: AbortSignal): Promise<{ version?: string; devices: string[] }> {
    const response = await this.request("system_stats", { signal });
    if (!response.ok) throw new ImageGenError("server", `ComfyUI responded ${response.status}`);
    const json = (await response.json()) as { system?: { comfyui_version?: string }; devices?: { name?: string }[] };
    return { version: json.system?.comfyui_version, devices: (json.devices ?? []).map((d) => d.name ?? "device") };
  }

  async queue(workflow: ComfyWorkflowJson, clientId: string, signal?: AbortSignal): Promise<string> {
    const response = await this.request("prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      signal,
    });
    const text = await response.text();
    if (!response.ok) {
      let message = `ComfyUI rejected the workflow (${response.status})`;
      try {
        const json = JSON.parse(text) as { error?: { message?: string }; node_errors?: Record<string, { errors?: { message?: string; details?: string }[] }> };
        const nodeError = Object.entries(json.node_errors ?? {})[0];
        message = json.error?.message ?? message;
        if (nodeError) message += ` — node ${nodeError[0]}: ${nodeError[1].errors?.[0]?.message ?? ""} ${nodeError[1].errors?.[0]?.details ?? ""}`.trim();
      } catch {
        /* not JSON */
      }
      throw new ImageGenError("bad_request", message.slice(0, 600));
    }
    const json = JSON.parse(text) as { prompt_id?: string };
    if (!json.prompt_id) throw new ImageGenError("invalid_response", "ComfyUI did not return a prompt id");
    return json.prompt_id;
  }

  /** null while still running. */
  async history(promptId: string, signal?: AbortSignal): Promise<{ images: ComfyImageRef[]; error?: string } | null> {
    const response = await this.request(`history/${encodeURIComponent(promptId)}`, { signal });
    if (!response.ok) throw new ImageGenError("server", `ComfyUI responded ${response.status}`);
    const json = (await response.json()) as Record<
      string,
      { outputs?: Record<string, { images?: ComfyImageRef[] }>; status?: { status_str?: string; completed?: boolean; messages?: [string, { exception_message?: string }][] } }
    >;
    const entry = json[promptId];
    if (!entry) return null;
    if (entry.status?.status_str === "error") {
      const failure = entry.status.messages?.find(([type]) => type === "execution_error")?.[1]?.exception_message;
      return { images: [], error: failure ?? "ComfyUI execution failed" };
    }
    if (entry.status && entry.status.completed === false) return null;
    const images = Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? []).filter((i) => i.type === "output");
    return { images };
  }

  async view(ref: ComfyImageRef, signal?: AbortSignal): Promise<Blob> {
    const query = new URLSearchParams({ filename: ref.filename, subfolder: ref.subfolder, type: ref.type });
    const response = await this.request(`view?${query.toString()}`, { signal });
    if (!response.ok) throw new ImageGenError("invalid_response", `Could not download ${ref.filename}`);
    return response.blob();
  }

  async interrupt(): Promise<void> {
    await this.request("interrupt", { method: "POST" }).catch(() => undefined);
  }

  /** Waits for completion using WebSocket progress; falls back to polling /history. */
  async wait(promptId: string, clientId: string, options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {}): Promise<ComfyImageRef[]> {
    const viaSocket = this.deps.WebSocket ?? (typeof WebSocket !== "undefined" ? (WebSocket as unknown as ComfyDeps["WebSocket"]) : undefined);
    if (viaSocket) {
      const finished = await new Promise<"done" | "fallback">((resolve, reject) => {
        let socket: WebSocketLike;
        try {
          socket = new viaSocket(comfyWsUrl(this.baseUrl, clientId));
        } catch {
          resolve("fallback");
          return;
        }
        const close = () => {
          socket.onmessage = socket.onclose = socket.onerror = socket.onopen = null;
          socket.close();
        };
        options.signal?.addEventListener(
          "abort",
          () => {
            close();
            reject(new ImageGenError("aborted", "Generation cancelled"));
          },
          { once: true },
        );
        socket.onerror = () => {
          close();
          resolve("fallback");
        };
        socket.onclose = () => resolve("fallback");
        // The job may have finished before the socket connected: check once on open.
        socket.onopen = () => {
          this.history(promptId, options.signal)
            .then((result) => {
              if (result) {
                close();
                resolve("done");
              }
            })
            .catch(() => undefined);
        };
        socket.onmessage = (event) => {
          if (typeof event.data !== "string") return; // binary previews
          let message: { type?: string; data?: { prompt_id?: string; value?: number; max?: number; node?: string | null; exception_message?: string } };
          try {
            message = JSON.parse(event.data);
          } catch {
            return;
          }
          const data = message.data ?? {};
          if (data.prompt_id && data.prompt_id !== promptId) return;
          if (message.type === "progress" && data.max) options.onProgress?.(Math.min(0.95, (data.value ?? 0) / data.max));
          if (message.type === "execution_error") {
            close();
            reject(new ImageGenError("server", data.exception_message ?? "ComfyUI execution failed"));
          }
          if ((message.type === "executing" && data.node === null) || message.type === "execution_success") {
            close();
            resolve("done");
          }
        };
      });
      if (finished === "done") {
        const result = await this.history(promptId, options.signal);
        if (result?.error) throw new ImageGenError("server", result.error);
        if (result) return result.images;
      }
    }
    return this.poll(promptId, options);
  }

  async poll(promptId: string, options: { signal?: AbortSignal; onProgress?: (fraction: number) => void; timeoutMs?: number } = {}): Promise<ComfyImageRef[]> {
    const deadline = Date.now() + (options.timeoutMs ?? 30 * 60 * 1000);
    while (Date.now() < deadline) {
      if (options.signal?.aborted) throw new ImageGenError("aborted", "Generation cancelled");
      const result = await this.history(promptId, options.signal);
      if (result?.error) throw new ImageGenError("server", result.error);
      if (result) return result.images;
      await this.sleep(this.deps.pollMs ?? 1500);
    }
    throw new ImageGenError("timeout", "ComfyUI job timed out");
  }

  async download(refs: ComfyImageRef[], seed: number | null, signal?: AbortSignal): Promise<GeneratedImage[]> {
    return Promise.all(
      refs.map(async (ref) => {
        const blob = await this.view(ref, signal);
        return { blob, mimeType: blob.type || "image/png", seed };
      }),
    );
  }
}

export class ComfyImageGenerator implements ImageGenerator {
  readonly kind = "comfyui" as const;

  constructor(
    private readonly client: ComfyClient,
    private readonly workflow: ComfyWorkflowJson,
    private readonly mapping: ComfyMapping,
    private readonly deps: Pick<ComfyDeps, "random" | "clientId"> = {},
  ) {}

  capabilities(): ImageGenCapabilities {
    return {
      negativePrompt: this.mapping.negativePrompt !== null,
      seed: this.mapping.seed !== null,
      steps: this.mapping.steps !== null,
      guidance: this.mapping.guidance !== null,
      sizes: null,
      maxCount: 8,
      models: [],
    };
  }

  async generate(params: ImageGenParams, options: GenerateOptions = {}): Promise<ImageGenResult> {
    const random = this.deps.random ?? Math.random;
    const clientId = this.deps.clientId?.() ?? (typeof crypto !== "undefined" ? crypto.randomUUID() : String(random()));
    const baseSeed = params.seed ?? Math.floor(random() * 2 ** 32);
    // One batched run when the graph exposes batch_size; otherwise sequential runs with seed+i.
    const runs = this.mapping.batchSize ? [{ seed: baseSeed, batch: params.count }] : Array.from({ length: params.count }, (_, i) => ({ seed: (baseSeed + i) % 2 ** 32, batch: 1 }));
    const images: GeneratedImage[] = [];
    for (const [index, run] of runs.entries()) {
      const workflow = applyParams(this.workflow, this.mapping, params, run.seed, run.batch);
      const promptId = await this.client.queue(workflow, clientId, options.signal);
      options.onJob?.(promptId);
      const refs = await this.client.wait(promptId, clientId, {
        signal: options.signal,
        onProgress: (fraction) => options.onProgress?.((index + fraction) / runs.length),
      });
      images.push(...(await this.client.download(refs, run.seed, options.signal)));
    }
    options.onProgress?.(1);
    if (!images.length) throw new ImageGenError("invalid_response", "The workflow produced no output images (add a SaveImage node)");
    return { images };
  }
}
