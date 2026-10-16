"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { useAssistants } from "@/features/assistants/queries";
import { useI18n } from "@/hooks/use-i18n";
import { estimateTokens } from "@/lib/context/tokens";
import { getErrorMessage } from "@/lib/i18n/error-message";
import { MAX_MEMORY_TEXT, type MemoryChunk } from "@/lib/models";
import { useAddMemory, useUpdateMemory } from "./queries";

type EditableScope = "global" | "assistant";

/** Add a manual memory, or edit any memory's text / visibility. */
export function MemoryEditorDialog({ open, onOpenChange, chunk }: { open: boolean; onOpenChange: (open: boolean) => void; chunk?: MemoryChunk | null }) {
  const { t } = useI18n();
  const ids = { text: useId(), assistant: useId() };
  const assistants = useAssistants();
  const add = useAddMemory();
  const update = useUpdateMemory();
  const [text, setText] = useState("");
  const [scope, setScope] = useState<EditableScope>("global");
  const [assistantId, setAssistantId] = useState<string | null>(null);
  const conversationScoped = chunk?.scope === "conversation";

  useEffect(() => {
    if (!open) return;
    setText(chunk?.text ?? "");
    setScope(chunk?.scope === "assistant" ? "assistant" : "global");
    setAssistantId(chunk?.assistantId ?? assistants.data?.[0]?.id ?? null);
  }, [open, chunk, assistants.data]);

  const pending = add.isPending || update.isPending;
  const invalid = !text.trim() || (scope === "assistant" && !assistantId && !conversationScoped);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (invalid || pending) return;
    const done = { onSuccess: () => onOpenChange(false), onError: (e: unknown) => toast({ title: getErrorMessage(e, t), variant: "destructive" }) };
    if (chunk) {
      update.mutate({ id: chunk.id, patch: conversationScoped ? { text } : { text, scope, assistantId: scope === "assistant" ? assistantId : null } }, done);
    } else {
      add.mutate({ text, scope, assistantId: scope === "assistant" ? assistantId : null }, done);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{chunk ? t.memory.editTitle : t.memory.addTitle}</DialogTitle>
            <DialogDescription>{t.memory.addDescription}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={ids.text}>{t.memory.text}</Label>
            <Textarea id={ids.text} dir="auto" rows={6} value={text} maxLength={MAX_MEMORY_TEXT} onChange={(e) => setText(e.target.value)} placeholder={t.memory.textPlaceholder} />
            <p className="text-xs text-muted-foreground">{t.memory.tokens(estimateTokens(text))}</p>
          </div>
          {conversationScoped ? (
            <p className="text-xs text-muted-foreground">{t.memory.conversationScopeLocked}</p>
          ) : (
            <div className="grid gap-2">
              <span className="text-sm font-medium">{t.memory.visibility}</span>
              <SegmentedControl
                label={t.memory.visibility}
                value={scope}
                onValueChange={(v) => setScope(v)}
                options={[
                  { value: "global", label: t.memory.scopes.global },
                  { value: "assistant", label: t.memory.scopes.assistant },
                ]}
              />
              {scope === "assistant" ? (
                <>
                  <Label htmlFor={ids.assistant} className="sr-only">
                    {t.memory.assistant}
                  </Label>
                  <select id={ids.assistant} value={assistantId ?? ""} onChange={(e) => setAssistantId(e.target.value || null)} className="h-10 rounded-xl border bg-background px-3 text-sm">
                    <option value="">{t.memory.chooseAssistant}</option>
                    {(assistants.data ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.avatar.startsWith("data:") ? "" : `${a.avatar} `}
                        {a.name}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={invalid || pending}>
              {t.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
