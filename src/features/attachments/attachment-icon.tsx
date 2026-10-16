import { FileAudio, FileText, FileVideo, Image as ImageIcon } from "lucide-react";
import type { AttachmentKind } from "@/lib/models";

export function AttachmentIcon({ kind, className }: { kind: AttachmentKind; className?: string }) {
  const Icon = kind === "image" ? ImageIcon : kind === "video" ? FileVideo : kind === "audio" ? FileAudio : FileText;
  return <Icon className={className} aria-hidden="true" />;
}
