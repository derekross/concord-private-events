/**
 * Service worker — offline app shell + instant repeat loads.
 *
 * Strategies:
 *  - Navigations: network-first, falling back to the cached shell when
 *    offline (the app is a SPA, so the shell is the whole UI).
 *  - Vite build assets (/assets/*, content-hashed): cache-first — they never
 *    change under the same URL.
 *  - Icons / manifest / favicon: stale-while-revalidate.
 *  - Everything else (relay websockets, media servers, cross-origin): bypass.
 *
 * Bump VERSION on every deploy that changes precached behavior; old caches
 * are purged on activate.
 */

const VERSION = "v2";
const SHELL_CACHE = `seafood-boil-shell-${VERSION}`;
const RUNTIME_CACHE = `seafood-boil-runtime-${VERSION}`;

const SHELL_URLS = ["/", "/index.html", "/manifest.webmanifest", "/favicon-32.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // SPA navigations: network-first with offline shell fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put("/index.html", copy));
          }
          return response;
        })
        .catch(async () => {
          const cached =
            (await caches.match("/index.html")) || (await caches.match("/"));
          return cached || Response.error();
        })
    );
    return;
  }

  // Content-hashed build assets: cache-first, populate on miss.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
    return;
  }

  // Icons / manifest / favicon: stale-while-revalidate.
  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon-32.png"
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetched = fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
        return cached || fetched;
      })
    );
  }
});
