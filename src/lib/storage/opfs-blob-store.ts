import { StorageError } from "./errors";
import type { BlobStore } from "./types";

const DIRECTORY = "nova-attachments";
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

interface OpfsDirectory {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDirectory>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    getFile(): Promise<File>;
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>;
  }>;
  removeEntry(name: string): Promise<void>;
  keys(): AsyncIterableIterator<string>;
}

export function opfsAvailable(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function";
}

function checkId(id: string): string {
  if (!SAFE_ID.test(id)) throw new StorageError("VALIDATION", "Invalid attachment id for file storage");
  return id;
}

function wrap(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  const name = (error as { name?: string } | null)?.name;
  if (name === "QuotaExceededError") return new StorageError("QUOTA_EXCEEDED", "Storage is full", { cause: error });
  if (name === "NotFoundError") return new StorageError("NOT_FOUND", "File not found", { cause: error });
  return new StorageError("UNAVAILABLE", "File storage failed", { cause: error });
}

/**
 * Origin Private File System store (File System Access API family). Better for large
 * videos than IndexedDB: files are streamed to disk and not loaded into the DB.
 */
export function createOpfsBlobStore(getRoot: () => Promise<OpfsDirectory> = async () => (await navigator.storage.getDirectory()) as unknown as OpfsDirectory): BlobStore {
  let directory: Promise<OpfsDirectory> | null = null;
  const dir = () => (directory ??= getRoot().then((root) => root.getDirectoryHandle(DIRECTORY, { create: true })));

  return {
    kind: "opfs",
    async put(id, blob) {
      try {
        const handle = await (await dir()).getFileHandle(checkId(id), { create: true });
        const writable = await handle.createWritable();
        try {
          await writable.write(blob);
          await writable.close();
        } catch (error) {
          await writable.abort?.().catch(() => undefined);
          throw error;
        }
      } catch (error) {
        throw wrap(error);
      }
    },
    async get(id) {
      try {
        const handle = await (await dir()).getFileHandle(checkId(id));
        return await handle.getFile();
      } catch (error) {
        const wrapped = wrap(error);
        if (wrapped.code === "NOT_FOUND") return undefined;
        throw wrapped;
      }
    },
    async delete(id) {
      try {
        await (await dir()).removeEntry(checkId(id));
      } catch (error) {
        const wrapped = wrap(error);
        if (wrapped.code !== "NOT_FOUND") throw wrapped;
      }
    },
    async list() {
      try {
        const ids: string[] = [];
        for await (const name of (await dir()).keys()) ids.push(name);
        return ids;
      } catch (error) {
        throw wrap(error);
      }
    },
  };
}
