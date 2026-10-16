import type { HttpClient } from "@/lib/ai/types";
import { child, children, descendants, parseXml } from "./xml";

export type WebDavErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "precondition_failed"
  | "insufficient_storage"
  | "too_large"
  | "rate_limited"
  | "server"
  | "network"
  | "timeout"
  | "aborted"
  | "invalid_response"
  | "invalid_url";

export class WebDavError extends Error {
  constructor(
    readonly code: WebDavErrorCode,
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "WebDavError";
  }

  /** Network blips, timeouts, 5xx and 429 are worth retrying; auth/404/409 are not. */
  get retryable(): boolean {
    return this.code === "network" || this.code === "timeout" || this.code === "server" || this.code === "rate_limited";
  }
}

export type WebDavAuth = { type: "basic"; username: string; password: string } | { type: "bearer"; token: string } | null;

export interface WebDavEntry {
  /** Path relative to the client's base URL, decoded, always starting with "/". */
  path: string;
  name: string;
  isCollection: boolean;
  size: number;
  lastModified: number | null;
  etag: string | null;
  contentType: string | null;
}

export interface WebDavClientOptions {
  /** e.g. https://cloud.example.com/remote.php/dav/files/alice/ */
  baseUrl: string;
  auth: WebDavAuth;
  http: HttpClient;
  timeoutMs?: number;
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getetag/><d:getcontenttype/></d:prop></d:propfind>`;

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function normalizeBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new WebDavError("invalid_url", "Invalid WebDAV URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new WebDavError("invalid_url", "WebDAV URL must be http(s)");
  if (url.username || url.password) throw new WebDavError("invalid_url", "Put credentials in the username/password fields, not in the URL");
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

/** "/a b/c" -> "a%20b/c" (each segment encoded; ".." rejected). */
export function encodePath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.some((s) => s === ".." || s === ".")) throw new WebDavError("invalid_url", "Relative path segments are not allowed");
  return segments.map((s) => encodeURIComponent(s)).join("/");
}

export class WebDavClient {
  readonly base: URL;

  constructor(private readonly options: WebDavClientOptions) {
    this.base = normalizeBaseUrl(options.baseUrl);
  }

  url(path: string, collection = false): string {
    const encoded = encodePath(path);
    return new URL(encoded + (collection && encoded ? "/" : ""), this.base).toString();
  }

  private authHeader(): Record<string, string> {
    const auth = this.options.auth;
    if (!auth) return {};
    if (auth.type === "basic") return { Authorization: `Basic ${base64Utf8(`${auth.username}:${auth.password}`)}` };
    return { Authorization: `Bearer ${auth.token}` };
  }

  private async request(method: string, url: string, init: { headers?: Record<string, string>; body?: BodyInit; signal?: AbortSignal; okStatuses?: number[] } = {}): Promise<Response> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    init.signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.options.timeoutMs ?? 120_000);
    let response: Response;
    try {
      response = await this.options.http(url, { method, headers: { ...this.authHeader(), ...init.headers }, body: init.body, signal: controller.signal });
    } catch (error) {
      if (init.signal?.aborted) throw new WebDavError("aborted", "Cancelled", undefined, { cause: error });
      if (timedOut) throw new WebDavError("timeout", "The WebDAV server did not answer in time", undefined, { cause: error });
      throw new WebDavError("network", "Could not reach the WebDAV server (offline, DNS, TLS or CORS)", undefined, { cause: error });
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", onAbort);
    }
    if (response.ok || init.okStatuses?.includes(response.status)) return response;
    await response.body?.cancel().catch(() => undefined);
    throw statusError(response.status, method);
  }

  async propfind(path: string, depth: 0 | 1 = 1, signal?: AbortSignal): Promise<WebDavEntry[]> {
    const response = await this.request("PROPFIND", this.url(path, true), {
      headers: { Depth: String(depth), "Content-Type": "application/xml; charset=utf-8" },
      body: PROPFIND_BODY,
      signal,
    });
    return this.parseMultistatus(await response.text());
  }

  parseMultistatus(xml: string): WebDavEntry[] {
    let doc;
    try {
      doc = parseXml(xml);
    } catch (error) {
      throw new WebDavError("invalid_response", "The server returned invalid XML", undefined, { cause: error });
    }
    const responses = descendants(doc, "response");
    if (!responses.length && !descendants(doc, "multistatus").length) throw new WebDavError("invalid_response", "Not a WebDAV multistatus response");
    const basePath = decodeURIComponent(this.base.pathname);
    const entries: WebDavEntry[] = [];
    for (const response of responses) {
      const hrefText = child(response, "href")?.text.trim();
      if (!hrefText) continue;
      const okProp = children(response, "propstat").find((ps) => /\s2\d\d\s/.test(` ${child(ps, "status")?.text ?? "HTTP/1.1 200 OK"} `));
      const prop = child(okProp, "prop");
      let absolute: string;
      try {
        absolute = decodeURIComponent(new URL(hrefText, this.base).pathname);
      } catch {
        continue;
      }
      if (!absolute.startsWith(basePath)) continue;
      const relative = "/" + absolute.slice(basePath.length).replace(/^\/+/, "");
      const isCollection = Boolean(child(child(prop, "resourcetype"), "collection")) || relative.endsWith("/");
      const clean = relative.length > 1 ? relative.replace(/\/+$/, "") : "/";
      const modified = child(prop, "getlastmodified")?.text.trim();
      const parsedDate = modified ? Date.parse(modified) : NaN;
      entries.push({
        path: clean,
        name: clean.split("/").pop() ?? "",
        isCollection,
        size: Number(child(prop, "getcontentlength")?.text.trim() || 0) || 0,
        lastModified: Number.isFinite(parsedDate) ? parsedDate : null,
        etag: child(prop, "getetag")?.text.trim().replace(/^W\//, "").replace(/"/g, "") || null,
        contentType: child(prop, "getcontenttype")?.text.trim() || null,
      });
    }
    return entries;
  }

  /** Lists a folder's direct children (the folder itself is excluded). Missing folder → []. */
  async list(path: string, signal?: AbortSignal): Promise<WebDavEntry[]> {
    try {
      const self = "/" + path.split("/").filter(Boolean).join("/");
      return (await this.propfind(path, 1, signal)).filter((e) => e.path !== (self === "/" ? "/" : self));
    } catch (error) {
      if (error instanceof WebDavError && error.code === "not_found") return [];
      throw error;
    }
  }

  async stat(path: string, signal?: AbortSignal): Promise<WebDavEntry | null> {
    try {
      return (await this.propfind(path, 0, signal))[0] ?? null;
    } catch (error) {
      if (error instanceof WebDavError && error.code === "not_found") return null;
      throw error;
    }
  }

  async mkcol(path: string, signal?: AbortSignal): Promise<void> {
    // 405 = already exists.
    await this.request("MKCOL", this.url(path, true), { signal, okStatuses: [405] });
  }

  /** Creates every missing folder along the path. */
  async ensureDir(path: string, signal?: AbortSignal): Promise<void> {
    const segments = path.split("/").filter(Boolean);
    for (let i = 1; i <= segments.length; i += 1) {
      const partial = segments.slice(0, i).join("/");
      const existing = await this.stat(partial, signal);
      if (existing?.isCollection) continue;
      await this.mkcol(partial, signal);
    }
  }

  async put(path: string, body: Uint8Array | string, options: { contentType?: string; signal?: AbortSignal } = {}): Promise<void> {
    const payload = typeof body === "string" ? new TextEncoder().encode(body) : body;
    await this.request("PUT", this.url(path), {
      headers: { "Content-Type": options.contentType ?? "application/octet-stream" },
      body: new Blob([payload as BlobPart]),
      signal: options.signal,
    });
  }

  /** Downloads a file; `from` resumes with a Range request (falls back to a full download). */
  async get(path: string, options: { from?: number; signal?: AbortSignal } = {}): Promise<{ bytes: Uint8Array; partial: boolean }> {
    const headers: Record<string, string> = options.from ? { Range: `bytes=${options.from}-` } : {};
    const response = await this.request("GET", this.url(path), { headers, signal: options.signal });
    const bytes = new Uint8Array(await response.arrayBuffer().catch((error: unknown) => {
      throw new WebDavError("network", "The download was interrupted", undefined, { cause: error });
    }));
    return { bytes, partial: response.status === 206 };
  }

  async getText(path: string, signal?: AbortSignal): Promise<string> {
    return new TextDecoder().decode((await this.get(path, { signal })).bytes);
  }

  async delete(path: string, options: { collection?: boolean; signal?: AbortSignal } = {}): Promise<void> {
    await this.request("DELETE", this.url(path, options.collection), { signal: options.signal, okStatuses: [404] });
  }

  async move(from: string, to: string, options: { overwrite?: boolean; signal?: AbortSignal } = {}): Promise<void> {
    await this.request("MOVE", this.url(from), { headers: { Destination: this.url(to), Overwrite: options.overwrite === false ? "F" : "T" }, signal: options.signal });
  }
}

export function statusError(status: number, method: string): WebDavError {
  if (status === 401) return new WebDavError("unauthorized", "Wrong username, password or token", status);
  if (status === 403) return new WebDavError("forbidden", "Access denied by the WebDAV server", status);
  if (status === 404) return new WebDavError("not_found", "Not found on the WebDAV server", status);
  if (status === 409) return new WebDavError("conflict", "The parent folder does not exist", status);
  if (status === 412) return new WebDavError("precondition_failed", "The file changed on the server", status);
  if (status === 413) return new WebDavError("too_large", "The server rejected the upload size", status);
  if (status === 429) return new WebDavError("rate_limited", "Too many requests to the WebDAV server", status);
  if (status === 507) return new WebDavError("insufficient_storage", "Not enough storage on the WebDAV server", status);
  if (status === 405 && method === "PROPFIND") return new WebDavError("invalid_response", "This URL does not speak WebDAV", status);
  if (status >= 500) return new WebDavError("server", `WebDAV server error (${status})`, status);
  return new WebDavError("invalid_response", `Unexpected WebDAV status ${status}`, status);
}

/** Retries retryable failures with exponential backoff (network drops, 5xx, 429). */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: { attempts?: number; baseDelayMs?: number; signal?: AbortSignal; onRetry?: (error: WebDavError, attempt: number) => void } = {}): Promise<T> {
  const attempts = options.attempts ?? 4;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (!(error instanceof WebDavError) || !error.retryable || attempt >= attempts || options.signal?.aborted) throw error;
      options.onRetry?.(error, attempt);
      const delay = (options.baseDelayMs ?? 500) * 2 ** (attempt - 1);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        options.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new WebDavError("aborted", "Cancelled"));
          },
          { once: true },
        );
      });
    }
  }
}
