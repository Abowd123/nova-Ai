import { describe, expect, it } from "vitest";
import { BraveSearch, ExaSearch, SearchError, SearxngSearch, TavilySearch, formatSearchResults, hostMatches, normalizeUrl, rankResults } from "@/lib/web/search";

function http(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    client: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    },
  };
}

async function caught(promise: Promise<unknown>): Promise<SearchError> {
  try {
    await promise;
  } catch (error) {
    return error as SearchError;
  }
  throw new Error("expected rejection");
}

describe("search providers", () => {
  it("Tavily: POST with bearer key, exclude_domains", async () => {
    const fake = http({ results: [{ title: "A &amp; B", url: "https://a.test", content: "<b>snippet</b>", score: 0.9 }] });
    const results = await new TavilySearch(fake.client, async () => "tvly-key-123456").search({ query: "q", count: 3, excludeSites: ["x.com"] });
    expect(fake.calls[0]!.url).toBe("https://api.tavily.com/search");
    expect((fake.calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tvly-key-123456");
    expect(JSON.parse(fake.calls[0]!.init.body as string)).toMatchObject({ query: "q", max_results: 3, exclude_domains: ["x.com"] });
    expect(results).toEqual([{ title: "A & B", url: "https://a.test", snippet: "snippet", score: 0.9, publishedAt: undefined }]);
  });

  it("Brave: GET with subscription token, language/country and -site:", async () => {
    const fake = http({ web: { results: [{ title: "T", url: "https://b.test", description: "d" }] } });
    await new BraveSearch(fake.client, async () => "brave-key").search({ query: "news", count: 5, language: "ar", region: "sa", excludeSites: ["spam.test"] });
    const url = new URL(fake.calls[0]!.url);
    expect(url.origin + url.pathname).toBe("https://api.search.brave.com/res/v1/web/search");
    expect(url.searchParams.get("q")).toBe("news -site:spam.test");
    expect(url.searchParams.get("search_lang")).toBe("ar");
    expect(url.searchParams.get("country")).toBe("SA");
    expect((fake.calls[0]!.init.headers as Record<string, string>)["X-Subscription-Token"]).toBe("brave-key");
  });

  it("Exa and SearXNG request shapes", async () => {
    const exa = http({ results: [{ title: "E", url: "https://e.test", highlights: ["h1", "h2"] }] });
    const r = await new ExaSearch(exa.client, async () => "exa-key").search({ query: "q", count: 2 });
    expect((exa.calls[0]!.init.headers as Record<string, string>)["x-api-key"]).toBe("exa-key");
    expect(r[0]!.snippet).toBe("h1 … h2");
    const searx = http({ results: [{ title: "S", url: "https://s.test", content: "c" }] });
    await new SearxngSearch(searx.client, () => "https://searx.local/").search({ query: "q", count: 2, language: "en" });
    expect(searx.calls[0]!.url).toContain("https://searx.local/search?q=q&format=json");
  });

  it("maps errors and missing configuration", async () => {
    expect((await caught(new TavilySearch(http({}).client, async () => undefined).search({ query: "q", count: 1 }))).code).toBe("not_configured");
    expect((await caught(new BraveSearch(http({}, 401).client, async () => "k").search({ query: "q", count: 1 }))).code).toBe("unauthorized");
    expect((await caught(new BraveSearch(http({}, 429).client, async () => "k").search({ query: "q", count: 1 }))).code).toBe("rate_limited");
    expect((await caught(new SearxngSearch(http({}).client, () => "").search({ query: "q", count: 1 }))).code).toBe("not_configured");
  });
});

describe("ranking and formatting", () => {
  it("dedupes, blocks hosts and boosts relevant results", () => {
    const results = rankResults(
      [
        { title: "Unrelated", url: "https://a.test/1", snippet: "nothing" },
        { title: "Nova assistant release", url: "https://b.test/nova?utm_source=x", snippet: "nova assistant" },
        { title: "Duplicate", url: "https://www.b.test/nova", snippet: "nova" },
        { title: "Blocked", url: "https://ads.spam.test/", snippet: "nova assistant" },
        { title: "bad", url: "javascript:alert(1)", snippet: "" },
      ],
      "nova assistant",
      { count: 5, blockedSites: ["spam.test"] },
    );
    expect(results.map((r) => r.title)).toEqual(["Nova assistant release", "Unrelated"]);
  });

  it("helpers", () => {
    expect(hostMatches("news.example.com", "example.com")).toBe(true);
    expect(hostMatches("badexample.com", "example.com")).toBe(false);
    expect(hostMatches("a.b.c", "*.b.c")).toBe(true);
    expect(normalizeUrl("https://www.x.test/a/?utm_medium=1#top")).toBe("https://x.test/a");
    expect(formatSearchResults("q", [{ title: "T", url: "https://t.test", snippet: "s" }])).toContain("[1] T\nURL: https://t.test\ns");
    expect(formatSearchResults("q", [])).toBe('No results for "q".');
  });
});
