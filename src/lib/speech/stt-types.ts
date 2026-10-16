/** Provider-agnostic speech-to-text. UI talks only to this interface. */
export type SttErrorCode =
  | "permission_denied"
  | "no_microphone"
  | "unsupported"
  | "insecure_context"
  | "network"
  | "no_speech"
  | "aborted"
  | "provider"
  | "not_configured";

export class SttError extends Error {
  constructor(
    readonly code: SttErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SttError";
  }
}

export interface TranscribeOptions {
  /** BCP-47 tag or "auto". */
  language: string;
  signal?: AbortSignal;
  /** Free-text hint (names, jargon) for engines that support it. */
  prompt?: string;
}

export interface Transcript {
  text: string;
  language?: string;
  durationMs?: number;
}

export interface LiveCallbacks {
  onInterim(text: string): void;
  onFinal(text: string): void;
  onError(error: SttError): void;
  onEnd(): void;
}

export interface LiveSession {
  stop(): void;
  abort(): void;
}

export interface SpeechToText {
  readonly id: "web-speech" | "openai" | "whisper";
  /** live = streams words while you speak (Web Speech); file = transcribes a recording. */
  readonly mode: "live" | "file";
  isSupported(): boolean;
  transcribe?(audio: Blob, options: TranscribeOptions): Promise<Transcript>;
  startLive?(options: TranscribeOptions, callbacks: LiveCallbacks): LiveSession;
}

/** Maps getUserMedia / SpeechRecognition error names to our codes. */
export function micErrorCode(error: unknown): SttErrorCode {
  const name = (error as { name?: string; error?: string } | null)?.name ?? (error as { error?: string } | null)?.error;
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
    case "not-allowed":
    case "service-not-allowed":
      return typeof window !== "undefined" && window.isSecureContext === false ? "insecure_context" : "permission_denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
    case "audio-capture":
      return "no_microphone";
    case "network":
      return "network";
    case "no-speech":
      return "no_speech";
    case "aborted":
    case "AbortError":
      return "aborted";
    default:
      return "provider";
  }
}
