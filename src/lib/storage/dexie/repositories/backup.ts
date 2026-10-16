import { auditEntrySchema, syncConflictSchema, type AuditEntry, type SyncConflict, type SyncRecordState } from "@/lib/models";
import { redactSecrets } from "@/lib/security/redact";
import { StorageError, withStorageErrors } from "../../errors";
import type { AuditRepository, BackupRepository, RepositoryDeps, SyncRepository } from "../../types";
import type { NovaDatabase } from "../database";
import { parseOrThrow } from "../utils";

import { DATA_TABLES } from "../../data-tables";

export { DATA_TABLES };

export function createBackupRepository(db: NovaDatabase): BackupRepository {
  const table = (name: string) => {
    if (!(DATA_TABLES as readonly string[]).includes(name)) throw new StorageError("VALIDATION", `Table ${name} is not a data table`);
    return db.table<Record<string, unknown>, string>(name);
  };
  return {
    dataTables: () => DATA_TABLES,
    rows: (name) => withStorageErrors(() => table(name).toArray()),
    getRows: (name, ids) => withStorageErrors(() => table(name).bulkGet([...ids])),
    replaceTables: (data) =>
      withStorageErrors(async () => {
        const tables = Object.keys(data).map(table);
        await db.transaction("rw", tables, async () => {
          for (const [name, rows] of Object.entries(data)) {
            await table(name).clear();
            if (rows.length) await table(name).bulkPut(rows);
          }
        });
      }),
    putRows: (name, rows) => withStorageErrors(async () => void (rows.length && (await table(name).bulkPut(rows)))),
    deleteRows: (name, ids) => withStorageErrors(async () => void (ids.length && (await table(name).bulkDelete(ids)))),
  };
}

export function createSyncRepository(db: NovaDatabase): SyncRepository {
  return {
    records: (keys) => withStorageErrors(async () => (keys ? (await db.syncRecords.bulkGet([...keys])).filter((r): r is SyncRecordState => Boolean(r)) : db.syncRecords.toArray())),
    putRecords: (states) => withStorageErrors(async () => void (states.length && (await db.syncRecords.bulkPut(states)))),
    clearRecords: () => withStorageErrors(() => db.syncRecords.clear()),
    getState: <T,>(key: string) => withStorageErrors(async () => (await db.syncState.get(key))?.value as T | undefined),
    setState: (key, value) => withStorageErrors(async () => void (await db.syncState.put({ key, value }))),
    deleteState: (key) => withStorageErrors(() => db.syncState.delete(key)),
    addConflict: (conflict) => withStorageErrors(async () => void (await db.syncConflicts.put(parseOrThrow(syncConflictSchema, conflict, "sync conflict")))),
    conflicts: (status) =>
      withStorageErrors(async () => {
        const rows = status ? await db.syncConflicts.where("status").equals(status).toArray() : await db.syncConflicts.toArray();
        return rows.sort((a, b) => b.createdAt - a.createdAt);
      }),
    getConflict: (id) => withStorageErrors(() => db.syncConflicts.get(id)),
    resolveConflict: (id, at) => withStorageErrors(async () => void (await db.syncConflicts.update(id, { status: "resolved", resolvedAt: at }))),
    clearConflicts: () => withStorageErrors(() => db.syncConflicts.clear()),
  };
}

export const AUDIT_MAX_ENTRIES = 2000;

export function createAuditRepository(db: NovaDatabase, deps: RepositoryDeps): AuditRepository {
  return {
    add: (kind, detail) =>
      withStorageErrors(async () => {
        const entry: AuditEntry = parseOrThrow(auditEntrySchema, { id: deps.idGenerator(), at: deps.clock(), kind, detail: redactSecrets(detail).slice(0, 500) }, "audit entry");
        await db.auditLog.add(entry);
        const count = await db.auditLog.count();
        if (count > AUDIT_MAX_ENTRIES) {
          const old = await db.auditLog.orderBy("at").limit(count - AUDIT_MAX_ENTRIES).primaryKeys();
          await db.auditLog.bulkDelete(old);
        }
        return entry;
      }),
    list: (limit = 200) => withStorageErrors(() => db.auditLog.orderBy("at").reverse().limit(limit).toArray()),
    clear: () => withStorageErrors(() => db.auditLog.clear()),
  };
}

export type { SyncConflict };
