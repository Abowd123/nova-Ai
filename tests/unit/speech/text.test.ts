import { describe, expect, it } from "vitest";
import { SentenceBuffer, splitSentences } from "@/lib/speech/sentences";
import { toSpeakableText } from "@/lib/speech/speakable";

describe("toSpeakableText", () => {
  it("drops code blocks, URLs and markdown syntax but keeps link labels", () => {
    const md = "# Title\n\nSee [the docs](https://example.com/a(b)) and **bold** _it_.\n\n```ts\nconst x = 1;\n```\n- item one\n- item two\nVisit https://nova.test now. `inline` stays.";
    const text = toSpeakableText(md, { codePlaceholder: "Code omitted." });
    expect(text).toBe("Title\nSee the docs and bold it.\nCode omitted.\nitem one\nitem two\nVisit now. inline stays.");
  });

  it("removes images, HTML, math and tables separators", () => {
    const md = "![chart](x.png)\n<b>Hi</b> $x^2$ there\n| a | b |\n|---|---|\n| 1 | 2 |";
    const text = toSpeakableText(md);
    expect(text).not.toContain("x.png");
    expect(text).not.toContain("<b>");
    expect(text).not.toContain("x^2");
    expect(text).not.toContain("---");
    expect(text).toContain("chart");
  });

  it("skips code silently without a placeholder", () => {
    expect(toSpeakableText("before\n```\ncode\n```\nafter")).toBe("before\nafter");
  });
});

describe("splitSentences", () => {
  it("splits English and Arabic sentences", () => {
    expect(splitSentences("This is the first sentence. And this is the second one! Is this third?", { minLength: 5 })).toEqual([
      "This is the first sentence.",
      "And this is the second one!",
      "Is this third?",
    ]);
    expect(splitSentences("مرحباً بك في نوفا، المساعد الذكي. كيف يمكنني مساعدتك اليوم؟ أنا هنا.", { minLength: 5 })).toEqual([
      "مرحباً بك في نوفا، المساعد الذكي.",
      "كيف يمكنني مساعدتك اليوم؟",
      "أنا هنا.",
    ]);
  });

  it("does not split decimals and merges very short pieces", () => {
    expect(splitSentences("Pi is 3.14 roughly, as you know. Then we continue with more words.")).toEqual(["Pi is 3.14 roughly, as you know.", "Then we continue with more words."]);
    expect(splitSentences("Short. Ok. Then we continue with more words here.")).toEqual(["Short. Ok. Then we continue with more words here."]);
  });

  it("bounds long sentences at commas, then spaces", () => {
    const long = `${"word ".repeat(40)}, ${"more ".repeat(40)}`.trim();
    const parts = splitSentences(long, { maxLength: 120 });
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(120);
  });
});

describe("SentenceBuffer", () => {
  it("emits complete sentences once while streaming", () => {
    const buffer = new SentenceBuffer();
    expect(buffer.push("Hello there, this is a")).toEqual([]);
    expect(buffer.push("Hello there, this is a streamed reply. Next")).toEqual(["Hello there, this is a streamed reply."]);
    expect(buffer.push("Hello there, this is a streamed reply. Next sentence")).toEqual([]);
    expect(buffer.push("Hello there, this is a streamed reply. Next sentence ends.", true)).toEqual(["Next sentence ends."]);
    expect(buffer.push("Hello there, this is a streamed reply. Next sentence ends.", true)).toEqual([]);
  });
});
