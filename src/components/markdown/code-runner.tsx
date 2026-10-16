"use client";

import { createContext, useContext } from "react";

export type RunnableLanguage = "javascript" | "python";

export interface CodeRunOutput {
  stdout: string;
  stderr: string;
  value?: string;
  error?: string;
  durationMs: number;
}

/** Provided inside the app (needs services); markdown elsewhere (exports, previews) has no Run button. */
export interface CodeRunner {
  run(language: RunnableLanguage, code: string, signal: AbortSignal): Promise<CodeRunOutput>;
}

export const CodeRunnerContext = createContext<CodeRunner | null>(null);

export function useCodeRunner(): CodeRunner | null {
  return useContext(CodeRunnerContext);
}

export function runnableLanguage(language: string | null): RunnableLanguage | null {
  const lang = language?.toLowerCase();
  if (lang === "js" || lang === "javascript" || lang === "mjs") return "javascript";
  if (lang === "py" || lang === "python" || lang === "python3") return "python";
  return null;
}
