import Dexie from "dexie";
import {
  APP_SETTINGS_KEY,
  appSettingsSchema,
  assistantSchema,
  conversationSchema,
  messageSchema,
  providerSchema,
  tagSchema,
} from "@/lib/models";
import { withStorageErrors } from "../../errors";
import type { RepositoryDeps, TransferRepository } from "../../types";
import type { NovaDatabase } from "../database";
import { parseOrThrow, parseRecords } from "../utils";
import { mergeSettings } from "./settings";
import { deleteMemoryChunks, deleteMemoryForMessages } from "./memory";
import { deleteAttachments } from "./attachments";

export function createTransferRepository(db: NovaDatabase, deps: RepositoryDeps): TransferRepository {
  return {
    index: () =>
      withStorageErrors(async () => {
        const [assistants, tags, providers, conversations] = await Promise.all([
          db.assistants.toArray(),
          db.tags.toArray(),
          db.providers.toArray(),
          db.conversations.toArray(),
        ]);
        return {
          assistants: assistants.map((a) => ({ id: a.id, name: a.name, isDefault: a.isDefault === true })),
          tags: tags.map((t) => ({ id: t.id, name: t.name })),
          providers: providers.map((p) => ({ id: p.id, name: p.name })),
          conversations: conversations.map((c) => ({ id: c.id, title: c.title })),
        };
      }),

    readAll: ({ includeConversations }) =>
      withStorageErrors(async () => {
        const [assistants, tags, providers, settingsRow] = await Promise.all([
          db.assistants.toArray(),
          db.tags.orderBy("order").toArray(),
          db.providers.toArray(),
          db.settings.get(APP_SETTINGS_KEY),
        ]);
        const conversations = includeConversations ? await db.conversations.toArray() : [];
        const messages = includeConversations ? await db.messages.orderBy("[conversationId+createdAt]").toArray() : [];
        return {
          assistants: parseRecords(assistantSchema, assistants, "assistant"),
          tags: parseRecords(tagSchema, tags, "tag"),
          providers: parseRecords(providerSchema, providers, "provider"),
          settings: mergeSettings(settingsRow?.value),
          conversations: parseRecords(conversationSchema, conversations, "conversation"),
          messages: parseRecords(messageSchema, messages, "message"),
        };
      }),

    write: (batch, options) =>
      withStorageErrors(async () => {
        // Validate everything up-front: a single bad record aborts the whole import.
        const assistants = batch.assistants.map((r) => parseOrThrow(assistantSchema, r, "assistant"));
        const tags = batch.tags.map((r) => parseOrThrow(tagSchema, r, "tag"));
        const providers = batch.providers.map((r) => parseOrThrow(providerSchema, r, "provider"));
        const conversations = batch.conversations.map((r) => parseOrThrow(conversationSchema, r, "conversation"));
        const messages = batch.messages.map((r) => parseOrThrow(messageSchema, r, "message"));
        const settings = batch.settings ? parseOrThrow(appSettingsSchema, batch.settings, "settings") : null;

        await db.transaction("rw", [db.assistants, db.tags, db.providers, db.conversations, db.messages, db.attachments, db.attachmentBlobs, db.settings, db.memoryChunks, db.memoryVectors, db.summaries], async () => {
          if (options.replace) {
            await Promise.all([db.assistants.clear(), db.tags.clear(), db.providers.clear()]);
            if (settings) await db.settings.delete(APP_SETTINGS_KEY);
            if (options.replaceConversations) {
              await Promise.all([db.conversations.clear(), db.messages.clear()]);
              // Chat attachments go with their conversations; image-generation results stay.
              await deleteAttachments(db, await db.attachments.filter((a) => a.conversationId !== null).primaryKeys());
              // Memories learned from the replaced chats and their summaries go too; manual memories stay.
              await deleteMemoryChunks(db, (await db.memoryChunks.filter((c) => c.source === "message").primaryKeys()) as string[]);
              await db.summaries.clear();
            }
          }
          if (batch.replaceMessagesFor.length) {
            const replaced = await db.messages.where("conversationId").anyOf(batch.replaceMessagesFor).primaryKeys();
            await deleteMemoryForMessages(db, replaced as string[]);
            await db.messages.bulkDelete(replaced);
            await db.summaries.bulkDelete(batch.replaceMessagesFor);
          }

          await db.tags.bulkPut(tags);
          await db.providers.bulkPut(providers);
          await db.assistants.bulkPut(assistants);
          await db.conversations.bulkPut(conversations);
          await db.messages.bulkPut(messages);
          if (settings) await db.settings.put({ key: APP_SETTINGS_KEY, value: settings, updatedAt: deps.clock() });

          // Exactly one default assistant.
          const all = await db.assistants.toArray();
          const defaults = all.filter((a) => a.isDefault);
          if (all.length && defaults.length !== 1) {
            const keep = defaults[0]?.id ?? all.sort((a, b) => a.createdAt - b.createdAt)[0]?.id;
            await db.assistants.toCollection().modify((a) => {
              a.isDefault = a.id === keep;
            });
          }

          // Tag order stays a dense 0..n-1 sequence.
          let order = 0;
          await db.tags.orderBy("order").modify((tag) => {
            tag.order = order;
            order += 1;
          });

          // Drop references to things that no longer exist (e.g. after replace).
          const assistantIds = new Set(all.map((a) => a.id));
          const providerIds = new Set((await db.providers.toCollection().primaryKeys()) as string[]);
          const tagIds = new Set((await db.tags.toCollection().primaryKeys()) as string[]);
          await db.conversations.toCollection().modify((c) => {
            if (c.assistantId && !assistantIds.has(c.assistantId)) c.assistantId = null;
            if (c.providerId && !providerIds.has(c.providerId)) {
              c.providerId = null;
              c.modelId = null;
            }
            c.tagIds = c.tagIds.filter((id) => tagIds.has(id));
          });
          await db.assistants.toCollection().modify((a) => {
            if (a.defaultProviderId && !providerIds.has(a.defaultProviderId)) {
              a.defaultProviderId = null;
              a.defaultModelId = null;
            }
            a.tagIds = a.tagIds.filter((id) => tagIds.has(id));
          });

          // Recompute counters for imported conversations.
          for (const conversation of conversations) {
            const rows = await db.messages
              .where("[conversationId+createdAt]")
              .between([conversation.id, Dexie.minKey], [conversation.id, Dexie.maxKey])
              .toArray();
            await db.conversations.update(conversation.id, {
              messageCount: rows.length,
              lastMessageAt: rows.at(-1)?.createdAt ?? null,
            });
          }
        });
      }),
  };
}
