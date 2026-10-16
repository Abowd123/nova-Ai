import { lookup } from "node:dns/promises";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@/env.server";
import { checkSameOriginRequest } from "@/lib/security/route-guard";
import { RateLimiter } from "@/lib/security/rate-limit";
import { FetchPageError, fetchPage } from "@/lib/web/fetch-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    url: z.string().min(1).max(4000),
    maxChars: z.number().int().min(500).max(200_000).default(12_000),
    blockedSites: z.array(z.string().max(253)).max(500).default([]),
  })
  .strict();

let limiter: RateLimiter | null = null;

function deny(status: number, code: string, message: string, extra: Record<string, string> = {}) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store", ...extra } });
}

/** fetch_url backend: downloads a public page and returns its readable text. */
export async function POST(request: NextRequest) {
  const env = getServerEnv();
  if (!env.NOVA_FETCH_ENABLED) return deny(404, "disabled", "Page fetching is disabled on this server");
  const guard = checkSameOriginRequest({ header: (name) => request.headers.get(name), selfOrigin: request.nextUrl.origin });
  if (!guard.ok) return deny(guard.status, "csrf", guard.reason);

  limiter ??= new RateLimiter(env.NOVA_FETCH_RATE_LIMIT, 60_000);
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  const rate = limiter.check(key);
  if (!rate.allowed) return deny(429, "rate_limited", "Too many page requests", { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return deny(400, "invalid_url", "Invalid request");
  }
  try {
    const page = await fetchPage(body.url, {
      maxChars: body.maxChars,
      blockedSites: [...env.NOVA_FETCH_BLOCKED_HOSTS, ...body.blockedSites],
      allowPrivate: env.NOVA_PROXY_ALLOW_PRIVATE,
      fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }),
      lookup: (host) => lookup(host, { all: true }),
      signal: request.signal,
    });
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof FetchPageError) {
      const status = error.code === "private" || error.code === "blocked" ? 403 : error.code === "timeout" ? 504 : error.code === "too_large" ? 413 : error.code === "http_error" ? 502 : 400;
      return deny(status, error.code, error.message);
    }
    return deny(502, "network", "Could not fetch the page");
  }
}
