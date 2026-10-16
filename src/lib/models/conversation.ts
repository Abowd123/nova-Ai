import { z } from "zod";
import { idSchema, timestampSchema } from "./common";

export const DEFAULT_CONVERSATION_TITLE = "New conversation";

export const titleSourceSchema = z.enum(["default", "auto", "manual"]);
export type TitleSource = z.infer<typeof titleSourceSchema>;

export const conversationSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(200),
  titleSource: titleSourceSchema,
  assistantId: idSchema.nullable(),
  providerId: idSchema.nullable(),
  modelId: z.string().max(256).nullable(),
  pinned: z.boolean(),
  archived: z.boolean(),
  tagIds: z.array(idSchema),
  messageCount: z.number().int().nonnegative(),
  lastMessageAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Conversation = z.infer<typeof conversationSchema>;

export const conversationCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    titleSource: titleSourceSchema.optional(),
    assistantId: idSchema.nullable().optional(),
    providerId: idSchema.nullable().optional(),
    modelId: z.string().max(256).nullable().optional(),
    tagIds: z.array(idSchema).optional(),
  })
  .strict();
export type ConversationCreateInput = z.input<typeof conversationCreateSchema>;

export const conversationUpdateSchema = conversationSchema
  .pick({
    title: true,
    titleSource: true,
    assistantId: true,
    providerId: true,
    modelId: true,
    pinned: true,
    archived: true,
    tagIds: true,
  })
  .partial()
  .strict();
export type ConversationUpdateInput = z.input<typeof conversationUpdateSchema>;
