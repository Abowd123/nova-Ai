const MAX_TITLE = 60;

/** Instant title from the first user message (refined later by the model if enabled). */
export function titleFromText(text: string, max = MAX_TITLE): string {
  const firstLine =
    text
      .replace(/```[\s\S]*?(```|$)/g, " ")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  const plain = firstLine
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|$]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "";
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** Cleans a model-generated title: removes quotes, prefixes, trailing punctuation. */
export function cleanGeneratedTitle(raw: string, max = MAX_TITLE): string {
  const line =
    raw
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  const unquote = (value: string) => value.replace(/^["'«“”‘’`*#\s]+|["'»“”‘’`*\s]+$/g, "");
  const cleaned = unquote(unquote(line).replace(/^(title|العنوان)\s*[:：-]\s*/i, ""))
    .replace(/[.。!؟?]+$/u, "")
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max).trim()}…` : cleaned;
}

export const TITLE_PROMPT =
  "Write a short title (max 6 words) for this conversation, in the same language as the user. " +
  "Reply with the title only: no quotes, no punctuation at the end.";
