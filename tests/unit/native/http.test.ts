// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createProxyHttp, directHttp } from "@/lib/ai/transport";
import { webShare } from "@/lib/native/web-bridge";

const g = globalThis as unknown as { window?: unknown; fetch: typeof fetch };
const realFetch = g.fetch;

afterEach(() => {
  delete g.window;
  g.fetch = realFetch;
});

describe("HTTP in the Android app", () => {
  it("streams through the WebView fetch and relays 'proxy' requests over native HTTP (no /api/proxy)", async () => {
    const calls: string[] = [];
    g.window = { CapacitorWebFetch: async (url: string) => (calls.push(`web ${url}`), new Response("w")) };
    g.fetch = (async (url: string) => (calls.push(`native ${url}`), new Response("n"))) as typeof fetch;
    await directHttp("https://api.test/stream", {});
    await createProxyHttp()("https://dav.test/x", { method: "PROPFIND" });
    expect(calls).toEqual(["web https://api.test/stream", "native https://dav.test/x"]);
  });

  it("on the web, proxy requests go to /api/proxy with the method override", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    g.fetch = (async (url: string, init: RequestInit) => (seen.push({ url, init }), new Response("ok"))) as typeof fetch;
    await createProxyHttp()("https://dav.test/x", { method: "PROPFIND" });
    expect(seen[0]!.url).toBe("/api/proxy");
    expect(seen[0]!.init.method).toBe("POST");
    const headers = new Headers(seen[0]!.init.headers);
    expect(headers.get("x-nova-method")).toBe("PROPFIND");
    expect(headers.get("x-nova-target")).toBe("https://dav.test/x");
  });

  it("web share reports unsupported without navigator.share", async () => {
    expect(await webShare({ text: "x" })).toBe("unsupported");
  });
});
