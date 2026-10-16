import { z } from "zod";
import type { ProviderConfig } from "@/lib/ai/types";
import { providerKindSchema, providerTransportSchema, type Provider } from "@/lib/models";
import { gunzip, gzip } from "@/lib/transfer/compression";
import { ChunkCollector, encodeChunks, randomSessionId } from "./chunks";

export const PROVIDER_SHARE_TYPE = "nova-provider";

export const providerSharePayloadSchema = z
  .object({
    type: z.literal(PROVIDER_SHARE_TYPE),
    v: z.literal(1),
    name: z.string().trim().min(1).max(100),
    kind: providerKindSchema,
    baseUrl: z.string().url(),
    transport: providerTransportSchema,
    /** Enabled model ids only (keeps the QR sequence short). */
    models: z.array(z.string().min(1).max(256)).max(200),
    defaultModelId: z.string().max(256).nullable(),
    apiKey: z.string().min(1).max(4096).optional(),
    headers: z.record(z.string().min(1).max(200), z.string().max(4000)).optional(),
  })
  .strict();
export type ProviderSharePayload = z.infer<typeof providerSharePayloadSchema>;

export interface ShareOptions {
  /** Off by default. The UI requires an explicit, separate confirmation. */
  includeApiKey: boolean;
  includeHeaders: boolean;
}

export function buildProviderPayload(provider: Provider, config: ProviderConfig, options: ShareOptions): ProviderSharePayload {
  const payload: ProviderSharePayload = {
    type: PROVIDER_SHARE_TYPE,
    v: 1,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    transport: provider.transport,
    models: provider.models.filter((m) => m.enabled).map((m) => m.id).slice(0, 200),
    defaultModelId: provider.defaultModelId,
  };
  if (options.includeApiKey && config.apiKey) payload.apiKey = config.apiKey;
  if (options.includeHeaders && config.headers && Object.keys(config.headers).length) payload.headers = config.headers;
  return payload;
}

export function payloadHasSecrets(payload: ProviderSharePayload): boolean {
  return Boolean(payload.apiKey || (payload.headers && Object.keys(payload.headers).length));
}

export async function encodeProviderPayload(payload: ProviderSharePayload, options: { sessionId?: string; payloadSize?: number } = {}): Promise<string[]> {
  const bytes = await gzip(new TextEncoder().encode(JSON.stringify(payload)));
  return encodeChunks(bytes, { sessionId: options.sessionId ?? randomSessionId(), payloadSize: options.payloadSize });
}

export async function decodeProviderPayload(collector: ChunkCollector): Promise<ProviderSharePayload> {
  const bytes = await gunzip(collector.assemble());
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Invalid provider data");
  }
  const parsed = providerSharePayloadSchema.safeParse(json);
  if (!parsed.success) throw new Error("Invalid provider data");
  return parsed.data;
}
