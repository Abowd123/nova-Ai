import Dexie, { type DexieOptions, type Table } from "dexie";
import type {
  Assistant,
  Attachment,
  ComfyWorkflow,
  Conversation,
  ConversationSummary,
  Lorebook,
  McpServer,
  UsageRecord,
  AuditEntry,
  SyncConflict,
  SyncRecordState,
  SyncStateRecord,
  MemoryChunk,
  MemoryVectorRecord,
  ImageGeneration,
  Message,
  Provider,
  SecretRecord,
  SettingsRecord,
  Tag,
} from "@/lib/models";
import { applyMigrations } from "./migrations";

export const DB_NAME = "nova";

export interface CryptoKeyRecord {
  id: string;
  key: CryptoKey;
  createdAt: number;
}

export interface AttachmentBlobRecord {
  id: string;
  blob: Blob;
}

export class NovaDatabase extends Dexie {
  conversations!: Table<Conversation, string>;
  messages!: Table<Message, string>;
  assistants!: Table<Assistant, string>;
  providers!: Table<Provider, string>;
  tags!: Table<Tag, string>;
  attachments!: Table<Attachment, string>;
  settings!: Table<SettingsRecord, string>;
  cryptoKeys!: Table<CryptoKeyRecord, string>;
  attachmentBlobs!: Table<AttachmentBlobRecord, string>;
  secrets!: Table<SecretRecord, string>;
  imageGenerations!: Table<ImageGeneration, string>;
  comfyWorkflows!: Table<ComfyWorkflow, string>;
  memoryChunks!: Table<MemoryChunk, string>;
  memoryVectors!: Table<MemoryVectorRecord, string>;
  summaries!: Table<ConversationSummary, string>;
  lorebooks!: Table<Lorebook, string>;
  mcpServers!: Table<McpServer, string>;
  usageRecords!: Table<UsageRecord, string>;
  syncRecords!: Table<SyncRecordState, string>;
  syncConflicts!: Table<SyncConflict, string>;
  syncState!: Table<SyncStateRecord, string>;
  auditLog!: Table<AuditEntry, string>;

  constructor(name: string = DB_NAME, options?: DexieOptions) {
    super(name, options);
    applyMigrations(this);
  }
}
