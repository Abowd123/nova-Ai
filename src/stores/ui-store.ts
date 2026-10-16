import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { clientEnv } from "@/env";
import type { Locale } from "@/lib/models";

export const UI_STORAGE_KEY = "nova-ui";

interface UiState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
}

/**
 * UI-only preferences (no secrets, no user content). Persisted to localStorage so the
 * boot script can set lang/dir before first paint. skipHydration avoids SSR mismatches.
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      locale: clientEnv.NEXT_PUBLIC_DEFAULT_LOCALE,
      setLocale: (locale) => set({ locale }),
      mobileSidebarOpen: false,
      setMobileSidebarOpen: (mobileSidebarOpen) => set({ mobileSidebarOpen }),
    }),
    {
      name: UI_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ locale: state.locale }),
      skipHydration: true,
    },
  ),
);
