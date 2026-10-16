import { z } from "zod";
import { timestampSchema } from "./common";
import { encryptedSecretSchema } from "./provider";

/**
 * Encrypted credentials for non-chat services (ElevenLabs, later search APIs, MCP tokens).
 * id examples: "service:elevenlabs".
 */
export const secretIdSchema = z.string().regex(/^[a-z0-9-]+:[a-z0-9._-]{1,100}$/, "Invalid secret id");

export const secretRecordSchema = z.object({
  id: secretIdSchema,
  value: encryptedSecretSchema,
  updatedAt: timestampSchema,
});
export type SecretRecord = z.infer<typeof secretRecordSchema>;
