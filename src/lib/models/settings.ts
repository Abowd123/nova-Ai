import { z } from "zod";
import { DEFAULT_TOOL_SETTINGS, toolSettingsSchema } from "./tools";
import { DEFAULT_BACKUP_SETTINGS, backupSettingsSchema } from "./backup";

export const themeSchema = z.enum(["light", "dark", "system"]);
export type ThemePreference = z.infer<typeof themeSchema>;

export const localeSchema = z.enum(["ar", "en"]);
export type Locale = z.infer<typeof localeSchema>;

export const mediaSettingsSchema = z
  .object({
    /** Longest image edge after resizing. */
    imageMaxDimension: z.number().int().min(256).max(8192),
    imageFormat: z.enum(["image/webp", "image/jpeg"]),
    imageQuality: z.number().min(0.3).max(1),
    /** Keep the original file instead of re-encoding (still validated). */
    keepOriginalImages: z.boolean(),
    videoMode: z.enum(["auto", "native", "frames"]),
    videoFrameCount: z.number().int().min(1).max(32),
    /** auto = OPFS when available, else IndexedDB. */
    storage: z.enum(["auto", "idb", "opfs"]),
  })
  .strict();
export type MediaSettings = z.infer<typeof mediaSettingsSchema>;

export const sttSettingsSchema = z
  .object({
    engine: z.enum(["web-speech", "openai", "whisper"]),
    /** Provider whose base URL + key are used for OpenAI-compatible transcription. */
    providerId: z.string().min(1).max(128).nullable(),
    model: z.string().max(128),
    /** Custom Whisper endpoint (whisper.cpp / faster-whisper server). */
    whisperUrl: z.string().max(2048),
    /** "auto" or a BCP-47 tag like ar-SA / en-US. */
    language: z.string().min(2).max(35),
    autoSend: z.boolean(),
  })
  .strict();
export type SttSettings = z.infer<typeof sttSettingsSchema>;

export const ttsSettingsSchema = z
  .object({
    engine: z.enum(["web-speech", "openai", "elevenlabs"]),
    providerId: z.string().min(1).max(128).nullable(),
    model: z.string().max(128),
    /** Used when the assistant has no voiceId. */
    defaultVoice: z.string().max(200),
    rate: z.number().min(0.5).max(2),
  })
  .strict();
export type TtsSettings = z.infer<typeof ttsSettingsSchema>;

export const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
  imageMaxDimension: 2048,
  imageFormat: "image/webp",
  imageQuality: 0.85,
  keepOriginalImages: false,
  videoMode: "auto",
  videoFrameCount: 8,
  storage: "auto",
};
export const DEFAULT_STT_SETTINGS: SttSettings = {
  engine: "web-speech",
  providerId: null,
  model: "whisper-1",
  whisperUrl: "",
  language: "auto",
  autoSend: false,
};
export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  engine: "web-speech",
  providerId: null,
  model: "gpt-4o-mini-tts",
  defaultVoice: "",
  rate: 1,
};

export const DEFAULT_MEMORY_TEMPLATE =
  "Relevant notes from earlier conversations (may be outdated; use only if helpful, never mention this list):\n{{memories}}";

export const memorySettingsSchema = z
  .object({
    enabled: z.boolean(),
    /** Embedding provider (OpenAI-compatible, Gemini, Ollama...). null = text search only. */
    embeddingProviderId: z.string().min(1).max(128).nullable(),
    embeddingModel: z.string().max(256),
    /** Optional output dimensions (OpenAI text-embedding-3, Gemini). null = model default. */
    embeddingDimensions: z.number().int().min(16).max(8192).nullable(),
    /** Index new messages automatically after each reply. */
    autoIndex: z.boolean(),
    /** Scope for chats without an assistant. */
    defaultScope: z.enum(["none", "global", "conversation"]),
    topK: z.number().int().min(1).max(30),
    /** Minimum cosine similarity (semantic search). */
    threshold: z.number().min(0).max(1),
    /** Weight of semantic vs keyword score in hybrid ranking (1 = semantic only). */
    semanticWeight: z.number().min(0).max(1),
    /** Max tokens of retrieved memory injected per request. */
    tokenBudget: z.number().int().min(100).max(32_000),
    chunkTokens: z.number().int().min(100).max(1000),
    chunkOverlap: z.number().int().min(0).max(300),
    promptTemplate: z.string().min(1).max(4000),
  })
  .strict();
export type MemorySettings = z.infer<typeof memorySettingsSchema>;

export const contextSettingsSchema = z
  .object({
    /** Used when the model's context window is unknown. */
    defaultContextWindow: z.number().int().min(1024).max(10_000_000),
    /** Tokens kept free for the reply when the assistant sets no max tokens. */
    reserveOutputTokens: z.number().int().min(256).max(200_000),
    /** Summarize older messages automatically when usage passes this ratio. */
    autoSummarize: z.boolean(),
    summarizeAt: z.number().min(0.3).max(0.95),
    /** Cheap model for summaries (null = the conversation model). */
    summaryProviderId: z.string().min(1).max(128).nullable(),
    summaryModelId: z.string().min(1).max(256).nullable(),
    /** Tool results longer than this are truncated in requests. */
    maxToolResultTokens: z.number().int().min(100).max(100_000),
    /** Show a warning when the next request would use more than this ratio. */
    warnAt: z.number().min(0.5).max(1),
  })
  .strict();
export type ContextSettings = z.infer<typeof contextSettingsSchema>;

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: true,
  embeddingProviderId: null,
  embeddingModel: "text-embedding-3-small",
  embeddingDimensions: null,
  autoIndex: true,
  defaultScope: "global",
  topK: 5,
  threshold: 0.35,
  semanticWeight: 0.7,
  tokenBudget: 1500,
  chunkTokens: 400,
  chunkOverlap: 60,
  promptTemplate: DEFAULT_MEMORY_TEMPLATE,
};

export const DEFAULT_CONTEXT_SETTINGS: ContextSettings = {
  defaultContextWindow: 8192,
  reserveOutputTokens: 2048,
  autoSummarize: true,
  summarizeAt: 0.8,
  summaryProviderId: null,
  summaryModelId: null,
  maxToolResultTokens: 4000,
  warnAt: 0.9,
};

/** Per-device app behaviour (never synced). */
export const deviceSettingsSchema = z.object({
  haptics: z.boolean(),
  /** Local notification when a reply finishes while the app is in the background. */
  notifyOnReply: z.boolean(),
  /** Opt-in: send redacted crash reports to the configured endpoint. */
  crashReports: z.boolean(),
});
export type DeviceSettings = z.infer<typeof deviceSettingsSchema>;
export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = { haptics: true, notifyOnReply: false, crashReports: false };

export const appSettingsSchema = z.object({
  theme: themeSchema,
  locale: localeSchema,
  userName: z.string().trim().max(100),
  sendShortcut: z.enum(["ctrl-enter", "enter"]),
  reducedMotion: z.boolean(),
  defaultProviderId: z.string().min(1).max(128).nullable(),
  defaultModelId: z.string().min(1).max(256).nullable(),
  /** Ask the model for a short title after the first reply. */
  autoTitle: z.boolean(),
  /** Max seconds to wait for the first byte of a response. */
  requestTimeoutSec: z.number().int().min(5).max(600),
  media: mediaSettingsSchema,
  stt: sttSettingsSchema,
  tts: ttsSettingsSchema,
  memory: memorySettingsSchema,
  context: contextSettingsSchema,
  tools: toolSettingsSchema,
  /** Device-local: WebDAV, scheduled backups and sync. */
  backup: backupSettingsSchema,
  device: deviceSettingsSchema,
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const appSettingsPatchSchema = appSettingsSchema.partial().strict();
export type AppSettingsPatch = z.input<typeof appSettingsPatchSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  locale: "ar",
  userName: "",
  sendShortcut: "ctrl-enter",
  reducedMotion: false,
  defaultProviderId: null,
  defaultModelId: null,
  autoTitle: true,
  requestTimeoutSec: 60,
  media: DEFAULT_MEDIA_SETTINGS,
  stt: DEFAULT_STT_SETTINGS,
  tts: DEFAULT_TTS_SETTINGS,
  memory: DEFAULT_MEMORY_SETTINGS,
  context: DEFAULT_CONTEXT_SETTINGS,
  tools: DEFAULT_TOOL_SETTINGS,
  backup: DEFAULT_BACKUP_SETTINGS,
  device: DEFAULT_DEVICE_SETTINGS,
};

export const APP_SETTINGS_KEY = "app";

export interface SettingsRecord {
  key: string;
  value: unknown;
  updatedAt: number;
}
