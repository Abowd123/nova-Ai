export type ServiceWorkerMode = "auto" | "always" | "never";

export function isServiceWorkerEnabled(mode: ServiceWorkerMode, nodeEnv: string | undefined): boolean {
  if (mode === "always") return true;
  if (mode === "never") return false;
  return nodeEnv === "production";
}

export function serviceWorkerUrl(buildId: string): string {
  return `/sw.js?v=${encodeURIComponent(buildId)}`;
}
