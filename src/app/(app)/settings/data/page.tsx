import type { Metadata } from "next";
import { DataScreen } from "@/features/data/data-screen";

export const metadata: Metadata = { title: "Import & export" };

export default function DataPage() {
  return <DataScreen />;
}
