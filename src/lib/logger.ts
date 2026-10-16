import { redactUnknown } from "@/lib/security/redact";

/** The only sanctioned logger: every argument is redacted before reaching the console. */
export const logger = {
  warn(message: string, ...details: unknown[]) {
    console.warn(`[nova] ${redactUnknown(message)}`, ...details.map((d) => redactUnknown(d)));
  },
  error(message: string, ...details: unknown[]) {
    console.error(`[nova] ${redactUnknown(message)}`, ...details.map((d) => redactUnknown(d)));
  },
};
