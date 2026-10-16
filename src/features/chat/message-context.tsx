"use client";

import { useState } from "react";
import { Brain } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLorebooks, useMemoryChunks } from "@/features/memory/queries";
import { useI18n } from "@/hooks/use-i18n";
import type { MessageContextInfo } from "@/lib/models";

/** "Memory used" disclosure under an assistant reply: memories, lore entries, summary. */
export function MessageContext({ info }: { info: MessageContextInfo }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const chunks = useMemoryChunks(open ? info.memoryIds : []);
  const books = useLorebooks();
  const memories = info.memoryIds.length;
  const lore = info.lore.length;
  if (!memories && !lore && !info.summaryUsed && !info.omittedMessages) return null;

  const parts = [
    memories ? t.messageContext.memories(memories) : null,
    lore ? t.messageContext.lore(lore) : null,
    info.summaryUsed ? t.messageContext.summary : null,
    info.omittedMessages ? t.messageContext.omitted(info.omittedMessages) : null,
  ].filter((p): p is string => Boolean(p));

  const loreName = (bookId: string, entryId: string) => {
    const book = books.data?.find((b) => b.id === bookId);
    const entry = book?.entries.find((e) => e.id === entryId);
    return book ? `${book.name}${entry ? ` · ${entry.keywords[0] ?? ""}` : ""}` : t.messageContext.deletedLore;
  };

  return (
    <details className="group text-xs text-muted-foreground" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} data-testid="message-context">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full px-2 py-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Brain className="size-3.5" aria-hidden="true" />
        {parts.join(" · ")}
        {info.retrieval === "text" ? <span className="sr-only">{t.messageContext.keywordOnly}</span> : null}
      </summary>
      <div className="mt-2 grid gap-2 rounded-2xl border bg-surface-container-low p-3">
        {memories ? (
          <section aria-label={t.messageContext.memoriesHeading}>
            <h4 className="mb-1 font-medium text-foreground">
              {t.messageContext.memoriesHeading}
              {info.retrieval === "text" ? <Badge variant="outline" className="ms-2">{t.messageContext.keywordOnly}</Badge> : null}
            </h4>
            {chunks.isPending ? (
              <p>{t.common.loading}</p>
            ) : chunks.isError ? (
              <p className="text-destructive">{t.memory.loadError}</p>
            ) : (
              <ul className="grid gap-1">
                {info.memoryIds.map((id, i) => {
                  const chunk = chunks.data?.find((c) => c.id === id);
                  const score = info.memoryScores[i];
                  return (
                    <li key={id} className="rounded-xl bg-background px-2 py-1">
                      <span dir="auto" className="line-clamp-3 whitespace-pre-wrap text-foreground">
                        {chunk ? chunk.text : t.messageContext.deletedMemory}
                      </span>
                      {score !== undefined ? <span className="text-[11px]">{t.memory.score(Math.round(score * 100))}</span> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}
        {lore ? (
          <section aria-label={t.messageContext.loreHeading}>
            <h4 className="mb-1 font-medium text-foreground">{t.messageContext.loreHeading}</h4>
            <ul className="flex flex-wrap gap-1">
              {info.lore.map((l) => (
                <li key={`${l.lorebookId}:${l.entryId}`}>
                  <Badge variant="tonal">
                    <span dir="auto">{loreName(l.lorebookId, l.entryId)}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {info.summaryUsed ? <p>{t.messageContext.summaryUsed}</p> : null}
        {info.omittedMessages ? <p>{t.messageContext.omittedLong(info.omittedMessages)}</p> : null}
      </div>
    </details>
  );
}
