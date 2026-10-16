"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useServices } from "@/components/providers/services-provider";
import { toast } from "@/components/ui/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import type { PlayerState } from "@/lib/speech/tts-player";
import { TtsError } from "@/lib/speech/tts-types";

const IDLE: PlayerState = { status: "idle", itemId: null, index: 0, total: 0, error: null };

export function useTtsState(): PlayerState {
  const services = useServices();
  return useSyncExternalStore(
    (listener) => services().speech.player.subscribe(listener),
    () => services().speech.player.getState(),
    () => IDLE,
  );
}

export function useTtsActions() {
  const services = useServices();
  const { t } = useI18n();
  const speak = useCallback(
    async (itemId: string, text: string, voice?: string | null) => {
      try {
        await services().speech.speak(itemId, text, { voice });
        const error = services().speech.player.getState().error;
        if (error) toast({ title: t.speech.ttsErrors[error.code], variant: "destructive" });
      } catch (error) {
        toast({ title: t.speech.ttsErrors[error instanceof TtsError ? error.code : "provider"], variant: "destructive" });
      }
    },
    [services, t],
  );
  return {
    speak,
    pause: () => services().speech.player.pause(),
    resume: () => services().speech.player.resume(),
    stop: () => services().speech.player.stop(),
  };
}
