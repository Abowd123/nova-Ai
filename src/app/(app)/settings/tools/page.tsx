import type { Metadata } from "next";
import { ToolsSettingsScreen } from "@/features/tools/tools-settings-screen";

export const metadata: Metadata = { title: "Tools" };

export default function ToolsSettingsPage() {
  return <ToolsSettingsScreen />;
}
