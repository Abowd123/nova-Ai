import type Dexie from "dexie";
import { migrateAssistantRecord } from "@/lib/models/assistant";
import { migrateAttachmentRecord } from "@/lib/models/attachment";
import type { Transaction } from "dexie";

/**
 * Versioned IndexedDB schema. NEVER edit a released version: add a new one.
 * Note: booleans are not valid IndexedDB keys, so flags (pinned, isDefault) are not indexed.
 */
export const SCHEMA_V1 = {
  conversations: "id, updatedAt, createdAt",
  messages: "id, conversationId, [conversationId+createdAt]",
  assistants: "id, name, updatedAt",
  providers: "id, kind",
  tags: "id, name",
  attachments: "id, messageId, conversationId",
  settings: "key",
} as const;

export const SCHEMA_V2 = {
  conversations: "id, updatedAt, createdAt, assistantId, *tagIds",
  assistants: "id, name, updatedAt, *tagIds",
  tags: "id, name, order",
} as const;

export const SCHEMA_V3 = {
  messages: "id, conversationId, [conversationId+createdAt], status",
  cryptoKeys: "id",
} as const;

/** v5 (release 1.2): attachment binaries, service secrets, image generation history, ComfyUI workflows. */
export const SCHEMA_V5 = {
  attachments: "id, messageId, conversationId, derivedFrom, createdAt",
  attachmentBlobs: "id",
  secrets: "id",
  imageGenerations: "id, createdAt, status",
  comfyWorkflows: "id, name",
} as const;

/** v6 (release 1.3): RAG memory chunks + vectors, conversation summaries, lorebooks. */
export const SCHEMA_V6 = {
  memoryChunks: "id, hash, scope, assistantId, conversationId, sourceMessageId, embeddingModel, status, createdAt",
  memoryVectors: "id, model",
  summaries: "id",
  lorebooks: "id, name, assistantId, conversationId",
} as const;

/** v7 (release 1.4): MCP servers and usage records (sub-agent / auxiliary cost tracking). */
export const SCHEMA_V7 = {
  mcpServers: "id, &slug",
  usageRecords: "id, kind, createdAt, conversationId",
} as const;

/** v8 (1.4.2): incremental sync state, conflicts and the local audit log. */
export const SCHEMA_V8 = {
  syncRecords: "key, table",
  syncConflicts: "id, status, createdAt",
  syncState: "key",
  auditLog: "id, at, kind",
} as const;

export const LATEST_DB_VERSION = 8;

type LooseRecord = Record<string, unknown>;

/** v1 -> v2: adds pinned/archived/tagIds/messageCount/lastMessageAt and assistant defaults. */
export async function upgradeToV2(tx: Transaction): Promise<void> {
  const stats = new Map<string, { count: number; last: number }>();
  await tx.table("messages").each((message: LooseRecord) => {
    const conversationId = String(message.conversationId);
    const createdAt = typeof message.createdAt === "number" ? message.createdAt : 0;
    const current = stats.get(conversationId) ?? { count: 0, last: 0 };
    stats.set(conversationId, {
      count: current.count + 1,
      last: Math.max(current.last, createdAt),
    });
  });

  await tx
    .table("conversations")
    .toCollection()
    .modify((conversation: LooseRecord) => {
      const stat = stats.get(String(conversation.id));
      conversation.pinned = conversation.pinned === true;
      conversation.archived = conversation.archived === true;
      conversation.tagIds = Array.isArray(conversation.tagIds) ? conversation.tagIds : [];
      conversation.assistantId =
        typeof conversation.assistantId === "string" ? conversation.assistantId : null;
      conversation.messageCount = stat?.count ?? 0;
      conversation.lastMessageAt = stat && stat.last > 0 ? stat.last : null;
    });

  await tx
    .table("assistants")
    .toCollection()
    .modify((assistant: LooseRecord) => {
      assistant.isDefault = assistant.isDefault === true;
      assistant.tagIds = Array.isArray(assistant.tagIds) ? assistant.tagIds : [];
      assistant.temperature = typeof assistant.temperature === "number" ? assistant.temperature : 0.7;
      assistant.defaultProviderId = assistant.defaultProviderId ?? null;
      assistant.defaultModelId = assistant.defaultModelId ?? null;
      assistant.description = assistant.description ?? "";
      assistant.avatar = assistant.avatar ?? "✨";
      assistant.systemPrompt = assistant.systemPrompt ?? "";
      assistant.schemaVersion = 1;
    });

  let order = 0;
  await tx
    .table("tags")
    .toCollection()
    .modify((tag: LooseRecord) => {
      if (typeof tag.order !== "number") tag.order = order;
      order += 1;
    });
}

const DEFAULT_TITLES = new Set(["New conversation", "محادثة جديدة", "New chat"]);

/**
 * v2 -> v3 (release 1.0):
 *  - messages: content -> parts[], provider/model/usage/finishReason/heartbeatAt
 *  - conversations: titleSource, providerId, modelId
 *  - providers: transport, encryptedHeaders, models, defaultModelId; drops plaintext `headers`
 *    (no UI could set them before 1.0, and they may hold credentials).
 *  - new cryptoKeys table for the non-extractable vault key.
 */
export async function upgradeToV3(tx: Transaction): Promise<void> {
  await tx
    .table("messages")
    .toCollection()
    .modify((message: LooseRecord) => {
      const content = typeof message.content === "string" ? message.content : "";
      if (!Array.isArray(message.parts)) {
        message.parts = content ? [{ type: "text", text: content }] : [];
      }
      message.content = content;
      message.providerId = message.providerId ?? null;
      message.modelId = message.modelId ?? null;
      message.usage = message.usage ?? null;
      message.finishReason = message.finishReason ?? null;
      message.heartbeatAt = null;
      if (message.status === "streaming" || message.status === "pending") {
        message.status = "interrupted";
      }
    });

  await tx
    .table("conversations")
    .toCollection()
    .modify((conversation: LooseRecord) => {
      const title = typeof conversation.title === "string" ? conversation.title : "";
      conversation.titleSource = DEFAULT_TITLES.has(title) ? "default" : "manual";
      conversation.providerId = conversation.providerId ?? null;
      conversation.modelId = conversation.modelId ?? null;
    });

  await tx
    .table("providers")
    .toCollection()
    .modify((provider: LooseRecord) => {
      delete provider.headers;
      delete provider.apiKey;
      provider.transport = provider.transport === "proxy" ? "proxy" : "direct";
      provider.encryptedHeaders = provider.encryptedHeaders ?? null;
      provider.models = Array.isArray(provider.models) ? provider.models : [];
      provider.defaultModelId = provider.defaultModelId ?? null;
    });
}

/** v3 -> v4 (release 1.1): assistant schemaVersion 2 (model params, tools, voice, memory, starters). */
export async function upgradeToV4(tx: Transaction): Promise<void> {
  await tx
    .table("assistants")
    .toCollection()
    .modify((assistant: LooseRecord) => {
      Object.assign(assistant, migrateAssistantRecord(assistant));
    });
  // Tags gained an explicit order in v2; make sure every row has one (imports from 1.0 files).
  let order = 0;
  await tx
    .table("tags")
    .orderBy("order")
    .modify((tag: LooseRecord) => {
      tag.order = order;
      order += 1;
    });
}

/** v4 -> v5: attachments gain storage/thumbnail/metadata fields. */
export async function upgradeToV5(tx: Transaction): Promise<void> {
  await tx
    .table("attachments")
    .toCollection()
    .modify((attachment: LooseRecord) => {
      Object.assign(attachment, migrateAttachmentRecord(attachment));
    });
}

/** v5 -> v6: new tables only; messages gain an optional `context` (defaults to null on read). */
export async function upgradeToV6(tx: Transaction): Promise<void> {
  await tx
    .table("messages")
    .toCollection()
    .modify((message: LooseRecord) => {
      if (message.context === undefined) message.context = null;
    });
}

export function applyMigrations(db: Dexie): void {
  db.version(1).stores(SCHEMA_V1);
  db.version(2).stores(SCHEMA_V2).upgrade(upgradeToV2);
  db.version(3).stores(SCHEMA_V3).upgrade(upgradeToV3);
  db.version(4).stores({}).upgrade(upgradeToV4);
  db.version(5).stores(SCHEMA_V5).upgrade(upgradeToV5);
  db.version(6).stores(SCHEMA_V6).upgrade(upgradeToV6);
  db.version(7).stores(SCHEMA_V7);
  db.version(8).stores(SCHEMA_V8);
}
