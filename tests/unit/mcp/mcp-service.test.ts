import { describe, expect, it } from "vitest";
import { McpService } from "@/features/tools/mcp-service";
import type { McpStatus } from "@/features/tools/mcp-status";
import type { EncryptedSecret, McpServer } from "@/lib/models";
import type { Repositories } from "@/lib/storage/types";
import { ToolRegistry } from "@/lib/tools/registry";

function fakeRepos(server: McpServer) {
  const servers = new Map([[server.id, server]]);
  const secrets = new Map<string, EncryptedSecret>();
  return {
    secrets,
    repos: {
      mcpServers: {
        list: async () => [...servers.values()],
        get: async (id: string) => servers.get(id),
        update: async (id: string, patch: Partial<McpServer>) => {
          const next = { ...servers.get(id)!, ...patch };
          servers.set(id, next);
          return next;
        },
        delete: async (id: string) => void servers.delete(id),
        create: async () => server,
      },
      secrets: {
        get: async (id: string) => secrets.get(id),
        set: async (id: string, v: EncryptedSecret) => void secrets.set(id, v),
        delete: async (id: string) => void secrets.delete(id),
        has: async (id: string) => secrets.has(id),
      },
    } as unknown as Repositories,
  };
}

const vault = {
  encrypt: async (text: string, ctx: string) => ({ algorithm: "AES-GCM" as const, keyId: "k", iv: ctx, ciphertext: btoa(unescape(encodeURIComponent(text))) }),
  decrypt: async (s: EncryptedSecret) => decodeURIComponent(escape(atob(s.ciphertext))),
};

const server: McpServer = {
  id: "srv-1",
  name: "Files",
  slug: "files",
  url: "https://mcp.test/mcp",
  transport: "streamable-http",
  auth: "bearer",
  headers: { "X-Team": "nova" },
  enabled: true,
  disabledTools: ["hidden"],
  tools: [],
  oauthClientId: null,
  viaProxy: false,
  lastConnectedAt: null,
  lastError: null,
  serverInfo: null,
  createdAt: 1,
  updatedAt: 1,
};

function mcpServerFetch(seenAuth: string[]) {
  return async (_url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    seenAuth.push(headers.get("authorization") ?? "");
    if (init.method !== "POST") return new Response(null, { status: 405 });
    const body = JSON.parse(String(init.body));
    if (!("id" in body)) return new Response(null, { status: 202 });
    const results: Record<string, unknown> = {
      initialize: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "files-server", version: "2.0" } },
      "tools/list": {
        tools: [
          { name: "read", description: "Read a file", inputSchema: { type: "object", properties: { path: { type: "string" } } }, annotations: { readOnlyHint: true } },
          { name: "delete", description: "Delete a file", annotations: { destructiveHint: true } },
          { name: "hidden", description: "x" },
        ],
      },
      "tools/call": { content: [{ type: "text", text: `ran ${body.params?.name}` }] },
    };
    return Response.json({ jsonrpc: "2.0", id: body.id, result: results[body.method] });
  };
}

describe("McpService", () => {
  it("connects with the encrypted bearer token and registers server__tool tools", async () => {
    const { repos, secrets } = fakeRepos(server);
    const registry = new ToolRegistry();
    const statuses: McpStatus[] = [];
    const seenAuth: string[] = [];
    const service = new McpService({
      repos,
      vault,
      registry,
      fetchFor: () => mcpServerFetch(seenAuth),
      setStatus: (_id, s) => statuses.push(s),
      storage: () => ({ getItem: () => null, setItem() {}, removeItem() {} }),
      redirectUri: () => "https://app.test/oauth/callback",
    });
    await service.setBearerToken(server.id, "secret-token");
    expect([...secrets.keys()]).toEqual(["mcp:srv-1"]);
    expect(secrets.get("mcp:srv-1")!.ciphertext).not.toContain("secret-token");
    await service.connect(server.id);
    expect(seenAuth[0]).toBe("Bearer secret-token");
    expect(statuses.at(-1)).toEqual({ state: "connected", toolCount: 3 });
    const names = registry.list().map((t) => [t.name, t.permission, t.dangerous]);
    expect(names).toEqual([
      ["files__delete", "ask", true],
      ["files__read", "ask", false],
    ]);
    const read = registry.get("files__read")!;
    expect(read.description).toBe("[Files] Read a file");
    expect((await read.execute({ path: "/a" }, { signal: new AbortController().signal, conversationId: "c", assistantId: null })).content).toBe("ran read");
    expect((await repos.mcpServers.get(server.id))!.serverInfo).toEqual({ name: "files-server", version: "2.0" });
  });

  it("marks OAuth servers without tokens as needing sign-in and builds the authorize URL", async () => {
    const oauthServer = { ...server, auth: "oauth" as const };
    const { repos } = fakeRepos(oauthServer);
    const statuses: McpStatus[] = [];
    const store = new Map<string, string>();
    const service = new McpService({
      repos,
      vault,
      registry: new ToolRegistry(),
      fetchFor: () => async (url: string, init: RequestInit) => {
        if (url.endsWith("/register")) return Response.json({ client_id: "dyn-client" });
        if (init.method === "POST") return mcpServerFetch([])(url, init);
        return new Response("", { status: 404 });
      },
      setStatus: (_id, s) => statuses.push(s),
      storage: () => ({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) }),
      redirectUri: () => "https://app.test/oauth/callback",
    });
    let failed = false;
    await service.connect(oauthServer.id).catch(() => (failed = true));
    expect(failed).toBe(true);
    expect(statuses.at(-1)?.state).toBe("needs_auth");
    const url = new URL(await service.startAuthorization(oauthServer.id));
    expect(url.origin + url.pathname).toBe("https://mcp.test/authorize");
    expect(url.searchParams.get("client_id")).toBe("dyn-client");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect((await repos.mcpServers.get(oauthServer.id))!.oauthClientId).toBe("dyn-client");
    let error = "";
    await service.completeAuthorization("https://app.test/oauth/callback?state=forged&code=x").catch((e: Error) => (error = e.message));
    expect(error).toContain("expired");
  });
});
