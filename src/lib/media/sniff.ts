import type { AttachmentKind } from "@/lib/models";
import { ACCEPTED_TYPES } from "./limits";

/**
 * Detects the real type from magic bytes. We never trust the browser-reported MIME
 * type alone: a renamed .exe must not become "image/png".
 */
export function sniffMime(head: Uint8Array): string | null {
  const b = head;
  const at = (offset: number, bytes: number[]) => bytes.every((byte, i) => b[offset + i] === byte);
  const ascii = (offset: number, text: string) => at(offset, [...text].map((c) => c.charCodeAt(0)));

  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(0, "RIFF") && ascii(8, "WAVE")) return "audio/wav";
  if (ascii(0, "%PDF-")) return "application/pdf";
  if (ascii(0, "OggS")) return "audio/ogg";
  if (ascii(0, "fLaC")) return "audio/flac";
  if (ascii(0, "ID3") || (b[0] === 0xff && b[1] !== undefined && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) return "audio/mpeg";
  if (at(0, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm"; // EBML: webm/mkv (audio-only webm handled by caller)
  if (ascii(4, "ftyp")) {
    const brand = String.fromCharCode(...b.slice(8, 12));
    if (/^(heic|heix|hevc|mif1|msf1)$/.test(brand)) return "image/heic";
    if (/^avi[fs]$/.test(brand)) return "image/avif";
    if (/^qt {2}$/.test(brand)) return "video/quicktime";
    if (/^M4A /.test(brand)) return "audio/mp4";
    return "video/mp4";
  }
  return null;
}

const EXTENSIONS: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  json: "application/json",
  yaml: "application/x-yaml",
  yml: "application/x-yaml",
  xml: "application/xml",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  py: "text/x-python",
  js: "text/javascript",
  mjs: "text/javascript",
  jsx: "text/javascript",
  ts: "text/x-typescript",
  tsx: "text/x-typescript",
  sql: "text/plain",
  sh: "text/plain",
  pdf: "application/pdf",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  webm: "video/webm",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

export function mimeFromName(name: string): string | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return EXTENSIONS[ext] ?? null;
}

const TEXT_MIME = /^(text\/|application\/(json|xml|x-yaml|javascript))/;
export function isTextMime(mime: string): boolean {
  return TEXT_MIME.test(mime);
}

/** Plain text heuristic: valid UTF-8 and almost no control characters. */
export function looksLikeText(head: Uint8Array): boolean {
  if (head.length === 0) return true;
  const sample = head.length > 4096 ? head.slice(0, 4096) : head;
  try {
    // stream: true tolerates a multi-byte character cut at the end of the sample.
    new TextDecoder("utf-8", { fatal: true }).decode(sample, { stream: true });
  } catch {
    return false;
  }
  let control = 0;
  for (const byte of head.slice(0, 4096)) if (byte < 9 || (byte > 13 && byte < 32)) control += 1;
  return control / Math.min(head.length, 4096) < 0.01;
}

export function kindOfMime(mime: string): AttachmentKind | null {
  for (const kind of ["image", "video", "audio", "file"] as const) {
    if (ACCEPTED_TYPES[kind].includes(mime)) return kind;
  }
  if (isTextMime(mime)) return "file";
  return null;
}

export type ClassifyResult =
  | { ok: true; kind: AttachmentKind; mimeType: string }
  | { ok: false; reason: "unsupported_type" | "type_mismatch" };

/**
 * Decides kind + trusted MIME type from (reported type, file name, first bytes).
 * Binary signatures win; text files are accepted only if they really look like text.
 */
export function classifyFile(reported: string, name: string, head: Uint8Array): ClassifyResult {
  const sniffed = sniffMime(head);
  const declared = (reported || mimeFromName(name) || "").toLowerCase();
  if (sniffed) {
    // EBML container: audio-only WebM is reported as audio/webm.
    const mime = sniffed === "video/webm" && declared === "audio/webm" ? "audio/webm" : sniffed === "video/mp4" && declared.startsWith("audio/") ? "audio/mp4" : sniffed;
    const kind = kindOfMime(mime);
    if (!kind) return { ok: false, reason: "unsupported_type" };
    if (declared && declared !== mime) {
      const declaredKind = kindOfMime(declared);
      // Same family (jpeg vs jpg variants, mp4 vs quicktime) is fine; image vs pdf is not.
      if (declaredKind && declaredKind !== kind && !(declaredKind === "audio" && kind === "video")) return { ok: false, reason: "type_mismatch" };
    }
    return { ok: true, kind, mimeType: mime };
  }
  const textMime = isTextMime(declared) ? declared : mimeFromName(name);
  if (textMime && isTextMime(textMime) && looksLikeText(head)) return { ok: true, kind: "file", mimeType: textMime };
  return { ok: false, reason: kindOfMime(declared) ? "type_mismatch" : "unsupported_type" };
}
