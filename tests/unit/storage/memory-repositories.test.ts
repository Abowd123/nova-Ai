import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "@tests/helpers/storage";
import { memoryHash } from "@/lib/memory/text";

describe("memory repositories (Dexie v6)", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });
  afterEach(async () => {
    await ctx.destroy();
  });

  const input = (text: string) => ({ text, scope: "global" as const, source: "manual" as const, tokens: 5, hash: memoryHash(text, { scope: "global" }) });

  it("dedupes chunks by hash", async () => {
    const a = await ctx.repos.memory.create(input("User likes tea"));
    const b = await ctx.repos.memory.create(input("user likes tea"));
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.chunk.id).toBe(a.chunk.id);
  });

  it("stores vectors per model and reports pending chunks", async () => {
    const { chunk } = await ctx.repos.memory.create(input("Lives in Sanaa"));
    expect((await ctx.repos.memory.listPending("p:m:default", 10)).map((c) => c.id)).toEqual([chunk.id]);
    await ctx.repos.memory.saveVectors("p:m:default", [{ id: chunk.id, vector: Float32Array.from([1, 0]) }]);
    expect(await ctx.repos.memory.listPending("p:m:default", 10)).toEqual([]);
    expect((await ctx.repos.memory.listPending("p:other:default", 10)).length).toBe(1);
    const rows = await ctx.repos.memory.listForIndex("p:m:default");
    expect(Array.from(rows[0]!.vector!)).toEqual([1, 0]);
  });

  it("editing text invalidates the vector; delete removes both", async () => {
    const { chunk } = await ctx.repos.memory.create(input("Old fact here"));
    await ctx.repos.memory.saveVectors("k", [{ id: chunk.id, vector: Float32Array.from([1]) }]);
    await ctx.repos.memory.update(chunk.id, { text: "New fact here" });
    expect((await ctx.repos.memory.listForIndex("k"))[0]!.vector).toBeNull();
    await ctx.repos.memory.delete([chunk.id]);
    expect(await ctx.repos.memory.get(chunk.id)).toBeUndefined();
  });

  it("summaries and lorebooks CRUD", async () => {
    const summary = await ctx.repos.summaries.put("c1", { text: "- s", manualEdit: true, coveredUntil: 5, coveredMessageCount: 3, tokens: 2, providerId: null, modelId: null });
    expect(summary).toMatchObject({ id: "c1", manualEdit: true });
    const book = await ctx.repos.lorebooks.create({ name: "World", entries: [{ id: "e1", keywords: ["نوفا"], content: "x", priority: 0, enabled: true, caseSensitive: false }] });
    expect(book).toMatchObject({ enabled: true, tokenBudget: 1000, scanDepth: 6 });
    expect((await ctx.repos.lorebooks.update(book.id, { enabled: false })).enabled).toBe(false);
    await ctx.repos.lorebooks.delete(book.id);
    expect(await ctx.repos.lorebooks.list()).toEqual([]);
  });
});
