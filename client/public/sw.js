const CACHE_NAME = 'intact-static-v2';
const STATIC_ROUTES = ['/offline'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ROUTES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.registration.navigationPreload?.enable().catch(() => undefined),
      caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
    ])
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;

  // Student content is never cached. Only the generic offline screen is used.
  event.respondWith(
    event.preloadResponse
      .then((preloaded) => preloaded || fetch(request))
      .catch(() => caches.match('/offline')),
  );
});

self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(payload.title || '인텍트 새 알림', {
      body: payload.body || '새로운 활동이 있습니다.',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      data: { url: payload.url || '/notifications' },
      tag: payload.tag || 'igwak-notification',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url || '/notifications'));
});
