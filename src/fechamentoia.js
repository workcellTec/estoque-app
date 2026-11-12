// ================================================================
// fechamentoia.js — Fechar venda IA (somente dev)
// A IA só LÊ (texto e/ou imagens): produto, cliente e a lista de pagamentos.
// Quem faz a conta é o app, com as taxas cadastradas em Taxas (window._getRate).
// Registros: settings/fechamentosIA/{perfil}/{id}  (um registro por venda, separado por perfil)
// ================================================================

import { ref, get, set, push, remove }
    from "https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js";

const BASE = 'settings/fechamentosIA';
const MAX_IMGS = 6;
const MAX_PX = 1600;
const BANDEIRAS = [['visa', 'Visa'], ['mastercard', 'Mastercard'], ['elo', 'Elo'], ['hipercard', 'Hipercard'], ['hiper', 'Hiper'], ['amex', 'Amex']];
const MAQS = [['pagbank', 'PagBank'], ['infinity', 'InfinityPay'], ['valorante', 'Valorante'], ['nubank', 'Nubank']];
const MAX_PARC = { pagbank: 18, infinity: 12, valorante: 21, nubank: 12 };

// ── Utilidades ──────────────────────────────────────────────────
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = n => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const getDb = () => window._firebaseDB || null;
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = s => semAcento(s).toLowerCase();

// "2.170,04" → 2170.04 · "2170.04" → 2170.04 · "180,84" → 180.84 · vazio/ruim → null
function dinheiro(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v == null ? '' : v).replace(/R\$|\s/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
}
const fmtIn = n => (n == null || n === '' ? '' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtTaxa = t => Number(t).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%';
const sinal = n => (n > 0 ? '+ ' : n < 0 ? '− ' : '') + brl(Math.abs(n));
const nomeBand = b => (BANDEIRAS.find(x => x[0] === b) || [0, b || ''])[1];
const nomeMaq = m => (MAQS.find(x => x[0] === m) || [0, m || ''])[1];
const rotParc = p => (p === 0 ? 'Débito' : p + 'x');

function maqsAtivas() {
    let off = [];
    try { off = JSON.parse(lsGet('disabledMachines') || '[]'); } catch (e) { /* sem lista: todas ativas */ }
    const l = MAQS.filter(m => !off.includes(m[0]));
    return l.length ? l : MAQS;
}
function maqPadrao() {
    const l = maqsAtivas(), s = lsGet('ctwDefaultMachine');
    return l.some(m => m[0] === s) ? s : l[0][0];
}
function bandPadrao() {
    const s = lsGet('ctwDefaultBrand');
    return BANDEIRAS.some(b => b[0] === s) ? s : '';
}
function chavePerfil() {
    const n = (lsGet('ctwUserProfile') || '').trim();
    return (n || 'sem-perfil').replace(/[.#$\[\]\/]/g, '_').slice(0, 60);
}

// ── Estado ──────────────────────────────────────────────────────
let overlay = null, TELA = 'entrada', F = null, REG = [], FILTRO = 'semana';
let _busy = false, _tk = 0, _salvando = false, _exc = null, _toastT = null, _toastFn = null;

const novoEstado = () => ({ texto: '', imgs: [], cliente: '', prod: null, pag: [], seq: 0, erros: [], avisosIA: [], erro: '', res: null, salvoId: null, salvoTs: null });

// ── Interface base ──────────────────────────────────────────────
function abrirOverlay() {
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.className = 'ps-overlay fia';
    overlay.innerHTML = '<div class="ps-topo"><button type="button" class="ps-x" data-act="voltar" aria-label="Voltar">‹</button><b>Fechar venda IA</b><span class="fia-dev">Dev</span></div>' +
        '<div class="ps-corpo" id="fiaCorpo"></div><div class="fia-rod" id="fiaRod" hidden></div>';
    overlay.addEventListener('click', aoClicar);
    overlay.addEventListener('input', aoDigitar);
    overlay.addEventListener('change', aoMudar);
    document.body.appendChild(overlay);
    document.documentElement.classList.add('ps-aberto');
}

function fechar() {
    _tk++; _busy = false; _salvando = false; _exc = null;
    clearTimeout(_toastT); _toastFn = null;
    if (overlay) { overlay.remove(); overlay = null; }
    document.documentElement.classList.remove('ps-aberto');
    F = null; REG = [];
}

function titulo(t) { const el = overlay && overlay.querySelector('.ps-topo b'); if (el) el.textContent = t; }

function tela(html, rodape, manterScroll) {
    if (!overlay) return;
    const c = overlay.querySelector('#fiaCorpo'), r = overlay.querySelector('#fiaRod');
    const y = c.scrollTop;
    c.innerHTML = html;
    c.scrollTop = manterScroll ? y : 0;
    r.hidden = !rodape;
    r.innerHTML = rodape || '';
}

function toast(msg, desfazer) {
    if (!overlay) return;
    clearTimeout(_toastT);
    const velho = overlay.querySelector('.ps-toast'); if (velho) velho.remove();
    _toastFn = desfazer || null;
    const el = document.createElement('div'); el.className = 'ps-toast';
    el.innerHTML = `<span>${esc(msg)}</span>${desfazer ? '<button type="button" data-act="toastdesfazer">Desfazer</button>' : ''}`;
    overlay.appendChild(el);
    _toastT = setTimeout(() => { el.remove(); _toastFn = null; }, 6000);
}

// ── 1 · Entrada ─────────────────────────────────────────────────
const TEXTO_EXEMPLO = 'Ex.:\n12x R$ 180,84\n(Total: R$ 2.170,04)\n+R$ 500,00 no dinheiro ou pix\nREDMI Note 15 Pro 5G DE 512/8GB NOVO';

function telaEntrada() {
    TELA = 'entrada'; titulo('Fechar venda IA');
    const n = F.imgs.length, pode = !_busy && (F.texto.trim() || n);
    tela(`
      <div class="ps-card">
        <div class="fia-cap">VENDA, POR ESCRITO</div>
        <textarea id="fiaTexto" class="fia-ta" rows="7" data-f="texto" placeholder="${esc(TEXTO_EXEMPLO)}"${_busy ? ' disabled' : ''}>${esc(F.texto)}</textarea>
      </div>
      <div class="ps-card">
        <div class="fia-cap">IMAGENS · ${n} DE ${MAX_IMGS}</div>
        <div class="fia-thumbs">
          ${F.imgs.map(i => `<div class="fia-th"><img src="${i.url}" alt=""><button type="button" data-act="rmimg" data-id="${i.id}" aria-label="Remover imagem"${_busy ? ' disabled' : ''}>×</button></div>`).join('')}
        </div>
        <button type="button" class="ps-btn" data-act="addimg"${_busy || n >= MAX_IMGS ? ' disabled' : ''}><i class="bi bi-image"></i> Adicionar imagens</button>
        <input type="file" id="fiaArq" data-f="arq" accept="image/*" multiple hidden>
        <p>Comprovantes de Pix, prints do WhatsApp, recibos da maquininha. As imagens vão para a IA só para leitura e não ficam salvas no app.</p>
      </div>
      ${F.erro ? `<div class="ps-card ps-alerta"><p>${esc(F.erro)}</p></div>` : ''}
      <button type="button" class="ps-btn ps-prim" id="fiaLer" data-act="ler"${pode ? '' : ' disabled'}>${_busy ? '<i class="bi bi-hourglass-split"></i> Lendo…' : 'Ler com IA'}</button>
      <button type="button" class="ps-btn ps-suave" data-act="registros"${_busy ? ' disabled' : ''}><i class="bi bi-clock-history"></i> Meus registros</button>`);
}

function botaoLer() {
    const b = overlay && overlay.querySelector('#fiaLer');
    if (b) b.disabled = _busy || !(F.texto.trim() || F.imgs.length);
}

function redimensionar(arq) {
    return new Promise((resolve, reject) => {
        const img = new Image(), url = URL.createObjectURL(arq);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const k = Math.min(1, MAX_PX / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            resolve(c.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui abrir a imagem ' + arq.name)); };
        img.src = url;
    });
}

async function adicionarImagens(arquivos) {
    const livres = MAX_IMGS - F.imgs.length;
    const lista = Array.from(arquivos || []).filter(a => /^image\//.test(a.type) || /\.(jpe?g|png|webp|heic)$/i.test(a.name));
    if (!lista.length) return;
    if (livres <= 0) return toast(`O limite é de ${MAX_IMGS} imagens.`);
    if (lista.length > livres) toast(`O limite é de ${MAX_IMGS} imagens: usei só as ${livres} primeiras.`);
    const tk = _tk, estado = F;
    for (const a of lista.slice(0, livres)) {
        try {
            const url = await redimensionar(a);
            if (tk !== _tk || estado !== F) return;
            F.imgs.push({ id: ++F.seq, url });
        } catch (e) { toast(e.message); }
    }
    if (TELA === 'entrada') telaEntrada();
}

// ── Leitura pela IA ─────────────────────────────────────────────
const PROMPT = `Você lê dados de UMA venda de celular/aparelho em uma loja brasileira. Pode receber texto e imagens (comprovantes de Pix, prints de conversa do WhatsApp, recibos de maquininha de cartão). Sua tarefa é SOMENTE LER e copiar. NÃO calcule taxa, líquido, lucro nem some nada.

Responda APENAS com um JSON, sem texto antes ou depois, neste formato:
{
 "cliente": "nome do cliente ou vazio",
 "produto": "nome do aparelho vendido, como está escrito, sem emojis",
 "pagamentos": [
  {"tipo": "cartao" | "pix" | "dinheiro" | "troca",
   "valor": número | null,
   "parcelas": número | null,
   "valorParcela": número | null,
   "bandeira": "visa" | "mastercard" | "elo" | "hipercard" | "amex" | "",
   "maquininha": "pagbank" | "infinity" | "valorante" | "nubank" | "",
   "aparelho": "só para troca: modelo do aparelho dado na troca"}
 ],
 "avisos": ["dúvidas curtas, se houver"]
}

REGRAS:
- Números no padrão brasileiro: "2.170,04" = 2170.04 e "180,84" = 180.84. Responda números como número JSON (ponto decimal), sem "R$".
- CARTÃO: "valor" é o TOTAL passado no cartão (a soma de todas as parcelas, ex.: "Total: R$ 2.170,04" ou o total do recibo). Se aparece só "12x R$ 180,84" sem total, deixe "valor" null e preencha "valorParcela": 180.84. "parcelas": 12. Crédito à vista = 1. Débito = 0. Se não der para saber, null.
- Vários cartões na mesma venda: um item "cartao" para cada passada.
- PIX ou DINHEIRO: "valor" pago. Pode usar "pix" ou "dinheiro".
- TROCA: aparelho dado como parte do pagamento; "valor" é o quanto ele abate da venda.
- Se o MESMO pagamento aparece no texto e também no recibo/comprovante, liste UMA vez só (prefira os números do recibo/comprovante). O mesmo comprovante em duas imagens também conta uma vez.
- "bandeira" e "maquininha": preencha SOMENTE se estiver escrito ou aparecer claramente (logo, texto do recibo). Se não aparecer, deixe "". Não adivinhe.
- "cliente": a pessoa que está COMPRANDO (pagador do Pix, titular no extrato/print, nome na conversa ou no recibo). Nunca o nome da loja nem do vendedor. Se não achar, "".
- Não invente nada. Em dúvida, null ou "" e registre em "avisos".`;

function extrairJson(resp) {
    const m = String(resp || '').match(/\{[\s\S]*\}/);
    if (!m) throw new Error('A IA não devolveu uma leitura válida. Tente de novo.');
    try { return JSON.parse(m[0]); } catch (e) { throw new Error('A IA devolveu uma leitura que não consegui entender. Tente de novo.'); }
}

async function ler() {
    if (_busy || !F || !(F.texto.trim() || F.imgs.length)) return;
    const tk = ++_tk, estado = F;
    _busy = true; F.erro = '';
    telaEntrada();
    try {
        await window.ctwCarregarModulo('creditoscan');
        if (typeof window.ctwIAVisao !== 'function') throw new Error('A leitura por IA não está disponível agora. Tente de novo em instantes.');
        const content = F.imgs.map(i => ({ type: 'image_url', image_url: { url: i.url } }));
        content.push({ type: 'text', text: PROMPT + (F.texto.trim() ? '\n\nTEXTO DA VENDA:\n' + F.texto.trim() : '') });
        const resp = await window.ctwIAVisao([{ role: 'user', content }]);
        if (tk !== _tk || estado !== F) return;
        montarFormulario(extrairJson(resp));
        _busy = false;
        telaConferir();
    } catch (e) {
        if (tk !== _tk || estado !== F) return;
        _busy = false;
        F.erro = (e && e.message) || 'Não consegui ler agora. Tente de novo.';
        telaEntrada();
    }
}

// ── Do JSON da IA para o formulário editável ────────────────────
const tipoDe = t => {
    const s = norm(t);
    if (/cart|cred|deb/.test(s)) return 'cartao';
    if (/troca/.test(s)) return 'troca';
    if (/pix|dinh|especie|transf|vista/.test(s)) return 'pix';
    return null;
};
const bandDe = b => {
    const s = norm(b);
    if (/master/.test(s)) return 'mastercard';
    if (/visa/.test(s)) return 'visa';
    if (/hipercard/.test(s)) return 'hipercard';
    if (/hiper/.test(s)) return 'hiper';
    if (/elo/.test(s)) return 'elo';
    if (/amex|american/.test(s)) return 'amex';
    return '';
};
const maqDe = m => {
    const s = norm(m), ativas = maqsAtivas().map(x => x[0]);
    const v = /pag/.test(s) ? 'pagbank' : /infinit/.test(s) ? 'infinity' : /valor/.test(s) ? 'valorante' : /nu/.test(s) ? 'nubank' : '';
    return ativas.includes(v) ? v : '';
};

function novaLinha(k, o) {
    return Object.assign({ id: ++F.seq, k, valor: '', parc: null, band: '', maq: maqPadrao(), parcDuv: false, bandDuv: false, vp: null, semTotal: false, aparelho: '', manual: false }, o || {});
}

function montarFormulario(d) {
    F.cliente = String(d.cliente || '').trim().slice(0, 80);
    F.avisosIA = (Array.isArray(d.avisos) ? d.avisos : []).map(a => String(a).trim()).filter(Boolean).slice(0, 4);
    F.prod = acharProduto(String(d.produto || '').trim());
    F.pag = [];
    (Array.isArray(d.pagamentos) ? d.pagamentos : []).slice(0, 12).forEach(p => {
        const k = tipoDe(p && p.tipo);
        if (!k) return;
        let valor = dinheiro(p.valor);
        if (k === 'cartao') {
            const pc = dinheiro(p.parcelas), debito = /deb/.test(norm(p.tipo));
            const parc = pc != null && pc >= 0 && Math.floor(pc) === pc ? pc : (debito ? 0 : null);
            const vp = dinheiro(p.valorParcela), l = novaLinha('cartao', { parc, vp: vp > 0 ? vp : null });
            if (!(valor > 0) && l.vp && l.parc > 0) { valor = r2(l.vp * l.parc); l.semTotal = true; }
            l.valor = valor > 0 ? fmtIn(valor) : '';
            l.parcDuv = l.parc == null;
            const maq = maqDe(p.maquininha); if (maq) l.maq = maq;
            const b = bandDe(p.bandeira);
            if (b) l.band = b; else { l.band = bandPadrao(); l.bandDuv = true; }
            F.pag.push(l);
        } else if (k === 'pix') {
            F.pag.push(novaLinha('pix', { valor: valor > 0 ? fmtIn(valor) : '' }));
        } else {
            F.pag.push(novaLinha('troca', { valor: valor > 0 ? fmtIn(valor) : '', aparelho: String(p.aparelho || '').trim().slice(0, 60) }));
        }
    });
    if (!F.pag.length) F.avisosIA.unshift('A IA não achou nenhum pagamento. Adicione abaixo.');
    F.erros = []; F.res = null; F.salvoId = null; F.salvoTs = null;
}

// Produto do CTW: pega o mais parecido; se a semelhança é fraca, marca "confira"
const tokens = s => Array.from(new Set(norm(s).split(/[^a-z0-9]+/).filter(t => t.length > 1 && !['de', 'do', 'da', 'novo', 'nova', 'com'].includes(t))));
function buscarProdutos(termo, max) {
    const prods = window.products || [];
    if (!termo) return [];
    const fuse = window._fuse;
    const lista = fuse ? fuse.search(termo).slice(0, max || 8).map(r => r.item) : prods.filter(p => norm(p.nome).includes(norm(termo))).slice(0, max || 8);
    return lista;
}
function acharProduto(lido) {
    const base = { nome: lido, id: null, valor: null, manual: false, duvida: false, lido };
    if (!lido) return base;
    const tl = tokens(lido);
    let melhor = null, cob = 0;
    buscarProdutos(lido, 5).forEach(p => {
        const tp = new Set(tokens(p.nome)), c = tl.length ? tl.filter(t => tp.has(t)).length / tl.length : 0;
        if (c > cob) { cob = c; melhor = p; }
    });
    if (!melhor || cob < 0.5) return base;
    return { nome: melhor.nome, id: melhor.id, valor: parseFloat(melhor.valor) || 0, manual: false, duvida: cob < 0.85, lido };
}

// ── 2 · Conferir ────────────────────────────────────────────────
const campo = (rot, html, extra) => `<div class="fia-c${extra ? ' ' + extra : ''}"><div class="fia-cl">${rot}</div>${html}</div>`;
const linhaErro = id => { const e = F.erros.filter(x => x.id === id); return e.length ? `<div class="fia-err">${e.map(x => esc(x.msg)).join('<br>')}</div>` : ''; };

function notaCartao(l) {
    const v = dinheiro(l.valor);
    if (!(l.vp > 0) || !(l.parc > 0)) return { t: '', forte: false };
    const calc = r2(l.vp * l.parc);
    if (l.semTotal && v != null && Math.abs(v - calc) < 0.005) return { t: `Não veio o total impresso: calculei ${l.parc} × ${brl(l.vp)} = ${brl(calc)}.`, forte: false };
    if (v == null || Math.abs(v - calc) < 0.005) return { t: '', forte: false };
    const dif = Math.abs(v - calc);
    return { t: `${l.parc} × ${brl(l.vp)} = ${brl(calc)}. O total informado é ${brl(v)}: vale o total.${dif > 1 ? ' A diferença passa de R$ 1,00: confira.' : ''}`, forte: dif > 1 };
}

function htmlLinha(l) {
    const rem = '<button type="button" class="fia-rem" data-act="rem" data-id="' + l.id + '">Remover</button>';
    if (l.k === 'pix') {
        return `<div class="ps-card fia-lin" data-lid="${l.id}">
          <div class="fia-lh"><span class="fia-tag">PIX / DINHEIRO</span><span class="ps-sub fia-g">sem taxa</span>${rem}</div>
          ${campo('Valor (R$)', `<input class="fia-in" data-f="valor" data-id="${l.id}" inputmode="decimal" placeholder="0,00" value="${esc(l.valor)}">`, 'fia-w150')}
          ${linhaErro(l.id)}</div>`;
    }
    if (l.k === 'troca') {
        return `<div class="ps-card fia-lin" data-lid="${l.id}">
          <div class="fia-lh"><span class="fia-tag">TROCA</span><span class="ps-sub fia-g">conta como recebido pelo valor combinado</span>${rem}</div>
          <div class="fia-row">
            ${campo('Aparelho', `<input class="fia-in" data-f="aparelho" data-id="${l.id}" placeholder="Modelo" value="${esc(l.aparelho)}">`)}
            ${campo('Valor (R$)', `<input class="fia-in" data-f="valor" data-id="${l.id}" inputmode="decimal" placeholder="0,00" value="${esc(l.valor)}">`)}
          </div>
          ${linhaErro(l.id)}</div>`;
    }
    const max = MAX_PARC[l.maq] || 18, ehPag = l.maq === 'pagbank', nt = notaCartao(l);
    let optsP = `<option value=""${l.parc == null ? ' selected' : ''}>Escolher</option>`;
    for (let p = 0; p <= max; p++) optsP += `<option value="${p}"${l.parc === p ? ' selected' : ''}>${rotParc(p)}</option>`;
    if (l.parc != null && l.parc > max) optsP += `<option value="${l.parc}" selected>${l.parc}x (sem taxa)</option>`;
    const optsM = maqsAtivas().map(m => `<option value="${m[0]}"${l.maq === m[0] ? ' selected' : ''}>${m[1]}</option>`).join('');
    const optsB = `<option value=""${l.band ? '' : ' selected'}>Escolher</option>` + BANDEIRAS.map(b => `<option value="${b[0]}"${l.band === b[0] ? ' selected' : ''}>${b[1]}</option>`).join('');
    return `<div class="ps-card fia-lin" data-lid="${l.id}">
      <div class="fia-lh"><span class="fia-tag fia-tag-c">CARTÃO</span><span class="ps-sub fia-g">${l.manual ? 'adicionado por você' : 'lido pela IA'}</span>${rem}</div>
      <div class="fia-row">
        ${campo('Total passado (R$)', `<input class="fia-in" data-f="valor" data-id="${l.id}" inputmode="decimal" placeholder="0,00" value="${esc(l.valor)}">`, 'fia-w13')}
        ${campo(l.parcDuv ? 'Parcelas · confira' : 'Parcelas', `<select class="fia-in" data-f="parc" data-id="${l.id}">${optsP}</select>`, l.parcDuv ? 'fia-duv' : '')}
      </div>
      <div class="fia-row">
        ${campo('Maquininha', `<select class="fia-in" data-f="maq" data-id="${l.id}">${optsM}</select>`)}
        ${ehPag ? '' : campo(l.bandDuv ? 'Bandeira · confira' : 'Bandeira', `<select class="fia-in" data-f="band" data-id="${l.id}">${optsB}</select>`, l.bandDuv ? 'fia-duv' : '')}
      </div>
      <div class="fia-nota${nt.forte ? ' fia-nota-forte' : ''}" data-nota="${l.id}">${esc(nt.t)}</div>
      ${linhaErro(l.id)}</div>`;
}

function htmlProduto() {
    const p = F.prod || { nome: '', valor: null }, tem = p.valor > 0, erroP = linhaErro('prod');
    let info;
    if (tem) info = `valor no CTW ${brl(p.valor)}${p.manual ? ' · digitado por você' : ''}`;
    else info = p.valor === 0 && p.id ? 'este produto está sem valor no CTW' : 'não achei no CTW';
    const duv = !p.manual && (p.duvida || !tem);
    return `<div class="ps-card${duv ? ' fia-duvc' : ''}">
      <div class="fia-cap">PRODUTO NO CTW${p.duvida ? ' · CONFIRA' : ''}</div>
      <div class="fia-prod">
        <div class="ps-grow"><div class="ps-nome">${esc(p.nome || 'Produto não identificado')}</div><div class="ps-sub">${esc(info)}</div>
          ${p.lido && norm(p.lido) !== norm(p.nome) ? `<div class="ps-sub">A IA leu: “${esc(p.lido)}”</div>` : ''}</div>
        <button type="button" class="ps-link" data-act="trocarprod">${tem ? 'Trocar' : 'Buscar'}</button>
      </div>${erroP}</div>`;
}

function telaConferir(manterScroll) {
    TELA = 'conferir'; titulo('Conferir');
    const gerais = F.erros.filter(e => e.id == null);
    tela(`
      <div class="ps-sub">Corrija o que estiver errado. O cálculo só roda depois de você confirmar.</div>
      ${gerais.length ? `<div class="ps-card fia-errc">${gerais.map(e => `<p>${esc(e.msg)}</p>`).join('')}</div>` : ''}
      ${F.avisosIA.length ? `<div class="ps-card ps-alerta"><div class="fia-cap">A IA AVISOU</div>${F.avisosIA.map(a => `<p>${esc(a)}</p>`).join('')}</div>` : ''}
      <div class="ps-card"><div class="fia-cap">CLIENTE</div>
        <input class="fia-in fia-cli" data-f="cliente" placeholder="Nome do cliente (opcional)" maxlength="80" value="${esc(F.cliente)}"></div>
      ${htmlProduto()}
      ${F.pag.map(htmlLinha).join('')}
      <div class="fia-add">
        <button type="button" class="ps-btn" data-act="add" data-k="cartao">+ Cartão</button>
        <button type="button" class="ps-btn" data-act="add" data-k="pix">+ Pix/dinheiro</button>
        <button type="button" class="ps-btn" data-act="add" data-k="troca">+ Troca</button>
      </div>`,
        '<button type="button" class="ps-btn ps-prim" data-act="calcular">Calcular valor real</button>', manterScroll);
}

function atualizarNota(l) {
    const el = overlay && overlay.querySelector(`[data-nota="${l.id}"]`);
    if (!el) return;
    const nt = notaCartao(l);
    el.textContent = nt.t; el.classList.toggle('fia-nota-forte', nt.forte);
}

// ── Escolha do produto ──────────────────────────────────────────
function telaProduto() {
    TELA = 'produto'; titulo('Produto');
    const ini = (F.prod && (F.prod.lido || F.prod.nome)) || '';
    tela(`
      <div class="ps-busca"><input id="fiaBusca" data-f="busca" placeholder="Buscar produto no CTW" autocomplete="off" value="${esc(ini)}"></div>
      <div class="ps-col" id="fiaResBusca"></div>
      <div class="ps-card">
        <div class="fia-cap">NÃO ACHOU? DIGITE O VALOR</div>
        <input class="fia-in" data-f="mnome" placeholder="Nome do produto" value="">
        <input class="fia-in" data-f="mvalor" inputmode="decimal" placeholder="Valor no CTW (R$)" value="">
        <button type="button" class="ps-btn" data-act="usarmanual">Usar este valor</button>
      </div>`);
    buscar(ini);
}

function buscar(termo) {
    const box = overlay && overlay.querySelector('#fiaResBusca');
    if (!box) return;
    const t = String(termo || '').trim();
    if (!t) { box.innerHTML = '<div class="ps-msg">Digite o nome do produto.</div>'; return; }
    const lista = buscarProdutos(t, 8);
    box.innerHTML = lista.length ? lista.map(p => `<button type="button" class="ps-cand" data-act="escprod" data-id="${esc(p.id)}"><span class="ps-nome">${esc(p.nome)}</span><span class="ps-valor">${brl(parseFloat(p.valor) || 0)}</span></button>`).join('')
        : '<div class="ps-msg">Nenhum produto encontrado.</div>';
}

// ── Cálculo (feito aqui, com as taxas cadastradas) ──────────────
function calcular() {
    const erros = [];
    if (!window._areRatesLoaded || typeof window._getRate !== 'function') return { erros: [{ id: null, msg: 'As taxas ainda estão carregando. Tente de novo em instantes.' }] };
    const base = F.prod && F.prod.valor > 0 ? r2(F.prod.valor) : 0;
    if (!base) erros.push({ id: 'prod', msg: 'Escolha o produto no CTW ou digite o valor dele.' });
    if (!F.pag.length) erros.push({ id: null, msg: 'Adicione pelo menos um pagamento.' });
    const linhas = [];
    F.pag.forEach(l => {
        const v = dinheiro(l.valor);
        if (!(v > 0)) { erros.push({ id: l.id, msg: 'Informe o valor.' }); return; }
        if (l.k === 'pix') { linhas.push({ k: 'pix', valor: r2(v) }); return; }
        if (l.k === 'troca') { linhas.push({ k: 'troca', valor: r2(v), aparelho: l.aparelho.trim() }); return; }
        if (l.parc == null) { erros.push({ id: l.id, msg: 'Escolha as parcelas (Débito ou Nx).' }); return; }
        const ehPag = l.maq === 'pagbank';
        if (!ehPag && !l.band) { erros.push({ id: l.id, msg: 'Escolha a bandeira do cartão.' }); return; }
        let taxa;
        try { taxa = window._getRate(l.maq, l.band, l.parc); } catch (e) { taxa = undefined; }
        if (taxa == null || typeof taxa !== 'number' || !isFinite(taxa)) {
            erros.push({ id: l.id, msg: `Não há taxa cadastrada para ${nomeMaq(l.maq)}${ehPag ? '' : ' ' + nomeBand(l.band)} ${rotParc(l.parc)}. Cadastre em Taxas ou corrija a linha.` });
            return;
        }
        const liq = r2(v * (1 - taxa / 100));
        linhas.push({ k: 'cartao', valor: r2(v), parcelas: l.parc, bandeira: ehPag ? '' : l.band, maq: l.maq, taxa, desc: r2(v - liq), liq });
    });
    if (erros.length) return { erros };
    const real = r2(linhas.reduce((s, l) => s + (l.k === 'cartao' ? l.liq : l.valor), 0));
    return { erros, res: { cliente: F.cliente.trim(), produto: { nome: (F.prod.nome || '').trim(), valor: base }, linhas, real, lucro: r2(real - base) } };
}

// ── 3 · Resultado (também usado no detalhe do registro) ─────────
function htmlResultado(R) {
    const cartoes = R.linhas.filter(l => l.k === 'cartao'), temTroca = R.linhas.some(l => l.k === 'troca');
    const simples = cartoes.length === 1 && !temTroca;
    const cls = R.lucro > 0 ? 'ok' : R.lucro < 0 ? 'neg' : '';
    let n = 0;
    const lin = R.linhas.map(l => {
        if (l.k === 'pix') return `<div class="ps-lin"><span>Pix / dinheiro</span><b>${brl(l.valor)}</b></div>`;
        if (l.k === 'troca') return `<div class="fia-bl"><div class="ps-lin"><span>Troca${l.aparelho ? ' · ' + esc(l.aparelho) : ''}</span><b>${brl(l.valor)}</b></div><div class="ps-sub">conta como recebido pelo valor combinado</div></div>`;
        n++;
        if (simples) return `<div class="fia-bl"><div class="ps-lin"><span>${l.parcelas === 0 ? 'Débito' : 'Cartão ' + l.parcelas + 'x'} · passou</span><b>${brl(l.valor)}</b></div>
          <div class="ps-lin fia-neg"><span>taxa ${fmtTaxa(l.taxa)}</span><span>− ${brl(l.desc)}</span></div>
          <div class="ps-lin"><span>Líquido do cartão</span><b>${brl(l.liq)}</b></div></div>`;
        const nome = `Cartão ${cartoes.length > 1 ? n + ' · ' : '· '}${rotParc(l.parcelas)}${l.bandeira ? ' · ' + nomeBand(l.bandeira) : ''}`;
        return `<div class="fia-bl"><div class="ps-lin"><span>${esc(nome)}</span><b>${brl(l.valor)}</b></div><div class="ps-lin fia-sub2"><span>taxa ${fmtTaxa(l.taxa)} → líquido</span><b>${brl(l.liq)}</b></div></div>`;
    }).join('<div class="fia-hr"></div>');
    const c1 = cartoes[0];
    const rodapeNota = simples && c1 ? `<div class="ps-card"><p>${esc(nomeMaq(c1.maq))}${c1.bandeira ? ' · ' + esc(nomeBand(c1.bandeira)) : ''} · taxa lida do cadastro de Taxas.</p></div>` : '';
    return `
      <div class="ps-sub">${R.cliente ? esc(R.cliente) + ' · ' : ''}${esc(R.produto.nome || 'Produto sem nome')}</div>
      <div class="fia-big ${cls}">
        <div class="fia-cap">${R.lucro < 0 ? 'Prejuízo desta venda' : 'Lucro extra desta venda'}</div>
        <div class="fia-val">${sinal(R.lucro)}</div>
        <div class="ps-sub">Valor real final ${brl(R.real)} contra ${brl(R.produto.valor)} no CTW</div>
      </div>
      <div class="ps-card">
        <div class="fia-cap">${simples ? 'COMO CHEGUEI NESSE VALOR' : 'LINHA A LINHA'}</div>
        ${lin}
        <div class="fia-hr"></div>
        <div class="ps-lin fia-tot"><b>Valor real final</b><b>${brl(R.real)}</b></div>
        <div class="ps-lin fia-sub2"><span>Produto no CTW</span><span>− ${brl(R.produto.valor)}</span></div>
      </div>
      ${temTroca ? '<div class="ps-card ps-alerta"><p>A troca não é dinheiro na mão: o lucro só se confirma quando o aparelho for revendido por esse valor.</p></div>' : ''}
      ${rodapeNota}`;
}

function resumoTexto(R) {
    const L = [`Fechar venda · ${R.produto.nome || 'Produto'}`];
    if (R.cliente) L.push(`Cliente: ${R.cliente}`);
    R.linhas.forEach(l => {
        if (l.k === 'cartao') L.push(`${l.parcelas === 0 ? 'Débito' : 'Cartão ' + l.parcelas + 'x'}${l.bandeira ? ' ' + nomeBand(l.bandeira) : ''} (${nomeMaq(l.maq)}): ${brl(l.valor)} → líquido ${brl(l.liq)} (taxa ${fmtTaxa(l.taxa)})`);
        else if (l.k === 'pix') L.push(`Pix/dinheiro: ${brl(l.valor)}`);
        else L.push(`Troca${l.aparelho ? ' (' + l.aparelho + ')' : ''}: ${brl(l.valor)}`);
    });
    L.push(`Valor real final: ${brl(R.real)}`, `Produto no CTW: ${brl(R.produto.valor)}`, `${R.lucro < 0 ? 'Prejuízo' : 'Lucro extra'}: ${sinal(R.lucro)}`);
    return L.join('\n');
}

async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); return true; } catch (e) { /* tenta o método antigo */ }
    try {
        const t = document.createElement('textarea'); t.value = texto; t.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok;
    } catch (e) { return false; }
}

function telaResultado() {
    TELA = 'resultado'; titulo('Resultado');
    const salvo = !!F.salvoId;
    tela(htmlResultado(F.res),
        `<button type="button" class="ps-btn ps-prim" data-act="salvar"${_salvando ? ' disabled' : ''}>${salvo ? '<i class="bi bi-check2"></i> Salvo · atualizar registro' : 'Salvar no registro'}</button>
         <div class="fia-2"><button type="button" class="ps-btn" data-act="copiar">Copiar resumo</button><button type="button" class="ps-btn" data-act="editar">Editar</button></div>`);
}

async function salvar() {
    const db = getDb(), R = F && F.res;
    if (_salvando || !R) return;
    if (!db) { toast('Sem conexão com o banco. Tente de novo.'); return; }
    _salvando = true; telaResultado();
    const estado = F;
    try {
        const pasta = `${BASE}/${chavePerfil()}`;
        const id = F.salvoId || push(ref(db, pasta)).key, ts = F.salvoTs || Date.now();
        const rec = JSON.parse(JSON.stringify({ ts, cliente: R.cliente, produto: R.produto.nome || 'Produto sem nome', base: R.produto.valor, real: R.real, lucro: R.lucro, linhas: R.linhas }));
        await set(ref(db, `${pasta}/${id}`), rec);
        if (estado === F) { F.salvoId = id; F.salvoTs = ts; }
        _salvando = false;
        if (estado === F && TELA === 'resultado') { telaResultado(); toast('Venda salva no seu registro.'); }
    } catch (e) {
        _salvando = false;
        if (estado === F && TELA === 'resultado') { telaResultado(); toast('Não consegui salvar: ' + ((e && e.message) || 'erro de conexão') + '. Tente de novo.'); }
    }
}

// ── 4 · Registros ───────────────────────────────────────────────
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
function inicioDia(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function desde(f) {
    const hj = inicioDia(Date.now());
    if (f === 'semana') { hj.setDate(hj.getDate() - ((hj.getDay() + 6) % 7)); return hj.getTime(); }   // segunda-feira
    if (f === 'mes') { hj.setDate(1); return hj.getTime(); }
    return 0;
}
function rotData(ts) {
    const d = new Date(ts), hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const dias = Math.round((inicioDia(Date.now()) - inicioDia(ts)) / 86400000);
    if (dias === 0) return 'Hoje ' + hh;
    if (dias === 1) return 'Ontem ' + hh;
    if (dias > 1 && dias < 7) return DIAS[d.getDay()] + ' ' + hh;
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + ' ' + hh;
}
function resumoPag(linhas) {
    const c = linhas.filter(l => l.k === 'cartao'), parts = [];
    if (c.length === 1) parts.push(c[0].parcelas === 0 ? 'débito' : 'cartão ' + c[0].parcelas + 'x');
    else if (c.length > 1) parts.push(c.length + ' cartões');
    if (linhas.some(l => l.k === 'pix')) parts.push('Pix');
    if (linhas.some(l => l.k === 'troca')) parts.push('troca');
    return parts.length <= 2 ? parts.join(' + ') : parts.slice(0, -1).join(', ') + ' e ' + parts[parts.length - 1];
}

async function telaRegistros() {
    TELA = 'registros'; _exc = null; titulo('Meus registros');
    tela('<div class="ps-msg">Carregando…</div>');
    const db = getDb(), tk = _tk;
    if (!db) { tela('<div class="ps-msg ps-erro">Sem conexão com o banco.</div>'); return; }
    try {
        const v = (await get(ref(db, `${BASE}/${chavePerfil()}`))).val() || {};
        if (tk !== _tk || TELA !== 'registros') return;
        REG = Object.entries(v).filter(([, r]) => r && Array.isArray(r.linhas)).map(([id, r]) => ({ id, ...r })).sort((a, b) => (b.ts || 0) - (a.ts || 0));
        renderRegistros();
    } catch (e) {
        if (tk === _tk && TELA === 'registros') tela(`<div class="ps-msg ps-erro">Não consegui ler os registros: ${esc((e && e.message) || 'erro de conexão')}</div><button type="button" class="ps-btn" data-act="registros">Tentar de novo</button>`);
    }
}

function renderRegistros() {
    TELA = 'registros'; _exc = null; titulo('Meus registros');
    const ini = desde(FILTRO), lista = REG.filter(r => (r.ts || 0) >= ini);
    const tot = r2(lista.reduce((s, r) => s + (Number(r.lucro) || 0), 0));
    const abas = [['semana', 'Esta semana'], ['mes', 'Este mês'], ['tudo', 'Tudo']];
    tela(`
      <div class="ps-sub">Cada perfil vê só as próprias vendas.</div>
      <div class="fia-abas">${abas.map(a => `<button type="button" class="${FILTRO === a[0] ? 'on' : ''}" data-act="filtro" data-id="${a[0]}">${a[1]}</button>`).join('')}</div>
      <div class="ps-card fia-tot2"><div class="ps-grow"><div class="ps-sub">Lucro extra no período</div><div class="fia-val ${tot > 0 ? 'ok' : tot < 0 ? 'neg' : ''}">${sinal(tot)}</div></div><div class="ps-sub">${lista.length} ${lista.length === 1 ? 'venda' : 'vendas'}</div></div>
      ${lista.length ? lista.map(r => `<button type="button" class="ps-cand fia-reg" data-act="detalhe" data-id="${esc(r.id)}">
          <span class="fia-regl"><span class="ps-grow"><span class="ps-nome">${esc(r.produto || 'Produto')}</span><span class="ps-sub">${r.cliente ? esc(r.cliente) + ' · ' : ''}${rotData(r.ts || 0)} · ${esc(resumoPag(r.linhas))}</span></span>
          <b class="${r.lucro > 0 ? 'ok' : r.lucro < 0 ? 'neg' : ''}">${sinal(Number(r.lucro) || 0)}</b></span></button>`).join('')
        : '<div class="ps-msg">Nenhuma venda neste período.</div>'}`);
}

function paraResultado(r) {
    return { cliente: r.cliente || '', ts: r.ts, produto: { nome: r.produto, valor: Number(r.base) || 0 }, linhas: r.linhas, real: Number(r.real) || 0, lucro: Number(r.lucro) || 0 };
}

function telaDetalhe(id) {
    const r = REG.find(x => x.id === id);
    if (!r) return telaRegistros();
    TELA = 'detalhe'; titulo('Venda'); _exc = null;
    const R = paraResultado(r);
    tela(`<div class="ps-sub">${rotData(r.ts || 0)}</div>` + htmlResultado(R),
        `<div class="fia-2"><button type="button" class="ps-btn" data-act="copiar">Copiar resumo</button><button type="button" class="ps-btn ps-perigo" data-act="excluir" data-id="${esc(id)}">Excluir</button></div>`);
    F.det = R;
}

async function excluir(id) {
    if (_exc !== id) {
        _exc = id;
        const b = overlay.querySelector('[data-act="excluir"]');
        if (b) b.textContent = 'Toque de novo para excluir';
        return;
    }
    const db = getDb(); if (!db) return toast('Sem conexão com o banco.');
    try {
        await remove(ref(db, `${BASE}/${chavePerfil()}/${id}`));
        REG = REG.filter(x => x.id !== id);
        if (F.salvoId === id) { F.salvoId = null; F.salvoTs = null; }
        _exc = null;
        renderRegistros();
        toast('Registro excluído.');
    } catch (e) { toast('Não consegui excluir: ' + ((e && e.message) || 'erro de conexão')); }
}

// ── Eventos ─────────────────────────────────────────────────────
const achar = id => F && F.pag.find(l => String(l.id) === String(id));

function voltar() {
    if (TELA === 'entrada') return fechar();
    if (TELA === 'produto' || TELA === 'resultado') return telaConferir();
    if (TELA === 'detalhe') return renderRegistros();
    return telaEntrada();
}

function aoClicar(e) {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const act = b.dataset.act, id = b.dataset.id;
    if (act === 'voltar') return voltar();
    if (act === 'toastdesfazer') { const f = _toastFn; _toastFn = null; if (f) f(); const t = overlay.querySelector('.ps-toast'); if (t) t.remove(); return; }
    if (act === 'addimg') return overlay.querySelector('#fiaArq').click();
    if (act === 'rmimg') { F.imgs = F.imgs.filter(i => String(i.id) !== String(id)); return telaEntrada(); }
    if (act === 'ler') return ler();
    if (act === 'registros') return telaRegistros();
    if (act === 'filtro') { FILTRO = id; return renderRegistros(); }
    if (act === 'detalhe') return telaDetalhe(id);
    if (act === 'excluir') return excluir(id);
    if (act === 'trocarprod') return telaProduto();
    if (act === 'escprod') {
        const p = (window.products || []).find(x => String(x.id) === String(id)); if (!p) return;
        F.prod = { nome: p.nome, id: p.id, valor: parseFloat(p.valor) || 0, manual: false, duvida: false, lido: F.prod && F.prod.lido };
        return telaConferir();
    }
    if (act === 'usarmanual') {
        const nome = overlay.querySelector('[data-f="mnome"]').value.trim(), v = dinheiro(overlay.querySelector('[data-f="mvalor"]').value);
        if (!(v > 0)) return toast('Informe o valor do produto no CTW.');
        F.prod = { nome: nome || (F.prod && (F.prod.nome || F.prod.lido)) || 'Produto', id: null, valor: r2(v), manual: true, duvida: false, lido: F.prod && F.prod.lido };
        return telaConferir();
    }
    if (act === 'add') {
        const k = b.dataset.k, o = k === 'cartao' ? { manual: true, parcDuv: true, band: bandPadrao() } : {};
        F.pag.push(novaLinha(k, o)); F.erros = [];
        telaConferir(true);
        const c = overlay.querySelector('#fiaCorpo'); c.scrollTop = c.scrollHeight;
        return;
    }
    if (act === 'rem') {
        const i = F.pag.findIndex(l => String(l.id) === String(id)); if (i < 0) return;
        const [l] = F.pag.splice(i, 1); F.erros = [];
        telaConferir(true);
        toast('Pagamento removido.', () => { if (!F || TELA !== 'conferir') return; F.pag.splice(Math.min(i, F.pag.length), 0, l); telaConferir(true); });
        return;
    }
    if (act === 'calcular') {
        const r = calcular();
        F.erros = r.erros;
        if (r.erros.length) { telaConferir(); return; }
        F.res = r.res; return telaResultado();
    }
    if (act === 'editar') return telaConferir();
    if (act === 'salvar') return salvar();
    if (act === 'copiar') {
        const R = TELA === 'detalhe' ? F.det : F.res;
        return copiar(resumoTexto(R)).then(ok => toast(ok ? 'Resumo copiado.' : 'Não consegui copiar neste aparelho.'));
    }
}

function aoDigitar(e) {
    const t = e.target, f = t.dataset && t.dataset.f; if (!f || !F) return;
    if (f === 'texto') { F.texto = t.value; return botaoLer(); }
    if (f === 'cliente') { F.cliente = t.value; return; }
    if (f === 'busca') return buscar(t.value);
    const l = achar(t.dataset.id); if (!l) return;
    if (f === 'valor') { l.valor = t.value; atualizarNota(l); }
    else if (f === 'aparelho') l.aparelho = t.value;
}

function aoMudar(e) {
    const t = e.target, f = t.dataset && t.dataset.f; if (!f || !F) return;
    if (f === 'arq') { const arqs = Array.from(t.files || []); t.value = ''; return adicionarImagens(arqs); }
    const l = achar(t.dataset.id); if (!l) return;
    if (f === 'parc') { l.parc = t.value === '' ? null : parseInt(t.value, 10); l.parcDuv = false; }
    else if (f === 'maq') l.maq = t.value;
    else if (f === 'band') { l.band = t.value; l.bandDuv = false; }
    else return;
    telaConferir(true);
}

// ── Entrada do módulo ───────────────────────────────────────────
function abrir() {
    if (!(window.ctwEhDev && window.ctwEhDev())) return;
    if (!getDb()) { if (window.showCustomModal) window.showCustomModal({ message: 'O banco de dados ainda está conectando. Tente de novo em alguns segundos.' }); return; }
    F = novoEstado();
    abrirOverlay();
    telaEntrada();
}

export { abrir };
