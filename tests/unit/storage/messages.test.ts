import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "@tests/helpers/storage";

describe("MessageRepository", () => {
  let ctx: TestContext;
  let conversationId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    conversationId = (await ctx.repos.conversations.create({ title: "Chat" })).id;
  });
  afterEach(async () => {
    await ctx.destroy();
  });

  it("creates messages in order and updates conversation stats", async () => {
    const first = await ctx.repos.messages.create({ conversationId, role: "user", content: "one" });
    const second = await ctx.repos.messages.create({
      conversationId,
      role: "assistant",
      content: "two",
    });
    const list = await ctx.repos.messages.listByConversation(conversationId);
    expect(list.map((m) => m.content)).toEqual(["one", "two"]);
    expect(first.status).toBe("complete");
    const conversation = await ctx.repos.conversations.get(conversationId);
    expect(conversation?.messageCount).toBe(2);
    expect(conversation?.lastMessageAt).toBe(second.createdAt);
  });

  it("rejects messages for a missing conversation", async () => {
    await expect(
      ctx.repos.messages.create({ conversationId: "missing", role: "user", content: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("updates content and status (streaming -> complete)", async () => {
    const message = await ctx.repos.messages.create({
      conversationId,
      role: "assistant",
      content: "",
      status: "streaming",
    });
    const updated = await ctx.repos.messages.update(message.id, { content: "done", status: "complete" });
    expect(updated).toMatchObject({ content: "done", status: "complete" });
    expect(await ctx.repos.messages.get(message.id)).toEqual(updated);
  });

  it("deletes a message and recomputes stats", async () => {
    const first = await ctx.repos.messages.create({ conversationId, role: "user", content: "one" });
    const second = await ctx.repos.messages.create({ conversationId, role: "user", content: "two" });
    await ctx.repos.messages.delete(second.id);
    const conversation = await ctx.repos.conversations.get(conversationId);
    expect(conversation?.messageCount).toBe(1);
    expect(conversation?.lastMessageAt).toBe(first.createdAt);
    await ctx.repos.messages.delete(first.id);
    expect((await ctx.repos.conversations.get(conversationId))?.lastMessageAt).toBeNull();
  });

  it("deleteByConversation clears all messages", async () => {
    await ctx.repos.messages.create({ conversationId, role: "user", content: "a" });
    await ctx.repos.messages.create({ conversationId, role: "user", content: "b" });
    await ctx.repos.messages.deleteByConversation(conversationId);
    expect(await ctx.repos.messages.listByConversation(conversationId)).toEqual([]);
    expect((await ctx.repos.conversations.get(conversationId))?.messageCount).toBe(0);
  });

  it("isolates messages per conversation", async () => {
    const other = await ctx.repos.conversations.create({ title: "Other" });
    await ctx.repos.messages.create({ conversationId, role: "user", content: "mine" });
    await ctx.repos.messages.create({ conversationId: other.id, role: "user", content: "theirs" });
    expect((await ctx.repos.messages.listByConversation(conversationId)).map((m) => m.content)).toEqual([
      "mine",
    ]);
  });

  it("derives parts from content and content from parts", async () => {
    const fromContent = await ctx.repos.messages.create({ conversationId, role: "user", content: "hi" });
    expect(fromContent.parts).toEqual([{ type: "text", text: "hi" }]);
    const fromParts = await ctx.repos.messages.create({
      conversationId,
      role: "assistant",
      parts: [
        { type: "reasoning", text: "think" },
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ],
    });
    expect(fromParts.content).toBe("Hello world");
    const updated = await ctx.repos.messages.update(fromParts.id, { parts: [{ type: "text", text: "changed" }] });
    expect(updated.content).toBe("changed");
    const edited = await ctx.repos.messages.update(fromContent.id, { content: "edited" });
    expect(edited.parts).toEqual([{ type: "text", text: "edited" }]);
  });

  it("keeps strictly increasing createdAt for stable ordering", async () => {
    const a = await ctx.repos.messages.create({ conversationId, role: "user", content: "a" });
    const b = await ctx.repos.messages.create({ conversationId, role: "assistant", content: "b" });
    expect(b.createdAt).toBeGreaterThan(a.createdAt);
  });

  it("deleteAfter removes later messages (optionally the anchor)", async () => {
    const one = await ctx.repos.messages.create({ conversationId, role: "user", content: "1" });
    const two = await ctx.repos.messages.create({ conversationId, role: "assistant", content: "2" });
    await ctx.repos.messages.create({ conversationId, role: "user", content: "3" });
    expect(await ctx.repos.messages.deleteAfter(two.id)).toBe(1);
    expect((await ctx.repos.messages.listByConversation(conversationId)).map((m) => m.content)).toEqual(["1", "2"]);
    expect(await ctx.repos.messages.deleteAfter(one.id, { inclusive: true })).toBe(2);
    expect((await ctx.repos.conversations.get(conversationId))?.messageCount).toBe(0);
  });

  it("lists messages by status (stream recovery)", async () => {
    await ctx.repos.messages.create({ conversationId, role: "assistant", content: "", status: "streaming", heartbeatAt: 5 });
    await ctx.repos.messages.create({ conversationId, role: "user", content: "x" });
    const streaming = await ctx.repos.messages.listByStatus("streaming");
    expect(streaming).toHaveLength(1);
    expect(streaming[0]?.heartbeatAt).toBe(5);
  });
});
