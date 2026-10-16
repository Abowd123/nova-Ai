import type { Metadata } from "next";
import { MediaSettingsScreen } from "@/features/settings/media-settings-screen";

export const metadata: Metadata = { title: "Media & voice" };

export default function MediaSettingsPage() {
  return <MediaSettingsScreen />;
}
