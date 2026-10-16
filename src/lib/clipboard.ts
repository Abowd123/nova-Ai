import { getBridge } from "@/lib/native";
import { detectPlatform } from "@/lib/native/types";
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Native share sheet when available, clipboard otherwise. */
export async function shareText(text: string, title?: string): Promise<"shared" | "copied" | "failed" | "cancelled"> {
  if (detectPlatform() !== "web") {
    // Android share sheet (WebView has no navigator.share).
    const result = await getBridge().share({ title, text });
    if (result !== "unsupported") return result;
  }
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ text, title });
      return "shared";
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") return "cancelled";
    }
  }
  return (await copyText(text)) ? "copied" : "failed";
}
