import type { ComfyWorkflowJson, ImageGenParams } from "@/lib/models";

/** ComfyUI default text-to-image graph in API format. */
export function defaultWorkflow(): ComfyWorkflowJson {
  return {
    "3": { class_type: "KSampler", inputs: { seed: 1, steps: 20, cfg: 8, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "a cat", clip: ["4", 1] }, _meta: { title: "Positive" } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "blurry", clip: ["4", 1] } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "Nova", images: ["8", 0] } },
  } as ComfyWorkflowJson;
}

export function params(over: Partial<ImageGenParams> = {}): ImageGenParams {
  return { prompt: "a red fox", negativePrompt: "", width: 1344, height: 768, aspectRatio: "16:9", seed: null, count: 1, model: "", steps: null, guidance: null, ...over };
}
