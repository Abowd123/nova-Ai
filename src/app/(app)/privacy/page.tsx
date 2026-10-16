import type { Metadata } from "next";
import { PrivacyScreen } from "@/features/security/privacy-screen";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return <PrivacyScreen />;
}
