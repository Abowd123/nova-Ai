"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRepositories } from "@/components/providers/repository-provider";
import { useServices } from "@/components/providers/services-provider";
import type { AppSettingsPatch } from "@/lib/models";
import { audit } from "@/lib/audit";
import { wipeBrowserStorage } from "@/lib/storage/wipe";

export const settingsKeys = { all: ["settings"] as const, storage: ["storage-estimate"] as const };

export function useSettings() {
  const repos = useRepositories();
  return useQuery({ queryKey: settingsKeys.all, queryFn: () => repos().settings.get() });
}

export function useUpdateSettings() {
  const repos = useRepositories();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: AppSettingsPatch) => repos().settings.update(patch),
    onSuccess: (settings) => queryClient.setQueryData(settingsKeys.all, settings),
  });
}

export function useClearAllData() {
  const repos = useRepositories();
  const services = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      services().chat.stopAll();
      services().scheduler.stop();
      await repos().clearAll();
      // The vault key was wiped with the tables: drop the cached handle too.
      await services().vault.destroy();
      const report = await wipeBrowserStorage();
      audit("data_cleared", `IndexedDB, ${report.opfsEntries} files, ${report.caches} caches`);
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export function useStorageEstimate() {
  return useQuery({
    queryKey: settingsKeys.storage,
    queryFn: async () => {
      if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
      const estimate = await navigator.storage.estimate();
      return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
    },
  });
}
