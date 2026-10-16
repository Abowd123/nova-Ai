"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";

/** Fallback page served by the service worker for uncached navigations. */
export function OfflineView() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 p-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-3xl bg-secondary text-secondary-foreground">
        <WifiOff className="size-8" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-bold">{t.offline.title}</h1>
      <p className="max-w-md text-muted-foreground">{t.offline.description}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => window.location.reload()}>
          <RefreshCw aria-hidden="true" />
          {t.common.retry}
        </Button>
        <Button asChild variant="tonal">
          {/* Plain <a>: full navigation so the SW can serve the cached shell. */}
          <a href="/chat">{t.offline.goHome}</a>
        </Button>
      </div>
    </main>
  );
}
