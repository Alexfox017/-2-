const CACHE = "turnover-pwa-v702";

const STATIC_ASSETS = [
  "./index.html?v=702",
  "./style.css?v=702",
  "./app.js?v=702",
  "./manifest.json?v=702",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;

  const accept = req.headers.get("accept") || "";
  const isHTML = req.mode === "navigate" || accept.includes("text/html");

  if (isHTML) {
    e.respondWith((async () => {
      try {
        return await fetch(req, { cache: "no-store" });
      } catch {
        const cached =
          await caches.match("./index.html?v=702") ||
          await caches.match("./index.html");
        return cached || new Response("Офлайн. Немає кешованого index.html.", { status: 503 });
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    const fresh = await fetch(req);
    const cache = await caches.open(CACHE);
    cache.put(req, fresh.clone());
    return fresh;
  })());
});