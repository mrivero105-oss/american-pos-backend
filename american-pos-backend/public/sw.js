/**
 * Isaac POS Mobile Service Worker
 * Strategy: Cache-First for App Shell & Static Assets, Network-First for APIs
 */

const CACHE_NAME = 'isaac-pos-24.4.0.1795325914';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/logo.png',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(() => {});
    })
  );
});

const PRESERVED_CACHES = new Set([CACHE_NAME, 'isaac-pos-img-v1']);

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => !PRESERVED_CACHES.has(name))
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip WebSocket, API mutations, and non-GET requests
  if (event.request.method !== 'GET' || url.pathname.startsWith('/socket.io/')) {
    return;
  }

  // Static Assets & Media: Stale-While-Revalidate (0ms Cache-First + Background Sync)
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname.startsWith('/product_images/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.ttf') ||
    url.pathname === '/logo.png' ||
    url.pathname === '/manifest.json'
  ) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then(async (networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            try {
              const cache = await caches.open(CACHE_NAME);
              cache.put(event.request, networkResponse.clone());
            } catch (err) {
              console.warn('[SW] Error guardando recurso en caché:', err?.message);
            }
          }
          return networkResponse;
        }).catch(() => null);

        // Si ya está en caché, servir de inmediato en 0ms; actualizar en segundo plano
        if (cachedResponse) {
          return cachedResponse;
        }

        // Si no está en caché, esperar la red
        return fetchPromise.then((netRes) => {
          if (netRes) return netRes;
          return new Response('Asset not available offline', { status: 404, statusText: 'Offline' });
        });
      })
    );
    return;
  }

  // Navigation & APIs: Network-First with Fresh Shell Caching & Offline Fallback
  event.respondWith(
    fetch(event.request)
      .then(async (networkResponse) => {
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html')
        ) {
          try {
            const cache = await caches.open(CACHE_NAME);
            cache.put('/index.html', networkResponse.clone());
            cache.put('/', networkResponse.clone());
          } catch (err) {
            console.warn('[SW] Error cacheando shell HTML:', err?.message);
          }
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') {
          const cachedHtml = await caches.match('/index.html') || await caches.match('/');
          if (cachedHtml) return cachedHtml;
        }
        return new Response('Sin conexión al servidor POS', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
  );
});
