/**
 * Minimal, dependency-free XML reader for WebDAV multistatus responses.
 * Namespace prefixes are dropped (local names only): "d:href" and "D:href" both become "href".
 * No DTDs or external entities are processed (XXE-safe by construction).
 */
export interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const localName = (qualified: string) => {
  const index = qualified.indexOf(":");
  return (index >= 0 ? qualified.slice(index + 1) : qualified).toLowerCase();
};

export function parseXml(source: string): XmlElement {
  if (source.length > 20 * 1024 * 1024) throw new Error("XML response is too large");
  const root: XmlElement = { name: "#document", attributes: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf("<", i);
    const top = stack[stack.length - 1]!;
    if (lt < 0) {
      top.text += decodeXmlEntities(source.slice(i));
      break;
    }
    if (lt > i) top.text += decodeXmlEntities(source.slice(i, lt));
    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      i = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", lt)) {
      const end = source.indexOf("]]>", lt + 9);
      top.text += source.slice(lt + 9, end < 0 ? source.length : end);
      i = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith("<?", lt) || source.startsWith("<!", lt)) {
      const end = source.indexOf(">", lt);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    const end = source.indexOf(">", lt);
    if (end < 0) throw new Error("Malformed XML");
    const raw = source.slice(lt + 1, end);
    i = end + 1;
    if (raw.startsWith("/")) {
      const name = localName(raw.slice(1).trim());
      // Pop to the matching element (tolerates sloppy servers).
      for (let s = stack.length - 1; s > 0; s -= 1) {
        if (stack[s]!.name === name) {
          stack.length = s;
          break;
        }
      }
      continue;
    }
    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameMatch = /^\s*([^\s/>]+)/.exec(body);
    if (!nameMatch) continue;
    const element: XmlElement = { name: localName(nameMatch[1]!), attributes: {}, children: [], text: "" };
    const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let match: RegExpExecArray | null;
    const rest = body.slice(nameMatch[0].length);
    while ((match = attrRe.exec(rest))) element.attributes[match[1]!.toLowerCase()] = decodeXmlEntities(match[3] ?? match[4] ?? "");
    top.children.push(element);
    if (!selfClosing) stack.push(element);
  }
  return root;
}

export function child(element: XmlElement | undefined, name: string): XmlElement | undefined {
  return element?.children.find((c) => c.name === name);
}

export function children(element: XmlElement | undefined, name: string): XmlElement[] {
  return element?.children.filter((c) => c.name === name) ?? [];
}

/** Depth-first search for every descendant with this local name. */
export function descendants(element: XmlElement, name: string, out: XmlElement[] = []): XmlElement[] {
  for (const c of element.children) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}

export function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}
