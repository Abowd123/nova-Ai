import { describe, expect, it } from "vitest";
import { formatBytes, formatRelativeTime } from "@/lib/format";
import { normalizeForSearch } from "@/lib/text";

describe("normalizeForSearch", () => {
  it("removes Arabic diacritics and tatweel", () => {
    expect(normalizeForSearch("مُحَمَّـــد")).toBe("محمد");
  });
  it("unifies alef, yaa and taa marbuta forms", () => {
    expect(normalizeForSearch("أإآ")).toBe("ااا");
    expect(normalizeForSearch("مستشفى")).toBe("مستشفي");
    expect(normalizeForSearch("مدرسة")).toBe("مدرسه");
  });
  it("is case-insensitive and collapses whitespace", () => {
    expect(normalizeForSearch("  Hello   WORLD ")).toBe("hello world");
  });
});

describe("format", () => {
  const now = Date.UTC(2026, 0, 1);
  it("formats relative time", () => {
    expect(formatRelativeTime(now - 60_000, "en", now)).toBe("1 minute ago");
    expect(formatRelativeTime(now, "en", now)).toBe("now");
    expect(formatRelativeTime(now - 2 * 24 * 3600_000, "en", now)).toBe("2 days ago");
  });
  it("formats bytes", () => {
    expect(formatBytes(512, "en")).toMatch(/^512\s?\S+/);
    expect(formatBytes(1536, "en")).toMatch(/^1\.5\s?kB$/);
    expect(formatBytes(3 * 1024 * 1024, "en")).toMatch(/^3\s?MB$/);
  });
});
