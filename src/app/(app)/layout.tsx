import { AppShell } from "@/components/layout/app-shell";
import { CodeRunnerProvider } from "@/features/tools/code-runner-provider";
import { OAuthDeepLinkListener } from "@/features/tools/oauth-callback-screen";

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <CodeRunnerProvider>
      <OAuthDeepLinkListener />
      <AppShell>{children}</AppShell>
    </CodeRunnerProvider>
  );
}
