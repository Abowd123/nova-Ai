import type { HttpClient, ProviderConfig } from "../types";
import { OpenAICompatibleProvider } from "./openai-compatible";

/** Any OpenAI-compatible server: LM Studio, vLLM, llama.cpp, LocalAI, Together, Groq, ... */
export class CustomProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfig, http: HttpClient) {
    super(config, http, { kind: "custom", label: config.name || "Custom provider" });
  }
}
