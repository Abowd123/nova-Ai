"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRepositories } from "@/components/providers/repository-provider";
import { useServices } from "@/components/providers/services-provider";
import type { McpServerCreateInput, McpServerUpdateInput } from "@/lib/models";

export const mcpKeys = { all: ["mcp-servers"] as const };

export function useMcpServers() {
  const repos = useRepositories();
  return useQuery({ queryKey: mcpKeys.all, queryFn: () => repos().mcpServers.list() });
}

export function useSaveMcpServer() {
  const services = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; input: McpServerUpdateInput; secret?: string } | { id?: undefined; input: McpServerCreateInput; secret?: string }) =>
      args.id ? services().mcp.update(args.id, args.input, args.secret) : services().mcp.create(args.input as McpServerCreateInput, args.secret),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: mcpKeys.all }),
  });
}

export function useDeleteMcpServer() {
  const services = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => services().mcp.remove(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: mcpKeys.all }),
  });
}
