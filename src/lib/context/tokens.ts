import type { ChatMessage } from "@/lib/ai/types";
import type { MessagePart } from "@/lib/models";

/**
 * Fast, tokenizer-free token estimate. Calibrated against cl100k/o200k and Gemini/Claude
 * tokenizers on mixed Arabic/English text: Latin ≈ 4 chars/token, Arabic ≈ 2.5 chars/token
 * (BPE vocabularies have fewer Arabic merges), CJK ≈ 1 char/token, digits/punctuation ≈ 1-2.
 * It slightly over-estimates on purpose: under-estimating is what overflows a context window.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let latin = 0;
  let arabic = 0;
  let cjk = 0;
  let digits = 0;
  let symbols = 0;
  let other = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code <= 0x20 || code === 0xa0) continue; // whitespace is mostly merged into the next token
    if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || (code >= 0xc0 && code <= 0x24f)) latin += 1;
    else if (code >= 0x30 && code <= 0x39) digits += 1;
    else if ((code >= 0x600 && code <= 0x6ff) || (code >= 0x750 && code <= 0x77f) || (code >= 0xfb50 && code <= 0xfeff)) arabic += 1;
    else if ((code >= 0x3040 && code <= 0x30ff) || (code >= 0x3400 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7af)) cjk += 1;
    else if (code < 0x80) symbols += 1;
    else other += 1;
  }
  return Math.ceil(latin / 4 + arabic / 2.5 + cjk + digits / 2 + symbols / 1.5 + other / 1.5);
}

/** Rough per-part costs for media (provider-dependent; conservative middle values). */
export const MEDIA_TOKENS = { image: 800, audioPerMinute: 1600, video: 6000, file: 1500 } as const;
/** Role markers / separators added by chat templates per message. */
export const MESSAGE_OVERHEAD = 4;

export function estimatePartTokens(part: MessagePart): number {
  switch (part.type) {
    case "text":
    case "reasoning":
      return estimateTokens(part.text);
    case "image":
      return MEDIA_TOKENS.image;
    case "audio":
      return MEDIA_TOKENS.audioPerMinute;
    case "video":
      return MEDIA_TOKENS.video;
    case "file":
      return MEDIA_TOKENS.file;
    case "tool_call":
      return estimateTokens(part.name) + estimateTokens(part.arguments) + 8;
    case "tool_result":
      return estimateTokens(part.content) + 8;
    default:
      return 0;
  }
}

export function estimateMessageTokens(message: Pick<ChatMessage, "parts">): number {
  return MESSAGE_OVERHEAD + message.parts.reduce((sum, part) => sum + estimatePartTokens(part), 0);
}

/** Cuts text so that it fits `maxTokens` (binary search on the estimate). */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTokens(text.slice(0, mid)) <= maxTokens) low = mid;
    else high = mid - 1;
  }
  return text.slice(0, low);
}

export function formatTokens(tokens: number, locale = "en"): string {
  return new Intl.NumberFormat(locale, { notation: tokens >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(tokens);
}
