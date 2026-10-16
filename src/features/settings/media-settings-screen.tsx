"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, KeyRound } from "lucide-react";
import { useServices } from "@/components/providers/services-provider";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/feedback/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import { useProviders } from "@/features/providers/queries";
import { STT_LANGUAGES } from "@/features/speech/stt-languages";
import { VoicePicker } from "@/features/speech/voice-picker";
import { useI18n } from "@/hooks/use-i18n";
import { getErrorMessage } from "@/lib/i18n/error-message";
import { recognitionCtor } from "@/lib/speech/web-speech-stt";
import { opfsAvailable } from "@/lib/storage/opfs-blob-store";
import type { MediaSettings, SttSettings, TtsSettings } from "@/lib/models";
import { useSettings, useUpdateSettings } from "./queries";

function Row({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Select({ id, value, onChange, children }: { id: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-10 rounded-xl border bg-background px-3 text-sm">
      {children}
    </select>
  );
}

export function MediaSettingsScreen() {
  const { t, locale } = useI18n();
  const ids = { dim: useId(), quality: useId(), frames: useId(), sttProvider: useId(), sttModel: useId(), whisper: useId(), lang: useId(), ttsProvider: useId(), ttsModel: useId(), rate: useId(), eleven: useId(), keep: useId(), auto: useId() };
  const settings = useSettings();
  const update = useUpdateSettings();
  const providers = useProviders();
  const services = useServices();
  const [elevenKey, setElevenKey] = useState("");
  const [hasEleven, setHasEleven] = useState<boolean | null>(null);
  const [webSpeech, setWebSpeech] = useState({ stt: false, tts: false });

  useEffect(() => {
    setWebSpeech({ stt: recognitionCtor() !== null, tts: typeof window !== "undefined" && "speechSynthesis" in window });
    void services().speech.hasElevenLabsKey().then(setHasEleven).catch(() => setHasEleven(false));
  }, [services]);

  if (settings.isPending) return <LoadingState label={t.common.loading} rows={3} />;
  if (settings.isError || !settings.data)
    return <ErrorState title={t.settings.loadError} description={getErrorMessage(settings.error, t)} retryLabel={t.common.retry} onRetry={() => void settings.refetch()} />;

  const { media, stt, tts } = settings.data;
  const save = (patch: { media?: MediaSettings; stt?: SttSettings; tts?: TtsSettings }) =>
    update.mutate(patch, { onError: (e) => toast({ title: getErrorMessage(e, t), variant: "destructive" }) });
  const setMedia = (patch: Partial<MediaSettings>) => save({ media: { ...media, ...patch } });
  const setStt = (patch: Partial<SttSettings>) => save({ stt: { ...stt, ...patch } });
  const setTts = (patch: Partial<TtsSettings>) => save({ tts: { ...tts, ...patch } });
  const httpProviders = (providers.data ?? []).filter((p) => p.kind === "openai" || p.kind === "custom" || p.kind === "openrouter");

  const providerSelect = (id: string, value: string | null, onChange: (v: string | null) => void) => (
    <Select id={id} value={value ?? ""} onChange={(v) => onChange(v || null)}>
      <option value="">{t.media.chooseProvider}</option>
      {httpProviders.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <Link href="/settings" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight className="size-4 ltr:rotate-180" aria-hidden="true" />
        {t.settings.title}
      </Link>
      <PageHeader title={t.media.title} description={t.media.description} />

      <Card>
        <CardHeader>
          <CardTitle>{t.media.attachments}</CardTitle>
          <CardDescription>{t.media.attachmentsDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Row label={t.media.maxDimension} htmlFor={ids.dim} hint={t.media.maxDimensionHint}>
              <Select id={ids.dim} value={String(media.imageMaxDimension)} onChange={(v) => setMedia({ imageMaxDimension: Number(v) })}>
                {[1024, 1536, 2048, 3072, 4096].map((n) => (
                  <option key={n} value={n}>
                    {n}px
                  </option>
                ))}
              </Select>
            </Row>
            <Row label={`${t.media.quality}: ${Math.round(media.imageQuality * 100)}%`} htmlFor={ids.quality}>
              <input id={ids.quality} type="range" min={0.5} max={1} step={0.05} value={media.imageQuality} onChange={(e) => setMedia({ imageQuality: Number(e.target.value) })} className="w-full accent-[hsl(var(--primary))]" />
            </Row>
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium">{t.media.format}</span>
            <SegmentedControl
              label={t.media.format}
              value={media.imageFormat}
              onValueChange={(v) => setMedia({ imageFormat: v })}
              options={[
                { value: "image/webp", label: "WebP" },
                { value: "image/jpeg", label: "JPEG" },
              ]}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor={ids.keep}>{t.media.keepOriginal}</Label>
            <Switch id={ids.keep} checked={media.keepOriginalImages} onCheckedChange={(v) => setMedia({ keepOriginalImages: v })} />
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium">{t.media.videoMode}</span>
            <SegmentedControl
              label={t.media.videoMode}
              value={media.videoMode}
              onValueChange={(v) => setMedia({ videoMode: v })}
              options={[
                { value: "auto", label: t.media.videoModes.auto },
                { value: "native", label: t.media.videoModes.native },
                { value: "frames", label: t.media.videoModes.frames },
              ]}
            />
            <p className="text-xs text-muted-foreground">{t.media.videoModeHint}</p>
          </div>
          <Row label={`${t.media.frameCount}: ${media.videoFrameCount}`} htmlFor={ids.frames}>
            <input id={ids.frames} type="range" min={1} max={32} step={1} value={media.videoFrameCount} onChange={(e) => setMedia({ videoFrameCount: Number(e.target.value) })} className="w-full accent-[hsl(var(--primary))]" />
          </Row>
          <div className="grid gap-2">
            <span className="text-sm font-medium">{t.media.storage}</span>
            <SegmentedControl
              label={t.media.storage}
              value={media.storage}
              onValueChange={(v) => setMedia({ storage: v })}
              options={[
                { value: "auto", label: t.media.storageModes.auto },
                { value: "idb", label: "IndexedDB" },
                { value: "opfs", label: t.media.storageModes.opfs },
              ]}
            />
            <p className="text-xs text-muted-foreground">{opfsAvailable() ? t.media.storageHint : t.media.opfsUnavailable}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.media.stt}</CardTitle>
          <CardDescription>{t.media.sttDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <span className="text-sm font-medium">{t.media.engine}</span>
            <SegmentedControl
              label={t.media.engine}
              value={stt.engine}
              onValueChange={(v) => setStt({ engine: v })}
              options={[
                { value: "web-speech", label: t.media.engines.webSpeech },
                { value: "openai", label: t.media.engines.openai },
                { value: "whisper", label: t.media.engines.whisper },
              ]}
            />
            {stt.engine === "web-speech" ? <p className="text-xs text-muted-foreground">{webSpeech.stt ? t.media.webSpeechPrivacy : t.speech.errors.unsupported}</p> : null}
          </div>
          {stt.engine === "openai" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Row label={t.media.provider} htmlFor={ids.sttProvider} hint={t.media.providerHint}>
                {providerSelect(ids.sttProvider, stt.providerId, (v) => setStt({ providerId: v }))}
              </Row>
              <Row label={t.media.model} htmlFor={ids.sttModel}>
                <Input id={ids.sttModel} dir="ltr" defaultValue={stt.model} placeholder="whisper-1 / gpt-4o-mini-transcribe" onBlur={(e) => setStt({ model: e.target.value.trim() })} />
              </Row>
            </div>
          ) : null}
          {stt.engine === "whisper" ? (
            <div className="grid gap-4">
              <Row label={t.media.whisperUrl} htmlFor={ids.whisper} hint={t.media.whisperHint}>
                <Input id={ids.whisper} dir="ltr" type="url" defaultValue={stt.whisperUrl} placeholder="http://localhost:8080/inference" onBlur={(e) => setStt({ whisperUrl: e.target.value.trim() })} />
              </Row>
              <Row label={t.media.authProvider} htmlFor={ids.sttProvider}>
                {providerSelect(ids.sttProvider, stt.providerId, (v) => setStt({ providerId: v }))}
              </Row>
            </div>
          ) : null}
          <Row label={t.speech.language} htmlFor={ids.lang}>
            <Select id={ids.lang} value={stt.language} onChange={(v) => setStt({ language: v })}>
              {STT_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label[locale]}
                </option>
              ))}
            </Select>
          </Row>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor={ids.auto}>{t.media.autoSend}</Label>
              <p className="text-xs text-muted-foreground">{t.media.autoSendHint}</p>
            </div>
            <Switch id={ids.auto} checked={stt.autoSend} onCheckedChange={(v) => setStt({ autoSend: v })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.media.tts}</CardTitle>
          <CardDescription>{t.media.ttsDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <span className="text-sm font-medium">{t.media.engine}</span>
            <SegmentedControl
              label={t.media.engine}
              value={tts.engine}
              onValueChange={(v) => setTts({ engine: v, model: v === "elevenlabs" ? "eleven_multilingual_v2" : v === "openai" ? "gpt-4o-mini-tts" : "", defaultVoice: "" })}
              options={[
                { value: "web-speech", label: t.media.engines.webSpeech },
                { value: "openai", label: t.media.engines.openai },
                { value: "elevenlabs", label: "ElevenLabs" },
              ]}
            />
            {tts.engine === "web-speech" && !webSpeech.tts ? <p className="text-xs text-destructive">{t.speech.ttsErrors.unsupported}</p> : null}
          </div>
          {tts.engine === "openai" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Row label={t.media.provider} htmlFor={ids.ttsProvider} hint={t.media.providerHint}>
                {providerSelect(ids.ttsProvider, tts.providerId, (v) => setTts({ providerId: v }))}
              </Row>
              <Row label={t.media.model} htmlFor={ids.ttsModel}>
                <Input id={ids.ttsModel} dir="ltr" defaultValue={tts.model} placeholder="gpt-4o-mini-tts / tts-1" onBlur={(e) => setTts({ model: e.target.value.trim() })} />
              </Row>
            </div>
          ) : null}
          {tts.engine === "elevenlabs" ? (
            <div className="grid gap-4">
              <Row label={t.media.elevenKey} htmlFor={ids.eleven} hint={hasEleven ? t.media.keySaved : t.media.keyHint}>
                <div className="flex gap-2">
                  <Input id={ids.eleven} type="password" autoComplete="off" value={elevenKey} placeholder={hasEleven ? "••••••••" : ""} onChange={(e) => setElevenKey(e.target.value)} />
                  <Button
                    variant="tonal"
                    disabled={!elevenKey.trim()}
                    onClick={() =>
                      void services()
                        .speech.setElevenLabsKey(elevenKey)
                        .then(() => {
                          setElevenKey("");
                          setHasEleven(true);
                          toast({ title: t.media.keySaved, variant: "success" });
                        })
                        .catch((e: unknown) => toast({ title: getErrorMessage(e, t), variant: "destructive" }))
                    }
                  >
                    <KeyRound aria-hidden="true" />
                    {t.common.save}
                  </Button>
                  {hasEleven ? (
                    <Button variant="ghost" onClick={() => void services().speech.setElevenLabsKey(null).then(() => setHasEleven(false))}>
                      {t.common.delete}
                    </Button>
                  ) : null}
                </div>
              </Row>
              <Row label={t.media.model} htmlFor={ids.ttsModel}>
                <Input id={ids.ttsModel} dir="ltr" defaultValue={tts.model} placeholder="eleven_multilingual_v2" onBlur={(e) => setTts({ model: e.target.value.trim() })} />
              </Row>
            </div>
          ) : null}
          <VoicePicker label={t.speech.defaultVoiceLabel} value={tts.defaultVoice} onChange={(v) => setTts({ defaultVoice: v })} tts={tts} />
          <Row label={`${t.media.rate}: ${tts.rate.toFixed(2)}×`} htmlFor={ids.rate}>
            <input id={ids.rate} type="range" min={0.5} max={2} step={0.05} value={tts.rate} onChange={(e) => setTts({ rate: Number(e.target.value) })} className="w-full accent-[hsl(var(--primary))]" />
          </Row>
        </CardContent>
      </Card>
    </div>
  );
}
