// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assistant } from "@tests/helpers/fixtures";
import { buildChatRequest, limitHistory, renderSystemPrompt } from "@/features/chat/engine/build-request";
import { assistantCreateSchema, assistantSchema, avatarSchema, migrateAssistantRecord, type Message } from "@/lib/models";

const msg = (i: number, role: Message["role"]): Message => ({
  context: null,
  id: `m${i}`,
  conversationId: "c",
  role,
  content: `t${i}`,
  parts: [{ type: "text", text: `t${i}` }],
  status: "complete",
  attachmentIds: [],
  error: null,
  providerId: null,
  modelId: null,
  usage: null,
  finishReason: null,
  heartbeatAt: null,
  createdAt: i,
  updatedAt: i,
});
const history = [msg(1, "user"), msg(2, "assistant"), msg(3, "user"), msg(4, "assistant"), msg(5, "user")];
const vars = { userName: "Aboof", locale: "en", now: new Date(2026, 9, 16, 10, 0) };
const caps = { vision: false, audio: false, video: false, tools: false, reasoning: true };

describe("assistant schema v2", () => {
  it("migrates a v1 record and fills every new field", () => {
    const migrated = migrateAssistantRecord({ id: "a", name: "Old", systemPrompt: "hi", temperature: 1, createdAt: 1, updatedAt: 1 });
    expect(migrated).toMatchObject({ schemaVersion: 2, starters: [], enabledTools: [], memoryScope: "assistant", autoPlayTts: "never", avatar: "✨" });
    expect(assistantSchema.safeParse(migrated).success).toBe(true);
  });

  it("keeps a v2 record untouched", () => {
    const current = assistant("a", { starters: ["x"], memoryScope: "global" });
    expect(migrateAssistantRecord(current)).toEqual(current);
  });

  it("returns an empty object for garbage input", () => {
    expect(migrateAssistantRecord(null)).toEqual({});
    expect(migrateAssistantRecord("x")).toEqual({});
  });

  it("accepts emoji and raster data URLs but rejects SVG and long text", () => {
    expect(avatarSchema.safeParse("🤖").success).toBe(true);
    expect(avatarSchema.safeParse("data:image/png;base64,iVBORw0KGgo=").success).toBe(true);
    expect(avatarSchema.safeParse("data:image/webp;base64,UklGRg==").success).toBe(true);
    expect(avatarSchema.safeParse("data:image/svg+xml;base64,PHN2Zy8+").success).toBe(false);
    expect(avatarSchema.safeParse("data:text/html;base64,PGI+").success).toBe(false);
    expect(avatarSchema.safeParse("x".repeat(17)).success).toBe(false);
  });

  it("validates starters and parameter ranges", () => {
    expect(assistantCreateSchema.safeParse({ name: "a", starters: Array(9).fill("s") }).success).toBe(false);
    expect(assistantCreateSchema.safeParse({ name: "a", starters: ["  "] }).success).toBe(false);
    expect(assistantCreateSchema.safeParse({ name: "a", topP: 1.1 }).success).toBe(false);
    expect(assistantCreateSchema.safeParse({ name: "a", maxTokens: 0 }).success).toBe(false);
    expect(assistantCreateSchema.safeParse({ name: "a", contextMessageLimit: 4, settings: { reasoning: "on", reasoningBudget: 4096 } }).success).toBe(true);
  });
});

describe("system prompt variables", () => {
  it("replaces all supported variables and leaves unknown ones", () => {
    const out = renderSystemPrompt("{{date}}|{{ time }}|{{user_name}}|{{model}}|{{device_language}}|{{other}}", { ...vars, model: "GPT" });
    const [date, time, ...rest] = out.split("|");
    expect(date).toContain("2026");
    expect(time).toMatch(/10/);
    expect(rest).toEqual(["Aboof", "GPT", "en", "{{other}}"]);
  });
});

describe("limitHistory", () => {
  const messages = history.map((m) => ({ role: m.role as "user" | "assistant", parts: [{ type: "text" as const, text: m.content }] }));
  const textOf = (m: { parts: { type: string; text?: string }[] }) => m.parts.map((p) => p.text ?? "").join("");
  it("returns everything without a limit", () => {
    expect(limitHistory(messages, null)).toHaveLength(5);
    expect(limitHistory(messages, 10)).toHaveLength(5);
  });
  it("keeps the last N and never starts on an assistant reply", () => {
    expect(limitHistory(messages, 3).map(textOf)).toEqual(["t3", "t4", "t5"]);
    expect(limitHistory(messages, 2).map(textOf)).toEqual(["t5"]);
  });
});

describe("buildChatRequest with assistant parameters", () => {
  it("applies prompt, temperature, topP, maxTokens and the context limit", () => {
    const request = buildChatRequest({
      history,
      modelId: "gpt-4o",
      assistant: assistant("a", { systemPrompt: "Hi {{user_name}} on {{model}}", temperature: 0.2, topP: 0.9, maxTokens: 512, contextMessageLimit: 3 }),
      vars,
    });
    expect(request).toMatchObject({ model: "gpt-4o", system: "Hi Aboof on gpt-4o", temperature: 0.2, topP: 0.9, maxTokens: 512 });
    expect(request.messages).toHaveLength(3);
    expect(request).not.toHaveProperty("reasoning");
  });

  it("enables reasoning automatically for reasoning models and respects off", () => {
    const model = { id: "o3", name: "o3", enabled: true, contextWindow: null, capabilities: caps, inputCost: null, outputCost: null, source: "remote" as const };
    const auto = buildChatRequest({ history, modelId: "o3", model, assistant: assistant("a"), vars });
    expect(auto.reasoning).toEqual({ enabled: true, budgetTokens: 2048 });
    const off = buildChatRequest({ history, modelId: "o3", model, assistant: assistant("a", { settings: { reasoning: "off", reasoningBudget: 2048 } }), vars });
    expect(off).not.toHaveProperty("reasoning");
    const forced = buildChatRequest({ history, modelId: "x", assistant: assistant("a", { settings: { reasoning: "on", reasoningBudget: 8000 } }), vars });
    expect(forced.reasoning).toEqual({ enabled: true, budgetTokens: 8000 });
  });

  it("sends no assistant parameters without an assistant", () => {
    const request = buildChatRequest({ history, modelId: "m", vars });
    expect(request).not.toHaveProperty("temperature");
    expect(request.system).toBeUndefined();
    expect(request.messages).toHaveLength(5);
  });
});
