import { DEFAULT_SETTINGS, migrateAssistantRecord, type AppSettings, type Assistant, type Conversation, type Message, type Provider, type ProviderModel, type Tag } from "@/lib/models";
import { normalizeForSearch } from "@/lib/text";
import type { TransferBatch, TransferIndex } from "@/lib/storage/types";
import { TransferError } from "./errors";
import { migrateExport } from "./migrate";
import {
  ASSISTANT_FORMAT,
  ENCRYPTED_FORMAT,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  MAX_IMPORT_BYTES,
  encryptedEnvelopeSchema,
  exportSnapshotSchema,
  sharedAssistantSchema,
  type EncryptedEnvelope,
  type ExportSnapshot,
  type ExportedSecrets,
} from "./format";

export type ParsedImport =
  | { kind: "encrypted"; envelope: EncryptedEnvelope }
  | { kind: "snapshot"; snapshot: ExportSnapshot; migratedFrom: number | null; source: "backup" | "assistant" };

function issuesOf(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): string[] {
  return error.issues.slice(0, 20).map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`);
}

/** Detects the file type, migrates older versions and validates strictly. */
export function parseImportText(text: string): ParsedImport {
  if (new Blob([text]).size > MAX_IMPORT_BYTES) throw new TransferError("too_large", "File is too large");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new TransferError("invalid_json", "File is not valid JSON", [], { cause: error });
  }
  const format = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as { format?: unknown }).format : undefined;

  if (format === ENCRYPTED_FORMAT) {
    const parsed = encryptedEnvelopeSchema.safeParse(raw);
    if (!parsed.success) throw new TransferError("invalid_data", "Encrypted file header is invalid", issuesOf(parsed.error));
    return { kind: "encrypted", envelope: parsed.data };
  }

  if (format === ASSISTANT_FORMAT) {
    const input = raw as { assistant?: unknown; version?: unknown };
    if (typeof input.version === "number" && input.version > 1) throw new TransferError("newer_version", "Assistant file is newer than this app");
    const migrated = { ...(raw as object), assistant: migrateAssistantRecord(input.assistant) };
    const parsed = sharedAssistantSchema.safeParse(migrated);
    if (!parsed.success) throw new TransferError("invalid_data", "Assistant file is invalid", issuesOf(parsed.error));
    const snapshot: ExportSnapshot = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: parsed.data.exportedAt,
      app: { name: "Nova", version: "shared" },
      assistants: [parsed.data.assistant],
      tags: parsed.data.tags,
      providers: [],
      models: [],
      settings: DEFAULT_SETTINGS,
    };
    return { kind: "snapshot", snapshot, migratedFrom: null, source: "assistant" };
  }

  const { data, migratedFrom } = migrateExport(raw);
  const parsed = exportSnapshotSchema.safeParse(data);
  if (!parsed.success) throw new TransferError("invalid_data", "Backup file is invalid", issuesOf(parsed.error));
  return { kind: "snapshot", snapshot: parsed.data, migratedFrom, source: "backup" };
}

export type ImportMode = "merge" | "replace";
/** What to do when an imported id already exists locally (merge mode). */
export type ConflictStrategy = "overwrite" | "skip" | "duplicate";
export type EntityKind = "assistant" | "tag" | "provider" | "conversation";
export type ImportAction = "add" | "overwrite" | "skip" | "duplicate" | "reuse";

export interface ImportConflict {
  entity: EntityKind;
  id: string;
  importedName: string;
  existingName: string;
  action: ImportAction;
  /** Same name, different id: matched instead of creating a duplicate tag. */
  reason: "same-id" | "same-name";
}

export interface EntityCounts {
  total: number;
  add: number;
  overwrite: number;
  skip: number;
  duplicate: number;
  reuse: number;
}

export interface PendingSecret {
  providerId: string;
  secrets: ExportedSecrets;
}

export interface ImportPlan {
  mode: ImportMode;
  strategy: ConflictStrategy;
  counts: Record<EntityKind, EntityCounts>;
  conflicts: ImportConflict[];
  duplicateIdsInFile: { entity: EntityKind | "message"; id: string }[];
  warnings: ("providers_without_keys" | "keys_included" | "migrated" | "settings_skipped" | "replace_deletes_data")[];
  batch: TransferBatch;
  secrets: PendingSecret[];
  /** Providers imported without a key: keep the local encrypted key if the id already exists. */
  preserveSecretsFor: string[];
  /** The file carried a conversations section (replace mode then replaces conversations too). */
  includesConversations: boolean;
}

export interface PlanOptions {
  mode: ImportMode;
  strategy: ConflictStrategy;
  applySettings: boolean;
  idGenerator: () => string;
  migratedFrom?: number | null;
}

const emptyCounts = (): EntityCounts => ({ total: 0, add: 0, overwrite: 0, skip: 0, duplicate: 0, reuse: 0 });

/**
 * Pure planning step: decides per record whether to add/overwrite/skip/duplicate, dedupes ids
 * inside the file, remaps every reference (tags, providers, assistants, conversations) and
 * produces a ready-to-write batch plus a human-readable conflict report.
 */
export function planImport(snapshot: ExportSnapshot, existing: TransferIndex, options: PlanOptions): ImportPlan {
  const merge = options.mode === "merge";
  const counts: Record<EntityKind, EntityCounts> = { assistant: emptyCounts(), tag: emptyCounts(), provider: emptyCounts(), conversation: emptyCounts() };
  const conflicts: ImportConflict[] = [];
  const duplicateIdsInFile: ImportPlan["duplicateIdsInFile"] = [];
  const warnings: ImportPlan["warnings"] = [];

  /** Gives later duplicates inside the file a fresh id. References resolve to the first. */
  function dedupe<T extends { id: string }>(entity: EntityKind | "message", items: T[]): { item: T; originalId: string; first: boolean }[] {
    const seen = new Set<string>();
    return items.map((item) => {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        return { item, originalId: item.id, first: true };
      }
      duplicateIdsInFile.push({ entity, id: item.id });
      return { item: { ...item, id: options.idGenerator() }, originalId: item.id, first: false };
    });
  }

  function decide(entity: EntityKind, id: string, importedName: string, existingName: string | undefined): { action: ImportAction; finalId: string } {
    counts[entity].total += 1;
    if (!merge || existingName === undefined) {
      counts[entity].add += 1;
      return { action: "add", finalId: id };
    }
    const action: ImportAction = options.strategy;
    counts[entity][action] += 1;
    conflicts.push({ entity, id, importedName, existingName, action, reason: "same-id" });
    return { action, finalId: action === "duplicate" ? options.idGenerator() : id };
  }

  // ---------- tags ----------
  const tagMap = new Map<string, string>();
  const tags: Tag[] = [];
  const existingTagById = new Map(existing.tags.map((t) => [t.id, t.name]));
  const existingTagByName = new Map(existing.tags.map((t) => [normalizeForSearch(t.name), t]));
  for (const { item, originalId, first } of dedupe("tag", snapshot.tags)) {
    const sameName = merge ? existingTagByName.get(normalizeForSearch(item.name)) : undefined;
    if (sameName && !existingTagById.has(item.id)) {
      counts.tag.total += 1;
      counts.tag.reuse += 1;
      conflicts.push({ entity: "tag", id: item.id, importedName: item.name, existingName: sameName.name, action: "reuse", reason: "same-name" });
      if (first) tagMap.set(originalId, sameName.id);
      continue;
    }
    const { action, finalId } = decide("tag", item.id, item.name, existingTagById.get(item.id));
    if (first) tagMap.set(originalId, finalId);
    if (action !== "skip") tags.push({ ...item, id: finalId, order: 10_000 + tags.length });
  }
  const mapTags = (ids: string[]) => [...new Set(ids.map((id) => tagMap.get(id) ?? (existingTagById.has(id) ? id : undefined)).filter((x): x is string => Boolean(x)))];

  // ---------- providers ----------
  const providerMap = new Map<string, string>();
  const providers: Provider[] = [];
  const secrets: PendingSecret[] = [];
  const preserveSecretsFor: string[] = [];
  const existingProviders = new Map(existing.providers.map((p) => [p.id, p.name]));
  const modelsByProvider = new Map<string, ProviderModel[]>();
  for (const { providerId, ...model } of snapshot.models) {
    const list = modelsByProvider.get(providerId) ?? [];
    if (!list.some((m) => m.id === model.id)) list.push(model);
    modelsByProvider.set(providerId, list);
  }
  for (const { item, originalId, first } of dedupe("provider", snapshot.providers)) {
    const { secrets: providerSecrets, ...provider } = item;
    const { action, finalId } = decide("provider", provider.id, provider.name, existingProviders.get(provider.id));
    if (first) providerMap.set(originalId, finalId);
    if (action === "skip") continue;
    const models = first ? (modelsByProvider.get(originalId) ?? []) : [];
    providers.push({
      ...provider,
      id: finalId,
      encryptedApiKey: null,
      encryptedHeaders: null,
      models,
      defaultModelId: provider.defaultModelId && models.some((m) => m.id === provider.defaultModelId) ? provider.defaultModelId : (models.find((m) => m.enabled)?.id ?? null),
    });
    if (providerSecrets && (providerSecrets.apiKey || providerSecrets.headers)) secrets.push({ providerId: finalId, secrets: providerSecrets });
    else preserveSecretsFor.push(finalId);
  }
  const mapProvider = (id: string | null) => (id ? (providerMap.get(id) ?? (existingProviders.has(id) ? id : null)) : null);

  // ---------- assistants ----------
  const assistantMap = new Map<string, string>();
  const assistants: Assistant[] = [];
  const existingAssistants = new Map(existing.assistants.map((a) => [a.id, a.name]));
  const keepLocalDefault = merge && existing.assistants.some((a) => a.isDefault);
  for (const { item, originalId, first } of dedupe("assistant", snapshot.assistants)) {
    const { action, finalId } = decide("assistant", item.id, item.name, existingAssistants.get(item.id));
    if (first) assistantMap.set(originalId, finalId);
    if (action === "skip") continue;
    const providerId = mapProvider(item.defaultProviderId);
    assistants.push({
      ...item,
      id: finalId,
      isDefault: keepLocalDefault ? false : item.isDefault,
      tagIds: mapTags(item.tagIds),
      defaultProviderId: providerId,
      defaultModelId: providerId ? item.defaultModelId : null,
    });
  }
  const mapAssistant = (id: string | null) => (id ? (assistantMap.get(id) ?? (existingAssistants.has(id) ? id : null)) : null);

  // ---------- conversations + messages ----------
  const conversations: Conversation[] = [];
  const messages: Message[] = [];
  const replaceMessagesFor: string[] = [];
  const existingConversations = new Map(existing.conversations.map((c) => [c.id, c.title]));
  const seenMessageIds = new Set<string>();
  for (const { item } of dedupe("conversation", snapshot.conversations ?? [])) {
    const { messages: conversationMessages, ...conversation } = item;
    const { action, finalId } = decide("conversation", conversation.id, conversation.title, existingConversations.get(conversation.id));
    if (action === "skip") continue;
    if (action === "overwrite") replaceMessagesFor.push(finalId);
    const providerId = mapProvider(conversation.providerId);
    conversations.push({
      ...conversation,
      id: finalId,
      assistantId: mapAssistant(conversation.assistantId),
      providerId,
      modelId: providerId ? conversation.modelId : null,
      tagIds: mapTags(conversation.tagIds),
    });
    for (const message of conversationMessages) {
      const duplicate = seenMessageIds.has(message.id);
      if (duplicate) duplicateIdsInFile.push({ entity: "message", id: message.id });
      // New ids when the conversation is copied or the id repeats; never collide with local rows.
      const id = action === "duplicate" || duplicate ? options.idGenerator() : message.id;
      seenMessageIds.add(id);
      messages.push({ ...message, id, conversationId: finalId, providerId: mapProvider(message.providerId), heartbeatAt: null, status: message.status === "streaming" ? "interrupted" : message.status });
    }
  }

  // ---------- settings ----------
  let settings: AppSettings | null = null;
  if (options.applySettings || options.mode === "replace") {
    const defaultProviderId = mapProvider(snapshot.settings.defaultProviderId);
    settings = { ...snapshot.settings, defaultProviderId, defaultModelId: defaultProviderId ? snapshot.settings.defaultModelId : null };
  } else {
    warnings.push("settings_skipped");
  }

  if (snapshot.providers.length && preserveSecretsFor.length) warnings.push("providers_without_keys");
  if (secrets.length) warnings.push("keys_included");
  if (options.migratedFrom !== null && options.migratedFrom !== undefined) warnings.push("migrated");
  if (options.mode === "replace") warnings.push("replace_deletes_data");

  return {
    mode: options.mode,
    strategy: options.strategy,
    counts,
    conflicts,
    duplicateIdsInFile,
    warnings,
    batch: { assistants, tags, providers, conversations, messages, settings, replaceMessagesFor },
    secrets,
    preserveSecretsFor,
    includesConversations: snapshot.conversations !== undefined,
  };
}
