"use client";

import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MessagesSquare, Plus, Search, SearchX } from "lucide-react";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { getErrorMessage } from "@/lib/i18n/error-message";
import type { Conversation } from "@/lib/models";
import { ConversationItem } from "./conversation-item";
import {
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  useSeedDemoData,
  useUpdateConversation,
} from "./queries";
import { RenameDialog } from "./rename-dialog";
import { chatHref, chatIdFrom } from "@/lib/routes";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function ConversationSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const currentChatId = chatIdFrom(pathname, search.toString());
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());

  const conversations = useConversations(deferredQuery);
  const createConversation = useCreateConversation();
  const updateConversation = useUpdateConversation();
  const deleteConversation = useDeleteConversation();
  const seed = useSeedDemoData();

  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "/" && !isEditableTarget(event.target) && searchRef.current?.offsetParent) {
        event.preventDefault();
        searchRef.current.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const reportError = useCallback(
    (error: unknown) => toast({ title: getErrorMessage(error, t), variant: "destructive" }),
    [t],
  );

  const handleNew = () => {
    createConversation.mutate(
      { title: t.conversations.defaultTitle },
      {
        onSuccess: (conversation) => {
          router.push(chatHref(conversation.id));
          onNavigate?.();
        },
        onError: reportError,
      },
    );
  };

  const handleTogglePin = useCallback(
    (conversation: Conversation) =>
      updateConversation.mutate(
        { id: conversation.id, patch: { pinned: !conversation.pinned } },
        { onError: reportError },
      ),
    [updateConversation, reportError],
  );

  const handleRename = (title: string) => {
    if (!renameTarget) return;
    updateConversation.mutate(
      { id: renameTarget.id, patch: { title, titleSource: "manual" } },
      {
        onSuccess: () => {
          toast({ title: t.conversations.renamed, variant: "success" });
          setRenameTarget(null);
        },
        onError: reportError,
      },
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    deleteConversation.mutate(target.id, {
      onSuccess: () => {
        toast({ title: t.conversations.deleted });
        setDeleteTarget(null);
        if (currentChatId === target.id) router.push("/chat");
      },
      onError: reportError,
    });
  };

  const groups = useMemo(() => {
    const items = conversations.data ?? [];
    return {
      pinned: items.filter((c) => c.pinned),
      recent: items.filter((c) => !c.pinned),
    };
  }, [conversations.data]);

  const renderList = (title: string, items: Conversation[]) =>
    items.length > 0 ? (
      <section className="mb-3" aria-label={title}>
        <h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        <ul className="flex flex-col gap-0.5">
          {items.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              active={currentChatId === conversation.id}
              onNavigate={onNavigate}
              onTogglePin={handleTogglePin}
              onRename={setRenameTarget}
              onDelete={setDeleteTarget}
            />
          ))}
        </ul>
      </section>
    ) : null;

  let content: React.ReactNode;
  if (conversations.isPending) {
    content = <LoadingState label={t.common.loading} rows={4} />;
  } else if (conversations.isError) {
    content = (
      <ErrorState
        title={t.conversations.loadError}
        description={getErrorMessage(conversations.error, t)}
        retryLabel={t.common.retry}
        onRetry={() => void conversations.refetch()}
        className="m-2"
      />
    );
  } else if (conversations.data.length === 0 && deferredQuery) {
    content = (
      <EmptyState
        compact
        icon={SearchX}
        title={t.conversations.noResultsTitle}
        description={t.conversations.noResultsDescription}
        className="m-2"
      />
    );
  } else if (conversations.data.length === 0) {
    content = (
      <EmptyState
        compact
        icon={MessagesSquare}
        title={t.conversations.emptyTitle}
        description={t.conversations.emptyDescription}
        className="m-2"
        action={
          <Button
            variant="tonal"
            size="sm"
            disabled={seed.isPending}
            onClick={() =>
              seed.mutate(locale, {
                onSuccess: () => toast({ title: t.conversations.seeded, variant: "success" }),
                onError: reportError,
              })
            }
          >
            {t.conversations.seedDemo}
          </Button>
        }
      />
    );
  } else {
    content = (
      <>
        {renderList(t.conversations.pinned, groups.pinned)}
        {renderList(t.conversations.recent, groups.recent)}
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-4 pb-2 pe-14 lg:pe-4">
        <Button className="w-full" onClick={handleNew} disabled={createConversation.isPending}>
          <Plus aria-hidden="true" />
          {t.conversations.newConversation}
        </Button>
      </div>
      <div className="px-4 py-2">
        <label htmlFor={searchId} className="sr-only">
          {t.conversations.searchLabel}
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id={searchId}
            ref={searchRef}
            type="search"
            value={query}
            dir="auto"
            placeholder={t.conversations.searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
            className="ps-9"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" aria-busy={conversations.isFetching}>
        {content}
      </div>

      <RenameDialog
        open={renameTarget !== null}
        initialTitle={renameTarget?.title ?? ""}
        onOpenChange={(open) => !open && setRenameTarget(null)}
        onSubmit={handleRename}
        pending={updateConversation.isPending}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.conversations.deleteTitle}
        description={t.conversations.deleteDescription}
        confirmLabel={t.common.delete}
        onConfirm={handleDelete}
        pending={deleteConversation.isPending}
      />
    </div>
  );
}
