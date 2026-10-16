import { ComfyClient, ComfyImageGenerator } from "@/lib/imagegen/comfy-client";
import { GeminiImageGenerator, OpenAIImageGenerator, OpenRouterImageGenerator } from "@/lib/imagegen/http-generators";
import type { ImageGenCapabilities } from "@/lib/imagegen/types";
import type { ComfyWorkflow, ImageBackendKind } from "@/lib/models";

const placeholder = { id: "x", name: "x", baseUrl: "https://example.invalid", transport: "direct" as const };
const noHttp = () => Promise.reject(new Error("capabilities only"));

/** Static capability lookup for the form (no credentials needed). */
export function capabilitiesFor(backend: ImageBackendKind, model: string, workflow?: ComfyWorkflow): ImageGenCapabilities {
  switch (backend) {
    case "openai":
      return new OpenAIImageGenerator({ ...placeholder, kind: "openai" }, noHttp).capabilities(model);
    case "gemini":
      return new GeminiImageGenerator({ ...placeholder, kind: "gemini" }, noHttp).capabilities(model);
    case "openrouter":
      return new OpenRouterImageGenerator({ ...placeholder, kind: "openrouter" }, noHttp).capabilities();
    case "comfyui":
      return workflow
        ? new ComfyImageGenerator(new ComfyClient(workflow.baseUrl), workflow.workflow, workflow.mapping).capabilities()
        : { negativePrompt: true, seed: true, steps: true, guidance: true, sizes: null, maxCount: 8, models: [] };
  }
}
