import { z } from "zod";
import { idSchema, timestampSchema } from "./common";
import { messagePartSchema, tokenUsageSchema } from "./message-part";
import { messageContextSchema } from "./memory";

export const messageRoleSchema = z.enum(["system", "user", "assistant", "tool"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

/**
 * interrupted = the tab was closed/reloaded mid-stream; partial content was kept.
 */
export const messageStatusSchema = z.enum([
  "pending",
  "streaming",
  "complete",
  "error",
  "aborted",
  "interrupted",
]);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

export const finishReasonSchema = z.enum([
  "stop",
  "length",
  "tool_calls",
  "content_filter",
  "error",
  "aborted",
  "unknown",
]);
export type FinishReason = z.infer<typeof finishReasonSchema>;

export const MAX_MESSAGE_LENGTH = 1_000_000;

export const messageSchema = z.object({
  id: idSchema,
  conversationId: idSchema,
  role: messageRoleSchema,
  /** Plain-text projection of `parts` (search, copy, previews). */
  content: z.string().max(MAX_MESSAGE_LENGTH),
  parts: z.array(messagePartSchema),
  status: messageStatusSchema,
  attachmentIds: z.array(idSchema),
  error: z.string().max(2000).nullable(),
  providerId: idSchema.nullable(),
  modelId: z.string().max(256).nullable(),
  usage: tokenUsageSchema.nullable(),
  finishReason: finishReasonSchema.nullable(),
  /** Updated while streaming; lets a reload detect abandoned streams. */
  heartbeatAt: timestampSchema.nullable(),
  /** Assistant replies: memory/lore/summary used to build the request (1.3+). Older rows default to null. */
  context: messageContextSchema.nullable().default(null),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Message = z.infer<typeof messageSchema>;

export const messageCreateSchema = z
  .object({
    conversationId: idSchema,
    role: messageRoleSchema,
    content: z.string().max(MAX_MESSAGE_LENGTH).optional(),
    parts: z.array(messagePartSchema).optional(),
    status: messageStatusSchema.optional(),
    attachmentIds: z.array(idSchema).optional(),
    providerId: idSchema.nullable().optional(),
    modelId: z.string().max(256).nullable().optional(),
    heartbeatAt: timestampSchema.nullable().optional(),
    context: messageContextSchema.nullable().optional(),
  })
  .strict();
export type MessageCreateInput = z.input<typeof messageCreateSchema>;

export const messageUpdateSchema = messageSchema
  .pick({
    content: true,
    parts: true,
    status: true,
    error: true,
    attachmentIds: true,
    providerId: true,
    modelId: true,
    usage: true,
    finishReason: true,
    heartbeatAt: true,
    context: true,
  })
  .partial()
  .strict();
export type MessageUpdateInput = z.input<typeof messageUpdateSchema>;
