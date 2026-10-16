import { base64ToBytes, bytesToBase64 } from "@/lib/crypto/encoding";

/**
 * JSON that survives typed arrays (memory vectors). Tagged values:
 *   { "$nova": "f32", "b64": "..." }  Float32Array
 *   { "$nova": "u8",  "b64": "..." }  Uint8Array
 */
const TAG = "$nova";

export function toJsonValue(value: unknown): unknown {
  if (value instanceof Float32Array) return { [TAG]: "f32", b64: bytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  if (value instanceof Uint8Array) return { [TAG]: "u8", b64: bytesToBase64(value) };
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value && typeof value === "object") {
    if (typeof Blob !== "undefined" && value instanceof Blob) throw new Error("Blobs must be stored as archive entries");
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = toJsonValue(v);
    return out;
  }
  return value;
}

export function fromJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromJsonValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record[TAG] === "string" && typeof record.b64 === "string" && Object.keys(record).length === 2) {
      const bytes = base64ToBytes(record.b64);
      if (record[TAG] === "f32") {
        const copy = new Uint8Array(bytes);
        return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4));
      }
      if (record[TAG] === "u8") return bytes;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      // Prototype pollution guard for untrusted archives.
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      out[k] = fromJsonValue(v);
    }
    return out;
  }
  return value;
}

export const stringifyData = (value: unknown) => JSON.stringify(toJsonValue(value));
export const parseData = (text: string) => fromJsonValue(JSON.parse(text));
