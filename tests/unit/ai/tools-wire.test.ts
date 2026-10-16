// @vitest-environment node
import { describe, expect, it } from "vitest";
import { collect, recordingHttp, sse, streamOf } from "@tests/helpers/streams";
import { createProvider } from "@/lib/ai/factory";
import type { ChatRequest, ProviderConfig } from "@/lib/ai/types";

const base: Omit<ProviderConfig, "kind" | "baseUrl"> = { id: "p1", name: "T", apiKey: "sk-test-key-1234567890", transport: "direct" };
const tools: ChatRequest["tools"] = [
  { name: "web_search", description: "Search", parameters: { type: "object", properties: { query: { type: ["string", "null"] } }, required: ["query"], additionalProperties: false } },
];
const history: ChatRequest["messages"] = [
  { role: "user", parts: [{ type: "text", text: "weather?" }] },
  { role: "assistant", parts: [{ type: "tool_call", id: "call_1", name: "web_search", arguments: '{"query":"aden"}', signature: "sig" }] },
  { role: "tool", parts: [{ type: "tool_result", toolCallId: "call_1", name: "web_search", content: "sunny", display: { kind: "search" } }] },
];

async function body(kind: ProviderConfig["kind"], baseUrl: string, toolChoice?: ChatRequest["toolChoice"]) {
  const { http, requests } = recordingHttp([() => new Response(streamOf([sse([{ data: "[DONE]" }])]))]);
  await collect(createProvider({ ...base, kind, baseUrl }, http).streamChat({ model: "m", messages: history, tools, toolChoice })).catch(() => undefined);
  return requests[0]!.body as Record<string, any>;
}

describe("tool calling on the wire", () => {
  it("OpenAI: function tools, tool_calls and tool messages", async () => {
    const b = await body("openai", "https://api.openai.com/v1", "none");
    expect(b.tools).toEqual([{ type: "function", function: { name: "web_search", description: "Search", parameters: tools![0]!.parameters } }]);
    expect(b.tool_choice).toBe("none");
    expect(b.messages[1]).toMatchObject({ role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "web_search", arguments: '{"query":"aden"}' } }] });
    expect(b.messages[2]).toEqual({ role: "tool", tool_call_id: "call_1", content: "sunny" });
  });

  it("Anthropic: input_schema, tool_use/tool_result blocks, cached tools", async () => {
    const { http, requests } = recordingHttp([() => new Response(streamOf([sse([{ event: "message_stop", data: { type: "message_stop" } }])]))]);
    await collect(createProvider({ ...base, kind: "anthropic", baseUrl: "https://api.anthropic.com/v1" }, http).streamChat({ model: "m", messages: history, tools, toolChoice: "required", promptCache: true })).catch(() => undefined);
    const b = requests[0]!.body as Record<string, any>;
    expect(b.tools[0]).toMatchObject({ name: "web_search", input_schema: { type: "object" }, cache_control: { type: "ephemeral" } });
    expect(b.tool_choice).toEqual({ type: "any" });
    expect(b.messages[1].content[0]).toEqual({ type: "tool_use", id: "call_1", name: "web_search", input: { query: "aden" } });
    expect(b.messages[2]).toMatchObject({ role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "sunny" }] });
  });

  it("Gemini: functionDeclarations with converted schema, thought signatures replayed", async () => {
    const b = await body("gemini", "https://generativelanguage.googleapis.com/v1beta");
    expect(b.tools).toEqual([{ functionDeclarations: [{ name: "web_search", description: "Search", parameters: { type: "OBJECT", properties: { query: { type: "STRING", nullable: true } }, required: ["query"] } }] }]);
    expect(b.toolConfig).toEqual({ functionCallingConfig: { mode: "AUTO" } });
    expect(b.contents[1].parts[0]).toEqual({ functionCall: { name: "web_search", args: { query: "aden" } }, thoughtSignature: "sig" });
    expect(b.contents[2].parts[0]).toEqual({ functionResponse: { name: "web_search", response: { content: "sunny" } } });
  });

  it("Ollama: tools omitted on the forced-answer step", async () => {
    const withTools = await body("ollama", "http://localhost:11434");
    expect(withTools.tools[0].function.name).toBe("web_search");
    const last = await body("ollama", "http://localhost:11434", "none");
    expect(last.tools).toBeUndefined();
  });
});
