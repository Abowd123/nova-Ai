"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useServices } from "@/components/providers/services-provider";
import { useSettings, useUpdateSettings } from "@/features/settings/queries";
import { startRecording, type RecorderHandle, type Recording } from "@/lib/speech/recorder";
import { SttError, type LiveSession, type SttErrorCode } from "@/lib/speech/stt-types";
import { DEFAULT_STT_SETTINGS } from "@/lib/models";

export type DictationStatus = "idle" | "listening" | "recording" | "review" | "transcribing";

const MAX_RECORDING_MS = 10 * 60 * 1000;

export interface DictationCallbacks {
  /** Live text while speaking (Web Speech) or the final transcript. */
  onText: (text: string, final: boolean) => void;
  /** Send immediately with inputMode=voice. */
  onSend: (text: string) => void;
}

export function useDictation(callbacks: DictationCallbacks) {
  const services = useServices();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const stt = settings.data?.stt ?? DEFAULT_STT_SETTINGS;
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [error, setError] = useState<SttErrorCode | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const recorder = useRef<RecorderHandle | null>(null);
  const live = useRef<LiveSession | null>(null);
  const abort = useRef<AbortController | null>(null);
  const cb = useRef(callbacks);
  cb.current = callbacks;

  const engine = useCallback(() => services().speech.sttEngine(stt), [services, stt]);
  const supported = typeof window !== "undefined" && (stt.engine === "web-speech" ? engine().isSupported() : typeof MediaRecorder !== "undefined");

  useEffect(() => {
    if (status !== "recording" && status !== "listening") return;
    const started = Date.now();
    const timer = setInterval(() => {
      setElapsed(Date.now() - started);
      setLevel(recorder.current?.level() ?? 0);
    }, 120);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(
    () => () => {
      recorder.current?.cancel();
      live.current?.abort();
      abort.current?.abort();
    },
    [],
  );

  const fail = (e: unknown) => {
    setError(e instanceof SttError ? e.code : "provider");
    setStatus("idle");
  };

  const transcribe = useCallback(
    async (rec: Recording, send: boolean) => {
      setStatus("transcribing");
      setError(null);
      const controller = new AbortController();
      abort.current = controller;
      try {
        const result = await engine().transcribe!(rec.blob, { language: stt.language, signal: controller.signal });
        setRecording(null);
        setStatus("idle");
        if (!result.text) {
          setError("no_speech");
          return;
        }
        if (send) cb.current.onSend(result.text);
        else cb.current.onText(result.text, true);
      } catch (e) {
        setStatus("review");
        setError(e instanceof SttError ? e.code : "provider");
      }
    },
    [engine, stt.language],
  );

  const start = useCallback(async () => {
    setError(null);
    const current = engine();
    if (!current.isSupported()) {
      setError("unsupported");
      return;
    }
    if (current.mode === "live") {
      try {
        live.current = current.startLive!(
          { language: stt.language },
          {
            onInterim: (text) => cb.current.onText(text, false),
            onFinal: (text) => {
              if (!text) return;
              if (stt.autoSend) cb.current.onSend(text);
              else cb.current.onText(text, true);
            },
            onError: (e) => setError(e.code),
            onEnd: () => {
              live.current = null;
              setStatus("idle");
            },
          },
        );
        setStatus("listening");
      } catch (e) {
        fail(e);
      }
      return;
    }
    try {
      recorder.current = await startRecording({
        maxDurationMs: MAX_RECORDING_MS,
        onAutoStop: (rec) => {
          recorder.current = null;
          setRecording(rec);
          setStatus("review");
        },
      });
      setStatus("recording");
    } catch (e) {
      fail(e);
    }
  }, [engine, stt.language, stt.autoSend]);

  const stop = useCallback(async () => {
    if (live.current) {
      live.current.stop();
      return;
    }
    const handle = recorder.current;
    if (!handle) return;
    recorder.current = null;
    try {
      const rec = await handle.stop();
      if (stt.autoSend) {
        await transcribe(rec, true);
      } else {
        setRecording(rec);
        setStatus("review");
      }
    } catch (e) {
      fail(e);
    }
  }, [stt.autoSend, transcribe]);

  const cancel = useCallback(() => {
    recorder.current?.cancel();
    recorder.current = null;
    live.current?.abort();
    live.current = null;
    abort.current?.abort();
    setRecording(null);
    setStatus("idle");
  }, []);

  const setLanguage = useCallback((language: string) => updateSettings.mutate({ stt: { ...stt, language } }), [stt, updateSettings]);

  return {
    status,
    error,
    clearError: () => setError(null),
    recording,
    elapsed,
    level,
    supported,
    engineId: stt.engine,
    language: stt.language,
    setLanguage,
    start,
    stop,
    cancel,
    transcribe: (send: boolean) => (recording ? transcribe(recording, send) : Promise.resolve()),
  };
}
