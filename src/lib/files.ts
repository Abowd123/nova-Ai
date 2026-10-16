import { getBridge } from "@/lib/native";
import { isNativeApp } from "@/lib/platform";
/**
 * File helpers: File System Access API when available (Chromium desktop/Android),
 * classic download / <input type=file> everywhere else (Safari, Firefox, iOS).
 */
export type SaveResult = "saved" | "downloaded" | "cancelled";

function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError";
}

export function downloadText(text: string, fileName: string, mime = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function saveTextFile(text: string, fileName: string, mime = "application/json"): Promise<SaveResult> {
  if (isNativeApp()) {
    // Android: Documents/Nova + share sheet (no file picker in the WebView).
    const result = await getBridge().saveFile(fileName, new Blob([text], { type: mime }), { mime, share: true });
    return result === "cancelled" ? "saved" : result === "shared" ? "saved" : result;
  }
  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: "Nova", accept: { [mime]: [".json"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return "saved";
    } catch (error) {
      if (isAbort(error)) return "cancelled";
      // SecurityError (iframe, no user gesture...) -> fall back to a download.
    }
  }
  downloadText(text, fileName, mime);
  return "downloaded";
}

export interface OpenedFile {
  name: string;
  text: string;
  size: number;
}

export async function openTextFile(accept = ".json,application/json", maxBytes = 100 * 1024 * 1024): Promise<OpenedFile | null> {
  const read = async (file: File): Promise<OpenedFile> => {
    if (file.size > maxBytes) throw new Error("file-too-large");
    return { name: file.name, text: await file.text(), size: file.size };
  };

  if (typeof window.showOpenFilePicker === "function") {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: "Nova", accept: { "application/json": [".json"] } }],
      });
      return handle ? read(await handle.getFile()) : null;
    } catch (error) {
      if (isAbort(error)) return null;
    }
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    input.dataset.testid = "file-input-fallback";
    document.body.append(input);
    const cleanup = () => input.remove();
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      cleanup();
      if (!file) resolve(null);
      else read(file).then(resolve, reject);
    });
    input.addEventListener("cancel", () => {
      cleanup();
      resolve(null);
    });
    input.click();
  });
}

/** Web Share with a file (mobile). Falls back to "unsupported" so callers can download instead. */
export async function shareTextFile(text: string, fileName: string, title: string): Promise<"shared" | "cancelled" | "unsupported"> {
  if (isNativeApp()) return getBridge().share({ title, files: [{ name: fileName, data: new Blob([text], { type: "application/json" }) }] });
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return "unsupported";
  const file = new File([text], fileName, { type: "application/json" });
  if (!navigator.canShare({ files: [file] })) return "unsupported";
  try {
    await navigator.share({ files: [file], title });
    return "shared";
  } catch (error) {
    return isAbort(error) ? "cancelled" : "unsupported";
  }
}

/** Triggers a download for an existing (object) URL. */
export function downloadUrl(url: string, fileName: string): void {
  if (isNativeApp()) {
    // WebViews ignore <a download>: write the file natively instead.
    void fetch(url)
      .then((r) => r.blob())
      .then((blob) => getBridge().saveFile(fileName, blob, { share: true }))
      .catch(() => undefined);
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

/** Web Share with a binary file (images). */
export async function shareBlob(blob: Blob, fileName: string, title: string): Promise<"shared" | "cancelled" | "unsupported"> {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return "unsupported";
  const file = new File([blob], fileName, { type: blob.type });
  if (!navigator.canShare({ files: [file] })) return "unsupported";
  try {
    await navigator.share({ files: [file], title });
    return "shared";
  } catch (error) {
    return (error as { name?: string })?.name === "AbortError" ? "cancelled" : "unsupported";
  }
}
