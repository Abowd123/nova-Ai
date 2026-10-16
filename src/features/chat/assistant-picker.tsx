"use client";

import { useId } from "react";
import { Bot } from "lucide-react";
import { useAssistants } from "@/features/assistants/queries";
import { useI18n } from "@/hooks/use-i18n";
import type { Assistant } from "@/lib/models";
import { cn } from "@/lib/utils";

/** Quick assistant switcher for the chat header. Emoji avatars only (images can't go in <option>). */
export function AssistantPicker({
  value,
  onChange,
  className,
}: {
  value: string | null;
  onChange: (assistant: Assistant | null) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const id = useId();
  const assistants = useAssistants();
  if (assistants.isPending) return <div className={cn("h-9 w-32 animate-pulse rounded-full bg-surface-container-high", className)} aria-hidden="true" />;
  const list = assistants.data ?? [];
  if (list.length === 0) return null;
  return (
    <div className={cn("relative flex min-w-0 items-center", className)}>
      <label htmlFor={id} className="sr-only">
        {t.chat.assistantPicker}
      </label>
      <Bot className="pointer-events-none absolute start-3 size-4 text-muted-foreground" aria-hidden="true" />
      <select
        id={id}
        value={value ?? ""}
        onChange={(event) => onChange(list.find((a) => a.id === event.target.value) ?? null)}
        className="h-9 w-36 min-w-0 appearance-none truncate rounded-full border bg-surface-container pe-4 ps-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-44"
      >
        <option value="">{t.chat.noAssistant}</option>
        {list.map((assistant) => (
          <option key={assistant.id} value={assistant.id}>
            {assistant.avatar.startsWith("data:") ? "" : `${assistant.avatar} `}
            {assistant.name}
          </option>
        ))}
      </select>
    </div>
  );
}
