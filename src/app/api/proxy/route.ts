import { lookup } from "node:dns/promises";
import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/env.server";
import { PROXY_MARKER_HEADER, PROXY_TARGET_HEADER } from "@/lib/ai/transport";
import { RateLimiter } from "@/lib/security/rate-limit";
import { checkResolvedHost, checkTargetUrl } from "@/lib/security/ssrf";
import { METHOD_HEADER, checkSameOriginRequest, methodHasBody, upstreamMethod } from "@/lib/security/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Large enough for Files API uploads of big videos/PDFs. */
const MAX_BODY_BYTES = 512 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 10 * 60 * 1000;

/** Request headers that must never be forwarded upstream. */
const STRIP_REQUEST = new Set([
  "host",
  "cookie",
  "origin",
  "referer",
  "connection",
  "content-length",
  "accept-encoding",
  "transfer-encoding",
  "upgrade",
  "te",
  "x-real-ip",
  "forwarded",
  PROXY_TARGET_HEADER,
  PROXY_MARKER_HEADER,
  METHOD_HEADER,
]);

const PASS_RESPONSE = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
  "dav",
  "retry-after",
  "retry-after-ms",
  "x-request-id",
  "request-id",
  "x-goog-upload-url",
  "x-goog-upload-status",
  // MCP Streamable HTTP
  "mcp-session-id",
  "www-authenticate",
];

let limiter: RateLimiter | null = null;

function clientKey(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

function deny(status: number, message: string, extra: Record<string, string> = {}) {
  return NextResponse.json({ error: { message } }, { status, headers: { "Cache-Control": "no-store", ...extra } });
}

async function handle(request: NextRequest): Promise<Response> {
  const env = getServerEnv();
  if (!env.NOVA_PROXY_ENABLED) return deny(404, "Proxy disabled");

  const guard = checkSameOriginRequest({ header: (name) => request.headers.get(name), selfOrigin: request.nextUrl.origin });
  if (!guard.ok) return deny(guard.status, guard.reason);
  const method = upstreamMethod(request.method, request.headers.get(METHOD_HEADER));
  if (!method.ok) return deny(405, method.reason);

  limiter ??= new RateLimiter(env.NOVA_PROXY_RATE_LIMIT, 60_000);
  const rate = limiter.check(clientKey(request));
  if (!rate.allowed) {
    return deny(429, "Too many proxy requests", { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) });
  }

  const policy = { allowPrivate: env.NOVA_PROXY_ALLOW_PRIVATE, allowedHosts: env.NOVA_PROXY_ALLOWED_HOSTS };
  const target = checkTargetUrl(request.headers.get(PROXY_TARGET_HEADER), policy);
  if (!target.ok) return deny(400, target.reason);
  const resolved = await checkResolvedHost(target.url.hostname, policy, (host) => lookup(host, { all: true }));
  if (!resolved.ok) return deny(400, "reason" in resolved ? resolved.reason : "Target rejected");

  const headers = new Headers();
  request.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (!STRIP_REQUEST.has(lower) && !lower.startsWith("x-forwarded-") && !lower.startsWith("sec-")) {
      headers.set(name, value);
    }
  });

  let body: ArrayBuffer | undefined;
  if (methodHasBody(method.method)) {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES) return deny(413, "Request body too large");
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength > MAX_BODY_BYTES) return deny(413, "Request body too large");
    body = buffer;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  request.signal.addEventListener("abort", () => controller.abort(), { once: true });

  let upstream: Response;
  try {
    upstream = await fetch(target.url, {
      method: method.method,
      headers,
      body,
      redirect: "manual", // a redirect could point at an internal address
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    clearTimeout(timer);
    // Never echo upstream error details: they may include the target or credentials.
    return deny(502, "Upstream request failed");
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    clearTimeout(timer);
    await upstream.body?.cancel();
    return deny(502, "Upstream redirects are not followed");
  }

  const responseHeaders = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  for (const name of PASS_RESPONSE) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  const passthrough = upstream.body
    ? upstream.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          flush() {
            clearTimeout(timer);
          },
        }),
      )
    : null;
  if (!passthrough) clearTimeout(timer);

  return new Response(method.method === "HEAD" ? null : passthrough, { status: upstream.status, headers: responseHeaders });
}

export function GET(request: NextRequest) {
  return handle(request);
}

export function POST(request: NextRequest) {
  return handle(request);
}
