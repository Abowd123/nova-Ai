import type { NovaDatabase } from "@/lib/storage/dexie/database";
import type { KeyStore } from "./vault";

/** CryptoKey objects are structured-cloneable, so IndexedDB stores them without exposing bytes. */
export class DexieKeyStore implements KeyStore {
  constructor(private readonly db: NovaDatabase) {}

  async get(id: string): Promise<CryptoKey | undefined> {
    return (await this.db.cryptoKeys.get(id))?.key;
  }

  async put(id: string, key: CryptoKey): Promise<void> {
    await this.db.cryptoKeys.put({ id, key, createdAt: Date.now() });
  }

  async delete(id: string): Promise<void> {
    await this.db.cryptoKeys.delete(id);
  }
}
