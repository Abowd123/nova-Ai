/**
 * Removes credentials from any text before it is logged, stored as an error or shown in the UI.
 * Defense in depth: callers should also pass the exact secrets they know about.
 */
const PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-***"],
  [/\bsk-or-[A-Za-z0-9_-]{8,}/g, "sk-or-***"],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-***"],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, "AIza***"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "gh_***"],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/g, "xox-***"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 ***"],
  [
    /\b(api[_-]?key|x-api-key|x-goog-api-key|access[_-]?token|refresh[_-]?token|token|secret|password|key)(["']?\s*[:=]\s*["']?)[^\s"'&,;}]{4,}/gi,
    "$1$2***",
  ],
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactSecrets(input: string, knownSecrets: readonly (string | undefined | null)[] = []): string {
  let output = input;
  for (const secret of knownSecrets) {
    if (secret && secret.length >= 4) {
      output = output.replace(new RegExp(escapeRegExp(secret), "g"), "***");
    }
  }
  for (const [pattern, replacement] of PATTERNS) output = output.replace(pattern, replacement);
  return output;
}

export function redactUnknown(value: unknown, knownSecrets: readonly (string | undefined | null)[] = []): string {
  if (value instanceof Error) return redactSecrets(`${value.name}: ${value.message}`, knownSecrets);
  if (typeof value === "string") return redactSecrets(value, knownSecrets);
  try {
    return redactSecrets(JSON.stringify(value), knownSecrets);
  } catch {
    return "[unserializable]";
  }
}
