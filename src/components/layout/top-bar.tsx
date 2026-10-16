"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InstallButton } from "@/features/pwa/install-button";
import { useI18n } from "@/hooks/use-i18n";
import { useUiStore } from "@/stores/ui-store";
import { Logo } from "./logo";
import { OfflineBanner } from "./offline-banner";
import { ThemeToggle } from "./theme-toggle";

export function TopBar({ showMenu }: { showMenu: boolean }) {
  const { t } = useI18n();
  const setOpen = useUiStore((state) => state.setMobileSidebarOpen);
  return (
    <>
      <header className="safe-top flex min-h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur md:px-4">
        {showMenu ? (
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label={t.nav.openSidebar}
            onClick={() => setOpen(true)}
          >
            <Menu aria-hidden="true" />
          </Button>
        ) : null}
        <Link
          href="/chat"
          aria-label={t.nav.home}
          className="flex items-center gap-2 rounded-xl font-semibold md:hidden"
        >
          <Logo className="size-7" />
          <span aria-hidden="true">{t.app.name}</span>
        </Link>
        <div className="ms-auto flex items-center gap-1">
          <InstallButton />
          <ThemeToggle />
        </div>
      </header>
      <OfflineBanner />
    </>
  );
}
