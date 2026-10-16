import { estimateTokens } from "@/lib/context/tokens";

export interface ChunkOptions {
  /** Target size; chunks grow up to ~1.25× this before being cut. */
  targetTokens: number;
  overlapTokens: number;
  /** Text shorter than this is not worth remembering. */
  minChars?: number;
}

export interface TextChunk {
  text: string;
  tokens: number;
  index: number;
}

const SENTENCE_END = /(?<=[.!?؟。…])\s+|\n/;

/** Normalizes whitespace and drops content that must never be re-indexed (injected context, images). */
function clean(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/<context>[\s\S]*?<\/context>\s*/g, "") // never re-index injected context
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLong(paragraph: string, maxTokens: number): string[] {
  if (estimateTokens(paragraph) <= maxTokens) return [paragraph];
  const sentences = paragraph.split(SENTENCE_END).filter((s) => s.trim());
  const pieces: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (estimateTokens(sentence) > maxTokens) {
      if (current) pieces.push(current);
      current = "";
      // Hard cut by words.
      let buffer = "";
      for (const word of sentence.split(/\s+/)) {
        const next = buffer ? `${buffer} ${word}` : word;
        if (estimateTokens(next) > maxTokens && buffer) {
          pieces.push(buffer);
          buffer = word;
        } else buffer = next;
      }
      if (buffer) pieces.push(buffer);
      continue;
    }
    const next = current ? `${current} ${sentence.trim()}` : sentence.trim();
    if (estimateTokens(next) > maxTokens && current) {
      pieces.push(current);
      current = sentence.trim();
    } else current = next;
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Trailing part of `text` worth about `tokens` tokens, starting at a word boundary. */
function tail(text: string, tokens: number): string {
  if (tokens <= 0) return "";
  const words = text.split(/\s+/);
  let out = "";
  for (let i = words.length - 1; i >= 0; i -= 1) {
    const next = out ? `${words[i]} ${out}` : words[i]!;
    if (estimateTokens(next) > tokens) break;
    out = next;
  }
  return out;
}

/**
 * Paragraph-aware chunking: paragraphs are packed until ~targetTokens (300–500 by default),
 * oversized paragraphs are split by sentence then by word, and each chunk starts with the
 * last ~overlapTokens of the previous one so facts spanning a boundary stay retrievable.
 */
export function chunkText(input: string, options: ChunkOptions): TextChunk[] {
  const text = clean(input);
  if (text.length < (options.minChars ?? 20)) return [];
  const target = Math.max(50, options.targetTokens);
  const max = Math.round(target * 1.25);
  const overlap = Math.min(options.overlapTokens, Math.floor(target / 3));
  const paragraphs = text.split(/\n\s*\n/).flatMap((p) => splitLong(p.trim(), max)).filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (current && estimateTokens(next) > max) {
      chunks.push(current);
      const carry = tail(current, overlap);
      current = carry ? `${carry}\n\n${paragraph}` : paragraph;
    } else if (estimateTokens(next) >= target) {
      chunks.push(next);
      current = tail(next, overlap);
      if (current === next) current = "";
    } else current = next;
  }
  // Leftover that is only overlap is already part of the previous chunk.
  const last = chunks.at(-1);
  if (current && (!last || !last.endsWith(current))) chunks.push(current);

  return chunks.map((chunk, index) => ({ text: chunk, tokens: estimateTokens(chunk), index }));
}
