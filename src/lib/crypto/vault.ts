import type { EncryptedSecret } from "@/lib/models";
import { base64ToBytes, bytesToBase64 } from "./encoding";

export const VAULT_KEY_ID = "vault-master-v1";

/** Where the non-extractable CryptoKey lives (IndexedDB in the app, memory in tests). */
export interface KeyStore {
  get(id: string): Promise<CryptoKey | undefined>;
  put(id: string, key: CryptoKey): Promise<void>;
  delete(id: string): Promise<void>;
}

export class VaultError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VaultError";
  }
}

export class MemoryKeyStore implements KeyStore {
  private readonly keys = new Map<string, CryptoKey>();
  async get(id: string) {
    return this.keys.get(id);
  }
  async put(id: string, key: CryptoKey) {
    this.keys.set(id, key);
  }
  async delete(id: string) {
    this.keys.delete(id);
  }
}

/**
 * AES-GCM-256 secret vault.
 *
 * - The master key is generated with `extractable: false`: JavaScript (including an XSS
 *   payload or a malicious export) can never read the raw key bytes, only ask the browser
 *   to encrypt/decrypt while the page is open.
 * - Every secret gets a fresh 96-bit IV.
 * - `context` is bound as additional authenticated data, so a ciphertext copied from one
 *   provider/field to another fails to decrypt.
 * - Ciphertexts are useless off-device (exports, backups, DevTools copies).
 */
export class SecretVault {
  private keyPromise: Promise<CryptoKey> | null = null;

  constructor(
    private readonly store: KeyStore,
    private readonly subtle: SubtleCrypto = globalThis.crypto?.subtle,
    private readonly random: (bytes: Uint8Array) => Uint8Array = (bytes) => globalThis.crypto.getRandomValues(bytes),
  ) {
    if (!this.subtle) throw new VaultError("Web Crypto is unavailable (requires a secure context: HTTPS or localhost)");
  }

  private getKey(): Promise<CryptoKey> {
    this.keyPromise ??= (async () => {
      const existing = await this.store.get(VAULT_KEY_ID);
      if (existing) return existing;
      const key = await this.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      await this.store.put(VAULT_KEY_ID, key);
      return key;
    })().catch((error: unknown) => {
      this.keyPromise = null;
      throw new VaultError("Could not initialise the encryption key", { cause: error });
    });
    return this.keyPromise;
  }

  async encrypt(plaintext: string, context: string): Promise<EncryptedSecret> {
    const key = await this.getKey();
    const iv = this.random(new Uint8Array(12));
    const ciphertext = await this.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
      key,
      new TextEncoder().encode(plaintext),
    );
    return {
      algorithm: "AES-GCM",
      keyId: VAULT_KEY_ID,
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    };
  }

  async decrypt(secret: EncryptedSecret, context: string): Promise<string> {
    if (secret.keyId !== VAULT_KEY_ID) throw new VaultError("Secret was encrypted with an unknown key");
    const key = await this.getKey();
    try {
      const plaintext = await this.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(secret.iv), additionalData: new TextEncoder().encode(context) },
        key,
        base64ToBytes(secret.ciphertext),
      );
      return new TextDecoder().decode(plaintext);
    } catch (error) {
      throw new VaultError("Secret could not be decrypted (wrong device, key reset or tampering)", { cause: error });
    }
  }

  /** Forgets the key: every stored secret becomes unreadable. */
  async destroy(): Promise<void> {
    this.keyPromise = null;
    await this.store.delete(VAULT_KEY_ID);
  }
}

export function secretContext(providerId: string, field: "apiKey" | "headers"): string {
  return `nova:provider:${providerId}:${field}`;
}

/** Vault AAD for records of the secrets table ("service:tavily" → "nova:service:tavily"). */
export function secretTableContext(secretId: string): string {
  return `nova:${secretId}`;
}
