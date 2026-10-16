import { decodeBase45, encodeBase45 } from "./base45";
import { crc32Hex } from "./crc32";

/**
 * Multi-QR framing. Every part is pure QR-alphanumeric text with a fixed-width header:
 *
 *   NV1 | sessionId(6) | index(2) | total(2) | dataCrc(8) | partCrc(8) | payload(base45)
 *
 * - index/total are base36 (up to 1295 parts), index is 0-based
 * - dataCrc = CRC32 of the WHOLE byte string (ties parts to one transfer)
 * - partCrc = CRC32 of this part's payload text (rejects damaged scans)
 */
export const CHUNK_PREFIX = "NV1";
const HEADER_LENGTH = CHUNK_PREFIX.length + 6 + 2 + 2 + 8 + 8;
export const DEFAULT_CHUNK_PAYLOAD = 360;
const SESSION_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export interface ChunkHeader {
  sessionId: string;
  index: number;
  total: number;
  dataCrc: string;
  partCrc: string;
  payload: string;
}

export function randomSessionId(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  return [...random(new Uint8Array(6))].map((b) => SESSION_CHARS[b % 36]).join("");
}

const pad36 = (n: number) => n.toString(36).toUpperCase().padStart(2, "0");

export function encodeChunks(bytes: Uint8Array, options: { sessionId: string; payloadSize?: number }): string[] {
  if (!/^[0-9A-Z]{6}$/.test(options.sessionId)) throw new Error("sessionId must be 6 base36 chars");
  // Keep payload a multiple of 3 so each part decodes on its own boundaries.
  const size = Math.max(3, Math.floor((options.payloadSize ?? DEFAULT_CHUNK_PAYLOAD) / 3) * 3);
  const encoded = encodeBase45(bytes);
  const total = Math.max(1, Math.ceil(encoded.length / size));
  if (total > 36 * 36 - 1) throw new Error("Data too large for QR transfer");
  const dataCrc = crc32Hex(bytes);
  return Array.from({ length: total }, (_, index) => {
    const payload = encoded.slice(index * size, (index + 1) * size);
    return `${CHUNK_PREFIX}${options.sessionId}${pad36(index)}${pad36(total)}${dataCrc}${crc32Hex(payload)}${payload}`;
  });
}

export type ParseResult = { ok: true; chunk: ChunkHeader } | { ok: false; reason: "not-nova" | "malformed" | "corrupt" };

export function parseChunk(raw: string): ParseResult {
  const text = raw.trim();
  if (!text.startsWith(CHUNK_PREFIX)) return { ok: false, reason: "not-nova" };
  if (text.length < HEADER_LENGTH) return { ok: false, reason: "malformed" };
  let offset = CHUNK_PREFIX.length;
  const take = (n: number) => {
    const value = text.slice(offset, offset + n);
    offset += n;
    return value;
  };
  const sessionId = take(6);
  const index = parseInt(take(2), 36);
  const total = parseInt(take(2), 36);
  const dataCrc = take(8);
  const partCrc = take(8);
  const payload = text.slice(offset);
  if (!/^[0-9A-Z]{6}$/.test(sessionId) || !Number.isFinite(index) || !Number.isFinite(total) || total < 1 || index >= total) {
    return { ok: false, reason: "malformed" };
  }
  if (!/^[0-9A-F]{8}$/.test(dataCrc) || !/^[0-9A-F]{8}$/.test(partCrc)) return { ok: false, reason: "malformed" };
  if (crc32Hex(payload) !== partCrc) return { ok: false, reason: "corrupt" };
  return { ok: true, chunk: { sessionId, index, total, dataCrc, partCrc, payload } };
}

export type AddStatus = "accepted" | "duplicate" | "corrupt" | "not-nova" | "malformed" | "other-session" | "complete";

/** Collects parts in any order; restarts automatically if a NEW transfer is scanned after an old one. */
export class ChunkCollector {
  private sessionId: string | null = null;
  private dataCrc: string | null = null;
  private total = 0;
  private readonly parts = new Map<number, string>();
  private rejected = 0;

  get progress(): { received: number; total: number; ratio: number; rejected: number } {
    return { received: this.parts.size, total: this.total, ratio: this.total ? this.parts.size / this.total : 0, rejected: this.rejected };
  }

  get missing(): number[] {
    return Array.from({ length: this.total }, (_, i) => i).filter((i) => !this.parts.has(i));
  }

  get complete(): boolean {
    return this.total > 0 && this.parts.size === this.total;
  }

  reset(): void {
    this.sessionId = null;
    this.dataCrc = null;
    this.total = 0;
    this.parts.clear();
    this.rejected = 0;
  }

  add(raw: string, options: { switchSession?: boolean } = {}): AddStatus {
    const parsed = parseChunk(raw);
    if (!parsed.ok) {
      if (parsed.reason === "corrupt") this.rejected += 1;
      return parsed.reason;
    }
    const { chunk } = parsed;
    if (this.sessionId && (chunk.sessionId !== this.sessionId || chunk.dataCrc !== this.dataCrc || chunk.total !== this.total)) {
      if (!options.switchSession) return "other-session";
      this.reset();
    }
    if (!this.sessionId) {
      this.sessionId = chunk.sessionId;
      this.dataCrc = chunk.dataCrc;
      this.total = chunk.total;
    }
    if (this.parts.has(chunk.index)) return "duplicate";
    this.parts.set(chunk.index, chunk.payload);
    return this.complete ? "complete" : "accepted";
  }

  /** Joins parts and verifies the whole-data checksum. */
  assemble(): Uint8Array {
    if (!this.complete) throw new Error("Transfer is incomplete");
    const encoded = Array.from({ length: this.total }, (_, i) => this.parts.get(i) ?? "").join("");
    const bytes = decodeBase45(encoded);
    if (crc32Hex(bytes) !== this.dataCrc) throw new Error("Checksum mismatch");
    return bytes;
  }
}
