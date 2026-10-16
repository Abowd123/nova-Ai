"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Loader2, Play, Square } from "lucide-react";
import { runnableLanguage, useCodeRunner, type CodeRunOutput } from "./code-runner";
import { useI18n } from "@/hooks/use-i18n";
import { copyText } from "@/lib/clipboard";

export function CodeBlock({ language, children }: { language: string | null; children: ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  const runner = useCodeRunner();
  const runnable = runner ? runnableLanguage(language) : null;
  const [running, setRunning] = useState<AbortController | null>(null);
  const [output, setOutput] = useState<CodeRunOutput | null>(null);
  useEffect(() => () => running?.abort(), [running]);

  const onRun = async () => {
    if (!runner || !runnable) return;
    if (running) {
      running.abort();
      return;
    }
    const controller = new AbortController();
    setRunning(controller);
    setOutput(null);
    try {
      setOutput(await runner.run(runnable, ref.current?.textContent ?? "", controller.signal));
    } catch (error) {
      setOutput({ stdout: "", stderr: "", error: error instanceof Error ? error.message : String(error), durationMs: 0 });
    } finally {
      setRunning(null);
    }
  };

  const onCopy = async () => {
    const ok = await copyText(ref.current?.textContent ?? "");
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="not-prose group/code my-3 overflow-hidden rounded-2xl border bg-surface-container-low" dir="ltr">
      <div className="flex items-center justify-between gap-2 border-b bg-surface-container px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-mono" data-testid="code-language">
          {language ?? t.markdown.plainText}
        </span>
        <span className="flex items-center gap-1">
        {runnable ? (
          <button
            type="button"
            onClick={() => void onRun()}
            aria-label={running ? t.tools.stopRun : t.tools.runCode}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {running ? <Square className="size-3.5" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
            <span>{running ? t.tools.stopRun : t.tools.run}</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void onCopy()}
          aria-label={copied ? t.markdown.copied : t.markdown.copyCode}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
          <span aria-live="polite">{copied ? t.markdown.copied : t.markdown.copy}</span>
        </button>
        </span>
      </div>
      <pre className="overflow-x-auto p-3 text-[0.85rem] leading-relaxed">
        <code ref={ref} className="hljs font-mono">
          {children}
        </code>
      </pre>
      {running ? (
        <p className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {t.tools.running}
        </p>
      ) : null}
      {output ? <RunOutput output={output} /> : null}
    </div>
  );
}

function RunOutput({ output }: { output: CodeRunOutput }) {
  const { t } = useI18n();
  const empty = !output.stdout && !output.stderr && output.value === undefined && !output.error;
  return (
    <div className="border-t bg-background/60 px-3 py-2 text-xs" aria-live="polite" data-testid="code-run-output">
      <p className="mb-1 font-medium text-muted-foreground">
        {t.tools.output} · {Math.round(output.durationMs)} ms
      </p>
      {empty ? <p className="text-muted-foreground">{t.tools.noOutput}</p> : null}
      {output.stdout ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono">{output.stdout}</pre> : null}
      {output.stderr ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-amber-700 dark:text-amber-400">{output.stderr}</pre> : null}
      {output.value !== undefined ? <pre className="whitespace-pre-wrap font-mono text-primary">⇒ {output.value}</pre> : null}
      {output.error ? <pre className="whitespace-pre-wrap font-mono text-destructive">{output.error}</pre> : null}
    </div>
  );
}
