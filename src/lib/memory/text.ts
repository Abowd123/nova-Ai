import { normalizeForSearch } from "@/lib/text";

/** Very common words that carry no meaning for keyword ranking. */
const STOPWORDS = new Set([
  // English
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "it", "its", "this", "that", "these", "those", "as", "if", "then", "so", "do", "does", "did", "i", "you", "he", "she", "we", "they", "me",
  "my", "your", "our", "their", "what", "which", "who", "how", "can", "could", "would", "should", "will", "not", "no", "yes", "about",
  // Arabic (normalized: ة→ه, ى→ي, أإآ→ا)
  "في", "من", "الي", "علي", "عن", "مع", "هذا", "هذه", "ذلك", "تلك", "التي", "الذي", "الذين", "هو", "هي", "هم", "انا", "انت", "نحن",
  "ان", "او", "ثم", "لا", "لم", "لن", "ما", "ماذا", "كيف", "هل", "قد", "كان", "كانت", "يكون", "كل", "بعض", "اي", "اذا", "لكن", "بين", "عند", "و",
]);

/** Arabic proclitics stripped for matching (و ف ب ك ل ال وال بال كال فال لل). */
const ARABIC_PREFIX = /^(?:[وف]?(?:بال|كال|لل|ال)|[وف][بكل]?|[بكل])(?=[\u0621-\u064a]{3,})/;
/** Frequent Arabic suffixes (pronouns, plurals). */
const ARABIC_SUFFIX = /(?:هما|كما|ها|هم|هن|كم|كن|نا|ات|ون|ين|ان|يه|ه|ي|ك)$/;

/** Light stemming: keeps roots comparable without a dictionary. */
export function stem(token: string): string {
  if (/[\u0621-\u064a]/.test(token)) {
    let t = token.replace(ARABIC_PREFIX, "");
    if (t.length > 4) t = t.replace(ARABIC_SUFFIX, "");
    return t;
  }
  if (token.length > 4) {
    if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
    if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
    if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
    if (token.endsWith("es") && /(?:s|x|z|ch|sh)es$/.test(token)) return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith("s") && !/(?:ss|us|is)$/.test(token)) return token.slice(0, -1);
  return token;
}

/** Normalized, stemmed keyword tokens (Arabic + Latin + digits). */
export function tokenize(text: string): string[] {
  const normalized = normalizeForSearch(text);
  const raw = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const tokens: string[] = [];
  for (const word of raw) {
    if (word.length < 2 && !/\d/.test(word)) continue;
    if (STOPWORDS.has(word)) continue;
    tokens.push(stem(word));
  }
  return tokens;
}

/** FNV-1a 64-bit (as hex) — fast dedupe key, not a security hash. */
export function hashText(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function memoryHash(text: string, owner: { scope: string; assistantId?: string | null; conversationId?: string | null }): string {
  const key = owner.scope === "global" ? "g" : owner.scope === "assistant" ? `a:${owner.assistantId ?? ""}` : `c:${owner.conversationId ?? ""}`;
  return `${key.length > 40 ? hashText(key) : key}|${hashText(normalizeForSearch(text))}`;
}
