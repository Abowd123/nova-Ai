"use client";

import { useState } from "react";
import { BookOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import { useAssistants } from "@/features/assistants/queries";
import { useI18n } from "@/hooks/use-i18n";
import { getErrorMessage } from "@/lib/i18n/error-message";
import type { Lorebook } from "@/lib/models";
import { LorebookEditorDialog } from "./lorebook-editor-dialog";
import { useDeleteLorebook, useLorebooks, useSaveLorebook } from "./queries";

export function LorebooksPanel() {
  const { t } = useI18n();
  const books = useLorebooks();
  const assistants = useAssistants();
  const save = useSaveLorebook();
  const remove = useDeleteLorebook();
  const [editing, setEditing] = useState<{ open: boolean; book: Lorebook | null }>({ open: false, book: null });
  const [deleting, setDeleting] = useState<Lorebook | null>(null);
  const report = (e: unknown) => toast({ title: getErrorMessage(e, t), variant: "destructive" });
  const assistantName = (id: string | null) => (id ? (assistants.data?.find((a) => a.id === id)?.name ?? t.lorebooks.unknownAssistant) : null);

  const addButton = (
    <Button onClick={() => setEditing({ open: true, book: null })}>
      <Plus className="size-4" aria-hidden="true" />
      {t.lorebooks.create}
    </Button>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">{t.lorebooks.description}</p>
        {books.data?.length ? addButton : null}
      </div>
      {books.isPending ? (
        <LoadingState label={t.common.loading} rows={3} />
      ) : books.isError ? (
        <ErrorState title={t.lorebooks.loadError} description={getErrorMessage(books.error, t)} retryLabel={t.common.retry} onRetry={() => void books.refetch()} />
      ) : books.data.length === 0 ? (
        <EmptyState icon={BookOpen} title={t.lorebooks.emptyTitle} description={t.lorebooks.emptyDescription} action={addButton} />
      ) : (
        <ul className="grid gap-3" aria-label={t.lorebooks.listLabel}>
          {books.data.map((book) => {
            const active = book.entries.filter((e) => e.enabled).length;
            const owner = assistantName(book.assistantId);
            return (
              <li key={book.id}>
                <Card data-testid="lorebook-card">
                  <CardContent className="flex flex-wrap items-start gap-3 pt-5">
                    <div className="min-w-0 flex-1">
                      <h3 dir="auto" className="truncate font-medium">
                        {book.name}
                      </h3>
                      {book.description ? (
                        <p dir="auto" className="line-clamp-2 text-sm text-muted-foreground">
                          {book.description}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <Badge variant="tonal">{t.lorebooks.entryCount(active, book.entries.length)}</Badge>
                        <Badge variant="outline">{t.lorebooks.budgetBadge(book.tokenBudget)}</Badge>
                        <Badge variant="outline">{owner ? t.lorebooks.onlyFor(owner) : book.conversationId ? t.lorebooks.oneConversation : t.lorebooks.everywhere}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Switch
                        checked={book.enabled}
                        aria-label={t.lorebooks.toggle(book.name)}
                        onCheckedChange={(enabled) => save.mutate({ id: book.id, input: { name: book.name, enabled } }, { onError: report })}
                      />
                      <Button size="icon-sm" variant="ghost" aria-label={t.lorebooks.editNamed(book.name)} onClick={() => setEditing({ open: true, book })}>
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={t.lorebooks.deleteNamed(book.name)} onClick={() => setDeleting(book)}>
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <LorebookEditorDialog open={editing.open} book={editing.book} onOpenChange={(open) => setEditing((s) => ({ ...s, open }))} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t.lorebooks.deleteTitle}
        description={deleting ? t.lorebooks.deleteDescription(deleting.name) : ""}
        confirmLabel={t.common.delete}
        destructive
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, { onSuccess: () => setDeleting(null), onError: report });
        }}
      />
    </div>
  );
}
