// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assistant, conversation, message, provider, sequentialIds, snapshot, tag } from "@tests/helpers/fixtures";
import { DEFAULT_SETTINGS, type EncryptedSecret } from "@/lib/models";
import type { Repositories, TransferBatch, TransferIndex, TransferWriteOptions } from "@/lib/storage/types";
import { applyImport } from "@/lib/transfer/apply";
import { buildSharedAssistant } from "@/lib/transfer/export";
import { parseImportText, planImport, type PlanOptions } from "@/lib/transfer/import";
import { migrateExport } from "@/lib/transfer/migrate";

const emptyIndex: TransferIndex = { assistants: [], tags: [], providers: [], conversations: [] };
const merge = (extra: Partial<PlanOptions> = {}): PlanOptions => ({ mode: "merge", strategy: "duplicate", applySettings: false, idGenerator: sequentialIds(), ...extra });

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`expected ${code}`);
}

describe("parseImportText", () => {
  it("parses a current backup", () => {
    const parsed = parseImportText(JSON.stringify(snapshot({ assistants: [assistant("a1")] })));
    expect(parsed).toMatchObject({ kind: "snapshot", source: "backup", migratedFrom: null });
  });

  it("detects an encrypted envelope without decrypting", () => {
    const envelope = { format: "nova-export-encrypted", version: 1, kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 100000, salt: "AAAAAAAAAAAAAAAAAAAAAA==" }, cipher: { name: "AES-GCM", iv: "AAAAAAAAAAAAAAAA" }, compression: "gzip", ciphertext: "AAAA" };
    expect(parseImportText(JSON.stringify(envelope)).kind).toBe("encrypted");
  });

  it("wraps a shared assistant into a snapshot", () => {
    const shared = buildSharedAssistant(assistant("a1", { name: "Shared" }), []);
    const parsed = parseImportText(JSON.stringify(shared));
    expect(parsed.kind === "snapshot" && parsed.source).toBe("assistant");
    expect(parsed.kind === "snapshot" && parsed.snapshot.assistants[0]?.name).toBe("Shared");
  });

  it("rejects invalid JSON, foreign files, newer versions and bad data", () => {
    expectCode(() => parseImportText("{oops"), "invalid_json");
    expectCode(() => parseImportText(JSON.stringify({ format: "other-app", version: 1 })), "unsupported_format");
    expectCode(() => parseImportText(JSON.stringify({ ...snapshot(), version: 99 })), "newer_version");
    expectCode(() => parseImportText(JSON.stringify(snapshot({ tags: [{ id: "t", name: "x", color: "red" } as never] }))), "invalid_data");
    expectCode(() => parseImportText("42"), "unsupported_format");
  });
});

describe("migrateExport (backward compatibility)", () => {
  it("accepts a version-0 bare array of v1 assistants", () => {
    const { data, migratedFrom } = migrateExport([{ id: "a1", name: "Legacy", systemPrompt: "x", createdAt: 1, updatedAt: 1 }]);
    expect(migratedFrom).toBe(0);
    const parsed = parseImportText(JSON.stringify(data));
    expect(parsed.kind === "snapshot" && parsed.snapshot.assistants[0]).toMatchObject({ name: "Legacy", schemaVersion: 2, starters: [] });
  });

  it("accepts a version-0 object without format and nested provider models", () => {
    const { data, migratedFrom } = migrateExport({
      assistants: [],
      tags: [{ id: "t1", name: "x", color: "#000000", createdAt: 1, updatedAt: 1 }],
      providers: [{ id: "p1", name: "P", kind: "openai", baseUrl: "https://api.openai.com/v1", enabled: true, createdAt: 1, updatedAt: 1, models: [{ id: "gpt-4o", name: "GPT-4o", enabled: true }] }],
    });
    expect(migratedFrom).toBe(0);
    const parsed = parseImportText(JSON.stringify(data));
    if (parsed.kind !== "snapshot") throw new Error("expected snapshot");
    expect(parsed.snapshot.tags[0]?.order).toBe(0);
    expect(parsed.snapshot.models.map((m) => [m.providerId, m.id])).toEqual([["p1", "gpt-4o"]]);
    expect(JSON.stringify(parsed.snapshot.providers)).not.toContain("encrypted");
  });

  it("flags v1 files that still carry schema-1 assistants as migrated", () => {
    const old = { ...snapshot(), assistants: [{ id: "a1", name: "Old", createdAt: 1, updatedAt: 1, schemaVersion: 1 }] };
    expect(migrateExport(old).migratedFrom).toBe(1);
    expect(migrateExport(snapshot()).migratedFrom).toBeNull();
  });
});

describe("planImport", () => {
  const file = snapshot({
    tags: [tag("t1", "Work"), tag("t2", "Fun", 1)],
    providers: [provider("p1", { name: "OpenAI" })],
    models: [{ id: "gpt-4o", name: "GPT-4o", enabled: true, contextWindow: null, capabilities: { vision: false, audio: false, video: false, tools: false, reasoning: false }, inputCost: null, outputCost: null, source: "remote", providerId: "p1" }],
    assistants: [assistant("a1", { name: "Coder", tagIds: ["t1", "t2"], defaultProviderId: "p1", defaultModelId: "gpt-4o", isDefault: true })],
    conversations: [{ ...conversation("c1", { assistantId: "a1", providerId: "p1", modelId: "gpt-4o", tagIds: ["t2"] }), messages: [message("m1", "c1", { status: "streaming", providerId: "p1" })] }],
    settings: { ...DEFAULT_SETTINGS, defaultProviderId: "p1", defaultModelId: "gpt-4o" },
  });

  it("adds everything into an empty database", () => {
    const plan = planImport(file, emptyIndex, merge());
    expect(plan.counts.assistant).toMatchObject({ total: 1, add: 1 });
    expect(plan.conflicts).toEqual([]);
    expect(plan.batch.providers[0]).toMatchObject({ id: "p1", encryptedApiKey: null, defaultModelId: "gpt-4o" });
    expect(plan.batch.providers[0]?.models.map((m) => m.id)).toEqual(["gpt-4o"]);
    expect(plan.batch.messages[0]?.status).toBe("interrupted");
    expect(plan.batch.settings).toBeNull();
    expect(plan.warnings).toContain("settings_skipped");
    expect(plan.warnings).toContain("providers_without_keys");
  });

  it("reuses local tags with the same name and remaps references", () => {
    const plan = planImport(file, { ...emptyIndex, tags: [{ id: "local-work", name: "work" }] }, merge());
    expect(plan.counts.tag).toMatchObject({ reuse: 1, add: 1 });
    expect(plan.conflicts.find((c) => c.entity === "tag")).toMatchObject({ action: "reuse", reason: "same-name", existingName: "work" });
    expect(plan.batch.tags.map((t) => t.id)).toEqual(["t2"]);
    expect(plan.batch.assistants[0]?.tagIds).toEqual(["local-work", "t2"]);
  });

  it("duplicates conflicting ids with new ids and remaps everything to them", () => {
    const index: TransferIndex = { assistants: [{ id: "a1", name: "Local", isDefault: true }], tags: [], providers: [{ id: "p1", name: "Mine" }], conversations: [{ id: "c1", title: "Local chat" }] };
    const plan = planImport(file, index, merge({ strategy: "duplicate" }));
    const newProvider = plan.batch.providers[0]!.id;
    const newAssistant = plan.batch.assistants[0]!;
    expect(newProvider).not.toBe("p1");
    expect(newAssistant.id).not.toBe("a1");
    expect(newAssistant).toMatchObject({ defaultProviderId: newProvider, isDefault: false });
    const conv = plan.batch.conversations[0]!;
    expect(conv.id).not.toBe("c1");
    expect(conv).toMatchObject({ assistantId: newAssistant.id, providerId: newProvider });
    expect(plan.batch.messages[0]).toMatchObject({ conversationId: conv.id, providerId: newProvider });
    expect(plan.batch.messages[0]?.id).not.toBe("m1");
    expect(plan.conflicts.filter((c) => c.reason === "same-id")).toHaveLength(3);
  });

  it("skips or overwrites conflicts by strategy", () => {
    const index: TransferIndex = { assistants: [{ id: "a1", name: "Local", isDefault: false }], tags: [], providers: [], conversations: [{ id: "c1", title: "x" }] };
    const skip = planImport(file, index, merge({ strategy: "skip" }));
    expect(skip.batch.assistants).toEqual([]);
    expect(skip.batch.conversations).toEqual([]);
    expect(skip.counts.assistant.skip).toBe(1);
    const overwrite = planImport(file, index, merge({ strategy: "overwrite" }));
    expect(overwrite.batch.assistants[0]?.id).toBe("a1");
    expect(overwrite.batch.replaceMessagesFor).toEqual(["c1"]);
  });

  it("gives duplicate ids inside the file new ids", () => {
    const dupFile = snapshot({ assistants: [assistant("a1", { name: "First" }), assistant("a1", { name: "Second" })], tags: [tag("t1", "A"), tag("t1", "B")] });
    const plan = planImport(dupFile, emptyIndex, merge());
    expect(plan.batch.assistants[0]?.id).toBe("a1");
    expect(new Set(plan.batch.assistants.map((a) => a.id)).size).toBe(2);
    expect(new Set(plan.batch.tags.map((t) => t.id)).size).toBe(2);
    expect(plan.duplicateIdsInFile).toContainEqual({ entity: "assistant", id: "a1" });
    expect(plan.duplicateIdsInFile).toContainEqual({ entity: "tag", id: "t1" });
  });

  it("drops references to things that exist neither in the file nor locally", () => {
    const orphan = snapshot({ assistants: [assistant("a1", { tagIds: ["ghost"], defaultProviderId: "nowhere", defaultModelId: "m" })] });
    const plan = planImport(orphan, emptyIndex, merge());
    expect(plan.batch.assistants[0]).toMatchObject({ tagIds: [], defaultProviderId: null, defaultModelId: null });
  });

  it("replace mode adds everything and applies settings", () => {
    const plan = planImport(file, { ...emptyIndex, assistants: [{ id: "a1", name: "x", isDefault: true }] }, { ...merge(), mode: "replace" });
    expect(plan.conflicts).toEqual([]);
    expect(plan.batch.assistants[0]).toMatchObject({ id: "a1", isDefault: true });
    expect(plan.batch.settings).toMatchObject({ defaultProviderId: "p1", defaultModelId: "gpt-4o" });
    expect(plan.warnings).toContain("replace_deletes_data");
    expect(plan.includesConversations).toBe(true);
  });

  it("collects secrets for re-encryption", () => {
    const withKey = snapshot({ providers: [{ ...provider("p1"), secrets: { apiKey: "sk-abc" } }] as never });
    const plan = planImport(withKey, emptyIndex, merge());
    expect(plan.secrets).toEqual([{ providerId: "p1", secrets: { apiKey: "sk-abc" } }]);
    expect(plan.warnings).toContain("keys_included");
    expect(JSON.stringify(plan.batch)).not.toContain("sk-abc");
  });
});

describe("applyImport", () => {
  function recorder(local?: ReturnType<typeof provider>) {
    const writes: { batch: TransferBatch; options: TransferWriteOptions }[] = [];
    const repos = {
      transfer: { write: async (batch: TransferBatch, options: TransferWriteOptions) => void writes.push({ batch, options }) },
      providers: { get: async (id: string) => (local?.id === id ? local : undefined) },
      settings: { get: async () => ({ ...DEFAULT_SETTINGS, backup: { ...DEFAULT_SETTINGS.backup, webdav: { ...DEFAULT_SETTINGS.backup.webdav, url: "https://local.dav/" } } }) },
    } as unknown as Repositories;
    return { repos, writes };
  }
  const encrypt = async (plain: string, id: string, field: string): Promise<EncryptedSecret> => ({ algorithm: "AES-GCM", keyId: "device", iv: `${id}:${field}`, ciphertext: `enc(${plain})` });

  it("re-encrypts imported keys with the local vault", async () => {
    const plan = planImport(snapshot({ providers: [{ ...provider("p1"), secrets: { apiKey: "sk-abc", headers: { "X-A": "1" } } }] as never }), emptyIndex, merge());
    const { repos, writes } = recorder();
    const result = await applyImport(plan, { repos, encrypt });
    expect(result.keysImported).toBe(1);
    const written = writes[0]!.batch.providers[0]!;
    expect(written.encryptedApiKey).toMatchObject({ iv: "p1:apiKey", ciphertext: "enc(sk-abc)" });
    expect(written.encryptedHeaders).toMatchObject({ iv: "p1:headers" });
    expect(writes[0]!.options).toEqual({ replace: false, replaceConversations: false });
  });

  it("keeps local keys when the file has none (overwrite)", async () => {
    const localKey: EncryptedSecret = { algorithm: "AES-GCM", keyId: "device", iv: "local", ciphertext: "local" };
    const plan = planImport(snapshot({ providers: [provider("p1", { name: "From file" })] }), { ...emptyIndex, providers: [{ id: "p1", name: "Mine" }] }, merge({ strategy: "overwrite" }));
    const { repos, writes } = recorder(provider("p1", { encryptedApiKey: localKey }));
    await applyImport(plan, { repos, encrypt });
    expect(writes[0]!.batch.providers[0]).toMatchObject({ name: "From file", encryptedApiKey: localKey });
  });

  it("passes replace flags through", async () => {
    const plan = planImport(snapshot({ conversations: [] }), emptyIndex, { ...merge(), mode: "replace" });
    const { repos, writes } = recorder();
    const result = await applyImport(plan, { repos, encrypt });
    expect(writes[0]!.options).toEqual({ replace: true, replaceConversations: true });
    expect(result.settings).toBe(true);
    // This device's WebDAV configuration survives an import.
    expect(writes[0]!.batch.settings?.backup.webdav.url).toBe("https://local.dav/");
  });
});
