"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageSquare, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/hooks/use-i18n";
import { formatRelativeTime } from "@/lib/format";
import type { MemoryChunk } from "@/lib/models";
import { cn } from "@/lib/utils";
import { chatHref } from "@/lib/routes";

export function MemoryCard({
  chunk,
  score,
  assistantName,
  onEdit,
  onDelete,
}: {
  chunk: MemoryChunk;
  score?: number;
  assistantName?: string;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const long = chunk.text.length > 280;
  return (
    <Card data-testid="memory-card">
      <CardContent className="flex flex-col gap-2 pt-5">
        <p dir="auto" className={cn("whitespace-pre-wrap text-sm", !expanded && long && "line-clamp-4")}>
          {chunk.text}
        </p>
        {long ? (
          <button type="button" className="w-fit text-xs text-primary underline-offset-2 hover:underline" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded ? t.memory.showLess : t.memory.showMore}
          </button>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="tonal">{t.memory.scopes[chunk.scope]}</Badge>
          {chunk.scope === "assistant" && assistantName ? <Badge variant="outline">{assistantName}</Badge> : null}
          <Badge variant="outline">{chunk.source === "manual" ? t.memory.sourceManual : chunk.role === "assistant" ? t.memory.sourceReply : t.memory.sourceUser}</Badge>
          {chunk.status === "error" ? (
            <Badge variant="warning" title={chunk.error ?? undefined}>
              {t.memory.statuses.error}
            </Badge>
          ) : chunk.status === "pending" ? (
            <Badge variant="outline">{t.memory.statuses.pending}</Badge>
          ) : null}
          {score !== undefined ? <span>{t.memory.score(Math.round(score * 100))}</span> : null}
          <span>{formatRelativeTime(chunk.createdAt, locale)}</span>
          {chunk.conversationId ? (
            <Link href={chatHref(chunk.conversationId)} className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
              <MessageSquare className="size-3" aria-hidden="true" />
              {t.memory.openConversation}
            </Link>
          ) : null}
          <span className="flex-1" />
          {onEdit ? (
            <Button variant="ghost" size="icon-sm" aria-label={t.common.edit} onClick={onEdit}>
              <Pencil aria-hidden="true" />
            </Button>
          ) : null}
          {onDelete ? (
            <Button variant="ghost" size="icon-sm" aria-label={t.common.delete} onClick={onDelete}>
              <Trash2 aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
