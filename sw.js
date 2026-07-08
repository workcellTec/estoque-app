// sw.js — Central Workcell
// Arquivo deve ficar na raiz do repositório (mesma pasta do index.html)
//
// ESTRATÉGIA: NETWORK-FIRST para código (HTML/JS/CSS).
// Todo deploy aparece no próximo refresh — NUNCA MAIS precisa mudar a
// versão do cache. O cache vira apenas reserva para funcionar offline.
// Imagens/ícones continuam cache-first (não mudam, economiza rede).

const CACHE = 'ctw-net-1';

self.addEventListener('install', e => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE).then(c =>
            Promise.allSettled([
                c.add('./'), c.add('./index.html'),
                c.add('./app.js'), c.add('./style.css'), c.add('./debug.js'),
                c.add('./stockCount.js'),
                c.add('./descricao.js'),
                c.add('./repairs.js'), c.add('./notifications.js'),
                c.add('./ambilight.js'), c.add('./Favorites.js'), c.add('./Bookip.js'), c.add('./reposicao.js'),
                c.add('./creditoscan.js'), c.add('./fecharVenda.js'),
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
    if (e.request.method !== 'GET') return;

    // Imagens e ícones: cache-first (conteúdo imutável)
    if (e.request.destination === 'image') {
        e.respondWith(
            caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
                if (resp && resp.ok) {
                    const clone = resp.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone));
                }
                return resp;
            }))
        );
        return;
    }

    // Código (HTML/JS/CSS): REDE PRIMEIRO — o cache só entra sem internet
    e.respondWith(
        fetch(e.request)
            .then(resp => {
                if (resp && resp.ok && new URL(e.request.url).origin === self.location.origin) {
                    const clone = resp.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone));
                }
                return resp;
            })
            .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
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
