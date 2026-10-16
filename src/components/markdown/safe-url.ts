const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const SAFE_IMAGE_PROTOCOLS = new Set(["https:", "http:"]);

/** Strips control/whitespace chars browsers ignore inside schemes ("java\tscript:"). */
function normalize(raw: string): string {
  return raw.replace(/[\x00-\x20\u007f-\u009f\u200b-\u200f\u2028-\u202f\ufeff]/g, "").trim();
}

function decodeEntities(raw: string): string {
  return raw
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&colon;?/gi, ":")
    .replace(/&tab;?/gi, "\t")
    .replace(/&newline;?/gi, "\n");
}

function isRelative(url: string): boolean {
  return url.startsWith("#") || url.startsWith("/") || url.startsWith("./") || url.startsWith("../") || !/^[a-z][a-z0-9+.-]*:/i.test(url);
}

/** Returns a safe href or an empty string (react-markdown then drops the attribute). */
export function safeLinkUrl(raw: string): string {
  const cleaned = normalize(decodeEntities(raw));
  if (!cleaned) return "";
  if (cleaned.startsWith("//")) return ""; // protocol-relative: ambiguous target
  if (isRelative(cleaned)) return cleaned.startsWith("#") ? cleaned : "";
  try {
    const url = new URL(cleaned);
    return SAFE_LINK_PROTOCOLS.has(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

/** Images: absolute http(s) only. No data:, blob:, svg scripts or relative paths. */
export function safeImageUrl(raw: string): string {
  const cleaned = normalize(decodeEntities(raw));
  try {
    const url = new URL(cleaned);
    return SAFE_IMAGE_PROTOCOLS.has(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export function urlTransform(url: string, key: string, node: { tagName?: string }): string {
  if (node.tagName === "img" || key === "src") return safeImageUrl(url);
  return safeLinkUrl(url);
}
