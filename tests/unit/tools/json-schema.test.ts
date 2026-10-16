import { describe, expect, it } from "vitest";
import { parseToolArguments, toGeminiSchema, toObjectSchema, validateArgs } from "@/lib/tools/json-schema";

const schema = {
  type: "object" as const,
  properties: {
    query: { type: "string" as const, minLength: 1, maxLength: 10 },
    count: { type: "integer" as const, minimum: 1, maximum: 5 },
    mode: { type: "string" as const, enum: ["a", "b"] },
    tags: { type: "array" as const, items: { type: "string" as const }, maxItems: 2 },
  },
  required: ["query"],
  additionalProperties: false,
};

describe("validateArgs", () => {
  it("accepts valid arguments", () => {
    expect(validateArgs(schema, { query: "hi", count: 3, mode: "a", tags: ["x"] })).toEqual([]);
  });

  it("reports readable issues", () => {
    const issues = validateArgs(schema, { count: 9, mode: "z", tags: ["x", 1, "y"], extra: true });
    const text = issues.map((i) => `${i.path} ${i.message}`);
    expect(text).toContain("$.query is required");
    expect(text).toContain("$.count must be ≤ 5");
    expect(text.some((t) => t.startsWith("$.mode must be one of"))).toBe(true);
    expect(text).toContain("$.tags allows at most 2 items");
    expect(text).toContain("$.tags[1] expected string, got integer");
    expect(text).toContain("$.extra is not allowed");
  });

  it("handles number vs integer and anyOf", () => {
    expect(validateArgs({ type: "integer" }, 1.5)).toHaveLength(1);
    expect(validateArgs({ type: "number" }, 2)).toEqual([]);
    expect(validateArgs({ anyOf: [{ type: "string" }, { type: "null" }] }, null)).toEqual([]);
    expect(validateArgs({ anyOf: [{ type: "string" }] }, 3)).toHaveLength(1);
  });
});

describe("parseToolArguments", () => {
  it("parses objects, treats empty as {}, rejects others", () => {
    expect(parseToolArguments('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseToolArguments("  ")).toEqual({ ok: true, value: {} });
    expect(parseToolArguments("[1]")).toMatchObject({ ok: false });
    expect(parseToolArguments("{oops")).toMatchObject({ ok: false });
  });
});

describe("provider schema conversion", () => {
  it("converts to Gemini's OpenAPI subset", () => {
    const out = toGeminiSchema({ type: "object", $schema: "x", additionalProperties: false, properties: { a: { type: ["string", "null"], format: "uri" }, n: { type: "integer", enum: [1, 2] } }, required: ["a"] });
    expect(out).toEqual({ type: "OBJECT", properties: { a: { type: "STRING", nullable: true }, n: { type: "INTEGER", enum: ["1", "2"] } }, required: ["a"] });
  });

  it("guarantees an object schema at the top level", () => {
    expect(toObjectSchema(undefined)).toEqual({ type: "object", properties: {} });
    expect(toObjectSchema({ type: "object", $schema: "http://json-schema.org/draft-07/schema#", properties: { a: { type: "string" } } } as never)).toEqual({ type: "object", properties: { a: { type: "string" } } });
  });
});
