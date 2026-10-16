/**
 * Android back button policy:
 *  1) an open dialog/sheet/menu closes (same as Escape),
 *  2) otherwise go back in history,
 *  3) on a root screen with no history, exit (second press within 2 s, with a hint first).
 */
export type BackAction = "close-overlay" | "history-back" | "confirm-exit" | "exit";

export const ROOT_PATHS = ["/", "/chat", "/chat/"];

export function decideBack(state: { overlayOpen: boolean; canGoBack: boolean; pathname: string; lastPressAt: number | null; now: number }): BackAction {
  if (state.overlayOpen) return "close-overlay";
  const atRoot = ROOT_PATHS.includes(state.pathname);
  if (state.canGoBack && !atRoot) return "history-back";
  if (state.lastPressAt !== null && state.now - state.lastPressAt < 2000) return "exit";
  return "confirm-exit";
}

/** Radix dialogs/sheets/menus mark themselves with data-state="open". */
export function findOpenOverlay(doc: Document = document): Element | null {
  const overlays = doc.querySelectorAll('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [data-radix-popper-content-wrapper]');
  return overlays.length ? overlays[overlays.length - 1]! : null;
}

export function closeOverlay(doc: Document = document): void {
  const target = doc.activeElement ?? doc.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
}
