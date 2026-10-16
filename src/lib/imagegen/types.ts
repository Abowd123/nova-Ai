import type { ImageGenParams } from "@/lib/models";

export type ImageGenErrorCode = "unauthorized" | "bad_request" | "rate_limited" | "content_policy" | "network" | "server" | "aborted" | "not_configured" | "invalid_response" | "timeout";

export class ImageGenError extends Error {
  constructor(
    readonly code: ImageGenErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ImageGenError";
  }
}

export interface GeneratedImage {
  blob: Blob;
  mimeType: string;
  seed: number | null;
}

export interface ImageGenResult {
  images: GeneratedImage[];
  revisedPrompt?: string;
}

export interface ImageGenCapabilities {
  negativePrompt: boolean;
  seed: boolean;
  steps: boolean;
  guidance: boolean;
  /** Exact sizes accepted ("WxH"); null = any multiple of 8/64. */
  sizes: readonly string[] | null;
  maxCount: number;
  /** Suggested model ids. */
  models: readonly string[];
}

export interface GenerateOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  /** Long-running backends (ComfyUI) report a job id so the app can resume after reload. */
  onJob?: (jobId: string) => void;
}

/** One interface for every backend; the UI never knows which one it talks to. */
export interface ImageGenerator {
  readonly kind: "openai" | "gemini" | "openrouter" | "comfyui";
  capabilities(model: string): ImageGenCapabilities;
  generate(params: ImageGenParams, options?: GenerateOptions): Promise<ImageGenResult>;
}

export function statusToCode(status: number, body: string): ImageGenErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  if (/safety|policy|moderation|blocked/i.test(body)) return "content_policy";
  return "bad_request";
}
