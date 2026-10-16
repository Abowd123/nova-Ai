import { z } from "zod";
import { idSchema, timestampSchema } from "./common";

/**
 * Bump when the assistant shape changes and add a step to `migrateAssistantRecord`.
 * Stored rows, export files and shared assistants all carry this number.
 */
export const ASSISTANT_SCHEMA_VERSION = 2 as const;
export const DEFAULT_ASSISTANT_AVATAR = "✨";
export const MAX_STARTERS = 8;

export const memoryScopeSchema = z.enum(["none", "global", "assistant", "conversation"]);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

export const autoPlayTtsSchema = z.enum(["never", "always", "voice-input"]);
export type AutoPlayTts = z.infer<typeof autoPlayTtsSchema>;

/** Tool ids known to the app. Tools are wired in release 1.4; assistants can opt in now. */
export const KNOWN_TOOLS = ["search_memory", "web_search", "fetch_url", "run_javascript", "run_python", "delegate_task"] as const;
export type KnownTool = (typeof KNOWN_TOOLS)[number];

/** Emoji/short text, or a small raster image as data URL (never SVG: it can carry scripts). */
export const avatarSchema = z
  .string()
  .max(200_000)
  .refine(
    (value) => value.startsWith("data:") ? /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) : value.length <= 16,
    "Avatar must be an emoji/short text or a PNG/JPEG/WebP data URL",
  );

export const assistantSettingsSchema = z
  .object({
    /** auto = follow the model capability, on/off = force. */
    reasoning: z.enum(["auto", "on", "off"]).default("auto"),
    reasoningBudget: z.number().int().min(1024).max(64_000).default(2048),
  })
  .strict();
export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;
export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = { reasoning: "auto", reasoningBudget: 2048 };

const starterSchema = z.string().trim().min(1).max(300);

export const assistantSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500),
  avatar: avatarSchema,
  systemPrompt: z.string().max(50_000),
  defaultProviderId: idSchema.nullable(),
  defaultModelId: z.string().max(256).nullable(),
  temperature: z.number().min(0).max(2),
  topP: z.number().min(0).max(1).nullable(),
  maxTokens: z.number().int().min(1).max(1_000_000).nullable(),
  /** How many recent messages to send. null = all. */
  contextMessageLimit: z.number().int().min(1).max(1000).nullable(),
  enabledTools: z.array(z.string().min(1).max(64)).max(100),
  memoryScope: memoryScopeSchema,
  voiceId: z.string().min(1).max(200).nullable(),
  autoPlayTts: autoPlayTtsSchema,
  starters: z.array(starterSchema).max(MAX_STARTERS),
  settings: assistantSettingsSchema,
  isDefault: z.boolean(),
  tagIds: z.array(idSchema),
  schemaVersion: z.literal(ASSISTANT_SCHEMA_VERSION),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Assistant = z.infer<typeof assistantSchema>;

const editable = {
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  avatar: avatarSchema.optional(),
  systemPrompt: z.string().max(50_000).optional(),
  defaultProviderId: idSchema.nullable().optional(),
  defaultModelId: z.string().max(256).nullable().optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).nullable().optional(),
  maxTokens: z.number().int().min(1).max(1_000_000).nullable().optional(),
  contextMessageLimit: z.number().int().min(1).max(1000).nullable().optional(),
  enabledTools: z.array(z.string().min(1).max(64)).max(100).optional(),
  memoryScope: memoryScopeSchema.optional(),
  voiceId: z.string().min(1).max(200).nullable().optional(),
  autoPlayTts: autoPlayTtsSchema.optional(),
  starters: z.array(starterSchema).max(MAX_STARTERS).optional(),
  settings: assistantSettingsSchema.optional(),
  tagIds: z.array(idSchema).optional(),
};

export const assistantCreateSchema = z.object(editable).strict();
export type AssistantCreateInput = z.input<typeof assistantCreateSchema>;

export const assistantUpdateSchema = assistantCreateSchema.partial().strict();
export type AssistantUpdateInput = z.input<typeof assistantUpdateSchema>;

type LooseRecord = Record<string, unknown>;

/**
 * Upgrades any older assistant record (DB row, export file, shared link) to the current
 * schemaVersion. Pure and idempotent; unknown future versions are rejected by validation.
 */
export function migrateAssistantRecord(input: unknown): LooseRecord {
  if (!input || typeof input !== "object") return {};
  const record: LooseRecord = { ...(input as LooseRecord) };
  const version = typeof record.schemaVersion === "number" ? record.schemaVersion : 1;

  if (version <= 1) {
    record.description = typeof record.description === "string" ? record.description : "";
    const avatar = typeof record.avatar === "string" ? record.avatar.trim() : "";
    record.avatar = avatarSchema.safeParse(avatar).success && avatar ? avatar : DEFAULT_ASSISTANT_AVATAR;
    record.systemPrompt = typeof record.systemPrompt === "string" ? record.systemPrompt : "";
    record.defaultProviderId = record.defaultProviderId ?? null;
    record.defaultModelId = record.defaultModelId ?? null;
    record.temperature = typeof record.temperature === "number" ? record.temperature : 0.7;
    record.topP = record.topP ?? null;
    record.maxTokens = record.maxTokens ?? null;
    record.contextMessageLimit = record.contextMessageLimit ?? null;
    record.enabledTools = Array.isArray(record.enabledTools) ? record.enabledTools : [];
    record.memoryScope = record.memoryScope ?? "assistant";
    record.voiceId = record.voiceId ?? null;
    record.autoPlayTts = record.autoPlayTts ?? "never";
    record.starters = Array.isArray(record.starters) ? record.starters : [];
    record.settings = { ...DEFAULT_ASSISTANT_SETTINGS, ...((record.settings as LooseRecord) ?? {}) };
    record.isDefault = record.isDefault === true;
    record.tagIds = Array.isArray(record.tagIds) ? record.tagIds : [];
    record.schemaVersion = 2;
  }
  return record;
}
