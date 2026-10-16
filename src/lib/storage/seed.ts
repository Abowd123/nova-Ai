import type { Locale, MessageRole } from "@/lib/models";
import type { Repositories } from "./types";

interface DemoContent {
  assistants: { name: string; avatar: string; description: string; systemPrompt: string }[];
  conversations: {
    title: string;
    pinned?: boolean;
    messages: { role: MessageRole; content: string }[];
  }[];
}

const DEMO: Record<Locale, DemoContent> = {
  ar: {
    assistants: [
      {
        name: "المساعد العام",
        avatar: "✨",
        description: "مساعد متعدد الاستخدامات للأسئلة اليومية.",
        systemPrompt: "أنت مساعد مفيد. اليوم هو {{date}}.",
      },
      {
        name: "مبرمج TypeScript",
        avatar: "🧑‍💻",
        description: "يراجع الكود ويقترح حلولاً نظيفة.",
        systemPrompt: "أنت مهندس برمجيات خبير في TypeScript وReact.",
      },
      {
        name: "مترجم",
        avatar: "🌍",
        description: "ترجمة دقيقة بين العربية والإنجليزية.",
        systemPrompt: "ترجم النص مع الحفاظ على المعنى والأسلوب.",
      },
    ],
    conversations: [
      {
        title: "خطة إطلاق Nova",
        pinned: true,
        messages: [
          { role: "user", content: "ما هي أولويات الإصدار 0.1؟" },
          { role: "assistant", content: "الواجهة الأساسية وPWA وتخزين Dexie وCI." },
        ],
      },
      {
        title: "مراجعة كود React",
        messages: [{ role: "user", content: "كيف أمنع إعادة رسم القائمة مع كل token؟" }],
      },
      {
        title: "Translate a paragraph",
        messages: [{ role: "user", content: "ترجم: Local-first apps keep your data on device." }],
      },
    ],
  },
  en: {
    assistants: [
      {
        name: "General assistant",
        avatar: "✨",
        description: "A versatile helper for everyday questions.",
        systemPrompt: "You are a helpful assistant. Today is {{date}}.",
      },
      {
        name: "TypeScript coder",
        avatar: "🧑‍💻",
        description: "Reviews code and suggests clean solutions.",
        systemPrompt: "You are an expert TypeScript and React engineer.",
      },
      {
        name: "Translator",
        avatar: "🌍",
        description: "Accurate Arabic and English translation.",
        systemPrompt: "Translate text while preserving meaning and tone.",
      },
    ],
    conversations: [
      {
        title: "Nova launch plan",
        pinned: true,
        messages: [
          { role: "user", content: "What are the priorities for 0.1?" },
          { role: "assistant", content: "Core shell, PWA, Dexie storage and CI." },
        ],
      },
      {
        title: "React code review",
        messages: [{ role: "user", content: "How do I avoid re-rendering the list on every token?" }],
      },
      {
        title: "ترجمة فقرة",
        messages: [{ role: "user", content: "Translate: التطبيقات المحلية أولاً تحفظ بياناتك على جهازك." }],
      },
    ],
  },
};

export async function seedDemoData(repos: Repositories, locale: Locale): Promise<void> {
  const content = DEMO[locale];
  const assistantIds: string[] = [];
  for (const assistant of content.assistants) {
    assistantIds.push((await repos.assistants.create(assistant)).id);
  }
  for (const [index, conversation] of content.conversations.entries()) {
    const created = await repos.conversations.create({
      title: conversation.title,
      assistantId: assistantIds[index % assistantIds.length] ?? null,
    });
    for (const message of conversation.messages) {
      await repos.messages.create({ conversationId: created.id, ...message, status: "complete" });
    }
    if (conversation.pinned) await repos.conversations.update(created.id, { pinned: true });
  }
}
