import { ASSISTANT_SCHEMA_VERSION, DEFAULT_ASSISTANT_SETTINGS, DEFAULT_SETTINGS, type Assistant, type Conversation, type Message, type Provider, type Tag } from "@/lib/models";
import type { ExportSnapshot } from "@/lib/transfer/format";

export const assistant = (id: string, extra: Partial<Assistant> = {}): Assistant => ({
  id,
  name: id,
  description: "",
  avatar: "✨",
  systemPrompt: "",
  defaultProviderId: null,
  defaultModelId: null,
  temperature: 0.7,
  topP: null,
  maxTokens: null,
  contextMessageLimit: null,
  enabledTools: [],
  memoryScope: "assistant",
  voiceId: null,
  autoPlayTts: "never",
  starters: [],
  settings: DEFAULT_ASSISTANT_SETTINGS,
  isDefault: false,
  tagIds: [],
  schemaVersion: ASSISTANT_SCHEMA_VERSION,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

export const tag = (id: string, name: string, order = 0, color = "#6750A4"): Tag => ({ id, name, color, order, createdAt: 1, updatedAt: 1 });

export const provider = (id: string, extra: Partial<Provider> = {}): Provider => ({
  id,
  name: id,
  kind: "openai",
  baseUrl: "https://api.openai.com/v1",
  enabled: true,
  transport: "direct",
  encryptedApiKey: null,
  encryptedHeaders: null,
  models: [],
  defaultModelId: null,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

export const conversation = (id: string, extra: Partial<Conversation> = {}): Conversation => ({
  id,
  title: id,
  titleSource: "manual",
  assistantId: null,
  providerId: null,
  modelId: null,
  pinned: false,
  archived: false,
  tagIds: [],
  messageCount: 0,
  lastMessageAt: null,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

export const message = (id: string, conversationId: string, extra: Partial<Message> = {}): Message => ({
  context: null,
  id,
  conversationId,
  role: "user",
  content: id,
  parts: [{ type: "text", text: id }],
  status: "complete",
  attachmentIds: [],
  error: null,
  providerId: null,
  modelId: null,
  usage: null,
  finishReason: null,
  heartbeatAt: null,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

export const snapshot = (extra: Partial<ExportSnapshot> = {}): ExportSnapshot => ({
  format: "nova-export",
  version: 1,
  exportedAt: "2026-01-01T00:00:00.000Z",
  app: { name: "Nova", version: "1.1.0" },
  assistants: [],
  tags: [],
  providers: [],
  models: [],
  settings: DEFAULT_SETTINGS,
  ...extra,
});

export function sequentialIds(prefix = "new") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}
