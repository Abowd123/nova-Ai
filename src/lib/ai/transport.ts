import { MARKER_HEADER, METHOD_HEADER } from "@/lib/security/route-guard";
import { hasNativeHttp, nativeFetch, webFetch } from "@/lib/native/http";
import type { HttpClient, ProviderTransport } from "./types";

export const PROXY_PATH = "/api/proxy";
export const PROXY_TARGET_HEADER = "x-nova-target";
export const PROXY_MARKER_HEADER = MARKER_HEADER;

/** Browser -> provider. Keys are decrypted in memory just for the request. */
export const directHttp: HttpClient = (url, init) => webFetch(url, { ...init, credentials: "omit", referrerPolicy: "no-referrer" });

/**
 * Browser -> Nova server -> provider. Useful when the provider blocks CORS.
 * The target URL travels in a header (not the query string) so it never lands in access logs.
 */
export function createProxyHttp(proxyPath: string = PROXY_PATH): HttpClient {
  return (url, init) => {
    // Android app: native HTTP has no CORS and there is no server to relay through.
    if (hasNativeHttp()) return nativeFetch(url, init);
    const headers = new Headers(init.headers);
    headers.set(PROXY_TARGET_HEADER, url);
    headers.set(PROXY_MARKER_HEADER, "1");
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "POST") headers.set(METHOD_HEADER, method);
    return fetch(proxyPath, {
      ...init,
      method: method === "GET" ? "GET" : "POST",
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
  };
}

export function httpForTransport(transport: ProviderTransport): HttpClient {
  return transport === "proxy" ? createProxyHttp() : directHttp;
}
