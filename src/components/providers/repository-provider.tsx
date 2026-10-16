"use client";

import { createContext, useContext, type ReactNode } from "react";
import { getRepositories, type Repositories } from "@/lib/storage";

type RepositoryFactory = () => Repositories;

const RepositoryContext = createContext<RepositoryFactory>(getRepositories);

/**
 * Exposes storage through interfaces only. The factory is lazy so nothing touches
 * IndexedDB during SSR; tests can inject in-memory/fake implementations.
 */
export function RepositoryProvider({
  children,
  factory = getRepositories,
}: {
  children: ReactNode;
  factory?: RepositoryFactory;
}) {
  return <RepositoryContext.Provider value={factory}>{children}</RepositoryContext.Provider>;
}

export function useRepositories(): RepositoryFactory {
  return useContext(RepositoryContext);
}
