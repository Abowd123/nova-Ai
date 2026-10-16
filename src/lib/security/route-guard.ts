/**
 * CSRF guard shared by every state-changing server route (/api/proxy, /api/fetch).
 * The custom marker header forces a CORS preflight that cross-site pages cannot pass;
 * Origin / Sec-Fetch-Site are checked on top for browsers that send them.
 */
export const MARKER_HEADER = "x-nova-proxy";
/** Real HTTP method for the proxy (the browser always talks POST/GET to /api/proxy). */
export const METHOD_HEADER = "x-nova-method";

/** WebDAV + MCP need more than GET/POST; nothing else is forwarded. */
export const PROXY_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "PROPFIND", "MKCOL", "MOVE", "COPY", "OPTIONS"]);

export type GuardResult = { ok: true } | { ok: false; status: number; reason: string };

export interface GuardInput {
  /** Reads a request header (case-insensitive). */
  header: (name: string) => string | null;
  /** Origin of this server (request.nextUrl.origin). */
  selfOrigin: string;
}

export function checkSameOriginRequest({ header, selfOrigin }: GuardInput): GuardResult {
  if (header(MARKER_HEADER) !== "1") return { ok: false, status: 400, reason: "Missing proxy marker" };
  const origin = header("origin");
  if (origin && origin !== selfOrigin) return { ok: false, status: 403, reason: "Cross-origin use is not allowed" };
  if (header("sec-fetch-site") === "cross-site") return { ok: false, status: 403, reason: "Cross-site requests are not allowed" };
  return { ok: true };
}

/** Resolves the upstream method: GET stays GET; POST may carry an allowed override. */
export function upstreamMethod(requestMethod: string, override: string | null): { ok: true; method: string } | { ok: false; reason: string } {
  const method = requestMethod.toUpperCase();
  if (method === "GET") return { ok: true, method: "GET" };
  if (method !== "POST") return { ok: false, reason: "Unsupported method" };
  if (!override) return { ok: true, method: "POST" };
  const wanted = override.trim().toUpperCase();
  return PROXY_METHODS.has(wanted) ? { ok: true, method: wanted } : { ok: false, reason: "Method not allowed" };
}

/** Upstream methods that carry a body. */
export function methodHasBody(method: string): boolean {
  return !["GET", "HEAD", "DELETE", "OPTIONS", "MKCOL"].includes(method);
}
