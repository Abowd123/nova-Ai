import type { ToolPermission } from "@/lib/models";

/** JSON Schema subset understood by every provider (object at the top level). */
export interface JsonSchema {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array" | "null" | (string & {}) | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  format?: string;
  [key: string]: unknown;
}

/** Shown in the tool card / passed back to the model. */
export interface ToolCitation {
  index: number;
  title: string;
  url: string;
  snippet?: string;
}

export interface ToolOutputFile {
  name: string;
  mimeType: string;
  /** Saved as an attachment by the runner; the card links to it. */
  attachmentId?: string;
  size: number;
}

export interface ToolResult {
  /** Text the MODEL sees (keep it compact; the context manager truncates very long results). */
  content: string;
  isError?: boolean;
  /** Extra data for the UI only (never sent to the model). */
  display?: {
    kind: "text" | "code" | "search" | "page" | "files" | "subagent";
    stdout?: string;
    stderr?: string;
    value?: string;
    citations?: ToolCitation[];
    files?: ToolOutputFile[];
    durationMs?: number;
    usage?: { inputTokens: number; outputTokens: number };
  };
}

export interface ToolContext {
  signal: AbortSignal;
  conversationId: string;
  assistantId: string | null;
  /** Live progress lines for the tool card ("Downloading Pyodide…"). */
  onProgress?: (message: string) => void;
}

export type ToolSource = "builtin" | "mcp";

export interface Tool {
  /** Model-facing name: ^[a-zA-Z0-9_-]{1,64}$ (MCP tools: server__tool). */
  name: string;
  /** i18n key for built-ins; free text for MCP. */
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  /** Default when the user set nothing. */
  permission: ToolPermission;
  /** Dangerous tools ALWAYS need approval: "auto" is downgraded to "ask". */
  dangerous: boolean;
  source: ToolSource;
  /** MCP server id. */
  serverId?: string;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

export type ToolCallStatus = "pending" | "awaiting_approval" | "running" | "done" | "error" | "denied" | "cancelled";

export interface ToolCallState {
  callId: string;
  name: string;
  status: ToolCallStatus;
  progress?: string;
  startedAt?: number;
}

export type ApprovalDecision = "allow" | "deny" | "always";

export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
