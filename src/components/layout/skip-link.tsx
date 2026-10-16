"use client";

import { useI18n } from "@/hooks/use-i18n";

export function SkipLink() {
  const { t } = useI18n();
  return (
    <a
      href="#main-content"
      className="sr-only z-[200] rounded-full bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
    >
      {t.nav.skipToContent}
    </a>
  );
}
