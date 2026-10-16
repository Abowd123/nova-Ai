import { describe, expect, it } from "vitest";
import { shouldAutoplay, TtsPlayer, type MediaSessionLike, type PlayerState } from "@/lib/speech/tts-player";
import { TtsError, type SpeakOptions, type TextToSpeech, type Utterance } from "@/lib/speech/tts-types";

const tick = () => new Promise((r) => setTimeout(r, 0));

class FakeEngine implements TextToSpeech {
  readonly id = "web-speech" as const;
  log: string[] = [];
  /** Controls when each utterance finishes playing. */
  finishers: (() => void)[] = [];
  failOn: string | null = null;
  isSupported() {
    return true;
  }
  async listVoices() {
    return [];
  }
  async prepare(text: string, _options: SpeakOptions): Promise<Utterance> {
    this.log.push(`prepare:${text}`);
    if (text === this.failOn) throw new TtsError("network", "down");
    let settle: (() => void) | null = null;
    return {
      play: () =>
        new Promise<void>((resolve) => {
          this.log.push(`play:${text}`);
          settle = resolve;
          this.finishers.push(resolve);
        }),
      pause: () => this.log.push(`pause:${text}`),
      resume: () => this.log.push(`resume:${text}`),
      // Contract: stop() settles a pending play().
      stop: () => {
        this.log.push(`stop:${text}`);
        settle?.();
      },
    };
  }
}

const TEXT = "First sentence is right here. Second sentence is right here. Third sentence is right here.";

describe("TtsPlayer", () => {
  it("plays sentences in order and prefetches the next one", async () => {
    const engine = new FakeEngine();
    const player = new TtsPlayer({ prefetch: 1 });
    const states: PlayerState["status"][] = [];
    player.subscribe((s) => states.push(s.status));
    const done = player.speak(engine, TEXT, { itemId: "m1", rate: 1 });
    await tick();
    expect(engine.log).toEqual(["prepare:First sentence is right here.", "prepare:Second sentence is right here.", "play:First sentence is right here."]);
    expect(player.getState()).toMatchObject({ status: "playing", itemId: "m1", index: 0, total: 3 });
    engine.finishers.shift()!();
    await tick();
    expect(engine.log.at(-1)).toBe("play:Second sentence is right here.");
    expect(engine.log).toContain("prepare:Third sentence is right here.");
    engine.finishers.shift()!();
    await tick();
    engine.finishers.shift()!();
    await done;
    expect(player.getState()).toMatchObject({ status: "idle", itemId: null, error: null });
    expect(states[0]).toBe("loading");
  });

  it("pauses, resumes and stops", async () => {
    const engine = new FakeEngine();
    const player = new TtsPlayer();
    const done = player.speak(engine, TEXT, { itemId: "m1", rate: 1 });
    await tick();
    player.pause();
    expect(player.getState().status).toBe("paused");
    expect(engine.log).toContain("pause:First sentence is right here.");
    player.resume();
    expect(player.getState().status).toBe("playing");
    player.stop();
    await done;
    expect(engine.log).toContain("stop:First sentence is right here.");
    expect(player.getState().status).toBe("idle");
    expect(engine.log.filter((l) => l.startsWith("play:"))).toHaveLength(1);
  });

  it("reports engine failures without throwing", async () => {
    const engine = new FakeEngine();
    engine.failOn = "First sentence is right here.";
    const player = new TtsPlayer();
    await player.speak(engine, TEXT, { itemId: "m1", rate: 1 });
    expect(player.getState().status).toBe("idle");
    expect(player.getState().error?.code).toBe("network");
  });

  it("a new speak() replaces the current one", async () => {
    const engine = new FakeEngine();
    const player = new TtsPlayer();
    const first = player.speak(engine, TEXT, { itemId: "m1", rate: 1 });
    await tick();
    const second = player.speak(engine, "Another message entirely here.", { itemId: "m2", rate: 1 });
    await first;
    await tick();
    expect(player.getState()).toMatchObject({ itemId: "m2", status: "playing" });
    engine.finishers.at(-1)!();
    await second;
  });

  it("mirrors state to the Media Session and clears handlers", async () => {
    const handlers = new Map<string, (() => void) | null>();
    const session: MediaSessionLike = { metadata: null, playbackState: "none", setActionHandler: (a, h) => void handlers.set(a, h) };
    const engine = new FakeEngine();
    const player = new TtsPlayer({ mediaSession: () => session, createMetadata: (init) => init });
    const done = player.speak(engine, "Only one sentence to read.", { itemId: "m1", rate: 1, title: "Nova reply" });
    await tick();
    expect(session.playbackState).toBe("playing");
    expect(session.metadata).toEqual({ title: "Nova reply", artist: "Nova" });
    handlers.get("pause")!();
    expect(session.playbackState).toBe("paused");
    handlers.get("play")!();
    engine.finishers.shift()!();
    await done;
    expect(session.metadata).toBeNull();
    expect(handlers.get("play")).toBeNull();
  });

  it("does nothing for text with nothing speakable", async () => {
    const engine = new FakeEngine();
    const player = new TtsPlayer();
    await player.speak(engine, "```\ncode only\n```", { itemId: "m1", rate: 1 });
    expect(engine.log).toEqual([]);
  });
});

describe("shouldAutoplay", () => {
  it("follows the assistant setting", () => {
    expect(shouldAutoplay("always", "text")).toBe(true);
    expect(shouldAutoplay("voice-input", "voice")).toBe(true);
    expect(shouldAutoplay("voice-input", "text")).toBe(false);
    expect(shouldAutoplay("never", "voice")).toBe(false);
    expect(shouldAutoplay(undefined, "voice")).toBe(false);
  });
});
