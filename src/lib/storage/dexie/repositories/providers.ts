import {
  APP_SETTINGS_KEY,
  providerCreateSchema,
  providerSchema,
  providerUpdateSchema,
} from "@/lib/models";
import { notFound, withStorageErrors } from "../../errors";
import type { ProviderRepository, RepositoryDeps } from "../../types";
import type { NovaDatabase } from "../database";
import { parseOrThrow, parseRecords } from "../utils";

export function createProviderRepository(db: NovaDatabase, deps: RepositoryDeps): ProviderRepository {
  return {
    list: () =>
      withStorageErrors(async () =>
        parseRecords(providerSchema, await db.providers.toArray(), "provider").sort(
          (a, b) => a.createdAt - b.createdAt,
        ),
      ),

    get: (id) =>
      withStorageErrors(async () => {
        const row = await db.providers.get(id);
        return row ? parseOrThrow(providerSchema, row, "provider") : undefined;
      }),

    create: (input) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(providerCreateSchema, input, "provider input");
        const timestamp = deps.clock();
        const provider = parseOrThrow(
          providerSchema,
          {
            id: deps.idGenerator(),
            name: data.name,
            kind: data.kind,
            baseUrl: data.baseUrl,
            enabled: data.enabled ?? true,
            transport: data.transport ?? "direct",
            encryptedApiKey: data.encryptedApiKey ?? null,
            encryptedHeaders: data.encryptedHeaders ?? null,
            models: data.models ?? [],
            defaultModelId: data.defaultModelId ?? null,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          "provider",
        );
        await db.providers.add(provider);
        return provider;
      }),

    update: (id, patch) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(providerUpdateSchema, patch, "provider patch");
        return db.transaction("rw", db.providers, async () => {
          const existing = await db.providers.get(id);
          if (!existing) throw notFound("Provider", id);
          const next = parseOrThrow(
            providerSchema,
            { ...existing, ...data, updatedAt: deps.clock() },
            "provider",
          );
          await db.providers.put(next);
          return next;
        });
      }),

    delete: (id) =>
      withStorageErrors(async () => {
        await db.transaction("rw", [db.providers, db.assistants, db.conversations, db.settings], async () => {
          await db.providers.delete(id);
          await db.assistants
            .filter((assistant) => assistant.defaultProviderId === id)
            .modify({ defaultProviderId: null, defaultModelId: null });
          await db.conversations
            .filter((conversation) => conversation.providerId === id)
            .modify({ providerId: null, modelId: null });
          const settings = await db.settings.get(APP_SETTINGS_KEY);
          const value = settings?.value as { defaultProviderId?: unknown } | undefined;
          if (settings && value?.defaultProviderId === id) {
            await db.settings.put({
              ...settings,
              value: { ...value, defaultProviderId: null, defaultModelId: null },
            });
          }
        });
      }),
  };
}
