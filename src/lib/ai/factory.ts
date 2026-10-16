import { AnthropicProvider } from "./adapters/anthropic";
import { CustomProvider } from "./adapters/custom";
import { GeminiProvider } from "./adapters/gemini";
import { OllamaProvider } from "./adapters/ollama";
import { OpenAIProvider } from "./adapters/openai";
import { OpenRouterProvider } from "./adapters/openrouter";
import { httpForTransport } from "./transport";
import type { ChatProvider, HttpClient, ProviderConfig } from "./types";

export function createProvider(config: ProviderConfig, http: HttpClient = httpForTransport(config.transport)): ChatProvider {
  switch (config.kind) {
    case "openai":
      return new OpenAIProvider(config, http);
    case "anthropic":
      return new AnthropicProvider(config, http);
    case "gemini":
      return new GeminiProvider(config, http);
    case "openrouter":
      return new OpenRouterProvider(config, http, typeof location !== "undefined" ? location.origin : undefined);
    case "ollama":
      return new OllamaProvider(config, http);
    case "custom":
      return new CustomProvider(config, http);
  }
}
