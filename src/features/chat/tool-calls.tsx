"use client";

import { useState } from "react";
import { Bot, Brain, Check, CircleSlash, Code2, Download, FileText, Globe, Loader2, Plug, Search, ShieldAlert, TriangleAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAttachmentUrl } from "@/features/attachments/use-attachment-url";
import { useI18n } from "@/hooks/use-i18n";
import { MCP_TOOL_SEPARATOR, type MessagePart, type ToolResultPart } from "@/lib/models";
import type { ToolCallStatus } from "@/lib/tools/types";
import { cn } from "@/lib/utils";
import { downloadUrl } from "@/lib/files";
import { useToolApproval, useToolCallState, useToolStore } from "./engine/tool-store";

type ToolCallPart = Extract<MessagePart, { type: "tool_call" }>;

const ICONS: Record<string, typeof Search> = {
  search_memory: Brain,
  web_search: Search,
  fetch_url: Globe,
  run_javascript: Code2,
  run_python: Code2,
  delegate_task: Bot,
};

const CODE_TOOLS = new Set(["run_javascript", "run_python"]);

function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function statusOf(live: ToolCallStatus | undefined, result: ToolResultPart | undefined): ToolCallStatus {
  if (result) return result.outcome === "denied" ? "denied" : result.outcome === "cancelled" ? "cancelled" : result.isError ? "error" : "done";
  return live ?? "pending";
}

function useToolLabel(name: string): string {
  const { t } = useI18n();
  const builtin = (t.tools.names as Record<string, string>)[name];
  if (builtin) return builtin;
  const index = name.indexOf(MCP_TOOL_SEPARATOR);
  return index > 0 ? `${name.slice(0, index)} › ${name.slice(index + MCP_TOOL_SEPARATOR.length)}` : name;
}

function FileLink({ id, name }: { id: string; name: string }) {
  const { t } = useI18n();
  const { url } = useAttachmentUrl(id);
  if (!url) return <span className="text-muted-foreground">{name}</span>;
  return (
    <a
      href={url}
      download={name}
      onClick={(event) => {
        event.preventDefault();
        downloadUrl(url, name);
      }}
      className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
    >
      <Download className="size-3.5" aria-hidden="true" />
      {t.tools.downloadFile(name)}
    </a>
  );
}

function ResultView({ result, name }: { result: ToolResultPart; name: string }) {
  const { t } = useI18n();
  const display = result.display;
  if (display?.kind === "code") {
    return (
      <div className="grid gap-1.5">
        {display.stdout ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-background/70 p-2 font-mono text-xs" dir="ltr">{display.stdout}</pre> : null}
        {display.stderr ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-background/70 p-2 font-mono text-xs text-amber-700 dark:text-amber-400" dir="ltr">{display.stderr}</pre> : null}
        {display.value !== undefined ? <pre className="whitespace-pre-wrap font-mono text-xs text-primary" dir="ltr">⇒ {display.value}</pre> : null}
        {display.files?.length ? (
          <ul className="flex flex-wrap gap-3 text-xs">
            {display.files.map((file) => (
              <li key={file.name}>{file.attachmentId ? <FileLink id={file.attachmentId} name={file.name} /> : file.name}</li>
            ))}
          </ul>
        ) : null}
        {!display.stdout && !display.stderr && display.value === undefined && !display.files?.length ? <p className="text-xs text-muted-foreground">{t.tools.noOutput}</p> : null}
      </div>
    );
  }
  if ((display?.kind === "search" || display?.kind === "page") && display.citations?.length) {
    return (
      <ol className="grid gap-1.5 text-sm">
        {display.citations.map((c) => (
          <li key={`${c.index}-${c.url}`} className="min-w-0">
            <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-primary underline-offset-2 hover:underline" dir="auto">
              [{c.index}] {c.title}
            </a>
            <p className="truncate text-xs text-muted-foreground" dir="ltr">{c.url}</p>
            {c.snippet ? <p className="line-clamp-2 text-xs text-muted-foreground" dir="auto">{c.snippet}</p> : null}
          </li>
        ))}
      </ol>
    );
  }
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-background/70 p-2 text-xs" dir="auto" data-tool={name}>
      {result.content.slice(0, 6000)}
      {result.content.length > 6000 ? "\n…" : ""}
    </pre>
  );
}

function ApprovalPanel({ callId, name, args }: { callId: string; name: string; args: Record<string, unknown> | null }) {
  const { t } = useI18n();
  const approval = useToolApproval(callId);
  const decide = useToolStore((s) => s.decide);
  if (!approval) return null;
  return (
    <div role="group" aria-label={t.tools.approvalLabel} className="mt-2 grid gap-2 rounded-2xl border border-primary/40 bg-primary/5 p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        {approval.dangerous ? <ShieldAlert className="size-4 text-destructive" aria-hidden="true" /> : null}
        {approval.dangerous ? t.tools.approveDangerous : t.tools.approveQuestion}
      </p>
      {CODE_TOOLS.has(name) && typeof args?.code === "string" ? (
        <pre className="max-h-56 overflow-auto rounded-xl bg-background p-2 font-mono text-xs" dir="ltr">{args.code}</pre>
      ) : (
        <pre className="max-h-40 overflow-auto rounded-xl bg-background p-2 font-mono text-xs" dir="ltr">{JSON.stringify(args ?? {}, null, 2)}</pre>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => decide(callId, "allow")} autoFocus>
          <Check className="size-4" aria-hidden="true" />
          {t.tools.allow}
        </Button>
        {!approval.dangerous ? (
          <Button size="sm" variant="tonal" onClick={() => decide(callId, "always")}>
            {t.tools.alwaysAllow}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => decide(callId, "deny")}>
          <X className="size-4" aria-hidden="true" />
          {t.tools.deny}
        </Button>
      </div>
    </div>
  );
}

function ToolCallCard({ call, result }: { call: ToolCallPart; result: ToolResultPart | undefined }) {
  const { t } = useI18n();
  const live = useToolCallState(call.id);
  const status = statusOf(live?.status, result);
  const label = useToolLabel(call.name);
  const args = parseArgs(call.arguments);
  const [open, setOpen] = useState(false);
  const Icon = ICONS[call.name] ?? (call.name.includes(MCP_TOOL_SEPARATOR) ? Plug : FileText);
  const summary =
    typeof args?.query === "string" ? args.query : typeof args?.url === "string" ? args.url : typeof args?.task === "string" ? args.task : CODE_TOOLS.has(call.name) ? t.tools.codeSnippet : "";
  const busy = status === "running" || status === "pending";
  return (
    <li className="rounded-2xl border bg-surface-container-low px-3 py-2" data-testid="tool-call" data-status={status}>
      <div className="flex items-center gap-2 text-sm">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">{label}</span>
        {summary ? <span className="min-w-0 flex-1 truncate text-muted-foreground" dir="auto">{summary}</span> : <span className="flex-1" />}
        <Badge variant={status === "error" || status === "denied" ? "warning" : status === "done" ? "tonal" : "outline"} className="shrink-0">
          {busy ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : status === "error" ? <TriangleAlert className="size-3" aria-hidden="true" /> : status === "denied" || status === "cancelled" ? <CircleSlash className="size-3" aria-hidden="true" /> : null}
          {t.tools.status[status]}
        </Badge>
        {result?.display?.durationMs !== undefined ? <span className="shrink-0 text-xs text-muted-foreground" dir="ltr">{(result.display.durationMs / 1000).toFixed(1)} s</span> : null}
      </div>
      {live?.progress && busy ? <p className="mt-1 text-xs text-muted-foreground" role="status">{(t.tools.progress as Record<string, string>)[live.progress] ?? live.progress}</p> : null}
      {status === "awaiting_approval" ? <ApprovalPanel callId={call.id} name={call.name} args={args} /> : null}
      {result || !busy ? (
        <div className="mt-1">
          <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? t.tools.hideDetails : t.tools.showDetails}
          </button>
          {open ? (
            <div className="mt-2 grid gap-2">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">{t.tools.arguments}</p>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-background/70 p-2 font-mono text-xs" dir="ltr">
                  {CODE_TOOLS.has(call.name) && typeof args?.code === "string" ? args.code : JSON.stringify(args ?? call.arguments, null, 2)}
                </pre>
              </div>
              {result ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{t.tools.result}</p>
                  <ResultView result={result} name={call.name} />
                </div>
              ) : null}
            </div>
          ) : result?.display?.kind === "search" || result?.display?.kind === "page" ? (
            <div className="mt-2">
              <ResultView result={result} name={call.name} />
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function ToolCalls({ parts, results }: { parts: MessagePart[]; results: ReadonlyMap<string, ToolResultPart> }) {
  const { t } = useI18n();
  const calls = parts.filter((p): p is ToolCallPart => p.type === "tool_call");
  if (!calls.length) return null;
  return (
    <ul aria-label={t.tools.callsLabel} className={cn("mt-2 grid gap-2")}>
      {calls.map((call) => (
        <ToolCallCard key={call.id} call={call} result={results.get(call.id)} />
      ))}
    </ul>
  );
}

/** Numbered sources (from web_search / fetch_url) the reply cites as [n]. */
export function Sources({ citations }: { citations: { index: number; title: string; url: string }[] }) {
  const { t } = useI18n();
  if (!citations.length) return null;
  return (
    <nav aria-label={t.tools.sources} className="mt-3 border-t pt-2">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{t.tools.sources}</p>
      <ol className="flex flex-wrap gap-2 text-xs">
        {citations.map((c) => (
          <li key={`${c.index}-${c.url}`}>
            <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-[16rem] items-center gap-1 truncate rounded-full border px-2 py-0.5 hover:bg-accent" title={c.url} dir="auto">
              <span className="font-mono">[{c.index}]</span> <span className="truncate">{c.title}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
