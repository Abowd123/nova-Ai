import { z } from "zod";
import {
  appSettingsSchema,
  assistantSchema,
  conversationSchema,
  idSchema,
  messageSchema,
  providerModelSchema,
  providerSchema,
  tagSchema,
} from "@/lib/models";

export const EXPORT_FORMAT = "nova-export";
export const EXPORT_VERSION = 1 as const;
export const ENCRYPTED_FORMAT = "nova-export-encrypted";
export const ASSISTANT_FORMAT = "nova-assistant";
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

const headersSchema = z.record(z.string().min(1).max(200), z.string().max(4000));

/** Only present inside password-encrypted exports, and only when the user opted in. */
export const exportedSecretsSchema = z
  .object({ apiKey: z.string().min(1).max(4096).optional(), headers: headersSchema.optional() })
  .strict();
export type ExportedSecrets = z.infer<typeof exportedSecretsSchema>;

/** Device-bound ciphertexts and the model list are stripped; models travel in `models`. */
export const exportedProviderSchema = providerSchema
  .omit({ encryptedApiKey: true, encryptedHeaders: true, models: true })
  .extend({ secrets: exportedSecretsSchema.optional() });
export type ExportedProvider = z.infer<typeof exportedProviderSchema>;

export const exportedModelSchema = providerModelSchema.extend({ providerId: idSchema });
export type ExportedModel = z.infer<typeof exportedModelSchema>;

export const exportedConversationSchema = conversationSchema.extend({ messages: z.array(messageSchema) });
export type ExportedConversation = z.infer<typeof exportedConversationSchema>;

export const exportSnapshotSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.string().datetime(),
  app: z.object({ name: z.string().max(100), version: z.string().max(32) }),
  assistants: z.array(assistantSchema),
  tags: z.array(tagSchema),
  providers: z.array(exportedProviderSchema),
  models: z.array(exportedModelSchema),
  settings: appSettingsSchema,
  conversations: z.array(exportedConversationSchema).optional(),
});
export type ExportSnapshot = z.infer<typeof exportSnapshotSchema>;

export const sharedAssistantSchema = z.object({
  format: z.literal(ASSISTANT_FORMAT),
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  assistant: assistantSchema,
  tags: z.array(tagSchema),
});
export type SharedAssistant = z.infer<typeof sharedAssistantSchema>;

export const encryptedEnvelopeSchema = z
  .object({
    format: z.literal(ENCRYPTED_FORMAT),
    version: z.literal(1),
    kdf: z.object({
      name: z.literal("PBKDF2"),
      hash: z.literal("SHA-256"),
      iterations: z.number().int().min(100_000).max(10_000_000),
      salt: z.string().min(16).max(200),
    }),
    cipher: z.object({ name: z.literal("AES-GCM"), iv: z.string().min(12).max(64) }),
    compression: z.enum(["gzip", "none"]),
    ciphertext: z.string().min(1),
  })
  .strict();
export type EncryptedEnvelope = z.infer<typeof encryptedEnvelopeSchema>;

export function hasSecrets(snapshot: ExportSnapshot): boolean {
  return snapshot.providers.some((p) => Boolean(p.secrets?.apiKey || (p.secrets?.headers && Object.keys(p.secrets.headers).length)));
}
