"use client";

import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, KeyRound, ShieldAlert, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/feedback/page-header";
import { useRepositories } from "@/components/providers/repository-provider";
import { useServices } from "@/components/providers/services-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { ModelPicker } from "@/features/chat/model-picker";
import { modelKey } from "@/features/chat/model-selection";
import { useSettings, useUpdateSettings } from "@/features/settings/queries";
import { useI18n } from "@/hooks/use-i18n";
import { getErrorMessage } from "@/lib/i18n/error-message";
import { validPyodideUrl } from "@/lib/sandbox/py-worker-source";
import { effectivePermission } from "@/lib/tools/registry";
import type { SearchProviderKind, ToolPermission, ToolSettings } from "@/lib/models";
import type { ServiceKeyName } from "./service-keys";

function Row({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function NumberInput({ id, value, min, max, onCommit }: { id: string; value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      dir="ltr"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = Number(draft);
        if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, Math.round(n))));
        else setDraft(String(value));
      }}
    />
  );
}

const hostsOf = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter((h) => /^[a-z0-9.*-]+$/.test(h));

function KeyField({ service, label }: { service: ServiceKeyName; label: string }) {
  const { t } = useI18n();
  const services = useServices();
  const id = useId();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<boolean | null>(null);
  useEffect(() => {
    void services().keys.has(service).then(setSaved).catch(() => setSaved(false));
  }, [services, service]);
  const save = async (next: string) => {
    try {
      await services().keys.set(service, next);
      setSaved(Boolean(next.trim()));
      setValue("");
      toast({ title: t.settings.saved, variant: "success" });
    } catch (e) {
      toast({ title: getErrorMessage(e, t), variant: "destructive" });
    }
  };
  return (
    <Row label={label} htmlFor={id} hint={saved ? t.media.keySaved : t.media.keyHint}>
      <div className="flex gap-2">
        <Input id={id} type="password" autoComplete="off" dir="ltr" value={value} placeholder={saved ? "••••••••" : ""} onChange={(e) => setValue(e.target.value)} />
        <Button type="button" variant="tonal" disabled={!value.trim()} onClick={() => void save(value)}>
          <KeyRound className="size-4" aria-hidden="true" />
          {t.common.save}
        </Button>
        {saved ? (
          <Button type="button" variant="ghost" size="icon" aria-label={t.tools.removeKey} onClick={() => void save("")}>
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </Row>
  );
}

function UsageCard() {
  const { t, locale } = useI18n();
  const repos = useRepositories();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const totals = useQuery({ queryKey: ["usage-totals"], queryFn: () => repos().usage.totals() });
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 4 });
  const number = new Intl.NumberFormat(locale);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.tools.usageTitle}</CardTitle>
        <CardDescription>{t.tools.usageDescription}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {totals.isPending ? <LoadingState label={t.common.loading} rows={1} /> : null}
        {totals.isError ? <ErrorState title={t.errors.generic} description={getErrorMessage(totals.error, t)} retryLabel={t.common.retry} onRetry={() => void totals.refetch()} /> : null}
        {totals.data && totals.data.length === 0 ? <p className="text-muted-foreground">{t.tools.usageEmpty}</p> : null}
        {totals.data && totals.data.length > 0 ? (
          <table className="w-full text-start">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 text-start font-medium">{t.tools.usageKind}</th>
                <th className="py-1 text-start font-medium">{t.tools.usageTokens}</th>
                <th className="py-1 text-start font-medium">{t.tools.usageCost}</th>
              </tr>
            </thead>
            <tbody>
              {totals.data.map((row) => (
                <tr key={row.kind} className="border-t">
                  <td className="py-1.5">{t.tools.usageKinds[row.kind]}</td>
                  <td className="py-1.5" dir="ltr">
                    {number.format(row.inputTokens)} / {number.format(row.outputTokens)}
                  </td>
                  <td className="py-1.5" dir="ltr">
                    {money.format(row.cost)}
                    {row.unpriced ? ` (+${row.unpriced} ?)` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {totals.data?.length ? (
          <Button variant="ghost" className="justify-self-start" onClick={() => setConfirm(true)}>
            <Trash2 className="size-4" aria-hidden="true" />
            {t.tools.usageClear}
          </Button>
        ) : null}
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={t.tools.usageClear}
          description={t.tools.usageClearDescription}
          confirmLabel={t.common.delete}
          destructive
          onConfirm={() =>
            void repos()
              .usage.clear()
              .then(() => {
                setConfirm(false);
                void queryClient.invalidateQueries({ queryKey: ["usage-totals"] });
              })
          }
        />
      </CardContent>
    </Card>
  );
}

export function ToolsSettingsScreen() {
  const { t } = useI18n();
  const ids = {
    steps: useId(),
    timeout: useId(),
    provider: useId(),
    searx: useId(),
    count: useId(),
    lang: useId(),
    region: useId(),
    exclude: useId(),
    blocked: useId(),
    chars: useId(),
    jsTimeout: useId(),
    jsChars: useId(),
    jsMem: useId(),
    pyUrl: useId(),
    pyTimeout: useId(),
    subTokens: useId(),
    subSteps: useId(),
  };
  const settings = useSettings();
  const update = useUpdateSettings();
  const services = useServices();
  const registry = services().tools;
  const tools = useSyncExternalStore(
    (cb) => registry.subscribe(cb),
    () => registry.list(),
    () => registry.list(),
  );
  const [pyUrl, setPyUrl] = useState<string | null>(null);

  if (settings.isPending) return <LoadingState label={t.common.loading} rows={3} />;
  if (settings.isError || !settings.data)
    return <ErrorState title={t.settings.loadError} description={getErrorMessage(settings.error, t)} retryLabel={t.common.retry} onRetry={() => void settings.refetch()} />;

  const config = settings.data.tools;
  const save = (next: ToolSettings) => update.mutate({ tools: next }, { onError: (e) => toast({ title: getErrorMessage(e, t), variant: "destructive" }) });
  const set = <K extends keyof ToolSettings>(key: K, value: ToolSettings[K]) => save({ ...config, [key]: value });
  const permissionOptions = (dangerous: boolean) =>
    [
      ...(dangerous ? [] : [{ value: "auto" as const, label: t.tools.permissions.auto }]),
      { value: "ask" as const, label: t.tools.permissions.ask },
      { value: "disabled" as const, label: t.tools.permissions.disabled },
    ] satisfies { value: ToolPermission; label: string }[];
  const providerKinds: (SearchProviderKind | "")[] = ["", "tavily", "brave", "exa", "searxng"];

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6 p-4 sm:p-6">
      <PageHeader title={t.tools.title} description={t.tools.description} />

      <Card>
        <CardHeader>
          <CardTitle>{t.tools.agentTitle}</CardTitle>
          <CardDescription>{t.tools.agentDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Row label={t.tools.maxSteps} htmlFor={ids.steps} hint={t.tools.maxStepsHint}>
            <NumberInput id={ids.steps} value={config.maxSteps} min={1} max={50} onCommit={(v) => set("maxSteps", v)} />
          </Row>
          <Row label={t.tools.timeout} htmlFor={ids.timeout}>
            <NumberInput id={ids.timeout} value={config.timeoutSec} min={5} max={900} onCommit={(v) => set("timeoutSec", v)} />
          </Row>
          <label className="flex items-center justify-between gap-3 sm:col-span-2">
            <span className="text-sm">{t.tools.parallel}</span>
            <Switch checked={config.parallel} onCheckedChange={(v) => set("parallel", v)} aria-label={t.tools.parallel} />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.tools.permissionsTitle}</CardTitle>
          <CardDescription>{t.tools.permissionsDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {tools.length === 0 ? <p className="text-sm text-muted-foreground">{t.tools.noTools}</p> : null}
          {tools.map((tool) => {
            const current = effectivePermission(tool, config.permissions);
            return (
              <div key={tool.name} className="flex flex-col gap-2 rounded-2xl border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-1 font-medium">
                    {tool.dangerous ? <ShieldAlert className="size-4 text-destructive" aria-label={t.tools.dangerous} /> : null}
                    <span dir="ltr" className="truncate font-mono text-sm">{tool.name}</span>
                  </p>
                  <p className="line-clamp-2 text-xs text-muted-foreground" dir="auto">
                    {(t.tools.names as Record<string, string>)[tool.name] ?? tool.description}
                  </p>
                  {tool.dangerous ? <p className="text-xs text-destructive">{t.tools.alwaysAsks}</p> : null}
                </div>
                <SegmentedControl
                  label={t.tools.permissionFor(tool.name)}
                  value={current}
                  options={permissionOptions(tool.dangerous)}
                  onValueChange={(value) => set("permissions", { ...config.permissions, [tool.name]: value })}
                />
              </div>
            );
          })}
          <Link href="/settings/mcp" className="inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline">
            {t.tools.manageMcp}
            <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.tools.searchTitle}</CardTitle>
          <CardDescription>{t.tools.searchDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Row label={t.tools.searchProvider} htmlFor={ids.provider}>
            <select
              id={ids.provider}
              className="h-10 rounded-xl border bg-background px-3 text-sm"
              value={config.search.provider ?? ""}
              onChange={(e) => set("search", { ...config.search, provider: (e.target.value || null) as SearchProviderKind | null })}
            >
              {providerKinds.map((kind) => (
                <option key={kind || "none"} value={kind}>
                  {kind ? t.tools.searchProviders[kind] : t.tools.searchNone}
                </option>
              ))}
            </select>
          </Row>
          {config.search.provider === "tavily" || config.search.provider === "brave" || config.search.provider === "exa" ? (
            <KeyField service={config.search.provider} label={t.tools.apiKey(t.tools.searchProviders[config.search.provider])} />
          ) : null}
          {config.search.provider === "searxng" ? (
            <Row label={t.tools.searxngUrl} htmlFor={ids.searx} hint={t.tools.searxngHint}>
              <Input id={ids.searx} dir="ltr" type="url" defaultValue={config.search.searxngUrl} onBlur={(e) => set("search", { ...config.search, searxngUrl: e.target.value.trim() })} />
            </Row>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <Row label={t.tools.resultCount} htmlFor={ids.count}>
              <NumberInput id={ids.count} value={config.search.count} min={1} max={20} onCommit={(v) => set("search", { ...config.search, count: v })} />
            </Row>
            <Row label={t.tools.language} htmlFor={ids.lang}>
              <Input id={ids.lang} dir="ltr" maxLength={10} placeholder="ar" defaultValue={config.search.language} onBlur={(e) => set("search", { ...config.search, language: e.target.value.trim().toLowerCase() })} />
            </Row>
            <Row label={t.tools.region} htmlFor={ids.region}>
              <Input id={ids.region} dir="ltr" maxLength={10} placeholder="sa" defaultValue={config.search.region} onBlur={(e) => set("search", { ...config.search, region: e.target.value.trim().toLowerCase() })} />
            </Row>
          </div>
          <Row label={t.tools.excludeSites} htmlFor={ids.exclude} hint={t.tools.sitesHint}>
            <Textarea id={ids.exclude} dir="ltr" rows={2} defaultValue={config.search.excludeSites.join("\n")} onBlur={(e) => set("search", { ...config.search, excludeSites: hostsOf(e.target.value).slice(0, 100) })} />
          </Row>
          <Row label={t.tools.blockedSites} htmlFor={ids.blocked} hint={t.tools.blockedHint}>
            <Textarea id={ids.blocked} dir="ltr" rows={2} defaultValue={config.search.blockedSites.join("\n")} onBlur={(e) => set("search", { ...config.search, blockedSites: hostsOf(e.target.value).slice(0, 500) })} />
          </Row>
          <Row label={t.tools.maxContent} htmlFor={ids.chars}>
            <NumberInput id={ids.chars} value={config.search.maxContentChars} min={500} max={200_000} onCommit={(v) => set("search", { ...config.search, maxContentChars: v })} />
          </Row>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">{t.tools.summarizePages}</span>
            <Switch checked={config.search.summarizeResults} onCheckedChange={(v) => set("search", { ...config.search, summarizeResults: v })} aria-label={t.tools.summarizePages} />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.tools.jsTitle}</CardTitle>
          <CardDescription>{t.tools.jsDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Row label={t.tools.timeoutMs} htmlFor={ids.jsTimeout}>
            <NumberInput id={ids.jsTimeout} value={config.js.timeoutMs} min={100} max={120_000} onCommit={(v) => set("js", { ...config.js, timeoutMs: v })} />
          </Row>
          <Row label={t.tools.maxOutput} htmlFor={ids.jsChars}>
            <NumberInput id={ids.jsChars} value={config.js.maxOutputChars} min={1000} max={1_000_000} onCommit={(v) => set("js", { ...config.js, maxOutputChars: v })} />
          </Row>
          <Row label={t.tools.memoryLimit} htmlFor={ids.jsMem} hint={t.tools.memoryHint}>
            <NumberInput id={ids.jsMem} value={config.js.memoryLimitMb} min={16} max={4096} onCommit={(v) => set("js", { ...config.js, memoryLimitMb: v })} />
          </Row>
          <label className="flex items-center justify-between gap-3 sm:col-span-3">
            <span className="text-sm">
              {t.tools.allowNetwork}
              <span className="block text-xs text-muted-foreground">{t.tools.allowNetworkHint}</span>
            </span>
            <Switch checked={config.js.allowNetwork} onCheckedChange={(v) => set("js", { ...config.js, allowNetwork: v })} aria-label={t.tools.allowNetwork} />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.tools.pyTitle}</CardTitle>
          <CardDescription>{t.tools.pyDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">{t.tools.pyEnabled}</span>
            <Switch checked={config.python.enabled} onCheckedChange={(v) => set("python", { ...config.python, enabled: v })} aria-label={t.tools.pyEnabled} />
          </label>
          <Row label={t.tools.pyUrl} htmlFor={ids.pyUrl} hint={pyUrl !== null && !validPyodideUrl(pyUrl) ? t.tools.pyUrlInvalid : t.tools.pyUrlHint}>
            <Input
              id={ids.pyUrl}
              dir="ltr"
              type="url"
              defaultValue={config.python.indexUrl}
              aria-invalid={pyUrl !== null && !validPyodideUrl(pyUrl)}
              onChange={(e) => setPyUrl(e.target.value)}
              onBlur={(e) => {
                const valid = validPyodideUrl(e.target.value.trim());
                if (valid) set("python", { ...config.python, indexUrl: valid });
              }}
            />
          </Row>
          <Row label={t.tools.timeoutMs} htmlFor={ids.pyTimeout}>
            <NumberInput id={ids.pyTimeout} value={config.python.timeoutMs} min={1000} max={600_000} onCommit={(v) => set("python", { ...config.python, timeoutMs: v })} />
          </Row>
          <Button variant="tonal" className="justify-self-start" onClick={() => services().python.reset()}>
            {t.tools.pyReset}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.tools.subagentTitle}</CardTitle>
          <CardDescription>{t.tools.subagentDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ModelPicker
            label={t.tools.subagentModel}
            value={config.subagent.providerId && config.subagent.modelId ? modelKey(config.subagent.providerId, config.subagent.modelId) : null}
            onChange={({ providerId, modelId }) => set("subagent", { ...config.subagent, providerId, modelId })}
          />
          {config.subagent.providerId ? (
            <Button variant="ghost" className="justify-self-start" onClick={() => set("subagent", { ...config.subagent, providerId: null, modelId: null })}>
              {t.tools.subagentUseConversation}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">{t.tools.subagentFallback}</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Row label={t.tools.subagentMaxTokens} htmlFor={ids.subTokens}>
              <NumberInput id={ids.subTokens} value={config.subagent.maxTokens} min={64} max={32_000} onCommit={(v) => set("subagent", { ...config.subagent, maxTokens: v })} />
            </Row>
            <Row label={t.tools.subagentMaxSteps} htmlFor={ids.subSteps}>
              <NumberInput id={ids.subSteps} value={config.subagent.maxSteps} min={1} max={20} onCommit={(v) => set("subagent", { ...config.subagent, maxSteps: v })} />
            </Row>
          </div>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">
              {t.tools.subagentTitles}
              <span className="block text-xs text-muted-foreground">{t.tools.subagentUsedFor}</span>
            </span>
            <Switch checked={config.subagent.useForTitles} onCheckedChange={(v) => set("subagent", { ...config.subagent, useForTitles: v })} aria-label={t.tools.subagentTitles} />
          </label>
        </CardContent>
      </Card>

      <UsageCard />
    </div>
  );
}
