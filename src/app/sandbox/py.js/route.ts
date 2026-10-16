import { PY_WORKER_SOURCE, pythonCsp } from "@/lib/sandbox/py-worker-source";
import { DEFAULT_PYODIDE_URL } from "@/lib/models";

export const dynamic = "force-static";

/**
 * Static Python worker for the exported (APK) build, where /sandbox/py cannot run.
 * Its CSP allows the default Pyodide CDN; a custom index URL is still passed in the init message.
 */
export function GET() {
  return new Response(PY_WORKER_SOURCE, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Security-Policy": pythonCsp(DEFAULT_PYODIDE_URL),
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
