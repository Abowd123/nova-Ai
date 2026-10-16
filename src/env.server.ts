import { z } from "zod";
import { formatEnvIssues } from "./env";

const booleanString = (fallback: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((value) => value === "true");

/**
 * Server-only environment variables. Import ONLY from route handlers / server code.
 * Nothing here is ever sent to the browser.
 */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Enables the /api/proxy route used by providers set to "proxy" transport. */
  NOVA_PROXY_ENABLED: booleanString("true"),
  /** Allows proxying to private/loopback addresses (e.g. self-hosted Ollama). Keep false on public servers. */
  NOVA_PROXY_ALLOW_PRIVATE: booleanString("false"),
  /** Optional comma-separated host allowlist. Empty = any public host. */
  NOVA_PROXY_ALLOWED_HOSTS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    ),
  /** Requests per minute per client IP. */
  NOVA_PROXY_RATE_LIMIT: z.coerce.number().int().min(1).max(10_000).default(120),
  /** Enables /api/fetch (fetch_url tool: page download + readable text extraction). */
  NOVA_FETCH_ENABLED: booleanString("true"),
  /** Pages per minute per client IP. */
  NOVA_FETCH_RATE_LIMIT: z.coerce.number().int().min(1).max(10_000).default(30),
  /** Comma-separated hosts (and their subdomains) fetch_url must never download. */
  NOVA_FETCH_BLOCKED_HOSTS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    ),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    normalized[key] = value === undefined || value.trim() === "" ? undefined : value;
  }
  const result = serverEnvSchema.safeParse(normalized);
  if (!result.success) {
    throw new Error(`Invalid server environment variables:\n${formatEnvIssues(result.error)}`);
  }
  return result.data;
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv({
    NODE_ENV: process.env.NODE_ENV,
    NOVA_PROXY_ENABLED: process.env.NOVA_PROXY_ENABLED,
    NOVA_PROXY_ALLOW_PRIVATE: process.env.NOVA_PROXY_ALLOW_PRIVATE,
    NOVA_PROXY_ALLOWED_HOSTS: process.env.NOVA_PROXY_ALLOWED_HOSTS,
    NOVA_PROXY_RATE_LIMIT: process.env.NOVA_PROXY_RATE_LIMIT,
    NOVA_FETCH_ENABLED: process.env.NOVA_FETCH_ENABLED,
    NOVA_FETCH_RATE_LIMIT: process.env.NOVA_FETCH_RATE_LIMIT,
    NOVA_FETCH_BLOCKED_HOSTS: process.env.NOVA_FETCH_BLOCKED_HOSTS,
  });
}
