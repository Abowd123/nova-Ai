"use client";

import { useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRepositories } from "@/components/providers/repository-provider";
import { useServices } from "@/components/providers/services-provider";
import type { ComfyWorkflowCreateInput, ComfyWorkflowUpdateInput, ImageBackendKind, ImageGenParams } from "@/lib/models";

export const imageKeys = { generations: ["image-generations"] as const, workflows: ["comfy-workflows"] as const };

export function useImageGenerations() {
  const repos = useRepositories();
  return useQuery({ queryKey: imageKeys.generations, queryFn: () => repos().imageGenerations.list({ limit: 200 }) });
}

export function useComfyWorkflows() {
  const repos = useRepositories();
  return useQuery({ queryKey: imageKeys.workflows, queryFn: () => repos().comfyWorkflows.list() });
}

export function useStartGeneration() {
  const services = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ backend, sourceId, params }: { backend: ImageBackendKind; sourceId: string; params: ImageGenParams }) => services().imageGen.start(backend, sourceId, params),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: imageKeys.generations }),
  });
}

export function useDeleteGeneration() {
  const repos = useRepositories();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => repos().imageGenerations.delete(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: imageKeys.generations }),
  });
}

export function useSaveWorkflow() {
  const repos = useRepositories();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ComfyWorkflowCreateInput | ComfyWorkflowUpdateInput }) =>
      id ? repos().comfyWorkflows.update(id, input) : repos().comfyWorkflows.create(input as ComfyWorkflowCreateInput),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: imageKeys.workflows }),
  });
}

export function useDeleteWorkflow() {
  const repos = useRepositories();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => repos().comfyWorkflows.delete(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: imageKeys.workflows }),
  });
}

/** Live progress (0..1) of a running job, straight from the service (no DB round-trip). */
export function useJobProgress(id: string): number | undefined {
  const services = useServices();
  return useSyncExternalStore(
    (listener) => services().imageGen.subscribe(listener),
    () => services().imageGen.progressOf(id),
    () => undefined,
  );
}
