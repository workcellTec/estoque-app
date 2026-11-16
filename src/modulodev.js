// ================================================================
// modulodev.js — Painel do Módulo dev
// Reúne o que antes ficava solto no app (busca por IA, Garantia detalhada, WhatsApp e Preços) e mostra os aparelhos
// com o módulo ligado, que podem ser desligados daqui, de qualquer celular. A trava em si (ligar, validade, desligar
// de longe) fica em app.js: window.ctwEhDev / ctwDevLigar / ctwDevDesligarAqui.
// ================================================================
import { ref, get, update } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js";

const NOS = 'settings/devAparelhos';
const LIMPA_APOS_MS = 3 * 86400000;     // aparelho que ninguém vê há 3 dias já venceu sozinho: sai da lista

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const getDb = () => window._firebaseDB || null;
const ehDev = () => typeof window.ctwEhDev === 'function' && window.ctwEhDev();

function ha(ms) {
    const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (m < 2) return 'agora';
    if (m < 60) return `há ${m} min`;
    if (m < 1440) return `há ${Math.round(m / 60)} h`;
    return `há ${Math.round(m / 1440)} d`;
}
const dataHora = ms => { const d = new Date(ms); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

// Atalhos que podem ficar soltos nas telas: [chave, nome, onde aparece]
const SW = [['ia', 'Busca por IA', 'no Por aparelho'], ['precos', 'WhatsApp e Preços', 'no Mais'], ['gd', 'Garantia detalhada', 'no botão +']];
const ligado = k => k === 'gd' ? !!(window.ctwGdAtalho && window.ctwGdAtalho.ligado()) : !!(window.ctwDevAtalho && window.ctwDevAtalho.ligado(k));
const alternar = k => k === 'gd' ? window.ctwGdAtalho.alternar() : window.ctwDevAtalho.alternar(k);
const sub = (a, on) => on ? 'Aparece ' + a[2] : 'Desligado: só pelo painel';

function abrir() {
    if (!ehDev()) return;
    document.getElementById('ctwDevOv')?.remove();
    const ov = document.createElement('div');
    ov.id = 'ctwDevOv'; ov.className = 'ctw-dv-ov';
    const zap = window.ctwZapNumero || 0;
    ov.innerHTML = `<div class="ctw-dv-bk"></div><div class="ctw-dv-sh" role="dialog" aria-modal="true" aria-label="Módulo dev">
        <h3>Módulo dev</h3>
        <div class="ctw-dv-ls">
          <button type="button" class="ctw-dv-it" data-a="ia"><span><b>Busca por IA</b><small>Pedido da cliente vira lista com parcelas</small></span></button>
          <button type="button" class="ctw-dv-it" data-a="gd"><span><b>Garantia detalhada</b><small>Com produtos do CTW e lucro</small></span></button>
          <button type="button" class="ctw-dv-it" data-a="precos"><span><b>WhatsApp e Preços</b><small>Atualizar preços e o que fazer no WhatsApp</small></span>${zap ? `<em class="ctw-dv-n">${zap}</em>` : ''}</button>
        </div>
        <h4>Atalhos soltos nas telas</h4>
        <div class="ctw-dv-ls">${SW.map(a => `<div class="ctw-dv-it ctw-dv-sw"><span><b>${a[1]}</b><small id="ctwDvSub-${a[0]}">${sub(a, ligado(a[0]))}</small></span><button type="button" class="ui-sw${ligado(a[0]) ? ' on' : ''}" role="switch" aria-checked="${ligado(a[0])}" aria-label="${a[1]}" data-a="sw" data-k="${a[0]}"></button></div>`).join('')}
        </div>
        <h4>Aparelhos com o módulo ligado</h4>
        <div id="ctwDvAp" class="ctw-dv-ap"><p class="ctw-dv-m">Carregando…</p></div>
        <button type="button" class="ctw-dv-x" data-a="todos" disabled>Desligar todos os aparelhos</button>
        <button type="button" class="ctw-dv-x" data-a="aqui">Desligar neste aparelho</button>
        <button type="button" class="ctw-dv-x" data-a="fechar">Fechar</button></div>`;
    document.body.appendChild(ov);
    const sh = ov.querySelector('.ctw-dv-sh'), lista = sh.querySelector('#ctwDvAp'), btTodos = sh.querySelector('[data-a=todos]');
    let aparelhos = {}, confirmaTodos = false, ocupado = false;
    const fechar = () => ov.remove();

    const erroModal = m => window.showCustomModal && window.showCustomModal({ message: m });
    const abrirModulo = async (nome, fn) => {
        try { const m = await window.ctwCarregarModulo(nome); fn(m); }
        catch (e) { console.warn('[módulo dev]', nome, e); erroModal('Não consegui abrir agora. Tente de novo.'); }
    };

    const pintarAparelhos = () => {
        const meu = window.ctwDevId && window.ctwDevId(), ids = Object.keys(aparelhos).sort((a, b) => (aparelhos[b].vistoEm || 0) - (aparelhos[a].vistoEm || 0));
        lista.innerHTML = ids.length ? ids.map(id => {
            const a = aparelhos[id], eu = id === meu;
            return `<div class="ctw-dv-ap1"><span><b>${esc(a.perfil || 'Perfil')}${eu ? ' · este aparelho' : ''}</b><small>${esc(a.modelo || '')}<br>ligado ${esc(dataHora(a.ativadoEm || 0))} · visto ${esc(ha(a.vistoEm || a.ativadoEm || 0))}</small></span>
              ${eu ? '' : a.desligar ? '<em class="ctw-dv-m">aguardando conectar</em>' : `<button type="button" class="ctw-dv-off" data-a="off" data-id="${esc(id)}">Desligar</button>`}</div>`;
        }).join('') : '<p class="ctw-dv-m">Nenhum aparelho registrado.</p>';
        btTodos.disabled = !ids.length; btTodos.textContent = 'Desligar todos os aparelhos'; confirmaTodos = false;
    };
    const carregar = async () => {
        const db = getDb();
        if (!db) { lista.innerHTML = '<p class="ctw-dv-m">Sem conexão com o banco.</p>'; return; }
        try {
            const v = (await get(ref(db, NOS))).val() || {};
            const velhos = Object.keys(v).filter(id => Date.now() - ((v[id] && (v[id].vistoEm || v[id].ativadoEm)) || 0) > LIMPA_APOS_MS);
            if (velhos.length) { const up = {}; velhos.forEach(id => { up[`${NOS}/${id}`] = null; delete v[id]; }); update(ref(db), up).catch(() => {}); }
            aparelhos = v; pintarAparelhos();
        } catch (e) { lista.innerHTML = '<p class="ctw-dv-m">Não consegui ler a lista agora.</p>'; }
    };

    ov.addEventListener('click', async e => {
        if (e.target.closest('.ctw-dv-bk')) return fechar();
        const b = e.target.closest('button'); if (!b || !sh.contains(b) || !b.dataset.a) return;
        const a = b.dataset.a;
        if (a === 'fechar') return fechar();
        if (a === 'ia') {                                   // a busca por IA adiciona no Por aparelho: abre essa tela antes
            fechar();
            if (typeof window.showMainSection === 'function') window.showMainSection('calculator');
            setTimeout(() => document.getElementById('openCalcularPorAparelho')?.click(), 300);
            setTimeout(() => abrirModulo('buscaia', m => m.abrir()), 450);
            return;
        }
        if (a === 'gd') { fechar(); return abrirModulo('fechamentoia', m => m.abrirGarantiaDet()); }
        if (a === 'precos') { fechar(); return abrirModulo('precosync', m => m.abrir()); }
        if (a === 'sw') {
            const k = b.dataset.k, on = alternar(k), def = SW.find(x => x[0] === k);
            b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
            sh.querySelector('#ctwDvSub-' + k).textContent = sub(def, on);
            return;
        }
        if (a === 'aqui') { window.ctwDevDesligarAqui(); return; }
        if (ocupado) return;
        const db = getDb();
        if (a === 'off') {
            ocupado = true; b.disabled = true; b.textContent = 'Desligando…';
            try { await update(ref(db, `${NOS}/${b.dataset.id}`), { desligar: true }); await carregar(); }
            catch (err) { erroModal('Não consegui desligar agora. Confira a conexão.'); b.disabled = false; b.textContent = 'Desligar'; }
            ocupado = false; return;
        }
        if (a === 'todos') {
            if (!confirmaTodos) { confirmaTodos = true; b.textContent = `Confirmar: desligar ${Object.keys(aparelhos).length} aparelho(s), inclusive este`; return; }
            ocupado = true; b.disabled = true; b.textContent = 'Desligando…';
            try {
                const up = { 'settings/devDesligarTodosEm': Date.now() };
                Object.keys(aparelhos).forEach(id => { up[`${NOS}/${id}/desligar`] = true; });
                await update(ref(db), up);
                setTimeout(() => { if (ehDev()) window.ctwDevDesligarAqui(); }, 1200);      // garante que este também desliga
            } catch (err) { erroModal('Não consegui desligar agora. Confira a conexão.'); b.disabled = false; confirmaTodos = false; b.textContent = 'Desligar todos os aparelhos'; }
            ocupado = false;
        }
    });
    carregar();
}

export { abrir };
