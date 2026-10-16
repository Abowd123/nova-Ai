import { httpForTransport } from "@/lib/ai/transport";
import { audit } from "@/lib/audit";
import type { ProviderConfig } from "@/lib/ai/types";
import type { SecretVault } from "@/lib/crypto/vault";
import type { SttSettings, TtsSettings } from "@/lib/models";
import { HttpSpeechToText, openAiTranscriptionUrl } from "@/lib/speech/http-stt";
import { SttError, type SpeechToText } from "@/lib/speech/stt-types";
import { ElevenLabsTts, OpenAiTts, WebSpeechTts } from "@/lib/speech/tts-engines";
import { TtsPlayer, shouldAutoplay, type MediaSessionLike } from "@/lib/speech/tts-player";
import { TtsError, type TextToSpeech, type Voice } from "@/lib/speech/tts-types";
import { WebSpeechStt } from "@/lib/speech/web-speech-stt";
import type { Repositories } from "@/lib/storage/types";
import type { ReplyCompleteInfo } from "@/features/chat/engine/chat-service";

export const ELEVENLABS_SECRET_ID = "service:elevenlabs";
const elevenLabsContext = "nova:service:elevenlabs";

export interface SpeechServiceDeps {
  repos: Repositories;
  vault: Pick<SecretVault, "encrypt" | "decrypt">;
  getProviderConfig: (providerId: string) => Promise<ProviderConfig>;
  locale?: () => string;
  /** Spoken in place of code blocks. */
  codePlaceholder?: () => string;
}

/** Picks STT/TTS engines from settings; owns the single app-wide TTS player. */
export class SpeechService {
  readonly player: TtsPlayer;

  constructor(private readonly deps: SpeechServiceDeps) {
    this.player = new TtsPlayer({
      mediaSession: () => (typeof navigator !== "undefined" && "mediaSession" in navigator ? (navigator.mediaSession as unknown as MediaSessionLike) : undefined),
      createMetadata: (init) => (typeof MediaMetadata !== "undefined" ? new MediaMetadata(init) : null),
      prefetch: 1,
    });
  }

  private async providerConfig(providerId: string | null, purpose: "stt" | "tts"): Promise<ProviderConfig> {
    if (!providerId) {
      if (purpose === "stt") throw new SttError("not_configured", "Choose a provider for transcription");
      throw new TtsError("not_configured", "Choose a provider for speech");
    }
    return this.deps.getProviderConfig(providerId);
  }

  sttEngine(settings: SttSettings): SpeechToText {
    switch (settings.engine) {
      case "web-speech":
        return new WebSpeechStt();
      case "openai":
        return new HttpSpeechToText("openai", async () => {
          const config = await this.providerConfig(settings.providerId, "stt");
          return { url: openAiTranscriptionUrl(config.baseUrl), apiKey: config.apiKey, headers: config.headers, model: settings.model || "whisper-1" };
        }, (url, init) => this.httpFor(settings.providerId)(url, init));
      case "whisper":
        return new HttpSpeechToText("whisper", async () => {
          const config = settings.providerId ? await this.deps.getProviderConfig(settings.providerId).catch(() => null) : null;
          return { url: settings.whisperUrl.trim(), apiKey: config?.apiKey, model: settings.model || undefined };
        });
    }
  }

  private httpFor(providerId: string | null) {
    return async (url: string, init: RequestInit) => {
      const config = providerId ? await this.deps.getProviderConfig(providerId).catch(() => null) : null;
      return httpForTransport(config?.transport ?? "direct")(url, init);
    };
  }

  ttsEngine(settings: TtsSettings): TextToSpeech {
    switch (settings.engine) {
      case "web-speech":
        return new WebSpeechTts();
      case "openai":
        return new OpenAiTts(async () => {
          const config = await this.providerConfig(settings.providerId, "tts");
          return { baseUrl: config.baseUrl, apiKey: config.apiKey, headers: config.headers, model: settings.model };
        }, (url, init) => this.httpFor(settings.providerId)(url, init));
      case "elevenlabs":
        return new ElevenLabsTts(async () => ({ apiKey: await this.getElevenLabsKey(), model: settings.model.startsWith("eleven") ? settings.model : "eleven_multilingual_v2" }));
    }
  }

  async listVoices(settings: TtsSettings): Promise<Voice[]> {
    return this.ttsEngine(settings).listVoices();
  }

  async setElevenLabsKey(key: string | null): Promise<void> {
    if (!key) {
      await this.deps.repos.secrets.delete(ELEVENLABS_SECRET_ID);
      audit("key_removed", "service elevenlabs");
      return;
    }
    await this.deps.repos.secrets.set(ELEVENLABS_SECRET_ID, await this.deps.vault.encrypt(key.trim(), elevenLabsContext));
    audit("key_saved", "service elevenlabs");
  }

  async hasElevenLabsKey(): Promise<boolean> {
    return this.deps.repos.secrets.has(ELEVENLABS_SECRET_ID);
  }

  private async getElevenLabsKey(): Promise<string | undefined> {
    const value = await this.deps.repos.secrets.get(ELEVENLABS_SECRET_ID);
    return value ? this.deps.vault.decrypt(value, elevenLabsContext) : undefined;
  }

  /** Reads a message aloud (voice: assistant.voiceId → settings default). */
  async speak(itemId: string, markdown: string, options: { voice?: string | null; title?: string } = {}): Promise<void> {
    const settings = await this.deps.repos.settings.get();
    const engine = this.ttsEngine(settings.tts);
    if (!engine.isSupported()) throw new TtsError("unsupported", "Speech output is not supported in this browser");
    await this.player.speak(engine, markdown, {
      itemId,
      voice: options.voice || settings.tts.defaultVoice || undefined,
      language: this.deps.locale?.(),
      rate: settings.tts.rate,
      title: options.title,
      codePlaceholder: this.deps.codePlaceholder?.(),
    });
  }

  /** Chat engine hook: honours assistant.autoPlayTts (never / always / after voice input). */
  async handleReplyComplete(info: ReplyCompleteInfo): Promise<boolean> {
    if (!info.text.trim() || !info.assistantId) return false;
    const assistant = await this.deps.repos.assistants.get(info.assistantId);
    if (!assistant || !shouldAutoplay(assistant.autoPlayTts, info.inputMode)) return false;
    await this.speak(info.messageId, info.text, { voice: assistant.voiceId, title: assistant.name });
    return true;
  }
}
