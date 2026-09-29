// Floor Link service worker — caches the app shell so the page itself
// can load with no connection, AND handles push notifications (Firebase
// Cloud Messaging) that arrive while the app isn't open.
//
// IMPORTANT: the Firebase config below must be the exact same values as
// YOUR_FIREBASE_CONFIG in index.html. A service worker runs in its own
// isolated scope and can't read variables from the page, so these are
// duplicated here on purpose — that's normal and expected, not a bug.
// These values are safe to expose (they're not secret credentials; access
// is controlled by your Firestore rules, not by hiding this config).

importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyD_lwucPFiMylSs3G0lTYbbn_wcNwwhKg8",
  authDomain: "floor-link.firebaseapp.com",
  projectId: "floor-link",
  storageBucket: "floor-link.firebasestorage.app",
  messagingSenderId: "1002443478349",
  appId: "1:1002443478349:web:9b103544895158c3775304"
});

const NOTIF_ICON = "data:image/png;base64,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";

try {
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    console.log("[sw] background push received:", payload);
    const n = payload.notification || {};
    const title = n.title || "Floor Link";
    self.registration.showNotification(title, {
      body: n.body || "",
      icon: NOTIF_ICON,
      badge: NOTIF_ICON,
      data: payload.data || {}
    }).then(() => {
      console.log("[sw] showNotification resolved OK");
    }).catch((err) => {
      console.error("[sw] showNotification FAILED:", err);
    });
  });
} catch (e) {
  console.error("[sw] Firebase Messaging setup failed in service worker:", e);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow("./");
    })
  );
});

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
