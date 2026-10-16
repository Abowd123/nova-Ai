/* Nova service worker.
 *
 * Security decisions:
 *  - Only same-origin GET requests are ever cached.
 *  - /api/* is NEVER intercepted or cached (future proxy routes carry secrets).
 *  - Requests with Authorization / API-key headers or secret-looking query params bypass the SW.
 *  - Responses marked no-store/private, redirects and non-basic responses are never cached.
 *  - The SW holds no secrets and does not read IndexedDB.
 *  - Caches are versioned by build id (?v=) and old ones are deleted on activate.
 */
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const PRECACHE = `nova-precache-${VERSION}`;
const RUNTIME = `nova-runtime-${VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE_PAGES = ["/", "/chat", "/assistants", "/memory", "/settings", "/settings/providers", "/settings/data", "/settings/media", "/settings/memory", "/images"];
const PRECACHE_ASSETS = [
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
];
const MAX_RUNTIME_ENTRIES = 150;
const STATIC_ASSET_PATTERN = /\/_next\/static\/[^"'\s)\\]+/g;
const SENSITIVE_HEADERS = ["authorization", "x-api-key", "api-key", "x-goog-api-key", "anthropic-api-key"];
const SENSITIVE_PARAMS = ["key", "api_key", "apikey", "token", "access_token", "code"];

function isBypassed(request, url) {
  if (request.method !== "GET") return true;
  if (url.origin !== self.location.origin) return true;
  if (url.pathname.startsWith("/api/")) return true;
  if (url.pathname === "/sw.js") return true;
  if (SENSITIVE_HEADERS.some((header) => request.headers.has(header))) return true;
  if (SENSITIVE_PARAMS.some((param) => url.searchParams.has(param))) return true;
  if (request.cache === "no-store") return true;
  return false;
}

function isCacheable(response) {
  if (!response || !response.ok || response.type !== "basic" || response.redirected) return false;
  const cacheControl = response.headers.get("cache-control") || "";
  return !/no-store|private/i.test(cacheControl);
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - maxEntries; i += 1) await cache.delete(keys[i]);
}

async function precache() {
  const cache = await caches.open(PRECACHE);

  // Offline fallback is mandatory: install fails without it.
  const offline = await fetch(new Request(OFFLINE_URL, { cache: "reload" }));
  if (!offline.ok) throw new Error("Offline page unavailable");
  const offlineHtml = await offline.clone().text();
  await cache.put(OFFLINE_URL, offline);

  await Promise.all(
    PRECACHE_ASSETS.map(async (url) => {
      try {
        const response = await fetch(new Request(url, { cache: "reload" }));
        if (response.ok) await cache.put(url, response);
      } catch (_error) {
        /* best effort */
      }
    }),
  );

  // Precache app shell pages + every hashed asset they reference, so the shell
  // works offline right after the first visit.
  const assets = new Set(offlineHtml.match(STATIC_ASSET_PATTERN) || []);
  await Promise.all(
    PRECACHE_PAGES.map(async (path) => {
      try {
        const response = await fetch(new Request(path, { cache: "reload", credentials: "same-origin" }));
        if (!isCacheable(response)) return;
        const html = await response.clone().text();
        for (const match of html.match(STATIC_ASSET_PATTERN) || []) assets.add(match);
        await cache.put(path, response);
      } catch (_error) {
        /* best effort */
      }
    }),
  );

  await Promise.all(
    [...assets].map(async (url) => {
      try {
        const response = await fetch(url);
        if (isCacheable(response)) await cache.put(url, response);
      } catch (_error) {
        /* best effort */
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("nova-") && name !== PRECACHE && name !== RUNTIME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const cache = await caches.open(RUNTIME);
      await cache.put(request, response.clone());
      void trimCache(RUNTIME, MAX_RUNTIME_ENTRIES);
    }
    return response;
  } catch (_error) {
    const cached = await caches.match(request, { ignoreSearch: true, ignoreVary: true });
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL, { ignoreVary: true });
    return (
      offline ||
      new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) {
    const cache = await caches.open(RUNTIME);
    await cache.put(request, response.clone());
    void trimCache(RUNTIME, MAX_RUNTIME_ENTRIES);
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request, { ignoreVary: true });
  const network = fetch(request)
    .then(async (response) => {
      if (isCacheable(response)) {
        const cache = await caches.open(PRECACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);
  return cached || (await network) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (isBypassed(request, url)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }
  // Hashed, immutable build assets.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (PRECACHE_ASSETS.includes(url.pathname) || url.pathname.startsWith("/icons/")) {
    event.respondWith(staleWhileRevalidate(request));
  }
  // Everything else (RSC payloads, etc.) goes straight to the network.
});

self.addEventListener("message", (event) => {
  if (event.origin && event.origin !== self.location.origin) return;
  if (event.data && event.data.type === "SKIP_WAITING") void self.skipWaiting();
});
