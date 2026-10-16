"use client";

import { useEffect, useId, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Camera, Maximize2, Minimize2, Paperclip, SendHorizontal, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AttachmentTray } from "@/features/attachments/attachment-tray";
import type { DraftsController } from "@/features/attachments/use-drafts";
import { DictationPanel, MicButton } from "@/features/speech/dictation-panel";
import { useDictation } from "@/features/speech/use-dictation";
import { useI18n } from "@/hooks/use-i18n";
import { ACCEPT_ATTRIBUTE } from "@/lib/media/limits";
import { checkAttachment, type MediaTarget, type VideoModeSetting } from "@/lib/media/support";
import { MAX_MESSAGE_LENGTH } from "@/lib/models";
import { cn } from "@/lib/utils";

const MAX_HEIGHT = 240;

export interface ComposerSendInput {
  content: string;
  inputMode: "text" | "voice";
}

interface ComposerProps {
  /** Resolve true to clear the draft, false to keep it (e.g. no model configured). */
  onSend: (input: ComposerSendInput) => Promise<boolean>;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  sendShortcut?: "ctrl-enter" | "enter";
  drafts?: DraftsController;
  mediaTarget?: MediaTarget | null;
  videoMode?: VideoModeSetting;
  /** Reports the draft (debounce on the caller side) — used for the context-size warning. */
  onDraftChange?: (text: string) => void;
  /** Extra status line under the composer (e.g. "this message may not fit"). */
  notice?: ReactNode;
}

export function Composer({ onSend, onStop, streaming, disabled = false, sendShortcut = "ctrl-enter", drafts, mediaTarget = null, videoMode = "auto", onDraftChange, notice }: ComposerProps) {
  const { t } = useI18n();
  const inputId = useId();
  const hintId = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  useEffect(() => {
    onDraftChange?.(value);
  }, [value, onDraftChange]);
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState(false);
  // Text typed before dictation started; live transcripts are appended to it.
  const baseText = useRef("");
  const voiceUsed = useRef(false);

  const dictation = useDictation({
    onText: (text, final) => {
      voiceUsed.current = true;
      const prefix = baseText.current ? `${baseText.current.trimEnd()} ` : "";
      setValue(prefix + text);
      if (final) baseText.current = prefix + text;
    },
    onSend: (text) => {
      const prefix = baseText.current ? `${baseText.current.trimEnd()} ` : "";
      void submit(prefix + text, "voice");
    },
  });

  useEffect(() => {
    if (dictation.status === "listening" || dictation.status === "recording") baseText.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- capture text only when dictation starts
  }, [dictation.status]);

  useEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
  }, [value, expanded]);

  useEffect(() => {
    if (!expanded) return;
    ref.current?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const ready = drafts?.ready ?? [];
  const blocked = Boolean(
    drafts?.drafts.some((d) => d.status === "error") ||
      ready.some((a) => !mediaTarget || !checkAttachment(a, mediaTarget, drafts?.videoModes[a.id] ?? videoMode).ok),
  );
  const hasContent = Boolean(value.trim()) || ready.length > 0;
  const canSend = hasContent && !streaming && !disabled && !sending && !drafts?.busy && !blocked;

  async function submit(text = value, mode: "text" | "voice" = voiceUsed.current ? "voice" : "text") {
    const content = text.trim();
    if ((!content && ready.length === 0) || streaming || disabled || sending || drafts?.busy || blocked) return;
    setSending(true);
    try {
      if (await onSend({ content, inputMode: mode })) {
        setValue("");
        baseText.current = "";
        voiceUsed.current = false;
        setExpanded(false);
        drafts?.consume();
      } else if (text !== value) {
        setValue(text);
      }
    } finally {
      setSending(false);
      ref.current?.focus();
    }
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return; // IME (Arabic/Asian keyboards)
    const modifier = event.ctrlKey || event.metaKey;
    if (event.key === "Enter" && (modifier || (sendShortcut === "enter" && !event.shiftKey))) {
      event.preventDefault();
      void submit();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!drafts) return;
    const files = Array.from(event.clipboardData.files);
    if (files.length) {
      event.preventDefault();
      drafts.add(files);
    }
  };

  const blockedReason = blocked ? t.attachments.blocked : null;

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "border-t bg-background/80 p-3 backdrop-blur",
        expanded ? "fixed inset-0 z-50 flex flex-col bg-background p-4 md:p-8" : "safe-bottom",
      )}
    >
      <DictationPanel dictation={dictation} />
      <div
        className={cn(
          "mx-auto flex w-full max-w-3xl flex-col rounded-3xl border bg-surface-container px-3 py-2 focus-within:ring-2 focus-within:ring-ring",
          expanded && "min-h-0 flex-1",
        )}
      >
        {drafts ? <AttachmentTray controller={drafts} target={mediaTarget} videoMode={videoMode} /> : null}
        <div className={cn("flex gap-2", expanded ? "min-h-0 flex-1 flex-col" : "items-end")}>
          <label htmlFor={inputId} className="sr-only">
            {t.chat.composerLabel}
          </label>
          <textarea
            id={inputId}
            ref={ref}
            value={value}
            rows={1}
            dir="auto"
            maxLength={MAX_MESSAGE_LENGTH}
            aria-describedby={hintId}
            placeholder={t.chat.composerPlaceholder}
            onChange={(event) => {
              setValue(event.target.value);
              if (!event.target.value) voiceUsed.current = false;
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            className={cn(
              "flex-1 resize-none bg-transparent px-1 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:outline-none",
              expanded ? "h-full min-h-0" : "max-h-60 min-h-10",
            )}
            style={expanded ? { height: "100%" } : undefined}
          />
          <div className={cn("flex items-center gap-1", expanded && "justify-end")}>
            {drafts ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept={ACCEPT_ATTRIBUTE}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  data-testid="attach-input"
                  onChange={(event) => {
                    if (event.target.files?.length) drafts.add(event.target.files);
                    event.target.value = "";
                  }}
                />
                {/* Mobile: opens the camera directly. */}
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*,video/*"
                  capture="environment"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => {
                    if (event.target.files?.length) drafts.add(event.target.files);
                    event.target.value = "";
                  }}
                />
                <Button type="button" variant="ghost" size="icon" aria-label={t.attachments.attach} onClick={() => fileRef.current?.click()} disabled={disabled}>
                  <Paperclip aria-hidden="true" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="[@media(pointer:fine)]:hidden" aria-label={t.attachments.camera} onClick={() => cameraRef.current?.click()} disabled={disabled}>
                  <Camera aria-hidden="true" />
                </Button>
              </>
            ) : null}
            <MicButton dictation={dictation} disabled={disabled || streaming} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={expanded ? t.chat.collapseComposer : t.chat.expandComposer}
              aria-pressed={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            </Button>
            {streaming ? (
              <Button type="button" size="icon" variant="destructive" aria-label={t.chat.stop} onClick={onStop} data-testid="stop-button">
                <Square className="fill-current" aria-hidden="true" />
              </Button>
            ) : (
              <Button type="submit" size="icon" disabled={!canSend} aria-label={t.chat.send} data-testid="send-button" aria-describedby={blockedReason ? `${hintId}-blocked` : undefined}>
                <SendHorizontal className="rtl:-scale-x-100" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </div>
      {blockedReason ? (
        <p id={`${hintId}-blocked`} className="mx-auto mt-1 w-full max-w-3xl px-3 text-xs text-destructive" role="status" data-testid="send-blocked">
          {blockedReason}
        </p>
      ) : null}
      {notice ? <div className="mx-auto mt-1 w-full max-w-3xl px-3 text-xs">{notice}</div> : null}
      <p id={hintId} className="mx-auto mt-1 w-full max-w-3xl px-3 text-xs text-muted-foreground">
        {sendShortcut === "enter" ? t.chat.composerHintEnter : t.chat.composerHint}
      </p>
    </form>
  );
}
