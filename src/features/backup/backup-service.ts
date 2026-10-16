import { secretContext, secretTableContext } from "@/lib/crypto/vault";
import { ArchiveError, concatBytes, packArchive, sha256Hex, unpackArchive, type ArchiveEntryInput } from "@/lib/backup/archive";
import {
  BACKUP_FORMAT,
  BackupDecryptError,
  DEFAULT_PART_SIZE,
  backupManifestSchema,
  createPartCrypto,
  describeParts,
  newBackupId,
  openPart,
  partCryptoFor,
  partName,
  sealPart,
  splitParts,
  type BackupManifest,
} from "@/lib/backup/format";
import { parseData, stringifyData } from "@/lib/backup/serialize";
import { logger } from "@/lib/logger";
import { BACKUP_PASSPHRASE_SECRET, DEFAULT_BACKUP_SETTINGS, WEBDAV_PASSWORD_SECRET, type Attachment, type WebDavSettings } from "@/lib/models";
import type { BlobStore } from "@/lib/storage/types";
import { compressionAvailable, gunzip, gzip } from "@/lib/transfer/compression";
import { WebDavError, withRetry, type WebDavClient } from "@/lib/webdav/client";
import { BackupError } from "./errors";
import { createRemote, getSecretText, joinPath, setSecretText, type RemoteDeps } from "./remote";

export type BackupPhase = "collecting" | "compressing" | "encrypting" | "uploading" | "finalizing" | "pruning" | "downloading" | "verifying" | "restoring";

export interface BackupProgress {
  phase: BackupPhase;
  done: number;
  total: number;
}

export interface BackupServiceDeps extends RemoteDeps {
  appVersion: string;
  device: () => Promise<{ id: string; label: string }>;
  /** Attachment blobs (IndexedDB or OPFS). */
  readBlob: (attachment: Attachment) => Promise<Blob | undefined>;
  /** Writes a restored blob; returns the storage actually used. */
  writeBlob: (attachment: Attachment, blob: Blob) => Promise<Attachment["storage"]>;
  /** Local scratch space for resumable transfers (IndexedDB blob table). */
  scratch: BlobStore;
  /** Called after a restore (memory index, caches, UI). */
  onRestored?: () => void;
  audit?: (kind: "backup_created" | "backup_failed" | "backup_restored" | "backup_deleted", detail: string) => void;
  clock?: () => number;
  random?: () => string;
  partSize?: number;
  /** PBKDF2 iterations (tests use fewer). */
  iterations?: number;
}

export interface BackupListItem {
  id: string;
  createdAt: number;
  /** Bytes on the server. */
  size: number;
  complete: boolean;
  manifest: BackupManifest | null;
}

export interface RestorePreview {
  manifest: BackupManifest;
  counts: Record<string, number>;
  /** Opaque, kept in memory until restore() or discard. */
  data: { tables: Record<string, Record<string, unknown>[]>; blobs: Map<string, Uint8Array>; secrets: ArchiveSecrets | null };
}

export interface ArchiveSecrets {
  providers: Record<string, { apiKey?: string; headers?: Record<string, string> }>;
  /** secrets table: id → plaintext (WebDAV credentials are never included). */
  secrets: Record<string, string>;
}

export interface ConnectionCheck {
  ok: boolean;
  steps: { step: "list" | "folder" | "write" | "read" | "delete"; ok: boolean; error?: string }[];
  nextcloud: boolean;
}

const UPLOAD_SESSION_KEY = "backup:upload-session";
const LAST_BACKUP_KEY = "backup:last";

interface UploadSession {
  id: string;
  manifest: BackupManifest;
  createdAt: number;
}

export interface LastBackupInfo {
  at: number;
  id: string | null;
  size: number;
  error: string | null;
}

const scratchUp = (id: string, index: number) => `backup-up:${id}:${index}`;
const scratchDown = (id: string, index: number) => `backup-down:${id}:${index}`;

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Full backups to WebDAV:
 *  archive (all data tables + attachment blobs [+ secrets when encrypted]) → gzip → 4 MB parts
 *  → each part AES-GCM sealed (optional) → PUT parts → manifest.json LAST (marks completion).
 * Uploads and downloads resume part by part; every part and the archive carry SHA-256 checksums.
 * API keys are only ever uploaded inside encrypted backups; plaintext backups contain no secrets.
 */
export class BackupService {
  private running: Promise<unknown> | null = null;
  private readonly clock: () => number;

  constructor(private readonly deps: BackupServiceDeps) {
    this.clock = deps.clock ?? (() => Date.now());
  }

  get busy(): boolean {
    return this.running !== null;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running) throw new BackupError("busy", "A backup task is already running");
    const run = fn().finally(() => {
      this.running = null;
    });
    this.running = run;
    return run;
  }

  // ------------------------------------------------------------ credentials

  async saveCredentials(password: string | undefined, passphrase: string | undefined): Promise<void> {
    if (password !== undefined) await setSecretText(this.deps, WEBDAV_PASSWORD_SECRET, password);
    if (passphrase !== undefined) await setSecretText(this.deps, BACKUP_PASSPHRASE_SECRET, passphrase);
  }

  async credentialState(): Promise<{ password: boolean; passphrase: boolean }> {
    return {
      password: await this.deps.repos.secrets.has(WEBDAV_PASSWORD_SECRET),
      passphrase: await this.deps.repos.secrets.has(BACKUP_PASSPHRASE_SECRET),
    };
  }

  lastBackup(): Promise<LastBackupInfo | undefined> {
    return this.deps.repos.sync.getState<LastBackupInfo>(LAST_BACKUP_KEY);
  }

  async pendingUpload(): Promise<{ id: string; parts: number } | null> {
    const session = await this.deps.repos.sync.getState<UploadSession>(UPLOAD_SESSION_KEY);
    return session ? { id: session.id, parts: session.manifest.parts.length } : null;
  }

  // ------------------------------------------------------------ connection test

  /** List → create folder → write → read back → delete. Works with Nextcloud, ownCloud, Apache/nginx DAV… */
  async testConnection(config?: WebDavSettings, password?: string): Promise<ConnectionCheck> {
    const { client, root } = await createRemote(this.deps, config, password);
    const steps: ConnectionCheck["steps"] = [];
    const run = async (step: ConnectionCheck["steps"][number]["step"], fn: () => Promise<void>) => {
      if (steps.some((s) => !s.ok)) return;
      try {
        await fn();
        steps.push({ step, ok: true });
      } catch (error) {
        steps.push({ step, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    };
    const probe = joinPath(root, `.nova-test-${this.deps.random?.() ?? Math.random().toString(36).slice(2, 8)}.txt`);
    const text = `nova ${new Date(this.clock()).toISOString()}`;
    await run("list", async () => void (await client.propfind("", 0)));
    await run("folder", () => client.ensureDir(joinPath(root, "backups")));
    await run("write", () => client.put(probe, text, { contentType: "text/plain" }));
    await run("read", async () => {
      if ((await client.getText(probe)) !== text) throw new Error("Read-back mismatch");
    });
    await run("delete", () => client.delete(probe));
    return { ok: steps.length === 5 && steps.every((s) => s.ok), steps, nextcloud: /\/remote\.php\/(dav|webdav)\//.test(client.base.pathname) };
  }

  // ------------------------------------------------------------ create

  createBackup(options: { onProgress?: (p: BackupProgress) => void; signal?: AbortSignal; passphrase?: string } = {}): Promise<BackupListItem> {
    return this.exclusive(async () => {
      try {
        const pending = await this.deps.repos.sync.getState<UploadSession>(UPLOAD_SESSION_KEY);
        if (pending) await this.discardSession(pending);
        const session = await this.prepare(options);
        const item = await this.upload(session, options);
        await this.prune(options.onProgress).catch((error: unknown) => logger.warn("Backup pruning failed", error));
        return item;
      } catch (error) {
        await this.recordFailure(error);
        throw error;
      }
    });
  }

  /** Continues an interrupted upload (network drop, closed tab) from the first missing part. */
  resumeUpload(options: { onProgress?: (p: BackupProgress) => void; signal?: AbortSignal } = {}): Promise<BackupListItem | null> {
    return this.exclusive(async () => {
      const session = await this.deps.repos.sync.getState<UploadSession>(UPLOAD_SESSION_KEY);
      if (!session) return null;
      try {
        const item = await this.upload(session, options);
        await this.prune(options.onProgress).catch((error: unknown) => logger.warn("Backup pruning failed", error));
        return item;
      } catch (error) {
        await this.recordFailure(error);
        throw error;
      }
    });
  }

  private async recordFailure(error: unknown): Promise<void> {
    if (error instanceof WebDavError && error.code === "aborted") return;
    const message = error instanceof Error ? error.message : String(error);
    const last = await this.lastBackup();
    await this.deps.repos.sync.setState(LAST_BACKUP_KEY, { at: last?.at ?? 0, id: last?.id ?? null, size: last?.size ?? 0, error: message.slice(0, 300) } satisfies LastBackupInfo);
    this.deps.audit?.("backup_failed", message);
  }

  private async discardSession(session: UploadSession): Promise<void> {
    for (const part of session.manifest.parts) await this.deps.scratch.delete(scratchUp(session.id, part.index)).catch(() => undefined);
    await this.deps.repos.sync.deleteState(UPLOAD_SESSION_KEY);
  }

  /** Builds the archive and stores sealed parts locally so the upload can resume. */
  private async prepare(options: { onProgress?: (p: BackupProgress) => void; passphrase?: string }): Promise<UploadSession> {
    const settings = await this.deps.repos.settings.get();
    const schedule = settings.backup.schedule;
    const passphrase = schedule.encrypt ? (options.passphrase ?? (await getSecretText(this.deps, BACKUP_PASSPHRASE_SECRET))) : undefined;
    if (schedule.encrypt && !passphrase) throw new BackupError("passphrase_required", "Set a backup passphrase or turn encryption off");
    if (!compressionAvailable()) throw new BackupError("compression_unavailable", "This browser cannot compress backups");

    options.onProgress?.({ phase: "collecting", done: 0, total: 1 });
    const { entries, counts, includesAttachments } = await this.collect(Boolean(passphrase), schedule.includeAttachments, schedule.maxAttachmentMb * 1024 * 1024, options.onProgress);
    const now = new Date(this.clock());
    const archive = await packArchive(entries, now);
    const archiveSha256 = await sha256Hex(archive);

    options.onProgress?.({ phase: "compressing", done: 0, total: 1 });
    const payload = await gzip(archive);
    const id = newBackupId(now, this.deps.random ?? (() => Math.random().toString(36).slice(2, 8)));
    const crypto = passphrase ? await createPartCrypto(passphrase, { iterations: this.deps.iterations }) : null;
    const plainParts = splitParts(payload, this.deps.partSize ?? DEFAULT_PART_SIZE);
    const sealed: Uint8Array[] = [];
    for (let i = 0; i < plainParts.length; i += 1) {
      options.onProgress?.({ phase: "encrypting", done: i, total: plainParts.length });
      sealed.push(await sealPart(plainParts[i]!, crypto?.key ?? null, id, i));
    }
    const parts = await describeParts(sealed);
    const manifest: BackupManifest = backupManifestSchema.parse({
      format: BACKUP_FORMAT,
      version: 1,
      id,
      createdAt: now.toISOString(),
      app: { version: this.deps.appVersion },
      device: await this.deps.device(),
      encrypted: Boolean(crypto),
      kdf: crypto?.kdf ?? null,
      compression: "gzip",
      archiveSize: archive.byteLength,
      archiveSha256,
      storedSize: parts.reduce((n, p) => n + p.size, 0),
      partSize: this.deps.partSize ?? DEFAULT_PART_SIZE,
      parts,
      counts,
      includesAttachments,
      includesSecrets: Boolean(crypto),
    });
    for (let i = 0; i < sealed.length; i += 1) await this.deps.scratch.put(scratchUp(id, i), new Blob([sealed[i] as BlobPart]));
    const session: UploadSession = { id, manifest, createdAt: this.clock() };
    await this.deps.repos.sync.setState(UPLOAD_SESSION_KEY, session);
    return session;
  }

  private async collect(withSecrets: boolean, includeAttachments: boolean, maxBlobBytes: number, onProgress?: (p: BackupProgress) => void) {
    const { repos } = this.deps;
    const tables: Record<string, Record<string, unknown>[]> = {};
    const counts: Record<string, number> = {};
    const secrets: ArchiveSecrets = { providers: {}, secrets: {} };
    for (const table of repos.backup.dataTables()) {
      let rows = await repos.backup.rows(table);
      if (table === "providers") {
        if (withSecrets) {
          for (const row of rows) {
            const id = String(row.id);
            const entry: ArchiveSecrets["providers"][string] = {};
            try {
              if (row.encryptedApiKey) entry.apiKey = await this.deps.vault.decrypt(row.encryptedApiKey as never, secretContext(id, "apiKey"));
              if (row.encryptedHeaders) entry.headers = JSON.parse(await this.deps.vault.decrypt(row.encryptedHeaders as never, secretContext(id, "headers"))) as Record<string, string>;
            } catch (error) {
              logger.warn("Skipping an unreadable provider key in backup", error);
            }
            if (entry.apiKey || entry.headers) secrets.providers[id] = entry;
          }
        }
        // Device-bound ciphertexts are useless elsewhere and never leave the device.
        rows = rows.map((row) => ({ ...row, encryptedApiKey: null, encryptedHeaders: null }));
      }
      if (table === "settings") {
        rows = rows.map((row) => (row.value && typeof row.value === "object" ? { ...row, value: { ...(row.value as object), backup: DEFAULT_BACKUP_SETTINGS } } : row));
      }
      tables[table] = rows;
      counts[table] = rows.length;
    }
    if (withSecrets) {
      for (const { id } of await repos.secrets.list()) {
        if (id.startsWith("webdav:")) continue;
        const plain = await getSecretText(this.deps, id).catch(() => undefined);
        if (plain) secrets.secrets[id] = plain;
      }
    }

    const entries: ArchiveEntryInput[] = [];
    let skipped = 0;
    if (includeAttachments) {
      const attachments = (tables.attachments ?? []) as unknown as Attachment[];
      let done = 0;
      for (const attachment of attachments) {
        onProgress?.({ phase: "collecting", done: done++, total: attachments.length });
        if (attachment.size > maxBlobBytes) {
          skipped += 1;
          continue;
        }
        const blob = await this.deps.readBlob(attachment).catch(() => undefined);
        if (!blob) {
          skipped += 1;
          continue;
        }
        entries.push({ name: `blobs/${attachment.id}`, data: await blobBytes(blob), mime: attachment.mimeType });
      }
    }
    counts.blobs = entries.length;
    counts.skippedBlobs = skipped;
    entries.unshift({ name: "db.json", data: new TextEncoder().encode(stringifyData({ schema: 1, tables })), mime: "application/json" });
    if (withSecrets) entries.push({ name: "secrets.json", data: new TextEncoder().encode(JSON.stringify(secrets)), mime: "application/json" });
    return { entries, counts, includesAttachments: includeAttachments };
  }

  private async upload(session: UploadSession, options: { onProgress?: (p: BackupProgress) => void; signal?: AbortSignal }): Promise<BackupListItem> {
    const { client, root } = await createRemote(this.deps);
    const folder = joinPath(root, "backups", session.id);
    await withRetry(() => client.ensureDir(folder, options.signal), { signal: options.signal });
    const existing = new Map((await withRetry(() => client.list(folder, options.signal), { signal: options.signal })).map((e) => [e.name, e.size]));
    const parts = session.manifest.parts;
    for (const part of parts) {
      options.onProgress?.({ phase: "uploading", done: part.index, total: parts.length });
      if (existing.get(partName(part.index)) === part.size) continue; // already on the server (resume)
      const blob = await this.deps.scratch.get(scratchUp(session.id, part.index));
      if (!blob) throw new BackupError("corrupted", "Local upload data is missing; start a new backup");
      const bytes = await blobBytes(blob);
      if ((await sha256Hex(bytes)) !== part.sha256) throw new BackupError("corrupted", "Local upload data is corrupted; start a new backup");
      await withRetry(() => client.put(joinPath(folder, partName(part.index)), bytes, { signal: options.signal }), { signal: options.signal });
    }
    options.onProgress?.({ phase: "finalizing", done: parts.length, total: parts.length });
    await withRetry(() => client.put(joinPath(folder, "manifest.json"), JSON.stringify(session.manifest, null, 1), { contentType: "application/json", signal: options.signal }), { signal: options.signal });
    await this.discardSession(session);
    const at = Date.parse(session.manifest.createdAt);
    await this.deps.repos.sync.setState(LAST_BACKUP_KEY, { at, id: session.id, size: session.manifest.storedSize, error: null } satisfies LastBackupInfo);
    this.deps.audit?.("backup_created", `${session.id} (${session.manifest.storedSize} bytes, ${session.manifest.encrypted ? "encrypted" : "not encrypted"})`);
    return { id: session.id, createdAt: at, size: session.manifest.storedSize, complete: true, manifest: session.manifest };
  }

  // ------------------------------------------------------------ list / prune / delete

  async listBackups(signal?: AbortSignal): Promise<BackupListItem[]> {
    const { client, root } = await createRemote(this.deps);
    const folders = (await withRetry(() => client.list(joinPath(root, "backups"), signal), { signal })).filter((e) => e.isCollection);
    const items = await Promise.all(
      folders.map(async (folder): Promise<BackupListItem> => {
        const files = await client.list(joinPath(root, "backups", folder.name), signal).catch(() => []);
        const size = files.reduce((n, f) => n + (f.isCollection ? 0 : f.size), 0);
        let manifest: BackupManifest | null = null;
        if (files.some((f) => f.name === "manifest.json")) {
          try {
            const parsed = backupManifestSchema.safeParse(JSON.parse(await client.getText(joinPath(root, "backups", folder.name, "manifest.json"), signal)));
            if (parsed.success && parsed.data.id === folder.name) manifest = parsed.data;
          } catch (error) {
            logger.warn("Unreadable backup manifest", error);
          }
        }
        return {
          id: folder.name,
          createdAt: manifest ? Date.parse(manifest.createdAt) : (folder.lastModified ?? 0),
          size: manifest?.storedSize ?? size,
          complete: manifest !== null,
          manifest,
        };
      }),
    );
    return items.sort((a, b) => b.createdAt - a.createdAt);
  }

  async deleteBackup(id: string): Promise<void> {
    if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) throw new BackupError("not_found", "Invalid backup id");
    const { client, root } = await createRemote(this.deps);
    await withRetry(() => client.delete(joinPath(root, "backups", id), { collection: true }));
    this.deps.audit?.("backup_deleted", id);
  }

  /** Keeps the newest N complete backups; removes abandoned partial uploads older than 2 days. */
  async prune(onProgress?: (p: BackupProgress) => void): Promise<number> {
    onProgress?.({ phase: "pruning", done: 0, total: 1 });
    const keep = (await this.deps.repos.settings.get()).backup.schedule.keepLast;
    const list = await this.listBackups();
    const pending = await this.deps.repos.sync.getState<UploadSession>(UPLOAD_SESSION_KEY);
    const complete = list.filter((b) => b.complete);
    const stale = list.filter((b) => !b.complete && b.id !== pending?.id && this.clock() - b.createdAt > 2 * 86_400_000);
    const victims = [...complete.slice(keep), ...stale];
    const { client, root } = await createRemote(this.deps);
    for (const item of victims) await withRetry(() => client.delete(joinPath(root, "backups", item.id), { collection: true }));
    return victims.length;
  }

  // ------------------------------------------------------------ download / restore

  /** Downloads (resumably) and opens a backup, returning a preview. Nothing is written yet. */
  inspect(item: BackupListItem, options: { passphrase?: string; onProgress?: (p: BackupProgress) => void; signal?: AbortSignal } = {}): Promise<RestorePreview> {
    return this.exclusive(async () => {
      const manifest = item.manifest;
      if (!manifest) throw new BackupError("corrupted", "This backup is incomplete");
      if (manifest.version > 1) throw new BackupError("newer_version", "This backup was made by a newer version of Nova");
      const passphrase = manifest.encrypted ? (options.passphrase || (await getSecretText(this.deps, BACKUP_PASSPHRASE_SECRET))) : undefined;
      if (manifest.encrypted && !passphrase) throw new BackupError("passphrase_required", "Enter the backup passphrase");
      const key = manifest.encrypted && manifest.kdf ? await partCryptoFor(passphrase!, manifest.kdf) : null;

      const { client, root } = await createRemote(this.deps);
      const folder = joinPath(root, "backups", manifest.id);
      const plain: Uint8Array[] = [];
      for (const part of manifest.parts) {
        options.onProgress?.({ phase: "downloading", done: part.index, total: manifest.parts.length });
        const bytes = await this.downloadPart(client, folder, manifest.id, part, options.signal);
        try {
          plain.push(await openPart(bytes, key, manifest.id, part.index));
        } catch (error) {
          if (error instanceof BackupDecryptError) throw new BackupError("wrong_passphrase", "Wrong passphrase", { cause: error });
          throw error;
        }
      }
      options.onProgress?.({ phase: "verifying", done: 0, total: 1 });
      let archive: Uint8Array;
      try {
        archive = await gunzip(concatBytes(plain));
      } catch (error) {
        throw new BackupError("corrupted", "The backup data is corrupted", { cause: error });
      }
      if ((await sha256Hex(archive)) !== manifest.archiveSha256) throw new BackupError("corrupted", "Backup checksum mismatch");
      let unpacked;
      try {
        unpacked = await unpackArchive(archive);
      } catch (error) {
        throw new BackupError("corrupted", error instanceof ArchiveError ? error.message : "The backup data is corrupted", { cause: error });
      }
      const db = unpacked.entries.get("db.json");
      if (!db) throw new BackupError("corrupted", "The backup has no database");
      const parsed = parseData(new TextDecoder().decode(db)) as { schema?: number; tables?: Record<string, Record<string, unknown>[]> };
      if (!parsed || typeof parsed !== "object" || !parsed.tables || typeof parsed.tables !== "object") throw new BackupError("corrupted", "The backup database is invalid");
      if ((parsed.schema ?? 1) > 1) throw new BackupError("newer_version", "This backup was made by a newer version of Nova");
      const allowed = new Set(this.deps.repos.backup.dataTables());
      const tables: Record<string, Record<string, unknown>[]> = {};
      for (const [name, rows] of Object.entries(parsed.tables)) if (allowed.has(name) && Array.isArray(rows)) tables[name] = rows.filter((r) => r && typeof r === "object");
      const blobs = new Map<string, Uint8Array>();
      for (const [name, data] of unpacked.entries) if (name.startsWith("blobs/")) blobs.set(name.slice(6), data);
      const secretsEntry = unpacked.entries.get("secrets.json");
      const secrets = secretsEntry ? (JSON.parse(new TextDecoder().decode(secretsEntry)) as ArchiveSecrets) : null;
      const counts = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]));
      counts.blobs = blobs.size;
      // Downloaded parts are no longer needed once the archive is verified.
      for (const part of manifest.parts) await this.deps.scratch.delete(scratchDown(manifest.id, part.index)).catch(() => undefined);
      return { manifest, counts, data: { tables, blobs, secrets } };
    });
  }

  private async downloadPart(client: WebDavClient, folder: string, id: string, part: BackupManifest["parts"][number], signal?: AbortSignal): Promise<Uint8Array> {
    const cached = await this.deps.scratch.get(scratchDown(id, part.index));
    if (cached) {
      const bytes = await blobBytes(cached);
      if ((await sha256Hex(bytes)) === part.sha256) return bytes;
    }
    // Resume inside a part: keep what arrived, ask for the rest with a Range request.
    let received = new Uint8Array(0);
    const bytes = await withRetry(
      async () => {
        const result = await client.get(joinPath(folder, partName(part.index)), { from: received.byteLength || undefined, signal });
        received = result.partial ? concatBytes([received, result.bytes]) : result.bytes;
        if (received.byteLength < part.size) throw new WebDavError("network", "The download was interrupted");
        return received;
      },
      { signal, attempts: 6 },
    );
    if ((await sha256Hex(bytes)) !== part.sha256) throw new BackupError("corrupted", `Checksum mismatch in part ${part.index}`);
    await this.deps.scratch.put(scratchDown(id, part.index), new Blob([bytes as BlobPart]));
    return bytes;
  }

  /** Replaces local data with the backup. Local keys are kept for providers the backup has no keys for. */
  async restore(preview: RestorePreview, options: { onProgress?: (p: BackupProgress) => void } = {}): Promise<void> {
    const { repos, vault } = this.deps;
    options.onProgress?.({ phase: "restoring", done: 0, total: 3 });
    const tables = { ...preview.data.tables };
    const localSettings = await repos.settings.get();
    const localProviders = new Map((await repos.providers.list()).map((p) => [p.id, p]));
    const secrets = preview.data.secrets;

    tables.providers = await Promise.all(
      (tables.providers ?? []).map(async (row) => {
        const id = String(row.id);
        const fromBackup = secrets?.providers[id];
        if (fromBackup) {
          return {
            ...row,
            encryptedApiKey: fromBackup.apiKey ? await vault.encrypt(fromBackup.apiKey, secretContext(id, "apiKey")) : null,
            encryptedHeaders: fromBackup.headers && Object.keys(fromBackup.headers).length ? await vault.encrypt(JSON.stringify(fromBackup.headers), secretContext(id, "headers")) : null,
          };
        }
        const local = localProviders.get(id);
        return { ...row, encryptedApiKey: local?.encryptedApiKey ?? null, encryptedHeaders: local?.encryptedHeaders ?? null };
      }),
    );
    tables.settings = (tables.settings ?? []).map((row) => (row.value && typeof row.value === "object" ? { ...row, value: { ...(row.value as object), backup: localSettings.backup } } : row));

    options.onProgress?.({ phase: "restoring", done: 1, total: 3 });
    // Blobs first (attachment rows point at them).
    const attachments = (tables.attachments ?? []) as unknown as Attachment[];
    const restoredAttachments: Record<string, unknown>[] = [];
    for (const attachment of attachments) {
      const data = preview.data.blobs.get(attachment.id);
      if (data) {
        const storage = await this.deps.writeBlob(attachment, new Blob([data as BlobPart], { type: attachment.mimeType }));
        restoredAttachments.push({ ...attachment, storage });
      } else restoredAttachments.push(attachment as unknown as Record<string, unknown>);
    }
    tables.attachments = restoredAttachments;

    await repos.backup.replaceTables(tables);
    if (secrets) for (const [id, value] of Object.entries(secrets.secrets)) if (!id.startsWith("webdav:")) await repos.secrets.set(id, await vault.encrypt(value, secretTableContext(id))).catch(() => undefined);

    // Remove blobs of attachments that no longer exist.
    const keep = new Set(attachments.map((a) => a.id));
    for (const id of await repos.blobs.list()) if (!keep.has(id) && !id.startsWith("backup-")) await repos.blobs.delete(id).catch(() => undefined);

    // Data was replaced wholesale: sync re-baselines from scratch.
    await repos.sync.clearRecords();
    await repos.sync.deleteState("sync:cursors");
    options.onProgress?.({ phase: "restoring", done: 3, total: 3 });
    this.deps.audit?.("backup_restored", `${preview.manifest.id} from ${preview.manifest.device.label}`);
    this.deps.onRestored?.();
  }
}
