// notifications.js — notificações push locais + aniversários
// Depende de: window.currentUserProfile, window.dbClientsCache

// ============================================================

// 🔔 NOTIFICAÇÕES NATIVAS — versão final limpa
// ============================================================

// Ícone do app (arquivo na raiz do repositório)
const CTW_ICON = (() => {
    const base = location.href.replace(/\/[^\/]*(\?.*)?$/, '/');
    return base + 'icon-192.png';
})();
const CTW_BADGE = (() => {
    const base = location.href.replace(/\/[^\/]*(\?.*)?$/, '/');
    return base + 'badge.png';
})();

// Dispara notificação via Service Worker (única forma que funciona no Android)

// Obtém SW registration com timeout
async function getSwReg(timeoutMs = 4000) {
    if (!('serviceWorker' in navigator)) return null;
    return Promise.race([
        navigator.serviceWorker.ready,
        new Promise(resolve => setTimeout(() => resolve(null), timeoutMs))
    ]);
}

window.dispararNotificacaoNativa = async function(notifications, forcar = false) {
    if (!notifications || notifications.length === 0) return;
    if (Notification.permission !== 'granted') return;

    // Anti-spam: cada notif dispara só 1x por dia (por ID único)
    // "forcar=true" ignora o cache — usado no teste de boas-vindas
    const hoje = new Date().toISOString().split('T')[0];
    const cacheKey = 'ctw_fired_' + hoje;
    let fired = [];
    try { fired = JSON.parse(localStorage.getItem(cacheKey) || '[]'); } catch(e) {}

    // Aguarda o SW estar pronto (máx 5s)
    let reg = null;
    try {
        reg = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise(r => setTimeout(() => r(null), 5000))
        ]);
    } catch(e) {}

    for (let i = 0; i < notifications.length; i++) {
        const notif = notifications[i];

        // Texto puro da mensagem HTML
        const tmp = document.createElement('div');
        tmp.innerHTML = notif.message || '';
        const body = (tmp.textContent || '').trim().slice(0, 200);
        if (!body) continue;

        // Chave única para anti-spam
        const id = notif.notificationId || notif.boletoId || ('g' + i + body.slice(0, 10));
        const tag = hoje + '_' + id;
        if (!forcar && fired.includes(tag)) continue;

        // Título
        let title = '⚡ Central Workcell';
        if (notif.isGeneral)     title = '📢 Aviso do Sistema';
        else if (notif.isBirthday) title = '🎂 Aniversário!';
        else                     title = '💳 Parcela em aberto';

        // Opções da notificação — ícone sem verificação prévia
        const opts = {
            body,
            icon: CTW_ICON,
            badge: CTW_BADGE,
            tag,
            renotify: true,
            vibrate: [200, 100, 200]
        };

        let ok = false;

        // MÉTODO 1: via SW registration (funciona no Android com app fechado)
        if (reg) {
            try { await reg.showNotification(title, opts); ok = true; }
            catch(e) { console.warn('SW notif falhou:', e); }
        }

        // MÉTODO 2: Notification API direta (fallback desktop/iOS)
        if (!ok) {
            try { new Notification(title, opts); ok = true; }
            catch(e) { console.warn('Notification() falhou:', e); }
        }

        console.log('🔔', ok ? 'OK' : 'FALHOU', '|', title, '|', body.slice(0, 60));

        if (ok) {
            fired.push(tag);
            try { localStorage.setItem(cacheKey, JSON.stringify(fired)); } catch(e) {}
        }
    }
};

// Pede permissão e dispara teste imediato
window.pedirPermissaoNotificacao = async function() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'denied') return;
    if (Notification.permission === 'granted') return;

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;

    // Limpa cache do dia para notificações pendentes dispararem logo
    const hoje = new Date().toISOString().split('T')[0];
    localStorage.removeItem('ctw_fired_' + hoje);

    // Notificação de teste — espera SW estar registrado
    setTimeout(async () => {
        let reg = null;
        try { reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 3000))]); } catch(e) {}

        const opts = { body: '✅ Parcelas, avisos e aniversários vão aparecer aqui.', icon: CTW_ICON, badge: CTW_BADGE, tag: 'ctw_boas_vindas', renotify: true };

        let ok = false;
        if (reg) { try { await reg.showNotification('⚡ Notificações ativadas!', opts); ok = true; } catch(e) {} }
        if (!ok) { try { new Notification('⚡ Notificações ativadas!', opts); } catch(e) {} }
    }, 1500);

    // Dispara notificações reais pendentes
    setTimeout(() => { if (typeof window.setupNotificationListeners === 'function') window.setupNotificationListeners(); }, 3000);
};

// Checa aniversários dos clientes
window.checarAniversariosHoje = function() {
    const clientes = window.dbClientsCache || [];
    if (!clientes.length) return;
    const hoje = new Date();
    const mes = hoje.getMonth() + 1, dia = hoje.getDate();
    // Só notifica clientes atribuídos ao perfil atual
    const perfilAtual = (window.currentUserProfile || localStorage.getItem('ctwUserProfile') || '').toLowerCase().trim();
    const aniv = clientes.filter(c => {
        if (!c.dataNascimento) return false;
        const p = c.dataNascimento.split('-');
        const dataOk = p.length >= 3 && +p[1] === mes && +p[2] === dia;
        if (!dataOk) return false;
        // Se cliente tem atribuição, só notifica o dono
        if (c.atribuidoA) {
            return c.atribuidoA.toLowerCase().trim() === perfilAtual;
        }
        // Sem atribuição → notifica todos
        return true;
    });
    if (!aniv.length) return;
    window.dispararNotificacaoNativa(aniv.map(c => ({
        isBirthday: true,
        notificationId: 'birthday_' + c.id,
        message: '🎂 Hoje é aniversário de ' + c.nome + '!',
        clienteNome: c.nome,
        clienteTel: c.tel,
    })));
};

// Hook em updateNotificationUI → dispara push a cada nova notificação
(function() {
    // Aguarda window.updateNotificationUI estar disponível (módulo ES)
    function hookUpdateNotif() {
        if (typeof window.updateNotificationUI !== 'function') {
            setTimeout(hookUpdateNotif, 200);
            return;
        }
        var orig = window.updateNotificationUI;
        window.updateNotificationUI = function(notifications) {
            if (notifications && notifications.length > 0) {
                window.dispararNotificacaoNativa && window.dispararNotificacaoNativa(notifications);
            }
            return orig(notifications);
        };
    }
    hookUpdateNotif();
})();

// Hook aniversários no setupNotificationListeners
(function() {
    function hookSetup() {
        if (typeof window.setupNotificationListeners !== 'function') {
            setTimeout(hookSetup, 200);
            return;
        }
        var orig = window.setupNotificationListeners;
        window.setupNotificationListeners = function() {
            orig();
            setTimeout(function() {
                window.checarAniversariosHoje && window.checarAniversariosHoje();
            }, 5000);
        };
    }
    hookSetup();
})();

// Pede permissão no primeiro clique
document.addEventListener('click', function _ask() {
    window.pedirPermissaoNotificacao();
    document.removeEventListener('click', _ask);
}, { once: true });
