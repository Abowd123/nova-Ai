"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRepositories } from "@/components/providers/repository-provider";
import type { AssistantCreateInput, AssistantUpdateInput } from "@/lib/models";

export const assistantKeys = { all: ["assistants"] as const };

export function useAssistants() {
  const repos = useRepositories();
  return useQuery({ queryKey: assistantKeys.all, queryFn: () => repos().assistants.list() });
}

function useAssistantMutation<TVariables, TResult>(fn: (variables: TVariables) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export function useCreateAssistant() {
  const repos = useRepositories();
  return useAssistantMutation((input: AssistantCreateInput) => repos().assistants.create(input));
}

export function useUpdateAssistant() {
  const repos = useRepositories();
  return useAssistantMutation(({ id, patch }: { id: string; patch: AssistantUpdateInput }) =>
    repos().assistants.update(id, patch),
  );
}

export function useDeleteAssistant() {
  const repos = useRepositories();
  return useAssistantMutation((id: string) => repos().assistants.delete(id));
}

export function useDuplicateAssistant() {
  const repos = useRepositories();
  return useAssistantMutation(({ id, name }: { id: string; name: string }) =>
    repos().assistants.duplicate(id, { name }),
  );
}

export function useSetDefaultAssistant() {
  const repos = useRepositories();
  return useAssistantMutation((id: string) => repos().assistants.setDefault(id));
}
