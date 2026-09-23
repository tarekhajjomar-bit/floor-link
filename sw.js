// Floor Link service worker — caches the app shell so the page itself
// can load with no connection. It does NOT cache Firestore/Storage data;
// that's handled by the app's own offline queue (see saveOrQueue in index.html).

const CACHE_NAME = "floorlink-shell-v2";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Only intercept same-origin GET requests (the app shell, fonts, the
// qr-code library, etc). Everything else — and specifically every POST
// request, like photo/signature uploads to ImgBB or writes to Firestore —
// is left completely alone and goes straight to the network, untouched by
// this service worker. Intercepting cross-origin API calls here caused
// uploads to fail unpredictably (worse on mobile networks than on stable
// wifi), because a network hiccup made this worker return an invalid
// response instead of just letting the real request fail/retry normally.
self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === "navigate" || req.url.endsWith("index.html")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached || Response.error());
    })
  );
});
