import type { HttpClient } from "@/lib/ai/types";
import type { SecretVault } from "@/lib/crypto/vault";
import { secretTableContext } from "@/lib/crypto/vault";
import { WEBDAV_PASSWORD_SECRET, type WebDavSettings } from "@/lib/models";
import type { Repositories } from "@/lib/storage/types";
import { WebDavClient } from "@/lib/webdav/client";
import { BackupError } from "./errors";

/** Shared by backups and sync: builds the WebDAV client from settings + the encrypted password. */
export interface RemoteDeps {
  repos: Repositories;
  vault: Pick<SecretVault, "encrypt" | "decrypt">;
  httpFor: (viaProxy: boolean) => HttpClient;
}

export function joinPath(...parts: string[]): string {
  return parts
    .flatMap((p) => p.split("/"))
    .filter(Boolean)
    .join("/");
}

export async function getSecretText(deps: Pick<RemoteDeps, "repos" | "vault">, id: string): Promise<string | undefined> {
  const stored = await deps.repos.secrets.get(id);
  return stored ? deps.vault.decrypt(stored, secretTableContext(id)) : undefined;
}

export async function setSecretText(deps: Pick<RemoteDeps, "repos" | "vault">, id: string, value: string): Promise<void> {
  if (!value) await deps.repos.secrets.delete(id);
  else await deps.repos.secrets.set(id, await deps.vault.encrypt(value, secretTableContext(id)));
}

export async function createRemote(deps: RemoteDeps, config?: WebDavSettings, passwordOverride?: string): Promise<{ client: WebDavClient; root: string }> {
  const webdav = config ?? (await deps.repos.settings.get()).backup.webdav;
  if (!webdav.url.trim()) throw new BackupError("not_configured", "Set up WebDAV first");
  const secret = passwordOverride ?? (await getSecretText(deps, WEBDAV_PASSWORD_SECRET)) ?? "";
  const client = new WebDavClient({
    baseUrl: webdav.url,
    auth: webdav.authType === "bearer" ? (secret ? { type: "bearer", token: secret } : null) : webdav.username ? { type: "basic", username: webdav.username, password: secret } : null,
    http: deps.httpFor(webdav.viaProxy),
  });
  return { client, root: joinPath(webdav.rootPath || "Nova") };
}

export function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}
