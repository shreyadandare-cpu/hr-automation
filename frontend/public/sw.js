/*
 * The service worker that makes Wohlig One installable and opens it quickly on phones. It keeps only public files: the
 * app's scripts and styles (their names change with every build, so they are kept for good), the logos and icons, and the
 * offline page. It never keeps a page or anything from /api: personal data is never stored on the phone. A page that cannot
 * load because there is no connection shows the offline page instead.
 */
const VERSION = "wohlig-one-v1";
const SHELL = ["/offline.html", "/wohlig-smile-mark.svg", "/favicon.svg", "/app-icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const PUBLIC_FILE = /^\/(app\/assets\/|wohlig-[\w-]+\.(svg|png)$|favicon\.(svg|ico)$|app-icon-[\w-]+\.png$|apple-touch-icon\.png$)/;
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  // A page: always from the network (it may hold personal data, so it is never kept); the offline page when there is none.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
    return;
  }
  if (!PUBLIC_FILE.test(url.pathname)) return;   // the API and everything else: straight to the network
  // Scripts and styles never change under the same name: from the phone when kept. Logos and icons can change on a re-brand:
  // shown from the phone at once, and refreshed from the network for next time.
  const fixed = url.pathname.startsWith("/app/assets/");
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(req);
    const fresh = fetch(req).then((res) => { if (res.ok && res.type === "basic") c.put(req, res.clone()); return res; });
    if (hit) { if (!fixed) e.waitUntil(fresh.catch(() => {})); return hit; }
    return fresh;
  }));
});
