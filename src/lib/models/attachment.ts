import { z } from "zod";
import { idSchema, timestampSchema } from "./common";

export const attachmentKindSchema = z.enum(["image", "video", "audio", "file"]);
export type AttachmentKind = z.infer<typeof attachmentKindSchema>;

/** Hard ceiling for any stored blob. Per-kind limits live in lib/media/limits.ts. */
export const MAX_ATTACHMENT_SIZE = 2 * 1024 * 1024 * 1024;
export const ATTACHMENT_SCHEMA_VERSION = 2 as const;

export const mimeTypeSchema = z.string().regex(/^[\w.+-]+\/[\w.+-]+$/, "Invalid MIME type");

/** Where the binary lives. "opfs" = Origin Private File System (File System Access API). */
export const blobStorageSchema = z.enum(["idb", "opfs"]);
export type BlobStorageKind = z.infer<typeof blobStorageSchema>;

export const attachmentMetadataSchema = z
  .object({
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    durationMs: z.number().nonnegative().optional(),
    originalName: z.string().max(255).optional(),
    originalSize: z.number().int().nonnegative().optional(),
    originalMimeType: mimeTypeSchema.optional(),
    compressed: z.boolean().optional(),
    /** For video: ids of image attachments extracted as frames (fallback for non-video models). */
    frameIds: z.array(idSchema).max(64).optional(),
    frameTimesMs: z.array(z.number().nonnegative()).max(64).optional(),
    /** For text-like files: number of characters inlined. */
    textLength: z.number().int().nonnegative().optional(),
  })
  .strict();
export type AttachmentMetadata = z.infer<typeof attachmentMetadataSchema>;

/** Provider-side copy (OpenAI file_id, Gemini file URI) to avoid re-uploading. */
export const remoteRefSchema = z.object({
  ref: z.string().min(1).max(2048),
  kind: z.enum(["file_id", "uri"]),
  expiresAt: timestampSchema.nullable(),
});
export type RemoteRef = z.infer<typeof remoteRefSchema>;

export const attachmentSchema = z.object({
  id: idSchema,
  conversationId: idSchema.nullable(),
  messageId: idSchema.nullable(),
  kind: attachmentKindSchema,
  name: z.string().trim().min(1).max(255),
  mimeType: mimeTypeSchema,
  size: z.number().int().nonnegative().max(MAX_ATTACHMENT_SIZE),
  storage: blobStorageSchema,
  /** Small JPEG/WebP data URL for lists and chips. */
  thumbnail: z
    .string()
    .max(120_000)
    .regex(/^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/)
    .nullable(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  metadata: attachmentMetadataSchema,
  remoteRefs: z.record(z.string().min(1).max(128), remoteRefSchema),
  /** Frames extracted from a video point back to it and stay hidden in the UI. */
  derivedFrom: idSchema.nullable(),
  schemaVersion: z.literal(ATTACHMENT_SCHEMA_VERSION),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const attachmentCreateSchema = z
  .object({
    conversationId: idSchema.nullable().optional(),
    messageId: idSchema.nullable().optional(),
    kind: attachmentKindSchema,
    name: z.string().trim().min(1).max(255),
    mimeType: mimeTypeSchema,
    size: z.number().int().nonnegative().max(MAX_ATTACHMENT_SIZE),
    storage: blobStorageSchema.optional(),
    thumbnail: attachmentSchema.shape.thumbnail.optional(),
    sha256: attachmentSchema.shape.sha256.optional(),
    metadata: attachmentMetadataSchema.optional(),
    derivedFrom: idSchema.nullable().optional(),
  })
  .strict();
export type AttachmentCreateInput = z.input<typeof attachmentCreateSchema>;

export const attachmentUpdateSchema = z
  .object({
    conversationId: idSchema.nullable(),
    messageId: idSchema.nullable(),
    name: z.string().trim().min(1).max(255),
    thumbnail: attachmentSchema.shape.thumbnail,
    metadata: attachmentMetadataSchema,
    remoteRefs: z.record(z.string().min(1).max(128), remoteRefSchema),
  })
  .partial()
  .strict();
export type AttachmentUpdateInput = z.input<typeof attachmentUpdateSchema>;

type Loose = Record<string, unknown>;

/** Upgrades phase-1 metadata-only rows. */
export function migrateAttachmentRecord(input: unknown): Loose {
  if (!input || typeof input !== "object") return {};
  const record: Loose = { ...(input as Loose) };
  if (record.schemaVersion !== ATTACHMENT_SCHEMA_VERSION) {
    record.storage = record.storage ?? "idb";
    record.thumbnail = record.thumbnail ?? null;
    record.sha256 = record.sha256 ?? null;
    record.metadata = record.metadata ?? {};
    record.remoteRefs = record.remoteRefs ?? {};
    record.derivedFrom = record.derivedFrom ?? null;
    record.updatedAt = typeof record.updatedAt === "number" ? record.updatedAt : record.createdAt;
    record.schemaVersion = ATTACHMENT_SCHEMA_VERSION;
  }
  return record;
}
