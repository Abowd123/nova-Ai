// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FetchPageError, fetchPage, type FetchPageOptions } from "@/lib/web/fetch-page";
import { extractReadable } from "@/lib/web/readability";
import { decodeEntities, parseHtml, textContent } from "@/lib/web/html";

const ARTICLE = `<!doctype html><html lang="en"><head><title>Doc title</title><meta property="og:title" content="OG Title"><meta name="author" content="Ada"><style>p{}</style></head>
<body><nav class="menu"><a href="/">Home</a></nav><aside class="sidebar"><p>Subscribe to our newsletter today and never miss an update again ok.</p></aside>
<article><h2>Intro</h2><p>The first paragraph is long enough, with commas, and explains things in detail for the reader.</p>
<p>Second paragraph links to <a href="/docs">the docs</a>, which are relative and must be resolved properly.</p>
<pre>def f():
    return 1</pre></article><footer><p>Copyright 2026 Example Corp, all rights reserved worldwide forever.</p></footer>
<script>document.write("<p>injected</p>")</script></body></html>`;

describe("html + readability", () => {
  it("parses tolerant markup and entities", () => {
    const root = parseHtml("<p>a &amp; b<p>c &#x41; &#66;<br>d");
    expect(textContent(root)).toBe("a & bc A Bd");
    expect(decodeEntities("&laquo;x&raquo; &unknown;")).toBe("«x» &unknown;");
  });

  it("extracts the article and drops chrome", () => {
    const page = extractReadable(ARTICLE, "https://site.test/post/1");
    expect(page.title).toBe("OG Title");
    expect(page.byline).toBe("Ada");
    expect(page.lang).toBe("en");
    expect(page.text).toContain("## Intro");
    expect(page.text).toContain("the docs");
    expect(page.text).toContain("```\ndef f():\n    return 1\n```");
    expect(page.text).not.toContain("newsletter");
    expect(page.text).not.toContain("Copyright");
    expect(page.text).not.toContain("injected");
    expect(page.links).toEqual([{ url: "https://site.test/docs", text: "the docs" }]);
  });

  it("finds the main block without semantic tags (Arabic)", () => {
    const html = `<body><div class="nav"><a href="/a">رابط</a><a href="/b">رابط</a></div><div class="post-body"><p>هذه فقرة عربية طويلة، فيها فواصل، وتشرح فكرة المقال بوضوح للقارئ.</p><p>وهذه فقرة ثانية، طويلة أيضاً، تكمل الشرح وتضيف تفاصيل مهمة.</p></div></body>`;
    const page = extractReadable(html, "https://ar.test/");
    expect(page.text).toContain("هذه فقرة عربية طويلة");
    expect(page.text).not.toContain("رابط");
  });
});

function server(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const options: FetchPageOptions = {
    maxChars: 5000,
    blockedSites: ["blocked.test"],
    allowPrivate: false,
    lookup: async (host) => [{ address: host === "internal.test" ? "10.0.0.5" : "93.184.216.34" }],
    fetch: async (url) => {
      calls.push(url);
      const route = routes[url];
      if (!route) return new Response("nf", { status: 404 });
      return route();
    },
  };
  return { options, calls };
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as FetchPageError).code;
  }
  return "ok";
}

describe("fetchPage (SSRF-safe)", () => {
  it("downloads HTML, follows redirects and extracts text", async () => {
    const { options, calls } = server({
      "https://site.test/old": () => new Response(null, { status: 301, headers: { location: "/post" } }),
      "https://site.test/post": () => new Response(ARTICLE, { headers: { "content-type": "text/html; charset=utf-8" } }),
    });
    const page = await fetchPage("https://site.test/old", options);
    expect(calls).toEqual(["https://site.test/old", "https://site.test/post"]);
    expect(page).toMatchObject({ url: "https://site.test/post", title: "OG Title", contentType: "text/html", truncated: false });
  });

  it("rejects private, blocked and non-http targets, also after a redirect", async () => {
    const { options } = server({ "https://site.test/r": () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }) });
    expect(await code(fetchPage("http://127.0.0.1/", options))).toBe("private");
    expect(await code(fetchPage("https://internal.test/", options))).toBe("private");
    expect(await code(fetchPage("https://localhost/", options))).toBe("private");
    expect(await code(fetchPage("https://www.blocked.test/x", options))).toBe("blocked");
    expect(await code(fetchPage("file:///etc/passwd", options))).toBe("invalid_url");
    expect(await code(fetchPage("https://user:pw@site.test/", options))).toBe("invalid_url");
    expect(await code(fetchPage("https://site.test:22/", options))).toBe("blocked");
    expect(await code(fetchPage("https://site.test/r", options))).toBe("private");
  });

  it("limits redirects, size, types and reports HTTP errors", async () => {
    const loop = server({ "https://site.test/a": () => new Response(null, { status: 302, headers: { location: "/a" } }) });
    expect(await code(fetchPage("https://site.test/a", loop.options))).toBe("too_many_redirects");
    const big = server({ "https://site.test/big": () => new Response("x".repeat(2000), { headers: { "content-type": "text/plain" } }) });
    const page = await fetchPage("https://site.test/big", { ...big.options, maxBytes: 500 });
    expect(page.truncated).toBe(true);
    expect(page.text.length).toBe(500);
    const pdf = server({ "https://site.test/f.pdf": () => new Response("%PDF", { headers: { "content-type": "application/pdf" } }) });
    expect(await code(fetchPage("https://site.test/f.pdf", pdf.options))).toBe("unsupported_type");
    const gone = server({});
    expect(await code(fetchPage("https://site.test/none", gone.options))).toBe("http_error");
  });
});
