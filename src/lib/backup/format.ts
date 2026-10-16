import { z } from "zod";
import { base64ToBytes, bytesToBase64 } from "@/lib/crypto/encoding";
import { DEFAULT_PBKDF2_ITERATIONS, deriveKey } from "@/lib/transfer/crypto-file";
import { concatBytes, sha256Hex } from "./archive";

export const BACKUP_FORMAT = "nova-backup";
export const DEFAULT_PART_SIZE = 4 * 1024 * 1024;
const IV_BYTES = 12;

export const backupManifestSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(1),
  id: z.string().regex(/^[A-Za-z0-9-]{8,80}$/),
  createdAt: z.string().datetime(),
  app: z.object({ version: z.string().max(32) }),
  device: z.object({ id: z.string().max(100), label: z.string().max(100) }),
  encrypted: z.boolean(),
  kdf: z.object({ name: z.literal("PBKDF2"), hash: z.literal("SHA-256"), iterations: z.number().int().min(100_000).max(10_000_000), salt: z.string().min(16).max(200) }).nullable(),
  compression: z.enum(["gzip", "none"]),
  /** Uncompressed archive. */
  archiveSize: z.number().int().nonnegative(),
  archiveSha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Bytes stored remotely (sum of parts). */
  storedSize: z.number().int().nonnegative(),
  partSize: z.number().int().min(64 * 1024).max(256 * 1024 * 1024),
  parts: z.array(z.object({ index: z.number().int().nonnegative(), size: z.number().int().nonnegative(), sha256: z.string().regex(/^[0-9a-f]{64}$/) })).max(100_000),
  counts: z.record(z.string().max(64), z.number().int().nonnegative()),
  includesAttachments: z.boolean(),
  includesSecrets: z.boolean(),
});
export type BackupManifest = z.infer<typeof backupManifestSchema>;

export function partName(index: number): string {
  return `part-${String(index).padStart(5, "0")}.bin`;
}

/** Sortable, URL-safe id: 2026-10-16T04-46-00Z-a1b2c3 */
export function newBackupId(now: Date, random: () => string): string {
  return `${now.toISOString().slice(0, 19).replace(/:/g, "-")}Z-${random()}`;
}

export interface PartCrypto {
  key: CryptoKey;
  kdf: NonNullable<BackupManifest["kdf"]>;
}

export async function createPartCrypto(passphrase: string, options: { iterations?: number; random?: (b: Uint8Array) => Uint8Array; subtle?: SubtleCrypto } = {}): Promise<PartCrypto> {
  const subtle = options.subtle ?? globalThis.crypto.subtle;
  const salt = (options.random ?? ((b) => globalThis.crypto.getRandomValues(b)))(new Uint8Array(16));
  const iterations = options.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  return { key: await deriveKey(passphrase, salt, iterations, subtle), kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: bytesToBase64(salt) } };
}

export async function partCryptoFor(passphrase: string, kdf: NonNullable<BackupManifest["kdf"]>, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<CryptoKey> {
  return deriveKey(passphrase, base64ToBytes(kdf.salt), kdf.iterations, subtle);
}

/** Each part is sealed on its own (AES-GCM, AAD = backup id + index) so parts can be re-sent independently. */
export async function sealPart(data: Uint8Array, key: CryptoKey | null, backupId: string, index: number, random: (b: Uint8Array) => Uint8Array = (b) => globalThis.crypto.getRandomValues(b)): Promise<Uint8Array> {
  if (!key) return data;
  const iv = random(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: new TextEncoder().encode(`${backupId}:${index}`) }, key, data as BufferSource),
  );
  return concatBytes([iv, sealed]);
}

export class BackupDecryptError extends Error {
  constructor() {
    super("Wrong passphrase or corrupted backup");
    this.name = "BackupDecryptError";
  }
}

export async function openPart(stored: Uint8Array, key: CryptoKey | null, backupId: string, index: number): Promise<Uint8Array> {
  if (!key) return stored;
  if (stored.byteLength <= IV_BYTES) throw new BackupDecryptError();
  try {
    return new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: stored.subarray(0, IV_BYTES) as BufferSource, additionalData: new TextEncoder().encode(`${backupId}:${index}`) },
        key,
        stored.subarray(IV_BYTES) as BufferSource,
      ),
    );
  } catch {
    throw new BackupDecryptError();
  }
}

export function splitParts(payload: Uint8Array, partSize: number): Uint8Array[] {
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < payload.byteLength; offset += partSize) parts.push(payload.subarray(offset, Math.min(payload.byteLength, offset + partSize)));
  if (!parts.length) parts.push(new Uint8Array(0));
  return parts;
}

export async function describeParts(parts: readonly Uint8Array[]): Promise<BackupManifest["parts"]> {
  return Promise.all(parts.map(async (p, index) => ({ index, size: p.byteLength, sha256: await sha256Hex(p) })));
}
