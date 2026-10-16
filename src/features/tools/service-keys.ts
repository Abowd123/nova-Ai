import type { SecretVault } from "@/lib/crypto/vault";
import { audit } from "@/lib/audit";
import type { Repositories } from "@/lib/storage/types";

/** API keys of non-chat services, AES-GCM encrypted in IndexedDB (never shown again, never exported in plaintext). */
export type ServiceKeyName = "tavily" | "brave" | "exa";

const secretId = (service: ServiceKeyName) => `service:${service}`;
const context = (service: ServiceKeyName) => `nova:service:${service}`;

export class ServiceKeys {
  constructor(private readonly deps: { repos: Repositories; vault: Pick<SecretVault, "encrypt" | "decrypt"> }) {}

  async set(service: ServiceKeyName, key: string): Promise<void> {
    const value = key.trim();
    if (!value) {
      await this.deps.repos.secrets.delete(secretId(service));
      audit("key_removed", `service ${service}`);
      return;
    }
    await this.deps.repos.secrets.set(secretId(service), await this.deps.vault.encrypt(value, context(service)));
    audit("key_saved", `service ${service}`);
  }

  has(service: ServiceKeyName): Promise<boolean> {
    return this.deps.repos.secrets.has(secretId(service));
  }

  async get(service: ServiceKeyName): Promise<string | undefined> {
    const stored = await this.deps.repos.secrets.get(secretId(service));
    return stored ? this.deps.vault.decrypt(stored, context(service)) : undefined;
  }
}
