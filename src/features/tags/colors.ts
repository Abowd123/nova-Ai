/** Material 3 inspired palette; all pass WCAG AA with white text at chip size when used as background. */
export const TAG_COLORS = [
  "#6750A4",
  "#B3261E",
  "#7D5260",
  "#006A6A",
  "#386A20",
  "#8B5000",
  "#0061A4",
  "#984061",
  "#5C5F00",
  "#625B71",
] as const;

/** Relative luminance (WCAG) -> picks readable text on a colored chip. */
export function readableTextColor(hex: string): "#000000" | "#FFFFFF" {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) return "#FFFFFF";
  const n = parseInt(match[1], 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  return l > 0.179 ? "#000000" : "#FFFFFF";
}

export function nextTagColor(used: readonly string[]): string {
  const lower = used.map((c) => c.toLowerCase());
  return TAG_COLORS.find((c) => !lower.includes(c.toLowerCase())) ?? TAG_COLORS[used.length % TAG_COLORS.length]!;
}
