// @vitest-environment node
import { describe, expect, it } from "vitest";
import catalogJson from "@/lib/ai/catalog/models.json";
import { MODEL_CATALOG, catalogFor, catalogSchema, enrichRemoteModel, findCatalogEntry, guessCapabilities } from "@/lib/ai/catalog/catalog";
import { PROVIDER_KINDS, PROVIDER_PRESETS } from "@/lib/ai/presets";

describe("model catalog", () => {
  it("is valid against the schema and has the required fields", () => {
    expect(catalogSchema.safeParse(catalogJson).success).toBe(true);
    for (const entry of MODEL_CATALOG) {
      expect(Object.keys(entry).sort()).toEqual(
        ["provider", "name", "modelId", "baseUrl", "contextWindow", "vision", "audio", "video", "tools", "reasoning", "inputCost", "outputCost"].sort(),
      );
    }
  });

  it("has unique model ids per provider", () => {
    const keys = MODEL_CATALOG.map((e) => `${e.provider}:${e.modelId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers every built-in provider except custom, using the preset base URL", () => {
    for (const kind of PROVIDER_KINDS.filter((k) => k !== "custom")) {
      const entries = catalogFor(kind);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) expect(entry.baseUrl).toBe(PROVIDER_PRESETS[kind].baseUrl);
    }
  });

  it("matches tagged, dated and prefixed ids", () => {
    expect(findCatalogEntry("ollama", "llama3.2:3b")?.modelId).toBe("llama3.2");
    expect(findCatalogEntry("openai", "gpt-4o-2024-08-06")?.modelId).toBe("gpt-4o");
    expect(findCatalogEntry("gemini", "models/gemini-2.5-pro")?.modelId).toBe("gemini-2.5-pro");
  });

  it("enriches remote models with catalog data, remote limits win", () => {
    const model = enrichRemoteModel("openai", { id: "gpt-4o", contextWindow: 64000 });
    expect(model).toMatchObject({ name: "GPT-4o", contextWindow: 64000, inputCost: 2.5, source: "remote", capabilities: { vision: true } });
  });

  it("guesses capabilities conservatively for unknown models", () => {
    expect(guessCapabilities("my-company/custom-llm")).toMatchObject({ vision: false, reasoning: false, tools: true });
    expect(guessCapabilities("qwen2.5-vl-7b")).toMatchObject({ vision: true });
    expect(guessCapabilities("deepseek-r1-distill")).toMatchObject({ reasoning: true });
    expect(guessCapabilities("text-embedding-3-large").tools).toBe(false);
  });
});
