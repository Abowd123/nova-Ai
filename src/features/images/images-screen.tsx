"use client";

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Dices, ImagePlus, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/feedback/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { useProviders } from "@/features/providers/queries";
import { useI18n } from "@/hooks/use-i18n";
import { getErrorMessage } from "@/lib/i18n/error-message";
import { ASPECT_RATIOS, sizeForAspect } from "@/lib/media/geometry";
import { imageGenParamsSchema, type ComfyWorkflow, type ImageGenParams } from "@/lib/models";
import { cn } from "@/lib/utils";
import { sourcesFrom } from "./image-gen-service";
import { capabilitiesFor } from "./capabilities";
import { ComfyWorkflowDialog } from "./comfy-dialog";
import { Gallery } from "./gallery";
import { useComfyWorkflows, useDeleteWorkflow, useImageGenerations, useStartGeneration } from "./queries";

const DEFAULT_PARAMS: ImageGenParams = {
  prompt: "",
  negativePrompt: "",
  width: 1024,
  height: 1024,
  aspectRatio: "1:1",
  seed: null,
  count: 1,
  model: "",
  steps: null,
  guidance: null,
};

function NumberField({ id, label, value, onChange, min, max, step = 1, placeholder }: { id: string; label: string; value: number | null; onChange: (v: number | null) => void; min: number; max: number; step?: number; placeholder?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" inputMode="numeric" dir="ltr" min={min} max={max} step={step} placeholder={placeholder} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
    </div>
  );
}

export function ImagesScreen() {
  const { t } = useI18n();
  const ids = { source: useId(), model: useId(), prompt: useId(), negative: useId(), width: useId(), height: useId(), seed: useId(), count: useId(), steps: useId(), guidance: useId(), models: useId() };
  const providers = useProviders();
  const workflows = useComfyWorkflows();
  const generations = useImageGenerations();
  const start = useStartGeneration();
  const deleteWorkflow = useDeleteWorkflow();
  const sources = useMemo(() => sourcesFrom(providers.data ?? [], workflows.data ?? []), [providers.data, workflows.data]);
  const [sourceKey, setSourceKey] = useState("");
  const [params, setParams] = useState<ImageGenParams>(DEFAULT_PARAMS);
  const [comfyOpen, setComfyOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<ComfyWorkflow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ComfyWorkflow | null>(null);

  useEffect(() => {
    if (!sourceKey && sources[0]) setSourceKey(sources[0].key);
    if (sourceKey && !sources.some((s) => s.key === sourceKey)) setSourceKey(sources[0]?.key ?? "");
  }, [sources, sourceKey]);

  const source = sources.find((s) => s.key === sourceKey);
  const workflow = source?.backend === "comfyui" ? workflows.data?.find((w) => w.id === source.sourceId) : undefined;
  const caps = source ? capabilitiesFor(source.backend, params.model, workflow) : null;
  const set = <K extends keyof ImageGenParams>(key: K, value: ImageGenParams[K]) => setParams((p) => ({ ...p, [key]: value }));

  const setAspect = (aspectRatio: string) => setParams((p) => ({ ...p, aspectRatio, ...sizeForAspect(aspectRatio, Math.round(Math.sqrt(p.width * p.height) / 64) * 64 || 1024) }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!source) return;
    const candidate = { ...params, count: Math.min(params.count, caps?.maxCount ?? 1), model: params.model || caps?.models[0] || "" };
    const parsed = imageGenParamsSchema.safeParse(candidate);
    if (!parsed.success) {
      toast({ title: t.images.invalidParams, description: parsed.error.issues[0]?.path.join("."), variant: "destructive" });
      return;
    }
    if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission().catch(() => undefined);
    start.mutate({ backend: source.backend, sourceId: source.sourceId, params: parsed.data }, { onError: (e) => toast({ title: getErrorMessage(e, t), variant: "destructive" }) });
  };

  const loading = providers.isPending || workflows.isPending;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <PageHeader
        title={t.images.title}
        description={t.images.description}
        actions={
          <Button
            variant="outline"
            onClick={() => {
              setEditingWorkflow(null);
              setComfyOpen(true);
            }}
          >
            <Plus aria-hidden="true" />
            {t.images.addWorkflow}
          </Button>
        }
      />

      {loading ? (
        <LoadingState label={t.common.loading} rows={2} />
      ) : sources.length === 0 ? (
        <EmptyState
          icon={ImagePlus}
          title={t.images.noSourcesTitle}
          description={t.images.noSourcesDescription}
          action={
            <>
              <Button asChild>
                <Link href="/settings/providers">{t.chat.addProvider}</Link>
              </Button>
              <Button variant="outline" onClick={() => setComfyOpen(true)}>
                {t.images.addWorkflow}
              </Button>
            </>
          }
        />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={submit} className="grid gap-4" aria-label={t.images.formLabel}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={ids.source}>{t.images.source}</Label>
                  <div className="flex gap-1">
                    <select id={ids.source} value={sourceKey} onChange={(e) => setSourceKey(e.target.value)} className="h-10 min-w-0 flex-1 rounded-xl border bg-background px-3 text-sm">
                      {sources.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    {workflow ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t.images.editWorkflow}
                          onClick={() => {
                            setEditingWorkflow(workflow);
                            setComfyOpen(true);
                          }}
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={t.common.delete} onClick={() => setDeleteTarget(workflow)}>
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
                {source?.backend !== "comfyui" ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor={ids.model}>{t.images.model}</Label>
                    <Input id={ids.model} dir="ltr" list={ids.models} value={params.model} placeholder={caps?.models[0]} onChange={(e) => set("model", e.target.value)} />
                    <datalist id={ids.models}>
                      {caps?.models.map((m) => <option key={m} value={m} />)}
                    </datalist>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor={ids.prompt}>{t.images.prompt}</Label>
                <Textarea id={ids.prompt} rows={3} dir="auto" value={params.prompt} onChange={(e) => set("prompt", e.target.value)} placeholder={t.images.promptPlaceholder} required />
              </div>
              {caps?.negativePrompt ? (
                <div className="grid gap-1.5">
                  <Label htmlFor={ids.negative}>{t.images.negativePrompt}</Label>
                  <Textarea id={ids.negative} rows={2} dir="auto" value={params.negativePrompt} onChange={(e) => set("negativePrompt", e.target.value)} />
                </div>
              ) : null}

              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">{t.images.aspectRatio}</legend>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t.images.aspectRatio}>
                  {ASPECT_RATIOS.map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      role="radio"
                      aria-checked={params.aspectRatio === ratio}
                      onClick={() => setAspect(ratio)}
                      className={cn("h-8 rounded-full border px-3 text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", params.aspectRatio === ratio ? "border-transparent bg-primary text-primary-foreground" : "hover:bg-accent")}
                      dir="ltr"
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
                {caps?.sizes ? <p className="text-xs text-muted-foreground">{t.images.sizesHint(caps.sizes.join(", "))}</p> : null}
              </fieldset>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <NumberField id={ids.width} label={t.images.width} value={params.width} min={64} max={8192} step={64} onChange={(v) => set("width", v ?? 1024)} />
                <NumberField id={ids.height} label={t.images.height} value={params.height} min={64} max={8192} step={64} onChange={(v) => set("height", v ?? 1024)} />
                <NumberField id={ids.count} label={t.images.count(caps?.maxCount ?? 1)} value={params.count} min={1} max={caps?.maxCount ?? 1} onChange={(v) => set("count", Math.max(1, Math.min(v ?? 1, caps?.maxCount ?? 1)))} />
                {caps?.seed ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor={ids.seed}>{t.images.seed}</Label>
                    <div className="flex gap-1">
                      <Input id={ids.seed} type="number" dir="ltr" min={0} max={4294967295} placeholder={t.images.random} value={params.seed ?? ""} onChange={(e) => set("seed", e.target.value === "" ? null : Number(e.target.value))} />
                      <Button variant="ghost" size="icon" aria-label={t.images.randomSeed} onClick={() => set("seed", Math.floor(Math.random() * 2 ** 32))}>
                        <Dices aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                ) : null}
                {caps?.steps ? <NumberField id={ids.steps} label={t.images.steps} value={params.steps} min={1} max={200} placeholder={t.images.default} onChange={(v) => set("steps", v)} /> : null}
                {caps?.guidance ? <NumberField id={ids.guidance} label={t.images.guidance} value={params.guidance} min={0} max={50} step={0.5} placeholder={t.images.default} onChange={(v) => set("guidance", v)} /> : null}
              </div>

              <div>
                <Button type="submit" disabled={!params.prompt.trim() || !source || start.isPending} aria-busy={start.isPending} data-testid="generate-button">
                  <Sparkles aria-hidden="true" />
                  {t.images.generate}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <section aria-labelledby="images-history" className="grid gap-3">
        <h2 id="images-history" className="text-lg font-semibold">
          {t.images.history}
        </h2>
        {generations.isPending ? (
          <LoadingState label={t.common.loading} rows={2} />
        ) : generations.isError ? (
          <ErrorState title={t.images.loadError} description={getErrorMessage(generations.error, t)} retryLabel={t.common.retry} onRetry={() => void generations.refetch()} />
        ) : generations.data.length === 0 ? (
          <EmptyState compact icon={ImagePlus} title={t.images.emptyTitle} description={t.images.emptyDescription} />
        ) : (
          <Gallery
            generations={generations.data}
            onReuse={(reused) => {
              setParams(reused);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        )}
      </section>

      <ComfyWorkflowDialog open={comfyOpen} onOpenChange={setComfyOpen} workflow={editingWorkflow} />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.images.deleteWorkflowTitle}
        description={t.images.deleteWorkflowDescription}
        confirmLabel={t.common.delete}
        pending={deleteWorkflow.isPending}
        onConfirm={() => deleteTarget && deleteWorkflow.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) })}
      />
    </div>
  );
}
