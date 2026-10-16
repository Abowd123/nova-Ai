"use client";

import { useEffect, useId, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, LogIn, LogOut, Pencil, Plug, Plus, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/feedback/page-header";
import { useServices } from "@/components/providers/services-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { getErrorMessage } from "@/lib/i18n/error-message";
import { mcpSlugSchema, type McpAuth, type McpServer, type McpToolInfo, type McpTransport } from "@/lib/models";
import { openExternal } from "@/lib/platform";
import { useMcpStatus } from "./mcp-status";
import { useDeleteMcpServer, useMcpServers, useSaveMcpServer } from "./mcp-queries";

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "server";

function parseHeaders(text: string): Record<string, string> | null {
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const index = line.indexOf(":");
    if (index <= 0) return null;
    const name = line.slice(0, index).trim();
    if (!/^[A-Za-z0-9-]{1,100}$/.test(name) || /^authorization$/i.test(name)) return null;
    headers[name] = line.slice(index + 1).trim();
  }
  return headers;
}

interface FormState {
  name: string;
  slug: string;
  url: string;
  transport: McpTransport;
  auth: McpAuth;
  headers: string;
  token: string;
  viaProxy: boolean;
}

function ServerDialog({ open, onOpenChange, server }: { open: boolean; onOpenChange: (open: boolean) => void; server: McpServer | null }) {
  const { t } = useI18n();
  const services = useServices();
  const save = useSaveMcpServer();
  const ids = { name: useId(), slug: useId(), url: useId(), headers: useId(), token: useId() };
  const empty: FormState = { name: "", slug: "", url: "", transport: "streamable-http", auth: "none", headers: "", token: "", viaProxy: false };
  const [form, setForm] = useState<FormState>(empty);
  const [slugTouched, setSlugTouched] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setTestResult(null);
    setSlugTouched(Boolean(server));
    setForm(
      server
        ? { name: server.name, slug: server.slug, url: server.url, transport: server.transport, auth: server.auth, headers: Object.entries(server.headers).map(([k, v]) => `${k}: ${v}`).join("\n"), token: "", viaProxy: server.viaProxy }
        : empty,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, server]);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const headers = parseHeaders(form.headers);
  let urlValid = false;
  try {
    urlValid = ["https:", "http:"].includes(new URL(form.url).protocol);
  } catch {
    urlValid = false;
  }
  const slugValid = mcpSlugSchema.safeParse(form.slug).success;
  const valid = form.name.trim() && slugValid && urlValid && headers !== null;

  const test = async () => {
    if (!valid || !headers) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await services().mcp.test({ url: form.url, transport: form.transport, headers, viaProxy: form.viaProxy, bearer: form.auth === "bearer" ? form.token || undefined : undefined });
      setTestResult({ ok: true, text: t.mcp.testOk(result.name, result.version, result.tools.length) });
    } catch (error) {
      setTestResult({ ok: false, text: error instanceof Error ? error.message : t.errors.generic });
    } finally {
      setTesting(false);
    }
  };

  const submit = () => {
    if (!valid || !headers) return;
    const input = { name: form.name.trim(), slug: form.slug, url: form.url.trim(), transport: form.transport, auth: form.auth, headers, viaProxy: form.viaProxy };
    const secret = form.auth === "bearer" && form.token ? form.token : undefined;
    save.mutate(
      server ? { id: server.id, input, secret } : { input, secret },
      {
        onSuccess: () => {
          toast({ title: t.settings.saved, variant: "success" });
          onOpenChange(false);
        },
        onError: (e) => toast({ title: e instanceof Error && /already exists/.test(e.message) ? t.mcp.slugTaken : getErrorMessage(e, t), variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t.common.close} className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{server ? t.mcp.editServer : t.mcp.addServer}</DialogTitle>
          <DialogDescription>{t.mcp.formDescription}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={ids.name}>{t.mcp.name}</Label>
            <Input id={ids.name} value={form.name} maxLength={100} required onChange={(e) => set({ name: e.target.value, ...(slugTouched ? {} : { slug: slugify(e.target.value) }) })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={ids.slug}>{t.mcp.slug}</Label>
            <Input id={ids.slug} dir="ltr" value={form.slug} maxLength={32} aria-invalid={!slugValid} onChange={(e) => { setSlugTouched(true); set({ slug: e.target.value.toLowerCase() }); }} />
            <p className="text-xs text-muted-foreground">{t.mcp.slugHint(form.slug || "server")}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={ids.url}>{t.mcp.url}</Label>
            <Input id={ids.url} dir="ltr" type="url" required value={form.url} placeholder="https://example.com/mcp" aria-invalid={Boolean(form.url) && !urlValid} onChange={(e) => set({ url: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium">{t.mcp.transport}</span>
            <SegmentedControl
              label={t.mcp.transport}
              value={form.transport}
              onValueChange={(transport) => set({ transport })}
              options={[
                { value: "streamable-http", label: t.mcp.transports.streamable },
                { value: "sse", label: t.mcp.transports.sse },
              ]}
            />
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium">{t.mcp.auth}</span>
            <SegmentedControl
              label={t.mcp.auth}
              value={form.auth}
              onValueChange={(auth) => set({ auth })}
              options={[
                { value: "none", label: t.mcp.auths.none },
                { value: "bearer", label: t.mcp.auths.bearer },
                { value: "oauth", label: t.mcp.auths.oauth },
              ]}
            />
            {form.auth === "oauth" ? <p className="text-xs text-muted-foreground">{t.mcp.oauthHint}</p> : null}
          </div>
          {form.auth === "bearer" ? (
            <div className="grid gap-2">
              <Label htmlFor={ids.token}>{t.mcp.token}</Label>
              <Input id={ids.token} type="password" dir="ltr" autoComplete="off" value={form.token} placeholder={server ? "••••••••" : ""} onChange={(e) => set({ token: e.target.value })} />
              <p className="text-xs text-muted-foreground">{t.mcp.tokenHint}</p>
            </div>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor={ids.headers}>{t.mcp.headers}</Label>
            <Textarea id={ids.headers} dir="ltr" rows={3} value={form.headers} placeholder="X-Api-Version: 2" aria-invalid={headers === null} onChange={(e) => set({ headers: e.target.value })} />
            <p className="text-xs text-muted-foreground">{headers === null ? t.mcp.headersInvalid : t.mcp.headersHint}</p>
          </div>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">
              {t.mcp.viaProxy}
              <span className="block text-xs text-muted-foreground">{t.mcp.viaProxyHint}</span>
            </span>
            <Switch checked={form.viaProxy} onCheckedChange={(viaProxy) => set({ viaProxy })} aria-label={t.mcp.viaProxy} />
          </label>
          {testResult ? (
            <p role="status" className={testResult.ok ? "text-sm text-primary" : "text-sm text-destructive"} dir="auto">
              {testResult.text}
            </p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="tonal" disabled={!valid || testing || form.auth === "oauth"} onClick={() => void test()}>
              {testing ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              {t.mcp.test}
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              {t.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ToolToggles({ server }: { server: McpServer }) {
  const { t } = useI18n();
  const save = useSaveMcpServer();
  if (!server.tools.length) return <p className="text-xs text-muted-foreground">{t.mcp.noToolsYet}</p>;
  const toggle = (tool: McpToolInfo, enabled: boolean) => {
    const disabledTools = enabled ? server.disabledTools.filter((n) => n !== tool.name) : [...server.disabledTools, tool.name];
    save.mutate({ id: server.id, input: { disabledTools } }, { onError: (e) => toast({ title: getErrorMessage(e, t), variant: "destructive" }) });
  };
  return (
    <ul className="grid gap-1.5" aria-label={t.mcp.toolsOf(server.name)}>
      {server.tools.map((tool) => {
        const enabled = !server.disabledTools.includes(tool.name);
        return (
          <li key={tool.name} className="flex items-start justify-between gap-3 rounded-xl px-2 py-1.5 hover:bg-accent/40">
            <div className="min-w-0">
              <p className="flex items-center gap-1 font-mono text-xs" dir="ltr">
                {tool.destructive ? <ShieldAlert className="size-3.5 text-destructive" aria-label={t.tools.dangerous} /> : null}
                {tool.name}
                {tool.readOnly ? <Badge variant="outline" className="ms-1">{t.mcp.readOnly}</Badge> : null}
              </p>
              {tool.description ? <p className="line-clamp-2 text-xs text-muted-foreground" dir="auto">{tool.description}</p> : null}
            </div>
            <Switch checked={enabled} onCheckedChange={(v) => toggle(tool, v)} aria-label={t.mcp.toggleTool(tool.name)} />
          </li>
        );
      })}
    </ul>
  );
}

function ServerCard({ server, onEdit, onDelete }: { server: McpServer; onEdit: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  const services = useServices();
  const status = useMcpStatus(server.id);
  const save = useSaveMcpServer();
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    if (server.auth === "oauth") void services().mcp.hasOAuthTokens(server.id).then(setSignedIn).catch(() => setSignedIn(false));
  }, [services, server.auth, server.id, status.state]);

  const reconnect = async () => {
    setBusy(true);
    try {
      await services().mcp.connect(server.id);
      toast({ title: t.mcp.connected, variant: "success" });
    } catch (e) {
      toast({ title: t.mcp.connectFailed, description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  const signIn = async () => {
    setBusy(true);
    try {
      await openExternal(await services().mcp.startAuthorization(server.id));
    } catch (e) {
      toast({ title: t.mcp.signInFailed, description: e instanceof Error ? e.message : undefined, variant: "destructive" });
      setBusy(false);
    }
  };
  const stateLabel = server.enabled ? t.mcp.states[status.state] : t.mcp.disabled;
  const errorText = status.error ?? server.lastError;

  return (
    <Card data-testid="mcp-server">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Plug className="size-5 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-lg">{server.name}</CardTitle>
          <Badge variant={status.state === "connected" ? "tonal" : status.state === "error" || status.state === "needs_auth" ? "warning" : "outline"}>
            {status.state === "connecting" ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {stateLabel}
          </Badge>
          <span className="ms-auto flex items-center gap-1">
            <Switch
              checked={server.enabled}
              aria-label={t.mcp.enable(server.name)}
              onCheckedChange={(enabled) => save.mutate({ id: server.id, input: { enabled } })}
            />
            <Button variant="ghost" size="icon-sm" aria-label={t.common.edit} onClick={onEdit}>
              <Pencil className="size-4" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={t.common.delete} onClick={onDelete}>
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </span>
        </div>
        <CardDescription dir="ltr" className="truncate">
          {server.url}
          {server.serverInfo ? ` · ${server.serverInfo.name} ${server.serverInfo.version}` : ""}
        </CardDescription>
        {errorText && status.state !== "connected" ? (
          <p className="text-xs text-destructive" dir="auto" role="alert">
            {errorText}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          {server.enabled ? (
            <Button size="sm" variant="tonal" disabled={busy} onClick={() => void reconnect()}>
              <RefreshCw className="size-4" aria-hidden="true" />
              {t.mcp.reconnect}
            </Button>
          ) : null}
          {server.auth === "oauth" ? (
            signedIn ? (
              <Button size="sm" variant="ghost" onClick={() => void services().mcp.signOut(server.id).then(() => setSignedIn(false))}>
                <LogOut className="size-4" aria-hidden="true" />
                {t.mcp.signOut}
              </Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => void signIn()}>
                <LogIn className="size-4" aria-hidden="true" />
                {t.mcp.signIn}
              </Button>
            )
          ) : null}
        </div>
        <ToolToggles server={server} />
      </CardContent>
    </Card>
  );
}

export function McpServersScreen() {
  const { t } = useI18n();
  const servers = useMcpServers();
  const remove = useDeleteMcpServer();
  const params = useSearchParams();
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<McpServer | null>(null);

  useEffect(() => {
    if (params.get("connected")) toast({ title: t.mcp.signedIn, variant: "success" });
    if (params.get("error")) toast({ title: t.mcp.signInFailed, variant: "destructive" });
  }, [params, t]);

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6 p-4 sm:p-6">
      <PageHeader
        title={t.mcp.title}
        description={t.mcp.description}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t.mcp.addServer}
          </Button>
        }
      />
      <p className="flex items-start gap-2 rounded-2xl bg-secondary/60 px-3 py-2 text-sm">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {t.mcp.securityNotice}
      </p>
      {servers.isPending ? <LoadingState label={t.common.loading} rows={2} /> : null}
      {servers.isError ? <ErrorState title={t.mcp.loadError} description={getErrorMessage(servers.error, t)} retryLabel={t.common.retry} onRetry={() => void servers.refetch()} /> : null}
      {servers.data && servers.data.length === 0 ? (
        <EmptyState
          icon={Plug}
          title={t.mcp.emptyTitle}
          description={t.mcp.emptyDescription}
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {t.mcp.addServer}
            </Button>
          }
        />
      ) : null}
      <div className="grid gap-4">
        {servers.data?.map((server) => (
          <ServerCard
            key={server.id}
            server={server}
            onEdit={() => {
              setEditing(server);
              setOpen(true);
            }}
            onDelete={() => setDeleting(server)}
          />
        ))}
      </div>
      <ServerDialog open={open} onOpenChange={setOpen} server={editing} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={t.mcp.deleteTitle(deleting?.name ?? "")}
        description={t.mcp.deleteDescription}
        confirmLabel={t.common.delete}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null), onError: (e) => toast({ title: getErrorMessage(e, t), variant: "destructive" }) })}
      />
    </div>
  );
}
