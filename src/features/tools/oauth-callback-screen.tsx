"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { useServices } from "@/components/providers/services-provider";
import { useI18n } from "@/hooks/use-i18n";
import { onDeepLink } from "@/lib/platform";

/** /oauth/callback: finishes an MCP OAuth sign-in (code → tokens) and returns to the MCP screen. */
export function OAuthCallbackScreen() {
  const { t } = useI18n();
  const services = useServices();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const href = window.location.href;
    // Remove code/state from the address bar and history right away.
    window.history.replaceState(null, "", "/oauth/callback");
    services()
      .mcp.completeAuthorization(href)
      .then((serverId) => router.replace(`/settings/mcp?connected=${encodeURIComponent(serverId)}`))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : t.errors.generic));
  }, [services, router, t]);

  if (error) return <ErrorState title={t.mcp.signInFailed} description={error} retryLabel={t.mcp.backToServers} onRetry={() => router.replace("/settings/mcp")} />;
  return <LoadingState label={t.mcp.finishingSignIn} rows={1} />;
}

/** Native app: OAuth redirects come back as deep links (app.nova.assistant://oauth/callback?…). */
export function OAuthDeepLinkListener() {
  const services = useServices();
  const router = useRouter();
  useEffect(
    () =>
      onDeepLink((url) => {
        if (!url.includes("oauth/callback")) return;
        void services()
          .mcp.completeAuthorization(url)
          .then((serverId) => router.replace(`/settings/mcp?connected=${encodeURIComponent(serverId)}`))
          .catch(() => router.replace("/settings/mcp?error=oauth"));
      }),
    [services, router],
  );
  return null;
}
