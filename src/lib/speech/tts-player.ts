import { splitSentences } from "./sentences";
import { toSpeakableText } from "./speakable";
import { TtsError, type SpeakOptions, type TextToSpeech, type Utterance } from "./tts-types";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused";

export interface PlayerState {
  status: PlayerStatus;
  /** Id of what is being read (message id). */
  itemId: string | null;
  index: number;
  total: number;
  error: TtsError | null;
}

export interface MediaSessionLike {
  metadata: unknown;
  playbackState: "none" | "paused" | "playing";
  setActionHandler(action: string, handler: (() => void) | null): void;
}

export interface PlayerDeps {
  mediaSession?: () => MediaSessionLike | undefined;
  createMetadata?: (init: { title: string; artist: string }) => unknown;
  /** How many sentences to prepare ahead of the one playing. */
  prefetch?: number;
}

/**
 * Sentence queue for TTS: splits text, prepares the next sentence(s) while the current one
 * plays (prefetch), supports pause/resume/stop and mirrors state to the Media Session API
 * so lock-screen / headset controls work and audio can keep playing in the background.
 */
export class TtsPlayer {
  private state: PlayerState = { status: "idle", itemId: null, index: 0, total: 0, error: null };
  private readonly listeners = new Set<(state: PlayerState) => void>();
  private run = 0;
  private current: Utterance | null = null;
  private controller: AbortController | null = null;
  private resumeWaiter: (() => void) | null = null;

  constructor(private readonly deps: PlayerDeps = {}) {}

  getState(): PlayerState {
    return this.state;
  }

  subscribe(listener: (state: PlayerState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch };
    const session = this.deps.mediaSession?.();
    if (session) session.playbackState = this.state.status === "playing" ? "playing" : this.state.status === "paused" ? "paused" : "none";
    for (const listener of this.listeners) listener(this.state);
  }

  /** Speaks markdown text. Resolves when finished, stopped or failed (never rejects). */
  async speak(
    engine: TextToSpeech,
    markdown: string,
    options: Omit<SpeakOptions, "signal"> & { itemId: string; title?: string; codePlaceholder?: string },
  ): Promise<void> {
    this.stop();
    const runId = ++this.run;
    const sentences = splitSentences(toSpeakableText(markdown, { codePlaceholder: options.codePlaceholder }));
    if (!sentences.length) return;
    const controller = new AbortController();
    this.controller = controller;
    this.set({ status: "loading", itemId: options.itemId, index: 0, total: sentences.length, error: null });
    this.bindMediaSession(options.title ?? sentences[0]!.slice(0, 60));

    const prefetch = Math.max(0, this.deps.prefetch ?? 1);
    const pending = new Map<number, Promise<Utterance>>();
    const prepare = (i: number) => {
      if (i >= sentences.length || pending.has(i)) return;
      const promise = engine.prepare(sentences[i]!, { ...options, signal: controller.signal });
      promise.catch(() => undefined); // surfaced when awaited
      pending.set(i, promise);
    };

    try {
      for (let i = 0; i < sentences.length; i += 1) {
        for (let k = 0; k <= prefetch; k += 1) prepare(i + k);
        if (!pending.has(i)) prepare(i);
        const utterance = await pending.get(i)!;
        pending.delete(i);
        if (runId !== this.run) {
          utterance.stop();
          return;
        }
        if (this.state.status === "paused") await new Promise<void>((resolve) => (this.resumeWaiter = resolve));
        if (runId !== this.run) {
          utterance.stop();
          return;
        }
        this.current = utterance;
        this.set({ status: "playing", index: i });
        await utterance.play();
        this.current = null;
        if (runId !== this.run) return;
      }
      this.finish(runId, null);
    } catch (error) {
      if (runId !== this.run) return;
      const failure = error instanceof TtsError ? error : new TtsError("provider", "Speech failed", { cause: error });
      this.finish(runId, failure.code === "aborted" ? null : failure);
    } finally {
      for (const promise of pending.values()) void promise.then((u) => u.stop()).catch(() => undefined);
    }
  }

  private finish(runId: number, error: TtsError | null): void {
    if (runId !== this.run) return;
    this.controller = null;
    this.current = null;
    this.unbindMediaSession();
    this.set({ status: "idle", itemId: null, index: 0, total: 0, error });
  }

  pause(): void {
    if (this.state.status !== "playing" && this.state.status !== "loading") return;
    this.current?.pause();
    this.set({ status: "paused" });
  }

  resume(): void {
    if (this.state.status !== "paused") return;
    this.set({ status: this.current ? "playing" : "loading" });
    this.current?.resume();
    this.resumeWaiter?.();
    this.resumeWaiter = null;
  }

  toggle(): void {
    if (this.state.status === "paused") this.resume();
    else this.pause();
  }

  stop(): void {
    this.run += 1;
    this.controller?.abort();
    this.controller = null;
    this.current?.stop();
    this.current = null;
    this.resumeWaiter?.();
    this.resumeWaiter = null;
    if (this.state.status !== "idle") {
      this.unbindMediaSession();
      this.set({ status: "idle", itemId: null, index: 0, total: 0, error: null });
    }
  }

  private bindMediaSession(title: string): void {
    const session = this.deps.mediaSession?.();
    if (!session) return;
    try {
      if (this.deps.createMetadata) session.metadata = this.deps.createMetadata({ title, artist: "Nova" });
      session.setActionHandler("play", () => this.resume());
      session.setActionHandler("pause", () => this.pause());
      session.setActionHandler("stop", () => this.stop());
    } catch {
      /* some actions are unsupported on some platforms */
    }
  }

  private unbindMediaSession(): void {
    const session = this.deps.mediaSession?.();
    if (!session) return;
    for (const action of ["play", "pause", "stop"]) {
      try {
        session.setActionHandler(action, null);
      } catch {
        /* ignore */
      }
    }
    session.metadata = null;
  }
}

/** Autoplay policy from the assistant's autoPlayTts setting. */
export function shouldAutoplay(setting: "never" | "always" | "voice-input" | undefined, inputMode: "text" | "voice"): boolean {
  return setting === "always" || (setting === "voice-input" && inputMode === "voice");
}
