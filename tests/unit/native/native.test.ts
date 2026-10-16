// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decideBack } from "@/lib/native/back";
import { isExternalLink } from "@/lib/native/links";
import { detectPlatform } from "@/lib/native/types";
import { safeFileName } from "@/lib/native/file-names";
import { chatHref, chatIdFrom } from "@/lib/routes";
import { CrashReporter, buildCrashReport, readReports, type CrashStore } from "@/lib/crash/reporter";

const memoryStore = (): CrashStore => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

describe("platform detection", () => {
  it("is web without Capacitor and android inside the shell", () => {
    expect(detectPlatform(undefined)).toBe("web");
    expect(detectPlatform({ isNativePlatform: () => false })).toBe("web");
    expect(detectPlatform({ isNativePlatform: () => true, getPlatform: () => "android" })).toBe("android");
  });
});

describe("Android back button", () => {
  const base = { overlayOpen: false, canGoBack: true, pathname: "/settings", lastPressAt: null, now: 10_000 };
  it("closes overlays first, then goes back, then asks before exiting", () => {
    expect(decideBack({ ...base, overlayOpen: true })).toBe("close-overlay");
    expect(decideBack(base)).toBe("history-back");
    expect(decideBack({ ...base, pathname: "/chat" })).toBe("confirm-exit");
    expect(decideBack({ ...base, canGoBack: false })).toBe("confirm-exit");
    expect(decideBack({ ...base, pathname: "/", lastPressAt: 9_000 })).toBe("exit");
    expect(decideBack({ ...base, pathname: "/", lastPressAt: 5_000 })).toBe("confirm-exit");
  });
});

describe("external links", () => {
  it("only other origins and mailto/tel leave the app", () => {
    const origin = "https://localhost";
    expect(isExternalLink("https://example.com/x", origin)).toBe(true);
    expect(isExternalLink("/settings", origin)).toBe(false);
    expect(isExternalLink("https://localhost/chat", origin)).toBe(false);
    expect(isExternalLink("mailto:a@b.c", origin)).toBe(true);
    expect(isExternalLink("javascript:alert(1)", origin)).toBe(false);
  });
});

describe("routes for the static export", () => {
  it("builds and parses conversation URLs in both modes", () => {
    expect(chatHref("a b", false)).toBe("/chat/a%20b");
    expect(chatHref("a b", true)).toBe("/chat/view?id=a%20b");
    expect(chatIdFrom("/chat/abc", "")).toBe("abc");
    expect(chatIdFrom("/chat/view/", "?id=xyz")).toBe("xyz");
    expect(chatIdFrom("/chat", "")).toBeNull();
    expect(chatIdFrom("/chat/view", "")).toBeNull();
  });

  it("file names are safe for shared storage", () => {
    expect(safeFileName("../evil/na:me?.json")).toBe("_evil_na_me_.json");
    expect(safeFileName("")).toBe("nova-file");
  });
});

describe("crash reporter", () => {
  const context = { pathname: "/chat/secret-id?x=1", version: "1.5.0", platform: "android", userAgent: "UA" };

  it("redacts keys and query strings, hides conversation ids", () => {
    const error = new Error("boom at https://api.test/v1?key=sk-abcdefghijklmnopqrstuvwxyz123");
    const report = buildCrashReport(error, { ...context, kind: "error", now: 1, id: "r1" });
    expect(report.message).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123");
    expect(report.message).not.toContain("?key");
    expect(report.route).toBe("/chat/:id");
  });

  it("stores locally always, sends only when opted in, once per crash, capped", async () => {
    const store = memoryStore();
    const sent: string[] = [];
    let optedIn = false;
    let n = 0;
    const reporter = new CrashReporter({ store, endpoint: "https://crash.test/r", optedIn: async () => optedIn, send: async (_u, body) => void sent.push(body), context: () => context, id: () => `id${++n}` });
    await reporter.capture(new Error("first"), "error");
    expect(readReports(store)).toHaveLength(1);
    expect(sent).toHaveLength(0);
    optedIn = true;
    const repeated = new Error("second");
    await reporter.capture(repeated, "error");
    await reporter.capture(repeated, "error"); // same crash in a loop
    expect(sent).toHaveLength(1);
    for (let i = 0; i < 10; i += 1) await reporter.capture(new Error(`e${i}`), "unhandledrejection");
    expect(sent).toHaveLength(5);
    expect(JSON.parse(sent[0]!)).not.toHaveProperty("conversation");
  });

  it("without an endpoint nothing is ever sent", async () => {
    const sent: string[] = [];
    const reporter = new CrashReporter({ store: memoryStore(), optedIn: async () => true, send: async (_u, b) => void sent.push(b), context: () => context });
    await reporter.capture(new Error("x"), "error");
    expect(sent).toHaveLength(0);
  });
});
