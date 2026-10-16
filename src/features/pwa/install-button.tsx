"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { useInstallPrompt } from "./use-install-prompt";

export function InstallButton() {
  const { t } = useI18n();
  const { canInstall, promptInstall } = useInstallPrompt();
  if (!canInstall) return null;
  return (
    <Button variant="tonal" size="sm" onClick={() => void promptInstall()}>
      <Download aria-hidden="true" />
      <span className="hidden sm:inline">{t.pwa.install}</span>
      <span className="sr-only sm:hidden">{t.pwa.install}</span>
    </Button>
  );
}
