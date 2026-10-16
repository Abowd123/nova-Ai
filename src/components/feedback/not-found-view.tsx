"use client";

import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { EmptyState } from "./empty-state";

export function NotFoundView() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <h1 className="sr-only">{t.errors.notFoundTitle}</h1>
      <EmptyState
        icon={FileQuestion}
        title={t.errors.notFoundTitle}
        description={t.errors.notFoundDescription}
        action={
          <Button asChild>
            <Link href="/chat">{t.chat.backToChats}</Link>
          </Button>
        }
      />
    </main>
  );
}
