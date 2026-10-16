// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { Scheduler } from "@/features/backup/scheduler";

describe("Scheduler", () => {
  it("runs due jobs once, skips disabled/not-due and offline, and survives failures", async () => {
    const ran: string[] = [];
    let online = true;
    const scheduler = new Scheduler({
      online: () => online,
      lock: async (_name, fn) => fn(),
      jobs: [
        { name: "due", dueIn: async () => -1, run: async () => void ran.push("due") },
        { name: "later", dueIn: async () => 60_000, run: async () => void ran.push("later") },
        { name: "off", dueIn: async () => null, run: async () => void ran.push("off") },
        {
          name: "boom",
          dueIn: async () => 0,
          run: async () => {
            ran.push("boom");
            throw new Error("x");
          },
        },
      ],
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await scheduler.tick();
    expect(ran).toEqual(["due", "boom"]);
    online = false;
    await scheduler.tick();
    expect(ran).toHaveLength(2);
    warn.mockRestore();
  });

  it("does not start a job twice while it is running", async () => {
    let release!: () => void;
    let runs = 0;
    const scheduler = new Scheduler({
      online: () => true,
      lock: async (_n, fn) => fn(),
      jobs: [{ name: "slow", dueIn: async () => 0, run: () => new Promise<void>((r) => ((runs += 1), (release = r))) }],
    });
    const first = scheduler.tick();
    await new Promise((r) => setTimeout(r, 5));
    await scheduler.tick();
    release();
    await first;
    expect(runs).toBe(1);
  });
});
