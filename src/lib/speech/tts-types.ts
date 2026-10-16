/** Provider-agnostic text-to-speech. */
export type TtsErrorCode = "unsupported" | "not_configured" | "network" | "provider" | "aborted" | "playback_blocked";

export class TtsError extends Error {
  constructor(
    readonly code: TtsErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "TtsError";
  }
}

export interface Voice {
  id: string;
  name: string;
  language?: string;
}

export interface SpeakOptions {
  voice?: string;
  language?: string;
  rate: number;
  signal?: AbortSignal;
}

/**
 * A prepared utterance. Audio engines download the clip in prepare() (that's how the queue
 * prefetches the next sentence); Web Speech prepares instantly.
 */
export interface Utterance {
  play(): Promise<void>;
  pause(): void;
  resume(): void;
  /** Must settle a pending play() promise. */
  stop(): void;
}

export interface TextToSpeech {
  readonly id: "web-speech" | "openai" | "elevenlabs";
  isSupported(): boolean;
  listVoices(): Promise<Voice[]>;
  prepare(text: string, options: SpeakOptions): Promise<Utterance>;
}
