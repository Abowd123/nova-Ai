import { z } from "zod";
import { providerKindSchema, type ModelCapabilities, type ProviderKind } from "@/lib/models";
import type { ModelInfo } from "../types";
import catalogJson from "./models.json";

export const catalogEntrySchema = z
  .object({
    provider: providerKindSchema,
    name: z.string().min(1),
    modelId: z.string().min(1),
    baseUrl: z.string().url(),
    contextWindow: z.number().int().positive(),
    vision: z.boolean(),
    audio: z.boolean(),
    video: z.boolean(),
    tools: z.boolean(),
    reasoning: z.boolean(),
    inputCost: z.number().nonnegative().nullable(),
    outputCost: z.number().nonnegative().nullable(),
  })
  .strict();
export type CatalogEntry = z.infer<typeof catalogEntrySchema>;

export const catalogSchema = z.object({
  $comment: z.string().optional(),
  version: z.literal(1),
  models: z.array(catalogEntrySchema),
});

export const MODEL_CATALOG: readonly CatalogEntry[] = catalogSchema.parse(catalogJson).models;

export function catalogFor(kind: ProviderKind): CatalogEntry[] {
  // Custom providers are OpenAI-compatible; no catalog entries by default.
  return MODEL_CATALOG.filter((entry) => entry.provider === kind);
}

function normalizeId(id: string): string {
  return id.replace(/^models\//, "").toLowerCase();
}

export function findCatalogEntry(kind: ProviderKind | null, modelId: string): CatalogEntry | undefined {
  const id = normalizeId(modelId);
  const candidates = kind ? MODEL_CATALOG.filter((e) => e.provider === kind) : MODEL_CATALOG;
  return (
    candidates.find((e) => normalizeId(e.modelId) === id) ??
    // Ollama tags (llama3.2:3b), dated snapshots (gpt-4o-2024-08-06), OpenRouter prefixes.
    candidates.find((e) => id.startsWith(`${normalizeId(e.modelId)}:`)) ??
    candidates.find((e) => id.startsWith(`${normalizeId(e.modelId)}-`)) ??
    candidates.find((e) => id.endsWith(`/${normalizeId(e.modelId)}`))
  );
}

/** Conservative guess for models missing from the catalog. */
export function guessCapabilities(modelId: string): ModelCapabilities {
  const id = modelId.toLowerCase();
  return {
    vision: /vision|vl\b|-vl|4o|4\.1|gpt-5|gemini|claude-(3|sonnet|opus|haiku)|llava|pixtral|gemma3/.test(id),
    audio: /audio|gemini/.test(id),
    video: /gemini/.test(id),
    tools: !/embed|whisper|tts|dall-e|image|moderation/.test(id),
    reasoning: /\bo[1345]\b|o[1345]-|r1|thinking|reason|qwq|gpt-5|claude-(opus|sonnet)-4|3-7-sonnet|gemini-2\.5/.test(id),
  };
}

export function catalogEntryToModelInfo(entry: CatalogEntry): ModelInfo {
  return {
    id: entry.modelId,
    name: entry.name,
    providerKind: entry.provider,
    contextWindow: entry.contextWindow,
    capabilities: {
      vision: entry.vision,
      audio: entry.audio,
      video: entry.video,
      tools: entry.tools,
      reasoning: entry.reasoning,
    },
    inputCost: entry.inputCost,
    outputCost: entry.outputCost,
    source: "catalog",
  };
}

export interface RemoteModel {
  id: string;
  name?: string;
  contextWindow?: number | null;
  inputCost?: number | null;
  outputCost?: number | null;
  capabilities?: Partial<ModelCapabilities>;
}

/** Remote data wins for identity/limits; the catalog fills in capabilities and pricing. */
export function enrichRemoteModel(kind: ProviderKind, remote: RemoteModel): ModelInfo {
  const entry = findCatalogEntry(kind === "custom" ? null : kind, remote.id);
  const base = entry ? catalogEntryToModelInfo(entry) : undefined;
  return {
    id: remote.id,
    name: remote.name?.trim() || base?.name || remote.id,
    providerKind: kind,
    contextWindow: remote.contextWindow ?? base?.contextWindow ?? null,
    capabilities: { ...(base?.capabilities ?? guessCapabilities(remote.id)), ...remote.capabilities },
    inputCost: remote.inputCost ?? base?.inputCost ?? null,
    outputCost: remote.outputCost ?? base?.outputCost ?? null,
    source: "remote",
  };
}
