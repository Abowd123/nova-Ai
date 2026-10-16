import { joinUrl } from "@/lib/ai/http";
import type { HttpClient } from "@/lib/ai/types";
import { redactSecrets } from "@/lib/security/redact";
import { SttError, type SpeechToText, type TranscribeOptions, type Transcript } from "./stt-types";

export interface HttpSttConfig {
  /** Full endpoint, e.g. https://api.openai.com/v1/audio/transcriptions or http://localhost:8080/inference */
  url: string;
  apiKey?: string;
  headers?: Record<string, string>;
  model?: string;
  /** whisper.cpp server uses "file" too; some servers want "audio". */
  fileField?: string;
}

function extensionFor(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  return "webm";
}

/** "ar-SA" -> "ar" (ISO-639-1 is what Whisper expects). */
export function whisperLanguage(language: string): string | undefined {
  if (!language || language === "auto") return undefined;
  return language.split("-")[0]!.toLowerCase();
}

export function buildTranscriptionForm(audio: Blob, options: TranscribeOptions, config: Pick<HttpSttConfig, "model" | "fileField">): FormData {
  const form = new FormData();
  form.append(config.fileField ?? "file", new File([audio], `recording.${extensionFor(audio.type)}`, { type: audio.type || "audio/webm" }));
  if (config.model) form.append("model", config.model);
  const language = whisperLanguage(options.language);
  if (language) form.append("language", language);
  if (options.prompt) form.append("prompt", options.prompt.slice(0, 800));
  form.append("response_format", "json");
  return form;
}

/**
 * OpenAI-compatible transcription (OpenAI, Groq, LocalAI, faster-whisper-server) and custom
 * Whisper servers. Responses: {text} JSON or plain text.
 */
export class HttpSpeechToText implements SpeechToText {
  readonly mode = "file" as const;

  constructor(
    readonly id: "openai" | "whisper",
    private readonly config: () => Promise<HttpSttConfig>,
    private readonly http: HttpClient = (url, init) => fetch(url, { ...init, credentials: "omit", referrerPolicy: "no-referrer" }),
  ) {}

  isSupported(): boolean {
    return typeof FormData !== "undefined";
  }

  async transcribe(audio: Blob, options: TranscribeOptions): Promise<Transcript> {
    const config = await this.config();
    if (!config.url) throw new SttError("not_configured", "No transcription endpoint configured");
    const headers: Record<string, string> = { Accept: "application/json", ...(config.headers ?? {}) };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    let response: Response;
    try {
      response = await this.http(config.url, { method: "POST", headers, body: buildTranscriptionForm(audio, options, config), signal: options.signal });
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") throw new SttError("aborted", "Transcription aborted", { cause: error });
      throw new SttError("network", "Could not reach the transcription service", { cause: error });
    }
    const secrets = [config.apiKey, ...Object.values(config.headers ?? {})].filter((s): s is string => Boolean(s && s.length >= 4));
    const body = await response.text();
    if (!response.ok) {
      throw new SttError("provider", redactSecrets(`HTTP ${response.status}: ${body.slice(0, 300)}`, secrets));
    }
    let text = body.trim();
    try {
      const json = JSON.parse(body) as { text?: unknown; language?: unknown; duration?: unknown };
      if (typeof json.text === "string") {
        return {
          text: json.text.trim(),
          ...(typeof json.language === "string" ? { language: json.language } : {}),
          ...(typeof json.duration === "number" ? { durationMs: Math.round(json.duration * 1000) } : {}),
        };
      }
    } catch {
      text = body.trim();
    }
    return { text };
  }
}

export function openAiTranscriptionUrl(baseUrl: string): string {
  return joinUrl(baseUrl, "audio/transcriptions");
}
