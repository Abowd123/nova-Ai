import {
  mcpServerCreateSchema,
  mcpServerSchema,
  mcpServerUpdateSchema,
  usageKindSchema,
  usageRecordSchema,
  type McpServer,
  type UsageRecord,
} from "@/lib/models";
import { StorageError, notFound, withStorageErrors } from "../../errors";
import type { McpServerRepository, RepositoryDeps, UsageRepository, UsageTotals } from "../../types";
import type { NovaDatabase } from "../database";
import { parseOrThrow, parseRecords } from "../utils";

export function createMcpServerRepository(db: NovaDatabase, deps: RepositoryDeps): McpServerRepository {
  const ensureUniqueSlug = async (slug: string, selfId?: string) => {
    const clash = await db.mcpServers.where("slug").equals(slug).first();
    if (clash && clash.id !== selfId) throw new StorageError("CONSTRAINT", `An MCP server named "${slug}" already exists`);
  };
  return {
    list: () => withStorageErrors(async () => parseRecords(mcpServerSchema, await db.mcpServers.toArray(), "MCP server").sort((a, b) => a.name.localeCompare(b.name))),
    get: (id) =>
      withStorageErrors(async () => {
        const row = await db.mcpServers.get(id);
        return row ? parseOrThrow(mcpServerSchema, row, "MCP server") : undefined;
      }),
    create: (input) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(mcpServerCreateSchema, input, "MCP server input");
        const now = deps.clock();
        const record: McpServer = parseOrThrow(
          mcpServerSchema,
          {
            id: deps.idGenerator(),
            name: data.name,
            slug: data.slug,
            url: data.url,
            transport: data.transport ?? "streamable-http",
            auth: data.auth ?? "none",
            headers: data.headers ?? {},
            enabled: data.enabled ?? true,
            disabledTools: [],
            tools: [],
            oauthClientId: null,
            viaProxy: data.viaProxy ?? false,
            lastConnectedAt: null,
            lastError: null,
            serverInfo: null,
            createdAt: now,
            updatedAt: now,
          },
          "MCP server",
        );
        await db.transaction("rw", db.mcpServers, async () => {
          await ensureUniqueSlug(record.slug);
          await db.mcpServers.add(record);
        });
        return record;
      }),
    update: (id, patch) =>
      withStorageErrors(async () => {
        const data = parseOrThrow(mcpServerUpdateSchema, patch, "MCP server patch");
        return db.transaction("rw", db.mcpServers, async () => {
          const existing = await db.mcpServers.get(id);
          if (!existing) throw notFound("MCP server", id);
          if (data.slug && data.slug !== existing.slug) await ensureUniqueSlug(data.slug, id);
          const next = parseOrThrow(mcpServerSchema, { ...existing, ...data, updatedAt: deps.clock() }, "MCP server");
          await db.mcpServers.put(next);
          return next;
        });
      }),
    delete: (id) =>
      withStorageErrors(async () => {
        await db.mcpServers.delete(id);
      }),
  };
}

export function createUsageRepository(db: NovaDatabase, deps: RepositoryDeps): UsageRepository {
  return {
    add: (input) =>
      withStorageErrors(async () => {
        const record: UsageRecord = parseOrThrow(usageRecordSchema, { ...input, id: deps.idGenerator(), createdAt: deps.clock() }, "usage record");
        await db.usageRecords.add(record);
        return record;
      }),
    list: (options = {}) =>
      withStorageErrors(async () => {
        const rows = await db.usageRecords.where("createdAt").aboveOrEqual(options.since ?? 0).reverse().limit(options.limit ?? 500).toArray();
        return parseRecords(usageRecordSchema, rows, "usage record");
      }),
    totals: (since = 0) =>
      withStorageErrors(async () => {
        const rows = await db.usageRecords.where("createdAt").aboveOrEqual(since).toArray();
        const byKind = new Map<string, UsageTotals>();
        for (const row of rows) {
          const kind = usageKindSchema.safeParse(row.kind);
          if (!kind.success) continue;
          const total = byKind.get(kind.data) ?? { kind: kind.data, inputTokens: 0, outputTokens: 0, cost: 0, unpriced: 0, count: 0 };
          total.inputTokens += row.inputTokens;
          total.outputTokens += row.outputTokens;
          if (row.cost === null) total.unpriced += 1;
          else total.cost += row.cost;
          total.count += 1;
          byKind.set(kind.data, total);
        }
        return [...byKind.values()].sort((a, b) => a.kind.localeCompare(b.kind));
      }),
    clear: () =>
      withStorageErrors(async () => {
        await db.usageRecords.clear();
      }),
  };
}
