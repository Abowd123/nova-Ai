/** Tiny, dependency-free HTML parser good enough for article extraction (server and tests). */

export interface HtmlElement {
  type: "element";
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
  parent: HtmlElement | null;
}

export interface HtmlText {
  type: "text";
  text: string;
  parent: HtmlElement | null;
}

export type HtmlNode = HtmlElement | HtmlText;

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
/** Raw-text elements: their content is never parsed as markup. */
const RAW = new Set(["script", "style", "textarea", "title", "noscript", "template", "xmp"]);
/** Opening one of these implicitly closes an open <p> / <li> / etc. */
const AUTO_CLOSE: Record<string, string[]> = {
  p: ["p"],
  li: ["li"],
  dt: ["dt", "dd"],
  dd: ["dt", "dd"],
  tr: ["tr", "td", "th"],
  td: ["td", "th"],
  th: ["td", "th"],
  option: ["option"],
};
const BLOCK_CLOSES_P = new Set(["address", "article", "aside", "blockquote", "div", "dl", "fieldset", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "pre", "section", "table", "ul", "figure"]);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", bull: "•", middot: "·", times: "×" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) attrs[m[1]!.toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return attrs;
}

export function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = { type: "element", tag: "#root", attrs: {}, children: [], parent: null };
  let current = root;
  const tagRe = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<\/?([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const text = (value: string) => {
    if (value) current.children.push({ type: "text", text: decodeEntities(value), parent: current });
  };
  const close = (tag: string) => {
    let node: HtmlElement | null = current;
    while (node && node.tag !== tag) node = node.parent;
    if (node && node.parent) current = node.parent;
  };
  while ((m = tagRe.exec(html))) {
    text(html.slice(last, m.index));
    last = tagRe.lastIndex;
    const name = m[1]?.toLowerCase();
    if (!name) continue; // comment / doctype
    const isClose = m[0][1] === "/";
    if (isClose) {
      close(name);
      continue;
    }
    for (const closes of [AUTO_CLOSE[name] ?? [], BLOCK_CLOSES_P.has(name) ? ["p"] : []]) {
      if (closes.includes(current.tag)) current = current.parent ?? root;
    }
    const element: HtmlElement = { type: "element", tag: name, attrs: parseAttrs(m[2] ?? ""), children: [], parent: current };
    current.children.push(element);
    if (RAW.has(name)) {
      const end = html.toLowerCase().indexOf(`</${name}`, last);
      const stop = end === -1 ? html.length : end;
      element.children.push({ type: "text", text: name === "title" || name === "textarea" ? decodeEntities(html.slice(last, stop)) : html.slice(last, stop), parent: element });
      const gt = end === -1 ? html.length : html.indexOf(">", end);
      last = gt === -1 ? html.length : gt + 1;
      tagRe.lastIndex = last;
      continue;
    }
    if (!VOID.has(name) && !/\/\s*$/.test(m[2] ?? "")) current = element;
  }
  text(html.slice(last));
  return root;
}

export function* walk(node: HtmlElement): Generator<HtmlElement> {
  for (const child of node.children) {
    if (child.type === "element") {
      yield child;
      yield* walk(child);
    }
  }
}

export function find(node: HtmlElement, predicate: (el: HtmlElement) => boolean): HtmlElement | undefined {
  for (const el of walk(node)) if (predicate(el)) return el;
  return undefined;
}

export function textContent(node: HtmlNode): string {
  if (node.type === "text") return node.text;
  if (node.tag === "script" || node.tag === "style" || node.tag === "template") return "";
  return node.children.map(textContent).join("");
}
