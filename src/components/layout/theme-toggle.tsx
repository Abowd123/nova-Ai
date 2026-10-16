"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { useMounted } from "@/hooks/use-mounted";

const ORDER = ["light", "dark", "system"] as const;
type ThemeName = (typeof ORDER)[number];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const mounted = useMounted();
  const current: ThemeName = mounted && ORDER.includes(theme as ThemeName) ? (theme as ThemeName) : "system";
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? "system";
  const Icon = current === "light" ? Sun : current === "dark" ? Moon : Monitor;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t.theme.toggle(t.settings.themes[current])}
      onClick={() => setTheme(next)}
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}
