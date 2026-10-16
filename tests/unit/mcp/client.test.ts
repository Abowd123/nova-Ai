import { describe, expect, it } from "vitest";
import { McpClient } from "@/lib/mcp/client";
import { McpError, contentToText, type JsonRpcRequest } from "@/lib/mcp/protocol";

type Handler = (message: JsonRpcRequest) => unknown;

/** Fake Streamable HTTP server. `sse` answers as text/event-stream (with a notification first). */
function streamableServer(handlers: Record<string, Handler>, options: { sse?: boolean; status?: number } = {}) {
  const requests: { method: string; headers: Record<string, string>; body: JsonRpcRequest | null }[] = [];
  const fetch = async (_url: string, init: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = init.body ? (JSON.parse(String(init.body)) as JsonRpcRequest) : null;
    requests.push({ method: init.method ?? "GET", headers, body });
    if (options.status) return new Response("nope", { status: options.status, headers: { "www-authenticate": 'Bearer resource_metadata="https://mcp.test/.well-known/oauth-protected-resource"' } });
    if (init.method === "GET") return new Response(null, { status: 405 });
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    if (!body || !("id" in body)) return new Response(null, { status: 202 });
    const handler = handlers[body.method];
    const reply = handler ? { jsonrpc: "2.0", id: body.id, result: handler(body) } : { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "no" } };
    const sessionHeaders: Record<string, string> = body.method === "initialize" ? { "mcp-session-id": "sess-1" } : {};
    if (options.sse) {
      const note = { jsonrpc: "2.0", method: "notifications/tools/list_changed" };
      return new Response(`event: message\ndata: ${JSON.stringify(note)}\n\nevent: message\ndata: ${JSON.stringify(reply)}\n\n`, { headers: { "content-type": "text/event-stream", ...sessionHeaders } });
    }
    return new Response(JSON.stringify(reply), { headers: { "content-type": "application/json", ...sessionHeaders } });
  };
  return { fetch, requests };
}

const initialize = () => ({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1.0" } });

describe("McpClient (Streamable HTTP)", () => {
  it("initializes, keeps the session, lists tools with pagination and calls a tool", async () => {
    let page = 0;
    const server = streamableServer({
      initialize,
      "tools/list": () => (page++ === 0 ? { tools: [{ name: "a", inputSchema: { type: "object" } }], nextCursor: "c2" } : { tools: [{ name: "b", annotations: { destructiveHint: true } }] }),
      "tools/call": (m) => ({ content: [{ type: "text", text: `called ${String((m.params as { name: string }).name)}` }] }),
    });
    const client = new McpClient({ url: "https://mcp.test/mcp", transport: "streamable-http", fetch: server.fetch, headers: async () => ({ Authorization: "Bearer t" }) });
    const info = await client.connect();
    expect(info.serverInfo.name).toBe("fake");
    expect((await client.listTools()).map((t) => t.name)).toEqual(["a", "b"]);
    const result = await client.callTool("a", { x: 1 });
    expect(contentToText(result)).toBe("called a");
    const init = server.requests[0]!;
    expect(init.body?.params).toMatchObject({ protocolVersion: "2025-06-18", clientInfo: { name: "Nova" } });
    expect(init.headers.accept).toBe("application/json, text/event-stream");
    expect(init.headers.authorization).toBe("Bearer t");
    expect(server.requests[1]!.body).toEqual({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(server.requests[2]!.headers["mcp-session-id"]).toBe("sess-1");
    expect(server.requests[3]!.body?.params).toEqual({ cursor: "c2" });
    await client.close();
    expect(server.requests.at(-1)!.method).toBe("DELETE");
  });

  it("reads SSE responses and dispatches list_changed notifications", async () => {
    const server = streamableServer({ initialize, "tools/list": () => ({ tools: [] }) }, { sse: true });
    let changed = 0;
    const client = new McpClient({ url: "https://mcp.test/mcp", transport: "streamable-http", fetch: server.fetch, headers: async () => ({}), onToolsChanged: () => changed++ });
    await client.connect();
    await client.listTools();
    expect(changed).toBe(2);
  });

  it("surfaces 401 with the WWW-Authenticate challenge and JSON-RPC errors", async () => {
    const unauthorized = streamableServer({}, { status: 401 });
    let error: McpError | null = null;
    try {
      await new McpClient({ url: "https://mcp.test/mcp", transport: "streamable-http", fetch: unauthorized.fetch, headers: async () => ({}) }).connect();
    } catch (e) {
      error = e as McpError;
    }
    expect(error?.code).toBe("unauthorized");
    expect(error?.authenticate).toContain("resource_metadata");

    const server = streamableServer({ initialize });
    const client = new McpClient({ url: "https://mcp.test/mcp", transport: "streamable-http", fetch: server.fetch, headers: async () => ({}) });
    await client.connect();
    let rpc: McpError | null = null;
    try {
      await client.callTool("missing", {});
    } catch (e) {
      rpc = e as McpError;
    }
    expect(rpc?.code).toBe("server");
  });

  it("rejects unknown protocol versions", async () => {
    const server = streamableServer({ initialize: () => ({ ...initialize(), protocolVersion: "1999-01-01" }) });
    let error: McpError | null = null;
    try {
      await new McpClient({ url: "https://mcp.test/mcp", transport: "streamable-http", fetch: server.fetch, headers: async () => ({}) }).connect();
    } catch (e) {
      error = e as McpError;
    }
    expect(error?.code).toBe("protocol");
  });
});

describe("McpClient (legacy SSE)", () => {
  it("discovers the endpoint and receives answers on the stream", async () => {
    let push: ((text: string) => void) | null = null;
    const posts: JsonRpcRequest[] = [];
    const fetch = async (url: string, init: RequestInit) => {
      if (init.method === "GET") {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            push = (text) => controller.enqueue(encoder.encode(text));
            push("event: endpoint\ndata: /messages?session=1\n\n");
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream" } });
      }
      expect(url).toBe("https://mcp.test/messages?session=1");
      const body = JSON.parse(String(init.body)) as JsonRpcRequest;
      posts.push(body);
      if ("id" in body) {
        const result = body.method === "initialize" ? { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "old", version: "0.1" } } : { tools: [{ name: "t" }] };
        setTimeout(() => push?.(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n`), 1);
      }
      return new Response(null, { status: 202 });
    };
    const client = new McpClient({ url: "https://mcp.test/sse", transport: "sse", fetch, headers: async () => ({}) });
    expect((await client.connect()).serverInfo.name).toBe("old");
    expect((await client.listTools()).map((t) => t.name)).toEqual(["t"]);
    expect(posts.map((p) => p.method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    await client.close();
  });
});

describe("contentToText", () => {
  it("flattens mixed content", () => {
    expect(
      contentToText({
        content: [
          { type: "text", text: "a" },
          { type: "image", data: "AAAA", mimeType: "image/png" },
          { type: "resource_link", uri: "file:///x", name: "x" },
        ],
      }),
    ).toBe("a\n\n[image image/png, 0 KB]\n\n[resource] x: file:///x");
    expect(contentToText({ structuredContent: { ok: true } })).toBe('{"ok":true}');
  });
});
