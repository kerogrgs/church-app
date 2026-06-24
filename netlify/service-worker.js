/**
 * service-worker.js — PWA offline asset caching.
 * Caches all static assets on install, serves from cache when offline.
 * API calls to GOOGLE_SCRIPT_URL are NEVER cached — they go to offline queue.
 */

let CACHE_NAME = "sunday-app-v1.1.0"; // default fallback
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/app.js",
  "/config.js",
  "/styles.css",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&display=swap"
];

// Install: cache all static assets
self.addEventListener("install", async (event) => {
  // Fetch version info to build a cache name dynamically
  try {
    const resp = await fetch("/version.json", { cache: "no-store" });
    const data = await resp.json();
    if (data.version) {
      CACHE_NAME = `sunday-app-v${data.version}`;
    }
  } catch (e) {
    console.warn("Service Worker: Could not fetch version.json, using fallback cache name", e);
  }
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE.map((url) => {
        return new Request(url, { mode: "no-cors" });
      })).catch((err) => {
        console.warn("Service Worker: Some assets could not be cached:", err);
      });
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activate: remove old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch: serve from cache, fall through to network
self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // Never cache API calls (Google Apps Script URLs)
  if (
    url.includes("script.google.com") ||
    url.includes("googleapis.com/macros") ||
    event.request.method === "POST"
  ) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({ success: false, error: "offline" }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" }
          }
        );
      })
    );
    return;
  }

  // Serve from cache first, fall through to network
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        // Cache successful GET responses for static assets
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          event.request.method === "GET"
        ) {
          const clonedResponse = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clonedResponse);
          });
        }
        return networkResponse;
      }).catch(() => {
        // If both cache and network fail, return cached index.html for navigation
        if (event.request.mode === "navigate") {
          return caches.match("/index.html");
        }
        return new Response("Resource not available offline", {
          status: 503,
          headers: { "Content-Type": "text/plain" }
        });
      });
    })
  );
});

// Handle background sync messages
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
