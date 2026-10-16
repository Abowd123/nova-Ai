// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RateLimiter } from "@/lib/security/rate-limit";
import { checkResolvedHost, checkTargetUrl, isPrivateAddress } from "@/lib/security/ssrf";

const strict = { allowPrivate: false, allowedHosts: [] as string[] };

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.5",
    "172.16.4.4",
    "172.31.255.255",
    "192.168.0.1",
    "169.254.169.254",
    "100.64.1.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "not-an-ip",
  ])("%s is private", (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("%s is public", (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe("checkTargetUrl", () => {
  it("accepts public https targets", () => {
    expect(checkTargetUrl("https://api.openai.com/v1/chat/completions", strict).ok).toBe(true);
  });

  it.each([
    [null, "Missing"],
    ["not a url", "Invalid"],
    ["http://api.openai.com", "https"],
    ["file:///etc/passwd", "https"],
    ["https://user:pass@api.example.com", "Credentials"],
    ["https://localhost:11434", "Private"],
    ["https://metadata.internal", "Private"],
    ["https://127.0.0.1", "Private"],
    ["https://[::1]/", "Private"],
    ["https://169.254.169.254/latest/meta-data", "Private"],
  ])("rejects %s", (url, reason) => {
    const result = checkTargetUrl(url, strict);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(reason);
  });

  it("enforces the host allowlist", () => {
    const policy = { allowPrivate: false, allowedHosts: ["api.openai.com"] };
    expect(checkTargetUrl("https://api.openai.com/v1", policy).ok).toBe(true);
    expect(checkTargetUrl("https://evil.example/v1", policy).ok).toBe(false);
  });

  it("allows http + private hosts only when explicitly enabled", () => {
    expect(checkTargetUrl("http://localhost:11434/api/chat", { allowPrivate: true, allowedHosts: [] }).ok).toBe(true);
  });
});

describe("checkResolvedHost (DNS rebinding)", () => {
  it("rejects hostnames that resolve to any private address", async () => {
    const lookup = async () => [{ address: "93.184.216.34" }, { address: "10.0.0.1" }];
    expect((await checkResolvedHost("sneaky.example", strict, lookup)).ok).toBe(false);
  });

  it("accepts hostnames resolving to public addresses only", async () => {
    expect((await checkResolvedHost("api.example", strict, async () => [{ address: "93.184.216.34" }])).ok).toBe(true);
  });

  it("rejects unresolvable hosts", async () => {
    const lookup = async () => {
      throw new Error("ENOTFOUND");
    };
    expect((await checkResolvedHost("nope.example", strict, lookup)).ok).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("allows up to the limit per window, then blocks with retry info", () => {
    let now = 0;
    const limiter = new RateLimiter(2, 1000, () => now);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    const blocked = limiter.check("a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(1000);
    expect(limiter.check("b").allowed).toBe(true);
    now = 1001;
    expect(limiter.check("a").allowed).toBe(true);
  });
});
