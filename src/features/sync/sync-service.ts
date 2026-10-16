import { base64ToBytes, bytesToBase64 } from "@/lib/crypto/encoding";
import { createPartCrypto, openPart, partCryptoFor, sealPart, BackupDecryptError } from "@/lib/backup/format";
import { parseData, stringifyData } from "@/lib/backup/serialize";
import { logger } from "@/lib/logger";
import { BACKUP_PASSPHRASE_SECRET, type Attachment, type SyncConflict, type SyncRecordState } from "@/lib/models";
import type { BlobStore } from "@/lib/storage/types";
import {
  MAX_CHANGES_PER_DELTA,
  SYNC_DELTA_FORMAT,
  SYNC_KEY_FORMAT,
  SYNC_TABLES,
  deltaFileName,
  fromSyncable,
  hashRecord,
  labelOf,
  parseDeltaFileName,
  primaryKeyOf,
  recordId,
  recordKey,
  remoteWins,
  syncDeltaSchema,
  toSyncable,
  type SyncChange,
  type SyncDelta,
} from "@/lib/sync/records";
import { gunzip, gzip } from "@/lib/transfer/compression";
import { WebDavError, withRetry, type WebDavClient } from "@/lib/webdav/client";
import { BackupError } from "@/features/backup/errors";
import { createRemote, getSecretText, isOnline, joinPath, type RemoteDeps } from "@/features/backup/remote";

export const SYNC_CURSORS_KEY = "sync:cursors";
const SEQ_KEY = "sync:seq";
const PENDING_KEY = "sync:pending";
const LAST_SYNC_KEY = "sync:last";

export interface SyncServiceDeps extends RemoteDeps {
  deviceId: () => Promise<string>;
  readBlob: (attachment: Attachment) => Promise<Blob | undefined>;
  writeBlob: (attachment: Attachment, blob: Blob) => Promise<Attachment["storage"]>;
  scratch: BlobStore;
  /** Remote changes were applied (memory index, UI caches). */
  onApplied?: (tables: Set<string>) => void;
  audit?: (kind: "sync_completed" | "sync_failed" | "sync_conflict", detail: string) => void;
  clock?: () => number;
  iterations?: number;
  newId?: () => string;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  at: number;
}

export interface LastSyncInfo {
  at: number;
  pushed: number;
  pulled: number;
  conflicts: number;
  error: string | null;
}

interface PendingDelta {
  seq: number;
  scratchId: string;
  states: SyncRecordState[];
}

interface KeyFile {
  format: typeof SYNC_KEY_FORMAT;
  version: 1;
  encrypted: boolean;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string } | null;
  check: string | null;
}

const CHECK_TEXT = "nova-sync-check";

/**
 * Incremental sync over WebDAV, no server logic required.
 *
 * Remote layout (under <root>/sync):
 *   key.json                          encryption parameters + passphrase check
 *   devices/<deviceId>/<seq>.delta    append-only change files (gzip [+ AES-GCM])
 *   blobs/<attachmentId>              attachment contents
 *
 * Change detection compares each record's content hash with the last synced base
 * (syncRecords), so no write path needs hooks; deletions become tombstones (deletedAt).
 * Each change carries rev (per-record revision), updatedAt and deviceId. Pull keeps a cursor
 * per remote device. Conflicts (both sides changed since the base) resolve last-writer-wins
 * by default and are logged for review; the losing version can be restored from the log.
 * Built deltas are stored locally before upload and re-sent byte-for-byte, so retries are safe.
 */
export class SyncService {
  private running: Promise<SyncResult> | null = null;
  private key: { passphrase: string; key: CryptoKey | null } | null = null;
  private readonly clock: () => number;

  constructor(private readonly deps: SyncServiceDeps) {
    this.clock = deps.clock ?? (() => Date.now());
  }

  get busy(): boolean {
    return this.running !== null;
  }

  lastSync(): Promise<LastSyncInfo | undefined> {
    return this.deps.repos.sync.getState<LastSyncInfo>(LAST_SYNC_KEY);
  }

  /** Runs push + pull once (single-flight). */
  sync(options: { signal?: AbortSignal } = {}): Promise<SyncResult> {
    if (this.running) return this.running;
    const run = this.syncOnce(options).finally(() => {
      this.running = null;
    });
    this.running = run;
    return run;
  }

  private async syncOnce(options: { signal?: AbortSignal }): Promise<SyncResult> {
    if (!isOnline()) throw new BackupError("offline", "Offline: sync will run when the connection is back");
    try {
      const { client, root } = await createRemote(this.deps);
      const base = joinPath(root, "sync");
      const deviceId = await this.deps.deviceId();
      const settings = (await this.deps.repos.settings.get()).backup.sync;
      await withRetry(() => client.ensureDir(joinPath(base, "devices", deviceId), options.signal), { signal: options.signal });
      await withRetry(() => client.ensureDir(joinPath(base, "blobs"), options.signal), { signal: options.signal });
      const key = await this.resolveKey(client, base, settings.encrypt);
      // Pull first so local edits are compared against the newest remote state.
      const pulled = await this.pull(client, base, deviceId, key, options.signal);
      const pushed = await this.push(client, base, deviceId, key, settings, options.signal);
      const result: SyncResult = { pushed, pulled: pulled.applied, conflicts: pulled.conflicts, at: this.clock() };
      await this.deps.repos.sync.setState(LAST_SYNC_KEY, { ...result, error: null } satisfies LastSyncInfo);
      if (pushed || pulled.applied) this.deps.audit?.("sync_completed", `pushed ${pushed}, pulled ${pulled.applied}, conflicts ${pulled.conflicts}`);
      return result;
    } catch (error) {
      if (!(error instanceof WebDavError && error.code === "aborted")) {
        const message = error instanceof Error ? error.message : String(error);
        const last = await this.lastSync();
        await this.deps.repos.sync.setState(LAST_SYNC_KEY, { at: last?.at ?? 0, pushed: 0, pulled: 0, conflicts: 0, error: message.slice(0, 300) } satisfies LastSyncInfo);
        this.deps.audit?.("sync_failed", message);
      }
      throw error;
    }
  }

  /** Forgets the sync base (next sync compares everything again; nothing is deleted). */
  async reset(): Promise<void> {
    await this.deps.repos.sync.clearRecords();
    await this.deps.repos.sync.deleteState(SYNC_CURSORS_KEY);
    await this.deps.repos.sync.deleteState(PENDING_KEY);
    this.key = null;
  }

  // ------------------------------------------------------------ encryption

  private async resolveKey(client: WebDavClient, base: string, encrypt: boolean): Promise<CryptoKey | null> {
    const passphrase = encrypt ? await getSecretText(this.deps, BACKUP_PASSPHRASE_SECRET) : undefined;
    if (encrypt && !passphrase) throw new BackupError("passphrase_required", "Set the backup passphrase to sync encrypted");
    if (this.key && this.key.passphrase === (passphrase ?? "")) return this.key.key;
    const path = joinPath(base, "key.json");
    let file: KeyFile | null = null;
    try {
      file = JSON.parse(await client.getText(path)) as KeyFile;
    } catch (error) {
      if (!(error instanceof WebDavError && error.code === "not_found")) throw error;
    }
    let key: CryptoKey | null = null;
    if (!file) {
      // First device: publish the parameters.
      if (encrypt) {
        const crypto = await createPartCrypto(passphrase!, { iterations: this.deps.iterations });
        key = crypto.key;
        const check = await sealPart(new TextEncoder().encode(CHECK_TEXT), key, "sync", 0);
        file = { format: SYNC_KEY_FORMAT, version: 1, encrypted: true, kdf: crypto.kdf, check: bytesToBase64(check) };
      } else file = { format: SYNC_KEY_FORMAT, version: 1, encrypted: false, kdf: null, check: null };
      await client.put(path, JSON.stringify(file), { contentType: "application/json" });
    } else {
      if (file.format !== SYNC_KEY_FORMAT) throw new BackupError("corrupted", "The sync folder is not a Nova sync folder");
      if (file.encrypted !== encrypt) throw new BackupError("corrupted", file.encrypted ? "Sync on this server is encrypted: turn encryption on" : "Sync on this server is not encrypted: turn encryption off");
      if (file.encrypted && file.kdf && file.check) {
        key = await partCryptoFor(passphrase!, file.kdf);
        try {
          const text = new TextDecoder().decode(await openPart(base64ToBytes(file.check), key, "sync", 0));
          if (text !== CHECK_TEXT) throw new BackupDecryptError();
        } catch {
          throw new BackupError("wrong_passphrase", "Wrong sync passphrase");
        }
      }
    }
    this.key = { passphrase: passphrase ?? "", key };
    return key;
  }

  private async encode(delta: SyncDelta, key: CryptoKey | null): Promise<Uint8Array> {
    const packed = await gzip(new TextEncoder().encode(stringifyData(delta)));
    return sealPart(packed, key, `${delta.deviceId}:${delta.seq}`, 0);
  }

  private async decode(bytes: Uint8Array, key: CryptoKey | null, deviceId: string, seq: number): Promise<SyncDelta> {
    let plain: Uint8Array;
    try {
      plain = await openPart(bytes, key, `${deviceId}:${seq}`, 0);
    } catch {
      throw new BackupError("wrong_passphrase", "Could not decrypt a sync file");
    }
    const parsed = syncDeltaSchema.safeParse(parseData(new TextDecoder().decode(await gunzip(plain))));
    if (!parsed.success || parsed.data.deviceId !== deviceId || parsed.data.seq !== seq) throw new BackupError("corrupted", "Invalid sync file");
    return parsed.data;
  }

  // ------------------------------------------------------------ push

  private async push(client: WebDavClient, base: string, deviceId: string, key: CryptoKey | null, settings: { includeAttachments: boolean; maxAttachmentMb: number }, signal?: AbortSignal): Promise<number> {
    const { repos } = this.deps;
    let pushed = 0;
    // 1) Re-send deltas that were built but not confirmed (identical bytes: safe retry).
    let pending = (await repos.sync.getState<PendingDelta[]>(PENDING_KEY)) ?? [];
    if (!pending.length) pending = await this.buildDeltas(deviceId, key, settings, client, base, signal);
    for (const delta of [...pending]) {
      const blob = await this.deps.scratch.get(delta.scratchId);
      if (!blob) {
        // Lost scratch data: drop it, the next run rebuilds from the base.
        pending = pending.filter((p) => p !== delta);
        await repos.sync.setState(PENDING_KEY, pending);
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await withRetry(() => client.put(joinPath(base, "devices", deviceId, deltaFileName(delta.seq)), bytes, { signal }), { signal });
      await repos.sync.putRecords(delta.states);
      await repos.sync.setState(SEQ_KEY, delta.seq);
      pending = pending.filter((p) => p !== delta);
      await repos.sync.setState(PENDING_KEY, pending);
      await this.deps.scratch.delete(delta.scratchId).catch(() => undefined);
      pushed += delta.states.length;
    }
    return pushed;
  }

  /** Compares every record with its synced base and writes the changes as pending deltas. */
  private async buildDeltas(deviceId: string, key: CryptoKey | null, settings: { includeAttachments: boolean; maxAttachmentMb: number }, client: WebDavClient, base: string, signal?: AbortSignal): Promise<PendingDelta[]> {
    const { repos } = this.deps;
    const now = this.clock();
    const states = new Map((await repos.sync.records()).map((s) => [s.key, s]));
    const changes: SyncChange[] = [];
    const nextStates: SyncRecordState[] = [];
    const seen = new Set<string>();
    const uploadBlobs: Attachment[] = [];
    for (const table of SYNC_TABLES) {
      for (const row of await repos.backup.rows(table)) {
        if (table === "settings" && row.key !== "app") continue;
        const id = recordId(table, row);
        const key = recordKey(table, id);
        seen.add(key);
        const hash = hashRecord(table, row);
        const state = states.get(key);
        if (state && !state.deleted && state.hash === hash) continue;
        const rev = (state?.rev ?? 0) + 1;
        const updatedAt = typeof row.updatedAt === "number" ? row.updatedAt : now;
        changes.push({ op: "put", table, id, rev, updatedAt, deviceId, hash, data: toSyncable(table, row) });
        nextStates.push({ key, table, recordId: id, hash, rev, updatedAt, deviceId, deleted: false });
        if (table === "attachments" && settings.includeAttachments) uploadBlobs.push(row as unknown as Attachment);
      }
    }
    for (const state of states.values()) {
      if (state.deleted || seen.has(state.key)) continue;
      const rev = state.rev + 1;
      changes.push({ op: "delete", table: state.table as SyncChange["table"], id: state.recordId, rev, updatedAt: now, deletedAt: now, deviceId, hash: null });
      nextStates.push({ ...state, hash: null, rev, updatedAt: now, deviceId, deleted: true });
    }
    if (!changes.length) return [];

    // Blobs go up before the deltas that reference them.
    if (uploadBlobs.length) {
      const remote = new Set((await client.list(joinPath(base, "blobs"), signal)).map((e) => e.name));
      for (const attachment of uploadBlobs) {
        if (remote.has(attachment.id) || attachment.size > settings.maxAttachmentMb * 1024 * 1024) continue;
        const blob = await this.deps.readBlob(attachment).catch(() => undefined);
        if (!blob) continue;
        const sealed = await sealPart(new Uint8Array(await blob.arrayBuffer()), key, `blob:${attachment.id}`, 0);
        await withRetry(() => client.put(joinPath(base, "blobs", attachment.id), sealed, { signal }), { signal });
      }
    }

    let seq = (await repos.sync.getState<number>(SEQ_KEY)) ?? 0;
    const pending: PendingDelta[] = [];
    for (let i = 0; i < changes.length; i += MAX_CHANGES_PER_DELTA) {
      seq += 1;
      const delta: SyncDelta = { format: SYNC_DELTA_FORMAT, version: 1, deviceId, seq, createdAt: now, changes: changes.slice(i, i + MAX_CHANGES_PER_DELTA) };
      const scratchId = `sync-out:${deviceId}:${seq}`;
      await this.deps.scratch.put(scratchId, new Blob([(await this.encode(delta, key)) as BlobPart]));
      pending.push({ seq, scratchId, states: nextStates.slice(i, i + MAX_CHANGES_PER_DELTA) });
    }
    await repos.sync.setState(PENDING_KEY, pending);
    return pending;
  }

  // ------------------------------------------------------------ pull

  private async pull(client: WebDavClient, base: string, deviceId: string, key: CryptoKey | null, signal?: AbortSignal): Promise<{ applied: number; conflicts: number }> {
    const { repos } = this.deps;
    const cursors = (await repos.sync.getState<Record<string, number>>(SYNC_CURSORS_KEY)) ?? {};
    const devices = (await withRetry(() => client.list(joinPath(base, "devices"), signal), { signal })).filter((e) => e.isCollection && e.name !== deviceId);
    let applied = 0;
    let conflicts = 0;
    const touched = new Set<string>();
    for (const device of devices) {
      const files = (await withRetry(() => client.list(joinPath(base, "devices", device.name), signal), { signal }))
        .map((e) => ({ name: e.name, seq: parseDeltaFileName(e.name) }))
        .filter((f): f is { name: string; seq: number } => f.seq !== null && f.seq > (cursors[device.name] ?? 0))
        .sort((a, b) => a.seq - b.seq);
      for (const file of files) {
        const { bytes } = await withRetry(() => client.get(joinPath(base, "devices", device.name, file.name), { signal }), { signal });
        const delta = await this.decode(bytes, key, device.name, file.seq);
        const result = await this.apply(delta, deviceId, client, base, key, signal);
        applied += result.applied;
        conflicts += result.conflicts;
        for (const t of result.tables) touched.add(t);
        cursors[device.name] = file.seq;
        // Cursor saved per file: an interrupted pull resumes after the last applied file.
        await repos.sync.setState(SYNC_CURSORS_KEY, cursors);
      }
    }
    if (touched.size) this.deps.onApplied?.(touched);
    return { applied, conflicts };
  }

  private async apply(delta: SyncDelta, deviceId: string, client: WebDavClient, base: string, key: CryptoKey | null, signal?: AbortSignal): Promise<{ applied: number; conflicts: number; tables: Set<string> }> {
    const { repos } = this.deps;
    const now = this.clock();
    const keys = delta.changes.map((c) => recordKey(c.table, c.id));
    const states = new Map((await repos.sync.records(keys)).map((s) => [s.key, s]));
    const puts = new Map<string, Record<string, unknown>[]>();
    const deletes = new Map<string, string[]>();
    const nextStates: SyncRecordState[] = [];
    const tables = new Set<string>();
    const blobsToFetch: Attachment[] = [];
    let applied = 0;
    let conflicts = 0;

    // Current local rows, per table.
    const locals = new Map<string, Record<string, unknown> | undefined>();
    const byTable = new Map<string, string[]>();
    for (const c of delta.changes) byTable.set(c.table, [...(byTable.get(c.table) ?? []), c.id]);
    for (const [table, ids] of byTable) {
      const rows = await repos.backup.getRows(table, ids);
      ids.forEach((id, i) => locals.set(recordKey(table, id), rows[i]));
    }

    for (const change of delta.changes) {
      const key = recordKey(change.table, change.id);
      const state = states.get(key);
      const local = locals.get(key);
      const localHash = local ? hashRecord(change.table, local) : null;
      const remoteState: SyncRecordState = { key, table: change.table, recordId: change.id, hash: change.hash, rev: change.rev, updatedAt: change.updatedAt, deviceId: change.deviceId, deleted: change.op === "delete" };
      // Duplicate / already-equal: just advance the base.
      if (localHash === change.hash) {
        nextStates.push({ ...remoteState, rev: Math.max(change.rev, state?.rev ?? 0) });
        continue;
      }
      // Older than what we already merged.
      if (state && change.rev < state.rev) continue;
      const baseHash = state && !state.deleted ? state.hash : null;
      const localChanged = state ? localHash !== baseHash : local !== undefined;
      const takeRemote = () => {
        if (change.op === "delete") deletes.set(change.table, [...(deletes.get(change.table) ?? []), change.id]);
        else {
          const row = fromSyncable(change.table, change.data ?? {}, local, now);
          puts.set(change.table, [...(puts.get(change.table) ?? []), row]);
          if (change.table === "attachments") blobsToFetch.push(row as unknown as Attachment);
        }
        nextStates.push(remoteState);
        tables.add(change.table);
        applied += 1;
      };
      if (!localChanged) {
        takeRemote();
        continue;
      }
      // Both sides changed since the base: last writer wins, the loser goes to the conflict log.
      conflicts += 1;
      const localUpdatedAt = local && typeof local.updatedAt === "number" ? local.updatedAt : (state?.updatedAt ?? now);
      const winnerRemote = remoteWins({ updatedAt: localUpdatedAt, deviceId }, { updatedAt: change.updatedAt, deviceId: change.deviceId });
      const conflict: SyncConflict = {
        id: this.deps.newId?.() ?? crypto.randomUUID(),
        table: change.table,
        recordId: change.id,
        label: labelOf(change.table, (change.data as Record<string, unknown> | undefined) ?? local),
        local: local ? toSyncable(change.table, local) : null,
        remote: change.data ?? null,
        localUpdatedAt,
        remoteUpdatedAt: change.updatedAt,
        remoteDeviceId: change.deviceId,
        winner: winnerRemote ? "remote" : "local",
        status: "open",
        createdAt: now,
        resolvedAt: null,
      };
      await repos.sync.addConflict(conflict);
      this.deps.audit?.("sync_conflict", `${change.table} "${conflict.label}" → ${conflict.winner}`);
      if (winnerRemote) takeRemote();
      // Local wins: the base becomes the remote version, so the next push sends ours with rev+1.
      else nextStates.push(remoteState);
    }

    for (const [table, rows] of puts) await repos.backup.putRows(table, rows);
    for (const [table, ids] of deletes) await repos.backup.deleteRows(table, ids);
    await repos.sync.putRecords(nextStates);

    for (const attachment of blobsToFetch) {
      if (await this.deps.readBlob(attachment).catch(() => undefined)) continue;
      try {
        const { bytes } = await withRetry(() => client.get(joinPath(base, "blobs", attachment.id), { signal }), { signal, attempts: 3 });
        const plain = await openPart(bytes, key, `blob:${attachment.id}`, 0);
        const storage = await this.deps.writeBlob(attachment, new Blob([plain as BlobPart], { type: attachment.mimeType }));
        if (storage !== attachment.storage) await repos.backup.putRows("attachments", [{ ...(attachment as unknown as Record<string, unknown>), storage }]);
      } catch (error) {
        if (!(error instanceof WebDavError && error.code === "not_found")) logger.warn("Sync: attachment download failed", error);
      }
    }
    return { applied, conflicts, tables };
  }

  // ------------------------------------------------------------ conflicts

  conflicts(status?: SyncConflict["status"]): Promise<SyncConflict[]> {
    return this.deps.repos.sync.conflicts(status);
  }

  /**
   * Keeps one version. Choosing the version that lost rewrites it with a fresh updatedAt,
   * so it wins everywhere on the next sync.
   */
  async resolveConflict(id: string, choice: "local" | "remote"): Promise<void> {
    const { repos } = this.deps;
    const conflict = await repos.sync.getConflict(id);
    if (!conflict) return;
    if (choice !== conflict.winner) {
      const chosen = (choice === "local" ? conflict.local : conflict.remote) as Record<string, unknown> | null;
      const now = this.clock();
      if (chosen) {
        const [current] = await repos.backup.getRows(conflict.table, [conflict.recordId]);
        const row = fromSyncable(conflict.table, chosen, current, now);
        await repos.backup.putRows(conflict.table, [{ ...row, updatedAt: now, [primaryKeyOf(conflict.table)]: conflict.recordId }]);
      } else await repos.backup.deleteRows(conflict.table, [conflict.recordId]);
      this.deps.onApplied?.(new Set([conflict.table]));
    }
    await repos.sync.resolveConflict(id, this.clock());
  }
}
