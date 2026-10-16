/** Links that must leave the app (system browser) instead of navigating the WebView. */
export function isExternalLink(href: string, appOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(href, appOrigin);
  } catch {
    return false;
  }
  if (url.protocol === "mailto:" || url.protocol === "tel:") return true;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return url.origin !== appOrigin;
}

/** Returns the anchor an event targets when it should open externally. */
export function externalAnchorFor(event: MouseEvent, appOrigin: string): HTMLAnchorElement | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!anchor || anchor.hasAttribute("download")) return null;
  return isExternalLink(anchor.getAttribute("href") ?? "", appOrigin) ? anchor : null;
}
