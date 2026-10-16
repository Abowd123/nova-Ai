import {
  conversationCreateSchema,
  conversationSchema,
  conversationUpdateSchema,
  DEFAULT_CONVERSATION_TITLE,
} from "@/lib/models";
import { normalizeForSearch } from "@/lib/text";
import { notFound, withStorageErrors } from "../../errors";
import type { ConversationRepository, RepositoryDeps } from "../../types";
import type { NovaDatabase } from "../database";
import { deleteAttachments } from "./attachments";
import { deleteMemoryForConversation, memoryTables } from "./memory";
import { parseOrThrow, parseRecords } from "../utils";

export function createConversationRepository(
  db: NovaDatabase,
  deps: RepositoryDeps,
): ConversationRepository {
  return {
    list: (options = {}) =>
      withStorageErrors(async () => {
        const rows = await db.conversations.orderBy("updatedAt").reverse().toArray();
        let items = parseRecords(conversationSchema, rows, "conversation");
        if (!options.includeArchived) items = items.filter((c) => !c.archived);
        const query = options.query ? normalizeForSearch(options.query) : "";
        if (query) {
          const contentMatches = new Set<string>();
          await db.messages.each((message) => {
            if (
              !contentMatches.has(message.conversationId) &&
              typeof message.content === "string" &&
              normalizeForSearch(message.content).includes(query)
            ) {
              contentMatches.add(message.conversationId);
            }
          });
          items = items.filter(
            (c) => normalizeForSearch(c.title).includes(query) || contentMatches.has(c.id),
          );
        }
        items.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
        return typeof options.limit === "number" ? items.slice(0, options.limit) : items;
      }),

    get: (id) =>
      withStorageErrors(async () => {
        const row = await db.conversations.get(id);
        return row ? parseOrThrow(conversationSchema, row, "conversation") : undefined;
      }),

    create: (input = {}) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(conversationCreateSchema, input, "conversation input");
        const timestamp = deps.clock();
        const conversation = parseOrThrow(
          conversationSchema,
          {
            id: deps.idGenerator(),
            title: data.title ?? DEFAULT_CONVERSATION_TITLE,
            titleSource: data.titleSource ?? (data.title ? "manual" : "default"),
            assistantId: data.assistantId ?? null,
            providerId: data.providerId ?? null,
            modelId: data.modelId ?? null,
            pinned: false,
            archived: false,
            tagIds: data.tagIds ?? [],
            messageCount: 0,
            lastMessageAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          "conversation",
        );
        await db.conversations.add(conversation);
        return conversation;
      }),

    update: (id, patch) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(conversationUpdateSchema, patch, "conversation patch");
        return db.transaction("rw", db.conversations, async () => {
          const existing = await db.conversations.get(id);
          if (!existing) throw notFound("Conversation", id);
          const next = parseOrThrow(
            conversationSchema,
            { ...existing, ...data, updatedAt: deps.clock() },
            "conversation",
          );
          await db.conversations.put(next);
          return next;
        });
      }),

    delete: (id) =>
      withStorageErrors(async () => {
        await db.transaction("rw", [db.conversations, db.messages, db.attachments, db.attachmentBlobs, ...memoryTables(db)], async () => {
          await db.messages.where("conversationId").equals(id).delete();
          await deleteMemoryForConversation(db, id);
          await deleteAttachments(db, await db.attachments.where("conversationId").equals(id).primaryKeys());
          await db.conversations.delete(id);
        });
      }),
  };
}
