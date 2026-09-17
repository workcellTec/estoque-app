// sw.js — Central Workcell
// Arquivo deve ficar na raiz do repositório (mesma pasta do index.html)

const CACHE = 'ctw-194'; // FIX SCROLL v8: reflow forçado (offsetHeight + scrollTop=0) no #contractContainer após trocar Contrato/Garantia de hidden para visível — bug conhecido de WebView Android que não recalcula altura rolável do pai automaticamente

self.addEventListener('install', e => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE).then(c =>
            Promise.allSettled([
                c.add('./'), c.add('./index.html'),
                c.add('./app.js'), c.add('./style.css'), c.add('./sw.js'),
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
    // FIX: estratégia antiga era "Cache First" (caches.match → só busca a
    // rede se NÃO tiver no cache) — isso significa que, uma vez que um
    // arquivo é cacheado, o Service Worker NUNCA MAIS busca a versão nova
    // dele, mesmo trocando o CACHE_NAME manualmente em alguns cenários de
    // navegador. Trocado para "Network First": sempre tenta buscar a
    // versão mais recente da rede primeiro (e atualiza o cache com ela);
    // só usa o cache salvo como fallback se estiver sem internet. Isso
    // garante que correções de código sempre cheguem ao usuário assim que
    // ele recarrega a página, mantendo o funcionamento offline como rede
    // de segurança (não como comportamento padrão).
    e.respondWith(
        fetch(e.request)
            .then(resposta => {
                // Atualiza o cache com a versão fresca, para uso offline futuro
                const respostaClone = resposta.clone();
                caches.open(CACHE).then(c => c.put(e.request, respostaClone));
                return resposta;
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
