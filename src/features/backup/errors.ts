import { WebDavError } from "@/lib/webdav/client";

export type BackupErrorCode =
  | "not_configured"
  | "passphrase_required"
  | "wrong_passphrase"
  | "corrupted"
  | "newer_version"
  | "busy"
  | "offline"
  | "not_found"
  | "compression_unavailable";

export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "BackupError";
  }
}

export function isBackupOrDavError(error: unknown): error is BackupError | WebDavError {
  return error instanceof BackupError || error instanceof WebDavError;
}
