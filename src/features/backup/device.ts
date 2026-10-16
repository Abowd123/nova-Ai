import type { Repositories } from "@/lib/storage/types";

const ID_KEY = "device:id";
const LABEL_KEY = "device:label";

function defaultLabel(): string {
  if (typeof navigator === "undefined") return "Device";
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${browser} · ${os}`;
}

/** Stable random device id (sync cursors, LWW tie-break) and an editable label. */
export function deviceIdentity(repos: Repositories) {
  let cached: { id: string; label: string } | null = null;
  return {
    async get(): Promise<{ id: string; label: string }> {
      if (cached) return cached;
      let id = await repos.sync.getState<string>(ID_KEY);
      if (!id) {
        id = `d-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
        await repos.sync.setState(ID_KEY, id);
      }
      const label = (await repos.sync.getState<string>(LABEL_KEY)) ?? defaultLabel();
      cached = { id, label };
      return cached;
    },
    async setLabel(label: string): Promise<void> {
      const clean = label.trim().slice(0, 60) || defaultLabel();
      await repos.sync.setState(LABEL_KEY, clean);
      if (cached) cached = { ...cached, label: clean };
    },
  };
}
