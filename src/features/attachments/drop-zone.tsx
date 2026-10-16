"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/** Drag & drop target covering its children, with a visible overlay while dragging. */
export function DropZone({ onFiles, disabled, children, className }: { onFiles: (files: File[]) => void; disabled?: boolean; children: ReactNode; className?: string }) {
  const { t } = useI18n();
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  return (
    <div
      className={cn("relative", className)}
      onDragEnter={(event) => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setActive(true);
      }}
      onDragOver={(event) => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setActive(false);
      }}
      onDrop={(event) => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        depth.current = 0;
        setActive(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length) onFiles(files);
      }}
    >
      {children}
      {active ? (
        <div className="pointer-events-none absolute inset-2 z-40 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-primary bg-primary/10 text-primary backdrop-blur-sm" role="status">
          <Upload className="size-8" aria-hidden="true" />
          <span className="font-medium">{t.attachments.dropHere}</span>
        </div>
      ) : null}
    </div>
  );
}
