import { z } from "zod";
import { idSchema, timestampSchema } from "./common";

/** auto = run without asking, ask = user approves each call, disabled = never offered to the model. */
export const toolPermissionSchema = z.enum(["auto", "ask", "disabled"]);
export type ToolPermission = z.infer<typeof toolPermissionSchema>;

export const searchProviderKindSchema = z.enum(["tavily", "brave", "exa", "searxng"]);
export type SearchProviderKind = z.infer<typeof searchProviderKindSchema>;

const toolNameSchema = z.string().min(1).max(128);
const hostSchema = z.string().trim().toLowerCase().min(1).max(253).regex(/^[a-z0-9.*-]+$/, "Invalid host");

export const toolSettingsSchema = z
  .object({
    /** Per-tool override of the tool's default permission (built-in and MCP "server__tool"). */
    permissions: z.record(toolNameSchema, toolPermissionSchema),
    /** Max model ↔ tool round trips per reply. */
    maxSteps: z.number().int().min(1).max(50),
    /** Per tool call. */
    timeoutSec: z.number().int().min(5).max(900),
    /** Run independent calls of one step concurrently. */
    parallel: z.boolean(),
    js: z
      .object({
        timeoutMs: z.number().int().min(100).max(120_000),
        /** Network APIs stay blocked unless the user opts in. */
        allowNetwork: z.boolean(),
        maxOutputChars: z.number().int().min(1000).max(1_000_000),
        /** Soft heap cap checked while running (Chromium only); the timeout is the hard stop. */
        memoryLimitMb: z.number().int().min(16).max(4096),
      })
      .strict(),
    python: z
      .object({
        enabled: z.boolean(),
        /** Pyodide distribution (downloaded on first use, then cached by the browser). */
        indexUrl: z.string().url().max(500),
        timeoutMs: z.number().int().min(1000).max(600_000),
        maxOutputChars: z.number().int().min(1000).max(1_000_000),
      })
      .strict(),
    search: z
      .object({
        provider: searchProviderKindSchema.nullable(),
        searxngUrl: z.string().max(500),
        count: z.number().int().min(1).max(20),
        language: z.string().max(10),
        region: z.string().max(10),
        excludeSites: z.array(hostSchema).max(100),
        /** fetch_url refuses these hosts (and their subdomains). */
        blockedSites: z.array(hostSchema).max(500),
        /** Characters of page text returned by fetch_url. */
        maxContentChars: z.number().int().min(500).max(200_000),
        /** Summarize long pages with the sub-agent model before returning them. */
        summarizeResults: z.boolean(),
      })
      .strict(),
    subagent: z
      .object({
        providerId: idSchema.nullable(),
        modelId: z.string().min(1).max(256).nullable(),
        maxTokens: z.number().int().min(64).max(32_000),
        maxSteps: z.number().int().min(1).max(20),
        /** Use the cheap model for chat titles too. */
        useForTitles: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type ToolSettings = z.infer<typeof toolSettingsSchema>;

export const DEFAULT_PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  permissions: {},
  maxSteps: 8,
  timeoutSec: 60,
  parallel: true,
  js: { timeoutMs: 10_000, allowNetwork: false, maxOutputChars: 20_000, memoryLimitMb: 256 },
  python: { enabled: true, indexUrl: DEFAULT_PYODIDE_URL, timeoutMs: 60_000, maxOutputChars: 20_000 },
  search: { provider: null, searxngUrl: "", count: 5, language: "", region: "", excludeSites: [], blockedSites: [], maxContentChars: 12_000, summarizeResults: false },
  subagent: { providerId: null, modelId: null, maxTokens: 2048, maxSteps: 4, useForTitles: false },
};

// ------------------------------------------------------------------ MCP servers

export const mcpTransportSchema = z.enum(["streamable-http", "sse"]);
export type McpTransport = z.infer<typeof mcpTransportSchema>;
export const mcpAuthSchema = z.enum(["none", "bearer", "oauth"]);
export type McpAuth = z.infer<typeof mcpAuthSchema>;

export const mcpToolInfoSchema = z.object({
  name: z.string().min(1).max(128),
  title: z.string().max(200).optional(),
  description: z.string().max(10_000),
  inputSchema: z.record(z.string(), z.unknown()),
  /** MCP annotations.destructiveHint / readOnlyHint. */
  destructive: z.boolean(),
  readOnly: z.boolean(),
});
export type McpToolInfo = z.infer<typeof mcpToolInfoSchema>;

/** Server name used as the tool prefix: server__tool. */
export const mcpSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/, "Use a-z, 0-9, - and _ (max 32)");

export const mcpServerSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(100),
  slug: mcpSlugSchema,
  url: z.string().url().max(2000),
  transport: mcpTransportSchema,
  auth: mcpAuthSchema,
  /** Non-secret extra headers. Bearer tokens / OAuth tokens live encrypted in secrets. */
  headers: z.record(z.string().min(1).max(100), z.string().max(2000)),
  enabled: z.boolean(),
  /** Tools the user turned off. */
  disabledTools: z.array(z.string().min(1).max(128)).max(500),
  /** Last tools/list result (offline display + registration before reconnect). */
  tools: z.array(mcpToolInfoSchema).max(500),
  /** OAuth client registration (public client, no secret). */
  oauthClientId: z.string().max(500).nullable(),
  /** Use the app proxy (servers without CORS). */
  viaProxy: z.boolean(),
  lastConnectedAt: timestampSchema.nullable(),
  lastError: z.string().max(1000).nullable(),
  serverInfo: z.object({ name: z.string().max(200), version: z.string().max(100) }).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type McpServer = z.infer<typeof mcpServerSchema>;

export const mcpServerCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    slug: mcpSlugSchema,
    url: z.string().url().max(2000),
    transport: mcpTransportSchema.optional(),
    auth: mcpAuthSchema.optional(),
    headers: z.record(z.string().min(1).max(100), z.string().max(2000)).optional(),
    enabled: z.boolean().optional(),
    viaProxy: z.boolean().optional(),
  })
  .strict();
export type McpServerCreateInput = z.input<typeof mcpServerCreateSchema>;

export const mcpServerUpdateSchema = mcpServerSchema
  .pick({
    name: true,
    slug: true,
    url: true,
    transport: true,
    auth: true,
    headers: true,
    enabled: true,
    disabledTools: true,
    tools: true,
    oauthClientId: true,
    viaProxy: true,
    lastConnectedAt: true,
    lastError: true,
    serverInfo: true,
  })
  .partial()
  .strict();
export type McpServerUpdateInput = z.input<typeof mcpServerUpdateSchema>;

/** Separator between server slug and tool name (OpenAI allows ^[a-zA-Z0-9_-]{1,64}$). */
export const MCP_TOOL_SEPARATOR = "__";

// ------------------------------------------------------------------ Usage (cost tracking)

export const usageKindSchema = z.enum(["chat", "subagent", "title", "summary", "search_summary", "embedding"]);
export type UsageKind = z.infer<typeof usageKindSchema>;

export const usageRecordSchema = z.object({
  id: idSchema,
  kind: usageKindSchema,
  providerId: idSchema,
  modelId: z.string().min(1).max(256),
  conversationId: idSchema.nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** USD, from the model's prices when known. */
  cost: z.number().nonnegative().nullable(),
  createdAt: timestampSchema,
});
export type UsageRecord = z.infer<typeof usageRecordSchema>;
export type UsageRecordInput = Omit<UsageRecord, "id" | "createdAt">;
