export type { ChatProvider, TokenUsage } from "@/lib/ai/types";

export interface ToolCallPartLike {
  id: string;
  name: string;
  arguments: string;
  signature?: string;
}
