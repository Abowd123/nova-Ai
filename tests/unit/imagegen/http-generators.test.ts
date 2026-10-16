import { describe, expect, it } from "vitest";
import { GeminiImageGenerator, OpenAIImageGenerator, OpenRouterImageGenerator } from "@/lib/imagegen/http-generators";
import { ImageGenError, statusToCode } from "@/lib/imagegen/types";
import type { ProviderConfig } from "@/lib/ai/types";
import { params } from "./fixtures";

const config = (kind: ProviderConfig["kind"], baseUrl: string): ProviderConfig => ({ id: "p1", kind, name: kind, baseUrl, apiKey: "sk-test-secret-999", transport: "direct" });

function http(responder: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    client: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return responder(url, init);
    },
  };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const B64_PNG = "iVBORw0KGgo=";

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected rejection");
}

describe("statusToCode", () => {
  it("maps HTTP failures", () => {
    expect(statusToCode(401, "")).toBe("unauthorized");
    expect(statusToCode(429, "")).toBe("rate_limited");
    expect(statusToCode(503, "")).toBe("server");
    expect(statusToCode(400, "Your request was rejected by the safety system")).toBe("content_policy");
    expect(statusToCode(400, "bad size")).toBe("bad_request");
  });
});

describe("OpenAI Images", () => {
  it("builds bodies per model with the nearest supported size", () => {
    const gen = new OpenAIImageGenerator(config("openai", "https://api.openai.com/v1"), http(() => json({})).client);
    expect(gen.body(params({ count: 3 }))).toEqual({ model: "gpt-image-1", prompt: "a red fox", n: 3, size: "1536x1024" });
    expect(gen.body(params({ model: "dall-e-3", count: 4, width: 768, height: 1344 }))).toEqual({ model: "dall-e-3", prompt: "a red fox", n: 1, size: "1024x1792", response_format: "b64_json" });
  });

  it("decodes base64 images, keeps the revised prompt and sends the key", async () => {
    const fake = http(() => json({ data: [{ b64_json: B64_PNG, revised_prompt: "A red fox in snow" }] }));
    const gen = new OpenAIImageGenerator(config("openai", "https://api.openai.com/v1"), fake.client);
    const result = await gen.generate(params());
    expect(fake.calls[0]!.url).toBe("https://api.openai.com/v1/images/generations");
    expect((fake.calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-secret-999");
    expect(result.revisedPrompt).toBe("A red fox in snow");
    expect(result.images[0]!.mimeType).toBe("image/png");
    expect(result.images[0]!.blob.size).toBe(8);
  });

  it("downloads URL results", async () => {
    const fake = http((url) => (url.startsWith("https://cdn") ? new Response(new Blob(["img"], { type: "image/webp" })) : json({ data: [{ url: "https://cdn.test/a.webp" }] })));
    const result = await new OpenAIImageGenerator(config("openai", "https://api.openai.com/v1"), fake.client).generate(params());
    expect(result.images[0]!.mimeType).toBe("image/webp");
  });

  it("maps errors and redacts the key", async () => {
    const fake = http(() => json({ error: { message: "Incorrect API key sk-test-secret-999" } }, 401));
    const error = (await caught(new OpenAIImageGenerator(config("openai", "https://api.openai.com/v1"), fake.client).generate(params()))) as ImageGenError;
    expect(error.code).toBe("unauthorized");
    expect(error.message).not.toContain("sk-test-secret-999");
  });
});

describe("Gemini / Imagen", () => {
  const base = "https://generativelanguage.googleapis.com/v1beta";

  it("builds Imagen :predict bodies", () => {
    const gen = new GeminiImageGenerator(config("gemini", base), http(() => json({})).client);
    expect(gen.imagenBody(params({ count: 6, negativePrompt: "text", seed: 5 }))).toEqual({
      instances: [{ prompt: "a red fox" }],
      parameters: { sampleCount: 4, aspectRatio: "16:9", negativePrompt: "text", seed: 5, addWatermark: false },
    });
  });

  it("calls Imagen with the x-goog-api-key header", async () => {
    const fake = http(() => json({ predictions: [{ bytesBase64Encoded: B64_PNG, mimeType: "image/png" }] }));
    const result = await new GeminiImageGenerator(config("gemini", base), fake.client).generate(params({ model: "imagen-4.0-generate-001" }));
    expect(fake.calls[0]!.url).toBe(`${base}/models/imagen-4.0-generate-001:predict`);
    expect((fake.calls[0]!.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("sk-test-secret-999");
    expect(result.images).toHaveLength(1);
  });

  it("uses generateContent with IMAGE modality for Gemini image models", async () => {
    const fake = http(() => json({ candidates: [{ content: { parts: [{ text: "Here" }, { inlineData: { mimeType: "image/png", data: B64_PNG } }] } }] }));
    const result = await new GeminiImageGenerator(config("gemini", base), fake.client).generate(params({ model: "gemini-2.5-flash-image", negativePrompt: "people" }));
    const body = JSON.parse(fake.calls[0]!.init.body as string);
    expect(fake.calls[0]!.url).toBe(`${base}/models/gemini-2.5-flash-image:generateContent`);
    expect(body.generationConfig).toEqual({ responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: "16:9" } });
    expect(body.contents[0].parts[0].text).toContain("Avoid: people");
    expect(result.images).toHaveLength(1);
  });

  it("treats empty results as filtered content", async () => {
    const fake = http(() => json({ predictions: [] }));
    const error = (await caught(new GeminiImageGenerator(config("gemini", base), fake.client).generate(params({ model: "imagen-4.0-fast-generate-001" })))) as ImageGenError;
    expect(error.code).toBe("content_policy");
  });
});

describe("OpenRouter", () => {
  it("requests image modality and decodes data URLs", async () => {
    const fake = http(() => json({ choices: [{ message: { content: "", images: [{ image_url: { url: `data:image/png;base64,${B64_PNG}` } }] } }] }));
    const result = await new OpenRouterImageGenerator(config("openrouter", "https://openrouter.ai/api/v1"), fake.client).generate(params({ seed: 3 }));
    const body = JSON.parse(fake.calls[0]!.init.body as string);
    expect(body).toMatchObject({ model: "google/gemini-2.5-flash-image", modalities: ["image", "text"], image_config: { aspect_ratio: "16:9" }, seed: 3 });
    expect(result.images[0]).toMatchObject({ mimeType: "image/png", seed: 3 });
  });

  it("explains when the model returns only text", async () => {
    const fake = http(() => json({ choices: [{ message: { content: "I can't draw that" } }] }));
    const error = (await caught(new OpenRouterImageGenerator(config("openrouter", "https://openrouter.ai/api/v1"), fake.client).generate(params()))) as ImageGenError;
    expect(error.code).toBe("invalid_response");
    expect(error.message).toBe("I can't draw that");
  });
});
