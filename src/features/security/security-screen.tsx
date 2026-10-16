"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, CircleAlert, KeyRound, ScrollText, ShieldCheck, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/feedback/page-header";
import { useRepositories } from "@/components/providers/repository-provider";
import { useServices } from "@/components/providers/services-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import { useSettings } from "@/features/settings/queries";
import { useI18n } from "@/hooks/use-i18n";
import { audit } from "@/lib/audit";
import { formatRelativeTime } from "@/lib/format";
import { effectivePermission } from "@/lib/tools/registry";

interface StoredKey {
  id: string;
  label: string;
  updatedAt: number;
  kind: "provider" | "secret";
}

function useStoredKeys() {
  const repos = useRepositories();
  const { t } = useI18n();
  return useQuery({
    queryKey: ["stored-keys"],
    queryFn: async (): Promise<StoredKey[]> => {
      const [secrets, providers, servers] = await Promise.all([repos().secrets.list(), repos().providers.list(), repos().mcpServers.list()]);
      const serverName = new Map(servers.map((s) => [s.id.toLowerCase(), s.name]));
      const keys: StoredKey[] = providers
        .filter((p) => p.encryptedApiKey || p.encryptedHeaders)
        .map((p) => ({ id: `provider:${p.id}`, label: t.security.providerKey(p.name), updatedAt: p.updatedAt, kind: "provider" as const }));
      for (const secret of secrets) {
        const [prefix, rest = ""] = secret.id.split(/:(.*)/s);
        const label =
          prefix === "service"
            ? t.security.serviceKey(rest)
            : prefix === "mcp"
              ? t.security.mcpToken(serverName.get(rest) ?? rest)
              : prefix === "mcp-oauth"
                ? t.security.mcpOauth(serverName.get(rest) ?? rest)
                : secret.id === "webdav:password"
                  ? t.security.webdavPassword
                  : secret.id === "webdav:passphrase"
                    ? t.security.backupPassphrase
                    : secret.id;
        keys.push({ id: secret.id, label, updatedAt: secret.updatedAt, kind: "secret" });
      }
      return keys;
    },
  });
}

function Checklist() {
  const { t } = useI18n();
  const settings = useSettings();
  const [env, setEnv] = useState<{ secure: boolean; persisted: boolean | null; crypto: boolean }>({ secure: true, persisted: null, crypto: true });
  useEffect(() => {
    setEnv({ secure: window.isSecureContext, persisted: null, crypto: Boolean(globalThis.crypto?.subtle) });
    void navigator.storage?.persisted?.().then((persisted) => setEnv((e) => ({ ...e, persisted })));
  }, []);
  const backup = settings.data?.backup;
  const items: { ok: boolean | null; label: string; hint?: string; action?: React.ReactNode }[] = [
    { ok: env.secure, label: t.security.checks.secure },
    { ok: env.crypto, label: t.security.checks.crypto },
    {
      ok: env.persisted,
      label: t.security.checks.persisted,
      hint: t.security.checks.persistedHint,
      action:
        env.persisted === false ? (
          <Button size="sm" variant="tonal" onClick={() => void navigator.storage?.persist?.().then((persisted) => setEnv((e) => ({ ...e, persisted })))}>
            {t.security.checks.request}
          </Button>
        ) : null,
    },
    { ok: backup ? !backup.schedule.enabled || backup.schedule.encrypt : null, label: t.security.checks.backupEncrypted },
    { ok: backup ? !backup.sync.enabled || backup.sync.encrypt : null, label: t.security.checks.syncEncrypted },
    { ok: true, label: t.security.checks.dangerousAsk },
    { ok: true, label: t.security.checks.keysEncrypted },
  ];
  return (
    <ul className="grid gap-2" aria-label={t.security.checklistTitle}>
      {items.map((item) => (
        <li key={item.label} className="flex flex-wrap items-center gap-2 text-sm">
          {item.ok === null ? (
            <CircleAlert className="size-4 text-muted-foreground" aria-hidden="true" />
          ) : item.ok ? (
            <CheckCircle2 className="size-4 text-primary" aria-label={t.security.ok} />
          ) : (
            <CircleAlert className="size-4 text-destructive" aria-label={t.security.notOk} />
          )}
          <span className="flex-1">
            {item.label}
            {item.hint && item.ok === false ? <span className="block text-xs text-muted-foreground">{item.hint}</span> : null}
          </span>
          {item.action}
        </li>
      ))}
    </ul>
  );
}

export function SecurityScreen() {
  const { t, locale } = useI18n();
  const repos = useRepositories();
  const services = useServices();
  const queryClient = useQueryClient();
  const keys = useStoredKeys();
  const settings = useSettings();
  const log = useQuery({ queryKey: ["audit-log"], queryFn: () => repos().audit.list(200) });
  const [removing, setRemoving] = useState<StoredKey | null>(null);
  const [clearing, setClearing] = useState(false);
  const tools = services().tools.list();
  const permissions = settings.data?.tools.permissions ?? {};

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6 p-4 sm:p-6">
      <PageHeader title={t.security.title} description={t.security.description} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" aria-hidden="true" />
            {t.security.checklistTitle}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Checklist />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5" aria-hidden="true" />
            {t.security.keysTitle}
          </CardTitle>
          <CardDescription>{t.security.keysDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {keys.isPending ? <LoadingState label={t.common.loading} rows={2} /> : null}
          {keys.isError ? <ErrorState title={t.errors.generic} retryLabel={t.common.retry} onRetry={() => void keys.refetch()} /> : null}
          {keys.data?.length === 0 ? <EmptyState compact title={t.security.noKeys} /> : null}
          {keys.data?.length ? (
            <ul className="grid gap-2">
              {keys.data.map((key) => (
                <li key={key.id} className="flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate" dir="auto">{key.label}</span>
                    <span className="block text-xs text-muted-foreground">{formatRelativeTime(key.updatedAt, locale)}</span>
                  </span>
                  {key.kind === "provider" ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link href="/providers">{t.security.manage}</Link>
                    </Button>
                  ) : (
                    <Button size="icon-sm" variant="ghost" aria-label={t.security.removeKey(key.label)} onClick={() => setRemoving(key)}>
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.security.permissionsTitle}</CardTitle>
          <CardDescription>{t.security.permissionsDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <ul className="grid gap-1 text-sm">
            {tools.map((tool) => {
              const permission = effectivePermission(tool, permissions);
              return (
                <li key={tool.name} className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs" dir="ltr">
                    {tool.name}
                  </span>
                  <Badge variant={permission === "auto" ? "tonal" : permission === "ask" ? "outline" : "warning"}>{t.tools.permissions[permission]}</Badge>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-3">
            <Link href="/settings/tools" className="inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline">
              {t.security.editPermissions}
              <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
            </Link>
            <Link href="/settings/mcp" className="inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline">
              {t.tools.manageMcp}
              <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
            </Link>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="size-5" aria-hidden="true" />
            {t.security.auditTitle}
          </CardTitle>
          <CardDescription>{t.security.auditDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {log.isPending ? <LoadingState label={t.common.loading} rows={2} /> : null}
          {log.isError ? <ErrorState title={t.errors.generic} retryLabel={t.common.retry} onRetry={() => void log.refetch()} /> : null}
          {log.data?.length === 0 ? <EmptyState compact title={t.security.auditEmpty} /> : null}
          {log.data?.length ? (
            <ol className="grid max-h-96 gap-1 overflow-y-auto text-sm" aria-label={t.security.auditTitle}>
              {log.data.map((entry) => (
                <li key={entry.id} className="flex flex-wrap gap-x-2 border-b py-1 last:border-0">
                  <span className="font-medium">{t.security.auditKinds[entry.kind]}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground" dir="auto" title={entry.detail}>
                    {entry.detail}
                  </span>
                  <time className="text-xs text-muted-foreground" dateTime={new Date(entry.at).toISOString()}>
                    {new Date(entry.at).toLocaleString(locale)}
                  </time>
                </li>
              ))}
            </ol>
          ) : null}
          {log.data?.length ? (
            <Button variant="ghost" className="justify-self-start" onClick={() => setClearing(true)}>
              <Trash2 className="size-4" aria-hidden="true" />
              {t.security.auditClear}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.security.dataTitle}</CardTitle>
          <CardDescription>{t.security.dataDescription}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild variant="tonal">
            <Link href="/settings/data">{t.security.exportAll}</Link>
          </Button>
          <Button asChild variant="tonal">
            <Link href="/settings/backup">{t.settings.backupLink}</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/privacy">{t.security.privacyPolicy}</Link>
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={t.security.removeKey(removing?.label ?? "")}
        description={t.security.removeKeyDescription}
        confirmLabel={t.common.delete}
        onConfirm={() => {
          if (!removing) return;
          void repos()
            .secrets.delete(removing.id)
            .then(() => {
              audit("key_removed", removing.label);
              setRemoving(null);
              toast({ title: t.security.keyRemoved, variant: "success" });
              void queryClient.invalidateQueries({ queryKey: ["stored-keys"] });
              void queryClient.invalidateQueries({ queryKey: ["audit-log"] });
            });
        }}
      />
      <ConfirmDialog
        open={clearing}
        onOpenChange={setClearing}
        title={t.security.auditClear}
        description={t.security.auditClearDescription}
        confirmLabel={t.common.delete}
        onConfirm={() => void repos().audit.clear().then(() => (setClearing(false), queryClient.invalidateQueries({ queryKey: ["audit-log"] })))}
      />
    </div>
  );
}
