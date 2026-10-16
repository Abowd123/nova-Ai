import { webFetch } from "@/lib/native/http";
import { joinUrl } from "@/lib/ai/http";
import type { HttpClient } from "@/lib/ai/types";
import { redactSecrets } from "@/lib/security/redact";
import { TtsError, type SpeakOptions, type TextToSpeech, type Utterance, type Voice } from "./tts-types";

const directHttp: HttpClient = (url, init) => webFetch(url, { ...init, credentials: "omit", referrerPolicy: "no-referrer" });

// ---------------------------------------------------------------- Web Speech Synthesis

export class WebSpeechTts implements TextToSpeech {
  readonly id = "web-speech" as const;

  constructor(private readonly synth: () => SpeechSynthesis | undefined = () => (typeof window !== "undefined" ? window.speechSynthesis : undefined)) {}

  isSupported(): boolean {
    return Boolean(this.synth()) && typeof SpeechSynthesisUtterance !== "undefined";
  }

  async listVoices(): Promise<Voice[]> {
    const synth = this.synth();
    if (!synth) return [];
    let voices = synth.getVoices();
    if (!voices.length) {
      // Chrome loads voices asynchronously.
      voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
        const timer = setTimeout(() => resolve(synth.getVoices()), 1500);
        synth.addEventListener(
          "voiceschanged",
          () => {
            clearTimeout(timer);
            resolve(synth.getVoices());
          },
          { once: true },
        );
      });
    }
    return voices.map((v) => ({ id: v.voiceURI, name: `${v.name}${v.localService ? "" : " ☁"}`, language: v.lang }));
  }

  async prepare(text: string, options: SpeakOptions): Promise<Utterance> {
    const synth = this.synth();
    if (!synth) throw new TtsError("unsupported", "Speech synthesis is not supported");
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.rate;
    if (options.language) utterance.lang = options.language;
    if (options.voice) {
      const voice = synth.getVoices().find((v) => v.voiceURI === options.voice || v.name === options.voice);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }
    }
    let stopped = false;
    return {
      play: () =>
        new Promise<void>((resolve, reject) => {
          if (stopped) return resolve();
          utterance.onend = () => resolve();
          utterance.onerror = (event) => {
            if (event.error === "canceled" || event.error === "interrupted") resolve();
            else reject(new TtsError(event.error === "not-allowed" ? "playback_blocked" : "provider", `Speech synthesis error: ${event.error}`));
          };
          synth.speak(utterance);
        }),
      pause: () => synth.pause(),
      resume: () => synth.resume(),
      stop: () => {
        stopped = true;
        synth.cancel();
      },
    };
  }
}

// ---------------------------------------------------------------- audio-clip engines

export type AudioFactory = (src: string) => HTMLAudioElement;
const defaultAudio: AudioFactory = (src) => {
  const audio = new Audio(src);
  audio.preload = "auto";
  return audio;
};

/** Wraps a downloaded clip in an Utterance played through <audio> (works in background tabs). */
export function clipUtterance(blob: Blob, rate: number, createAudio: AudioFactory = defaultAudio): Utterance {
  const url = URL.createObjectURL(blob);
  const audio = createAudio(url);
  audio.playbackRate = rate;
  const cleanup = () => URL.revokeObjectURL(url);
  let settle: (() => void) | null = null;
  return {
    play: () =>
      new Promise<void>((resolve, reject) => {
        settle = () => {
          cleanup();
          resolve();
        };
        audio.onended = settle;
        audio.onerror = () => {
          cleanup();
          reject(new TtsError("provider", "Audio playback failed"));
        };
        audio.play().catch((error: unknown) => {
          cleanup();
          reject(new TtsError((error as { name?: string })?.name === "NotAllowedError" ? "playback_blocked" : "provider", "Audio playback failed", { cause: error }));
        });
      }),
    pause: () => audio.pause(),
    resume: () => void audio.play().catch(() => undefined),
    stop: () => {
      audio.pause();
      audio.removeAttribute("src");
      if (settle) settle();
      else cleanup();
    },
  };
}

async function fetchClip(http: HttpClient, url: string, init: RequestInit, secrets: (string | undefined)[], signal?: AbortSignal): Promise<Blob> {
  let response: Response;
  try {
    response = await http(url, { ...init, signal });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw new TtsError("aborted", "Speech aborted", { cause: error });
    throw new TtsError("network", "Could not reach the speech service", { cause: error });
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new TtsError("provider", redactSecrets(`HTTP ${response.status}: ${body.slice(0, 300)}`, secrets));
  }
  return response.blob();
}

export interface OpenAiTtsConfig {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  model: string;
}

export const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"] as const;

/** OpenAI-compatible /audio/speech (OpenAI, LocalAI, Kokoro-FastAPI, openedai-speech...). */
export class OpenAiTts implements TextToSpeech {
  readonly id = "openai" as const;

  constructor(
    private readonly config: () => Promise<OpenAiTtsConfig>,
    private readonly http: HttpClient = directHttp,
    private readonly createAudio: AudioFactory = defaultAudio,
  ) {}

  isSupported(): boolean {
    return typeof Audio !== "undefined" || typeof HTMLAudioElement !== "undefined";
  }

  async listVoices(): Promise<Voice[]> {
    return OPENAI_VOICES.map((id) => ({ id, name: id }));
  }

  async prepare(text: string, options: SpeakOptions): Promise<Utterance> {
    const config = await this.config();
    if (!config.baseUrl) throw new TtsError("not_configured", "No TTS provider configured");
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "audio/mpeg", ...(config.headers ?? {}) };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    const blob = await fetchClip(
      this.http,
      joinUrl(config.baseUrl, "audio/speech"),
      { method: "POST", headers, body: JSON.stringify({ model: config.model || "gpt-4o-mini-tts", voice: options.voice || "alloy", input: text, response_format: "mp3" }) },
      [config.apiKey, ...Object.values(config.headers ?? {})],
      options.signal,
    );
    return clipUtterance(blob, options.rate, this.createAudio);
  }
}

export interface ElevenLabsConfig {
  apiKey?: string;
  model: string;
  baseUrl?: string;
}

export const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

export class ElevenLabsTts implements TextToSpeech {
  readonly id = "elevenlabs" as const;

  constructor(
    private readonly config: () => Promise<ElevenLabsConfig>,
    private readonly http: HttpClient = directHttp,
    private readonly createAudio: AudioFactory = defaultAudio,
  ) {}

  isSupported(): boolean {
    return typeof Audio !== "undefined" || typeof HTMLAudioElement !== "undefined";
  }

  async listVoices(): Promise<Voice[]> {
    const config = await this.config();
    if (!config.apiKey) throw new TtsError("not_configured", "ElevenLabs API key is missing");
    let response: Response;
    try {
      response = await this.http(joinUrl(config.baseUrl ?? ELEVENLABS_BASE, "voices"), { method: "GET", headers: { "xi-api-key": config.apiKey, Accept: "application/json" } });
    } catch (error) {
      throw new TtsError("network", "Could not reach ElevenLabs", { cause: error });
    }
    if (!response.ok) throw new TtsError("provider", `HTTP ${response.status}`);
    const json = (await response.json()) as { voices?: { voice_id?: string; name?: string; labels?: { language?: string } }[] };
    return (json.voices ?? [])
      .filter((v): v is { voice_id: string; name?: string; labels?: { language?: string } } => typeof v.voice_id === "string")
      .map((v) => ({ id: v.voice_id, name: v.name ?? v.voice_id, ...(v.labels?.language ? { language: v.labels.language } : {}) }));
  }

  async prepare(text: string, options: SpeakOptions): Promise<Utterance> {
    const config = await this.config();
    if (!config.apiKey) throw new TtsError("not_configured", "ElevenLabs API key is missing");
    if (!options.voice) throw new TtsError("not_configured", "Choose an ElevenLabs voice");
    const url = `${joinUrl(config.baseUrl ?? ELEVENLABS_BASE, `text-to-speech/${encodeURIComponent(options.voice)}`)}?output_format=mp3_44100_128`;
    const blob = await fetchClip(
      this.http,
      url,
      {
        method: "POST",
        headers: { "xi-api-key": config.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: config.model || "eleven_multilingual_v2" }),
      },
      [config.apiKey],
      options.signal,
    );
    return clipUtterance(blob, options.rate, this.createAudio);
  }
}
