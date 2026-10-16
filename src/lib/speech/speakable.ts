export interface SpeakableOptions {
  /** Spoken instead of a code block, e.g. "(code omitted)". Empty = skip silently. */
  codePlaceholder?: string;
}

/**
 * Markdown -> plain text suitable for speech: drops code blocks, URLs, images, tables
 * syntax, LaTeX and HTML; keeps link labels and list item text.
 */
export function toSpeakableText(markdown: string, options: SpeakableOptions = {}): string {
  const placeholder = options.codePlaceholder ?? "";
  let text = markdown.replace(/\r\n?/g, "\n");
  text = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?(?:\n\1[^\n]*|$)/gm, placeholder ? `\n${placeholder}\n` : "\n");
  text = text.replace(/\$\$[\s\S]*?\$\$/g, " ");
  text = text.replace(/\\\[[\s\S]*?\\\]/g, " ");
  text = text.replace(/(^|[^\\$])\$(?!\s)[^$\n]+?\$(?!\d)/g, "$1 ");
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");
  text = text.replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, "");
  text = text.replace(/<\/?[a-z][^>]*>/gi, " ");
  text = text.replace(/https?:\/\/\S+|www\.\S+/gi, " ");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  text = text.replace(/^\s{0,3}>\s?/gm, "");
  text = text.replace(/^\s*([-*+]|\d+[.)])\s+/gm, "");
  text = text.replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, "");
  text = text.replace(/\|/g, ", ");
  text = text.replace(/^\s*([-*_])(\s*\1){2,}\s*$/gm, "");
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(\*|_)(\S(?:.*?\S)?)\1/g, "$2");
  text = text.replace(/~~(.*?)~~/g, "$1");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n");
  return text.trim();
}
