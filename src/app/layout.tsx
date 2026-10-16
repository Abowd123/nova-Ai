import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Providers } from "@/components/providers/providers";
import { clientEnv } from "@/env";
import { getBootScript } from "@/lib/boot-script";
import { getDirection } from "@/lib/i18n/locale";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(clientEnv.NEXT_PUBLIC_APP_URL),
  title: { default: clientEnv.NEXT_PUBLIC_APP_NAME, template: `%s · ${clientEnv.NEXT_PUBLIC_APP_NAME}` },
  description: "Local-first, multi-provider AI assistant.",
  applicationName: clientEnv.NEXT_PUBLIC_APP_NAME,
  appleWebApp: { capable: true, title: clientEnv.NEXT_PUBLIC_APP_NAME, statusBarStyle: "default" },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Android keyboard resizes the layout instead of covering the composer.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FEF7FF" },
    { media: "(prefers-color-scheme: dark)", color: "#141218" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = clientEnv.NEXT_PUBLIC_DEFAULT_LOCALE;
  // Set by middleware (CSP nonce); absent when CSP is off.
  // Static export (APK shell) has no middleware: skip the request headers there.
  const nonce = process.env.NOVA_STATIC_EXPORT === "1" ? undefined : ((await headers()).get("x-nonce") ?? undefined);
  return (
    <html lang={locale} dir={getDirection(locale)} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: getBootScript(locale) }} />
      </head>
      <body className="min-h-dvh font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
