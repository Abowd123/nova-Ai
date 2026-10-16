import { describe, expect, it } from "vitest";
import { MemoryIndex, visible, type IndexEntry, type SearchQuery } from "@/lib/memory/memory-index";
import { runBenchmark } from "@/lib/memory/benchmark";
import { createInlineIndexClient } from "@/lib/memory/index-client";

const v = (...xs: number[]) => Float32Array.from(xs);
function entry(id: string, text: string, vector: Float32Array | null, over: Partial<IndexEntry> = {}): IndexEntry {
  return { id, text, scope: "global", assistantId: null, conversationId: null, sourceMessageId: null, createdAt: 1, vector, ...over };
}
const query = (over: Partial<SearchQuery>): SearchQuery => ({ text: "", vector: null, topK: 5, threshold: 0.3, semanticWeight: 0.7, filter: { mode: "all" }, ...over });

describe("MemoryIndex", () => {
  it("ranks by cosine and applies the threshold", () => {
    const index = new MemoryIndex();
    index.upsert([entry("a", "likes tea", v(1, 0, 0)), entry("b", "likes coffee", v(0.8, 0.6, 0)), entry("c", "car broke", v(0, 0, 1))]);
    const hits = index.search(query({ text: "drinks", vector: v(1, 0.1, 0) }));
    expect(hits.map((h) => h.id)).toEqual(["a", "b"]);
    expect(hits[0]!.semantic).toBeGreaterThan(hits[1]!.semantic!);
    expect(index.dims).toBe(3);
  });

  it("boosts keyword matches in hybrid ranking", () => {
    const index = new MemoryIndex();
    index.upsert([entry("a", "general preferences", v(1, 0)), entry("b", "the user's dog is called Luna", v(0.95, 0.31))]);
    const hits = index.search(query({ text: "what is my dog called", vector: v(1, 0), semanticWeight: 0.5 }));
    expect(hits[0]!.id).toBe("b");
  });

  it("falls back to BM25 when there is no query vector (Arabic)", () => {
    const index = new MemoryIndex();
    index.upsert([entry("a", "المستخدم يعيش في مدينة صنعاء", null), entry("b", "يفضل القهوة العربية", null), entry("c", "likes hiking", null)]);
    const hits = index.search(query({ text: "أين يعيش المستخدم؟ في أي مدينة", vector: null }));
    expect(hits[0]!.id).toBe("a");
    expect(hits[0]!.semantic).toBeNull();
    expect(hits.find((h) => h.id === "c")).toBeUndefined();
  });

  it("keeps non-embedded entries reachable by keywords below semantic hits", () => {
    const index = new MemoryIndex();
    index.upsert([entry("old", "project codename falcon", null), entry("new", "project timeline", v(1, 0))]);
    const hits = index.search(query({ text: "falcon project", vector: v(1, 0) }));
    expect(hits.map((h) => h.id)).toContain("old");
  });

  it("excludes messages already in the window and supports upsert/remove", () => {
    const index = new MemoryIndex();
    index.upsert([entry("a", "budget is 500 dollars", v(1, 0), { sourceMessageId: "m1" }), entry("b", "budget for travel 900", v(1, 0.1))]);
    expect(index.search(query({ text: "budget", vector: v(1, 0), excludeMessageIds: ["m1"] })).map((h) => h.id)).toEqual(["b"]);
    index.upsert([entry("b", "nothing related", v(0, 1))]);
    expect(index.search(query({ text: "budget", vector: v(1, 0) })).map((h) => h.id)).toEqual(["a"]);
    index.remove(["a"]);
    expect(index.size).toBe(1);
    expect(index.search(query({ text: "budget", vector: null }))).toEqual([]);
  });

  it("respects topK", () => {
    const index = new MemoryIndex();
    index.upsert(Array.from({ length: 20 }, (_, i) => entry(`e${i}`, `note ${i}`, v(1, i / 100))));
    expect(index.search(query({ vector: v(1, 0), topK: 3 }))).toHaveLength(3);
  });
});

describe("scope visibility", () => {
  const g = { scope: "global" as const, assistantId: null, conversationId: null };
  const a1 = { scope: "assistant" as const, assistantId: "a1", conversationId: null };
  const c1 = { scope: "conversation" as const, assistantId: "a1", conversationId: "c1" };
  const c2 = { scope: "conversation" as const, assistantId: "a2", conversationId: "c2" };

  it("global sees shared + own assistant + own conversation", () => {
    const f = { mode: "global" as const, assistantId: "a1", conversationId: "c1" };
    expect([g, a1, c1, c2].map((e) => visible(e, f))).toEqual([true, true, true, false]);
    expect(visible(a1, { ...f, assistantId: null })).toBe(false);
  });

  it("assistant scope sees only that assistant", () => {
    const f = { mode: "assistant" as const, assistantId: "a1", conversationId: "c1" };
    expect([g, a1, c1, c2].map((e) => visible(e, f))).toEqual([false, true, true, false]);
  });

  it("conversation scope sees only that conversation", () => {
    const f = { mode: "conversation" as const, assistantId: "a1", conversationId: "c1" };
    expect([g, a1, c1, c2].map((e) => visible(e, f))).toEqual([false, false, true, false]);
  });
});

describe("benchmark (10k)", () => {
  it("indexes 10k × 384 and searches in well under a second", () => {
    const result = runBenchmark({ count: 10_000, dims: 384, runs: 3 });
    expect(result.entries).toBe(10_000);
    expect(result.searchMs).toBeLessThanOrEqual(1000);
    // eslint-disable-next-line no-console
    console.log(`benchmark: build ${result.buildMs.toFixed(0)} ms, search ${result.searchMs.toFixed(1)} ms`);
  });

  it("inline client wraps the index", async () => {
    const client = createInlineIndexClient();
    await client.reset([entry("a", "tea", v(1, 0))]);
    expect(await client.size()).toBe(1);
    expect((await client.search(query({ vector: v(1, 0) })))[0]!.id).toBe("a");
    await client.remove(["a"]);
    expect(await client.size()).toBe(0);
  });
});
