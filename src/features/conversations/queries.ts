"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRepositories } from "@/components/providers/repository-provider";
import type { ConversationCreateInput, ConversationUpdateInput, Locale } from "@/lib/models";
import { seedDemoData } from "@/lib/storage/seed";

export const conversationKeys = {
  all: ["conversations"] as const,
  list: (query: string) => ["conversations", "list", query] as const,
  detail: (id: string) => ["conversations", "detail", id] as const,
  messages: (id: string) => ["conversations", "messages", id] as const,
};

export function useConversations(query = "") {
  const repos = useRepositories();
  return useQuery({
    queryKey: conversationKeys.list(query),
    queryFn: () => repos().conversations.list({ query }),
  });
}

export function useConversation(id: string) {
  const repos = useRepositories();
  return useQuery({
    queryKey: conversationKeys.detail(id),
    queryFn: async () => (await repos().conversations.get(id)) ?? null,
  });
}

export function useMessages(conversationId: string) {
  const repos = useRepositories();
  return useQuery({
    queryKey: conversationKeys.messages(conversationId),
    queryFn: () => repos().messages.listByConversation(conversationId),
  });
}

export function useCreateConversation() {
  const repos = useRepositories();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ConversationCreateInput) => repos().conversations.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: conversationKeys.all }),
  });
}

export function useUpdateConversation() {
  const repos = useRepositories();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ConversationUpdateInput }) =>
      repos().conversations.update(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: conversationKeys.all }),
  });
}

export function useDeleteConversation() {
  const repos = useRepositories();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => repos().conversations.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: conversationKeys.all }),
  });
}

export function useSaveDraftMessage() {
  const repos = useRepositories();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, content }: { conversationId: string; content: string }) =>
      repos().messages.create({ conversationId, role: "user", content, status: "complete" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: conversationKeys.all }),
  });
}

export function useDeleteMessage() {
  const repos = useRepositories();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => repos().messages.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: conversationKeys.all }),
  });
}

export function useSeedDemoData() {
  const repos = useRepositories();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (locale: Locale) => seedDemoData(repos(), locale),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
