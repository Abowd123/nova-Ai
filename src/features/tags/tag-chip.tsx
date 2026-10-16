import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { Tag } from "@/lib/models";
import { cn } from "@/lib/utils";
import { readableTextColor } from "./colors";

export function TagChip({ tag, className }: { tag: Pick<Tag, "name" | "color">; className?: string }) {
  return (
    <span
      className={cn("inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-xs font-medium", className)}
      style={{ backgroundColor: tag.color, color: readableTextColor(tag.color) }}
    >
      <span className="truncate" dir="auto">
        {tag.name}
      </span>
    </span>
  );
}

/** Toggleable filter/selection chip (aria-pressed). */
export function TagToggle({
  tag,
  pressed,
  onToggle,
  removable,
  children,
}: {
  tag: Pick<Tag, "name" | "color">;
  pressed: boolean;
  onToggle: () => void;
  removable?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={cn(
        "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        pressed ? "border-transparent" : "bg-transparent hover:bg-accent",
      )}
      style={pressed ? { backgroundColor: tag.color, color: readableTextColor(tag.color) } : undefined}
    >
      {!pressed ? <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} /> : null}
      <span className="truncate" dir="auto">
        {tag.name}
      </span>
      {children}
      {pressed && removable ? <X className="size-3.5 shrink-0" aria-hidden="true" /> : null}
    </button>
  );
}
