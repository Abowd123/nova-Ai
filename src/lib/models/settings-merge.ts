import { DEFAULT_SETTINGS, appSettingsSchema, type AppSettings } from "./settings";

/** Field-by-field merge: one corrupted field never resets the others. */
const isPlain = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Fills fields missing in `raw` from `fallback`, recursively (nested groups gain fields over time). */

function deepFill(fallback: unknown, raw: unknown): unknown {
  if (!isPlain(fallback) || !isPlain(raw)) return raw;
  const out: Record<string, unknown> = { ...fallback };
  for (const [key, value] of Object.entries(raw)) out[key] = key in fallback ? deepFill(fallback[key], value) : value;
  return out;
}

export function mergeSettings(value: unknown): AppSettings {
  const result: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    for (const [key, schema] of Object.entries(appSettingsSchema.shape)) {
      const fallback = (DEFAULT_SETTINGS as Record<string, unknown>)[key];
      const raw = source[key];
      // Nested groups (media/stt/tts) gain fields over time: fill missing ones from defaults.
      const candidate = deepFill(fallback, raw);
      const parsed = schema.safeParse(candidate);
      if (parsed.success) result[key] = parsed.data;
    }
  }
  return result as AppSettings;
}

