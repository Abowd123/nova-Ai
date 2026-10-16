import { getBridge } from "@/lib/native";
import { detectPlatform } from "@/lib/native/types";

/** Capacitor native shell (Android APK) vs. browser / PWA. */
export function isNativeApp(): boolean {
  return detectPlatform() !== "web";
}

/** Opens an external URL: system browser / Custom Tab in the app, same tab on the web (OAuth returns to /oauth/callback). */
export async function openExternal(url: string): Promise<void> {
  if (isNativeApp()) await getBridge().openExternal(url);
  else window.location.assign(url);
}

/** Deep links (app.nova.assistant://…) in the native app. Returns an unsubscribe function. */
export function onDeepLink(handler: (url: string) => void): () => void {
  return getBridge().onDeepLink(handler);
}
