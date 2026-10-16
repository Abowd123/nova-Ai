import { McpError } from "./protocol";
import type { FetchLike } from "./transport";

/** OAuth 2.1 for MCP (authorization code + PKCE S256, dynamic client registration, refresh). */

export interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms; null = no expiry reported. */
  expiresAt: number | null;
  scope: string | null;
  tokenEndpoint: string;
  clientId: string;
  resource: string;
}

export interface PendingAuthorization {
  serverId: string;
  state: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  tokenEndpoint: string;
  resource: string;
  createdAt: number;
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export function randomString(bytes = 32, random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return base64url(random(bytes));
}

export async function pkceChallenge(verifier: string, subtle: SubtleCrypto = crypto.subtle): Promise<string> {
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** Canonical resource URI of the MCP server (RFC 8707): no fragment, no trailing slash quirks. */
export function resourceUri(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.hash = "";
  return url.toString();
}

/** resource_metadata="…" from a WWW-Authenticate: Bearer header (RFC 9728). */
export function resourceMetadataFrom(header: string | undefined): string | null {
  if (!header) return null;
  return /resource_metadata="([^"]+)"/i.exec(header)?.[1] ?? null;
}

async function getJson<T>(fetchFn: FetchLike, url: string): Promise<T | null> {
  try {
    const response = await fetchFn(url, { method: "GET", headers: { Accept: "application/json", "MCP-Protocol-Version": "2025-06-18" } });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function wellKnown(base: string, suffix: string): string[] {
  const url = new URL(base);
  const path = url.pathname.replace(/\/+$/, "");
  const candidates = [`${url.origin}/.well-known/${suffix}${path && path !== "/" ? path : ""}`];
  if (path && path !== "/") candidates.push(`${url.origin}/.well-known/${suffix}`);
  return candidates;
}

/** Finds the authorization server for an MCP server (protected-resource metadata → AS metadata → defaults). */
export async function discover(serverUrl: string, fetchFn: FetchLike, wwwAuthenticate?: string): Promise<AuthServerMetadata> {
  let issuer: string | null = null;
  const metadataUrls = [resourceMetadataFrom(wwwAuthenticate), ...wellKnown(serverUrl, "oauth-protected-resource")].filter((u): u is string => Boolean(u));
  for (const url of metadataUrls) {
    const meta = await getJson<{ authorization_servers?: string[] }>(fetchFn, url);
    if (meta?.authorization_servers?.[0]) {
      issuer = meta.authorization_servers[0];
      break;
    }
  }
  issuer ??= new URL(serverUrl).origin;
  for (const url of [...wellKnown(issuer, "oauth-authorization-server"), ...wellKnown(issuer, "openid-configuration")]) {
    const meta = await getJson<AuthServerMetadata>(fetchFn, url);
    if (meta?.authorization_endpoint && meta.token_endpoint) {
      if (meta.code_challenge_methods_supported && !meta.code_challenge_methods_supported.includes("S256")) {
        throw new McpError("protocol", "The authorization server does not support PKCE S256");
      }
      return meta;
    }
  }
  // 2025-03-26 fallback: default endpoints at the server origin.
  const origin = new URL(issuer).origin;
  return { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register` };
}

/** Dynamic client registration (RFC 7591) as a public client. */
export async function registerClient(meta: AuthServerMetadata, redirectUri: string, fetchFn: FetchLike): Promise<string> {
  if (!meta.registration_endpoint) throw new McpError("protocol", "The server does not support dynamic client registration; enter a client id");
  const response = await fetchFn(meta.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Nova",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const json = (await response.json().catch(() => null)) as { client_id?: string; error_description?: string } | null;
  if (!response.ok || !json?.client_id) throw new McpError("protocol", `Client registration failed${json?.error_description ? `: ${json.error_description}` : ""}`);
  return json.client_id;
}

export function authorizationUrl(input: { meta: AuthServerMetadata; clientId: string; redirectUri: string; challenge: string; state: string; resource: string; scope?: string }): string {
  const url = new URL(input.meta.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  url.searchParams.set("resource", input.resource);
  const scope = input.scope ?? input.meta.scopes_supported?.join(" ");
  if (scope) url.searchParams.set("scope", scope);
  return url.toString();
}

async function tokenRequest(endpoint: string, params: Record<string, string>, fetchFn: FetchLike): Promise<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }> {
  let response: Response;
  try {
    response = await fetchFn(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(params).toString(),
    });
  } catch {
    throw new McpError("network", "Could not reach the token endpoint");
  }
  const json = (await response.json().catch(() => null)) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string } | null;
  if (!response.ok || !json?.access_token) {
    throw new McpError("unauthorized", `Token request failed: ${json?.error_description ?? json?.error ?? `HTTP ${response.status}`}`);
  }
  return json as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
}

export async function exchangeCode(pending: PendingAuthorization, code: string, fetchFn: FetchLike, now = Date.now()): Promise<OAuthTokens> {
  const json = await tokenRequest(
    pending.tokenEndpoint,
    { grant_type: "authorization_code", code, redirect_uri: pending.redirectUri, client_id: pending.clientId, code_verifier: pending.verifier, resource: pending.resource },
    fetchFn,
  );
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: json.expires_in ? now + json.expires_in * 1000 : null,
    scope: json.scope ?? null,
    tokenEndpoint: pending.tokenEndpoint,
    clientId: pending.clientId,
    resource: pending.resource,
  };
}

export async function refreshTokens(tokens: OAuthTokens, fetchFn: FetchLike, now = Date.now()): Promise<OAuthTokens> {
  if (!tokens.refreshToken) throw new McpError("unauthorized", "The session expired; sign in again");
  const json = await tokenRequest(tokens.tokenEndpoint, { grant_type: "refresh_token", refresh_token: tokens.refreshToken, client_id: tokens.clientId, resource: tokens.resource }, fetchFn);
  return {
    ...tokens,
    accessToken: json.access_token,
    // Refresh tokens may rotate (OAuth 2.1): keep the old one only if no new one was issued.
    refreshToken: json.refresh_token ?? tokens.refreshToken,
    expiresAt: json.expires_in ? now + json.expires_in * 1000 : null,
    scope: json.scope ?? tokens.scope,
  };
}

/** Refresh a minute early. */
export function needsRefresh(tokens: OAuthTokens, now = Date.now()): boolean {
  return tokens.expiresAt !== null && tokens.expiresAt - 60_000 <= now;
}

// --------------------------------------------------------------- pending flows (browser storage)

const PENDING_KEY = "nova:mcp-oauth-pending";
const PENDING_TTL = 10 * 60 * 1000;

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function readPending(store: KeyValueStore, now: number): PendingAuthorization[] {
  try {
    const list = JSON.parse(store.getItem(PENDING_KEY) ?? "[]") as PendingAuthorization[];
    return Array.isArray(list) ? list.filter((p) => now - p.createdAt < PENDING_TTL) : [];
  } catch {
    return [];
  }
}

export function savePending(store: KeyValueStore, pending: PendingAuthorization, now = Date.now()): void {
  const list = readPending(store, now).filter((p) => p.serverId !== pending.serverId);
  store.setItem(PENDING_KEY, JSON.stringify([...list, pending]));
}

/** Returns and removes the flow for this state (single use). */
export function takePending(store: KeyValueStore, state: string, now = Date.now()): PendingAuthorization | null {
  const list = readPending(store, now);
  const match = list.find((p) => p.state === state) ?? null;
  store.setItem(PENDING_KEY, JSON.stringify(list.filter((p) => p !== match)));
  return match;
}

/** Web: /oauth/callback on this origin. Native app (Capacitor): custom-scheme deep link. */
export function redirectUriFor(location: { origin: string; protocol: string }, native: boolean): string {
  return native ? "app.nova.assistant://oauth/callback" : `${location.origin}/oauth/callback`;
}
