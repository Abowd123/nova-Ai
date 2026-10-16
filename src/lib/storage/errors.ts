import { ZodError } from "zod";

export type StorageErrorCode =
  | "NOT_FOUND"
  | "VALIDATION"
  | "QUOTA_EXCEEDED"
  | "UNAVAILABLE"
  | "VERSION_CONFLICT"
  | "CONSTRAINT"
  | "UNKNOWN";

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageError";
    this.code = code;
  }
}

const NAME_TO_CODE: Record<string, StorageErrorCode> = {
  QuotaExceededError: "QUOTA_EXCEEDED",
  ConstraintError: "CONSTRAINT",
  VersionError: "VERSION_CONFLICT",
  UpgradeError: "VERSION_CONFLICT",
  MissingAPIError: "UNAVAILABLE",
  DatabaseClosedError: "UNAVAILABLE",
  OpenFailedError: "UNAVAILABLE",
  InvalidStateError: "UNAVAILABLE",
  SecurityError: "UNAVAILABLE",
  NotFoundError: "NOT_FOUND",
  DataError: "VALIDATION",
};

function errorName(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = (error as { name: unknown }).name;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
}

/** Maps Dexie / IndexedDB / Zod errors to a stable, UI-friendly StorageError. */
export function toStorageError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  if (error instanceof ZodError) {
    return new StorageError("VALIDATION", "Invalid data", { cause: error });
  }

  const candidates = [error, (error as { inner?: unknown } | null)?.inner];
  for (const candidate of candidates) {
    const name = errorName(candidate);
    if (name && NAME_TO_CODE[name]) {
      const message = candidate instanceof Error ? candidate.message : name;
      return new StorageError(NAME_TO_CODE[name], message, { cause: error });
    }
  }

  const message = error instanceof Error ? error.message : "Unknown storage error";
  return new StorageError("UNKNOWN", message, { cause: error });
}

export async function withStorageErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw toStorageError(error);
  }
}

export function notFound(entity: string, id: string): StorageError {
  return new StorageError("NOT_FOUND", `${entity} "${id}" was not found`);
}
