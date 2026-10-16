import type { ChatMessage, ChatRequest } from "@/lib/ai/types";
import type { Assistant, Message, ProviderModel } from "@/lib/models";

export interface PromptVariables {
  userName: string;
  model: string;
  locale: string;
  now: Date;
}

/** Supports {{date}}, {{time}}, {{user_name}}, {{model}}, {{device_language}}. Unknown variables are left untouched. */
export function renderSystemPrompt(template: string, vars: PromptVariables): string {
  const values: Record<string, string> = {
    date: vars.now.toLocaleDateString(vars.locale, { year: "numeric", month: "long", day: "numeric" }),
    time: vars.now.toLocaleTimeString(vars.locale, { hour: "2-digit", minute: "2-digit" }),
    user_name: vars.userName,
    model: vars.model,
    device_language: vars.locale,
  };
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, name: string) => values[name.toLowerCase()] ?? match);
}

const USABLE: ReadonlySet<Message["status"]> = new Set(["complete", "aborted", "interrupted"]);

/** History -> provider-agnostic messages. Failed/empty turns and reasoning are left out. */
export function toChatMessages(history: Message[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const message of history) {
    if (message.role === "system") continue;
    if (!USABLE.has(message.status)) continue;
    const parts = message.parts.filter((p) => p.type !== "reasoning" || Boolean(p.signature));
    const hasContent = parts.some((p) => (p.type === "text" ? p.text.trim().length > 0 : true));
    if (!hasContent) continue;
    result.push({ role: message.role, parts });
  }
  return result;
}

export interface BuildRequestInput {
  history: Message[];
  modelId: string;
  model?: ProviderModel;
  assistant?: Assistant | null;
  vars: Omit<PromptVariables, "model">;
}

/** Keeps the last N turns. Never starts the window on an orphan assistant reply. */
export function limitHistory(messages: ChatMessage[], limit: number | null | undefined): ChatMessage[] {
  if (!limit || messages.length <= limit) return messages;
  const window = messages.slice(-limit);
  while (window.length > 1 && window[0]?.role === "assistant") window.shift();
  return window;
}

export function buildChatRequest({ history, modelId, model, assistant, vars }: BuildRequestInput): ChatRequest {
  const system = assistant?.systemPrompt?.trim()
    ? renderSystemPrompt(assistant.systemPrompt, { ...vars, model: model?.name ?? modelId })
    : undefined;
  const reasoningSetting = assistant?.settings.reasoning ?? "auto";
  const reasoning =
    reasoningSetting === "on" || (reasoningSetting === "auto" && model?.capabilities.reasoning)
      ? { enabled: true, budgetTokens: assistant?.settings.reasoningBudget ?? 2048 }
      : undefined;
  return {
    model: modelId,
    messages: limitHistory(toChatMessages(history), assistant?.contextMessageLimit),
    system,
    ...(assistant ? { temperature: assistant.temperature } : {}),
    ...(assistant?.topP !== null && assistant?.topP !== undefined ? { topP: assistant.topP } : {}),
    ...(assistant?.maxTokens ? { maxTokens: assistant.maxTokens } : {}),
    ...(reasoning ? { reasoning } : {}),
  };
}

export const CONTINUE_PROMPT =
  "Continue your previous answer exactly where it stopped. Do not repeat what you already wrote and do not add any preamble.";
