import { describe, expect, it } from "vitest";
import { MediaError, resolveRequestMedia, type MediaSource, type ResolveContext } from "@/features/chat/engine/media-resolver";
import type { ChatRequest, UploadedFile } from "@/lib/ai/types";
import type { Attachment, ModelCapabilities } from "@/lib/models";

function attachment(id: string, over: Partial<Attachment> = {}): Attachment {
  return {
    id,
    conversationId: "c1",
    messageId: "m1",
    kind: "image",
    name: `${id}.png`,
    mimeType: "image/png",
    size: 3,
    storage: "idb",
    thumbnail: null,
    sha256: null,
    metadata: {},
    remoteRefs: {},
    derivedFrom: null,
    schemaVersion: 2,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  } as Attachment;
}

function source(items: Attachment[], blobs: Record<string, Blob>) {
  const saved: { id: string; providerId: string; ref: UploadedFile }[] = [];
  const map = new Map(items.map((a) => [a.id, a]));
  const src: MediaSource = {
    getAttachment: async (id) => map.get(id),
    getAttachments: async (ids) => ids.map((id) => map.get(id)).filter((a): a is Attachment => Boolean(a)),
    getBlob: async (a) => blobs[a.id],
    saveRemoteRef: async (a, providerId, ref) => {
      saved.push({ id: a.id, providerId, ref });
    },
  };
  return { src, saved };
}

const caps = (over: Partial<ModelCapabilities> = {}): ModelCapabilities => ({ vision: true, audio: false, video: false, tools: false, reasoning: false, ...over });
const ctx = (over: Partial<ResolveContext> = {}): ResolveContext => ({
  providerId: "p1",
  providerKind: "openai",
  capabilities: caps(),
  provider: {},
  videoMode: "auto",
  now: () => 1_000_000,
  ...over,
});

const request = (...messages: ChatRequest["messages"]): ChatRequest => ({ model: "m", messages });

describe("resolveRequestMedia", () => {
  it("inlines images as base64", async () => {
    const { src } = source([attachment("a")], { a: new Blob(["abc"]) });
    const out = await resolveRequestMedia(request({ role: "user", parts: [{ type: "image", attachmentId: "a", mimeType: "image/png" }, { type: "text", text: "what?" }] }), src, ctx());
    expect(out.messages[0]!.parts).toEqual([
      { type: "image", attachmentId: "a", mimeType: "image/png", name: "a.png", data: "YWJj" },
      { type: "text", text: "what?" },
    ]);
  });

  it("inlines text files in a fence", async () => {
    const file = attachment("t", { kind: "file", name: "notes.md", mimeType: "text/markdown", size: 7 });
    const { src } = source([file], { t: new Blob(["# Title"]) });
    const out = await resolveRequestMedia(request({ role: "user", parts: [{ type: "file", attachmentId: "t", mimeType: "text/markdown" }] }), src, ctx({ capabilities: caps({ vision: false }) }));
    expect(out.messages[0]!.parts).toEqual([{ type: "text", text: "File: notes.md\n```\n# Title\n```" }]);
  });

  it("expands videos into a note and frames", async () => {
    const video = attachment("v", { kind: "video", name: "clip.mp4", mimeType: "video/mp4", size: 100, storage: "opfs", metadata: { durationMs: 9000, frameIds: ["f1", "f2"], frameTimesMs: [3000, 6000] } });
    const f1 = attachment("f1", { mimeType: "image/jpeg", derivedFrom: "v" });
    const f2 = attachment("f2", { mimeType: "image/jpeg", derivedFrom: "v" });
    const { src } = source([video, f1, f2], { f1: new Blob(["a"]), f2: new Blob(["b"]) });
    const out = await resolveRequestMedia(request({ role: "user", parts: [{ type: "video", attachmentId: "v", mimeType: "video/mp4" }] }), src, ctx());
    const parts = out.messages[0]!.parts;
    expect(parts[0]).toEqual({ type: "text", text: 'Video "clip.mp4" (0:09): 2 frames at 0:03, 0:06.' });
    expect(parts.slice(1).map((p) => p.type)).toEqual(["image", "image"]);
  });

  it("uploads large PDFs once and reuses the cached reference", async () => {
    const big = 30 * 1024 * 1024;
    const pdf = attachment("p", { kind: "file", name: "r.pdf", mimeType: "application/pdf", size: big });
    const { src, saved } = source([pdf], { p: new Blob(["%PDF"]) });
    let uploads = 0;
    const provider = {
      uploadFile: async () => {
        uploads += 1;
        return { ref: "file-123", kind: "file_id" as const, expiresAt: null };
      },
    };
    const req = request({ role: "user", parts: [{ type: "file", attachmentId: "p", mimeType: "application/pdf" }] });
    const out = await resolveRequestMedia(req, src, ctx({ provider }));
    expect(out.messages[0]!.parts[0]).toMatchObject({ type: "file", fileId: "file-123", name: "r.pdf" });
    expect(saved).toEqual([{ id: "p", providerId: "p1", ref: { ref: "file-123", kind: "file_id", expiresAt: null } }]);

    const cached = attachment("p", { ...pdf, remoteRefs: { p1: { ref: "file-123", kind: "file_id", expiresAt: null } } });
    const again = source([cached], {});
    await resolveRequestMedia(req, again.src, ctx({ provider }));
    expect(uploads).toBe(1);
  });

  it("re-uploads when the cached reference is about to expire", async () => {
    const big = 30 * 1024 * 1024;
    const video = attachment("v", { kind: "video", mimeType: "video/mp4", size: big, remoteRefs: { p1: { ref: "https://g/old", kind: "uri", expiresAt: 1_000_000 + 60_000 } } });
    const { src } = source([video], { v: new Blob(["x"]) });
    const provider = { uploadFile: async () => ({ ref: "https://g/new", kind: "uri" as const, expiresAt: 9e12 }) };
    const out = await resolveRequestMedia(request({ role: "user", parts: [{ type: "video", attachmentId: "v", mimeType: "video/mp4", mode: "native" }] }), src, ctx({ providerKind: "gemini", capabilities: caps({ video: true }), provider }));
    expect(out.messages[0]!.parts[0]).toMatchObject({ url: "https://g/new" });
  });

  it("is strict for the last user message and lenient for history", async () => {
    const { src } = source([attachment("a"), attachment("b")], { a: new Blob(["1"]), b: new Blob(["2"]) });
    const textOnly = ctx({ capabilities: caps({ vision: false }) });
    const history = request(
      { role: "user", parts: [{ type: "image", attachmentId: "a", mimeType: "image/png" }] },
      { role: "assistant", parts: [{ type: "text", text: "nice" }] },
      { role: "user", parts: [{ type: "text", text: "and now?" }] },
    );
    const out = await resolveRequestMedia(history, src, textOnly);
    expect(out.messages[0]!.parts).toEqual([{ type: "text", text: "[image: a.png]" }]);

    const strict = request({ role: "user", parts: [{ type: "image", attachmentId: "b", mimeType: "image/png" }] });
    let error: unknown;
    try {
      await resolveRequestMedia(strict, src, textOnly);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MediaError);
    expect((error as MediaError).problem).toBe("image_unsupported");
  });

  it("fails clearly when the binary is gone", async () => {
    const { src } = source([attachment("a")], {});
    let error: unknown;
    try {
      await resolveRequestMedia(request({ role: "user", parts: [{ type: "image", attachmentId: "a", mimeType: "image/png" }] }), src, ctx());
    } catch (e) {
      error = e;
    }
    expect((error as MediaError).problem).toBe("missing");
  });
});
