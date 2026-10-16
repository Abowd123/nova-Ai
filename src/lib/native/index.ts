import { createCapacitorBridge } from "./capacitor-bridge";
import { detectPlatform, type NativeBridge } from "./types";
import { createWebBridge } from "./web-bridge";

export * from "./types";

let bridge: NativeBridge | null = null;

/** The platform bridge (Capacitor on Android/iOS, web APIs elsewhere). */
export function getBridge(): NativeBridge {
  if (bridge) return bridge;
  const platform = detectPlatform();
  bridge = platform === "web" ? createWebBridge() : createCapacitorBridge(platform);
  return bridge;
}

/** Tests only. */
export function setBridgeForTests(next: NativeBridge | null): void {
  bridge = next;
}
