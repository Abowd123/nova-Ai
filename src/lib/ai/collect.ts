import type { ChatProvider, ChatRequest, StreamOptions, TokenUsage } from "./types";

/** Runs a non-interactive request and returns the full text (titles, summaries…). */
export async function collectText(provider: ChatProvider, request: ChatRequest, options?: StreamOptions): Promise<string> {
  return (await collectResponse(provider, request, options)).text;
}

/** Like collectText, plus usage (for cost tracking) and tool calls (sub-agent loop). */
export async function collectResponse(
  provider: ChatProvider,
  request: ChatRequest,
  options?: StreamOptions,
): Promise<{ text: string; usage: TokenUsage | null; toolCalls: { id: string; name: string; arguments: string; signature?: string }[] }> {
  let text = "";
  let usage: TokenUsage | null = null;
  const toolCalls: { id: string; name: string; arguments: string; signature?: string }[] = [];
  for await (const event of provider.streamChat(request, options)) {
    if (event.type === "text-delta") text += event.text;
    else if (event.type === "usage") usage = event.usage;
    else if (event.type === "finish" && event.usage) usage = event.usage;
    else if (event.type === "tool-call") toolCalls.push({ id: event.id, name: event.name, arguments: event.arguments, ...(event.signature ? { signature: event.signature } : {}) });
  }
  return { text, usage, toolCalls };
}
