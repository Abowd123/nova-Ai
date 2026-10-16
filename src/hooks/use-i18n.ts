"use client";

import { dictionaries } from "@/lib/i18n/dictionaries";
import { getDirection } from "@/lib/i18n/locale";
import { useUiStore } from "@/stores/ui-store";

export function useI18n() {
  const locale = useUiStore((state) => state.locale);
  const setLocale = useUiStore((state) => state.setLocale);
  return { t: dictionaries[locale], locale, dir: getDirection(locale), setLocale };
}
