// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildChatRequest, renderSystemPrompt, toChatMessages } from "@/features/chat/engine/build-request";
import { cleanGeneratedTitle, titleFromText } from "@/features/chat/engine/titles";
import { effectiveModel, modelKey, parseModelKey } from "@/features/chat/model-selection";
import { mergeFetchedModels, selectableModels } from "@/features/providers/provider-service";
import type { Message, Provider, ProviderModel } from "@/lib/models";

const caps = { vision: false, audio: false, video: false, tools: false, reasoning: false };
const model = (id: string, enabled = true, extra: Partial<ProviderModel> = {}): ProviderModel => ({
  id,
  name: id.toUpperCase(),
  enabled,
  contextWindow: null,
  capabilities: caps,
  inputCost: null,
  outputCost: null,
  source: "remote",
  ...extra,
});
const provider = (id: string, models: ProviderModel[], extra: Partial<Provider> = {}): Provider => ({
  id,
  name: id,
  kind: "custom",
  baseUrl: "https://x.test",
  enabled: true,
  transport: "direct",
  encryptedApiKey: null,
  encryptedHeaders: null,
  models,
  defaultModelId: models[0]?.id ?? null,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});
const message = (role: Message["role"], content: string, status: Message["status"] = "complete", parts?: Message["parts"]): Message => ({
  context: null,
  id: `${role}-${content}`,
  conversationId: "c",
  role,
  content,
  parts: parts ?? (content ? [{ type: "text", text: content }] : []),
  status,
  attachmentIds: [],
  error: null,
  providerId: null,
  modelId: null,
  usage: null,
  finishReason: null,
  heartbeatAt: null,
  createdAt: 0,
  updatedAt: 0,
});

describe("request building", () => {
  it("renders supported variables and leaves unknown ones", () => {
    const out = renderSystemPrompt("Hi {{user_name}}, {{ model }} on {{device_language}} {{unknown}}", {
      userName: "Sara",
      model: "GPT",
      locale: "ar",
      now: new Date(Date.UTC(2026, 9, 16)),
    });
    expect(out).toBe("Hi Sara, GPT on ar {{unknown}}");
  });

  it("drops failed/empty/streaming turns and unsigned reasoning", () => {
    const history = [
      message("user", "q1"),
      message("assistant", "", "error"),
      message("assistant", "partial", "aborted"),
      message("assistant", "", "complete"),
      message("assistant", "a", "complete", [{ type: "reasoning", text: "secret thoughts" }, { type: "text", text: "a" }]),
      message("assistant", "live", "streaming"),
      message("system", "sys"),
    ];
    expect(toChatMessages(history)).toEqual([
      { role: "user", parts: [{ type: "text", text: "q1" }] },
      { role: "assistant", parts: [{ type: "text", text: "partial" }] },
      { role: "assistant", parts: [{ type: "text", text: "a" }] },
    ]);
  });

  it("enables reasoning only for reasoning-capable models", () => {
    const base = { history: [message("user", "q")], modelId: "m", vars: { userName: "", locale: "en", now: new Date() } };
    expect(buildChatRequest({ ...base, model: model("m") }).reasoning).toBeUndefined();
    expect(buildChatRequest({ ...base, model: model("m", true, { capabilities: { ...caps, reasoning: true } }) }).reasoning).toEqual({
      enabled: true,
      budgetTokens: 2048,
    });
  });
});

describe("titles", () => {
  it("derives a clean title from the first line", () => {
    expect(titleFromText("```js\ncode\n```\n# **Fix** the [login](https://x) bug\nmore")).toBe("Fix the login bug");
    expect(titleFromText("   ")).toBe("");
    const long = titleFromText("word ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(61);
    expect(long.endsWith("…")).toBe(true);
  });

  it("cleans model titles", () => {
    expect(cleanGeneratedTitle('"Title: Sorting arrays."')).toBe("Sorting arrays");
    expect(cleanGeneratedTitle("<think>hmm</think>\n«ترتيب المصفوفات»")).toBe("ترتيب المصفوفات");
    expect(cleanGeneratedTitle("العنوان: خطة السفر؟")).toBe("خطة السفر");
  });
});

describe("model selection", () => {
  const providers = [provider("p1", [model("a", false), model("b")], { defaultModelId: "b" }), provider("p2", [model("c")], { enabled: false })];

  it("lists only enabled models of enabled providers", () => {
    expect(selectableModels(providers).map((s) => `${s.providerId}/${s.model.id}`)).toEqual(["p1/b"]);
  });

  it("resolves conversation -> settings -> first available", () => {
    expect(effectiveModel(providers, { providerId: "p2", modelId: "c" }, null)?.model.id).toBe("b");
    expect(effectiveModel(providers, null, { defaultProviderId: "p1", defaultModelId: "b" })?.model.id).toBe("b");
    expect(effectiveModel([], null, null)).toBeUndefined();
  });

  it("encodes model keys safely", () => {
    expect(parseModelKey(modelKey("p1", "org/model:tag"))).toEqual({ providerId: "p1", modelId: "org/model:tag" });
    expect(parseModelKey("broken")).toBeNull();
  });

  it("merging fetched models keeps user choices and manual models", () => {
    const existing = [model("keep-off", false), model("manual-x", true, { source: "manual" })];
    const fetched = [
      { id: "keep-off", name: "K", providerKind: "custom" as const, contextWindow: 10, capabilities: caps, inputCost: null, outputCost: null, source: "remote" as const },
      { id: "new", name: "N", providerKind: "custom" as const, contextWindow: null, capabilities: caps, inputCost: null, outputCost: null, source: "remote" as const },
    ];
    const merged = mergeFetchedModels(existing, fetched);
    expect(merged.map((m) => [m.id, m.enabled])).toEqual([
      ["keep-off", false],
      ["new", true],
      ["manual-x", true],
    ]);
    expect(merged[0]?.contextWindow).toBe(10);
  });
});
