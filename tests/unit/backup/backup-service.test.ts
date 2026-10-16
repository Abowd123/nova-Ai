// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FakeWebDav } from "@tests/helpers/fake-webdav";
import { memoryRepos } from "@tests/helpers/memory-repos";
import { BackupService } from "@/features/backup/backup-service";
import { BackupError } from "@/features/backup/errors";
import { MemoryKeyStore, SecretVault, secretContext } from "@/lib/crypto/vault";
import { DEFAULT_SETTINGS, type Attachment } from "@/lib/models";

const API_KEY = "sk-live-SUPERSECRETKEY-1234567890";

async function setup(options: { encrypt?: boolean; server?: FakeWebDav; seed?: boolean } = {}) {
  const server = options.server ?? new FakeWebDav({ username: "alice", password: "dav-pw" });
  const vault = new SecretVault(new MemoryKeyStore());
  const mem = memoryRepos();
  const settings = {
    ...DEFAULT_SETTINGS,
    userName: "Aboof",
    backup: {
      ...DEFAULT_SETTINGS.backup,
      webdav: { url: server.baseUrl, username: "alice", authType: "basic" as const, viaProxy: false, rootPath: "Nova" },
      schedule: { ...DEFAULT_SETTINGS.backup.schedule, encrypt: options.encrypt ?? true, keepLast: 2 },
    },
  };
  mem.put("settings", { key: "app", value: settings, updatedAt: 1 });
  if (options.seed !== false) {
    mem.put("providers", { id: "p1", name: "OpenAI", encryptedApiKey: await vault.encrypt(API_KEY, secretContext("p1", "apiKey")), encryptedHeaders: null, models: [], updatedAt: 1 });
    mem.put("conversations", { id: "c1", title: "مرحبا", updatedAt: 1 });
    mem.put("messages", { id: "m1", conversationId: "c1", content: "hello", updatedAt: 1 });
    mem.put("memoryVectors", { id: "v1", vector: new Float32Array([0.5, 0.25]) });
    mem.put("attachments", { id: "a1", mimeType: "image/png", size: 4, storage: "idb", updatedAt: 1 });
    await mem.repos.blobs.put("a1", new Blob([new Uint8Array([1, 2, 3, 4])]));
  }
  let rand = 0;
  const service = new BackupService({
    repos: mem.repos,
    vault,
    httpFor: () => server.fetch,
    appVersion: "1.4.2",
    device: async () => ({ id: "dev-a", label: "Test" }),
    readBlob: (a: Attachment) => mem.repos.blobs.get(a.id),
    writeBlob: async (a: Attachment, blob: Blob) => (await mem.repos.blobs.put(a.id, blob), "idb"),
    scratch: mem.repos.blobs,
    random: () => `r${++rand}xxxx`,
    partSize: 64 * 1024,
    iterations: 100_000,
    clock: (() => {
      let t = Date.parse("2026-10-16T01:00:00Z");
      return () => (t += 60_000);
    })(),
  });
  await service.saveCredentials("dav-pw", options.encrypt === false ? undefined : "backup passphrase!");
  return { server, vault, mem, service };
}

const allText = (server: FakeWebDav) => [...server.files.values()].map((b) => new TextDecoder("latin1").decode(b)).join("\n");

describe("BackupService", () => {
  it("tests the connection (Nextcloud layout)", async () => {
    const { service } = await setup();
    const check = await service.testConnection();
    expect(check).toMatchObject({ ok: true, nextcloud: true });
    expect(check.steps.map((s) => s.step)).toEqual(["list", "folder", "write", "read", "delete"]);
  });

  it("uploads an encrypted backup (manifest last), lists it and restores everything incl. keys", async () => {
    const { server, service, mem, vault } = await setup();
    const item = await service.createBackup();
    const folder = `/Nova/backups/${item.id}`;
    const puts = server.log.filter((l) => l.startsWith("PUT"));
    expect(puts.at(-1)).toBe(`PUT ${folder}/manifest.json`);
    expect(item.manifest).toMatchObject({ encrypted: true, includesSecrets: true, counts: { conversations: 1, messages: 1, blobs: 1 } });
    // The key never appears on the server in plaintext.
    expect(allText(server)).not.toContain("SUPERSECRETKEY");
    expect(allText(server)).not.toContain("hello");

    const [listed] = await service.listBackups();
    expect(listed).toMatchObject({ id: item.id, complete: true });

    // Wipe local data, then restore.
    mem.remove("conversations", "c1");
    mem.remove("providers", "p1");
    await mem.repos.blobs.delete("a1");
    const preview = await service.inspect(listed!);
    expect(preview.counts).toMatchObject({ conversations: 1, providers: 1, blobs: 1 });
    await service.restore(preview);
    expect(mem.row("conversations", "c1")).toMatchObject({ title: "مرحبا" });
    const provider = mem.row("providers", "p1")!;
    expect(await vault.decrypt(provider.encryptedApiKey as never, secretContext("p1", "apiKey"))).toBe(API_KEY);
    expect(Array.from((mem.row("memoryVectors", "v1")!.vector as Float32Array))).toEqual([0.5, 0.25]);
    expect(new Uint8Array(await (await mem.repos.blobs.get("a1"))!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    // Device-local WebDAV settings survive the restore.
    expect((await mem.repos.settings.get()).backup.webdav.url).toBe(server.baseUrl);
  });

  it("plain backups never contain API keys", async () => {
    const { server, service } = await setup({ encrypt: false });
    const item = await service.createBackup();
    expect(item.manifest).toMatchObject({ encrypted: false, includesSecrets: false });
    expect(allText(server)).not.toContain("SUPERSECRETKEY");
  });

  it("rejects a wrong passphrase", async () => {
    const { service } = await setup();
    const item = await service.createBackup();
    let error: BackupError | null = null;
    await service.inspect(item, { passphrase: "not the passphrase" }).catch((e: BackupError) => (error = e));
    expect(error!.code).toBe("wrong_passphrase");
  });

  it("resumes an upload after the network drops, without re-sending finished parts", async () => {
    const { server, service, mem } = await setup({ encrypt: false });
    // Big incompressible attachment → several parts.
    const noise = new Uint8Array(200 * 1024).map(() => Math.floor(Math.random() * 256));
    mem.put("attachments", { id: "big", mimeType: "application/octet-stream", size: noise.byteLength, storage: "idb", updatedAt: 1 });
    await mem.repos.blobs.put("big", new Blob([noise]));
    let parts = 0;
    server.failWhen = (method, path) => method === "PUT" && path.endsWith(".bin") && ++parts > 2;
    await service.createBackup().catch(() => undefined);
    const pending = await service.pendingUpload();
    expect(pending!.parts).toBeGreaterThan(2);
    expect([...server.files.keys()].some((p) => p.endsWith("manifest.json"))).toBe(false);
    server.failWhen = null;
    server.log.length = 0;
    const item = await service.resumeUpload();
    expect(item?.complete).toBe(true);
    const resent = server.log.filter((l) => l.startsWith("PUT") && l.endsWith(".bin"));
    expect(resent).toHaveLength(pending!.parts - 2);
    expect(await service.pendingUpload()).toBeNull();
    const preview = await service.inspect((await service.listBackups())[0]!);
    expect(preview.counts.blobs).toBe(2);
  });

  it("resumes a dropped download with Range and verifies checksums", async () => {
    const { server, service } = await setup({ encrypt: false });
    const item = await service.createBackup();
    server.truncateNextGetAt = 10;
    const preview = await service.inspect(item);
    expect(preview.counts.messages).toBe(1);
    expect(server.log.filter((l) => l.startsWith("GET") && l.includes("part-00000")).length).toBe(2);
  });

  it("detects a corrupted part", async () => {
    const { server, service } = await setup({ encrypt: false });
    const item = await service.createBackup();
    const key = [...server.files.keys()].find((k) => k.endsWith("part-00000.bin"))!;
    const bytes = server.files.get(key)!.slice();
    bytes[5] ^= 0xff;
    server.files.set(key, bytes);
    let error: BackupError | null = null;
    await service.inspect(item).catch((e: BackupError) => (error = e));
    expect(error!.code).toBe("corrupted");
  });

  it("keeps only the newest N backups", async () => {
    const { service } = await setup({ encrypt: false });
    await service.createBackup();
    await service.createBackup();
    await service.createBackup();
    const list = await service.listBackups();
    expect(list).toHaveLength(2);
    expect(list[0]!.createdAt).toBeGreaterThan(list[1]!.createdAt);
  });

  it("requires a passphrase for encrypted backups", async () => {
    const { service, mem } = await setup();
    await mem.repos.secrets.delete("webdav:passphrase");
    let error: BackupError | null = null;
    await service.createBackup().catch((e: BackupError) => (error = e));
    expect(error!.code).toBe("passphrase_required");
  });
});
