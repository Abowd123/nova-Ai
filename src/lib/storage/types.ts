import type {
  AuditEntry,
  AuditKind,
  SyncConflict,
  SyncRecordState,
  AppSettings,
  AppSettingsPatch,
  Assistant,
  AssistantCreateInput,
  AssistantUpdateInput,
  Attachment,
  AttachmentCreateInput,
  AttachmentUpdateInput,
  ComfyWorkflow,
  ComfyWorkflowCreateInput,
  ComfyWorkflowUpdateInput,
  ImageGeneration,
  ImageGenerationCreateInput,
  ImageGenerationUpdateInput,
  EncryptedSecret,
  Conversation,
  ConversationCreateInput,
  ConversationUpdateInput,
  Message,
  MessageCreateInput,
  MessageUpdateInput,
  Provider,
  ProviderCreateInput,
  ProviderUpdateInput,
  Tag,
  TagCreateInput,
  TagUpdateInput,
  ConversationSummary,
  ConversationSummaryPut,
  Lorebook,
  LorebookCreateInput,
  LorebookUpdateInput,
  MemoryChunk,
  MemoryChunkCreateInput,
  MemoryChunkScope,
  MemoryChunkUpdateInput,
  McpServer,
  McpServerCreateInput,
  McpServerUpdateInput,
  UsageKind,
  UsageRecord,
  UsageRecordInput,
} from "@/lib/models";

/**
 * Storage-agnostic repository contracts. The UI depends ONLY on these interfaces,
 * never on Dexie. Swap implementations (in-memory, remote sync) without UI changes.
 */
export interface ListConversationsOptions {
  /** Matches titles and message content (Arabic-normalized). */
  query?: string;
  includeArchived?: boolean;
  limit?: number;
}

export interface ConversationRepository {
  list(options?: ListConversationsOptions): Promise<Conversation[]>;
  get(id: string): Promise<Conversation | undefined>;
  create(input?: ConversationCreateInput): Promise<Conversation>;
  update(id: string, patch: ConversationUpdateInput): Promise<Conversation>;
  delete(id: string): Promise<void>;
}

export interface MessageRepository {
  listByConversation(conversationId: string): Promise<Message[]>;
  listByStatus(status: Message["status"]): Promise<Message[]>;
  get(id: string): Promise<Message | undefined>;
  create(input: MessageCreateInput): Promise<Message>;
  update(id: string, patch: MessageUpdateInput): Promise<Message>;
  delete(id: string): Promise<void>;
  /** Deletes every message created after `messageId` (and the message itself if inclusive). */
  deleteAfter(messageId: string, options?: { inclusive?: boolean }): Promise<number>;
  deleteByConversation(conversationId: string): Promise<void>;
}

export interface AssistantRepository {
  list(options?: { query?: string }): Promise<Assistant[]>;
  get(id: string): Promise<Assistant | undefined>;
  getDefault(): Promise<Assistant | undefined>;
  create(input: AssistantCreateInput): Promise<Assistant>;
  update(id: string, patch: AssistantUpdateInput): Promise<Assistant>;
  duplicate(id: string, overrides?: { name?: string }): Promise<Assistant>;
  setDefault(id: string): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ProviderRepository {
  list(): Promise<Provider[]>;
  get(id: string): Promise<Provider | undefined>;
  create(input: ProviderCreateInput): Promise<Provider>;
  update(id: string, patch: ProviderUpdateInput): Promise<Provider>;
  delete(id: string): Promise<void>;
}

export interface TagRepository {
  list(): Promise<Tag[]>;
  get(id: string): Promise<Tag | undefined>;
  create(input: TagCreateInput): Promise<Tag>;
  update(id: string, patch: TagUpdateInput): Promise<Tag>;
  reorder(orderedIds: string[]): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface AttachmentRepository {
  get(id: string): Promise<Attachment | undefined>;
  getMany(ids: string[]): Promise<Attachment[]>;
  listByMessage(messageId: string): Promise<Attachment[]>;
  listByConversation(conversationId: string): Promise<Attachment[]>;
  /** Drafts not yet linked to a message (composer), oldest first. */
  listUnlinked(olderThan?: number): Promise<Attachment[]>;
  /** Stores metadata AND the binary atomically (IndexedDB) or after writing to OPFS. */
  create(input: AttachmentCreateInput, blob?: Blob): Promise<Attachment>;
  update(id: string, patch: AttachmentUpdateInput): Promise<Attachment>;
  /** Links drafts (and their derived frames) to a sent message. */
  link(ids: string[], target: { conversationId: string; messageId: string }): Promise<void>;
  /** Deletes metadata, IndexedDB blob and derived frames. */
  delete(id: string): Promise<void>;
  /** All ids (used to sweep orphaned OPFS files). */
  allIds(): Promise<string[]>;
}

/** Binary storage behind attachments: IndexedDB or the Origin Private File System. */
export interface BlobStore {
  readonly kind: "idb" | "opfs";
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | undefined>;
  delete(id: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface SecretRepository {
  get(id: string): Promise<EncryptedSecret | undefined>;
  set(id: string, value: EncryptedSecret): Promise<void>;
  delete(id: string): Promise<void>;
  has(id: string): Promise<boolean>;
  /** Ids + dates only (security center, backups). */
  list(): Promise<{ id: string; updatedAt: number }[]>;
}

export interface ImageGenerationRepository {
  list(options?: { limit?: number }): Promise<ImageGeneration[]>;
  get(id: string): Promise<ImageGeneration | undefined>;
  listByStatus(statuses: ImageGeneration["status"][]): Promise<ImageGeneration[]>;
  create(input: ImageGenerationCreateInput): Promise<ImageGeneration>;
  update(id: string, patch: ImageGenerationUpdateInput): Promise<ImageGeneration>;
  /** Deletes the record and its image attachments. */
  delete(id: string): Promise<void>;
}

export interface ComfyWorkflowRepository {
  list(): Promise<ComfyWorkflow[]>;
  get(id: string): Promise<ComfyWorkflow | undefined>;
  create(input: ComfyWorkflowCreateInput): Promise<ComfyWorkflow>;
  update(id: string, patch: ComfyWorkflowUpdateInput): Promise<ComfyWorkflow>;
  delete(id: string): Promise<void>;
}

export interface MemoryListFilter {
  scope?: MemoryChunkScope | "all";
  assistantId?: string | null;
  conversationId?: string | null;
  source?: "message" | "manual";
}

export interface MemoryIndexStats {
  total: number;
  /** Embedded with the current model. */
  indexed: number;
  pending: number;
  errors: number;
}

export interface MemoryRepository {
  /** Newest first. */
  list(filter?: MemoryListFilter, page?: { limit?: number; offset?: number }): Promise<{ items: MemoryChunk[]; total: number }>;
  get(id: string): Promise<MemoryChunk | undefined>;
  getMany(ids: string[]): Promise<MemoryChunk[]>;
  /** Dedupes on `hash`: returns the existing chunk with created=false. */
  create(input: MemoryChunkCreateInput): Promise<{ chunk: MemoryChunk; created: boolean }>;
  /** Changing the text invalidates the stored vector. */
  update(id: string, patch: MemoryChunkUpdateInput): Promise<MemoryChunk>;
  delete(ids: string[]): Promise<void>;
  /** Every chunk plus its vector for `modelKey` (null when missing) — loads the search index. */
  listForIndex(modelKey: string): Promise<{ chunk: MemoryChunk; vector: Float32Array | null }[]>;
  /** Chunks not embedded with `modelKey` (errors excluded unless includeErrors). Oldest first. */
  listPending(modelKey: string, limit: number, options?: { includeErrors?: boolean }): Promise<MemoryChunk[]>;
  saveVectors(modelKey: string, items: { id: string; vector: Float32Array }[]): Promise<void>;
  markError(ids: string[], message: string): Promise<void>;
  /** Retry failed chunks (status error -> pending). */
  resetErrors(): Promise<number>;
  /** Drops vectors of other models (after a model change) to free space. */
  pruneVectors(keepModelKey: string): Promise<number>;
  stats(modelKey: string): Promise<MemoryIndexStats>;
}

export interface SummaryRepository {
  get(conversationId: string): Promise<ConversationSummary | undefined>;
  put(conversationId: string, data: ConversationSummaryPut): Promise<ConversationSummary>;
  delete(conversationId: string): Promise<void>;
}

export interface LorebookRepository {
  list(): Promise<Lorebook[]>;
  get(id: string): Promise<Lorebook | undefined>;
  create(input: LorebookCreateInput): Promise<Lorebook>;
  update(id: string, patch: LorebookUpdateInput): Promise<Lorebook>;
  delete(id: string): Promise<void>;
}

export interface McpServerRepository {
  list(): Promise<McpServer[]>;
  get(id: string): Promise<McpServer | undefined>;
  create(input: McpServerCreateInput): Promise<McpServer>;
  update(id: string, patch: McpServerUpdateInput): Promise<McpServer>;
  delete(id: string): Promise<void>;
}

export interface UsageTotals {
  kind: UsageKind;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  /** Records whose model price is unknown. */
  unpriced: number;
  count: number;
}

export interface UsageRepository {
  add(record: UsageRecordInput): Promise<UsageRecord>;
  /** Newest first. */
  list(options?: { since?: number; limit?: number }): Promise<UsageRecord[]>;
  totals(since?: number): Promise<UsageTotals[]>;
  clear(): Promise<void>;
}

export interface SettingsRepository {
  get(): Promise<AppSettings>;
  update(patch: AppSettingsPatch): Promise<AppSettings>;
  reset(): Promise<AppSettings>;
}

export interface TransferIndex {
  assistants: { id: string; name: string; isDefault: boolean }[];
  tags: { id: string; name: string }[];
  providers: { id: string; name: string }[];
  conversations: { id: string; title: string }[];
}

export interface TransferBatch {
  assistants: Assistant[];
  tags: Tag[];
  providers: Provider[];
  conversations: Conversation[];
  messages: Message[];
  /** null = keep current settings. */
  settings: AppSettings | null;
  /** Conversations being overwritten: their existing messages are removed first. */
  replaceMessagesFor: string[];
}

export interface TransferWriteOptions {
  /** Clear assistants, tags and providers (and settings if provided) before writing. */
  replace: boolean;
  /** Also clear conversations/messages/attachments (only when the file carries conversations). */
  replaceConversations: boolean;
}

export interface TransferRepository {
  index(): Promise<TransferIndex>;
  readAll(options: { includeConversations: boolean }): Promise<{
    assistants: Assistant[];
    tags: Tag[];
    providers: Provider[];
    settings: AppSettings;
    conversations: Conversation[];
    messages: Message[];
  }>;
  /** Validates every record, then writes everything in ONE transaction (all-or-nothing). */
  write(batch: TransferBatch, options: TransferWriteOptions): Promise<void>;
}

/** Raw table access for full backups and sync (records were validated when first written). */
export interface BackupRepository {
  /** Tables included in backups / sync (never cryptoKeys, secrets, blobs or sync bookkeeping). */
  dataTables(): readonly string[];
  rows(table: string): Promise<Record<string, unknown>[]>;
  getRows(table: string, ids: readonly string[]): Promise<(Record<string, unknown> | undefined)[]>;
  /** Replaces the given tables (all-or-nothing). */
  replaceTables(data: Record<string, Record<string, unknown>[]>): Promise<void>;
  putRows(table: string, rows: Record<string, unknown>[]): Promise<void>;
  deleteRows(table: string, ids: string[]): Promise<void>;
}

export interface SyncRepository {
  records(keys?: readonly string[]): Promise<SyncRecordState[]>;
  putRecords(states: SyncRecordState[]): Promise<void>;
  clearRecords(): Promise<void>;
  getState<T = unknown>(key: string): Promise<T | undefined>;
  setState(key: string, value: unknown): Promise<void>;
  deleteState(key: string): Promise<void>;
  addConflict(conflict: SyncConflict): Promise<void>;
  conflicts(status?: SyncConflict["status"]): Promise<SyncConflict[]>;
  getConflict(id: string): Promise<SyncConflict | undefined>;
  resolveConflict(id: string, at: number): Promise<void>;
  clearConflicts(): Promise<void>;
}

export interface AuditRepository {
  add(kind: AuditKind, detail: string): Promise<AuditEntry>;
  list(limit?: number): Promise<AuditEntry[]>;
  clear(): Promise<void>;
}

export interface Repositories {
  transfer: TransferRepository;
  conversations: ConversationRepository;
  messages: MessageRepository;
  assistants: AssistantRepository;
  providers: ProviderRepository;
  tags: TagRepository;
  attachments: AttachmentRepository;
  /** IndexedDB blob store (always available). OPFS store lives in lib/storage/opfs-blob-store. */
  blobs: BlobStore;
  secrets: SecretRepository;
  imageGenerations: ImageGenerationRepository;
  comfyWorkflows: ComfyWorkflowRepository;
  memory: MemoryRepository;
  summaries: SummaryRepository;
  lorebooks: LorebookRepository;
  mcpServers: McpServerRepository;
  usage: UsageRepository;
  backup: BackupRepository;
  sync: SyncRepository;
  audit: AuditRepository;
  settings: SettingsRepository;
  /** Deletes ALL local user data (privacy: "delete my data"). */
  clearAll(): Promise<void>;
}

export interface RepositoryDeps {
  clock: () => number;
  idGenerator: () => string;
}
