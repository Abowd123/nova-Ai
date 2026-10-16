"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { NAV_ITEMS, isNavActive } from "./nav-items";

/** Material 3 navigation rail for tablet/desktop. */
export function NavRail({ className }: { className?: string }) {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <nav
      aria-label={t.nav.main}
      className={cn(
        "w-20 shrink-0 flex-col items-center gap-4 border-e bg-surface-container-low py-4",
        className,
      )}
    >
      <Link
        href="/chat"
        aria-label={t.nav.home}
        className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Logo className="size-10" />
      </Link>
      <ul className="flex flex-col gap-2">
        {NAV_ITEMS.map(({ key, href, icon: Icon }) => {
          const active = isNavActive(pathname, href);
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className="group flex w-16 flex-col items-center gap-1 rounded-2xl py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className={cn(
                    "flex h-8 w-14 items-center justify-center rounded-full transition-colors group-hover:bg-accent",
                    active && "bg-secondary text-secondary-foreground group-hover:bg-secondary",
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className={cn(active ? "text-foreground" : "text-muted-foreground")}>
                  {t.nav[key]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
