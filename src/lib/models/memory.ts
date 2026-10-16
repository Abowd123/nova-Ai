import { z } from "zod";
import { idSchema, timestampSchema } from "./common";

/** Where a memory is visible. Mirrors the assistant memory scope (minus "none"). */
export const memoryChunkScopeSchema = z.enum(["global", "assistant", "conversation"]);
export type MemoryChunkScope = z.infer<typeof memoryChunkScopeSchema>;

export const memorySourceSchema = z.enum(["message", "manual"]);
export type MemorySource = z.infer<typeof memorySourceSchema>;

/** pending = needs (re)embedding for the current model; error = last attempt failed. */
export const memoryIndexStatusSchema = z.enum(["pending", "indexed", "error"]);
export type MemoryIndexStatus = z.infer<typeof memoryIndexStatusSchema>;

export const MAX_MEMORY_TEXT = 20_000;

export const memoryChunkSchema = z.object({
  id: idSchema,
  text: z.string().trim().min(1).max(MAX_MEMORY_TEXT),
  scope: memoryChunkScopeSchema,
  /** Owner assistant (null = chat without assistant / manual global memory). */
  assistantId: idSchema.nullable(),
  /** Source conversation (null for manual memories). */
  conversationId: idSchema.nullable(),
  sourceMessageId: idSchema.nullable(),
  source: memorySourceSchema,
  role: z.enum(["user", "assistant"]).nullable(),
  /** Position of the chunk inside its source message. */
  chunkIndex: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  /** Dedupe key: hash of normalized text + owner. */
  hash: z.string().min(1).max(128),
  /** "providerId:model:dims" of the stored vector, "" when not embedded. Never null: IndexedDB can't index null. */
  embeddingModel: z.string().max(400),
  dims: z.number().int().nonnegative(),
  status: memoryIndexStatusSchema,
  error: z.string().max(500).nullable(),
  indexedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type MemoryChunk = z.infer<typeof memoryChunkSchema>;

export const memoryChunkCreateSchema = z
  .object({
    text: z.string().trim().min(1).max(MAX_MEMORY_TEXT),
    scope: memoryChunkScopeSchema,
    assistantId: idSchema.nullable().optional(),
    conversationId: idSchema.nullable().optional(),
    sourceMessageId: idSchema.nullable().optional(),
    source: memorySourceSchema,
    role: z.enum(["user", "assistant"]).nullable().optional(),
    chunkIndex: z.number().int().nonnegative().optional(),
    tokens: z.number().int().nonnegative(),
    hash: z.string().min(1).max(128),
  })
  .strict();
export type MemoryChunkCreateInput = z.input<typeof memoryChunkCreateSchema>;

export const memoryChunkUpdateSchema = z
  .object({
    text: z.string().trim().min(1).max(MAX_MEMORY_TEXT),
    scope: memoryChunkScopeSchema,
    assistantId: idSchema.nullable(),
    tokens: z.number().int().nonnegative(),
    hash: z.string().min(1).max(128),
  })
  .partial()
  .strict();
export type MemoryChunkUpdateInput = z.input<typeof memoryChunkUpdateSchema>;

/** Embedding stored apart from the chunk so listing memories never loads vectors. */
export interface MemoryVectorRecord {
  /** = chunk id */
  id: string;
  model: string;
  dims: number;
  vector: Float32Array;
  createdAt: number;
}

export const conversationSummarySchema = z.object({
  /** = conversation id (one summary per conversation). */
  id: idSchema,
  text: z.string().max(40_000),
  /** Set when the user edited the text: automatic runs never overwrite it. */
  manualEdit: z.boolean(),
  /** createdAt of the newest message the summary covers. */
  coveredUntil: timestampSchema.nullable(),
  coveredMessageCount: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  providerId: idSchema.nullable(),
  modelId: z.string().max(256).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const conversationSummaryPutSchema = conversationSummarySchema
  .pick({ text: true, manualEdit: true, coveredUntil: true, coveredMessageCount: true, tokens: true, providerId: true, modelId: true })
  .strict();
export type ConversationSummaryPut = z.input<typeof conversationSummaryPutSchema>;

export const loreEntrySchema = z.object({
  id: z.string().min(1).max(64),
  /** Any keyword found in recent messages activates the entry. */
  keywords: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
  content: z.string().trim().min(1).max(20_000),
  /** Higher first. */
  priority: z.number().int().min(-1000).max(1000),
  enabled: z.boolean(),
  caseSensitive: z.boolean(),
});
export type LoreEntry = z.infer<typeof loreEntrySchema>;

export const lorebookSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500),
  enabled: z.boolean(),
  /** Limit to one assistant / conversation (null = everywhere). */
  assistantId: idSchema.nullable(),
  conversationId: idSchema.nullable(),
  /** Max tokens this book may inject per request. */
  tokenBudget: z.number().int().min(50).max(32_000),
  /** How many recent messages are scanned for keywords. */
  scanDepth: z.number().int().min(1).max(50),
  entries: z.array(loreEntrySchema).max(500),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Lorebook = z.infer<typeof lorebookSchema>;

export const lorebookCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500).optional(),
    enabled: z.boolean().optional(),
    assistantId: idSchema.nullable().optional(),
    conversationId: idSchema.nullable().optional(),
    tokenBudget: z.number().int().min(50).max(32_000).optional(),
    scanDepth: z.number().int().min(1).max(50).optional(),
    entries: z.array(loreEntrySchema).max(500).optional(),
  })
  .strict();
export type LorebookCreateInput = z.input<typeof lorebookCreateSchema>;

export const lorebookUpdateSchema = lorebookSchema
  .pick({ name: true, description: true, enabled: true, assistantId: true, conversationId: true, tokenBudget: true, scanDepth: true, entries: true })
  .partial()
  .strict();
export type LorebookUpdateInput = z.input<typeof lorebookUpdateSchema>;

export const DEFAULT_LOREBOOK = { description: "", enabled: true, assistantId: null, conversationId: null, tokenBudget: 1000, scanDepth: 6, entries: [] as LoreEntry[] };

/** What went into a request: shown under the reply ("memory used"). */
export const messageContextSchema = z.object({
  memoryIds: z.array(idSchema).max(100),
  memoryScores: z.array(z.number()).max(100),
  lore: z.array(z.object({ lorebookId: idSchema, entryId: z.string().min(1).max(64) })).max(200),
  summaryUsed: z.boolean(),
  /** Messages left out of the request because of the context window. */
  omittedMessages: z.number().int().nonnegative(),
  estimatedInputTokens: z.number().int().nonnegative(),
  /** Tokens of injected memories (lets previews account for retrieval without calling it). */
  memoryTokens: z.number().int().nonnegative().default(0),
  contextWindow: z.number().int().nonnegative(),
  /** semantic | text (fallback without embeddings) | none */
  retrieval: z.enum(["semantic", "text", "none"]),
});
export type MessageContextInfo = z.infer<typeof messageContextSchema>;
