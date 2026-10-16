import { create } from "zustand";

export type ToastVariant = "default" | "success" | "destructive";

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

export interface ToastItem extends Omit<ToastInput, "variant"> {
  id: string;
  variant: ToastVariant;
  open: boolean;
}

interface ToastState {
  toasts: ToastItem[];
  add: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  remove: (id: string) => void;
}

const MAX_TOASTS = 4;
let counter = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  add: (input) => {
    counter += 1;
    const id = `toast-${counter}`;
    set((state) => ({
      toasts: [
        ...state.toasts.slice(-(MAX_TOASTS - 1)),
        { ...input, id, variant: input.variant ?? "default", open: true },
      ],
    }));
    return id;
  },
  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.map((t) => (t.id === id ? { ...t, open: false } : t)) })),
  remove: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export function toast(input: ToastInput): string {
  return useToastStore.getState().add(input);
}
