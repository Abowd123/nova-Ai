"use client";

import { useRef, type KeyboardEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  label: string;
  className?: string;
}

/** Accessible radio group (WAI-ARIA pattern) with RTL-aware arrow keys. */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  label,
  className,
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const rtl = document.documentElement.dir === "rtl";
    const steps: Record<string, number> = {
      ArrowRight: rtl ? -1 : 1,
      ArrowLeft: rtl ? 1 : -1,
      ArrowDown: 1,
      ArrowUp: -1,
    };
    let next: number | undefined;
    if (event.key in steps) next = (index + (steps[event.key] ?? 0) + options.length) % options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    const option = options[next];
    if (!option) return;
    onValueChange(option.value);
    refs.current[next]?.focus();
  };

  const hasChecked = options.some((option) => option.value === value);

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex flex-wrap gap-1 rounded-full border bg-surface-container p-1", className)}
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked || (!hasChecked && index === 0) ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              checked ? "bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            {Icon ? <Icon className="size-4" aria-hidden="true" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
