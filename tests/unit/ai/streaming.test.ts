// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { collect, hangingStream, recordingHttp, sse, streamOf } from "@tests/helpers/streams";
import { ProviderError, codeForStatus, errorFromResponse, parseRetryAfter, toProviderError } from "@/lib/ai/errors";
import { createProvider } from "@/lib/ai/factory";
import { computeBackoff, withRetry } from "@/lib/ai/retry";
import type { ChatRequest, HttpClient } from "@/lib/ai/types";

const request: ChatRequest = { model: "m", messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }] };
const ok = () => new Response(streamOf([sse([{ data: { choices: [{ delta: { content: "ok" } }] } }, { data: "[DONE]" }])]));
const providerWith = (http: HttpClient) =>
  createProvider({ id: "p", name: "P", kind: "openai", baseUrl: "https://api.test/v1", apiKey: "sk-super-secret-value-123", transport: "direct" }, http);

describe("HTTP error mapping", () => {
  it.each([
    [400, "bad_request", false],
    [401, "unauthorized", false],
    [403, "forbidden", false],
    [404, "not_found", false],
    [408, "timeout", true],
    [429, "rate_limited", true],
    [500, "server", true],
    [502, "server", true],
    [503, "server", true],
  ] as const)("HTTP %i -> %s (retryable=%s)", async (status, code, retryable) => {
    expect(codeForStatus(status)).toBe(code);
    const error = await errorFromResponse(new Response('{"error":{"message":"nope"}}', { status }));
    expect(error).toMatchObject({ code, status, retryable });
    expect(error.message).toContain("nope");
  });

  it("501 is never retried", async () => {
    expect((await errorFromResponse(new Response("", { status: 501 }))).retryable).toBe(false);
  });

  it("parses Retry-After seconds, dates and retry-after-ms", () => {
    expect(parseRetryAfter(new Headers({ "retry-after": "3" }))).toBe(3000);
    expect(parseRetryAfter(new Headers({ "retry-after-ms": "250" }))).toBe(250);
    const now = Date.UTC(2026, 0, 1);
    expect(parseRetryAfter(new Headers({ "retry-after": new Date(now + 5000).toUTCString() }), now)).toBe(5000);
    expect(parseRetryAfter(new Headers())).toBeUndefined();
  });

  it("redacts secrets echoed back by providers", async () => {
    const error = await errorFromResponse(
      new Response('{"error":{"message":"Incorrect API key provided: sk-super-secret-value-123"}}', { status: 401 }),
      ["sk-super-secret-value-123"],
    );
    expect(error.message).not.toContain("super-secret");
  });

  it("classifies fetch TypeErrors as network and AbortError as aborted", () => {
    expect(toProviderError(new TypeError("Failed to fetch")).code).toBe("network");
    expect(toProviderError(new DOMException("x", "AbortError")).code).toBe("aborted");
  });
});

describe("retry/backoff", () => {
  it("computes exponential backoff with jitter and a cap", () => {
    const opts = { baseDelayMs: 100, maxDelayMs: 1000, random: () => 1 };
    expect([0, 1, 2, 3, 4].map((a) => computeBackoff(a, opts))).toEqual([100, 200, 400, 800, 1000]);
    expect(computeBackoff(0, { ...opts, random: () => 0 })).toBe(50);
    expect(computeBackoff(5, { ...opts, retryAfterMs: 1500 })).toBe(1500);
  });

  it("retries retryable errors and stops on success", async () => {
    const sleep = vi.fn(async () => undefined);
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new ProviderError("server", "boom");
        return "done";
      },
      { retries: 3, sleep },
    );
    expect(result).toBe("done");
    expect(attempts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable errors", async () => {
    const sleep = vi.fn(async () => undefined);
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new ProviderError("unauthorized", "no");
        },
        { retries: 5, sleep },
      ),
    ).rejects.toMatchObject({ code: "unauthorized" });
    expect(attempts).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries 500/429 before streaming, but never 401", async () => {
    const flaky = recordingHttp([
      () => new Response("down", { status: 500, headers: { "retry-after-ms": "1" } }),
      () => new Response("slow down", { status: 429, headers: { "retry-after-ms": "1" } }),
      ok,
    ]);
    const events = await collect(providerWith(flaky.http).streamChat(request, { retry: { retries: 2, baseDelayMs: 1 } }));
    expect(flaky.requests).toHaveLength(3);
    expect(events.some((e) => e.type === "text-delta")).toBe(true);

    const unauthorized = recordingHttp([() => new Response('{"error":{"message":"bad key"}}', { status: 401 })]);
    await expect(collect(providerWith(unauthorized.http).streamChat(request, { retry: { retries: 3 } }))).rejects.toMatchObject({
      code: "unauthorized",
      status: 401,
    });
    expect(unauthorized.requests).toHaveLength(1);
  });

  it("gives up after the retry budget", async () => {
    const down = recordingHttp([() => new Response("", { status: 503, headers: { "retry-after-ms": "1" } })]);
    await expect(collect(providerWith(down.http).streamChat(request, { retry: { retries: 1 } }))).rejects.toMatchObject({ code: "server" });
    expect(down.requests).toHaveLength(2);
  });
});

describe("cancellation and timeouts", () => {
  it("AbortController stops an active stream with code=aborted", async () => {
    const controller = new AbortController();
    const http: HttpClient = async (_url, init) =>
      new Response(hangingStream(sse([{ data: { choices: [{ delta: { content: "first" } }] } }]), init.signal));
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const event of providerWith(http).streamChat(request, { signal: controller.signal })) {
          if (event.type === "text-delta") {
            seen.push(event.text);
            controller.abort();
          }
        }
      })(),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(seen).toEqual(["first"]);
  });

  it("aborting before the response arrives cancels without retrying", async () => {
    const controller = new AbortController();
    let calls = 0;
    const http: HttpClient = (_url, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("x", "AbortError"))));
    };
    const promise = collect(providerWith(http).streamChat(request, { signal: controller.signal, retry: { retries: 3 } }));
    setTimeout(() => controller.abort(), 10);
    await expect(promise).rejects.toMatchObject({ code: "aborted" });
    expect(calls).toBe(1);
  });

  it("times out waiting for headers", async () => {
    const http: HttpClient = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("x", "AbortError"))));
    await expect(collect(providerWith(http).streamChat(request, { timeoutMs: 20, retry: { retries: 0 } }))).rejects.toMatchObject({ code: "timeout" });
  });

  it("times out when the stream goes silent", async () => {
    const http: HttpClient = async (_url, init) => new Response(hangingStream("", init.signal));
    await expect(collect(providerWith(http).streamChat(request, { idleTimeoutMs: 20 }))).rejects.toMatchObject({ code: "timeout" });
  });
});
