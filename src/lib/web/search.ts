import type { HttpClient } from "@/lib/ai/types";
import type { SearchProviderKind } from "@/lib/models";
import { redactSecrets } from "@/lib/security/redact";

export interface SearchQuery {
  query: string;
  count: number;
  language?: string;
  region?: string;
  excludeSites?: string[];
  signal?: AbortSignal;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  /** Provider relevance when reported (0..1). */
  score?: number;
}

export type SearchErrorCode = "not_configured" | "unauthorized" | "rate_limited" | "network" | "provider" | "aborted";

export class SearchError extends Error {
  constructor(
    readonly code: SearchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SearchError";
  }
}

export interface SearchProvider {
  readonly kind: SearchProviderKind;
  search(query: SearchQuery): Promise<SearchResult[]>;
}

async function request<T>(http: HttpClient, url: string, init: RequestInit, secrets: (string | undefined)[], signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await http(url, { ...init, signal });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw new SearchError("aborted", "Search cancelled");
    throw new SearchError("network", "Could not reach the search service");
  }
  const text = await response.text();
  if (!response.ok) {
    const code: SearchErrorCode = response.status === 401 || response.status === 403 ? "unauthorized" : response.status === 429 ? "rate_limited" : "provider";
    throw new SearchError(code, redactSecrets(`Search failed (HTTP ${response.status}): ${text.slice(0, 300)}`, secrets));
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SearchError("provider", "The search service returned invalid JSON");
  }
}

const clean = (text: string | undefined) =>
  (text ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

export class TavilySearch implements SearchProvider {
  readonly kind = "tavily" as const;
  constructor(
    private readonly http: HttpClient,
    private readonly apiKey: () => Promise<string | undefined>,
  ) {}

  async search(q: SearchQuery): Promise<SearchResult[]> {
    const key = await this.apiKey();
    if (!key) throw new SearchError("not_configured", "Tavily API key is missing");
    const json = await request<{ results?: { title?: string; url?: string; content?: string; score?: number; published_date?: string }[] }>(
      this.http,
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          query: q.query,
          max_results: q.count,
          search_depth: "basic",
          include_answer: false,
          ...(q.excludeSites?.length ? { exclude_domains: q.excludeSites } : {}),
          ...(q.region ? { country: q.region } : {}),
        }),
      },
      [key],
      q.signal,
    );
    return (json.results ?? []).filter((r) => r.url).map((r) => ({ title: clean(r.title) || r.url!, url: r.url!, snippet: clean(r.content), score: r.score, publishedAt: r.published_date }));
  }
}

export class BraveSearch implements SearchProvider {
  readonly kind = "brave" as const;
  constructor(
    private readonly http: HttpClient,
    private readonly apiKey: () => Promise<string | undefined>,
  ) {}

  async search(q: SearchQuery): Promise<SearchResult[]> {
    const key = await this.apiKey();
    if (!key) throw new SearchError("not_configured", "Brave Search API key is missing");
    const params = new URLSearchParams({ q: withExclusions(q.query, q.excludeSites), count: String(Math.min(20, q.count)) });
    if (q.language) params.set("search_lang", q.language);
    if (q.region) params.set("country", q.region.toUpperCase());
    const json = await request<{ web?: { results?: { title?: string; url?: string; description?: string; age?: string }[] } }>(
      this.http,
      `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
      { method: "GET", headers: { Accept: "application/json", "X-Subscription-Token": key } },
      [key],
      q.signal,
    );
    return (json.web?.results ?? []).filter((r) => r.url).map((r) => ({ title: clean(r.title) || r.url!, url: r.url!, snippet: clean(r.description), publishedAt: r.age }));
  }
}

export class ExaSearch implements SearchProvider {
  readonly kind = "exa" as const;
  constructor(
    private readonly http: HttpClient,
    private readonly apiKey: () => Promise<string | undefined>,
  ) {}

  async search(q: SearchQuery): Promise<SearchResult[]> {
    const key = await this.apiKey();
    if (!key) throw new SearchError("not_configured", "Exa API key is missing");
    const json = await request<{ results?: { title?: string; url?: string; text?: string; highlights?: string[]; score?: number; publishedDate?: string }[] }>(
      this.http,
      "https://api.exa.ai/search",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key },
        body: JSON.stringify({
          query: q.query,
          numResults: q.count,
          type: "auto",
          ...(q.excludeSites?.length ? { excludeDomains: q.excludeSites } : {}),
          contents: { text: { maxCharacters: 600 } },
        }),
      },
      [key],
      q.signal,
    );
    return (json.results ?? []).filter((r) => r.url).map((r) => ({ title: clean(r.title) || r.url!, url: r.url!, snippet: clean(r.highlights?.join(" … ") || r.text), score: r.score, publishedAt: r.publishedDate }));
  }
}

export class SearxngSearch implements SearchProvider {
  readonly kind = "searxng" as const;
  constructor(
    private readonly http: HttpClient,
    private readonly baseUrl: () => string,
  ) {}

  async search(q: SearchQuery): Promise<SearchResult[]> {
    const base = this.baseUrl().trim().replace(/\/+$/, "");
    if (!base) throw new SearchError("not_configured", "SearXNG URL is missing");
    const params = new URLSearchParams({ q: withExclusions(q.query, q.excludeSites), format: "json", pageno: "1", safesearch: "1" });
    if (q.language) params.set("language", q.region ? `${q.language}-${q.region.toUpperCase()}` : q.language);
    const json = await request<{ results?: { title?: string; url?: string; content?: string; score?: number; publishedDate?: string }[] }>(
      this.http,
      `${base}/search?${params.toString()}`,
      { method: "GET", headers: { Accept: "application/json" } },
      [],
      q.signal,
    );
    return (json.results ?? []).filter((r) => r.url).slice(0, q.count * 2).map((r) => ({ title: clean(r.title) || r.url!, url: r.url!, snippet: clean(r.content), publishedAt: r.publishedDate ?? undefined }));
  }
}

function withExclusions(query: string, sites: string[] | undefined): string {
  return [query, ...(sites ?? []).slice(0, 20).map((s) => `-site:${s}`)].join(" ");
}

/** host matches "example.com" or any subdomain of it ("*.example.com" accepted too). */
export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  const p = pattern.toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
  return h === p || h.endsWith(`.${p}`);
}

export function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_eid|ref$)/i.test(key)) url.searchParams.delete(key);
    url.hostname = url.hostname.replace(/^www\./, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * Cleans and ranks provider results: drops non-http, excluded/blocked hosts and duplicates,
 * then re-ranks by provider order blended with query-term overlap in title and snippet.
 */
export function rankResults(results: SearchResult[], query: string, options: { count: number; excludeSites?: string[]; blockedSites?: string[] }): SearchResult[] {
  const blocked = [...(options.excludeSites ?? []), ...(options.blockedSites ?? [])];
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
  const seen = new Set<string>();
  const scored: { result: SearchResult; score: number }[] = [];
  results.forEach((result, position) => {
    const key = normalizeUrl(result.url);
    if (!key || seen.has(key)) return;
    const host = new URL(result.url).hostname;
    if (blocked.some((pattern) => hostMatches(host, pattern))) return;
    seen.add(key);
    const haystack = `${result.title} ${result.snippet}`.toLowerCase();
    const overlap = terms.length ? terms.filter((t) => haystack.includes(t)).length / terms.length : 0;
    const order = 1 / (1 + position);
    scored.push({ result, score: 0.6 * order + 0.4 * overlap + (result.score ?? 0) * 0.1 });
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, options.count)
    .map((s) => s.result);
}

/** Model-facing text with numbered sources the model is asked to cite as [n]. */
export function formatSearchResults(query: string, results: SearchResult[]): string {
  if (!results.length) return `No results for "${query}".`;
  const lines = results.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}${r.publishedAt ? `\nDate: ${r.publishedAt}` : ""}\n${r.snippet.slice(0, 600)}`);
  return `Search results for "${query}". Cite sources inline as [n] using the numbers below; use fetch_url to read a page in full.\n\n${lines.join("\n\n")}`;
}
