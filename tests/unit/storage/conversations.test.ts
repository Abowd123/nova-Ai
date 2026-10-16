import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "@tests/helpers/storage";
import { StorageError } from "@/lib/storage/errors";

describe("ConversationRepository", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });
  afterEach(async () => {
    await ctx.destroy();
  });

  it("creates a conversation with defaults and reads it back", async () => {
    const created = await ctx.repos.conversations.create({ title: "Hello" });
    expect(created).toMatchObject({
      title: "Hello",
      assistantId: null,
      pinned: false,
      archived: false,
      tagIds: [],
      messageCount: 0,
      lastMessageAt: null,
    });
    expect(await ctx.repos.conversations.get(created.id)).toEqual(created);
  });

  it("uses a default title", async () => {
    const created = await ctx.repos.conversations.create();
    expect(created.title).toBe("New conversation");
  });

  it("returns undefined for a missing id", async () => {
    expect(await ctx.repos.conversations.get("missing")).toBeUndefined();
  });

  it("lists pinned first, then most recently updated", async () => {
    const a = await ctx.repos.conversations.create({ title: "A" });
    await ctx.repos.conversations.create({ title: "B" });
    const c = await ctx.repos.conversations.create({ title: "C" });
    await ctx.repos.conversations.update(a.id, { pinned: true });
    await ctx.repos.conversations.update(c.id, { title: "C2" });
    const titles = (await ctx.repos.conversations.list()).map((x) => x.title);
    expect(titles).toEqual(["A", "C2", "B"]);
  });

  it("searches titles with Arabic normalization", async () => {
    await ctx.repos.conversations.create({ title: "مُحادثة عن الأَمن" });
    await ctx.repos.conversations.create({ title: "Weekend PLAN" });
    expect((await ctx.repos.conversations.list({ query: "امن" })).map((x) => x.title)).toEqual([
      "مُحادثة عن الأَمن",
    ]);
    expect(await ctx.repos.conversations.list({ query: "plan" })).toHaveLength(1);
  });

  it("search also matches message content", async () => {
    const target = await ctx.repos.conversations.create({ title: "Untitled" });
    await ctx.repos.conversations.create({ title: "Other" });
    await ctx.repos.messages.create({ conversationId: target.id, role: "assistant", content: "Use Array.prototype.toSorted() للترتيب" });
    expect((await ctx.repos.conversations.list({ query: "tosorted" })).map((c) => c.id)).toEqual([target.id]);
    expect((await ctx.repos.conversations.list({ query: "الترتيب" })).map((c) => c.id)).toEqual([target.id]);
  });

  it("tracks title source and model selection", async () => {
    const auto = await ctx.repos.conversations.create();
    expect(auto).toMatchObject({ titleSource: "default", providerId: null, modelId: null });
    const named = await ctx.repos.conversations.create({ title: "Named" });
    expect(named.titleSource).toBe("manual");
    const updated = await ctx.repos.conversations.update(auto.id, { providerId: "p", modelId: "m", titleSource: "auto" });
    expect(updated).toMatchObject({ providerId: "p", modelId: "m", titleSource: "auto" });
  });

  it("hides archived conversations unless requested", async () => {
    const a = await ctx.repos.conversations.create({ title: "Archived" });
    await ctx.repos.conversations.update(a.id, { archived: true });
    expect(await ctx.repos.conversations.list()).toHaveLength(0);
    expect(await ctx.repos.conversations.list({ includeArchived: true })).toHaveLength(1);
  });

  it("respects limit", async () => {
    for (const title of ["1", "2", "3"]) await ctx.repos.conversations.create({ title });
    expect(await ctx.repos.conversations.list({ limit: 2 })).toHaveLength(2);
  });

  it("updates and bumps updatedAt", async () => {
    const created = await ctx.repos.conversations.create({ title: "Old" });
    const updated = await ctx.repos.conversations.update(created.id, { title: "New" });
    expect(updated.title).toBe("New");
    expect(updated.updatedAt).toBeGreaterThan(created.updatedAt);
    expect(updated.createdAt).toBe(created.createdAt);
  });

  it("throws NOT_FOUND when updating a missing conversation", async () => {
    const promise = ctx.repos.conversations.update("missing", { title: "x" });
    await expect(promise).rejects.toBeInstanceOf(StorageError);
    await expect(ctx.repos.conversations.update("missing", { title: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("deletes a conversation and cascades messages and attachments", async () => {
    const conversation = await ctx.repos.conversations.create({ title: "Bye" });
    const message = await ctx.repos.messages.create({
      conversationId: conversation.id,
      role: "user",
      content: "hi",
    });
    await ctx.repos.attachments.create({
      conversationId: conversation.id,
      messageId: message.id,
      kind: "image",
      name: "a.png",
      mimeType: "image/png",
      size: 4,
    }, new Blob(["\x89PNG"]));
    await ctx.repos.conversations.delete(conversation.id);
    expect(await ctx.repos.conversations.get(conversation.id)).toBeUndefined();
    expect(await ctx.repos.messages.listByConversation(conversation.id)).toEqual([]);
    expect(await ctx.repos.attachments.listByConversation(conversation.id)).toEqual([]);
    expect(await ctx.db.attachmentBlobs.count()).toBe(0);
  });

  it("delete is idempotent", async () => {
    await expect(ctx.repos.conversations.delete("missing")).resolves.toBeUndefined();
  });
});
