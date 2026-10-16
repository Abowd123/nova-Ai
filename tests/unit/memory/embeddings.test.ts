import { describe, expect, it } from "vitest";
import { createEmbeddingProvider, embeddingModelKey, GeminiEmbeddings, OpenAICompatibleEmbeddings, supportsEmbeddings } from "@/lib/ai/embeddings";
import type { ProviderConfig } from "@/lib/ai/types";
import { recordingHttp } from "@tests/helpers/streams";

const config = (kind: ProviderConfig["kind"], baseUrl: string): ProviderConfig => ({ id: "p1", kind, name: kind, baseUrl, apiKey: "sk-embed-secret-42", transport: "direct" });

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected rejection");
}

describe("embeddings", () => {
  it("OpenAI-compatible: body, order by index, usage", async () => {
    const { http, requests } = recordingHttp([() => Response.json({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }], usage: { prompt_tokens: 7 } })]);
    const provider = new OpenAICompatibleEmbeddings(config("openai", "https://api.openai.com/v1"), http, "text-embedding-3-small", 256);
    const result = await provider.embed(["a", "b"]);
    expect(requests[0]!.url).toBe("https://api.openai.com/v1/embeddings");
    expect(requests[0]!.body).toEqual({ model: "text-embedding-3-small", input: ["a", "b"], encoding_format: "float", dimensions: 256 });
    expect(requests[0]!.headers.authorization).toBe("Bearer sk-embed-secret-42");
    expect(result.vectors.map((x) => Array.from(x))).toEqual([[1, 0], [0, 1]]);
    expect(result).toMatchObject({ dims: 2, tokens: 7 });
  });

  it("Gemini: batchEmbedContents with task types", async () => {
    const { http, requests } = recordingHttp([() => Response.json({ embeddings: [{ values: [0.1, 0.2, 0.3] }] })]);
    const provider = new GeminiEmbeddings(config("gemini", "https://generativelanguage.googleapis.com/v1beta"), http, "gemini-embedding-001", 768);
    const result = await provider.embed(["سؤال"], { task: "query" });
    expect(requests[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents");
    expect(requests[0]!.headers["x-goog-api-key"]).toBe("sk-embed-secret-42");
    expect(requests[0]!.body).toEqual({ requests: [{ model: "models/gemini-embedding-001", content: { parts: [{ text: "سؤال" }] }, taskType: "RETRIEVAL_QUERY", outputDimensionality: 768 }] });
    expect(result.dims).toBe(3);
  });

  it("rejects malformed responses", async () => {
    const wrongCount = recordingHttp([() => Response.json({ data: [{ index: 0, embedding: [1] }] })]);
    const p1 = new OpenAICompatibleEmbeddings(config("custom", "http://x/v1"), wrongCount.http, "m");
    expect(await caught(p1.embed(["a", "b"]))).toMatchObject({ code: "invalid_response" });
    const mixed = recordingHttp([() => Response.json({ data: [{ index: 0, embedding: [1] }, { index: 1, embedding: [1, 2] }] })]);
    const p2 = new OpenAICompatibleEmbeddings(config("custom", "http://x/v1"), mixed.http, "m");
    expect(await caught(p2.embed(["a", "b"]))).toMatchObject({ code: "invalid_response" });
  });

  it("factory, keys and support", async () => {
    const { http } = recordingHttp([() => Response.json({ embeddings: [[1, 2]] })]);
    const ollama = createEmbeddingProvider({ ...config("ollama", "http://localhost:11434"), apiKey: undefined }, http, "nomic-embed-text", null);
    expect((await ollama.embed(["x"])).dims).toBe(2);
    expect(supportsEmbeddings("anthropic")).toBe(false);
    expect(() => createEmbeddingProvider(config("anthropic", "https://api.anthropic.com/v1"), http, "m", null)).toThrow();
    expect(embeddingModelKey("p1", "m", null)).toBe("p1:m:default");
    expect(embeddingModelKey("p1", "m", 256)).not.toBe(embeddingModelKey("p1", "m", 512));
    expect(await new OpenAICompatibleEmbeddings(config("openai", "http://x"), http, "m").embed([])).toEqual({ vectors: [], dims: 0, tokens: 0 });
  });
});
