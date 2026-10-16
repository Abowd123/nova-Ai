"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { audit } from "@/lib/audit";
import { useRepositories } from "@/components/providers/repository-provider";
import { useServices } from "@/components/providers/services-provider";
import { clientEnv } from "@/env";
import { secretContext } from "@/lib/crypto/vault";
import { applyImport } from "@/lib/transfer/apply";
import { decryptWithPassword } from "@/lib/transfer/crypto-file";
import { TransferError } from "@/lib/transfer/errors";
import { exportFileName, exportToText } from "@/lib/transfer/export";
import { parseImportText, planImport, type ConflictStrategy, type ImportMode, type ParsedImport } from "@/lib/transfer/import";
import type { ExportSnapshot } from "@/lib/transfer/format";

const newId = () => crypto.randomUUID();

export function useExportData() {
  const repos = useRepositories();
  const services = useServices();
  return useMutation({
    mutationFn: async (options: { includeConversations: boolean; includeSecrets: boolean; password?: string }) => {
      const { text, encrypted, snapshot } = await exportToText(repos(), {
        ...options,
        appVersion: clientEnv.NEXT_PUBLIC_APP_VERSION,
        readSecrets: async (provider) => {
          const config = await services().providers.getConfig(provider.id);
          return { apiKey: config.apiKey, headers: config.headers };
        },
      });
      audit("export", `${encrypted ? "encrypted" : "plain"} file${options.includeConversations ? " with conversations" : ""}${options.includeSecrets ? " with API keys" : ""}`);
      return { text, encrypted, snapshot, fileName: exportFileName(new Date(), encrypted) };
    },
  });
}

/** Turns raw file text into a validated snapshot (decrypting first when needed). */
export async function readImport(text: string, password?: string): Promise<Extract<ParsedImport, { kind: "snapshot" }>> {
  const parsed = parseImportText(text);
  if (parsed.kind === "snapshot") return parsed;
  if (!password) throw new TransferError("password_required", "Password required");
  const inner = parseImportText(await decryptWithPassword(parsed.envelope, password));
  if (inner.kind !== "snapshot") throw new TransferError("unsupported_format", "Nested encryption is not supported");
  return inner;
}

export function usePlanImport() {
  const repos = useRepositories();
  return useMutation({
    mutationFn: async ({
      snapshot,
      migratedFrom,
      mode,
      strategy,
      applySettings,
    }: {
      snapshot: ExportSnapshot;
      migratedFrom: number | null;
      mode: ImportMode;
      strategy: ConflictStrategy;
      applySettings: boolean;
    }) => planImport(snapshot, await repos().transfer.index(), { mode, strategy, applySettings, migratedFrom, idGenerator: newId }),
  });
}

export function useApplyImport() {
  const repos = useRepositories();
  const services = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (plan: Awaited<ReturnType<typeof planImport>>) =>
      applyImport(plan, {
        repos: repos(),
        encrypt: (plaintext, providerId, field) => services().vault.encrypt(plaintext, secretContext(providerId, field)),
      }),
    onSuccess: (result) => {
      audit("import", `${result.assistants} assistants, ${result.providers} providers, ${result.conversations} conversations, ${result.keysImported} keys`);
      return queryClient.invalidateQueries();
    },
  });
}
