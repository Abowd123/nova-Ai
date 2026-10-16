"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ImagePlus, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { renderSystemPrompt } from "@/features/chat/engine/build-request";
import { ModelPicker } from "@/features/chat/model-picker";
import { modelKey } from "@/features/chat/model-selection";
import { useSettings } from "@/features/settings/queries";
import { TagToggle } from "@/features/tags/tag-chip";
import { useTags } from "@/features/tags/queries";
import { useI18n } from "@/hooks/use-i18n";
import { getErrorMessage } from "@/lib/i18n/error-message";
import { imageFileToAvatar } from "@/lib/image";
import {
  DEFAULT_ASSISTANT_AVATAR,
  DEFAULT_ASSISTANT_SETTINGS,
  KNOWN_TOOLS,
  MAX_STARTERS,
  assistantCreateSchema,
  type Assistant,
  type AssistantCreateInput,
  type AutoPlayTts,
  type MemoryScope,
} from "@/lib/models";
import { VoicePicker } from "@/features/speech/voice-picker";
import { useMcpServers } from "@/features/tools/mcp-queries";
import { mcpServerToolKey } from "@/lib/tools/registry";
import { AssistantAvatar } from "./assistant-avatar";
import { useCreateAssistant, useUpdateAssistant } from "./queries";

export const PROMPT_VARIABLES = ["date", "time", "user_name", "model", "device_language"] as const;

type TabKey = "general" | "model" | "tools" | "voice" | "memory";

interface FormValues {
  name: string;
  avatar: string;
  description: string;
  systemPrompt: string;
  tagIds: string[];
  starters: string[];
  providerId: string | null;
  modelId: string | null;
  temperature: number;
  topP: string;
  maxTokens: string;
  contextMessageLimit: string;
  reasoning: "auto" | "on" | "off";
  enabledTools: string[];
  voiceId: string;
  autoPlayTts: AutoPlayTts;
  memoryScope: MemoryScope;
}

const FIELD_TAB: Record<string, TabKey> = {
  name: "general",
  avatar: "general",
  description: "general",
  systemPrompt: "general",
  starters: "general",
  tagIds: "general",
  temperature: "model",
  topP: "model",
  maxTokens: "model",
  contextMessageLimit: "model",
  settings: "model",
  defaultProviderId: "model",
  defaultModelId: "model",
  enabledTools: "tools",
  voiceId: "voice",
  autoPlayTts: "voice",
  memoryScope: "memory",
};

function toValues(assistant: Assistant | null): FormValues {
  return {
    name: assistant?.name ?? "",
    avatar: assistant?.avatar ?? DEFAULT_ASSISTANT_AVATAR,
    description: assistant?.description ?? "",
    systemPrompt: assistant?.systemPrompt ?? "",
    tagIds: assistant?.tagIds ?? [],
    starters: assistant?.starters ?? [],
    providerId: assistant?.defaultProviderId ?? null,
    modelId: assistant?.defaultModelId ?? null,
    temperature: assistant?.temperature ?? 0.7,
    topP: assistant?.topP?.toString() ?? "",
    maxTokens: assistant?.maxTokens?.toString() ?? "",
    contextMessageLimit: assistant?.contextMessageLimit?.toString() ?? "",
    reasoning: assistant?.settings.reasoning ?? "auto",
    enabledTools: assistant?.enabledTools ?? [],
    voiceId: assistant?.voiceId ?? "",
    autoPlayTts: assistant?.autoPlayTts ?? "never",
    memoryScope: assistant?.memoryScope ?? "assistant",
  };
}

const numberOrNull = (value: string): number | null => (value.trim() === "" ? null : Number(value));

export function toAssistantInput(values: FormValues, budget = DEFAULT_ASSISTANT_SETTINGS.reasoningBudget): AssistantCreateInput {
  return {
    name: values.name.trim(),
    avatar: values.avatar.trim() || DEFAULT_ASSISTANT_AVATAR,
    description: values.description.trim(),
    systemPrompt: values.systemPrompt,
    tagIds: values.tagIds,
    starters: values.starters.map((s) => s.trim()).filter(Boolean),
    defaultProviderId: values.providerId,
    defaultModelId: values.providerId ? values.modelId : null,
    temperature: values.temperature,
    topP: numberOrNull(values.topP),
    maxTokens: numberOrNull(values.maxTokens),
    contextMessageLimit: numberOrNull(values.contextMessageLimit),
    enabledTools: values.enabledTools,
    voiceId: values.voiceId.trim() || null,
    autoPlayTts: values.autoPlayTts,
    memoryScope: values.memoryScope,
    settings: { reasoning: values.reasoning, reasoningBudget: budget },
  };
}

function Field({ id, label, hint, error, children }: { id: string; label: ReactNode; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function AssistantFormDialog({
  open,
  onOpenChange,
  assistant,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assistant: Assistant | null;
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const createAssistant = useCreateAssistant();
  const updateAssistant = useUpdateAssistant();
  const tags = useTags();
  const mcpServers = useMcpServers();
  const settings = useSettings();
  const [tab, setTab] = useState<TabKey>("general");
  const [values, setValues] = useState<FormValues>(() => toValues(null));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pending = createAssistant.isPending || updateAssistant.isPending;

  useEffect(() => {
    if (!open) return;
    setValues(toValues(assistant));
    setErrors({});
    setTab("general");
  }, [open, assistant]);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setValues((current) => ({ ...current, [key]: value }));

  const preview = useMemo(
    () =>
      renderSystemPrompt(values.systemPrompt, {
        userName: settings.data?.userName || t.assistants.previewUser,
        model: values.modelId ?? t.assistants.previewModel,
        locale,
        now: new Date(),
      }),
    [values.systemPrompt, values.modelId, settings.data?.userName, locale, t],
  );

  const insertVariable = (name: string) => {
    const token = `{{${name}}}`;
    const element = promptRef.current;
    const start = element?.selectionStart ?? values.systemPrompt.length;
    const end = element?.selectionEnd ?? start;
    const next = values.systemPrompt.slice(0, start) + token + values.systemPrompt.slice(end);
    set("systemPrompt", next);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      set("avatar", await imageFileToAvatar(file));
    } catch {
      toast({ title: t.assistants.avatarError, variant: "destructive" });
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const input = toAssistantInput(values, assistant?.settings.reasoningBudget);
    const parsed = assistantCreateSchema.safeParse(input);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "name");
        next[key] ??= key === "name" && !input.name ? t.assistants.nameRequired : t.assistants.invalidValue;
      }
      setErrors(next);
      const firstKey = Object.keys(next)[0];
      if (firstKey) setTab(FIELD_TAB[firstKey] ?? "general");
      return;
    }
    try {
      if (assistant) await updateAssistant.mutateAsync({ id: assistant.id, patch: parsed.data });
      else await createAssistant.mutateAsync(parsed.data);
      toast({ title: t.assistants.saved, variant: "success" });
      onOpenChange(false);
    } catch (error) {
      toast({ title: getErrorMessage(error, t), variant: "destructive" });
    }
  };

  const describedBy = (key: string, hint = false) =>
    [errors[key] ? `${id}-${key}-error` : null, hint ? `${id}-${key}-hint` : null].filter(Boolean).join(" ") || undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t.common.close} className="max-w-2xl">
        <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{assistant ? t.assistants.editTitle : t.assistants.createTitle}</DialogTitle>
            <DialogDescription>{t.assistants.description}</DialogDescription>
          </DialogHeader>

          <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)} className="grid gap-4">
            <TabsList label={t.assistants.sections}>
              <TabsTrigger value="general">{t.assistants.tabs.general}</TabsTrigger>
              <TabsTrigger value="model">{t.assistants.tabs.model}</TabsTrigger>
              <TabsTrigger value="tools">{t.assistants.tabs.tools}</TabsTrigger>
              <TabsTrigger value="voice">{t.assistants.tabs.voice}</TabsTrigger>
              <TabsTrigger value="memory">{t.assistants.tabs.memory}</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="grid gap-4">
              <div className="flex items-end gap-3">
                <AssistantAvatar avatar={values.avatar} className="size-16 text-3xl" />
                <Field id={`${id}-avatar`} label={t.assistants.avatar} error={errors.avatar}>
                  <div className="flex gap-2">
                    <Input
                      id={`${id}-avatar`}
                      className="w-24 text-center text-xl"
                      maxLength={16}
                      value={values.avatar.startsWith("data:") ? "" : values.avatar}
                      placeholder={values.avatar.startsWith("data:") ? "🖼️" : ""}
                      onChange={(e) => set("avatar", e.target.value)}
                    />
                    <Button variant="outline" size="icon" aria-label={t.assistants.uploadAvatar} onClick={() => fileRef.current?.click()}>
                      <ImagePlus aria-hidden="true" />
                    </Button>
                    {values.avatar.startsWith("data:") ? (
                      <Button variant="ghost" size="icon" aria-label={t.assistants.removeAvatar} onClick={() => set("avatar", DEFAULT_ASSISTANT_AVATAR)}>
                        <X aria-hidden="true" />
                      </Button>
                    ) : null}
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden="true"
                      onChange={(e) => {
                        void pickImage(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </div>
                </Field>
              </div>

              <Field id={`${id}-name`} label={t.assistants.name} error={errors.name}>
                <Input
                  id={`${id}-name`}
                  value={values.name}
                  maxLength={100}
                  dir="auto"
                  autoFocus
                  aria-invalid={errors.name ? true : undefined}
                  aria-describedby={describedBy("name")}
                  onChange={(e) => set("name", e.target.value)}
                />
              </Field>

              <Field
                id={`${id}-description`}
                label={
                  <>
                    {t.assistants.descriptionLabel} <span className="text-muted-foreground">({t.common.optional})</span>
                  </>
                }
                error={errors.description}
              >
                <Input id={`${id}-description`} value={values.description} maxLength={500} dir="auto" onChange={(e) => set("description", e.target.value)} />
              </Field>

              <Field id={`${id}-systemPrompt`} label={t.assistants.systemPrompt} error={errors.systemPrompt}>
                <div className="flex flex-wrap gap-1" role="group" aria-label={t.assistants.insertVariable}>
                  {PROMPT_VARIABLES.map((name) => (
                    <Button key={name} variant="outline" size="sm" className="h-7 px-2.5 font-mono text-xs" onClick={() => insertVariable(name)}>
                      {`{{${name}}}`}
                    </Button>
                  ))}
                </div>
                <Textarea
                  id={`${id}-systemPrompt`}
                  ref={promptRef}
                  rows={6}
                  dir="auto"
                  value={values.systemPrompt}
                  onChange={(e) => set("systemPrompt", e.target.value)}
                />
                {values.systemPrompt.includes("{{") ? (
                  <details className="rounded-2xl bg-surface-container px-3 py-2 text-sm">
                    <summary className="cursor-pointer text-muted-foreground">{t.common.preview}</summary>
                    <p className="mt-2 whitespace-pre-wrap" dir="auto" data-testid="prompt-preview">
                      {preview}
                    </p>
                  </details>
                ) : null}
              </Field>

              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">{t.assistants.tags}</legend>
                {(tags.data ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t.assistants.noTagsHint}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {(tags.data ?? []).map((tag) => (
                      <TagToggle
                        key={tag.id}
                        tag={tag}
                        pressed={values.tagIds.includes(tag.id)}
                        onToggle={() =>
                          set("tagIds", values.tagIds.includes(tag.id) ? values.tagIds.filter((x) => x !== tag.id) : [...values.tagIds, tag.id])
                        }
                      />
                    ))}
                  </div>
                )}
              </fieldset>

              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">{t.assistants.starters}</legend>
                <p className="text-xs text-muted-foreground">{t.assistants.startersHint}</p>
                {values.starters.map((starter, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      aria-label={t.assistants.starterN(index + 1)}
                      value={starter}
                      maxLength={300}
                      dir="auto"
                      onChange={(e) => set("starters", values.starters.map((s, i) => (i === index ? e.target.value : s)))}
                    />
                    <Button variant="ghost" size="icon" aria-label={t.assistants.removeStarter} onClick={() => set("starters", values.starters.filter((_, i) => i !== index))}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                {errors.starters ? <p className="text-xs text-destructive">{errors.starters}</p> : null}
                <div>
                  <Button variant="outline" size="sm" disabled={values.starters.length >= MAX_STARTERS} onClick={() => set("starters", [...values.starters, ""])}>
                    <Plus aria-hidden="true" />
                    {t.assistants.addStarter}
                  </Button>
                </div>
              </fieldset>
            </TabsContent>

            <TabsContent value="model" className="grid gap-4">
              <div className="grid gap-2">
                <span className="text-sm font-medium">{t.assistants.defaultModel}</span>
                <div className="flex gap-2">
                  <ModelPicker
                    label={t.assistants.defaultModel}
                    value={values.providerId && values.modelId ? modelKey(values.providerId, values.modelId) : null}
                    onChange={({ providerId, modelId }) => setValues((v) => ({ ...v, providerId, modelId }))}
                  />
                  {values.providerId ? (
                    <Button variant="ghost" size="sm" onClick={() => setValues((v) => ({ ...v, providerId: null, modelId: null }))}>
                      {t.assistants.useAppDefault}
                    </Button>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{values.providerId ? "" : t.assistants.appDefaultHint}</p>
              </div>

              <Field id={`${id}-temperature`} label={`${t.assistants.temperature}: ${values.temperature.toFixed(1)}`} hint={t.assistants.temperatureHint}>
                <input
                  id={`${id}-temperature`}
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={values.temperature}
                  aria-describedby={`${id}-temperature-hint`}
                  onChange={(e) => set("temperature", Number(e.target.value))}
                  className="w-full accent-[hsl(var(--primary))]"
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field id={`${id}-topP`} label="Top P" hint={t.assistants.emptyMeansDefault} error={errors.topP}>
                  <Input id={`${id}-topP`} type="number" inputMode="decimal" min={0} max={1} step={0.05} dir="ltr" value={values.topP} onChange={(e) => set("topP", e.target.value)} />
                </Field>
                <Field id={`${id}-maxTokens`} label={t.assistants.maxTokens} hint={t.assistants.emptyMeansDefault} error={errors.maxTokens}>
                  <Input id={`${id}-maxTokens`} type="number" inputMode="numeric" min={1} step={1} dir="ltr" value={values.maxTokens} onChange={(e) => set("maxTokens", e.target.value)} />
                </Field>
                <Field id={`${id}-contextMessageLimit`} label={t.assistants.contextLimit} hint={t.assistants.contextLimitHint} error={errors.contextMessageLimit}>
                  <Input
                    id={`${id}-contextMessageLimit`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={1000}
                    step={1}
                    dir="ltr"
                    value={values.contextMessageLimit}
                    onChange={(e) => set("contextMessageLimit", e.target.value)}
                  />
                </Field>
              </div>

              <div className="grid gap-2">
                <span className="text-sm font-medium">{t.assistants.reasoning}</span>
                <SegmentedControl
                  label={t.assistants.reasoning}
                  value={values.reasoning}
                  onValueChange={(value) => set("reasoning", value)}
                  options={[
                    { value: "auto", label: t.assistants.reasoningAuto },
                    { value: "on", label: t.assistants.reasoningOn },
                    { value: "off", label: t.assistants.reasoningOff },
                  ]}
                />
              </div>
            </TabsContent>

            <TabsContent value="tools" className="grid gap-3">
              <p className="rounded-2xl bg-secondary/60 px-3 py-2 text-sm">{t.assistants.toolsNotice}</p>
              <fieldset className="grid gap-2">
                <legend className="sr-only">{t.assistants.tabs.tools}</legend>
                {KNOWN_TOOLS.map((tool) => (
                  <label key={tool} className="flex items-start gap-3 rounded-2xl border p-3">
                    <input
                      type="checkbox"
                      checked={values.enabledTools.includes(tool)}
                      onChange={(e) =>
                        set("enabledTools", e.target.checked ? [...values.enabledTools, tool] : values.enabledTools.filter((x) => x !== tool))
                      }
                      className="mt-1 size-4 accent-[hsl(var(--primary))]"
                    />
                    <span>
                      <span className="block font-mono text-sm" dir="ltr">
                        {tool}
                      </span>
                      <span className="block text-xs text-muted-foreground">{t.assistants.toolDescriptions[tool]}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {mcpServers.data?.length ? (
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-medium">{t.assistants.mcpServers}</legend>
                  {mcpServers.data.map((server) => {
                    const key = mcpServerToolKey(server.slug);
                    return (
                      <label key={server.id} className="flex items-start gap-3 rounded-2xl border p-3">
                        <input
                          type="checkbox"
                          checked={values.enabledTools.includes(key)}
                          onChange={(e) => set("enabledTools", e.target.checked ? [...values.enabledTools, key] : values.enabledTools.filter((x) => x !== key))}
                          className="mt-1 size-4 accent-[hsl(var(--primary))]"
                        />
                        <span>
                          <span className="block text-sm font-medium">{server.name}</span>
                          <span className="block text-xs text-muted-foreground">{t.assistants.mcpToolCount(server.tools.length - server.disabledTools.length)}</span>
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              ) : null}
            </TabsContent>

            <TabsContent value="voice" className="grid gap-4">
              <p className="rounded-2xl bg-secondary/60 px-3 py-2 text-sm">{t.assistants.voiceNotice}</p>
              <div className="grid gap-1">
                <VoicePicker label={t.assistants.voiceId} value={values.voiceId} onChange={(voice) => set("voiceId", voice)} />
                <p className="text-xs text-muted-foreground">{t.assistants.voiceIdHint}</p>
              </div>
              <div className="grid gap-2">
                <span className="text-sm font-medium">{t.assistants.autoPlay}</span>
                <SegmentedControl
                  label={t.assistants.autoPlay}
                  value={values.autoPlayTts}
                  onValueChange={(value) => set("autoPlayTts", value)}
                  options={[
                    { value: "never", label: t.assistants.autoPlayNever },
                    { value: "always", label: t.assistants.autoPlayAlways },
                    { value: "voice-input", label: t.assistants.autoPlayVoice },
                  ]}
                />
              </div>
            </TabsContent>

            <TabsContent value="memory" className="grid gap-3">
              <p className="rounded-2xl bg-secondary/60 px-3 py-2 text-sm">{t.assistants.memoryNotice}</p>
              <SegmentedControl
                label={t.assistants.memoryScope}
                value={values.memoryScope}
                onValueChange={(value) => set("memoryScope", value)}
                options={[
                  { value: "none", label: t.assistants.memoryScopes.none },
                  { value: "global", label: t.assistants.memoryScopes.global },
                  { value: "assistant", label: t.assistants.memoryScopes.assistant },
                  { value: "conversation", label: t.assistants.memoryScopes.conversation },
                ]}
              />
              <p className="text-xs text-muted-foreground">{t.assistants.memoryScopeHints[values.memoryScope]}</p>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {t.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
