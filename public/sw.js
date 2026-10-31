// Offline app shell only. Never cache receipts, user data, OCR text or external requests.
const CACHE_NAME = 'dining-split-v2.0.2';
const FILES = [
  './', './index.html', './manifest.webmanifest', './assets/icons/icon.svg',
  './assets/icons/icon-192.png', './assets/icons/icon-512.png',
  './assets/css/styles.css', './assets/js/app.js', './assets/js/storage.js',
  './assets/js/receipt.js', './assets/js/domain/money.js',
  './assets/js/domain/bill.js', './assets/js/domain/legacy.js',
  './assets/js/domain/receipt-review.js'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names
    .filter(name => name.startsWith('dining-split-') && name !== CACHE_NAME)
    .map(name => caches.delete(name)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
});
