import { getBridge } from "./index";
import type { HapticKind } from "./types";

let enabled = true;

/** Synced from Settings → App & device. */
export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

/** Fire-and-forget haptic feedback (no-op when disabled or unsupported). */
export function haptic(kind: HapticKind): void {
  if (!enabled) return;
  void getBridge()
    .haptic(kind)
    .catch(() => undefined);
}
