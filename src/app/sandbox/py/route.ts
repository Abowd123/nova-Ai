import { NextResponse, type NextRequest } from "next/server";
import { PY_WORKER_SOURCE, pythonCsp, validPyodideUrl } from "@/lib/sandbox/py-worker-source";
import { DEFAULT_PYODIDE_URL } from "@/lib/models";

export const dynamic = "force-dynamic";

/** Python (Pyodide) worker; the CSP only allows the chosen Pyodide origin. */
export function GET(request: NextRequest) {
  const index = validPyodideUrl(request.nextUrl.searchParams.get("index") ?? DEFAULT_PYODIDE_URL);
  if (!index) return NextResponse.json({ error: { message: "Invalid Pyodide URL" } }, { status: 400 });
  return new Response(PY_WORKER_SOURCE, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Security-Policy": pythonCsp(index),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
