import { z } from "zod";

const mimeType = z.string().regex(/^[\w.+-]+\/[\w.+-]+$/, "Invalid MIME type");

/** Media can be referenced by stored attachment, remote URL or inline base64 (no data: prefix). */
const mediaSource = {
  mimeType,
  attachmentId: z.string().min(1).max(128).optional(),
  url: z.string().url().max(8192).optional(),
  data: z.string().max(50_000_000).optional(),
  /** Provider file id (OpenAI Files API) resolved at send time. */
  fileId: z.string().min(1).max(512).optional(),
  name: z.string().max(255).optional(),
};

export const textPartSchema = z.object({ type: z.literal("text"), text: z.string() });
export const imagePartSchema = z.object({ type: z.literal("image"), ...mediaSource });
export const audioPartSchema = z.object({ type: z.literal("audio"), ...mediaSource });
export const videoPartSchema = z.object({
  type: z.literal("video"),
  ...mediaSource,
  /** native = send the video itself (Gemini...), frames = send extracted JPEG frames. */
  mode: z.enum(["native", "frames"]).optional(),
});
/** Generic document (PDF, text, code...). Text-like files are inlined as text when needed. */
export const filePartSchema = z.object({ type: z.literal("file"), ...mediaSource });
export const toolCallPartSchema = z.object({
  type: z.literal("tool_call"),
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  /** Raw JSON string exactly as produced by the model. */
  arguments: z.string(),
  /** Gemini thought signature that must be replayed with the call. */
  signature: z.string().max(100_000).optional(),
});
/** UI-only details of a tool run (never sent to the model). */
export const toolDisplaySchema = z.object({
  kind: z.enum(["text", "code", "search", "page", "files", "subagent"]),
  stdout: z.string().max(200_000).optional(),
  stderr: z.string().max(200_000).optional(),
  value: z.string().max(200_000).optional(),
  citations: z
    .array(z.object({ index: z.number().int().nonnegative(), title: z.string().max(500), url: z.string().max(4000), snippet: z.string().max(2000).optional() }))
    .max(50)
    .optional(),
  files: z
    .array(z.object({ name: z.string().max(255), mimeType: z.string().max(255), attachmentId: z.string().max(128).optional(), size: z.number().int().nonnegative() }))
    .max(50)
    .optional(),
  durationMs: z.number().nonnegative().optional(),
  usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).optional(),
});
export type ToolDisplay = z.infer<typeof toolDisplaySchema>;

export const toolResultPartSchema = z.object({
  type: z.literal("tool_result"),
  toolCallId: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  content: z.string(),
  isError: z.boolean().optional(),
  /** denied = the user refused, cancelled = stopped before it ran. */
  outcome: z.enum(["ok", "error", "denied", "cancelled"]).optional(),
  display: toolDisplaySchema.optional(),
});
export const reasoningPartSchema = z.object({
  type: z.literal("reasoning"),
  text: z.string(),
  /** Provider signature (Anthropic) needed to send thinking back. */
  signature: z.string().optional(),
});

export const messagePartSchema = z.discriminatedUnion("type", [
  textPartSchema,
  imagePartSchema,
  audioPartSchema,
  videoPartSchema,
  filePartSchema,
  toolCallPartSchema,
  toolResultPartSchema,
  reasoningPartSchema,
]);

export type MessagePart = z.infer<typeof messagePartSchema>;
export type TextPart = z.infer<typeof textPartSchema>;
export type ImagePart = z.infer<typeof imagePartSchema>;
export type AudioPart = z.infer<typeof audioPartSchema>;
export type VideoPart = z.infer<typeof videoPartSchema>;
export type FilePart = z.infer<typeof filePartSchema>;
export type MediaPart = ImagePart | AudioPart | VideoPart | FilePart;

export function isMediaPart(part: MessagePart): part is MediaPart {
  return part.type === "image" || part.type === "audio" || part.type === "video" || part.type === "file";
}
export type ToolCallPart = z.infer<typeof toolCallPartSchema>;
export type ToolResultPart = z.infer<typeof toolResultPartSchema>;
export type ReasoningPart = z.infer<typeof reasoningPartSchema>;

export const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export function textOf(parts: readonly MessagePart[]): string {
  return parts
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function reasoningOf(parts: readonly MessagePart[]): string {
  return parts
    .filter((part): part is ReasoningPart => part.type === "reasoning")
    .map((part) => part.text)
    .join("");
}
