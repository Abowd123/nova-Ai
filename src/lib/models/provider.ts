import { z } from "zod";
import { idSchema, timestampSchema } from "./common";

export const providerKindSchema = z.enum([
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "ollama",
  "custom",
]);
export type ProviderKind = z.infer<typeof providerKindSchema>;

/** direct = browser calls the provider (BYOK); proxy = through Nova's /api/proxy route. */
export const providerTransportSchema = z.enum(["direct", "proxy"]);
export type ProviderTransport = z.infer<typeof providerTransportSchema>;

/**
 * Secrets are only ever stored encrypted (Web Crypto AES-GCM, see src/lib/crypto/vault.ts).
 * There is intentionally NO plaintext `apiKey`/`headers` field: strict schemas reject them.
 */
export const encryptedSecretSchema = z
  .object({
    algorithm: z.literal("AES-GCM"),
    keyId: z.string().min(1).max(128),
    iv: z.string().min(1).max(64),
    ciphertext: z.string().min(1).max(65_536),
  })
  .strict();
export type EncryptedSecret = z.infer<typeof encryptedSecretSchema>;

export const modelCapabilitiesSchema = z.object({
  vision: z.boolean(),
  audio: z.boolean(),
  video: z.boolean(),
  tools: z.boolean(),
  reasoning: z.boolean(),
});
export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>;

export const providerModelSchema = z.object({
  id: z.string().trim().min(1).max(256),
  name: z.string().trim().min(1).max(256),
  enabled: z.boolean(),
  contextWindow: z.number().int().positive().nullable(),
  capabilities: modelCapabilitiesSchema,
  /** USD per 1M tokens. */
  inputCost: z.number().nonnegative().nullable(),
  outputCost: z.number().nonnegative().nullable(),
  source: z.enum(["catalog", "remote", "manual"]),
});
export type ProviderModel = z.infer<typeof providerModelSchema>;

export const providerSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(100),
  kind: providerKindSchema,
  baseUrl: z.string().url(),
  enabled: z.boolean(),
  transport: providerTransportSchema,
  encryptedApiKey: encryptedSecretSchema.nullable(),
  /** JSON object of extra headers, encrypted (headers often carry credentials). */
  encryptedHeaders: encryptedSecretSchema.nullable(),
  models: z.array(providerModelSchema).max(5000),
  defaultModelId: z.string().max(256).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Provider = z.infer<typeof providerSchema>;

export const providerCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    kind: providerKindSchema,
    baseUrl: z.string().url(),
    enabled: z.boolean().optional(),
    transport: providerTransportSchema.optional(),
    encryptedApiKey: encryptedSecretSchema.nullable().optional(),
    encryptedHeaders: encryptedSecretSchema.nullable().optional(),
    models: z.array(providerModelSchema).max(5000).optional(),
    defaultModelId: z.string().max(256).nullable().optional(),
  })
  .strict();
export type ProviderCreateInput = z.input<typeof providerCreateSchema>;

export const providerUpdateSchema = providerCreateSchema.partial().strict();
export type ProviderUpdateInput = z.input<typeof providerUpdateSchema>;
