import type { Locale } from "@/lib/models";

export type Direction = "rtl" | "ltr";

export const LOCALES: readonly Locale[] = ["ar", "en"];

export function getDirection(locale: Locale): Direction {
  return locale === "ar" ? "rtl" : "ltr";
}

export function isLocale(value: unknown): value is Locale {
  return value === "ar" || value === "en";
}
