// sw.js — Service Worker for 台灣廣播 Radiolist
// Version: bump this string to force cache refresh
const CACHE_NAME = 'tw-radio-v1';

// App shell files to cache immediately on install
const PRECACHE = [
  './',
  './index.html',
  'https://cdn.jsdelivr.net/npm/hls.js@latest',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=Space+Mono&display=swap',
];

// ── Install: pre-cache app shell ────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Use individual adds so one failure doesn't break everything
      return Promise.allSettled(
        PRECACHE.map(url => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ──────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network-first for streams, cache-first for app shell ─
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Always network-only for audio streams (never cache)
  if (
    url.includes('rcs.revma.com') ||
    url.includes('pbs.gov.tw') ||
    url.includes('ginnet.cloud') ||
    url.includes('radiojar.com') ||
    url.includes('.m3u8') ||
    url.includes('.m4a') ||
    url.includes('.mp3') ||
    url.includes(':8000') ||
    url.includes(':8080') ||
    url.includes(':8081') ||
    url.includes(':1935')
  ) {
    // Don't intercept stream requests — let them go directly
    return;
  }

  // Cache-first for app shell (HTML, fonts, scripts)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        // Only cache successful GET requests
        if (
          event.request.method === 'GET' &&
          response.status === 200 &&
          response.type !== 'opaque'
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback: return cached index.html for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});
