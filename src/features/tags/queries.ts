"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRepositories } from "@/components/providers/repository-provider";
import type { TagCreateInput, TagUpdateInput } from "@/lib/models";

export const tagKeys = { all: ["tags"] as const };

export function useTags() {
  const repos = useRepositories();
  return useQuery({ queryKey: tagKeys.all, queryFn: () => repos().tags.list() });
}

function useTagMutation<V, R>(fn: (variables: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tagKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["assistants"] });
    },
  });
}

export function useCreateTag() {
  const repos = useRepositories();
  return useTagMutation((input: TagCreateInput) => repos().tags.create(input));
}

export function useUpdateTag() {
  const repos = useRepositories();
  return useTagMutation(({ id, patch }: { id: string; patch: TagUpdateInput }) => repos().tags.update(id, patch));
}

export function useDeleteTag() {
  const repos = useRepositories();
  return useTagMutation((id: string) => repos().tags.delete(id));
}

export function useReorderTags() {
  const repos = useRepositories();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => repos().tags.reorder(ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: tagKeys.all });
      const previous = queryClient.getQueryData<{ id: string }[]>(tagKeys.all);
      if (previous) {
        const byId = new Map(previous.map((t) => [t.id, t]));
        queryClient.setQueryData(tagKeys.all, ids.map((id, order) => ({ ...byId.get(id)!, order })));
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(tagKeys.all, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: tagKeys.all }),
  });
}

export { moveItem } from "./order";
