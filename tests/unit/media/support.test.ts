import { describe, expect, it } from "vitest";
import { checkAttachment, checkAttachments, type MediaTarget } from "@/lib/media/support";
import type { ModelCapabilities } from "@/lib/models";

const caps = (over: Partial<ModelCapabilities> = {}): ModelCapabilities => ({ vision: false, audio: false, video: false, tools: false, reasoning: false, ...over });
const target = (providerKind: MediaTarget["providerKind"], c: Partial<ModelCapabilities>, canUpload = false): MediaTarget => ({ providerKind, capabilities: caps(c), canUpload });
const MB = 1024 * 1024;
const att = (kind: "image" | "video" | "audio" | "file", mimeType: string, size = 1000, frameIds?: string[]) => ({ kind, mimeType, size, metadata: { frameIds } });

describe("checkAttachment", () => {
  it("blocks images on text-only models", () => {
    expect(checkAttachment(att("image", "image/png"), target("openai", {}))).toEqual({ ok: false, problem: "image_unsupported" });
    expect(checkAttachment(att("image", "image/png"), target("openai", { vision: true }))).toEqual({ ok: true, strategy: { kind: "inline" } });
  });

  it("uploads large images only on Gemini", () => {
    expect(checkAttachment(att("image", "image/png", 30 * MB), target("gemini", { vision: true }, true))).toEqual({ ok: true, strategy: { kind: "upload" } });
    expect(checkAttachment(att("image", "image/png", 30 * MB), target("openai", { vision: true }, true))).toEqual({ ok: false, problem: "too_large" });
  });

  it("sends native video to Gemini and frames elsewhere", () => {
    const video = att("video", "video/mp4", 5 * MB, ["f1", "f2"]);
    expect(checkAttachment(video, target("gemini", { vision: true, video: true }, true))).toEqual({ ok: true, strategy: { kind: "inline" } });
    expect(checkAttachment(video, target("gemini", { vision: true, video: true }, true), "frames")).toEqual({ ok: true, strategy: { kind: "frames" } });
    expect(checkAttachment(video, target("openai", { vision: true }))).toEqual({ ok: true, strategy: { kind: "frames" } });
    expect(checkAttachment(video, target("openai", { vision: true }), "native")).toEqual({ ok: false, problem: "video_unsupported" });
    expect(checkAttachment(att("video", "video/mp4"), target("openai", { vision: true }))).toEqual({ ok: false, problem: "frames_missing" });
    expect(checkAttachment(video, target("openai", {}))).toEqual({ ok: false, problem: "video_unsupported" });
  });

  it("checks audio formats per provider", () => {
    expect(checkAttachment(att("audio", "audio/mpeg"), target("openai", { audio: true }))).toEqual({ ok: true, strategy: { kind: "inline" } });
    expect(checkAttachment(att("audio", "audio/webm"), target("openai", { audio: true }))).toEqual({ ok: false, problem: "audio_format" });
    expect(checkAttachment(att("audio", "audio/webm"), target("gemini", { audio: true }))).toEqual({ ok: true, strategy: { kind: "inline" } });
    expect(checkAttachment(att("audio", "audio/mpeg"), target("anthropic", { audio: true }))).toEqual({ ok: false, problem: "audio_unsupported" });
  });

  it("inlines text files everywhere and PDFs only where supported", () => {
    expect(checkAttachment(att("file", "text/markdown"), target("ollama", {}))).toEqual({ ok: true, strategy: { kind: "text" } });
    expect(checkAttachment(att("file", "application/pdf"), target("anthropic", {}))).toEqual({ ok: true, strategy: { kind: "inline" } });
    expect(checkAttachment(att("file", "application/pdf"), target("ollama", {}))).toEqual({ ok: false, problem: "file_unsupported" });
    expect(checkAttachment(att("file", "application/pdf", 50 * MB), target("openai", {}, true))).toEqual({ ok: true, strategy: { kind: "upload" } });
  });
});

describe("checkAttachments", () => {
  it("reports every attachment and the overall result", () => {
    const list = [
      { id: "a", name: "a.png", ...att("image", "image/png") },
      { id: "b", name: "b.txt", ...att("file", "text/plain") },
    ];
    const result = checkAttachments(list, target("openai", {}));
    expect(result.ok).toBe(false);
    expect(result.checks.map((c) => c.result.ok)).toEqual([false, true]);
    expect(checkAttachments(list, target("openai", { vision: true })).ok).toBe(true);
    expect(checkAttachments(list, null).ok).toBe(false);
  });
});
