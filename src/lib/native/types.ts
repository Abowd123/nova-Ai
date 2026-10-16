/**
 * Platform bridge: the only place that knows about Capacitor. UI and services call these
 * functions; on the web they fall back to standard APIs, so the app runs without Capacitor.
 */
export type Platform = "web" | "android" | "ios";
export type HapticKind = "light" | "medium" | "success" | "warning" | "error";
export type SaveFileResult = "saved" | "downloaded" | "shared" | "cancelled";

export interface ShareInput {
  title?: string;
  text?: string;
  url?: string;
  files?: { name: string; data: Blob }[];
}

export interface NativeBridge {
  readonly platform: Platform;
  readonly isNative: boolean;
  saveFile(name: string, data: Blob, options?: { mime?: string; share?: boolean }): Promise<SaveFileResult>;
  share(input: ShareInput): Promise<"shared" | "cancelled" | "unsupported">;
  haptic(kind: HapticKind): Promise<void>;
  notify(input: { id: number; title: string; body: string; route?: string }): Promise<boolean>;
  requestNotifications(): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  /** Returns an unsubscribe function. */
  onBackButton(handler: (info: { canGoBack: boolean }) => void): () => void;
  onAppState(handler: (active: boolean) => void): () => void;
  onDeepLink(handler: (url: string) => void): () => void;
  onNetwork(handler: (online: boolean) => void): () => void;
  onKeyboard(handler: (visible: boolean, height: number) => void): () => void;
  onNotificationTap(handler: (route: string | null) => void): () => void;
  setStatusBar(theme: "light" | "dark", color: string): Promise<void>;
  hideSplash(): Promise<void>;
  exitApp(): Promise<void>;
}

export interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

export function capacitorGlobal(): CapacitorGlobal | undefined {
  return typeof window !== "undefined" ? (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor : undefined;
}

export function detectPlatform(cap: CapacitorGlobal | undefined = capacitorGlobal()): Platform {
  if (!cap?.isNativePlatform?.()) return "web";
  const p = cap.getPlatform?.();
  return p === "ios" ? "ios" : "android";
}
