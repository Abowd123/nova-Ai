"use client";

import { useMemo, type ReactNode } from "react";
import { CodeRunnerContext, type CodeRunner } from "@/components/markdown/code-runner";
import { useServices } from "@/components/providers/services-provider";
import { DEFAULT_TOOL_SETTINGS } from "@/lib/models";
import { useRepositories } from "@/components/providers/repository-provider";

/** Lets the user run JavaScript / Python code blocks with the same sandboxes as the tools. */
export function CodeRunnerProvider({ children }: { children: ReactNode }) {
  const services = useServices();
  const repos = useRepositories();
  const runner = useMemo<CodeRunner>(
    () => ({
      async run(language, code, signal) {
        const settings = (await repos().settings.get()).tools ?? DEFAULT_TOOL_SETTINGS;
        if (language === "javascript") {
          const result = await services().js.run(code, { timeoutMs: settings.js.timeoutMs, allowNetwork: settings.js.allowNetwork, maxOutputChars: settings.js.maxOutputChars, memoryLimitMb: settings.js.memoryLimitMb, signal });
          return {
            stdout: result.logs.filter((l) => l.level !== "error" && l.level !== "warn").map((l) => l.text).join("\n"),
            stderr: result.logs.filter((l) => l.level === "error" || l.level === "warn").map((l) => l.text).join("\n"),
            value: result.value,
            error: result.error ? `${result.error.name}: ${result.error.message}` : undefined,
            durationMs: result.durationMs,
          };
        }
        if (!settings.python.enabled) throw new Error("Python is disabled in Settings → Tools");
        services().python.configure(settings.python.indexUrl);
        const result = await services().python.run(code, { timeoutMs: settings.python.timeoutMs, maxOutputChars: settings.python.maxOutputChars, signal });
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          value: result.value,
          error: result.error ? `${result.error.type}: ${result.error.message}` : undefined,
          durationMs: result.durationMs,
        };
      },
    }),
    [services, repos],
  );
  return <CodeRunnerContext.Provider value={runner}>{children}</CodeRunnerContext.Provider>;
}
