import type { ToolPermission, ToolResultPart } from "@/lib/models";
import { redactSecrets } from "@/lib/security/redact";
import { parseToolArguments, validateArgs } from "./json-schema";
import type { ActiveTool } from "./registry";
import type { ApprovalDecision, ToolCallState, ToolResult } from "./types";

export interface ToolCallInput {
  id: string;
  name: string;
  arguments: string;
}

export interface ApprovalRequest {
  callId: string;
  conversationId: string;
  toolName: string;
  title?: string;
  args: Record<string, unknown>;
  dangerous: boolean;
  source: "builtin" | "mcp";
}

export interface ToolRunnerDeps {
  /** Resolves when the user decides; rejects/aborts with the signal. */
  approve(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision>;
  /** "Always allow" persists the permission. */
  setPermission?(toolName: string, permission: ToolPermission): Promise<void>;
  onState?(conversationId: string, state: ToolCallState): void;
  clock?: () => number;
}

export interface RunCallsOptions {
  conversationId: string;
  assistantId: string | null;
  tools: ReadonlyMap<string, ActiveTool>;
  signal: AbortSignal;
  timeoutMs: number;
  parallel: boolean;
}

export class ToolCancelledError extends Error {
  constructor() {
    super("Tool run cancelled");
    this.name = "AbortError";
  }
}

/** Calls whose names are blank or unknown still need an answer, or providers reject the next turn. */
function result(call: ToolCallInput, content: string, outcome: NonNullable<ToolResultPart["outcome"]>, extra: Partial<ToolResultPart> = {}): ToolResultPart {
  return { type: "tool_result", toolCallId: call.id, name: call.name || "unknown", content, isError: outcome !== "ok", outcome, ...extra };
}

/** AbortSignal that fires on the parent signal or after `ms`. */
function withTimeout(parent: AbortSignal, ms: number): { signal: AbortSignal; dispose: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, ms);
  const onAbort = () => controller.abort();
  if (parent.aborted) controller.abort();
  else parent.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => expired,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * Executes one step of tool calls: permission check, approval, argument validation,
 * timeout, cancellation. Never throws for tool failures (the model gets an error result
 * and can recover); throws ToolCancelledError only when the whole reply was stopped.
 */
export class ToolRunner {
  private readonly clock: () => number;

  constructor(private readonly deps: ToolRunnerDeps) {
    this.clock = deps.clock ?? (() => Date.now());
  }

  async runCalls(calls: readonly ToolCallInput[], options: RunCallsOptions): Promise<ToolResultPart[]> {
    const state = (callId: string, name: string, patch: Omit<ToolCallState, "callId" | "name">) =>
      this.deps.onState?.(options.conversationId, { callId, name, ...patch });
    for (const call of calls) state(call.id, call.name, { status: "pending" });

    // Approvals are asked one by one (in order) even in parallel mode: stacked dialogs are confusing.
    const approved = new Map<string, ToolResultPart | null>();
    for (const call of calls) {
      if (options.signal.aborted) throw new ToolCancelledError();
      approved.set(call.id, await this.authorize(call, options, state));
    }

    const execute = async (call: ToolCallInput): Promise<ToolResultPart> => {
      const early = approved.get(call.id);
      if (early) return early;
      return this.execute(call, options, state);
    };

    if (options.parallel) return Promise.all(calls.map(execute));
    const results: ToolResultPart[] = [];
    for (const call of calls) results.push(await execute(call));
    return results;
  }

  /** Returns a final result when the call must not run (unknown, invalid, denied), else null. */
  private async authorize(call: ToolCallInput, options: RunCallsOptions, state: (id: string, name: string, patch: Omit<ToolCallState, "callId" | "name">) => void): Promise<ToolResultPart | null> {
    const active = options.tools.get(call.name);
    if (!active) {
      state(call.id, call.name, { status: "error" });
      return result(call, `Error: tool "${call.name}" is not available. Available tools: ${[...options.tools.keys()].join(", ") || "none"}.`, "error");
    }
    const parsed = parseToolArguments(call.arguments);
    if (!parsed.ok) {
      state(call.id, call.name, { status: "error" });
      return result(call, `Error: ${parsed.error}. Send a JSON object matching the tool schema.`, "error");
    }
    const issues = validateArgs(active.tool.inputSchema, parsed.value);
    if (issues.length) {
      state(call.id, call.name, { status: "error" });
      return result(call, `Error: invalid arguments: ${issues.slice(0, 8).map((i) => `${i.path} ${i.message}`).join("; ")}`, "error");
    }
    if (active.permission === "ask") {
      state(call.id, call.name, { status: "awaiting_approval" });
      let decision: ApprovalDecision;
      try {
        decision = await this.deps.approve(
          { callId: call.id, conversationId: options.conversationId, toolName: call.name, title: active.tool.title, args: parsed.value, dangerous: active.tool.dangerous, source: active.tool.source },
          options.signal,
        );
      } catch {
        if (options.signal.aborted) {
          state(call.id, call.name, { status: "cancelled" });
          throw new ToolCancelledError();
        }
        decision = "deny";
      }
      if (decision === "deny") {
        state(call.id, call.name, { status: "denied" });
        return result(call, "The user declined to run this tool. Do not retry it; continue without it or ask the user.", "denied");
      }
      if (decision === "always" && !active.tool.dangerous) await this.deps.setPermission?.(call.name, "auto").catch(() => undefined);
    }
    return null;
  }

  private async execute(call: ToolCallInput, options: RunCallsOptions, state: (id: string, name: string, patch: Omit<ToolCallState, "callId" | "name">) => void): Promise<ToolResultPart> {
    const active = options.tools.get(call.name)!;
    const args = (parseToolArguments(call.arguments) as { ok: true; value: Record<string, unknown> }).value;
    const startedAt = this.clock();
    state(call.id, call.name, { status: "running", startedAt });
    const scope = withTimeout(options.signal, options.timeoutMs);
    let output: ToolResult;
    try {
      output = await new Promise<ToolResult>((resolve, reject) => {
        // Tools should honour the signal; this guarantees we stop waiting even if one doesn't.
        scope.signal.addEventListener("abort", () => reject(new ToolCancelledError()), { once: true });
        active.tool
          .execute(args, {
            signal: scope.signal,
            conversationId: options.conversationId,
            assistantId: options.assistantId,
            onProgress: (progress) => state(call.id, call.name, { status: "running", startedAt, progress }),
          })
          .then(resolve, reject);
      });
    } catch (error) {
      const durationMs = this.clock() - startedAt;
      if (options.signal.aborted) {
        state(call.id, call.name, { status: "cancelled" });
        throw new ToolCancelledError();
      }
      if (scope.timedOut()) {
        state(call.id, call.name, { status: "error" });
        return result(call, `Error: the tool timed out after ${Math.round(options.timeoutMs / 1000)} s.`, "error", { display: { kind: "text", durationMs } });
      }
      const message = redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 2000);
      state(call.id, call.name, { status: "error" });
      return result(call, `Error: ${message}`, "error", { display: { kind: "text", durationMs } });
    } finally {
      scope.dispose();
    }
    const durationMs = this.clock() - startedAt;
    state(call.id, call.name, { status: output.isError ? "error" : "done" });
    return result(call, output.content, output.isError ? "error" : "ok", {
      display: { kind: output.display?.kind ?? "text", ...output.display, durationMs },
    });
  }
}
