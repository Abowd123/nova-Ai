import { redactSecrets } from "@/lib/security/redact";

export type ProviderErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "bad_request"
  | "rate_limited"
  | "server"
  | "network"
  | "timeout"
  | "aborted"
  | "invalid_response"
  | "unsupported"
  | "unknown";

const RETRYABLE: ReadonlySet<ProviderErrorCode> = new Set(["rate_limited", "server", "network", "timeout"]);

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(
    code: ProviderErrorCode,
    message: string,
    options: { status?: number; retryAfterMs?: number; cause?: unknown; retryable?: boolean } = {},
  ) {
    super(redactSecrets(message), { cause: options.cause });
    this.name = "ProviderError";
    this.code = code;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.retryable = options.retryable ?? RETRYABLE.has(code);
  }
}

export function codeForStatus(status: number): ProviderErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  if (status >= 400) return "bad_request";
  return "unknown";
}

/** Parses Retry-After (seconds or HTTP date) and provider-specific ms headers. */
export function parseRetryAfter(headers: Headers, now = Date.now()): number | undefined {
  const ms = headers.get("retry-after-ms");
  if (ms && Number.isFinite(Number(ms))) return Math.max(0, Number(ms));
  const value = headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

function extractMessage(body: string): string | undefined {
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const error = json.error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error) {
      const message = (error as { message: unknown }).message;
      if (typeof message === "string") return message;
    }
    if (typeof json.message === "string") return json.message;
    if (Array.isArray(json) && json[0]?.error?.message) return String(json[0].error.message);
  } catch {
    /* not JSON */
  }
  const trimmed = body.trim();
  return trimmed ? trimmed.slice(0, 300) : undefined;
}

export async function errorFromResponse(response: Response, knownSecrets: string[] = []): Promise<ProviderError> {
  let body = "";
  try {
    body = (await response.text()).slice(0, 4000);
  } catch {
    /* ignore */
  }
  const code = codeForStatus(response.status);
  const detail = extractMessage(body) ?? response.statusText ?? "";
  return new ProviderError(
    code,
    redactSecrets(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`, knownSecrets),
    {
      status: response.status,
      retryAfterMs: code === "rate_limited" || code === "server" ? parseRetryAfter(response.headers) : undefined,
      // 501 Not Implemented will never succeed on retry.
      retryable: response.status === 501 ? false : undefined,
    },
  );
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof ProviderError && error.code === "aborted") ||
    (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError")
  );
}

/** Normalizes anything thrown during a request into a ProviderError. */
export function toProviderError(error: unknown, knownSecrets: string[] = []): ProviderError {
  if (error instanceof ProviderError) return error;
  if (isAbortError(error)) return new ProviderError("aborted", "Request aborted", { cause: error });
  if (error instanceof TypeError) {
    // fetch() network failures (DNS, CORS, offline) surface as TypeError.
    return new ProviderError("network", redactSecrets(error.message, knownSecrets), { cause: error });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError("unknown", redactSecrets(message, knownSecrets), { cause: error });
}
