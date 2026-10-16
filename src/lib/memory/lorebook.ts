import { estimateTokens } from "@/lib/context/tokens";
import type { LoreEntry, Lorebook } from "@/lib/models";
import { normalizeForSearch } from "@/lib/text";

export interface LoreMatch {
  lorebookId: string;
  entryId: string;
  content: string;
  priority: number;
  tokens: number;
  keyword: string;
}

const ARABIC = /[\u0600-\u06ff]/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Optional conjunction (و/ف) then optional preposition/article: وبالـ، فللـ، كالـ… */
const PROCLITICS = "(?:[وف])?(?:بال|كال|لل|ال|ب|ك|ل)?";
const ENCLITICS = "(?:هما|كما|ها|هم|هن|كم|كن|نا|ات|ون|ين|ان|ه|ي|ك)?";

/**
 * Keyword -> regex. Latin keywords match whole words (optionally plural "s"); Arabic keywords
 * tolerate attached prefixes (و ف ب ك ل ال…) and pronoun/plural suffixes, after
 * diacritic/alef/ta-marbuta normalization — so "المكتبة" and "بمكتبتها" both hit "مكتبة".
 */
export function keywordPattern(keyword: string, caseSensitive: boolean): RegExp {
  const base = caseSensitive ? keyword.trim() : normalizeForSearch(keyword);
  if (ARABIC.test(base)) {
    const body = escape(base.replace(/^ال(?=.{3,})/, "")).replace(/[هة]$/, "[هةت]");
    return new RegExp(`(?<![\\p{L}\\p{N}])${PROCLITICS}${body}${ENCLITICS}(?![\\p{L}\\p{N}])`, "u");
  }
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escape(base)}(?:s|es)?(?![\\p{L}\\p{N}_])`, caseSensitive ? "u" : "iu");
}

function applies(book: Lorebook, context: { assistantId: string | null; conversationId: string | null }): boolean {
  if (!book.enabled) return false;
  if (book.assistantId && book.assistantId !== context.assistantId) return false;
  if (book.conversationId && book.conversationId !== context.conversationId) return false;
  return true;
}

function findKeyword(entry: LoreEntry, normalized: string, raw: string): string | null {
  for (const keyword of entry.keywords) {
    if (keywordPattern(keyword, entry.caseSensitive).test(entry.caseSensitive ? raw : normalized)) return keyword;
  }
  return null;
}

/**
 * Scans the last `scanDepth` messages of each applicable lorebook for entry keywords and
 * returns triggered entries: priority order (then entry order), each book within its
 * tokenBudget. Lower-priority entries that don't fit are skipped, smaller ones may still fit.
 */
export function matchLorebooks(
  books: readonly Lorebook[],
  recentTexts: readonly string[],
  context: { assistantId: string | null; conversationId: string | null },
): LoreMatch[] {
  const matches: LoreMatch[] = [];
  for (const book of books) {
    if (!applies(book, context)) continue;
    const raw = recentTexts.slice(-book.scanDepth).join("\n");
    if (!raw.trim()) continue;
    const normalized = normalizeForSearch(raw);
    const triggered = book.entries
      .map((entry, order) => ({ entry, order }))
      .filter(({ entry }) => entry.enabled)
      .map(({ entry, order }) => ({ entry, order, keyword: findKeyword(entry, normalized, raw) }))
      .filter((x): x is { entry: LoreEntry; order: number; keyword: string } => x.keyword !== null)
      .sort((a, b) => b.entry.priority - a.entry.priority || a.order - b.order);
    let budget = book.tokenBudget;
    for (const { entry, keyword } of triggered) {
      const tokens = estimateTokens(entry.content);
      if (tokens > budget) continue;
      budget -= tokens;
      matches.push({ lorebookId: book.id, entryId: entry.id, content: entry.content, priority: entry.priority, tokens, keyword });
    }
  }
  return matches.sort((a, b) => b.priority - a.priority);
}
