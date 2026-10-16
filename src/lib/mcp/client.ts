import {
  MCP_PROTOCOL_VERSION,
  McpError,
  SUPPORTED_PROTOCOL_VERSIONS,
  isNotification,
  isServerRequest,
  type JsonRpcMessage,
  type McpCallResult,
  type McpInitializeResult,
  type McpToolDescriptor,
} from "./protocol";
import { SseTransport, StreamableHttpTransport, type FetchLike, type McpTransport } from "./transport";

export interface McpClientOptions {
  url: string;
  transport: "streamable-http" | "sse";
  fetch: FetchLike;
  headers: () => Promise<Record<string, string>>;
  clientInfo?: { name: string; version: string };
  timeoutMs?: number;
  onToolsChanged?: () => void;
  /** Injected transport (tests). */
  createTransport?: () => McpTransport;
}

/** Minimal MCP client: initialize → tools/list → tools/call, plus list_changed notifications. */
export class McpClient {
  private transport: McpTransport;
  private nextId = 1;
  private listenController: AbortController | null = null;
  info: McpInitializeResult | null = null;

  constructor(private readonly options: McpClientOptions) {
    this.transport = this.createTransport();
  }

  private createTransport(): McpTransport {
    if (this.options.createTransport) return this.options.createTransport();
    const deps = { url: this.options.url, fetch: this.options.fetch, headers: this.options.headers };
    return this.options.transport === "sse" ? new SseTransport(deps) : new StreamableHttpTransport(deps);
  }

  get connected(): boolean {
    return this.info !== null;
  }

  private onMessage = (message: JsonRpcMessage) => {
    if (isNotification(message)) {
      if (message.method === "notifications/tools/list_changed") this.options.onToolsChanged?.();
      return;
    }
    if (isServerRequest(message)) {
      // We implement no client features (sampling, roots, elicitation): answer ping, refuse the rest.
      const reply =
        message.method === "ping"
          ? { jsonrpc: "2.0" as const, id: message.id, result: {} }
          : { jsonrpc: "2.0" as const, id: message.id, error: { code: -32601, message: `Method not supported by Nova: ${message.method}` } };
      void this.transport.notify(reply).catch(() => undefined);
    }
  };

  private async call<T>(method: string, params: Record<string, unknown> | undefined, signal?: AbortSignal, timeoutMs = this.options.timeoutMs ?? 30_000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await this.transport.request({ jsonrpc: "2.0", id: this.nextId++, method, ...(params ? { params } : {}) }, controller.signal);
      if (response.error) throw new McpError("server", `${response.error.message} (${response.error.code})`);
      return response.result as T;
    } catch (error) {
      if (controller.signal.aborted && !signal?.aborted) throw new McpError("timeout", `The MCP server did not answer within ${Math.round(timeoutMs / 1000)} s`);
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async connect(signal?: AbortSignal): Promise<McpInitializeResult> {
    this.transport.onMessage = this.onMessage;
    await this.transport.start(signal);
    const result = await this.call<McpInitializeResult>(
      "initialize",
      { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: this.options.clientInfo ?? { name: "Nova", version: "1.4.0" } },
      signal,
    );
    if (!result || typeof result !== "object" || !result.serverInfo) throw new McpError("protocol", "Invalid initialize response");
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(result.protocolVersion)) throw new McpError("protocol", `Unsupported MCP protocol version ${result.protocolVersion}`);
    this.transport.setProtocolVersion(result.protocolVersion);
    await this.transport.notify({ jsonrpc: "2.0", method: "notifications/initialized" });
    this.info = result;
    if (result.capabilities.tools?.listChanged && this.transport.listen) this.startListening();
    return result;
  }

  private startListening(): void {
    this.listenController?.abort();
    const controller = new AbortController();
    this.listenController = controller;
    void (async () => {
      let failures = 0;
      while (!controller.signal.aborted && failures < 5) {
        try {
          await this.transport.listen!(controller.signal);
          failures = 0;
          if (controller.signal.aborted) return;
          await new Promise((r) => setTimeout(r, 1000));
        } catch {
          failures += 1;
          await new Promise((r) => setTimeout(r, 2000 * failures));
        }
      }
    })();
  }

  async listTools(signal?: AbortSignal): Promise<McpToolDescriptor[]> {
    const tools: McpToolDescriptor[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const result = await this.call<{ tools?: McpToolDescriptor[]; nextCursor?: string }>("tools/list", cursor ? { cursor } : undefined, signal);
      tools.push(...(result?.tools ?? []).filter((t) => t && typeof t.name === "string"));
      cursor = result?.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<McpCallResult> {
    return this.call<McpCallResult>("tools/call", { name, arguments: args }, options.signal, options.timeoutMs);
  }

  async ping(signal?: AbortSignal): Promise<void> {
    await this.call("ping", undefined, signal, 10_000);
  }

  async close(): Promise<void> {
    this.listenController?.abort();
    this.listenController = null;
    this.info = null;
    await this.transport.close().catch(() => undefined);
    this.transport = this.createTransport();
  }
}
