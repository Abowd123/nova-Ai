import type { MediaTarget } from "@/lib/media/support";
import type { SelectableModel } from "@/features/providers/provider-service";

/** Adapters that implement uploadFile (keep in sync with lib/ai/adapters). */
const UPLOADERS = new Set(["openai", "gemini"]);

export function mediaTargetFor(selected: SelectableModel | undefined | null): MediaTarget | null {
  if (!selected) return null;
  return { providerKind: selected.providerKind, capabilities: selected.model.capabilities, canUpload: UPLOADERS.has(selected.providerKind) };
}
