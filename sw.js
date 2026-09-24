// Mobile Distributor Pro — service worker.
// Makes the app open instantly and work with no signal. Only this app's OWN files are
// cached; Firebase traffic (logins, data sync) is never touched — Firestore keeps its
// own offline copy of the data.
// Bump VERSION whenever you upload new app files so every device picks up the update.
const VERSION = 'mdp-v2.0.0';
const SHELL = [
  './', './index.html', './manifest.json', './css/app.css',
  './js/main.js', './js/app.js', './js/config.js', './js/util.js', './js/data.js', './js/ops.js', './js/ui.js',
  './js/scanner.js', './js/security.js', './js/importer.js', './js/demo-seed.js',
  './js/views/home.js', './js/views/sell.js', './js/views/stock.js', './js/views/customers.js', './js/views/customer.js',
  './js/views/dues.js', './js/views/reports.js', './js/views/expenses.js', './js/views/suppliers.js', './js/views/settings.js',
  './vendor/firebase.js', './vendor/barcode.js', './vendor/zxing_reader.wasm',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // let Firebase & other sites through untouched
  // Network first (so updates arrive when online), cache as fallback (works offline).
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
