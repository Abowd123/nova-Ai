import { NovaDatabase } from "./dexie/database";
import { createDexieRepositories } from "./dexie/create-repositories";
import { StorageError } from "./errors";
import type { Repositories } from "./types";
import { DexieKeyStore } from "@/lib/crypto/dexie-key-store";
import type { KeyStore } from "@/lib/crypto/vault";

export * from "./types";
export * from "./errors";

let instance: Repositories | null = null;
let database: NovaDatabase | null = null;

function getDatabase(): NovaDatabase {
  if (typeof indexedDB === "undefined") {
    throw new StorageError("UNAVAILABLE", "IndexedDB is not available in this environment");
  }
  database ??= new NovaDatabase();
  return database;
}

/** Lazily creates the browser repositories. Never call during SSR. */
export function getRepositories(): Repositories {
  instance ??= createDexieRepositories(getDatabase());
  return instance;
}

/** Key store for the secret vault (same IndexedDB database). */
export function getKeyStore(): KeyStore {
  return new DexieKeyStore(getDatabase());
}

/** Test hook. */
export function setRepositoriesForTesting(repositories: Repositories | null): void {
  instance = repositories;
}
