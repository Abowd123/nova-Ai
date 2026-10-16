"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, isNavActive } from "./nav-items";

/** Material 3 navigation bar for phones. */
export function BottomNav({ className }: { className?: string }) {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <nav
      aria-label={t.nav.main}
      className={cn("safe-bottom fixed inset-x-0 bottom-0 z-40 border-t bg-surface-container", className)}
    >
      <ul className="grid grid-cols-4">
        {NAV_ITEMS.map(({ key, href, icon: Icon }) => {
          const active = isNavActive(pathname, href);
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className="group flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span
                  className={cn(
                    "flex h-8 w-16 items-center justify-center rounded-full transition-colors",
                    active && "bg-secondary text-secondary-foreground",
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                {t.nav[key]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
