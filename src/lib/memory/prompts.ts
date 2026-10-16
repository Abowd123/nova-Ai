/** Model-facing prompts (English works best across models; the output follows the chat language). */

export const SUMMARY_SYSTEM =
  "You maintain a running summary of a conversation between a user and an AI assistant. " +
  "Write a concise, factual summary that preserves: the user's goals, preferences and personal facts they shared, " +
  "decisions made, open questions, important numbers, names, code identifiers and file names. " +
  "Use short bullet points. Do not invent anything. Write in the same language the conversation mostly uses. " +
  "Output only the summary.";

export function summaryUserPrompt(previous: string | null, transcript: string): string {
  return [
    previous?.trim() ? `Current summary:\n${previous.trim()}` : "There is no summary yet.",
    `New messages to integrate:\n${transcript}`,
    "Return the updated summary (merge, don't just append; drop details that no longer matter).",
  ].join("\n\n");
}

export function transcriptLine(role: string, text: string): string {
  return `${role === "user" ? "User" : "Assistant"}: ${text.replace(/<context>[\s\S]*?<\/context>\s*/g, "").trim()}`;
}

/** Strips wrappers some models add ("Here is the summary:", code fences). */
export function cleanSummary(raw: string): string {
  return raw
    .trim()
    .replace(/^```[a-z]*\n?|```$/g, "")
    .replace(/^(here is|here's)[^\n:]*:\s*/i, "")
    .replace(/^(ملخص|الملخص)[^\n:]*:\s*/u, "")
    .trim();
}
