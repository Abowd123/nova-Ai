import Dexie from "dexie";
import {
  messageCreateSchema,
  messageSchema,
  messageUpdateSchema,
  textOf,
  type MessagePart,
} from "@/lib/models";
import { notFound, withStorageErrors } from "../../errors";
import type { MessageRepository, RepositoryDeps } from "../../types";
import type { NovaDatabase } from "../database";
import { deleteAttachments } from "./attachments";
import { deleteMemoryForMessages } from "./memory";
import { parseOrThrow, parseRecords } from "../utils";

function resolveContent(content: string | undefined, parts: MessagePart[] | undefined) {
  if (parts) return { parts, content: content ?? textOf(parts) };
  const text = content ?? "";
  return { content: text, parts: text ? ([{ type: "text", text }] as MessagePart[]) : [] };
}

export function createMessageRepository(db: NovaDatabase, deps: RepositoryDeps): MessageRepository {
  const byConversation = (conversationId: string) =>
    db.messages
      .where("[conversationId+createdAt]")
      .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey]);

  async function refreshConversationStats(conversationId: string): Promise<void> {
    const remaining = await byConversation(conversationId).toArray();
    const last = remaining.at(-1);
    await db.conversations.update(conversationId, {
      messageCount: remaining.length,
      lastMessageAt: last?.createdAt ?? null,
      updatedAt: deps.clock(),
    });
  }

  return {
    listByConversation: (conversationId) =>
      withStorageErrors(async () =>
        parseRecords(messageSchema, await byConversation(conversationId).toArray(), "message"),
      ),

    listByStatus: (status) =>
      withStorageErrors(async () =>
        parseRecords(messageSchema, await db.messages.where("status").equals(status).toArray(), "message"),
      ),

    get: (id) =>
      withStorageErrors(async () => {
        const row = await db.messages.get(id);
        return row ? parseOrThrow(messageSchema, row, "message") : undefined;
      }),

    create: (input) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(messageCreateSchema, input, "message input");
        return db.transaction("rw", db.conversations, db.messages, async () => {
          const conversation = await db.conversations.get(data.conversationId);
          if (!conversation) throw notFound("Conversation", data.conversationId);
          const last = await byConversation(data.conversationId).last();
          // Strictly increasing createdAt keeps ordering stable even within the same ms.
          const timestamp = Math.max(deps.clock(), (last?.createdAt ?? 0) + 1);
          const { content, parts } = resolveContent(data.content, data.parts);
          const message = parseOrThrow(
            messageSchema,
            {
              id: deps.idGenerator(),
              conversationId: data.conversationId,
              role: data.role,
              content,
              parts,
              status: data.status ?? "complete",
              attachmentIds: data.attachmentIds ?? [],
              error: null,
              providerId: data.providerId ?? null,
              modelId: data.modelId ?? null,
              usage: null,
              finishReason: null,
              heartbeatAt: data.heartbeatAt ?? null,
              context: data.context ?? null,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            "message",
          );
          await db.messages.add(message);
          await db.conversations.update(conversation.id, {
            messageCount: conversation.messageCount + 1,
            lastMessageAt: timestamp,
            updatedAt: timestamp,
          });
          return message;
        });
      }),

    update: (id, patch) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(messageUpdateSchema, patch, "message patch");
        return db.transaction("rw", db.messages, async () => {
          const existing = await db.messages.get(id);
          if (!existing) throw notFound("Message", id);
          const merged = { ...existing, ...data, updatedAt: deps.clock() };
          // Keep the plain-text projection in sync when only parts change.
          if (data.parts && data.content === undefined) merged.content = textOf(data.parts);
          if (data.content !== undefined && !data.parts) {
            merged.parts = [
              ...existing.parts.filter((part) => part.type !== "text"),
              ...(data.content ? [{ type: "text" as const, text: data.content }] : []),
            ];
          }
          const next = parseOrThrow(messageSchema, merged, "message");
          await db.messages.put(next);
          return next;
        });
      }),

    delete: (id) =>
      withStorageErrors(async () => {
        await db.transaction("rw", [db.conversations, db.messages, db.attachments, db.attachmentBlobs, db.memoryChunks, db.memoryVectors], async () => {
          const existing = await db.messages.get(id);
          if (!existing) return;
          await deleteAttachments(db, await db.attachments.where("messageId").equals(id).primaryKeys());
          await deleteMemoryForMessages(db, [id]);
          await db.messages.delete(id);
          await refreshConversationStats(existing.conversationId);
        });
      }),

    deleteAfter: (messageId, options = {}) =>
      withStorageErrors(async () =>
        db.transaction("rw", [db.conversations, db.messages, db.attachments, db.attachmentBlobs, db.memoryChunks, db.memoryVectors], async () => {
          const anchor = await db.messages.get(messageId);
          if (!anchor) throw notFound("Message", messageId);
          const targets = (await byConversation(anchor.conversationId).toArray()).filter((m) =>
            options.inclusive ? m.createdAt >= anchor.createdAt : m.createdAt > anchor.createdAt,
          );
          const ids = targets.map((m) => m.id);
          if (ids.length === 0) return 0;
          await deleteAttachments(db, await db.attachments.where("messageId").anyOf(ids).primaryKeys());
          await deleteMemoryForMessages(db, ids);
          await db.messages.bulkDelete(ids);
          await refreshConversationStats(anchor.conversationId);
          return ids.length;
        }),
      ),

    deleteByConversation: (conversationId) =>
      withStorageErrors(async () => {
        await db.transaction("rw", [db.conversations, db.messages, db.attachments, db.attachmentBlobs, db.memoryChunks, db.memoryVectors], async () => {
          await db.messages.where("conversationId").equals(conversationId).delete();
          await deleteAttachments(db, await db.attachments.where("conversationId").equals(conversationId).primaryKeys());
          if (await db.conversations.get(conversationId)) {
            await refreshConversationStats(conversationId);
          }
        });
      }),
  };
}
