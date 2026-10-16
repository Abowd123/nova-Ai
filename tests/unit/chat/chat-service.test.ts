// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeProvider, hang, reply, turns, waitFor } from "@tests/helpers/fake-provider";
import { ToolRegistry } from "@/lib/tools/registry";
import { ToolRunner } from "@/lib/tools/runner";
import type { Tool } from "@/lib/tools/types";
import { createTestContext, type TestContext } from "@tests/helpers/storage";
import { ChatService } from "@/features/chat/engine/chat-service";
import type { StreamLocks } from "@/features/chat/engine/stream-locks";
import type { StreamingSink } from "@/features/chat/engine/streaming-store";

describe("ChatService", () => {
  let ctx: TestContext;
  let provider: FakeProvider;
  let sink: StreamingSink & { events: string[] };
  let service: ChatService;
  let conversationId: string;
  let providerId: string;

  const makeService = (extra: Partial<ConstructorParameters<typeof ChatService>[0]> = {}) =>
    new ChatService({
      repos: ctx.repos,
      getChatProvider: async () => provider,
      sink,
      flushIntervalMs: 0,
      schedule: (callback) => callback(),
      ...extra,
    });

  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    ctx = await createTestContext();
    provider = new FakeProvider(reply("Hello ", "world"));
    sink = {
      events: [],
      begin(stream) {
        this.events.push(`begin:${stream.messageId}`);
      },
      update(_id, text) {
        this.events.push(`update:${text}`);
      },
      end(id) {
        this.events.push(`end:${id}`);
      },
    };
    const created = await ctx.repos.providers.create({
      name: "Fake",
      kind: "custom",
      baseUrl: "https://fake.test/v1",
      models: [
        {
          id: "fake-1",
          name: "Fake One",
          enabled: true,
          contextWindow: 8000,
          capabilities: { vision: false, audio: false, video: false, tools: false, reasoning: false },
          inputCost: null,
          outputCost: null,
          source: "manual",
        },
      ],
      defaultModelId: "fake-1",
    });
    providerId = created.id;
    await ctx.repos.settings.update({ autoTitle: false });
    conversationId = (await ctx.repos.conversations.create({ titleSource: "default" })).id;
    service = makeService();
  });

  afterEach(async () => {
    await ctx.destroy();
  });

  const messages = () => ctx.repos.messages.listByConversation(conversationId);

  it("sends a message, streams the reply and persists it with usage", async () => {
    await service.send(conversationId, "  How do I sort an array?  ");
    const list = await messages();
    expect(list.map((m) => [m.role, m.content, m.status])).toEqual([
      ["user", "How do I sort an array?", "complete"],
      ["assistant", "Hello world", "complete"],
    ]);
    expect(list[1]).toMatchObject({ providerId, modelId: "fake-1", finishReason: "stop", heartbeatAt: null, usage: { totalTokens: 5 } });
    expect(sink.events[0]).toMatch(/^begin:/);
    expect(sink.events).toContain("update:Hello world");
    expect(sink.events.at(-1)).toMatch(/^end:/);
    expect(provider.requests[0]).toMatchObject({ model: "fake-1", messages: [{ role: "user" }] });
  });

  it("sets an instant title from the first message", async () => {
    await service.send(conversationId, "## Sorting **arrays** in TypeScript\nplease");
    expect(await ctx.repos.conversations.get(conversationId)).toMatchObject({ title: "Sorting arrays in TypeScript", titleSource: "auto" });
  });

  it("never overwrites a manual title", async () => {
    await ctx.repos.conversations.update(conversationId, { title: "Mine", titleSource: "manual" });
    await service.send(conversationId, "something else");
    expect((await ctx.repos.conversations.get(conversationId))?.title).toBe("Mine");
  });

  it("asks the model for a title after the first reply when enabled", async () => {
    await ctx.repos.settings.update({ autoTitle: true });
    let call = 0;
    provider.script = (request, options) => {
      call += 1;
      return call === 1 ? reply("answer")(request, options) : reply('"Title: Array sorting tips."')(request, options);
    };
    await service.send(conversationId, "how to sort");
    await waitFor(() => call >= 2);
    await vi.waitFor(async () => expect((await ctx.repos.conversations.get(conversationId))?.title).toBe("Array sorting tips"));
  });

  it("persists partial output while streaming (with heartbeat)", async () => {
    provider.script = hang("partial text");
    const run = service.send(conversationId, "q");
    await vi.waitFor(async () => {
      const last = (await messages()).at(-1);
      expect(last).toMatchObject({ role: "assistant", status: "streaming", content: "partial text" });
      expect(last?.heartbeatAt).not.toBeNull();
    });
    service.stop(conversationId);
    await run;
  });

  it("stop keeps the partial reply as aborted", async () => {
    provider.script = hang("half an ans");
    const run = service.send(conversationId, "q");
    await waitFor(() => service.isStreaming(conversationId));
    await vi.waitFor(async () => expect((await messages()).at(-1)?.content).toBe("half an ans"));
    service.stop(conversationId);
    await expect(run).resolves.toBeUndefined();
    expect((await messages()).at(-1)).toMatchObject({ status: "aborted", content: "half an ans", finishReason: "aborted", error: null });
    expect(service.isStreaming(conversationId)).toBe(false);
  });

  it("refuses concurrent generations in the same conversation", async () => {
    provider.script = hang("x");
    const run = service.send(conversationId, "first");
    await waitFor(() => service.isStreaming(conversationId));
    await expect(service.send(conversationId, "second")).rejects.toMatchObject({ code: "busy" });
    service.stop(conversationId);
    await run;
  });

  it("continue appends to an aborted reply", async () => {
    provider.script = hang("Once upon");
    const run = service.send(conversationId, "story");
    await vi.waitFor(async () => expect((await messages()).at(-1)?.content).toBe("Once upon"));
    service.stop(conversationId);
    await run;
    const aborted = (await messages()).at(-1)!;

    provider.script = reply(" a time.");
    await service.continue(aborted.id);
    const list = await messages();
    expect(list).toHaveLength(2);
    expect(list[1]).toMatchObject({ id: aborted.id, content: "Once upon a time.", status: "complete" });
    const request = provider.requests.at(-1)!;
    expect(request.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("regenerate replaces the last reply", async () => {
    await service.send(conversationId, "q");
    const first = (await messages()).at(-1)!;
    provider.script = reply("second try");
    await service.regenerate(first.id);
    const list = await messages();
    expect(list).toHaveLength(2);
    expect(list[1]?.content).toBe("second try");
    expect(list[1]?.id).not.toBe(first.id);
  });

  it("edit rewrites a user message, drops later turns and resends", async () => {
    await service.send(conversationId, "first question");
    provider.script = reply("second answer");
    await service.send(conversationId, "second question");
    const firstUser = (await messages())[0]!;

    provider.script = reply("new answer");
    await service.editAndResend(firstUser.id, "edited question");
    const list = await messages();
    expect(list.map((m) => m.content)).toEqual(["edited question", "new answer"]);
    expect(provider.requests.at(-1)?.messages).toEqual([{ role: "user", parts: [{ type: "text", text: "edited question" }] }]);
  });

  it("stores provider errors (redacted) and excludes them from later history", async () => {
    provider.script = async function* () {
      yield { type: "text-delta", text: "partial" };
      throw new Error("HTTP 500 for key sk-abcdefghijklmnopqrstuv");
    };
    await expect(service.send(conversationId, "q")).rejects.toBeTruthy();
    const failed = (await messages()).at(-1)!;
    expect(failed.status).toBe("error");
    expect(failed.error).not.toContain("abcdefghijklmnop");

    provider.script = reply("ok");
    await service.send(conversationId, "again");
    const history = provider.requests.at(-1)!.messages;
    expect(history.map((m) => m.role)).toEqual(["user", "user"]);
  });

  it("fails fast with no_model and saves nothing", async () => {
    await ctx.repos.providers.update(providerId, { enabled: false });
    await expect(service.send(conversationId, "hello")).rejects.toMatchObject({ code: "no_model" });
    expect(await messages()).toEqual([]);
  });

  it("uses the conversation's model over the defaults", async () => {
    await ctx.repos.providers.update(providerId, {
      models: [
        ...(await ctx.repos.providers.get(providerId))!.models,
        {
          id: "fake-2",
          name: "Fake Two",
          enabled: true,
          contextWindow: null,
          capabilities: { vision: false, audio: false, video: false, tools: false, reasoning: false },
          inputCost: null,
          outputCost: null,
          source: "manual",
        },
      ],
    });
    await ctx.repos.conversations.update(conversationId, { providerId, modelId: "fake-2" });
    await service.send(conversationId, "q");
    expect(provider.requests.at(-1)?.model).toBe("fake-2");
  });

  it("applies the assistant system prompt with variables", async () => {
    await ctx.repos.settings.update({ userName: "Aboof" });
    const assistant = await ctx.repos.assistants.create({ name: "Helper", systemPrompt: "Help {{user_name}} using {{model}}.", temperature: 0.2 });
    await ctx.repos.conversations.update(conversationId, { assistantId: assistant.id });
    await service.send(conversationId, "q");
    expect(provider.requests.at(-1)).toMatchObject({ system: "Help Aboof using Fake One.", temperature: 0.2 });
  });

  describe("recovery after reload", () => {
    async function orphan(heartbeatAt: number | null) {
      return ctx.repos.messages.create({ conversationId, role: "assistant", content: "half", status: "streaming", heartbeatAt });
    }

    it("marks stale streams as interrupted (heartbeat fallback)", async () => {
      const stale = await orphan(0);
      const fresh = await orphan(Date.now() + 60_000);
      const svc = makeService({ clock: () => Date.now() + 60_000 + 1000 });
      expect(await svc.recoverInterrupted()).toBe(1);
      expect(await ctx.repos.messages.get(stale.id)).toMatchObject({ status: "interrupted", content: "half" });
      expect((await ctx.repos.messages.get(fresh.id))?.status).toBe("streaming");
    });

    it("with Web Locks, only streams whose lock is free are recovered", async () => {
      const mine = await orphan(Date.now());
      const theirs = await orphan(Date.now());
      const locks: StreamLocks = {
        acquire: async () => () => undefined,
        heldNames: async () => new Set([`nova-stream:${theirs.id}`]),
      };
      const svc = makeService({ locks });
      expect(await svc.recoverInterrupted()).toBe(1);
      expect((await ctx.repos.messages.get(mine.id))?.status).toBe("interrupted");
      expect((await ctx.repos.messages.get(theirs.id))?.status).toBe("streaming");
    });

    it("holds a lock while streaming and releases it afterwards", async () => {
      const released: string[] = [];
      const locks: StreamLocks = {
        acquire: async (name) => () => released.push(name),
        heldNames: async () => new Set(),
      };
      await makeService({ locks }).send(conversationId, "q");
      expect(released).toHaveLength(1);
      expect(released[0]).toMatch(/^nova-stream:/);
    });
  });
  describe("agent loop (tools)", () => {
    const calls: Record<string, unknown>[] = [];
    const echo: Tool = {
      name: "echo",
      description: "Echoes its input",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      permission: "auto",
      dangerous: false,
      source: "builtin",
      execute: async (args) => {
        calls.push(args);
        return { content: `echo:${String(args.text)}` };
      },
    };
    const guarded: Tool = { ...echo, name: "guarded", permission: "ask" };

    const toolService = (options: { approve?: "allow" | "deny"; slowTool?: boolean; maxSteps?: number } = {}) => {
      const registry = new ToolRegistry();
      const slow: Tool = {
        ...echo,
        name: "slow",
        execute: (_args, context) =>
          new Promise((_resolve, reject) => {
            const signal = context.signal;
            signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
          }),
      };
      registry.register(echo);
      registry.register(guarded);
      if (options.slowTool) registry.register(slow);
      const runner = new ToolRunner({ approve: async () => options.approve ?? "allow" });
      return makeService({
        tools: {
          resolve: async ({ settings }) => registry.resolve({ enabledTools: null, settings: { permissions: settings.tools?.permissions ?? {} } }),
          runner,
        },
      });
    };

    beforeEach(async () => {
      calls.length = 0;
      const current = await ctx.repos.providers.get(providerId);
      await ctx.repos.providers.update(providerId, {
        models: current!.models.map((m) => ({ ...m, capabilities: { ...m.capabilities, tools: true } })),
      });
    });

    it("runs a tool call, saves the tool message and continues to a final answer", async () => {
      provider = new FakeProvider(turns({ calls: [{ id: "c1", name: "echo", arguments: '{"text":"hi"}' }] }, { text: "Done: hi" }));
      await toolService().send(conversationId, "use the tool");
      const list = await messages();
      expect(list.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
      expect(list[1]?.finishReason).toBe("tool_calls");
      expect(list[2]?.parts[0]).toMatchObject({ type: "tool_result", toolCallId: "c1", content: "echo:hi", outcome: "ok" });
      expect(list[3]).toMatchObject({ content: "Done: hi", status: "complete" });
      expect(calls).toEqual([{ text: "hi" }]);
      expect(provider.requests[0]?.tools?.map((t) => t.name).sort()).toEqual(["echo", "guarded"]);
      expect(provider.requests[1]?.messages.at(-1)).toMatchObject({ role: "tool" });
    });

    it("records a denied result when the user rejects an approval", async () => {
      provider = new FakeProvider(turns({ calls: [{ id: "c1", name: "guarded", arguments: '{"text":"x"}' }] }, { text: "ok" }));
      await toolService({ approve: "deny" }).send(conversationId, "try");
      const list = await messages();
      expect(list[2]?.parts[0]).toMatchObject({ toolCallId: "c1", outcome: "denied", isError: true });
      expect(calls).toHaveLength(0);
    });

    it("forces a text answer on the last allowed step", async () => {
      await ctx.repos.settings.update({ tools: { ...(await ctx.repos.settings.get()).tools!, maxSteps: 1 } });
      provider = new FakeProvider(turns({ calls: [{ id: "c1", name: "echo", arguments: '{"text":"a"}' }] }, { text: "final" }));
      await toolService().send(conversationId, "go");
      expect(provider.requests).toHaveLength(2);
      expect(provider.requests[0]?.toolChoice).toBeUndefined();
      expect(provider.requests[1]?.toolChoice).toBe("none");
      expect((await messages()).at(-1)?.content).toBe("final");
    });

    it("saves cancelled results when stopped while a tool runs", async () => {
      provider = new FakeProvider(turns({ calls: [{ id: "c9", name: "slow", arguments: '{"text":"z"}' }] }, { text: "never" }));
      const svc = toolService({ slowTool: true });
      const pending = svc.send(conversationId, "slow please");
      await waitFor(() => provider.requests.length === 1 && svc.isStreaming(conversationId));
      await new Promise((r) => setTimeout(r, 20));
      svc.stop(conversationId);
      await pending;
      const list = await messages();
      const tool = list.find((m) => m.role === "tool");
      expect(tool?.parts[0]).toMatchObject({ toolCallId: "c9", outcome: "cancelled" });
      expect(provider.requests).toHaveLength(1);
    });

    it("regenerate restarts the whole tool chain after the user turn", async () => {
      provider = new FakeProvider(turns({ calls: [{ id: "c1", name: "echo", arguments: '{"text":"1"}' }] }, { text: "first" }));
      const svc = toolService();
      await svc.send(conversationId, "q");
      const last = (await messages()).at(-1)!;
      provider = new FakeProvider(reply("second"));
      await svc.regenerate(last.id);
      const list = await messages();
      expect(list.map((m) => [m.role, m.content])).toEqual([
        ["user", "q"],
        ["assistant", "second"],
      ]);
    });
  });
});
