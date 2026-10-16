"use client";

import { forwardRef } from "react";
import { useI18n } from "@/hooks/use-i18n";
import { useMemo } from "react";
import type { Message, Provider, ToolResultPart } from "@/lib/models";
import { MessageRow, type MessageRowHandlers } from "./message-row";

interface MessageListProps extends MessageRowHandlers {
  messages: Message[];
  providers: Provider[];
  busy: boolean;
  voice?: string | null;
}

function modelNameOf(message: Message, providers: Provider[]): string | undefined {
  if (!message.modelId) return undefined;
  const provider = providers.find((p) => p.id === message.providerId);
  return provider?.models.find((m) => m.id === message.modelId)?.name ?? message.modelId;
}

export const MessageList = forwardRef<HTMLUListElement, MessageListProps>(function MessageList(
  { messages: allMessages, providers, busy, voice, ...handlers },
  ref,
) {
  const { t } = useI18n();
  // Tool results live in role=tool messages: shown inside the cards of the calling assistant step.
  const { visible, results, citations } = useMemo(() => {
    const results = new Map<string, ToolResultPart>();
    const citations = new Map<string, { index: number; title: string; url: string }[]>();
    const visible: Message[] = [];
    let collected: { index: number; title: string; url: string }[] = [];
    for (const message of allMessages) {
      if (message.role === "user") collected = [];
      if (message.role === "tool") {
        for (const part of message.parts) {
          if (part.type !== "tool_result") continue;
          results.set(part.toolCallId, part);
          if (part.display?.kind === "search" && part.display.citations) collected = part.display.citations.map(({ index, title, url }) => ({ index, title, url }));
        }
        continue;
      }
      if (message.role === "assistant" && collected.length && /\[\d+\]/.test(message.content)) citations.set(message.id, collected);
      visible.push(message);
    }
    return { visible, results, citations };
  }, [allMessages]);
  const messages = visible;
  let lastAssistant = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "assistant") {
      lastAssistant = i;
      break;
    }
  }
  return (
    <ul ref={ref} aria-label={t.chat.messagesLabel} className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4">
      {messages.map((message, index) => (
        <MessageRow
          key={message.id}
          message={message}
          isLast={index === messages.length - 1}
          isLastAssistant={index === lastAssistant && index === messages.length - 1}
          busy={busy}
          modelName={message.role === "assistant" ? modelNameOf(message, providers) : undefined}
          voice={voice}
          toolResults={results}
          citations={citations.get(message.id)}
          {...handlers}
        />
      ))}
    </ul>
  );
});
