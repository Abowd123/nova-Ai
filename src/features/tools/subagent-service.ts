import { collectResponse } from "@/lib/ai/collect";
import type { ChatMessage, ChatProvider, ChatRequest } from "@/lib/ai/types";
import { DEFAULT_TOOL_SETTINGS, type ToolResultPart, type UsageKind } from "@/lib/models";
import type { Repositories } from "@/lib/storage/types";
import { truncateToTokens } from "@/lib/context/tokens";
import { parseToolArguments, validateArgs } from "@/lib/tools/json-schema";
import { toToolSpecs, type ActiveTool } from "@/lib/tools/registry";
import { costOf } from "./pricing";

export interface SubagentDeps {
  repos: Repositories;
  getChatProvider: (providerId: string) => Promise<ChatProvider>;
  /** Conversation model, used when no sub-agent model is configured. */
  fallbackModel: (conversationId: string | null) => Promise<{ providerId: string; modelId: string } | null>;
  /** Tools the sub-agent may use on its own (only auto-approved, non-dangerous ones are passed). */
  tools?: () => Promise<ActiveTool[]>;
  clock?: () => number;
}

export interface SubagentResult {
  text: string;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  providerId: string;
  modelId: string;
}

export const SUBAGENT_SYSTEM =
  "You are a focused sub-agent working for another AI assistant. Complete exactly the delegated task. " +
  "You do not see the user's conversation: rely only on the task and context given. Use tools when they help. " +
  "Finish with a concise, self-contained report (facts, numbers, sources as URLs) the main assistant can use directly.";

/**
 * Cheap-model helper with its OWN context: delegated tasks (delegate_task), page summaries for
 * search, and other auxiliary jobs. Every call is logged in usageRecords (separate cost tracking).
 */
export class SubagentService {
  constructor(private readonly deps: SubagentDeps) {}

  async model(conversationId: string | null): Promise<{ providerId: string; modelId: string }> {
    const settings = (await this.deps.repos.settings.get()).tools ?? DEFAULT_TOOL_SETTINGS;
    if (settings.subagent.providerId && settings.subagent.modelId) {
      const provider = await this.deps.repos.providers.get(settings.subagent.providerId);
      if (provider?.enabled) return { providerId: provider.id, modelId: settings.subagent.modelId };
    }
    const fallback = await this.deps.fallbackModel(conversationId);
    if (!fallback) throw new Error("No model is available for the sub-agent");
    return fallback;
  }

  /** Configured cheap model only (null = none configured): used for titles when enabled. */
  async configuredModel(): Promise<{ providerId: string; modelId: string } | null> {
    const settings = (await this.deps.repos.settings.get()).tools ?? DEFAULT_TOOL_SETTINGS;
    if (!settings.subagent.providerId || !settings.subagent.modelId) return null;
    const provider = await this.deps.repos.providers.get(settings.subagent.providerId);
    return provider?.enabled ? { providerId: provider.id, modelId: settings.subagent.modelId } : null;
  }

  async record(kind: UsageKind, providerId: string, modelId: string, conversationId: string | null, usage: { inputTokens: number; outputTokens: number } | null): Promise<void> {
    const provider = await this.deps.repos.providers.get(providerId);
    await this.deps.repos.usage.add({
      kind,
      providerId,
      modelId,
      conversationId,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      cost: costOf(provider, modelId, usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : null),
    });
  }

  /** Runs a delegated task with a separate context, step and token limits. */
  async run(input: { task: string; context?: string; conversationId: string | null; signal?: AbortSignal; onProgress?: (message: string) => void }): Promise<SubagentResult> {
    const settings = (await this.deps.repos.settings.get()).tools ?? DEFAULT_TOOL_SETTINGS;
    const { providerId, modelId } = await this.model(input.conversationId);
    const provider = await this.deps.getChatProvider(providerId);
    const active = ((await this.deps.tools?.()) ?? []).filter((a) => a.permission === "auto" && !a.tool.dangerous && a.tool.name !== "delegate_task");
    const toolMap = new Map(active.map((a) => [a.tool.name, a]));
    const messages: ChatMessage[] = [
      { role: "user", parts: [{ type: "text", text: input.context?.trim() ? `Task:\n${input.task}\n\nContext:\n${truncateToTokens(input.context, 6000)}` : `Task:\n${input.task}` }] },
    ];
    let inputTokens = 0;
    let outputTokens = 0;
    let text = "";
    let steps = 0;
    for (; steps < settings.subagent.maxSteps; ) {
      const last = steps + 1 >= settings.subagent.maxSteps;
      const request: ChatRequest = {
        model: modelId,
        system: SUBAGENT_SYSTEM,
        maxTokens: settings.subagent.maxTokens,
        temperature: 0.3,
        messages,
        ...(active.length ? { tools: toToolSpecs(active), ...(last ? { toolChoice: "none" as const } : {}) } : {}),
      };
      const response = await collectResponse(provider, request, { signal: input.signal, timeoutMs: 90_000, retry: { retries: 1 } });
      steps += 1;
      inputTokens += response.usage?.inputTokens ?? 0;
      outputTokens += response.usage?.outputTokens ?? 0;
      await this.record("subagent", providerId, modelId, input.conversationId, response.usage).catch(() => undefined);
      text = response.text;
      if (!response.toolCalls.length || !active.length) break;
      messages.push({ role: "assistant", parts: [...(response.text ? [{ type: "text" as const, text: response.text }] : []), ...response.toolCalls.map((c) => ({ type: "tool_call" as const, ...c }))] });
      const results: ToolResultPart[] = [];
      for (const call of response.toolCalls) {
        input.onProgress?.(`${call.name}…`);
        const tool = toolMap.get(call.name);
        const parsed = parseToolArguments(call.arguments);
        let content: string;
        let isError = false;
        if (!tool) {
          content = `Error: unknown tool ${call.name}`;
          isError = true;
        } else if (!parsed.ok) {
          content = `Error: ${parsed.error}`;
          isError = true;
        } else {
          const issues = validateArgs(tool.tool.inputSchema, parsed.value);
          if (issues.length) {
            content = `Error: invalid arguments: ${issues.map((i) => `${i.path} ${i.message}`).join("; ")}`;
            isError = true;
          } else {
            try {
              const out = await tool.tool.execute(parsed.value, { signal: input.signal ?? new AbortController().signal, conversationId: input.conversationId ?? "", assistantId: null });
              content = out.content;
              isError = Boolean(out.isError);
            } catch (error) {
              if (input.signal?.aborted) throw error;
              content = `Error: ${error instanceof Error ? error.message : String(error)}`;
              isError = true;
            }
          }
        }
        results.push({ type: "tool_result", toolCallId: call.id, name: call.name, content: truncateToTokens(content, 3000), isError });
      }
      messages.push({ role: "tool", parts: results });
    }
    return { text: text.trim() || "(the sub-agent returned no answer)", steps, inputTokens, outputTokens, providerId, modelId };
  }

  /** Condenses a long page for a question (search summaries). */
  async summarize(input: { text: string; focus: string; conversationId: string | null; signal?: AbortSignal; kind?: UsageKind }): Promise<string> {
    const { providerId, modelId } = await this.model(input.conversationId);
    const provider = await this.deps.getChatProvider(providerId);
    const response = await collectResponse(
      provider,
      {
        model: modelId,
        system: "Summarize the document for the stated purpose. Keep facts, numbers, names, dates and quotes that matter; drop navigation and boilerplate. Answer in the document's language.",
        maxTokens: 1024,
        temperature: 0.2,
        messages: [{ role: "user", parts: [{ type: "text", text: `Purpose: ${input.focus}\n\nDocument:\n${truncateToTokens(input.text, 12_000)}` }] }],
      },
      { signal: input.signal, timeoutMs: 60_000, retry: { retries: 1 } },
    );
    await this.record(input.kind ?? "search_summary", providerId, modelId, input.conversationId, response.usage).catch(() => undefined);
    return response.text.trim();
  }
}
