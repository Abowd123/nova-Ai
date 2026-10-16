"use client";

import { memo, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CircleStop, TriangleAlert } from "lucide-react";
import { Markdown } from "@/components/markdown/markdown";
import { ReasoningSection } from "@/components/markdown/reasoning-section";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/hooks/use-i18n";
import { reasoningOf, type Message, type ToolResultPart } from "@/lib/models";
import { cn } from "@/lib/utils";
import { useLiveStream } from "./engine/streaming-store";
import { MessageActions } from "./message-actions";
import { MessageAttachments } from "@/features/attachments/message-attachments";
import { Sources, ToolCalls } from "./tool-calls";
import { SpeakButton } from "@/features/speech/tts-bar";
import { MessageContext } from "./message-context";

export interface MessageRowHandlers {
  onDelete: (id: string) => void;
  onEdit: (id: string, text: string) => void;
  onRegenerate: (id: string) => void;
  onContinue: (id: string) => void;
}

interface MessageRowProps extends MessageRowHandlers {
  message: Message;
  isLastAssistant: boolean;
  isLast: boolean;
  busy: boolean;
  modelName?: string;
  /** Assistant voice for read-aloud. */
  voice?: string | null;
  toolResults?: ReadonlyMap<string, ToolResultPart>;
  citations?: { index: number; title: string; url: string }[];
}

const NO_RESULTS: ReadonlyMap<string, ToolResultPart> = new Map();

/** Subscribes to the live stream of ONE message: tokens never re-render the list. */
function LiveAssistantBody({ message }: { message: Message }) {
  const live = useLiveStream(message.id);
  const text = live?.text ?? message.content;
  const reasoning = live?.reasoning ?? reasoningOf(message.parts);
  const { t } = useI18n();
  return (
    <>
      <ReasoningSection text={reasoning} streaming />
      {text ? (
        <Markdown content={text} streaming />
      ) : (
        <span className="inline-flex items-center gap-1 text-muted-foreground" role="status">
          <span className="sr-only">{t.chat.generating}</span>
          <span className="size-2 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" aria-hidden="true" />
          <span className="size-2 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" aria-hidden="true" />
          <span className="size-2 animate-bounce rounded-full bg-current" aria-hidden="true" />
        </span>
      )}
    </>
  );
}

function UserEditor({ initial, onCancel, onSave }: { initial: string; onCancel: () => void; onSave: (text: string) => void }) {
  const { t } = useI18n();
  const id = useId();
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.setSelectionRange(initial.length, initial.length);
  }, [initial.length]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") onCancel();
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && value.trim()) {
      event.preventDefault();
      onSave(value);
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <label htmlFor={id} className="sr-only">
        {t.chat.editMessage}
      </label>
      <Textarea id={id} ref={ref} value={value} dir="auto" rows={4} onChange={(e) => setValue(e.target.value)} onKeyDown={onKeyDown} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t.common.cancel}
        </Button>
        <Button size="sm" disabled={!value.trim() || value.trim() === initial.trim()} onClick={() => onSave(value)}>
          {t.chat.saveAndResend}
        </Button>
      </div>
    </div>
  );
}

function formatUsage(message: Message, locale: string): string | null {
  if (!message.usage) return null;
  const n = new Intl.NumberFormat(locale);
  return `${n.format(message.usage.inputTokens)} ↑ · ${n.format(message.usage.outputTokens)} ↓`;
}

export const MessageRow = memo(function MessageRow({
  message,
  isLastAssistant,
  isLast,
  busy,
  modelName,
  voice,
  toolResults = NO_RESULTS,
  citations,
  onDelete,
  onEdit,
  onRegenerate,
  onContinue,
}: MessageRowProps) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState(false);
  const isUser = message.role === "user";
  const streaming = message.status === "streaming";
  const usage = formatUsage(message, locale);
  const canContinue = !isUser && isLastAssistant && (message.status === "aborted" || message.status === "interrupted") && Boolean(message.content);
  const canRegenerate = !isUser && isLastAssistant;

  return (
    <li
      className={cn("group flex flex-col gap-1", isUser ? "items-end" : "items-start")}
      data-testid={`message-${message.role}`}
      data-status={message.status}
      aria-busy={streaming || undefined}
    >
      <span className="px-2 text-xs text-muted-foreground">
        {isUser ? t.chat.you : (modelName ?? t.chat.assistant)}
      </span>

      {isUser ? <MessageAttachments parts={message.parts} align="end" /> : null}

      {isUser && !message.content && !editing ? null : isUser ? (
        editing ? (
          <div className="w-full max-w-[85%] sm:max-w-[75%]">
            <UserEditor
              initial={message.content}
              onCancel={() => setEditing(false)}
              onSave={(text) => {
                setEditing(false);
                onEdit(message.id, text);
              }}
            />
          </div>
        ) : (
          <div dir="auto" className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl rounded-ee-md bg-primary px-4 py-2.5 text-[0.95rem] leading-relaxed text-primary-foreground [unicode-bidi:plaintext] sm:max-w-[75%]">
            {message.content}
          </div>
        )
      ) : (
        <div className="w-full max-w-full rounded-3xl rounded-es-md bg-surface-container-high px-4 py-3 sm:max-w-[90%]">
          {streaming ? (
            <LiveAssistantBody message={message} />
          ) : (
            <>
              <ReasoningSection text={reasoningOf(message.parts)} streaming={false} />
              {message.content ? <Markdown content={message.content} /> : null}
            </>
          )}
          <ToolCalls parts={message.parts} results={toolResults} />
          {citations && !streaming ? <Sources citations={citations} /> : null}
          {message.status === "error" ? (
            <div role="alert" className="mt-2 flex items-start gap-2 rounded-2xl bg-destructive/10 px-3 py-2 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-medium">{t.chat.replyFailed}</p>
                {message.error ? <p className="break-words text-muted-foreground" dir="auto">{message.error}</p> : null}
              </div>
            </div>
          ) : null}
          {message.status === "aborted" || message.status === "interrupted" ? (
            <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
              <CircleStop className="size-3.5" aria-hidden="true" />
              {message.status === "aborted" ? t.chat.stopped : t.chat.interrupted}
            </p>
          ) : null}
        </div>
      )}

      {!editing && !streaming && (isUser || message.content || !message.parts.some((p) => p.type === "tool_call")) ? (
        <div
          className={cn(
            "flex items-center gap-2 px-1 transition-opacity",
            !isLast && "opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
          )}
        >
          <MessageActions
            text={message.content}
            role={isUser ? "user" : "assistant"}
            busy={busy}
            canRegenerate={canRegenerate}
            canContinue={canContinue}
            onEdit={isUser ? () => setEditing(true) : undefined}
            onRegenerate={() => onRegenerate(message.id)}
            onContinue={() => onContinue(message.id)}
            onDelete={() => onDelete(message.id)}
          />
          {!isUser && message.content ? <SpeakButton itemId={message.id} text={message.content} voice={voice} /> : null}
          {usage ? (
            <span className="text-xs text-muted-foreground" dir="ltr" title={t.chat.tokens}>
              {usage}
            </span>
          ) : null}
        </div>
      ) : null}
      {!isUser && !streaming && message.context ? (
        <div className="px-1">
          <MessageContext info={message.context} />
        </div>
      ) : null}
    </li>
  );
});
