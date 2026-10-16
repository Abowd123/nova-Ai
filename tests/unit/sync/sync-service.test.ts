// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FakeWebDav } from "@tests/helpers/fake-webdav";
import { memoryRepos } from "@tests/helpers/memory-repos";
import { SyncService } from "@/features/sync/sync-service";
import { BackupError } from "@/features/backup/errors";
import { MemoryKeyStore, SecretVault, secretContext } from "@/lib/crypto/vault";
import { DEFAULT_SETTINGS, type Attachment } from "@/lib/models";
import { hashRecord, remoteWins, stableStringify } from "@/lib/sync/records";
import { setSecretText } from "@/features/backup/remote";

let clockValue = 1_000_000;
const tick = () => (clockValue += 1000);

async function device(server: FakeWebDav, id: string, options: { encrypt?: boolean; passphrase?: string } = {}) {
  const vault = new SecretVault(new MemoryKeyStore());
  const mem = memoryRepos();
  mem.put("settings", {
    key: "app",
    value: {
      ...DEFAULT_SETTINGS,
      backup: {
        ...DEFAULT_SETTINGS.backup,
        webdav: { url: server.baseUrl, username: "", authType: "basic" as const, viaProxy: false, rootPath: "Nova" },
        sync: { ...DEFAULT_SETTINGS.backup.sync, enabled: true, encrypt: options.encrypt ?? true },
      },
    },
    updatedAt: 1,
  });
  if (options.encrypt !== false) await setSecretText({ repos: mem.repos, vault }, "webdav:passphrase", options.passphrase ?? "shared sync passphrase");
  let n = 0;
  const applied: string[] = [];
  const service = new SyncService({
    repos: mem.repos,
    vault,
    httpFor: () => server.fetch,
    deviceId: async () => id,
    readBlob: (a: Attachment) => mem.repos.blobs.get(a.id),
    writeBlob: async (a: Attachment, blob: Blob) => (await mem.repos.blobs.put(a.id, blob), "idb"),
    scratch: mem.repos.blobs,
    onApplied: (tables) => applied.push(...tables),
    clock: () => clockValue,
    iterations: 100_000,
    newId: () => `${id}-conflict-${++n}`,
  });
  return { mem, vault, service, applied };
}

describe("record helpers", () => {
  it("hashes deterministically and ignores device-bound fields", () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe('{"a":[1,{"d":2}],"b":1}');
    const a = hashRecord("providers", { id: "p", name: "x", encryptedApiKey: { iv: "1" } });
    const b = hashRecord("providers", { id: "p", name: "x", encryptedApiKey: null });
    expect(a).toBe(b);
    expect(hashRecord("attachments", { id: "a", storage: "opfs" })).toBe(hashRecord("attachments", { id: "a", storage: "idb" }));
  });

  it("LWW: newer wins, ties broken by device id on every device", () => {
    expect(remoteWins({ updatedAt: 1, deviceId: "a" }, { updatedAt: 2, deviceId: "a" })).toBe(true);
    expect(remoteWins({ updatedAt: 2, deviceId: "a" }, { updatedAt: 1, deviceId: "b" })).toBe(false);
    expect(remoteWins({ updatedAt: 1, deviceId: "a" }, { updatedAt: 1, deviceId: "b" })).toBe(true);
    expect(remoteWins({ updatedAt: 1, deviceId: "b" }, { updatedAt: 1, deviceId: "a" })).toBe(false);
  });
});

describe("SyncService (two devices, one WebDAV folder)", () => {
  it("pushes and pulls deltas, tombstones deletes and never uploads keys", async () => {
    const server = new FakeWebDav();
    const A = await device(server, "dev-a");
    const B = await device(server, "dev-b");
    A.mem.put("providers", { id: "p1", name: "OpenAI", encryptedApiKey: await A.vault.encrypt("sk-SECRET-123456789012345", secretContext("p1", "apiKey")), encryptedHeaders: null, updatedAt: tick() });
    A.mem.put("conversations", { id: "c1", title: "Plan", updatedAt: tick() });
    A.mem.put("messages", { id: "m1", conversationId: "c1", content: "hi", updatedAt: tick() });
    A.mem.put("attachments", { id: "a1", mimeType: "image/png", size: 3, storage: "opfs", updatedAt: tick() });
    await A.mem.repos.blobs.put("a1", new Blob([new Uint8Array([7, 7, 7])]));

    const first = await A.service.sync();
    expect(first.pushed).toBeGreaterThanOrEqual(4);
    const raw = [...server.files.values()].map((b) => new TextDecoder("latin1").decode(b)).join();
    expect(raw).not.toContain("sk-SECRET");
    expect(raw).not.toContain("Plan"); // encrypted

    const pulled = await B.service.sync();
    expect(pulled.pulled).toBeGreaterThanOrEqual(4);
    expect(B.mem.row("conversations", "c1")).toMatchObject({ title: "Plan" });
    expect(B.mem.row("providers", "p1")).toMatchObject({ name: "OpenAI", encryptedApiKey: null });
    expect(B.mem.row("attachments", "a1")).toMatchObject({ storage: "idb" });
    expect(new Uint8Array(await (await B.mem.repos.blobs.get("a1"))!.arrayBuffer())).toEqual(new Uint8Array([7, 7, 7]));
    expect(B.applied).toContain("conversations");
    // B pushes nothing back (dedupe: nothing changed locally).
    expect(pulled.pushed).toBe(0);

    // Delete on B → tombstone → gone on A.
    B.mem.remove("messages", "m1");
    tick();
    expect((await B.service.sync()).pushed).toBe(1);
    await A.service.sync();
    expect(A.mem.row("messages", "m1")).toBeUndefined();

    // Nothing left to do: idempotent.
    expect(await A.service.sync()).toMatchObject({ pushed: 0, pulled: 0 });
  });

  it("resolves concurrent edits last-writer-wins and logs the conflict; the loser can be picked", async () => {
    const server = new FakeWebDav();
    const A = await device(server, "dev-a");
    const B = await device(server, "dev-b");
    A.mem.put("conversations", { id: "c1", title: "Original", updatedAt: tick() });
    await A.service.sync();
    await B.service.sync();

    A.mem.put("conversations", { id: "c1", title: "Edited on A", updatedAt: tick() });
    B.mem.put("conversations", { id: "c1", title: "Edited on B", updatedAt: tick() }); // newer
    await A.service.sync();
    const result = await B.service.sync();
    expect(result.conflicts).toBe(1);
    // B's edit is newer: B keeps it and pushes it.
    expect(B.mem.row("conversations", "c1")).toMatchObject({ title: "Edited on B" });
    await A.service.sync();
    expect(A.mem.row("conversations", "c1")).toMatchObject({ title: "Edited on B" });

    const [conflict] = await B.service.conflicts("open");
    expect(conflict).toMatchObject({ table: "conversations", recordId: "c1", winner: "local", remoteDeviceId: "dev-a" });
    expect((conflict!.remote as { title: string }).title).toBe("Edited on A");

    // User picks A's version on B → it propagates everywhere.
    tick();
    await B.service.resolveConflict(conflict!.id, "remote");
    expect(B.mem.row("conversations", "c1")).toMatchObject({ title: "Edited on A" });
    expect(await B.service.conflicts("open")).toHaveLength(0);
    await B.service.sync();
    await A.service.sync();
    expect(A.mem.row("conversations", "c1")).toMatchObject({ title: "Edited on A" });
  });

  it("retries safely: a delta whose upload failed is re-sent unchanged", async () => {
    const server = new FakeWebDav();
    const A = await device(server, "dev-a", { encrypt: false });
    const B = await device(server, "dev-b", { encrypt: false });
    A.mem.put("tags", { id: "t1", name: "work", updatedAt: tick() });
    server.failWhen = (method, path) => method === "PUT" && path.endsWith(".delta");
    await A.service.sync().catch(() => undefined);
    expect((await A.service.lastSync())?.error).toBeTruthy();
    // Change more data before the retry: the pending delta is still sent as built, extra changes go in the next one.
    A.mem.put("tags", { id: "t2", name: "home", updatedAt: tick() });
    server.failWhen = null;
    await A.service.sync();
    await A.service.sync();
    const deltas = [...server.files.keys()].filter((k) => k.includes("/devices/dev-a/"));
    expect(deltas.length).toBe(2);
    await B.service.sync();
    expect(B.mem.row("tags", "t1")).toMatchObject({ name: "work" });
    expect(B.mem.row("tags", "t2")).toMatchObject({ name: "home" });
  });

  it("refuses a wrong passphrase and mismatched encryption", async () => {
    const server = new FakeWebDav();
    const A = await device(server, "dev-a");
    A.mem.put("tags", { id: "t1", name: "x", updatedAt: tick() });
    await A.service.sync();
    const B = await device(server, "dev-b", { passphrase: "another passphrase" });
    let error: BackupError | null = null;
    await B.service.sync().catch((e: BackupError) => (error = e));
    expect(error!.code).toBe("wrong_passphrase");
    const C = await device(server, "dev-c", { encrypt: false });
    await C.service.sync().catch((e: BackupError) => (error = e));
    expect(error!.code).toBe("corrupted");
  });

  it("offline: skips without touching the server", async () => {
    const server = new FakeWebDav();
    const A = await device(server, "dev-a");
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
    let error: BackupError | null = null;
    await A.service.sync().catch((e: BackupError) => (error = e));
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete (globalThis as { navigator?: unknown }).navigator;
    expect(error!.code).toBe("offline");
    expect(server.log).toHaveLength(0);
  });
});
