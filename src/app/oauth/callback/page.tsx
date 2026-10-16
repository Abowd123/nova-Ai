import type { Metadata } from "next";
import { OAuthCallbackScreen } from "@/features/tools/oauth-callback-screen";

export const metadata: Metadata = { title: "Signing in…", robots: { index: false } };

export default function OAuthCallbackPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center p-6">
      <div className="w-full">
        <OAuthCallbackScreen />
      </div>
    </main>
  );
}
