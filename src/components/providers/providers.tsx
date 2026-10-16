"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toast";
import { ServiceWorkerRegistrar } from "@/features/pwa/service-worker-registrar";
import { LocaleSync } from "./locale-sync";
import { RepositoryProvider } from "./repository-provider";
import { ServicesProvider } from "./services-provider";
import { NativeShell } from "@/components/native/native-shell";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false, networkMode: "always" },
          mutations: { retry: 0, networkMode: "always" },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <RepositoryProvider>
          <ServicesProvider>
            <LocaleSync />
            <ServiceWorkerRegistrar />
            <NativeShell />
            {children}
            <Toaster />
          </ServicesProvider>
        </RepositoryProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
