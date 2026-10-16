import { describe, expect, it } from "vitest";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getErrorMessage } from "@/lib/i18n/error-message";
import { getDirection, isLocale } from "@/lib/i18n/locale";
import { StorageError } from "@/lib/storage/errors";

function shape(value: unknown): unknown {
  if (typeof value === "function") return "fn";
  if (Array.isArray(value)) return `array:${value.length}`;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, shape(child)]),
    );
  }
  return typeof value;
}

describe("i18n", () => {
  it("ar and en dictionaries have identical keys", () => {
    expect(shape(dictionaries.en)).toEqual(shape(dictionaries.ar));
  });

  it("maps locale to direction", () => {
    expect(getDirection("ar")).toBe("rtl");
    expect(getDirection("en")).toBe("ltr");
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("fr")).toBe(false);
  });

  it("never leaks raw error messages", () => {
    const secret = new Error("sk-live-SECRET in message");
    expect(getErrorMessage(secret, dictionaries.en)).toBe(dictionaries.en.errors.generic);
    expect(getErrorMessage(new StorageError("QUOTA_EXCEEDED", "x"), dictionaries.en)).toBe(
      dictionaries.en.errors.storage.QUOTA_EXCEEDED,
    );
  });
});
