"use client";

import { useCallback, useEffect, useState } from "react";

export const INSTALL_PROMPT_EVENT = "nova:installprompt";

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    navigator.standalone === true
  );
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) && !/crios|fxios/i.test(ua);
}

/**
 * The boot script captures `beforeinstallprompt` before React mounts
 * (window.__novaInstallPrompt) so the event is never missed.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    setIos(isIosSafari());
    setDeferred(window.__novaInstallPrompt ?? null);

    const onCaptured = () => setDeferred(window.__novaInstallPrompt ?? null);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      window.__novaInstallPrompt = event as BeforeInstallPromptEvent;
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      window.__novaInstallPrompt = null;
      setDeferred(null);
      setInstalled(true);
    };

    window.addEventListener(INSTALL_PROMPT_EVENT, onCaptured);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener(INSTALL_PROMPT_EVENT, onCaptured);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    if (!deferred) return "unavailable";
    await deferred.prompt();
    const choice = await deferred.userChoice;
    window.__novaInstallPrompt = null;
    setDeferred(null);
    return choice.outcome;
  }, [deferred]);

  return { canInstall: Boolean(deferred) && !installed, installed, isIos: ios, promptInstall };
}
