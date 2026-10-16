import { MemoryError } from "@/features/memory/memory-service";
import { VaultError } from "@/lib/crypto/vault";
import { ImageGenError } from "@/lib/imagegen/types";
import { SttError } from "@/lib/speech/stt-types";
import { TtsError } from "@/lib/speech/tts-types";
import { StorageError } from "@/lib/storage/errors";
import type { Dictionary } from "./dictionaries";

/** Never surfaces raw error messages (they may contain sensitive data). */
export function getErrorMessage(error: unknown, t: Dictionary): string {
  if (error instanceof StorageError) return t.errors.storage[error.code];
  if (error instanceof VaultError) return t.errors.vault;
  if (error instanceof ImageGenError) return t.images.errors[error.code];
  if (error instanceof SttError) return t.speech.errors[error.code];
  if (error instanceof TtsError) return t.speech.ttsErrors[error.code];
  if (error instanceof MemoryError) return t.memorySettings.errors[error.code];
  return t.errors.generic;
}
