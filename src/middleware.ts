import { NextResponse, type NextRequest } from "next/server";
import { TRUSTED_TYPES_POLICY, buildCsp, cspApplies, generateNonce } from "@/lib/security/csp";

/**
 * Per-request CSP nonce. Next.js reads the nonce from the request's CSP header and adds it
 * to its own scripts; the root layout reads x-nonce for the boot script.
 * NOVA_CSP=off disables it (e.g. behind a proxy that sets its own CSP).
 */
export function middleware(request: NextRequest) {
  const mode = process.env.NOVA_CSP ?? "strict";
  if (mode === "off" || !cspApplies(request.nextUrl.pathname)) return NextResponse.next();
  const nonce = generateNonce();
  const csp = buildCsp({ nonce, dev: process.env.NODE_ENV !== "production" });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  const tt = process.env.NOVA_TRUSTED_TYPES ?? "report";
  const enforced: string[] = mode === "report-only" ? [] : [csp];
  const reported: string[] = mode === "report-only" ? [csp] : [];
  if (tt === "enforce") enforced.push(TRUSTED_TYPES_POLICY);
  else if (tt === "report") reported.push(TRUSTED_TYPES_POLICY);
  if (enforced.length) response.headers.set("Content-Security-Policy", enforced.join("; "));
  if (reported.length) response.headers.set("Content-Security-Policy-Report-Only", reported.join("; "));
  return response;
}

export const config = {
  matcher: [{ source: "/((?!api|_next/static|_next/image|sandbox|icons|sw.js|manifest.webmanifest|favicon.ico).*)", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] }],
};
