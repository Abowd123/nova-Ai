import type { RemoteModel } from "../catalog/catalog";
import type { ChatRequest, HttpClient, ProviderConfig } from "../types";
import { OpenAICompatibleProvider } from "./openai-compatible";

function perMillion(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1_000_000 * 1000) / 1000 : null;
}

export function mapOpenRouterModel(raw: Record<string, unknown>): RemoteModel | null {
  if (typeof raw.id !== "string") return null;
  const pricing = (raw.pricing ?? {}) as Record<string, unknown>;
  const architecture = (raw.architecture ?? {}) as { input_modalities?: unknown };
  const modalities = Array.isArray(architecture.input_modalities) ? architecture.input_modalities : [];
  const params = Array.isArray(raw.supported_parameters) ? (raw.supported_parameters as unknown[]) : [];
  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : undefined,
    contextWindow: typeof raw.context_length === "number" ? raw.context_length : null,
    inputCost: perMillion(pricing.prompt),
    outputCost: perMillion(pricing.completion),
    capabilities: {
      ...(modalities.length ? { vision: modalities.includes("image"), audio: modalities.includes("audio"), video: modalities.includes("video") } : {}),
      ...(params.length ? { tools: params.includes("tools"), reasoning: params.includes("reasoning") } : {}),
    },
  };
}

export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfig, http: HttpClient, appUrl = "https://nova.local") {
    super(config, http, {
      kind: "openrouter",
      label: "OpenRouter",
      extraHeaders: { "HTTP-Referer": appUrl, "X-Title": "Nova" },
      mapRemoteModel: mapOpenRouterModel,
    });
  }

  protected override buildBody(request: ChatRequest): Record<string, unknown> {
    const body = super.buildBody(request);
    if (request.reasoning?.enabled) {
      body.reasoning = {
        enabled: true,
        ...(request.reasoning.budgetTokens ? { max_tokens: request.reasoning.budgetTokens } : {}),
      };
    }
    body.usage = { include: true };
    return body;
  }
}
