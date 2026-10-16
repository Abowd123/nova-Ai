import { describe, expect, it } from "vitest";
import { parseClientEnv } from "@/env";
import { parseServerEnv } from "@/env.server";

describe("client env", () => {
  it("applies defaults when nothing is set", () => {
    expect(parseClientEnv({})).toEqual({
      NEXT_PUBLIC_APP_NAME: "Nova",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_ENABLE_SW: "auto",
      NEXT_PUBLIC_DEFAULT_LOCALE: "ar",
      NEXT_PUBLIC_BUILD_ID: "dev",
      NEXT_PUBLIC_APP_VERSION: "0.1.0",
    });
  });

  it("treats empty strings as unset", () => {
    expect(parseClientEnv({ NEXT_PUBLIC_APP_URL: "  " }).NEXT_PUBLIC_APP_URL).toBe(
      "http://localhost:3000",
    );
  });

  it("accepts valid overrides", () => {
    const env = parseClientEnv({
      NEXT_PUBLIC_APP_URL: "https://nova.example.com",
      NEXT_PUBLIC_ENABLE_SW: "never",
      NEXT_PUBLIC_DEFAULT_LOCALE: "en",
    });
    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://nova.example.com");
    expect(env.NEXT_PUBLIC_ENABLE_SW).toBe("never");
    expect(env.NEXT_PUBLIC_DEFAULT_LOCALE).toBe("en");
  });

  it("rejects invalid values with a readable message", () => {
    expect(() => parseClientEnv({ NEXT_PUBLIC_APP_URL: "not-a-url" })).toThrow(/NEXT_PUBLIC_APP_URL/);
    expect(() => parseClientEnv({ NEXT_PUBLIC_ENABLE_SW: "sometimes" })).toThrow(/NEXT_PUBLIC_ENABLE_SW/);
    expect(() => parseClientEnv({ NEXT_PUBLIC_DEFAULT_LOCALE: "fr" })).toThrow();
  });
});

describe("server env", () => {
  it("validates NODE_ENV", () => {
    expect(parseServerEnv({ NODE_ENV: "production" }).NODE_ENV).toBe("production");
    expect(() => parseServerEnv({ NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
});
