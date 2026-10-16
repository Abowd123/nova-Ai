import { logger } from "@/lib/logger";
import { isOnline } from "./remote";

export interface ScheduledJob {
  name: string;
  /** ms until the job is due (≤ 0 = due now); null = disabled. */
  dueIn: () => Promise<number | null>;
  run: () => Promise<unknown>;
}

export interface SchedulerDeps {
  jobs: ScheduledJob[];
  /** How often due-ness is checked. */
  tickMs?: number;
  /** Cross-tab mutual exclusion (Web Locks); defaults to navigator.locks when available. */
  lock?: (name: string, fn: () => Promise<void>) => Promise<void>;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
  online?: () => boolean;
}

function webLock(name: string, fn: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks) return fn();
  // ifAvailable: another tab is already doing it → skip this round.
  return locks.request(`nova-${name}`, { ifAvailable: true }, async (lock) => {
    if (lock) await fn();
  }) as Promise<void>;
}

/**
 * Foreground scheduler for backups and sync. Browsers give no reliable background timers,
 * so jobs run while the app is open: on start, every tick, and when the device comes online.
 * Failures are logged and retried on the next tick; only one tab runs a job at a time.
 */
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly running = new Set<string>();
  private readonly onOnline = () => void this.tick();

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    if (this.timer) return;
    const set = this.deps.setInterval ?? setInterval;
    this.timer = set(() => void this.tick(), this.deps.tickMs ?? 60_000);
    if (typeof window !== "undefined") window.addEventListener("online", this.onOnline);
    void this.tick();
  }

  stop(): void {
    if (this.timer) (this.deps.clearInterval ?? clearInterval)(this.timer);
    this.timer = null;
    if (typeof window !== "undefined") window.removeEventListener("online", this.onOnline);
  }

  async tick(): Promise<void> {
    if (!(this.deps.online ?? isOnline)()) return;
    for (const job of this.deps.jobs) {
      if (this.running.has(job.name)) continue;
      let due: number | null;
      try {
        due = await job.dueIn();
      } catch (error) {
        logger.warn(`Scheduler: ${job.name} check failed`, error);
        continue;
      }
      if (due === null || due > 0) continue;
      this.running.add(job.name);
      try {
        await (this.deps.lock ?? webLock)(job.name, async () => {
          await job.run();
        });
      } catch (error) {
        logger.warn(`Scheduled ${job.name} failed`, error);
      } finally {
        this.running.delete(job.name);
      }
    }
  }
}
