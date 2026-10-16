/**
 * Cross-tab ownership of a running stream. With the Web Locks API a lock is released
 * automatically when its tab closes or reloads, so recovery can tell an abandoned stream
 * from one still running in another tab without guessing from timestamps.
 */
export interface StreamLocks {
  acquire(name: string): Promise<() => void>;
  /** null when the platform cannot report held locks (fallback to heartbeats). */
  heldNames(): Promise<Set<string> | null>;
}

export function streamLockName(messageId: string): string {
  return `nova-stream:${messageId}`;
}

export function createWebLocks(): StreamLocks | undefined {
  if (typeof navigator === "undefined" || !("locks" in navigator) || !navigator.locks) return undefined;
  const locks = navigator.locks;
  return {
    acquire: (name) =>
      new Promise((resolve) => {
        void locks.request(name, () => new Promise<void>((release) => resolve(release))).catch(() => resolve(() => undefined));
      }),
    heldNames: async () => {
      try {
        const snapshot = await locks.query();
        return new Set((snapshot.held ?? []).map((lock) => lock.name).filter((n): n is string => Boolean(n)));
      } catch {
        return null;
      }
    },
  };
}
