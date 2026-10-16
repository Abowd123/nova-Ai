"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy, Pencil, Play, RefreshCw, Share2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { copyText, shareText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

function ActionButton({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  );
}

interface MessageActionsProps {
  text: string;
  role: "user" | "assistant";
  busy: boolean;
  canRegenerate: boolean;
  canContinue: boolean;
  onEdit?: () => void;
  onRegenerate?: () => void;
  onContinue?: () => void;
  onDelete: () => void;
  className?: string;
}

export function MessageActions({
  text,
  role,
  busy,
  canRegenerate,
  canContinue,
  onEdit,
  onRegenerate,
  onContinue,
  onDelete,
  className,
}: MessageActionsProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (await copyText(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } else toast({ title: t.chat.copyFailed, variant: "destructive" });
  };

  const share = async () => {
    const result = await shareText(text, t.app.name);
    if (result === "copied") toast({ title: t.chat.copiedForSharing });
    else if (result === "failed") toast({ title: t.chat.copyFailed, variant: "destructive" });
  };

  return (
    <div role="group" aria-label={t.chat.messageActions} className={cn("flex flex-wrap items-center gap-0.5", className)}>
      <ActionButton label={copied ? t.markdown.copied : t.chat.copy} onClick={() => void copy()} disabled={!text}>
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </ActionButton>
      {role === "assistant" ? (
        <ActionButton label={t.chat.share} onClick={() => void share()} disabled={!text}>
          <Share2 aria-hidden="true" />
        </ActionButton>
      ) : null}
      {role === "user" && onEdit ? (
        <ActionButton label={t.common.edit} onClick={onEdit} disabled={busy}>
          <Pencil aria-hidden="true" />
        </ActionButton>
      ) : null}
      {canContinue && onContinue ? (
        <ActionButton label={t.chat.continue} onClick={onContinue} disabled={busy}>
          <Play className="rtl:-scale-x-100" aria-hidden="true" />
        </ActionButton>
      ) : null}
      {canRegenerate && onRegenerate ? (
        <ActionButton label={t.chat.regenerate} onClick={onRegenerate} disabled={busy}>
          <RefreshCw aria-hidden="true" />
        </ActionButton>
      ) : null}
      <ActionButton label={t.chat.deleteMessage} onClick={onDelete} disabled={busy}>
        <Trash2 aria-hidden="true" />
      </ActionButton>
    </div>
  );
}
