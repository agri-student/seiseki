/* Seiseki Service Worker — アプリ本体をキャッシュしてオフラインでも開けるようにする */
const CACHE = "seiseki-v2";
const CORE = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "byok.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 同一オリジンのGET: キャッシュを即返しつつ裏で更新(stale-while-revalidate)。
   AI各社やFirebaseへの通信には一切さわらない。 */
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const fetched = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        fetched.catch(() => {});
        return cached;
      }
      const res = await fetched;
      if (res) return res;
      if (e.request.mode === "navigate") {
        const shell = await cache.match("index.html");
        if (shell) return shell;
      }
      return Response.error();
    })()
  );
});
