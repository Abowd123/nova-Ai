import { ConversationView } from "@/features/chat/conversation-view";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ConversationView id={decodeURIComponent(id)} />;
}
