"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Settings2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { useAssistants } from "@/features/assistants/queries";
import { useCreateConversation } from "@/features/conversations/queries";
import { selectableModels } from "@/features/providers/provider-service";
import { useProviders } from "@/features/providers/queries";
import { useI18n } from "@/hooks/use-i18n";
import { getErrorMessage } from "@/lib/i18n/error-message";
import { useChatActions } from "./use-chat-actions";
import { chatHref } from "@/lib/routes";

export function ChatHome() {
  const { t } = useI18n();
  const router = useRouter();
  const createConversation = useCreateConversation();
  const providers = useProviders();
  const actions = useChatActions();
  const handledShortcut = useRef(false);
  const assistants = useAssistants();
  const hasModel = selectableModels(providers.data ?? []).length > 0;
  const defaultAssistant = assistants.data?.find((a) => a.isDefault) ?? null;
  const starters = defaultAssistant?.starters.length ? defaultAssistant.starters : t.chat.starters;

  const start = async (starter?: string) => {
    try {
      const conversation = await createConversation.mutateAsync({
        title: t.conversations.defaultTitle,
        titleSource: "default",
        assistantId: defaultAssistant?.id ?? null,
        ...(defaultAssistant?.defaultProviderId
          ? { providerId: defaultAssistant.defaultProviderId, modelId: defaultAssistant.defaultModelId }
          : {}),
      });
      router.push(chatHref(conversation.id));
      if (starter) await actions.send(conversation.id, starter);
    } catch (error) {
      toast({ title: getErrorMessage(error, t), variant: "destructive" });
    }
  };

  // Manifest shortcut: /chat?new=1
  useEffect(() => {
    if (handledShortcut.current) return;
    handledShortcut.current = true;
    if (new URLSearchParams(window.location.search).get("new") === "1") void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = createConversation.isPending;

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center gap-8 p-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-3xl bg-primary text-primary-foreground shadow-elevation2">
        <Sparkles className="size-8" aria-hidden="true" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{t.chat.welcomeTitle}</h1>
        <p className="mx-auto max-w-xl text-muted-foreground">{hasModel ? t.chat.welcomeDescription : t.chat.welcomeNoProvider}</p>
      </div>
      {!providers.isPending && !hasModel ? (
        <Button asChild size="lg">
          <Link href="/settings/providers">
            <Settings2 aria-hidden="true" />
            {t.chat.addProvider}
          </Link>
        </Button>
      ) : null}
      <section aria-label={t.chat.startersLabel} className="w-full">
        <ul className="grid w-full gap-3 sm:grid-cols-2">
          {starters.map((starter) => (
            <li key={starter}>
              <button
                type="button"
                disabled={busy || !hasModel}
                onClick={() => void start(starter)}
                className="h-full w-full rounded-3xl border bg-surface-container-low p-4 text-start text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <span dir="auto">{starter}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <Button size="lg" variant={hasModel ? "default" : "outline"} data-testid="home-new-conversation" disabled={busy} onClick={() => void start()}>
        <Plus aria-hidden="true" />
        {t.conversations.newConversation}
      </Button>
    </div>
  );
}
