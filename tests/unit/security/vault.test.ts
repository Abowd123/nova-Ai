// @vitest-environment node
import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryKeyStore, SecretVault, VAULT_KEY_ID, VaultError, secretContext } from "@/lib/crypto/vault";

function makeVault(store = new MemoryKeyStore()) {
  return new SecretVault(store, webcrypto.subtle as unknown as SubtleCrypto, (bytes) => webcrypto.getRandomValues(bytes));
}

describe("SecretVault", () => {
  it("round-trips secrets and never stores plaintext", async () => {
    const vault = makeVault();
    const secret = await vault.encrypt("sk-live-abcdef", "ctx");
    expect(secret).toMatchObject({ algorithm: "AES-GCM", keyId: VAULT_KEY_ID });
    expect(JSON.stringify(secret)).not.toContain("sk-live");
    expect(await vault.decrypt(secret, "ctx")).toBe("sk-live-abcdef");
  });

  it("uses a fresh IV for every encryption", async () => {
    const vault = makeVault();
    const a = await vault.encrypt("same", "ctx");
    const b = await vault.encrypt("same", "ctx");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("binds ciphertext to its context (no swapping between providers)", async () => {
    const vault = makeVault();
    const secret = await vault.encrypt("k", secretContext("provider-a", "apiKey"));
    await expect(vault.decrypt(secret, secretContext("provider-b", "apiKey"))).rejects.toBeInstanceOf(VaultError);
  });

  it("detects tampering", async () => {
    const vault = makeVault();
    const secret = await vault.encrypt("k", "ctx");
    const bytes = Buffer.from(secret.ciphertext, "base64");
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    await expect(vault.decrypt({ ...secret, ciphertext: bytes.toString("base64") }, "ctx")).rejects.toBeInstanceOf(VaultError);
  });

  it("generates a NON-extractable key and reuses it", async () => {
    const store = new MemoryKeyStore();
    const vault = makeVault(store);
    const secret = await vault.encrypt("k", "ctx");
    const key = await store.get(VAULT_KEY_ID);
    expect(key?.extractable).toBe(false);
    await expect(webcrypto.subtle.exportKey("raw", key as never)).rejects.toThrow();
    // A second vault on the same store can decrypt (survives reloads).
    expect(await makeVault(store).decrypt(secret, "ctx")).toBe("k");
  });

  it("secrets are unreadable after destroy (delete all data)", async () => {
    const store = new MemoryKeyStore();
    const vault = makeVault(store);
    const secret = await vault.encrypt("k", "ctx");
    await vault.destroy();
    await expect(makeVault(store).decrypt(secret, "ctx")).rejects.toBeInstanceOf(VaultError);
  });

  it("rejects secrets from an unknown key", async () => {
    const vault = makeVault();
    const secret = await vault.encrypt("k", "ctx");
    await expect(vault.decrypt({ ...secret, keyId: "other" }, "ctx")).rejects.toBeInstanceOf(VaultError);
  });
});
