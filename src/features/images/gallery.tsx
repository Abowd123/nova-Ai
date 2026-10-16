"use client";

import { useState } from "react";
import { Download, Loader2, RotateCcw, Share2, Trash2, X } from "lucide-react";
import { useServices } from "@/components/providers/services-provider";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useAttachmentUrl } from "@/features/attachments/use-attachment-url";
import { useI18n } from "@/hooks/use-i18n";
import { downloadUrl, shareBlob } from "@/lib/files";
import type { ImageGenParams, ImageGeneration } from "@/lib/models";
import { useDeleteGeneration, useJobProgress } from "./queries";

function GeneratedImageTile({ attachmentId, prompt }: { attachmentId: string; prompt: string }) {
  const { t } = useI18n();
  const services = useServices();
  const { url, attachment, missing } = useAttachmentUrl(attachmentId);
  const [open, setOpen] = useState(false);
  if (missing) return <div className="flex aspect-square items-center justify-center rounded-2xl bg-muted text-xs text-muted-foreground">{t.attachments.missing("")}</div>;
  const name = attachment?.name ?? "image.png";
  const share = async () => {
    if (!attachment) return;
    const blob = await services().attachments.getBlob(attachment);
    if (!blob) return;
    const result = await shareBlob(blob, name, prompt.slice(0, 80));
    if (result === "unsupported" && url) downloadUrl(url, name);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block aspect-square overflow-hidden rounded-2xl bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t.attachments.openImage(name)} data-testid="generated-image">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={attachment?.thumbnail ?? url ?? undefined} alt={prompt.slice(0, 120)} loading="lazy" className="size-full object-cover" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={t.common.close} className="max-w-4xl p-2">
          <DialogTitle className="sr-only">{name}</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {url ? <img src={url} alt={prompt.slice(0, 300)} className="max-h-[78vh] w-full rounded-2xl object-contain" /> : null}
          <div className="flex flex-wrap items-center justify-end gap-2 px-2 pb-1">
            {url ? (
              <Button variant="ghost" size="sm" onClick={() => downloadUrl(url, name)}>
                <Download aria-hidden="true" />
                {t.common.download}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => void share()}>
              <Share2 aria-hidden="true" />
              {t.chat.share}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function GenerationCard({ generation, onReuse }: { generation: ImageGeneration; onReuse: (params: ImageGenParams) => void }) {
  const { t, locale } = useI18n();
  const services = useServices();
  const remove = useDeleteGeneration();
  const live = useJobProgress(generation.id);
  const [confirm, setConfirm] = useState(false);
  const running = generation.status === "running" || generation.status === "queued";
  const progress = live ?? generation.progress;
  const { params } = generation;

  return (
    <li className="grid gap-3 rounded-3xl border bg-surface-container-low p-3" data-testid="generation-card" data-status={generation.status}>
      <div className="flex flex-wrap items-start gap-2">
        <p className="min-w-0 flex-1 text-sm" dir="auto">
          {params.prompt}
        </p>
        <Badge variant={generation.status === "error" ? "warning" : generation.status === "complete" ? "tonal" : "outline"}>{t.images.status[generation.status]}</Badge>
      </div>
      <p className="text-xs text-muted-foreground" dir="ltr">
        {[params.model || generation.backend, `${params.width}×${params.height}`, params.seed !== null ? `seed ${params.seed}` : null, generation.seeds.find((s) => s !== null) != null ? `→ ${generation.seeds.filter((s) => s !== null).join(", ")}` : null, new Date(generation.createdAt).toLocaleString(locale)]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {running ? (
        <div className="grid gap-1">
          <div role="progressbar" aria-label={t.images.progress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} className="h-2 overflow-hidden rounded-full bg-surface-container-high">
            <div className="h-full bg-primary transition-all" style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }} />
          </div>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            {t.images.generating(Math.round(progress * 100))}
          </span>
        </div>
      ) : null}
      {generation.status === "error" ? (
        <p className="rounded-2xl bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert" dir="auto">
          {generation.error === "interrupted" ? t.images.interrupted : generation.error}
        </p>
      ) : null}
      {generation.revisedPrompt ? <p className="text-xs italic text-muted-foreground" dir="auto">{t.images.revised(generation.revisedPrompt)}</p> : null}
      {generation.imageIds.length ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {generation.imageIds.map((id) => (
            <li key={id}>
              <GeneratedImageTile attachmentId={id} prompt={params.prompt} />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {running ? (
          <Button variant="outline" size="sm" onClick={() => services().imageGen.cancel(generation.id)}>
            <X aria-hidden="true" />
            {t.common.cancel}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => onReuse(params)}>
          <RotateCcw aria-hidden="true" />
          {t.images.reuse}
        </Button>
        {!running ? (
          <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
            <Trash2 aria-hidden="true" />
            {t.common.delete}
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t.images.deleteTitle}
        description={t.images.deleteDescription}
        confirmLabel={t.common.delete}
        pending={remove.isPending}
        onConfirm={() => remove.mutate(generation.id, { onSuccess: () => setConfirm(false), onError: () => toast({ title: t.errors.generic, variant: "destructive" }) })}
      />
    </li>
  );
}

export function Gallery({ generations, onReuse }: { generations: ImageGeneration[]; onReuse: (params: ImageGenParams) => void }) {
  const { t } = useI18n();
  return (
    <ul className="grid gap-4" aria-label={t.images.history} data-testid="image-history">
      {generations.map((generation) => (
        <GenerationCard key={generation.id} generation={generation} onReuse={onReuse} />
      ))}
    </ul>
  );
}
