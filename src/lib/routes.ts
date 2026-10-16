/**
 * Conversation URLs. The web build uses /chat/<id>; the static export bundled in the Android
 * app has no server to render dynamic segments, so it uses /chat/view?id=<id> (works on both).
 */
export const STATIC_EXPORT = process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";

export function chatHref(id: string, staticExport = STATIC_EXPORT): string {
  return staticExport ? `/chat/view?id=${encodeURIComponent(id)}` : `/chat/${encodeURIComponent(id)}`;
}

/** Conversation id of the current location, if any. */
export function chatIdFrom(pathname: string, search: string): string | null {
  const path = pathname.replace(/\/+$/, "");
  if (path === "/chat/view") return new URLSearchParams(search).get("id");
  const match = /^\/chat\/([^/]+)$/.exec(path);
  return match && match[1] !== "view" ? decodeURIComponent(match[1]!) : null;
}
