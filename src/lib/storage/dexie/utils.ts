import type { z } from "zod";
import { StorageError } from "../errors";

type Schema<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

export function parseOrThrow<T>(schema: Schema<T>, data: unknown, entity: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new StorageError("VALIDATION", `Invalid ${entity}: ${details}`, { cause: result.error });
  }
  return result.data;
}

/** Reads defensively: corrupted rows are skipped instead of crashing the whole list. */
export function parseRecords<T>(schema: Schema<T>, rows: unknown[], entity: string): T[] {
  const valid: T[] = [];
  let skipped = 0;
  for (const row of rows) {
    const result = schema.safeParse(row);
    if (result.success) valid.push(result.data);
    else skipped += 1;
  }
  if (skipped > 0) console.warn(`[storage] Skipped ${skipped} invalid ${entity} record(s)`);
  return valid;
}
