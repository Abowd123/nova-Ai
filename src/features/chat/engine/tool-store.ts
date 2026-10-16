import { create } from "zustand";
import type { ApprovalDecision, ToolCallState } from "@/lib/tools/types";
import type { ApprovalRequest } from "@/lib/tools/runner";

interface PendingApproval extends ApprovalRequest {
  resolve: (decision: ApprovalDecision) => void;
}

interface ToolStoreState {
  /** callId -> live state (while the reply runs). */
  calls: Record<string, ToolCallState>;
  /** callId -> approval waiting for the user. */
  approvals: Record<string, PendingApproval>;
  setCall: (state: ToolCallState) => void;
  clearConversation: (callIds: string[]) => void;
  request: (request: ApprovalRequest, signal: AbortSignal) => Promise<ApprovalDecision>;
  decide: (callId: string, decision: ApprovalDecision) => void;
}

export const useToolStore = create<ToolStoreState>((set, get) => ({
  calls: {},
  approvals: {},
  setCall: (state) => set((s) => ({ calls: { ...s.calls, [state.callId]: state } })),
  clearConversation: (callIds) =>
    set((s) => {
      const calls = { ...s.calls };
      for (const id of callIds) delete calls[id];
      return { calls };
    }),
  request: (request, signal) =>
    new Promise<ApprovalDecision>((resolve, reject) => {
      const remove = () =>
        set((s) => {
          const { [request.callId]: _gone, ...approvals } = s.approvals;
          return { approvals };
        });
      const onAbort = () => {
        remove();
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
      set((s) => ({
        approvals: {
          ...s.approvals,
          [request.callId]: {
            ...request,
            resolve: (decision) => {
              signal.removeEventListener("abort", onAbort);
              remove();
              resolve(decision);
            },
          },
        },
      }));
    }),
  decide: (callId, decision) => get().approvals[callId]?.resolve(decision),
}));

export function useToolCallState(callId: string): ToolCallState | undefined {
  return useToolStore((s) => s.calls[callId]);
}

export function useToolApproval(callId: string): PendingApproval | undefined {
  return useToolStore((s) => s.approvals[callId]);
}
