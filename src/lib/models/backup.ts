import { z } from "zod";
import { idSchema, timestampSchema } from "./common";

/** Device-local WebDAV / backup / sync configuration (never synced to other devices). */
export const webDavSettingsSchema = z.object({
  /** e.g. https://cloud.example.com/remote.php/dav/files/alice/ ("" = not configured). */
  url: z.string().max(2000),
  username: z.string().max(256),
  authType: z.enum(["basic", "bearer"]),
  /** Route through /api/proxy for servers without CORS (most Nextcloud installs). */
  viaProxy: z.boolean(),
  /** Folder (relative to url) that holds Nova data. */
  rootPath: z.string().trim().max(200).regex(/^[^\\?#%]*$/, "Invalid folder"),
});
export type WebDavSettings = z.infer<typeof webDavSettingsSchema>;

export const backupScheduleSchema = z.object({
  enabled: z.boolean(),
  intervalHours: z.number().int().min(1).max(24 * 30),
  keepLast: z.number().int().min(1).max(100),
  includeAttachments: z.boolean(),
  /** Encrypt with the backup passphrase (required to include API keys). */
  encrypt: z.boolean(),
  /** Skip attachments larger than this (MB) to keep archives reasonable. */
  maxAttachmentMb: z.number().int().min(1).max(2048),
});
export type BackupSchedule = z.infer<typeof backupScheduleSchema>;

export const syncSettingsSchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().int().min(1).max(24 * 60),
  encrypt: z.boolean(),
  includeAttachments: z.boolean(),
  maxAttachmentMb: z.number().int().min(1).max(512),
});
export type SyncSettings = z.infer<typeof syncSettingsSchema>;

export const backupSettingsSchema = z.object({
  webdav: webDavSettingsSchema,
  schedule: backupScheduleSchema,
  sync: syncSettingsSchema,
});
export type BackupSettings = z.infer<typeof backupSettingsSchema>;

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  webdav: { url: "", username: "", authType: "basic", viaProxy: true, rootPath: "Nova" },
  schedule: { enabled: false, intervalHours: 24, keepLast: 7, includeAttachments: true, encrypt: true, maxAttachmentMb: 100 },
  sync: { enabled: false, intervalMinutes: 15, encrypt: true, includeAttachments: true, maxAttachmentMb: 25 },
};

/** Secret ids (vault-encrypted in the secrets table). */
export const WEBDAV_PASSWORD_SECRET = "webdav:password";
export const BACKUP_PASSPHRASE_SECRET = "webdav:passphrase";

// ---------------------------------------------------------------- sync records

/** Last synced state of one record: the base for change and conflict detection. */
export interface SyncRecordState {
  /** "<table>:<id>" */
  key: string;
  table: string;
  recordId: string;
  /** Content hash of the record when last synced (null = deleted). */
  hash: string | null;
  rev: number;
  updatedAt: number;
  deviceId: string;
  deleted: boolean;
}

export const syncConflictSchema = z.object({
  id: idSchema,
  table: z.string().min(1).max(64),
  recordId: z.string().min(1).max(256),
  /** Short label for the review UI (title, name or first words). */
  label: z.string().max(300),
  local: z.unknown().nullable(),
  remote: z.unknown().nullable(),
  localUpdatedAt: timestampSchema,
  remoteUpdatedAt: timestampSchema,
  remoteDeviceId: z.string().max(100),
  winner: z.enum(["local", "remote"]),
  status: z.enum(["open", "resolved"]),
  createdAt: timestampSchema,
  resolvedAt: timestampSchema.nullable(),
});
export type SyncConflict = z.infer<typeof syncConflictSchema>;

export interface SyncStateRecord {
  key: string;
  value: unknown;
}

// ---------------------------------------------------------------- audit log

export const AUDIT_KINDS = [
  "key_saved",
  "key_removed",
  "tool_approved",
  "tool_denied",
  "tool_always_allowed",
  "mcp_connected",
  "mcp_signed_in",
  "mcp_removed",
  "backup_created",
  "backup_failed",
  "backup_restored",
  "backup_deleted",
  "sync_completed",
  "sync_failed",
  "sync_conflict",
  "import",
  "export",
  "data_cleared",
  "permission_changed",
] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

export const auditEntrySchema = z.object({
  id: idSchema,
  at: timestampSchema,
  kind: z.enum(AUDIT_KINDS),
  /** Human-readable, secret-free summary (redacted before saving). */
  detail: z.string().max(500),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;
