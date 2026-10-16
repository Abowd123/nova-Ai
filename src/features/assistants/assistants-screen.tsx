"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bot, Copy, FileUp, MessageSquarePlus, Pencil, Plus, Search, SearchX, Share2, Star, Tags, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/feedback/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { useCreateConversation } from "@/features/conversations/queries";
import { readImport, useApplyImport, usePlanImport } from "@/features/data/use-transfer";
import { transferErrorMessage } from "@/features/data/transfer-error";
import { TagChip, TagToggle } from "@/features/tags/tag-chip";
import { TagManagerDialog } from "@/features/tags/tag-manager-dialog";
import { useTags } from "@/features/tags/queries";
import { useI18n } from "@/hooks/use-i18n";
import { openTextFile, saveTextFile, shareTextFile } from "@/lib/files";
import { getErrorMessage } from "@/lib/i18n/error-message";
import type { Assistant } from "@/lib/models";
import { assistantFileName, buildSharedAssistant } from "@/lib/transfer/export";
import { AssistantAvatar } from "./assistant-avatar";
import { AssistantFormDialog } from "./assistant-form-dialog";
import { filterAssistants, filterFromSearchParams, filterToSearchParams, toggleTag, type AssistantFilter } from "./filter";
import { useAssistants, useDeleteAssistant, useDuplicateAssistant, useSetDefaultAssistant } from "./queries";
import { chatHref } from "@/lib/routes";

function useUrlFilter(knownTagIds: string[] | undefined) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filter = useMemo(() => filterFromSearchParams(new URLSearchParams(params.toString()), knownTagIds), [params, knownTagIds]);
  const setFilter = (next: AssistantFilter) => {
    const search = filterToSearchParams(next, new URLSearchParams(params.toString())).toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  };
  return { filter, setFilter };
}

export function AssistantsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const assistants = useAssistants();
  const tags = useTags();
  const deleteAssistant = useDeleteAssistant();
  const duplicateAssistant = useDuplicateAssistant();
  const setDefault = useSetDefaultAssistant();
  const createConversation = useCreateConversation();
  const planImport = usePlanImport();
  const applyImport = useApplyImport();
  const knownTagIds = useMemo(() => tags.data?.map((tag) => tag.id), [tags.data]);
  const { filter, setFilter } = useUrlFilter(knownTagIds);
  const [query, setQuery] = useState(filter.query);

  const [formOpen, setFormOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [editing, setEditing] = useState<Assistant | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Assistant | null>(null);

  const reportError = (error: unknown) => toast({ title: getErrorMessage(error, t), variant: "destructive" });
  const tagById = useMemo(() => new Map((tags.data ?? []).map((tag) => [tag.id, tag])), [tags.data]);
  const visible = useMemo(() => filterAssistants(assistants.data ?? [], tags.data ?? [], { ...filter, query }), [assistants.data, tags.data, filter, query]);
  const filtering = Boolean(query.trim() || filter.tagIds.length);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const share = async (assistant: Assistant) => {
    const json = JSON.stringify(buildSharedAssistant(assistant, tags.data ?? []), null, 2);
    const name = assistantFileName(assistant);
    const shared = await shareTextFile(json, name, assistant.name);
    if (shared === "unsupported") {
      const saved = await saveTextFile(json, name);
      if (saved !== "cancelled") toast({ title: t.assistants.exported(name), variant: "success" });
    }
  };

  const importAssistant = async () => {
    try {
      const opened = await openTextFile();
      if (!opened) return;
      const parsed = await readImport(opened.text);
      if (parsed.source !== "assistant") {
        toast({ title: t.assistants.isBackupFile, action: { label: t.data.title, onClick: () => router.push("/settings/data") } });
        return;
      }
      const plan = await planImport.mutateAsync({ snapshot: parsed.snapshot, migratedFrom: parsed.migratedFrom, mode: "merge", strategy: "duplicate", applySettings: false });
      await applyImport.mutateAsync(plan);
      toast({ title: t.assistants.importedOne(parsed.snapshot.assistants[0]?.name ?? ""), variant: "success" });
    } catch (error) {
      toast({ title: transferErrorMessage(error, t), variant: "destructive" });
    }
  };

  const startChat = (assistant: Assistant) =>
    createConversation.mutate(
      {
        titleSource: "default",
        assistantId: assistant.id,
        providerId: assistant.defaultProviderId,
        modelId: assistant.defaultProviderId ? assistant.defaultModelId : null,
      },
      { onSuccess: (conversation) => router.push(chatHref(conversation.id)), onError: reportError },
    );

  let content: React.ReactNode;
  if (assistants.isPending || tags.isPending) content = <LoadingState label={t.common.loading} rows={3} />;
  else if (assistants.isError)
    content = <ErrorState title={t.assistants.loadError} description={getErrorMessage(assistants.error, t)} retryLabel={t.common.retry} onRetry={() => void assistants.refetch()} />;
  else if (assistants.data.length === 0)
    content = (
      <EmptyState
        icon={Bot}
        title={t.assistants.emptyTitle}
        description={t.assistants.emptyDescription}
        action={
          <>
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" />
              {t.assistants.new}
            </Button>
            <Button variant="outline" onClick={() => void importAssistant()}>
              <FileUp aria-hidden="true" />
              {t.assistants.import}
            </Button>
          </>
        }
      />
    );
  else if (visible.length === 0)
    content = (
      <EmptyState
        icon={SearchX}
        title={t.assistants.noResults}
        description={t.assistants.noResultsDescription}
        action={
          <Button
            variant="tonal"
            onClick={() => {
              setQuery("");
              setFilter({ query: "", tagIds: [] });
            }}
          >
            {t.assistants.clearFilters}
          </Button>
        }
      />
    );
  else
    content = (
      <ul aria-label={t.assistants.listLabel} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="assistant-list">
        {visible.map((assistant) => (
          <li key={assistant.id}>
            <Card className="flex h-full flex-col" data-testid="assistant-card">
              <CardHeader className="flex-row items-start gap-3">
                <AssistantAvatar avatar={assistant.avatar} />
                <div className="min-w-0 flex-1 space-y-1">
                  <CardTitle className="truncate" dir="auto">
                    {assistant.name}
                  </CardTitle>
                  <div className="flex flex-wrap gap-1">
                    {assistant.isDefault ? (
                      <Badge variant="default">
                        <Star className="size-3" aria-hidden="true" />
                        {t.assistants.default}
                      </Badge>
                    ) : null}
                    {assistant.tagIds.map((id) => {
                      const tag = tagById.get(id);
                      return tag ? <TagChip key={id} tag={tag} /> : null;
                    })}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                <p className="line-clamp-3 text-sm text-muted-foreground" dir="auto">
                  {assistant.description || assistant.systemPrompt}
                </p>
              </CardContent>
              <CardFooter role="group" aria-label={t.assistants.actionsFor(assistant.name)} className="flex-wrap gap-1">
                <Button variant="tonal" size="sm" onClick={() => startChat(assistant)}>
                  <MessageSquarePlus aria-hidden="true" />
                  {t.assistants.startChat}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t.common.edit}
                  onClick={() => {
                    setEditing(assistant);
                    setFormOpen(true);
                  }}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t.common.duplicate}
                  onClick={() =>
                    duplicateAssistant.mutate(
                      { id: assistant.id, name: `${assistant.name}${t.assistants.copySuffix}` },
                      { onSuccess: () => toast({ title: t.assistants.duplicated, variant: "success" }), onError: reportError },
                    )
                  }
                >
                  <Copy aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={t.assistants.share} onClick={() => void share(assistant)}>
                  <Share2 aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={t.common.delete} onClick={() => setDeleteTarget(assistant)}>
                  <Trash2 aria-hidden="true" />
                </Button>
                {!assistant.isDefault ? (
                  <Button variant="ghost" size="sm" className="ms-auto" onClick={() => setDefault.mutate(assistant.id, { onError: reportError })}>
                    {t.assistants.setDefault}
                  </Button>
                ) : null}
              </CardFooter>
            </Card>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <PageHeader
        title={t.assistants.title}
        description={t.assistants.description}
        actions={
          <>
            <Button variant="outline" onClick={() => setTagsOpen(true)}>
              <Tags aria-hidden="true" />
              {t.tags.manage}
            </Button>
            <Button variant="outline" onClick={() => void importAssistant()}>
              <FileUp aria-hidden="true" />
              {t.assistants.import}
            </Button>
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" />
              {t.assistants.new}
            </Button>
          </>
        }
      />

      {(assistants.data?.length ?? 0) > 0 ? (
        <div className="grid gap-3" role="search">
          <div className="relative">
            <label htmlFor="assistant-search" className="sr-only">
              {t.assistants.searchLabel}
            </label>
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="assistant-search"
              type="search"
              dir="auto"
              value={query}
              placeholder={t.assistants.searchPlaceholder}
              className="ps-9"
              onChange={(e) => {
                setQuery(e.target.value);
                setFilter({ ...filter, query: e.target.value });
              }}
            />
          </div>
          {(tags.data ?? []).length ? (
            <div role="group" aria-label={t.assistants.filterByTags} className="flex flex-wrap items-center gap-2">
              {(tags.data ?? []).map((tag) => (
                <TagToggle key={tag.id} tag={tag} pressed={filter.tagIds.includes(tag.id)} removable onToggle={() => setFilter({ ...toggleTag(filter, tag.id), query })} />
              ))}
              {filtering ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setQuery("");
                    setFilter({ query: "", tagIds: [] });
                  }}
                >
                  <X aria-hidden="true" />
                  {t.assistants.clearFilters}
                </Button>
              ) : null}
            </div>
          ) : null}
          {filtering ? (
            <p className="text-xs text-muted-foreground" role="status">
              {t.assistants.resultCount(visible.length, assistants.data?.length ?? 0)}
            </p>
          ) : null}
        </div>
      ) : null}

      {content}
      <AssistantFormDialog open={formOpen} onOpenChange={setFormOpen} assistant={editing} />
      <TagManagerDialog open={tagsOpen} onOpenChange={setTagsOpen} />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.assistants.deleteTitle}
        description={t.assistants.deleteDescription}
        confirmLabel={t.common.delete}
        pending={deleteAssistant.isPending}
        onConfirm={() =>
          deleteTarget &&
          deleteAssistant.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast({ title: t.assistants.deleted });
              setDeleteTarget(null);
            },
            onError: reportError,
          })
        }
      />
    </div>
  );
}
