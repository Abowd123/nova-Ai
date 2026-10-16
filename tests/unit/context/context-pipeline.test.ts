import { describe, expect, it } from "vitest";
import { prepareContext, toContextMessages, type ContextRetriever } from "@/features/chat/engine/context-pipeline";
import { DEFAULT_SETTINGS, type Lorebook, type Message } from "@/lib/models";

let n = 0;
const message = (role: "user" | "assistant", text: string, status: Message["status"] = "complete"): Message =>
  ({ id: `m${++n}`, conversationId: "c1", role, content: text, parts: [{ type: "text", text }], status, createdAt: n, updatedAt: n }) as unknown as Message;

const settings = { ...DEFAULT_SETTINGS, memory: { ...DEFAULT_SETTINGS.memory, enabled: true } };

function retriever(hits: { id: string; text: string; score: number }[]) {
  const calls: { query: string; excludeMessageIds: readonly string[] }[] = [];
  const r: ContextRetriever = {
    retrieve: async (input) => {
      calls.push({ query: input.query, excludeMessageIds: input.excludeMessageIds });
      return { hits: hits.map((h) => ({ chunk: { id: h.id, text: h.text }, score: h.score })), retrieval: "semantic" };
    },
  };
  return { r, calls };
}

const lorebook: Lorebook = {
  id: "b1",
  name: "World",
  description: "",
  enabled: true,
  assistantId: null,
  conversationId: null,
  tokenBudget: 500,
  scanDepth: 4,
  entries: [{ id: "e1", keywords: ["نوفا", "Nova"], content: "Nova is a local-first assistant.", priority: 1, enabled: true, caseSensitive: false }],
  createdAt: 1,
  updatedAt: 1,
};

describe("toContextMessages", () => {
  it("keeps usable turns with ids and applies the message limit", () => {
    const history = [message("user", "a"), message("assistant", "b"), message("user", "c", "error"), message("user", "d"), message("assistant", "e")];
    const all = toContextMessages(history, null);
    expect(all.map((m) => m.id)).toEqual([history[0]!.id, history[1]!.id, history[3]!.id, history[4]!.id]);
    expect(toContextMessages(history, 3).map((m) => m.message.role)[0]).toBe("user");
  });
});

describe("prepareContext", () => {
  it("retrieves with the last user message, excluding what is already in the window, and reports usage", async () => {
    const history = [message("user", "My name is Aboof."), message("assistant", "Nice to meet you."), message("user", "ما هو نوفا وما اسمي؟")];
    const { r, calls } = retriever([{ id: "k1", text: "User's name is Aboof.", score: 0.82 }]);
    const prepared = await prepareContext(
      { conversationId: "c1", history, request: { model: "m", system: "Be brief.", messages: [] }, assistant: null, model: { contextWindow: 16000 } as never, settings },
      { retriever: r, lorebooks: { list: async () => [lorebook] }, summaries: { get: async () => undefined } },
    );
    expect(calls[0]!.query).toBe("ما هو نوفا وما اسمي؟");
    expect(calls[0]!.excludeMessageIds).toEqual(history.map((m) => m.id));
    expect(prepared.info).toMatchObject({ memoryIds: ["k1"], memoryScores: [0.82], lore: [{ lorebookId: "b1", entryId: "e1" }], retrieval: "semantic", contextWindow: 16000, summaryUsed: false });
    expect(prepared.request.promptCache).toBe(true);
    expect(prepared.request.system).toBe("Be brief.");
    const last = prepared.request.messages.at(-1)!.parts[0] as { text: string };
    expect(last.text).toContain("User's name is Aboof.");
    expect(last.text).toContain("Nova is a local-first assistant.");
    expect(prepared.windowKnown).toBe(true);
  });

  it("skips retrieval for previews and when memory is disabled", async () => {
    const { r, calls } = retriever([{ id: "k1", text: "x", score: 1 }]);
    const base = { conversationId: "c1", history: [message("user", "hi")], request: { model: "m", messages: [] }, assistant: null, model: undefined };
    const preview = await prepareContext({ ...base, settings, retrieve: false, draft: "draft text" }, { retriever: r });
    expect(calls).toHaveLength(0);
    expect(preview.info.retrieval).toBe("none");
    expect(preview.request.messages.at(-1)!.parts[0]).toEqual({ type: "text", text: "draft text" });
    expect(preview.windowKnown).toBe(false);
    await prepareContext({ ...base, settings: { ...settings, memory: { ...settings.memory, enabled: false } } }, { retriever: r });
    expect(calls).toHaveLength(0);
  });

  it("survives failing sources", async () => {
    const prepared = await prepareContext(
      { conversationId: "c1", history: [message("user", "hello Nova")], request: { model: "m", messages: [] }, assistant: null, model: undefined, settings },
      { lorebooks: { list: async () => Promise.reject(new Error("db")) }, summaries: { get: async () => Promise.reject(new Error("db")) } },
    );
    expect(prepared.info.lore).toEqual([]);
    expect(prepared.request.messages).toHaveLength(1);
  });
});
