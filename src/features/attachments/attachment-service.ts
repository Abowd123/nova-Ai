import type { UploadedFile } from "@/lib/ai/types";
import type { MediaSource } from "@/features/chat/engine/media-resolver";
import { captureFrames, probeMedia } from "@/lib/media/av-probe";
import { blobToDataUrl, readHead, sha256Hex } from "@/lib/media/encoding";
import type { ImageProcessor } from "@/lib/media/image-processor";
import { MAX_INPUT_SIZE, THUMBNAIL_SIZE } from "@/lib/media/limits";
import { classifyFile } from "@/lib/media/sniff";
import type { Attachment, AttachmentKind, AttachmentMetadata, MediaSettings } from "@/lib/models";
import type { BlobStore, Repositories } from "@/lib/storage/types";

export type AttachmentErrorCode = "too_large" | "unsupported_type" | "type_mismatch" | "processing_failed" | "empty";

export class AttachmentError extends Error {
  constructor(
    readonly code: AttachmentErrorCode,
    readonly fileName: string,
    options?: { cause?: unknown },
  ) {
    super(`${fileName}: ${code}`, options);
    this.name = "AttachmentError";
  }
}

export interface AttachmentServiceDeps {
  repos: Repositories;
  images: Pick<ImageProcessor, "encode">;
  /** OPFS store when available (large media). */
  opfs?: BlobStore | null;
  clock?: () => number;
  /** Injected for tests; default uses the DOM <video>/<audio> elements. */
  probe?: typeof probeMedia;
  frames?: typeof captureFrames;
}

export interface PrepareOptions {
  conversationId?: string | null;
  signal?: AbortSignal;
  onStage?: (stage: "reading" | "processing" | "frames" | "saving") => void;
}

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const IDB_PREFERRED_MAX = 8 * 1024 * 1024;

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "image";
}

function extensionFor(mime: string): string {
  return mime === "image/webp" ? "webp" : mime === "image/jpeg" ? "jpg" : mime.split("/")[1] ?? "bin";
}

/**
 * Turns user files into stored attachments: validates by magic bytes, compresses/resizes
 * images (EXIF stripped), extracts video frames and thumbnails, then stores the binary in
 * IndexedDB or OPFS. UI and chat engine only see Attachment metadata + this service.
 */
export class AttachmentService {
  private readonly clock: () => number;

  constructor(private readonly deps: AttachmentServiceDeps) {
    this.clock = deps.clock ?? (() => Date.now());
  }

  private storeFor(kind: AttachmentKind, size: number, setting: MediaSettings["storage"]): BlobStore {
    const opfs = this.deps.opfs ?? null;
    if (setting === "idb" || !opfs) return this.deps.repos.blobs;
    if (setting === "opfs") return opfs;
    return kind === "video" || kind === "audio" || size > IDB_PREFERRED_MAX ? opfs : this.deps.repos.blobs;
  }

  private async store(
    meta: { kind: AttachmentKind; name: string; mimeType: string; thumbnail: string | null; metadata: AttachmentMetadata; derivedFrom?: string | null; conversationId?: string | null },
    blob: Blob,
    setting: MediaSettings["storage"],
  ): Promise<Attachment> {
    const store = this.storeFor(meta.kind, blob.size, setting);
    const sha256 = await sha256Hex(blob).catch(() => null);
    if (store.kind === "idb") {
      return this.deps.repos.attachments.create({ ...meta, size: blob.size, storage: "idb", sha256 }, blob);
    }
    const attachment = await this.deps.repos.attachments.create({ ...meta, size: blob.size, storage: "opfs", sha256 });
    try {
      await store.put(attachment.id, blob);
    } catch (error) {
      await this.deps.repos.attachments.delete(attachment.id);
      throw error;
    }
    return attachment;
  }

  /** Stores a file produced by a tool (e.g. a Python chart) as an attachment of the conversation. */
  async saveGenerated(file: { name: string; mimeType: string; data: Uint8Array }, conversationId: string | null): Promise<Attachment> {
    const kind: AttachmentKind = /^image\/(png|jpeg|webp|gif)$/.test(file.mimeType) ? "image" : "file";
    const name = file.name.split("/").pop()!.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 200) || "output";
    const blob = new Blob([file.data as BlobPart], { type: file.mimeType });
    return this.store({ kind, name, mimeType: file.mimeType, thumbnail: null, metadata: {}, conversationId }, blob, "auto");
  }

  async prepare(file: File, settings: MediaSettings, options: PrepareOptions = {}): Promise<Attachment> {
    options.onStage?.("reading");
    if (file.size === 0) throw new AttachmentError("empty", file.name);
    const classified = classifyFile(file.type, file.name, await readHead(file));
    if (!classified.ok) throw new AttachmentError(classified.reason, file.name);
    const { kind, mimeType } = classified;
    if (file.size > MAX_INPUT_SIZE[kind]) throw new AttachmentError("too_large", file.name);
    const common = { conversationId: options.conversationId ?? null, originalName: file.name, originalSize: file.size, originalMimeType: mimeType };

    try {
      options.onStage?.("processing");
      if (kind === "image") return await this.prepareImage(file, mimeType, settings, common, options);
      if (kind === "video") return await this.prepareVideo(file, mimeType, settings, common, options);
      if (kind === "audio") {
        const info = await (this.deps.probe ?? probeMedia)(file, "audio").catch(() => ({ durationMs: 0 }));
        options.onStage?.("saving");
        return await this.store(
          { kind, name: file.name, mimeType, thumbnail: null, metadata: { ...omitConversation(common), durationMs: info.durationMs }, conversationId: common.conversationId },
          file.slice(0, file.size, mimeType),
          settings.storage,
        );
      }
      const textLength = mimeType.startsWith("text/") || (mimeType.startsWith("application/") && mimeType !== "application/pdf") ? (await file.text()).length : undefined;
      options.onStage?.("saving");
      return await this.store(
        { kind, name: file.name, mimeType, thumbnail: null, metadata: { ...omitConversation(common), ...(textLength !== undefined ? { textLength } : {}) }, conversationId: common.conversationId },
        file.slice(0, file.size, mimeType),
        settings.storage,
      );
    } catch (error) {
      if (error instanceof AttachmentError) throw error;
      if ((error as { name?: string })?.name === "StorageError") throw error;
      throw new AttachmentError("processing_failed", file.name, { cause: error });
    }
  }

  private async prepareImage(
    file: File,
    mimeType: string,
    settings: MediaSettings,
    common: { conversationId: string | null; originalName: string; originalSize: number; originalMimeType: string },
    options: PrepareOptions,
  ): Promise<Attachment> {
    // Animated GIFs would lose their animation; keep originals when asked.
    const keep = settings.keepOriginalImages || mimeType === "image/gif";
    const encoded = await this.deps.images.encode({
      source: file,
      maxDimension: keep ? 1 << 14 : settings.imageMaxDimension,
      format: settings.imageFormat,
      quality: settings.imageQuality,
      thumbnailSize: THUMBNAIL_SIZE,
    });
    const thumbnail = await blobToDataUrl(encoded.thumbnail, "image/jpeg");
    const useEncoded = !keep && (encoded.blob.size < file.size || encoded.width < encoded.originalWidth || mimeType === "image/heic" || mimeType === "image/avif");
    const blob = useEncoded ? encoded.blob : file.slice(0, file.size, mimeType);
    const outMime = useEncoded ? encoded.blob.type || settings.imageFormat : mimeType;
    options.onStage?.("saving");
    return this.store(
      {
        kind: "image",
        name: useEncoded ? `${baseName(file.name)}.${extensionFor(outMime)}` : file.name,
        mimeType: outMime,
        thumbnail,
        metadata: {
          ...omitConversation(common),
          width: useEncoded ? encoded.width : encoded.originalWidth,
          height: useEncoded ? encoded.height : encoded.originalHeight,
          compressed: useEncoded,
        },
        conversationId: common.conversationId,
      },
      blob,
      settings.storage,
    );
  }

  private async prepareVideo(
    file: File,
    mimeType: string,
    settings: MediaSettings,
    common: { conversationId: string | null; originalName: string; originalSize: number; originalMimeType: string },
    options: PrepareOptions,
  ): Promise<Attachment> {
    const info = await (this.deps.probe ?? probeMedia)(file, "video").catch(() => ({ durationMs: 0 }) as { durationMs: number; width?: number; height?: number });
    options.onStage?.("saving");
    const video = await this.store(
      {
        kind: "video",
        name: file.name,
        mimeType,
        thumbnail: null,
        metadata: { ...omitConversation(common), durationMs: info.durationMs, ...(info.width ? { width: info.width, height: info.height } : {}) },
        conversationId: common.conversationId,
      },
      file.slice(0, file.size, mimeType),
      settings.storage,
    );

    // Frames make videos usable with any vision model. Failure is not fatal.
    options.onStage?.("frames");
    const frameIds: string[] = [];
    let thumbnail: string | null = null;
    let times: number[] = [];
    try {
      times = await (this.deps.frames ?? captureFrames)(file, settings.videoFrameCount, async (frame, timeMs, index) => {
        if (options.signal?.aborted) {
          frame.close();
          throw new DOMException("Aborted", "AbortError");
        }
        const encoded = await this.deps.images.encode({ source: frame, maxDimension: Math.min(settings.imageMaxDimension, 1024), format: "image/jpeg", quality: 0.8, thumbnailSize: THUMBNAIL_SIZE });
        if (index === 0) thumbnail = await blobToDataUrl(encoded.thumbnail, "image/jpeg");
        const stored = await this.store(
          {
            kind: "image",
            name: `${baseName(file.name)}-frame-${index + 1}.jpg`,
            mimeType: "image/jpeg",
            thumbnail: null,
            metadata: { width: encoded.width, height: encoded.height, durationMs: timeMs },
            derivedFrom: video.id,
            conversationId: common.conversationId,
          },
          encoded.blob,
          "idb",
        );
        frameIds.push(stored.id);
      });
    } catch (error) {
      if (options.signal?.aborted) {
        await this.remove(video);
        throw error;
      }
    }
    return this.deps.repos.attachments.update(video.id, {
      thumbnail,
      metadata: { ...video.metadata, ...(frameIds.length ? { frameIds, frameTimesMs: times.slice(0, frameIds.length) } : {}) },
    });
  }

  async getBlob(attachment: Attachment): Promise<Blob | undefined> {
    if (attachment.storage === "opfs") return (await this.deps.opfs?.get(attachment.id)) ?? undefined;
    return this.deps.repos.blobs.get(attachment.id);
  }

  async remove(attachmentOrId: Attachment | string): Promise<void> {
    const attachment = typeof attachmentOrId === "string" ? await this.deps.repos.attachments.get(attachmentOrId) : attachmentOrId;
    if (!attachment) return;
    await this.deps.repos.attachments.delete(attachment.id);
    if (attachment.storage === "opfs") await this.deps.opfs?.delete(attachment.id).catch(() => undefined);
  }

  /** Removes abandoned composer drafts and OPFS files whose metadata no longer exists. */
  async sweep(): Promise<{ drafts: number; files: number }> {
    const stale = await this.deps.repos.attachments.listUnlinked(this.clock() - DRAFT_TTL_MS);
    const drafts = stale.filter((a) => a.conversationId !== null || a.derivedFrom !== null);
    for (const attachment of drafts) await this.remove(attachment);
    let files = 0;
    if (this.deps.opfs) {
      const known = new Set(await this.deps.repos.attachments.allIds());
      for (const id of await this.deps.opfs.list()) {
        if (!known.has(id)) {
          await this.deps.opfs.delete(id);
          files += 1;
        }
      }
    }
    return { drafts: drafts.length, files };
  }

  /** Read-only view used by the chat engine. */
  asMediaSource(): MediaSource {
    return {
      getAttachment: (id) => this.deps.repos.attachments.get(id),
      getAttachments: (ids) => this.deps.repos.attachments.getMany(ids),
      getBlob: (attachment) => this.getBlob(attachment),
      saveRemoteRef: async (attachment: Attachment, providerId: string, ref: UploadedFile) => {
        const latest = (await this.deps.repos.attachments.get(attachment.id)) ?? attachment;
        await this.deps.repos.attachments.update(attachment.id, { remoteRefs: { ...latest.remoteRefs, [providerId]: ref } });
      },
    };
  }
}

function omitConversation<T extends { conversationId: unknown }>(value: T): Omit<T, "conversationId"> {
  const { conversationId: _ignored, ...rest } = value;
  return rest;
}
