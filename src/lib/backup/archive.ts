/**
 * Nova archive: one binary container for a full backup.
 *
 *   "NOVAARC1" (8 bytes) | header length (uint32 BE) | header JSON (UTF-8) | entry bytes…
 *
 * The header lists every entry with its size and SHA-256 so corruption is detected per entry.
 */
const MAGIC = new TextEncoder().encode("NOVAARC1");
export const MAX_ARCHIVE_HEADER = 32 * 1024 * 1024;

export interface ArchiveEntryInput {
  name: string;
  data: Uint8Array;
  mime?: string;
}

export interface ArchiveEntryMeta {
  name: string;
  size: number;
  sha256: string;
  mime?: string;
}

export interface ArchiveHeader {
  format: "nova-archive";
  version: 1;
  createdAt: string;
  entries: ArchiveEntryMeta[];
}

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}

export async function sha256Hex(bytes: Uint8Array, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<string> {
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes as BufferSource));
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const safeName = (name: string) => /^[A-Za-z0-9._\-/:]{1,300}$/.test(name) && !name.includes("..");

export async function packArchive(entries: readonly ArchiveEntryInput[], createdAt = new Date()): Promise<Uint8Array> {
  const seen = new Set<string>();
  const metas: ArchiveEntryMeta[] = [];
  for (const entry of entries) {
    if (!safeName(entry.name)) throw new ArchiveError(`Invalid entry name: ${entry.name}`);
    if (seen.has(entry.name)) throw new ArchiveError(`Duplicate entry: ${entry.name}`);
    seen.add(entry.name);
    metas.push({ name: entry.name, size: entry.data.byteLength, sha256: await sha256Hex(entry.data), ...(entry.mime ? { mime: entry.mime } : {}) });
  }
  const header: ArchiveHeader = { format: "nova-archive", version: 1, createdAt: createdAt.toISOString(), entries: metas };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, headerBytes.byteLength, false);
  return concatBytes([MAGIC, length, headerBytes, ...entries.map((e) => e.data)]);
}

export interface UnpackedArchive {
  header: ArchiveHeader;
  entries: Map<string, Uint8Array>;
}

export async function unpackArchive(bytes: Uint8Array): Promise<UnpackedArchive> {
  if (bytes.byteLength < 12 || !MAGIC.every((b, i) => bytes[i] === b)) throw new ArchiveError("Not a Nova archive");
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset + 8, 4).getUint32(0, false);
  if (headerLength > MAX_ARCHIVE_HEADER || 12 + headerLength > bytes.byteLength) throw new ArchiveError("Archive header is corrupted");
  let header: ArchiveHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + headerLength))) as ArchiveHeader;
  } catch {
    throw new ArchiveError("Archive header is corrupted");
  }
  if (header?.format !== "nova-archive" || header.version !== 1 || !Array.isArray(header.entries)) throw new ArchiveError("Unsupported archive version");
  const entries = new Map<string, Uint8Array>();
  let offset = 12 + headerLength;
  for (const meta of header.entries) {
    if (!safeName(meta.name) || !Number.isInteger(meta.size) || meta.size < 0) throw new ArchiveError("Archive entry is invalid");
    if (offset + meta.size > bytes.byteLength) throw new ArchiveError(`Archive is truncated (${meta.name})`);
    const data = bytes.subarray(offset, offset + meta.size);
    if ((await sha256Hex(data)) !== meta.sha256) throw new ArchiveError(`Checksum mismatch: ${meta.name}`);
    entries.set(meta.name, data);
    offset += meta.size;
  }
  return { header, entries };
}
