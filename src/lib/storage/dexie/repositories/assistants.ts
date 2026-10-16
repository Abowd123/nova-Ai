import {
  ASSISTANT_SCHEMA_VERSION,
  assistantCreateSchema,
  assistantSchema,
  assistantUpdateSchema,
  DEFAULT_ASSISTANT_AVATAR,
  DEFAULT_ASSISTANT_SETTINGS,
  type Assistant,
} from "@/lib/models";
import { normalizeForSearch } from "@/lib/text";
import { notFound, withStorageErrors } from "../../errors";
import type { AssistantRepository, RepositoryDeps } from "../../types";
import type { NovaDatabase } from "../database";
import { deleteMemoryChunks } from "./memory";
import { parseOrThrow, parseRecords } from "../utils";

function sortAssistants(items: Assistant[]): Assistant[] {
  return items.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.updatedAt - a.updatedAt);
}

export function createAssistantRepository(
  db: NovaDatabase,
  deps: RepositoryDeps,
): AssistantRepository {
  const listAll = async () =>
    sortAssistants(parseRecords(assistantSchema, await db.assistants.toArray(), "assistant"));

  return {
    list: (options = {}) =>
      withStorageErrors(async () => {
        const items = await listAll();
        const query = options.query ? normalizeForSearch(options.query) : "";
        if (!query) return items;
        return items.filter(
          (a) =>
            normalizeForSearch(a.name).includes(query) ||
            normalizeForSearch(a.description).includes(query),
        );
      }),

    get: (id) =>
      withStorageErrors(async () => {
        const row = await db.assistants.get(id);
        return row ? parseOrThrow(assistantSchema, row, "assistant") : undefined;
      }),

    getDefault: () =>
      withStorageErrors(async () => {
        const items = await listAll();
        return items.find((a) => a.isDefault) ?? items[0];
      }),

    create: (input) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(assistantCreateSchema, input, "assistant input");
        return db.transaction("rw", db.assistants, async () => {
          const isFirst = (await db.assistants.count()) === 0;
          const timestamp = deps.clock();
          const assistant = parseOrThrow(
            assistantSchema,
            {
              id: deps.idGenerator(),
              name: data.name,
              description: data.description ?? "",
              avatar: data.avatar?.trim() || DEFAULT_ASSISTANT_AVATAR,
              systemPrompt: data.systemPrompt ?? "",
              defaultProviderId: data.defaultProviderId ?? null,
              defaultModelId: data.defaultModelId ?? null,
              temperature: data.temperature ?? 0.7,
              topP: data.topP ?? null,
              maxTokens: data.maxTokens ?? null,
              contextMessageLimit: data.contextMessageLimit ?? null,
              enabledTools: data.enabledTools ?? [],
              memoryScope: data.memoryScope ?? "assistant",
              voiceId: data.voiceId ?? null,
              autoPlayTts: data.autoPlayTts ?? "never",
              starters: data.starters ?? [],
              settings: data.settings ?? DEFAULT_ASSISTANT_SETTINGS,
              isDefault: isFirst,
              tagIds: data.tagIds ?? [],
              schemaVersion: ASSISTANT_SCHEMA_VERSION,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            "assistant",
          );
          await db.assistants.add(assistant);
          return assistant;
        });
      }),

    update: (id, patch) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(assistantUpdateSchema, patch, "assistant patch");
        return db.transaction("rw", db.assistants, async () => {
          const existing = await db.assistants.get(id);
          if (!existing) throw notFound("Assistant", id);
          const next = parseOrThrow(
            assistantSchema,
            {
              ...existing,
              ...data,
              avatar: data.avatar !== undefined ? data.avatar.trim() || DEFAULT_ASSISTANT_AVATAR : existing.avatar,
              updatedAt: deps.clock(),
            },
            "assistant",
          );
          await db.assistants.put(next);
          return next;
        });
      }),

    duplicate: (id, overrides = {}) =>
      withStorageErrors(async () => {
        return db.transaction("rw", db.assistants, async () => {
          const existing = await db.assistants.get(id);
          if (!existing) throw notFound("Assistant", id);
          const timestamp = deps.clock();
          const copy = parseOrThrow(
            assistantSchema,
            {
              ...existing,
              id: deps.idGenerator(),
              name: (overrides.name ?? `${existing.name} (copy)`).slice(0, 100),
              isDefault: false,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            "assistant",
          );
          await db.assistants.add(copy);
          return copy;
        });
      }),

    setDefault: (id) =>
      withStorageErrors(async () => {
        await db.transaction("rw", db.assistants, async () => {
          if (!(await db.assistants.get(id))) throw notFound("Assistant", id);
          await db.assistants.toCollection().modify((assistant) => {
            assistant.isDefault = assistant.id === id;
          });
        });
      }),

    delete: (id) =>
      withStorageErrors(async () => {
        await db.transaction("rw", [db.assistants, db.conversations, db.memoryChunks, db.memoryVectors, db.lorebooks], async () => {
          const existing = await db.assistants.get(id);
          if (!existing) return;
          await db.assistants.delete(id);
          await db.conversations.where("assistantId").equals(id).modify({ assistantId: null });
          // Memories private to the assistant go with it; lorebooks bound to it are unbound and disabled.
          const privateChunks = await db.memoryChunks.where("assistantId").equals(id).filter((c) => c.scope === "assistant").primaryKeys();
          await deleteMemoryChunks(db, privateChunks as string[]);
          await db.lorebooks.where("assistantId").equals(id).modify({ assistantId: null, enabled: false });
          if (existing.isDefault) {
            const next = await db.assistants.orderBy("updatedAt").last();
            if (next) await db.assistants.update(next.id, { isDefault: true });
          }
        });
      }),
  };
}
