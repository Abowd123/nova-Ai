import type { Attachment, ModelCapabilities, ProviderKind } from "@/lib/models";
import { MAX_INLINE_BYTES } from "./limits";
import { isTextMime } from "./sniff";

export type VideoModeSetting = "auto" | "native" | "frames";

export interface MediaTarget {
  providerKind: ProviderKind;
  capabilities: ModelCapabilities;
  /** Provider adapter implements uploadFile (OpenAI Files / Gemini Files API). */
  canUpload: boolean;
}

export type MediaStrategy =
  | { kind: "inline" }
  | { kind: "upload" }
  | { kind: "text" }
  | { kind: "frames" };

export type SupportProblem =
  | "image_unsupported"
  | "video_unsupported"
  | "audio_unsupported"
  | "audio_format"
  | "file_unsupported"
  | "too_large"
  | "frames_missing";

export type SupportResult = { ok: true; strategy: MediaStrategy } | { ok: false; problem: SupportProblem };

type AttachmentLike = Pick<Attachment, "kind" | "mimeType" | "size"> & { metadata: Pick<Attachment["metadata"], "frameIds"> };

const OPENAI_AUDIO = new Set(["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3"]);
/** Providers that accept a whole video file in chat requests. */
const NATIVE_VIDEO: ReadonlySet<ProviderKind> = new Set(["gemini"]);
/** Providers that accept PDF documents natively. */
const PDF_INPUT: ReadonlySet<ProviderKind> = new Set(["openai", "anthropic", "gemini", "openrouter"]);

function inlineOrUpload(size: number, target: MediaTarget): SupportResult {
  if (size <= (MAX_INLINE_BYTES[target.providerKind] ?? MAX_INLINE_BYTES.custom!)) return { ok: true, strategy: { kind: "inline" } };
  if (target.canUpload) return { ok: true, strategy: { kind: "upload" } };
  return { ok: false, problem: "too_large" };
}

/** Decides HOW an attachment is sent to a given model, or why it can't be. Pure. */
export function checkAttachment(attachment: AttachmentLike, target: MediaTarget, videoMode: VideoModeSetting = "auto"): SupportResult {
  const { capabilities: caps, providerKind } = target;
  switch (attachment.kind) {
    case "image":
      if (!caps.vision) return { ok: false, problem: "image_unsupported" };
      return inlineOrUpload(attachment.size, { ...target, canUpload: target.canUpload && providerKind === "gemini" });
    case "video": {
      const native = caps.video && NATIVE_VIDEO.has(providerKind);
      const frames = caps.vision && (attachment.metadata.frameIds?.length ?? 0) > 0;
      if (videoMode === "frames" || (videoMode === "auto" && !native)) {
        if (frames) return { ok: true, strategy: { kind: "frames" } };
        return { ok: false, problem: caps.vision ? "frames_missing" : "video_unsupported" };
      }
      if (!native) return { ok: false, problem: "video_unsupported" };
      return inlineOrUpload(attachment.size, target);
    }
    case "audio":
      if (!caps.audio || providerKind === "anthropic" || providerKind === "ollama") return { ok: false, problem: "audio_unsupported" };
      if (providerKind !== "gemini" && !OPENAI_AUDIO.has(attachment.mimeType)) return { ok: false, problem: "audio_format" };
      return inlineOrUpload(attachment.size, { ...target, canUpload: target.canUpload && providerKind === "gemini" });
    case "file":
      if (isTextMime(attachment.mimeType)) return { ok: true, strategy: { kind: "text" } };
      if (attachment.mimeType === "application/pdf" && PDF_INPUT.has(providerKind)) return inlineOrUpload(attachment.size, target);
      return { ok: false, problem: "file_unsupported" };
  }
}

export interface AttachmentCheck {
  id: string;
  name: string;
  result: SupportResult;
}

export function checkAttachments(
  attachments: readonly (AttachmentLike & { id: string; name: string })[],
  target: MediaTarget | null,
  videoMode: VideoModeSetting = "auto",
): { ok: boolean; checks: AttachmentCheck[] } {
  const checks = attachments.map((a) => ({
    id: a.id,
    name: a.name,
    result: target ? checkAttachment(a, target, videoMode) : ({ ok: false, problem: "image_unsupported" } as SupportResult),
  }));
  return { ok: checks.every((c) => c.result.ok), checks };
}
