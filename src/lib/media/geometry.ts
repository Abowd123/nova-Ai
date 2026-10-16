/** Scales (w,h) down so the longest edge is <= max. Never upscales. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Evenly spaced timestamps, avoiding the very first/last frame (often black). */
export function frameTimestamps(durationMs: number, count: number): number[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || count <= 0) return [0];
  const n = Math.max(1, Math.floor(count));
  const step = durationMs / (n + 1);
  return Array.from({ length: n }, (_, i) => Math.round(step * (i + 1)));
}

export const ASPECT_RATIOS = ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9"] as const;

/** Width/height for an aspect ratio around a target megapixel count, multiples of `step`. */
export function sizeForAspect(aspect: string, base = 1024, step = 64): { width: number; height: number } {
  const [w, h] = aspect.split(":").map(Number);
  if (!w || !h) return { width: base, height: base };
  const area = base * base;
  const width = Math.sqrt((area * w) / h);
  const round = (v: number) => Math.max(step, Math.round(v / step) * step);
  return { width: round(width), height: round(area / width) };
}

/** Closest supported "WxH" option (e.g. OpenAI sizes) by aspect ratio, then area. */
export function nearestSize(width: number, height: number, options: readonly string[]): string {
  const target = width / height;
  let best = options[0] ?? `${width}x${height}`;
  let bestScore = Infinity;
  for (const option of options) {
    const [w, h] = option.split("x").map(Number);
    if (!w || !h) continue;
    const score = Math.abs(Math.log(w / h / target)) * 10 + Math.abs(Math.log((w * h) / (width * height)));
    if (score < bestScore) {
      bestScore = score;
      best = option;
    }
  }
  return best;
}
