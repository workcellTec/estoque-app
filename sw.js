// sw.js — Central Workcell
// Arquivo deve ficar na raiz do repositório (mesma pasta do index.html)

const CACHE = 'ctw-v89';

self.addEventListener('install', e => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE).then(c =>
            Promise.allSettled([
                c.add('./'), c.add('./index.html'),
                c.add('./app.js'), c.add('./style.css'), c.add('./sw.js'),
                c.add('./icon-192.png'), c.add('./icon-512.png'), c.add('./icon-1024.png'), c.add('./badge.png'),
            ])
        )
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    e.respondWith(
        caches.match(e.request)
            .then(r => r || fetch(e.request))
            .catch(() => caches.match('./index.html'))
    );
});

// Recebe pedido do app e exibe notificação
self.addEventListener('message', e => {
    if (!e.data || e.data.tipo !== 'MOSTRAR_NOTIFICACAO') return;
    const { titulo, corpo, tag } = e.data;
    e.waitUntil(
        self.registration.showNotification(titulo || '⚡ Central Workcell', {
            body: corpo,
            icon: './icon-192.png',
            badge: './badge.png',
            tag: tag || 'ctw',
            renotify: true,
            vibrate: [200, 100, 200]
        })
    );
});

// Clicou na notificação → foca ou abre o app
self.addEventListener('notificationclick', e => {
    e.notification.close();
    e.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            const c = list[0];
            return c ? c.focus() : clients.openWindow('./');
        })
    );
});
