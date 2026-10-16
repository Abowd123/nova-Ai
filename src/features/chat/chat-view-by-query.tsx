"use client";

import { useSearchParams } from "next/navigation";
import { NotFoundView } from "@/components/feedback/not-found-view";
import { ConversationView } from "./conversation-view";

export function ChatViewByQuery() {
  const id = useSearchParams().get("id");
  if (!id) return <NotFoundView />;
  return <ConversationView key={id} id={id} />;
}
