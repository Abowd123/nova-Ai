import { ProviderError } from "@/lib/ai/errors";
import type { ChatMessage, ChatProvider, ChatRequest, UploadedFile } from "@/lib/ai/types";
import { blobToBase64 } from "@/lib/media/encoding";
import { MAX_INLINE_TEXT_CHARS } from "@/lib/media/limits";
import { checkAttachment, type MediaTarget, type SupportProblem, type VideoModeSetting } from "@/lib/media/support";
import { formatDuration } from "@/lib/media/encoding";
import { isMediaPart, type Attachment, type MediaPart, type MessagePart, type ModelCapabilities, type ProviderKind } from "@/lib/models";

export interface MediaSource {
  getAttachment(id: string): Promise<Attachment | undefined>;
  getAttachments(ids: string[]): Promise<Attachment[]>;
  getBlob(attachment: Attachment): Promise<Blob | undefined>;
  saveRemoteRef(attachment: Attachment, providerId: string, ref: UploadedFile): Promise<void>;
}

export interface ResolveContext {
  providerId: string;
  providerKind: ProviderKind;
  capabilities: ModelCapabilities;
  provider: Pick<ChatProvider, "uploadFile">;
  videoMode: VideoModeSetting;
  now: () => number;
  signal?: AbortSignal;
}

export class MediaError extends ProviderError {
  constructor(
    readonly problem: SupportProblem | "missing",
    readonly attachmentName: string,
  ) {
    super("unsupported", `Attachment "${attachmentName}" cannot be sent: ${problem}`, { retryable: false });
    this.name = "MediaError";
  }
}

/** Uploads expire; keep a 10 min safety margin. */
const EXPIRY_MARGIN_MS = 10 * 60 * 1000;

function placeholder(part: MediaPart, attachment: Attachment | undefined): MessagePart {
  const name = attachment?.name ?? part.name ?? part.type;
  return { type: "text", text: `[${part.type}: ${name}]` };
}

/**
 * Replaces attachment references with provider-ready parts (base64 inline, uploaded file
 * reference, extracted text or video frames). Only the LAST user message is strict: media
 * in older turns that the current model can't read is replaced by a short placeholder so
 * switching models mid-conversation keeps working.
 */
export async function resolveRequestMedia(request: ChatRequest, source: MediaSource, context: ResolveContext): Promise<ChatRequest> {
  const target: MediaTarget = {
    providerKind: context.providerKind,
    capabilities: context.capabilities,
    canUpload: typeof context.provider.uploadFile === "function",
  };
  const lastUserIndex = request.messages.map((m) => m.role).lastIndexOf("user");

  const messages: ChatMessage[] = [];
  for (const [index, message] of request.messages.entries()) {
    if (!message.parts.some(isMediaPart)) {
      messages.push(message);
      continue;
    }
    const strict = index === lastUserIndex;
    const parts: MessagePart[] = [];
    for (const part of message.parts) {
      if (!isMediaPart(part) || !part.attachmentId || part.data || part.url || part.fileId) {
        parts.push(part);
        continue;
      }
      parts.push(...(await resolvePart(part, strict, source, context, target)));
    }
    messages.push({ ...message, parts });
  }
  return { ...request, messages };
}

async function resolvePart(part: MediaPart, strict: boolean, source: MediaSource, context: ResolveContext, target: MediaTarget): Promise<MessagePart[]> {
  const attachment = await source.getAttachment(part.attachmentId!);
  if (!attachment) {
    if (strict) throw new MediaError("missing", part.name ?? part.type);
    return [placeholder(part, undefined)];
  }
  const videoMode = part.type === "video" && part.mode ? part.mode : context.videoMode;
  const support = checkAttachment(attachment, target, videoMode);
  if (!support.ok) {
    if (strict) throw new MediaError(support.problem, attachment.name);
    return [placeholder(part, attachment)];
  }

  const loadBlob = async (a: Attachment) => {
    const blob = await source.getBlob(a);
    if (!blob) throw new MediaError("missing", a.name);
    return blob;
  };

  switch (support.strategy.kind) {
    case "text": {
      const text = await (await loadBlob(attachment)).text();
      const truncated = text.length > MAX_INLINE_TEXT_CHARS;
      const body = truncated ? text.slice(0, MAX_INLINE_TEXT_CHARS) : text;
      const fence = body.includes("```") ? "````" : "```";
      return [
        {
          type: "text",
          text: `File: ${attachment.name}${truncated ? ` (first ${MAX_INLINE_TEXT_CHARS} characters)` : ""}\n${fence}\n${body}\n${fence}`,
        },
      ];
    }
    case "frames": {
      const frameIds = attachment.metadata.frameIds ?? [];
      const frames = await source.getAttachments(frameIds);
      const times = attachment.metadata.frameTimesMs ?? [];
      const images: MessagePart[] = [];
      for (const frame of frames) {
        images.push({ type: "image", mimeType: frame.mimeType, data: await blobToBase64(await loadBlob(frame)), name: frame.name });
      }
      const when = times.map(formatDuration).join(", ");
      return [
        { type: "text", text: `Video "${attachment.name}"${attachment.metadata.durationMs ? ` (${formatDuration(attachment.metadata.durationMs)})` : ""}: ${images.length} frames at ${when}.` },
        ...images,
      ];
    }
    case "upload": {
      const cached = attachment.remoteRefs[context.providerId];
      let ref: UploadedFile;
      if (cached && (cached.expiresAt === null || cached.expiresAt - EXPIRY_MARGIN_MS > context.now())) {
        ref = cached;
      } else {
        if (!context.provider.uploadFile) throw new MediaError("too_large", attachment.name);
        ref = await context.provider.uploadFile(
          { blob: await loadBlob(attachment), name: attachment.name, mimeType: attachment.mimeType },
          { signal: context.signal },
        );
        await source.saveRemoteRef(attachment, context.providerId, ref);
      }
      const base = { ...part, mimeType: attachment.mimeType, name: attachment.name };
      return [ref.kind === "file_id" ? { ...base, fileId: ref.ref } : { ...base, url: ref.ref }];
    }
    case "inline": {
      const data = await blobToBase64(await loadBlob(attachment));
      return [{ ...part, mimeType: attachment.mimeType, name: attachment.name, data }];
    }
  }
}
