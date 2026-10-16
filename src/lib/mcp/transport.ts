import { SSEParser } from "@/lib/ai/sse";
import { MCP_PROTOCOL_VERSION, McpError, isResponse, type JsonRpcMessage, type JsonRpcNotification, type JsonRpcRequest, type JsonRpcResponse } from "./protocol";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface TransportDeps {
  url: string;
  fetch: FetchLike;
  /** Extra headers incl. Authorization (re-read on every request so refreshed tokens apply). */
  headers: () => Promise<Record<string, string>>;
}

export interface McpTransport {
  /** Server notifications and server→client requests. */
  onMessage: ((message: JsonRpcMessage) => void) | null;
  start(signal?: AbortSignal): Promise<void>;
  request(message: JsonRpcRequest, signal?: AbortSignal): Promise<JsonRpcResponse>;
  notify(message: JsonRpcNotification | JsonRpcResponse): Promise<void>;
  /** Long-lived stream for server-initiated messages (list_changed). Resolves when it ends. */
  listen?(signal: AbortSignal): Promise<void>;
  setProtocolVersion(version: string): void;
  close(): Promise<void>;
}

async function* sseMessages(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SSEParser();
  const onAbort = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const message of parser.feed(decoder.decode(value, { stream: true }))) yield message;
    }
    for (const message of parser.feed("\n\n")) yield message;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

function parseJson(data: string): JsonRpcMessage[] {
  if (!data.trim()) return [];
  try {
    const value = JSON.parse(data) as JsonRpcMessage | JsonRpcMessage[];
    return Array.isArray(value) ? value : [value];
  } catch {
    throw new McpError("protocol", "The server sent invalid JSON");
  }
}

async function failure(response: Response): Promise<never> {
  const text = await response.text().catch(() => "");
  if (response.status === 401 || response.status === 403) {
    throw new McpError("unauthorized", `The MCP server requires authorization (HTTP ${response.status})`, response.headers.get("www-authenticate") ?? undefined);
  }
  let message = `MCP server error (HTTP ${response.status})`;
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string };
    const detail = typeof json.error === "string" ? json.error : json.error?.message;
    if (detail) message += `: ${detail.slice(0, 300)}`;
  } catch {
    if (text) message += `: ${text.slice(0, 200)}`;
  }
  throw new McpError("server", message);
}

async function send(fetchFn: FetchLike, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw new McpError("aborted", "Request cancelled");
    throw new McpError("network", "Could not reach the MCP server (CORS? enable “use proxy” for this server)");
  }
}

/** MCP Streamable HTTP transport (2025-03-26+): POST for messages, optional GET stream, Mcp-Session-Id. */
export class StreamableHttpTransport implements McpTransport {
  onMessage: ((message: JsonRpcMessage) => void) | null = null;
  sessionId: string | null = null;
  private protocolVersion = MCP_PROTOCOL_VERSION;

  constructor(private readonly deps: TransportDeps) {}

  async start(): Promise<void> {}

  setProtocolVersion(version: string): void {
    this.protocolVersion = version;
  }

  private async headers(accept: string, json: boolean): Promise<Record<string, string>> {
    const headers: Record<string, string> = { Accept: accept, ...(await this.deps.headers()) };
    if (json) headers["Content-Type"] = "application/json";
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    headers["MCP-Protocol-Version"] = this.protocolVersion;
    return headers;
  }

  async request(message: JsonRpcRequest, signal?: AbortSignal): Promise<JsonRpcResponse> {
    const response = await send(this.deps.fetch, this.deps.url, {
      method: "POST",
      headers: await this.headers("application/json, text/event-stream", true),
      body: JSON.stringify(message),
      signal,
    });
    const session = response.headers.get("mcp-session-id");
    if (session) this.sessionId = session;
    if (response.status === 404 && this.sessionId && message.method !== "initialize") {
      this.sessionId = null;
      throw new McpError("protocol", "The MCP session expired");
    }
    if (!response.ok) return failure(response);
    const type = response.headers.get("content-type") ?? "";
    if (type.includes("text/event-stream") && response.body) {
      for await (const event of sseMessages(response.body, signal)) {
        for (const item of parseJson(event.data)) {
          if (isResponse(item) && item.id === message.id) {
            void response.body.cancel().catch(() => undefined);
            return item;
          }
          this.onMessage?.(item);
        }
      }
      throw new McpError("protocol", "The stream ended without a response");
    }
    const items = parseJson(await response.text());
    let found: JsonRpcResponse | undefined;
    for (const item of items) {
      if (isResponse(item) && item.id === message.id) found = item;
      else this.onMessage?.(item);
    }
    if (!found) throw new McpError("protocol", "The server did not answer the request");
    return found;
  }

  async notify(message: JsonRpcNotification | JsonRpcResponse): Promise<void> {
    const response = await send(this.deps.fetch, this.deps.url, { method: "POST", headers: await this.headers("application/json, text/event-stream", true), body: JSON.stringify(message) });
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok && response.status !== 202) await failure(response);
  }

  async listen(signal: AbortSignal): Promise<void> {
    const response = await send(this.deps.fetch, this.deps.url, { method: "GET", headers: await this.headers("text/event-stream", false), signal });
    if (response.status === 405 || response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      return; // server has no standalone stream
    }
    if (!response.ok || !response.body) return failure(response);
    for await (const event of sseMessages(response.body, signal)) for (const item of parseJson(event.data)) this.onMessage?.(item);
  }

  async close(): Promise<void> {
    if (!this.sessionId) return;
    const headers = await this.headers("application/json", false);
    this.sessionId = null;
    await this.deps.fetch(this.deps.url, { method: "DELETE", headers }).catch(() => undefined);
  }
}

/** Legacy HTTP+SSE transport (2024-11-05): GET stream announces a POST endpoint; answers arrive on the stream. */
export class SseTransport implements McpTransport {
  onMessage: ((message: JsonRpcMessage) => void) | null = null;
  private endpoint: string | null = null;
  private readonly pending = new Map<string | number, { resolve: (r: JsonRpcResponse) => void; reject: (e: unknown) => void }>();
  private controller: AbortController | null = null;

  constructor(private readonly deps: TransportDeps) {}

  setProtocolVersion(): void {}

  async start(signal?: AbortSignal): Promise<void> {
    this.controller = new AbortController();
    const controller = this.controller;
    signal?.addEventListener("abort", () => controller.abort(), { once: true });
    const response = await send(this.deps.fetch, this.deps.url, { method: "GET", headers: { Accept: "text/event-stream", ...(await this.deps.headers()) }, signal: controller.signal });
    if (!response.ok || !response.body) return failure(response);
    const body = response.body;
    await new Promise<void>((resolve, reject) => {
      let announced = false;
      void (async () => {
        try {
          for await (const event of sseMessages(body, controller.signal)) {
            if (event.event === "endpoint") {
              this.endpoint = new URL(event.data.trim(), this.deps.url).toString();
              if (new URL(this.endpoint).origin !== new URL(this.deps.url).origin) throw new McpError("protocol", "The SSE endpoint points to another origin");
              announced = true;
              resolve();
              continue;
            }
            for (const item of parseJson(event.data)) {
              if (isResponse(item) && item.id !== null && this.pending.has(item.id)) {
                this.pending.get(item.id)!.resolve(item);
                this.pending.delete(item.id);
              } else this.onMessage?.(item);
            }
          }
          throw new McpError("network", "The SSE stream closed");
        } catch (error) {
          for (const waiter of this.pending.values()) waiter.reject(error);
          this.pending.clear();
          if (!announced) reject(error instanceof McpError ? error : new McpError("network", "The SSE stream failed"));
        }
      })();
    });
  }

  private async post(message: JsonRpcMessage, signal?: AbortSignal): Promise<void> {
    if (!this.endpoint) throw new McpError("not_connected", "Not connected");
    const response = await send(this.deps.fetch, this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await this.deps.headers()) },
      body: JSON.stringify(message),
      signal,
    });
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok && response.status !== 202) await failure(response);
  }

  async request(message: JsonRpcRequest, signal?: AbortSignal): Promise<JsonRpcResponse> {
    const result = new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pending.set(message.id, { resolve, reject });
      signal?.addEventListener(
        "abort",
        () => {
          this.pending.delete(message.id);
          reject(new McpError("aborted", "Request cancelled"));
        },
        { once: true },
      );
    });
    try {
      await this.post(message, signal);
    } catch (error) {
      this.pending.delete(message.id);
      throw error;
    }
    return result;
  }

  notify(message: JsonRpcNotification | JsonRpcResponse): Promise<void> {
    return this.post(message);
  }

  async close(): Promise<void> {
    this.controller?.abort();
    this.controller = null;
    this.endpoint = null;
  }
}
