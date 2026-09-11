/* ============================================================
   DIAGNÓSTICO DE SCROLL — TEMPORÁRIO
   Objetivo: rodar no aparelho que não rola e gerar um relatório
   real (não achismo) com: quem é o container ativo, se ele
   deveria rolar, se o toque está chegando nele, e se o scrollTop
   muda ou não quando você arrasta o dedo.

   Como usar: abre o app no celular problemático, aparece um
   botão flutuante "🩺" no canto. Toca nele, tenta rolar a tela
   normalmente por uns 5 segundos, depois toca em "Copiar
   relatório" e manda pra mim.

   REMOVER: apagar este arquivo e a linha <script src="diagnostico-scroll.js">
   do index.html quando o problema for resolvido.
   ============================================================ */
(function () {
    'use strict';

    var CONTAINER_IDS = [
        'mainMenu', 'stockContainer', 'clientsContainer', 'administracao',
        'contractContainer', 'calculatorContainer', 'reposicaoContainer'
    ];

    var eventLog = [];
    function logEvent(line) {
        var ts = new Date().toISOString().substr(11, 12);
        eventLog.push('[' + ts + '] ' + line);
        if (eventLog.length > 60) eventLog.shift();
        var live = document.getElementById('diagLiveLog');
        if (live) live.textContent = eventLog.slice(-25).join('\n');
    }

    function px(v) { return (v === null || v === undefined) ? 'n/a' : v; }

    function findActiveContainer() {
        for (var i = 0; i < CONTAINER_IDS.length; i++) {
            var el = document.getElementById(CONTAINER_IDS[i]);
            if (!el) continue;
            var cs = window.getComputedStyle(el);
            if (cs.display !== 'none' && !el.classList.contains('hidden')) {
                return el;
            }
        }
        return null;
    }

    function describeElement(el) {
        var cs = window.getComputedStyle(el);
        return {
            ref: (el.tagName.toLowerCase()) + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).trim().replace(/\s+/g, '.') : ''),
            display: cs.display,
            position: cs.position,
            overflow: cs.overflow,
            overflowY: cs.overflowY,
            overflowX: cs.overflowX,
            height: cs.height,
            minHeight: cs.minHeight,
            maxHeight: cs.maxHeight,
            transform: cs.transform,
            willChange: cs.willChange,
            perspective: cs.perspective,
            backfaceVisibility: cs.backfaceVisibility,
            touchAction: cs.touchAction,
            pointerEvents: cs.pointerEvents,
            contain: cs.contain
        };
    }

    function buildReport() {
        var lines = [];
        lines.push('=== DIAGNÓSTICO DE SCROLL — Central Workcell ===');
        lines.push('Data: ' + new Date().toString());
        lines.push('');
        lines.push('--- DISPOSITIVO ---');
        lines.push('userAgent: ' + navigator.userAgent);
        lines.push('platform: ' + (navigator.platform || 'n/a'));
        lines.push('screen: ' + screen.width + 'x' + screen.height + ' (dpr ' + window.devicePixelRatio + ')');
        lines.push('window.innerWidth/Height: ' + window.innerWidth + 'x' + window.innerHeight);
        if (window.visualViewport) {
            lines.push('visualViewport: ' + Math.round(window.visualViewport.width) + 'x' + Math.round(window.visualViewport.height) + ' scale=' + window.visualViewport.scale);
        } else {
            lines.push('visualViewport: não suportado neste navegador');
        }
        lines.push('CSS.supports(height:100dvh): ' + (window.CSS && CSS.supports ? CSS.supports('height', '100dvh') : 'CSS.supports indisponível'));
        lines.push('CSS.supports(overscroll-behavior-y:none): ' + (window.CSS && CSS.supports ? CSS.supports('overscroll-behavior-y', 'none') : 'n/a'));
        lines.push('');

        var active = findActiveContainer();
        lines.push('--- CONTAINER ATIVO NA TELA ---');
        if (!active) {
            lines.push('NENHUM container conhecido (' + CONTAINER_IDS.join(', ') + ') está visível agora. Abra a tela que não rola antes de gerar o relatório.');
        } else {
            var d = describeElement(active);
            lines.push('Elemento: ' + d.ref);
            lines.push('scrollHeight: ' + active.scrollHeight + 'px | clientHeight: ' + active.clientHeight + 'px | scrollTop atual: ' + active.scrollTop + 'px');
            lines.push('PRECISA rolar (scrollHeight > clientHeight)? ' + (active.scrollHeight > active.clientHeight + 2 ? 'SIM' : 'NÃO — o conteúdo já cabe na tela'));
            lines.push('overflow-y: ' + d.overflowY + ' | overflow-x: ' + d.overflowX + ' | overflow: ' + d.overflow);
            lines.push('position: ' + d.position + ' | display: ' + d.display);
            lines.push('height: ' + d.height + ' | min-height: ' + d.minHeight + ' | max-height: ' + d.maxHeight);
            lines.push('transform: ' + d.transform + ' | will-change: ' + d.willChange);
            lines.push('perspective: ' + d.perspective + ' | backface-visibility: ' + d.backfaceVisibility);
            lines.push('touch-action: ' + d.touchAction + ' | pointer-events: ' + d.pointerEvents + ' | contain: ' + d.contain);
            lines.push('');
            lines.push('--- CADEIA DE PAIS (do container até <html>) ---');
            var p = active.parentElement;
            var depth = 0;
            while (p && depth < 15) {
                var pd = describeElement(p);
                var flags = [];
                if (pd.overflow !== 'visible') flags.push('overflow=' + pd.overflow);
                if (pd.overflowY !== 'visible') flags.push('overflow-y=' + pd.overflowY);
                if (pd.position !== 'static') flags.push('position=' + pd.position);
                if (pd.transform !== 'none') flags.push('transform=' + pd.transform);
                if (pd.willChange !== 'auto') flags.push('will-change=' + pd.willChange);
                if (pd.height && pd.height !== 'auto') flags.push('height=' + pd.height);
                lines.push('  ' + pd.ref + (flags.length ? '  [' + flags.join(', ') + ']' : '  [sem propriedade suspeita]'));
                p = p.parentElement;
                depth++;
            }
        }
        lines.push('');
        lines.push('--- LOG DE TOQUE/SCROLL (últimos eventos capturados) ---');
        if (eventLog.length === 0) {
            lines.push('Nenhum evento capturado ainda. Tenta arrastar o dedo pra baixo na tela ANTES de copiar o relatório.');
        } else {
            lines.push(eventLog.join('\n'));
        }
        lines.push('');
        lines.push('=== FIM DO RELATÓRIO ===');
        return lines.join('\n');
    }

    // --- Monitor de toque no container ativo + na janela ---
    var lastScrollTop = null;
    function attachMonitors() {
        var active = findActiveContainer();
        if (!active || active.dataset.diagMonitored) return;
        active.dataset.diagMonitored = '1';

        active.addEventListener('touchstart', function (e) {
            lastScrollTop = active.scrollTop;
            logEvent('touchstart em ' + describeElement(active).ref + ' | scrollTop=' + active.scrollTop);
        }, { passive: true });

        active.addEventListener('touchmove', function (e) {
            logEvent('touchmove | scrollTop=' + active.scrollTop + ' | defaultPrevented=' + e.defaultPrevented);
        }, { passive: true });

        active.addEventListener('touchend', function (e) {
            var moved = (lastScrollTop !== null) ? (active.scrollTop - lastScrollTop) : 'n/a';
            logEvent('touchend | scrollTop final=' + active.scrollTop + ' | mudou=' + moved + 'px');
        }, { passive: true });

        active.addEventListener('scroll', function () {
            logEvent('EVENTO SCROLL disparou | scrollTop=' + active.scrollTop);
        }, { passive: true });
    }

    // --- UI flutuante ---
    function buildUI() {
        var btn = document.createElement('button');
        btn.textContent = '🩺';
        btn.setAttribute('aria-label', 'Diagnóstico de scroll');
        btn.style.cssText = 'position:fixed;bottom:16px;right:16px;width:48px;height:48px;border-radius:50%;background:#d33;color:#fff;border:none;font-size:20px;z-index:2147483647;box-shadow:0 2px 10px rgba(0,0,0,.5);';

        var panel = document.createElement('div');
        panel.style.cssText = 'position:fixed;inset:0;background:#0d0d0d;color:#0f0;font-family:monospace;font-size:12px;z-index:2147483647;display:none;flex-direction:column;padding:10px;box-sizing:border-box;';

        var header = document.createElement('div');
        header.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;';

        var refreshBtn = document.createElement('button');
        refreshBtn.textContent = 'Atualizar relatório';
        var copyBtn = document.createElement('button');
        copyBtn.textContent = 'Copiar relatório';
        var closeBtn = document.createElement('button');
        closeBtn.textContent = 'Fechar';
        [refreshBtn, copyBtn, closeBtn].forEach(function (b) {
            b.style.cssText = 'padding:8px 12px;border-radius:6px;border:1px solid #0f0;background:#111;color:#0f0;';
        });

        header.appendChild(refreshBtn);
        header.appendChild(copyBtn);
        header.appendChild(closeBtn);

        var textarea = document.createElement('textarea');
        textarea.readOnly = true;
        textarea.style.cssText = 'flex:1;width:100%;background:#000;color:#0f0;font-family:monospace;font-size:11px;border:1px solid #333;padding:8px;box-sizing:border-box;white-space:pre;';

        var liveLog = document.createElement('div');
        liveLog.id = 'diagLiveLog';
        liveLog.style.cssText = 'height:110px;overflow-y:auto;background:#000;color:#ff0;font-size:10px;border:1px solid #333;padding:6px;margin-top:8px;white-space:pre-wrap;';
        liveLog.textContent = 'Arraste o dedo na tela pra ver os eventos aqui...';

        panel.appendChild(header);
        panel.appendChild(textarea);
        panel.appendChild(liveLog);

        function refresh() {
            attachMonitors();
            textarea.value = buildReport();
        }

        refreshBtn.onclick = refresh;
        closeBtn.onclick = function () { panel.style.display = 'none'; };
        copyBtn.onclick = function () {
            textarea.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) {}
            if (!ok && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(textarea.value).then(function () {
                    copyBtn.textContent = 'Copiado!';
                }).catch(function () {
                    copyBtn.textContent = 'Copiar (seleciona e usa o botão de copiar do teclado)';
                });
            } else {
                copyBtn.textContent = ok ? 'Copiado!' : 'Seleciona o texto e copia manualmente';
            }
            setTimeout(function () { copyBtn.textContent = 'Copiar relatório'; }, 2000);
        };

        btn.onclick = function () {
            panel.style.display = (panel.style.display === 'none') ? 'flex' : 'none';
            if (panel.style.display === 'flex') refresh();
        };

        document.body.appendChild(btn);
        document.body.appendChild(panel);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', buildUI);
    } else {
        buildUI();
    }
})();
