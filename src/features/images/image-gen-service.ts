import { httpForTransport } from "@/lib/ai/transport";
import type { ProviderConfig } from "@/lib/ai/types";
import { ComfyClient, ComfyImageGenerator } from "@/lib/imagegen/comfy-client";
import { GeminiImageGenerator, OpenAIImageGenerator, OpenRouterImageGenerator } from "@/lib/imagegen/http-generators";
import { ImageGenError, type GeneratedImage, type ImageGenerator } from "@/lib/imagegen/types";
import { blobToDataUrl } from "@/lib/media/encoding";
import type { ImageProcessor } from "@/lib/media/image-processor";
import { THUMBNAIL_SIZE } from "@/lib/media/limits";
import type { ComfyWorkflow, ImageBackendKind, ImageGenParams, ImageGeneration, Provider } from "@/lib/models";
import type { Repositories } from "@/lib/storage/types";
import { redactSecrets } from "@/lib/security/redact";

export interface ImageSource {
  /** "<backend>:<sourceId>" */
  key: string;
  backend: ImageBackendKind;
  sourceId: string;
  name: string;
}

const IMAGE_PROVIDER_KINDS: Partial<Record<Provider["kind"], ImageBackendKind>> = { openai: "openai", gemini: "gemini", openrouter: "openrouter" };

export function sourcesFrom(providers: Provider[], workflows: ComfyWorkflow[]): ImageSource[] {
  const fromProviders = providers
    .filter((p) => p.enabled && IMAGE_PROVIDER_KINDS[p.kind])
    .map((p) => ({ key: `${IMAGE_PROVIDER_KINDS[p.kind]}:${p.id}`, backend: IMAGE_PROVIDER_KINDS[p.kind]!, sourceId: p.id, name: p.name }));
  const fromComfy = workflows.map((w) => ({ key: `comfyui:${w.id}`, backend: "comfyui" as const, sourceId: w.id, name: `ComfyUI · ${w.name}` }));
  return [...fromProviders, ...fromComfy];
}

export interface ImageGenServiceDeps {
  repos: Repositories;
  images: Pick<ImageProcessor, "encode">;
  getProviderConfig: (id: string) => Promise<ProviderConfig>;
  onChange?: () => void;
  notify?: (title: string, body: string) => void;
  appUrl?: string;
}

interface RunningJob {
  controller: AbortController;
  client?: ComfyClient;
}

/**
 * Runs image jobs independently of any React screen: navigating away keeps them going,
 * ComfyUI jobs are resumed after a reload from their remote prompt id, and a system
 * notification is shown when a job finishes in a hidden tab.
 */
export class ImageGenService {
  private readonly running = new Map<string, RunningJob>();
  private readonly progress = new Map<string, number>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: ImageGenServiceDeps) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  progressOf(id: string): number | undefined {
    return this.progress.get(id);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
    this.deps.onChange?.();
  }

  async generatorFor(backend: ImageBackendKind, sourceId: string): Promise<{ generator: ImageGenerator; client?: ComfyClient }> {
    if (backend === "comfyui") {
      const workflow = await this.deps.repos.comfyWorkflows.get(sourceId);
      if (!workflow) throw new ImageGenError("not_configured", "ComfyUI workflow not found");
      const client = new ComfyClient(workflow.baseUrl);
      return { generator: new ComfyImageGenerator(client, workflow.workflow, workflow.mapping), client };
    }
    const config = await this.deps.getProviderConfig(sourceId);
    const http = httpForTransport(config.transport);
    if (backend === "openai") return { generator: new OpenAIImageGenerator(config, http) };
    if (backend === "gemini") return { generator: new GeminiImageGenerator(config, http) };
    return { generator: new OpenRouterImageGenerator(config, http, this.deps.appUrl) };
  }

  async start(backend: ImageBackendKind, sourceId: string, params: ImageGenParams): Promise<ImageGeneration> {
    const record = await this.deps.repos.imageGenerations.create({ backend, sourceId, params });
    this.emit();
    void this.run(record);
    return record;
  }

  private async run(record: ImageGeneration): Promise<void> {
    const controller = new AbortController();
    const job: RunningJob = { controller };
    this.running.set(record.id, job);
    let lastSaved = 0;
    try {
      const { generator, client } = await this.generatorFor(record.backend, record.sourceId);
      job.client = client;
      await this.deps.repos.imageGenerations.update(record.id, { status: "running", progress: 0 });
      this.emit();
      const result = await generator.generate(record.params, {
        signal: controller.signal,
        onProgress: (fraction) => {
          this.progress.set(record.id, fraction);
          for (const listener of this.listeners) listener();
          if (Date.now() - lastSaved > 2000) {
            lastSaved = Date.now();
            void this.deps.repos.imageGenerations.update(record.id, { progress: Math.min(1, fraction) }).catch(() => undefined);
          }
        },
        onJob: (jobId) => void this.deps.repos.imageGenerations.update(record.id, { remoteJobId: jobId }).catch(() => undefined),
      });
      await this.complete(record, result.images, result.revisedPrompt ?? null);
    } catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof ImageGenError && error.code === "aborted");
      await this.deps.repos.imageGenerations
        .update(record.id, {
          status: cancelled ? "cancelled" : "error",
          error: cancelled ? null : redactSecrets(error instanceof Error ? error.message : "Generation failed").slice(0, 2000),
        })
        .catch(() => undefined);
    } finally {
      this.running.delete(record.id);
      this.progress.delete(record.id);
      this.emit();
    }
  }

  private async complete(record: ImageGeneration, images: GeneratedImage[], revisedPrompt: string | null): Promise<void> {
    const imageIds: string[] = [];
    const seeds: (number | null)[] = [];
    for (const [index, image] of images.entries()) {
      let thumbnail: string | null = null;
      let width: number | undefined;
      let height: number | undefined;
      try {
        const encoded = await this.deps.images.encode({ source: image.blob, maxDimension: 16_384, format: "image/webp", quality: 0.9, thumbnailSize: THUMBNAIL_SIZE });
        thumbnail = await blobToDataUrl(encoded.thumbnail, "image/jpeg");
        width = encoded.originalWidth;
        height = encoded.originalHeight;
      } catch {
        thumbnail = null;
      }
      const ext = image.mimeType.split("/")[1] ?? "png";
      const attachment = await this.deps.repos.attachments.create(
        {
          kind: "image",
          name: `nova-${record.id.slice(0, 8)}-${index + 1}.${ext}`,
          mimeType: image.mimeType,
          size: image.blob.size,
          storage: "idb",
          thumbnail,
          metadata: { ...(width ? { width, height } : {}) },
        },
        image.blob,
      );
      imageIds.push(attachment.id);
      seeds.push(image.seed);
    }
    await this.deps.repos.imageGenerations.update(record.id, { status: "complete", progress: 1, imageIds, seeds, revisedPrompt, error: null });
    if (typeof document !== "undefined" && document.hidden) this.deps.notify?.("Nova", record.params.prompt.slice(0, 120));
  }

  cancel(id: string): void {
    const job = this.running.get(id);
    if (!job) return;
    job.controller.abort();
    void job.client?.interrupt();
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  /** After a reload: resume ComfyUI jobs by prompt id; mark other unfinished jobs as interrupted. */
  async resumeInterrupted(): Promise<number> {
    const unfinished = await this.deps.repos.imageGenerations.listByStatus(["queued", "running"]);
    let resumed = 0;
    for (const record of unfinished) {
      if (this.running.has(record.id)) continue;
      if (record.backend === "comfyui" && record.remoteJobId) {
        resumed += 1;
        void this.resumeComfy(record);
      } else {
        await this.deps.repos.imageGenerations.update(record.id, { status: "error", error: "interrupted" });
      }
    }
    if (unfinished.length) this.emit();
    return resumed;
  }

  private async resumeComfy(record: ImageGeneration): Promise<void> {
    const controller = new AbortController();
    const workflow = await this.deps.repos.comfyWorkflows.get(record.sourceId);
    if (!workflow) {
      await this.deps.repos.imageGenerations.update(record.id, { status: "error", error: "ComfyUI workflow not found" });
      return;
    }
    const client = new ComfyClient(workflow.baseUrl);
    this.running.set(record.id, { controller, client });
    try {
      const refs = await client.poll(record.remoteJobId!, { signal: controller.signal });
      await this.complete(record, await client.download(refs, record.params.seed, controller.signal), null);
    } catch (error) {
      await this.deps.repos.imageGenerations
        .update(record.id, { status: controller.signal.aborted ? "cancelled" : "error", error: error instanceof Error ? error.message.slice(0, 2000) : "failed" })
        .catch(() => undefined);
    } finally {
      this.running.delete(record.id);
      this.emit();
    }
  }
}
