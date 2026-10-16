// @vitest-environment node
import { describe, expect, it } from "vitest";
import { repairIncompleteMarkdown, splitMarkdownBlocks } from "@/components/markdown/incomplete";
import { safeImageUrl, safeLinkUrl } from "@/components/markdown/safe-url";

describe("repairIncompleteMarkdown", () => {
  it.each([
    ["```ts\nconst a = 1", "```ts\nconst a = 1\n```"],
    ["~~~\ncode\n", "~~~\ncode\n~~~"],
    ["hello **wor", "hello **wor**"],
    ["it is __very", "it is __very__"],
    ["~~old", "~~old~~"],
    ["an *emph", "an *emph*"],
    ["use `npm i", "use `npm i`"],
    ["$$\nx^2 +", "$$\nx^2 +\n$$"],
    ["see [the docs](https://exa", "see the docs"],
    ["an image ![alt](https://i", "an image alt"],
    ["open [bracket", "open bracket"],
  ])("repairs %j", (input, expected) => {
    expect(repairIncompleteMarkdown(input)).toBe(expected);
  });

  it.each(["", "complete **bold** text", "* list item", "```\nclosed\n```", "inline `code` done", "$$x$$", "price is 5 * 3", "a [link](https://x.y) ok"])(
    "leaves %j unchanged",
    (input) => expect(repairIncompleteMarkdown(input)).toBe(input),
  );

  it("ignores emphasis markers inside inline code", () => {
    expect(repairIncompleteMarkdown("run `a**b` now")).toBe("run `a**b` now");
  });
});

describe("splitMarkdownBlocks", () => {
  it("splits on blank lines but keeps fences and math blocks whole", () => {
    const text = "para one\n\n```py\na = 1\n\nb = 2\n```\n\n$$\nx\n\ny\n$$\n\nlast";
    expect(splitMarkdownBlocks(text)).toEqual(["para one", "```py\na = 1\n\nb = 2\n```", "$$\nx\n\ny\n$$", "last"]);
  });

  it("rejoining blocks preserves content", () => {
    const text = "# Title\n\n- a\n- b\n\n| a | b |\n|---|---|\n| 1 | 2 |";
    expect(splitMarkdownBlocks(text).join("\n\n")).toBe(text);
  });
});

describe("safe URLs", () => {
  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "&#106;avascript:alert(1)",
    "&#x6A;avascript:alert(1)",
    "javascript&colon;alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "file:///etc/passwd",
    "//evil.example/x",
    "relative/path",
  ])("blocks link %j", (url) => expect(safeLinkUrl(url)).toBe(""));

  it("allows http(s), mailto and in-page anchors", () => {
    expect(safeLinkUrl("https://example.com/a?b=1#c")).toBe("https://example.com/a?b=1#c");
    expect(safeLinkUrl("mailto:hi@example.com")).toBe("mailto:hi@example.com");
    expect(safeLinkUrl("#user-content-fn-1")).toBe("#user-content-fn-1");
  });

  it("images: only absolute http(s)", () => {
    expect(safeImageUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
    for (const bad of ["data:image/svg+xml;base64,PHN2Zz4=", "javascript:alert(1)", "blob:https://x/1", "/local.png"]) {
      expect(safeImageUrl(bad)).toBe("");
    }
  });
});
