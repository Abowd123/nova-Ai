import type { Metadata } from "next";
import { SecurityScreen } from "@/features/security/security-screen";

export const metadata: Metadata = { title: "Privacy & security" };

export default function SecurityPage() {
  return <SecurityScreen />;
}
