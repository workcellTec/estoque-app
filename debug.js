// debug.js — Bot de Log do CTW
// Captura console.log/warn/error, erros de runtime e promises rejeitadas.
// Botão flutuante 🐞 abre o painel; "Copiar" põe tudo na área de transferência
// para colar no chat. Carregar ANTES dos outros scripts no index.html.

(function () {
    'use strict';

    const MAX = 400;
    const logs = [];

    function hora() {
        const d = new Date();
        return String(d.getHours()).padStart(2, '0') + ':'
             + String(d.getMinutes()).padStart(2, '0') + ':'
             + String(d.getSeconds()).padStart(2, '0');
    }

    function fmt(v) {
        if (v instanceof Error) return v.message + '\n' + (v.stack || '');
        if (typeof v === 'object' && v !== null) {
            try { return JSON.stringify(v); } catch (e) { return String(v); }
        }
        return String(v);
    }

    function add(nivel, args) {
        logs.push('[' + hora() + '] ' + nivel + ' ' + Array.from(args).map(fmt).join(' '));
        if (logs.length > MAX) logs.shift();
        const lista = document.getElementById('ctwDbgLista');
        if (lista) renderLogs(lista);
    }

    // ── Intercepta o console ──
    ['log', 'info', 'warn', 'error'].forEach(m => {
        const orig = console[m].bind(console);
        const tag = { log: '📝', info: 'ℹ️', warn: '⚠️', error: '❌' }[m];
        console[m] = function () { add(tag, arguments); orig.apply(null, arguments); };
    });

    // ── Erros de runtime e promises ──
    window.addEventListener('error', e => {
        add('💥', [(e.message || 'erro') + ' @ ' + (e.filename || '?') + ':' + (e.lineno || '?')]);
    });
    window.addEventListener('unhandledrejection', e => {
        add('💥', ['Promise rejeitada: ' + fmt(e.reason)]);
    });

    // ── Diagnóstico do sistema ──
    async function diagnostico() {
        const l = [];
        l.push('===== DIAGNÓSTICO CTW ' + hora() + ' =====');
        l.push('URL: ' + location.href);
        l.push('UA: ' + navigator.userAgent);
        l.push('— Funções-chave —');
        l.push('processarTextoZapIA: ' + typeof window.processarTextoZapIA);
        l.push('_bookipAddFotoFile: ' + typeof window._bookipAddFotoFile);
        l.push('_bookipRenderFotos: ' + typeof window._bookipRenderFotos);
        l.push('_bookipFotos: ' + (Array.isArray(window._bookipFotos) ? window._bookipFotos.length + ' foto(s)' : typeof window._bookipFotos));
        l.push('checarAniversariosHoje: ' + typeof window.checarAniversariosHoje);
        l.push('— Elementos-chave —');
        ['bookipPhotosThumbs', 'bookipPhotoInputCamera', 'bookipPhotoInputGallery', 'bookipPhotoBtnCamera', 'bookipPhotoBtnGallery', 'bookipProdValorTemp', 'btnAdicionarItemLista']
            .forEach(id => l.push('#' + id + ': ' + (document.getElementById(id) ? 'OK' : '*** AUSENTE ***')));
        l.push('— Service Worker —');
        try {
            l.push('controller: ' + (navigator.serviceWorker && navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : 'nenhum'));
            if (window.caches) {
                const keys = await caches.keys();
                l.push('caches: ' + (keys.join(', ') || 'nenhum'));
            }
        } catch (e) { l.push('SW: erro ao ler — ' + e.message); }
        l.push('=====================================');
        return l.join('\n');
    }

    function renderLogs(lista) {
        lista.textContent = logs.length ? logs.join('\n\n') : '(sem logs ainda — use o app e volte aqui)';
        lista.scrollTop = lista.scrollHeight;
    }

    // ── UI ──
    function montarUI() {
        if (document.getElementById('ctwDbgBtn')) return;

        const btn = document.createElement('button');
        btn.id = 'ctwDbgBtn';
        btn.type = 'button';
        btn.textContent = '🐞';
        btn.style.cssText = 'position:fixed;left:10px;bottom:110px;z-index:99998;width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.55);font-size:1.1rem;opacity:.55;cursor:pointer;';
        btn.onclick = abrirPainel;
        document.body.appendChild(btn);
    }

    async function abrirPainel() {
        let ov = document.getElementById('ctwDbgOverlay');
        if (ov) { ov.remove(); return; }

        ov = document.createElement('div');
        ov.id = 'ctwDbgOverlay';
        ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.85);display:flex;flex-direction:column;padding:12px;padding-bottom:env(safe-area-inset-bottom,12px);';

        const diag = await diagnostico();

        ov.innerHTML =
            '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">'
            + '<strong style="color:#fff;font-size:.95rem;flex:1;">🐞 Log do CTW</strong>'
            + '<button type="button" id="ctwDbgCopiar" style="padding:8px 14px;border:none;border-radius:10px;background:#22c55e;color:#000;font-weight:700;font-size:.8rem;">📋 Copiar</button>'
            + '<button type="button" id="ctwDbgLimpar" style="padding:8px 12px;border:none;border-radius:10px;background:rgba(255,255,255,.12);color:#fff;font-size:.8rem;">Limpar</button>'
            + '<button type="button" id="ctwDbgFechar" style="padding:8px 12px;border:none;border-radius:10px;background:rgba(255,255,255,.12);color:#fff;font-size:.8rem;">✕</button>'
            + '</div>'
            + '<pre id="ctwDbgDiag" style="flex-shrink:0;max-height:32vh;overflow:auto;background:rgba(255,255,255,.06);color:#7dd3fc;font-size:.62rem;line-height:1.5;padding:10px;border-radius:10px;white-space:pre-wrap;word-break:break-all;margin:0 0 8px;">' + diag.replace(/</g, '&lt;') + '</pre>'
            + '<pre id="ctwDbgLista" style="flex:1;overflow:auto;background:rgba(255,255,255,.04);color:#e2e8f0;font-size:.62rem;line-height:1.5;padding:10px;border-radius:10px;white-space:pre-wrap;word-break:break-all;margin:0;"></pre>';

        document.body.appendChild(ov);
        renderLogs(document.getElementById('ctwDbgLista'));

        document.getElementById('ctwDbgFechar').onclick = () => ov.remove();
        document.getElementById('ctwDbgLimpar').onclick = () => { logs.length = 0; renderLogs(document.getElementById('ctwDbgLista')); };
        document.getElementById('ctwDbgCopiar').onclick = async () => {
            const texto = diag + '\n\n===== LOGS =====\n' + logs.join('\n');
            try {
                await navigator.clipboard.writeText(texto);
                document.getElementById('ctwDbgCopiar').textContent = '✅ Copiado!';
            } catch (e) {
                // Fallback para contextos sem clipboard API
                const ta = document.createElement('textarea');
                ta.value = texto;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
                document.getElementById('ctwDbgCopiar').textContent = '✅ Copiado!';
            }
        };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarUI);
    else montarUI();

    console.log('🐞 Bot de log ativo (debug.js)');
})();
