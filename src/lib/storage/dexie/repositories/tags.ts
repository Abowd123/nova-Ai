import { tagCreateSchema, tagSchema, tagUpdateSchema } from "@/lib/models";
import { notFound, withStorageErrors } from "../../errors";
import type { RepositoryDeps, TagRepository } from "../../types";
import type { NovaDatabase } from "../database";
import { parseOrThrow, parseRecords } from "../utils";

export const DEFAULT_TAG_COLOR = "#6750A4";

export function createTagRepository(db: NovaDatabase, deps: RepositoryDeps): TagRepository {
  return {
    list: () =>
      withStorageErrors(async () =>
        parseRecords(tagSchema, await db.tags.orderBy("order").toArray(), "tag"),
      ),

    get: (id) =>
      withStorageErrors(async () => {
        const row = await db.tags.get(id);
        return row ? parseOrThrow(tagSchema, row, "tag") : undefined;
      }),

    create: (input) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(tagCreateSchema, input, "tag input");
        return db.transaction("rw", db.tags, async () => {
          const timestamp = deps.clock();
          const tag = parseOrThrow(
            tagSchema,
            {
              id: deps.idGenerator(),
              name: data.name,
              color: data.color ?? DEFAULT_TAG_COLOR,
              order: await db.tags.count(),
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            "tag",
          );
          await db.tags.add(tag);
          return tag;
        });
      }),

    update: (id, patch) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(tagUpdateSchema, patch, "tag patch");
        return db.transaction("rw", db.tags, async () => {
          const existing = await db.tags.get(id);
          if (!existing) throw notFound("Tag", id);
          const next = parseOrThrow(tagSchema, { ...existing, ...data, updatedAt: deps.clock() }, "tag");
          await db.tags.put(next);
          return next;
        });
      }),

    reorder: (orderedIds) =>
      withStorageErrors(async () => {
        await db.transaction("rw", db.tags, async () => {
          const timestamp = deps.clock();
          for (const [index, id] of orderedIds.entries()) {
            const updated = await db.tags.update(id, { order: index, updatedAt: timestamp });
            if (updated === 0) throw notFound("Tag", id);
          }
        });
      }),

    delete: (id) =>
      withStorageErrors(async () => {
        await db.transaction("rw", [db.tags, db.conversations, db.assistants], async () => {
          await db.tags.delete(id);
          await db.conversations
            .where("tagIds")
            .equals(id)
            .modify((conversation) => {
              conversation.tagIds = conversation.tagIds.filter((tagId) => tagId !== id);
            });
          await db.assistants
            .where("tagIds")
            .equals(id)
            .modify((assistant) => {
              assistant.tagIds = assistant.tagIds.filter((tagId) => tagId !== id);
            });
        });
      }),
  };
}
