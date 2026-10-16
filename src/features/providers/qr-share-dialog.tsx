"use client";

import { useEffect, useId, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardCopy, Pause, Play, QrCode } from "lucide-react";
import { useServices } from "@/components/providers/services-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { copyText } from "@/lib/clipboard";
import type { Provider } from "@/lib/models";
import { buildProviderPayload, encodeProviderPayload } from "@/lib/qr/provider-share";

const INTERVAL_MS = 900;

async function renderQr(chunks: string[]): Promise<string[]> {
  const QRCode = (await import("qrcode")).default;
  // Base45 text is QR-alphanumeric, so the encoder picks the compact alphanumeric mode.
  return Promise.all(chunks.map((chunk) => QRCode.toDataURL(chunk, { errorCorrectionLevel: "M", margin: 2, width: 360 })));
}

export function QrShareDialog({ provider, open, onOpenChange }: { provider: Provider; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  const ids = { key: useId(), headers: useId(), confirm: useId() };
  const services = useServices();
  const [includeKey, setIncludeKey] = useState(false);
  const [includeHeaders, setIncludeHeaders] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [chunks, setChunks] = useState<string[] | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [busy, setBusy] = useState(false);
  const secrets = includeKey || includeHeaders;

  useEffect(() => {
    if (open) return;
    // Forget everything (including any key) as soon as the dialog closes.
    setIncludeKey(false);
    setIncludeHeaders(false);
    setAcknowledged(false);
    setChunks(null);
    setImages([]);
    setIndex(0);
    setPlaying(true);
  }, [open]);

  useEffect(() => {
    if (!playing || images.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % images.length), INTERVAL_MS);
    return () => clearInterval(timer);
  }, [playing, images.length]);

  const generate = async () => {
    setBusy(true);
    try {
      const config = secrets ? await services().providers.getConfig(provider.id) : { ...provider, apiKey: undefined, headers: {} };
      const payload = buildProviderPayload(provider, config, { includeApiKey: includeKey, includeHeaders });
      const parts = await encodeProviderPayload(payload);
      setChunks(parts);
      setImages(await renderQr(parts));
      setIndex(0);
    } catch {
      toast({ title: t.qr.generateFailed, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t.common.close} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.qr.shareTitle(provider.name)}</DialogTitle>
          <DialogDescription>{t.qr.shareDescription}</DialogDescription>
        </DialogHeader>

        {!chunks ? (
          <div className="grid gap-3">
            <label htmlFor={ids.key} className="flex items-start gap-3 rounded-2xl border p-3">
              <input
                id={ids.key}
                type="checkbox"
                checked={includeKey}
                disabled={!provider.encryptedApiKey}
                onChange={(e) => {
                  setIncludeKey(e.target.checked);
                  setAcknowledged(false);
                }}
                className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
              />
              <span>
                <span className="block text-sm font-medium">{t.qr.includeKey}</span>
                <span className="block text-xs text-muted-foreground">{provider.encryptedApiKey ? t.qr.includeKeyHint : t.qr.noKey}</span>
              </span>
            </label>
            <label htmlFor={ids.headers} className="flex items-start gap-3 rounded-2xl border p-3">
              <input
                id={ids.headers}
                type="checkbox"
                checked={includeHeaders}
                disabled={!provider.encryptedHeaders}
                onChange={(e) => {
                  setIncludeHeaders(e.target.checked);
                  setAcknowledged(false);
                }}
                className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
              />
              <span className="text-sm font-medium">{t.qr.includeHeaders}</span>
            </label>
            {secrets ? (
              <div role="alert" className="grid gap-2 rounded-2xl border border-destructive/50 bg-destructive/10 p-3 text-sm">
                <p className="flex items-start gap-2 font-medium">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                  {t.qr.secretWarning}
                </p>
                <label htmlFor={ids.confirm} className="flex items-center gap-2">
                  <input id={ids.confirm} type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="size-4 accent-[hsl(var(--destructive))]" />
                  {t.qr.acknowledge}
                </label>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t.qr.noSecretsNote}</p>
            )}
            <Button onClick={() => void generate()} disabled={busy || (secrets && !acknowledged)} aria-busy={busy}>
              <QrCode aria-hidden="true" />
              {t.qr.generate}
            </Button>
          </div>
        ) : (
          <div className="grid justify-items-center gap-3">
            {secrets ? (
              <p className="flex items-center gap-2 rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                {t.qr.containsKey}
              </p>
            ) : null}
            {images[index] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={images[index]}
                alt={t.qr.codeAlt(index + 1, images.length)}
                width={300}
                height={300}
                className="rounded-2xl bg-white p-2"
                data-testid="qr-image"
                data-chunk={chunks[index]}
              />
            ) : null}
            <p className="text-sm font-medium tabular-nums" aria-live="polite">
              {t.qr.part(index + 1, chunks.length)}
            </p>
            {chunks.length > 1 ? (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" aria-label={t.qr.previous} onClick={() => setIndex((i) => (i - 1 + chunks.length) % chunks.length)}>
                  <ChevronRight className="ltr:rotate-180" aria-hidden="true" />
                </Button>
                <Button variant="tonal" size="icon" aria-label={playing ? t.qr.pause : t.qr.play} aria-pressed={playing} onClick={() => setPlaying((p) => !p)}>
                  {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                </Button>
                <Button variant="ghost" size="icon" aria-label={t.qr.next} onClick={() => setIndex((i) => (i + 1) % chunks.length)}>
                  <ChevronLeft className="ltr:rotate-180" aria-hidden="true" />
                </Button>
              </div>
            ) : null}
            <p className="text-center text-xs text-muted-foreground">{t.qr.scanHint}</p>
            {!secrets ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyText(chunks.join("\n")).then((ok) => toast({ title: ok ? t.qr.copied : t.chat.copyFailed }))}
              >
                <ClipboardCopy aria-hidden="true" />
                {t.qr.copyText}
              </Button>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
