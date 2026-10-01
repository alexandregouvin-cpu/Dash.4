// Service worker: funcionamento offline + lembrete diário com o app fechado.

const VERSION = 'v3';
const APP_CACHE = `gastos-app-${VERSION}`;
const STATE_CACHE = 'gastos-shared-state';
const STATE_URL = new URL('./__state.json', self.registration.scope).href;

const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/core.js',
  './js/storage.js',
  './js/notifications.js',
  './js/places.js',
  './js/sync.js',
  './js/firebase-config.js',
  './js/vendor/firebase.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/badge-96.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gastos-app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Rede primeiro (para receber atualizações), com o cache como reserva offline.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(APP_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit ?? caches.match('./index.html'))),
  );
});

function localISO(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function maybeRemind() {
  const cache = await caches.open(STATE_CACHE);
  const res = await cache.match(STATE_URL);
  if (!res) return;
  const state = await res.json();
  if (!state.reminderEnabled) return;

  const now = new Date();
  const today = localISO(now);
  const [h, m] = String(state.reminderTime || '21:00').split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;
  if (state.lastExpenseDate === today || state.lastReminderDate === today) return;

  await self.registration.showNotification('Registrou seus gastos de hoje? 💸', {
    body: 'Leva 10 segundos: toque para anotar o que você pagou hoje.',
    tag: 'daily-reminder',
    icon: './icons/icon-192.png',
    badge: './icons/badge-96.png',
    lang: 'pt-BR',
    data: { url: './' },
  });
  state.lastReminderDate = today;
  await cache.put(STATE_URL, new Response(JSON.stringify(state), { headers: { 'Content-Type': 'application/json' } }));
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'daily-reminder') event.waitUntil(maybeRemind());
});

// Suporte a push de um servidor, caso um seja configurado no futuro.
self.addEventListener('push', (event) => {
  const data = event.data?.json?.() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Controle de Gastos', {
      body: data.body || 'Você tem uma novidade.',
      icon: './icons/icon-192.png',
      badge: './icons/badge-96.png',
      data: { url: data.url || './' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const open = clients.find((c) => c.url.startsWith(self.registration.scope));
      if (open) return open.focus();
      return self.clients.openWindow(`${url}?novo=1`);
    }),
  );
});
