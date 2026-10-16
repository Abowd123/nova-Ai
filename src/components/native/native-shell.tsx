"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useServices } from "@/components/providers/services-provider";
import { toast } from "@/components/ui/use-toast";
import { clientEnv } from "@/env";
import { useSettings } from "@/features/settings/queries";
import { useToolStore } from "@/features/chat/engine/tool-store";
import { useI18n } from "@/hooks/use-i18n";
import { CrashReporter } from "@/lib/crash/reporter";
import { getBridge } from "@/lib/native";
import { closeOverlay, decideBack, findOpenOverlay } from "@/lib/native/back";
import { haptic, setHapticsEnabled } from "@/lib/native/feedback";
import { externalAnchorFor } from "@/lib/native/links";
import { chatHref } from "@/lib/routes";
import { logger } from "@/lib/logger";

const STATUS_COLORS = { light: "#FEF7FF", dark: "#141218" } as const;

/**
 * Glue between the app and the platform (Android via Capacitor; harmless on the web):
 * crash capture, back button, external links, status bar, splash, keyboard, lifecycle,
 * haptics and reply notifications.
 */
export function NativeShell() {
  const services = useServices();
  const router = useRouter();
  const pathname = usePathname();
  const { resolvedTheme } = useTheme();
  const { t } = useI18n();
  const settings = useSettings();
  const state = useRef({ pathname, lastBackAt: null as number | null, t, notifyOnReply: false, crashReports: false });
  state.current.pathname = pathname;
  state.current.t = t;
  state.current.notifyOnReply = settings.data?.device.notifyOnReply ?? false;
  state.current.crashReports = settings.data?.device.crashReports ?? false;
  const bridge = getBridge();

  // Settings → module flags.
  useEffect(() => setHapticsEnabled(settings.data?.device.haptics ?? true), [settings.data?.device.haptics]);

  // Crash capture (web + native). Sending is opt-in and needs an https endpoint.
  useEffect(() => {
    const reporter = new CrashReporter({
      store: window.localStorage,
      endpoint: clientEnv.NEXT_PUBLIC_CRASH_ENDPOINT,
      optedIn: async () => state.current.crashReports,
      context: () => ({ pathname: window.location.pathname, version: clientEnv.NEXT_PUBLIC_APP_VERSION, platform: bridge.platform, userAgent: navigator.userAgent }),
    });
    return reporter.install();
  }, [bridge]);

  // Native-only behaviour below.
  useEffect(() => {
    if (!bridge.isNative) return;
    document.documentElement.classList.add("native-app", `platform-${bridge.platform}`);
    void bridge.hideSplash().catch(() => undefined);

    const offBack = bridge.onBackButton(({ canGoBack }) => {
      const action = decideBack({ overlayOpen: findOpenOverlay() !== null, canGoBack, pathname: state.current.pathname, lastPressAt: state.current.lastBackAt, now: Date.now() });
      if (action === "close-overlay") closeOverlay();
      else if (action === "history-back") window.history.back();
      else if (action === "exit") void bridge.exitApp();
      else {
        state.current.lastBackAt = Date.now();
        toast({ title: state.current.t.native.pressBackAgain, duration: 2000 });
      }
    });

    // External links → system browser (never navigate the app WebView away).
    const onClick = (event: MouseEvent) => {
      const anchor = externalAnchorFor(event, window.location.origin);
      if (!anchor) return;
      event.preventDefault();
      void bridge.openExternal(anchor.href);
    };
    document.addEventListener("click", onClick, true);

    const offKeyboard = bridge.onKeyboard((visible, height) => {
      document.documentElement.style.setProperty("--keyboard-height", `${visible ? height : 0}px`);
      document.documentElement.classList.toggle("keyboard-open", visible);
    });

    const offState = bridge.onAppState((active) => {
      if (!active) return;
      // Back from background: recover streams the OS may have killed, run due backups/sync.
      void services().chat.recoverInterrupted().catch((error: unknown) => logger.warn("Resume recovery failed", error));
      void services().scheduler.tick();
    });

    const offTap = bridge.onNotificationTap((route) => route && router.push(route));

    return () => {
      offBack();
      offKeyboard();
      offState();
      offTap();
      document.removeEventListener("click", onClick, true);
    };
  }, [bridge, router, services]);

  // Status bar follows the theme.
  useEffect(() => {
    if (!bridge.isNative || !resolvedTheme) return;
    const theme = resolvedTheme === "dark" ? "dark" : "light";
    void bridge.setStatusBar(theme, STATUS_COLORS[theme]).catch(() => undefined);
  }, [bridge, resolvedTheme]);

  // Reply finished: haptic in the foreground, local notification in the background (opt-in).
  useEffect(
    () =>
      services().onReply((info) => {
        if (document.visibilityState === "visible") {
          haptic("success");
          return;
        }
        if (!state.current.notifyOnReply) return;
        const body = info.text.replace(/\s+/g, " ").trim().slice(0, 140) || state.current.t.native.replyReady;
        void bridge.notify({ id: Math.floor(Date.now() % 2_000_000_000), title: state.current.t.native.replyReady, body, route: chatHref(info.conversationId) });
      }),
    [bridge, services],
  );

  // Approval needed: warning haptic.
  useEffect(() => {
    let count = Object.keys(useToolStore.getState().approvals).length;
    return useToolStore.subscribe((s) => {
      const next = Object.keys(s.approvals).length;
      if (next > count) haptic("warning");
      count = next;
    });
  }, []);

  return null;
}
