import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

/**
 * Build identifier used to version the service worker caches.
 * Every new build gets a new SW URL (/sw.js?v=<buildId>) so stale caches are dropped.
 */
const buildId =
  process.env.NEXT_PUBLIC_BUILD_ID ??
  process.env.GITHUB_SHA?.slice(0, 12) ??
  Date.now().toString(36);

const appVersion = process.env.npm_package_version ?? "0.1.0";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Camera/microphone are needed later (phase 4) for this origin only.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
];

/**
 * NOVA_STATIC_EXPORT=1 → static export for the Android app (Capacitor serves files from the APK).
 * Server-only parts (API routes, middleware, /chat/[id], /sandbox/py) are moved aside by
 * scripts/build-mobile.mjs during that build.
 */
const staticExport = process.env.NOVA_STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(staticExport ? { output: "export" as const, trailingSlash: true, images: { unoptimized: true } } : {}),
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_STATIC_EXPORT: staticExport ? "1" : "0",
  },
  async headers() {
    if (staticExport) return [];
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === "true", openAnalyzer: false });

export default withBundleAnalyzer(nextConfig);
