"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRepositories } from "@/components/providers/repository-provider";
import { useServices } from "@/components/providers/services-provider";
import type { LorebookCreateInput, LorebookUpdateInput, MemoryChunkScope } from "@/lib/models";
import type { ScopeFilter } from "@/lib/memory/memory-index";
import type { MemoryListFilter } from "@/lib/storage/types";

export const memoryKeys = {
  all: ["memory"] as const,
  list: (filter: MemoryListFilter, page: number) => ["memory", "list", filter, page] as const,
  search: (query: string, filter: ScopeFilter) => ["memory", "search", query, filter] as const,
  stats: ["memory", "stats"] as const,
  chunks: (ids: string[]) => ["memory", "chunks", ids] as const,
  lorebooks: ["lorebooks"] as const,
  summary: (conversationId: string) => ["summary", conversationId] as const,
};

export const MEMORY_PAGE_SIZE = 30;

export function useMemoryList(filter: MemoryListFilter, page: number) {
  const repos = useRepositories();
  return useQuery({
    queryKey: memoryKeys.list(filter, page),
    queryFn: () => repos().memory.list(filter, { limit: MEMORY_PAGE_SIZE, offset: page * MEMORY_PAGE_SIZE }),
    placeholderData: (previous) => previous,
  });
}

export function useMemorySearch(query: string, filter: ScopeFilter) {
  const services = useServices();
  return useQuery({
    queryKey: memoryKeys.search(query, filter),
    queryFn: ({ signal }) => services().memory.search(query, { filter, signal }),
    enabled: query.trim().length > 0,
    staleTime: 30_000,
  });
}

export function useMemoryStats() {
  const services = useServices();
  return useQuery({ queryKey: memoryKeys.stats, queryFn: () => services().memory.stats(), refetchInterval: (q) => (q.state.data?.running ? 2000 : false) });
}

export function useMemoryChunks(ids: string[]) {
  const repos = useRepositories();
  return useQuery({ queryKey: memoryKeys.chunks(ids), queryFn: () => repos().memory.getMany(ids), enabled: ids.length > 0 });
}

function useInvalidateMemory() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: memoryKeys.all });
}

export function useAddMemory() {
  const services = useServices();
  const invalidate = useInvalidateMemory();
  return useMutation({
    mutationFn: (input: { text: string; scope: Exclude<MemoryChunkScope, "conversation">; assistantId: string | null }) => services().memory.addManual(input),
    onSuccess: invalidate,
  });
}

export function useUpdateMemory() {
  const services = useServices();
  const invalidate = useInvalidateMemory();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { text?: string; scope?: MemoryChunkScope; assistantId?: string | null } }) => services().memory.update(id, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteMemory() {
  const services = useServices();
  const invalidate = useInvalidateMemory();
  return useMutation({ mutationFn: (ids: string[]) => services().memory.remove(ids), onSuccess: invalidate });
}

export function useReindexMemory() {
  const services = useServices();
  const invalidate = useInvalidateMemory();
  return useMutation({ mutationFn: () => services().memory.reindex(), onSuccess: invalidate });
}

export function useLorebooks() {
  const repos = useRepositories();
  return useQuery({ queryKey: memoryKeys.lorebooks, queryFn: () => repos().lorebooks.list() });
}

export function useSaveLorebook() {
  const repos = useRepositories();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: LorebookCreateInput & LorebookUpdateInput }) =>
      id ? repos().lorebooks.update(id, input) : repos().lorebooks.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: memoryKeys.lorebooks }),
  });
}

export function useDeleteLorebook() {
  const repos = useRepositories();
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (id: string) => repos().lorebooks.delete(id), onSuccess: () => queryClient.invalidateQueries({ queryKey: memoryKeys.lorebooks }) });
}

export function useSummary(conversationId: string) {
  const services = useServices();
  return useQuery({ queryKey: memoryKeys.summary(conversationId), queryFn: async () => (await services().summaries.get(conversationId)) ?? null });
}

export function useSaveSummary(conversationId: string) {
  const services = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => services().summaries.saveManual(conversationId, text),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: memoryKeys.summary(conversationId) }),
  });
}

export function useRegenerateSummary(conversationId: string) {
  const services = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => services().summaries.summarize(conversationId, { force: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: memoryKeys.summary(conversationId) }),
  });
}

export function useDeleteSummary(conversationId: string) {
  const services = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => services().summaries.remove(conversationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: memoryKeys.summary(conversationId) }),
  });
}

/** Debounced preview of the next request size (context meter + overflow warning). */
export function useContextPreview(conversationId: string, draft: string, revision: unknown) {
  const services = useServices();
  return useQuery({
    queryKey: ["context-preview", conversationId, draft, revision],
    queryFn: () => services().chat.previewContext(conversationId, draft),
    placeholderData: (previous) => previous,
    staleTime: 10_000,
    retry: false,
  });
}
