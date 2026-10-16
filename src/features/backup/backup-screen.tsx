"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CloudUpload, Download, KeyRound, Loader2, Lock, RefreshCw, RotateCcw, Trash2, TriangleAlert, Unlock, XCircle } from "lucide-react";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/feedback/page-header";
import { useServices } from "@/components/providers/services-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import { useSettings, useUpdateSettings } from "@/features/settings/queries";
import { useI18n } from "@/hooks/use-i18n";
import { formatBytes, formatRelativeTime } from "@/lib/format";
import type { BackupSettings } from "@/lib/models";
import { WebDavError } from "@/lib/webdav/client";
import { useBackupErrorText } from "./error-text";
import type { BackupListItem, BackupProgress, ConnectionCheck, RestorePreview } from "./backup-service";
import { SyncCard } from "@/features/sync/sync-card";

function Row({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ProgressBar({ progress }: { progress: BackupProgress | null }) {
  const { t } = useI18n();
  if (!progress) return null;
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="grid gap-1" role="status" aria-live="polite">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{t.backup.phases[progress.phase]}</span>
        <span dir="ltr">{progress.total > 1 ? `${progress.done}/${progress.total}` : ""}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${Math.max(4, percent)}%` }} />
      </div>
    </div>
  );
}

function SecretField({ id, label, hint, saved, onSave }: { id: string; label: string; hint?: string; saved: boolean; onSave: (value: string) => Promise<void> }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  return (
    <Row label={label} htmlFor={id} hint={saved ? t.backup.savedEncrypted : hint}>
      <div className="flex gap-2">
        <Input id={id} type="password" autoComplete="new-password" dir="ltr" value={value} placeholder={saved ? "••••••••" : ""} onChange={(e) => setValue(e.target.value)} />
        <Button
          type="button"
          variant="tonal"
          disabled={!value}
          onClick={() =>
            void onSave(value).then(() => {
              setValue("");
              toast({ title: t.settings.saved, variant: "success" });
            })
          }
        >
          <KeyRound className="size-4" aria-hidden="true" />
          {t.common.save}
        </Button>
        {saved ? (
          <Button type="button" variant="ghost" size="icon" aria-label={t.backup.removeSecret} onClick={() => void onSave("")}>
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </Row>
  );
}

function ConnectionCard({ config, save }: { config: BackupSettings; save: (next: BackupSettings) => void }) {
  const { t } = useI18n();
  const services = useServices();
  const errorText = useBackupErrorText();
  const ids = { url: useId(), user: useId(), pass: useId(), root: useId(), phrase: useId() };
  const creds = useQuery({ queryKey: ["backup-credentials"], queryFn: () => services().backup.credentialState() });
  const queryClient = useQueryClient();
  const [testing, setTesting] = useState(false);
  const [check, setCheck] = useState<ConnectionCheck | null>(null);
  const webdav = config.webdav;
  const setDav = (patch: Partial<BackupSettings["webdav"]>) => save({ ...config, webdav: { ...webdav, ...patch } });
  const refreshCreds = () => void queryClient.invalidateQueries({ queryKey: ["backup-credentials"] });

  const test = async () => {
    setTesting(true);
    setCheck(null);
    try {
      setCheck(await services().backup.testConnection());
    } catch (error) {
      toast({ title: t.backup.testFailed, description: errorText(error), variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.backup.connectionTitle}</CardTitle>
        <CardDescription>{t.backup.connectionDescription}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Row label={t.backup.url} htmlFor={ids.url} hint={t.backup.urlHint}>
          <Input id={ids.url} type="url" dir="ltr" defaultValue={webdav.url} placeholder="https://cloud.example.com/remote.php/dav/files/USER/" onBlur={(e) => e.target.value.trim() !== webdav.url && setDav({ url: e.target.value.trim() })} />
        </Row>
        <div className="grid gap-2">
          <span className="text-sm font-medium">{t.backup.authType}</span>
          <SegmentedControl
            label={t.backup.authType}
            value={webdav.authType}
            onValueChange={(authType) => setDav({ authType })}
            options={[
              { value: "basic", label: t.backup.auth.basic },
              { value: "bearer", label: t.backup.auth.bearer },
            ]}
          />
        </div>
        {webdav.authType === "basic" ? (
          <Row label={t.backup.username} htmlFor={ids.user}>
            <Input id={ids.user} dir="ltr" autoComplete="username" defaultValue={webdav.username} onBlur={(e) => e.target.value.trim() !== webdav.username && setDav({ username: e.target.value.trim() })} />
          </Row>
        ) : null}
        <SecretField id={ids.pass} label={webdav.authType === "basic" ? t.backup.password : t.backup.token} hint={t.backup.appPasswordHint} saved={Boolean(creds.data?.password)} onSave={(v) => services().backup.saveCredentials(v, undefined).then(refreshCreds)} />
        <Row label={t.backup.rootPath} htmlFor={ids.root}>
          <Input id={ids.root} dir="ltr" defaultValue={webdav.rootPath} onBlur={(e) => e.target.value.trim() !== webdav.rootPath && setDav({ rootPath: e.target.value.trim().replace(/^\/+|\/+$/g, "") || "Nova" })} />
        </Row>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">
            {t.backup.viaProxy}
            <span className="block text-xs text-muted-foreground">{t.backup.viaProxyHint}</span>
          </span>
          <Switch checked={webdav.viaProxy} onCheckedChange={(viaProxy) => setDav({ viaProxy })} aria-label={t.backup.viaProxy} />
        </label>
        <SecretField id={ids.phrase} label={t.backup.passphrase} hint={t.backup.passphraseHint} saved={Boolean(creds.data?.passphrase)} onSave={(v) => services().backup.saveCredentials(undefined, v).then(refreshCreds)} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="tonal" disabled={!webdav.url || testing} onClick={() => void test()}>
            {testing ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
            {t.backup.test}
          </Button>
          {check ? (
            <ul className="flex flex-wrap gap-2 text-xs" aria-label={t.backup.testResults}>
              {check.steps.map((step) => (
                <li key={step.step} className="inline-flex items-center gap-1" title={step.error}>
                  {step.ok ? <CheckCircle2 className="size-3.5 text-primary" aria-hidden="true" /> : <XCircle className="size-3.5 text-destructive" aria-hidden="true" />}
                  {t.backup.steps[step.step]}
                </li>
              ))}
              {check.ok && check.nextcloud ? <li><Badge variant="outline">Nextcloud</Badge></li> : null}
            </ul>
          ) : null}
        </div>
        {check && !check.ok ? (
          <p className="text-xs text-destructive" role="alert" dir="auto">
            {check.steps.find((s) => !s.ok)?.error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RestoreDialog({ item, onClose }: { item: BackupListItem | null; onClose: () => void }) {
  const { t, locale } = useI18n();
  const services = useServices();
  const errorText = useBackupErrorText();
  const [passphrase, setPassphrase] = useState("");
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const id = useId();

  useEffect(() => {
    setPassphrase("");
    setPreview(null);
    setError(null);
    setProgress(null);
  }, [item]);

  const open = async () => {
    if (!item) return;
    setBusy(true);
    setError(null);
    controller.current = new AbortController();
    try {
      setPreview(await services().backup.inspect(item, { passphrase: passphrase || undefined, onProgress: setProgress, signal: controller.current.signal }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
  const restore = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await services().backup.restore(preview, { onProgress: setProgress });
      toast({ title: t.backup.restored, variant: "success" });
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(v) => {
        if (!v) {
          controller.current?.abort();
          onClose();
        }
      }}
    >
      <DialogContent closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>{t.backup.restoreTitle}</DialogTitle>
          <DialogDescription>{item ? new Date(item.createdAt).toLocaleString(locale) : ""}</DialogDescription>
        </DialogHeader>
        {!preview ? (
          <div className="grid gap-3">
            {item?.manifest?.encrypted ? (
              <Row label={t.backup.passphrase} htmlFor={id} hint={t.backup.passphraseRestoreHint}>
                <Input id={id} type="password" dir="ltr" autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
              </Row>
            ) : null}
            <ProgressBar progress={progress} />
          </div>
        ) : (
          <div className="grid gap-2 text-sm">
            <p className="flex items-start gap-2 rounded-2xl bg-destructive/10 px-3 py-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
              {t.backup.restoreWarning}
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              {(["conversations", "messages", "assistants", "providers", "memoryChunks", "blobs"] as const).map((key) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">{t.backup.countLabels[key]}</dt>
                  <dd dir="ltr" className="text-end">{preview.counts[key] ?? 0}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">
              {preview.manifest.includesSecrets ? t.backup.keysIncluded : t.backup.keysNotIncluded} · {preview.manifest.device.label} · Nova {preview.manifest.app.version}
            </p>
            <ProgressBar progress={progress} />
          </div>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive" dir="auto">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          {!preview ? (
            <Button disabled={busy} onClick={() => void open()}>
              {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
              {t.backup.downloadAndCheck}
            </Button>
          ) : (
            <Button variant="destructive" disabled={busy} onClick={() => void restore()}>
              <RotateCcw className="size-4" aria-hidden="true" />
              {t.backup.restoreNow}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BackupsCard({ config, save }: { config: BackupSettings; save: (next: BackupSettings) => void }) {
  const { t, locale } = useI18n();
  const services = useServices();
  const errorText = useBackupErrorText();
  const queryClient = useQueryClient();
  const ids = { interval: useId(), keep: useId(), max: useId() };
  const configured = Boolean(config.webdav.url);
  const list = useQuery({ queryKey: ["backups"], queryFn: () => services().backup.listBackups(), enabled: configured, retry: false });
  const last = useQuery({ queryKey: ["backup-last"], queryFn: async () => ({ last: (await services().backup.lastBackup()) ?? null, pending: await services().backup.pendingUpload() }) });
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [restoring, setRestoring] = useState<BackupListItem | null>(null);
  const [deleting, setDeleting] = useState<BackupListItem | null>(null);
  const controller = useRef<AbortController | null>(null);
  const schedule = config.schedule;
  const setSchedule = (patch: Partial<BackupSettings["schedule"]>) => save({ ...config, schedule: { ...schedule, ...patch } });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["backups"] });
    void queryClient.invalidateQueries({ queryKey: ["backup-last"] });
  };

  const run = async (resume: boolean) => {
    controller.current = new AbortController();
    setRunning(true);
    try {
      const options = { onProgress: setProgress, signal: controller.current.signal };
      await (resume ? services().backup.resumeUpload(options) : services().backup.createBackup(options));
      toast({ title: t.backup.done, variant: "success" });
    } catch (error) {
      if (!(error instanceof WebDavError && error.code === "aborted")) toast({ title: t.backup.failed, description: errorText(error), variant: "destructive" });
    } finally {
      setRunning(false);
      setProgress(null);
      refresh();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.backup.backupsTitle}</CardTitle>
        <CardDescription>{t.backup.backupsDescription}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">{t.backup.scheduleEnabled}</span>
          <Switch checked={schedule.enabled} onCheckedChange={(enabled) => setSchedule({ enabled })} aria-label={t.backup.scheduleEnabled} />
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <Row label={t.backup.intervalHours} htmlFor={ids.interval}>
            <Input id={ids.interval} type="number" dir="ltr" min={1} max={720} defaultValue={schedule.intervalHours} onBlur={(e) => setSchedule({ intervalHours: Math.min(720, Math.max(1, Number(e.target.value) || 24)) })} />
          </Row>
          <Row label={t.backup.keepLast} htmlFor={ids.keep}>
            <Input id={ids.keep} type="number" dir="ltr" min={1} max={100} defaultValue={schedule.keepLast} onBlur={(e) => setSchedule({ keepLast: Math.min(100, Math.max(1, Number(e.target.value) || 7)) })} />
          </Row>
          <Row label={t.backup.maxAttachment} htmlFor={ids.max}>
            <Input id={ids.max} type="number" dir="ltr" min={1} max={2048} defaultValue={schedule.maxAttachmentMb} onBlur={(e) => setSchedule({ maxAttachmentMb: Math.min(2048, Math.max(1, Number(e.target.value) || 100)) })} />
          </Row>
        </div>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">{t.backup.includeAttachments}</span>
          <Switch checked={schedule.includeAttachments} onCheckedChange={(includeAttachments) => setSchedule({ includeAttachments })} aria-label={t.backup.includeAttachments} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">
            {t.backup.encrypt}
            <span className="block text-xs text-muted-foreground">{schedule.encrypt ? t.backup.encryptOnHint : t.backup.encryptOffHint}</span>
          </span>
          <Switch checked={schedule.encrypt} onCheckedChange={(encrypt) => setSchedule({ encrypt })} aria-label={t.backup.encrypt} />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!configured || running} onClick={() => void run(false)}>
            {running ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CloudUpload className="size-4" aria-hidden="true" />}
            {t.backup.backupNow}
          </Button>
          {last.data?.pending && !running ? (
            <Button variant="tonal" onClick={() => void run(true)}>
              {t.backup.resume(last.data.pending.parts)}
            </Button>
          ) : null}
          {running ? (
            <Button variant="ghost" onClick={() => controller.current?.abort()}>
              {t.common.cancel}
            </Button>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {last.data?.last?.at ? t.backup.lastBackup(formatRelativeTime(last.data.last.at, locale)) : t.backup.never}
          </span>
        </div>
        {last.data?.last?.error ? (
          <p className="text-xs text-destructive" role="alert" dir="auto">
            {t.backup.lastError}: {last.data.last.error}
          </p>
        ) : null}
        <ProgressBar progress={progress} />

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{t.backup.onServer}</h3>
          <Button variant="ghost" size="sm" disabled={!configured} onClick={refresh}>
            <RefreshCw className="size-4" aria-hidden="true" />
            {t.backup.refresh}
          </Button>
        </div>
        {!configured ? <p className="text-sm text-muted-foreground">{t.backup.notConfigured}</p> : null}
        {configured && list.isPending ? <LoadingState label={t.common.loading} rows={2} /> : null}
        {configured && list.isError ? <ErrorState title={t.backup.listError} description={errorText(list.error)} retryLabel={t.common.retry} onRetry={() => void list.refetch()} /> : null}
        {list.data && list.data.length === 0 ? <EmptyState compact title={t.backup.emptyTitle} description={t.backup.emptyDescription} /> : null}
        {list.data?.length ? (
          <ul className="grid gap-2" aria-label={t.backup.onServer}>
            {list.data.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2 rounded-2xl border p-3" data-testid="backup-item">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{new Date(item.createdAt).toLocaleString(locale)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(item.size, locale)}
                    {item.manifest ? ` · ${item.manifest.device.label} · ${t.backup.conversationsCount(item.manifest.counts.conversations ?? 0)}` : ""}
                  </p>
                </div>
                {item.manifest?.encrypted ? (
                  <Badge variant="tonal">
                    <Lock className="size-3" aria-hidden="true" />
                    {t.backup.encrypted}
                  </Badge>
                ) : item.manifest ? (
                  <Badge variant="outline">
                    <Unlock className="size-3" aria-hidden="true" />
                    {t.backup.notEncrypted}
                  </Badge>
                ) : (
                  <Badge variant="warning">{t.backup.incomplete}</Badge>
                )}
                <Button size="sm" variant="tonal" disabled={!item.complete || running} onClick={() => setRestoring(item)}>
                  {t.backup.restore}
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={t.common.delete} onClick={() => setDeleting(item)}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <RestoreDialog item={restoring} onClose={() => setRestoring(null)} />
        <ConfirmDialog
          open={deleting !== null}
          onOpenChange={(v) => !v && setDeleting(null)}
          title={t.backup.deleteTitle}
          description={t.backup.deleteDescription}
          confirmLabel={t.common.delete}
          onConfirm={() =>
            deleting &&
            void services()
              .backup.deleteBackup(deleting.id)
              .then(() => setDeleting(null))
              .catch((e: unknown) => toast({ title: errorText(e), variant: "destructive" }))
              .finally(refresh)
          }
        />
      </CardContent>
    </Card>
  );
}

export function BackupScreen() {
  const { t } = useI18n();
  const settings = useSettings();
  const update = useUpdateSettings();
  if (settings.isPending) return <LoadingState label={t.common.loading} rows={3} />;
  if (settings.isError || !settings.data) return <ErrorState title={t.settings.loadError} description={t.errors.generic} retryLabel={t.common.retry} onRetry={() => void settings.refetch()} />;
  const config = settings.data.backup;
  const save = (next: BackupSettings) => update.mutate({ backup: next }, { onError: () => toast({ title: t.errors.generic, variant: "destructive" }) });
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6 p-4 sm:p-6">
      <PageHeader title={t.backup.title} description={t.backup.description} />
      <ConnectionCard config={config} save={save} />
      <BackupsCard config={config} save={save} />
      <SyncCard config={config} save={save} />
    </div>
  );
}
