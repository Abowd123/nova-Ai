"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Eye, EyeOff, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { isAllowedCustomHeader } from "@/lib/ai/adapters/shared";
import { PROVIDER_KINDS, PROVIDER_PRESETS } from "@/lib/ai/presets";
import { getErrorMessage } from "@/lib/i18n/error-message";
import type { Provider, ProviderKind, ProviderTransport } from "@/lib/models";
import { useProviderHeaderNames, useSaveProvider } from "./queries";
import type { HeaderDraft } from "./provider-service";

interface HeaderRow extends HeaderDraft {
  key: number;
  stored: boolean;
}

const urlSchema = z.string().trim().url();

export function ProviderFormDialog({
  open,
  onOpenChange,
  provider,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: Provider | null;
}) {
  const { t } = useI18n();
  const ids = { kind: useId(), name: useId(), url: useId(), key: useId(), transport: useId() };
  const save = useSaveProvider();
  const headerNames = useProviderHeaderNames(open && provider ? provider.id : null);

  const [kind, setKind] = useState<ProviderKind>("openai");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [transport, setTransport] = useState<ProviderTransport>("direct");
  const [apiKey, setApiKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const [errors, setErrors] = useState<{ name?: string; url?: string; headers?: string }>({});

  useEffect(() => {
    if (!open) return;
    const preset = PROVIDER_PRESETS[provider?.kind ?? "openai"];
    setKind(provider?.kind ?? "openai");
    setName(provider?.name ?? preset.label);
    setBaseUrl(provider?.baseUrl ?? preset.baseUrl);
    setTransport(provider?.transport ?? preset.defaultTransport);
    setApiKey("");
    setRemoveKey(false);
    setShowKey(false);
    setHeaders([]);
    setErrors({});
  }, [open, provider]);

  useEffect(() => {
    if (open && provider && headerNames.data) {
      setHeaders(headerNames.data.map((headerName, index) => ({ key: index, name: headerName, value: null, stored: true })));
    }
  }, [open, provider, headerNames.data]);

  const changeKind = (next: ProviderKind) => {
    const previous = PROVIDER_PRESETS[kind];
    const preset = PROVIDER_PRESETS[next];
    setKind(next);
    if (!name.trim() || name === previous.label) setName(preset.label);
    if (!baseUrl.trim() || baseUrl === previous.baseUrl) setBaseUrl(preset.baseUrl);
  };

  const preset = PROVIDER_PRESETS[kind];
  const hasStoredKey = Boolean(provider?.encryptedApiKey);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    if (!name.trim()) nextErrors.name = t.providers.nameRequired;
    if (!urlSchema.safeParse(baseUrl).success) nextErrors.url = t.providers.invalidUrl;
    const badHeader = headers.find((h) => h.name.trim() && !isAllowedCustomHeader(h.name));
    if (badHeader) nextErrors.headers = t.providers.invalidHeader(badHeader.name);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    try {
      await save.mutateAsync({
        id: provider?.id,
        draft: {
          kind,
          name,
          baseUrl,
          transport,
          apiKey: removeKey ? null : apiKey.trim() ? apiKey.trim() : provider ? undefined : null,
          headers: headers.map(({ name: headerName, value }) => ({ name: headerName, value })),
        },
      });
      setApiKey("");
      toast({ title: t.providers.saved, variant: "success" });
      onOpenChange(false);
    } catch (error) {
      toast({ title: getErrorMessage(error, t), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t.common.close} className="max-w-xl">
        <form onSubmit={handleSubmit} className="grid gap-4" noValidate autoComplete="off">
          <DialogHeader>
            <DialogTitle>{provider ? t.providers.editTitle : t.providers.addTitle}</DialogTitle>
            <DialogDescription>{t.providers.formDescription}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor={ids.kind}>{t.providers.kind}</Label>
            <select
              id={ids.kind}
              value={kind}
              disabled={Boolean(provider)}
              onChange={(e) => changeKind(e.target.value as ProviderKind)}
              className="h-11 rounded-2xl border border-input bg-surface-container px-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
            >
              {PROVIDER_KINDS.map((value) => (
                <option key={value} value={value}>
                  {PROVIDER_PRESETS[value].label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={ids.name}>{t.providers.name}</Label>
            <Input id={ids.name} value={name} maxLength={100} dir="auto" aria-invalid={errors.name ? true : undefined} onChange={(e) => setName(e.target.value)} />
            {errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor={ids.url}>{t.providers.baseUrl}</Label>
            <Input
              id={ids.url}
              value={baseUrl}
              dir="ltr"
              inputMode="url"
              spellCheck={false}
              aria-invalid={errors.url ? true : undefined}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            {errors.url ? <p className="text-xs text-destructive">{errors.url}</p> : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor={ids.key}>
              {t.providers.apiKey}{" "}
              {!preset.requiresApiKey ? <span className="text-muted-foreground">({t.common.optional})</span> : null}
            </Label>
            <div className="flex gap-2">
              <Input
                id={ids.key}
                type={showKey ? "text" : "password"}
                value={apiKey}
                dir="ltr"
                spellCheck={false}
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                disabled={removeKey}
                placeholder={hasStoredKey ? t.providers.keyStoredPlaceholder : (preset.keyUrl ? "sk-…" : "")}
                aria-describedby={`${ids.key}-hint`}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <Button variant="ghost" size="icon" aria-label={showKey ? t.providers.hideKey : t.providers.showKey} aria-pressed={showKey} onClick={() => setShowKey((v) => !v)}>
                {showKey ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </Button>
            </div>
            <p id={`${ids.key}-hint`} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {t.providers.keyHint}
            </p>
            {hasStoredKey ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={removeKey} onChange={(e) => setRemoveKey(e.target.checked)} className="size-4 accent-[hsl(var(--primary))]" />
                {t.providers.removeKey}
              </label>
            ) : null}
            {preset.keyUrl ? (
              <a href={preset.keyUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline underline-offset-4">
                {t.providers.getKey}
              </a>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor={ids.transport}>{t.providers.transport}</Label>
            <select
              id={ids.transport}
              value={transport}
              onChange={(e) => setTransport(e.target.value as ProviderTransport)}
              aria-describedby={`${ids.transport}-hint`}
              className="h-11 rounded-2xl border border-input bg-surface-container px-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
            >
              <option value="direct">{t.providers.transportDirect}</option>
              <option value="proxy">{t.providers.transportProxy}</option>
            </select>
            <p id={`${ids.transport}-hint`} className="text-xs text-muted-foreground">
              {transport === "direct" ? t.providers.transportDirectHint : t.providers.transportProxyHint}
            </p>
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t.providers.headers}</legend>
            <p className="text-xs text-muted-foreground">{t.providers.headersHint}</p>
            {headers.map((row) => (
              <div key={row.key} className="flex gap-2">
                <Input
                  aria-label={t.providers.headerName}
                  value={row.name}
                  dir="ltr"
                  spellCheck={false}
                  placeholder="X-Header"
                  onChange={(e) => setHeaders((list) => list.map((h) => (h.key === row.key ? { ...h, name: e.target.value } : h)))}
                />
                <Input
                  aria-label={t.providers.headerValue}
                  type="password"
                  autoComplete="new-password"
                  value={row.value ?? ""}
                  dir="ltr"
                  placeholder={row.stored ? t.providers.headerStoredPlaceholder : ""}
                  onChange={(e) =>
                    setHeaders((list) => list.map((h) => (h.key === row.key ? { ...h, value: e.target.value === "" && h.stored ? null : e.target.value } : h)))
                  }
                />
                <Button variant="ghost" size="icon" aria-label={t.providers.removeHeader} onClick={() => setHeaders((list) => list.filter((h) => h.key !== row.key))}>
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            ))}
            {errors.headers ? <p className="text-xs text-destructive">{errors.headers}</p> : null}
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setHeaders((list) => [...list, { key: Date.now(), name: "", value: "", stored: false }])}
              >
                <Plus aria-hidden="true" />
                {t.providers.addHeader}
              </Button>
            </div>
          </fieldset>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={save.isPending} aria-busy={save.isPending}>
              {t.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
