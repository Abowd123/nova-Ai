import type { MetadataRoute } from "next";
import { clientEnv } from "@/env";

// Required for the static export (Android app); harmless for the web build.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: `${clientEnv.NEXT_PUBLIC_APP_NAME} AI Assistant`,
    short_name: clientEnv.NEXT_PUBLIC_APP_NAME,
    description: "Local-first, multi-provider AI assistant.",
    start_url: "/chat?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#FEF7FF",
    theme_color: "#6750A4",
    lang: clientEnv.NEXT_PUBLIC_DEFAULT_LOCALE,
    dir: clientEnv.NEXT_PUBLIC_DEFAULT_LOCALE === "ar" ? "rtl" : "ltr",
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "New chat",
        short_name: "New",
        url: "/chat?new=1",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
