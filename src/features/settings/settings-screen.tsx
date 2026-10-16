"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArchiveRestore, AudioLines, Brain, ChevronLeft, Download, ImagePlus, Monitor, Moon, CloudUpload, Plug, Server, ShieldCheck, Sun, Trash2, Wrench } from "lucide-react";
import { useTheme } from "next-themes";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/feedback/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import { clientEnv } from "@/env";
import { ModelPicker } from "@/features/chat/model-picker";
import { effectiveModel, modelKey } from "@/features/chat/model-selection";
import { useProviders } from "@/features/providers/queries";
import { useInstallPrompt } from "@/features/pwa/use-install-prompt";
import { useI18n } from "@/hooks/use-i18n";
import { DeviceSettingsCard } from "./device-settings-card";
import { useMounted } from "@/hooks/use-mounted";
import { formatBytes } from "@/lib/format";
import { getErrorMessage } from "@/lib/i18n/error-message";
import type { Locale, ThemePreference } from "@/lib/models";
import { useClearAllData, useSettings, useStorageEstimate, useUpdateSettings } from "./queries";

export function SettingsScreen() {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const clearAll = useClearAllData();
  const storage = useStorageEstimate();
  const install = useInstallPrompt();
  const providers = useProviders();
  const nameId = useId();
  const [userName, setUserName] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (settings.data) setUserName(settings.data.userName);
  }, [settings.data]);

  const reportError = (error: unknown) =>
    toast({ title: getErrorMessage(error, t), variant: "destructive" });

  const currentTheme = (mounted ? theme : "system") as ThemePreference;

  const changeTheme = (value: ThemePreference) => {
    setTheme(value);
    updateSettings.mutate({ theme: value }, { onError: reportError });
  };

  const changeLocale = (value: Locale) => {
    setLocale(value);
    updateSettings.mutate({ locale: value }, { onError: reportError });
  };

  const saveName = (event: FormEvent) => {
    event.preventDefault();
    updateSettings.mutate(
      { userName: userName.trim() },
      { onSuccess: () => toast({ title: t.settings.saved, variant: "success" }), onError: reportError },
    );
  };

  const handleClear = () =>
    clearAll.mutate(undefined, {
      onSuccess: () => {
        setConfirmClear(false);
        setTheme("system");
        setUserName("");
        toast({ title: t.settings.cleared });
      },
      onError: reportError,
    });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <PageHeader title={t.settings.title} description={t.settings.description} />

      <Card>
        <CardHeader>
          <CardTitle>{t.settings.appearance}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <span className="text-sm font-medium">
              {t.settings.theme}
            </span>
            <SegmentedControl
              label={t.settings.theme}
              value={currentTheme}
              onValueChange={changeTheme}
              options={[
                { value: "light", label: t.settings.themes.light, icon: Sun },
                { value: "dark", label: t.settings.themes.dark, icon: Moon },
                { value: "system", label: t.settings.themes.system, icon: Monitor },
              ]}
            />
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium">{t.settings.language}</span>
            <SegmentedControl
              label={t.settings.language}
              value={locale}
              onValueChange={changeLocale}
              options={[
                { value: "ar", label: t.settings.languages.ar },
                { value: "en", label: t.settings.languages.en },
              ]}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.settings.chat}</CardTitle>
          <CardDescription>{t.settings.chatDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Link
            href="/settings/providers"
            className="flex items-center gap-3 rounded-2xl border bg-surface-container-low p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Server className="size-5 shrink-0" aria-hidden="true" />
            <span className="flex-1">
              <span className="block font-medium">{t.providers.title}</span>
              <span className="block text-sm text-muted-foreground">{t.settings.providersLink(providers.data?.length ?? 0)}</span>
            </span>
            <ChevronLeft className="size-5 ltr:rotate-180" aria-hidden="true" />
          </Link>
          <div className="grid gap-2">
            <span className="text-sm font-medium">{t.settings.defaultModel}</span>
            {(() => {
              const current = effectiveModel(providers.data ?? [], null, settings.data);
              return (
                <ModelPicker
                  label={t.settings.defaultModel}
                  value={current ? modelKey(current.providerId, current.model.id) : null}
                  onChange={({ providerId, modelId }) =>
                    updateSettings.mutate(
                      { defaultProviderId: providerId, defaultModelId: modelId },
                      { onSuccess: () => toast({ title: t.settings.saved, variant: "success" }), onError: reportError },
                    )
                  }
                />
              );
            })()}
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium">{t.settings.sendShortcut}</span>
            <SegmentedControl
              label={t.settings.sendShortcut}
              value={settings.data?.sendShortcut ?? "ctrl-enter"}
              onValueChange={(value) => updateSettings.mutate({ sendShortcut: value }, { onError: reportError })}
              options={[
                { value: "ctrl-enter", label: t.settings.shortcutCtrlEnter },
                { value: "enter", label: t.settings.shortcutEnter },
              ]}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium" id="auto-title-label">
                {t.settings.autoTitle}
              </p>
              <p className="text-xs text-muted-foreground">{t.settings.autoTitleHint}</p>
            </div>
            <Switch
              aria-labelledby="auto-title-label"
              checked={settings.data?.autoTitle ?? true}
              onCheckedChange={(autoTitle) => updateSettings.mutate({ autoTitle }, { onError: reportError })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.settings.profile}</CardTitle>
        </CardHeader>
        <CardContent>
          {settings.isPending ? (
            <LoadingState label={t.common.loading} />
          ) : settings.isError ? (
            <ErrorState
              title={t.settings.loadError}
              description={getErrorMessage(settings.error, t)}
              retryLabel={t.common.retry}
              onRetry={() => void settings.refetch()}
            />
          ) : (
            <form onSubmit={saveName} className="grid gap-2">
              <Label htmlFor={nameId}>{t.settings.userName}</Label>
              <div className="flex gap-2">
                <Input
                  id={nameId}
                  value={userName}
                  maxLength={100}
                  dir="auto"
                  autoComplete="name"
                  aria-describedby={`${nameId}-hint`}
                  onChange={(event) => setUserName(event.target.value)}
                />
                <Button type="submit" disabled={updateSettings.isPending}>
                  {t.common.save}
                </Button>
              </div>
              <p id={`${nameId}-hint`} className="text-xs text-muted-foreground">
                {t.settings.userNameHint}
              </p>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.settings.install}</CardTitle>
          <CardDescription>{t.settings.installDescription}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {install.installed ? (
            <p>{t.settings.installed}</p>
          ) : install.canInstall ? (
            <Button onClick={() => void install.promptInstall()}>
              <Download aria-hidden="true" />
              {t.settings.installButton}
            </Button>
          ) : (
            <p className="text-muted-foreground">
              {install.isIos ? t.settings.iosInstallHint : t.settings.installUnavailable}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.settings.mediaSection}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <Link
            href="/settings/media"
            className="flex items-center gap-3 rounded-2xl border bg-surface-container-low p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <AudioLines className="size-5 shrink-0" aria-hidden="true" />
            <span className="flex-1">
              <span className="block font-medium">{t.settings.media}</span>
              <span className="block text-muted-foreground">{t.settings.mediaDescription}</span>
            </span>
            <ChevronLeft className="size-5 ltr:rotate-180" aria-hidden="true" />
          </Link>
          <Link
            href="/settings/memory"
            className="flex items-center gap-3 rounded-2xl border bg-surface-container-low p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Brain className="size-5 shrink-0" aria-hidden="true" />
            <span className="flex-1">
              <span className="block font-medium">{t.settings.memorySettings}</span>
              <span className="block text-muted-foreground">{t.settings.memorySettingsDescription}</span>
            </span>
            <ChevronLeft className="size-5 ltr:rotate-180" aria-hidden="true" />
          </Link>
          <Link
            href="/images"
            className="flex items-center gap-3 rounded-2xl border bg-surface-container-low p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ImagePlus className="size-5 shrink-0" aria-hidden="true" />
            <span className="flex-1">
              <span className="block font-medium">{t.settings.images}</span>
              <span className="block text-muted-foreground">{t.settings.imagesDescription}</span>
            </span>
            <ChevronLeft className="size-5 ltr:rotate-180" aria-hidden="true" />
          </Link>
          <Link
            href="/settings/tools"
            className="flex items-center gap-3 rounded-2xl border bg-surface-container-low p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Wrench className="size-5 shrink-0" aria-hidden="true" />
            <span className="flex-1">
              <span className="block font-medium">{t.settings.tools}</span>
              <span className="block text-muted-foreground">{t.settings.toolsDescription}</span>
            </span>
            <ChevronLeft className="size-5 ltr:rotate-180" aria-hidden="true" />
          </Link>
          <Link
            href="/settings/mcp"
            className="flex items-center gap-3 rounded-2xl border bg-surface-container-low p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plug className="size-5 shrink-0" aria-hidden="true" />
            <span className="flex-1">
              <span className="block font-medium">{t.settings.mcp}</span>
              <span className="block text-muted-foreground">{t.settings.mcpDescription}</span>
            </span>
            <ChevronLeft className="size-5 ltr:rotate-180" aria-hidden="true" />
          </Link>
          <Link
            href="/settings/backup"
            className="flex items-center gap-3 rounded-2xl border bg-surface-container-low p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CloudUpload className="size-5 shrink-0" aria-hidden="true" />
            <span className="flex-1">
              <span className="block font-medium">{t.settings.backupLink}</span>
              <span className="block text-muted-foreground">{t.settings.backupLinkDescription}</span>
            </span>
            <ChevronLeft className="size-5 ltr:rotate-180" aria-hidden="true" />
          </Link>
          <Link
            href="/settings/security"
            className="flex items-center gap-3 rounded-2xl border bg-surface-container-low p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ShieldCheck className="size-5 shrink-0" aria-hidden="true" />
            <span className="flex-1">
              <span className="block font-medium">{t.settings.securityLink}</span>
              <span className="block text-muted-foreground">{t.settings.securityLinkDescription}</span>
            </span>
            <ChevronLeft className="size-5 ltr:rotate-180" aria-hidden="true" />
          </Link>
        </CardContent>
      </Card>

      <DeviceSettingsCard />

      <Card>
        <CardHeader>
          <CardTitle>{t.settings.data}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <Link
            href="/settings/data"
            className="flex items-center gap-3 rounded-2xl border bg-surface-container-low p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArchiveRestore className="size-5 shrink-0" aria-hidden="true" />
            <span className="flex-1">
              <span className="block font-medium">{t.settings.backup}</span>
              <span className="block text-muted-foreground">{t.settings.backupDescription}</span>
            </span>
            <ChevronLeft className="size-5 ltr:rotate-180" aria-hidden="true" />
          </Link>
          <p>
            {t.settings.storageUsage}:{" "}
            <span className="font-medium">
              {storage.data
                ? `${formatBytes(storage.data.usage, locale)} / ${formatBytes(storage.data.quota, locale)}`
                : t.settings.storageUnknown}
            </span>
          </p>
          <div>
            <Button variant="destructive" onClick={() => setConfirmClear(true)}>
              <Trash2 aria-hidden="true" />
              {t.settings.clearData}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.settings.about}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t.settings.version}</dt>
            <dd dir="ltr" className="text-start">{clientEnv.NEXT_PUBLIC_APP_VERSION}</dd>
            <dt className="text-muted-foreground">{t.settings.build}</dt>
            <dd dir="ltr" className="text-start font-mono text-xs">{clientEnv.NEXT_PUBLIC_BUILD_ID}</dd>
          </dl>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t.settings.clearDataTitle}
        description={t.settings.clearDataDescription}
        confirmLabel={t.common.delete}
        onConfirm={handleClear}
        pending={clearAll.isPending}
      />
    </div>
  );
}
