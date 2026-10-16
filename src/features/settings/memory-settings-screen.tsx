"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Gauge, RefreshCw } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { useReindexMemory } from "@/features/memory/queries";
import { useProviders } from "@/features/providers/queries";
import { useI18n } from "@/hooks/use-i18n";
import { SUGGESTED_EMBEDDING_MODELS, supportsEmbeddings } from "@/lib/ai/embeddings";
import { formatTokens } from "@/lib/context/tokens";
import { getErrorMessage } from "@/lib/i18n/error-message";
import type { BenchmarkResult } from "@/lib/memory/benchmark";
import { DEFAULT_MEMORY_TEMPLATE, type ContextSettings, type MemorySettings } from "@/lib/models";
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

function Range({ id, value, min, max, step, onChange }: { id: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[hsl(var(--primary))]" />;
}

/** Number input that commits on blur, clamped to the schema bounds. */
function NumberInput({ id, value, min, max, onCommit }: { id: string; value: number; min: number; max: number; onCommit: (v: number) => void }) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      dir="ltr"
      min={min}
      max={max}
      defaultValue={value}
      key={value}
      onBlur={(e) => {
        const n = Math.round(Number(e.target.value));
        if (!Number.isFinite(n)) return;
        const clamped = Math.min(max, Math.max(min, n));
        if (clamped !== value) onCommit(clamped);
        e.target.value = String(clamped);
      }}
    />
  );
}

export function MemorySettingsScreen() {
  const { t, locale } = useI18n();
  const ids = {
    enabled: useId(), provider: useId(), model: useId(), dims: useId(), autoIndex: useId(), topK: useId(), threshold: useId(), weight: useId(), budget: useId(), chunk: useId(), overlap: useId(), template: useId(),
    window: useId(), reserve: useId(), autoSum: useId(), sumAt: useId(), sumProvider: useId(), sumModel: useId(), toolMax: useId(), warnAt: useId(),
  };
  const settings = useSettings();
  const update = useUpdateSettings();
  const providers = useProviders();
  const reindex = useReindexMemory();
  const services = useServices();
  const [bench, setBench] = useState<{ state: "idle" | "running" | "done" | "error"; result?: BenchmarkResult }>({ state: "idle" });

  if (settings.isPending) return <LoadingState label={t.common.loading} rows={4} />;
  if (settings.isError || !settings.data)
    return <ErrorState title={t.settings.loadError} description={getErrorMessage(settings.error, t)} retryLabel={t.common.retry} onRetry={() => void settings.refetch()} />;

  const { memory, context } = settings.data;
  const report = (e: unknown) => toast({ title: getErrorMessage(e, t), variant: "destructive" });
  const setMemory = (patch: Partial<MemorySettings>) => update.mutate({ memory: { ...memory, ...patch } }, { onError: report });
  const setContext = (patch: Partial<ContextSettings>) => update.mutate({ context: { ...context, ...patch } }, { onError: report });
  /** Changing the embedding model invalidates every stored vector: the service reindexes in the background. */
  const setEmbedding = (patch: Partial<MemorySettings>) =>
    update.mutate(
      { memory: { ...memory, ...patch } },
      {
        onSuccess: () => {
          services().memory.invalidate();
          void services().memory.ensureIndex().catch(() => undefined);
          toast({ title: t.memorySettings.reindexing });
        },
        onError: report,
      },
    );

  const all = providers.data ?? [];
  const embeddingProviders = all.filter((p) => p.enabled && supportsEmbeddings(p.kind));
  const embeddingProvider = all.find((p) => p.id === memory.embeddingProviderId);
  const suggestions = embeddingProvider ? (SUGGESTED_EMBEDDING_MODELS[embeddingProvider.kind] ?? []) : [];
  const summaryProvider = all.find((p) => p.id === context.summaryProviderId);
  const summaryModels = (summaryProvider?.models ?? []).filter((m) => m.enabled);

  const runBench = async () => {
    setBench({ state: "running" });
    try {
      setBench({ state: "done", result: await services().memory.benchmark(10_000, 768) });
    } catch {
      setBench({ state: "error" });
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <Link href="/settings" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight className="size-4 ltr:rotate-180" aria-hidden="true" />
        {t.settings.title}
      </Link>
      <PageHeader title={t.memorySettings.title} description={t.memorySettings.description} />

      <Card>
        <CardHeader>
          <CardTitle>{t.memorySettings.memory}</CardTitle>
          <CardDescription>{t.memorySettings.memoryDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor={ids.enabled}>{t.memorySettings.enabled}</Label>
            <Switch id={ids.enabled} checked={memory.enabled} onCheckedChange={(v) => setMemory({ enabled: v })} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor={ids.autoIndex}>{t.memorySettings.autoIndex}</Label>
              <p className="text-xs text-muted-foreground">{t.memorySettings.autoIndexHint}</p>
            </div>
            <Switch id={ids.autoIndex} checked={memory.autoIndex} onCheckedChange={(v) => setMemory({ autoIndex: v })} disabled={!memory.enabled} />
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium">{t.memorySettings.defaultScope}</span>
            <SegmentedControl
              label={t.memorySettings.defaultScope}
              value={memory.defaultScope}
              onValueChange={(v) => setMemory({ defaultScope: v })}
              options={[
                { value: "global", label: t.memory.scopes.global },
                { value: "conversation", label: t.memory.scopes.conversation },
                { value: "none", label: t.memorySettings.scopeNone },
              ]}
            />
            <p className="text-xs text-muted-foreground">{t.memorySettings.defaultScopeHint}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.memorySettings.embeddings}</CardTitle>
          <CardDescription>{t.memorySettings.embeddingsDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Row label={t.memorySettings.provider} htmlFor={ids.provider} hint={embeddingProviders.length ? undefined : t.memorySettings.noEmbeddingProviders}>
              <Select id={ids.provider} value={memory.embeddingProviderId ?? ""} onChange={(v) => setEmbedding({ embeddingProviderId: v || null })}>
                <option value="">{t.memorySettings.keywordOnly}</option>
                {embeddingProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Row>
            <Row label={t.memorySettings.model} htmlFor={ids.model}>
              <Input
                id={ids.model}
                dir="ltr"
                list={`${ids.model}-list`}
                defaultValue={memory.embeddingModel}
                key={memory.embeddingModel}
                disabled={!memory.embeddingProviderId}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  if (value && value !== memory.embeddingModel) setEmbedding({ embeddingModel: value });
                }}
              />
              <datalist id={`${ids.model}-list`}>
                {suggestions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Row>
          </div>
          <Row label={t.memorySettings.dimensions} htmlFor={ids.dims} hint={t.memorySettings.dimensionsHint}>
            <Select id={ids.dims} value={String(memory.embeddingDimensions ?? "")} onChange={(v) => setEmbedding({ embeddingDimensions: v ? Number(v) : null })}>
              <option value="">{t.memorySettings.modelDefault}</option>
              {[256, 512, 768, 1024, 1536, 3072].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Row>
          <p className="rounded-2xl bg-secondary/60 px-3 py-2 text-sm">{t.memorySettings.modelChangeNotice}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => reindex.mutate(undefined, { onSuccess: () => toast({ title: t.memory.reindexStarted }), onError: report })} disabled={reindex.isPending}>
              <RefreshCw className={reindex.isPending ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
              {t.memory.reindex}
            </Button>
            <Button variant="outline" onClick={() => void runBench()} disabled={bench.state === "running"}>
              <Gauge className="size-4" aria-hidden="true" />
              {bench.state === "running" ? t.memorySettings.benchmarkRunning : t.memorySettings.benchmark}
            </Button>
          </div>
          <div aria-live="polite" className="text-sm">
            {bench.state === "done" && bench.result ? (
              <p>{t.memorySettings.benchmarkResult(bench.result.entries.toLocaleString(locale), bench.result.dims, Math.round(bench.result.buildMs), Math.round(bench.result.searchMs * 10) / 10)}</p>
            ) : null}
            {bench.state === "error" ? <p className="text-destructive">{t.memorySettings.benchmarkError}</p> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.memorySettings.retrieval}</CardTitle>
          <CardDescription>{t.memorySettings.retrievalDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Row label={`${t.memorySettings.topK}: ${memory.topK}`} htmlFor={ids.topK}>
              <Range id={ids.topK} value={memory.topK} min={1} max={30} step={1} onChange={(v) => setMemory({ topK: v })} />
            </Row>
            <Row label={`${t.memorySettings.threshold}: ${memory.threshold.toFixed(2)}`} htmlFor={ids.threshold} hint={t.memorySettings.thresholdHint}>
              <Range id={ids.threshold} value={memory.threshold} min={0} max={1} step={0.05} onChange={(v) => setMemory({ threshold: v })} />
            </Row>
            <Row label={`${t.memorySettings.semanticWeight}: ${Math.round(memory.semanticWeight * 100)}%`} htmlFor={ids.weight} hint={t.memorySettings.semanticWeightHint}>
              <Range id={ids.weight} value={memory.semanticWeight} min={0} max={1} step={0.05} onChange={(v) => setMemory({ semanticWeight: v })} />
            </Row>
            <Row label={t.memorySettings.tokenBudget} htmlFor={ids.budget}>
              <NumberInput id={ids.budget} value={memory.tokenBudget} min={100} max={32_000} onCommit={(v) => setMemory({ tokenBudget: v })} />
            </Row>
            <Row label={t.memorySettings.chunkTokens} htmlFor={ids.chunk} hint={t.memorySettings.chunkHint}>
              <NumberInput id={ids.chunk} value={memory.chunkTokens} min={100} max={1000} onCommit={(v) => setMemory({ chunkTokens: v })} />
            </Row>
            <Row label={t.memorySettings.chunkOverlap} htmlFor={ids.overlap}>
              <NumberInput id={ids.overlap} value={memory.chunkOverlap} min={0} max={300} onCommit={(v) => setMemory({ chunkOverlap: v })} />
            </Row>
          </div>
          <Row label={t.memorySettings.template} htmlFor={ids.template} hint={t.memorySettings.templateHint}>
            <Textarea
              id={ids.template}
              dir="auto"
              rows={4}
              maxLength={4000}
              defaultValue={memory.promptTemplate}
              key={memory.promptTemplate}
              onBlur={(e) => {
                const value = e.target.value.trim() || DEFAULT_MEMORY_TEMPLATE;
                if (!value.includes("{{memories}}")) {
                  toast({ title: t.memorySettings.templateMissingVar, variant: "destructive" });
                  return;
                }
                if (value !== memory.promptTemplate) setMemory({ promptTemplate: value });
              }}
            />
          </Row>
          <div>
            <Button variant="ghost" size="sm" onClick={() => setMemory({ promptTemplate: DEFAULT_MEMORY_TEMPLATE })}>
              {t.memorySettings.resetTemplate}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.memorySettings.context}</CardTitle>
          <CardDescription>{t.memorySettings.contextDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <p className="rounded-2xl bg-secondary/60 px-3 py-2 text-sm">{t.memorySettings.budgetOrder}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Row label={t.memorySettings.defaultWindow} htmlFor={ids.window} hint={t.memorySettings.defaultWindowHint(formatTokens(context.defaultContextWindow, locale))}>
              <NumberInput id={ids.window} value={context.defaultContextWindow} min={1024} max={10_000_000} onCommit={(v) => setContext({ defaultContextWindow: v })} />
            </Row>
            <Row label={t.memorySettings.reserveOutput} htmlFor={ids.reserve} hint={t.memorySettings.reserveOutputHint}>
              <NumberInput id={ids.reserve} value={context.reserveOutputTokens} min={256} max={200_000} onCommit={(v) => setContext({ reserveOutputTokens: v })} />
            </Row>
            <Row label={t.memorySettings.maxToolResult} htmlFor={ids.toolMax} hint={t.memorySettings.maxToolResultHint}>
              <NumberInput id={ids.toolMax} value={context.maxToolResultTokens} min={100} max={100_000} onCommit={(v) => setContext({ maxToolResultTokens: v })} />
            </Row>
            <Row label={`${t.memorySettings.warnAt}: ${Math.round(context.warnAt * 100)}%`} htmlFor={ids.warnAt}>
              <Range id={ids.warnAt} value={context.warnAt} min={0.5} max={1} step={0.05} onChange={(v) => setContext({ warnAt: v })} />
            </Row>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.memorySettings.summaries}</CardTitle>
          <CardDescription>{t.memorySettings.summariesDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor={ids.autoSum}>{t.memorySettings.autoSummarize}</Label>
            <Switch id={ids.autoSum} checked={context.autoSummarize} onCheckedChange={(v) => setContext({ autoSummarize: v })} />
          </div>
          <Row label={`${t.memorySettings.summarizeAt}: ${Math.round(context.summarizeAt * 100)}%`} htmlFor={ids.sumAt} hint={t.memorySettings.summarizeAtHint}>
            <Range id={ids.sumAt} value={context.summarizeAt} min={0.3} max={0.95} step={0.05} onChange={(v) => setContext({ summarizeAt: v })} />
          </Row>
          <div className="grid gap-4 sm:grid-cols-2">
            <Row label={t.memorySettings.summaryProvider} htmlFor={ids.sumProvider} hint={t.memorySettings.summaryProviderHint}>
              <Select id={ids.sumProvider} value={context.summaryProviderId ?? ""} onChange={(v) => setContext({ summaryProviderId: v || null, summaryModelId: null })}>
                <option value="">{t.memorySettings.conversationModel}</option>
                {all
                  .filter((p) => p.enabled)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </Row>
            <Row label={t.memorySettings.summaryModel} htmlFor={ids.sumModel}>
              <Select id={ids.sumModel} value={context.summaryModelId ?? ""} onChange={(v) => setContext({ summaryModelId: v || null })}>
                <option value="">{summaryProvider ? t.memorySettings.chooseModel : t.memorySettings.conversationModel}</option>
                {summaryModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Row>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
