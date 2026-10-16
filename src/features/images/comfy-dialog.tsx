"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { CheckCircle2, FileUp, Plug, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { openTextFile } from "@/lib/files";
import { getErrorMessage } from "@/lib/i18n/error-message";
import { ComfyClient } from "@/lib/imagegen/comfy-client";
import { ComfyWorkflowError, detectMapping, listNodeInputs, parseWorkflow } from "@/lib/imagegen/comfy-workflow";
import type { ComfyInputRef, ComfyMapping, ComfyWorkflow, ComfyWorkflowJson } from "@/lib/models";
import { useSaveWorkflow } from "./queries";

const SLOTS: (keyof ComfyMapping)[] = ["prompt", "negativePrompt", "seed", "width", "height", "batchSize", "steps", "guidance"];
const refKey = (ref: ComfyInputRef | null) => (ref ? `${ref.nodeId}::${ref.input}` : "");
const parseRef = (value: string): ComfyInputRef | null => {
  if (!value) return null;
  const [nodeId, input] = value.split("::");
  return nodeId && input ? { nodeId, input } : null;
};

export function ComfyWorkflowDialog({ open, onOpenChange, workflow }: { open: boolean; onOpenChange: (open: boolean) => void; workflow: ComfyWorkflow | null }) {
  const { t } = useI18n();
  const ids = { name: useId(), url: useId(), json: useId() };
  const save = useSaveWorkflow();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:8188");
  const [jsonText, setJsonText] = useState("");
  const [parsed, setParsed] = useState<ComfyWorkflowJson | null>(null);
  const [mapping, setMapping] = useState<ComfyMapping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(workflow?.name ?? "");
    setBaseUrl(workflow?.baseUrl ?? "http://127.0.0.1:8188");
    setJsonText(workflow ? JSON.stringify(workflow.workflow, null, 2) : "");
    setParsed(workflow?.workflow ?? null);
    setMapping(workflow?.mapping ?? null);
    setError(null);
    setTestResult(null);
  }, [open, workflow]);

  const nodes = useMemo(() => (parsed ? listNodeInputs(parsed) : []), [parsed]);

  const load = (text: string) => {
    setJsonText(text);
    try {
      const workflowJson = parseWorkflow(text);
      setParsed(workflowJson);
      setError(null);
      try {
        setMapping(detectMapping(workflowJson));
      } catch (e) {
        setMapping(null);
        setError(e instanceof ComfyWorkflowError ? t.images.comfyErrors[e.code] : t.errors.generic);
      }
    } catch (e) {
      setParsed(null);
      setMapping(null);
      setError(e instanceof ComfyWorkflowError ? t.images.comfyErrors[e.code] : t.errors.generic);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const stats = await new ComfyClient(baseUrl).systemStats();
      setTestResult(t.images.comfyConnected(stats.version ?? "?", stats.devices.join(", ") || "CPU"));
    } catch (e) {
      setTestResult(e instanceof Error ? e.message : t.errors.generic);
    } finally {
      setTesting(false);
    }
  };

  const submit = () => {
    if (!parsed || !mapping || !name.trim()) return;
    save.mutate(
      { id: workflow?.id, input: { name: name.trim(), baseUrl: baseUrl.trim(), workflow: parsed, mapping } },
      { onSuccess: () => onOpenChange(false), onError: (e) => toast({ title: getErrorMessage(e, t), variant: "destructive" }) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t.common.close} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{workflow ? t.images.editWorkflow : t.images.addWorkflow}</DialogTitle>
          <DialogDescription>{t.images.comfyDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65vh] gap-4 overflow-y-auto pe-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={ids.name}>{t.images.workflowName}</Label>
              <Input id={ids.name} value={name} maxLength={100} dir="auto" onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={ids.url}>{t.images.serverUrl}</Label>
              <div className="flex gap-2">
                <Input id={ids.url} type="url" dir="ltr" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
                <Button variant="outline" size="icon" aria-label={t.providers.test} onClick={() => void test()} disabled={testing || !baseUrl}>
                  <Plug aria-hidden="true" />
                </Button>
              </div>
            </div>
          </div>
          {testResult ? (
            <p className="text-xs text-muted-foreground" role="status" dir="auto">
              {testResult}
            </p>
          ) : null}
          <p className="rounded-2xl bg-secondary/60 px-3 py-2 text-xs">{t.images.corsHint}</p>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={ids.json}>{t.images.workflowJson}</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void openTextFile()
                    .then((file) => file && load(file.text))
                    .catch(() => undefined)
                }
              >
                <FileUp aria-hidden="true" />
                {t.images.importWorkflow}
              </Button>
            </div>
            <Textarea id={ids.json} dir="ltr" rows={6} className="font-mono text-xs" value={jsonText} onChange={(e) => load(e.target.value)} placeholder='{"3": {"class_type": "KSampler", ...}}' />
            {error ? (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : parsed ? (
              <p className="flex items-center gap-1 text-xs text-success">
                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                {t.images.nodesFound(Object.keys(parsed).length)}
              </p>
            ) : null}
          </div>

          {parsed ? (
            <fieldset className="grid gap-3 rounded-2xl border p-3">
              <legend className="flex items-center gap-2 px-1 text-sm font-medium">
                {t.images.mapping}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  onClick={() => {
                    try {
                      setMapping(detectMapping(parsed));
                      setError(null);
                    } catch (e) {
                      setError(e instanceof ComfyWorkflowError ? t.images.comfyErrors[e.code] : t.errors.generic);
                    }
                  }}
                >
                  <Wand2 aria-hidden="true" />
                  {t.images.autoDetect}
                </Button>
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {SLOTS.map((slot) => (
                  <label key={slot} className="grid gap-1 text-xs">
                    <span className="font-medium">
                      {t.images.slots[slot]}
                      {slot === "prompt" ? " *" : ""}
                    </span>
                    <select
                      className="h-9 rounded-xl border bg-background px-2 text-xs"
                      value={refKey(mapping?.[slot] ?? null)}
                      onChange={(e) => {
                        const ref = parseRef(e.target.value);
                        setMapping((m) => {
                          const base: ComfyMapping = m ?? { prompt: ref ?? { nodeId: "", input: "" }, negativePrompt: null, seed: null, width: null, height: null, batchSize: null, steps: null, guidance: null };
                          return slot === "prompt" ? (ref ? { ...base, prompt: ref } : base) : { ...base, [slot]: ref };
                        });
                      }}
                    >
                      {slot === "prompt" ? null : <option value="">{t.images.notMapped}</option>}
                      {nodes.flatMap((node) =>
                        node.inputs.map((input) => (
                          <option key={`${node.nodeId}::${input}`} value={`${node.nodeId}::${input}`}>
                            #{node.nodeId} {node.title} → {input}
                          </option>
                        )),
                      )}
                    </select>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button onClick={submit} disabled={!parsed || !mapping?.prompt.nodeId || !name.trim() || !baseUrl || save.isPending}>
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
