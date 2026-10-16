import { joinUrl } from "@/lib/ai/http";
import type { HttpClient, ProviderConfig } from "@/lib/ai/types";
import { mergeHeaders } from "@/lib/ai/adapters/shared";
import { base64ToBlob } from "@/lib/media/encoding";
import { nearestSize } from "@/lib/media/geometry";
import type { ImageGenParams } from "@/lib/models";
import { redactSecrets } from "@/lib/security/redact";
import { ImageGenError, statusToCode, type GenerateOptions, type ImageGenCapabilities, type ImageGenResult, type ImageGenerator } from "./types";

async function postJson<T>(http: HttpClient, url: string, headers: Record<string, string>, body: unknown, secrets: (string | undefined)[], signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await http(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", ...headers }, body: JSON.stringify(body), signal });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw new ImageGenError("aborted", "Generation cancelled", { cause: error });
    throw new ImageGenError("network", "Could not reach the image service", { cause: error });
  }
  const text = await response.text();
  if (!response.ok) {
    let message = text.slice(0, 500);
    try {
      const json = JSON.parse(text) as { error?: { message?: string } | string };
      message = typeof json.error === "string" ? json.error : (json.error?.message ?? message);
    } catch {
      /* not JSON */
    }
    throw new ImageGenError(statusToCode(response.status, text), redactSecrets(message, secrets));
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new ImageGenError("invalid_response", "Image service returned invalid JSON", { cause: error });
  }
}

async function fetchImage(http: HttpClient, url: string, signal?: AbortSignal): Promise<Blob> {
  const response = await http(url, { method: "GET", signal });
  if (!response.ok) throw new ImageGenError("invalid_response", `Could not download image (${response.status})`);
  return response.blob();
}

function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const match = /^data:([\w.+/-]+);base64,(.+)$/.exec(url);
  return match ? { mimeType: match[1]!, data: match[2]! } : null;
}

// ------------------------------------------------------------------ OpenAI Images

const GPT_IMAGE_SIZES = ["1024x1024", "1536x1024", "1024x1536"] as const;
const DALLE3_SIZES = ["1024x1024", "1792x1024", "1024x1792"] as const;
const DALLE2_SIZES = ["256x256", "512x512", "1024x1024"] as const;

export class OpenAIImageGenerator implements ImageGenerator {
  readonly kind = "openai" as const;
  constructor(
    private readonly config: ProviderConfig,
    private readonly http: HttpClient,
  ) {}

  capabilities(model: string): ImageGenCapabilities {
    const dalle3 = model.startsWith("dall-e-3");
    const dalle2 = model.startsWith("dall-e-2");
    return {
      negativePrompt: false,
      seed: false,
      steps: false,
      guidance: false,
      sizes: dalle3 ? DALLE3_SIZES : dalle2 ? DALLE2_SIZES : GPT_IMAGE_SIZES,
      maxCount: dalle3 ? 1 : 8,
      models: ["gpt-image-1", "gpt-image-1-mini", "dall-e-3", "dall-e-2"],
    };
  }

  /** Request body for /images/generations (exported for tests). */
  body(params: ImageGenParams): Record<string, unknown> {
    const model = params.model || "gpt-image-1";
    const caps = this.capabilities(model);
    const body: Record<string, unknown> = {
      model,
      prompt: params.prompt,
      n: Math.min(params.count, caps.maxCount),
      size: nearestSize(params.width, params.height, caps.sizes ?? GPT_IMAGE_SIZES),
    };
    // gpt-image-* always returns base64; DALL·E needs it requested.
    if (model.startsWith("dall-e")) body.response_format = "b64_json";
    return body;
  }

  async generate(params: ImageGenParams, options: GenerateOptions = {}): Promise<ImageGenResult> {
    const headers: Record<string, string> = {};
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    options.onProgress?.(0.05);
    const json = await postJson<{ data?: { b64_json?: string; url?: string; revised_prompt?: string }[] }>(
      this.http,
      joinUrl(this.config.baseUrl, "images/generations"),
      mergeHeaders(headers, this.config),
      this.body(params),
      [this.config.apiKey],
      options.signal,
    );
    const items = json.data ?? [];
    if (!items.length) throw new ImageGenError("invalid_response", "No images returned");
    const images = await Promise.all(
      items.map(async (item) => {
        if (item.b64_json) return { blob: base64ToBlob(item.b64_json, "image/png"), mimeType: "image/png", seed: null };
        if (item.url) {
          const blob = await fetchImage(this.http, item.url, options.signal);
          return { blob, mimeType: blob.type || "image/png", seed: null };
        }
        throw new ImageGenError("invalid_response", "Image item has no data");
      }),
    );
    options.onProgress?.(1);
    return { images, ...(items[0]?.revised_prompt ? { revisedPrompt: items[0].revised_prompt } : {}) };
  }
}

// ------------------------------------------------------------------ Gemini / Imagen

export class GeminiImageGenerator implements ImageGenerator {
  readonly kind = "gemini" as const;
  constructor(
    private readonly config: ProviderConfig,
    private readonly http: HttpClient,
  ) {}

  private isImagen(model: string): boolean {
    return model.startsWith("imagen");
  }

  capabilities(model: string): ImageGenCapabilities {
    const imagen = this.isImagen(model);
    return {
      negativePrompt: imagen,
      seed: imagen,
      steps: false,
      guidance: false,
      sizes: null,
      maxCount: imagen ? 4 : 1,
      models: ["imagen-4.0-generate-001", "imagen-4.0-fast-generate-001", "gemini-2.5-flash-image"],
    };
  }

  /** Imagen :predict body (exported for tests). */
  imagenBody(params: ImageGenParams): Record<string, unknown> {
    const parameters: Record<string, unknown> = { sampleCount: Math.min(params.count, 4), aspectRatio: params.aspectRatio };
    if (params.negativePrompt.trim()) parameters.negativePrompt = params.negativePrompt;
    if (params.seed !== null) {
      parameters.seed = params.seed;
      parameters.addWatermark = false; // Imagen ignores seeds while watermarking
    }
    return { instances: [{ prompt: params.prompt }], parameters };
  }

  async generate(params: ImageGenParams, options: GenerateOptions = {}): Promise<ImageGenResult> {
    const model = params.model || "imagen-4.0-generate-001";
    const headers = mergeHeaders(this.config.apiKey ? { "x-goog-api-key": this.config.apiKey } : {}, this.config);
    options.onProgress?.(0.05);
    if (this.isImagen(model)) {
      const json = await postJson<{ predictions?: { bytesBase64Encoded?: string; mimeType?: string }[] }>(
        this.http,
        joinUrl(this.config.baseUrl, `models/${model}:predict`),
        headers,
        this.imagenBody(params),
        [this.config.apiKey],
        options.signal,
      );
      const images = (json.predictions ?? [])
        .filter((p) => p.bytesBase64Encoded)
        .map((p) => ({ blob: base64ToBlob(p.bytesBase64Encoded!, p.mimeType ?? "image/png"), mimeType: p.mimeType ?? "image/png", seed: params.seed }));
      if (!images.length) throw new ImageGenError("content_policy", "No images returned (possibly filtered)");
      options.onProgress?.(1);
      return { images };
    }
    // Gemini native image models: generateContent with IMAGE modality.
    const json = await postJson<{ candidates?: { content?: { parts?: { text?: string; inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }[] } }[] }>(
      this.http,
      joinUrl(this.config.baseUrl, `models/${model}:generateContent`),
      headers,
      {
        contents: [{ role: "user", parts: [{ text: params.negativePrompt.trim() ? `${params.prompt}\n\nAvoid: ${params.negativePrompt}` : params.prompt }] }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: params.aspectRatio } },
      },
      [this.config.apiKey],
      options.signal,
    );
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const images = parts
      .map((p) => p.inlineData ?? (p.inline_data ? { mimeType: p.inline_data.mime_type, data: p.inline_data.data } : undefined))
      .filter((d): d is { mimeType?: string; data: string } => Boolean(d?.data))
      .map((d) => ({ blob: base64ToBlob(d.data, d.mimeType ?? "image/png"), mimeType: d.mimeType ?? "image/png", seed: null }));
    if (!images.length) throw new ImageGenError("content_policy", parts.find((p) => p.text)?.text?.slice(0, 300) ?? "No image returned");
    options.onProgress?.(1);
    return { images };
  }
}

// ------------------------------------------------------------------ OpenRouter

export class OpenRouterImageGenerator implements ImageGenerator {
  readonly kind = "openrouter" as const;
  constructor(
    private readonly config: ProviderConfig,
    private readonly http: HttpClient,
    private readonly appUrl = "https://nova.local",
  ) {}

  capabilities(): ImageGenCapabilities {
    return { negativePrompt: false, seed: true, steps: false, guidance: false, sizes: null, maxCount: 1, models: ["google/gemini-2.5-flash-image", "openai/gpt-5-image-mini"] };
  }

  async generate(params: ImageGenParams, options: GenerateOptions = {}): Promise<ImageGenResult> {
    const headers: Record<string, string> = { "HTTP-Referer": this.appUrl, "X-Title": "Nova" };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    options.onProgress?.(0.05);
    const json = await postJson<{ choices?: { message?: { content?: string; images?: { image_url?: { url?: string } }[] } }[] }>(
      this.http,
      joinUrl(this.config.baseUrl, "chat/completions"),
      mergeHeaders(headers, this.config),
      {
        model: params.model || "google/gemini-2.5-flash-image",
        modalities: ["image", "text"],
        messages: [{ role: "user", content: params.prompt }],
        image_config: { aspect_ratio: params.aspectRatio },
        ...(params.seed !== null ? { seed: params.seed } : {}),
      },
      [this.config.apiKey],
      options.signal,
    );
    const message = json.choices?.[0]?.message;
    const images = await Promise.all(
      (message?.images ?? [])
        .map((i) => i.image_url?.url)
        .filter((u): u is string => Boolean(u))
        .map(async (url) => {
          const data = parseDataUrl(url);
          if (data) return { blob: base64ToBlob(data.data, data.mimeType), mimeType: data.mimeType, seed: params.seed };
          const blob = await fetchImage(this.http, url, options.signal);
          return { blob, mimeType: blob.type || "image/png", seed: params.seed };
        }),
    );
    if (!images.length) throw new ImageGenError("invalid_response", message?.content?.slice(0, 300) || "The model returned no image");
    options.onProgress?.(1);
    return { images };
  }
}
