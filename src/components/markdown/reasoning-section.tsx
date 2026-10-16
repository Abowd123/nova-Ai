"use client";

import { Brain, ChevronDown } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { Markdown } from "./markdown";

export function ReasoningSection({ text, streaming }: { text: string; streaming: boolean }) {
  const { t } = useI18n();
  if (!text.trim()) return null;
  return (
    <details className="group/reasoning mb-2 rounded-2xl border bg-surface-container-low text-sm" open={streaming || undefined}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-2xl px-3 py-2 text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <Brain className="size-4" aria-hidden="true" />
        <span>{streaming ? t.markdown.thinking : t.markdown.reasoning}</span>
        <ChevronDown className="ms-auto size-4 transition-transform group-open/reasoning:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t px-3 py-2 text-muted-foreground">
        <Markdown content={text} streaming={streaming} />
      </div>
    </details>
  );
}
