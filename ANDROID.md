# Android (Capacitor)

The Android app is the same web app, exported statically and wrapped by Capacitor. No Kotlin code;
everything native goes through `src/lib/native` (web fallbacks keep the browser build independent).

## Local build
Requirements: Node 20+, JDK 21, Android Studio (SDK 35, build tools), an emulator or a device (Android 8.0+).

```bash
npm install
npm run build:mobile          # static export → ./out (API routes/middleware are set aside)
npx cap add android           # first time only (android/ is generated, not committed)
npm run android:assets        # icons + splash from ./resources
node scripts/patch-android.mjs
npx cap sync android
npx cap open android          # run from Android Studio, or:
cd android && ./gradlew assembleDebug
```

`NOVA_ANDROID_DEBUG=1 npx cap sync android` enables WebView debugging (chrome://inspect).
`NOVA_ANDROID_CLEARTEXT=1 node scripts/patch-android.mjs` allows http (LAN Ollama/ComfyUI); prefer the "proxy" transport instead (native HTTP).

## What is native
| Feature | Implementation |
| --- | --- |
| Back button | closes dialogs → history back → "press again to exit" |
| Deep links | `app.nova.assistant://oauth/callback` (MCP OAuth) |
| External links | system browser (Custom Tabs) |
| Files | exports/downloads → Documents/Nova + share sheet |
| Share | Android share sheet |
| Mic / camera / photos | WebView permission prompts (RECORD_AUDIO, CAMERA, READ_MEDIA_*) |
| HTTP | WebView fetch for streaming; native HTTP (no CORS) for WebDAV, MCP, search, page reading and "proxy" providers |
| Status/navigation bar, splash, keyboard resize, safe areas, rotation | Capacitor plugins + manifest patch |
| Haptics, local notifications (reply ready), lifecycle (resume → recovery, scheduled backup/sync), network | Capacitor plugins |

Differences from the web build: no `/api/*` server (native HTTP replaces it), no service worker (files are in the APK),
CSP via the static export has no per-request nonce, MCP legacy SSE and "proxy"-transport providers are buffered (no token streaming).

## Release signing (GitHub Actions)
Create a keystore once (keep it safe; losing it means you can't update the app):

```bash
keytool -genkeypair -v -keystore nova-release.jks -alias nova -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 nova-release.jks > nova-release.jks.b64
```

Repository → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | contents of `nova-release.jks.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | `nova` (the alias above) |
| `ANDROID_KEY_PASSWORD` | key password |

Push a tag `v1.5.0` → the Android workflow builds debug + signed release APK/AAB, uploads artifacts and creates a GitHub Release
with the APKs, `SHA256SUMS.txt` and notes from `CHANGELOG.md`. Secrets are only passed as environment variables to Gradle,
never echoed; the decoded keystore lives in the runner temp dir and is deleted at the end of the job.
Without the secrets, tags still produce a debug APK.
