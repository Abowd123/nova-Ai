import { JS_WORKER_SOURCE, sandboxCsp } from "@/lib/sandbox/js-worker-source";

export const dynamic = "force-static";

/** JavaScript sandbox worker WITHOUT network access (CSP connect-src 'none'). */
export function GET() {
  return new Response(JS_WORKER_SOURCE, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Security-Policy": sandboxCsp(false),
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
