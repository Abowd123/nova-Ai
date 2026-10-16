import {
  ATTACHMENT_SCHEMA_VERSION,
  attachmentCreateSchema,
  attachmentSchema,
  attachmentUpdateSchema,
  type Attachment,
} from "@/lib/models";
import { StorageError, notFound, withStorageErrors } from "../../errors";
import type { AttachmentRepository, BlobStore, RepositoryDeps } from "../../types";
import type { NovaDatabase } from "../database";
import { parseOrThrow, parseRecords } from "../utils";

/**
 * Deletes attachment rows, their IndexedDB blobs and any frames derived from them.
 * Must run inside a transaction that includes `attachments` and `attachmentBlobs`.
 */
export async function deleteAttachments(db: NovaDatabase, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const derived = await db.attachments.where("derivedFrom").anyOf([...ids]).primaryKeys();
  const all = [...new Set([...ids, ...derived])];
  await db.attachments.bulkDelete(all);
  await db.attachmentBlobs.bulkDelete(all);
}

export function createAttachmentRepository(db: NovaDatabase, deps: RepositoryDeps): AttachmentRepository {
  const parseAll = (rows: unknown[]) => parseRecords(attachmentSchema, rows, "attachment");

  return {
    get: (id) =>
      withStorageErrors(async () => {
        const row = await db.attachments.get(id);
        return row ? parseOrThrow(attachmentSchema, row, "attachment") : undefined;
      }),

    getMany: (ids) =>
      withStorageErrors(async () => {
        const rows = await db.attachments.bulkGet([...ids]);
        return parseAll(rows.filter(Boolean));
      }),

    listByMessage: (messageId) =>
      withStorageErrors(async () => parseAll(await db.attachments.where("messageId").equals(messageId).toArray())),

    listByConversation: (conversationId) =>
      withStorageErrors(async () => parseAll(await db.attachments.where("conversationId").equals(conversationId).toArray())),

    listUnlinked: (olderThan) =>
      withStorageErrors(async () => {
        const rows = await db.attachments
          .orderBy("createdAt")
          .filter((a) => a.messageId === null && (olderThan === undefined || a.createdAt < olderThan))
          .toArray();
        return parseAll(rows);
      }),

    create: (input, blob) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(attachmentCreateSchema, input, "attachment input");
        const storage = data.storage ?? "idb";
        if (storage === "idb" && !blob) throw new StorageError("VALIDATION", "IndexedDB attachments need their binary");
        if (blob && blob.size !== data.size) throw new StorageError("VALIDATION", "Attachment size does not match its binary");
        const timestamp = deps.clock();
        const attachment = parseOrThrow(
          attachmentSchema,
          {
            id: deps.idGenerator(),
            conversationId: data.conversationId ?? null,
            messageId: data.messageId ?? null,
            kind: data.kind,
            name: data.name,
            mimeType: data.mimeType,
            size: data.size,
            storage,
            thumbnail: data.thumbnail ?? null,
            sha256: data.sha256 ?? null,
            metadata: data.metadata ?? {},
            remoteRefs: {},
            derivedFrom: data.derivedFrom ?? null,
            schemaVersion: ATTACHMENT_SCHEMA_VERSION,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          "attachment",
        );
        await db.transaction("rw", db.attachments, db.attachmentBlobs, async () => {
          await db.attachments.add(attachment);
          if (storage === "idb" && blob) await db.attachmentBlobs.put({ id: attachment.id, blob });
        });
        return attachment;
      }),

    update: (id, patch) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(attachmentUpdateSchema, patch, "attachment patch");
        return db.transaction("rw", db.attachments, async () => {
          const existing = await db.attachments.get(id);
          if (!existing) throw notFound("Attachment", id);
          const next: Attachment = parseOrThrow(attachmentSchema, { ...existing, ...data, updatedAt: deps.clock() }, "attachment");
          await db.attachments.put(next);
          return next;
        });
      }),

    link: (ids, target) =>
      withStorageErrors(async () => {
        if (ids.length === 0) return;
        await db.transaction("rw", db.attachments, async () => {
          const derived = await db.attachments.where("derivedFrom").anyOf([...ids]).primaryKeys();
          const all = [...new Set([...ids, ...derived])];
          const now = deps.clock();
          await db.attachments
            .where("id")
            .anyOf(all)
            .modify((a) => {
              a.conversationId = target.conversationId;
              a.messageId = target.messageId;
              a.updatedAt = now;
            });
        });
      }),

    delete: (id) =>
      withStorageErrors(async () => {
        await db.transaction("rw", db.attachments, db.attachmentBlobs, () => deleteAttachments(db, [id]));
      }),

    allIds: () => withStorageErrors(async () => (await db.attachments.toCollection().primaryKeys()) as string[]),
  };
}

/** IndexedDB blob store (Blob values are stored natively by IndexedDB). */
export function createIdbBlobStore(db: NovaDatabase): BlobStore {
  return {
    kind: "idb",
    put: (id, blob) =>
      withStorageErrors(async () => {
        await db.attachmentBlobs.put({ id, blob });
      }),
    get: (id) => withStorageErrors(async () => (await db.attachmentBlobs.get(id))?.blob),
    delete: (id) =>
      withStorageErrors(async () => {
        await db.attachmentBlobs.delete(id);
      }),
    list: () => withStorageErrors(async () => (await db.attachmentBlobs.toCollection().primaryKeys()) as string[]),
  };
}
