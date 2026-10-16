"use client";

import { memo } from "react";
import Link from "next/link";
import { Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { formatRelativeTime } from "@/lib/format";
import type { Conversation } from "@/lib/models";
import { cn } from "@/lib/utils";
import { chatHref } from "@/lib/routes";

interface ConversationItemProps {
  conversation: Conversation;
  active: boolean;
  onNavigate?: () => void;
  onTogglePin: (conversation: Conversation) => void;
  onRename: (conversation: Conversation) => void;
  onDelete: (conversation: Conversation) => void;
}

export const ConversationItem = memo(function ConversationItem({
  conversation,
  active,
  onNavigate,
  onTogglePin,
  onRename,
  onDelete,
}: ConversationItemProps) {
  const { t, locale } = useI18n();
  return (
    <li className="group relative">
      <Link
        href={chatHref(conversation.id)}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        className={cn(
          "flex flex-col gap-0.5 rounded-2xl py-2.5 pe-28 ps-3 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active && "bg-secondary text-secondary-foreground hover:bg-secondary",
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5 font-medium">
          {conversation.pinned ? <Pin className="size-3.5 shrink-0" aria-hidden="true" /> : null}
          <span className="truncate" dir="auto">
            {conversation.title}
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(conversation.updatedAt, locale)}
        </span>
      </Link>
      <div
        role="group"
        aria-label={t.conversations.actionsFor(conversation.title)}
        className="absolute end-1.5 top-1/2 flex -translate-y-1/2 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={conversation.pinned ? t.conversations.unpin : t.conversations.pin}
          aria-pressed={conversation.pinned}
          onClick={() => onTogglePin(conversation)}
        >
          {conversation.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t.common.rename}
          onClick={() => onRename(conversation)}
        >
          <Pencil aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t.common.delete}
          onClick={() => onDelete(conversation)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
});
