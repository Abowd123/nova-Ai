import type { JsonSchema } from "./types";

export interface SchemaIssue {
  path: string;
  message: string;
}

const typeOf = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
};

function matchesType(value: unknown, expected: string): boolean {
  const actual = typeOf(value);
  if (expected === "number") return actual === "number" || actual === "integer";
  return actual === expected;
}

/**
 * Small JSON-Schema validator for tool arguments (type, required, properties, items, enum,
 * min/max, lengths, anyOf/oneOf). Models make mistakes; we return readable issues so the
 * model can retry instead of the tool crashing.
 */
export function validateArgs(schema: JsonSchema, value: unknown, path = "$"): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants?.length) {
    const ok = variants.some((variant) => validateArgs(variant, value, path).length === 0);
    if (!ok) issues.push({ path, message: "does not match any allowed shape" });
    return issues;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      issues.push({ path, message: `expected ${types.join(" | ")}, got ${typeOf(value)}` });
      return issues;
    }
  }
  if (schema.enum && !schema.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
    issues.push({ path, message: `must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}` });
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) issues.push({ path, message: `must be ≥ ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) issues.push({ path, message: `must be ≤ ${schema.maximum}` });
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) issues.push({ path, message: `must have at least ${schema.minLength} characters` });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) issues.push({ path, message: `must have at most ${schema.maxLength} characters` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push({ path, message: `needs at least ${schema.minItems} items` });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push({ path, message: `allows at most ${schema.maxItems} items` });
    if (schema.items) value.forEach((item, i) => issues.push(...validateArgs(schema.items!, item, `${path}[${i}]`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (record[key] === undefined) issues.push({ path: `${path}.${key}`, message: "is required" });
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (record[key] !== undefined) issues.push(...validateArgs(child, record[key], `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) if (!(key in (schema.properties ?? {}))) issues.push({ path: `${path}.${key}`, message: "is not allowed" });
    }
  }
  return issues;
}

/** Parses model-produced arguments. Empty string = {} (some models send nothing for no-arg tools). */
export function parseToolArguments(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const text = raw.trim();
  if (!text) return { ok: true, value: {} };
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Arguments must be a JSON object" };
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, error: "Arguments are not valid JSON" };
  }
}

/** Keys Gemini's OpenAPI-subset schema accepts. Everything else is dropped. */
const GEMINI_KEYS = new Set(["type", "format", "description", "nullable", "enum", "properties", "required", "items", "minItems", "maxItems", "minimum", "maximum", "anyOf", "propertyOrdering", "title", "minLength", "maxLength", "pattern", "default"]);

/**
 * Gemini function declarations use an OpenAPI 3 subset: no $schema/$ref/additionalProperties,
 * `type` must be a single value (["string","null"] -> nullable), enums only on strings.
 */
export function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!GEMINI_KEYS.has(key) || value === undefined) continue;
    if (key === "type" && Array.isArray(value)) {
      const types = value.filter((t) => t !== "null");
      out.type = (types[0] ?? "string").toUpperCase();
      if (types.length !== value.length) out.nullable = true;
      continue;
    }
    if (key === "type" && typeof value === "string") out.type = value.toUpperCase();
    else if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(Object.entries(value as Record<string, JsonSchema>).map(([k, v]) => [k, toGeminiSchema(v)]));
    } else if (key === "items" && value && typeof value === "object") out.items = toGeminiSchema(value as JsonSchema);
    else if (key === "anyOf" && Array.isArray(value)) out.anyOf = value.map((v) => toGeminiSchema(v as JsonSchema));
    else if (key === "enum" && Array.isArray(value)) out.enum = value.map(String);
    else if (key === "format" && typeof value === "string") {
      if (["enum", "date-time", "int32", "int64", "float", "double"].includes(value)) out.format = value;
    } else out[key] = value;
  }
  if (out.enum && !out.type) out.type = "STRING";
  return out;
}

/** OpenAI/Anthropic accept JSON Schema; make sure the top level is an object schema. */
export function toObjectSchema(schema: JsonSchema | undefined): JsonSchema {
  if (!schema || schema.type !== "object") return { type: "object", properties: {}, ...(schema && schema.type === undefined ? schema : {}) };
  const { $schema: _ignored, ...rest } = schema as JsonSchema & { $schema?: unknown };
  return { ...rest, properties: rest.properties ?? {} };
}
