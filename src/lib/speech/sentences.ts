const TERMINATORS = /([.!?؟。！？…]+["'”»)\]]*)(\s+|$)/g;

/**
 * Splits text into speakable chunks: sentences (Latin + Arabic punctuation), each no longer
 * than maxLength (long ones are split at commas/semicolons, then spaces). Very short pieces are
 * merged with the next one so playback doesn't stutter.
 */
export function splitSentences(text: string, options: { maxLength?: number; minLength?: number } = {}): string[] {
  const maxLength = options.maxLength ?? 280;
  const minLength = options.minLength ?? 24;
  const sentences: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    let last = 0;
    for (const match of trimmed.matchAll(TERMINATORS)) {
      const end = (match.index ?? 0) + match[1]!.length;
      // Avoid splitting decimals like 3.14 (no whitespace after the dot -> regex already requires \s or end).
      sentences.push(trimmed.slice(last, end).trim());
      last = end;
    }
    if (last < trimmed.length) sentences.push(trimmed.slice(last).trim());
  }

  const bounded = sentences.filter(Boolean).flatMap((sentence) => splitLong(sentence, maxLength));
  const merged: string[] = [];
  for (const piece of bounded) {
    const previous = merged.at(-1);
    if (previous !== undefined && previous.length < minLength && previous.length + piece.length + 1 <= maxLength) {
      merged[merged.length - 1] = `${previous} ${piece}`;
    } else {
      merged.push(piece);
    }
  }
  return merged;
}

function splitLong(sentence: string, maxLength: number): string[] {
  if (sentence.length <= maxLength) return [sentence];
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > maxLength) {
    const window = rest.slice(0, maxLength);
    let cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf("، "), window.lastIndexOf("; "), window.lastIndexOf("؛ "));
    if (cut < maxLength * 0.4) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = maxLength - 1;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Streaming helper: feed growing text, get completed sentences once. */
export class SentenceBuffer {
  private consumed = 0;

  constructor(private readonly options: { maxLength?: number } = {}) {}

  /** Returns sentences that are complete in `fullText` and not returned before. */
  push(fullText: string, done = false): string[] {
    const pending = fullText.slice(this.consumed);
    if (!pending.trim()) return [];
    if (done) {
      this.consumed = fullText.length;
      return splitSentences(pending, this.options);
    }
    let lastEnd = -1;
    for (const match of pending.matchAll(TERMINATORS)) {
      if (match[2]) lastEnd = (match.index ?? 0) + match[0].length;
    }
    const newline = pending.lastIndexOf("\n");
    const cut = Math.max(lastEnd, newline + 1);
    if (cut <= 0) return [];
    this.consumed += cut;
    return splitSentences(pending.slice(0, cut), this.options);
  }
}
