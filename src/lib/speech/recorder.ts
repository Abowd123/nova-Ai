import { SttError, micErrorCode } from "./stt-types";

/** Preferred recording formats, best first. Whisper/OpenAI accept all of these. */
export const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"] as const;

export function pickRecordingType(isSupported: (type: string) => boolean): string | undefined {
  return RECORDING_TYPES.find((type) => isSupported(type));
}

export function recordingSupported(): boolean {
  return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

export interface Recording {
  blob: Blob;
  durationMs: number;
  mimeType: string;
}

export interface RecorderHandle {
  /** Resolves with the recording. */
  stop(): Promise<Recording>;
  cancel(): void;
  /** 0..1 input level for a meter. */
  level(): number;
  readonly startedAt: number;
}

/** Microphone recording via MediaRecorder with a level meter and a hard max duration. */
export async function startRecording(options: { maxDurationMs?: number; onAutoStop?: (recording: Recording) => void } = {}): Promise<RecorderHandle> {
  if (typeof window !== "undefined" && window.isSecureContext === false) throw new SttError("insecure_context", "Microphone needs HTTPS");
  if (!recordingSupported()) throw new SttError("unsupported", "Recording is not supported in this browser");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (error) {
    throw new SttError(micErrorCode(error), "Microphone unavailable", { cause: error });
  }

  const mimeType = pickRecordingType((type) => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };

  let analyser: AnalyserNode | null = null;
  let context: AudioContext | null = null;
  try {
    context = new AudioContext();
    analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
  } catch {
    analyser = null;
  }
  const samples = new Uint8Array(256);

  const startedAt = Date.now();
  const release = () => {
    stream.getTracks().forEach((track) => track.stop());
    void context?.close().catch(() => undefined);
  };

  let stopping: Promise<Recording> | null = null;
  const stop = () =>
    (stopping ??= new Promise<Recording>((resolve, reject) => {
      recorder.onstop = () => {
        release();
        const type = recorder.mimeType || mimeType || "audio/webm";
        resolve({ blob: new Blob(chunks, { type: type.split(";")[0] }), durationMs: Date.now() - startedAt, mimeType: type.split(";")[0]! });
      };
      recorder.onerror = (event) => {
        release();
        reject(new SttError("provider", "Recording failed", { cause: event }));
      };
      if (recorder.state === "inactive") recorder.onstop?.(new Event("stop"));
      else recorder.stop();
    }));

  recorder.start(250);
  const timer = options.maxDurationMs
    ? setTimeout(() => {
        void stop().then((recording) => options.onAutoStop?.(recording));
      }, options.maxDurationMs)
    : null;

  return {
    startedAt,
    stop: () => {
      if (timer) clearTimeout(timer);
      return stop();
    },
    cancel: () => {
      if (timer) clearTimeout(timer);
      recorder.ondataavailable = null;
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
      release();
    },
    level: () => {
      if (!analyser) return 0;
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const value of samples) peak = Math.max(peak, Math.abs(value - 128));
      return Math.min(1, peak / 128);
    },
  };
}
