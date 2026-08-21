// Service Worker — F&G Seguro Garantia Hub
const CACHE_NAME = 'fg-hub-v1';
const SUPABASE_DOMAIN = 'hfjvwibucplyhsvnwfor.supabase.co';

// Assets estáticos que vão para cache imediatamente
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/index.css',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/logo.svg',
];

// ── Instalação: pré-cache dos assets principais ──────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pré-cache dos assets principais');
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Alguns assets não foram cacheados:', err);
      });
    })
  );
  self.skipWaiting();
});

// ── Ativação: limpa caches antigos ───────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] Removendo cache antigo:', key);
            return caches.delete(key);
          })
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: estratégia por tipo de request ────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Network-first para Supabase (API, Auth, Edge Functions)
  if (url.hostname === SUPABASE_DOMAIN) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Ignora requests não-GET e extensões externas
  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;
  if (url.hostname !== self.location.hostname && url.hostname !== 'fonts.googleapis.com' && url.hostname !== 'fonts.gstatic.com') return;

  // Cache-first para assets estáticos (JS, CSS, imagens, fontes)
  if (
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff2?|ttf)$/) ||
    url.hostname.includes('fonts.')
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Stale-while-revalidate para HTML e tudo mais
  event.respondWith(staleWhileRevalidate(request));
});

// ── Estratégias de cache ──────────────────────────────────────────────────────

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('{"error":"offline"}', {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || (await fetchPromise) || new Response('', { status: 503 });
}
