"use client";

import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Volume2 } from "lucide-react";
import { useServices } from "@/components/providers/services-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettings } from "@/features/settings/queries";
import { useI18n } from "@/hooks/use-i18n";
import { DEFAULT_TTS_SETTINGS, type TtsSettings } from "@/lib/models";
import { TtsError } from "@/lib/speech/tts-types";
import { useTtsActions } from "./use-tts";

/** Voice select for the configured TTS engine, with free-text fallback and preview. */
export function VoicePicker({ value, onChange, label, tts: override }: { value: string; onChange: (voice: string) => void; label: string; tts?: TtsSettings }) {
  const { t, locale } = useI18n();
  const id = useId();
  const services = useServices();
  const settings = useSettings();
  const tts = override ?? settings.data?.tts ?? DEFAULT_TTS_SETTINGS;
  const actions = useTtsActions();
  const [custom, setCustom] = useState(false);
  const voices = useQuery({
    queryKey: ["tts-voices", tts.engine, tts.providerId],
    queryFn: () => services().speech.listVoices(tts),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const list = voices.data ?? [];
  const sorted = [...list].sort((a, b) => Number((b.language ?? "").startsWith(locale)) - Number((a.language ?? "").startsWith(locale)) || a.name.localeCompare(b.name));
  const known = list.some((v) => v.id === value);

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        {custom || (value && !known && !voices.isPending) || voices.isError ? (
          <Input id={id} dir="ltr" value={value} maxLength={200} onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1" placeholder="alloy / voice id" />
        ) : (
          <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-10 min-w-0 flex-1 rounded-xl border bg-background px-3 text-sm" disabled={voices.isPending}>
            <option value="">{t.speech.defaultVoice}</option>
            {sorted.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name}
                {voice.language ? ` (${voice.language})` : ""}
              </option>
            ))}
          </select>
        )}
        {voices.isPending ? <Loader2 className="size-4 animate-spin self-center" aria-label={t.common.loading} /> : null}
        <Button variant="ghost" size="sm" onClick={() => setCustom((c) => !c)}>
          {custom ? t.speech.pickFromList : t.speech.enterVoiceId}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void actions.speak("voice-preview", t.speech.previewSentence, value || undefined)}>
          <Volume2 aria-hidden="true" />
          {t.speech.previewVoice}
        </Button>
      </div>
      {voices.isError ? (
        <p className="text-xs text-destructive">{t.speech.ttsErrors[voices.error instanceof TtsError ? voices.error.code : "provider"]}</p>
      ) : null}
    </div>
  );
}
