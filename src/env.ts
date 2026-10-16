import { z } from "zod";

/**
 * Public (client-safe) environment variables.
 * Only NEXT_PUBLIC_* values belong here; they are inlined into the browser bundle.
 * Secrets must NEVER be added to this schema.
 */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().trim().min(1).max(50).default("Nova"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_ENABLE_SW: z.enum(["auto", "always", "never"]).default("auto"),
  NEXT_PUBLIC_DEFAULT_LOCALE: z.enum(["ar", "en"]).default("ar"),
  NEXT_PUBLIC_BUILD_ID: z.string().trim().min(1).max(64).default("dev"),
  NEXT_PUBLIC_APP_VERSION: z.string().trim().min(1).max(32).default("0.1.0"),
  /** Opt-in crash reports are POSTed here (https only). Empty = reports stay on the device. */
  NEXT_PUBLIC_CRASH_ENDPOINT: z
    .string()
    .url()
    .refine((v) => v.startsWith("https://"), "must be https")
    .optional(),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

type RawEnv = Record<string, string | undefined>;

/** Treat empty strings as "not set" so defaults apply (common in CI). */
function normalize(source: RawEnv): RawEnv {
  const out: RawEnv = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = value === undefined || value.trim() === "" ? undefined : value;
  }
  return out;
}

export function formatEnvIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
}

export function parseClientEnv(source: RawEnv): ClientEnv {
  const result = clientEnvSchema.safeParse(normalize(source));
  if (!result.success) {
    throw new Error(`Invalid public environment variables:\n${formatEnvIssues(result.error)}`);
  }
  return result.data;
}

// Each variable is referenced literally so Next.js can inline it at build time.
export const clientEnv: ClientEnv = parseClientEnv({
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_ENABLE_SW: process.env.NEXT_PUBLIC_ENABLE_SW,
  NEXT_PUBLIC_DEFAULT_LOCALE: process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
  NEXT_PUBLIC_BUILD_ID: process.env.NEXT_PUBLIC_BUILD_ID,
  NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
  NEXT_PUBLIC_CRASH_ENDPOINT: process.env.NEXT_PUBLIC_CRASH_ENDPOINT,
});
