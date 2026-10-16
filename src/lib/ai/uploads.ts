import { ProviderError } from "./errors";
import { joinUrl, readJson, sendWithRetry } from "./http";
import type { HttpClient, ProviderConfig, RequestOptions, UploadInput, UploadedFile } from "./types";
import { knownSecrets, mergeHeaders } from "./adapters/shared";

const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

/** OpenAI Files API (purpose=user_data) -> file_id usable in chat `file` parts. */
export async function uploadOpenAIFile(config: ProviderConfig, http: HttpClient, input: UploadInput, options: RequestOptions = {}): Promise<UploadedFile> {
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("file", new File([input.blob], input.name, { type: input.mimeType }));
  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const { response, link } = await sendWithRetry(
    http,
    joinUrl(config.baseUrl, "files"),
    { method: "POST", headers: mergeHeaders(headers, config), body: form },
    { ...options, timeoutMs: options.timeoutMs ?? UPLOAD_TIMEOUT_MS, knownSecrets: knownSecrets(config), retry: { retries: 1 } },
  );
  try {
    const json = await readJson<{ id?: string; expires_at?: number | null }>(response);
    if (typeof json.id !== "string") throw new ProviderError("invalid_response", "Upload response missing `id`");
    return { ref: json.id, kind: "file_id", expiresAt: typeof json.expires_at === "number" ? json.expires_at * 1000 : null };
  } finally {
    link.dispose();
  }
}

/** https://host/v1beta -> https://host/upload/v1beta */
export function geminiUploadUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/upload${url.pathname.replace(/\/+$/, "")}/files`;
  return url.toString();
}

interface GeminiFile {
  name?: string;
  uri?: string;
  state?: "PROCESSING" | "ACTIVE" | "FAILED" | "STATE_UNSPECIFIED";
  expirationTime?: string;
}

/**
 * Gemini Files API: resumable upload (start -> upload+finalize), then waits until the file
 * is ACTIVE (videos are processed server-side). Returns the file URI for `file_data` parts.
 */
export async function uploadGeminiFile(
  config: ProviderConfig,
  http: HttpClient,
  input: UploadInput,
  options: RequestOptions & { pollIntervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<UploadedFile> {
  const secrets = knownSecrets(config);
  const auth: Record<string, string> = config.apiKey ? { "x-goog-api-key": config.apiKey } : {};
  const timeoutMs = options.timeoutMs ?? UPLOAD_TIMEOUT_MS;

  const start = await sendWithRetry(
    http,
    geminiUploadUrl(config.baseUrl),
    {
      method: "POST",
      headers: mergeHeaders(
        {
          ...auth,
          "Content-Type": "application/json",
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": String(input.blob.size),
          "X-Goog-Upload-Header-Content-Type": input.mimeType,
        },
        config,
      ),
      body: JSON.stringify({ file: { display_name: input.name.slice(0, 128) } }),
    },
    { ...options, timeoutMs, knownSecrets: secrets, retry: { retries: 1 } },
  );
  const uploadUrl = start.response.headers.get("x-goog-upload-url");
  start.link.dispose();
  if (!uploadUrl) throw new ProviderError("invalid_response", "Gemini did not return an upload URL");

  const upload = await sendWithRetry(
    http,
    uploadUrl,
    {
      method: "POST",
      headers: mergeHeaders({ ...auth, "X-Goog-Upload-Command": "upload, finalize", "X-Goog-Upload-Offset": "0", "Content-Type": input.mimeType }, config),
      body: input.blob,
    },
    { ...options, timeoutMs, knownSecrets: secrets, retry: { retries: 0 } },
  );
  let file: GeminiFile;
  try {
    file = (await readJson<{ file?: GeminiFile }>(upload.response)).file ?? {};
  } finally {
    upload.link.dispose();
  }

  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const deadline = Date.now() + timeoutMs;
  while (file.state === "PROCESSING") {
    if (options.signal?.aborted) throw new ProviderError("aborted", "Upload aborted");
    if (Date.now() > deadline) throw new ProviderError("timeout", "Gemini file processing timed out");
    await sleep(options.pollIntervalMs ?? 2000);
    if (!file.name) break;
    const poll = await sendWithRetry(http, joinUrl(config.baseUrl, file.name), { method: "GET", headers: mergeHeaders({ ...auth, Accept: "application/json" }, config) }, { ...options, knownSecrets: secrets });
    try {
      file = await readJson<GeminiFile>(poll.response);
    } finally {
      poll.link.dispose();
    }
  }
  if (file.state === "FAILED") throw new ProviderError("bad_request", "Gemini could not process the file", { retryable: false });
  if (!file.uri) throw new ProviderError("invalid_response", "Upload response missing file URI");
  const expires = file.expirationTime ? Date.parse(file.expirationTime) : NaN;
  return { ref: file.uri, kind: "uri", expiresAt: Number.isFinite(expires) ? expires : null };
}
