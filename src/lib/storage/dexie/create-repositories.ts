import { withStorageErrors } from "../errors";
import type { Repositories, RepositoryDeps } from "../types";
import type { NovaDatabase } from "./database";
import { createAssistantRepository } from "./repositories/assistants";
import { createAttachmentRepository, createIdbBlobStore } from "./repositories/attachments";
import { createConversationRepository } from "./repositories/conversations";
import { createMessageRepository } from "./repositories/messages";
import { createProviderRepository } from "./repositories/providers";
import { createSettingsRepository } from "./repositories/settings";
import { createTagRepository } from "./repositories/tags";
import { createTransferRepository } from "./repositories/transfer";
import { createSecretRepository } from "./repositories/secrets";
import { createComfyWorkflowRepository, createImageGenerationRepository } from "./repositories/image-generations";
import { createMcpServerRepository, createUsageRepository } from "./repositories/tools";
import { createAuditRepository, createBackupRepository, createSyncRepository } from "./repositories/backup";
import { createLorebookRepository, createMemoryRepository, createSummaryRepository } from "./repositories/memory";

function defaultIdGenerator(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createDexieRepositories(
  db: NovaDatabase,
  options: Partial<RepositoryDeps> = {},
): Repositories {
  const deps: RepositoryDeps = {
    clock: options.clock ?? (() => Date.now()),
    idGenerator: options.idGenerator ?? defaultIdGenerator,
  };

  return {
    conversations: createConversationRepository(db, deps),
    messages: createMessageRepository(db, deps),
    assistants: createAssistantRepository(db, deps),
    providers: createProviderRepository(db, deps),
    tags: createTagRepository(db, deps),
    attachments: createAttachmentRepository(db, deps),
    settings: createSettingsRepository(db, deps),
    transfer: createTransferRepository(db, deps),
    blobs: createIdbBlobStore(db),
    secrets: createSecretRepository(db, deps),
    imageGenerations: createImageGenerationRepository(db, deps),
    comfyWorkflows: createComfyWorkflowRepository(db, deps),
    memory: createMemoryRepository(db, deps),
    summaries: createSummaryRepository(db, deps),
    lorebooks: createLorebookRepository(db, deps),
    mcpServers: createMcpServerRepository(db, deps),
    usage: createUsageRepository(db, deps),
    backup: createBackupRepository(db),
    sync: createSyncRepository(db),
    audit: createAuditRepository(db, deps),
    clearAll: () =>
      withStorageErrors(async () => {
        await db.transaction("rw", db.tables, async () => {
          await Promise.all(db.tables.map((table) => table.clear()));
        });
      }),
  };
}
