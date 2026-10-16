import { describe, expect, it } from "vitest";
import { FakeProvider, turns } from "@tests/helpers/fake-provider";
import { SubagentService } from "@/features/tools/subagent-service";
import { createBuiltinTools, searchProviderFor } from "@/features/tools/builtin-tools";
import { costOf } from "@/features/tools/pricing";
import { DEFAULT_SETTINGS, DEFAULT_TOOL_SETTINGS, type Provider, type ToolSettings, type UsageRecordInput } from "@/lib/models";
import type { Repositories } from "@/lib/storage/types";
import { ToolRegistry } from "@/lib/tools/registry";
import type { Tool } from "@/lib/tools/types";

const provider = {
  id: "cheap",
  enabled: true,
  models: [{ id: "mini", inputCost: 0.15, outputCost: 0.6 }],
} as unknown as Provider;

function repos(tools: ToolSettings = DEFAULT_TOOL_SETTINGS) {
  const usage: UsageRecordInput[] = [];
  const r = {
    settings: { get: async () => ({ ...DEFAULT_SETTINGS, tools }) },
    providers: { get: async (id: string) => (id === "cheap" ? provider : undefined) },
    usage: { add: async (rec: UsageRecordInput) => (usage.push(rec), { ...rec, id: "u", createdAt: 1 }) },
  } as unknown as Repositories;
  return { r, usage };
}

const echo: Tool = {
  name: "web_search",
  description: "search",
  inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  permission: "auto",
  dangerous: false,
  source: "builtin",
  execute: async (args) => ({ content: `results for ${String(args.query)}` }),
};

describe("SubagentService", () => {
  it("runs a separate-context loop with auto tools and records its own usage", async () => {
    const settings = { ...DEFAULT_TOOL_SETTINGS, subagent: { ...DEFAULT_TOOL_SETTINGS.subagent, providerId: "cheap", modelId: "mini", maxSteps: 3 } };
    const { r, usage } = repos(settings);
    const fake = new FakeProvider(turns({ calls: [{ id: "c1", name: "web_search", arguments: '{"query":"aden weather"}' }] }, { text: "It is sunny." }));
    const registry = new ToolRegistry();
    registry.register(echo);
    registry.register({ ...echo, name: "run_javascript", permission: "ask" });
    const service = new SubagentService({
      repos: r,
      getChatProvider: async () => fake,
      fallbackModel: async () => null,
      tools: async () => registry.resolve({ enabledTools: null, settings: { permissions: {} } }),
    });
    const result = await service.run({ task: "Find the weather", conversationId: "conv" });
    expect(result).toMatchObject({ text: "It is sunny.", steps: 2, providerId: "cheap", modelId: "mini", inputTokens: 20, outputTokens: 7 });
    expect(fake.requests[0]!.system).toContain("sub-agent");
    expect(fake.requests[0]!.tools?.map((t) => t.name)).toEqual(["web_search"]);
    expect(fake.requests[1]!.messages.at(-1)).toMatchObject({ role: "tool", parts: [{ type: "tool_result", content: "results for aden weather" }] });
    expect(usage.map((u) => u.kind)).toEqual(["subagent", "subagent"]);
    expect(usage[0]!.cost).toBeCloseTo((10 * 0.15 + 2 * 0.6) / 1_000_000);
  });

  it("falls back to the conversation model and forces a final answer on the last step", async () => {
    const { r } = repos();
    const fake = new FakeProvider(turns({ calls: [{ id: "c1", name: "web_search", arguments: '{"query":"x"}' }] }));
    const registry = new ToolRegistry();
    registry.register(echo);
    const service = new SubagentService({
      repos: r,
      getChatProvider: async () => fake,
      fallbackModel: async () => ({ providerId: "conv-p", modelId: "big" }),
      tools: async () => registry.resolve({ enabledTools: null, settings: { permissions: {} } }),
    });
    await service.run({ task: "t", conversationId: "c" });
    expect(fake.requests).toHaveLength(DEFAULT_TOOL_SETTINGS.subagent.maxSteps);
    expect(fake.requests.at(-1)!.toolChoice).toBe("none");
    expect(fake.requests[0]!.model).toBe("big");
  });
});

describe("built-in tools", () => {
  const base = () => {
    const settings = { ...DEFAULT_TOOL_SETTINGS, search: { ...DEFAULT_TOOL_SETTINGS.search, provider: "searxng" as const, searxngUrl: "https://searx.test", blockedSites: ["bad.test"] } };
    const calls: string[] = [];
    const tools = createBuiltinTools({
      settings: async () => settings,
      getAssistant: async () => undefined,
      memory: { retrieve: async () => ({ hits: [{ chunk: { id: "m", text: "User lives in Aden." }, score: 0.91 }], retrieval: "semantic" }) },
      js: { run: async () => ({ logs: [{ level: "log", text: "4" }], value: "4", truncated: false, timedOut: false, cancelled: false, durationMs: 3 }) } as never,
      python: { id: "p", isAvailable: () => true, reset() {}, run: async () => ({ stdout: "ok\n", stderr: "", files: [{ name: "a.png", mimeType: "image/png", data: new Uint8Array([1]) }], truncated: false, timedOut: false, cancelled: false, durationMs: 1 }) },
      keys: { get: async () => undefined } as never,
      searchHttp: async (url) => {
        calls.push(url);
        return Response.json({ results: [{ title: "Good", url: "https://good.test/a", content: "aden" }, { title: "Bad", url: "https://bad.test/", content: "aden" }] });
      },
      subagent: { run: async () => ({ text: "report", steps: 1, inputTokens: 1, outputTokens: 2, providerId: "p", modelId: "mini" }) } as never,
      saveFile: async () => "att-1",
    });
    return { byName: new Map(tools.map((t) => [t.name, t])), calls };
  };
  const ctx = { signal: new AbortController().signal, conversationId: "c", assistantId: null };

  it("exposes six tools with safe defaults", () => {
    const { byName } = base();
    expect([...byName.keys()]).toEqual(["search_memory", "web_search", "fetch_url", "run_javascript", "run_python", "delegate_task"]);
    expect(byName.get("run_javascript")!.permission).toBe("ask");
    expect(byName.get("run_python")!.permission).toBe("ask");
  });

  it("search_memory, web_search (blocked sites removed, citations), code tools and delegate_task", async () => {
    const { byName, calls } = base();
    expect((await byName.get("search_memory")!.execute({ query: "where" }, ctx)).content).toBe("1. (relevance 0.91) User lives in Aden.");
    const search = await byName.get("web_search")!.execute({ query: "aden" }, ctx);
    expect(calls[0]).toContain("https://searx.test/search?q=aden");
    expect(search.display?.citations).toEqual([{ index: 1, title: "Good", url: "https://good.test/a", snippet: "aden" }]);
    expect(search.content).toContain("[1] Good");
    expect((await byName.get("run_javascript")!.execute({ code: "2+2" }, ctx)).content).toContain("Result: 4");
    const py = await byName.get("run_python")!.execute({ code: "print('ok')" }, ctx);
    expect(py.display?.files).toEqual([{ name: "a.png", mimeType: "image/png", size: 1, attachmentId: "att-1" }]);
    expect((await byName.get("delegate_task")!.execute({ task: "t" }, ctx)).content).toBe("report");
  });

  it("explains when search is not configured", async () => {
    expect(searchProviderFor(DEFAULT_TOOL_SETTINGS, { keys: {} as never, searchHttp: async () => new Response() })).toBeNull();
  });

  it("prices usage", () => {
    expect(costOf(provider, "mini", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.75);
    expect(costOf(provider, "unknown", { inputTokens: 1, outputTokens: 1 })).toBeNull();
  });
});
