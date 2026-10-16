import {
  comfyWorkflowCreateSchema,
  comfyWorkflowSchema,
  comfyWorkflowUpdateSchema,
  imageGenerationCreateSchema,
  imageGenerationSchema,
  imageGenerationUpdateSchema,
} from "@/lib/models";
import { notFound, withStorageErrors } from "../../errors";
import type { ComfyWorkflowRepository, ImageGenerationRepository, RepositoryDeps } from "../../types";
import type { NovaDatabase } from "../database";
import { parseOrThrow, parseRecords } from "../utils";
import { deleteAttachments } from "./attachments";

export function createImageGenerationRepository(db: NovaDatabase, deps: RepositoryDeps): ImageGenerationRepository {
  return {
    list: (options = {}) =>
      withStorageErrors(async () => {
        const rows = await db.imageGenerations.orderBy("createdAt").reverse().limit(options.limit ?? 200).toArray();
        return parseRecords(imageGenerationSchema, rows, "image generation");
      }),
    get: (id) =>
      withStorageErrors(async () => {
        const row = await db.imageGenerations.get(id);
        return row ? parseOrThrow(imageGenerationSchema, row, "image generation") : undefined;
      }),
    listByStatus: (statuses) =>
      withStorageErrors(async () =>
        parseRecords(imageGenerationSchema, await db.imageGenerations.where("status").anyOf(statuses).toArray(), "image generation"),
      ),
    create: (input) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(imageGenerationCreateSchema, input, "image generation input");
        const now = deps.clock();
        const record = parseOrThrow(
          imageGenerationSchema,
          {
            ...data,
            id: deps.idGenerator(),
            status: "queued",
            progress: 0,
            error: null,
            imageIds: [],
            seeds: [],
            revisedPrompt: null,
            remoteJobId: null,
            createdAt: now,
            updatedAt: now,
          },
          "image generation",
        );
        await db.imageGenerations.add(record);
        return record;
      }),
    update: (id, patch) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(imageGenerationUpdateSchema, patch, "image generation patch");
        return db.transaction("rw", db.imageGenerations, async () => {
          const existing = await db.imageGenerations.get(id);
          if (!existing) throw notFound("Image generation", id);
          const next = parseOrThrow(imageGenerationSchema, { ...existing, ...data, updatedAt: deps.clock() }, "image generation");
          await db.imageGenerations.put(next);
          return next;
        });
      }),
    delete: (id) =>
      withStorageErrors(async () => {
        await db.transaction("rw", db.imageGenerations, db.attachments, db.attachmentBlobs, async () => {
          const existing = await db.imageGenerations.get(id);
          if (!existing) return;
          await deleteAttachments(db, existing.imageIds);
          await db.imageGenerations.delete(id);
        });
      }),
  };
}

export function createComfyWorkflowRepository(db: NovaDatabase, deps: RepositoryDeps): ComfyWorkflowRepository {
  return {
    list: () =>
      withStorageErrors(async () => parseRecords(comfyWorkflowSchema, await db.comfyWorkflows.orderBy("name").toArray(), "ComfyUI workflow")),
    get: (id) =>
      withStorageErrors(async () => {
        const row = await db.comfyWorkflows.get(id);
        return row ? parseOrThrow(comfyWorkflowSchema, row, "ComfyUI workflow") : undefined;
      }),
    create: (input) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(comfyWorkflowCreateSchema, input, "ComfyUI workflow input");
        const now = deps.clock();
        const record = parseOrThrow(comfyWorkflowSchema, { ...data, id: deps.idGenerator(), createdAt: now, updatedAt: now }, "ComfyUI workflow");
        await db.comfyWorkflows.add(record);
        return record;
      }),
    update: (id, patch) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(comfyWorkflowUpdateSchema, patch, "ComfyUI workflow patch");
        return db.transaction("rw", db.comfyWorkflows, async () => {
          const existing = await db.comfyWorkflows.get(id);
          if (!existing) throw notFound("ComfyUI workflow", id);
          const next = parseOrThrow(comfyWorkflowSchema, { ...existing, ...data, updatedAt: deps.clock() }, "ComfyUI workflow");
          await db.comfyWorkflows.put(next);
          return next;
        });
      }),
    delete: (id) =>
      withStorageErrors(async () => {
        await db.comfyWorkflows.delete(id);
      }),
  };
}
