import type { Metadata } from "next";
import { MemorySettingsScreen } from "@/features/settings/memory-settings-screen";

export const metadata: Metadata = { title: "Memory & context" };

export default function MemorySettingsPage() {
  return <MemorySettingsScreen />;
}
