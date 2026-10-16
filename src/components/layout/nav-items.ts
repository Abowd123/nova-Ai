import { Bot, Brain, ImageIcon, MessagesSquare, Settings, type LucideIcon } from "lucide-react";

export type NavKey = "chat" | "assistants" | "images" | "memory" | "settings";

export const NAV_ITEMS: ReadonlyArray<{ key: NavKey; href: string; icon: LucideIcon }> = [
  { key: "chat", href: "/chat", icon: MessagesSquare },
  { key: "assistants", href: "/assistants", icon: Bot },
  { key: "images", href: "/images", icon: ImageIcon },
  { key: "memory", href: "/memory", icon: Brain },
  { key: "settings", href: "/settings", icon: Settings },
];

export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/chat") return pathname === "/" || pathname === "/chat" || pathname.startsWith("/chat/");
  return pathname === href || pathname.startsWith(`${href}/`);
}
