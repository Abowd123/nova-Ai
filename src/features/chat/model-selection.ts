import { selectableModels, type SelectableModel } from "@/features/providers/provider-service";
import type { AppSettings, Conversation, Provider } from "@/lib/models";

export function modelKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

export function parseModelKey(key: string): { providerId: string; modelId: string } | null {
  const index = key.indexOf("::");
  if (index <= 0) return null;
  return { providerId: key.slice(0, index), modelId: key.slice(index + 2) };
}

/** Mirrors ChatService.resolveModel for display purposes (no assistant lookup). */
export function effectiveModel(
  providers: Provider[],
  conversation: Pick<Conversation, "providerId" | "modelId"> | null | undefined,
  settings: Pick<AppSettings, "defaultProviderId" | "defaultModelId"> | null | undefined,
): SelectableModel | undefined {
  const options = selectableModels(providers);
  const find = (providerId: string | null | undefined, modelId: string | null | undefined) => {
    if (!providerId) return undefined;
    const provider = providers.find((p) => p.id === providerId && p.enabled);
    const id = modelId ?? provider?.defaultModelId;
    return options.find((o) => o.providerId === providerId && o.model.id === id);
  };
  return (
    find(conversation?.providerId, conversation?.modelId) ??
    find(settings?.defaultProviderId, settings?.defaultModelId) ??
    providers.map((p) => find(p.id, null)).find(Boolean) ??
    options[0]
  );
}
