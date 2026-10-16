import type { AttachmentKind } from "@/lib/models";

const MB = 1024 * 1024;

/** Max bytes accepted from the user, per kind (before compression). */
export const MAX_INPUT_SIZE: Record<AttachmentKind, number> = {
  image: 40 * MB,
  video: 1024 * MB,
  audio: 200 * MB,
  file: 100 * MB,
};

/** Max bytes we inline as base64 in a JSON request. Larger media must be uploaded or rejected. */
export const MAX_INLINE_BYTES: Record<string, number> = {
  openai: 20 * MB,
  anthropic: 5 * MB, // per image; PDFs up to 32 MB
  gemini: 20 * MB, // total request; Files API above
  openrouter: 20 * MB,
  ollama: 20 * MB,
  custom: 20 * MB,
};

export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
/** Text-like files are inlined into the prompt up to this many characters. */
export const MAX_INLINE_TEXT_CHARS = 200_000;
export const THUMBNAIL_SIZE = 256;

export const ACCEPTED_TYPES: Record<AttachmentKind, readonly string[]> = {
  image: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/heic", "image/heif", "image/avif"],
  video: ["video/mp4", "video/webm", "video/quicktime", "video/ogg"],
  audio: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg", "audio/mp4", "audio/aac", "audio/flac", "audio/x-m4a"],
  file: [
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/csv",
    "text/html",
    "text/css",
    "text/xml",
    "application/json",
    "application/xml",
    "application/x-yaml",
    "text/x-python",
    "text/javascript",
    "application/javascript",
    "text/x-typescript",
  ],
};

/** For <input accept>. Extensions help mobile pickers that report empty MIME types. */
export const ACCEPT_ATTRIBUTE = [
  "image/*",
  "video/*",
  "audio/*",
  ...ACCEPTED_TYPES.file,
  ".md",
  ".txt",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".py",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".html",
  ".css",
  ".xml",
  ".pdf",
  ".log",
  ".sql",
  ".sh",
].join(",");
