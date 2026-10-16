"use client";

import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitMerge, Loader2, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { EmptyState } from "@/components/feedback/empty-state";
import { useServices } from "@/components/providers/services-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import { useBackupErrorText } from "@/features/backup/error-text";
import { useI18n } from "@/hooks/use-i18n";
import { formatRelativeTime } from "@/lib/format";
import type { BackupSettings, SyncConflict } from "@/lib/models";

function Preview({ value }: { value: unknown }) {
  const { t } = useI18n();
  if (value === null || value === undefined) return <p className="text-xs italic text-muted-foreground">{t.sync.deletedVersion}</p>;
  const text = JSON.stringify(value, (key, v) => (key === "embedding" || key === "vector" ? undefined : v), 2);
  return (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-background/70 p-2 text-xs" dir="auto">
      {text.length > 3000 ? `${text.slice(0, 3000)}\n…` : text}
    </pre>
  );
}

function ConflictItem({ conflict, onResolved }: { conflict: SyncConflict; onResolved: () => void }) {
  const { t, locale } = useI18n();
  const services = useServices();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pick = async (choice: "local" | "remote") => {
    setBusy(true);
    try {
      await services().sync.resolveConflict(conflict.id, choice);
      toast({ title: t.sync.resolved, variant: "success" });
      onResolved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="rounded-2xl border p-3" data-testid="sync-conflict">
      <div className="flex flex-wrap items-center gap-2">
        <GitMerge className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">
          {conflict.label || conflict.recordId}
        </span>
        <Badge variant="outline">{t.sync.tables[conflict.table as keyof typeof t.sync.tables] ?? conflict.table}</Badge>
        <Badge variant="tonal">{conflict.winner === "local" ? t.sync.keptLocal : t.sync.keptRemote}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{formatRelativeTime(conflict.createdAt, locale)}</p>
      <button type="button" className="mt-1 text-xs text-primary underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? t.sync.hideVersions : t.sync.compare}
      </button>
      {open ? (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <p className="text-xs font-medium">
              {t.sync.thisDevice} · {new Date(conflict.localUpdatedAt).toLocaleString(locale)}
            </p>
            <Preview value={conflict.local} />
            <Button size="sm" variant={conflict.winner === "local" ? "tonal" : "default"} disabled={busy} onClick={() => void pick("local")}>
              {t.sync.keepThis}
            </Button>
          </div>
          <div className="grid gap-1">
            <p className="text-xs font-medium">
              {t.sync.otherDevice} · {new Date(conflict.remoteUpdatedAt).toLocaleString(locale)}
            </p>
            <Preview value={conflict.remote} />
            <Button size="sm" variant={conflict.winner === "remote" ? "tonal" : "default"} disabled={busy} onClick={() => void pick("remote")}>
              {t.sync.keepThis}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function SyncCard({ config, save }: { config: BackupSettings; save: (next: BackupSettings) => void }) {
  const { t, locale } = useI18n();
  const services = useServices();
  const errorText = useBackupErrorText();
  const queryClient = useQueryClient();
  const intervalId = useId();
  const sync = config.sync;
  const setSync = (patch: Partial<BackupSettings["sync"]>) => save({ ...config, sync: { ...sync, ...patch } });
  const last = useQuery({ queryKey: ["sync-last"], queryFn: async () => (await services().sync.lastSync()) ?? null });
  const conflicts = useQuery({ queryKey: ["sync-conflicts"], queryFn: () => services().sync.conflicts("open") });
  const [running, setRunning] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["sync-last"] });
    void queryClient.invalidateQueries({ queryKey: ["sync-conflicts"] });
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const result = await services().sync.sync();
      toast({ title: t.sync.doneSummary(result.pushed, result.pulled, result.conflicts), variant: "success" });
    } catch (error) {
      toast({ title: t.sync.failed, description: errorText(error), variant: "destructive" });
    } finally {
      setRunning(false);
      refresh();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.sync.title}</CardTitle>
        <CardDescription>{t.sync.description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">{t.sync.enabled}</span>
          <Switch checked={sync.enabled} onCheckedChange={(enabled) => setSync({ enabled })} aria-label={t.sync.enabled} />
        </label>
        <div className="grid gap-2">
          <Label htmlFor={intervalId}>{t.sync.interval}</Label>
          <Input id={intervalId} type="number" dir="ltr" min={1} max={1440} defaultValue={sync.intervalMinutes} onBlur={(e) => setSync({ intervalMinutes: Math.min(1440, Math.max(1, Number(e.target.value) || 15)) })} />
        </div>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">
            {t.sync.encrypt}
            <span className="block text-xs text-muted-foreground">{t.sync.encryptHint}</span>
          </span>
          <Switch checked={sync.encrypt} onCheckedChange={(encrypt) => setSync({ encrypt })} aria-label={t.sync.encrypt} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">{t.sync.attachments}</span>
          <Switch checked={sync.includeAttachments} onCheckedChange={(includeAttachments) => setSync({ includeAttachments })} aria-label={t.sync.attachments} />
        </label>
        <p className="text-xs text-muted-foreground">{t.sync.keysNote}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!config.webdav.url || running} onClick={() => void runNow()}>
            {running ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
            {t.sync.now}
          </Button>
          <Button variant="ghost" onClick={() => setConfirmReset(true)}>
            {t.sync.reset}
          </Button>
          <span className="text-xs text-muted-foreground">{last.data?.at ? t.sync.last(formatRelativeTime(last.data.at, locale)) : t.sync.never}</span>
        </div>
        {last.data?.error ? (
          <p className="text-xs text-destructive" role="alert" dir="auto">
            {last.data.error}
          </p>
        ) : null}

        <h3 className="text-sm font-medium">{t.sync.conflictsTitle}</h3>
        {conflicts.isPending ? <p className="text-xs text-muted-foreground">{t.common.loading}</p> : null}
        {conflicts.data && conflicts.data.length === 0 ? <EmptyState compact title={t.sync.noConflicts} description={t.sync.noConflictsDescription} /> : null}
        {conflicts.data?.length ? (
          <ul className="grid gap-2" aria-label={t.sync.conflictsTitle}>
            {conflicts.data.map((c) => (
              <ConflictItem key={c.id} conflict={c} onResolved={refresh} />
            ))}
          </ul>
        ) : null}
        <ConfirmDialog
          open={confirmReset}
          onOpenChange={setConfirmReset}
          title={t.sync.reset}
          description={t.sync.resetDescription}
          confirmLabel={t.sync.reset}
          destructive={false}
          onConfirm={() => void services().sync.reset().then(() => setConfirmReset(false)).finally(refresh)}
        />
      </CardContent>
    </Card>
  );
}
