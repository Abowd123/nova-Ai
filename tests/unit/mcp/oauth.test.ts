import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  authorizationUrl,
  discover,
  exchangeCode,
  needsRefresh,
  pkceChallenge,
  randomString,
  refreshTokens,
  registerClient,
  resourceMetadataFrom,
  savePending,
  takePending,
  type OAuthTokens,
} from "@/lib/mcp/oauth";

function memoryStore() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

describe("OAuth 2.1 helpers", () => {
  it("computes the RFC 7636 S256 challenge", async () => {
    // Appendix B test vector.
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", webcrypto.subtle as SubtleCrypto)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(randomString(32, (n) => new Uint8Array(n).fill(255))).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("discovers the authorization server via protected-resource metadata", async () => {
    const seen: string[] = [];
    const fetch = async (url: string) => {
      seen.push(url);
      if (url === "https://mcp.test/.well-known/oauth-protected-resource") return Response.json({ authorization_servers: ["https://auth.test"] });
      if (url === "https://auth.test/.well-known/oauth-authorization-server")
        return Response.json({ issuer: "https://auth.test", authorization_endpoint: "https://auth.test/authorize", token_endpoint: "https://auth.test/token", registration_endpoint: "https://auth.test/register", code_challenge_methods_supported: ["S256"] });
      return new Response("", { status: 404 });
    };
    const meta = await discover("https://mcp.test/mcp", fetch, 'Bearer realm="x", resource_metadata="https://mcp.test/.well-known/oauth-protected-resource"');
    expect(meta.token_endpoint).toBe("https://auth.test/token");
    expect(seen[0]).toBe("https://mcp.test/.well-known/oauth-protected-resource");
    expect(resourceMetadataFrom(undefined)).toBeNull();
  });

  it("falls back to default endpoints", async () => {
    const meta = await discover("https://mcp.test/mcp", async () => new Response("", { status: 404 }));
    expect(meta).toMatchObject({ authorization_endpoint: "https://mcp.test/authorize", token_endpoint: "https://mcp.test/token" });
  });

  it("registers a public client and builds the authorize URL", async () => {
    let body: Record<string, unknown> = {};
    const clientId = await registerClient(
      { issuer: "i", authorization_endpoint: "https://a/authorize", token_endpoint: "https://a/token", registration_endpoint: "https://a/register" },
      "https://app.test/oauth/callback",
      async (_u, init) => {
        body = JSON.parse(String(init.body));
        return Response.json({ client_id: "cid-1" }, { status: 201 });
      },
    );
    expect(clientId).toBe("cid-1");
    expect(body).toMatchObject({ redirect_uris: ["https://app.test/oauth/callback"], token_endpoint_auth_method: "none" });
    const url = new URL(authorizationUrl({ meta: { issuer: "i", authorization_endpoint: "https://a/authorize", token_endpoint: "t", scopes_supported: ["read"] }, clientId: "cid-1", redirectUri: "https://app.test/oauth/callback", challenge: "ch", state: "st", resource: "https://mcp.test/mcp" }));
    expect(Object.fromEntries(url.searchParams)).toEqual({ response_type: "code", client_id: "cid-1", redirect_uri: "https://app.test/oauth/callback", code_challenge: "ch", code_challenge_method: "S256", state: "st", resource: "https://mcp.test/mcp", scope: "read" });
  });

  it("exchanges the code and refreshes (rotating refresh tokens)", async () => {
    const forms: URLSearchParams[] = [];
    const fetch = async (_u: string, init: RequestInit) => {
      const form = new URLSearchParams(String(init.body));
      forms.push(form);
      return form.get("grant_type") === "authorization_code"
        ? Response.json({ access_token: "at1", refresh_token: "rt1", expires_in: 3600 })
        : Response.json({ access_token: "at2", expires_in: 60 });
    };
    const pending = { serverId: "s", state: "st", verifier: "ver", redirectUri: "https://app/cb", clientId: "cid", tokenEndpoint: "https://a/token", resource: "https://mcp/", createdAt: 0 };
    const tokens = await exchangeCode(pending, "code-1", fetch, 1000);
    expect(tokens).toMatchObject({ accessToken: "at1", refreshToken: "rt1", expiresAt: 1000 + 3_600_000 });
    expect(forms[0]!.get("code_verifier")).toBe("ver");
    expect(needsRefresh(tokens, 1000 + 3_600_000 - 30_000)).toBe(true);
    const refreshed = await refreshTokens(tokens as OAuthTokens, fetch, 5000);
    expect(refreshed).toMatchObject({ accessToken: "at2", refreshToken: "rt1", expiresAt: 65_000 });
    expect(forms[1]!.get("refresh_token")).toBe("rt1");
  });

  it("stores pending flows once and expires them", () => {
    const store = memoryStore();
    const pending = { serverId: "s", state: "st", verifier: "v", redirectUri: "r", clientId: "c", tokenEndpoint: "t", resource: "x", createdAt: 1000 };
    savePending(store, pending, 1000);
    expect(takePending(store, "other", 1000)).toBeNull();
    expect(takePending(store, "st", 2000)).toEqual(pending);
    expect(takePending(store, "st", 2000)).toBeNull();
    savePending(store, pending, 1000);
    expect(takePending(store, "st", 1000 + 11 * 60_000)).toBeNull();
  });
});
