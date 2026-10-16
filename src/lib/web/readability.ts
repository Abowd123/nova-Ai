import { find, parseHtml, textContent, walk, type HtmlElement, type HtmlNode } from "./html";

export interface ExtractedPage {
  title: string;
  byline: string | null;
  excerpt: string | null;
  lang: string | null;
  siteName: string | null;
  /** Readable text (light markdown: headings, lists, code fences). */
  text: string;
  /** Links found in the article (absolute, deduped, max 50). */
  links: { text: string; url: string }[];
}

const REMOVE = new Set(["script", "style", "noscript", "template", "svg", "canvas", "iframe", "object", "embed", "form", "button", "input", "select", "textarea", "nav", "footer", "aside", "dialog", "menu", "link", "meta"]);
const UNLIKELY = /(^|[\s_-])(comment|disqus|share|social|sidebar|footer|nav|menu|cookie|consent|banner|advert|ads?|promo|related|recommend|subscribe|newsletter|popup|modal|breadcrumb|pagination|masthead|sponsor|widget|skip)([\s_-]|$)/i;
const LIKELY = /article|content|main|post|body|text|story|entry|blog|prose/i;
const POSITIVE = /article|body|content|entry|main|page|post|text|blog|story|prose/i;
const NEGATIVE = /hidden|comment|footer|footnote|masthead|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|tool|widget|nav|menu/i;
const BLOCKS = new Set(["p", "div", "section", "article", "main", "blockquote", "pre", "ul", "ol", "li", "table", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "figure", "figcaption", "dl", "dt", "dd", "hr", "br", "header", "details", "summary"]);

function attr(el: HtmlElement, name: string): string {
  return el.attrs[name] ?? "";
}

function classId(el: HtmlElement): string {
  return `${attr(el, "class")} ${attr(el, "id")}`;
}

function isHidden(el: HtmlElement): boolean {
  return "hidden" in el.attrs || attr(el, "aria-hidden") === "true" || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attr(el, "style"));
}

function prune(el: HtmlElement): void {
  el.children = el.children.filter((child) => {
    if (child.type === "text") return true;
    if (REMOVE.has(child.tag) || isHidden(child)) return false;
    const ci = classId(child);
    if (child.tag !== "body" && child.tag !== "article" && child.tag !== "main" && UNLIKELY.test(ci) && !LIKELY.test(ci)) return false;
    if (attr(child, "role") === "navigation" || attr(child, "role") === "complementary") return false;
    prune(child);
    return true;
  });
}

const textLength = (el: HtmlNode) => textContent(el).replace(/\s+/g, " ").trim().length;

function linkDensity(el: HtmlElement): number {
  const total = textLength(el);
  if (!total) return 0;
  let links = 0;
  for (const a of walk(el)) if (a.tag === "a") links += textLength(a);
  return links / total;
}

function classWeight(el: HtmlElement): number {
  const ci = classId(el);
  let weight = 0;
  if (POSITIVE.test(ci)) weight += 25;
  if (NEGATIVE.test(ci)) weight -= 25;
  return weight;
}

/** Readability-style scoring: paragraphs vote for their parent (full) and grandparent (half). */
function bestCandidate(body: HtmlElement): HtmlElement {
  const scores = new Map<HtmlElement, number>();
  const init = (el: HtmlElement) => {
    if (!scores.has(el)) {
      const base = el.tag === "div" || el.tag === "article" || el.tag === "section" || el.tag === "main" ? 5 : el.tag === "pre" || el.tag === "td" || el.tag === "blockquote" ? 3 : 0;
      scores.set(el, base + classWeight(el));
    }
  };
  for (const el of walk(body)) {
    if (!["p", "pre", "td", "blockquote", "li"].includes(el.tag)) continue;
    const text = textContent(el).replace(/\s+/g, " ").trim();
    if (text.length < 25) continue;
    const score = 1 + text.split(/[,،]/).length + Math.min(3, Math.floor(text.length / 100));
    const parent = el.parent;
    const grand = parent?.parent;
    if (parent && parent.tag !== "#root") {
      init(parent);
      scores.set(parent, scores.get(parent)! + score);
    }
    if (grand && grand.tag !== "#root") {
      init(grand);
      scores.set(grand, scores.get(grand)! + score / 2);
    }
  }
  let best: HtmlElement = body;
  let bestScore = -Infinity;
  for (const [el, score] of scores) {
    const final = score * (1 - linkDensity(el));
    if (final > bestScore) {
      bestScore = final;
      best = el;
    }
  }
  // A candidate that is just one of several equally good siblings: climb to the shared parent.
  if (best !== body && best.parent && best.parent.tag !== "#root" && best.parent.tag !== "html") {
    const siblings = best.parent.children.filter((c): c is HtmlElement => c.type === "element" && c !== best && (scores.get(c) ?? 0) * (1 - linkDensity(c)) > bestScore * 0.4);
    if (siblings.length) best = best.parent;
  }
  return best;
}

function resolveUrl(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Renders a subtree to readable text with light markdown. */
function render(el: HtmlElement, base: string, links: Map<string, string>): string {
  const out: string[] = [];
  const visit = (node: HtmlNode, inPre: boolean, listDepth: number) => {
    if (node.type === "text") {
      out.push(inPre ? node.text : node.text.replace(/\s+/g, " "));
      return;
    }
    const tag = node.tag;
    if (tag === "br") return void out.push("\n");
    if (tag === "hr") return void out.push("\n\n---\n\n");
    if (tag === "img") {
      const alt = attr(node, "alt").trim();
      if (alt) out.push(` ${alt} `);
      return;
    }
    if (tag === "pre") {
      const code = textContent(node).replace(/\n+$/, "");
      out.push(`\n\n\`\`\`\n${code}\n\`\`\`\n\n`);
      return;
    }
    const heading = /^h([1-6])$/.exec(tag);
    if (heading) out.push(`\n\n${"#".repeat(Number(heading[1]))} `);
    else if (tag === "li") out.push(`\n${"  ".repeat(Math.max(0, listDepth - 1))}- `);
    else if (tag === "blockquote") out.push("\n\n> ");
    else if (tag === "td" || tag === "th") out.push(" | ");
    else if (BLOCKS.has(tag)) out.push("\n\n");
    if (tag === "code" && !inPre) out.push("`");
    if (tag === "a") {
      const url = resolveUrl(attr(node, "href"), base);
      const label = textContent(node).replace(/\s+/g, " ").trim();
      if (url && label && links.size < 50 && !links.has(url)) links.set(url, label.slice(0, 200));
    }
    const nextDepth = tag === "ul" || tag === "ol" ? listDepth + 1 : listDepth;
    for (const child of node.children) visit(child, inPre || tag === "pre", nextDepth);
    if (tag === "code" && !inPre) out.push("`");
    if (heading || (BLOCKS.has(tag) && tag !== "li" && tag !== "td" && tag !== "th")) out.push("\n\n");
  };
  visit(el, false, 0);
  // Whitespace cleanup outside code fences only (indentation inside code matters).
  return out
    .join("")
    .split(/(\n```\n[\s\S]*?\n```\n)/)
    .map((segment, i) => (i % 2 === 1 ? segment : segment.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+(?=[^\s-])/g, "\n").replace(/[ \t]{2,}/g, " ")))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function meta(root: HtmlElement, ...names: string[]): string | null {
  for (const name of names) {
    const el = find(root, (e) => e.tag === "meta" && (attr(e, "property") === name || attr(e, "name") === name));
    const content = el ? attr(el, "content").trim() : "";
    if (content) return content;
  }
  return null;
}

/** Extracts the main readable content of an HTML page (Readability-style heuristics). */
export function extractReadable(html: string, pageUrl: string): ExtractedPage {
  const root = parseHtml(html);
  const titleEl = find(root, (e) => e.tag === "title");
  const htmlEl = find(root, (e) => e.tag === "html");
  const ogTitle = meta(root, "og:title", "twitter:title");
  const docTitle = titleEl ? textContent(titleEl).replace(/\s+/g, " ").trim() : "";
  const result = {
    byline: meta(root, "author", "article:author", "twitter:creator"),
    excerpt: meta(root, "description", "og:description", "twitter:description"),
    siteName: meta(root, "og:site_name", "application-name"),
    lang: htmlEl ? attr(htmlEl, "lang") || null : null,
  };
  const body = find(root, (e) => e.tag === "body") ?? root;
  prune(body);
  const h1 = find(body, (e) => e.tag === "h1");
  const title = ogTitle || docTitle || (h1 ? textContent(h1).trim() : "") || pageUrl;

  // Prefer explicit semantic containers when they hold enough text.
  const semantic = [...walk(body)].filter((e) => e.tag === "article" || e.tag === "main" || attr(e, "role") === "main" || attr(e, "itemprop") === "articleBody").sort((a, b) => textLength(b) - textLength(a))[0];
  const container = semantic && textLength(semantic) >= 400 ? semantic : bestCandidate(body);
  const links = new Map<string, string>();
  let text = render(container, pageUrl, links);
  if (text.length < 200 && container !== body) {
    links.clear();
    text = render(body, pageUrl, links);
  }
  return { title, ...result, text, links: [...links].map(([url, label]) => ({ url, text: label })) };
}
