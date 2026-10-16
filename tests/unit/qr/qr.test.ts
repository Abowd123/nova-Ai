// @vitest-environment node
import { describe, expect, it } from "vitest";
import { provider } from "@tests/helpers/fixtures";
import { decodeBase45, encodeBase45 } from "@/lib/qr/base45";
import { ChunkCollector, encodeChunks, parseChunk } from "@/lib/qr/chunks";
import { crc32Hex } from "@/lib/qr/crc32";
import { buildProviderPayload, decodeProviderPayload, encodeProviderPayload, payloadHasSecrets } from "@/lib/qr/provider-share";

const text = (s: string) => new TextEncoder().encode(s);
const data = new Uint8Array(2500).map((_, i) => (i * 31 + 7) % 256);

function corrupt(chunk: string): string {
  const last = chunk.at(-1);
  return chunk.slice(0, -1) + (last === "A" ? "B" : "A");
}

describe("base45 (RFC 9285)", () => {
  it("matches the RFC test vectors", () => {
    expect(encodeBase45(text("AB"))).toBe("BB8");
    expect(encodeBase45(text("Hello!!"))).toBe("%69 VD92EX0");
    expect(encodeBase45(text("base-45"))).toBe("UJCLQE7W581");
    expect(new TextDecoder().decode(decodeBase45("QED8WEX0"))).toBe("ietf!");
  });
  it("round-trips arbitrary bytes and rejects invalid input", () => {
    expect(decodeBase45(encodeBase45(data))).toEqual(data);
    expect(() => decodeBase45("GGW")).toThrow();
    expect(() => decodeBase45("abc")).toThrow();
  });
});

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32Hex("123456789")).toBe("CBF43926");
    expect(crc32Hex(new Uint8Array())).toBe("00000000");
  });
});

describe("QR chunks", () => {
  const parts = encodeChunks(data, { sessionId: "ABC123", payloadSize: 300 });

  it("uses only QR alphanumeric characters and a parseable header", () => {
    expect(parts.length).toBeGreaterThan(5);
    for (const part of parts) expect(part).toMatch(/^[0-9A-Z $%*+\-./:]+$/);
    const first = parseChunk(parts[0]!);
    expect(first.ok && first.chunk).toMatchObject({ sessionId: "ABC123", index: 0, total: parts.length });
  });

  it("reassembles parts received in any order", () => {
    const collector = new ChunkCollector();
    const shuffled = [...parts].sort((a, b) => crc32Hex(a).localeCompare(crc32Hex(b)));
    const statuses = shuffled.map((p) => collector.add(p));
    expect(statuses.at(-1)).toBe("complete");
    expect(statuses.slice(0, -1).every((s) => s === "accepted")).toBe(true);
    expect(collector.assemble()).toEqual(data);
  });

  it("reports progress, missing parts and duplicates", () => {
    const collector = new ChunkCollector();
    collector.add(parts[2]!);
    expect(collector.add(parts[2]!)).toBe("duplicate");
    expect(collector.progress).toMatchObject({ received: 1, total: parts.length });
    expect(collector.missing).not.toContain(2);
    expect(collector.complete).toBe(false);
  });

  it("rejects damaged parts and counts them", () => {
    const collector = new ChunkCollector();
    expect(collector.add(corrupt(parts[0]!))).toBe("corrupt");
    expect(collector.progress.rejected).toBe(1);
    expect(collector.add("hello world")).toBe("not-nova");
    expect(collector.add("NV1AB")).toBe("malformed");
    expect(collector.progress.received).toBe(0);
  });

  it("ignores parts of another session unless switching", () => {
    const collector = new ChunkCollector();
    collector.add(parts[0]!);
    const other = encodeChunks(text("other"), { sessionId: "ZZZZZZ" })[0]!;
    expect(collector.add(other)).toBe("other-session");
    expect(collector.add(other, { switchSession: true })).toBe("complete");
  });
});

describe("provider share payload", () => {
  const p = provider("p1", {
    name: "OpenAI",
    models: [
      { id: "gpt-4o", name: "GPT-4o", enabled: true, contextWindow: null, capabilities: { vision: true, audio: false, video: false, tools: true, reasoning: false }, inputCost: null, outputCost: null, source: "remote" },
      { id: "old", name: "Old", enabled: false, contextWindow: null, capabilities: { vision: false, audio: false, video: false, tools: false, reasoning: false }, inputCost: null, outputCost: null, source: "remote" },
    ],
    defaultModelId: "gpt-4o",
  });
  const config = { id: "p1", kind: "openai" as const, name: "OpenAI", baseUrl: p.baseUrl, transport: "direct" as const, apiKey: "sk-secret-123456", headers: { "X-Org": "o" } };

  it("never includes the key or headers by default", () => {
    const payload = buildProviderPayload(p, config, { includeApiKey: false, includeHeaders: false });
    expect(payload).not.toHaveProperty("apiKey");
    expect(payload).not.toHaveProperty("headers");
    expect(payloadHasSecrets(payload)).toBe(false);
    expect(payload.models).toEqual(["gpt-4o"]);
  });

  it("includes secrets only when explicitly requested", () => {
    const payload = buildProviderPayload(p, config, { includeApiKey: true, includeHeaders: true });
    expect(payload).toMatchObject({ apiKey: "sk-secret-123456", headers: { "X-Org": "o" } });
    expect(payloadHasSecrets(payload)).toBe(true);
  });

  it("round-trips through gzip + base45 chunks", async () => {
    const payload = buildProviderPayload(p, config, { includeApiKey: false, includeHeaders: false });
    const chunks = await encodeProviderPayload(payload, { sessionId: "S0S0S0", payloadSize: 40 });
    expect(chunks.length).toBeGreaterThan(1);
    const collector = new ChunkCollector();
    for (const chunk of [...chunks].reverse()) collector.add(chunk);
    expect(await decodeProviderPayload(collector)).toEqual(payload);
  });

  it("rejects a valid frame carrying a non-provider payload", async () => {
    const collector = new ChunkCollector();
    for (const chunk of encodeChunks(text("not gzip"), { sessionId: "BAD000" })) collector.add(chunk);
    await expect(decodeProviderPayload(collector)).rejects.toThrow();
  });
});
