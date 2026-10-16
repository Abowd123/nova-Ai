"use client";

import { useEffect, useState } from "react";
import { Bell, Bug, Copy, Smartphone, Trash2, Vibrate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import { clientEnv } from "@/env";
import { useI18n } from "@/hooks/use-i18n";
import { copyText } from "@/lib/clipboard";
import { clearReports, readReports, type CrashReport } from "@/lib/crash/reporter";
import { getBridge } from "@/lib/native";
import type { DeviceSettings } from "@/lib/models";
import { useSettings, useUpdateSettings } from "./queries";

/** Settings → App & device: haptics, reply notifications, opt-in crash reports. */
export function DeviceSettingsCard() {
  const { t, locale } = useI18n();
  const settings = useSettings();
  const update = useUpdateSettings();
  const [reports, setReports] = useState<CrashReport[]>([]);
  const bridge = getBridge();
  useEffect(() => setReports(readReports(window.localStorage)), []);
  if (!settings.data) return null;
  const device = settings.data.device;
  const save = (patch: Partial<DeviceSettings>) => update.mutate({ device: { ...device, ...patch } }, { onError: () => toast({ title: t.errors.generic, variant: "destructive" }) });

  const toggleNotify = async (value: boolean) => {
    if (value && !(await bridge.requestNotifications().catch(() => false))) {
      toast({ title: t.native.notificationsDenied, variant: "destructive" });
      return;
    }
    save({ notifyOnReply: value });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="size-5" aria-hidden="true" />
          {t.native.title}
        </CardTitle>
        <CardDescription>{bridge.isNative ? t.native.descriptionApp : t.native.descriptionWeb}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <label className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm">
            <Vibrate className="size-4 text-muted-foreground" aria-hidden="true" />
            {t.native.haptics}
          </span>
          <Switch checked={device.haptics} onCheckedChange={(haptics) => save({ haptics })} aria-label={t.native.haptics} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm">
            <Bell className="size-4 text-muted-foreground" aria-hidden="true" />
            <span>
              {t.native.notifyOnReply}
              <span className="block text-xs text-muted-foreground">{t.native.notifyOnReplyHint}</span>
            </span>
          </span>
          <Switch checked={device.notifyOnReply} onCheckedChange={(v) => void toggleNotify(v)} aria-label={t.native.notifyOnReply} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm">
            <Bug className="size-4 text-muted-foreground" aria-hidden="true" />
            <span>
              {t.native.crashReports}
              <span className="block text-xs text-muted-foreground">{clientEnv.NEXT_PUBLIC_CRASH_ENDPOINT ? t.native.crashReportsHint : t.native.crashReportsLocalOnly}</span>
            </span>
          </span>
          <Switch checked={device.crashReports} disabled={!clientEnv.NEXT_PUBLIC_CRASH_ENDPOINT} onCheckedChange={(crashReports) => save({ crashReports })} aria-label={t.native.crashReports} />
        </label>
        <div className="grid gap-2">
          <p className="text-sm font-medium">{t.native.recentCrashes(reports.length)}</p>
          {reports.length === 0 ? <p className="text-xs text-muted-foreground">{t.native.noCrashes}</p> : null}
          {reports.length ? (
            <ul className="grid max-h-48 gap-1 overflow-y-auto text-xs">
              {reports.map((r) => (
                <li key={r.id} className="truncate" dir="ltr" title={r.message}>
                  {new Date(r.at).toLocaleString(locale)} · {r.message}
                </li>
              ))}
            </ul>
          ) : null}
          {reports.length ? (
            <div className="flex gap-2">
              <Button size="sm" variant="tonal" onClick={() => void copyText(JSON.stringify(reports, null, 2)).then((ok) => ok && toast({ title: t.markdown.copied, variant: "success" }))}>
                <Copy className="size-4" aria-hidden="true" />
                {t.native.copyReports}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  clearReports(window.localStorage);
                  setReports([]);
                }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {t.native.clearReports}
              </Button>
            </div>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground" dir="ltr">
          Nova {clientEnv.NEXT_PUBLIC_APP_VERSION} · {bridge.platform}
        </p>
      </CardContent>
    </Card>
  );
}
