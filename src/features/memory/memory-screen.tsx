"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Brain, Plus, RefreshCw, Search, Settings2 } from "lucide-react";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/feedback/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/use-toast";
import { useAssistants } from "@/features/assistants/queries";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useI18n } from "@/hooks/use-i18n";
import { getErrorMessage } from "@/lib/i18n/error-message";
import type { ScopeFilter } from "@/lib/memory/memory-index";
import type { MemoryChunk, MemoryChunkScope } from "@/lib/models";
import { LorebooksPanel } from "./lorebooks-panel";
import { MemoryCard } from "./memory-card";
import { MemoryEditorDialog } from "./memory-editor-dialog";
import { MEMORY_PAGE_SIZE, useDeleteMemory, useMemoryList, useMemorySearch, useMemoryStats, useReindexMemory } from "./queries";

type ScopeOption = "all" | MemoryChunkScope;

function IndexStatus() {
  const { t } = useI18n();
  const stats = useMemoryStats();
  const reindex = useReindexMemory();
  if (!stats.data) return null;
  const { total, indexed, pending, errors, modelKey, error, running } = stats.data;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 pt-5 text-sm" data-testid="memory-index-status">
        <div className="min-w-0 flex-1 space-y-1">
          {modelKey ? (
            <>
              <p className="font-medium">{t.memory.indexed(indexed, total)}</p>
              <p className="truncate text-xs text-muted-foreground" dir="ltr">
                {modelKey.split(":").slice(1, -1).join(":")}
              </p>
              {pending > 0 || errors > 0 ? <p className="text-xs text-muted-foreground">{t.memory.pendingErrors(pending, errors)}</p> : null}
              {error ? (
                <p className="text-xs text-destructive" role="status">
                  {t.memory.indexError}: <span dir="ltr">{error}</span>
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="font-medium">{t.memory.keywordOnly}</p>
              <p className="text-xs text-muted-foreground">{t.memory.keywordOnlyHint}</p>
            </>
          )}
        </div>
        {modelKey ? (
          <Button
            variant="outline"
            size="sm"
            disabled={reindex.isPending || running}
            onClick={() => reindex.mutate(undefined, { onSuccess: () => toast({ title: t.memory.reindexStarted }), onError: (e) => toast({ title: getErrorMessage(e, t), variant: "destructive" }) })}
          >
            <RefreshCw className={running ? "animate-spin" : undefined} aria-hidden="true" />
            {running ? t.memory.indexing : t.memory.reindex}
          </Button>
        ) : null}
        <Button asChild variant="ghost" size="sm">
          <Link href="/settings/memory">
            <Settings2 aria-hidden="true" />
            {t.memory.settingsLink}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function MemoriesPanel() {
  const { t } = useI18n();
  const searchId = useId();
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 350);
  const [scope, setScope] = useState<ScopeOption>("all");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<MemoryChunk | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<MemoryChunk | null>(null);
  const assistants = useAssistants();
  const assistantNames = useMemo(() => new Map<string, string>((assistants.data ?? []).map((a) => [a.id, a.name] as [string, string])), [assistants.data]);
  const remove = useDeleteMemory();

  const filter = useMemo(() => (scope === "all" ? {} : { scope }), [scope]);
  const searchFilter: ScopeFilter = { mode: "all" };
  const list = useMemoryList(filter, page);
  const search = useMemorySearch(debounced, searchFilter);
  const searching = debounced.trim().length > 0;

  let content: React.ReactNode;
  if (searching) {
    if (search.isPending) content = <LoadingState label={t.memory.searching} rows={3} />;
    else if (search.isError)
      content = <ErrorState title={t.memory.searchError} description={getErrorMessage(search.error, t)} retryLabel={t.common.retry} onRetry={() => void search.refetch()} />;
    else {
      const hits = (search.data?.hits ?? []).filter((h) => scope === "all" || h.chunk.scope === scope);
      content = hits.length ? (
        <>
          <p className="text-xs text-muted-foreground" role="status">
            {search.data?.retrieval === "semantic" ? t.memory.semanticResults(hits.length) : t.memory.keywordResults(hits.length)}
          </p>
          <ul aria-label={t.memory.chunksLabel} className="grid gap-3">
            {hits.map((hit) => (
              <li key={hit.chunk.id}>
                <MemoryCard chunk={hit.chunk} score={hit.score} assistantName={assistantNames.get(hit.chunk.assistantId ?? "")} onEdit={() => setEditing(hit.chunk)} onDelete={() => setDeleting(hit.chunk)} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState icon={Search} title={t.memory.noResults} description={t.memory.noResultsDescription} />
      );
    }
  } else if (list.isPending) content = <LoadingState label={t.common.loading} rows={3} />;
  else if (list.isError) content = <ErrorState title={t.memory.loadError} description={getErrorMessage(list.error, t)} retryLabel={t.common.retry} onRetry={() => void list.refetch()} />;
  else if (!list.data || list.data.items.length === 0)
    content = (
      <EmptyState
        icon={Brain}
        title={scope === "all" ? t.memory.emptyTitle : t.memory.emptyScopeTitle}
        description={t.memory.emptyDescription}
        action={
          <Button onClick={() => setEditing(null)}>
            <Plus aria-hidden="true" />
            {t.memory.add}
          </Button>
        }
      />
    );
  else {
    const { items, total } = list.data;
    const pages = Math.max(1, Math.ceil(total / MEMORY_PAGE_SIZE));
    content = (
      <>
        <p className="text-xs text-muted-foreground" role="status">
          {t.memory.count(total)}
        </p>
        <ul aria-label={t.memory.chunksLabel} className="grid gap-3">
          {items.map((chunk) => (
            <li key={chunk.id}>
              <MemoryCard chunk={chunk} assistantName={assistantNames.get(chunk.assistantId ?? "")} onEdit={() => setEditing(chunk)} onDelete={() => setDeleting(chunk)} />
            </li>
          ))}
        </ul>
        {pages > 1 ? (
          <nav aria-label={t.memory.pagination} className="flex items-center justify-center gap-3">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              {t.memory.previous}
            </Button>
            <span className="text-sm">{t.memory.pageOf(page + 1, pages)}</span>
            <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
              {t.memory.next}
            </Button>
          </nav>
        ) : null}
      </>
    );
  }

  return (
    <div className="grid gap-4">
      <IndexStatus />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor={searchId} className="sr-only">
          {t.memory.searchLabel}
        </label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id={searchId} type="search" dir="auto" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.memory.searchPlaceholder} className="ps-9" />
        </div>
        <SegmentedControl
          label={t.memory.scopeFilter}
          value={scope}
          onValueChange={(v) => {
            setScope(v);
            setPage(0);
          }}
          options={(["all", "global", "assistant", "conversation"] as const).map((value) => ({ value, label: value === "all" ? t.memory.all : t.memory.scopes[value] }))}
        />
        <Button onClick={() => setEditing(null)}>
          <Plus aria-hidden="true" />
          {t.memory.add}
        </Button>
      </div>
      <div aria-live="polite">{content}</div>
      <MemoryEditorDialog open={editing !== undefined} chunk={editing ?? null} onOpenChange={(open) => !open && setEditing(undefined)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t.memory.deleteTitle}
        description={t.memory.deleteDescription}
        confirmLabel={t.common.delete}
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate([deleting.id], {
            onSuccess: () => {
              setDeleting(null);
              toast({ title: t.memory.deleted });
            },
            onError: (e) => toast({ title: getErrorMessage(e, t), variant: "destructive" }),
          })
        }
      />
    </div>
  );
}

export function MemoryScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState("memories");
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <PageHeader title={t.memory.title} description={t.memory.description} />
      <Tabs value={tab} onValueChange={setTab} className="grid gap-4">
        <TabsList label={t.memory.title}>
          <TabsTrigger value="memories">
            <Brain className="size-4" aria-hidden="true" />
            {t.memory.tabs.memories}
          </TabsTrigger>
          <TabsTrigger value="lorebooks">
            <BookOpen className="size-4" aria-hidden="true" />
            {t.memory.tabs.lorebooks}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="memories">
          <MemoriesPanel />
        </TabsContent>
        <TabsContent value="lorebooks">
          <LorebooksPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
