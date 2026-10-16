import type { Metadata } from "next";
import { OfflineView } from "@/features/pwa/offline-view";

export const metadata: Metadata = { title: "Offline", robots: { index: false } };

export default function OfflinePage() {
  return <OfflineView />;
}
