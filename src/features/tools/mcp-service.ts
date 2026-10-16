import type { SecretVault } from "@/lib/crypto/vault";
import { audit } from "@/lib/audit";
import { McpClient } from "@/lib/mcp/client";
import {
  authorizationUrl,
  discover,
  exchangeCode,
  needsRefresh,
  pkceChallenge,
  randomString,
  refreshTokens,
  registerClient,
  resourceUri,
  savePending,
  takePending,
  type KeyValueStore,
  type OAuthTokens,
} from "@/lib/mcp/oauth";
import { McpError, contentToText, type McpToolDescriptor } from "@/lib/mcp/protocol";
import type { FetchLike } from "@/lib/mcp/transport";
import type { McpServer, McpServerCreateInput, McpToolInfo } from "@/lib/models";
import { logger } from "@/lib/logger";
import type { Repositories } from "@/lib/storage/types";
import { mcpToolName, type ToolRegistry } from "@/lib/tools/registry";
import type { JsonSchema, Tool } from "@/lib/tools/types";
import type { McpStatus } from "./mcp-status";

export interface McpServiceDeps {
  repos: Repositories;
  vault: Pick<SecretVault, "encrypt" | "decrypt">;
  registry: ToolRegistry;
  /** direct fetch, or the app proxy for servers without CORS. */
  fetchFor: (viaProxy: boolean) => FetchLike;
  setStatus: (serverId: string, status: McpStatus) => void;
  storage: () => KeyValueStore;
  redirectUri: () => string;
  onChange?: () => void;
  appVersion?: string;
}

const bearerId = (serverId: string) => `mcp:${serverId.toLowerCase()}`;
const oauthId = (serverId: string) => `mcp-oauth:${serverId.toLowerCase()}`;
const bearerContext = (serverId: string) => `nova:mcp:${serverId}`;
const oauthContext = (serverId: string) => `nova:mcp-oauth:${serverId}`;

export function toToolInfo(tool: McpToolDescriptor): McpToolInfo {
  return {
    name: tool.name.slice(0, 128),
    ...(tool.title || tool.annotations?.title ? { title: (tool.title ?? tool.annotations?.title ?? "").slice(0, 200) } : {}),
    description: (tool.description ?? "").slice(0, 10_000),
    inputSchema: tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : { type: "object", properties: {} },
    destructive: tool.annotations?.destructiveHint === true,
    readOnly: tool.annotations?.readOnlyHint === true,
  };
}

/**
 * Connects to MCP servers and exposes their tools in the registry as "<slug>__<tool>".
 * MCP tools default to "ask"; tools the server marks destructive are dangerous (always ask).
 * Tokens (Bearer / OAuth) are encrypted with the vault; headers in the server record are not secret.
 */
export class McpService {
  private readonly clients = new Map<string, McpClient>();
  private readonly connecting = new Map<string, Promise<McpClient>>();
  private readonly challenges = new Map<string, string | undefined>();

  constructor(private readonly deps: McpServiceDeps) {}

  // ----------------------------------------------------------------- secrets

  async setBearerToken(serverId: string, token: string): Promise<void> {
    if (!token.trim()) await this.deps.repos.secrets.delete(bearerId(serverId));
    else await this.deps.repos.secrets.set(bearerId(serverId), await this.deps.vault.encrypt(token.trim(), bearerContext(serverId)));
    audit(token.trim() ? "key_saved" : "key_removed", `MCP bearer token (${serverId})`);
  }

  hasBearerToken(serverId: string): Promise<boolean> {
    return this.deps.repos.secrets.has(bearerId(serverId));
  }

  hasOAuthTokens(serverId: string): Promise<boolean> {
    return this.deps.repos.secrets.has(oauthId(serverId));
  }

  private async loadTokens(serverId: string): Promise<OAuthTokens | null> {
    const stored = await this.deps.repos.secrets.get(oauthId(serverId));
    if (!stored) return null;
    try {
      return JSON.parse(await this.deps.vault.decrypt(stored, oauthContext(serverId))) as OAuthTokens;
    } catch {
      return null;
    }
  }

  private async saveTokens(serverId: string, tokens: OAuthTokens): Promise<void> {
    await this.deps.repos.secrets.set(oauthId(serverId), await this.deps.vault.encrypt(JSON.stringify(tokens), oauthContext(serverId)));
  }

  async signOut(serverId: string): Promise<void> {
    await this.deps.repos.secrets.delete(oauthId(serverId));
    await this.disconnect(serverId);
    this.deps.setStatus(serverId, { state: "needs_auth" });
  }

  private async authHeaders(server: McpServer): Promise<Record<string, string>> {
    const headers: Record<string, string> = { ...server.headers };
    if (server.auth === "bearer") {
      const stored = await this.deps.repos.secrets.get(bearerId(server.id));
      if (stored) headers.Authorization = `Bearer ${await this.deps.vault.decrypt(stored, bearerContext(server.id))}`;
    } else if (server.auth === "oauth") {
      let tokens = await this.loadTokens(server.id);
      if (!tokens) throw new McpError("unauthorized", "Sign in to this MCP server first");
      if (needsRefresh(tokens)) {
        tokens = await refreshTokens(tokens, this.deps.fetchFor(server.viaProxy));
        await this.saveTokens(server.id, tokens);
      }
      headers.Authorization = `Bearer ${tokens.accessToken}`;
    }
    return headers;
  }

  // ----------------------------------------------------------------- connections

  private buildClient(server: McpServer): McpClient {
    return new McpClient({
      url: server.url,
      transport: server.transport,
      fetch: this.deps.fetchFor(server.viaProxy),
      headers: () => this.authHeaders(server),
      clientInfo: { name: "Nova", version: this.deps.appVersion ?? "1.4.0" },
      onToolsChanged: () => void this.refreshTools(server.id).catch((error: unknown) => logger.warn("MCP tools refresh failed", error)),
    });
  }

  private async client(serverId: string, signal?: AbortSignal): Promise<McpClient> {
    const existing = this.clients.get(serverId);
    if (existing?.connected) return existing;
    const pending = this.connecting.get(serverId);
    if (pending) return pending;
    const promise = this.connect(serverId, signal).finally(() => this.connecting.delete(serverId));
    this.connecting.set(serverId, promise);
    return promise;
  }

  /** Connects, lists tools, caches them on the server record and registers them. */
  async connect(serverId: string, signal?: AbortSignal): Promise<McpClient> {
    const server = await this.deps.repos.mcpServers.get(serverId);
    if (!server) throw new McpError("not_connected", "Unknown MCP server");
    await this.clients.get(serverId)?.close();
    this.deps.setStatus(serverId, { state: "connecting" });
    const client = this.buildClient(server);
    try {
      const info = await client.connect(signal);
      const tools = (await client.listTools(signal)).map(toToolInfo);
      this.clients.set(serverId, client);
      const updated = await this.deps.repos.mcpServers.update(serverId, {
        tools,
        serverInfo: { name: info.serverInfo.name.slice(0, 200), version: String(info.serverInfo.version ?? "").slice(0, 100) },
        lastConnectedAt: Date.now(),
        lastError: null,
      });
      this.register(updated);
      this.deps.setStatus(serverId, { state: "connected", toolCount: tools.length });
      audit("mcp_connected", `${server.name} (${tools.length} tools)`);
      this.deps.onChange?.();
      return client;
    } catch (error) {
      await client.close();
      const unauthorized = error instanceof McpError && error.code === "unauthorized";
      if (unauthorized) this.challenges.set(serverId, error.authenticate);
      const message = error instanceof Error ? error.message.slice(0, 1000) : "Connection failed";
      await this.deps.repos.mcpServers.update(serverId, { lastError: message }).catch(() => undefined);
      this.deps.setStatus(serverId, unauthorized && server.auth !== "bearer" ? { state: "needs_auth", error: message } : { state: "error", error: message });
      this.deps.onChange?.();
      throw error;
    }
  }

  async disconnect(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    this.clients.delete(serverId);
    await client?.close();
    this.deps.setStatus(serverId, { state: "idle" });
  }

  async refreshTools(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (!client?.connected) return;
    const tools = (await client.listTools()).map(toToolInfo);
    const updated = await this.deps.repos.mcpServers.update(serverId, { tools });
    this.register(updated);
    this.deps.setStatus(serverId, { state: "connected", toolCount: tools.length });
    this.deps.onChange?.();
  }

  /** Registers cached tools of every enabled server (offline-safe) and connects in the background. */
  async start(): Promise<void> {
    const servers = await this.deps.repos.mcpServers.list();
    for (const server of servers) {
      if (!server.enabled) continue;
      this.register(server);
      void this.client(server.id).catch(() => undefined);
    }
  }

  /** Tool definitions for one server (enabled, not user-disabled). */
  register(server: McpServer): void {
    if (!server.enabled) {
      this.deps.registry.replaceServerTools(server.id, []);
      return;
    }
    const tools: Tool[] = server.tools
      .filter((t) => !server.disabledTools.includes(t.name))
      .map((info) => ({
        name: mcpToolName(server.slug, info.name),
        title: info.title ?? info.name,
        description: `[${server.name}] ${info.description || info.title || info.name}`,
        inputSchema: info.inputSchema as JsonSchema,
        permission: "ask",
        dangerous: info.destructive,
        source: "mcp",
        serverId: server.id,
        execute: async (args, context) => {
          const run = async () => {
            const client = await this.client(server.id, context.signal);
            return client.callTool(info.name, args, { signal: context.signal, timeoutMs: 120_000 });
          };
          let result;
          try {
            result = await run();
          } catch (error) {
            // Expired session: reconnect once.
            if (error instanceof McpError && error.code === "protocol" && /session/i.test(error.message)) {
              this.clients.delete(server.id);
              result = await run();
            } else throw error;
          }
          return { content: contentToText(result), isError: Boolean(result.isError), display: { kind: "text" } };
        },
      }));
    this.deps.registry.replaceServerTools(server.id, tools);
  }

  // ----------------------------------------------------------------- CRUD

  async create(input: McpServerCreateInput, secret?: string): Promise<McpServer> {
    const server = await this.deps.repos.mcpServers.create(input);
    if (secret && server.auth === "bearer") await this.setBearerToken(server.id, secret);
    this.deps.onChange?.();
    return server;
  }

  async update(serverId: string, patch: Parameters<Repositories["mcpServers"]["update"]>[1], secret?: string): Promise<McpServer> {
    const server = await this.deps.repos.mcpServers.update(serverId, patch);
    if (secret !== undefined && server.auth === "bearer") await this.setBearerToken(serverId, secret);
    await this.disconnect(serverId);
    this.register(server);
    if (server.enabled) void this.client(serverId).catch(() => undefined);
    this.deps.onChange?.();
    return server;
  }

  async remove(serverId: string): Promise<void> {
    await this.disconnect(serverId);
    this.deps.registry.replaceServerTools(serverId, []);
    await this.deps.repos.secrets.delete(bearerId(serverId));
    await this.deps.repos.secrets.delete(oauthId(serverId));
    await this.deps.repos.mcpServers.delete(serverId);
    audit("mcp_removed", serverId);
    this.deps.onChange?.();
  }

  /** Checks a configuration without saving it (form "Test" button; bearer token in memory only). */
  async test(input: { url: string; transport: McpServer["transport"]; headers: Record<string, string>; viaProxy: boolean; bearer?: string }): Promise<{ name: string; version: string; tools: McpToolInfo[] }> {
    const client = new McpClient({
      url: input.url,
      transport: input.transport,
      fetch: this.deps.fetchFor(input.viaProxy),
      headers: async () => ({ ...input.headers, ...(input.bearer ? { Authorization: `Bearer ${input.bearer}` } : {}) }),
    });
    try {
      const info = await client.connect();
      const tools = (await client.listTools()).map(toToolInfo);
      return { name: info.serverInfo.name, version: String(info.serverInfo.version ?? ""), tools };
    } finally {
      await client.close();
    }
  }

  // ----------------------------------------------------------------- OAuth

  /** Prepares the authorization request and returns the URL to open. */
  async startAuthorization(serverId: string): Promise<string> {
    const server = await this.deps.repos.mcpServers.get(serverId);
    if (!server) throw new McpError("not_connected", "Unknown MCP server");
    const fetchFn = this.deps.fetchFor(server.viaProxy);
    const meta = await discover(server.url, fetchFn, this.challenges.get(serverId));
    const redirectUri = this.deps.redirectUri();
    let clientId = server.oauthClientId;
    if (!clientId) {
      clientId = await registerClient(meta, redirectUri, fetchFn);
      await this.deps.repos.mcpServers.update(serverId, { oauthClientId: clientId });
    }
    const verifier = randomString(48);
    const state = randomString(24);
    const resource = resourceUri(server.url);
    savePending(this.deps.storage(), { serverId, state, verifier, redirectUri, clientId, tokenEndpoint: meta.token_endpoint, resource, createdAt: Date.now() });
    return authorizationUrl({ meta, clientId, redirectUri, challenge: await pkceChallenge(verifier), state, resource });
  }

  /** Handles /oauth/callback (or the app deep link). Returns the server id. */
  async completeAuthorization(callbackUrl: string): Promise<string> {
    const url = new URL(callbackUrl);
    const state = url.searchParams.get("state") ?? "";
    const pending = takePending(this.deps.storage(), state);
    if (!pending) throw new McpError("protocol", "Unknown or expired sign-in attempt. Start again.");
    const error = url.searchParams.get("error");
    if (error) throw new McpError("unauthorized", url.searchParams.get("error_description") ?? error);
    const code = url.searchParams.get("code");
    if (!code) throw new McpError("protocol", "The authorization server returned no code");
    const server = await this.deps.repos.mcpServers.get(pending.serverId);
    if (!server) throw new McpError("not_connected", "Unknown MCP server");
    const tokens = await exchangeCode(pending, code, this.deps.fetchFor(server.viaProxy));
    await this.saveTokens(server.id, tokens);
    audit("mcp_signed_in", server.name);
    await this.connect(server.id).catch(() => undefined);
    return server.id;
  }
}
