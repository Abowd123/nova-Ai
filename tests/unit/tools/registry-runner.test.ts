import { describe, expect, it } from "vitest";
import { ToolRegistry, effectivePermission, mcpServerToolKey, mcpToolName, toToolSpecs } from "@/lib/tools/registry";
import { ToolRunner, type ApprovalRequest } from "@/lib/tools/runner";
import type { ApprovalDecision, Tool, ToolCallState } from "@/lib/tools/types";

function tool(name: string, over: Partial<Tool> = {}): Tool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { type: "object", properties: { x: { type: "number" } }, required: ["x"] },
    permission: "auto",
    dangerous: false,
    source: "builtin",
    execute: async (args) => ({ content: `${name}:${String(args.x)}` }),
    ...over,
  };
}

describe("ToolRegistry", () => {
  it("resolves assistant selection, MCP server keys and permissions", () => {
    const registry = new ToolRegistry();
    registry.register(tool("a"));
    registry.register(tool("b", { permission: "ask" }));
    registry.replaceServerTools("s1", [tool(mcpToolName("git", "push"), { source: "mcp", dangerous: true })]);
    const slugOf = (id: string) => (id === "s1" ? "git" : undefined);
    expect(registry.resolve({ enabledTools: null, settings: { permissions: {} } }).map((a) => [a.tool.name, a.permission])).toEqual([
      ["a", "auto"],
      ["b", "ask"],
      ["git__push", "ask"],
    ]);
    expect(registry.resolve({ enabledTools: ["a", mcpServerToolKey("git")], settings: { permissions: { a: "disabled" } }, mcpSlugOf: slugOf }).map((a) => a.tool.name)).toEqual(["git__push"]);
    expect(toToolSpecs(registry.resolve({ enabledTools: ["b"], settings: { permissions: {} } }))).toEqual([{ name: "b", description: "b tool", parameters: tool("b").inputSchema }]);
    registry.replaceServerTools("s1", []);
    expect(registry.get("git__push")).toBeUndefined();
  });

  it("dangerous tools never run automatically; names are sanitized", () => {
    expect(effectivePermission({ name: "x", permission: "ask", dangerous: true }, { x: "auto" })).toBe("ask");
    expect(effectivePermission({ name: "x", permission: "ask", dangerous: false }, { x: "auto" })).toBe("auto");
    expect(mcpToolName("srv", "files.read/all")).toBe("srv__files_read_all");
    expect(() => new ToolRegistry().register(tool("bad name"))).toThrow();
  });
});

function setup(decisions: ApprovalDecision[] = []) {
  const states: ToolCallState[] = [];
  const asked: ApprovalRequest[] = [];
  const saved: [string, string][] = [];
  const runner = new ToolRunner({
    approve: async (request) => {
      asked.push(request);
      return decisions.shift() ?? "deny";
    },
    setPermission: async (name, permission) => void saved.push([name, permission]),
    onState: (_c, state) => states.push(state),
  });
  return { runner, states, asked, saved };
}

const options = (tools: Tool[], over: Partial<Parameters<ToolRunner["runCalls"]>[1]> = {}) => {
  const registry = new ToolRegistry();
  for (const t of tools) registry.register(t);
  return {
    conversationId: "c1",
    assistantId: null,
    tools: new Map(registry.resolve({ enabledTools: null, settings: { permissions: {} } }).map((a) => [a.tool.name, a])),
    signal: new AbortController().signal,
    timeoutMs: 1000,
    parallel: true,
    ...over,
  };
};

describe("ToolRunner", () => {
  it("runs calls in parallel and keeps order", async () => {
    const { runner, states } = setup();
    const slow = tool("slow", { execute: async (a) => (await new Promise((r) => setTimeout(r, 20)), { content: `slow ${String(a.x)}` }) });
    const results = await runner.runCalls(
      [
        { id: "1", name: "slow", arguments: '{"x":1}' },
        { id: "2", name: "a", arguments: '{"x":2}' },
      ],
      options([slow, tool("a")]),
    );
    expect(results.map((r) => [r.toolCallId, r.content, r.outcome])).toEqual([
      ["1", "slow 1", "ok"],
      ["2", "a:2", "ok"],
    ]);
    expect(results[0]!.display?.durationMs).toBeGreaterThanOrEqual(0);
    expect(states.filter((s) => s.status === "running")).toHaveLength(2);
  });

  it("answers unknown tools, bad JSON and invalid args with errors the model can read", async () => {
    const { runner } = setup();
    const results = await runner.runCalls(
      [
        { id: "1", name: "nope", arguments: "{}" },
        { id: "2", name: "a", arguments: "{bad" },
        { id: "3", name: "a", arguments: '{"x":"str"}' },
      ],
      options([tool("a")]),
    );
    expect(results.map((r) => r.outcome)).toEqual(["error", "error", "error"]);
    expect(results[0]!.content).toContain("not available");
    expect(results[1]!.content).toContain("not valid JSON");
    expect(results[2]!.content).toContain("$.x expected number");
  });

  it("asks for approval; deny and always-allow", async () => {
    const { runner, asked, saved } = setup(["deny", "always"]);
    const ask = tool("b", { permission: "ask" });
    const results = await runner.runCalls(
      [
        { id: "1", name: "b", arguments: '{"x":1}' },
        { id: "2", name: "b", arguments: '{"x":2}' },
      ],
      options([ask]),
    );
    expect(asked.map((a) => a.args)).toEqual([{ x: 1 }, { x: 2 }]);
    expect(results.map((r) => r.outcome)).toEqual(["denied", "ok"]);
    expect(saved).toEqual([["b", "auto"]]);
  });

  it("never persists always-allow for dangerous tools", async () => {
    const { runner, saved } = setup(["always"]);
    const results = await runner.runCalls([{ id: "1", name: "d", arguments: '{"x":1}' }], options([tool("d", { dangerous: true })]));
    expect(results[0]!.outcome).toBe("ok");
    expect(saved).toEqual([]);
  });

  it("times out stuck tools and reports thrown errors (redacted)", async () => {
    const { runner } = setup();
    const hang = tool("hang", { execute: () => new Promise(() => undefined) });
    const boom = tool("boom", {
      execute: async () => {
        throw new Error("failed with key sk-abcdefghijklmnopqrstuvwxyz123456");
      },
    });
    const results = await runner.runCalls(
      [
        { id: "1", name: "hang", arguments: '{"x":1}' },
        { id: "2", name: "boom", arguments: '{"x":1}' },
      ],
      options([hang, boom], { timeoutMs: 30 }),
    );
    expect(results[0]!.content).toContain("timed out");
    expect(results[1]!.content).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
  });

  it("throws on cancellation of the whole reply", async () => {
    const { runner } = setup();
    const controller = new AbortController();
    const hang = tool("hang", { execute: () => new Promise(() => undefined) });
    const run = runner.runCalls([{ id: "1", name: "hang", arguments: '{"x":1}' }], options([hang], { signal: controller.signal }));
    setTimeout(() => controller.abort(), 10);
    let name = "";
    try {
      await run;
    } catch (e) {
      name = (e as Error).name;
    }
    expect(name).toBe("AbortError");
  });
});
