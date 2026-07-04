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
    if (!aniv.length) { window._aniversariosHoje = []; return; }

    // Lista de dispensadas (X no balão) — o ID inclui o ano, então
    // dispensar hoje não silencia o aniversário do ano que vem
    var dismissed = [];
    try { dismissed = JSON.parse(localStorage.getItem('ctwDismissedNotifs') || '[]'); } catch(e) {}

    function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    var notifs = aniv.map(function(c) {
        return {
            isBirthday: true,
            notificationId: 'birthday_' + c.id + '_' + hoje.getFullYear(),
            message: '<strong>' + esc(c.nome) + ':</strong> 🎂 Faz aniversário hoje!',
            clienteNome: c.nome,
            clienteTel: c.tel,
        };
    }).filter(function(n) { return !dismissed.includes(n.notificationId); });

    // Guarda para o checkForDueInstallments reinserir a cada refresh dos boletos
    window._aniversariosHoje = notifs;
    if (!notifs.length) return;

    // 1. Push nativo
    window.dispararNotificacaoNativa(notifs);

    // 2. Injeta no painel de Alertas (sino)
    if (typeof window.updateNotificationUI === 'function') {
        var atuais = (window._currentNotifications || []).filter(function(n) { return !n.isBirthday; });
        window.updateNotificationUI(atuais.concat(notifs));
    }
};

// ============================================================
// 🔍 AUDITORIA DE ANIVERSÁRIOS
// Varre a base de clientes e lista quem está sem data de
// nascimento, permitindo preencher e salvar direto no Firebase.
// ============================================================
window.auditarAniversarios = function() {
    var clientes = (window.dbClientsCache || []).slice();
    if (!clientes.length) {
        alert('A base de clientes ainda não carregou. Tente novamente em alguns segundos.');
        return;
    }

    var comData = clientes.filter(function(c) { return !!c.dataNascimento; }).length;
    var semData = clientes.filter(function(c) { return !c.dataNascimento; })
        .sort(function(a, b) { return (b.ultimoCompra || '').localeCompare(a.ultimoCompra || ''); });

    // Overlay (z-index abaixo do picker, que usa 99999)
    var old = document.getElementById('ctwAuditNascOverlay');
    if (old) old.remove();
    var overlay = document.createElement('div');
    overlay.id = 'ctwAuditNascOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:29000;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;';

    overlay.innerHTML =
        '<div style="background:var(--bg-color,#0b1325);border-radius:24px 24px 0 0;width:100%;max-width:520px;max-height:85vh;display:flex;flex-direction:column;padding-bottom:env(safe-area-inset-bottom,12px);">'
        + '<div style="width:40px;height:4px;background:rgba(255,255,255,.15);border-radius:99px;margin:14px auto 12px;flex-shrink:0;"></div>'
        + '<div style="padding:0 20px 10px;flex-shrink:0;">'
        +   '<div style="font-weight:700;font-size:1rem;color:var(--text-color,#fff);display:flex;align-items:center;gap:8px;">🎂 Auditoria de Aniversários</div>'
        +   '<div style="font-size:.75rem;color:var(--text-secondary,#8899aa);margin-top:4px;">'
        +     '<span style="color:#22c55e;font-weight:700;">' + comData + ' com data</span> · '
        +     '<span style="color:#fb923c;font-weight:700;">' + semData.length + ' sem data</span> · ordenado por compra mais recente'
        +   '</div>'
        +   '<input id="ctwAuditBusca" type="text" placeholder="🔍 Buscar por nome ou telefone..." style="width:100%;margin-top:10px;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:var(--text-color,#fff);font-size:.85rem;outline:none;">'
        + '</div>'
        + '<div id="ctwAuditLista" style="flex:1;overflow-y:auto;padding:4px 14px 14px;"></div>'
        + '<input type="hidden" id="ctwAuditNascInput"><span id="ctwAuditNascLbl" style="display:none;"></span><button type="button" id="ctwAuditNascBtn" style="display:none;"></button>';

    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    var lista = document.getElementById('ctwAuditLista');

    function fmtUltCompra(iso) {
        if (!iso) return 'sem compra registrada';
        try {
            var d = new Date(iso);
            return 'última compra: ' + String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
        } catch (e) { return ''; }
    }

    async function salvarData(cliente, iso, rowEl, btnEl) {
        btnEl.textContent = 'Salvando...';
        btnEl.disabled = true;
        try {
            var fb = await import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js');
            var db = window._firebaseDB;
            if (!db) throw new Error('Banco indisponível');
            await fb.update(fb.ref(db, 'clientes/' + cliente.id), { dataNascimento: iso });
            cliente.dataNascimento = iso; // atualiza o cache local também
            var p = iso.split('-');
            rowEl.style.opacity = '.55';
            btnEl.textContent = '✅ ' + p[2] + '/' + p[1];
            btnEl.style.background = 'rgba(34,197,94,.15)';
            btnEl.style.color = '#22c55e';
        } catch (e) {
            btnEl.textContent = '🎂 Definir';
            btnEl.disabled = false;
            alert('Erro ao salvar: ' + e.message);
        }
    }

    function render(filtro) {
        lista.innerHTML = '';
        var f = (filtro || '').toLowerCase().trim();
        var itens = semData.filter(function(c) {
            if (c.dataNascimento) return false; // já preenchido nesta sessão
            if (!f) return true;
            return (c.nome || '').toLowerCase().includes(f) || (c.tel || '').includes(f);
        });
        if (!itens.length) {
            lista.innerHTML = '<div style="text-align:center;padding:30px 10px;color:var(--text-secondary,#8899aa);font-size:.85rem;">Nenhum cliente sem data encontrado 🎉</div>';
            return;
        }
        itens.forEach(function(c) {
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:11px 8px;border-bottom:1px solid rgba(255,255,255,.06);';
            var info = document.createElement('div');
            info.style.cssText = 'flex:1;min-width:0;';
            var nome = document.createElement('div');
            nome.style.cssText = 'font-size:.86rem;font-weight:600;color:var(--text-color,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            nome.textContent = c.nome || '(sem nome)';
            var sub = document.createElement('div');
            sub.style.cssText = 'font-size:.68rem;color:var(--text-secondary,#8899aa);';
            sub.textContent = (c.tel ? c.tel + ' · ' : '') + fmtUltCompra(c.ultimoCompra);
            info.appendChild(nome); info.appendChild(sub);
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = '🎂 Definir';
            btn.style.cssText = 'flex-shrink:0;padding:8px 12px;border:none;border-radius:10px;background:rgba(251,146,60,.15);color:#fb923c;font-size:.75rem;font-weight:700;cursor:pointer;';
            btn.addEventListener('click', function() {
                document.getElementById('ctwAuditNascInput').value = ''; // não herdar data do cliente anterior
                window._abrirBirthdayPicker('ctwAuditNascInput', 'ctwAuditNascBtn', 'ctwAuditNascLbl', function(iso) {
                    salvarData(c, iso, row, btn);
                });
            });
            row.appendChild(info); row.appendChild(btn);
            lista.appendChild(row);
        });
    }

    render('');
    document.getElementById('ctwAuditBusca').addEventListener('input', function() { render(this.value); });
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
