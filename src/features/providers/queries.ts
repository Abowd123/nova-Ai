"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRepositories } from "@/components/providers/repository-provider";
import { useServices } from "@/components/providers/services-provider";
import type { ProviderDraft } from "./provider-service";

export const providerKeys = {
  all: ["providers"] as const,
  headers: (id: string) => ["providers", "headers", id] as const,
};

export function useProviders() {
  const repos = useRepositories();
  return useQuery({ queryKey: providerKeys.all, queryFn: () => repos().providers.list() });
}

export function useProviderHeaderNames(id: string | null) {
  const services = useServices();
  return useQuery({
    queryKey: providerKeys.headers(id ?? "none"),
    queryFn: () => (id ? services().providers.headerNames(id) : Promise.resolve([])),
    enabled: Boolean(id),
    staleTime: 0,
  });
}

function useProviderMutation<V, R>(fn: (variables: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: providerKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useSaveProvider() {
  const services = useServices();
  return useProviderMutation(({ draft, id }: { draft: ProviderDraft; id?: string }) => services().providers.save(draft, id));
}

export function useDeleteProvider() {
  const services = useServices();
  return useProviderMutation((id: string) => services().providers.delete(id));
}

export function useToggleProvider() {
  const services = useServices();
  return useProviderMutation(({ id, enabled }: { id: string; enabled: boolean }) => services().providers.setEnabled(id, enabled));
}

export function useTestProvider() {
  const services = useServices();
  return useMutation({ mutationFn: (id: string) => services().providers.test(id) });
}

export function useFetchModels() {
  const services = useServices();
  return useProviderMutation((id: string) => services().providers.fetchModels(id));
}

export function useToggleModel() {
  const services = useServices();
  return useProviderMutation(({ id, modelId, enabled }: { id: string; modelId: string; enabled: boolean }) =>
    services().providers.setModelEnabled(id, modelId, enabled),
  );
}

export function useToggleAllModels() {
  const services = useServices();
  return useProviderMutation(({ id, enabled }: { id: string; enabled: boolean }) => services().providers.setAllModelsEnabled(id, enabled));
}

export function useSetDefaultModel() {
  const services = useServices();
  return useProviderMutation(({ id, modelId }: { id: string; modelId: string }) => services().providers.setDefaultModel(id, modelId));
}

export function useAddManualModel() {
  const services = useServices();
  return useProviderMutation(({ id, modelId }: { id: string; modelId: string }) => services().providers.addManualModel(id, modelId));
}
