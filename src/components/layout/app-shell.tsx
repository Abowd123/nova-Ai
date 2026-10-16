"use client";

import { Suspense } from "react";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ConversationSidebar } from "@/features/conversations/conversation-sidebar";
import { useI18n } from "@/hooks/use-i18n";
import { useUiStore } from "@/stores/ui-store";
import { BottomNav } from "./bottom-nav";
import { NavRail } from "./nav-rail";
import { SkipLink } from "./skip-link";
import { TopBar } from "./top-bar";

/**
 * Responsive layout:
 *  - phone  (<768px):  top bar + bottom nav, conversations in a sheet
 *  - tablet (768-1023): nav rail, conversations in a sheet
 *  - desktop (>=1024):  nav rail + persistent conversation sidebar
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const isChat = pathname === "/" || pathname.startsWith("/chat");
  const open = useUiStore((state) => state.mobileSidebarOpen);
  const setOpen = useUiStore((state) => state.setMobileSidebarOpen);

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <SkipLink />
      <NavRail className="hidden md:flex" />
      {isChat ? (
        <aside
          aria-label={t.conversations.listLabel}
          className="hidden w-80 shrink-0 border-e bg-surface-container-low lg:flex lg:flex-col"
        >
          <Suspense fallback={null}>
            <ConversationSidebar />
          </Suspense>
        </aside>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar showMenu={isChat} />
        <main id="main-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto pb-20 outline-none md:pb-0">
          {children}
        </main>
      </div>
      <BottomNav className="md:hidden" />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="start" closeLabel={t.common.close} className="lg:hidden">
          <SheetTitle className="sr-only">{t.conversations.title}</SheetTitle>
          <SheetDescription className="sr-only">{t.conversations.listLabel}</SheetDescription>
          <Suspense fallback={null}>
            <ConversationSidebar onNavigate={() => setOpen(false)} />
          </Suspense>
        </SheetContent>
      </Sheet>
    </div>
  );
}
