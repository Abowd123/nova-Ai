// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";
import { redactSecrets, redactUnknown } from "@/lib/security/redact";

describe("redactSecrets", () => {
  it.each([
    ["OpenAI key sk-proj-abcdefghijklmnop", "sk-proj-abcdefghijklmnop"],
    ["Anthropic sk-ant-api03-ABCDEFGHIJKL", "sk-ant-api03-ABCDEFGHIJKL"],
    ["OpenRouter sk-or-v1-0123456789abcdef", "sk-or-v1-0123456789abcdef"],
    ["Gemini AIzaSyA1234567890123456789012345", "AIzaSyA1234567890123456789012345"],
    ["Authorization: Bearer eyJhbGciOi.payload.sig", "eyJhbGciOi.payload.sig"],
    ["https://x.test/v1?key=SECRETVALUE123&a=1", "SECRETVALUE123"],
    ['{"api_key": "zzzz-1234-yyyy"}', "zzzz-1234-yyyy"],
    ["x-api-key: hunter2hunter2", "hunter2hunter2"],
  ])("removes %s", (input, secret) => {
    expect(redactSecrets(input)).not.toContain(secret);
  });

  it("removes explicitly known secrets of any shape", () => {
    expect(redactSecrets("token is abc-custom-9", ["abc-custom-9"])).toBe("token is ***");
  });

  it("leaves normal text alone", () => {
    expect(redactSecrets("The model gpt-4o returned 429 Too Many Requests")).toBe("The model gpt-4o returned 429 Too Many Requests");
  });

  it("redacts Error objects and JSON", () => {
    expect(redactUnknown(new Error("bad sk-abcdefghijklmnop"))).toBe("Error: bad sk-***");
    expect(redactUnknown({ headers: { Authorization: "Bearer abcdefghijk" } })).not.toContain("abcdefghijk");
  });

  it("the logger never prints secrets", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    logger.warn("failed with sk-abcdefghijklmnop", new Error("Bearer abcdefghijklmn"));
    const printed = JSON.stringify(warn.mock.calls);
    expect(printed).not.toContain("abcdefghijklmnop");
    expect(printed).not.toContain("abcdefghijklmn");
  });
});
