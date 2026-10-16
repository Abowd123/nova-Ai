import type { HapticKind, NativeBridge, Platform, SaveFileResult } from "./types";
import { webShare } from "./web-bridge";
import { safeFileName } from "./file-names";

export { safeFileName };

/**
 * Capacitor implementation. Plugins are imported lazily so the web bundle never loads them
 * and the web build works without a native shell.
 */
type Unsub = () => void;
type Handle = { remove: () => Promise<void> | void };

function subscribe(register: () => Promise<Handle>): Unsub {
  let handle: Handle | null = null;
  let cancelled = false;
  void register()
    .then((h) => {
      if (cancelled) void h.remove();
      else handle = h;
    })
    .catch(() => undefined);
  return () => {
    cancelled = true;
    void handle?.remove();
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export function createCapacitorBridge(platform: Exclude<Platform, "web">): NativeBridge {
  return {
    platform,
    isNative: true,

    async saveFile(name, data, options = {}): Promise<SaveFileResult> {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const fileName = safeFileName(name);
      const path = `Nova/${fileName}`;
      // Documents/Nova is visible in the Files app; falls back to app cache if storage is restricted.
      let written: { uri: string };
      try {
        written = await Filesystem.writeFile({ path, data: await blobToBase64(data), directory: Directory.Documents, recursive: true });
      } catch {
        written = await Filesystem.writeFile({ path, data: await blobToBase64(data), directory: Directory.Cache, recursive: true });
        options = { ...options, share: true };
      }
      if (!options.share) return "saved";
      const { Share } = await import("@capacitor/share");
      try {
        await Share.share({ title: fileName, files: [written.uri] });
        return "shared";
      } catch {
        return "cancelled";
      }
    },

    async share(input) {
      const { Share } = await import("@capacitor/share");
      if (!(await Share.canShare()).value) return webShare(input);
      try {
        let files: string[] | undefined;
        if (input.files?.length) {
          const { Filesystem, Directory } = await import("@capacitor/filesystem");
          files = [];
          for (const file of input.files) {
            const result = await Filesystem.writeFile({ path: `share/${safeFileName(file.name)}`, data: await blobToBase64(file.data), directory: Directory.Cache, recursive: true });
            files.push(result.uri);
          }
        }
        await Share.share({ title: input.title, text: input.text, url: input.url, files });
        return "shared";
      } catch {
        return "cancelled";
      }
    },

    async haptic(kind: HapticKind) {
      const { Haptics, ImpactStyle, NotificationType } = await import("@capacitor/haptics");
      if (kind === "light" || kind === "medium") await Haptics.impact({ style: kind === "light" ? ImpactStyle.Light : ImpactStyle.Medium });
      else await Haptics.notification({ type: kind === "success" ? NotificationType.Success : kind === "warning" ? NotificationType.Warning : NotificationType.Error });
    },

    async notify({ id, title, body, route }) {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      if ((await LocalNotifications.checkPermissions()).display !== "granted") return false;
      await LocalNotifications.schedule({ notifications: [{ id, title, body, extra: route ? { route } : undefined, smallIcon: "ic_stat_nova" }] });
      return true;
    },

    async requestNotifications() {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const current = await LocalNotifications.checkPermissions();
      if (current.display === "granted") return true;
      return (await LocalNotifications.requestPermissions()).display === "granted";
    },

    async openExternal(url) {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url });
    },

    onBackButton: (handler) => subscribe(async () => (await import("@capacitor/app")).App.addListener("backButton", ({ canGoBack }) => handler({ canGoBack }))),
    onAppState: (handler) => subscribe(async () => (await import("@capacitor/app")).App.addListener("appStateChange", ({ isActive }) => handler(isActive))),
    onDeepLink: (handler) => subscribe(async () => (await import("@capacitor/app")).App.addListener("appUrlOpen", ({ url }) => handler(url))),
    onNetwork: (handler) => subscribe(async () => (await import("@capacitor/network")).Network.addListener("networkStatusChange", ({ connected }) => handler(connected))),
    onKeyboard(handler) {
      const show = subscribe(async () => (await import("@capacitor/keyboard")).Keyboard.addListener("keyboardWillShow", ({ keyboardHeight }) => handler(true, keyboardHeight)));
      const hide = subscribe(async () => (await import("@capacitor/keyboard")).Keyboard.addListener("keyboardWillHide", () => handler(false, 0)));
      return () => {
        show();
        hide();
      };
    },
    onNotificationTap: (handler) =>
      subscribe(async () =>
        (await import("@capacitor/local-notifications")).LocalNotifications.addListener("localNotificationActionPerformed", ({ notification }) => {
          const route = (notification.extra as { route?: unknown } | undefined)?.route;
          handler(typeof route === "string" && route.startsWith("/") ? route : null);
        }),
      ),

    async setStatusBar(theme, color) {
      const { StatusBar, Style } = await import("@capacitor/status-bar");
      await StatusBar.setOverlaysWebView({ overlay: false });
      await StatusBar.setStyle({ style: theme === "dark" ? Style.Dark : Style.Light });
      if (platform === "android") await StatusBar.setBackgroundColor({ color });
    },

    async hideSplash() {
      const { SplashScreen } = await import("@capacitor/splash-screen");
      await SplashScreen.hide({ fadeOutDuration: 200 });
    },

    async exitApp() {
      const { App } = await import("@capacitor/app");
      await App.exitApp();
    },
  };
}
