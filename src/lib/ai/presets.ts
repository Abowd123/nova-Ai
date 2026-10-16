import type { ProviderKind, ProviderTransport } from "@/lib/models";

export interface ProviderPreset {
  kind: ProviderKind;
  label: string;
  baseUrl: string;
  requiresApiKey: boolean;
  defaultTransport: ProviderTransport;
  keyUrl?: string;
}

export const PROVIDER_PRESETS: Record<ProviderKind, ProviderPreset> = {
  openai: {
    kind: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    requiresApiKey: true,
    defaultTransport: "direct",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    kind: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    requiresApiKey: true,
    defaultTransport: "direct",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  gemini: {
    kind: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    requiresApiKey: true,
    defaultTransport: "direct",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  openrouter: {
    kind: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    requiresApiKey: true,
    defaultTransport: "direct",
    keyUrl: "https://openrouter.ai/keys",
  },
  ollama: {
    kind: "ollama",
    label: "Ollama",
    baseUrl: "http://localhost:11434",
    requiresApiKey: false,
    defaultTransport: "direct",
  },
  custom: {
    kind: "custom",
    label: "Custom (OpenAI-compatible)",
    baseUrl: "http://localhost:8000/v1",
    requiresApiKey: false,
    defaultTransport: "direct",
  },
};

export const PROVIDER_KINDS = Object.keys(PROVIDER_PRESETS) as ProviderKind[];
