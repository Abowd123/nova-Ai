import type { ChatMessage } from "@/lib/ai/types";
import type { MessagePart } from "@/lib/models";
import { estimateMessageTokens, estimateTokens, truncateToTokens } from "./tokens";

export interface ContextMessage {
  message: ChatMessage;
  /** Stored message id/time when known (used to skip summarized turns and RAG duplicates). */
  id?: string;
  createdAt?: number;
}

export interface LoreItem {
  lorebookId: string;
  entryId: string;
  content: string;
}

export interface MemoryItem {
  id: string;
  text: string;
  score: number;
}

export interface ContextInput {
  /** Assistant system prompt (stable across turns). */
  system?: string;
  lore: LoreItem[];
  /** Best first. */
  memories: MemoryItem[];
  summary: { text: string; coveredUntil: number | null } | null;
  /** Chronological; the last entry must be the current user turn. */
  messages: ContextMessage[];
  contextWindow: number;
  reserveOutput: number;
  maxToolResultTokens: number;
  /** Cap for injected memories (on top of the window check). */
  memoryTokenBudget: number;
  templates?: Partial<ContextTemplates>;
}

export interface ContextTemplates {
  /** Must contain {{memories}}. */
  memory: string;
  lore: string;
  summary: string;
}

export const DEFAULT_TEMPLATES: ContextTemplates = {
  memory: "Relevant notes from earlier conversations (may be outdated; use only if helpful):\n{{memories}}",
  lore: "Background knowledge for this conversation:",
  summary: "Summary of the earlier part of this conversation:",
};

export interface ContextBreakdown {
  system: number;
  lore: number;
  memory: number;
  summary: number;
  messages: number;
  reserved: number;
  /** Everything sent (excludes the reserved reply budget). */
  total: number;
  window: number;
}

export interface ContextResult {
  /** Stable prefix: assistant prompt + summary. Changes rarely, so provider prompt caches hit. */
  system?: string;
  messages: ChatMessage[];
  breakdown: ContextBreakdown;
  usedMemoryIds: string[];
  usedMemoryScores: number[];
  usedLore: { lorebookId: string; entryId: string }[];
  summaryUsed: boolean;
  /** Messages dropped without being covered by the summary. */
  omittedMessages: number;
  /** Messages represented by the summary instead of their text. */
  summarizedMessages: number;
  /** System + current turn alone exceed the window: the request will fail. */
  overflow: boolean;
  /** total / window */
  ratio: number;
  /** Ids of stored messages that made it into the request (for RAG de-duplication). */
  keptMessageIds: string[];
}

const CONTEXT_OPEN = "<context>";
const CONTEXT_CLOSE = "</context>";

/** Long tool outputs (web pages, logs) are cut so one tool call can't eat the window. */
export function truncateToolResults(parts: MessagePart[], maxTokens: number): MessagePart[] {
  return parts.map((part) => {
    if (part.type !== "tool_result") return part;
    const tokens = estimateTokens(part.content);
    if (tokens <= maxTokens) return part;
    return { ...part, content: `${truncateToTokens(part.content, maxTokens)}\n…[truncated ${tokens - maxTokens} tokens]` };
  });
}

function joinSections(sections: (string | undefined | null)[]): string | undefined {
  const text = sections.filter((s): s is string => Boolean(s && s.trim())).join("\n\n");
  return text || undefined;
}

/**
 * Fits a request into the model window. Priority (highest first):
 *   system prompt + current user turn (mandatory) > lorebook > memory > summary > recent messages.
 * Lorebook + memories change every turn, so they are injected into the CURRENT user turn
 * (the uncached tail) instead of the system prompt: the prefix (system + summary + older
 * turns) stays byte-identical between requests and provider prompt caching keeps working.
 */
export function buildContext(input: ContextInput): ContextResult {
  const templates = { ...DEFAULT_TEMPLATES, ...input.templates };
  const window = Math.max(0, input.contextWindow);
  const available = Math.max(0, window - input.reserveOutput);

  const messages = input.messages.map((m) => ({ ...m, message: { ...m.message, parts: truncateToolResults(m.message.parts, input.maxToolResultTokens) } }));
  const current = messages.at(-1);
  const older = messages.slice(0, -1);

  const systemTokens = input.system ? estimateTokens(input.system) + 4 : 0;
  const currentTokens = current ? estimateMessageTokens(current.message) : 0;
  let used = systemTokens + currentTokens;
  const overflow = used > available;

  // 1) Lorebook (already priority-ordered and budgeted per book).
  const usedLore: LoreItem[] = [];
  let loreTokens = 0;
  if (input.lore.length) {
    const header = estimateTokens(templates.lore) + 2;
    for (const item of input.lore) {
      const cost = estimateTokens(item.content) + 2 + (usedLore.length === 0 ? header : 0);
      if (used + cost > available) continue;
      usedLore.push(item);
      loreTokens += cost;
      used += cost;
    }
  }

  // 2) Memories within their own budget.
  const usedMemories: MemoryItem[] = [];
  let memoryTokens = 0;
  if (input.memories.length) {
    const header = estimateTokens(templates.memory.replace("{{memories}}", "")) + 2;
    for (const memory of input.memories) {
      const cost = estimateTokens(memory.text) + 3 + (usedMemories.length === 0 ? header : 0);
      if (memoryTokens + cost > input.memoryTokenBudget || used + cost > available) continue;
      usedMemories.push(memory);
      memoryTokens += cost;
      used += cost;
    }
  }

  // 3) Summary (only meaningful if it covers some of the older turns).
  const summaryText = input.summary?.text.trim();
  let summaryUsed = false;
  let summaryTokens = 0;
  let candidates = older;
  if (summaryText && input.summary) {
    const covered = input.summary.coveredUntil;
    const cost = estimateTokens(summaryText) + estimateTokens(templates.summary) + 4;
    const coversSomething = covered !== null && older.some((m) => m.createdAt !== undefined && m.createdAt <= covered);
    if (coversSomething && used + cost <= available) {
      summaryUsed = true;
      summaryTokens = cost;
      used += cost;
      candidates = older.filter((m) => m.createdAt === undefined || m.createdAt > covered);
    }
  }
  const summarizedMessages = older.length - candidates.length;

  // 4) Recent messages, newest first.
  const kept: ContextMessage[] = [];
  let messageTokens = currentTokens;
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const candidate = candidates[i]!;
    const cost = estimateMessageTokens(candidate.message);
    if (used + cost > available) break;
    kept.unshift(candidate);
    used += cost;
    messageTokens += cost;
  }
  // Never start on an orphan assistant reply or tool result.
  while (kept.length && kept[0]!.message.role !== "user") {
    const dropped = kept.shift()!;
    const cost = estimateMessageTokens(dropped.message);
    used -= cost;
    messageTokens -= cost;
  }
  const omittedMessages = candidates.length - kept.length;

  const system = joinSections([input.system, summaryUsed ? `${templates.summary}\n${summaryText}` : null]);
  const note = joinSections([
    usedLore.length ? `${templates.lore}\n${usedLore.map((l) => l.content.trim()).join("\n\n")}` : null,
    usedMemories.length ? templates.memory.replace("{{memories}}", usedMemories.map((m) => `- ${m.text.trim().replace(/\n+/g, " ")}`).join("\n")) : null,
  ]);

  const out: ChatMessage[] = kept.map((m) => m.message);
  if (current) {
    out.push(note ? { ...current.message, parts: [{ type: "text", text: `${CONTEXT_OPEN}\n${note}\n${CONTEXT_CLOSE}\n\n` }, ...current.message.parts] } : current.message);
  }

  const total = used;
  return {
    system,
    messages: out,
    breakdown: { system: systemTokens, lore: loreTokens, memory: memoryTokens, summary: summaryTokens, messages: messageTokens, reserved: input.reserveOutput, total, window },
    usedMemoryIds: usedMemories.map((m) => m.id),
    usedMemoryScores: usedMemories.map((m) => Math.round(m.score * 1000) / 1000),
    usedLore: usedLore.map(({ lorebookId, entryId }) => ({ lorebookId, entryId })),
    summaryUsed,
    omittedMessages,
    summarizedMessages,
    overflow,
    ratio: window > 0 ? total / window : 1,
    keptMessageIds: [...kept, ...(current ? [current] : [])].map((m) => m.id).filter((id): id is string => Boolean(id)),
  };
}

/** Context window for a model: known value, else the configured default. */
export function contextWindowFor(model: { contextWindow: number | null } | undefined, fallback: number): number {
  return model?.contextWindow && model.contextWindow > 0 ? model.contextWindow : fallback;
}

/** Reply budget: assistant max tokens when set, else the default reserve, never above half the window. */
export function reserveFor(maxTokens: number | null | undefined, fallback: number, window: number): number {
  return Math.min(maxTokens ?? fallback, Math.floor(window / 2));
}
