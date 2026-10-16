import { PROXY_MARKER_HEADER } from "@/lib/ai/transport";
import { hasNativeHttp, nativeFetch } from "@/lib/native/http";
import { FetchPageError, fetchPage, type FetchedPage, type FetchPageErrorCode } from "./fetch-page";

export const FETCH_PATH = "/api/fetch";

export class FetchUrlError extends Error {
  constructor(
    readonly code: FetchPageErrorCode | "disabled" | "rate_limited" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "FetchUrlError";
  }
}

/** Browser side of fetch_url: the app server downloads and cleans the page (CORS + SSRF safety). */
export async function fetchUrlViaServer(
  url: string,
  options: { maxChars: number; blockedSites: string[]; signal?: AbortSignal; fetch?: typeof fetch },
): Promise<FetchedPage> {
  if (!options.fetch && hasNativeHttp()) return fetchUrlOnDevice(url, options);
  const doFetch = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(FETCH_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json", [PROXY_MARKER_HEADER]: "1" },
      body: JSON.stringify({ url, maxChars: options.maxChars, blockedSites: options.blockedSites }),
      signal: options.signal,
      credentials: "same-origin",
    });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw error;
    throw new FetchUrlError("unavailable", "The page-fetching service is unreachable (fetch_url needs the Nova server; it is not available in a static/offline build)");
  }
  const json = (await response.json().catch(() => null)) as (FetchedPage & { error?: { code?: string; message?: string } }) | null;
  if (!response.ok || !json || json.error) {
    const code = (json?.error?.code as FetchUrlError["code"]) ?? (response.status === 404 ? "disabled" : "network");
    throw new FetchUrlError(code, json?.error?.message ?? `Fetching failed (HTTP ${response.status})`);
  }
  return json;
}

export function formatPage(page: FetchedPage): string {
  const header = [`Title: ${page.title}`, `URL: ${page.url}`, page.byline ? `Author: ${page.byline}` : null, page.excerpt ? `Description: ${page.excerpt}` : null].filter(Boolean).join("\n");
  return `${header}\n\n${page.text}${page.truncated ? "\n\n[content truncated]" : ""}`;
}

/**
 * Android app: no Nova server, but native HTTP has no CORS, so the page is downloaded and
 * cleaned on the device (same size/type/redirect limits; blocked sites still apply).
 * Private addresses are allowed here: the request comes from the user's own device.
 */
async function fetchUrlOnDevice(url: string, options: { maxChars: number; blockedSites: string[]; signal?: AbortSignal }): Promise<FetchedPage> {
  try {
    return await fetchPage(url, {
      maxChars: options.maxChars,
      blockedSites: options.blockedSites,
      allowPrivate: true,
      lookup: async () => [],
      fetch: (target, init) => nativeFetch(target, { ...init, signal: options.signal }),
    });
  } catch (error) {
    if (error instanceof FetchPageError) throw new FetchUrlError(error.code, error.message);
    throw error;
  }
}
