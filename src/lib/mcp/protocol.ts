/** JSON-RPC 2.0 + Model Context Protocol message shapes (subset used by the client). */

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export function isResponse(message: unknown): message is JsonRpcResponse {
  return Boolean(message) && typeof message === "object" && "id" in (message as object) && ("result" in (message as object) || "error" in (message as object));
}

export function isNotification(message: unknown): message is JsonRpcNotification {
  return Boolean(message) && typeof message === "object" && "method" in (message as object) && !("id" in (message as object));
}

export function isServerRequest(message: unknown): message is JsonRpcRequest {
  return Boolean(message) && typeof message === "object" && "method" in (message as object) && "id" in (message as object);
}

export interface McpToolDescriptor {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | { type: "resource_link"; uri: string; name?: string; description?: string; mimeType?: string }
  | { type: "resource"; resource: { uri: string; mimeType?: string; text?: string; blob?: string } };

export interface McpCallResult {
  content?: McpContent[];
  structuredContent?: unknown;
  isError?: boolean;
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: { tools?: { listChanged?: boolean } } & Record<string, unknown>;
  serverInfo: { name: string; version: string; title?: string };
  instructions?: string;
}

export type McpErrorCode = "unauthorized" | "network" | "protocol" | "server" | "timeout" | "aborted" | "not_connected";

export class McpError extends Error {
  constructor(
    readonly code: McpErrorCode,
    message: string,
    /** WWW-Authenticate header of a 401 (OAuth discovery). */
    readonly authenticate?: string,
  ) {
    super(message);
    this.name = "McpError";
  }
}

/** Flattens tool output for the model (text kept, binary summarized). */
export function contentToText(result: McpCallResult): string {
  const parts: string[] = [];
  for (const item of result.content ?? []) {
    switch (item.type) {
      case "text":
        parts.push(item.text);
        break;
      case "image":
      case "audio":
        parts.push(`[${item.type} ${item.mimeType}, ${Math.round((item.data.length * 3) / 4 / 1024)} KB]`);
        break;
      case "resource_link":
        parts.push(`[resource] ${item.name ?? item.uri}: ${item.uri}${item.description ? ` — ${item.description}` : ""}`);
        break;
      case "resource":
        parts.push(item.resource.text ?? `[resource ${item.resource.uri} (${item.resource.mimeType ?? "binary"})]`);
        break;
    }
  }
  if (!parts.length && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent));
  return parts.join("\n\n") || "(empty result)";
}
