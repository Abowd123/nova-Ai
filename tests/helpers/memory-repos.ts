import { DEFAULT_SETTINGS, type AppSettings, type EncryptedSecret, type SyncConflict, type SyncRecordState } from "@/lib/models";
import { mergeSettings } from "@/lib/models/settings-merge";
import { DATA_TABLES } from "@/lib/storage/data-tables";
import type { BlobStore, Repositories } from "@/lib/storage/types";

type Row = Record<string, unknown>;

/**
 * In-memory implementation of the repository subset used by backup + sync
 * (lets those services run in plain Node without IndexedDB).
 */
export function memoryRepos(seed: Partial<Record<string, Row[]>> = {}) {
  const tables = new Map<string, Map<string, Row>>();
  const pk = (table: string) => (table === "settings" ? "key" : "id");
  for (const name of DATA_TABLES) tables.set(name, new Map());
  for (const [name, rows] of Object.entries(seed)) for (const row of rows ?? []) tables.get(name)!.set(String(row[pk(name)]), structuredClone(row));
  const secrets = new Map<string, { value: EncryptedSecret; updatedAt: number }>();
  const syncRecords = new Map<string, SyncRecordState>();
  const syncState = new Map<string, unknown>();
  const conflicts = new Map<string, SyncConflict>();
  const blobs = new Map<string, Blob>();
  const audit: { kind: string; detail: string }[] = [];
  const table = (name: string) => {
    const t = tables.get(name);
    if (!t) throw new Error(`no table ${name}`);
    return t;
  };

  const blobStore: BlobStore = {
    kind: "idb",
    put: async (id, blob) => void blobs.set(id, blob),
    get: async (id) => blobs.get(id),
    delete: async (id) => void blobs.delete(id),
    list: async () => [...blobs.keys()],
  };

  const settingsGet = async (): Promise<AppSettings> => mergeSettings(table("settings").get("app")?.value ?? DEFAULT_SETTINGS);

  const repos = {
    settings: {
      get: settingsGet,
      update: async (patch: Partial<AppSettings>) => {
        const next = { ...(await settingsGet()), ...patch };
        table("settings").set("app", { key: "app", value: next, updatedAt: Date.now() });
        return next;
      },
    },
    secrets: {
      get: async (id: string) => secrets.get(id)?.value,
      set: async (id: string, value: EncryptedSecret) => void secrets.set(id, { value, updatedAt: Date.now() }),
      delete: async (id: string) => void secrets.delete(id),
      has: async (id: string) => secrets.has(id),
      list: async () => [...secrets.entries()].map(([id, v]) => ({ id, updatedAt: v.updatedAt })),
    },
    providers: { list: async () => [...table("providers").values()].map((r) => structuredClone(r)) },
    blobs: blobStore,
    backup: {
      dataTables: () => DATA_TABLES,
      rows: async (name: string) => [...table(name).values()].map((r) => structuredClone(r)),
      getRows: async (name: string, ids: readonly string[]) => ids.map((id) => (table(name).has(id) ? structuredClone(table(name).get(id)!) : undefined)),
      replaceTables: async (data: Record<string, Row[]>) => {
        for (const [name, rows] of Object.entries(data)) {
          table(name).clear();
          for (const row of rows) table(name).set(String(row[pk(name)]), structuredClone(row));
        }
      },
      putRows: async (name: string, rows: Row[]) => {
        for (const row of rows) table(name).set(String(row[pk(name)]), structuredClone(row));
      },
      deleteRows: async (name: string, ids: string[]) => {
        for (const id of ids) table(name).delete(id);
      },
    },
    sync: {
      records: async (keys?: readonly string[]) => (keys ? keys.map((k) => syncRecords.get(k)).filter((r): r is SyncRecordState => Boolean(r)) : [...syncRecords.values()]),
      putRecords: async (states: SyncRecordState[]) => states.forEach((s) => syncRecords.set(s.key, { ...s })),
      clearRecords: async () => syncRecords.clear(),
      getState: async <T,>(key: string) => syncState.get(key) as T | undefined,
      setState: async (key: string, value: unknown) => void syncState.set(key, structuredClone(value)),
      deleteState: async (key: string) => void syncState.delete(key),
      addConflict: async (c: SyncConflict) => void conflicts.set(c.id, c),
      conflicts: async (status?: string) => [...conflicts.values()].filter((c) => !status || c.status === status),
      getConflict: async (id: string) => conflicts.get(id),
      resolveConflict: async (id: string, at: number) => {
        const c = conflicts.get(id);
        if (c) conflicts.set(id, { ...c, status: "resolved", resolvedAt: at });
      },
      clearConflicts: async () => conflicts.clear(),
    },
    audit: { add: async (kind: string, detail: string) => (audit.push({ kind, detail }), { id: "a", at: 0, kind, detail }), list: async () => [], clear: async () => undefined },
  };

  return {
    repos: repos as unknown as Repositories,
    tables,
    secrets,
    blobs,
    syncState,
    audit,
    row: (name: string, id: string) => table(name).get(id),
    put: (name: string, row: Row) => table(name).set(String(row[pk(name)]), structuredClone(row)),
    remove: (name: string, id: string) => table(name).delete(id),
  };
}
