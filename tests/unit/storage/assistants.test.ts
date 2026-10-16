import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "@tests/helpers/storage";

describe("AssistantRepository", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });
  afterEach(async () => {
    await ctx.destroy();
  });

  it("creates with defaults; the first assistant becomes default", async () => {
    const first = await ctx.repos.assistants.create({ name: "One" });
    const second = await ctx.repos.assistants.create({ name: "Two", avatar: "🤖" });
    expect(first).toMatchObject({
      isDefault: true,
      avatar: "✨",
      temperature: 0.7,
      schemaVersion: 2,
      systemPrompt: "",
      description: "",
      topP: null,
      maxTokens: null,
      contextMessageLimit: null,
      enabledTools: [],
      memoryScope: "assistant",
      autoPlayTts: "never",
      starters: [],
      settings: { reasoning: "auto", reasoningBudget: 2048 },
    });
    expect(second.isDefault).toBe(false);
    expect(second.avatar).toBe("🤖");
  });

  it("lists default first", async () => {
    await ctx.repos.assistants.create({ name: "One" });
    const two = await ctx.repos.assistants.create({ name: "Two" });
    await ctx.repos.assistants.setDefault(two.id);
    const list = await ctx.repos.assistants.list();
    expect(list[0]?.name).toBe("Two");
    expect(list.filter((a) => a.isDefault)).toHaveLength(1);
    expect((await ctx.repos.assistants.getDefault())?.id).toBe(two.id);
  });

  it("updates fields", async () => {
    const created = await ctx.repos.assistants.create({ name: "Coder" });
    const updated = await ctx.repos.assistants.update(created.id, {
      name: "Senior coder",
      systemPrompt: "Be precise",
      temperature: 0.2,
    });
    expect(updated).toMatchObject({ name: "Senior coder", systemPrompt: "Be precise", temperature: 0.2 });
  });

  it("duplicates without copying default flag", async () => {
    const original = await ctx.repos.assistants.create({ name: "Orig", systemPrompt: "P" });
    const copy = await ctx.repos.assistants.duplicate(original.id, { name: "Orig (copy)" });
    expect(copy.id).not.toBe(original.id);
    expect(copy).toMatchObject({ name: "Orig (copy)", systemPrompt: "P", isDefault: false });
  });

  it("reassigns default and unlinks conversations on delete", async () => {
    const first = await ctx.repos.assistants.create({ name: "First" });
    const second = await ctx.repos.assistants.create({ name: "Second" });
    const conversation = await ctx.repos.conversations.create({ title: "c", assistantId: first.id });
    await ctx.repos.assistants.delete(first.id);
    expect(await ctx.repos.assistants.get(first.id)).toBeUndefined();
    expect((await ctx.repos.assistants.get(second.id))?.isDefault).toBe(true);
    expect((await ctx.repos.conversations.get(conversation.id))?.assistantId).toBeNull();
  });

  it("searches by name and description", async () => {
    await ctx.repos.assistants.create({ name: "مترجم", description: "ترجمة" });
    await ctx.repos.assistants.create({ name: "Coder", description: "TypeScript expert" });
    expect(await ctx.repos.assistants.list({ query: "typescript" })).toHaveLength(1);
    expect(await ctx.repos.assistants.list({ query: "مترجم" })).toHaveLength(1);
  });

  it("throws NOT_FOUND for setDefault/duplicate on missing ids", async () => {
    await expect(ctx.repos.assistants.setDefault("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ctx.repos.assistants.duplicate("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
