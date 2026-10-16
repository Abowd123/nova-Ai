# Security

## Reporting
Please report vulnerabilities privately to the maintainers (do not open a public issue). Include steps to reproduce and the affected version.

## Model
Nova is local-first: user data lives in the browser (IndexedDB / OPFS). The optional Next.js server only relays requests (`/api/proxy`, `/api/fetch`) and stores nothing.

## Controls

| Area | Control |
| --- | --- |
| Keys at rest | AES-256-GCM with a non-extractable WebCrypto key; context bound as AAD; ciphertexts are useless off-device |
| Keys in transit | Only to the provider/service they belong to; never in URLs, logs, errors, exports (unless password-encrypted), backups (unless encrypted) or sync (never) |
| Logs | Single `logger` with redaction of key/token patterns; audit log entries are redacted before storage |
| CSP | Per-request nonce + `strict-dynamic`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'` (`NOVA_CSP`) |
| Trusted Types | Report-only by default; `NOVA_TRUSTED_TYPES=enforce` to enforce |
| XSS | Markdown rendered with rehype-sanitize (no raw HTML, scripts, event handlers or `javascript:` URLs); no `innerHTML` in app code except the static boot script (nonce) |
| CSRF | Server routes require a custom marker header (forces CORS preflight), same `Origin`, and reject `Sec-Fetch-Site: cross-site` |
| SSRF | Proxy/fetch block private, loopback, link-local and metadata addresses after DNS resolution and on every redirect hop; optional host allowlist |
| Rate limits | Per-IP limits on `/api/proxy` and `/api/fetch` |
| Proxy methods | Only GET/HEAD/POST/PUT/DELETE/PATCH/PROPFIND/MKCOL/MOVE/COPY/OPTIONS are forwarded |
| Tools | Dangerous tools (code, destructive MCP tools) can never run without approval; JS sandbox in a worker on a separate path with its own CSP (no network by default) |
| Files | Type sniffing + size limits for attachments; archive entry names validated; prototype-pollution guard when reading backups |
| Backups | Optional AES-256-GCM per part (PBKDF2-SHA256, 600k iterations), SHA-256 per part and per archive; manifest written last |
| Sync | Encrypted deltas (same passphrase on every device, verified with a check value); provider keys and device-local settings never leave the device |
| Data control | Export everything; "Delete all data" wipes IndexedDB, OPFS, Cache Storage and Nova keys in local/session storage |

## Release security checklist
- [ ] `npm audit` clean (or reviewed) and lockfile committed
- [ ] `NOVA_PROXY_ALLOW_PRIVATE=false` on internet-facing deployments
- [ ] CSP header present on `/` (DevTools → Network) and no violations in the console
- [ ] `/api/proxy` rejects requests without the marker header and from another origin
- [ ] No API key strings in console output, exported plain files, plain backups or sync files (unit tests cover this)
- [ ] Sandbox `/sandbox/js` responds with `connect-src 'none'`
- [ ] Dangerous tools cannot be set to "auto"
- [ ] Backups restore on a second device with the passphrase; wrong passphrase is rejected
- [ ] "Delete all data" leaves no Nova data in DevTools → Application
