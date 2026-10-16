"use client";

import { useState } from "react";
import { Download, FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/hooks/use-i18n";
import { downloadUrl } from "@/lib/files";
import { formatBytes, formatDuration } from "@/lib/media/encoding";
import { isMediaPart, type MediaPart, type MessagePart } from "@/lib/models";
import { cn } from "@/lib/utils";
import { AttachmentIcon } from "./attachment-icon";
import { useAttachmentUrl } from "./use-attachment-url";

function MissingMedia({ name }: { name: string }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-xl bg-muted px-2 py-1 text-xs text-muted-foreground">
      <FileWarning className="size-3.5" aria-hidden="true" />
      {t.attachments.missing(name)}
    </span>
  );
}

function ImageMedia({ part }: { part: MediaPart }) {
  const { t } = useI18n();
  const { url, attachment, missing, loading } = useAttachmentUrl(part.attachmentId);
  const [open, setOpen] = useState(false);
  const name = attachment?.name ?? part.name ?? "image";
  if (missing) return <MissingMedia name={name} />;
  const width = attachment?.metadata.width;
  const height = attachment?.metadata.height;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block overflow-hidden rounded-2xl bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t.attachments.openImage(name)}
        style={width && height ? { aspectRatio: `${width} / ${height}` } : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url ?? attachment?.thumbnail ?? undefined}
          alt={name}
          loading="lazy"
          className={cn("max-h-72 w-full max-w-xs object-cover", loading && "animate-pulse")}
          width={width}
          height={height}
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={t.common.close} className="max-w-4xl p-2">
          <DialogTitle className="sr-only">{name}</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {url ? <img src={url} alt={name} className="max-h-[80vh] w-full rounded-2xl object-contain" /> : null}
          <div className="flex items-center justify-between gap-2 px-2 pb-1 text-xs text-muted-foreground">
            <span dir="auto" className="truncate">
              {name}
              {width && height ? ` · ${width}×${height}` : ""}
            </span>
            {url ? (
              <Button variant="ghost" size="sm" onClick={() => downloadUrl(url, name)}>
                <Download aria-hidden="true" />
                {t.common.download}
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AvMedia({ part }: { part: MediaPart }) {
  const { url, attachment, missing } = useAttachmentUrl(part.attachmentId);
  const name = attachment?.name ?? part.name ?? part.type;
  if (missing) return <MissingMedia name={name} />;
  if (part.type === "video") {
    return (
      <video
        controls
        preload="metadata"
        playsInline
        src={url ?? undefined}
        poster={attachment?.thumbnail ?? undefined}
        className="max-h-80 w-full max-w-sm rounded-2xl bg-black"
        aria-label={name}
      />
    );
  }
  return (
    <div className="flex w-full max-w-sm flex-col gap-1 rounded-2xl bg-surface-container px-3 py-2">
      <span className="truncate text-xs" dir="auto">
        {name}
        {attachment?.metadata.durationMs ? ` · ${formatDuration(attachment.metadata.durationMs)}` : ""}
      </span>
      <audio controls preload="metadata" src={url ?? undefined} className="w-full" aria-label={name} />
    </div>
  );
}

function FileMedia({ part }: { part: MediaPart }) {
  const { t, locale } = useI18n();
  const { url, attachment, missing } = useAttachmentUrl(part.attachmentId);
  const name = attachment?.name ?? part.name ?? "file";
  if (missing) return <MissingMedia name={name} />;
  return (
    <div className="flex w-full max-w-xs items-center gap-2 rounded-2xl bg-surface-container px-3 py-2">
      <AttachmentIcon kind="file" className="size-5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm" dir="auto">
          {name}
        </span>
        {attachment ? <span className="block text-xs text-muted-foreground">{formatBytes(attachment.size, locale)}</span> : null}
      </span>
      {url ? (
        <Button variant="ghost" size="icon-sm" aria-label={t.attachments.download(name)} onClick={() => downloadUrl(url, name)}>
          <Download aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

/** Renders the media parts of a message (user uploads or generated content). */
export function MessageAttachments({ parts, align }: { parts: readonly MessagePart[]; align: "start" | "end" }) {
  const { t } = useI18n();
  const media = parts.filter(isMediaPart);
  if (media.length === 0) return null;
  return (
    <ul className={cn("flex max-w-[85%] flex-wrap gap-2 sm:max-w-[75%]", align === "end" ? "justify-end" : "justify-start")} aria-label={t.attachments.inMessage(media.length)} data-testid="message-attachments">
      {media.map((part, index) => (
        <li key={part.attachmentId ?? index}>
          {part.type === "image" ? <ImageMedia part={part} /> : part.type === "file" ? <FileMedia part={part} /> : <AvMedia part={part} />}
        </li>
      ))}
    </ul>
  );
}
