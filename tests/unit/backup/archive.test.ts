// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ArchiveError, packArchive, sha256Hex, unpackArchive } from "@/lib/backup/archive";
import { BackupDecryptError, createPartCrypto, openPart, partCryptoFor, sealPart, splitParts } from "@/lib/backup/format";
import { parseData, stringifyData } from "@/lib/backup/serialize";

describe("archive", () => {
  it("round-trips entries with checksums and detects corruption", async () => {
    const archive = await packArchive([
      { name: "db.json", data: new TextEncoder().encode('{"a":1}') },
      { name: "blobs/x", data: new Uint8Array([9, 8, 7]) },
    ]);
    const { header, entries } = await unpackArchive(archive);
    expect(header.entries.map((e) => [e.name, e.size])).toEqual([
      ["db.json", 7],
      ["blobs/x", 3],
    ]);
    expect(Array.from(entries.get("blobs/x")!)).toEqual([9, 8, 7]);
    const broken = archive.slice();
    broken[broken.length - 1] ^= 0xff;
    let error: unknown;
    await unpackArchive(broken).catch((e) => (error = e));
    expect(error).toBeInstanceOf(ArchiveError);
    await packArchive([{ name: "../evil", data: new Uint8Array() }]).catch((e) => (error = e));
    expect((error as Error).message).toContain("Invalid entry name");
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("serializes typed arrays and drops prototype keys", () => {
    const data = parseData(stringifyData({ v: new Float32Array([1.5, -2]), b: new Uint8Array([1]), ["__proto__"]: { polluted: true } })) as Record<string, unknown>;
    expect(Array.from(data.v as Float32Array)).toEqual([1.5, -2]);
    expect(Array.from(data.b as Uint8Array)).toEqual([1]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("seals parts independently and rejects a wrong passphrase or swapped part", async () => {
    const { key, kdf } = await createPartCrypto("correct horse", { iterations: 100_000 });
    const sealed = await sealPart(new Uint8Array([1, 2, 3]), key, "b1", 0);
    expect(Array.from(await openPart(sealed, await partCryptoFor("correct horse", kdf), "b1", 0))).toEqual([1, 2, 3]);
    let error: unknown;
    await openPart(sealed, await partCryptoFor("wrong", kdf), "b1", 0).catch((e) => (error = e));
    expect(error).toBeInstanceOf(BackupDecryptError);
    error = null;
    await openPart(sealed, key, "b1", 1).catch((e) => (error = e));
    expect(error).toBeInstanceOf(BackupDecryptError);
    expect(splitParts(new Uint8Array(10), 4).map((p) => p.byteLength)).toEqual([4, 4, 2]);
  });
});
