"use client";

import { useEffect, useState } from "react";
import { Loader2, Mic, Send, Square, Type, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { formatDuration } from "@/lib/media/encoding";
import { STT_LANGUAGES } from "./stt-languages";
import type { useDictation } from "./use-dictation";

type Dictation = ReturnType<typeof useDictation>;

function RecordingPreview({ blob, label }: { blob: Blob; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url ? <audio controls src={url} className="h-9 min-w-0 flex-1" aria-label={label} data-testid="recording-preview" /> : null;
}

export function MicButton({ dictation, disabled }: { dictation: Dictation; disabled?: boolean }) {
  const { t } = useI18n();
  const active = dictation.status === "recording" || dictation.status === "listening";
  return (
    <Button
      type="button"
      variant={active ? "destructive" : "ghost"}
      size="icon"
      disabled={disabled || dictation.status === "transcribing" || dictation.status === "review"}
      aria-label={active ? t.speech.stopRecording : t.speech.startRecording}
      aria-pressed={active}
      title={!dictation.supported ? t.speech.errors.unsupported : undefined}
      onClick={() => void (active ? dictation.stop() : dictation.start())}
      data-testid="mic-button"
    >
      {active ? <Square className="fill-current" aria-hidden="true" /> : <Mic aria-hidden="true" />}
    </Button>
  );
}

/** Recording status, live level, language, review (preview + transcribe/send) and errors. */
export function DictationPanel({ dictation }: { dictation: Dictation }) {
  const { t, locale } = useI18n();
  const { status, error } = dictation;
  if (status === "idle" && !error) return null;

  return (
    <div className="mx-auto mb-2 flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-2xl border bg-surface-container-high px-3 py-2 text-sm" role="region" aria-label={t.speech.panelLabel} data-testid="dictation-panel">
      {status === "recording" || status === "listening" ? (
        <>
          <span className="relative flex size-3" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-60" />
            <span className="relative inline-flex size-3 rounded-full bg-destructive" />
          </span>
          <span className="font-medium" role="status">
            {status === "listening" ? t.speech.listening : t.speech.recording}
          </span>
          <span className="tabular-nums text-muted-foreground" dir="ltr">
            {formatDuration(dictation.elapsed)}
          </span>
          {status === "recording" ? (
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <span className="block h-full bg-primary transition-[width]" style={{ width: `${Math.round(dictation.level * 100)}%` }} />
            </span>
          ) : null}
          <label className="ms-auto flex items-center gap-1 text-xs text-muted-foreground">
            <span className="sr-only sm:not-sr-only">{t.speech.language}</span>
            <select
              value={dictation.language}
              onChange={(e) => dictation.setLanguage(e.target.value)}
              className="h-8 rounded-full border bg-background px-2 text-xs"
              aria-label={t.speech.language}
              disabled={status === "listening"}
            >
              {STT_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label[locale]}
                </option>
              ))}
            </select>
          </label>
          <Button variant="ghost" size="icon-sm" aria-label={t.common.cancel} onClick={dictation.cancel}>
            <X aria-hidden="true" />
          </Button>
        </>
      ) : null}

      {status === "review" && dictation.recording ? (
        <>
          <RecordingPreview blob={dictation.recording.blob} label={t.speech.preview} />
          <Button variant="tonal" size="sm" onClick={() => void dictation.transcribe(false)}>
            <Type aria-hidden="true" />
            {t.speech.transcribe}
          </Button>
          <Button size="sm" onClick={() => void dictation.transcribe(true)}>
            <Send className="rtl:-scale-x-100" aria-hidden="true" />
            {t.speech.transcribeAndSend}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t.speech.discard} onClick={dictation.cancel}>
            <X aria-hidden="true" />
          </Button>
        </>
      ) : null}

      {status === "transcribing" ? (
        <span className="flex items-center gap-2" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {t.speech.transcribing}
        </span>
      ) : null}

      {error ? (
        <p className="flex w-full items-center justify-between gap-2 text-destructive" role="alert">
          {t.speech.errors[error]}
          <Button variant="ghost" size="icon-sm" aria-label={t.common.close} onClick={dictation.clearError}>
            <X aria-hidden="true" />
          </Button>
        </p>
      ) : null}
    </div>
  );
}
