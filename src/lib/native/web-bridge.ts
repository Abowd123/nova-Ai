import type { NativeBridge, SaveFileResult, ShareInput } from "./types";

const noop = () => () => undefined;

function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError";
}

export function downloadBlob(name: string, data: Blob): void {
  const url = URL.createObjectURL(data);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function webShare(input: ShareInput): Promise<"shared" | "cancelled" | "unsupported"> {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return "unsupported";
  const files = input.files?.map((f) => new File([f.data], f.name, { type: f.data.type || "application/octet-stream" }));
  const payload: ShareData = { title: input.title, text: input.text, url: input.url, ...(files?.length ? { files } : {}) };
  if (files?.length && (typeof navigator.canShare !== "function" || !navigator.canShare({ files }))) return "unsupported";
  try {
    await navigator.share(payload);
    return "shared";
  } catch (error) {
    return isAbort(error) ? "cancelled" : "unsupported";
  }
}

/** Standard web APIs only (browsers and installed PWAs). */
export function createWebBridge(): NativeBridge {
  return {
    platform: "web",
    isNative: false,
    async saveFile(name, data): Promise<SaveFileResult> {
      downloadBlob(name, data);
      return "downloaded";
    },
    share: webShare,
    async haptic(kind) {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(kind === "error" || kind === "warning" ? [20, 40, 20] : 10);
    },
    async notify({ title, body }) {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
      try {
        const registration = await navigator.serviceWorker?.getRegistration?.();
        if (registration) await registration.showNotification(title, { body, icon: "/icons/icon-192.png", tag: "nova" });
        else new Notification(title, { body });
        return true;
      } catch {
        return false;
      }
    },
    async requestNotifications() {
      if (typeof Notification === "undefined") return false;
      if (Notification.permission === "granted") return true;
      return (await Notification.requestPermission()) === "granted";
    },
    async openExternal(url) {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onBackButton: noop,
    onAppState(handler) {
      const listener = () => handler(document.visibilityState === "visible");
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    onDeepLink: noop,
    onNetwork(handler) {
      const on = () => handler(true);
      const off = () => handler(false);
      window.addEventListener("online", on);
      window.addEventListener("offline", off);
      return () => {
        window.removeEventListener("online", on);
        window.removeEventListener("offline", off);
      };
    },
    onKeyboard: noop,
    onNotificationTap: noop,
    async setStatusBar() {},
    async hideSplash() {},
    async exitApp() {},
  };
}
