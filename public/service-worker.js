const CACHE_NAME = "store-system-shell-v1";
const OFFLINE_PATH = "/offline";
const FALLBACK_PATH = "/offline-fallback.html";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const path of [OFFLINE_PATH, FALLBACK_PATH, "/manifest.webmanifest", "/icon.svg"]) {
      try {
        const response = await fetch(path, { cache: "reload" });
        if (!response.ok) continue;
        await cache.put(path, response.clone());
        if (path === OFFLINE_PATH) {
          const html = await response.text();
          const assets = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?#]+)"/g)].map((match) => match[1]);
          await Promise.allSettled(assets.map(async (asset) => {
            const assetResponse = await fetch(asset, { cache: "reload" });
            if (assetResponse.ok) await cache.put(asset, assetResponse);
          }));
        }
      } catch { /* The app can still work online if precaching is unavailable. */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("store-system-") && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/manifest.webmanifest" || url.pathname === "/icon.svg") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (url.pathname === OFFLINE_PATH && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(OFFLINE_PATH, response.clone());
        }
        return response;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const fallbackPath = url.pathname === OFFLINE_PATH ? OFFLINE_PATH : FALLBACK_PATH;
        return await cache.match(fallbackPath) ?? new Response("You’re offline. Reconnect and try again.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })());
  }
});
