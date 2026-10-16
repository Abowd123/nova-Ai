import { describe, expect, it } from "vitest";
import { fitWithin, frameTimestamps, nearestSize, sizeForAspect } from "@/lib/media/geometry";
import { base64ToBytes, bytesToBase64, formatBytes, formatDuration, sha256Hex } from "@/lib/media/encoding";

describe("geometry", () => {
  it("fits the longest edge and never upscales", () => {
    expect(fitWithin(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(1000, 4000, 2048)).toEqual({ width: 512, height: 2048 });
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(0, 10, 100)).toEqual({ width: 1, height: 1 });
  });

  it("spreads frame timestamps away from the edges", () => {
    expect(frameTimestamps(10_000, 4)).toEqual([2000, 4000, 6000, 8000]);
    expect(frameTimestamps(Number.NaN, 4)).toEqual([0]);
  });

  it("computes sizes for aspect ratios in multiples of 64", () => {
    expect(sizeForAspect("1:1")).toEqual({ width: 1024, height: 1024 });
    expect(sizeForAspect("16:9")).toEqual({ width: 1344, height: 768 });
    const tall = sizeForAspect("9:16");
    expect(tall.width % 64).toBe(0);
    expect(tall.height).toBeGreaterThan(tall.width);
    expect(sizeForAspect("bad")).toEqual({ width: 1024, height: 1024 });
  });

  it("picks the nearest supported size", () => {
    const sizes = ["1024x1024", "1536x1024", "1024x1536"];
    expect(nearestSize(1344, 768, sizes)).toBe("1536x1024");
    expect(nearestSize(768, 1344, sizes)).toBe("1024x1536");
    expect(nearestSize(512, 512, sizes)).toBe("1024x1024");
  });
});

describe("encoding", () => {
  it("round-trips base64 for binary data", () => {
    const data = new Uint8Array(70_000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(data))).toEqual(data);
    expect(bytesToBase64(new TextEncoder().encode("hi"))).toBe("aGk=");
  });

  it("hashes blobs with SHA-256", async () => {
    expect(await sha256Hex(new Blob(["abc"]))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("formats sizes and durations", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatDuration(65_000)).toBe("1:05");
  });
});
