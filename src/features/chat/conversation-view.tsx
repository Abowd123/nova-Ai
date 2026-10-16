"use client";

import { useCallback, useRef, useState } from "react";
import { useContextPreview } from "@/features/memory/queries";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ContextMeter, ContextNotice } from "./context-meter";
import { SummaryDialog } from "./summary-dialog";
import Link from "next/link";
import { ArrowDown, MessageSquareDashed, MessageSquareOff, Pencil } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { RenameDialog } from "@/features/conversations/rename-dialog";
import { useConversation, useDeleteMessage, useMessages, useUpdateConversation } from "@/features/conversations/queries";
import { AssistantAvatar } from "@/features/assistants/assistant-avatar";
import { useAssistants } from "@/features/assistants/queries";
import { useProviders } from "@/features/providers/queries";
import { useSettings } from "@/features/settings/queries";
import { useI18n } from "@/hooks/use-i18n";
import { useStickToBottom } from "@/hooks/use-stick-to-bottom";
import { getErrorMessage } from "@/lib/i18n/error-message";
import { AssistantPicker } from "./assistant-picker";
import { DropZone } from "@/features/attachments/drop-zone";
import { mediaTargetFor } from "@/features/attachments/media-target";
import { useDrafts } from "@/features/attachments/use-drafts";
import { TtsBar } from "@/features/speech/tts-bar";
import { Composer } from "./composer";
import { useIsConversationStreaming } from "./engine/streaming-store";
import { MessageList } from "./message-list";
import { ModelPicker } from "./model-picker";
import { effectiveModel, modelKey } from "./model-selection";
import { useChatActions } from "./use-chat-actions";

export function ConversationView({ id }: { id: string }) {
  const { t } = useI18n();
  const conversation = useConversation(id);
  const messages = useMessages(id);
  const providers = useProviders();
  const settings = useSettings();
  const assistants = useAssistants();
  const drafts = useDrafts(id);
  const updateConversation = useUpdateConversation();
  const deleteMessage = useDeleteMessage();
  const actions = useChatActions();
  const streaming = useIsConversationStreaming(id);
  const [renameOpen, setRenameOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const debouncedDraft = useDebouncedValue(draft, 600);
  // Re-estimate when messages, model or assistant change (not on every streamed token).
  const last = messages.data?.at(-1);
  const revision = `${messages.data?.length ?? 0}:${last?.id ?? ""}:${last?.status ?? ""}:${conversation.data?.providerId ?? ""}:${conversation.data?.modelId ?? ""}:${conversation.data?.assistantId ?? ""}`;
  const preview = useContextPreview(id, streaming ? "" : debouncedDraft, revision);
  const warnAt = settings.data?.context?.warnAt ?? 0.9;

  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const { atBottom, scrollToBottom } = useStickToBottom(scrollRef, listRef);

  const reportError = useCallback(
    (error: unknown) => toast({ title: getErrorMessage(error, t), variant: "destructive" }),
    [t],
  );

  const onDelete = useCallback((messageId: string) => deleteMessage.mutate(messageId, { onError: reportError }), [deleteMessage, reportError]);
  const onEdit = useCallback((messageId: string, text: string) => actions.edit(messageId, text), [actions]);
  const onRegenerate = useCallback((messageId: string) => actions.regenerate(messageId), [actions]);
  const onContinue = useCallback((messageId: string) => actions.continue(messageId), [actions]);

  if (conversation.isPending) {
    return <LoadingState label={t.common.loading} rows={3} className="mx-auto max-w-3xl" />;
  }
  if (conversation.isError) {
    return (
      <div className="p-6">
        <ErrorState
          title={t.chat.loadError}
          description={getErrorMessage(conversation.error, t)}
          retryLabel={t.common.retry}
          onRetry={() => void conversation.refetch()}
        />
      </div>
    );
  }
  if (!conversation.data) {
    return (
      <div className="p-6">
        <EmptyState
          icon={MessageSquareOff}
          title={t.chat.notFoundTitle}
          description={t.chat.notFoundDescription}
          action={
            <Button asChild variant="tonal">
              <Link href="/chat">{t.chat.backToChats}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const assistant = assistants.data?.find((a) => a.id === conversation.data?.assistantId) ?? null;
  const current = effectiveModel(
    providers.data ?? [],
    conversation.data.providerId ? conversation.data : assistant?.defaultProviderId ? { providerId: assistant.defaultProviderId, modelId: assistant.defaultModelId } : null,
    settings.data,
  );
  const starters = assistant?.starters.length ? assistant.starters : [];
  const hasModel = Boolean(current);

  let body: React.ReactNode;
  if (messages.isPending) body = <LoadingState label={t.common.loading} rows={3} />;
  else if (messages.isError)
    body = (
      <div className="p-6">
        <ErrorState
          title={t.chat.loadError}
          description={getErrorMessage(messages.error, t)}
          retryLabel={t.common.retry}
          onRetry={() => void messages.refetch()}
        />
      </div>
    );
  else if (messages.data.length === 0)
    body = (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        {assistant ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <AssistantAvatar avatar={assistant.avatar} className="size-16 text-3xl" />
            <h2 className="text-lg font-semibold" dir="auto">
              {assistant.name}
            </h2>
            {assistant.description ? (
              <p className="max-w-md text-sm text-muted-foreground" dir="auto">
                {assistant.description}
              </p>
            ) : null}
          </div>
        ) : (
          <EmptyState icon={MessageSquareDashed} title={t.chat.emptyTitle} description={hasModel ? t.chat.emptyDescription : t.chat.noModelDescription} />
        )}
        {!hasModel ? (
          <div className="flex justify-center">
            <Button asChild>
              <Link href="/settings/providers">{t.chat.addProvider}</Link>
            </Button>
          </div>
        ) : starters.length ? (
          <section aria-label={t.chat.startersLabel}>
            <ul className="grid gap-2 sm:grid-cols-2" data-testid="assistant-starters">
              {starters.map((starter) => (
                <li key={starter}>
                  <button
                    type="button"
                    disabled={streaming}
                    onClick={() => void actions.send(id, starter)}
                    className="h-full w-full rounded-3xl border bg-surface-container-low p-4 text-start text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <span dir="auto">{starter}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  else
    body = (
      <MessageList
        ref={listRef}
        messages={messages.data}
        providers={providers.data ?? []}
        busy={streaming}
        voice={assistant?.voiceId}
        onDelete={onDelete}
        onEdit={onEdit}
        onRegenerate={onRegenerate}
        onContinue={onContinue}
      />
    );

  return (
    <DropZone className="flex h-full min-h-0 flex-col" onFiles={drafts.add} disabled={!hasModel}>
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold" dir="auto">
            {conversation.data.title}
          </h1>
          <Button variant="ghost" size="icon-sm" aria-label={t.common.rename} onClick={() => setRenameOpen(true)}>
            <Pencil aria-hidden="true" />
          </Button>
          <AssistantPicker
            value={conversation.data.assistantId}
            onChange={(next) =>
              updateConversation.mutate(
                {
                  id,
                  patch: next?.defaultProviderId
                    ? { assistantId: next.id, providerId: next.defaultProviderId, modelId: next.defaultModelId }
                    : { assistantId: next?.id ?? null },
                },
                { onError: reportError },
              )
            }
          />
          <ContextMeter preview={preview.data} warnAt={warnAt} onOpenSummary={() => setSummaryOpen(true)} />
          <ModelPicker
            compact
            value={current ? modelKey(current.providerId, current.model.id) : null}
            onChange={({ providerId, modelId }) =>
              updateConversation.mutate({ id, patch: { providerId, modelId } }, { onError: reportError })
            }
          />
        </div>
      </header>
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto" aria-live="off">
        {body}
        {!atBottom ? (
          <Button
            variant="tonal"
            size="icon"
            className="sticky bottom-3 start-1/2 z-10 mx-auto flex shadow-elevation2"
            aria-label={t.chat.scrollToBottom}
            onClick={() => scrollToBottom("smooth")}
          >
            <ArrowDown aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <TtsBar />
      <Composer
        streaming={streaming}
        disabled={!hasModel && !providers.isPending}
        sendShortcut={settings.data?.sendShortcut}
        onStop={() => actions.stop(id)}
        drafts={drafts}
        mediaTarget={mediaTargetFor(current)}
        videoMode={settings.data?.media.videoMode ?? "auto"}
        onDraftChange={setDraft}
        notice={<ContextNotice preview={preview.data} warnAt={warnAt} />}
        onSend={async ({ content, inputMode }) => {
          const ok = await actions.send(id, content, { attachmentIds: drafts.ready.map((a) => a.id), videoModes: drafts.videoModes, inputMode });
          if (ok) requestAnimationFrame(() => scrollToBottom());
          return ok;
        }}
      />
      <SummaryDialog conversationId={id} open={summaryOpen} onOpenChange={setSummaryOpen} />
      <RenameDialog
        open={renameOpen}
        initialTitle={conversation.data.title}
        onOpenChange={setRenameOpen}
        pending={updateConversation.isPending}
        onSubmit={(title) =>
          updateConversation.mutate(
            { id, patch: { title, titleSource: "manual" } },
            { onSuccess: () => setRenameOpen(false), onError: reportError },
          )
        }
      />
    </DropZone>
  );
}
