import type { HttpClient, ProviderConfig, RequestOptions, UploadInput, UploadedFile } from "../types";
import { uploadOpenAIFile } from "../uploads";
import { OpenAICompatibleProvider } from "./openai-compatible";

const NON_CHAT = /embedding|whisper|tts|dall-e|davinci|babbage|moderation|transcribe|image|realtime|search/;

export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfig, http: HttpClient) {
    super(config, http, {
      kind: "openai",
      label: "OpenAI",
      maxTokensField: "max_completion_tokens",
      mapRemoteModel: (raw) =>
        typeof raw.id === "string" && !NON_CHAT.test(raw.id) ? { id: raw.id } : null,
    });
  }

  uploadFile(input: UploadInput, options?: RequestOptions): Promise<UploadedFile> {
    return uploadOpenAIFile(this.config, this.http, input, options);
  }
}
