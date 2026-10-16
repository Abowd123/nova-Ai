import type { HttpClient } from "@/lib/ai/types";

/**
 * In the Android app, CapacitorHttp patches window.fetch to go through native HTTP (no CORS),
 * and keeps the WebView's own fetch as window.CapacitorWebFetch.
 *  - webFetch:    WebView fetch → streaming responses (SSE) work; CORS applies.
 *  - nativeFetch: native HTTP → no CORS (WebDAV, MCP, search, page reading); responses are buffered.
 */
type FetchFn = typeof fetch;

function capacitorWebFetch(): FetchFn | undefined {
  return typeof window !== "undefined" ? (window as unknown as { CapacitorWebFetch?: FetchFn }).CapacitorWebFetch : undefined;
}

export const webFetch: HttpClient = (url, init) => (capacitorWebFetch() ?? fetch)(url, init);

export const nativeFetch: HttpClient = (url, init) => fetch(url, { ...init, credentials: "omit" });

/** True when native HTTP (CORS-free) is available. */
export function hasNativeHttp(): boolean {
  return capacitorWebFetch() !== undefined;
}
