import { createProvider } from "@/lib/ai/factory";
import { audit } from "@/lib/audit";
import { catalogEntryToModelInfo, catalogFor, enrichRemoteModel } from "@/lib/ai/catalog/catalog";
import { isAllowedCustomHeader } from "@/lib/ai/adapters/shared";
import type { ChatProvider, ConnectionTestResult, HttpClient, ModelInfo, ProviderConfig } from "@/lib/ai/types";
import { secretContext, type SecretVault } from "@/lib/crypto/vault";
import type { Provider, ProviderKind, ProviderModel, ProviderTransport } from "@/lib/models";
import type { ProviderSharePayload } from "@/lib/qr/provider-share";
import { StorageError } from "@/lib/storage/errors";
import type { Repositories } from "@/lib/storage/types";

export interface HeaderDraft {
  name: string;
  /** null = keep the currently stored value for this header. */
  value: string | null;
}

export interface ProviderDraft {
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  transport: ProviderTransport;
  enabled?: boolean;
  /** undefined = keep, "" or null = remove, string = replace. */
  apiKey?: string | null;
  headers?: HeaderDraft[];
}

export interface SelectableModel {
  providerId: string;
  providerName: string;
  providerKind: ProviderKind;
  model: ProviderModel;
}

/** Big remote lists (OpenRouter has hundreds) start disabled except catalog-known models. */
const AUTO_ENABLE_LIMIT = 25;

export function toProviderModel(info: ModelInfo, enabled: boolean): ProviderModel {
  return {
    id: info.id,
    name: info.name,
    enabled,
    contextWindow: info.contextWindow,
    capabilities: info.capabilities,
    inputCost: info.inputCost,
    outputCost: info.outputCost,
    source: info.source,
  };
}

export function mergeFetchedModels(existing: ProviderModel[], fetched: ModelInfo[]): ProviderModel[] {
  const previous = new Map(existing.map((m) => [m.id, m]));
  const merged = fetched.map((info) => {
    const before = previous.get(info.id);
    const known = before !== undefined;
    const enabled = known ? before.enabled : fetched.length <= AUTO_ENABLE_LIMIT || catalogFor(info.providerKind).some((e) => e.modelId === info.id);
    return toProviderModel(info, enabled);
  });
  // Keep manually added models the provider does not list.
  for (const model of existing) {
    if (model.source === "manual" && !merged.some((m) => m.id === model.id)) merged.push(model);
  }
  return merged;
}

export function selectableModels(providers: Provider[]): SelectableModel[] {
  return providers
    .filter((p) => p.enabled)
    .flatMap((p) =>
      p.models
        .filter((m) => m.enabled)
        .map((model) => ({ providerId: p.id, providerName: p.name, providerKind: p.kind, model })),
    );
}

export class ProviderService {
  constructor(
    private readonly repos: Repositories,
    private readonly vault: SecretVault,
    private readonly httpFor?: (config: ProviderConfig) => HttpClient,
  ) {}

  private async requireProvider(id: string): Promise<Provider> {
    const provider = await this.repos.providers.get(id);
    if (!provider) throw new StorageError("NOT_FOUND", `Provider "${id}" was not found`);
    return provider;
  }

  private async decryptHeaders(provider: Provider): Promise<Record<string, string>> {
    if (!provider.encryptedHeaders) return {};
    const json = await this.vault.decrypt(provider.encryptedHeaders, secretContext(provider.id, "headers"));
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  }

  /** Header names only: values are never sent back to the UI. */
  async headerNames(id: string): Promise<string[]> {
    return Object.keys(await this.decryptHeaders(await this.requireProvider(id)));
  }

  async save(draft: ProviderDraft, id?: string): Promise<Provider> {
    const base = {
      name: draft.name.trim(),
      kind: draft.kind,
      baseUrl: draft.baseUrl.trim().replace(/\/+$/, ""),
      transport: draft.transport,
      ...(draft.enabled !== undefined ? { enabled: draft.enabled } : {}),
    };

    const provider = id
      ? await this.repos.providers.update(id, base)
      : await this.repos.providers.create({
          ...base,
          models: catalogFor(draft.kind).map((entry) => toProviderModel(catalogEntryToModelInfo(entry), true)),
          defaultModelId: catalogFor(draft.kind)[0]?.modelId ?? null,
        });

    const patch: Parameters<Repositories["providers"]["update"]>[1] = {};

    if (draft.apiKey !== undefined) {
      const key = draft.apiKey?.trim() ?? "";
      patch.encryptedApiKey = key ? await this.vault.encrypt(key, secretContext(provider.id, "apiKey")) : null;
      audit(key ? "key_saved" : "key_removed", `provider ${provider.name}`);
    }

    if (draft.headers !== undefined) {
      const current = id ? await this.decryptHeaders(provider) : {};
      const next: Record<string, string> = {};
      for (const header of draft.headers) {
        const name = header.name.trim();
        if (!name) continue;
        if (!isAllowedCustomHeader(name)) throw new StorageError("VALIDATION", `Header "${name}" is not allowed`);
        const value = header.value ?? current[name];
        if (value !== undefined && value !== "") next[name] = value;
      }
      patch.encryptedHeaders = Object.keys(next).length
        ? await this.vault.encrypt(JSON.stringify(next), secretContext(provider.id, "headers"))
        : null;
    }

    return Object.keys(patch).length ? this.repos.providers.update(provider.id, patch) : provider;
  }

  async delete(id: string): Promise<void> {
    await this.repos.providers.delete(id);
  }

  async setEnabled(id: string, enabled: boolean): Promise<Provider> {
    return this.repos.providers.update(id, { enabled });
  }

  /** Decrypted config, kept in memory only for the lifetime of a request. */
  async getConfig(id: string): Promise<ProviderConfig> {
    const provider = await this.requireProvider(id);
    const apiKey = provider.encryptedApiKey
      ? await this.vault.decrypt(provider.encryptedApiKey, secretContext(provider.id, "apiKey"))
      : undefined;
    return {
      id: provider.id,
      kind: provider.kind,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey,
      headers: await this.decryptHeaders(provider),
      transport: provider.transport,
    };
  }

  async getChatProvider(id: string): Promise<ChatProvider> {
    const config = await this.getConfig(id);
    return createProvider(config, this.httpFor?.(config));
  }

  async test(id: string, signal?: AbortSignal): Promise<ConnectionTestResult> {
    return (await this.getChatProvider(id)).testConnection({ signal, timeoutMs: 20_000 });
  }

  async fetchModels(id: string, signal?: AbortSignal): Promise<Provider> {
    const provider = await this.requireProvider(id);
    const fetched = await (await this.getChatProvider(id)).listModels({ signal, timeoutMs: 30_000 });
    const models = mergeFetchedModels(provider.models, fetched);
    const defaultModelId =
      provider.defaultModelId && models.some((m) => m.id === provider.defaultModelId && m.enabled)
        ? provider.defaultModelId
        : (models.find((m) => m.enabled)?.id ?? null);
    return this.repos.providers.update(id, { models, defaultModelId });
  }

  async setModelEnabled(id: string, modelId: string, enabled: boolean): Promise<Provider> {
    const provider = await this.requireProvider(id);
    const models = provider.models.map((m) => (m.id === modelId ? { ...m, enabled } : m));
    const defaultModelId =
      !enabled && provider.defaultModelId === modelId ? (models.find((m) => m.enabled)?.id ?? null) : provider.defaultModelId;
    return this.repos.providers.update(id, { models, defaultModelId });
  }

  async setAllModelsEnabled(id: string, enabled: boolean): Promise<Provider> {
    const provider = await this.requireProvider(id);
    const models = provider.models.map((m) => ({ ...m, enabled }));
    return this.repos.providers.update(id, {
      models,
      defaultModelId: enabled ? (provider.defaultModelId ?? models[0]?.id ?? null) : null,
    });
  }

  async setDefaultModel(id: string, modelId: string): Promise<Provider> {
    const provider = await this.requireProvider(id);
    const models = provider.models.map((m) => (m.id === modelId ? { ...m, enabled: true } : m));
    return this.repos.providers.update(id, { models, defaultModelId: modelId });
  }

  /** Creates a provider from a scanned QR payload; the key (if any) is encrypted immediately. */
  async importShared(payload: ProviderSharePayload): Promise<Provider> {
    const provider = await this.save({
      name: payload.name,
      kind: payload.kind,
      baseUrl: payload.baseUrl,
      transport: payload.transport,
      apiKey: payload.apiKey ?? null,
      headers: Object.entries(payload.headers ?? {}).map(([name, value]) => ({ name, value })),
    });
    if (payload.models.length === 0) return provider;
    const known = new Map(provider.models.map((m) => [m.id, m]));
    const models = payload.models.map((id) => known.get(id) ?? toProviderModel(enrichRemoteModel(payload.kind, { id }), true));
    const defaultModelId = payload.defaultModelId && payload.models.includes(payload.defaultModelId) ? payload.defaultModelId : (models[0]?.id ?? null);
    return this.repos.providers.update(provider.id, { models: models.map((m) => ({ ...m, enabled: true })), defaultModelId });
  }

  async addManualModel(id: string, modelId: string): Promise<Provider> {
    const provider = await this.requireProvider(id);
    const trimmed = modelId.trim();
    if (!trimmed) throw new StorageError("VALIDATION", "Model id is required");
    if (provider.models.some((m) => m.id === trimmed)) return this.setModelEnabled(id, trimmed, true);
    const model = toProviderModel({ ...enrichRemoteModel(provider.kind, { id: trimmed }), source: "manual" }, true);
    return this.repos.providers.update(id, {
      models: [...provider.models, model],
      defaultModelId: provider.defaultModelId ?? trimmed,
    });
  }
}
