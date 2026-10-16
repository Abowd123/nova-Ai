import { describe, expect, it } from "vitest";
import { classifyFile, isTextMime, looksLikeText, mimeFromName, sniffMime } from "@/lib/media/sniff";

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(values.flatMap((v) => (typeof v === "string" ? [...v].map((c) => c.charCodeAt(0)) : [v])));

describe("sniffMime", () => {
  it("detects common signatures", () => {
    expect(sniffMime(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffMime(bytes("GIF89a"))).toBe("image/gif");
    expect(sniffMime(bytes("RIFF", 0, 0, 0, 0, "WEBP"))).toBe("image/webp");
    expect(sniffMime(bytes("RIFF", 0, 0, 0, 0, "WAVE"))).toBe("audio/wav");
    expect(sniffMime(bytes("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffMime(bytes("ID3", 4))).toBe("audio/mpeg");
    expect(sniffMime(bytes(0xff, 0xfb, 0x90))).toBe("audio/mpeg");
    expect(sniffMime(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe("video/webm");
    expect(sniffMime(bytes(0, 0, 0, 0x20, "ftypisom"))).toBe("video/mp4");
    expect(sniffMime(bytes(0, 0, 0, 0x20, "ftypheic"))).toBe("image/heic");
    expect(sniffMime(bytes(0, 0, 0, 0x20, "ftypqt  "))).toBe("video/quicktime");
    expect(sniffMime(bytes("hello"))).toBeNull();
  });
});

describe("text detection", () => {
  it("recognises text MIME types and extensions", () => {
    expect(isTextMime("text/markdown")).toBe(true);
    expect(isTextMime("application/json")).toBe(true);
    expect(isTextMime("application/pdf")).toBe(false);
    expect(mimeFromName("Notes.MD")).toBe("text/markdown");
  });

  it("accepts UTF-8 (including Arabic) and rejects binary", () => {
    expect(looksLikeText(new TextEncoder().encode("مرحبا بالعالم\nhello"))).toBe(true);
    expect(looksLikeText(new Uint8Array([0, 1, 2, 3, 0, 0, 5, 6]))).toBe(false);
    expect(looksLikeText(new Uint8Array([0xc3, 0x28]))).toBe(false);
  });
});

describe("classifyFile", () => {
  const png = bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a);
  it("trusts magic bytes over the reported type", () => {
    expect(classifyFile("", "photo", png)).toEqual({ ok: true, kind: "image", mimeType: "image/png" });
    expect(classifyFile("image/jpeg", "photo.jpg", png)).toEqual({ ok: true, kind: "image", mimeType: "image/png" });
  });

  it("rejects a disguised file (image named .pdf)", () => {
    expect(classifyFile("application/pdf", "doc.pdf", png)).toEqual({ ok: false, reason: "type_mismatch" });
  });

  it("treats audio-only WebM as audio", () => {
    expect(classifyFile("audio/webm", "rec.webm", bytes(0x1a, 0x45, 0xdf, 0xa3))).toEqual({ ok: true, kind: "audio", mimeType: "audio/webm" });
  });

  it("classifies text files by name and content", () => {
    expect(classifyFile("", "main.ts", new TextEncoder().encode("export const a = 1;"))).toMatchObject({ ok: true, kind: "file" });
    expect(classifyFile("text/plain", "a.txt", new Uint8Array([0, 0, 0, 1, 2, 3]))).toMatchObject({ ok: false });
  });

  it("rejects unknown binaries", () => {
    expect(classifyFile("application/x-msdownload", "setup.exe", bytes("MZ", 0x90, 0))).toEqual({ ok: false, reason: "unsupported_type" });
  });
});
