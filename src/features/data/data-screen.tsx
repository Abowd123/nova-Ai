"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Download, FileUp, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { PageHeader } from "@/components/feedback/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { toast } from "@/components/ui/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { openTextFile, saveTextFile } from "@/lib/files";
import { MIN_PASSWORD_LENGTH, passwordStrength } from "@/lib/transfer/crypto-file";
import { TransferError } from "@/lib/transfer/errors";
import type { ConflictStrategy, EntityKind, ImportMode, ImportPlan } from "@/lib/transfer/import";
import type { ExportSnapshot } from "@/lib/transfer/format";
import { cn } from "@/lib/utils";
import { transferErrorMessage } from "./transfer-error";
import { readImport, useApplyImport, useExportData, usePlanImport } from "./use-transfer";

function Check({ checked, onChange, label, hint, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; id: string }) {
  return (
    <label htmlFor={id} className="flex items-start gap-3 rounded-2xl border p-3">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-[hsl(var(--primary))]" />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

function ExportCard() {
  const { t } = useI18n();
  const ids = { conv: useId(), keys: useId(), encrypt: useId(), pw: useId(), pw2: useId() };
  const exportData = useExportData();
  const [includeConversations, setIncludeConversations] = useState(false);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const needsPassword = encrypt || includeSecrets;
  const strength = passwordStrength(password);
  const passwordError =
    needsPassword && password.length > 0 && password.length < MIN_PASSWORD_LENGTH
      ? t.data.passwordTooShort(MIN_PASSWORD_LENGTH)
      : needsPassword && confirm.length > 0 && confirm !== password
        ? t.data.passwordMismatch
        : null;
  const canExport = !needsPassword || (password.length >= MIN_PASSWORD_LENGTH && password === confirm);

  const run = async () => {
    try {
      const result = await exportData.mutateAsync({ includeConversations, includeSecrets, password: needsPassword ? password : undefined });
      const saved = await saveTextFile(result.text, result.fileName);
      if (saved !== "cancelled") toast({ title: t.data.exported(result.fileName), variant: "success" });
      setPassword("");
      setConfirm("");
    } catch (error) {
      toast({ title: transferErrorMessage(error, t), variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.data.exportTitle}</CardTitle>
        <CardDescription>{t.data.exportDescription}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Check id={ids.conv} checked={includeConversations} onChange={setIncludeConversations} label={t.data.includeConversations} hint={t.data.includeConversationsHint} />
        <Check id={ids.encrypt} checked={encrypt || includeSecrets} onChange={setEncrypt} label={t.data.encrypt} hint={t.data.encryptHint} />
        <Check
          id={ids.keys}
          checked={includeSecrets}
          onChange={(value) => {
            setIncludeSecrets(value);
            if (value) setEncrypt(true);
          }}
          label={t.data.includeKeys}
          hint={t.data.includeKeysHint}
        />
        {includeSecrets ? (
          <p role="alert" className="flex items-start gap-2 rounded-2xl bg-warning/15 px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t.data.keysWarning}
          </p>
        ) : null}
        {needsPassword ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={ids.pw}>{t.data.password}</Label>
              <Input id={ids.pw} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={`${ids.pw}-strength`} />
              <div id={`${ids.pw}-strength`} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex gap-1" aria-hidden="true">
                  {[1, 2, 3].map((level) => (
                    <span key={level} className={cn("h-1.5 w-8 rounded-full bg-surface-container-high", strength >= level && (strength === 1 ? "bg-destructive" : strength === 2 ? "bg-warning" : "bg-success"))} />
                  ))}
                </span>
                {t.data.strength[strength]}
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={ids.pw2}>{t.data.confirmPassword}</Label>
              <Input id={ids.pw2} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            {passwordError ? <p className="text-xs text-destructive sm:col-span-2">{passwordError}</p> : null}
            <p className="text-xs text-muted-foreground sm:col-span-2">{t.data.passwordHint}</p>
          </div>
        ) : null}
        <div>
          <Button onClick={() => void run()} disabled={!canExport || exportData.isPending} aria-busy={exportData.isPending}>
            {needsPassword ? <Lock aria-hidden="true" /> : <Download aria-hidden="true" />}
            {exportData.isPending ? t.data.exporting : t.data.exportButton}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const ENTITY_KEYS: EntityKind[] = ["assistant", "tag", "provider", "conversation"];

function PlanSummary({ plan }: { plan: ImportPlan }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3" data-testid="import-plan">
      <div className="overflow-x-auto rounded-2xl border">
        <table className="w-full text-sm">
          <thead className="bg-surface-container text-start">
            <tr>
              <th className="p-2 text-start font-medium">{t.data.entity}</th>
              <th className="p-2 font-medium">{t.data.actions.add}</th>
              <th className="p-2 font-medium">{t.data.actions.overwrite}</th>
              <th className="p-2 font-medium">{t.data.actions.skip}</th>
              <th className="p-2 font-medium">{t.data.actions.duplicate}</th>
              <th className="p-2 font-medium">{t.data.actions.reuse}</th>
            </tr>
          </thead>
          <tbody>
            {ENTITY_KEYS.map((key) => (
              <tr key={key} className="border-t">
                <th scope="row" className="p-2 text-start font-normal">
                  {t.data.entities[key]} ({plan.counts[key].total})
                </th>
                {(["add", "overwrite", "skip", "duplicate", "reuse"] as const).map((action) => (
                  <td key={action} className="p-2 text-center tabular-nums">
                    {plan.counts[key][action]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {plan.warnings.length ? (
        <ul className="grid gap-1.5">
          {plan.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2 rounded-2xl bg-warning/15 px-3 py-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t.data.warnings[warning]}
            </li>
          ))}
        </ul>
      ) : null}
      {plan.conflicts.length ? (
        <details className="rounded-2xl border" open={plan.conflicts.length <= 5}>
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{t.data.conflictReport(plan.conflicts.length)}</summary>
          <ul className="grid max-h-64 gap-1 overflow-y-auto border-t p-2 text-sm" data-testid="conflict-list">
            {plan.conflicts.map((conflict) => (
              <li key={`${conflict.entity}-${conflict.id}-${conflict.reason}`} className="flex flex-wrap items-center gap-2 rounded-xl px-2 py-1 hover:bg-accent/50">
                <Badge variant="outline">{t.data.entities[conflict.entity]}</Badge>
                <span dir="auto" className="font-medium">
                  {conflict.importedName}
                </span>
                <span className="text-muted-foreground">{conflict.reason === "same-name" ? t.data.sameName(conflict.existingName) : t.data.sameId(conflict.existingName)}</span>
                <Badge variant="tonal" className="ms-auto">
                  {t.data.actions[conflict.action]}
                </Badge>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {plan.duplicateIdsInFile.length ? <p className="text-xs text-muted-foreground">{t.data.duplicatesInFile(plan.duplicateIdsInFile.length)}</p> : null}
    </div>
  );
}

function ImportCard() {
  const { t } = useI18n();
  const ids = { pw: useId(), settings: useId() };
  const planImport = usePlanImport();
  const apply = useApplyImport();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [loaded, setLoaded] = useState<{ snapshot: ExportSnapshot; migratedFrom: number | null } | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [strategy, setStrategy] = useState<ConflictStrategy>("duplicate");
  const [applySettings, setApplySettings] = useState(false);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setLoaded(null);
    setPlan(null);
    setPassword("");
    setNeedsPassword(false);
    setError(null);
  };

  const recompute = async (next: { snapshot: ExportSnapshot; migratedFrom: number | null }, options = { mode, strategy, applySettings }) => {
    setPlan(await planImport.mutateAsync({ ...next, ...options }));
  };

  const load = async (text: string, pw?: string) => {
    setError(null);
    try {
      const parsed = await readImport(text, pw);
      const next = { snapshot: parsed.snapshot, migratedFrom: parsed.migratedFrom };
      setLoaded(next);
      setNeedsPassword(false);
      await recompute(next);
    } catch (e) {
      if (e instanceof TransferError && e.code === "password_required") setNeedsPassword(true);
      else setError(transferErrorMessage(e, t));
    }
  };

  const pick = async () => {
    try {
      const opened = await openTextFile();
      if (!opened) return;
      reset();
      setFile(opened);
      await load(opened.text);
    } catch (e) {
      setError(transferErrorMessage(e, t));
    }
  };

  const changeOptions = (patch: Partial<{ mode: ImportMode; strategy: ConflictStrategy; applySettings: boolean }>) => {
    const options = { mode, strategy, applySettings, ...patch };
    setMode(options.mode);
    setStrategy(options.strategy);
    setApplySettings(options.applySettings);
    if (loaded) void recompute(loaded, options);
  };

  const runApply = async () => {
    if (!plan) return;
    try {
      const result = await apply.mutateAsync(plan);
      toast({ title: t.data.imported(result.assistants, result.conversations), description: result.keysImported ? t.data.keysImported(result.keysImported) : undefined, variant: "success" });
      reset();
    } catch (e) {
      toast({ title: transferErrorMessage(e, t), variant: "destructive" });
    } finally {
      setConfirmReplace(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.data.importTitle}</CardTitle>
        <CardDescription>{t.data.importDescription}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="tonal" onClick={() => void pick()}>
            <FileUp aria-hidden="true" />
            {t.data.chooseFile}
          </Button>
          {file ? (
            <span className="text-sm text-muted-foreground" dir="auto" data-testid="import-file-name">
              {file.name}
            </span>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="rounded-2xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {needsPassword && file ? (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void load(file.text, password);
            }}
          >
            <Label htmlFor={ids.pw} className="flex items-center gap-1.5">
              <KeyRound className="size-4" aria-hidden="true" />
              {t.data.filePassword}
            </Label>
            <div className="flex gap-2">
              <Input id={ids.pw} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
              <Button type="submit" disabled={!password}>
                {t.data.unlock}
              </Button>
            </div>
          </form>
        ) : null}

        {loaded && plan ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <ShieldCheck className="size-4 text-success" aria-hidden="true" />
              {t.data.fileSummary(loaded.snapshot.app.version, new Date(loaded.snapshot.exportedAt))}
            </div>
            <div className="grid gap-2">
              <span className="text-sm font-medium">{t.data.mode}</span>
              <SegmentedControl
                label={t.data.mode}
                value={mode}
                onValueChange={(value) => changeOptions({ mode: value })}
                options={[
                  { value: "merge", label: t.data.modeMerge },
                  { value: "replace", label: t.data.modeReplace },
                ]}
              />
              <p className="text-xs text-muted-foreground">{mode === "merge" ? t.data.modeMergeHint : t.data.modeReplaceHint}</p>
            </div>
            {mode === "merge" ? (
              <>
                <div className="grid gap-2">
                  <span className="text-sm font-medium">{t.data.strategy}</span>
                  <SegmentedControl
                    label={t.data.strategy}
                    value={strategy}
                    onValueChange={(value) => changeOptions({ strategy: value })}
                    options={[
                      { value: "duplicate", label: t.data.strategyDuplicate },
                      { value: "overwrite", label: t.data.strategyOverwrite },
                      { value: "skip", label: t.data.strategySkip },
                    ]}
                  />
                </div>
                <Check id={ids.settings} checked={applySettings} onChange={(value) => changeOptions({ applySettings: value })} label={t.data.applySettings} />
              </>
            ) : null}
            <PlanSummary plan={plan} />
            <div className="flex flex-wrap gap-2">
              <Button
                variant={mode === "replace" ? "destructive" : "default"}
                disabled={apply.isPending || planImport.isPending}
                aria-busy={apply.isPending}
                onClick={() => (mode === "replace" ? setConfirmReplace(true) : void runApply())}
              >
                {t.data.importButton}
              </Button>
              <Button variant="ghost" onClick={reset}>
                {t.common.cancel}
              </Button>
            </div>
          </>
        ) : null}
        <ConfirmDialog
          open={confirmReplace}
          onOpenChange={setConfirmReplace}
          title={t.data.replaceTitle}
          description={t.data.replaceDescription}
          confirmLabel={t.data.importButton}
          pending={apply.isPending}
          onConfirm={() => void runApply()}
        />
      </CardContent>
    </Card>
  );
}

export function DataScreen() {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <Link href="/settings" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight className="size-4 ltr:rotate-180" aria-hidden="true" />
        {t.settings.title}
      </Link>
      <PageHeader title={t.data.title} description={t.data.description} />
      <ExportCard />
      <ImportCard />
    </div>
  );
}
