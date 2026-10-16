"use client";

import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/use-toast";
import { clientEnv } from "@/env";
import { useI18n } from "@/hooks/use-i18n";
import { isServiceWorkerEnabled, serviceWorkerUrl } from "./sw-config";
import { isNativeApp } from "@/lib/platform";

export function ServiceWorkerRegistrar() {
  const { t } = useI18n();
  const tRef = useRef(t);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    // The Android app serves files from the APK: no service worker needed.
    if (!("serviceWorker" in navigator) || isNativeApp()) return;
    const container = navigator.serviceWorker;

    if (!isServiceWorkerEnabled(clientEnv.NEXT_PUBLIC_ENABLE_SW, process.env.NODE_ENV)) {
      // Dev safety: remove any previously installed worker so caches never go stale.
      void container
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
        .catch(() => undefined);
      return;
    }

    const hadController = Boolean(container.controller);
    let notified = false;
    const onControllerChange = () => {
      if (!hadController || notified) return;
      notified = true;
      toast({
        title: tRef.current.pwa.updateReady,
        description: tRef.current.pwa.updateDescription,
        duration: Number.POSITIVE_INFINITY,
        action: { label: tRef.current.pwa.reload, onClick: () => window.location.reload() },
      });
    };
    container.addEventListener("controllerchange", onControllerChange);

    container
      .register(serviceWorkerUrl(clientEnv.NEXT_PUBLIC_BUILD_ID), { scope: "/", updateViaCache: "none" })
      .catch((error: unknown) => console.error("[pwa] Service worker registration failed", error));

    return () => container.removeEventListener("controllerchange", onControllerChange);
  }, []);

  return null;
}
