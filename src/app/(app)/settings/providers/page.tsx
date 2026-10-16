import type { Metadata } from "next";
import { ProvidersScreen } from "@/features/providers/providers-screen";

export const metadata: Metadata = { title: "Providers" };

export default function ProvidersPage() {
  return <ProvidersScreen />;
}
