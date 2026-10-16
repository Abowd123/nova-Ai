import { SttError, micErrorCode, type LiveCallbacks, type LiveSession, type SpeechToText, type TranscribeOptions } from "./stt-types";

interface RecognitionResultList {
  length: number;
  [index: number]: { isFinal: boolean; 0: { transcript: string } };
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: RecognitionResultList }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => RecognitionLike;

export function recognitionCtor(scope: unknown = typeof window !== "undefined" ? window : undefined): RecognitionCtor | null {
  const w = scope as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor } | undefined;
  return w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null;
}

/** Browser speech recognition (Chrome/Edge/Safari). Audio may be processed by the browser vendor. */
export class WebSpeechStt implements SpeechToText {
  readonly id = "web-speech" as const;
  readonly mode = "live" as const;

  constructor(
    private readonly ctor: () => RecognitionCtor | null = () => recognitionCtor(),
    private readonly deviceLanguage: () => string = () => (typeof navigator !== "undefined" ? navigator.language : "en-US"),
  ) {}

  isSupported(): boolean {
    return this.ctor() !== null;
  }

  startLive(options: TranscribeOptions, callbacks: LiveCallbacks): LiveSession {
    const Ctor = this.ctor();
    if (!Ctor) throw new SttError("unsupported", "Speech recognition is not supported in this browser");
    const recognition = new Ctor();
    recognition.lang = options.language === "auto" ? this.deviceLanguage() : options.language;
    recognition.continuous = true;
    recognition.interimResults = true;
    let finalText = "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]!;
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      callbacks.onInterim((finalText + interim).trim());
    };
    recognition.onerror = (event) => {
      const code = micErrorCode({ error: event.error });
      if (code !== "aborted") callbacks.onError(new SttError(code, `Speech recognition error: ${event.error}`));
    };
    recognition.onend = () => {
      callbacks.onFinal(finalText.trim());
      callbacks.onEnd();
    };
    options.signal?.addEventListener("abort", () => recognition.abort(), { once: true });
    recognition.start();
    return { stop: () => recognition.stop(), abort: () => recognition.abort() };
  }
}
