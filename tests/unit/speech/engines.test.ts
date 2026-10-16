import { describe, expect, it } from "vitest";
import { buildTranscriptionForm, HttpSpeechToText, openAiTranscriptionUrl, whisperLanguage } from "@/lib/speech/http-stt";
import { micErrorCode, SttError } from "@/lib/speech/stt-types";
import { pickRecordingType } from "@/lib/speech/recorder";
import { recognitionCtor } from "@/lib/speech/web-speech-stt";
import { ElevenLabsTts, OpenAiTts, type AudioFactory } from "@/lib/speech/tts-engines";
import { TtsError } from "@/lib/speech/tts-types";

type Call = { url: string; init: RequestInit };
function http(response: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const client = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return response();
  };
  return { calls, client };
}

class FakeAudio {
  playbackRate = 1;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly src: string) {}
  play() {
    queueMicrotask(() => this.onended?.());
    return Promise.resolve();
  }
  pause() {}
  removeAttribute() {}
}
const audio: AudioFactory = (src) => new FakeAudio(src) as unknown as HTMLAudioElement;

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected rejection");
}

describe("speech-to-text over HTTP", () => {
  it("maps languages and URLs", () => {
    expect(whisperLanguage("ar-SA")).toBe("ar");
    expect(whisperLanguage("auto")).toBeUndefined();
    expect(openAiTranscriptionUrl("https://api.openai.com/v1/")).toBe("https://api.openai.com/v1/audio/transcriptions");
  });

  it("builds the multipart form", () => {
    const form = buildTranscriptionForm(new Blob(["x"], { type: "audio/webm;codecs=opus" }), { language: "en-US", prompt: "Nova" }, { model: "whisper-1" });
    expect((form.get("file") as File).name).toBe("recording.webm");
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("language")).toBe("en");
    expect(form.get("prompt")).toBe("Nova");
    expect(form.get("response_format")).toBe("json");
  });

  it("sends the key as a bearer token and parses JSON", async () => {
    const fake = http(() => new Response(JSON.stringify({ text: " مرحبا ", language: "ar", duration: 1.5 }), { status: 200 }));
    const stt = new HttpSpeechToText("openai", async () => ({ url: "https://api.test/v1/audio/transcriptions", apiKey: "sk-secret-1234", model: "whisper-1" }), fake.client);
    expect(await stt.transcribe(new Blob(["a"], { type: "audio/webm" }), { language: "ar" })).toEqual({ text: "مرحبا", language: "ar", durationMs: 1500 });
    expect((fake.calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-secret-1234");
  });

  it("accepts plain-text responses (whisper.cpp)", async () => {
    const fake = http(() => new Response("hello world\n", { status: 200 }));
    const stt = new HttpSpeechToText("whisper", async () => ({ url: "http://localhost:8080/inference" }), fake.client);
    expect(await stt.transcribe(new Blob(["a"]), { language: "auto" })).toEqual({ text: "hello world" });
  });

  it("redacts the key from provider errors and maps network failures", async () => {
    const fake = http(() => new Response("invalid key sk-secret-1234", { status: 401 }));
    const stt = new HttpSpeechToText("openai", async () => ({ url: "https://api.test/x", apiKey: "sk-secret-1234" }), fake.client);
    const error = (await caught(stt.transcribe(new Blob(["a"]), { language: "en" }))) as SttError;
    expect(error.code).toBe("provider");
    expect(error.message).not.toContain("sk-secret-1234");

    const down = new HttpSpeechToText("openai", async () => ({ url: "https://api.test/x" }), async () => {
      throw new TypeError("fetch failed");
    });
    expect(((await caught(down.transcribe(new Blob(["a"]), { language: "en" }))) as SttError).code).toBe("network");
    const empty = new HttpSpeechToText("whisper", async () => ({ url: "" }), fake.client);
    expect(((await caught(empty.transcribe(new Blob(["a"]), { language: "en" }))) as SttError).code).toBe("not_configured");
  });

  it("maps microphone errors and detects support", () => {
    expect(micErrorCode(Object.assign(new Error("x"), { name: "NotAllowedError" }))).toBe("permission_denied");
    expect(micErrorCode(Object.assign(new Error("x"), { name: "NotFoundError" }))).toBe("no_microphone");
    expect(pickRecordingType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickRecordingType(() => false)).toBeUndefined();
    expect(recognitionCtor({})).toBeNull();
    const Ctor = function () {};
    expect(recognitionCtor({ webkitSpeechRecognition: Ctor })).toBe(Ctor);
  });
});

describe("text-to-speech engines", () => {
  it("OpenAI-compatible: posts to /audio/speech with model, voice and input", async () => {
    const fake = http(() => new Response(new Blob(["mp3"], { type: "audio/mpeg" }), { status: 200 }));
    const tts = new OpenAiTts(async () => ({ baseUrl: "https://api.test/v1", apiKey: "sk-abcdef", model: "tts-1" }), fake.client, audio);
    const utterance = await tts.prepare("Hello", { voice: "nova", rate: 1.2 });
    await utterance.play();
    expect(fake.calls[0]!.url).toBe("https://api.test/v1/audio/speech");
    expect(JSON.parse(fake.calls[0]!.init.body as string)).toEqual({ model: "tts-1", voice: "nova", input: "Hello", response_format: "mp3" });
    expect((fake.calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-abcdef");
  });

  it("ElevenLabs: uses the xi-api-key header and voice in the path", async () => {
    const fake = http(() => new Response(new Blob(["mp3"]), { status: 200 }));
    const tts = new ElevenLabsTts(async () => ({ apiKey: "el-key-123456", model: "" }), fake.client, audio);
    await tts.prepare("مرحبا", { voice: "voice/1", rate: 1 });
    expect(fake.calls[0]!.url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice%2F1?output_format=mp3_44100_128");
    const headers = fake.calls[0]!.init.headers as Record<string, string>;
    expect(headers["xi-api-key"]).toBe("el-key-123456");
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(fake.calls[0]!.init.body as string)).toEqual({ text: "مرحبا", model_id: "eleven_multilingual_v2" });
  });

  it("ElevenLabs: requires a key and a voice; lists voices", async () => {
    const none = new ElevenLabsTts(async () => ({ model: "" }), http(() => new Response("")).client, audio);
    expect(((await caught(none.prepare("x", { rate: 1, voice: "v" }))) as TtsError).code).toBe("not_configured");
    const list = http(() => new Response(JSON.stringify({ voices: [{ voice_id: "a", name: "Adam", labels: { language: "en" } }, { name: "broken" }] })));
    const tts = new ElevenLabsTts(async () => ({ apiKey: "k-123456", model: "" }), list.client, audio);
    expect(((await caught(tts.prepare("x", { rate: 1 }))) as TtsError).code).toBe("not_configured");
    expect(await tts.listVoices()).toEqual([{ id: "a", name: "Adam", language: "en" }]);
  });

  it("redacts keys from TTS errors", async () => {
    const fake = http(() => new Response("bad key el-key-123456", { status: 401 }));
    const tts = new ElevenLabsTts(async () => ({ apiKey: "el-key-123456", model: "" }), fake.client, audio);
    const error = (await caught(tts.prepare("x", { rate: 1, voice: "v" }))) as TtsError;
    expect(error.code).toBe("provider");
    expect(error.message).not.toContain("el-key-123456");
  });
});
