import {
  conversationSummaryPutSchema,
  conversationSummarySchema,
  lorebookCreateSchema,
  lorebookSchema,
  lorebookUpdateSchema,
  memoryChunkCreateSchema,
  memoryChunkSchema,
  memoryChunkUpdateSchema,
  DEFAULT_LOREBOOK,
  type MemoryChunk,
} from "@/lib/models";
import { notFound, withStorageErrors } from "../../errors";
import type { LorebookRepository, MemoryListFilter, MemoryRepository, RepositoryDeps, SummaryRepository } from "../../types";
import type { NovaDatabase } from "../database";
import { parseOrThrow, parseRecords } from "../utils";

/** Deletes chunks and their vectors. Must run inside a transaction covering both tables. */
export async function deleteMemoryChunks(db: NovaDatabase, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.memoryChunks.bulkDelete([...ids]);
  await db.memoryVectors.bulkDelete([...ids]);
}

/** Cascade for deleted messages (regenerate / edit / delete). */
export async function deleteMemoryForMessages(db: NovaDatabase, messageIds: readonly string[]): Promise<void> {
  if (messageIds.length === 0) return;
  await deleteMemoryChunks(db, (await db.memoryChunks.where("sourceMessageId").anyOf([...messageIds]).primaryKeys()) as string[]);
}

/** Cascade for a deleted conversation: its private memories, summary and bound lorebooks. Shared memories stay. */
export async function deleteMemoryForConversation(db: NovaDatabase, conversationId: string): Promise<void> {
  const chunks = await db.memoryChunks.where("conversationId").equals(conversationId).filter((c) => c.scope === "conversation").primaryKeys();
  await deleteMemoryChunks(db, chunks as string[]);
  await db.summaries.delete(conversationId);
  await db.lorebooks.where("conversationId").equals(conversationId).delete();
}

/** Tables touched by the cascades above. */
export function memoryTables(db: NovaDatabase) {
  return [db.memoryChunks, db.memoryVectors, db.summaries, db.lorebooks];
}

function matches(chunk: MemoryChunk, filter: MemoryListFilter): boolean {
  if (filter.scope && filter.scope !== "all" && chunk.scope !== filter.scope) return false;
  if (filter.assistantId !== undefined && chunk.assistantId !== filter.assistantId) return false;
  if (filter.conversationId !== undefined && chunk.conversationId !== filter.conversationId) return false;
  if (filter.source && chunk.source !== filter.source) return false;
  return true;
}

export function createMemoryRepository(db: NovaDatabase, deps: RepositoryDeps): MemoryRepository {
  const parse = (rows: unknown[]) => parseRecords(memoryChunkSchema, rows, "memory chunk");
  return {
    list: (filter = {}, page = {}) =>
      withStorageErrors(async () => {
        const limit = page.limit ?? 50;
        const offset = page.offset ?? 0;
        const collection = db.memoryChunks.orderBy("createdAt").reverse();
        const all = Object.keys(filter).length ? collection.filter((c) => matches(c, filter)) : collection;
        const [total, rows] = await Promise.all([all.clone().count(), all.clone().offset(offset).limit(limit).toArray()]);
        return { items: parse(rows), total };
      }),
    get: (id) =>
      withStorageErrors(async () => {
        const row = await db.memoryChunks.get(id);
        return row ? parseOrThrow(memoryChunkSchema, row, "memory chunk") : undefined;
      }),
    getMany: (ids) =>
      withStorageErrors(async () => {
        const rows = await db.memoryChunks.bulkGet(ids);
        return parse(rows.filter((r): r is MemoryChunk => Boolean(r)));
      }),
    create: (input) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(memoryChunkCreateSchema, input, "memory input");
        return db.transaction("rw", db.memoryChunks, async () => {
          const existing = await db.memoryChunks.where("hash").equals(data.hash).first();
          if (existing) return { chunk: parseOrThrow(memoryChunkSchema, existing, "memory chunk"), created: false };
          const now = deps.clock();
          const chunk = parseOrThrow(
            memoryChunkSchema,
            {
              id: deps.idGenerator(),
              text: data.text,
              scope: data.scope,
              assistantId: data.assistantId ?? null,
              conversationId: data.conversationId ?? null,
              sourceMessageId: data.sourceMessageId ?? null,
              source: data.source,
              role: data.role ?? null,
              chunkIndex: data.chunkIndex ?? 0,
              tokens: data.tokens,
              hash: data.hash,
              embeddingModel: "",
              dims: 0,
              status: "pending",
              error: null,
              indexedAt: null,
              createdAt: now,
              updatedAt: now,
            },
            "memory chunk",
          );
          await db.memoryChunks.add(chunk);
          return { chunk, created: true };
        });
      }),
    update: (id, patch) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(memoryChunkUpdateSchema, patch, "memory patch");
        return db.transaction("rw", db.memoryChunks, db.memoryVectors, async () => {
          const existing = await db.memoryChunks.get(id);
          if (!existing) throw notFound("Memory", id);
          const textChanged = data.text !== undefined && data.text !== existing.text;
          const next = parseOrThrow(
            memoryChunkSchema,
            {
              ...existing,
              ...data,
              ...(textChanged ? { embeddingModel: "", dims: 0, status: "pending", error: null, indexedAt: null } : {}),
              updatedAt: deps.clock(),
            },
            "memory chunk",
          );
          await db.memoryChunks.put(next);
          if (textChanged) await db.memoryVectors.delete(id);
          return next;
        });
      }),
    delete: (ids) =>
      withStorageErrors(async () => {
        await db.transaction("rw", db.memoryChunks, db.memoryVectors, () => deleteMemoryChunks(db, ids));
      }),
    listForIndex: (modelKey) =>
      withStorageErrors(async () => {
        const [chunks, vectors] = await Promise.all([db.memoryChunks.toArray(), modelKey ? db.memoryVectors.where("model").equals(modelKey).toArray() : []]);
        const byId = new Map(vectors.map((v) => [v.id, v.vector]));
        return parse(chunks).map((chunk) => ({ chunk, vector: byId.get(chunk.id) ?? null }));
      }),
    listPending: (modelKey, limit, options = {}) =>
      withStorageErrors(async () => {
        const rows = await db.memoryChunks
          .where("embeddingModel")
          .notEqual(modelKey)
          .filter((c) => options.includeErrors || c.status !== "error")
          .limit(Math.max(1, limit))
          .toArray();
        return parse(rows).sort((a, b) => a.createdAt - b.createdAt);
      }),
    saveVectors: (modelKey, items) =>
      withStorageErrors(async () => {
        if (items.length === 0) return;
        const now = deps.clock();
        await db.transaction("rw", db.memoryChunks, db.memoryVectors, async () => {
          const existing = new Set((await db.memoryChunks.where("id").anyOf(items.map((i) => i.id)).primaryKeys()) as string[]);
          const live = items.filter((i) => existing.has(i.id)); // chunk deleted while embedding: drop the vector
          await db.memoryVectors.bulkPut(live.map((i) => ({ id: i.id, model: modelKey, dims: i.vector.length, vector: i.vector, createdAt: now })));
          for (const item of live) {
            await db.memoryChunks.update(item.id, { embeddingModel: modelKey, dims: item.vector.length, status: "indexed", error: null, indexedAt: now, updatedAt: now });
          }
        });
      }),
    markError: (ids, message) =>
      withStorageErrors(async () => {
        await db.memoryChunks.where("id").anyOf([...ids]).modify({ status: "error", error: message.slice(0, 500), updatedAt: deps.clock() });
      }),
    resetErrors: () =>
      withStorageErrors(async () => db.memoryChunks.where("status").equals("error").modify({ status: "pending", error: null })),
    pruneVectors: (keepModelKey) =>
      withStorageErrors(async () => db.memoryVectors.where("model").notEqual(keepModelKey).delete()),
    stats: (modelKey) =>
      withStorageErrors(async () => {
        const [total, indexed, errors] = await Promise.all([
          db.memoryChunks.count(),
          modelKey ? db.memoryChunks.where("embeddingModel").equals(modelKey).count() : Promise.resolve(0),
          db.memoryChunks.where("status").equals("error").count(),
        ]);
        return { total, indexed, errors, pending: Math.max(0, total - indexed - errors) };
      }),
  };
}

export function createSummaryRepository(db: NovaDatabase, deps: RepositoryDeps): SummaryRepository {
  return {
    get: (conversationId) =>
      withStorageErrors(async () => {
        const row = await db.summaries.get(conversationId);
        return row ? parseOrThrow(conversationSummarySchema, row, "summary") : undefined;
      }),
    put: (conversationId, input) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(conversationSummaryPutSchema, input, "summary input");
        return db.transaction("rw", db.summaries, async () => {
          const existing = await db.summaries.get(conversationId);
          const now = deps.clock();
          const record = parseOrThrow(conversationSummarySchema, { ...data, id: conversationId, createdAt: existing?.createdAt ?? now, updatedAt: now }, "summary");
          await db.summaries.put(record);
          return record;
        });
      }),
    delete: (conversationId) =>
      withStorageErrors(async () => {
        await db.summaries.delete(conversationId);
      }),
  };
}

export function createLorebookRepository(db: NovaDatabase, deps: RepositoryDeps): LorebookRepository {
  return {
    list: () => withStorageErrors(async () => parseRecords(lorebookSchema, await db.lorebooks.orderBy("name").toArray(), "lorebook")),
    get: (id) =>
      withStorageErrors(async () => {
        const row = await db.lorebooks.get(id);
        return row ? parseOrThrow(lorebookSchema, row, "lorebook") : undefined;
      }),
    create: (input) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(lorebookCreateSchema, input, "lorebook input");
        const now = deps.clock();
        const record = parseOrThrow(lorebookSchema, { ...DEFAULT_LOREBOOK, ...data, id: deps.idGenerator(), createdAt: now, updatedAt: now }, "lorebook");
        await db.lorebooks.add(record);
        return record;
      }),
    update: (id, patch) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(lorebookUpdateSchema, patch, "lorebook patch");
        return db.transaction("rw", db.lorebooks, async () => {
          const existing = await db.lorebooks.get(id);
          if (!existing) throw notFound("Lorebook", id);
          const next = parseOrThrow(lorebookSchema, { ...existing, ...data, updatedAt: deps.clock() }, "lorebook");
          await db.lorebooks.put(next);
          return next;
        });
      }),
    delete: (id) =>
      withStorageErrors(async () => {
        await db.lorebooks.delete(id);
      }),
  };
}
