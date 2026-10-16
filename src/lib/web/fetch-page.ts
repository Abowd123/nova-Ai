import { isIP } from "@/lib/security/ip";
import { isPrivateAddress } from "@/lib/security/ssrf";
import { extractReadable } from "./readability";
import { hostMatches } from "./search";

export interface FetchPageOptions {
  maxChars: number;
  blockedSites: string[];
  allowPrivate: boolean;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  lookup: (host: string) => Promise<{ address: string }[]>;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
}

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  title: string;
  byline: string | null;
  excerpt: string | null;
  lang: string | null;
  text: string;
  truncated: boolean;
  links: { text: string; url: string }[];
}

export type FetchPageErrorCode = "invalid_url" | "blocked" | "private" | "too_large" | "unsupported_type" | "http_error" | "timeout" | "network" | "too_many_redirects";

export class FetchPageError extends Error {
  constructor(
    readonly code: FetchPageErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FetchPageError";
  }
}

const TEXT_TYPES = /^(text\/(plain|markdown|csv|x-markdown)|application\/(json|xml|rss\+xml|atom\+xml|ld\+json)|text\/xml)/i;
const HTML_TYPES = /^(text\/html|application\/xhtml\+xml)/i;

/** Static + DNS checks for one hop (every redirect is checked again). */
async function checkUrl(raw: string, options: FetchPageOptions): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchPageError("invalid_url", "Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchPageError("invalid_url", "Only http(s) URLs can be fetched");
  if (url.username || url.password) throw new FetchPageError("invalid_url", "Credentials in URLs are not allowed");
  if (url.port && !["80", "443", "8080", "8443"].includes(url.port) && !options.allowPrivate) throw new FetchPageError("blocked", "Non-standard ports are not allowed");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (options.blockedSites.some((pattern) => hostMatches(host, pattern))) throw new FetchPageError("blocked", `${host} is blocked`);
  if (options.allowPrivate) return url;
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/.test(host)) throw new FetchPageError("private", "Private addresses are not allowed");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new FetchPageError("private", "Private addresses are not allowed");
    return url;
  }
  let addresses: { address: string }[];
  try {
    addresses = await options.lookup(host);
  } catch {
    throw new FetchPageError("network", "The host could not be resolved");
  }
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new FetchPageError("private", "Private addresses are not allowed");
  return url;
}

async function readLimited(response: Response, maxBytes: number): Promise<{ bytes: Uint8Array; cut: boolean }> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes * 4) {
    await response.body?.cancel();
    throw new FetchPageError("too_large", `The page is too large (${Math.round(declared / 1048576)} MB)`);
  }
  if (!response.body) return { bytes: new Uint8Array(), cut: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let cut = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total >= maxBytes) {
      cut = true;
      await reader.cancel();
      break;
    }
  }
  const bytes = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, Math.max(0, bytes.length - offset));
    bytes.set(slice, offset);
    offset += slice.byteLength;
  }
  return { bytes, cut };
}

function decode(bytes: Uint8Array, contentType: string): string {
  const declared = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const sniffed = declared ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(new TextDecoder("latin1").decode(bytes.subarray(0, 2048)))?.[1];
  try {
    return new TextDecoder(sniffed ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/**
 * Server-side page fetch for the fetch_url tool: SSRF checks on every redirect hop, size and
 * time limits, charset detection, then readable-text extraction for HTML.
 */
export async function fetchPage(rawUrl: string, options: FetchPageOptions): Promise<FetchedPage> {
  const maxBytes = options.maxBytes ?? 3 * 1024 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    let current = rawUrl;
    for (let hop = 0; ; hop += 1) {
      if (hop > (options.maxRedirects ?? 5)) throw new FetchPageError("too_many_redirects", "Too many redirects");
      const url = await checkUrl(current, options);
      let response: Response;
      try {
        response = await options.fetch(url.toString(), {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5",
            "User-Agent": "Mozilla/5.0 (compatible; NovaFetch/1.4; +https://github.com/nova)",
            "Accept-Language": "ar,en;q=0.8",
          },
        });
      } catch {
        if (controller.signal.aborted) throw new FetchPageError("timeout", "The page took too long to respond");
        throw new FetchPageError("network", "Could not reach the page");
      }
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        await response.body?.cancel();
        current = new URL(response.headers.get("location")!, url).toString();
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new FetchPageError("http_error", `The page responded with HTTP ${response.status}`, response.status);
      }
      const contentType = response.headers.get("content-type") ?? "text/html";
      if (!HTML_TYPES.test(contentType) && !TEXT_TYPES.test(contentType)) {
        await response.body?.cancel();
        throw new FetchPageError("unsupported_type", `Unsupported content type: ${contentType.split(";")[0]}`);
      }
      const { bytes, cut } = await readLimited(response, maxBytes);
      const body = decode(bytes, contentType);
      const page = HTML_TYPES.test(contentType)
        ? extractReadable(body, url.toString())
        : { title: url.pathname.split("/").pop() || url.hostname, byline: null, excerpt: null, lang: null, siteName: null, text: body, links: [] };
      const truncated = cut || page.text.length > options.maxChars;
      return {
        url: url.toString(),
        status: response.status,
        contentType: contentType.split(";")[0]!.trim(),
        title: page.title,
        byline: page.byline,
        excerpt: page.excerpt,
        lang: page.lang,
        text: page.text.slice(0, options.maxChars),
        truncated,
        links: page.links.slice(0, 30),
      };
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
