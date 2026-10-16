import { redactSecrets } from "@/lib/security/redact";

/**
 * Crash capture. Reports are ALWAYS kept locally (last 20, viewable/copyable in Settings) and
 * only sent when the user opted in AND an https endpoint is configured. Reports contain no
 * conversation content: message, redacted stack, route path (no query), app version, platform.
 */
export interface CrashReport {
  id: string;
  at: number;
  kind: "error" | "unhandledrejection" | "react";
  message: string;
  stack: string;
  route: string;
  version: string;
  platform: string;
  userAgent: string;
}

export const CRASH_STORE_KEY = "nova:crash-reports";
export const MAX_STORED = 20;
export const MAX_SENT_PER_SESSION = 5;

const URL_QUERY = /(https?:\/\/[^\s?#)]+)[?#][^\s)]*/g;

function scrub(text: string): string {
  // Drop query strings/fragments (may contain ids or tokens) and redact key patterns.
  return redactSecrets(text.replace(URL_QUERY, "$1"));
}

export function buildCrashReport(
  error: unknown,
  context: { kind: CrashReport["kind"]; pathname: string; version: string; platform: string; userAgent: string; now: number; id: string },
): CrashReport {
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Non-error rejection");
  return {
    id: context.id,
    at: context.now,
    kind: context.kind,
    message: scrub(`${err.name}: ${err.message}`).slice(0, 500),
    stack: scrub(err.stack ?? "")
      .split("\n")
      .slice(0, 30)
      .join("\n")
      .slice(0, 4000),
    route: context.pathname.split(/[?#]/)[0]!.replace(/\/chat\/[^/]+/, "/chat/:id").slice(0, 200),
    version: context.version,
    platform: context.platform,
    userAgent: context.userAgent.slice(0, 200),
  };
}

export interface CrashStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readReports(store: CrashStore): CrashReport[] {
  try {
    const parsed = JSON.parse(store.getItem(CRASH_STORE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as CrashReport[]) : [];
  } catch {
    return [];
  }
}

export function saveReport(store: CrashStore, report: CrashReport): CrashReport[] {
  const list = [report, ...readReports(store)].slice(0, MAX_STORED);
  try {
    store.setItem(CRASH_STORE_KEY, JSON.stringify(list));
  } catch {
    /* quota: keep going */
  }
  return list;
}

export function clearReports(store: CrashStore): void {
  store.removeItem(CRASH_STORE_KEY);
}

export class CrashReporter {
  private sent = 0;
  private readonly seen = new Set<string>();

  constructor(
    private readonly deps: {
      store: CrashStore;
      endpoint?: string;
      optedIn: () => Promise<boolean>;
      send?: (url: string, body: string) => Promise<unknown>;
      context: () => Omit<Parameters<typeof buildCrashReport>[1], "kind" | "now" | "id">;
      now?: () => number;
      id?: () => string;
    },
  ) {}

  async capture(error: unknown, kind: CrashReport["kind"]): Promise<CrashReport | null> {
    const report = buildCrashReport(error, {
      ...this.deps.context(),
      kind,
      now: this.deps.now?.() ?? Date.now(),
      id: this.deps.id?.() ?? Math.random().toString(36).slice(2, 10),
    });
    // Same crash repeating in a loop: store/send once.
    const signature = `${report.message}|${report.stack.split("\n")[1] ?? ""}`;
    if (this.seen.has(signature)) return null;
    this.seen.add(signature);
    saveReport(this.deps.store, report);
    if (this.deps.endpoint && this.sent < MAX_SENT_PER_SESSION && (await this.deps.optedIn().catch(() => false))) {
      this.sent += 1;
      const send = this.deps.send ?? ((url: string, body: string) => fetch(url, { method: "POST", body, headers: { "Content-Type": "application/json" }, credentials: "omit", keepalive: true, referrerPolicy: "no-referrer" }));
      await send(this.deps.endpoint, JSON.stringify(report)).catch(() => undefined);
    }
    return report;
  }

  /** Global handlers; returns an uninstall function. */
  install(target: Window = window): () => void {
    const onError = (event: ErrorEvent) => void this.capture(event.error ?? event.message, "error");
    const onRejection = (event: PromiseRejectionEvent) => void this.capture(event.reason, "unhandledrejection");
    target.addEventListener("error", onError);
    target.addEventListener("unhandledrejection", onRejection);
    return () => {
      target.removeEventListener("error", onError);
      target.removeEventListener("unhandledrejection", onRejection);
    };
  }
}
