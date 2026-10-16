import { Suspense } from "react";
import type { Metadata } from "next";
import { LoadingState } from "@/components/feedback/loading-state";
import { AssistantsScreen } from "@/features/assistants/assistants-screen";

export const metadata: Metadata = { title: "Assistants" };

export default function AssistantsPage() {
  // useSearchParams (filter state in the URL) requires a Suspense boundary for static rendering.
  return (
    <Suspense fallback={<LoadingState label="…" rows={3} />}>
      <AssistantsScreen />
    </Suspense>
  );
}
