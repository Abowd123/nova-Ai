import { z } from "zod";
import { idSchema, timestampSchema } from "./common";

export const imageBackendKindSchema = z.enum(["openai", "gemini", "openrouter", "comfyui"]);
export type ImageBackendKind = z.infer<typeof imageBackendKindSchema>;

export const imageGenParamsSchema = z
  .object({
    prompt: z.string().trim().min(1).max(32_000),
    negativePrompt: z.string().max(8000),
    width: z.number().int().min(64).max(8192),
    height: z.number().int().min(64).max(8192),
    aspectRatio: z.string().regex(/^\d{1,2}:\d{1,2}$/),
    /** null = random. */
    seed: z.number().int().min(0).max(2 ** 32 - 1).nullable(),
    count: z.number().int().min(1).max(8),
    model: z.string().max(256),
    steps: z.number().int().min(1).max(200).nullable(),
    guidance: z.number().min(0).max(50).nullable(),
  })
  .strict();
export type ImageGenParams = z.infer<typeof imageGenParamsSchema>;

export const imageGenStatusSchema = z.enum(["queued", "running", "complete", "error", "cancelled"]);
export type ImageGenStatus = z.infer<typeof imageGenStatusSchema>;

export const imageGenerationSchema = z.object({
  id: idSchema,
  backend: imageBackendKindSchema,
  /** Provider id (openai/gemini/openrouter) or ComfyUI workflow id. */
  sourceId: idSchema,
  params: imageGenParamsSchema,
  status: imageGenStatusSchema,
  progress: z.number().min(0).max(1),
  error: z.string().max(2000).nullable(),
  /** Attachment ids of the resulting images (kind image, no conversation). */
  imageIds: z.array(idSchema),
  /** Seeds actually used, aligned with imageIds when known. */
  seeds: z.array(z.number().int().nonnegative().nullable()),
  revisedPrompt: z.string().max(32_000).nullable(),
  /** ComfyUI job handle, used to resume after reload. */
  remoteJobId: z.string().max(256).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type ImageGeneration = z.infer<typeof imageGenerationSchema>;

export const imageGenerationCreateSchema = imageGenerationSchema
  .pick({ backend: true, sourceId: true, params: true })
  .strict();
export type ImageGenerationCreateInput = z.input<typeof imageGenerationCreateSchema>;

export const imageGenerationUpdateSchema = imageGenerationSchema
  .pick({ status: true, progress: true, error: true, imageIds: true, seeds: true, revisedPrompt: true, remoteJobId: true })
  .partial()
  .strict();
export type ImageGenerationUpdateInput = z.input<typeof imageGenerationUpdateSchema>;

/** Where workflow inputs are injected: node id + input name. */
export const comfyInputRefSchema = z.object({ nodeId: z.string().min(1).max(64), input: z.string().min(1).max(64) });
export type ComfyInputRef = z.infer<typeof comfyInputRefSchema>;

export const comfyMappingSchema = z
  .object({
    prompt: comfyInputRefSchema,
    negativePrompt: comfyInputRefSchema.nullable(),
    seed: comfyInputRefSchema.nullable(),
    width: comfyInputRefSchema.nullable(),
    height: comfyInputRefSchema.nullable(),
    batchSize: comfyInputRefSchema.nullable(),
    steps: comfyInputRefSchema.nullable(),
    guidance: comfyInputRefSchema.nullable(),
  })
  .strict();
export type ComfyMapping = z.infer<typeof comfyMappingSchema>;

export const comfyNodeSchema = z.object({
  class_type: z.string().min(1).max(200),
  inputs: z.record(z.string(), z.unknown()),
  _meta: z.object({ title: z.string().optional() }).passthrough().optional(),
});
/** ComfyUI "API format" workflow: { "<nodeId>": { class_type, inputs } }. */
export const comfyWorkflowJsonSchema = z.record(z.string().min(1).max(64), comfyNodeSchema).refine((value) => Object.keys(value).length > 0, "Workflow is empty");
export type ComfyWorkflowJson = z.infer<typeof comfyWorkflowJsonSchema>;

export const comfyWorkflowSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(100),
  baseUrl: z.string().url().max(2048),
  workflow: comfyWorkflowJsonSchema,
  mapping: comfyMappingSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type ComfyWorkflow = z.infer<typeof comfyWorkflowSchema>;

export const comfyWorkflowCreateSchema = comfyWorkflowSchema.pick({ name: true, baseUrl: true, workflow: true, mapping: true }).strict();
export type ComfyWorkflowCreateInput = z.input<typeof comfyWorkflowCreateSchema>;
export const comfyWorkflowUpdateSchema = comfyWorkflowCreateSchema.partial().strict();
export type ComfyWorkflowUpdateInput = z.input<typeof comfyWorkflowUpdateSchema>;
