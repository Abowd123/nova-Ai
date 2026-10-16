import type { Provider, TokenUsage } from "@/lib/models";

/** USD for one request, or null when the model has no known price. */
export function costOf(provider: Provider | undefined, modelId: string, usage: Pick<TokenUsage, "inputTokens" | "outputTokens"> | null): number | null {
  if (!usage) return null;
  const model = provider?.models.find((m) => m.id === modelId);
  if (!model || model.inputCost === null || model.outputCost === null) return null;
  return (usage.inputTokens * model.inputCost + usage.outputTokens * model.outputCost) / 1_000_000;
}
