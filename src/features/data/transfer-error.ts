import { VaultError } from "@/lib/crypto/vault";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { getErrorMessage } from "@/lib/i18n/error-message";
import { TransferError } from "@/lib/transfer/errors";

export function transferErrorMessage(error: unknown, t: Dictionary): string {
  if (error instanceof TransferError) return t.data.errors[error.code];
  if (error instanceof VaultError) return t.errors.vault;
  if (error instanceof Error && error.message === "file-too-large") return t.data.errors.too_large;
  return getErrorMessage(error, t);
}
