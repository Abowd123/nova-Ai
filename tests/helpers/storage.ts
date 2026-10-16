import { NovaDatabase } from "@/lib/storage/dexie/database";
import { createDexieRepositories } from "@/lib/storage/dexie/create-repositories";
import type { Repositories } from "@/lib/storage/types";

export interface TestContext {
  db: NovaDatabase;
  repos: Repositories;
  destroy: () => Promise<void>;
}

export function uniqueDbName(prefix = "nova-test"): string {
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

/** Fresh isolated DB with a deterministic clock (+1s per call) and sequential ids. */
export async function createTestContext(
  options: { idGenerator?: () => string } = {},
): Promise<TestContext> {
  const db = new NovaDatabase(uniqueDbName());
  let time = 1_700_000_000_000;
  let counter = 0;
  const repos = createDexieRepositories(db, {
    clock: () => (time += 1000),
    idGenerator: options.idGenerator ?? (() => `id-${++counter}`),
  });
  await db.open();
  return {
    db,
    repos,
    destroy: async () => {
      db.close();
      await db.delete();
    },
  };
}
