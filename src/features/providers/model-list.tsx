"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { Plus, Search, Star } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { getErrorMessage } from "@/lib/i18n/error-message";
import type { Provider } from "@/lib/models";
import { normalizeForSearch } from "@/lib/text";
import { useAddManualModel, useSetDefaultModel, useToggleAllModels, useToggleModel } from "./queries";

function formatContext(tokens: number | null, locale: string): string | null {
  if (!tokens) return null;
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(tokens);
}

export function ModelList({ provider }: { provider: Provider }) {
  const { t, locale } = useI18n();
  const searchId = useId();
  const manualId = useId();
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");
  const toggle = useToggleModel();
  const toggleAll = useToggleAllModels();
  const setDefault = useSetDefaultModel();
  const addManual = useAddManualModel();
  const report = (error: unknown) => toast({ title: getErrorMessage(error, t), variant: "destructive" });

  const filtered = useMemo(() => {
    const q = normalizeForSearch(query);
    return q ? provider.models.filter((m) => normalizeForSearch(`${m.name} ${m.id}`).includes(q)) : provider.models;
  }, [provider.models, query]);

  const enabledCount = provider.models.filter((m) => m.enabled).length;
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 3 });

  const submitManual = (event: FormEvent) => {
    event.preventDefault();
    if (!manual.trim()) return;
    addManual.mutate({ id: provider.id, modelId: manual }, { onSuccess: () => setManual(""), onError: report });
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <label htmlFor={searchId} className="sr-only">
            {t.providers.searchModels}
          </label>
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id={searchId} type="search" value={query} placeholder={t.providers.searchModels} className="h-9 ps-9" onChange={(e) => setQuery(e.target.value)} />
        </div>
        <span className="text-xs text-muted-foreground">{t.providers.enabledCount(enabledCount, provider.models.length)}</span>
        <Button variant="ghost" size="sm" onClick={() => toggleAll.mutate({ id: provider.id, enabled: true }, { onError: report })}>
          {t.providers.enableAll}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => toggleAll.mutate({ id: provider.id, enabled: false }, { onError: report })}>
          {t.providers.disableAll}
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState compact title={t.providers.noModels} description={t.providers.noModelsDescription} />
      ) : (
        <ul className="grid max-h-96 gap-1 overflow-y-auto pe-1" aria-label={t.providers.modelsOf(provider.name)}>
          {filtered.map((model) => {
            const isDefault = provider.defaultModelId === model.id;
            const context = formatContext(model.contextWindow, locale);
            return (
              <li key={model.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-accent/60">
                <input
                  type="checkbox"
                  checked={model.enabled}
                  aria-label={t.providers.enableModel(model.name)}
                  onChange={(e) => toggle.mutate({ id: provider.id, modelId: model.id, enabled: e.target.checked }, { onError: report })}
                  className="size-4 shrink-0 accent-[hsl(var(--primary))]"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" dir="auto">
                    {model.name}
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground" dir="ltr">
                    {model.id}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {context ? <Badge variant="outline">{t.providers.context(context)}</Badge> : null}
                    {model.capabilities.vision ? <Badge variant="tonal">{t.models.vision}</Badge> : null}
                    {model.capabilities.audio ? <Badge variant="tonal">{t.models.audio}</Badge> : null}
                    {model.capabilities.video ? <Badge variant="tonal">{t.models.video}</Badge> : null}
                    {model.capabilities.tools ? <Badge variant="tonal">{t.models.tools}</Badge> : null}
                    {model.capabilities.reasoning ? <Badge variant="tonal">{t.models.reasoning}</Badge> : null}
                    {model.inputCost !== null && model.outputCost !== null ? (
                      <Badge variant="outline">
                        <span dir="ltr">
                          {money.format(model.inputCost)} / {money.format(model.outputCost)}
                        </span>
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <Button
                  variant={isDefault ? "tonal" : "ghost"}
                  size="sm"
                  aria-pressed={isDefault}
                  aria-label={isDefault ? t.providers.isDefaultModel(model.name) : t.providers.makeDefaultModel(model.name)}
                  onClick={() => !isDefault && setDefault.mutate({ id: provider.id, modelId: model.id }, { onError: report })}
                >
                  <Star className={isDefault ? "fill-current" : undefined} aria-hidden="true" />
                  <span className="hidden sm:inline">{isDefault ? t.providers.defaultModel : t.providers.setDefault}</span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={submitManual} className="flex gap-2">
        <label htmlFor={manualId} className="sr-only">
          {t.providers.manualModel}
        </label>
        <Input id={manualId} value={manual} dir="ltr" spellCheck={false} placeholder={t.providers.manualModel} className="h-9" onChange={(e) => setManual(e.target.value)} />
        <Button type="submit" variant="outline" size="sm" disabled={!manual.trim() || addManual.isPending}>
          <Plus aria-hidden="true" />
          {t.providers.addModel}
        </Button>
      </form>
    </div>
  );
}
