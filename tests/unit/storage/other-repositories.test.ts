import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "@tests/helpers/storage";
import { APP_SETTINGS_KEY, DEFAULT_SETTINGS } from "@/lib/models";

describe("SettingsRepository", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });
  afterEach(async () => {
    await ctx.destroy();
  });

  it("returns defaults when nothing is stored", async () => {
    expect(await ctx.repos.settings.get()).toEqual(DEFAULT_SETTINGS);
  });

  it("persists partial updates", async () => {
    await ctx.repos.settings.update({ theme: "dark" });
    await ctx.repos.settings.update({ userName: "  Aboof  " });
    expect(await ctx.repos.settings.get()).toEqual({
      ...DEFAULT_SETTINGS,
      theme: "dark",
      userName: "Aboof",
    });
  });

  it("recovers field-by-field from corrupted stored values", async () => {
    await ctx.db.settings.put({
      key: APP_SETTINGS_KEY,
      value: { theme: "purple", locale: "en", userName: 42 },
      updatedAt: 1,
    });
    expect(await ctx.repos.settings.get()).toEqual({ ...DEFAULT_SETTINGS, locale: "en" });
  });

  it("resets to defaults", async () => {
    await ctx.repos.settings.update({ theme: "light" });
    expect(await ctx.repos.settings.reset()).toEqual(DEFAULT_SETTINGS);
    expect(await ctx.repos.settings.get()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("TagRepository", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });
  afterEach(async () => {
    await ctx.destroy();
  });

  it("creates ordered tags and reorders them", async () => {
    const a = await ctx.repos.tags.create({ name: "A" });
    const b = await ctx.repos.tags.create({ name: "B", color: "#FF0000" });
    expect([a.order, b.order]).toEqual([0, 1]);
    await ctx.repos.tags.reorder([b.id, a.id]);
    expect((await ctx.repos.tags.list()).map((t) => t.name)).toEqual(["B", "A"]);
  });

  it("removes deleted tag ids from conversations and assistants", async () => {
    const tag = await ctx.repos.tags.create({ name: "Work" });
    const conversation = await ctx.repos.conversations.create({ title: "c", tagIds: [tag.id] });
    const assistant = await ctx.repos.assistants.create({ name: "a", tagIds: [tag.id] });
    await ctx.repos.tags.delete(tag.id);
    expect((await ctx.repos.conversations.get(conversation.id))?.tagIds).toEqual([]);
    expect((await ctx.repos.assistants.get(assistant.id))?.tagIds).toEqual([]);
  });
});

describe("ProviderRepository", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });
  afterEach(async () => {
    await ctx.destroy();
  });

  it("supports CRUD", async () => {
    const provider = await ctx.repos.providers.create({
      name: "Local Ollama",
      kind: "ollama",
      baseUrl: "http://localhost:11434",
    });
    expect(provider).toMatchObject({
      enabled: true,
      transport: "direct",
      encryptedApiKey: null,
      encryptedHeaders: null,
      models: [],
      defaultModelId: null,
    });
    const updated = await ctx.repos.providers.update(provider.id, { enabled: false });
    expect(updated.enabled).toBe(false);
    await ctx.repos.providers.delete(provider.id);
    expect(await ctx.repos.providers.list()).toEqual([]);
  });

  it("unlinks assistants from a deleted provider", async () => {
    const provider = await ctx.repos.providers.create({
      name: "OpenAI",
      kind: "openai",
      baseUrl: "https://api.openai.com/v1",
    });
    const assistant = await ctx.repos.assistants.create({
      name: "a",
      defaultProviderId: provider.id,
      defaultModelId: "gpt",
    });
    const conversation = await ctx.repos.conversations.create({ title: "c", providerId: provider.id, modelId: "gpt" });
    await ctx.repos.settings.update({ defaultProviderId: provider.id, defaultModelId: "gpt" });
    await ctx.repos.providers.delete(provider.id);
    expect(await ctx.repos.assistants.get(assistant.id)).toMatchObject({
      defaultProviderId: null,
      defaultModelId: null,
    });
    expect(await ctx.repos.conversations.get(conversation.id)).toMatchObject({ providerId: null, modelId: null });
    expect(await ctx.repos.settings.get()).toMatchObject({ defaultProviderId: null, defaultModelId: null });
  });
});

describe("AttachmentRepository + clearAll", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });
  afterEach(async () => {
    await ctx.destroy();
  });

  it("stores attachment metadata", async () => {
    const attachment = await ctx.repos.attachments.create({
      kind: "file",
      name: "notes.pdf",
      mimeType: "application/pdf",
      size: 4,
      messageId: "m-1",
    }, new Blob(["%PDF"], { type: "application/pdf" }));
    expect(attachment).toMatchObject({ storage: "idb", remoteRefs: {}, metadata: {} });
    expect(await ctx.repos.attachments.listByMessage("m-1")).toEqual([attachment]);
    expect(await ctx.repos.blobs.get(attachment.id)).toBeInstanceOf(Blob);
    await ctx.repos.attachments.delete(attachment.id);
    expect(await ctx.repos.attachments.get(attachment.id)).toBeUndefined();
    expect(await ctx.repos.blobs.get(attachment.id)).toBeUndefined();
  });

  it("requires the binary for IndexedDB attachments and a matching size", async () => {
    await expect(ctx.repos.attachments.create({ kind: "file", name: "a.txt", mimeType: "text/plain", size: 3 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(ctx.repos.attachments.create({ kind: "file", name: "a.txt", mimeType: "text/plain", size: 9 }, new Blob(["abc"]))).rejects.toMatchObject({ code: "VALIDATION" });
    const opfs = await ctx.repos.attachments.create({ kind: "video", name: "v.mp4", mimeType: "video/mp4", size: 100, storage: "opfs" });
    expect(opfs.storage).toBe("opfs");
  });

  it("links drafts with their derived frames and cascades frame deletion", async () => {
    const video = await ctx.repos.attachments.create({ kind: "video", name: "v.mp4", mimeType: "video/mp4", size: 100, storage: "opfs" });
    const frame = await ctx.repos.attachments.create({ kind: "image", name: "f1.jpg", mimeType: "image/jpeg", size: 2, derivedFrom: video.id }, new Blob(["ab"]));
    expect((await ctx.repos.attachments.listUnlinked()).map((a) => a.id).sort()).toEqual([video.id, frame.id].sort());
    await ctx.repos.attachments.link([video.id], { conversationId: "c-1", messageId: "m-9" });
    expect((await ctx.repos.attachments.getMany([video.id, frame.id])).map((a) => a.messageId)).toEqual(["m-9", "m-9"]);
    expect(await ctx.repos.attachments.listUnlinked()).toEqual([]);
    await ctx.repos.attachments.delete(video.id);
    expect(await ctx.repos.attachments.get(frame.id)).toBeUndefined();
    expect(await ctx.repos.blobs.get(frame.id)).toBeUndefined();
  });

  it("stores encrypted service secrets", async () => {
    const secret = { algorithm: "AES-GCM" as const, keyId: "k1", iv: "aXY=", ciphertext: "ZGF0YQ==" };
    expect(await ctx.repos.secrets.has("service:elevenlabs")).toBe(false);
    await ctx.repos.secrets.set("service:elevenlabs", secret);
    expect(await ctx.repos.secrets.get("service:elevenlabs")).toEqual(secret);
    expect(await ctx.repos.secrets.has("service:elevenlabs")).toBe(true);
    await ctx.repos.secrets.delete("service:elevenlabs");
    expect(await ctx.repos.secrets.get("service:elevenlabs")).toBeUndefined();
  });

  it("clearAll wipes every table", async () => {
    const conversation = await ctx.repos.conversations.create({ title: "x" });
    await ctx.repos.messages.create({ conversationId: conversation.id, role: "user", content: "y" });
    await ctx.repos.assistants.create({ name: "z" });
    await ctx.repos.settings.update({ theme: "dark" });
    await ctx.repos.clearAll();
    expect(await ctx.repos.conversations.list()).toEqual([]);
    expect(await ctx.repos.assistants.list()).toEqual([]);
    expect(await ctx.repos.settings.get()).toEqual(DEFAULT_SETTINGS);
  });
});
