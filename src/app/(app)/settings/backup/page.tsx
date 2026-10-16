import type { Metadata } from "next";
import { BackupScreen } from "@/features/backup/backup-screen";

export const metadata: Metadata = { title: "Backup & sync" };

export default function BackupPage() {
  return <BackupScreen />;
}
