"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/hooks/use-i18n";

interface RenameDialogProps {
  open: boolean;
  initialTitle: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (title: string) => void;
  pending?: boolean;
}

export function RenameDialog({ open, initialTitle, onOpenChange, onSubmit, pending }: RenameDialogProps) {
  const { t } = useI18n();
  const id = useId();
  const [title, setTitle] = useState(initialTitle);

  useEffect(() => {
    if (open) setTitle(initialTitle);
  }, [open, initialTitle]);

  const trimmed = title.trim();
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed) onSubmit(trimmed.slice(0, 200));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t.common.close}>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t.conversations.renameTitle}</DialogTitle>
            <DialogDescription className="sr-only">{t.conversations.renameTitle}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={id}>{t.conversations.titleLabel}</Label>
            <Input
              id={id}
              value={title}
              maxLength={200}
              dir="auto"
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={!trimmed || pending}>
              {t.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
