// Service Worker — F&G Seguro Garantia Hub
//
// O nome do cache é versionado: trocar o número aqui faz o `activate` apagar
// tudo que sobrou do SW anterior. Foi para v2 junto com o aviso de versão
// nova, porque o v1 servia o index.html do cache antes da rede — quem já
// tinha o hub aberto ficava uma visita inteira atrasado a cada deploy.
const CACHE_NAME = 'fg-hub-v2';
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

  // O version.json é justamente o arquivo que não pode vir do cache — ele
  // existe para dizer qual build está publicado agora. Sai daqui sem
  // respondWith: vai direto para a rede, como se o SW não existisse.
  if (url.pathname === '/version.json') return;

  // Cache-first para assets estáticos (JS, CSS, imagens, fontes)
  //
  // Seguro porque o Vite põe hash no nome: build novo gera arquivo com nome
  // novo, que por definição não está no cache e vem da rede.
  if (
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff2?|ttf)$/) ||
    url.hostname.includes('fonts.')
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // HTML: rede primeiro, cache só como rede de segurança.
  //
  // Aqui estava o furo do v1. O index.html é o único arquivo com nome fixo, e
  // é ele que aponta para o bundle com hash. Servindo-o do cache primeiro, o
  // navegador continuava carregando o JS antigo mesmo depois do deploy — e o
  // botão "Atualizar" do aviso de versão nova recarregaria para a mesma
  // versão velha, num laço sem fim. Offline continua funcionando pelo
  // fallback, que é o que o cache de HTML precisa fazer num PWA.
  event.respondWith(networkFirstComCache(request));
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

/** Rede primeiro, guardando a resposta boa para servir quando estiver offline. */
async function networkFirstComCache(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('', { status: 503 });
  }
}
