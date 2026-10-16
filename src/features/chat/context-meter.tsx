"use client";

import { useState } from "react";
import { FileText, Gauge, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/hooks/use-i18n";
import { formatTokens } from "@/lib/context/tokens";
import type { ContextPreview } from "./engine/chat-service";
import { cn } from "@/lib/utils";

export type MeterLevel = "ok" | "warn" | "over";

export function meterLevel(preview: Pick<ContextPreview, "ratio" | "overflow">, warnAt: number): MeterLevel {
  if (preview.overflow || preview.ratio >= 1) return "over";
  if (preview.ratio >= warnAt) return "warn";
  return "ok";
}

const BAR: Record<MeterLevel, string> = { ok: "bg-primary", warn: "bg-amber-500", over: "bg-destructive" };

/** Compact context usage bar in the conversation header; details + summary access in a dialog. */
export function ContextMeter({ preview, warnAt, onOpenSummary }: { preview: ContextPreview | undefined; warnAt: number; onOpenSummary: () => void }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  if (!preview) return null;
  const level = meterLevel(preview, warnAt);
  const pct = Math.min(100, Math.round(preview.ratio * 100));
  const { breakdown } = preview;
  const label = t.context.usage(formatTokens(breakdown.total, locale), formatTokens(breakdown.window, locale), pct);
  const rows: [string, number][] = [
    [t.context.parts.system, breakdown.system],
    [t.context.parts.lore, breakdown.lore],
    [t.context.parts.memory, breakdown.memory],
    [t.context.parts.summary, breakdown.summary],
    [t.context.parts.messages, breakdown.messages],
    [t.context.parts.reserved, breakdown.reserved],
  ];

  return (
    <>
      <Button variant="ghost" size="sm" className="gap-2 px-2" aria-label={label} onClick={() => setOpen(true)} data-testid="context-meter">
        {level === "ok" ? <Gauge className="size-4" aria-hidden="true" /> : <TriangleAlert className={cn("size-4", level === "over" ? "text-destructive" : "text-amber-600")} aria-hidden="true" />}
        <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block" aria-hidden="true">
          <span className={cn("block h-full rounded-full transition-all", BAR[level])} style={{ width: `${pct}%` }} />
        </span>
        <span className="text-xs tabular-nums" dir="ltr">
          {pct}%
        </span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.context.title}</DialogTitle>
            <DialogDescription>{label}</DialogDescription>
          </DialogHeader>
          <div
            role="progressbar"
            aria-label={t.context.title}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div className={cn("h-full rounded-full", BAR[level])} style={{ width: `${pct}%` }} />
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            {rows.map(([name, value]) => (
              <div key={name} className="contents">
                <dt className="text-muted-foreground">{name}</dt>
                <dd className="tabular-nums" dir="ltr">
                  {formatTokens(value, locale)}
                </dd>
              </div>
            ))}
          </dl>
          <div className="grid gap-1 text-xs text-muted-foreground">
            {!preview.windowKnown ? <p>{t.context.windowUnknown}</p> : null}
            {preview.lastInputTokens !== null ? <p>{t.context.lastActual(formatTokens(preview.lastInputTokens, locale))}</p> : null}
            {preview.summarizedMessages > 0 ? <p>{t.context.summarized(preview.summarizedMessages)}</p> : null}
            {preview.omittedMessages > 0 ? <p>{t.context.omitted(preview.omittedMessages)}</p> : null}
            <p>{t.context.estimateNote}</p>
          </div>
          {level !== "ok" ? (
            <p role="status" className={cn("rounded-2xl px-3 py-2 text-sm", level === "over" ? "bg-destructive/10" : "bg-amber-500/10")}>
              {level === "over" ? t.context.overflow : t.context.nearLimit}
            </p>
          ) : null}
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false);
              onOpenSummary();
            }}
          >
            <FileText className="size-4" aria-hidden="true" />
            {t.summary.open}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Line under the composer when the next request is close to / over the window. */
export function ContextNotice({ preview, warnAt }: { preview: ContextPreview | undefined; warnAt: number }) {
  const { t } = useI18n();
  if (!preview) return null;
  const level = meterLevel(preview, warnAt);
  if (level === "ok") return null;
  return (
    <p role="status" className={cn("flex items-center gap-1 text-xs", level === "over" ? "text-destructive" : "text-amber-700 dark:text-amber-400")} data-testid="context-notice">
      <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
      {level === "over" ? (preview.windowKnown ? t.context.wontFit : t.context.mayNotFit) : t.context.nearLimitShort(Math.round(preview.ratio * 100))}
    </p>
  );
}
