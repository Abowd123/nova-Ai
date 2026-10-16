import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { uniqueDbName } from "@tests/helpers/storage";
import { assistantSchema, conversationSchema, messageSchema, providerSchema } from "@/lib/models";
import { NovaDatabase } from "@/lib/storage/dexie/database";
import { LATEST_DB_VERSION, SCHEMA_V1, SCHEMA_V2, SCHEMA_V3 } from "@/lib/storage/dexie/migrations";
import { ATTACHMENT_SCHEMA_VERSION, attachmentSchema } from "@/lib/models";

const names: string[] = [];
function name() {
  const n = uniqueDbName("nova-migration");
  names.push(n);
  return n;
}

afterEach(async () => {
  await Promise.all(names.splice(0).map((n) => Dexie.delete(n)));
});

describe("Dexie migrations", () => {
  it("opens a fresh database at the latest version", async () => {
    const db = new NovaDatabase(name());
    await db.open();
    expect(db.verno).toBe(LATEST_DB_VERSION);
    expect(db.tables.map((t) => t.name).sort()).toEqual(
      ["assistants", "attachmentBlobs", "attachments", "comfyWorkflows", "conversations", "cryptoKeys", "imageGenerations", "lorebooks", "mcpServers", "memoryChunks", "memoryVectors", "messages", "providers", "secrets", "settings", "summaries", "syncConflicts", "syncRecords", "syncState", "tags", "auditLog", "usageRecords"].sort(),
    );
    db.close();
  });

  it("upgrades v1 data through every version without losing records", async () => {
    const dbName = name();
    const legacy = new Dexie(dbName);
    legacy.version(1).stores(SCHEMA_V1);
    await legacy.open();
    await legacy.table("conversations").bulkAdd([
      { id: "c1", title: "Legacy one", createdAt: 1, updatedAt: 10 },
      { id: "c2", title: "Legacy two", createdAt: 2, updatedAt: 20 },
    ]);
    await legacy.table("messages").bulkAdd([
      { id: "m1", conversationId: "c1", role: "user", content: "a", status: "complete", attachmentIds: [], error: null, createdAt: 3, updatedAt: 3 },
      { id: "m2", conversationId: "c1", role: "assistant", content: "b", status: "complete", attachmentIds: [], error: null, createdAt: 7, updatedAt: 7 },
    ]);
    await legacy.table("assistants").add({ id: "a1", name: "Old bot", createdAt: 1, updatedAt: 1 });
    await legacy.table("tags").bulkAdd([
      { id: "t1", name: "x", color: "#000000", createdAt: 1, updatedAt: 1 },
      { id: "t2", name: "y", color: "#FFFFFF", createdAt: 1, updatedAt: 1 },
    ]);
    legacy.close();

    const db = new NovaDatabase(dbName);
    await db.open();
    expect(db.verno).toBe(LATEST_DB_VERSION);

    const c1 = await db.conversations.get("c1");
    const c2 = await db.conversations.get("c2");
    expect(c1).toMatchObject({ pinned: false, archived: false, tagIds: [], messageCount: 2, lastMessageAt: 7, assistantId: null });
    expect(c2).toMatchObject({ messageCount: 0, lastMessageAt: null });
    expect(conversationSchema.safeParse(c1).success).toBe(true);

    const assistant = await db.assistants.get("a1");
    expect(assistant).toMatchObject({ isDefault: false, tagIds: [], schemaVersion: 2, temperature: 0.7, starters: [], memoryScope: "assistant", autoPlayTts: "never" });
    expect(assistantSchema.safeParse(assistant).success).toBe(true);

    expect((await db.tags.orderBy("order").toArray()).map((t) => t.order)).toEqual([0, 1]);
    expect(await db.messages.count()).toBe(2);
    db.close();
  });

  it("upgrades v2 data to the latest version (parts, title source, providers without plaintext headers)", async () => {
    const dbName = name();
    const legacy = new Dexie(dbName);
    legacy.version(1).stores(SCHEMA_V1);
    legacy.version(2).stores(SCHEMA_V2);
    await legacy.open();
    const conversationBase = { assistantId: null, pinned: false, archived: false, tagIds: [], messageCount: 1, lastMessageAt: 3, createdAt: 1, updatedAt: 1 };
    await legacy.table("conversations").bulkAdd([
      { id: "c1", title: "New conversation", ...conversationBase },
      { id: "c2", title: "My trip", ...conversationBase },
    ]);
    await legacy.table("messages").bulkAdd([
      { id: "m1", conversationId: "c1", role: "user", content: "hello", status: "complete", attachmentIds: [], error: null, createdAt: 3, updatedAt: 3 },
      { id: "m2", conversationId: "c1", role: "assistant", content: "half", status: "streaming", attachmentIds: [], error: null, createdAt: 4, updatedAt: 4 },
    ]);
    await legacy.table("providers").add({
      id: "p1",
      name: "Old",
      kind: "openai",
      baseUrl: "https://api.openai.com/v1",
      enabled: true,
      headers: { Authorization: "Bearer leaked" },
      encryptedApiKey: null,
      createdAt: 1,
      updatedAt: 1,
    });
    legacy.close();

    const db = new NovaDatabase(dbName);
    await db.open();
    expect(db.verno).toBe(LATEST_DB_VERSION);
    expect(await db.messages.get("m1")).toMatchObject({ parts: [{ type: "text", text: "hello" }], usage: null, providerId: null, heartbeatAt: null });
    expect((await db.messages.get("m2"))?.status).toBe("interrupted");
    expect(messageSchema.safeParse(await db.messages.get("m1")).success).toBe(true);
    expect((await db.conversations.get("c1"))?.titleSource).toBe("default");
    expect((await db.conversations.get("c2"))?.titleSource).toBe("manual");
    const provider = await db.providers.get("p1");
    expect(provider).not.toHaveProperty("headers");
    expect(JSON.stringify(provider)).not.toContain("leaked");
    expect(providerSchema.safeParse(provider).success).toBe(true);
    db.close();
  });

  it("upgrades v3 assistants to schema v2 and keeps custom values", async () => {
    const dbName = name();
    const legacy = new Dexie(dbName);
    legacy.version(1).stores(SCHEMA_V1);
    legacy.version(2).stores(SCHEMA_V2);
    legacy.version(3).stores(SCHEMA_V3);
    await legacy.open();
    await legacy.table("assistants").add({
      id: "a1",
      name: "Writer",
      avatar: "data:image/svg+xml;base64,PHN2Zy8+",
      systemPrompt: "Be brief",
      temperature: 1.2,
      isDefault: true,
      tagIds: ["t1"],
      schemaVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await legacy.table("tags").bulkAdd([
      { id: "t1", name: "b", color: "#000000", order: 5, createdAt: 1, updatedAt: 1 },
      { id: "t2", name: "a", color: "#FFFFFF", order: 9, createdAt: 1, updatedAt: 1 },
    ]);
    legacy.close();

    const db = new NovaDatabase(dbName);
    await db.open();
    expect(db.verno).toBe(LATEST_DB_VERSION);
    const assistant = await db.assistants.get("a1");
    expect(assistant).toMatchObject({
      schemaVersion: 2,
      avatar: "✨",
      systemPrompt: "Be brief",
      temperature: 1.2,
      isDefault: true,
      tagIds: ["t1"],
      settings: { reasoning: "auto" },
      enabledTools: [],
    });
    expect(assistantSchema.safeParse(assistant).success).toBe(true);
    expect((await db.tags.orderBy("order").toArray()).map((t) => [t.id, t.order])).toEqual([
      ["t1", 0],
      ["t2", 1],
    ]);
    db.close();
  });

  it("is idempotent when reopening an upgraded database", async () => {
    const dbName = name();
    const first = new NovaDatabase(dbName);
    await first.open();
    await first.conversations.add({
      id: "c", title: "t", titleSource: "manual", assistantId: null, providerId: null, modelId: null,
      pinned: true, archived: false, tagIds: [], messageCount: 0, lastMessageAt: null, createdAt: 1, updatedAt: 1,
    });
    first.close();
    const second = new NovaDatabase(dbName);
    await second.open();
    expect((await second.conversations.get("c"))?.pinned).toBe(true);
    second.close();
  });
  it("upgrades v4 attachment rows to schema v2 (storage, metadata, remoteRefs)", async () => {
    const dbName = name();
    const legacy = new Dexie(dbName);
    legacy.version(1).stores(SCHEMA_V1);
    legacy.version(2).stores(SCHEMA_V2);
    legacy.version(3).stores(SCHEMA_V3);
    legacy.version(4).stores({});
    await legacy.open();
    await legacy.table("attachments").add({ id: "at1", conversationId: null, messageId: "m1", kind: "image", name: "a.png", mimeType: "image/png", size: 10, createdAt: 5 });
    legacy.close();

    const db = new NovaDatabase(dbName);
    await db.open();
    expect(db.verno).toBe(LATEST_DB_VERSION);
    const row = await db.attachments.get("at1");
    expect(row).toMatchObject({ storage: "idb", thumbnail: null, sha256: null, metadata: {}, remoteRefs: {}, derivedFrom: null, schemaVersion: ATTACHMENT_SCHEMA_VERSION, updatedAt: 5 });
    expect(attachmentSchema.safeParse(row).success).toBe(true);
    db.close();
  });
});
