"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Camera, CameraOff, CircleCheck, RotateCcw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useServices } from "@/components/providers/services-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { PROVIDER_PRESETS } from "@/lib/ai/presets";
import { getErrorMessage } from "@/lib/i18n/error-message";
import { ChunkCollector, type AddStatus } from "@/lib/qr/chunks";
import { decodeProviderPayload, payloadHasSecrets, type ProviderSharePayload } from "@/lib/qr/provider-share";
import { providerKeys } from "./queries";

type Detector = (source: HTMLVideoElement, canvas: HTMLCanvasElement) => Promise<string[]>;

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

async function createDetector(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
  if (Native) {
    try {
      const detector = new Native({ formats: ["qr_code"] });
      return async (video) => (await detector.detect(video)).map((code) => code.rawValue);
    } catch {
      /* fall back to jsQR */
    }
  }
  const jsQR = (await import("jsqr")).default;
  return async (video, canvas) => {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return [];
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return [];
    context.drawImage(video, 0, 0, width, height);
    const result = jsQR(context.getImageData(0, 0, width, height).data, width, height, { inversionAttempts: "dontInvert" });
    return result?.data ? [result.data] : [];
  };
}

function cameraErrorKey(error: unknown): "denied" | "missing" | "insecure" | "failed" {
  const name = (error as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "missing";
  if (typeof window !== "undefined" && !window.isSecureContext) return "insecure";
  return "failed";
}

export function QrScanDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  const pasteId = useId();
  const services = useServices();
  const queryClient = useQueryClient();
  const collector = useRef(new ChunkCollector());
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<ReturnType<typeof cameraErrorKey> | null>(null);
  const [progress, setProgress] = useState(collector.current.progress);
  const [lastStatus, setLastStatus] = useState<AddStatus | null>(null);
  const [payload, setPayload] = useState<ProviderSharePayload | null>(null);
  const [paste, setPaste] = useState("");
  const [saving, setSaving] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  const finish = useCallback(async () => {
    try {
      setPayload(await decodeProviderPayload(collector.current));
      stopCamera();
    } catch {
      setLastStatus("corrupt");
      collector.current.reset();
      setProgress(collector.current.progress);
    }
  }, [stopCamera]);

  const ingest = useCallback(
    (text: string, switchSession = false) => {
      const status = collector.current.add(text, { switchSession });
      setLastStatus(status);
      setProgress(collector.current.progress);
      if (status === "complete") void finish();
      return status;
    },
    [finish],
  );

  useEffect(() => {
    if (open) return;
    stopCamera();
    collector.current.reset();
    setProgress(collector.current.progress);
    setPayload(null);
    setLastStatus(null);
    setPaste("");
    setCameraError(null);
  }, [open, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    void createDetector().then((detect) => {
      const tick = async () => {
        if (cancelled || !videoRef.current) return;
        try {
          for (const value of await detect(videoRef.current, (canvasRef.current ??= document.createElement("canvas")))) ingest(value);
        } catch {
          /* transient decode errors are ignored */
        }
        if (!cancelled) timer = setTimeout(() => void tick(), 120);
      };
      void tick();
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scanning, ingest]);

  const startCamera = async () => {
    setCameraError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("unsupported"), { name: window.isSecureContext ? "NotFoundError" : "SecurityError" });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setScanning(true);
    } catch (error) {
      setCameraError(cameraErrorKey(error));
    }
  };

  const submitPaste = () => {
    for (const line of paste.split(/\s*\n\s*/).filter(Boolean)) {
      if (ingest(line) === "complete") break;
    }
    setPaste("");
  };

  const save = async () => {
    if (!payload) return;
    setSaving(true);
    try {
      const provider = await services().providers.importShared(payload);
      await queryClient.invalidateQueries({ queryKey: providerKeys.all });
      toast({ title: t.qr.imported(provider.name), variant: "success" });
      onOpenChange(false);
    } catch (error) {
      toast({ title: getErrorMessage(error, t), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const percent = Math.round(progress.ratio * 100);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t.common.close} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.qr.scanTitle}</DialogTitle>
          <DialogDescription>{t.qr.scanDescription}</DialogDescription>
        </DialogHeader>

        {payload ? (
          <div className="grid gap-3" data-testid="scan-result">
            <p className="flex items-center gap-2 text-sm font-medium text-success">
              <CircleCheck className="size-4" aria-hidden="true" />
              {t.qr.received}
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-2xl bg-surface-container p-3 text-sm">
              <dt className="text-muted-foreground">{t.providers.name}</dt>
              <dd dir="auto">{payload.name}</dd>
              <dt className="text-muted-foreground">{t.providers.kind}</dt>
              <dd>{PROVIDER_PRESETS[payload.kind].label}</dd>
              <dt className="text-muted-foreground">{t.providers.baseUrl}</dt>
              <dd dir="ltr" className="break-all text-start font-mono text-xs">
                {payload.baseUrl}
              </dd>
              <dt className="text-muted-foreground">{t.providers.models}</dt>
              <dd>{payload.models.length}</dd>
            </dl>
            {payloadHasSecrets(payload) ? (
              <p role="alert" className="flex items-start gap-2 rounded-2xl bg-warning/15 px-3 py-2 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {t.qr.receivedKey}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{t.qr.receivedNoKey}</p>
            )}
            <div className="flex gap-2">
              <Button onClick={() => void save()} disabled={saving} aria-busy={saving}>
                {t.qr.addProvider}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setPayload(null);
                  collector.current.reset();
                  setProgress(collector.current.progress);
                }}
              >
                {t.qr.scanAgain}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-black">
              <video ref={videoRef} className="size-full object-cover" playsInline muted aria-label={t.qr.cameraPreview} />
              {!scanning ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-white">
                  {cameraError ? (
                    <>
                      <CameraOff className="size-8" aria-hidden="true" />
                      <p role="alert" className="text-sm">
                        {t.qr.cameraErrors[cameraError]}
                      </p>
                    </>
                  ) : null}
                  <Button variant="tonal" onClick={() => void startCamera()}>
                    <Camera aria-hidden="true" />
                    {cameraError ? t.common.retry : t.qr.startCamera}
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="grid gap-1">
              <div
                role="progressbar"
                aria-label={t.qr.progressLabel}
                aria-valuemin={0}
                aria-valuemax={progress.total || 1}
                aria-valuenow={progress.received}
                aria-valuetext={progress.total ? t.qr.progress(progress.received, progress.total) : t.qr.waiting}
                className="h-2 overflow-hidden rounded-full bg-surface-container-high"
              >
                <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
              </div>
              <p className="text-sm tabular-nums" aria-live="polite" data-testid="scan-progress">
                {progress.total ? t.qr.progress(progress.received, progress.total) : t.qr.waiting}
                {progress.rejected ? <Badge variant="warning" className="ms-2">{t.qr.rejected(progress.rejected)}</Badge> : null}
              </p>
              {lastStatus && ["corrupt", "malformed", "not-nova", "other-session"].includes(lastStatus) ? (
                <p className="flex flex-wrap items-center gap-2 text-xs text-destructive" role="status">
                  {t.qr.status[lastStatus as "corrupt" | "malformed" | "not-nova" | "other-session"]}
                  {lastStatus === "other-session" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        collector.current.reset();
                        setProgress(collector.current.progress);
                        setLastStatus(null);
                      }}
                    >
                      <RotateCcw aria-hidden="true" />
                      {t.qr.restart}
                    </Button>
                  ) : null}
                </p>
              ) : null}
            </div>

            <details className="rounded-2xl border">
              <summary className="cursor-pointer px-3 py-2 text-sm">{t.qr.pasteToggle}</summary>
              <div className="grid gap-2 border-t p-3">
                <label htmlFor={pasteId} className="text-xs text-muted-foreground">
                  {t.qr.pasteHint}
                </label>
                <Textarea id={pasteId} dir="ltr" rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} className="font-mono text-xs" />
                <Button variant="outline" size="sm" disabled={!paste.trim()} onClick={submitPaste}>
                  {t.qr.addCodes}
                </Button>
              </div>
            </details>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
