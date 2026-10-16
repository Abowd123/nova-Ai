// @vitest-environment node
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordingHttp } from "@tests/helpers/streams";
import { createTestContext, type TestContext } from "@tests/helpers/storage";
import { ProviderService } from "@/features/providers/provider-service";
import { MemoryKeyStore, SecretVault } from "@/lib/crypto/vault";
import type { HttpClient } from "@/lib/ai/types";

describe("ProviderService", () => {
  let ctx: TestContext;
  let service: ProviderService;
  let http: HttpClient;
  let requests: ReturnType<typeof recordingHttp>["requests"];

  beforeEach(async () => {
    ctx = await createTestContext();
    const vault = new SecretVault(new MemoryKeyStore(), webcrypto.subtle as unknown as SubtleCrypto, (b) => webcrypto.getRandomValues(b));
    const recorder = recordingHttp([() => Response.json({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }, { id: "brand-new-model" }] })]);
    http = recorder.http;
    requests = recorder.requests;
    service = new ProviderService(ctx.repos, vault, () => http);
  });

  afterEach(async () => {
    await ctx.destroy();
  });

  it("stores the API key and headers encrypted only", async () => {
    const provider = await service.save({
      name: "OpenAI",
      kind: "openai",
      baseUrl: "https://api.openai.com/v1/",
      transport: "direct",
      apiKey: "sk-live-very-secret-123",
      headers: [{ name: "OpenAI-Organization", value: "org-abc" }],
    });
    expect(provider.baseUrl).toBe("https://api.openai.com/v1");
    expect(provider.encryptedApiKey?.algorithm).toBe("AES-GCM");
    const raw = JSON.stringify(await ctx.db.providers.toArray());
    expect(raw).not.toContain("sk-live-very-secret-123");
    expect(raw).not.toContain("org-abc");

    const config = await service.getConfig(provider.id);
    expect(config.apiKey).toBe("sk-live-very-secret-123");
    expect(config.headers).toEqual({ "OpenAI-Organization": "org-abc" });
    expect(await service.headerNames(provider.id)).toEqual(["OpenAI-Organization"]);
  });

  it("seeds catalog models and a default model for known providers", async () => {
    const provider = await service.save({ name: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", transport: "direct" });
    expect(provider.models.length).toBeGreaterThan(0);
    expect(provider.models.every((m) => m.enabled && m.source === "catalog")).toBe(true);
    expect(provider.defaultModelId).toBe(provider.models[0]?.id);
  });

  it("keeps, replaces or removes the key on edit", async () => {
    const created = await service.save({ name: "A", kind: "custom", baseUrl: "https://a.test/v1", transport: "direct", apiKey: "first-key-123" });
    await service.save({ name: "A2", kind: "custom", baseUrl: "https://a.test/v1", transport: "proxy" }, created.id);
    expect((await service.getConfig(created.id)).apiKey).toBe("first-key-123");
    await service.save({ name: "A2", kind: "custom", baseUrl: "https://a.test/v1", transport: "proxy", apiKey: "second-key-456" }, created.id);
    expect((await service.getConfig(created.id)).apiKey).toBe("second-key-456");
    await service.save({ name: "A2", kind: "custom", baseUrl: "https://a.test/v1", transport: "proxy", apiKey: null }, created.id);
    expect((await service.getConfig(created.id)).apiKey).toBeUndefined();
    expect((await ctx.repos.providers.get(created.id))?.transport).toBe("proxy");
  });

  it("keeps stored header values when the field is left empty (null)", async () => {
    const created = await service.save({
      name: "A",
      kind: "custom",
      baseUrl: "https://a.test/v1",
      transport: "direct",
      headers: [{ name: "X-Token", value: "t-1" }],
    });
    await service.save(
      { name: "A", kind: "custom", baseUrl: "https://a.test/v1", transport: "direct", headers: [{ name: "X-Token", value: null }, { name: "X-New", value: "n" }] },
      created.id,
    );
    expect((await service.getConfig(created.id)).headers).toEqual({ "X-Token": "t-1", "X-New": "n" });
  });

  it("rejects forbidden header names", async () => {
    await expect(
      service.save({ name: "A", kind: "custom", baseUrl: "https://a.test/v1", transport: "direct", headers: [{ name: "Cookie", value: "x" }] }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("tests the connection and fetches models (merging with the catalog)", async () => {
    const provider = await service.save({ name: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", transport: "direct", apiKey: "sk-k-123456" });
    const result = await service.test(provider.id);
    expect(result).toMatchObject({ ok: true, modelCount: 3 });
    expect(requests[0]?.headers.authorization).toBe("Bearer sk-k-123456");

    const updated = await service.fetchModels(provider.id);
    expect(updated.models.map((m) => m.id)).toEqual(["brand-new-model", "gpt-4o", "gpt-4o-mini"]);
    expect(updated.models.find((m) => m.id === "gpt-4o")).toMatchObject({ name: "GPT-4o", capabilities: { vision: true } });
  });

  it("toggles models, keeps a valid default and supports manual models", async () => {
    const provider = await service.save({ name: "C", kind: "custom", baseUrl: "https://c.test/v1", transport: "direct" });
    let next = await service.addManualModel(provider.id, "my-model");
    expect(next.defaultModelId).toBe("my-model");
    next = await service.addManualModel(provider.id, "second");
    next = await service.setDefaultModel(provider.id, "second");
    expect(next.defaultModelId).toBe("second");
    next = await service.setModelEnabled(provider.id, "second", false);
    expect(next.defaultModelId).toBe("my-model");
    next = await service.setAllModelsEnabled(provider.id, false);
    expect(next.models.every((m) => !m.enabled)).toBe(true);
    expect(next.defaultModelId).toBeNull();
    await expect(service.addManualModel(provider.id, "  ")).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
