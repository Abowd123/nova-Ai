import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/memory/chunker";
import { hashText, memoryHash, stem, tokenize } from "@/lib/memory/text";
import { cosine, dot, normalize } from "@/lib/memory/vector-math";
import { estimateTokens } from "@/lib/context/tokens";

describe("tokenize / stem", () => {
  it("drops stopwords and stems English", () => {
    expect(tokenize("The cats are running in the gardens")).toEqual(["cat", "runn", "garden"]);
  });

  it("normalizes Arabic letters and strips proclitics/suffixes", () => {
    expect(tokenize("ذهبت إلى المكتبة")).toContain(stem("مكتبه"));
    expect(stem("والمدرسة")).toBe(stem("مدرسة"));
    expect(tokenize("في من على")).toEqual([]);
  });

  it("hashes deterministically and per owner", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("abd"));
    expect(memoryHash("Hello", { scope: "global" })).toBe(memoryHash("  hello ", { scope: "global" }));
    expect(memoryHash("Hello", { scope: "assistant", assistantId: "a1" })).not.toBe(memoryHash("Hello", { scope: "global" }));
  });
});

describe("vector math", () => {
  it("normalizes and computes cosine", () => {
    expect(Array.from(normalize([3, 4]))).toEqual([0.6000000238418579, 0.800000011920929]);
    expect(Array.from(normalize([0, 0]))).toEqual([0, 0]);
    expect(cosine([1, 0, 0, 0, 1], [1, 0, 0, 0, 1])).toBeGreaterThan(0.9999);
    expect(Math.abs(cosine([1, 0], [0, 1]))).toBeLessThanOrEqual(1e-9);
    expect(cosine([1, 2], [-1, -2])).toBeLessThanOrEqual(-0.9999);
    expect(dot(new Float32Array([1, 2, 3, 4, 5]), new Float32Array([1, 1, 1, 1, 1]))).toBe(15);
  });
});

describe("chunkText", () => {
  const paragraph = (n: number) => `Paragraph ${n}. ` + "Nova keeps your data on your device and works offline. ".repeat(12);

  it("ignores tiny text and injected context", () => {
    expect(chunkText("ok", { targetTokens: 400, overlapTokens: 50 })).toEqual([]);
    const chunks = chunkText("<context>\nsecret notes\n</context>\n\nThe user prefers metric units in every answer.", { targetTokens: 400, overlapTokens: 50 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).not.toContain("secret notes");
  });

  it("keeps short text as one chunk", () => {
    const chunks = chunkText(paragraph(1), { targetTokens: 400, overlapTokens: 50 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.index).toBe(0);
  });

  it("packs paragraphs into bounded chunks with overlap", () => {
    const text = Array.from({ length: 12 }, (_, i) => paragraph(i)).join("\n\n");
    const chunks = chunkText(text, { targetTokens: 300, overlapTokens: 40 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.tokens).toBeLessThanOrEqual(Math.round(300 * 1.25) + 45);
    for (let i = 1; i < chunks.length; i += 1) {
      const prevTail = chunks[i - 1]!.text.split(/\s+/).slice(-3).join(" ");
      expect(chunks[i]!.text.includes(prevTail)).toBe(true);
    }
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it("splits one huge paragraph (Arabic) by sentences", () => {
    const text = "هذه جملة عربية طويلة نسبياً عن مشروع نوفا وتطبيقه. ".repeat(120);
    const chunks = chunkText(text, { targetTokens: 300, overlapTokens: 30 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(estimateTokens(c.text)).toBeLessThanOrEqual(375 + 35);
  });
});

describe("Arabic double proclitics", () => {
  it("strips و/ف + بال", () => {
    expect(stem("وبالمكتبة")).toBe(stem("مكتبة"));
    expect(stem("فللطلاب")).toBe(stem("طلاب"));
  });
});
