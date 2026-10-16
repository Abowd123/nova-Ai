// @vitest-environment node
import { describe, expect, it } from "vitest";
import { nextTagColor, readableTextColor, TAG_COLORS } from "@/features/tags/colors";
import { moveItem } from "@/features/tags/order";

describe("tag ordering", () => {
  it("moves items up and down", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
  it("is a no-op out of range and never mutates", () => {
    const input = ["a", "b"];
    expect(moveItem(input, 0, 5)).toEqual(["a", "b"]);
    expect(moveItem(input, -1, 0)).toEqual(["a", "b"]);
    expect(moveItem(input, 1, 0)).not.toBe(input);
    expect(input).toEqual(["a", "b"]);
  });
});

describe("tag colors", () => {
  it("picks readable text on light and dark backgrounds", () => {
    expect(readableTextColor("#FFFFFF")).toBe("#000000");
    expect(readableTextColor("#FFEB3B")).toBe("#000000");
    expect(readableTextColor("#000000")).toBe("#FFFFFF");
    expect(readableTextColor("#1E3A8A")).toBe("#FFFFFF");
  });
  it("suggests an unused palette color first", () => {
    const first = TAG_COLORS[0]!;
    expect(nextTagColor([])).toBe(first);
    expect(nextTagColor([first])).not.toBe(first);
  });
});
