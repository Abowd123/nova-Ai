"use client";

import { useEffect, useState } from "react";
import { getDirection } from "@/lib/i18n/locale";
import { useUiStore } from "@/stores/ui-store";

/** Rehydrates UI prefs after mount and keeps <html lang/dir> in sync. */
export function LocaleSync() {
  const locale = useUiStore((state) => state.locale);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const unsubscribe = useUiStore.persist.onFinishHydration(() => setHydrated(true));
    void useUiStore.persist.rehydrate();
    if (useUiStore.persist.hasHydrated()) setHydrated(true);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;
    root.lang = locale;
    root.dir = getDirection(locale);
  }, [locale, hydrated]);

  return null;
}
