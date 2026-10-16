import { create } from "zustand";

export interface LiveStream {
  messageId: string;
  conversationId: string;
  text: string;
  reasoning: string;
  startedAt: number;
}

interface StreamingState {
  /** messageId -> live content. Only the streaming bubble subscribes to its own entry. */
  streams: Record<string, LiveStream>;
  /** conversationId -> messageId currently streaming. */
  active: Record<string, string>;
  begin: (stream: LiveStream) => void;
  update: (messageId: string, text: string, reasoning: string) => void;
  end: (messageId: string) => void;
}

export const useStreamingStore = create<StreamingState>((set) => ({
  streams: {},
  active: {},
  begin: (stream) =>
    set((state) => ({
      streams: { ...state.streams, [stream.messageId]: stream },
      active: { ...state.active, [stream.conversationId]: stream.messageId },
    })),
  update: (messageId, text, reasoning) =>
    set((state) => {
      const current = state.streams[messageId];
      if (!current || (current.text === text && current.reasoning === reasoning)) return state;
      return { streams: { ...state.streams, [messageId]: { ...current, text, reasoning } } };
    }),
  end: (messageId) =>
    set((state) => {
      const current = state.streams[messageId];
      if (!current) return state;
      const { [messageId]: _removed, ...streams } = state.streams;
      const active = { ...state.active };
      if (active[current.conversationId] === messageId) delete active[current.conversationId];
      return { streams, active };
    }),
}));

export function useLiveStream(messageId: string): LiveStream | undefined {
  return useStreamingStore((state) => state.streams[messageId]);
}

export function useIsConversationStreaming(conversationId: string): boolean {
  return useStreamingStore((state) => Boolean(state.active[conversationId]));
}

export interface StreamingSink {
  begin(stream: LiveStream): void;
  update(messageId: string, text: string, reasoning: string): void;
  end(messageId: string): void;
}

export const zustandStreamingSink: StreamingSink = {
  begin: (stream) => useStreamingStore.getState().begin(stream),
  update: (id, text, reasoning) => useStreamingStore.getState().update(id, text, reasoning),
  end: (id) => useStreamingStore.getState().end(id),
};
