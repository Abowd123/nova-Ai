import { mergeSettings } from "@/lib/models/settings-merge";
import { migrateAssistantRecord } from "@/lib/models";
import { TransferError } from "./errors";
import { EXPORT_FORMAT, EXPORT_VERSION } from "./format";

type Loose = Record<string, unknown>;

const isObject = (v: unknown): v is Loose => typeof v === "object" && v !== null && !Array.isArray(v);
const arrayOf = (v: unknown): Loose[] => (Array.isArray(v) ? v.filter(isObject) : []);

function migrateTag(tag: Loose, index: number): Loose {
  return { ...tag, order: typeof tag.order === "number" ? tag.order : index };
}

function migrateProvider(provider: Loose): Loose {
  const { headers: _plainHeaders, apiKey: _plainKey, encryptedApiKey: _a, encryptedHeaders: _h, models: _m, ...rest } = provider;
  return {
    ...rest,
    transport: rest.transport === "proxy" ? "proxy" : "direct",
    defaultModelId: rest.defaultModelId ?? null,
    ...(isObject(provider.secrets) ? { secrets: provider.secrets } : {}),
  };
}

function migrateMessage(message: Loose): Loose {
  const content = typeof message.content === "string" ? message.content : "";
  return {
    ...message,
    content,
    parts: Array.isArray(message.parts) ? message.parts : content ? [{ type: "text", text: content }] : [],
    attachmentIds: Array.isArray(message.attachmentIds) ? message.attachmentIds : [],
    error: message.error ?? null,
    providerId: message.providerId ?? null,
    modelId: message.modelId ?? null,
    usage: message.usage ?? null,
    finishReason: message.finishReason ?? null,
    heartbeatAt: null,
    // A stream can't continue in another app instance.
    status: message.status === "streaming" || message.status === "pending" ? "interrupted" : message.status,
  };
}

function migrateConversation(conversation: Loose): Loose {
  const messages = arrayOf(conversation.messages).map(migrateMessage);
  return {
    ...conversation,
    titleSource: conversation.titleSource ?? "manual",
    assistantId: conversation.assistantId ?? null,
    providerId: conversation.providerId ?? null,
    modelId: conversation.modelId ?? null,
    pinned: conversation.pinned === true,
    archived: conversation.archived === true,
    tagIds: Array.isArray(conversation.tagIds) ? conversation.tagIds : [],
    messageCount: messages.length,
    lastMessageAt: messages.length ? Math.max(...messages.map((m) => (typeof m.createdAt === "number" ? m.createdAt : 0))) : null,
    messages,
  };
}

/** Pulls provider models into the top-level `models` list (version 0 kept them nested). */
function extractModels(providers: Loose[], models: Loose[]): Loose[] {
  const nested = providers.flatMap((p) => arrayOf(p.models).map((m) => ({ ...m, providerId: p.id })));
  // 1.0 files may carry models without the newer metadata fields; fill safe defaults.
  return (models.length ? models : nested).map((m: Loose) => ({
    enabled: true,
    contextWindow: null,
    capabilities: { vision: false, audio: false, video: false, tools: false, reasoning: false },
    inputCost: null,
    outputCost: null,
    source: "remote",
    ...m,
    name: typeof m.name === "string" && m.name ? m.name : m.id,
  }));
}

export interface MigrationResult {
  data: Loose;
  /** null when the file was already current. */
  migratedFrom: number | null;
}

/**
 * Normalizes any supported export to the current shape before validation:
 *  - version 0: early files without `format`/`version`, or a bare array of assistants
 *  - version 1: current; still migrates nested records (assistant schemaVersion 1 -> 2)
 */
export function migrateExport(raw: unknown): MigrationResult {
  let source: Loose;
  let from: number;
  if (Array.isArray(raw)) {
    source = { assistants: raw };
    from = 0;
  } else if (isObject(raw)) {
    source = raw;
    if (raw.format === undefined && raw.version === undefined) from = 0;
    else if (raw.format !== EXPORT_FORMAT) throw new TransferError("unsupported_format", "Not a Nova export file");
    else if (typeof raw.version !== "number") throw new TransferError("unsupported_format", "Missing export version");
    else from = raw.version;
  } else {
    throw new TransferError("unsupported_format", "Not a Nova export file");
  }
  if (from > EXPORT_VERSION) throw new TransferError("newer_version", `File version ${from} is newer than this app supports`);

  const providers = arrayOf(source.providers);
  const assistants = arrayOf(source.assistants).map(migrateAssistantRecord);
  const assistantsNeededMigration = arrayOf(source.assistants).some((a) => a.schemaVersion !== 2);
  const data: Loose = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: typeof source.exportedAt === "string" ? source.exportedAt : new Date(0).toISOString(),
    app: isObject(source.app) ? source.app : { name: "Nova", version: "0" },
    assistants,
    tags: arrayOf(source.tags).map(migrateTag),
    providers: providers.map(migrateProvider),
    models: extractModels(providers, arrayOf(source.models)),
    settings: mergeSettings(isObject(source.settings) ? source.settings : {}),
    ...(source.conversations !== undefined ? { conversations: arrayOf(source.conversations).map(migrateConversation) } : {}),
  };
  return { data, migratedFrom: from < EXPORT_VERSION || assistantsNeededMigration ? from : null };
}
