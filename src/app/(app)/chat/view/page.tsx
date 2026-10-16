import { Suspense } from "react";
import { LoadingState } from "@/components/feedback/loading-state";
import { ChatViewByQuery } from "@/features/chat/chat-view-by-query";

/** /chat/view?id=… — conversation route that works in the static (APK) export. */
export default function ChatViewPage() {
  return (
    <Suspense fallback={<LoadingState label="…" rows={3} />}>
      <ChatViewByQuery />
    </Suspense>
  );
}
