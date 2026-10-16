"use client";

import { WifiOff } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useOnlineStatus } from "@/hooks/use-online-status";

export function OfflineBanner() {
  const online = useOnlineStatus();
  const { t } = useI18n();
  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 bg-warning/15 px-4 py-2 text-sm"
    >
      <WifiOff className="size-4" aria-hidden="true" />
      {t.network.offline}
    </div>
  );
}
