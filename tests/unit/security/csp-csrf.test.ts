// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { buildCsp, cspApplies, generateNonce } from "@/lib/security/csp";
import { checkSameOriginRequest, methodHasBody, upstreamMethod } from "@/lib/security/route-guard";
import { logger } from "@/lib/logger";
import { audit, setAuditSink } from "@/lib/audit";

const headers = (h: Record<string, string>) => (name: string) => h[name.toLowerCase()] ?? null;

describe("CSP", () => {
  it("uses a nonce + strict-dynamic, no unsafe-inline scripts or eval in production", () => {
    const csp = buildCsp({ nonce: "abc", dev: false });
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toBe("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(buildCsp({ nonce: "abc", dev: true })).toContain("'unsafe-eval'");
  });

  it("nonces are random and the sandbox/API routes keep their own policy", () => {
    expect(generateNonce()).not.toBe(generateNonce());
    expect(generateNonce(() => new Uint8Array(16))).toBe("AAAAAAAAAAAAAAAAAAAAAA==");
    expect(cspApplies("/chat/123")).toBe(true);
    expect(cspApplies("/api/proxy")).toBe(false);
    expect(cspApplies("/sandbox/js")).toBe(false);
  });
});

describe("CSRF guard for server routes", () => {
  const self = "https://nova.test";
  it("requires the marker header and same origin", () => {
    expect(checkSameOriginRequest({ header: headers({}), selfOrigin: self })).toMatchObject({ ok: false, status: 400 });
    expect(checkSameOriginRequest({ header: headers({ "x-nova-proxy": "1", origin: "https://evil.test" }), selfOrigin: self })).toMatchObject({ ok: false, status: 403 });
    expect(checkSameOriginRequest({ header: headers({ "x-nova-proxy": "1", "sec-fetch-site": "cross-site" }), selfOrigin: self })).toMatchObject({ ok: false, status: 403 });
    expect(checkSameOriginRequest({ header: headers({ "x-nova-proxy": "1", origin: self, "sec-fetch-site": "same-origin" }), selfOrigin: self })).toEqual({ ok: true });
  });

  it("only allows known upstream methods through POST", () => {
    expect(upstreamMethod("GET", "DELETE")).toEqual({ ok: true, method: "GET" });
    expect(upstreamMethod("POST", "propfind")).toEqual({ ok: true, method: "PROPFIND" });
    expect(upstreamMethod("POST", "TRACE")).toMatchObject({ ok: false });
    expect(upstreamMethod("PUT", null)).toMatchObject({ ok: false });
    expect(methodHasBody("MKCOL")).toBe(false);
    expect(methodHasBody("PUT")).toBe(true);
  });
});

describe("secret leaks", () => {
  it("the logger redacts API keys and bearer tokens", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    logger.warn("failed with sk-ant-api03-abcdefghijklmnopqrstuvwxyz", { headers: { Authorization: "Bearer abcdefghijklmnopqrstuvwxyz0123" } });
    const printed = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(printed).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("audit entries are redacted before storage", async () => {
    const saved: string[] = [];
    setAuditSink(async (_kind, detail) => void saved.push(detail));
    audit("key_saved", "provider X sk-proj-1234567890abcdefghijklmnop");
    await Promise.resolve();
    setAuditSink(null);
    expect(saved[0]).not.toContain("1234567890abcdefghijklmnop");
  });
});

