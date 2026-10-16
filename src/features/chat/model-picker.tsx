"use client";

import { useId, useMemo } from "react";
import Link from "next/link";
import { Cpu, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { selectableModels } from "@/features/providers/provider-service";
import { useProviders } from "@/features/providers/queries";
import { useI18n } from "@/hooks/use-i18n";
import type { Provider } from "@/lib/models";
import { cn } from "@/lib/utils";
import { modelKey, parseModelKey } from "./model-selection";

interface ModelPickerProps {
  value: string | null;
  onChange: (selection: { providerId: string; modelId: string }) => void;
  label?: string;
  className?: string;
  compact?: boolean;
}

export function capabilityBadges(model: Provider["models"][number], t: ReturnType<typeof useI18n>["t"]): string {
  const caps = model.capabilities;
  return [caps.vision && t.models.vision, caps.reasoning && t.models.reasoning, caps.tools && t.models.tools]
    .filter(Boolean)
    .join(" · ");
}

export function ModelPicker({ value, onChange, label, className, compact }: ModelPickerProps) {
  const { t } = useI18n();
  const id = useId();
  const providers = useProviders();
  const groups = useMemo(() => {
    const options = selectableModels(providers.data ?? []);
    const map = new Map<string, { name: string; items: typeof options }>();
    for (const option of options) {
      const group = map.get(option.providerId) ?? { name: option.providerName, items: [] };
      group.items.push(option);
      map.set(option.providerId, group);
    }
    return [...map.entries()];
  }, [providers.data]);

  if (providers.isPending) {
    return <div className={cn("h-9 w-40 animate-pulse rounded-full bg-surface-container-high", className)} aria-hidden="true" />;
  }

  if (groups.length === 0) {
    return (
      <Button asChild variant="tonal" size="sm" className={className}>
        <Link href="/settings/providers">
          <Plus aria-hidden="true" />
          {t.chat.addProvider}
        </Link>
      </Button>
    );
  }

  return (
    <div className={cn("relative flex min-w-0 items-center", className)}>
      <label htmlFor={id} className="sr-only">
        {label ?? t.models.pick}
      </label>
      <Cpu className="pointer-events-none absolute start-3 size-4 text-muted-foreground" aria-hidden="true" />
      <select
        id={id}
        value={value ?? ""}
        onChange={(event) => {
          const parsed = parseModelKey(event.target.value);
          if (parsed) onChange(parsed);
        }}
        className={cn(
          "h-9 min-w-0 max-w-full appearance-none truncate rounded-full border bg-surface-container pe-4 ps-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          compact ? "w-44 sm:w-56" : "w-full",
        )}
      >
        {value === null ? <option value="">{t.models.pick}</option> : null}
        {groups.map(([providerId, group]) => (
          <optgroup key={providerId} label={group.name}>
            {group.items.map(({ model }) => {
              const badges = capabilityBadges(model, t);
              return (
                <option key={model.id} value={modelKey(providerId, model.id)}>
                  {model.name}
                  {badges ? ` (${badges})` : ""}
                </option>
              );
            })}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
