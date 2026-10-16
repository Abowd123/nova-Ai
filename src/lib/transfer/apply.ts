import type { EncryptedSecret } from "@/lib/models";
import type { Repositories } from "@/lib/storage/types";
import type { ImportPlan } from "./import";

export interface ApplyDeps {
  repos: Repositories;
  /** Encrypts with the local device vault (context binds provider id + field). */
  encrypt: (plaintext: string, providerId: string, field: "apiKey" | "headers") => Promise<EncryptedSecret>;
}

export interface ImportResult {
  assistants: number;
  tags: number;
  providers: number;
  conversations: number;
  messages: number;
  settings: boolean;
  keysImported: number;
}

/**
 * Re-encrypts imported keys with THIS device's vault, keeps local keys for providers that
 * came without one, then writes everything in a single transaction.
 */
export async function applyImport(plan: ImportPlan, deps: ApplyDeps): Promise<ImportResult> {
  const providers = await Promise.all(
    plan.batch.providers.map(async (provider) => {
      const pending = plan.secrets.find((s) => s.providerId === provider.id);
      if (pending) {
        return {
          ...provider,
          encryptedApiKey: pending.secrets.apiKey ? await deps.encrypt(pending.secrets.apiKey, provider.id, "apiKey") : null,
          encryptedHeaders:
            pending.secrets.headers && Object.keys(pending.secrets.headers).length
              ? await deps.encrypt(JSON.stringify(pending.secrets.headers), provider.id, "headers")
              : null,
        };
      }
      if (plan.preserveSecretsFor.includes(provider.id)) {
        const local = await deps.repos.providers.get(provider.id);
        if (local) return { ...provider, encryptedApiKey: local.encryptedApiKey, encryptedHeaders: local.encryptedHeaders };
      }
      return provider;
    }),
  );

  // Keep this device's WebDAV/backup configuration.
  const settings = plan.batch.settings ? { ...plan.batch.settings, backup: (await deps.repos.settings.get()).backup } : null;
  await deps.repos.transfer.write(
    { ...plan.batch, providers, settings },
    { replace: plan.mode === "replace", replaceConversations: plan.mode === "replace" && plan.includesConversations },
  );

  return {
    assistants: plan.batch.assistants.length,
    tags: plan.batch.tags.length,
    providers: providers.length,
    conversations: plan.batch.conversations.length,
    messages: plan.batch.messages.length,
    settings: plan.batch.settings !== null,
    keysImported: plan.secrets.length,
  };
}
