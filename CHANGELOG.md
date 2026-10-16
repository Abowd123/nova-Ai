# Changelog

## 1.5.0 — Phase 8: Android app

### Added
- Android app (Capacitor 7) from the same codebase: static export wrapped in a native shell, no Kotlin code. Android 8.0+ (min SDK 26), app id `app.nova.assistant`.
- Native integration behind `src/lib/native` with web fallbacks: back button (closes dialogs, then history, then "press again to exit"), system browser for external links, share sheet, exports saved to Documents/Nova, haptics, network status, status bar, splash screen and keyboard resize.
- Native HTTP for WebDAV backup, MCP, web search and page reading (no CORS, no Nova server needed); the WebView fetch is kept for token streaming.
- Local notification when a reply is ready; app resume triggers reply recovery and scheduled backup/sync.
- Deep link `app.nova.assistant://oauth/callback` for MCP OAuth sign-in.
- Permissions for microphone, camera, photos/media and notifications, requested at the point of use.
- Icons and splash screens generated from `resources/` (light and dark).
- GitHub Actions workflow `android.yml`: lint, typecheck and unit tests, then a debug APK on every run; signed release APK + AAB on `v*` tags when the signing secrets exist; `SHA256SUMS.txt`; GitHub Release with notes from this file.
- Size report (JS chunks and APK) in the job summary with configurable budgets (`NOVA_JS_BUDGET_KB`, `NOVA_APK_BUDGET_MB`).
- Docs: `ANDROID.md`, `RELEASE.md`, `TESTING.md` (manual test matrix), release template.
- Optional opt-in crash reports via `NEXT_PUBLIC_CRASH_ENDPOINT`.

### Changed
- `npm run build:mobile` produces a static export by temporarily setting aside server-only parts (API routes, middleware, dynamic routes) and always restoring them. Inside the app, chats open at `/chat/view?id=…` and the Python sandbox loads from `/sandbox/py.js`.
- Cloud backup of app data is disabled on Android (`allowBackup=false`); use WebDAV backup instead.
- Cleartext http is off by default; enable with `NOVA_ANDROID_CLEARTEXT=1` only when needed.

### Known limitations (Android)
- No `/api/*` server in the app: `fetch_url` and "Route through the Nova server" are unavailable (native HTTP replaces them).
- No service worker (files ship inside the APK).
- MCP legacy SSE and "proxy"-transport providers are buffered (no token streaming).
- The static export has no per-request CSP nonce.

## 1.1.0 — Phase 3

### Added
- Assistants v2 schema (description, avatar image, topP, maxTokens, context limit, tools, memory scope, voice, starters, reasoning settings) with automatic migration (Dexie v4).
- System prompt variables: {{date}}, {{time}}, {{user_name}}, {{model}}, {{device_language}} with live preview.
- Tabbed assistant editor (General, Model, Tools, Voice, Memory); duplicate, default, quick picker in chat, starters in empty chats.
- Colored tags (many-to-many), reorder, search by name/tag, multi-tag AND filter, filter state in the URL.
- Backup & import (Settings → Backup & import): JSON export, optional conversations, merge/replace, conflict strategies, conflict report, duplicate-id handling, backward-compatible migrations.
- Password-encrypted backups (PBKDF2-SHA256 600k + AES-GCM, header bound as AAD, gzip). API keys only inside encrypted files.
- File System Access API with download/upload fallback; share a single assistant file.
- Provider sharing via animated QR (gzip + Base45 + chunk framing with session, index, total, CRC32); scanner with any-order collection, progress and damaged-part rejection. API key excluded unless explicitly confirmed.

## 1.0.0

### Added
- Unified Provider SDK: `ChatRequest`, `ChatMessage`, `ChatEvent`, `ModelInfo`, `ProviderCapabilities`, `TokenUsage`, `MessagePart` (text, image, audio, video, tool call/result, reasoning).
- Adapters: OpenAI-compatible, OpenAI, Anthropic, Gemini, OpenRouter, Ollama, Custom.
- SSE + NDJSON streaming with AbortController, header/idle timeouts, retry with backoff + Retry-After, error mapping (401/403/404/429/5xx).
- Model catalog (JSON) and provider management: add/edit/delete, test connection, fetch models, enable/disable models, default model, base URL, API key, extra headers, direct or proxy transport.
- Encrypted secret vault (AES-GCM, non-extractable key, AAD binding). Secret redaction for errors and logs.
- `/api/proxy` with SSRF protection, CSRF checks and rate limiting.
- Chat engine: streaming with partial persistence, stop, regenerate, edit & resend, continue, crash recovery after reload (Web Locks + heartbeat), auto titles.
- Full chat UI: model picker, message actions (copy, share, edit, delete, regenerate, continue), usage, fullscreen multi-line composer, Ctrl+Enter/Enter shortcut, search in titles and message content.
- Safe rich rendering: Markdown/GFM, KaTeX, syntax highlighting with copy, collapsible reasoning, incremental rendering of incomplete Markdown, XSS hardening.

### Changed
- Dexie schema v3: message parts/usage/heartbeat, conversation model + title source, encrypted provider headers and models; plaintext headers removed.

## 0.1.0

- Next.js 15 + TypeScript + App Router project with ESLint, Prettier, Vitest, Playwright.
- Material You inspired design system (light/dark/system, RTL, responsive).
- Screens: chat home, conversation, assistants (CRUD), memory (mock), settings.
- Dexie storage layer behind repository interfaces, Zod validation, versioned migrations.
- PWA: manifest, hand-written service worker, offline page, install prompt, icons.
- GitHub Actions CI: lint, typecheck, unit tests, build, Playwright (PWA + offline).

## 1.2.0 — Media & voice
- Attachments: images (worker compression/resize to WebP/JPEG, thumbnails), video (frames or native for Gemini), audio, PDFs and text files; drag & drop, paste, camera; magic-byte validation; IndexedDB or OPFS storage; per-model support check blocks unsupported sends.
- Provider formats: base64 inline, OpenAI Files (file_id), Gemini Files API (resumable upload, cached refs with expiry).
- Speech-to-text: Web Speech, OpenAI-compatible transcription, custom Whisper; record/stop/preview; transcribe or send directly; language choice.
- Text-to-speech: Web Speech, OpenAI-compatible, ElevenLabs (key encrypted locally); per-assistant voice; autoplay never/always/after voice input; sentence queue with prefetch; pause/resume/stop; Media Session.
- Image generation page: OpenAI Images, Gemini/Imagen, OpenRouter, ComfyUI (API workflow import, auto node mapping, /prompt + WebSocket progress, /view download, background resume); local gallery with download/share.
- Dexie v5 (attachment blobs, secrets, image generations, ComfyUI workflows).

## 1.3.0 — Memory (RAG), summaries, lorebooks, context manager
- Embeddings: OpenAI-compatible (OpenAI, OpenRouter, LM Studio, vLLM…), Gemini (task types), Ollama; vectors stored per model key; automatic reindex when the embedding model changes.
- Paragraph chunking (300–500 tokens, overlap), background indexing, hybrid search (cosine + BM25 with Arabic normalization/stemming) inside a Web Worker; text-search fallback; 10k benchmark in Settings → Memory.
- RAG: last user message → hybrid top-K over threshold → current window excluded → scope (global/assistant/conversation) → prompt template; "memory used" shown under each reply with the chunks.
- Memory screen: browse, search, add, edit, delete, reindex. Lorebooks with keywords (Arabic prefixes/suffixes), priority, token budget, scan depth, assistant/conversation scope.
- Rolling summaries with a cheap model; editable; manual edits are never overwritten automatically.
- ContextManager: token estimate, real usage after reply, context meter, budget order system > lorebook > memory > summary > recent, auto-summarize near the limit, tool result truncation, stable prefix for prompt caching, overflow warning.
- Dexie v6 (memoryChunks, memoryVectors, summaries, lorebooks).

## 1.4.0 — Tools, code execution, web, MCP

### Added
- ToolRegistry (name, description, JSON-Schema input, permission auto/ask/disabled, execute); per-assistant tool selection; schema conversion for OpenAI, Anthropic and Gemini.
- Agent loop: parallel tool calls, max steps (last step forces a text answer), per-tool timeout, cancel (pending calls get "cancelled" results), regenerate restarts the whole chain.
- Tool cards with live state, approval prompt (allow once / always / deny), dangerous tools always ask.
- Built-in tools: `search_memory`, `web_search`, `fetch_url`, `run_javascript`, `run_python`, `delegate_task`.
- JavaScript sandbox in a dedicated Worker (network off by default, timeout, output cap, interrupt, console capture, final value) + Run button on code blocks.
- Python via Pyodide (lazy download, virtual FS, stdout/stderr, output files) behind a `PythonProvider` interface.
- Web search: Tavily, Brave, Exa, SearXNG with ranking, blocked/excluded sites and clickable citations; `/api/fetch` server route with Readability extraction, SSRF checks on every redirect, rate limit and size/type limits.
- MCP client: Streamable HTTP and SSE, initialize, tools/list, tools/call, list_changed; headers, Bearer, OAuth 2.1 + PKCE with refresh, encrypted tokens, web and deep-link callbacks; MCP servers screen; tools exposed as `server__tool`.
- Sub-agent with a cheap model (`delegate_task`), separate context, usage records and cost tracking.
- Dexie v7: `mcpServers`, `usageRecords`.

## 1.4.2 — WebDAV backups, sync, security

### Added
- WebDAV client (PROPFIND, PUT, GET with Range, DELETE, MKCOL, MOVE), Nextcloud-compatible; retry with backoff; proxy forwards WebDAV methods (`x-nova-method`).
- Full backups: all data tables + attachment blobs (+ API keys only when encrypted) → archive with per-entry SHA-256 → gzip → 4 MB parts sealed with AES-256-GCM → manifest written last. Resumable upload and download (Range), checksum verification, schedule, keep last N, backup list with size/date/device, restore with preview, connection test.
- Incremental sync over the same WebDAV folder: per-record hash vs. synced base, tombstones (deletedAt), revisions, device ids, cursor per device, pending deltas re-sent byte-for-byte (safe retry), dedupe, offline skip, last-writer-wins, conflict log and review screen to pick a version.
- Security: nonce-based CSP via middleware, Trusted Types (report-only, optional enforce), shared CSRF guard, local audit log, Privacy & security center (stored keys, permissions, checklist, log), privacy policy page, `SECURITY.md`, `PRIVACY.md`; "Delete all data" also wipes OPFS, caches and local storage.
- Dexie v8: `syncRecords`, `syncConflicts`, `syncState`, `auditLog`.

### Changed
- Exports and backups never carry this device's WebDAV configuration; imports keep it.
- MCP session DELETE now goes through the proxy (method override).

## 1.5.0 — Android app (Capacitor)

### Added
- Android app from the same codebase (Capacitor 7, Android 8.0+): app id `app.nova.assistant`, icons, splash, status/navigation bar, deep links (MCP OAuth), back button policy, external links in the system browser, Documents/Nova exports + share sheet, mic/camera/photo permissions, keyboard resize, safe areas, rotation and tablet layouts.
- Native bridge (`src/lib/native`) with web fallbacks: filesystem, share, haptics, local notifications (reply ready, opt-in), lifecycle (resume → stream recovery, due backups/sync), network, keyboard.
- Native HTTP in the app for WebDAV, MCP, search and page reading (no CORS, no server needed); streaming stays on the WebView.
- Static export build (`npm run build:mobile`) and `/chat/view?id=` route; static sandbox workers (`/sandbox/*.js`).
- Settings → App & device: haptics, reply notifications, opt-in crash reports (redacted, local by default, `NEXT_PUBLIC_CRASH_ENDPOINT`).
- CI: Android workflow (debug APK on every build, signed APK/AAB + GitHub Release on `v*` tags), Lighthouse, bundle analyzer, JS/APK size budgets; release template, `ANDROID.md`, `TESTING.md`, `RELEASE.md`.
