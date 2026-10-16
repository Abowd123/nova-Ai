import { z } from "zod";
import { DEFAULT_BACKUP_SETTINGS, DEFAULT_DEVICE_SETTINGS } from "@/lib/models";

/** Tables that sync between devices (memory vectors are rebuilt locally; usage stays local). */
export const SYNC_TABLES = [
  "settings",
  "providers",
  "assistants",
  "tags",
  "conversations",
  "messages",
  "attachments",
  "imageGenerations",
  "comfyWorkflows",
  "memoryChunks",
  "summaries",
  "lorebooks",
  "mcpServers",
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

export const primaryKeyOf = (table: string) => (table === "settings" ? "key" : "id");

export function recordId(table: string, row: Record<string, unknown>): string {
  return String(row[primaryKeyOf(table)]);
}

export const recordKey = (table: string, id: string) => `${table}:${id}`;

/**
 * The device-independent view of a record. Device-bound fields never leave the device:
 * provider key ciphertexts, the WebDAV/backup configuration, where an attachment blob is stored.
 */
export function toSyncable(table: string, row: Record<string, unknown>): Record<string, unknown> {
  if (table === "providers") {
    const { encryptedApiKey: _k, encryptedHeaders: _h, ...rest } = row;
    return rest;
  }
  if (table === "settings") {
    const value = row.value && typeof row.value === "object" ? { ...(row.value as Record<string, unknown>) } : row.value;
    if (value && typeof value === "object") {
      delete (value as Record<string, unknown>).backup;
      delete (value as Record<string, unknown>).device;
    }
    const { updatedAt: _u, ...rest } = row;
    return { ...rest, value };
  }
  if (table === "attachments") {
    const { storage: _s, ...rest } = row;
    return rest;
  }
  return row;
}

/** Merges a remote record with the local device-bound fields. */
export function fromSyncable(table: string, remote: Record<string, unknown>, local: Record<string, unknown> | undefined, now: number): Record<string, unknown> {
  if (table === "providers") return { ...remote, encryptedApiKey: local?.encryptedApiKey ?? null, encryptedHeaders: local?.encryptedHeaders ?? null };
  if (table === "settings") {
    const localValue = (local?.value ?? {}) as Record<string, unknown>;
    const value = remote.value && typeof remote.value === "object" ? { ...(remote.value as Record<string, unknown>), backup: localValue.backup ?? DEFAULT_BACKUP_SETTINGS, device: localValue.device ?? DEFAULT_DEVICE_SETTINGS } : remote.value;
    return { ...remote, value, updatedAt: now };
  }
  if (table === "attachments") return { ...remote, storage: local?.storage ?? "idb" };
  return remote;
}

/** Deterministic JSON (sorted keys) so equal records hash equally on every device. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (ArrayBuffer.isView(value)) return JSON.stringify(Array.from(value as unknown as ArrayLike<number>));
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : stableStringify(v))).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** cyrb53-style 64-bit hash (fast, non-cryptographic; only used to detect changes). */
export function hashString(text: string): string {
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

export const hashRecord = (table: string, row: Record<string, unknown>) => hashString(stableStringify(toSyncable(table, row)));

/** Short label for the conflict review screen. */
export function labelOf(table: string, row: Record<string, unknown> | null | undefined): string {
  if (!row) return "";
  const pick = (k: string) => (typeof row[k] === "string" && row[k] ? String(row[k]) : "");
  const text = pick("title") || pick("name") || pick("content") || pick("text") || pick("key") || String(row.id ?? "");
  return text.replace(/\s+/g, " ").trim().slice(0, 120) || table;
}

// ---------------------------------------------------------------- wire format

export const SYNC_DELTA_FORMAT = "nova-sync-delta";
export const SYNC_KEY_FORMAT = "nova-sync-key";
/** Changes per delta file (keeps files small; first sync spans several). */
export const MAX_CHANGES_PER_DELTA = 1000;

export const syncChangeSchema = z.object({
  op: z.enum(["put", "delete"]),
  table: z.enum(SYNC_TABLES),
  id: z.string().min(1).max(256),
  rev: z.number().int().positive(),
  updatedAt: z.number().int().nonnegative(),
  deletedAt: z.number().int().nonnegative().optional(),
  deviceId: z.string().min(1).max(100),
  hash: z.string().max(32).nullable(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type SyncChange = z.infer<typeof syncChangeSchema>;

export const syncDeltaSchema = z.object({
  format: z.literal(SYNC_DELTA_FORMAT),
  version: z.literal(1),
  deviceId: z.string().min(1).max(100),
  seq: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  changes: z.array(syncChangeSchema).max(MAX_CHANGES_PER_DELTA),
});
export type SyncDelta = z.infer<typeof syncDeltaSchema>;

export const deltaFileName = (seq: number) => `${String(seq).padStart(10, "0")}.delta`;
export const parseDeltaFileName = (name: string): number | null => {
  const match = /^(\d{10})\.delta$/.exec(name);
  return match ? Number(match[1]) : null;
};

/** LWW: newer updatedAt wins; ties go to the larger device id (same answer on every device). */
export function remoteWins(local: { updatedAt: number; deviceId: string }, remote: { updatedAt: number; deviceId: string }): boolean {
  if (remote.updatedAt !== local.updatedAt) return remote.updatedAt > local.updatedAt;
  return remote.deviceId > local.deviceId;
}
