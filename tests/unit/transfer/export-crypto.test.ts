// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assistant, conversation, message, provider, tag } from "@tests/helpers/fixtures";
import { DEFAULT_SETTINGS, type EncryptedSecret } from "@/lib/models";
import type { Repositories } from "@/lib/storage/types";
import { decryptWithPassword, encryptWithPassword, passwordStrength } from "@/lib/transfer/crypto-file";
import { TransferError } from "@/lib/transfer/errors";
import { assistantFileName, buildSharedAssistant, buildSnapshot, exportFileName, exportToText } from "@/lib/transfer/export";
import { exportSnapshotSchema, hasSecrets } from "@/lib/transfer/format";

const fast = { iterations: 100_000 };
const model = { id: "gpt-4o", name: "GPT-4o", enabled: true, contextWindow: null, capabilities: { vision: true, audio: false, video: false, tools: true, reasoning: false }, inputCost: null, outputCost: null, source: "remote" as const };
const fakeSecret: EncryptedSecret = { algorithm: "AES-GCM", keyId: "device-key", iv: "AAAA", ciphertext: "BBBB" };

function fakeRepos() {
  const data = {
    assistants: [assistant("a1", { tagIds: ["t1"], defaultProviderId: "p1", defaultModelId: "gpt-4o", isDefault: true })],
    tags: [tag("t1", "Work")],
    providers: [provider("p1", { models: [model], defaultModelId: "gpt-4o", encryptedApiKey: fakeSecret })],
    settings: DEFAULT_SETTINGS,
    conversations: [conversation("c1", { messageCount: 1 })],
    messages: [message("m1", "c1")],
  };
  return {
    transfer: {
      readAll: async ({ includeConversations }: { includeConversations: boolean }) =>
        includeConversations ? data : { ...data, conversations: [], messages: [] },
    },
  } as unknown as Repositories;
}
const readSecrets = async () => ({ apiKey: "sk-live-secret-1234567890", headers: { "X-Org": "o1" } });
const base = { appVersion: "1.1.0", now: () => new Date("2026-10-16T00:00:00Z"), crypto: fast };

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(TransferError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe("buildSnapshot", () => {
  it("never includes ciphertexts or secrets by default", async () => {
    const snapshot = await buildSnapshot(fakeRepos(), { ...base, includeConversations: false, includeSecrets: false, readSecrets });
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain("encryptedApiKey");
    expect(json).not.toContain("sk-live");
    expect(json).not.toContain("BBBB");
    expect(hasSecrets(snapshot)).toBe(false);
    expect(snapshot).not.toHaveProperty("conversations");
    expect(snapshot.models).toEqual([{ ...model, providerId: "p1" }]);
    expect(exportSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("includes conversations with their messages when asked", async () => {
    const snapshot = await buildSnapshot(fakeRepos(), { ...base, includeConversations: true, includeSecrets: false });
    expect(snapshot.conversations?.[0]?.messages.map((m) => m.id)).toEqual(["m1"]);
  });

  it("requires a password to export secrets", async () => {
    await rejectsWith(buildSnapshot(fakeRepos(), { ...base, includeConversations: false, includeSecrets: true, readSecrets }), "password_required");
  });

  it("puts secrets only inside the encrypted file", async () => {
    const result = await exportToText(fakeRepos(), { ...base, includeConversations: false, includeSecrets: true, password: "correct horse 1", readSecrets });
    expect(result.encrypted).toBe(true);
    expect(result.text).not.toContain("sk-live");
    const plain = JSON.parse(await decryptWithPassword(JSON.parse(result.text), "correct horse 1"));
    expect(plain.providers[0].secrets).toEqual({ apiKey: "sk-live-secret-1234567890", headers: { "X-Org": "o1" } });
  });

  it("writes readable plain JSON without a password", async () => {
    const result = await exportToText(fakeRepos(), { ...base, includeConversations: false, includeSecrets: false });
    expect(result.encrypted).toBe(false);
    expect(JSON.parse(result.text).format).toBe("nova-export");
  });
});

describe("password encryption", () => {
  it("round-trips unicode text", async () => {
    const envelope = await encryptWithPassword("مرحبا Nova ✨", "pässwörd-123", fast);
    expect(envelope).toMatchObject({ format: "nova-export-encrypted", kdf: { name: "PBKDF2", iterations: 100_000 }, cipher: { name: "AES-GCM" } });
    expect(await decryptWithPassword(envelope, "pässwörd-123")).toBe("مرحبا Nova ✨");
  });

  it("uses a fresh salt and iv each time", async () => {
    const a = await encryptWithPassword("x", "password1", fast);
    const b = await encryptWithPassword("x", "password1", fast);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("rejects a wrong password, an empty password and tampering", async () => {
    const envelope = await encryptWithPassword("secret", "password1", fast);
    await rejectsWith(decryptWithPassword(envelope, "password2"), "wrong_password");
    await rejectsWith(decryptWithPassword(envelope, ""), "password_required");
    // Header is bound as AAD: lowering iterations or flipping compression must fail.
    await rejectsWith(decryptWithPassword({ ...envelope, compression: envelope.compression === "gzip" ? "none" : "gzip" }, "password1"), "wrong_password");
    const bytes = Buffer.from(envelope.ciphertext, "base64");
    bytes[0] ^= 1;
    await rejectsWith(decryptWithPassword({ ...envelope, ciphertext: bytes.toString("base64") }, "password1"), "wrong_password");
    await rejectsWith(decryptWithPassword({ format: "nope" }, "password1"), "unsupported_format");
  });

  it("rates password strength", () => {
    expect(passwordStrength("short")).toBe(0);
    expect(passwordStrength("abcdefgh")).toBe(1);
    expect(passwordStrength("Abcdefg1")).toBe(2);
    expect(passwordStrength("Correct-Horse-Battery-9")).toBe(3);
  });
});

describe("single assistant sharing", () => {
  it("strips local provider ids and default flag and keeps only its own tags", () => {
    const shared = buildSharedAssistant(
      assistant("a1", { name: "My Coder", isDefault: true, defaultProviderId: "p1", defaultModelId: "m", tagIds: ["t1"] }),
      [tag("t1", "Work"), tag("t2", "Other")],
      new Date("2026-10-16T00:00:00Z"),
    );
    expect(shared).toMatchObject({ format: "nova-assistant", version: 1, assistant: { isDefault: false, defaultProviderId: null, defaultModelId: null } });
    expect(shared.tags.map((t) => t.id)).toEqual(["t1"]);
  });

  it("builds safe file names", () => {
    expect(assistantFileName(assistant("a", { name: "مساعد / البرمجة!" }))).toMatch(/^nova-assistant-[\p{L}\p{N}-]+\.json$/u);
    expect(assistantFileName(assistant("a", { name: "***" }))).toBe("nova-assistant-export.json");
    expect(exportFileName(new Date("2026-10-16T05:00:00Z"), true)).toBe("nova-backup-2026-10-16-encrypted.json");
  });
});
