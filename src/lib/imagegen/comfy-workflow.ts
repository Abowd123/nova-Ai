import { comfyWorkflowJsonSchema, type ComfyInputRef, type ComfyMapping, type ComfyWorkflowJson, type ImageGenParams } from "@/lib/models";

export class ComfyWorkflowError extends Error {
  constructor(
    readonly code: "invalid_json" | "ui_format" | "invalid_workflow" | "no_prompt_node",
    message: string,
  ) {
    super(message);
    this.name = "ComfyWorkflowError";
  }
}

/** Parses an "API format" workflow (Save → Export (API)). Rejects the UI/graph format clearly. */
export function parseWorkflow(text: string): ComfyWorkflowJson {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ComfyWorkflowError("invalid_json", "Workflow is not valid JSON");
  }
  if (raw && typeof raw === "object" && "nodes" in raw && "links" in raw) {
    throw new ComfyWorkflowError("ui_format", "This is the UI workflow format. Export it with “Export (API)” instead.");
  }
  const parsed = comfyWorkflowJsonSchema.safeParse(raw);
  if (!parsed.success) throw new ComfyWorkflowError("invalid_workflow", "Not a ComfyUI API workflow");
  return parsed.data;
}

type Link = [string, number];
const isLink = (value: unknown): value is Link => Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number";

export interface NodeOption {
  nodeId: string;
  classType: string;
  title: string;
  inputs: string[];
}

/** Nodes with editable (non-linked) primitive inputs, for the mapping UI. */
export function listNodeInputs(workflow: ComfyWorkflowJson): NodeOption[] {
  return Object.entries(workflow)
    .map(([nodeId, node]) => ({
      nodeId,
      classType: node.class_type,
      title: node._meta?.title ?? node.class_type,
      inputs: Object.entries(node.inputs)
        .filter(([, value]) => !isLink(value) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean"))
        .map(([name]) => name),
    }))
    .filter((n) => n.inputs.length > 0)
    .sort((a, b) => Number(a.nodeId) - Number(b.nodeId) || a.nodeId.localeCompare(b.nodeId));
}

function textInputOf(workflow: ComfyWorkflowJson, nodeId: string, seen = new Set<string>()): ComfyInputRef | null {
  if (seen.has(nodeId)) return null;
  seen.add(nodeId);
  const node = workflow[nodeId];
  if (!node) return null;
  for (const name of ["text", "text_g", "prompt", "string", "value"]) {
    const value = node.inputs[name];
    if (typeof value === "string") return { nodeId, input: name };
    if (isLink(value)) {
      const upstream = textInputOf(workflow, value[0], seen);
      if (upstream) return upstream;
    }
  }
  // Follow conditioning chains (e.g. ConditioningCombine, ControlNetApply).
  for (const value of Object.values(node.inputs)) {
    if (isLink(value)) {
      const upstream = textInputOf(workflow, value[0], seen);
      if (upstream) return upstream;
    }
  }
  return null;
}

function findInput(workflow: ComfyWorkflowJson, names: string[], classPattern?: RegExp): ComfyInputRef | null {
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (classPattern && !classPattern.test(node.class_type)) continue;
    for (const name of names) if (typeof node.inputs[name] === "number") return { nodeId, input: name };
  }
  return null;
}

/** Best-effort automatic mapping: follows the sampler's positive/negative/latent links. */
export function detectMapping(workflow: ComfyWorkflowJson): ComfyMapping {
  const sampler = Object.entries(workflow).find(([, node]) => /KSampler|SamplerCustom/.test(node.class_type));
  let prompt: ComfyInputRef | null = null;
  let negativePrompt: ComfyInputRef | null = null;
  let width: ComfyInputRef | null = null;
  let height: ComfyInputRef | null = null;
  let batchSize: ComfyInputRef | null = null;

  if (sampler) {
    const [, node] = sampler;
    if (isLink(node.inputs.positive)) prompt = textInputOf(workflow, node.inputs.positive[0]);
    if (isLink(node.inputs.negative)) negativePrompt = textInputOf(workflow, node.inputs.negative[0]);
    if (isLink(node.inputs.latent_image)) {
      const latentId = node.inputs.latent_image[0];
      const latent = workflow[latentId];
      if (latent && typeof latent.inputs.width === "number") width = { nodeId: latentId, input: "width" };
      if (latent && typeof latent.inputs.height === "number") height = { nodeId: latentId, input: "height" };
      if (latent && typeof latent.inputs.batch_size === "number") batchSize = { nodeId: latentId, input: "batch_size" };
    }
  }
  // Flux/SD3 graphs use a guider instead of positive/negative on the sampler.
  if (!prompt) {
    const guider = Object.entries(workflow).find(([, n]) => /Guider/.test(n.class_type) && isLink(n.inputs.conditioning ?? n.inputs.positive));
    const link = guider ? (guider[1].inputs.conditioning ?? guider[1].inputs.positive) : null;
    if (isLink(link)) prompt = textInputOf(workflow, link[0]);
  }
  if (!prompt) {
    const encoders = Object.entries(workflow).filter(([, n]) => /CLIPTextEncode/.test(n.class_type) && typeof n.inputs.text === "string");
    if (encoders[0]) prompt = { nodeId: encoders[0][0], input: "text" };
    if (!negativePrompt && encoders[1]) negativePrompt = { nodeId: encoders[1][0], input: "text" };
  }
  if (!prompt) throw new ComfyWorkflowError("no_prompt_node", "Could not find a prompt node; pick it manually");
  if (negativePrompt && negativePrompt.nodeId === prompt.nodeId) negativePrompt = null;

  if (!width) width = findInput(workflow, ["width"], /Latent|Empty/);
  if (!height) height = findInput(workflow, ["height"], /Latent|Empty/);
  if (!batchSize) batchSize = findInput(workflow, ["batch_size"], /Latent|Empty/);

  return {
    prompt,
    negativePrompt,
    seed: findInput(workflow, ["seed", "noise_seed"]),
    width,
    height,
    batchSize,
    steps: findInput(workflow, ["steps"]),
    guidance: findInput(workflow, ["guidance"], /FluxGuidance/) ?? findInput(workflow, ["cfg"]),
  };
}

/** Returns a NEW workflow with params injected at the mapped inputs. */
export function applyParams(workflow: ComfyWorkflowJson, mapping: ComfyMapping, params: ImageGenParams, seed: number, batch = 1): ComfyWorkflowJson {
  const next = structuredClone(workflow) as ComfyWorkflowJson;
  const set = (ref: ComfyInputRef | null, value: string | number) => {
    if (!ref) return;
    const node = next[ref.nodeId];
    if (!node) throw new ComfyWorkflowError("invalid_workflow", `Mapped node ${ref.nodeId} no longer exists`);
    if (isLink(node.inputs[ref.input])) return; // never overwrite a link
    node.inputs[ref.input] = value;
  };
  set(mapping.prompt, params.prompt);
  set(mapping.negativePrompt, params.negativePrompt);
  set(mapping.seed, seed);
  set(mapping.width, params.width);
  set(mapping.height, params.height);
  set(mapping.batchSize, batch);
  if (params.steps !== null) set(mapping.steps, params.steps);
  if (params.guidance !== null) set(mapping.guidance, params.guidance);
  return next;
}
