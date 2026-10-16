import { describe, expect, it } from "vitest";
import { FakeProvider, reply } from "@tests/helpers/fake-provider";
import { KEEP_RECENT, SummaryService } from "@/features/memory/summary-service";
import { DEFAULT_SETTINGS, type ConversationSummary, type ConversationSummaryPut, type Message } from "@/lib/models";
import type { Repositories } from "@/lib/storage/types";

function setup(count: number, summaryText = "- user is planning a trip to Aden") {
  const messages: Message[] = Array.from(
    { length: count },
    (_, i) => ({ id: `m${i}`, conversationId: "c1", role: i % 2 ? "assistant" : "user", content: `message ${i}`, parts: [], status: "complete", createdAt: i + 1, updatedAt: i + 1 }) as unknown as Message,
  );
  const store = new Map<string, ConversationSummary>();
  let clock = 1000;
  const repos = {
    settings: { get: async () => DEFAULT_SETTINGS },
    providers: { get: async () => undefined },
    messages: { listByConversation: async () => messages },
    summaries: {
      get: async (id: string) => store.get(id),
      put: async (id: string, data: ConversationSummaryPut) => {
        const prev = store.get(id);
        const next = { id, createdAt: prev?.createdAt ?? clock, updatedAt: ++clock, ...data } as ConversationSummary;
        store.set(id, next);
        return next;
      },
      delete: async (id: string) => void store.delete(id),
    },
  } as unknown as Repositories;
  const provider = new FakeProvider(reply(`Here is the summary:\n${summaryText}`));
  const service = new SummaryService({
    repos,
    getChatProvider: async () => provider,
    resolveModel: async () => ({ provider: { id: "p1" }, modelId: "cheap-1", model: undefined }),
  });
  return { service, store, provider, messages };
}

describe("SummaryService", () => {
  it("skips short conversations", async () => {
    const { service } = setup(KEEP_RECENT);
    expect(await service.summarize("c1")).toEqual({ status: "skipped", reason: "too_short" });
  });

  it("summarizes everything except the recent messages, then only new ones", async () => {
    const { service, store, provider } = setup(10);
    const first = await service.summarize("c1");
    expect(first.status).toBe("updated");
    const saved = store.get("c1")!;
    expect(saved).toMatchObject({ text: "- user is planning a trip to Aden", manualEdit: false, coveredUntil: 10 - KEEP_RECENT, coveredMessageCount: 10 - KEEP_RECENT, modelId: "cheap-1" });
    const prompt = (provider.requests[0]!.messages[0]!.parts[0] as { text: string }).text;
    expect(prompt).toContain("User: message 0");
    expect(prompt).not.toContain(`message ${10 - KEEP_RECENT}`);
    expect(await service.summarize("c1")).toEqual({ status: "skipped", reason: "nothing_new" });
  });

  it("never overwrites a manual edit automatically; regenerate (force) does", async () => {
    const { service, store } = setup(12);
    await service.saveManual("c1", "  my own notes  ");
    expect(store.get("c1")).toMatchObject({ text: "my own notes", manualEdit: true });
    expect(await service.summarize("c1")).toEqual({ status: "skipped", reason: "manual" });
    expect(store.get("c1")!.text).toBe("my own notes");
    const forced = await service.summarize("c1", { force: true });
    expect(forced.status).toBe("updated");
    expect(store.get("c1")).toMatchObject({ manualEdit: false, coveredMessageCount: 12 - KEEP_RECENT });
  });

  it("does not run twice at once", async () => {
    const { service } = setup(10);
    const [a, b] = await Promise.all([service.summarize("c1"), service.summarize("c1")]);
    expect([a.status, b.status].sort()).toEqual(["skipped", "updated"]);
  });
});
