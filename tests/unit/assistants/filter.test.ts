// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assistant, tag } from "@tests/helpers/fixtures";
import { EMPTY_FILTER, filterAssistants, filterFromSearchParams, filterToSearchParams, toggleTag } from "@/features/assistants/filter";

const tags = [tag("t-code", "برمجة"), tag("t-work", "Work", 1), tag("t-fun", "Fun", 2)];
const list = [
  assistant("a1", { name: "Coder", tagIds: ["t-code", "t-work"] }),
  assistant("a2", { name: "Writer", description: "Blog posts", tagIds: ["t-work"] }),
  assistant("a3", { name: "مترجم", tagIds: ["t-fun"] }),
];
const names = (items: { name: string }[]) => items.map((a) => a.name);

describe("filterAssistants", () => {
  it("returns all with an empty filter", () => {
    expect(filterAssistants(list, tags, EMPTY_FILTER)).toHaveLength(3);
  });
  it("searches names and descriptions, case-insensitively", () => {
    expect(names(filterAssistants(list, tags, { query: "coder", tagIds: [] }))).toEqual(["Coder"]);
    expect(names(filterAssistants(list, tags, { query: "BLOG", tagIds: [] }))).toEqual(["Writer"]);
    expect(names(filterAssistants(list, tags, { query: "مترجم", tagIds: [] }))).toEqual(["مترجم"]);
  });
  it("searches tag names", () => {
    expect(names(filterAssistants(list, tags, { query: "برمجة", tagIds: [] }))).toEqual(["Coder"]);
    expect(names(filterAssistants(list, tags, { query: "work", tagIds: [] }))).toEqual(["Coder", "Writer"]);
  });
  it("combines multiple tags with AND", () => {
    expect(names(filterAssistants(list, tags, { query: "", tagIds: ["t-work"] }))).toEqual(["Coder", "Writer"]);
    expect(names(filterAssistants(list, tags, { query: "", tagIds: ["t-work", "t-code"] }))).toEqual(["Coder"]);
    expect(names(filterAssistants(list, tags, { query: "", tagIds: ["t-work", "t-fun"] }))).toEqual([]);
    expect(names(filterAssistants(list, tags, { query: "writer", tagIds: ["t-work"] }))).toEqual(["Writer"]);
  });
  it("ignores deleted tags in the filter", () => {
    expect(filterAssistants(list, tags, { query: "", tagIds: ["gone"] })).toHaveLength(3);
  });
});

describe("filter URL state", () => {
  it("round-trips query and tags", () => {
    const params = filterToSearchParams({ query: "co der", tagIds: ["t-code", "t-work"] });
    expect(filterFromSearchParams(new URLSearchParams(params.toString()))).toEqual({ query: "co der", tagIds: ["t-code", "t-work"] });
  });
  it("omits empty values and keeps unrelated params", () => {
    const params = filterToSearchParams(EMPTY_FILTER, new URLSearchParams("tab=x&q=old&tags=a"));
    expect(params.toString()).toBe("tab=x");
  });
  it("drops unknown and duplicate tag ids", () => {
    const filter = filterFromSearchParams(new URLSearchParams("tags=t-code,zzz,t-code"), tags.map((t) => t.id));
    expect(filter.tagIds).toEqual(["t-code"]);
  });
  it("toggles tags", () => {
    const on = toggleTag(EMPTY_FILTER, "t-fun");
    expect(on.tagIds).toEqual(["t-fun"]);
    expect(toggleTag(on, "t-fun").tagIds).toEqual([]);
  });
});
