import { describe, expect, it } from "vitest";
import { keywordPattern, matchLorebooks } from "@/lib/memory/lorebook";
import type { Lorebook, LoreEntry } from "@/lib/models";
import { cleanSummary, summaryUserPrompt, transcriptLine } from "@/lib/memory/prompts";

const e = (id: string, keywords: string[], content: string, priority = 0, over: Partial<LoreEntry> = {}): LoreEntry => ({ id, keywords, content, priority, enabled: true, caseSensitive: false, ...over });
const book = (entries: LoreEntry[], over: Partial<Lorebook> = {}): Lorebook => ({
  id: "b1",
  name: "World",
  description: "",
  enabled: true,
  assistantId: null,
  conversationId: null,
  tokenBudget: 1000,
  scanDepth: 3,
  entries,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});
const ctx = { assistantId: "a1", conversationId: "c1" };

describe("keywordPattern", () => {
  it("matches whole English words, plurals, case-insensitively", () => {
    const p = keywordPattern("Dragon", false);
    expect(p.test("the dragons fly")).toBe(true);
    expect(p.test("dragonfly")).toBe(false);
    expect(keywordPattern("Dragon", true).test("dragon")).toBe(false);
  });

  it("matches Arabic with attached prefixes and suffixes", () => {
    const p = keywordPattern("مكتبة", false);
    expect(p.test("ذهبت الى المكتبه")).toBe(true);
    expect(p.test("وبالمكتبة كتب")).toBe(true);
    expect(p.test("مكتبتها كبيرة")).toBe(true);
    expect(p.test("مكتب")).toBe(false);
  });
});

describe("matchLorebooks", () => {
  it("triggers by keywords in recent messages (Arabic + English), priority order", () => {
    const books = [book([e("1", ["Eldoria"], "Eldoria is a northern kingdom.", 1), e("2", ["سيف"], "السيف الأسود ملعون.", 5), e("3", ["moon"], "never", 9)])];
    const matches = matchLorebooks(books, ["Tell me about Eldoria", "وماذا عن السيف؟"], ctx);
    expect(matches.map((m) => m.entryId)).toEqual(["2", "1"]);
    expect(matches[0]!.keyword).toBe("سيف");
  });

  it("only scans scanDepth recent messages", () => {
    const books = [book([e("1", ["Eldoria"], "x")], { scanDepth: 1 })];
    expect(matchLorebooks(books, ["Eldoria", "something else"], ctx)).toEqual([]);
  });

  it("respects token budget: skips big entries, keeps smaller ones", () => {
    const big = "word ".repeat(400);
    const books = [book([e("big", ["a1"], big, 10), e("small", ["a1"], "short fact", 1)], { tokenBudget: 60 })];
    expect(matchLorebooks(books, ["a1"], ctx).map((m) => m.entryId)).toEqual(["small"]);
  });

  it("skips disabled books/entries and other assistants/conversations", () => {
    const entries = [e("1", ["key"], "c"), e("2", ["key"], "d", 0, { enabled: false })];
    expect(matchLorebooks([book(entries, { enabled: false })], ["key"], ctx)).toEqual([]);
    expect(matchLorebooks([book(entries, { assistantId: "other" })], ["key"], ctx)).toEqual([]);
    expect(matchLorebooks([book(entries, { conversationId: "c9" })], ["key"], ctx)).toEqual([]);
    expect(matchLorebooks([book(entries, { assistantId: "a1", conversationId: "c1" })], ["key"], ctx).map((m) => m.entryId)).toEqual(["1"]);
  });
});

describe("summary prompts", () => {
  it("builds the update prompt and strips injected context", () => {
    expect(summaryUserPrompt(null, "User: hi")).toContain("There is no summary yet.");
    expect(summaryUserPrompt("- old", "User: hi")).toContain("Current summary:\n- old");
    expect(transcriptLine("user", "<context>\nnotes\n</context>\n\nhello")).toBe("User: hello");
  });

  it("cleans model wrappers", () => {
    expect(cleanSummary("```\n- a\n```")).toBe("- a");
    expect(cleanSummary("Here is the summary:\n- a")).toBe("- a");
    expect(cleanSummary("الملخص:\n- نقطة")).toBe("- نقطة");
  });
});
