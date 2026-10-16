"use client";

import { Loader2, Pause, Play, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { useTtsActions, useTtsState } from "./use-tts";

/** Mini player shown while a reply is being read aloud. */
export function TtsBar() {
  const { t } = useI18n();
  const state = useTtsState();
  const actions = useTtsActions();
  if (state.status === "idle") return null;
  return (
    <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-3 pt-2" role="region" aria-label={t.speech.playerLabel} data-testid="tts-bar">
      <div className="flex flex-1 items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-sm text-secondary-foreground">
        {state.status === "loading" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Volume2 className="size-4" aria-hidden="true" />}
        <span className="flex-1" role="status">
          {state.status === "paused" ? t.speech.paused : t.speech.speaking(state.index + 1, state.total)}
        </span>
        {state.status === "paused" ? (
          <Button variant="ghost" size="icon-sm" aria-label={t.speech.resume} onClick={actions.resume}>
            <Play aria-hidden="true" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon-sm" aria-label={t.speech.pause} onClick={actions.pause}>
            <Pause aria-hidden="true" />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" aria-label={t.speech.stop} onClick={actions.stop}>
          <Square className="fill-current" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export function SpeakButton({ itemId, text, voice }: { itemId: string; text: string; voice?: string | null }) {
  const { t } = useI18n();
  const state = useTtsState();
  const actions = useTtsActions();
  const active = state.itemId === itemId && state.status !== "idle";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={active ? t.speech.stop : t.speech.readAloud}
      title={active ? t.speech.stop : t.speech.readAloud}
      aria-pressed={active}
      onClick={() => (active ? actions.stop() : void actions.speak(itemId, text, voice))}
      data-testid="speak-button"
    >
      {active ? <Square className="fill-current" aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
    </Button>
  );
}
