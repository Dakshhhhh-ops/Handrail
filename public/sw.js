/* Handrail service worker: makes the app open and work with no connection.
   - On install, it caches the page and every built file the page references, so the app
     works offline straight after the first visit (not only after a second one).
   - Pages: network first, so updates arrive; offline, the cached page is used. Only a
     successful response for the app's own page is cached, never an error page.
   - Built files (hashed names): cache first, since they never change.
   - The page also sends the files it loaded (lazy chunks, fonts), which are cached too. */
const CACHE = 'handrail-v2';
const SCOPE = new URL(self.registration.scope);

function isAppPage(url) {
  return url.origin === SCOPE.origin && (url.pathname === SCOPE.pathname || url.pathname === `${SCOPE.pathname}index.html`);
}

async function cacheIfOk(cache, url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (res.ok) await cache.put(url, res);
  } catch {
    /* offline or blocked: skip it */
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const page = await fetch('./', { cache: 'no-cache' });
    if (!page.ok) return;
    await cache.put('./', page.clone());
    const html = await page.text();
    const refs = [...html.matchAll(/(?:src|href)="([^"#?]+)"/g)].map((m) => new URL(m[1], SCOPE).href);
    const files = [...new Set([...refs, new URL('manifest.webmanifest', SCOPE).href, new URL('favicon.svg', SCOPE).href])]
      .filter((u) => new URL(u).origin === SCOPE.origin);
    await Promise.all(files.map((u) => cacheIfOk(cache, u)));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// The page lists the files it has loaded, so lazily loaded parts work offline too.
self.addEventListener('message', (event) => {
  const urls = event.data && event.data.type === 'cache' && Array.isArray(event.data.urls) ? event.data.urls : [];
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const u of urls.slice(0, 200)) {
      const url = new URL(u, SCOPE);
      if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) continue;
      if (!(await cache.match(url.href))) await cacheIfOk(cache, url.href);
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && isAppPage(url)) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./', copy));
          }
          return res;
        })
        .catch(() => caches.match('./').then((hit) => hit || caches.match('./index.html'))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
