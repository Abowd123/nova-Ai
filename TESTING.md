# Test & release plan

## Automated (CI)
| Layer | Command | Where |
| --- | --- | --- |
| Lint / types | `npm run lint`, `npm run typecheck` | CI, Android |
| Unit (Vitest) | `npm test` | CI, Android |
| E2E (Playwright, Chromium) | `npm run test:e2e` | CI (`build-e2e`) |
| Lighthouse (perf, a11y, best practices) | `lighthouserc.json` | CI (`build-e2e`) |
| Bundle analyzer | `npm run analyze` → `.next/analyze` | CI on PRs |
| Size budget (JS, APK) | `npm run size:report` | CI, Android |
| APK build (debug, signed release on tags) | `.github/workflows/android.yml` | Android |

## Manual matrix (before each release)
Mark ✅ / ❌ / n/a. Devices: Android phone (8.0 and 14+), Android tablet, emulator (API 26 and 35).

| Area | Chrome | Firefox | Safari (macOS/iOS) | PWA installed | Android app | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| First run, add provider, chat streaming | | | | | | stop/continue/regenerate |
| Offline: app opens, history readable, send queues an error | | | | | | airplane mode |
| Resume: background 5 min during a reply → recovered/interrupted | | | | | | |
| Attachments: image/PDF/audio/video, file picker | | | | | | large file > 50 MB |
| Microphone (STT), camera capture | | | | | | permission denied path |
| TTS read-aloud | | | | | | |
| Tools: JS sandbox, Pyodide first download, web search, fetch_url | | | | | | |
| MCP: Streamable HTTP, OAuth sign-in (deep link in app) | | | | | | |
| WebDAV: test, backup, drop network mid-upload → resume, restore | | | | | | Nextcloud |
| Sync two devices, conflict review | | | | | | |
| Back button (dialogs, history, exit) | n/a | n/a | n/a | | | |
| Rotation / tablet layout / keyboard over composer | | | | | | |
| Dark mode, RTL (ar) and LTR (en) | | | | | | |
| Share sheet, export file location | | | | | | Documents/Nova |
| Notifications (reply ready in background) | | | | | | opt-in |
| Delete all data → clean state | | | | | | |

## Performance targets
Lighthouse desktop: performance ≥ 0.8, accessibility ≥ 0.9. JS chunks ≤ 3.5 MB total, APK ≤ 40 MB (`NOVA_JS_BUDGET_KB`, `NOVA_APK_BUDGET_MB`).
