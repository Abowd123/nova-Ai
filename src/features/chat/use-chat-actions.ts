"use client";

import { useCallback, useMemo } from "react";
import { haptic } from "@/lib/native/feedback";
import { useRouter } from "next/navigation";
import { useServices } from "@/components/providers/services-provider";
import { toast } from "@/components/ui/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { userFacingError, type SendOptions } from "./engine/chat-service";
import { MediaError } from "./engine/media-resolver";

export function useChatActions() {
  const services = useServices();
  const router = useRouter();
  const { t } = useI18n();

  const report = useCallback(
    (error: unknown) => {
      if (error instanceof MediaError) {
        toast({ title: t.attachments.cannotSend(error.attachmentName), description: error.problem === "missing" ? t.attachments.missing(error.attachmentName) : t.attachments.problems[error.problem], variant: "destructive" });
        return;
      }
      const failure = userFacingError(error);
      if (failure.code === "aborted") return;
      toast({
        title: t.chatErrors[failure.code] ?? t.errors.generic,
        description: failure.code === "no_model" || failure.code === "busy" ? undefined : failure.message,
        variant: "destructive",
        action:
          failure.code === "no_model" || failure.code === "unauthorized" || failure.code === "forbidden"
            ? { label: t.chat.openProviders, onClick: () => router.push("/settings/providers") }
            : undefined,
      });
    },
    [router, t],
  );

  return useMemo(() => {
    const chat = () => services().chat;
    return {
      report,
      /** Validates a model is available, then streams in the background. Returns false to keep the draft. */
      send: async (conversationId: string, text: string, options: SendOptions = {}): Promise<boolean> => {
        try {
          await chat().resolveModel(conversationId);
          await chat().checkSendable(conversationId, options.attachmentIds ?? [], options.videoModes);
        } catch (error) {
          report(error);
          return false;
        }
        haptic("light");
        void chat().send(conversationId, text, options).catch(report);
        return true;
      },
      stop: (conversationId: string) => chat().stop(conversationId),
      regenerate: (messageId: string) => void chat().regenerate(messageId).catch(report),
      edit: (messageId: string, text: string) => void chat().editAndResend(messageId, text).catch(report),
      continue: (messageId: string) => void chat().continue(messageId).catch(report),
    };
  }, [services, report]);
}
