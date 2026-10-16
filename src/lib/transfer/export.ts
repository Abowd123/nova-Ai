import { DEFAULT_BACKUP_SETTINGS, type Assistant, type Provider, type Tag } from "@/lib/models";
import type { Repositories } from "@/lib/storage/types";
import { encryptWithPassword, type CryptoDeps } from "./crypto-file";
import { TransferError } from "./errors";
import {
  ASSISTANT_FORMAT,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  type ExportSnapshot,
  type ExportedSecrets,
  type SharedAssistant,
} from "./format";

export interface ExportOptions {
  includeConversations: boolean;
  /** Only allowed together with a password. */
  includeSecrets: boolean;
  password?: string;
  appVersion: string;
  now?: () => Date;
  /** Decrypts a provider's key/headers (ProviderService.getConfig). */
  readSecrets?: (provider: Provider) => Promise<ExportedSecrets>;
  crypto?: CryptoDeps;
}

export async function buildSnapshot(repos: Repositories, options: ExportOptions): Promise<ExportSnapshot> {
  if (options.includeSecrets && !options.password) {
    throw new TransferError("password_required", "Exporting API keys requires a password");
  }
  const data = await repos.transfer.readAll({ includeConversations: options.includeConversations });
  const providers = await Promise.all(
    data.providers.map(async ({ encryptedApiKey: _key, encryptedHeaders: _headers, models: _models, ...provider }) => {
      if (!options.includeSecrets || !options.readSecrets) return provider;
      const full = data.providers.find((p) => p.id === provider.id)!;
      const secrets = await options.readSecrets(full);
      const clean: ExportedSecrets = {
        ...(secrets.apiKey ? { apiKey: secrets.apiKey } : {}),
        ...(secrets.headers && Object.keys(secrets.headers).length ? { headers: secrets.headers } : {}),
      };
      return Object.keys(clean).length ? { ...provider, secrets: clean } : provider;
    }),
  );
  const byConversation = new Map<string, typeof data.messages>();
  for (const message of data.messages) {
    const list = byConversation.get(message.conversationId) ?? [];
    list.push(message);
    byConversation.set(message.conversationId, list);
  }
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: (options.now?.() ?? new Date()).toISOString(),
    app: { name: "Nova", version: options.appVersion },
    assistants: data.assistants,
    tags: data.tags,
    providers,
    models: data.providers.flatMap((p) => p.models.map((m) => ({ ...m, providerId: p.id }))),
    // WebDAV/backup config is device-local: never travels in exports.
    settings: { ...data.settings, backup: DEFAULT_BACKUP_SETTINGS },
    ...(options.includeConversations
      ? { conversations: data.conversations.map((c) => ({ ...c, messages: byConversation.get(c.id) ?? [] })) }
      : {}),
  };
}

/** Returns the file text: plain JSON, or an encrypted envelope when a password is given. */
export async function exportToText(repos: Repositories, options: ExportOptions): Promise<{ text: string; encrypted: boolean; snapshot: ExportSnapshot }> {
  const snapshot = await buildSnapshot(repos, options);
  const json = JSON.stringify(snapshot, null, options.password ? 0 : 2);
  if (!options.password) return { text: json, encrypted: false, snapshot };
  const envelope = await encryptWithPassword(json, options.password, options.crypto);
  return { text: JSON.stringify(envelope), encrypted: true, snapshot };
}

export function exportFileName(date: Date, encrypted: boolean): string {
  const day = date.toISOString().slice(0, 10);
  return `nova-backup-${day}${encrypted ? "-encrypted" : ""}.json`;
}

/** Portable single assistant: no local provider ids, not default, only its own tags. */
export function buildSharedAssistant(assistant: Assistant, allTags: Tag[], now = new Date()): SharedAssistant {
  return {
    format: ASSISTANT_FORMAT,
    version: 1,
    exportedAt: now.toISOString(),
    assistant: { ...assistant, isDefault: false, defaultProviderId: null, defaultModelId: null },
    tags: allTags.filter((tag) => assistant.tagIds.includes(tag.id)),
  };
}

export function assistantFileName(assistant: Assistant): string {
  const slug = assistant.name
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `nova-assistant-${slug || "export"}.json`;
}
