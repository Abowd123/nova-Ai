/**
 * Content-Security-Policy for app pages (sandbox workers and API routes set their own).
 *
 * - Scripts: nonce + 'strict-dynamic' (no inline scripts without the per-request nonce, no eval).
 * - connect-src stays open to https/http/ws because providers are user-configured (BYOK,
 *   LAN Ollama/ComfyUI, WebDAV); SSRF protection lives in the server routes instead.
 * - Trusted Types are reported (report-only) by default; set NOVA_TRUSTED_TYPES=enforce to enforce.
 */
export interface CspOptions {
  nonce: string;
  dev: boolean;
}

export function buildCsp({ nonce, dev }: CspOptions): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:", "https:"],
    "media-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", "https:", "http:", "wss:", "ws:", "blob:", "data:"],
    "worker-src": ["'self'", "blob:"],
    "child-src": ["'self'", "blob:"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "manifest-src": ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

/** Policy names allowed to create TrustedHTML/Script (Next.js internals + ours). */
export const TRUSTED_TYPES_POLICY = "require-trusted-types-for 'script'; trusted-types nova nextjs nextjs#bundler 'allow-duplicates'";

export function generateNonce(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(16));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Middleware applies the CSP to pages only. */
export function cspApplies(pathname: string): boolean {
  return !/^\/(api|_next\/static|_next\/image|sandbox|icons|sw\.js|manifest\.webmanifest|favicon\.ico|robots\.txt)/.test(pathname);
}
