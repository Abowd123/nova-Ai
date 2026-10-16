"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { useAssistants } from "@/features/assistants/queries";
import { useI18n } from "@/hooks/use-i18n";
import { estimateTokens } from "@/lib/context/tokens";
import { getErrorMessage } from "@/lib/i18n/error-message";
import { DEFAULT_LOREBOOK, lorebookCreateSchema, type LoreEntry, type Lorebook } from "@/lib/models";
import { useSaveLorebook } from "./queries";

interface EntryDraft extends Omit<LoreEntry, "keywords"> {
  /** Comma/Arabic-comma/newline separated while editing. */
  keywords: string;
}

const newEntryId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

export function splitKeywords(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(/[,،\n]/)) {
    const keyword = raw.trim();
    if (!keyword || seen.has(keyword.toLowerCase())) continue;
    seen.add(keyword.toLowerCase());
    out.push(keyword.slice(0, 100));
  }
  return out.slice(0, 50);
}

function toDraft(entry: LoreEntry): EntryDraft {
  return { ...entry, keywords: entry.keywords.join("، ") };
}

function blankEntry(priority: number): EntryDraft {
  return { id: newEntryId(), keywords: "", content: "", priority, enabled: true, caseSensitive: false };
}

/** Create or edit a lorebook and its keyword-triggered entries. */
export function LorebookEditorDialog({ open, onOpenChange, book }: { open: boolean; onOpenChange: (open: boolean) => void; book?: Lorebook | null }) {
  const { t } = useI18n();
  const id = useId();
  const assistants = useAssistants();
  const save = useSaveLorebook();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [assistantId, setAssistantId] = useState<string | null>(null);
  const [tokenBudget, setTokenBudget] = useState(DEFAULT_LOREBOOK.tokenBudget);
  const [scanDepth, setScanDepth] = useState(DEFAULT_LOREBOOK.scanDepth);
  const [entries, setEntries] = useState<EntryDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(book?.name ?? "");
    setDescription(book?.description ?? "");
    setEnabled(book?.enabled ?? true);
    setAssistantId(book?.assistantId ?? null);
    setTokenBudget(book?.tokenBudget ?? DEFAULT_LOREBOOK.tokenBudget);
    setScanDepth(book?.scanDepth ?? DEFAULT_LOREBOOK.scanDepth);
    setEntries(book ? book.entries.map(toDraft) : [blankEntry(0)]);
    setError(null);
  }, [open, book]);

  const patchEntry = (index: number, patch: Partial<EntryDraft>) => setEntries((list) => list.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  const move = (index: number, delta: number) =>
    setEntries((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // Empty rows are ignored; half-filled rows are an error the user must fix.
    const filled = entries.filter((e) => e.content.trim() || e.keywords.trim());
    const incomplete = filled.findIndex((e) => !e.content.trim() || splitKeywords(e.keywords).length === 0);
    if (incomplete >= 0) {
      setError(t.lorebooks.entryIncomplete(incomplete + 1));
      return;
    }
    const input = {
      name: name.trim(),
      description: description.trim(),
      enabled,
      assistantId,
      conversationId: book?.conversationId ?? null,
      tokenBudget,
      scanDepth,
      entries: filled.map((e) => ({ id: e.id, keywords: splitKeywords(e.keywords), content: e.content.trim(), priority: Math.round(e.priority), enabled: e.enabled, caseSensitive: e.caseSensitive })),
    };
    const parsed = lorebookCreateSchema.safeParse(input);
    if (!parsed.success) {
      setError(t.lorebooks.invalid);
      return;
    }
    save.mutate(
      { id: book?.id, input: parsed.data },
      {
        onSuccess: () => {
          toast({ title: t.lorebooks.saved, variant: "success" });
          onOpenChange(false);
        },
        onError: (e) => setError(getErrorMessage(e, t)),
      },
    );
  };

  const field = (suffix: string) => `${id}-${suffix}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{book ? t.lorebooks.editTitle : t.lorebooks.createTitle}</DialogTitle>
            <DialogDescription>{t.lorebooks.editorDescription}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={field("name")}>{t.lorebooks.name}</Label>
              <Input id={field("name")} dir="auto" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={field("assistant")}>{t.lorebooks.assistant}</Label>
              <select id={field("assistant")} value={assistantId ?? ""} onChange={(e) => setAssistantId(e.target.value || null)} className="h-10 rounded-xl border bg-background px-3 text-sm">
                <option value="">{t.lorebooks.allAssistants}</option>
                {(assistants.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={field("desc")}>{t.lorebooks.descriptionLabel}</Label>
            <Input id={field("desc")} dir="auto" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor={field("budget")}>{t.lorebooks.tokenBudget}</Label>
              <Input id={field("budget")} type="number" dir="ltr" min={50} max={32_000} value={tokenBudget} onChange={(e) => setTokenBudget(Math.min(32_000, Math.max(50, Number(e.target.value) || 50)))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={field("depth")}>{t.lorebooks.scanDepth}</Label>
              <Input id={field("depth")} type="number" dir="ltr" min={1} max={50} value={scanDepth} onChange={(e) => setScanDepth(Math.min(50, Math.max(1, Number(e.target.value) || 1)))} />
            </div>
            <div className="flex items-end justify-between gap-2 pb-2">
              <Label htmlFor={field("enabled")}>{t.lorebooks.enabled}</Label>
              <Switch id={field("enabled")} checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t.lorebooks.scanHint}</p>

          <fieldset className="grid gap-3">
            <legend className="mb-2 text-sm font-medium">{t.lorebooks.entries(entries.length)}</legend>
            {entries.map((entry, index) => (
              <div key={entry.id} className="grid gap-3 rounded-2xl border p-3" data-testid="lore-entry">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{t.lorebooks.entryN(index + 1)}</span>
                  <div className="flex items-center gap-1">
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={t.lorebooks.moveUp} disabled={index === 0} onClick={() => move(index, -1)}>
                      <ChevronUp className="size-4" aria-hidden="true" />
                    </Button>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={t.lorebooks.moveDown} disabled={index === entries.length - 1} onClick={() => move(index, 1)}>
                      <ChevronDown className="size-4" aria-hidden="true" />
                    </Button>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={t.lorebooks.removeEntry(index + 1)} onClick={() => setEntries((list) => list.filter((_, i) => i !== index))}>
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={field(`kw-${entry.id}`)}>{t.lorebooks.keywords}</Label>
                  <Input id={field(`kw-${entry.id}`)} dir="auto" value={entry.keywords} placeholder={t.lorebooks.keywordsPlaceholder} onChange={(e) => patchEntry(index, { keywords: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={field(`ct-${entry.id}`)}>{t.lorebooks.content}</Label>
                  <Textarea id={field(`ct-${entry.id}`)} dir="auto" rows={3} maxLength={20_000} value={entry.content} onChange={(e) => patchEntry(index, { content: e.target.value })} />
                  <p className="text-xs text-muted-foreground">{t.memory.tokens(estimateTokens(entry.content))}</p>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={field(`pr-${entry.id}`)}>{t.lorebooks.priority}</Label>
                    <Input id={field(`pr-${entry.id}`)} type="number" dir="ltr" className="w-24" min={-1000} max={1000} value={entry.priority} onChange={(e) => patchEntry(index, { priority: Math.min(1000, Math.max(-1000, Number(e.target.value) || 0)) })} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id={field(`en-${entry.id}`)} checked={entry.enabled} onCheckedChange={(v) => patchEntry(index, { enabled: v })} />
                    <Label htmlFor={field(`en-${entry.id}`)}>{t.lorebooks.entryEnabled}</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id={field(`cs-${entry.id}`)} checked={entry.caseSensitive} onCheckedChange={(v) => patchEntry(index, { caseSensitive: v })} />
                    <Label htmlFor={field(`cs-${entry.id}`)}>{t.lorebooks.caseSensitive}</Label>
                  </div>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" className="w-fit" onClick={() => setEntries((list) => [...list, blankEntry(0)])} disabled={entries.length >= 500}>
              <Plus className="size-4" aria-hidden="true" />
              {t.lorebooks.addEntry}
            </Button>
          </fieldset>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={!name.trim() || save.isPending}>
              {t.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
