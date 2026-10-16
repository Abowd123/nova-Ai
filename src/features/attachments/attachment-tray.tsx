"use client";

import { AlertTriangle, Film, Images, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { formatBytes } from "@/lib/media/encoding";
import { checkAttachment, type MediaTarget, type VideoModeSetting } from "@/lib/media/support";
import { cn } from "@/lib/utils";
import { AttachmentIcon } from "./attachment-icon";
import type { DraftsController } from "./use-drafts";

/** Chips for composer drafts: thumbnail, size, progress, per-model support, remove. */
export function AttachmentTray({
  controller,
  target,
  videoMode,
}: {
  controller: DraftsController;
  target: MediaTarget | null;
  videoMode: VideoModeSetting;
}) {
  const { t, locale } = useI18n();
  if (controller.drafts.length === 0) return null;
  return (
    <ul className="flex gap-2 overflow-x-auto px-1 pb-2 pt-1" aria-label={t.attachments.trayLabel} data-testid="attachment-tray">
      {controller.drafts.map((draft) => {
        const attachment = draft.attachment;
        const support = attachment && target ? checkAttachment(attachment, target, draft.videoMode ?? videoMode) : null;
        const problem = draft.status === "error" ? t.attachments.errors[draft.error ?? "storage"] : support && !support.ok ? t.attachments.problems[support.problem] : null;
        const nativeVideoPossible = attachment?.kind === "video" && target && checkAttachment(attachment, target, "native").ok;
        return (
          <li
            key={draft.localId}
            className={cn("relative flex w-48 shrink-0 items-center gap-2 rounded-2xl border bg-surface-container-high p-2", problem && "border-destructive/60")}
            data-testid="attachment-chip"
            data-status={draft.status}
          >
            <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-secondary">
              {attachment?.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={attachment.thumbnail} alt="" className="size-full object-cover" />
              ) : draft.status === "processing" ? (
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
              ) : (
                <AttachmentIcon kind={attachment?.kind ?? "file"} className="size-5" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium" dir="auto" title={draft.name}>
                {draft.name}
              </span>
              <span className="block truncate text-[0.7rem] text-muted-foreground">
                {draft.status === "processing" ? t.attachments.stages[draft.stage ?? "reading"] : formatBytes(draft.size, locale)}
              </span>
              {problem ? (
                <span className="mt-0.5 flex items-center gap-1 text-[0.7rem] text-destructive" role="alert">
                  <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
                  <span className="truncate" title={problem}>
                    {problem}
                  </span>
                </span>
              ) : null}
              {attachment?.kind === "video" && nativeVideoPossible && attachment.metadata.frameIds?.length ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-0.5 h-6 gap-1 px-1.5 text-[0.7rem]"
                  aria-pressed={(draft.videoMode ?? "native") === "frames"}
                  onClick={() => controller.setVideoMode(draft.localId, (draft.videoMode ?? "native") === "frames" ? "native" : "frames")}
                >
                  {(draft.videoMode ?? "native") === "frames" ? <Images className="size-3" aria-hidden="true" /> : <Film className="size-3" aria-hidden="true" />}
                  {(draft.videoMode ?? "native") === "frames" ? t.attachments.sendFrames : t.attachments.sendVideo}
                </Button>
              ) : null}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute -end-1.5 -top-1.5 size-6 rounded-full border bg-background"
              aria-label={t.attachments.remove(draft.name)}
              onClick={() => controller.remove(draft.localId)}
            >
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
