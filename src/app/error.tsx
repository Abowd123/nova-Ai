"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { useI18n } from "@/hooks/use-i18n";

export default function GlobalRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    // Log only the digest; never echo raw messages that could contain user data.
    console.error("[app] Unhandled route error", error.digest ?? "no-digest");
  }, [error]);
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <ErrorState
        title={t.errors.generic}
        description={t.errors.genericDescription}
        retryLabel={t.common.retry}
        onRetry={reset}
      />
    </main>
  );
}
