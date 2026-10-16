import { Suspense } from "react";
import type { Metadata } from "next";
import { LoadingState } from "@/components/feedback/loading-state";
import { McpServersScreen } from "@/features/tools/mcp-servers-screen";

export const metadata: Metadata = { title: "MCP servers" };

export default function McpServersPage() {
  return (
    <Suspense fallback={<LoadingState label="…" rows={2} />}>
      <McpServersScreen />
    </Suspense>
  );
}
