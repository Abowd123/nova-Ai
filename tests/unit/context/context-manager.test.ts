import { describe, expect, it } from "vitest";
import { buildContext, contextWindowFor, reserveFor, truncateToolResults, type ContextInput, type ContextMessage } from "@/lib/context/context-manager";
import { estimateMessageTokens, estimateTokens, truncateToTokens } from "@/lib/context/tokens";

const msg = (role: "user" | "assistant", text: string, i: number): ContextMessage => ({ message: { role, parts: [{ type: "text", text }] }, id: `m${i}`, createdAt: i });
const conversation = (n: number, words = 50) =>
  Array.from({ length: n }, (_, i) => msg(i % 2 === 0 ? "user" : "assistant", `turn ${i} ` + "lorem ipsum dolor ".repeat(words), i + 1));
const input = (over: Partial<ContextInput>): ContextInput => ({
  system: "You are Nova.",
  lore: [],
  memories: [],
  summary: null,
  messages: [msg("user", "hello", 1)],
  contextWindow: 8000,
  reserveOutput: 1000,
  maxToolResultTokens: 2000,
  memoryTokenBudget: 1000,
  ...over,
});
const textOf = (m: { parts: { type: string; text?: string }[] }) => m.parts.map((p) => p.text ?? "").join("");

describe("token estimates", () => {
  it("counts Arabic denser than English and skips whitespace", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("مرحبا")).toBe(2);
    expect(estimateTokens("a b c d")).toBe(1);
    expect(estimateMessageTokens({ parts: [{ type: "text", text: "abcd" }, { type: "image", mimeType: "image/png", data: "x" }] })).toBe(4 + 1 + 800);
  });

  it("truncates to a token budget", () => {
    const text = "word ".repeat(1000);
    expect(estimateTokens(truncateToTokens(text, 100))).toBeLessThanOrEqual(100);
    expect(truncateToTokens("short", 100)).toBe("short");
  });
});

describe("buildContext", () => {
  it("empty history: only system + current turn", () => {
    const result = buildContext(input({}));
    expect(result.messages).toHaveLength(1);
    expect(result.system).toBe("You are Nova.");
    expect(result.overflow).toBe(false);
    expect(result.omittedMessages).toBe(0);
    expect(result.keptMessageIds).toEqual(["m1"]);
    expect(result.breakdown.total).toBe(result.breakdown.system + result.breakdown.messages);
  });

  it("full window: keeps the newest turns, drops oldest, never starts with assistant", () => {
    const messages = conversation(41);
    const result = buildContext(input({ messages, contextWindow: 3000, reserveOutput: 500 }));
    expect(result.omittedMessages).toBeGreaterThan(0);
    expect(result.messages[0]!.role).toBe("user");
    expect(textOf(result.messages.at(-1)!)).toContain("turn 40");
    expect(result.breakdown.total).toBeLessThanOrEqual(2500);
    expect(result.ratio).toBeLessThanOrEqual(1);
  });

  it("overflow: the current turn alone exceeds the window", () => {
    const result = buildContext(input({ messages: [msg("user", "x ".repeat(20_000) + "y".repeat(40_000), 1)], contextWindow: 4000 }));
    expect(result.overflow).toBe(true);
  });

  it("priority: lore > memory > summary > recent; memories respect their budget", () => {
    const messages = conversation(21, 30);
    const result = buildContext(
      input({
        messages,
        contextWindow: 2600,
        reserveOutput: 400,
        lore: [{ lorebookId: "b", entryId: "e", content: "Eldoria is a kingdom." }],
        memories: [
          { id: "mem1", text: "User likes tea.", score: 0.9 },
          { id: "mem2", text: "word ".repeat(2000), score: 0.8 },
          { id: "mem3", text: "User lives in Sanaa.", score: 0.7 },
        ],
        memoryTokenBudget: 200,
        summary: { text: "- earlier: user planned a trip", coveredUntil: 10 },
      }),
    );
    expect(result.usedLore).toEqual([{ lorebookId: "b", entryId: "e" }]);
    expect(result.usedMemoryIds).toEqual(["mem1", "mem3"]);
    expect(result.summaryUsed).toBe(true);
    expect(result.summarizedMessages).toBe(10);
    expect(result.system).toContain("user planned a trip");
    const current = textOf(result.messages.at(-1)!);
    expect(current.startsWith("<context>")).toBe(true);
    expect(current).toContain("Eldoria");
    expect(current).toContain("- User likes tea.");
    expect(result.messages.some((m) => textOf(m).includes("turn 3 "))).toBe(false);
  });

  it("keeps a stable prefix: injected notes go into the last turn only", () => {
    const messages = conversation(5, 5);
    const a = buildContext(input({ messages, memories: [{ id: "x", text: "fact A", score: 1 }] }));
    const b = buildContext(input({ messages, memories: [{ id: "y", text: "fact B", score: 1 }] }));
    expect(a.system).toBe(b.system);
    expect(a.messages.slice(0, -1)).toEqual(b.messages.slice(0, -1));
    expect(textOf(a.messages.at(-1)!)).not.toBe(textOf(b.messages.at(-1)!));
  });

  it("ignores a summary that covers nothing", () => {
    const result = buildContext(input({ messages: conversation(3, 5), summary: { text: "s", coveredUntil: null } }));
    expect(result.summaryUsed).toBe(false);
  });

  it("truncates long tool results", () => {
    const parts = truncateToolResults([{ type: "tool_result", toolCallId: "t", content: "data ".repeat(5000) } as never], 100);
    const content = (parts[0] as { content: string }).content;
    expect(content).toContain("[truncated");
    expect(estimateTokens(content)).toBeLessThanOrEqual(120);
  });

  it("window helpers", () => {
    expect(contextWindowFor({ contextWindow: 128_000 }, 8000)).toBe(128_000);
    expect(contextWindowFor({ contextWindow: null }, 8000)).toBe(8000);
    expect(reserveFor(null, 2048, 8000)).toBe(2048);
    expect(reserveFor(10_000, 2048, 8000)).toBe(4000);
  });
});
