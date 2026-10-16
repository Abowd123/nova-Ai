import { MCP_TOOL_SEPARATOR, type ToolPermission, type ToolSettings } from "@/lib/models";
import type { ToolSpec } from "@/lib/ai/types";
import { TOOL_NAME_PATTERN, type Tool } from "./types";

export interface ActiveTool {
  tool: Tool;
  permission: Exclude<ToolPermission, "disabled">;
}

/** Assistant enabledTools entry that enables every tool of one MCP server. */
export function mcpServerToolKey(slug: string): string {
  return `mcp:${slug}`;
}

export function mcpToolName(slug: string, tool: string): string {
  // Provider tool names: ^[a-zA-Z0-9_-]{1,64}$
  const safe = tool.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${slug}${MCP_TOOL_SEPARATOR}${safe}`.slice(0, 64);
}

/** Effective permission: user override, else the tool default. Dangerous tools never run unasked. */
export function effectivePermission(tool: Pick<Tool, "name" | "permission" | "dangerous">, overrides: Record<string, ToolPermission>): ToolPermission {
  const chosen = overrides[tool.name] ?? tool.permission;
  if (chosen === "auto" && tool.dangerous) return "ask";
  return chosen;
}

/**
 * All tools the app knows (built-ins + connected MCP servers). Assistants pick a subset;
 * the permission settings decide what runs automatically, needs approval or is hidden.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly listeners = new Set<() => void>();

  register(tool: Tool): void {
    if (!TOOL_NAME_PATTERN.test(tool.name)) throw new Error(`Invalid tool name "${tool.name}"`);
    this.tools.set(tool.name, tool);
    this.emit();
  }

  remove(name: string): void {
    if (this.tools.delete(name)) this.emit();
  }

  /** Replaces every tool of an MCP server in one go (tools/list_changed). */
  replaceServerTools(serverId: string, tools: Tool[]): void {
    for (const [name, tool] of this.tools) if (tool.serverId === serverId) this.tools.delete(name);
    for (const tool of tools) {
      if (TOOL_NAME_PATTERN.test(tool.name)) this.tools.set(tool.name, { ...tool, serverId });
    }
    this.emit();
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()].sort((a, b) => Number(a.source === "mcp") - Number(b.source === "mcp") || a.name.localeCompare(b.name));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * Tools offered for one request.
   * @param enabledTools assistant selection (built-in names and "mcp:<slug>"); null = no assistant → every tool.
   * @param mcpSlugOf maps an MCP server id to its slug.
   */
  resolve(options: { enabledTools: readonly string[] | null; settings: Pick<ToolSettings, "permissions">; mcpSlugOf?: (serverId: string) => string | undefined }): ActiveTool[] {
    const selected = options.enabledTools ? new Set(options.enabledTools) : null;
    const active: ActiveTool[] = [];
    for (const tool of this.list()) {
      if (selected) {
        const slug = tool.serverId ? options.mcpSlugOf?.(tool.serverId) : undefined;
        const chosen = selected.has(tool.name) || (slug !== undefined && selected.has(mcpServerToolKey(slug)));
        if (!chosen) continue;
      }
      const permission = effectivePermission(tool, options.settings.permissions);
      if (permission === "disabled") continue;
      active.push({ tool, permission });
    }
    return active;
  }
}

export function toToolSpecs(active: readonly ActiveTool[]): ToolSpec[] {
  return active.map(({ tool }) => ({ name: tool.name, description: tool.description.slice(0, 4000), parameters: tool.inputSchema }));
}
