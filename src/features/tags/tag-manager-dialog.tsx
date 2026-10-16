"use client";

import { useId, useState, type DragEvent, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Check, GripVertical, Pencil, Plus, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { getErrorMessage } from "@/lib/i18n/error-message";
import type { Tag } from "@/lib/models";
import { cn } from "@/lib/utils";
import { TAG_COLORS, nextTagColor } from "./colors";
import { moveItem, useCreateTag, useDeleteTag, useReorderTags, useTags, useUpdateTag } from "./queries";
import { TagChip } from "./tag-chip";

function ColorPicker({ value, onChange, label }: { value: string; onChange: (color: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {TAG_COLORS.map((color) => {
        const checked = color.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={color}
            onClick={() => onChange(color)}
            className={cn(
              "flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              checked && "ring-2 ring-foreground",
            )}
            style={{ backgroundColor: color }}
          >
            {checked ? <Check className="size-4 text-white" aria-hidden="true" /> : null}
          </button>
        );
      })}
      <label className="relative flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border">
        <span className="sr-only">{label}</span>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="absolute inset-0 size-full cursor-pointer opacity-0" />
        <Plus className="size-4" aria-hidden="true" />
      </label>
    </div>
  );
}

function TagRow({
  tag,
  index,
  total,
  onMove,
  onDelete,
  dragHandlers,
}: {
  tag: Tag;
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
  onDelete: (tag: Tag) => void;
  dragHandlers: { onDragStart: (e: DragEvent) => void; onDragOver: (e: DragEvent) => void; onDrop: (e: DragEvent) => void };
}) {
  const { t } = useI18n();
  const update = useUpdateTag();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    update.mutate(
      { id: tag.id, patch: { name: name.trim(), color } },
      { onSuccess: () => setEditing(false), onError: (e) => toast({ title: getErrorMessage(e, t), variant: "destructive" }) },
    );
  };

  if (editing) {
    return (
      <li className="rounded-2xl border p-3">
        <form onSubmit={save} className="grid gap-3">
          <Input aria-label={t.tags.name} value={name} maxLength={50} dir="auto" autoFocus onChange={(e) => setName(e.target.value)} />
          <ColorPicker value={color} onChange={setColor} label={t.tags.color} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              <X aria-hidden="true" />
              {t.common.cancel}
            </Button>
            <Button type="submit" size="sm" disabled={!name.trim() || update.isPending}>
              {t.common.save}
            </Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li draggable className="flex items-center gap-2 rounded-2xl border px-2 py-1.5" data-testid="tag-row" {...dragHandlers}>
      <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden="true" />
      <TagChip tag={tag} className="min-w-0" />
      <div className="ms-auto flex shrink-0 gap-0.5" role="group" aria-label={t.tags.actionsFor(tag.name)}>
        <Button variant="ghost" size="icon-sm" aria-label={t.tags.moveUp} disabled={index === 0} onClick={() => onMove(index, index - 1)}>
          <ArrowUp aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={t.tags.moveDown} disabled={index === total - 1} onClick={() => onMove(index, index + 1)}>
          <ArrowDown aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={t.common.edit} onClick={() => setEditing(true)}>
          <Pencil aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={t.common.delete} onClick={() => onDelete(tag)}>
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

export function TagManagerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  const nameId = useId();
  const tags = useTags();
  const create = useCreateTag();
  const remove = useDeleteTag();
  const reorder = useReorderTags();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(TAG_COLORS[0]);
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const report = (e: unknown) => toast({ title: getErrorMessage(e, t), variant: "destructive" });

  const list = tags.data ?? [];
  const move = (from: number, to: number) => reorder.mutate(moveItem(list, from, to).map((tag) => tag.id), { onError: report });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), color },
      {
        onSuccess: () => {
          setName("");
          setColor(nextTagColor([...list.map((tag) => tag.color), color]));
        },
        onError: report,
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t.common.close} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.tags.manage}</DialogTitle>
          <DialogDescription>{t.tags.manageDescription}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-3 rounded-2xl bg-surface-container p-3">
          <label htmlFor={nameId} className="text-sm font-medium">
            {t.tags.newTag}
          </label>
          <div className="flex gap-2">
            <Input id={nameId} value={name} maxLength={50} dir="auto" placeholder={t.tags.namePlaceholder} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              <Plus aria-hidden="true" />
              {t.common.create}
            </Button>
          </div>
          <ColorPicker value={color} onChange={setColor} label={t.tags.color} />
        </form>

        {tags.isPending ? (
          <LoadingState label={t.common.loading} rows={2} />
        ) : tags.isError ? (
          <ErrorState title={t.tags.loadError} description={getErrorMessage(tags.error, t)} retryLabel={t.common.retry} onRetry={() => void tags.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState compact title={t.tags.emptyTitle} description={t.tags.emptyDescription} />
        ) : (
          <ul className="grid max-h-80 gap-2 overflow-y-auto" aria-label={t.tags.listLabel}>
            {list.map((tag, index) => (
              <TagRow
                key={tag.id}
                tag={tag}
                index={index}
                total={list.length}
                onMove={move}
                onDelete={setDeleteTarget}
                dragHandlers={{
                  onDragStart: (e) => {
                    setDragIndex(index);
                    e.dataTransfer.effectAllowed = "move";
                  },
                  onDragOver: (e) => e.preventDefault(),
                  onDrop: (e) => {
                    e.preventDefault();
                    if (dragIndex !== null && dragIndex !== index) move(dragIndex, index);
                    setDragIndex(null);
                  },
                }}
              />
            ))}
          </ul>
        )}

        <ConfirmDialog
          open={deleteTarget !== null}
          onOpenChange={(value) => !value && setDeleteTarget(null)}
          title={t.tags.deleteTitle}
          description={t.tags.deleteDescription}
          confirmLabel={t.common.delete}
          pending={remove.isPending}
          onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null), onError: report })}
        />
      </DialogContent>
    </Dialog>
  );
}
