/**
 * "Delete all my data" beyond IndexedDB: OPFS files (large attachments), Cache Storage
 * (offline copies, may contain fetched media), and Nova keys in local/session storage.
 * The app shell is re-cached by the service worker on the next load.
 */
export interface WipeReport {
  opfsEntries: number;
  caches: number;
  storageKeys: number;
}

export async function wipeBrowserStorage(): Promise<WipeReport> {
  const report: WipeReport = { opfsEntries: 0, caches: 0, storageKeys: 0 };
  try {
    const root = await navigator.storage?.getDirectory?.();
    if (root) {
      const names: string[] = [];
      for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
      for (const name of names) {
        await root.removeEntry(name, { recursive: true });
        report.opfsEntries += 1;
      }
    }
  } catch {
    /* OPFS unavailable */
  }
  try {
    if (typeof caches !== "undefined") {
      for (const name of await caches.keys()) {
        await caches.delete(name);
        report.caches += 1;
      }
    }
  } catch {
    /* Cache Storage unavailable */
  }
  for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
    if (!store) continue;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && /^nova[:\-_.]/i.test(key)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
    report.storageKeys += keys.length;
  }
  return report;
}
