import { create } from "zustand";

export type McpConnectionState = "idle" | "connecting" | "connected" | "error" | "needs_auth";

export interface McpStatus {
  state: McpConnectionState;
  error?: string;
  toolCount?: number;
}

interface McpStatusStore {
  statuses: Record<string, McpStatus>;
  set: (serverId: string, status: McpStatus) => void;
  remove: (serverId: string) => void;
}

export const useMcpStatusStore = create<McpStatusStore>((set) => ({
  statuses: {},
  set: (serverId, status) => set((s) => ({ statuses: { ...s.statuses, [serverId]: status } })),
  remove: (serverId) =>
    set((s) => {
      const { [serverId]: _gone, ...statuses } = s.statuses;
      return { statuses };
    }),
}));

export function useMcpStatus(serverId: string): McpStatus {
  return useMcpStatusStore((s) => s.statuses[serverId] ?? { state: "idle" });
}
