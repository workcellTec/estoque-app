// sw.js — Central Workcell
// Arquivo deve ficar na raiz do repositório (mesma pasta do index.html)

const CACHE = 'ctw-239'; // Sem luz verde no fundo (a barra de status volta a combinar com a tela); teste do servidor mostra a resposta do Supabase

// Arquivos do próprio app: baixados na instalação para o app abrir offline.
const ARQUIVOS_DO_APP = [
    './', './index.html', './app.js', './style.css', './firebase-config.js',
    './StockCount.js', './repairs.js', './notifications.js', './Bookip.js',
    './reposicao.js', './creditoscan.js', './fecharVenda.js', './ambilight.js',
    './icon-192.png', './icon-512.png', './icon-1024.png', './badge.png',
    './ctw-ui.js?v=4', './fuse.min.js?v=6.6.2', './bootstrap-lite.css?v=1', './bootstrap-icons-lite.css?v=1',
    './fonts/bootstrap-icons.woff2', './fonts/poppins-300.woff2', './fonts/poppins-400.woff2',
    './fonts/poppins-500.woff2', './fonts/poppins-600.woff2', './fonts/poppins-700.woff2'
];

// Bibliotecas externas com versão no endereço (Firebase SDK e bibliotecas de PDF): ficam em cache e abrem na hora.
const EH_LIB_VERSIONADA = /^https:\/\/(www\.gstatic\.com\/firebasejs\/\d|cdnjs\.cloudflare\.com\/ajax\/libs\/)/;

// Tempo máximo esperando a rede por um arquivo do app antes de usar a cópia guardada
// (em internet ruim o app ficava "pensando" até o navegador desistir).
const LIMITE_REDE_MS = 5000;

self.addEventListener('install', e => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE).then(c => Promise.allSettled(ARQUIVOS_DO_APP.map(u => c.add(u))))
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

function guardar(request, resposta) {
    if (resposta && resposta.ok) {
        const copia = resposta.clone();
        caches.open(CACHE).then(c => c.put(request, copia)).catch(() => {});
    }
    return resposta;
}

self.addEventListener('fetch', e => {
    const req = e.request;
    // Só GET http(s). Firebase (Auth/Database) e qualquer POST passam direto, sem tocar.
    if (req.method !== 'GET' || !/^https?:/.test(req.url)) return;
    const mesmaOrigem = new URL(req.url).origin === self.location.origin;

    // 1) Bibliotecas versionadas: cache primeiro (rápido e funciona offline).
    if (!mesmaOrigem && EH_LIB_VERSIONADA.test(req.url)) {
        e.respondWith(
            caches.match(req).then(guardado => guardado || fetch(req).then(r => guardar(req, r)))
        );
        return;
    }
    if (!mesmaOrigem) return;

    // 2) Arquivos do app: rede primeiro (correção chega assim que o app abre), mas com limite de
    //    tempo — se a internet estiver ruim, usa a cópia guardada em vez de travar.
    e.respondWith(
        new Promise(resolve => {
            let resolvido = false;
            const usarCache = () => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
            const timer = setTimeout(() => {
                usarCache().then(r => { if (r && !resolvido) { resolvido = true; resolve(r); } });
            }, LIMITE_REDE_MS);
            fetch(req).then(r => {
                clearTimeout(timer);
                if (!resolvido) { resolvido = true; resolve(guardar(req, r)); } else { guardar(req, r); }
            }).catch(() => {
                clearTimeout(timer);
                usarCache().then(r => { if (!resolvido) { resolvido = true; resolve(r || Response.error()); } });
            });
        })
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
