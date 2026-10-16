"use client";

import { useEffect, useId, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { useDeleteSummary, useRegenerateSummary, useSaveSummary, useSummary } from "@/features/memory/queries";
import { useI18n } from "@/hooks/use-i18n";
import { estimateTokens } from "@/lib/context/tokens";
import { formatRelativeTime } from "@/lib/format";
import { getErrorMessage } from "@/lib/i18n/error-message";

/** View / edit / regenerate the rolling summary of a conversation. */
export function SummaryDialog({ conversationId, open, onOpenChange }: { conversationId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, locale } = useI18n();
  const id = useId();
  const summary = useSummary(conversationId);
  const save = useSaveSummary(conversationId);
  const regenerate = useRegenerateSummary(conversationId);
  const remove = useDeleteSummary(conversationId);
  const [text, setText] = useState("");
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const report = (e: unknown) => toast({ title: getErrorMessage(e, t), variant: "destructive" });

  useEffect(() => {
    if (open) setText(summary.data?.text ?? "");
  }, [open, summary.data]);

  const data = summary.data;
  const dirty = text.trim() !== (data?.text ?? "").trim();
  const doRegenerate = () =>
    regenerate.mutate(undefined, {
      onSuccess: (outcome) => {
        if (outcome.status === "updated") toast({ title: t.summary.regenerated, variant: "success" });
        else toast({ title: t.summary.skipped[outcome.reason] });
      },
      onError: report,
    });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t.summary.title}</DialogTitle>
            <DialogDescription>{t.summary.description}</DialogDescription>
          </DialogHeader>
          {summary.isPending ? (
            <LoadingState label={t.common.loading} rows={2} />
          ) : summary.isError ? (
            <ErrorState title={t.summary.loadError} description={getErrorMessage(summary.error, t)} retryLabel={t.common.retry} onRetry={() => void summary.refetch()} />
          ) : (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {data ? (
                  <>
                    <span>{t.summary.updated(formatRelativeTime(data.updatedAt, locale))}</span>
                    <span>·</span>
                    <span>{t.summary.covers(data.coveredMessageCount)}</span>
                    {data.manualEdit ? <Badge variant="warning">{t.summary.manual}</Badge> : <Badge variant="tonal">{t.summary.auto}</Badge>}
                  </>
                ) : (
                  <span>{t.summary.none}</span>
                )}
              </div>
              <Label htmlFor={id} className="sr-only">
                {t.summary.title}
              </Label>
              <Textarea id={id} dir="auto" rows={10} maxLength={40_000} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.summary.placeholder} />
              <p className="text-xs text-muted-foreground">{t.memory.tokens(estimateTokens(text))}</p>
              {data?.manualEdit ? <p className="text-xs text-muted-foreground">{t.summary.manualHint}</p> : null}
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={regenerate.isPending} onClick={() => (data?.manualEdit ? setConfirmRegenerate(true) : doRegenerate())}>
                <RefreshCw className={regenerate.isPending ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
                {regenerate.isPending ? t.summary.generating : data ? t.summary.regenerate : t.summary.generate}
              </Button>
              {data ? (
                <Button type="button" variant="ghost" size="icon" aria-label={t.summary.delete} onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t.common.close}
              </Button>
              <Button
                type="button"
                disabled={!dirty || !text.trim() || save.isPending}
                onClick={() => save.mutate(text, { onSuccess: () => toast({ title: t.summary.saved, variant: "success" }), onError: report })}
              >
                {t.common.save}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmRegenerate}
        onOpenChange={setConfirmRegenerate}
        title={t.summary.overwriteTitle}
        description={t.summary.overwriteDescription}
        confirmLabel={t.summary.regenerate}
        destructive={false}
        onConfirm={() => {
          setConfirmRegenerate(false);
          doRegenerate();
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t.summary.deleteTitle}
        description={t.summary.deleteDescription}
        confirmLabel={t.common.delete}
        onConfirm={() => remove.mutate(undefined, { onSuccess: () => setConfirmDelete(false), onError: report })}
      />
    </>
  );
}
