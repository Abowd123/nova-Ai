import { encryptedSecretSchema, secretIdSchema } from "@/lib/models";
import { withStorageErrors } from "../../errors";
import type { RepositoryDeps, SecretRepository } from "../../types";
import type { NovaDatabase } from "../database";
import { parseOrThrow } from "../utils";

/** Stores only ciphertext produced by SecretVault. Plaintext never reaches IndexedDB. */
export function createSecretRepository(db: NovaDatabase, deps: RepositoryDeps): SecretRepository {
  return {
    get: (id) =>
      withStorageErrors(async () => {
        const row = await db.secrets.get(parseOrThrow(secretIdSchema, id, "secret id"));
        return row ? parseOrThrow(encryptedSecretSchema, row.value, "secret") : undefined;
      }),
    set: (id, value) =>
      withStorageErrors(async () => {
        await db.secrets.put({
          id: parseOrThrow(secretIdSchema, id, "secret id"),
          value: parseOrThrow(encryptedSecretSchema, value, "secret"),
          updatedAt: deps.clock(),
        });
      }),
    delete: (id) =>
      withStorageErrors(async () => {
        await db.secrets.delete(id);
      }),
    has: (id) => withStorageErrors(async () => (await db.secrets.get(id)) !== undefined),
    list: () => withStorageErrors(async () => (await db.secrets.toArray()).map((row) => ({ id: row.id, updatedAt: row.updatedAt }))),
  };
}
