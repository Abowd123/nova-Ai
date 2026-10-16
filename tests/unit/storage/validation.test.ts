import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestContext, type TestContext } from "@tests/helpers/storage";

describe("invalid data handling", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });
  afterEach(async () => {
    await ctx.destroy();
  });

  const validation = { code: "VALIDATION" };

  it("rejects blank or too-long conversation titles", async () => {
    await expect(ctx.repos.conversations.create({ title: "   " })).rejects.toMatchObject(validation);
    await expect(ctx.repos.conversations.create({ title: "x".repeat(201) })).rejects.toMatchObject(
      validation,
    );
  });

  it("rejects unknown keys in patches (strict schemas)", async () => {
    const conversation = await ctx.repos.conversations.create({ title: "ok" });
    await expect(
      ctx.repos.conversations.update(conversation.id, { id: "hijack" } as never),
    ).rejects.toMatchObject(validation);
    await expect(
      ctx.repos.conversations.update(conversation.id, { messageCount: 999 } as never),
    ).rejects.toMatchObject(validation);
  });

  it("rejects invalid message roles", async () => {
    const conversation = await ctx.repos.conversations.create({ title: "ok" });
    await expect(
      ctx.repos.messages.create({ conversationId: conversation.id, role: "hacker", content: "x" } as never),
    ).rejects.toMatchObject(validation);
  });

  it("rejects out-of-range assistant settings", async () => {
    await expect(ctx.repos.assistants.create({ name: "a", temperature: 3 })).rejects.toMatchObject(
      validation,
    );
    await expect(ctx.repos.assistants.create({ name: "" })).rejects.toMatchObject(validation);
    await expect(ctx.repos.assistants.create({ name: "a", topP: 1.5 })).rejects.toMatchObject(validation);
    await expect(ctx.repos.assistants.create({ name: "a", starters: Array.from({ length: 9 }, (_, i) => `s${i}`) })).rejects.toMatchObject(validation);
    await expect(ctx.repos.assistants.create({ name: "a", avatar: "data:image/svg+xml;base64,PHN2Zy8+" })).rejects.toMatchObject(validation);
    await expect(ctx.repos.assistants.create({ name: "a", memoryScope: "everything" } as never)).rejects.toMatchObject(validation);
  });

  it("rejects invalid tag colors and provider URLs", async () => {
    await expect(ctx.repos.tags.create({ name: "t", color: "red" })).rejects.toMatchObject(validation);
    await expect(
      ctx.repos.providers.create({ name: "p", kind: "openai", baseUrl: "not a url" }),
    ).rejects.toMatchObject(validation);
  });

  it("refuses plaintext API keys on providers (security)", async () => {
    await expect(
      ctx.repos.providers.create({
        name: "p",
        kind: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-plaintext",
      } as never),
    ).rejects.toMatchObject(validation);
    await expect(
      ctx.repos.providers.create({
        name: "p",
        kind: "openai",
        baseUrl: "https://api.openai.com/v1",
        headers: { Authorization: "Bearer plaintext" },
      } as never),
    ).rejects.toMatchObject(validation);
    expect(await ctx.repos.providers.list()).toEqual([]);
  });

  it("rejects malformed message parts and usage", async () => {
    const conversation = await ctx.repos.conversations.create({ title: "ok" });
    await expect(
      ctx.repos.messages.create({ conversationId: conversation.id, role: "user", parts: [{ type: "html", html: "<script>" }] } as never),
    ).rejects.toMatchObject(validation);
    const message = await ctx.repos.messages.create({ conversationId: conversation.id, role: "assistant", content: "" });
    await expect(
      ctx.repos.messages.update(message.id, { usage: { inputTokens: -1, outputTokens: 0, cachedTokens: 0, totalTokens: 0 } }),
    ).rejects.toMatchObject(validation);
  });

  it("rejects invalid attachment MIME types", async () => {
    await expect(
      ctx.repos.attachments.create({ kind: "file", name: "x", mimeType: "nope", size: 1 }),
    ).rejects.toMatchObject(validation);
  });

  it("rejects invalid settings values", async () => {
    await expect(ctx.repos.settings.update({ theme: "neon" } as never)).rejects.toMatchObject(validation);
  });

  it("skips corrupted rows when listing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await ctx.repos.conversations.create({ title: "good" });
    await ctx.db.table("conversations").put({ id: "bad", updatedAt: 5, title: 123 });
    const list = await ctx.repos.conversations.list();
    expect(list.map((c) => c.title)).toEqual(["good"]);
    expect(warn).toHaveBeenCalled();
  });

  it("throws VALIDATION when reading a single corrupted row", async () => {
    await ctx.db.table("conversations").put({ id: "bad", updatedAt: 5 });
    await expect(ctx.repos.conversations.get("bad")).rejects.toMatchObject(validation);
  });

  it("maps duplicate ids to CONSTRAINT", async () => {
    const fixed = await createTestContext({ idGenerator: () => "same-id" });
    await fixed.repos.conversations.create({ title: "1" });
    await expect(fixed.repos.conversations.create({ title: "2" })).rejects.toMatchObject({
      code: "CONSTRAINT",
    });
    await fixed.destroy();
  });
});
