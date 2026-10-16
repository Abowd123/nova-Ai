import { JS_WORKER_SOURCE, sandboxCsp } from "@/lib/sandbox/js-worker-source";

export const dynamic = "force-static";

/** JavaScript sandbox worker WITH network access (only when the user enabled it in Settings → Tools). */
export function GET() {
  return new Response(JS_WORKER_SOURCE, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Security-Policy": sandboxCsp(true),
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
