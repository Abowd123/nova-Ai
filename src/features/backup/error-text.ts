"use client";

import { useI18n } from "@/hooks/use-i18n";
import { WebDavError } from "@/lib/webdav/client";
import { BackupError } from "./errors";

export function useBackupErrorText() {
  const { t } = useI18n();
  return (error: unknown): string => {
    if (error instanceof BackupError) return t.backup.errors[error.code];
    if (error instanceof WebDavError) return t.backup.davErrors[error.code];
    return error instanceof Error ? error.message : t.errors.generic;
  };
}

