import type { Metadata } from "next";
import { ChatHome } from "@/features/chat/chat-home";

export const metadata: Metadata = { title: "Chat" };

export default function ChatPage() {
  return <ChatHome />;
}
