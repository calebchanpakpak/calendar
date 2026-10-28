/* Calendar V3 service worker (same pattern as Vault V3's sw.js)
 * - Install: pre-caches the whole app shell in one go, so old and new files never mix.
 * - Open: shell is cache-first (opens instantly, also in flight mode); data comes from IndexedDB.
 * - Update: change any shell file -> bump the r-number in CACHE -> the page shows "New version · Update".
 * - Other origins (script.google.com API): never intercepted or cached.
 * - Same github.io origin as Vault: this worker's scope is /calendar/ and it only ever deletes 'calendar-' caches.
 * - No Background Sync: iOS has none; the app syncs when opened / back online / returning / every 10 min.
 */
const CACHE = 'calendar-v3-shell-r2';
const SHELL = ['./', './index.html', './idb.js', './festivals.js', './sync.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
  // no automatic skipWaiting: the page asks first (no surprise reload while typing); a first install is active at once
});
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('calendar-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL('./', self.location).pathname;
  if (!url.pathname.startsWith(scope)) return;                // never touch Vault's paths
  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname === scope;
  const key = isPage ? './index.html' : req;
  event.respondWith(
    caches.open(CACHE).then(c => c.match(key, { ignoreSearch: true })).then(hit => hit || fetch(req).then(res => {
      if (res.ok && res.type === 'basic' && !isPage) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
