// ============================================================
// SERVICE WORKER — Central Workcell
// Coloque este arquivo na raiz do seu repositório GitHub
// ============================================================

const CACHE_NAME = 'centrar-workcell-cache-v81';

const urlsToCache = [
    '/',
    '/index.html',
    '/app.js',
    '/style.css',
    'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
];

// Instala e cacheia assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
    );
    self.skipWaiting();
});

// Ativa e limpa caches antigos
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames =>
            Promise.all(cacheNames.map(name => {
                if (name !== CACHE_NAME) return caches.delete(name);
            }))
        )
    );
    self.clients.claim();
});

// Serve do cache, busca na rede se não tiver
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response =>
            response || fetch(event.request).then(networkResponse => {
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                    return networkResponse;
                }
                const toCache = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache));
                return networkResponse;
            })
        ).catch(() => caches.match('/index.html'))
    );
});

// 🔔 Recebe mensagem do app e exibe notificação nativa
self.addEventListener('message', event => {
    if (event.data && event.data.tipo === 'MOSTRAR_NOTIFICACAO') {
        const { titulo, corpo, tag } = event.data;
        event.waitUntil(
            self.registration.showNotification(titulo, {
                body: corpo,
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                tag: tag || 'ctw-notif',
                renotify: false,
                vibrate: [200, 100, 200],
                data: { url: self.location.origin }
            })
        );
    }
});

// Ao clicar na notificação, abre/foca o app
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if ('focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow('/');
        })
    );
});
