import { describe, expect, it } from "vitest";
import { z } from "zod";
import { StorageError, toStorageError, withStorageErrors } from "@/lib/storage/errors";

function named(name: string, message = name) {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe("toStorageError", () => {
  it.each([
    ["QuotaExceededError", "QUOTA_EXCEEDED"],
    ["ConstraintError", "CONSTRAINT"],
    ["VersionError", "VERSION_CONFLICT"],
    ["MissingAPIError", "UNAVAILABLE"],
    ["DatabaseClosedError", "UNAVAILABLE"],
    ["OpenFailedError", "UNAVAILABLE"],
    ["InvalidStateError", "UNAVAILABLE"],
  ])("maps %s to %s", (name, code) => {
    expect(toStorageError(named(name)).code).toBe(code);
  });

  it("inspects Dexie inner errors", () => {
    const wrapper = Object.assign(named("AbortError"), { inner: named("QuotaExceededError") });
    expect(toStorageError(wrapper).code).toBe("QUOTA_EXCEEDED");
  });

  it("maps Zod errors to VALIDATION", () => {
    const result = z.string().safeParse(1);
    expect(result.success).toBe(false);
    if (!result.success) expect(toStorageError(result.error).code).toBe("VALIDATION");
  });

  it("falls back to UNKNOWN and keeps the cause", () => {
    const original = new Error("boom");
    const mapped = toStorageError(original);
    expect(mapped.code).toBe("UNKNOWN");
    expect(mapped.cause).toBe(original);
  });

  it("passes StorageError through untouched", () => {
    const error = new StorageError("NOT_FOUND", "x");
    expect(toStorageError(error)).toBe(error);
  });

  it("withStorageErrors converts thrown errors", async () => {
    await expect(
      withStorageErrors(async () => {
        throw named("QuotaExceededError");
      }),
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
  });
});
