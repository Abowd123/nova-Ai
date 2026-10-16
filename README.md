# Nova

مساعد ذكاء اصطناعي **Local-first** متعدد المزودين، يعمل كموقع ويب و**PWA** قابل للتثبيت، ثم يُغلَّف لاحقاً كتطبيق Android عبر Capacitor، كل ذلك من قاعدة كود واحدة.

> **الإصدار الحالي: 1.0** (المرحلة 2: المحادثة والمزودون وStreaming).
> المرحلة 1 (0.1): Web shell + PWA + Dexie + CI.

## الستاك

| الطبقة | التقنية |
| --- | --- |
| الإطار | Next.js 15 (App Router) + TypeScript (strict) |
| الواجهة | Tailwind CSS 3.4 + shadcn/ui (Radix UI) + lucide-react |
| الحالة | TanStack Query (بيانات التخزين) + Zustand (حالة الواجهة) |
| التخزين | IndexedDB عبر Dexie 4، مع Zod للتحقق |
| الأسرار | Web Crypto (AES-GCM-256، مفتاح غير قابل للاستخراج) |
| العرض | react-markdown + remark-gfm + remark-math + KaTeX + highlight.js + rehype-sanitize |
| السمات | next-themes (فاتح/داكن/النظام) |
| الاختبارات | Vitest + Testing Library + fake-indexeddb، وPlaywright |
| الجودة | ESLint 9 (flat) + Prettier |
| CI | GitHub Actions |

## المتطلبات

- Node.js **20.11+** (يُفضَّل 22، انظر `.nvmrc`)
- npm 10+

## البدء السريع

```bash
npm install
cp .env.example .env.local
npm run dev            # http://localhost:3000
```

> بعد أول `npm install` اعمل commit لملف `package-lock.json`. الـ CI يستخدم `npm ci` عند وجوده.

## الأوامر

| الأمر | الوظيفة |
| --- | --- |
| `npm run dev` | خادم التطوير (الـ Service Worker معطّل في dev افتراضياً) |
| `npm run build` / `npm start` | بناء الإنتاج وتشغيله على المنفذ 3000 |
| `npm run lint` | ESLint |
| `npm run format` / `format:check` | Prettier |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | اختبارات الوحدة (Vitest) |
| `npm run test:coverage` | اختبارات الوحدة مع التغطية |
| `npm run test:e2e:install` | تنزيل Chromium لـ Playwright (مرة واحدة) |
| `npm run test:e2e` | Playwright (يبني نسخة إنتاج ثم يشغّلها تلقائياً) |
| `npm run validate` | lint + typecheck + test + build |

## متغيرات البيئة

كلها موثقة في `.env.example` ويتم التحقق منها بـ Zod في `src/env.ts` (عامة) و`src/env.server.ts` (للخادم فقط). أي قيمة غير صالحة توقف البناء برسالة واضحة.

| المتغير | الافتراضي | الوصف |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_NAME` | `Nova` | اسم التطبيق |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | الرابط العام |
| `NEXT_PUBLIC_ENABLE_SW` | `auto` | `auto` (إنتاج فقط) / `always` / `never` |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | `ar` | لغة البداية |
| `NEXT_PUBLIC_BUILD_ID` | تلقائي | يُستخدم لإصدار كاش الـ SW (CI يأخذه من `GITHUB_SHA`) |

متغيرات الخادم فقط (لا تصل للمتصفح): `NOVA_PROXY_ENABLED`، `NOVA_PROXY_ALLOW_PRIVATE`، `NOVA_PROXY_ALLOWED_HOSTS`، `NOVA_PROXY_RATE_LIMIT` (انظر `.env.example`).

**لا تضع مفاتيح API في متغيرات البيئة.** المفاتيح BYOK وتُخزَّن مشفّرة على الجهاز.

## بنية المجلدات

```
src/
  app/                    # المسارات (App Router)
    (app)/                # الشاشات داخل AppShell: chat, chat/[id], assistants, memory, settings
    offline/              # صفحة انقطاع الشبكة
    api/health/           # فحص الحياة (لا يُخزَّن أبداً)
    api/proxy/            # Proxy آمن للمزودين (SSRF/CSRF/rate limit)
    manifest.ts           # Web App Manifest
  components/
    ui/                   # Design system: Button, Card, Dialog, Sheet, Toast, Input, ...
    feedback/             # EmptyState, LoadingState, ErrorState, ConfirmDialog, PageHeader
    layout/               # AppShell, NavRail, BottomNav, TopBar, SkipLink, ThemeToggle
    providers/            # Providers, RepositoryProvider, LocaleSync
  features/               # منطق كل ميزة: conversations, chat (engine/), providers, assistants, memory, settings, pwa
  components/markdown/    # العرض الغني الآمن
  lib/
    ai/                   # Provider SDK: types, errors, sse, retry, http, adapters/, catalog/
    crypto/               # Secret vault (Web Crypto)
    security/             # redact, ssrf, rate-limit
    models/               # نماذج البيانات + مخططات Zod (مستقلة عن التخزين)
    storage/              # واجهات Repository + أخطاء + تنفيذ Dexie + migrations + seed
    i18n/                 # القواميس (ar/en) والاتجاه
  stores/                 # Zustand
  hooks/
public/
  sw.js                   # Service worker مكتوب يدوياً
  icons/                  # أيقونات PWA (any + maskable)
tests/
  unit/                   # Vitest
  e2e/                    # Playwright
```

## قرارات معمارية

1. **فصل الطبقات:** الواجهة لا تستورد Dexie أبداً. تعتمد فقط على `Repositories` في `src/lib/storage/types.ts` عبر `RepositoryProvider`، فيمكن استبدال التخزين (in-memory، مزامنة) دون لمس الواجهة.
2. **النماذج منفصلة عن التخزين:** `src/lib/models` يعرّف الأنواع ومخططات Zod؛ كل كتابة تمر بتحقق strict، وكل قراءة تتحقق دفاعياً (السجلات التالفة تُتخطى في القوائم).
3. **Migrations مُرقّمة:** `src/lib/storage/dexie/migrations.ts`. لا تعدّل إصداراً منشوراً؛ أضف إصداراً جديداً مع `upgrade()`.
4. **أخطاء IndexedDB موحدة:** `StorageError` بأكواد ثابتة (`QUOTA_EXCEEDED`, `UNAVAILABLE`, `VERSION_CONFLICT`, ...) تُترجم لرسائل مفهومة دون تسريب نص الخطأ الخام.
5. **RTL أولاً:** خصائص منطقية (`ms-`, `pe-`, `start-`, `end-`)، `dir="auto"` للنصوص المختلطة، وسكربت إقلاع يضبط `lang/dir` قبل أول رسم.
6. **Responsive حسب Material 3:** شريط سفلي للهاتف، Navigation Rail للتابلت، وRail + Sidebar ثابت لسطح المكتب.

## المرحلة 2: المحادثة والمزودون

### المعمارية

```
UI (React)  ──>  ChatService (src/features/chat/engine)  ──>  ChatProvider interface (src/lib/ai)
   │                 │  builds ChatRequest, streams ChatEvents,          ├─ OpenAICompatibleProvider
   │                 │  persists partial output, stop/regenerate/        │    ├─ OpenAI / OpenRouter / Custom
   │                 │  edit/continue, crash recovery                    ├─ AnthropicProvider
   │                 ▼                                                   ├─ GeminiProvider
   │            Repositories (Dexie)                                     └─ OllamaProvider
   └── useStreamingStore (Zustand): one entry per streaming message
```

- **نماذج موحّدة** (`src/lib/ai/types.ts`, `src/lib/models/message-part.ts`): `ChatRequest`, `ChatMessage`, `ChatEvent`, `ModelInfo`, `ProviderCapabilities`, `TokenUsage` (`inputTokens/outputTokens/cachedTokens/totalTokens`) و`MessagePart` (Text, Image, Audio, Video, ToolCall, ToolResult, Reasoning).
- **كل مزود Adapter منفصل** يترجم الصيغة الموحّدة إلى صيغة المزود. الواجهة لا تعرف أي صيغة.
- **Streaming:** محلل SSE تزايدي (يدعم CRLF وتقطيع القطع في أي مكان) ومحلل NDJSON لـ Ollama.
- **الإيقاف:** `AbortController` يصل حتى قارئ الـ stream.
- **المهلات:** مهلة لوصول الـ headers (من الإعدادات، 60 ثانية افتراضياً) ومهلة صمت بين القطع (90 ثانية).
- **Retry/backoff:** أُسّي مع jitter ويحترم `Retry-After`، ويُعاد **قبل** بدء البث فقط حتى لا يتكرر المحتوى. يُعاد في 408/429/5xx وأخطاء الشبكة، ولا يُعاد في 401/403/404/400.
- **الحفظ أثناء البث:** يُحفظ الجزء المكتمل كل 500ms مع `heartbeatAt`. الواجهة تتحدث مرة كل إطار (rAF) وفقط فقاعة الرسالة الجارية تعيد الرسم.
- **الاستئناف الآمن:** كل بث يمسك قفل Web Locks باسم الرسالة. عند إعادة التحميل تتحول الرسائل العالقة إلى `interrupted` مع إبقاء النص الجزئي، مع خياري **متابعة** أو **إعادة توليد**. البث الجاري في تبويب آخر لا يُلمس. إذا لم يتوفر Web Locks نعتمد على heartbeat.
- **العنوان التلقائي:** عنوان فوري من أول رسالة، ثم يقترح النموذج عنواناً قصيراً بعد أول رد (يمكن تعطيله). العنوان اليدوي لا يُستبدل أبداً.

### المزودون

| المزود | الصيغة | المصادقة | يعمل مباشرة من المتصفح؟ |
| --- | --- | --- | --- |
| OpenAI | `/chat/completions` SSE | `Authorization: Bearer` | نعم |
| Anthropic | `/messages` SSE | `x-api-key` + `anthropic-dangerous-direct-browser-access` | نعم |
| Gemini | `:streamGenerateContent?alt=sse` | `x-goog-api-key` (ليس في الرابط) | نعم |
| OpenRouter | OpenAI-compatible | Bearer | نعم |
| Ollama | `/api/chat` NDJSON | لا يوجد (أو Bearer) | يحتاج `OLLAMA_ORIGINS` (انظر أدناه) |
| Custom | OpenAI-compatible | Bearer اختياري + Headers | حسب إعدادات CORS للخادم |

**Ollama من المتصفح:** شغّله مع السماح بأصل Nova، مثلاً:
`OLLAMA_ORIGINS="http://localhost:3000" ollama serve`.

**Proxy:** إذا منع مزود ما طلبات المتصفح (CORS) اختر «عبر خادم Nova». الطلب يمر عبر `/api/proxy` (Node runtime) مع:
حماية SSRF (https فقط، رفض العناوين الخاصة/loopback/link-local حتى بعد DNS)، عدم تتبع redirects، allowlist اختيارية،
rate limiting لكل IP، ترويسة `x-nova-proxy` + فحص Origin ضد CSRF، حد 20MB للجسم، ولا تسجيل ولا تخزين لأي شيء.

**الكتالوج:** `src/lib/ai/catalog/models.json` يحتوي على: provider, name, modelId, baseUrl, contextWindow, vision, audio, video, tools, reasoning, inputCost, outputCost.
الأسعار تقريبية (USD لكل مليون توكن) وتتغير باستمرار، تحقق منها لدى المزود. النماذج المجلوبة من المزود تتقدم على الكتالوج.

### الأمان في المرحلة 2

- **مفاتيح API والـ Headers تُشفَّر دائماً** بـ AES-GCM-256 (`src/lib/crypto/vault.ts`). المفتاح الرئيسي يُولَّد بـ `extractable: false` ويُخزَّن في IndexedDB كـ CryptoKey، فلا يستطيع أي JavaScript قراءة بايتاته. كل سرّ له IV جديد، ومربوط بسياقه (provider + field) عبر AAD فلا يمكن نقله لمزود آخر.
- **حدود هذا التشفير (بصراحة):** يحمي من قراءة البيانات خارج الجهاز (تصدير، نسخ احتياطي، نسخ ملفات المتصفح). لا يحمي من كود خبيث يعمل داخل الصفحة نفسها (XSS) لأنه يستطيع طلب فك التشفير. لهذا العرض الغني معقّم بالكامل، وتأتي CSP في المرحلة 7.
- مخطط Zod للمزوّد **يرفض** أي حقل `apiKey` أو `headers` بنص مكشوف. migration v3 يحذف أي headers قديمة غير مشفرة.
- `redactSecrets` يزيل المفاتيح (OpenAI/Anthropic/OpenRouter/Gemini/Bearer/`key=`) من كل الأخطاء والسجلات. `logger` هو المسجّل الوحيد المسموح ويمر كل شيء عبره.
- الواجهة لا تعرض المفتاح بعد الحفظ أبداً، ولا قيم الـ Headers المحفوظة.
- الطلبات المباشرة تُرسل بـ `credentials: "omit"` و`referrerPolicy: "no-referrer"`.

### العرض الغني الآمن

- Markdown (GFM: جداول قابلة للتمرير، قوائم مهام، شطب، حواشٍ)، LaTeX inline/block عبر KaTeX (`trust: false`)، تلوين الأكواد مع اسم اللغة وزر نسخ لكل كتلة.
- **منع XSS:** لا HTML خام إطلاقاً (`skipHtml`)، ثم `rehype-sanitize` بمخطط GitHub قبل KaTeX/highlight، ثم فحص الروابط (http/https/mailto/#) والصور (http/https فقط) مع فك ترميز الكيانات وإزالة المحارف الخفية (`java\tscript:` و`&#106;avascript:`).
- **أثناء البث:** يُقسم النص إلى كتل؛ الكتل المكتملة memoized وتُحلَّل الكتلة الأخيرة فقط، مع إصلاح Markdown غير المكتمل (code fences و`$$` و`**` والروابط المعلّقة).
- **الاتجاه المختلط:** `dir="auto"` و`unicode-bidi: plaintext` لكل فقرة؛ الأكواد والمعادلات دائماً LTR.
- قسم Reasoning قابل للطي، مفتوح أثناء التفكير.

## قرارات PWA والأمان

- **Service worker يدوي** (`public/sw.js`) بدل مكتبة، لتحكم كامل وسطح أصغر.
- يخزّن فقط طلبات **GET من نفس الأصل**. **لا يعترض أبداً** `/api/*`، ولا الطلبات التي تحمل `Authorization`/`x-api-key`، ولا روابط فيها `token`/`key`/`code`.
- لا يخزّن ردوداً عليها `no-store`/`private` أو redirect.
- لا يحمل أي أسرار ولا يقرأ IndexedDB.
- الكاش مُصدَّر بـ build id (`/sw.js?v=<id>`) ويُحذف القديم عند التفعيل. `sw.js` نفسه يُقدَّم بـ `no-store`.
- الاستراتيجيات: Network-first للصفحات مع fallback للكاش ثم `/offline`؛ Cache-first لأصول `/_next/static` (hashed)؛ Stale-while-revalidate للأيقونات والـ manifest.
- عند التثبيت يخزّن صفحات الـ shell وكل الأصول التي تشير إليها، فيعمل التطبيق دون اتصال من أول زيارة.
- Headers أمان: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `COOP`, `Permissions-Policy`. (CSP الكاملة مع nonces في المرحلة 7.)
- مخطط المزوّد **يرفض** أي حقل `apiKey` نصي؛ المسموح فقط `encryptedApiKey` بصيغة AES-GCM.
- "حذف كل البيانات المحلية" في الإعدادات يمسح كل جداول IndexedDB.

## الاختبارات

**المرحلة 2 (وحدة):** محلل SSE/NDJSON (تقطيع عند كل حرف)، كل Adapter (شكل الطلب، الـ headers، البث، reasoning، tool calls، usage)، خرائط أخطاء 400/401/403/404/408/429/5xx، retry/backoff وRetry-After، الإلغاء، مهلة الـ headers ومهلة الصمت، الكتالوج، الـ vault (IV جديد، AAD، كشف التلاعب، مفتاح غير قابل للاستخراج)، إخفاء الأسرار، SSRF وrate limit، ChatService (بث، حفظ جزئي، إيقاف، متابعة، إعادة توليد، تعديل، أخطاء، استرداد بعد إعادة التحميل، أقفال)، ProviderService، Markdown غير المكتمل، الروابط الآمنة، والعرض الغني مع حمولات XSS.

**المرحلة 2 (E2E):** مزود وهمي عبر `page.route`: إضافة واختبار وجلب نماذج وتعطيل وحذف مزود، التحقق من عدم وجود المفتاح بنص مكشوف في IndexedDB/localStorage/Cache، بث رد غني وحفظه بعد reload وعنوان تلقائي، إعادة التوليد والتعديل والحذف، زر الإيقاف، خطأ 401 دون تسريب المفتاح، حقل الإدخال (أسطر متعددة، ملء الشاشة، نسخ)، البحث والتثبيت وإعادة التسمية.

**وحدة (Vitest):** CRUD للمحادثات والرسائل والمساعدين والمزودين والوسوم والمرفقات والإعدادات، migration من v1 إلى v2، البيانات غير الصالحة والتالفة، تحويل أخطاء IndexedDB، env، i18n، سكربت الإقلاع، ومكونات الواجهة (حالات loading/error/empty وتنقل لوحة المفاتيح RTL).

**E2E (Playwright، على نسخة إنتاج):** smoke والتنقل، skip link، إنشاء محادثة وحفظ رسالة بعد reload، تبديل اللغة والسمة، CRUD للمساعد، Sheet على الجوال، صحة الـ manifest والأيقونات، تسجيل الـ SW، **قابلية التثبيت عبر CDP** (`Page.getInstallabilityErrors`)، عدم تخزين `/api` والروابط الحساسة، وفتح التطبيق **دون اتصال**.

## الاختبار اليدوي (المرحلة 2)

1. الإعدادات ← المحادثة ← **المزودون** ← إضافة مزود. اختر النوع وأدخل المفتاح.
2. **اختبار الاتصال** ثم **جلب النماذج**. فعّل/عطّل نماذج وحدد النموذج الافتراضي.
3. DevTools ← Application ← IndexedDB ← nova ← providers: المفتاح يظهر كـ `ciphertext` فقط. ابحث عن المفتاح في localStorage وCache Storage: لا شيء.
4. محادثة جديدة: اكتب رسالة واضغط Ctrl+Enter (أو Enter حسب الإعداد). لاحظ البث التدريجي والعنوان التلقائي.
5. اطلب «جدول + كود TypeScript + معادلة $$\int x\,dx$$». تحقق من التمرير الأفقي للجدول، اسم اللغة، زر النسخ، وKaTeX.
6. أثناء البث اضغط **إيقاف**: يبقى النص الجزئي مع «تم الإيقاف» وزر **متابعة**.
7. أثناء البث أعد تحميل الصفحة: بعد التحميل تظهر الرسالة «انقطع الرد» مع النص الجزئي. اضغط متابعة.
8. **إعادة التوليد**، **تعديل** رسالة المستخدم (تُحذف الردود التالية ويُعاد الإرسال)، **نسخ**، **مشاركة**، **حذف**.
9. غيّر النموذج من القائمة في رأس المحادثة. بحث المحادثات يطابق العناوين ومحتوى الرسائل.
10. أدخل مفتاحاً خاطئاً: يظهر «مفتاح API غير صالح (401)» دون إظهار المفتاح، مع زر للمزودين.
11. افصل الشبكة وأرسل: «تعذّر الاتصال بالمزود»، والرسائل السابقة باقية.
12. على الجوال: زر ملء الشاشة لحقل الإدخال، والقائمة الجانبية كـ Sheet.

## الاختبار اليدوي (المرحلة 1)

1. `npm run build && npm start` ثم افتح http://localhost:3000 في Chrome.
2. DevTools ← Application ← Manifest: لا أخطاء، والأيقونات تظهر (بما فيها maskable).
3. Application ← Service Workers: `sw.js?v=...` بحالة activated.
4. اضغط زر **تثبيت Nova** في الشريط العلوي أو من الإعدادات.
5. أنشئ بيانات تجريبية من الشريط الجانبي، افتح محادثة، اكتب رسالة واضغط Ctrl+Enter، ثم أعد التحميل: الرسالة باقية.
6. Network ← Offline ثم أعد التحميل: الواجهة تعمل، ويظهر شريط "أنت غير متصل". افتح `/chat/xyz`: تظهر صفحة offline.
7. الإعدادات: بدّل English/العربية ولاحظ تغيّر الاتجاه؛ بدّل الفاتح/الداكن/النظام.
8. لوحة المفاتيح فقط: Tab يبدأ بـ "تخطَّ إلى المحتوى"، `/` يركّز البحث، الأسهم تتنقل بين خيارات الإعدادات، Esc يغلق النوافذ.
9. DevTools Device Toolbar: جرّب 375px (شريط سفلي)، 820px (Rail + Sheet)، 1280px (Sidebar ثابت).
10. Lighthouse ← PWA + Accessibility.

## خارطة الإصدارات

| الإصدار | المحتوى |
| --- | --- |
| **0.1** | Web shell + PWA + Dexie + CI ← *هنا* |
| 1.0 | المحادثة والمزودون وStreaming |
| 1.1 | المساعدون وTags والاستيراد والتصدير وQR |
| 1.2 | الصور والفيديو والصوت وTTS وSTT وتوليد الصور |
| 1.3 | RAG وLorebooks وإدارة السياق |
| 1.4 | Tools وPython وWeb Search وMCP وSubagents |
| 1.4.2 | WebDAV والمزامنة والأمان |
| 1.5 | Capacitor APK وGitHub Releases |


## Phase 3 (1.1): Assistants, tags, import/export, QR

- **Assistants**: `/assistants`. Editor tabs: General, Model, Tools, Voice, Memory. Prompt variables `{{date}} {{time}} {{user_name}} {{model}} {{device_language}}`. Tools/voice/memory settings are stored now and take effect in 1.2–1.4.
- **Tags**: "Manage tags" on the assistants screen. Filters live in the URL (`?q=...&tags=id1,id2`, AND logic).
- **Backup & import**: `/settings/data`. Plain JSON or password-encrypted (`nova-export-encrypted`). Merge (duplicate / overwrite / skip) or replace. API keys are exported only inside encrypted files and are re-encrypted with the device vault on import.
- **QR**: Providers → "Share QR" / "Scan QR". Frames: `NV1 + session(6) + index(2) + total(2) + dataCRC(8) + partCRC(8) + Base45`. Without camera, use "Paste codes as text".

### Security notes
- Unencrypted exports never contain keys or ciphertexts.
- Including an API key in a QR requires two explicit toggles and shows a warning.
- Imported avatars are limited to PNG/JPEG/WebP data URLs (no SVG).

### Manual test (Phase 3)
1. Create two tags and two assistants, assign tags, filter by both tags, reload: filter persists.
2. Start a chat from an assistant: starters appear; switch assistant from the picker.
3. Export encrypted with keys, clear data, import with the password: assistants and working keys return.
4. Share a provider via QR to a second device (or paste the text), confirm it is added without a key by default.

## Phase 4 (1.2) — Media, voice, images
Settings → Media & voice (`/settings/media`) controls image compression, video mode, storage, STT and TTS engines. Image generation lives at `/images`.

**ComfyUI:** start with `python main.py --enable-cors-header`, export your workflow with *Save (API Format)*, import it in /images → Add ComfyUI workflow, check the auto-detected mapping.

**Security:** binaries never leave the device except to the provider you send to; ElevenLabs key is AES-GCM encrypted (non-extractable key) and never shown again; provider error texts are redacted.

**Manual tests:** attach image to a vision model → sent; attach to a text-only model → send blocked with a reason; record voice → preview → transcribe; press "Read aloud" on a reply → pause/resume/stop; generate an image → appears in gallery after reload; ComfyUI job survives a page reload.

## Phase 5 (1.3): Memory and context
Settings → Memory (`/settings/memory`): enable memory, pick the embedding provider/model, top-K, threshold, token budget and the prompt template; run the 10k benchmark. Memory screen (`/memory`): browse/search/add/delete memories, reindex, manage lorebooks. In a chat: the context meter shows usage vs. the model window; the summary button opens the editable summary.

**Manual tests:** tell the assistant a fact, open a new chat and ask about it → the reply shows "memory used"; switch the embedding model → reindex runs; add a lorebook entry with an Arabic keyword and mention it with a prefix (e.g. "وبالمكتبة") → it is injected; edit a summary → it is not overwritten by the next automatic update; fill a small-window model → warning before overflow.

## Phase 6 (1.4): Tools, code, web and MCP
Settings → Tools (`/settings/tools`): per-tool permission (auto / ask / disabled), max steps, timeout, parallel calls, JS sandbox limits, Python (Pyodide index URL; downloaded on first use from the CDN, change it to self-host), search provider + keys (Tavily / Brave / Exa, or a SearXNG URL), blocked sites, sub-agent model. Settings → MCP (`/settings/mcp`): add servers (Streamable HTTP or SSE), headers, Bearer token or OAuth sign-in, enable/disable individual tools. In the assistant editor → Tools tab pick which tools (and which MCP servers) the assistant may use.

Server env (fetch route): `NOVA_FETCH_ENABLED` (default true), `NOVA_FETCH_RATE_LIMIT` (requests/minute per client), `NOVA_FETCH_BLOCKED_HOSTS` (comma-separated). `fetch_url` needs the Next.js server; in a static/APK build without a server it reports that it is unavailable.

**Security:** dangerous tools (code, destructive MCP tools) can never be set to auto; tool keys and MCP tokens are stored encrypted and never logged; the JS sandbox runs on a separate origin path with a strict CSP and no network unless enabled; the fetch route blocks private/loopback/link-local addresses on every redirect hop. The sandbox memory limit is best-effort (the browser does not enforce worker heap limits); timeouts terminate the worker.

**Manual tests:** ask "what is 17^23? use JavaScript" → approval card → result card with the value; press Run on a code block; enable Python and run `import numpy; print(numpy.arange(5))` (first run downloads Pyodide); add a Tavily key and ask about today's news → citations are clickable; ask it to read a URL → page summary; try `http://127.0.0.1` → blocked; add an MCP server (e.g. a local Streamable HTTP server) → tools appear as `server__tool`, call one; set max steps to 1 → the model answers in text after one tool round; press stop while a tool runs → card shows cancelled.

## Phase 7 (1.4.2): WebDAV backup, sync and security
Settings → Backup & sync (`/settings/backup`): WebDAV URL (Nextcloud: `https://SERVER/remote.php/dav/files/USER/`, use an app password), "Route through the Nova server" for servers without CORS, encryption passphrase, connection test, back up now / resume, schedule, keep last N, list, restore, delete; sync toggle, interval, sync now, conflict review. Settings → Privacy & security (`/settings/security`): checklist, stored keys, tool permissions, event log. Privacy policy: `/privacy`, `PRIVACY.md`; security notes: `SECURITY.md`.

Remote layout: `<folder>/backups/<id>/part-*.bin + manifest.json` and `<folder>/sync/{key.json, devices/<id>/*.delta, blobs/*}`.

Server env: `NOVA_CSP` (strict | report-only | off), `NOVA_TRUSTED_TYPES` (report | enforce | off), `NOVA_STATIC_EXPORT=1` for static builds (no middleware/nonce).

**Manual tests:** connect to Nextcloud → Test shows all 5 steps; Back up now → backup listed (encrypted); turn Wi-Fi off mid-upload → "Resume upload" continues without re-sending finished parts; restore on a second browser with the passphrase (wrong passphrase rejected); enable sync on two browsers, edit the same conversation title on both → conflict appears, pick the other version → propagates; delete a message on one → disappears on the other; check DevTools → Network: CSP header on `/`, no API key strings in WebDAV files; Delete all data → Application panel empty.

## Phase 8 (1.5): Android app
Build the APK locally or in CI: see `ANDROID.md` (commands, native features, release signing secrets). Test matrix: `TESTING.md`. Release steps: `RELEASE.md`.

Env: `NEXT_PUBLIC_CRASH_ENDPOINT` (optional https endpoint for opt-in crash reports), `NOVA_ANDROID_DEBUG`, `NOVA_ANDROID_CLEARTEXT`, `NOVA_JS_BUDGET_KB`, `NOVA_APK_BUDGET_MB`, `ANALYZE=true` (bundle analyzer).

**Manual tests (app):** install the debug APK → splash then chat; back button closes a dialog, goes back, and asks before exiting; open a link in a reply → system browser; export data → saved to Documents/Nova and share sheet opens; record voice and take a photo (permission prompts); rotate on a tablet; enable "Notify when a reply is ready", send a long prompt and switch apps → notification opens the conversation; airplane mode → app still opens with history; WebDAV backup works without "Route through the Nova server" (native HTTP).
