import { describe, expect, it } from "vitest";
import { markdownSanitizeSchema } from "@/components/markdown/sanitize-schema";

describe("XSS: markdown sanitizer", () => {
  it("does not allow script, iframes, event handlers or javascript: URLs", () => {
    const schema = markdownSanitizeSchema as { tagNames?: string[]; attributes?: Record<string, unknown[]>; protocols?: Record<string, string[]> };
    expect(schema.tagNames).not.toContain("script");
    expect(schema.tagNames).not.toContain("iframe");
    const attrs = JSON.stringify(schema.attributes ?? {});
    expect(attrs).not.toMatch(/"on[a-z]+"/);
    expect(schema.protocols?.href ?? []).not.toContain("javascript");
  });
});
