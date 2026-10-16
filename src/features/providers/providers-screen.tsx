"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck, KeyRound, Pencil, Plug, Plus, QrCode, RefreshCw, ScanLine, Server, Trash2, Waypoints } from "lucide-react";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/feedback/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import { userFacingError } from "@/features/chat/engine/chat-service";
import { useI18n } from "@/hooks/use-i18n";
import { PROVIDER_PRESETS } from "@/lib/ai/presets";
import { getErrorMessage } from "@/lib/i18n/error-message";
import type { Provider } from "@/lib/models";
import { StorageError } from "@/lib/storage/errors";
import { ModelList } from "./model-list";
import { ProviderFormDialog } from "./provider-form-dialog";
import { QrScanDialog } from "./qr-scan-dialog";
import { QrShareDialog } from "./qr-share-dialog";
import { useDeleteProvider, useFetchModels, useProviders, useTestProvider, useToggleProvider } from "./queries";

function ProviderCard({ provider, onEdit, onDelete, onShare }: { provider: Provider; onEdit: () => void; onDelete: () => void; onShare: () => void }) {
  const { t } = useI18n();
  const test = useTestProvider();
  const fetchModels = useFetchModels();
  const toggle = useToggleProvider();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const describe = (error: unknown) => {
    if (error instanceof StorageError) return getErrorMessage(error, t);
    const failure = userFacingError(error);
    const hint = failure.code === "network" ? ` ${t.providers.networkHint}` : "";
    return `${t.chatErrors[failure.code] ?? t.errors.generic}: ${failure.message}${hint}`;
  };

  const runTest = () =>
    test.mutate(provider.id, {
      onSuccess: (result) => setStatus({ ok: true, text: t.providers.testOk(result.latencyMs, result.modelCount) }),
      onError: (error) => setStatus({ ok: false, text: describe(error) }),
    });

  const runFetch = () =>
    fetchModels.mutate(provider.id, {
      onSuccess: (next) => {
        setStatus({ ok: true, text: t.providers.fetched(next.models.length) });
        toast({ title: t.providers.fetched(next.models.length), variant: "success" });
      },
      onError: (error) => setStatus({ ok: false, text: describe(error) }),
    });

  return (
    <Card data-testid="provider-card">
      <CardHeader className="flex-row flex-wrap items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground" aria-hidden="true">
          <Server className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <CardTitle className="truncate" dir="auto">
            {provider.name}
          </CardTitle>
          <p className="truncate font-mono text-xs text-muted-foreground" dir="ltr">
            {provider.baseUrl}
          </p>
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline">{PROVIDER_PRESETS[provider.kind].label}</Badge>
            {provider.encryptedApiKey ? (
              <Badge variant="tonal">
                <KeyRound className="size-3" aria-hidden="true" />
                {t.providers.keyEncrypted}
              </Badge>
            ) : PROVIDER_PRESETS[provider.kind].requiresApiKey ? (
              <Badge variant="warning">{t.providers.keyMissing}</Badge>
            ) : null}
            {provider.transport === "proxy" ? (
              <Badge variant="tonal">
                <Waypoints className="size-3" aria-hidden="true" />
                {t.providers.viaProxy}
              </Badge>
            ) : null}
          </div>
        </div>
        <Switch
          checked={provider.enabled}
          aria-label={t.providers.enableProvider(provider.name)}
          onCheckedChange={(enabled) => toggle.mutate({ id: provider.id, enabled }, { onError: (e) => toast({ title: getErrorMessage(e, t), variant: "destructive" }) })}
        />
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t.providers.actionsFor(provider.name)}>
          <Button variant="tonal" size="sm" onClick={runTest} disabled={test.isPending} aria-busy={test.isPending}>
            <Plug aria-hidden="true" />
            {test.isPending ? t.providers.testing : t.providers.test}
          </Button>
          <Button variant="tonal" size="sm" onClick={runFetch} disabled={fetchModels.isPending} aria-busy={fetchModels.isPending}>
            <RefreshCw className={fetchModels.isPending ? "animate-spin" : undefined} aria-hidden="true" />
            {t.providers.fetchModels}
          </Button>
          <Button variant="ghost" size="sm" onClick={onShare}>
            <QrCode aria-hidden="true" />
            {t.providers.shareQr}
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil aria-hidden="true" />
            {t.common.edit}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 aria-hidden="true" />
            {t.common.delete}
          </Button>
        </div>
        {status ? (
          <p role="status" className={status.ok ? "flex items-start gap-1.5 text-sm text-success" : "text-sm text-destructive"} dir="auto">
            {status.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : null}
            {status.text}
          </p>
        ) : null}
        <details className="group rounded-2xl border">
          <summary className="cursor-pointer list-none rounded-2xl px-4 py-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t.providers.models} ({provider.models.filter((m) => m.enabled).length}/{provider.models.length})
          </summary>
          <div className="border-t p-3">
            <ModelList provider={provider} />
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

export function ProvidersScreen() {
  const { t } = useI18n();
  const providers = useProviders();
  const remove = useDeleteProvider();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null);
  const [shareTarget, setShareTarget] = useState<Provider | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  let content: React.ReactNode;
  if (providers.isPending) content = <LoadingState label={t.common.loading} rows={2} />;
  else if (providers.isError)
    content = (
      <ErrorState title={t.providers.loadError} description={getErrorMessage(providers.error, t)} retryLabel={t.common.retry} onRetry={() => void providers.refetch()} />
    );
  else if (providers.data.length === 0)
    content = (
      <EmptyState
        icon={Server}
        title={t.providers.emptyTitle}
        description={t.providers.emptyDescription}
        action={
          <Button onClick={openCreate}>
            <Plus aria-hidden="true" />
            {t.providers.add}
          </Button>
        }
      />
    );
  else
    content = (
      <ul className="grid gap-4" aria-label={t.providers.listLabel}>
        {providers.data.map((provider) => (
          <li key={provider.id}>
            <ProviderCard
              provider={provider}
              onEdit={() => {
                setEditing(provider);
                setFormOpen(true);
              }}
              onDelete={() => setDeleteTarget(provider)}
              onShare={() => setShareTarget(provider)}
            />
          </li>
        ))}
      </ul>
    );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <Link href="/settings" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight className="size-4 ltr:rotate-180" aria-hidden="true" />
        {t.settings.title}
      </Link>
      <PageHeader
        title={t.providers.title}
        description={t.providers.description}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="tonal" onClick={() => setScanOpen(true)}>
              <ScanLine aria-hidden="true" />
              {t.providers.scanQr}
            </Button>
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" />
              {t.providers.add}
            </Button>
          </div>
        }
      />
      {content}
      {shareTarget ? (
        <QrShareDialog key={shareTarget.id} provider={shareTarget} open onOpenChange={(open) => !open && setShareTarget(null)} />
      ) : null}
      <QrScanDialog open={scanOpen} onOpenChange={setScanOpen} />
      <ProviderFormDialog open={formOpen} onOpenChange={setFormOpen} provider={editing} />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t.providers.deleteTitle}
        description={t.providers.deleteDescription}
        confirmLabel={t.common.delete}
        pending={remove.isPending}
        onConfirm={() =>
          deleteTarget &&
          remove.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast({ title: t.providers.deleted });
              setDeleteTarget(null);
            },
            onError: (error) => toast({ title: getErrorMessage(error, t), variant: "destructive" }),
          })
        }
      />
    </div>
  );
}
