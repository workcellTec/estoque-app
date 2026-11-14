// ================================================================
// fechamentoia.js — Valor líquido da venda (somente dev)
// A IA só LÊ (texto e/ou imagens): produto, cliente e a lista de pagamentos.
// Quem faz a conta é o app, com as taxas cadastradas em Taxas (window._getRate).
// Duas portas de entrada, com o mesmo cálculo:
//   • solto     — Taxas > Fechar venda > "Fechar venda IA" (texto/imagens → conferir → resultado)
//   • detalhada — "Garantia detalhada" (botão + do menu, só dev): tela própria que cria ou edita a garantia já com o líquido,
//                 e tem a aba Histórico (o líquido das garantias aparece só ali)
// Registros: settings/fechamentosIA/{perfil}/{id}. Os da garantia usam o id da própria garantia como chave
// (recalcular atualiza o mesmo registro, nunca duplica). Nada disso vai no PDF nem aparece para outros perfis.
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
const ehDev = () => !!(window.ctwEhDev && window.ctwEhDev());
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
// E (estado de uma conferência): modo, itens (produtos com o valor no CTW), pag (linhas de pagamento), cliente...
let overlay = null, TELA = 'entrada', F = null, REG = [], FILTRO = 'semana';
let _busy = false, _tk = 0, _salvando = false, _exc = null, _toastT = null, _toastFn = null;
let MAPA = null, MAPA_TS = 0, CONT_H = null, LISTA_H = [];   // registros do perfil e histórico em tela

const novoEstado = modo => ({ modo: modo || 'solto', texto: '', imgs: [], cliente: '', itens: [], pag: [], seq: 0, erros: [], avisosIA: [], erro: '', res: null, salvoId: null, salvoTs: null, garantia: null, edIdx: 0 });
const novaLinha = (E, k, o) => Object.assign({ id: ++E.seq, k, valor: '', parc: null, band: '', maq: maqPadrao(), parcDuv: false, bandDuv: false, vp: null, semTotal: false, aparelho: '', manual: false }, o || {});

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

// ── 1 · Entrada (modo solto) ────────────────────────────────────
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
// Regras de leitura dos pagamentos: um texto só, usado no "Fechar venda IA" e no "Colar do Zap (IA)" da garantia
const REGRAS_PAG = `- Números no padrão brasileiro: "2.170,04" = 2170.04 e "180,84" = 180.84. Responda números como número JSON (ponto decimal), sem "R$".
- CARTÃO: "valor" é o TOTAL passado no cartão (a soma de todas as parcelas, ex.: "Total: R$ 2.170,04" ou o total do recibo). Se aparece só "12x R$ 180,84" sem total, deixe "valor" null e preencha "valorParcela": 180.84. "parcelas": 12. Crédito à vista = 1. Débito = 0. Se não der para saber, null.
- Vários cartões na mesma venda: um item "cartao" para cada passada.
- PIX ou DINHEIRO: "valor" pago. Pode usar "pix" ou "dinheiro".
- TROCA: aparelho dado como parte do pagamento; "valor" é o quanto ele abate da venda.
- Se o MESMO pagamento aparece no texto e também no recibo/comprovante, liste UMA vez só (prefira os números do recibo/comprovante). O mesmo comprovante em duas imagens também conta uma vez.
- "bandeira" e "maquininha": preencha SOMENTE se estiver escrito ou aparecer claramente (logo, texto do recibo). Se não aparecer, deixe "". Não adivinhe.
- Não invente nada. Em dúvida, null ou "".`;
const FORMATO_PAG = '{"tipo": "cartao" | "pix" | "dinheiro" | "troca", "valor": número | null, "parcelas": número | null, "valorParcela": número | null, "bandeira": "visa" | "mastercard" | "elo" | "hipercard" | "amex" | "", "maquininha": "pagbank" | "infinity" | "valorante" | "nubank" | "", "aparelho": "só para troca: modelo do aparelho dado na troca"}';

const PROMPT = `Você lê dados de UMA venda de celular/aparelho em uma loja brasileira. Pode receber texto e imagens (comprovantes de Pix, prints de conversa do WhatsApp, recibos de maquininha de cartão). Sua tarefa é SOMENTE LER e copiar. NÃO calcule taxa, líquido, lucro nem some nada.

Responda APENAS com um JSON, sem texto antes ou depois, neste formato:
{
 "cliente": "nome do cliente ou vazio",
 "produto": "nome do aparelho vendido, como está escrito, sem emojis",
 "pagamentos": [ ${FORMATO_PAG} ],
 "avisos": ["dúvidas curtas, se houver"]
}

REGRAS:
${REGRAS_PAG}
- "cliente": a pessoa que está COMPRANDO (pagador do Pix, titular no extrato/print, nome na conversa ou no recibo). Nunca o nome da loja nem do vendedor. Se não achar, "".`;

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

// Lista de pagamentos lida pela IA → linhas editáveis do estado E
function linhasDeIA(E, pagamentos) {
    const out = [];
    (Array.isArray(pagamentos) ? pagamentos : []).slice(0, 12).forEach(p => {
        const k = tipoDe(p && p.tipo);
        if (!k) return;
        let valor = dinheiro(p.valor);
        if (k === 'cartao') {
            const pc = dinheiro(p.parcelas), debito = /deb/.test(norm(p.tipo));
            const parc = pc != null && pc >= 0 && Math.floor(pc) === pc ? pc : (debito ? 0 : null);
            const vp = dinheiro(p.valorParcela), l = novaLinha(E, 'cartao', { parc, vp: vp > 0 ? vp : null });
            if (!(valor > 0) && l.vp && l.parc > 0) { valor = r2(l.vp * l.parc); l.semTotal = true; }
            l.valor = valor > 0 ? fmtIn(valor) : '';
            l.parcDuv = l.parc == null;
            const maq = maqDe(p.maquininha); if (maq) l.maq = maq;
            const b = bandDe(p.bandeira);
            if (b) l.band = b; else { l.band = bandPadrao(); l.bandDuv = true; }
            out.push(l);
        } else if (k === 'pix') {
            out.push(novaLinha(E, 'pix', { valor: valor > 0 ? fmtIn(valor) : '' }));
        } else {
            out.push(novaLinha(E, 'troca', { valor: valor > 0 ? fmtIn(valor) : '', aparelho: String(p.aparelho || '').trim().slice(0, 60) }));
        }
    });
    return out;
}

function montarFormulario(d) {
    F.cliente = String(d.cliente || '').trim().slice(0, 80);
    F.avisosIA = (Array.isArray(d.avisos) ? d.avisos : []).map(a => String(a).trim()).filter(Boolean).slice(0, 4);
    const lido = String(d.produto || '').trim();
    F.itens = [{ nome: lido, qtd: 1, valorG: null, prod: acharProduto(lido) }];
    F.pag = linhasDeIA(F, d.pagamentos);
    if (!F.pag.length) F.avisosIA.unshift('A IA não achou nenhum pagamento. Adicione abaixo.');
    F.erros = []; F.res = null; F.salvoId = null; F.salvoTs = null;
}

// ── Produtos do CTW ─────────────────────────────────────────────
// Pega o mais parecido; se a semelhança é fraca, marca "confira"
const SEM_PESO = ['de', 'do', 'da', 'novo', 'nova', 'com', 'lacrado', 'lacrada', 'seminovo', 'semi', 'usado', 'usada', 'vitrine', 'open', 'box'];   // condição do aparelho não identifica o produto
const tokens = s => Array.from(new Set(norm(s).split(/[^a-z0-9]+/).filter(t => t.length > 1 && !SEM_PESO.includes(t))));
// A busca do app exige TODAS as palavras ("poco x8 pro 512/12 - novo lacrado" não acha "POCO X8 Pro 512/12"). Por isso tenta,
// em ordem: o texto como veio → sem as palavras de condição (novo, lacrado, seminovo...) → tirando palavras do fim, até achar.
function variantesBusca(termo) {
    const orig = String(termo || '').trim(), v = [orig];
    const limpo = semCondicao(orig).replace(/[-–—|,;:()]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (limpo && limpo !== norm(orig)) v.push(limpo);
    const t = limpo.split(' ');
    for (let n = t.length - 1; n >= 2; n--) v.push(t.slice(0, n).join(' '));
    return v;
}
function buscarProdutos(termo, max) {
    const prods = window.products || [];
    if (!termo) return [];
    const fuse = window._fuse, lim = max || 8;
    for (const q of variantesBusca(termo)) {
        const r = fuse ? fuse.search(q).slice(0, lim).map(x => x.item) : prods.filter(p => norm(p.nome).includes(norm(q))).slice(0, lim);
        if (r.length) return r;
    }
    return [];
}
// Nomes ensinados: quando o usuário liga na mão um nome lido a um produto do CTW, o vínculo fica guardado e vale nas próximas vezes
// (settings/fechamentoAliases/{nome normalizado} → {pid, nome, ts}). Só o id do produto fica gravado: o valor sempre vem do CTW de hoje.
const BASE_AL = 'settings/fechamentoAliases';
let ALIASES = null, _alTent = 0;
const semCondicao = s => norm(s).replace(/\b(semi ?novo|novo|nova|lacrad[oa]|usad[oa]|vitrine|open ?box)\b/g, ' ');   // condição do aparelho não identifica o produto
const chaveAlias = s => semCondicao(s).replace(/[^a-z0-9]+/g, ' ').trim();
const chaveFb = s => chaveAlias(s).replace(/ /g, '_').slice(0, 120);

async function carregarAliases() {
    if (ALIASES) return;
    const db = getDb();
    if (!db) { if (++_alTent < 10) setTimeout(carregarAliases, 3000); return; }
    try { const v = (await get(ref(db, BASE_AL))).val(); ALIASES = v && typeof v === 'object' ? v : {}; }
    catch (e) { console.warn('[líquido] não li os nomes aprendidos:', e.message); if (++_alTent < 10) setTimeout(carregarAliases, 5000); }
}

function aliasDe(lido) {
    const a = ALIASES && ALIASES[chaveFb(lido)];
    const p = a && (window.products || []).find(x => String(x.id) === String(a.pid));
    return p ? { nome: p.nome, id: p.id, valor: parseFloat(p.valor) || 0, manual: false, duvida: false, lido, aprendido: true } : null;
}

// Ensina: só quando o nome lido é de fato diferente do nome do produto (ignora emoji, acento e pontuação)
async function aprender(lido, prod) {
    const db = getDb(), k = chaveFb(lido);
    if (!db || !prod || !prod.id || !k || chaveAlias(lido) === chaveAlias(prod.nome)) return false;
    if (!ALIASES) await carregarAliases();
    if (!ALIASES) ALIASES = {};
    if (ALIASES[k] && String(ALIASES[k].pid) === String(prod.id)) return false;
    const val = { pid: String(prod.id), nome: String(prod.nome || ''), ts: Date.now() };
    ALIASES[k] = val;
    try { await set(ref(db, `${BASE_AL}/${k}`), val); return true; }
    catch (e) { console.warn('[líquido] não gravei o nome aprendido:', e.message); return false; }
}

function acharProduto(lido) {
    const base = { nome: lido, id: null, valor: null, manual: false, duvida: false, lido };
    if (!lido) return base;
    const ens = aliasDe(lido); if (ens) return ens;
    const tl = tokens(lido);
    let melhor = null, cob = 0;
    buscarProdutos(lido, 5).forEach(p => {
        const tp = new Set(tokens(p.nome)), c = tl.length ? tl.filter(t => tp.has(t)).length / tl.length : 0;
        if (c > cob) { cob = c; melhor = p; }
    });
    if (!melhor || cob < 0.5) return base;
    return { nome: melhor.nome, id: melhor.id, valor: parseFloat(melhor.valor) || 0, manual: false, duvida: cob < 0.85, lido };
}

const totalItens = lista => r2((lista || []).filter(i => i && !i.isSituation).reduce((s, i) => s + (parseFloat(i.valor) || 0) * (parseInt(i.qtd, 10) || 1), 0));
const baseItem = it => (it.prod && it.prod.valor > 0 ? r2(it.prod.valor * it.qtd) : 0);
const baseTotal = E => r2(E.itens.reduce((s, it) => s + baseItem(it), 0));

// ── Registro salvo → linhas de pagamento ────────────────────────
function linhasDeRegistro(E, linhas) {
    return (linhas || []).map(l => {
        if (l.k === 'cartao') return novaLinha(E, 'cartao', { valor: fmtIn(l.valor), parc: l.parcelas, band: l.bandeira || '', maq: l.maq || maqPadrao(), manual: true });
        if (l.k === 'pix') return novaLinha(E, 'pix', { valor: fmtIn(l.valor), boleto: !!l.boleto, manual: true });
        return novaLinha(E, 'troca', { valor: fmtIn(l.valor), aparelho: l.aparelho || '', manual: true });
    });
}

// ── Garantia detalhada (dev) ────────────────────────────────────
// Tela própria (cobre o app) em 2 páginas: 1 · cliente e produtos, 2 · pagamento e lucro.
//   • Produtos escolhidos do CTW (o custo o app já sabe). O que a IA do Zap lê entra como "certo" só quando só pode ser aquele produto;
//     nos outros casos aparece "Precisa de você" com as sugestões. Cada produto que a pessoa liga na mão é lembrado (aliases).
//   • Pagamento: um valor, "Adicionar", e uma gaveta pergunta a forma/parcelas/bandeira. O total da venda é a soma dos pagamentos.
//   • O documento mostra só valores brutos: o total é dividido entre os produtos na proporção do custo do CTW, sem emoji no nome.
//   • Salvar preenche o formulário da Garantia (mesmo fluxo: prévia, número, cliente, foto, PDF) e o líquido vai junto.
//   • Rascunho no aparelho (localStorage): fechar o app não perde nada. Liga/desliga em Mais (só dev).
const GD_LS = 'ctwGdRascunho_v1', GD_SW = 'ctwGdAtivo', GD_IDADE = 48 * 3600 * 1000;
const CONDS = ['Novo / Lacrado', 'Seminovo'];   // item sem condição (cond '') só vem de documento antigo
const CHECKS = { pix: 'pagPix', boleto: 'pagBoleto', troca: 'pagTroca', deb: 'pagDebito', cred: 'pagCredito' };
const tipoForma = l => (l.k === 'cartao' ? (l.parc === 0 ? 'deb' : 'cred') : l.k === 'troca' ? 'troca' : l.boleto ? 'boleto' : 'pix');
const rotForma = l => (l.k === 'cartao' ? (l.parc === 0 ? 'Débito' : l.parc == null ? 'Cartão' : 'Crédito ' + l.parc + 'x') : l.k === 'troca' ? 'Troca' : l.boleto ? 'Boleto' : 'Pix / Dinheiro');
const semEmoji = t => String(t == null ? '' : t).replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}️‍⃣]/gu, '').replace(/\s+/g, ' ').trim();
const condDe = nome => (/semi ?novo/i.test(nome) ? 'Seminovo' : /novo|lacrad/i.test(nome) ? 'Novo / Lacrado' : '');
const produtoPorId = id => (window.products || []).find(x => String(x.id) === String(id));
const gdAtivo = () => ehDev() && lsGet(GD_SW) !== '0';
const resolvido = i => !!(i.prod && i.prod.id && i.prod.valor > 0);
const nomeBusca = p => String(p.nome || '');   // na busca o emoji do CTW fica (ajuda a achar); no cartão e no documento ele sai

function taxaDe(maq, band, parc) {
    if (!window._areRatesLoaded || typeof window._getRate !== 'function') return null;
    let t; try { t = window._getRate(maq, band, parc); } catch (e) { t = undefined; }
    return typeof t === 'number' && isFinite(t) ? t : null;
}

const IC = {
    back: '<path d="M15 6l-6 6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>', del: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>', ok: '<path d="M5 12l5 5 9-10"/>', chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>', pen: '<path d="M4 20l4-1 11-11-3-3L5 16l-1 4zM14 7l3 3"/>', chev: '<path d="M9 6l6 6-6 6"/>',
    cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>', rec: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    cal: '<path d="M5 5h14v15H5zM5 9h14M9 3v4M15 3v4"/>', trend: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', img: '<path d="M4 5h16v14H4z"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4 4 3 3-2 4 3"/>'
};
const ico = n => `<svg class="gd-i" viewBox="0 0 24 24" aria-hidden="true">${IC[n]}</svg>`;

// ── Produto lido → produto do CTW ───────────────────────────────
// Só é "certo" quando existe UM produto que cobre todas as palavras (o nome ensinado antes vale direto). Senão: sugestões, e quem escolhe é a pessoa.
const cobertura = (tl, nomeProd) => { const tp = tokens(nomeProd); return tl.length ? tl.filter(t => tp.some(x => x === t || x.startsWith(t))).length / tl.length : 0; };
const paraProd = (p, lido) => ({ nome: p.nome, id: p.id, valor: parseFloat(p.valor) || 0, manual: false, duvida: false, lido });

function interpretar(lido) {
    const al = aliasDe(lido); if (al && al.valor > 0) return { prod: al, sug: [] };
    const tl = tokens(lido), cands = [];
    buscarProdutos(lido, 8).forEach(p => { const c = cobertura(tl, p.nome); if (c >= 0.5) cands.push({ p, c }); });
    cands.sort((a, b) => b.c - a.c);
    const cheios = cands.filter(x => x.c === 1);
    if (cheios.length === 1 && parseFloat(cheios[0].p.valor) > 0) return { prod: paraProd(cheios[0].p, lido), sug: [] };
    return { prod: null, sug: cands.slice(0, 3).map(x => x.p) };
}

// ── Estado e rascunho ───────────────────────────────────────────
let G = null, GO = null, _gdT = null, GN = null, _edTrava = false;   // GN: a garantia nova em andamento, guardada enquanto uma antiga é editada
const CLI0 = () => ({ nome: '', cpf: '', tel: '', nasc: '', end: '', email: '' });
// page: 1 = Preencher (lista única), 3 = Histórico
const novoG = () => Object.assign(novoEstado('detalhada'), { page: 1, cli: CLI0(), dias: 365, dataVenda: '', busca: '', aviso: '', open: 0, sh: null, foto: null, zap: { foto: null, comp: [], texto: '', erro: '', lendo: false }, salvando: false, limpar: false, limCli: false, resOpen: false, cliente: '' });
const DIAS_GAR = [[365, '1 ano'], [180, '6 meses'], [120, '4 meses'], [30, '30 dias']];   // as mesmas opções da Garantia; "Outro tempo" aceita qualquer número de dias
const gdDiasOk = d => Number.isInteger(d) && d >= 1 && d <= 3650;
const gdRotDias = d => { const x = DIAS_GAR.find(o => o[0] === d); return x ? x[1] : d + (d === 1 ? ' dia' : ' dias'); };
// Escolha entre poucas opções: botões do app (o seletor nativo do Android é feio e esconde o resto da tela).
const gdSeg = (a, opts, sel, extra = '', cls = '') => `<div class="gd-seg${cls}" role="radiogroup">${opts.map(o => `<button type="button" role="radio" aria-checked="${o[0] === sel}" class="${o[0] === sel ? 'on' : ''}" data-gd="${a}" data-v="${esc(String(o[0]))}"${extra}>${esc(o[1])}</button>`).join('')}</div>`;
const gdVazio = E => !E.itens.length && !E.pag.length && !Object.values(E.cli).some(v => String(v).trim());

function gdGravar() {
    if (!G || G.edit) return;                              // editar uma garantia salva não toca no rascunho da nova
    try {
        if (gdVazio(G)) { localStorage.removeItem(GD_LS); return; }
        const s = { v: 1, ts: Date.now(), cli: G.cli, dias: G.dias, dataVenda: G.dataVenda, seq: G.seq,
            itens: G.itens.map(i => ({ id: i.id, nome: i.nome, qtd: i.qtd, cond: i.cond, cor: i.cor, obs: i.obs, prod: i.prod, sug: (i.sug || []).map(p => p.id) })), pag: G.pag };
        localStorage.setItem(GD_LS, JSON.stringify(s));
    } catch (e) { /* sem armazenamento: o rascunho só não existe */ }
}
const gdPersistir = () => { clearTimeout(_gdT); _gdT = setTimeout(gdGravar, 300); };
function gdLimparRasc() { clearTimeout(_gdT); try { localStorage.removeItem(GD_LS); } catch (e) { /* nada a limpar */ } }

function gdRestaurar() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(GD_LS) || 'null'); } catch (e) { s = null; }
    if (!s || s.v !== 1 || !s.ts || Date.now() - s.ts > GD_IDADE || !Array.isArray(s.itens) || !Array.isArray(s.pag)) return null;
    const E = novoG();
    E.cli = Object.assign(CLI0(), s.cli || {}); E.dias = gdDiasOk(s.dias) ? s.dias : E.dias; E.dataVenda = /^\d{4}-\d{2}-\d{2}$/.test(s.dataVenda || '') ? s.dataVenda : '';
    E.itens = s.itens.map(i => ({ id: i.id, nome: i.nome || '', qtd: Math.max(1, parseInt(i.qtd, 10) || 1), cond: CONDS.includes(i.cond) ? i.cond : '', cor: i.cor || '', obs: i.obs || '',
        prod: i.prod && i.prod.id ? i.prod : null, sug: (i.sug || []).map(produtoPorId).filter(Boolean), q: '', edCusto: false }));
    E.pag = s.pag; E.seq = Math.max(Number(s.seq) || 0, ...E.itens.map(i => i.id || 0), ...E.pag.map(l => l.id || 0));
    if (gdVazio(E)) return null;
    E.aviso = 'Recuperei o que você já tinha preenchido.';
    return E;
}

// ── Cálculo ─────────────────────────────────────────────────────
const totalGar = E => (E.garantia ? E.garantia.total : 0);
const calcG = () => { G.cliente = G.cli.nome; return calcular(G); };
const pendentes = () => G.itens.filter(i => !resolvido(i));
// A condição escolhida entra no fim do nome; se o nome do CTW já termina com uma condição ("... NOVO"), ela sai para não repetir.
const nomeDoc = i => {
    const nome = semEmoji(i.prod.nome).trim(), comCond = !!i.cond;
    return comCond ? nome.replace(/[\s-]*\b(semi ?novo|novo|nova|lacrad[oa]|usad[oa]|vitrine|open ?box)\s*$/i, '').trim() + ' - ' + i.cond : nome;
};

// O total da venda (soma dos pagamentos) é dividido entre os produtos na proporção do custo no CTW (qtd × custo). Sobra de centavos: vai para
// uma unidade avulsa, assim a soma do documento fecha exatamente com os pagamentos.
function itensDoDoc() {
    const l = G.itens, soma = somaPagamentos(G);
    const peso = l.map(i => i.qtd * (i.prod.hoje != null ? i.prod.hoje : i.prod.valor));
    const sp = peso.reduce((s, x) => s + x, 0);
    const un = l.map((i, k) => (sp > 0 ? r2(r2(soma * peso[k] / sp) / i.qtd) : 0));
    const linhas = l.map((i, k) => ({ nome: nomeDoc(i), qtd: i.qtd, valor: un[k], cor: semEmoji(i.cor), obs: String(i.obs || '').trim(), isSituation: false, ctw: { id: i.prod.id, nome: i.prod.nome } }));
    const res = r2(soma - linhas.reduce((s, x) => s + x.valor * x.qtd, 0));
    if (Math.abs(res) >= 0.005) {
        const k = linhas.map(x => x.qtd).lastIndexOf(1);
        if (k >= 0) linhas[k].valor = r2(linhas[k].valor + res);
        else {
            const j = linhas.length - 1;                      // todos com mais de uma unidade: uma unidade vira linha própria com a diferença
            linhas[j].qtd -= 1;
            linhas.splice(j + 1, 0, Object.assign({}, linhas[j], { qtd: 1, valor: r2(linhas[j].valor + res) }));
        }
    }
    return linhas;
}

// O que ainda impede de salvar: falta = o que falta fazer; erro = problema nos dados já lançados (cartão incompleto, taxa sem cadastro, data no futuro...).
// c = cálculo do lucro, só quando tudo está certo.
const gdHoje = () => dataLocal(Date.now());
function gdSituacao() {
    const falta = [];
    if (!G.itens.length) falta.push('adicionar um produto');
    else { const p = pendentes().length; if (p) falta.push('definir ' + p + (p === 1 ? ' produto' : ' produtos')); }
    if (!G.pag.length) falta.push('lançar o pagamento');
    if (falta.length) return { falta, erro: '', c: null };
    const c = calcG();
    if (c.erros.length) return { falta, erro: c.erros[0].msg, c: null };
    if (!(somaPagamentos(G) > 0)) return { falta: ['lançar o pagamento'], erro: '', c: null };
    if (G.dataVenda && G.dataVenda > gdHoje()) return { falta, erro: 'A data da venda não pode ser no futuro.', c };
    return { falta, erro: '', c };
}

// ── Interface ───────────────────────────────────────────────────
function gdAbrirOverlay() {
    if (window.ctwHistoricoNoGd) window.ctwHistoricoNoGd(null, true);
    if (GO) GO.remove();
    GO = document.createElement('div');
    GO.className = 'gd'; GO.id = 'gdRoot'; GO.setAttribute('data-dev-only', '');
    GO.addEventListener('click', gdClique);
    GO.addEventListener('input', gdDigita);
    GO.addEventListener('change', gdMuda);
    GO.addEventListener('click', e => { if (e.target.closest('#filterBarProfiles .filter-profile-btn')) lucCarregar(false); });   // trocou Todos / Meus arquivos: a busca de lucro segue o filtro
    document.body.appendChild(GO);
    document.documentElement.classList.add('ps-aberto');
}

function gdFechar() {
    if (window.ctwHistoricoNoGd) window.ctwHistoricoNoGd(null, true);   // a lista do histórico volta para a Garantia antes desta tela sair
    gdSheetFechar(true);
    Object.assign(LUC, { q: '', per: 'mes', exp: false, aberto: null, dados: null, escopo: '', erro: '', carregando: false }); LUC.seq++;   // a busca começa limpa na próxima abertura
    gdZapParar(); if (G && G.zap) G.zap.lendo = false;      // fechou a tela: a leitura da IA para de contar
    const sujo = G && G.salvando;                          // o formulário da Garantia foi preenchido e não chegou a salvar: volta limpo
    if (G) G.salvando = false;
    if (sujo && typeof window.resetFormulariosBookip === 'function') window.resetFormulariosBookip();
    clearTimeout(_gdT);
    gdGravar();
    if (GO) { GO.remove(); GO = null; }
    document.documentElement.classList.remove('ps-aberto');
    GN = null;                                             // se estava editando, a nova volta do rascunho na próxima abertura
}

function gdRender(manter) {
    if (!GO || !G) return;
    const pg = G.page, ed = !!G.edit, hist = window.ctwGdHistAtivo && window.ctwGdHistAtivo();
    if (hist) window.ctwHistoricoNoGd(pg === 3 ? document.createDocumentFragment() : null);   // a tela vai ser reescrita: a lista real sai antes (e volta, se for a aba Histórico)
    const corpo = GO.querySelector('.gd-bd'), y = corpo ? corpo.scrollTop : 0;
    const abas = ed ? '' : `<div class="gd-steps"><button type="button" class="${pg === 1 ? 'on' : ''}" data-gd="p1">${ico('pen')} Preencher</button><button type="button" class="${pg === 3 ? 'on' : ''}" data-gd="p3">${ico('clock')} Histórico</button></div>`;
    GO.innerHTML = `<div class="gd-hd"><button class="gd-bk" type="button" data-gd="voltar" aria-label="Voltar">${ico('back')}</button><h2>${ed ? 'Editando Doc ' + esc(G.edit.doc || '') : 'Garantia detalhada'}</h2>
        ${pg === 3 ? '' : `<button class="gd-zapb" type="button" data-gd="zap">${ico('chat')} Colar do Zap</button>`}</div>
      ${abas}
      ${pg === 3 ? '<div class="gd-bd"><div id="gdHist" class="gd-hist"></div></div>' : `<div class="gd-bd">${gdForm()}<div class="gd-ft" id="gdFt"></div></div>`}`;
    const novo = GO.querySelector('.gd-bd');
    if (manter && novo) novo.scrollTop = y;
    if (pg === 3) { window.ctwHistoricoNoGd(GO.querySelector('#gdHist')); lucMontar(); }
    else gdAtualizar();
    gdPersistir();
}

// Rola a lista até uma seção (os chips de cima)
function gdIr(id) {
    const bd = GO && GO.querySelector('.gd-bd'), el = GO && GO.querySelector('#' + id);
    if (bd && el) bd.scrollTo({ top: el.getBoundingClientRect().top - bd.getBoundingClientRect().top + bd.scrollTop - 8, behavior: 'smooth' });
}

// ── Lista única: cliente, produtos, pagamento, garantia e foto ──
const gdNascRot = iso => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${m[3]} de ${['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][+m[2] - 1]} de ${m[1]}` : '';
};
const gdSec = (id, n, tit, dir, corpo) => `<section class="gd-sc" id="${id}"><h3><span class="n">${n}</span>${tit}${dir || ''}</h3>${corpo}</section>`;

function gdCliente() {
    const c = G.cli, nasc = gdNascRot(c.nasc);
    const f = (k, rot, ph, tp) => `<div class="gd-fl"><label for="gdc-${k}">${rot}</label><input class="gd-in" id="gdc-${k}" data-ck="${k}" ${tp ? `type="${tp}" ` : ''}placeholder="${ph}" autocomplete="off" value="${esc(c[k])}"></div>`;
    return gdSec('gds1', 1, 'Cliente', `<button class="gd-lk2${G.limCli ? ' perigo' : ''}" type="button" data-gd="limcli">${G.limCli ? 'Toque de novo para limpar' : 'Limpar campos'}</button>`,
        `${f('nome', 'Nome completo <small>— vazio sai como “Consumidor”</small>', 'Nome do cliente')}<div class="gd-res" id="gdCres"></div>
      <div class="gd-r2">${f('cpf', 'CPF', '000.000.000-00')}${f('tel', 'Telefone', '(XX) 9XXXX-XXXX', 'tel')}</div>
      <div class="gd-fl"><label>Data de nascimento</label><input type="hidden" id="gdNasc" data-ck="nasc" value="${esc(c.nasc)}">
        <button type="button" id="gdNascBtn" class="gd-dt${nasc ? ' on' : ''}" data-gd="nasc">${ico('cal')}<span id="gdNascLabel">${nasc || 'Definir data'}</span></button></div>
      ${f('end', 'Endereço / CEP', 'Endereço completo')}${f('email', 'E-mail <small>— opcional</small>', 'cliente@email.com', 'email')}`);
}

const gdOpcoes = (lista, attr) => lista.map(p => `<button class="gd-op" type="button" ${attr}="${esc(p.id)}"><span>${esc(nomeBusca(p))}</span><small>custo ${brl(parseFloat(p.valor) || 0)}</small></button>`).join('');
const gdBusca = txt => (String(txt || '').trim() ? buscarProdutos(txt, 5) : []);

function gdItem(i) {
    const rm = `<button class="gd-ib" type="button" data-gd="del" data-id="${i.id}" aria-label="Remover produto">${ico('del')}</button>`;
    if (!resolvido(i)) {
        if (i.prod && i.prod.id) {                          // ligado ao CTW, mas sem valor lá: o custo precisa ser informado
            return `<div class="gd-card pr"><div class="gd-ih"><div class="gd-nm"><span class="gd-need">Sem valor no CTW</span><b>${esc(semEmoji(i.prod.nome))}</b></div>${rm}</div>
              <p class="gd-was">Este produto está sem valor no CTW. Informe quanto ele custa.</p>
              <div class="gd-ed"><input class="gd-in" id="gdcv-${i.id}" data-money inputmode="decimal" placeholder="Custo (R$)" autocomplete="off" aria-label="Custo do produto"><button type="button" data-gd="custook" data-id="${i.id}">OK</button></div></div>`;
        }
        const sug = (i.sug || []).map((p, k) => `<button class="gd-op${k === 0 ? ' mais' : ''}" type="button" data-gd="pick" data-id="${i.id}" data-pid="${esc(p.id)}"><span>${k === 0 ? '<i class="gd-tag">Mais provável</i>' : ''}${esc(nomeBusca(p))}</span><small>custo ${brl(parseFloat(p.valor) || 0)}</small></button>`).join('');
        return `<div class="gd-card pr"><div class="gd-ih"><div class="gd-nm"><span class="gd-need">Precisa de você</span></div>${rm}</div>
          <p class="gd-q">Qual é este produto?</p><p class="gd-was">Veio escrito: <b>${esc(i.nome)}</b></p>
          ${sug ? `<div class="gd-res">${sug}</div>` : '<p class="gd-was">Não achei nenhum parecido no CTW. Busque abaixo.</p>'}
          <div class="gd-sw">${ico('search')}<input class="gd-in" data-f="pbusca" data-id="${i.id}" placeholder="${sug ? 'Nenhum desses? Buscar outro' : 'Buscar no CTW'}" autocomplete="off" value="${esc(i.q || '')}" aria-label="Buscar produto no CTW"></div>
          <div class="gd-res" id="gdps-${i.id}">${gdOpcoes(gdBusca(i.q), `data-gd="pick" data-id="${i.id}" data-pid`)}</div></div>`;
    }
    const p = i.prod, mud = p.hoje != null && p.hoje !== p.valor;
    const veio = i.nome && chaveAlias(i.nome) !== chaveAlias(p.nome) ? ` · veio: ${esc(i.nome)}` : '';
    const custo = i.edCusto
        ? `<div class="gd-ed"><input class="gd-in" id="gdcv-${i.id}" data-money inputmode="decimal" placeholder="Custo do dia (R$)" autocomplete="off" value="${esc(fmtIn(p.valor))}" aria-label="Custo do dia"><button type="button" data-gd="custook" data-id="${i.id}">OK</button><button type="button" class="g" data-gd="custox" data-id="${i.id}">Cancelar</button></div>`
        : `<div class="gd-row"><span class="gd-l">${mud ? `Custo do dia <b>${brl(p.valor)}</b> (CTW ${brl(p.hoje)})` : `Custo no CTW <b>${brl(p.valor)}</b>`}</span><button class="gd-lk" type="button" data-gd="custo" data-id="${i.id}">${mud ? 'Mudar de novo' : 'Mudar custo'}</button></div>`;
    return `<div class="gd-card"><div class="gd-ih"><span class="gd-ck">${ico('ok')}</span><div class="gd-nm"><b>${esc(nomeDoc(i))}</b>${veio ? `<small>${veio.slice(3)}</small>` : ''}</div>${rm}</div>
      ${gdSeg('cond', CONDS.map(c => [c, c]), i.cond, ` data-id="${i.id}"`)}
      ${custo}
      <div class="gd-g3"><div class="gd-fl"><label>Quantidade</label><div class="gd-stp"><button type="button" data-gd="menos" data-id="${i.id}" aria-label="Menos">−</button><span>${i.qtd}</span><button type="button" data-gd="mais" data-id="${i.id}" aria-label="Mais">+</button></div></div>
        <div class="gd-fl"><label for="gdcor-${i.id}">Cor / detalhe</label><input class="gd-in" id="gdcor-${i.id}" data-f="cor" data-id="${i.id}" placeholder="Ex.: Preto" autocomplete="off" value="${esc(i.cor)}"></div></div>
      <div class="gd-fl"><label for="gdobs-${i.id}">IMEI / serial / observação</label><input class="gd-in" id="gdobs-${i.id}" data-f="obs" data-id="${i.id}" placeholder="IMEI 1 e 2, número de série…" autocomplete="off" value="${esc(i.obs)}"></div></div>`;
}

const taxaTxt = t => t.toFixed(1).replace('.', ',') + '%';
function gdLinhaPag(l) {
    const v = dinheiro(l.valor) || 0, ab = G.open === l.id, ehPag = l.maq === 'pagbank';
    const inc = l.k === 'cartao' && (l.parc == null || (!ehPag && !l.band));
    let det;
    if (l.k === 'cartao') {
        const t = inc ? null : taxaDe(l.maq, l.band, l.parc);
        det = `<div>Maquininha <b>${esc(nomeMaq(l.maq))}</b>${ehPag ? '' : ` · Bandeira <b>${esc(l.band ? nomeBand(l.band) : 'não informada')}</b>`}</div>` +
            (inc ? '<div class="gd-am">Falta completar: toque em Alterar.</div>' : t == null ? '<div class="gd-am">Sem taxa cadastrada para essa combinação.</div>' : `<div>Cai <b>${brl(r2(v * (1 - t / 100)))}</b> na conta (taxa ${taxaTxt(t)})</div>`);
    } else if (l.k === 'troca') det = `<div>Aparelho <b>${esc(l.aparelho || 'não informado')}</b></div>`;
    else det = '<div>Cai o valor cheio</div>';
    return `<div class="gd-pl${ab ? ' open' : ''}"><button class="gd-plh" type="button" data-gd="topay" data-id="${l.id}" aria-expanded="${ab}"><b>${brl(v)}</b><span>${esc(rotForma(l))}${l.k === 'cartao' && l.band && !ehPag ? ' · ' + esc(nomeBand(l.band)) : ''}${inc ? ' · <i class="gd-am">completar</i>' : ''}</span>${ico('chev')}</button>
      ${ab ? `<div class="gd-pld">${det}<div class="gd-acts"><button type="button" data-gd="altpay" data-id="${l.id}">Alterar</button><button type="button" class="rm" data-gd="rempay" data-id="${l.id}">Remover</button></div></div>` : ''}</div>`;
}
const gdLinhaCompleta = l => (dinheiro(l.valor) || 0) > 0 && (l.k !== 'cartao' || (l.parc != null && (l.maq === 'pagbank' || !!l.band)));
const gdTotHtml = () => (G.pag.length
    ? `<div class="gd-tt"><span>Total da venda (vai no documento)</span><b>${brl(somaPagamentos(G))}</b></div>`
    : '<p class="gd-msg">Lance como o cliente pagou (cartão, Pix, dinheiro, troca). O total do documento é a soma dos pagamentos.</p>');
const gdContar = (n, um, varios, nenhum) => (n ? n + ' ' + (n === 1 ? um : varios) : nenhum);

function gdFoto() {
    const url = G.foto ? 'data:image/jpeg;base64,' + G.foto : G.edit && G.edit.fotoUrl;
    const prev = url ? `<div class="gd-fp"><img src="${esc(url)}" alt="Foto do produto">${G.foto ? `<button class="gd-ib" type="button" data-gd="fotox" aria-label="Remover foto">${ico('del')}</button>` : ''}</div>${G.foto ? '' : '<p class="gd-msg">Foto atual do documento. Escolher outra a substitui.</p>'}` : '';
    return gdSec('gds5', 5, 'Foto do produto', '<span class="r">opcional</span>',
        `${prev}${G.foto ? '' : `<div class="gd-ph"><button type="button" data-gd="fotoc">${ico('cam')}Tirar foto</button><button type="button" data-gd="fotog">${ico('img')}Da galeria</button></div>`}
      <input type="file" id="gdFc" accept="image/*" capture="environment" hidden><input type="file" id="gdFg" accept="image/*" hidden>`);
}

function gdForm() {
    return `${G.edit ? `<div class="gd-ban am">Editando a garantia Doc ${esc(G.edit.doc || '')}.</div>` : ''}${G.edit && G.edit.nota ? `<div class="gd-ban am">${G.edit.nota}</div>` : ''}${G.aviso ? `<div class="gd-ban">${G.aviso}</div>` : ''}
      ${gdCliente()}
      ${gdSec('gds2', 2, 'Produtos', `<span class="r" id="gdNprod"></span>`, `${G.itens.map(gdItem).join('') || '<p class="gd-msg">Nenhum produto ainda. Busque no CTW abaixo.</p>'}
        <div class="gd-sw">${ico('search')}<input id="gdBq" class="gd-in" placeholder="Buscar produto no CTW ou digitar o nome" autocomplete="off" value="${esc(G.busca)}" aria-label="Buscar produto no CTW"></div>
        <div class="gd-res" id="gdBres">${gdOpcoes(gdBusca(G.busca), 'data-gd="add" data-pid')}</div>
        <button class="gd-add" type="button" data-gd="addtxt">${ico('plus')} Adicionar produto</button>`)}
      ${gdSec('gds3', 3, 'Pagamento', `<span class="r" id="gdNpag"></span>`, `${G.pag.map(gdLinhaPag).join('')}<button class="gd-add" type="button" data-gd="addpag">${ico('plus')} Adicionar pagamento</button><div id="gdTt"></div>`)}
      ${gdSec('gds4', 4, 'Garantia e documento', '', `<div class="gd-g2c"><div class="gd-fl"><label>Tempo de garantia</label><button type="button" class="gd-selb" data-gd="dias" aria-haspopup="dialog"><span>${esc(gdRotDias(G.dias))}</span>${ico('down')}</button></div>
        <div class="gd-fl"><label for="gdDv">Data da venda</label><input class="gd-in" id="gdDv" type="date" data-dv max="${gdHoje()}" value="${esc(G.dataVenda)}"></div></div>`)}
      ${gdFoto()}
      ${gdVazio(G) || G.edit ? '' : `<button class="gd-lk gd-zera${G.limpar ? ' perigo' : ''}" type="button" data-gd="zerar">${G.limpar ? 'Toque de novo para apagar tudo' : 'Começar de novo'}</button>`}`;
}

// Tudo o que muda enquanto se digita sem redesenhar a lista (para não perder o foco): contadores, total e rodapé
function gdAtualizar() {
    const ft = GO && GO.querySelector('#gdFt');
    if (!G || !ft) return;
    const s = gdSituacao();
    const soma = somaPagamentos(G), lucro = s.c ? s.c.res.lucro : null, pronto = !s.falta.length && !s.erro;
    ft.innerHTML = (G.resOpen ? '<div class="gd-rp" id="gdLucro"></div>' : '') +
        `<div class="gd-sm"><span>Total <b>${soma > 0 ? brl(soma) : '—'}</b></span><button class="gd-rbt${G.resOpen ? ' on' : ''}" type="button" data-gd="res" aria-expanded="${!!G.resOpen}" aria-label="${G.resOpen ? 'Esconder o resultado' : 'Ver o resultado'}">${ico('rec')}</button><span class="lu${lucro != null && lucro < 0 ? ' neg' : ''}">Lucro ${lucro != null ? sinal(lucro) : '—'}</span></div>
        <p class="gd-help">${esc(s.falta.length ? 'Falta: ' + s.falta.join(' e ') : s.erro || 'Tudo pronto.')}</p>
        <button class="gd-go${pronto ? '' : ' off'}" type="button" data-gd="salvar">${G.edit ? 'Salvar alterações' : 'Salvar garantia'}</button>`;
    const set = (id, t) => { const e = GO.querySelector(id); if (e) e.textContent = t; };
    set('#gdNprod', gdContar(G.itens.length, 'item', 'itens', ''));
    set('#gdNpag', gdContar(G.pag.length, 'lançado', 'lançados', ''));
    const tt = GO.querySelector('#gdTt'); if (tt) tt.innerHTML = gdTotHtml();
    if (G.resOpen) gdResumo();
}

// Resultado: fechado por padrão (o Histórico já mostra); o ícone do rodapé abre
function gdResumo() {
    const lu = GO && GO.querySelector('#gdLucro');
    if (!lu) return;
    if (!G.pag.length) { lu.innerHTML = '<p class="gd-msg">Lance o primeiro pagamento para ver o lucro.</p>'; return; }
    const c = calcG();
    if (c.erros.length) { lu.innerHTML = `<p class="gd-msg am">${Array.from(new Set(c.erros.map(x => x.msg))).map(esc).join('<br>')}</p>`; return; }
    const r = c.res, cl = r.lucro < 0 ? 'neg' : 'pos';
    lu.innerHTML = `<div class="gd-big"><small>${r.lucro < 0 ? 'Prejuízo' : 'Lucro'}</small><b class="${cl}">${sinal(r.lucro)}</b></div><hr>
      <div class="gd-ln"><span>Total da venda</span><b>${brl(somaPagamentos(G))}</b></div><div class="gd-ln"><span>Caiu na conta</span><b>${brl(r.real)}</b></div><div class="gd-ln"><span>Custo dos produtos</span><b>${brl(r.base)}</b></div>
      <button class="gd-lk full" type="button" data-gd="irprod">Mudar o custo de algum produto</button>`;
}

// ── Gaveta de pagamento: uma pergunta de cada vez ────────────────
// Teclado aberto: a gaveta sobe junto e rola, para o campo que está sendo preenchido nunca ficar atrás dele.
// Cobre os três jeitos do Android lidar com o teclado: tela encolhe (nada a fazer), só a visão encolhe (visualViewport) ou o teclado cobre (virtualKeyboard).
function gdSheetTeclado() {
    const w = document.getElementById('gdSheet'); if (!w) return;
    const vv = window.visualViewport, vk = navigator.virtualKeyboard;
    const k = Math.max(0, vv ? window.innerHeight - vv.height - vv.offsetTop : 0, vk && vk.boundingRect ? vk.boundingRect.height : 0);
    w.style.setProperty('--gd-kb', Math.round(k) + 'px');
    const f = document.activeElement;
    if (k > 0 && f && w.contains(f) && f.scrollIntoView) setTimeout(() => f.scrollIntoView({ block: 'nearest' }), 80);
}
const gdSheetKbOuvir = on => {
    const f = on ? 'addEventListener' : 'removeEventListener';
    if (window.visualViewport) { window.visualViewport[f]('resize', gdSheetTeclado); window.visualViewport[f]('scroll', gdSheetTeclado); }
    if (navigator.virtualKeyboard) navigator.virtualKeyboard[f]('geometrychange', gdSheetTeclado);
    window[f]('resize', gdSheetTeclado);
};
function gdSheet(html) {
    gdSheetFechar(true);
    const w = document.createElement('div');
    w.id = 'gdSheet'; w.className = 'ui-sheet-wrap'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true');
    w.innerHTML = `<button type="button" class="ui-dim" data-gd="shx" aria-label="Fechar"></button><div class="ui-sheet gd-sh"><div class="ui-grab"></div>${html}</div>`;
    ['click', 'input', 'change'].forEach(t => w.addEventListener(t, gdSheetEvento));
    w.addEventListener('focusin', () => setTimeout(gdSheetTeclado, 350));
    gdSheetKbOuvir(true);
    document.body.appendChild(w);
    void w.offsetHeight;
    w.classList.add('ui-open');
    return w;
}
function gdSheetFechar(sem) {
    const w = document.getElementById('gdSheet'); if (!w) return;
    gdSheetKbOuvir(false);
    w.id = '';
    if (G) G.sh = null;
    if (sem) { w.remove(); return; }
    w.classList.remove('ui-open');
    setTimeout(() => w.remove(), 280);
}

const FORMAS = [['pix', 'Pix / Dinheiro'], ['boleto', 'Boleto'], ['troca', 'Troca'], ['deb', 'Débito'], ['cred', 'Crédito']];
const gdChip = (a, v, rot, on) => `<button class="gd-ch${on ? ' on' : ''}" type="button" data-gd="${a}" data-v="${esc(v)}" aria-pressed="${!!on}">${esc(rot)}</button>`;
// O que ainda falta para lançar ('' = pode lançar)
function gdShFalta(h) {
    if (!(h.valor > 0)) return 'valor';
    if (!h.forma) return 'forma de pagamento';
    if (h.forma === 'cred' && h.parc == null) return 'parcelas';
    if ((h.forma === 'cred' || h.forma === 'deb') && h.maq !== 'pagbank' && !h.band) return 'bandeira';
    return '';
}
// Pré-visualização do que cai na conta + botão: é a única parte que muda enquanto se digita o valor
function gdShFim(h) {
    const falta = gdShFalta(h), cart = h.forma === 'cred' || h.forma === 'deb';
    let prev = '';
    if (!falta && cart) {
        const t = taxaDe(h.maq, h.maq === 'pagbank' ? '' : h.band, h.forma === 'deb' ? 0 : h.parc);
        prev = t == null ? '<p class="gd-prev am">Sem taxa cadastrada para essa combinação.</p>' : `<p class="gd-prev">Cai <b>${brl(r2(h.valor * (1 - t / 100)))}</b> na conta (taxa ${taxaTxt(t)})</p>`;
    }
    return `${prev}${h.err ? `<p class="gd-msg am">${esc(h.err)}</p>` : ''}<button class="gd-go${falta ? ' off' : ''}" type="button" data-gd="shl">${falta ? 'Falta: ' + falta : 'Lançar ' + brl(h.valor)}</button>`;
}
const gdShFimPintar = () => { const e = document.getElementById('gdShFim'); if (e && G && G.sh) e.innerHTML = gdShFim(G.sh); };

function gdSheetPintar() {
    const h = G.sh; if (!h) return;
    const cart = h.forma === 'cred' || h.forma === 'deb', ehPag = h.maq === 'pagbank', cred = h.forma === 'cred', max = MAX_PARC[h.maq] || 18;
    let par = ''; if (cred) for (let n = 1; n <= max; n++) par += gdChip('shp', n, n + 'x', h.parc === n);
    const w = document.getElementById('gdSheet') || gdSheet('');
    w.querySelector('.ui-sheet').innerHTML = `<div class="ui-grab"></div><div class="ui-sheet-title">${h.edit ? 'Alterar pagamento' : 'Novo pagamento'}</div>
      <div><label class="gd-lab" for="gdShV">Quanto foi? (R$)</label><input id="gdShV" class="gd-in big" data-money inputmode="decimal" placeholder="0,00" autocomplete="off" value="${h.valor > 0 ? esc(fmtIn(h.valor)) : ''}" aria-label="Valor do pagamento"></div>
      <div><span class="gd-lab">Como foi pago?</span><div class="gd-chs">${FORMAS.map(f => gdChip('shf', f[0], f[1], h.forma === f[0])).join('')}</div></div>
      ${cart ? `<div><span class="gd-lab">Maquininha</span><div class="gd-chs">${maqsAtivas().map(m => gdChip('shm', m[0], m[1], h.maq === m[0])).join('')}</div></div>` : ''}
      ${cred ? `<div><span class="gd-lab">Parcelas</span><div class="gd-pg">${par}</div></div>` : ''}
      ${cart && !ehPag ? `<div><span class="gd-lab">Bandeira</span><div class="gd-chs">${BANDEIRAS.map(b => gdChip('shb2', b[0], b[1], h.band === b[0])).join('')}</div></div>` : ''}
      ${cart && ehPag ? '<p class="gd-msg">O PagBank não pede a bandeira.</p>' : ''}
      ${h.forma === 'troca' ? `<div><label class="gd-lab" for="gdShA">Aparelho que o cliente deu</label><input class="gd-in" id="gdShA" placeholder="Ex.: iPhone 11 64GB" autocomplete="off" value="${esc(h.apar)}"></div>` : ''}
      <div id="gdShFim" class="gd-sh">${gdShFim(h)}</div>`;
}

function gdAbrirPag(valor, edit) {   // valor 0 = pagamento novo: o valor é digitado na própria gaveta
    const l = edit ? G.pag.find(x => x.id === edit) : null;
    gdSheet('');
    const forma = !l ? '' : l.k === 'cartao' ? (l.parc === 0 ? 'deb' : 'cred') : l.k === 'troca' ? 'troca' : l.boleto ? 'boleto' : 'pix';
    G.sh = { valor, edit: edit || 0, forma, parc: l && l.k === 'cartao' && l.parc > 0 ? l.parc : null, maq: (l && l.maq) || maqPadrao(), band: (l && l.band) || bandPadrao(), apar: (l && l.aparelho) || '', err: '' };
    gdSheetPintar();
    if (!(valor > 0)) { const v = document.getElementById('gdShV'); if (v) v.focus(); }
}

function gdLancar() {
    const h = G.sh; if (!h) return;
    const v = r2(h.valor), falta = gdShFalta(h);
    if (falta) { h.err = falta === 'valor' ? 'Informe um valor maior que zero.' : 'Falta escolher: ' + falta + '.'; return gdShFimPintar(); }
    let o;
    if (h.forma === 'pix' || h.forma === 'boleto') o = { k: 'pix', valor: fmtIn(v), boleto: h.forma === 'boleto', manual: true };
    else if (h.forma === 'troca') o = { k: 'troca', valor: fmtIn(v), aparelho: h.apar.trim(), manual: true };
    else {
        const deb = h.forma === 'deb', ehPag = h.maq === 'pagbank', parc = deb ? 0 : h.parc;
        if (!window._areRatesLoaded) { h.err = 'As taxas ainda estão carregando. Tente de novo em instantes.'; return gdShFimPintar(); }
        if (taxaDe(h.maq, ehPag ? '' : h.band, parc) == null) { h.err = `Não há taxa cadastrada para ${nomeMaq(h.maq)}${ehPag ? '' : ' ' + nomeBand(h.band)} ${rotParc(parc)}. Cadastre em Taxas ou mude a escolha.`; return gdShFimPintar(); }
        o = { k: 'cartao', valor: fmtIn(v), parc, band: ehPag ? '' : h.band, maq: h.maq, bandDuv: false, parcDuv: false, manual: true };
    }
    const alvo = h.edit ? G.pag.find(x => x.id === h.edit) : null;
    if (alvo) { ['boleto', 'aparelho', 'parc', 'band'].forEach(k => delete alvo[k]); Object.assign(alvo, o); G.open = alvo.id; }
    else { const nl = novaLinha(G, o.k, o); G.pag.push(nl); }
    G.aviso = '';
    gdSheetFechar(); gdRender(true);
}

function gdSheetEvento(e) {
    if (e.currentTarget.dataset.k === 'zap') return gdZapEvento(e);
    if (e.currentTarget.dataset.k === 'dias') return gdDiasEvento(e);
    const h = G && G.sh; if (!h) return;
    if (e.type === 'input') {
        if (e.target.id === 'gdShV') { mascararDinheiro(e.target, e.inputType === 'insertFromPaste'); h.valor = dinheiro(e.target.value) || 0; h.err = ''; gdShFimPintar(); }
        else if (e.target.id === 'gdShA') h.apar = e.target.value;
        return;
    }
    if (e.type === 'change') return;
    const b = e.target.closest('[data-gd]'); if (!b) return;
    const a = b.dataset.gd, v = b.dataset.v;
    if (a === 'shx') return gdSheetFechar();
    if (a === 'shm') { h.maq = v; if (h.parc > (MAX_PARC[h.maq] || 18)) h.parc = null; h.err = ''; return gdSheetPintar(); }
    if (a === 'shf') {
        h.forma = v; h.err = '';
        if ((v === 'pix' || v === 'boleto') && h.valor > 0) return gdLancar();      // à vista: lança na hora, como sempre foi
        return gdSheetPintar();
    }
    if (a === 'shp') { h.parc = parseInt(v, 10); h.err = ''; return gdSheetPintar(); }
    if (a === 'shb2') { h.band = v; h.err = ''; return gdSheetPintar(); }
    if (a === 'shl') return gdLancar();
}

// ── Colar do Zap (IA) ───────────────────────────────────────────
const PROMPT_GD = `Você lê uma mensagem de WhatsApp de uma VENDA de celulares/aparelhos em uma loja brasileira (e, se houver, imagens) para preencher uma garantia. Sua tarefa é SOMENTE LER e copiar. NÃO calcule taxa, líquido, lucro nem some nada.

Responda APENAS com um JSON válido, sem texto antes ou depois, neste formato:
{
 "cliente": {"nome": "", "cpf": "", "telefone": "", "nascimento": "AAAA-MM-DD", "endereco": "", "email": ""},
 "produtos": [ {"nome": "nome do aparelho como está escrito, sem emoji e sem a cor", "condicao": "novo" | "seminovo" | "", "qtd": 1, "cor": "", "imei": ""} ],
 "pagamentos": [ ${FORMATO_PAG} ]
}

REGRAS:
- "cliente": a pessoa que está COMPRANDO. Nunca o nome da loja nem do vendedor. Campo que não aparece fica "". "nascimento" só se tiver o ano completo.
- "produtos": UM item para cada produto diferente. "2x redmi 13c" = qtd 2. Se o mesmo produto aparece de novo com outra cor ou IMEI, é outro item com qtd 1. "condicao": "novo" se estiver escrito novo/lacrado, "seminovo" se estiver escrito seminovo/usado, senão "". Não inclua a condição no "nome". "imei": só IMEI/serial, nunca outro texto.
- "valorTotal" não existe aqui: o total é a soma dos pagamentos.
${REGRAS_PAG}`;

function gdTextoImagens(n, produto) {
    return n || produto ? `\n\n=== IMAGENS ENVIADAS ===
${produto ? 'A imagem 1 é a FOTO DO PRODUTO. ' : ''}${n ? `${produto ? 'As' : 'As'} ${n} imagem(ns) ${produto ? 'seguinte(s)' : 'enviada(s)'} ${n > 1 ? 'são COMPROVANTES' : 'é COMPROVANTE'} de pagamento (recibo da maquininha ou comprovante de Pix).` : ''}
- Nome, cor e IMEI do produto saem só do texto${produto ? ' e da foto do produto' : ''}: nunca de um comprovante. A foto pode mostrar na caixa a capacidade e a RAM: use no nome no formato "<Modelo> <armazenamento>GB/<RAM>GB".
- Os comprovantes servem para "pagamentos" (valor, parcelas, bandeira, maquininha). O mesmo comprovante em mais de uma foto conta uma vez.` : '';
}

const ZAP_LIMITE_S = 120;   // segundos COM o app aberto; passou disso, avisa em vez de ficar rodando sem fim
const gdZapTempo = z => `${z.seg || 0} s · costuma levar de 10 a 40 s`;
let _zapTick = null, _zapRun = 0;
function gdZapParar() { clearInterval(_zapTick); _zapTick = null; _zapRun++; }
// A IA não precisa da foto inteira: menos dados no envio (rede móvel) e leitura mais rápida. A original segue para o documento.
function reduzirB64(b64, max) {
    return new Promise(res => {
        const img = new Image();
        img.onload = () => {
            const k = Math.min(1, max / Math.max(img.width, img.height));
            if (k >= 1) return res(b64);
            const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            res(c.toDataURL('image/jpeg', 0.8).split(',')[1]);
        };
        img.onerror = () => res(b64);
        img.src = 'data:image/jpeg;base64,' + b64;
    });
}

function gdZapHtml() {
    const z = G.zap, ok = (n, t) => `${n ? '✓ ' : ''}${t}`;
    return `<div class="ui-grab"></div><div class="ui-sheet-title">Colar do Zap (IA)</div><p class="gd-sub">Cole a mensagem. A IA preenche cliente, produtos e pagamentos.</p>
      <textarea class="gd-ta" id="gdZt" rows="6" placeholder="Ex.: Carlos Henrique, CPF 123..., 2x redmi 13c novo, 3500 no pix + 1000 em 3x no cartão" aria-label="Mensagem do cliente">${esc(z.texto)}</textarea>
      <input type="file" id="gdZf" accept="image/*" hidden><input type="file" id="gdZc" accept="image/*" multiple hidden>
      <div class="gd-zr"><button type="button" class="${z.foto ? 'on' : ''}" data-gd="zf">${ico('cam')} ${ok(z.foto, 'Foto do produto')}</button><button type="button" class="${z.comp.length ? 'on' : ''}" data-gd="zc"${z.comp.length >= 4 ? ' disabled' : ''}>${ico('rec')} ${ok(z.comp.length, z.comp.length ? z.comp.length + (z.comp.length === 1 ? ' comprovante' : ' comprovantes') : 'Comprovantes')}</button></div>
      <p class="gd-sub" style="margin-top:-4px">A foto do produto vai anexada ao documento. Os comprovantes só a IA lê.</p>${z.foto || z.comp.length ? '<button type="button" class="gd-lk full" data-gd="zlimpa">Remover fotos</button>' : ''}
      ${z.erro ? `<p class="gd-msg am">${esc(z.erro)}</p>` : ''}
      ${z.lendo
        ? `<div class="gd-load" role="status" aria-live="polite"><span class="gd-spin" aria-hidden="true"></span><div><b>Lendo com a IA…</b><small id="gdZseg">${esc(gdZapTempo(z))}</small></div></div><div class="gd-bar" aria-hidden="true"><i></i></div><button class="gd-lk gd-zera" type="button" data-gd="zcancel">Cancelar</button>`
        : '<button class="gd-go" type="button" data-gd="zrun">Preencher com IA</button>'}`;
}

// Tempo de garantia: o campo abre esta lista; "Outro tempo…" troca a folha pelo campo para digitar os dias.
function gdDiasAbrir() {
    const w = gdSheet(''); w.dataset.k = 'dias'; w.dataset.m = 'lista';
    gdDiasPintar();
}
function gdDiasPintar() {
    const w = document.getElementById('gdSheet'); if (!w || w.dataset.k !== 'dias') return;
    const fora = !DIAS_GAR.some(o => o[0] === G.dias), s = w.querySelector('.ui-sheet');
    if (w.dataset.m === 'lista') {
        s.innerHTML = `<div class="ui-grab"></div><div class="ui-sheet-title">Tempo de garantia</div>` +
            DIAS_GAR.map(o => `<button class="gd-op${o[0] === G.dias ? ' sel' : ''}" type="button" data-gd="dd" data-v="${o[0]}"><span>${o[1]}</span>${o[0] === G.dias ? ico('ok') : ''}</button>`).join('') +
            `<button class="gd-op${fora ? ' sel' : ''}" type="button" data-gd="dout"><span>${fora ? 'Outro: ' + esc(gdRotDias(G.dias)) : 'Outro tempo…'}</span>${fora ? ico('ok') : ''}</button>`;
        return;
    }
    s.innerHTML = `<div class="ui-grab"></div><div class="ui-sheet-title">Outro tempo</div>
           <div><label class="gd-lab" for="gdDiasN">Quantos dias de garantia?</label><input id="gdDiasN" class="gd-in" inputmode="numeric" maxlength="4" placeholder="Ex.: 45" autocomplete="off" value="${fora ? G.dias : ''}"></div>
           ${w.dataset.erro ? `<p class="gd-msg am">${esc(w.dataset.erro)}</p>` : ''}<button class="gd-go" type="button" data-gd="dok">Confirmar</button>`;
    const n = s.querySelector('#gdDiasN'); if (n) n.focus();
}
function gdDiasEvento(e) {
    const w = e.currentTarget;
    if (e.type !== 'click') return;
    const b = e.target.closest('[data-gd]'); if (!b) return;
    const a = b.dataset.gd;
    if (a === 'shx') return gdSheetFechar();
    if (a === 'dd') { const d = parseInt(b.dataset.v, 10); if (gdDiasOk(d)) G.dias = d; gdSheetFechar(); return gdRender(true); }
    if (a === 'dout') { w.dataset.m = 'outro'; return gdDiasPintar(); }
    if (a === 'dok') {
        const n = w.querySelector('#gdDiasN'), v = parseInt(String(n && n.value).replace(/\D/g, ''), 10);
        if (!gdDiasOk(v)) { w.dataset.erro = 'Digite um número de dias entre 1 e 3650.'; return gdDiasPintar(); }
        G.dias = v; gdSheetFechar(); return gdRender(true);
    }
}

function gdZapAbrir() {
    let w = document.getElementById('gdSheet');
    if (!w || w.dataset.k !== 'zap') { w = gdSheet(''); w.dataset.k = 'zap'; }
    const ta = w.querySelector('#gdZt'), foco = ta && document.activeElement === ta;
    w.querySelector('.ui-sheet').innerHTML = gdZapHtml();
    if (foco) w.querySelector('#gdZt').focus();
}

function gdZapEvento(e) {
    const z = G && G.zap; if (!z) return;
    if (e.type === 'input') { if (e.target.id === 'gdZt') z.texto = e.target.value; return; }
    if (e.type === 'change') {
        const f = Array.from(e.target.files || []); e.target.value = '';
        if (e.target.id === 'gdZf' && f[0]) gdZapImg(f[0], 'foto');
        else if (e.target.id === 'gdZc') f.slice(0, 4 - z.comp.length).reduce((p, x) => p.then(() => gdZapImg(x, 'comp')), Promise.resolve());
        return;
    }
    const b = e.target.closest('[data-gd]'); if (!b || b.disabled) return;
    const a = b.dataset.gd, w = e.currentTarget;
    if (a === 'shx') return gdSheetFechar();
    if (a === 'zf') return w.querySelector('#gdZf').click();
    if (a === 'zc') return w.querySelector('#gdZc').click();
    if (a === 'zlimpa') { z.foto = null; z.comp = []; return gdZapAbrir(); }
    if (a === 'zrun') return gdZapLer();
    if (a === 'zcancel') { gdZapParar(); z.lendo = false; z.erro = ''; return gdZapAbrir(); }
}

async function gdZapImg(arq, tipo) {
    const z = G && G.zap; if (!z) return;
    if (typeof window._ctwResizeToBase64 !== 'function') { z.erro = 'O módulo de IA ainda está carregando. Tente de novo em instantes.'; return gdZapAbrir(); }
    try {
        const b64 = await window._ctwResizeToBase64(arq);
        if (!b64) throw new Error('foto');
        if (tipo === 'foto') z.foto = b64; else z.comp.push(b64);
        z.erro = '';
    } catch (e) { z.erro = 'Uma foto não abriu e foi ignorada.'; }
    if (document.getElementById('gdSheet')) gdZapAbrir();
}

async function gdZapLer() {
    const z = G.zap, estado = G;
    const texto = (z.texto || '').trim();
    if (z.lendo) return;
    if (!texto && !z.foto && !z.comp.length) { z.erro = 'Cole o texto ou adicione uma foto.'; return gdZapAbrir(); }
    gdZapParar();
    const run = _zapRun;                                    // se cancelar ou estourar o tempo, a resposta que chegar depois é ignorada
    z.lendo = true; z.erro = ''; z.seg = 0; gdZapAbrir();
    _zapTick = setInterval(() => {
        if (run !== _zapRun) return;
        if (!document.hidden) z.seg++;                      // só conta o tempo com o app aberto
        const t = document.getElementById('gdZseg'); if (t) t.textContent = gdZapTempo(z);
        if (z.seg >= ZAP_LIMITE_S) {
            gdZapParar(); z.lendo = false; z.erro = 'A IA demorou mais de ' + Math.round(ZAP_LIMITE_S / 60) + ' minutos. Confira a internet e toque em Preencher de novo.';
            if (G === estado && document.getElementById('gdSheet')) gdZapAbrir();
        }
    }, 1000);
    try {
        await window.ctwCarregarModulo('creditoscan');
        if (typeof window._ctwAiVision !== 'function') throw new Error('A leitura por IA não está disponível agora. Tente de novo em instantes.');
        const imagens = await Promise.all((z.foto ? [z.foto] : []).concat(z.comp).map(b => reduzirB64(b, 1024).then(base64 => ({ base64 }))));
        const resp = await window._ctwAiVision(imagens, texto, PROMPT_GD + gdTextoImagens(z.comp.length, !!z.foto));
        if (run !== _zapRun || G !== estado) return;
        const d = extrairJson(resp);
        gdZapParar();
        gdAplicarZap(d);
        z.lendo = false;
        gdSheetFechar(); gdRender();
    } catch (e) {
        if (run !== _zapRun || G !== estado) return;
        gdZapParar();
        z.lendo = false; z.erro = (e && e.message) || 'Não consegui ler agora. Tente de novo.';
        gdZapAbrir();
    }
}

const soDigitos = s => String(s || '').replace(/\D/g, '');
function fmtCpf(s) { const d = soDigitos(s); return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : String(s || '').trim(); }

// Cliente já cadastrado (mesmo CPF, telefone ou nome): completa só o que a mensagem não trouxe
function gdCadastro(c) {
    const lista = window.dbClientsCache || [], cpf = soDigitos(c.cpf), tel = soDigitos(c.tel), nome = norm(c.nome);
    return lista.find(x => (cpf.length === 11 && soDigitos(x.cpf) === cpf) || (tel.length >= 10 && soDigitos(x.tel) === tel) || (nome && norm(x.nome) === nome)) || null;
}
function gdCompletaCliente() {
    const x = gdCadastro(G.cli); if (!x) return;
    const c = G.cli;
    if (!c.nome) c.nome = x.nome || ''; if (!c.cpf) c.cpf = x.cpf || ''; if (!c.tel) c.tel = x.tel || '';
    if (!c.end) c.end = x.end || ''; if (!c.email) c.email = x.email || ''; if (!c.nasc) c.nasc = x.dataNascimento || '';
}

function gdAplicarZap(d) {
    const c = d.cliente || {};
    G.cli = { nome: String(c.nome || '').trim().slice(0, 80), cpf: fmtCpf(c.cpf), tel: soDigitos(c.telefone), nasc: /^\d{4}-\d{2}-\d{2}$/.test(c.nascimento || '') ? c.nascimento : '', end: String(c.endereco || '').trim(), email: String(c.email || '').trim() };
    gdCompletaCliente();
    G.itens = []; G.pag = []; G.open = 0;
    (Array.isArray(d.produtos) ? d.produtos : []).slice(0, 20).forEach(p => {
        const lido = String(p && p.nome || '').trim(); if (!lido) return;
        const r = interpretar(lido), cond = /seminovo|usado/i.test(p.condicao) ? 'Seminovo' : /novo|lacrad/i.test(p.condicao) ? 'Novo / Lacrado' : (condDe(lido) || CONDS[0]);
        gdPutItem({ nome: lido, qtd: Math.max(1, Math.min(99, parseInt(p.qtd, 10) || 1)), cond, cor: semEmoji(p.cor), obs: String(p.imei || '').trim(), prod: r.prod, sug: r.sug });
    });
    G.pag = linhasDeIA(G, d.pagamentos);
    G.foto = G.zap.foto;
    const n = pendentes().length, t = G.itens.length;
    G.aviso = `A IA leu a mensagem: <b>cliente</b>, <b>${t} ${t === 1 ? 'produto' : 'produtos'}</b> (${t - n} certo${t - n === 1 ? '' : 's'}${n ? `, <b>${n} ${n === 1 ? 'precisa' : 'precisam'} de você</b>` : ''}) e <b>${G.pag.length} ${G.pag.length === 1 ? 'pagamento' : 'pagamentos'}</b>.`;
    G.page = 1;
}

// Mesmo produto do CTW na mesma condição vira quantidade (não uma linha nova)
function gdPutItem(o) {
    const igual = o.prod && G.itens.find(i => i.prod && i.prod.id === o.prod.id && (i.cond || '') === (o.cond || '') && !i.cor && !i.obs && !o.cor && !o.obs);
    if (igual) { igual.qtd = Math.min(99, igual.qtd + o.qtd); return igual; }
    const it = Object.assign({ id: ++G.seq, q: '', edCusto: false, sug: [] }, o);
    G.itens.push(it);
    return it;
}

// ── Eventos ─────────────────────────────────────────────────────
const gdItemPorId = id => G.itens.find(i => String(i.id) === String(id));
const gdAprendeu = (it, p) => { aprender(it.nome, { id: p.id, nome: p.nome }); G.aviso = `Guardei: da próxima vez que vier “${esc(it.nome)}”, já sei que é ${esc(semEmoji(p.nome))}.`; };

function gdClique(e) {
    const b = e.target.closest('[data-gd]'); if (!b || b.tagName === 'SELECT' || b.disabled) return;
    if (!G) return;
    const a = b.dataset.gd, id = b.dataset.id, it = id != null ? gdItemPorId(id) : null;
    if (a !== 'zerar' && G.limpar) G.limpar = false;
    if (a !== 'limcli' && G.limCli) { G.limCli = false; const l = GO.querySelector('[data-gd="limcli"]'); if (l) { l.textContent = 'Limpar campos'; l.classList.remove('perigo'); } }
    if (a === 'voltar') { gdVoltar(); return; }
    if (a.startsWith('luc-')) return lucClique(a, b);
    if (a === 'p1') { G.page = 1; return gdRender(); }
    if (a === 'p3') { gdSheetFechar(true); G.page = 3; G.aviso = ''; return gdRender(); }
    if (a === 'res') { G.resOpen = !G.resOpen; return gdAtualizar(); }
    if (a === 'cond' && it) { it.cond = b.dataset.v; return gdRender(true); }
    if (a === 'dias') return gdDiasAbrir();
    if (a === 'zap') return gdZapAbrir();
    if (a === 'nasc') { if (typeof window._abrirBirthdayPicker === 'function') window._abrirBirthdayPicker('gdNasc', 'gdNascBtn', 'gdNascLabel'); return; }
    if (a === 'limcli') {
        if (!G.limCli) { G.limCli = true; b.textContent = 'Toque de novo para limpar'; b.classList.add('perigo'); return; }
        G.limCli = false; G.cli = CLI0(); return gdRender(true);
    }
    if (a === 'cad') { const x = (window.dbClientsCache || []).find(c => String(c.id) === String(b.dataset.cid)); if (x) { G.cli = { nome: x.nome || '', cpf: x.cpf || '', tel: x.tel || '', nasc: x.dataNascimento || '', end: x.end || '', email: x.email || '' }; } return gdRender(true); }
    if (a === 'add') {
        const p = produtoPorId(b.dataset.pid); if (!p) return;
        if (!(parseFloat(p.valor) > 0)) { G.aviso = 'Este produto está sem valor no CTW. Informe o custo no cartão dele.'; }
        else G.aviso = '';
        gdPutItem({ nome: semEmoji(p.nome), qtd: 1, cond: CONDS[0], cor: '', obs: '', prod: paraProd(p, semEmoji(p.nome)), sug: [] });
        G.busca = ''; return gdRender(true);
    }
    if (a === 'addtxt') {                                   // nome digitado que não está na lista: entra como produto a definir (ou já certo, se só houver um parecido)
        const lido = String(G.busca || '').trim();
        if (!lido) { const q = GO.querySelector('#gdBq'); if (q) q.focus(); return; }
        const r = interpretar(lido);
        gdPutItem({ nome: semEmoji(lido), qtd: 1, cond: condDe(lido) || CONDS[0], cor: '', obs: '', prod: r.prod, sug: r.sug });
        G.busca = ''; G.aviso = ''; return gdRender(true);
    }
    if (a === 'addpag') return gdAbrirPag(0, 0);
    if (a === 'fotoc' || a === 'fotog') { const f = GO.querySelector(a === 'fotoc' ? '#gdFc' : '#gdFg'); if (f) f.click(); return; }
    if (a === 'fotox') { G.foto = null; return gdRender(true); }
    if (a === 'pick' && it) {
        const p = produtoPorId(b.dataset.pid); if (!p) return;
        it.prod = paraProd(p, it.nome); it.sug = []; it.q = '';
        if (parseFloat(p.valor) > 0) gdAprendeu(it, p); else G.aviso = 'Este produto está sem valor no CTW. Informe o custo no cartão dele.';
        return gdRender(true);
    }
    if (a === 'del' && it) { G.itens = G.itens.filter(x => x !== it); return gdRender(true); }
    if (a === 'menos' && it) { it.qtd = Math.max(1, it.qtd - 1); return gdRender(true); }
    if (a === 'mais' && it) { it.qtd = Math.min(99, it.qtd + 1); return gdRender(true); }
    if (a === 'custo' && it) { it.edCusto = true; gdRender(true); const c = GO.querySelector('#gdcv-' + it.id); if (c) c.focus(); return; }
    if (a === 'custox' && it) { it.edCusto = false; return gdRender(true); }
    if (a === 'custook' && it) {
        const c = GO.querySelector('#gdcv-' + it.id), v = dinheiro(c && c.value), p = it.prod;
        if (!p) return;
        if (!p.id || !(p.valor > 0)) {                       // produto do CTW sem valor: o custo informado vira o valor dele
            if (!(v > 0)) { if (c) c.focus(); return; }
            p.valor = r2(v); p.manual = true; it.edCusto = false; return gdRender(true);
        }
        const hoje = p.hoje != null ? p.hoje : p.valor;
        if (c && c.value.trim() && !(v > 0)) { c.focus(); return; }
        if (!c || !c.value.trim() || r2(v) === r2(hoje)) { p.valor = hoje; delete p.hoje; p.manual = false; }
        else { p.hoje = hoje; p.valor = r2(v); p.manual = true; }
        it.edCusto = false; return gdRender(true);
    }
    if (a === 'zerar') {
        if (!G.limpar) { G.limpar = true; return gdRender(true); }
        gdLimparRasc(); const z = G.zap; G = novoG(); G.zap = z; return gdRender();
    }
    if (a === 'topay') { const l = Number(id); G.open = G.open === l ? 0 : l; return gdRender(true); }
    if (a === 'rempay') { G.pag = G.pag.filter(x => String(x.id) !== String(id)); G.open = 0; return gdRender(true); }
    if (a === 'altpay') { const l = G.pag.find(x => String(x.id) === String(id)); if (l) gdAbrirPag(dinheiro(l.valor) || 0, l.id); return; }
    if (a === 'irprod') { G.resOpen = false; gdAtualizar(); return gdIr('gds2'); }
    if (a === 'salvar') return gdSalvar();
}

// Valores em dinheiro ganham pontos e vírgula enquanto se digita: 3000 vira 3.000 e 3.000,50 vale três mil e cinquenta centavos.
// O ponto é sempre separador de milhar (como no Brasil); a vírgula separa os centavos (no máximo 2).
const dinheiroMascarado = txt => {
    const s = String(txt || ''), i = s.indexOf(',');
    const inteiro = (i < 0 ? s : s.slice(0, i)).replace(/\D/g, '').replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return i < 0 ? inteiro : (inteiro || '0') + ',' + s.slice(i + 1).replace(/\D/g, '').slice(0, 2);
};
function mascararDinheiro(el, colado) {
    if (colado && /^\s*(R\$)?\s*\d+\.\d{1,2}\s*$/.test(el.value)) el.value = el.value.replace('.', ',');   // valor colado de fora com ponto decimal (2150.5): digitado o ponto é sempre milhar, colado com 1 ou 2 casas é centavo
    const antes = el.value, pos = el.selectionStart == null ? antes.length : el.selectionStart;
    const novo = dinheiroMascarado(antes);
    if (novo === antes) return;
    const adireita = antes.slice(pos).replace(/[^\d,]/g, '').length;   // dígitos (e vírgula) à direita do cursor: o cursor continua com a mesma quantidade deles à direita
    el.value = novo;
    let n = 0, p = novo.length;
    while (p > 0 && n < adireita) { p--; if (/[\d,]/.test(novo[p])) n++; }
    while (p > 0 && novo[p - 1] === '.') p--;                          // fica antes do ponto, não depois
    try { el.setSelectionRange(p, p); } catch (e) { /* tipo de campo sem seleção */ }
}

function gdDigita(e) {
    if (!G) return;
    const t = e.target, ck = t.dataset && t.dataset.ck, f = t.dataset && t.dataset.f;
    if (t.id === 'gdLucIn') { LUC.q = t.value; LUC.aberto = null; lucPintar(); return; }
    if (t.dataset && t.dataset.money !== undefined) { mascararDinheiro(t, e.inputType === 'insertFromPaste'); return; }
    if (t.dataset && t.dataset.dv !== undefined) { G.dataVenda = t.value; gdAtualizar(); gdPersistir(); return; }
    if (ck) {
        G.cli[ck] = t.value; gdPersistir(); gdAtualizar();
        if (ck === 'nasc') { const nb = GO.querySelector('#gdNascBtn'); if (nb) nb.classList.toggle('on', !!t.value); }   // o seletor da Garantia avisa por aqui quando a data muda ou é limpa
        if (ck === 'nome') {
            const q = norm(t.value).trim(), r = GO.querySelector('#gdCres');
            const ach = q.length >= 2 ? (window.dbClientsCache || []).filter(c => norm(c.nome).includes(q) && norm(c.nome) !== q).slice(0, 4) : [];
            if (r) r.innerHTML = ach.map(c => `<button class="gd-op" type="button" data-gd="cad" data-cid="${esc(c.id)}"><span>${esc(c.nome)}</span><small>${esc(c.cpf || c.tel || 'cadastrado')}</small></button>`).join('');
        }
        return;
    }
    if (t.id === 'gdBq') { G.busca = t.value; const r = GO.querySelector('#gdBres'); if (r) r.innerHTML = gdOpcoes(gdBusca(G.busca), 'data-gd="add" data-pid'); return; }
    const it = t.dataset && t.dataset.id != null ? gdItemPorId(t.dataset.id) : null; if (!it) return;
    if (f === 'obs' || f === 'cor') { it[f] = t.value; gdPersistir(); }
    else if (f === 'pbusca') { it.q = t.value; const r = GO.querySelector('#gdps-' + it.id); if (r) r.innerHTML = gdOpcoes(gdBusca(it.q), `data-gd="pick" data-id="${it.id}" data-pid`); }
}


// Foto do produto escolhida na câmera ou na galeria
function gdMuda(e) {
    const t = e.target;
    if (!G || !t || (t.id !== 'gdFc' && t.id !== 'gdFg')) return;
    const arq = t.files && t.files[0]; t.value = '';
    if (arq) gdFotoLer(arq);
}
async function gdFotoLer(arq) {
    const estado = G;
    try {
        await window.ctwCarregarModulo('creditoscan');          // é dele a função que reduz a foto
        const b64 = await window._ctwResizeToBase64(arq);
        if (!b64) throw new Error('foto');
        if (G !== estado) return;
        G.foto = b64; G.aviso = '';
    } catch (err) {
        if (G !== estado) return;
        G.aviso = 'Não consegui abrir essa foto. Tente outra.';
    }
    gdRender(true);
}

// ── Salvar ──────────────────────────────────────────────────────
function gdSalvar() {
    const s = gdSituacao(), prob = s.falta.length ? 'falta' : s.erro;
    if (prob) {                                            // mostra o que falta e leva até a seção
        const h = GO.querySelector('.gd-help'); if (h) { h.classList.remove('flash'); void h.offsetWidth; h.classList.add('flash'); }
        gdIr(!G.itens.length || pendentes().length ? 'gds2' : !G.pag.length || !G.pag.every(gdLinhaCompleta) ? 'gds3' : 'gds4');
        return;
    }
    const sv = document.getElementById('btnSaveBookip'), pv = document.getElementById('ctwSavePreviewOverlay');
    if (pv && !pv.classList.contains('hidden')) return;     // a prévia já está aberta: um segundo toque não pode refazer o formulário
    if (typeof window.ctwPreencherGarantia !== 'function' || !sv) { window.showCustomModal && window.showCustomModal({ message: 'A Garantia ainda está carregando. Tente de novo em instantes.' }); return; }
    if (sv.disabled) return;                               // uma garantia está sendo gravada agora
    const spec = { cli: G.cli, dias: gdDiasOk(G.dias) ? G.dias : 365, items: itensDoDoc(), formas: Array.from(new Set(G.pag.map(l => CHECKS[tipoForma(l)]))), foto: G.foto, dataVenda: G.dataVenda };
    if (G.edit) Object.assign(spec, { editarId: G.edit.id, dataVenda: G.dataVenda || G.edit.dataVenda, fotoUrl: G.edit.fotoUrl });   // atualiza o mesmo documento (mesmo número, mesma foto; a data só muda se foi mudada aqui)
    const ir = forcar => {
        if (!G) return;
        const r = window.ctwPreencherGarantia(Object.assign({ forcar: !!forcar || G.salvando }, spec));   // G.salvando: o formulário já é desta tela (tentativa anterior falhou)
        if (r && r.ocupado) return window.showCustomModal({ message: 'Há uma garantia normal em andamento. Se continuar, ela será substituída por esta.', confirmText: 'Continuar', onConfirm: () => ir(true) });
        G.salvando = true;                                 // o formulário da Garantia agora é desta tela
        sv.click();                                        // mesmo fluxo da Garantia: prévia → número → cliente → foto → PDF
    };
    ir(false);
}

// A prévia da Garantia foi cancelada: o formulário volta limpo e esta tela continua como estava
function gdPreviaCancelada() {
    if (!G || !G.salvando) return;
    G.salvando = false;
    if (typeof window.resetFormulariosBookip === 'function') window.resetFormulariosBookip({ manterRascunho: true });
}

// Chamado pela Garantia depois que o documento foi salvo: grava o líquido ligado a ele e continua nesta tela (não leva para a Garantia comum).
// Garantia nova: a lista volta em branco, pronta para a próxima; o documento salvo está no Histórico. Edição: volta para o Histórico.
async function aoSalvarGarantia(dados) {
    if (!G || !G.salvando || !ehDev() || !dados || !dados.id || (G.edit && G.edit.id !== dados.id)) return;
    const E = G;
    try {
        const r = calcG();
        if (r.erros.length) throw new Error(r.erros[0].msg);
        r.res.garantia = { id: dados.id, doc: dados.docNumber || '', total: totalItens(dados.items) };
        r.res.soma = somaPagamentos(E); r.res.totalGarantia = r.res.garantia.total;
        r.res.cliente = r.res.cliente || String(dados.nome || '').trim();
        await garantirMapa();
        await gravarRegistro(r.res, dados.id, (E.edit && E.edit.ts) || Date.parse(dados.criadoEm) || Date.now());
    } catch (e) {
        if (window.showCustomModal) window.showCustomModal({ message: 'Garantia salva. O valor líquido NÃO foi salvo: ' + ((e && e.message) || 'erro de conexão') + ' Abra a Garantia detalhada, aba Histórico, expanda o card e toque em “Dev · Valor líquido” para completar.' });
    } finally {
        E.salvando = false;                                // o documento já foi gravado: o formulário da Garantia deixa de ser desta tela
        if (G === E && GO) {
            gdSheetFechar(true); gdZapParar();
            if (E.edit) gdRetomarNova(3);
            else {
                gdLimparRasc();
                G = novoG();
                G.aviso = `<b>Garantia${dados.docNumber ? ' Doc ' + esc(dados.docNumber) : ''} salva.</b> Toque em Histórico para ver, mandar o PDF ou o WhatsApp.`;
                gdRender();
            }
            const bd = GO && GO.querySelector('.gd-bd'); if (bd) bd.scrollTop = 0;
        }
    }
}

// Volta para a garantia nova que estava em andamento (guardada enquanto uma antiga era editada), na aba pedida
function gdRetomarNova(pagina) {
    G = GN || gdRestaurar() || novoG();
    GN = null; G.salvando = false; G.page = pagina;
    gdRender();
}

// Botão voltar do celular: fecha a gaveta, volta uma página ou fecha a tela (o rascunho fica guardado)
function gdVoltar() {
    if (!GO) return false;
    const pv = document.getElementById('ctwSavePreviewOverlay'), sv = document.getElementById('btnSaveBookip');
    if (G && G.salvando && ((pv && !pv.classList.contains('hidden')) || (sv && sv.disabled))) return true;   // salvando agora: o voltar não pode desmontar a tela por baixo
    if (document.getElementById('gdSheet')) gdSheetFechar();
    else if (G && G.edit) {                                // sair da edição perde o que foi mexido: confirma
        if (window.showCustomModal) window.showCustomModal({ message: 'Sair da edição? O que você mudou e não salvou será perdido.', confirmText: 'Sair da edição', cancelText: 'Continuar editando', onConfirm: gdSairEdicao, onCancel: () => {} });
        else gdSairEdicao();
    }
    else gdFechar();
    return true;
}

// ── Editar uma garantia salva pela Detalhada ────────────────────
// A tela abre já preenchida com o que foi salvo. Pagamento e lucro vêm do registro de líquido, se existir; garantia antiga (sem registro, ou de outro perfil)
// abre com o pagamento vazio para lançar de novo, mostrando o total atual do documento. Salvar atualiza o MESMO documento (número, data e foto ficam) e o líquido.
const EDIT_COND = /\s-\s(Novo \/ Lacrado|Seminovo)\s*$/;
function gdItensDaEdicao(E, doc, rec) {
    const linhas = (doc.items || []).filter(i => i && !i.isSituation), usadas = new Set();
    const meta = l => { const m = EDIT_COND.exec(String(l.nome || '')); return { cond: m ? m[1] : '', cor: String(l.cor || ''), obs: String(l.obs || '') }; };
    const novo = o => Object.assign({ id: ++E.seq, q: '', edCusto: false, sug: [] }, o);
    const qtd = n => Math.max(1, Math.min(99, parseInt(n, 10) || 1));
    if (rec && Array.isArray(rec.produtos) && rec.produtos.length) {     // o registro sabe o produto do CTW e o custo do dia; o documento, condição/cor/IMEI
        return rec.produtos.map((p, n) => {
            let falta = qtd(p.qtd), m = null;
            linhas.forEach((l, k) => {                                   // uma unidade pode ter sido separada em outra linha do documento: junta até fechar a quantidade
                if (falta <= 0 || usadas.has(k) || !(p.id && l.ctw && String(l.ctw.id) === String(p.id))) return;
                usadas.add(k); falta -= qtd(l.qtd); if (!m) m = meta(l);
            });
            if (!m && linhas[n] && !usadas.has(n)) { usadas.add(n); m = meta(linhas[n]); }
            m = m || { cond: '', cor: '', obs: '' };
            const lido = String(p.lido || p.nome || '');
            const r = p.id ? { sug: [] } : interpretar(lido);              // produto sem vínculo no registro: a pessoa escolhe de novo
            return novo({ nome: lido, qtd: qtd(p.qtd), cond: m.cond, cor: m.cor, obs: m.obs, sug: r.sug,
                prod: p.id ? { nome: p.nome, id: p.id, valor: Number(p.valor) || 0, manual: !!p.manual, duvida: false, lido, hoje: p.hoje != null ? Number(p.hoje) : undefined } : null });
        });
    }
    return linhas.map(l => {
        const m = meta(l), nome = String(l.nome || '').replace(EDIT_COND, '').trim(), cp = l.ctw && l.ctw.id ? produtoPorId(l.ctw.id) : null;
        const r = cp ? { prod: paraProd(cp, nome), sug: [] } : interpretar(nome);
        return novo({ nome, qtd: qtd(l.qtd), cond: m.cond, cor: m.cor, obs: m.obs, prod: r.prod, sug: r.sug });
    });
}

const dataLocal = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };   // documento sem data da venda: fica a do dia em que foi criado
async function gdIniciarEdicao(doc) {
    if (_edTrava) return;
    _edTrava = true;
    try {
        await garantirMapa(true);
        if (!GO || !G || G.salvando || G.edit) return;
        const rec = (MAPA && MAPA.data && MAPA.data[doc.id]) || null, total = totalItens(doc.items), E = novoG();
        E.cli = Object.assign(CLI0(), { nome: doc.nome && doc.nome !== 'Consumidor' ? doc.nome : '', cpf: doc.cpf || '', tel: doc.tel || '', end: doc.end || '', email: doc.email || '' });
        const cad = gdCadastro(E.cli); if (cad && cad.dataNascimento) E.cli.nasc = cad.dataNascimento;     // o nascimento não fica no documento: vem do cadastro do cliente
        E.dias = gdDiasOk(parseInt(doc.diasGarantia, 10)) ? parseInt(doc.diasGarantia, 10) : 365;
        E.itens = gdItensDaEdicao(E, doc, rec);
        E.pag = rec && Array.isArray(rec.linhas) ? linhasDeRegistro(E, rec.linhas) : [];
        E.edit = { id: doc.id, doc: doc.docNumber || '', dataVenda: doc.dataVenda || dataLocal(doc.criadoEm), fotoUrl: doc.fotoUrl || '', ts: (rec && rec.ts) || Date.parse(doc.criadoEm) || 0, nota: '' };
        const soma = somaPagamentos(E);
        if (!rec) E.edit.nota = `<b>Garantia feita antes do valor líquido.</b> Lance como foi pago para calcular o lucro. Total atual do documento: <b>${brl(total)}</b>. Ao salvar, o valor de cada produto no documento é refeito a partir do total dos pagamentos.`;
        else if (Math.abs(soma - total) >= 0.01) E.edit.nota = `<b>Os pagamentos somam ${brl(soma)} e o documento vale ${brl(total)}.</b> Ao salvar, o documento passa a valer o total dos pagamentos.`;
        E.dataVenda = E.edit.dataVenda;
        gdGravar();                                          // a garantia nova em andamento fica gravada antes de ser guardada
        gdZapParar(); if (G.zap) G.zap.lendo = false; gdSheetFechar(true);
        GN = G; G = E;
        gdRender();
    } catch (e) {
        console.warn('[líquido] não abri a edição:', e);
        if (window.showCustomModal) window.showCustomModal({ message: 'Não consegui abrir a edição: ' + ((e && e.message) || 'erro desconhecido') });
    } finally { _edTrava = false; }
}

// true = a edição abre aqui; false = o documento não cabe na Detalhada (recibo, situação, sem valor): fecha esta tela e a edição de sempre segue
function editarNaDetalhada(doc) {
    if (!GO || !G || !ehDev() || !doc) return false;
    if (!ehDocValido(doc) || doc.type === 'recibo') {
        gdFechar();
        if (window.ctwAbrirDoc) window.ctwAbrirDoc('garantia');
        return false;
    }
    gdIniciarEdicao(doc);
    return true;
}

// Sai da edição sem salvar: volta para a garantia nova que estava em andamento, na aba Histórico
function gdSairEdicao() {
    if (!G || !G.edit) return;
    if (G.salvando && typeof window.resetFormulariosBookip === 'function') window.resetFormulariosBookip({ manterRascunho: true });   // o formulário já foi preenchido por esta edição
    gdZapParar(); gdSheetFechar(true);
    gdRetomarNova(3);
}

function abrirGarantiaDet() {
    if (!gdAtivo()) return;
    if (!getDb()) { if (window.showCustomModal) window.showCustomModal({ message: 'O banco de dados ainda está conectando. Tente de novo em alguns segundos.' }); return; }
    carregarAliases();
    G = gdRestaurar() || novoG();
    gdAbrirOverlay();
    gdRender();
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
          <div class="fia-lh"><span class="fia-tag">${l.boleto ? 'BOLETO' : 'PIX / DINHEIRO'}</span><span class="ps-sub fia-g">sem taxa</span>${rem}</div>
          ${campo('Valor (R$)', `<input class="fia-in" data-f="valor" data-id="${l.id}" inputmode="decimal" placeholder="0,00" value="${esc(l.valor)}">`, 'fia-w150')}
          ${linhaErro(l.id)}</div>`;
    }
    if (l.k === 'troca') {
        return `<div class="ps-card fia-lin" data-lid="${l.id}">
          <div class="fia-lh"><span class="fia-tag">TROCA</span><span class="ps-sub fia-g">conta como dinheiro, pelo valor combinado</span>${rem}</div>
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
      <div class="fia-lh"><span class="fia-tag fia-tag-c">CARTÃO</span><span class="ps-sub fia-g">${l.manual ? 'complete aqui' : 'lido pela IA'}</span>${rem}</div>
      <div class="fia-row">
        ${campo('Total passado (R$)', `<input class="fia-in" data-f="valor" data-id="${l.id}" inputmode="decimal" placeholder="0,00" value="${esc(l.valor)}">`, 'fia-w13')}
        ${campo(l.parcDuv ? 'Parcelas · confira' : 'Parcelas', `<select class="fia-in" data-f="parc" data-id="${l.id}">${optsP}</select>`, l.parcDuv ? 'fia-duv' : '')}
      </div>
      <div class="fia-row">
        ${campo('Maquininha', `<select class="fia-in" data-f="maq" data-id="${l.id}">${optsM}</select>`)}
        ${ehPag ? '' : campo(l.bandDuv ? 'Bandeira · presumida' : 'Bandeira', `<select class="fia-in" data-f="band" data-id="${l.id}">${optsB}</select>`, l.bandDuv ? 'fia-duv' : '')}
      </div>
      <div class="fia-nota${nt.forte ? ' fia-nota-forte' : ''}" data-nota="${l.id}">${esc(nt.t)}</div>
      ${linhaErro(l.id)}</div>`;
}

function htmlProdutos() {
    const itens = F.itens, n = itens.length;
    const linhas = itens.map((it, i) => {
        const p = it.prod || { nome: '', valor: null }, tem = p.valor > 0;
        let info;
        if (tem) info = `valor no CTW ${brl(p.valor)}${it.qtd > 1 ? ` × ${it.qtd} = ${brl(baseItem(it))}` : ''}${p.manual ? ' · digitado por você' : p.aprendido ? ' · ligado por você antes' : ''}`;
        else info = p.valor === 0 && p.id ? 'este produto está sem valor no CTW' : 'não achei no CTW';
        const duv = !p.manual && (p.duvida || !tem);
        return `<div class="fia-prod${duv ? ' fia-duvl' : ''}">
          <div class="ps-grow"><div class="ps-nome">${esc(p.nome || it.nome || 'Produto não identificado')}</div><div class="ps-sub">${esc(info)}</div>
            ${p.lido && norm(p.lido) !== norm(p.nome) ? `<div class="ps-sub">${F.modo === 'solto' ? 'A IA leu' : 'Na garantia'}: “${esc(p.lido)}”</div>` : ''}</div>
          <button type="button" class="ps-link" data-act="trocarprod" data-i="${i}">${tem ? 'Trocar' : 'Buscar'}</button></div>${linhaErro('prod' + i)}`;
    }).join('');
    const duvC = itens.some(it => it.prod && !it.prod.manual && (it.prod.duvida || !(it.prod.valor > 0)));
    if (!n) return `<div class="ps-card"><div class="fia-cap">PRODUTOS NO CTW</div><div class="ps-sub">A garantia não tem produtos.</div></div>`;
    return `<div class="ps-card${duvC ? ' fia-duvc' : ''}">
      <div class="fia-cap">${n > 1 ? `PRODUTOS NO CTW · ${n} ITENS` : 'PRODUTO NO CTW'}${itens.some(it => it.prod && it.prod.duvida) ? ' · CONFIRA' : ''}</div>
      ${linhas}
      ${n > 1 ? `<div class="ps-lin fia-sub2"><span>Total no CTW</span><b>${brl(baseTotal(F))}</b></div>` : ''}</div>`;
}

function somaPagamentos(E) { return r2(E.pag.reduce((s, l) => s + (dinheiro(l.valor) || 0), 0)); }
function htmlSoma() {
    if (!F.garantia) return '';
    const soma = somaPagamentos(F), g = totalGar(F), bate = g > 0 && Math.abs(soma - g) < 0.01;
    return `<div class="fia-soma ${bate ? 'ok' : 'am'}" id="fiaSoma"><span>Soma dos pagamentos × garantia</span><span>${brl(soma)} ${bate ? '=' : '≠'} ${brl(g)}</span></div>`;
}
function atualizarSoma() {
    const el = overlay && overlay.querySelector('#fiaSoma');
    if (!el) return;
    el.outerHTML = htmlSoma();
}

function telaConferir(manterScroll) {
    TELA = 'conferir'; titulo(F.modo === 'solto' ? 'Conferir' : 'Líquido da venda');
    const gerais = F.erros.filter(e => e.id == null);
    const sub = F.modo === 'solto' ? 'Corrija o que estiver errado. O cálculo só roda depois de você confirmar.'
        : `Garantia nº ${esc(F.garantia.doc || '—')}${F.cliente ? ' · ' + esc(F.cliente) : ''}. Os valores vêm da garantia: complete o que faltar.`;
    tela(`
      <div class="ps-sub">${sub}</div>
      ${gerais.length ? `<div class="ps-card fia-errc">${gerais.map(e => `<p>${esc(e.msg)}</p>`).join('')}</div>` : ''}
      ${F.avisosIA.length ? `<div class="ps-card ps-alerta"><div class="fia-cap">A IA AVISOU</div>${F.avisosIA.map(a => `<p>${esc(a)}</p>`).join('')}</div>` : ''}
      ${F.modo === 'solto' ? `<div class="ps-card"><div class="fia-cap">CLIENTE</div>
        <input class="fia-in fia-cli" data-f="cliente" placeholder="Nome do cliente (opcional)" maxlength="80" value="${esc(F.cliente)}"></div>` : ''}
      ${htmlProdutos()}
      ${F.pag.map(htmlLinha).join('')}
      <div class="fia-add">
        <button type="button" class="ps-btn" data-act="add" data-k="cartao">+ Cartão</button>
        <button type="button" class="ps-btn" data-act="add" data-k="pix">+ Pix/dinheiro</button>
        <button type="button" class="ps-btn" data-act="add" data-k="troca">+ Troca</button>
      </div>
      ${htmlSoma()}`,
        '<button type="button" class="ps-btn ps-prim" data-act="calcular">Calcular valor real</button>', manterScroll);
}

function atualizarNota(l, raiz) {
    const el = (raiz || overlay) && (raiz || overlay).querySelector(`[data-nota="${l.id}"]`);
    if (!el) return;
    const nt = notaCartao(l);
    el.textContent = nt.t; el.classList.toggle('fia-nota-forte', nt.forte);
}

// ── Escolha do produto ──────────────────────────────────────────
function telaProduto() {
    TELA = 'produto'; titulo('Produto');
    const it = F.itens[F.edIdx] || { nome: '', prod: null };
    const ini = (it.prod && (it.prod.lido || it.prod.nome)) || it.nome || '';
    tela(`
      <div class="ps-busca"><input id="fiaBusca" data-f="busca" placeholder="Buscar produto no CTW" autocomplete="off" value="${esc(ini)}"></div>
      <div class="ps-col" id="fiaResBusca"></div>
      <div class="ps-card">
        <div class="fia-cap">NÃO ACHOU? DIGITE O VALOR</div>
        <input class="fia-in" data-f="mnome" placeholder="Nome do produto" value="">
        <input class="fia-in" data-f="mvalor" inputmode="decimal" placeholder="Valor unitário no CTW (R$)" value="">
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
// Cartão entra pelo líquido (valor passado − taxa); Pix, dinheiro e troca entram pelo valor cheio.
function calcular(E) {
    const erros = [];
    if (!window._areRatesLoaded || typeof window._getRate !== 'function') return { erros: [{ id: null, msg: 'As taxas ainda estão carregando. Tente de novo em instantes.' }] };
    if (!E.itens.length) erros.push({ id: null, msg: 'Não há produto para comparar com o CTW.' });
    E.itens.forEach((it, i) => { if (!(it.prod && it.prod.valor > 0)) erros.push({ id: 'prod' + i, msg: 'Escolha o produto no CTW ou digite o valor dele.' }); });
    const base = baseTotal(E);
    if (!E.pag.length) erros.push({ id: null, msg: 'Adicione pelo menos um pagamento.' });
    const linhas = [];
    E.pag.forEach(l => {
        const v = dinheiro(l.valor);
        if (!(v > 0)) { erros.push({ id: l.id, msg: 'Informe o valor.' }); return; }
        if (l.k === 'pix') { linhas.push(l.boleto ? { k: 'pix', valor: r2(v), boleto: true } : { k: 'pix', valor: r2(v) }); return; }
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
        linhas.push({ k: 'cartao', valor: r2(v), parcelas: l.parc, bandeira: ehPag ? '' : l.band, maq: l.maq, taxa, desc: r2(v - liq), liq, pres: !ehPag && !!l.bandDuv });
    });
    if (erros.length) return { erros };
    const real = r2(linhas.reduce((s, l) => s + (l.k === 'cartao' ? l.liq : l.valor), 0));
    const produtos = E.itens.map(it => ({ nome: ((it.prod && it.prod.nome) || it.nome || '').trim(), lido: it.nome, id: it.prod.id || null, qtd: it.qtd, valor: r2(it.prod.valor), manual: !!it.prod.manual, hoje: it.prod.hoje != null ? r2(it.prod.hoje) : null }));
    const res = { cliente: E.cliente.trim(), produtos, base, linhas, real, lucro: r2(real - base), garantia: E.garantia && E.garantia.id ? { id: E.garantia.id, doc: E.garantia.doc, total: E.garantia.total } : null };
    if (E.garantia) {
        res.soma = somaPagamentos(E); res.totalGarantia = E.garantia.total;
        if (res.soma < E.garantia.total - 0.005) res.parcial = true;     // ainda falta pagamento: o histórico avisa em vez de mostrar um lucro enganoso
    }
    return { erros, res };
}

// ── 3 · Resultado (também usado no detalhe do registro) ─────────
const listaProdutos = R => (R.produtos && R.produtos.length ? R.produtos : [{ nome: (R.produto && R.produto.nome) || 'Produto', qtd: 1, valor: (R.produto && R.produto.valor) || R.base || 0 }]);
const nomeDeR = R => { const p = listaProdutos(R); return (p[0].nome || 'Produto sem nome') + (p.length > 1 ? ` + ${p.length - 1}` : ''); };

function htmlResultado(R) {
    const cartoes = R.linhas.filter(l => l.k === 'cartao'), temTroca = R.linhas.some(l => l.k === 'troca');
    const prods = listaProdutos(R), base = R.base != null ? R.base : (R.produto && R.produto.valor) || 0;
    const simples = cartoes.length === 1 && !temTroca;
    const cls = R.lucro > 0 ? 'ok' : R.lucro < 0 ? 'neg' : '';
    let n = 0;
    const lin = R.linhas.map(l => {
        if (l.k === 'pix') return `<div class="ps-lin"><span>${l.boleto ? 'Boleto' : 'Pix / dinheiro'}</span><b>${brl(l.valor)}</b></div>`;
        if (l.k === 'troca') return `<div class="fia-bl"><div class="ps-lin"><span>Troca${l.aparelho ? ' · ' + esc(l.aparelho) : ''}</span><b>${brl(l.valor)}</b></div><div class="ps-sub">conta como dinheiro, pelo valor combinado</div></div>`;
        n++;
        if (simples) return `<div class="fia-bl"><div class="ps-lin"><span>${l.parcelas === 0 ? 'Débito' : 'Cartão ' + l.parcelas + 'x'} · passou</span><b>${brl(l.valor)}</b></div>
          <div class="ps-lin fia-neg"><span>taxa ${fmtTaxa(l.taxa)}</span><span>− ${brl(l.desc)}</span></div>
          <div class="ps-lin"><span>Líquido do cartão</span><b>${brl(l.liq)}</b></div></div>`;
        const nome = `Cartão ${cartoes.length > 1 ? n + ' · ' : '· '}${rotParc(l.parcelas)}${l.bandeira ? ' · ' + nomeBand(l.bandeira) + (l.pres ? ' (presumida)' : '') : ''}`;
        return `<div class="fia-bl"><div class="ps-lin"><span>${esc(nome)}</span><b>${brl(l.valor)}</b></div><div class="ps-lin fia-sub2"><span>taxa ${fmtTaxa(l.taxa)} → líquido</span><b>${brl(l.liq)}</b></div></div>`;
    }).join('<div class="fia-hr"></div>');
    const c1 = cartoes[0];
    const rodapeNota = simples && c1 ? `<div class="ps-card"><p>${esc(nomeMaq(c1.maq))}${c1.bandeira ? ' · ' + esc(nomeBand(c1.bandeira)) : ''} · taxa lida do cadastro de Taxas.</p></div>` : '';
    const descCtw = prods.length > 1
        ? prods.map(p => `<div class="ps-lin fia-sub2"><span>${esc(p.nome || 'Produto')}${p.qtd > 1 ? ' × ' + p.qtd : ''} no CTW</span><span>− ${brl(r2(p.valor * (p.qtd || 1)))}</span></div>`).join('')
        : `<div class="ps-lin fia-sub2"><span>Produto no CTW${(prods[0].qtd || 1) > 1 ? ' × ' + prods[0].qtd : ''}</span><span>− ${brl(base)}</span></div>`;
    const dif = R.totalGarantia != null && Math.abs((R.soma || 0) - R.totalGarantia) >= 0.01;
    return `
      <div class="ps-sub">${R.cliente ? esc(R.cliente) + ' · ' : ''}${esc(nomeDeR(R))}${R.garantia && R.garantia.doc ? ` · garantia nº ${esc(R.garantia.doc)}` : ''}</div>
      <div class="fia-big ${cls}">
        <div class="fia-cap">${R.lucro < 0 ? 'Prejuízo desta venda' : 'Lucro extra desta venda'}</div>
        <div class="fia-val">${sinal(R.lucro)}</div>
        <div class="ps-sub">Valor real final ${brl(R.real)} contra ${brl(base)} no CTW${prods.length > 1 ? ` (${prods.length} itens)` : ''}</div>
      </div>
      <div class="ps-card">
        <div class="fia-cap">${simples ? 'COMO CHEGUEI NESSE VALOR' : 'LINHA A LINHA'}</div>
        ${lin}
        <div class="fia-hr"></div>
        <div class="ps-lin fia-tot"><b>Valor real final</b><b>${brl(R.real)}</b></div>
        ${descCtw}
      </div>
      ${dif ? `<div class="ps-card ps-alerta"><p>A soma dos pagamentos (${brl(R.soma)}) não bate com o valor da garantia (${brl(R.totalGarantia)}). Confira se faltou algum pagamento.</p></div>` : ''}
      ${rodapeNota}`;
}

function resumoTexto(R) {
    const L = [`Valor líquido · ${nomeDeR(R)}`];
    if (R.cliente) L.push(`Cliente: ${R.cliente}`);
    R.linhas.forEach(l => {
        if (l.k === 'cartao') L.push(`${l.parcelas === 0 ? 'Débito' : 'Cartão ' + l.parcelas + 'x'}${l.bandeira ? ' ' + nomeBand(l.bandeira) : ''} (${nomeMaq(l.maq)}): ${brl(l.valor)} → líquido ${brl(l.liq)} (taxa ${fmtTaxa(l.taxa)})`);
        else if (l.k === 'pix') L.push(`${l.boleto ? 'Boleto' : 'Pix/dinheiro'}: ${brl(l.valor)}`);
        else L.push(`Troca${l.aparelho ? ' (' + l.aparelho + ')' : ''}: ${brl(l.valor)}`);
    });
    L.push(`Valor real final: ${brl(R.real)}`, `Produtos no CTW: ${brl(R.base != null ? R.base : (R.produto && R.produto.valor) || 0)}`, `${R.lucro < 0 ? 'Prejuízo' : 'Lucro extra'}: ${sinal(R.lucro)}`);
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
    const prim = `<button type="button" class="ps-btn ps-prim" data-act="salvar"${_salvando ? ' disabled' : ''}>${salvo ? '<i class="bi bi-check2"></i> Salvo · atualizar registro' : (F.modo === 'garantia' ? 'Salvar no histórico' : 'Salvar no registro')}</button>`;
    tela(htmlResultado(F.res),
        `${prim}<div class="fia-2"><button type="button" class="ps-btn" data-act="copiar">Copiar resumo</button><button type="button" class="ps-btn" data-act="editar">Editar</button></div>`);
}

// Grava (ou atualiza) um registro. `id` fixo = ligado a uma garantia; sem `id` = venda solta (id novo).
async function gravarRegistro(R, id, ts) {
    const db = getDb();
    if (!db) throw new Error('Sem conexão com o banco.');
    const pasta = `${BASE}/${chavePerfil()}`;
    const chave = id || push(ref(db, pasta)).key;
    const antigo = MAPA && MAPA.data && MAPA.data[chave];
    const rec = { ts: (antigo && antigo.ts) || ts || Date.now(), cliente: R.cliente || '', produto: nomeDeR(R), produtos: R.produtos, base: R.base, real: R.real, lucro: R.lucro, linhas: R.linhas };
    if (R.parcial) rec.parcial = true;
    if (R.garantia && R.garantia.id) { rec.garantiaId = R.garantia.id; rec.doc = R.garantia.doc || ''; rec.totalGarantia = R.totalGarantia != null ? R.totalGarantia : R.garantia.total; }
    const limpo = JSON.parse(JSON.stringify(rec));
    await set(ref(db, `${pasta}/${chave}`), limpo);
    if (MAPA && MAPA.data) MAPA.data[chave] = limpo;
    pintarHistorico();
    return { chave, ts: limpo.ts };
}

async function salvar() {
    const R = F && F.res;
    if (_salvando || !R) return;
    if (!getDb()) { toast('Sem conexão com o banco. Tente de novo.'); return; }
    _salvando = true; telaResultado();
    const estado = F;
    try {
        const idFixo = estado.modo === 'garantia' ? estado.garantia.id : estado.salvoId;
        const out = await gravarRegistro(R, idFixo || null, estado.salvoTs || estado.garantia && estado.garantia.ts || 0);
        if (estado === F) { F.salvoId = out.chave; F.salvoTs = out.ts; }
        _salvando = false;
        if (estado === F && TELA === 'resultado') { telaResultado(); toast(estado.modo === 'garantia' ? 'Líquido salvo na garantia.' : 'Venda salva no seu registro.'); }
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
    if (linhas.some(l => l.k === 'pix' && !l.boleto)) parts.push('Pix');
    if (linhas.some(l => l.k === 'pix' && l.boleto)) parts.push('Boleto');
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
          <span class="fia-regl"><span class="ps-grow"><span class="ps-nome">${esc(r.produto || 'Produto')}</span><span class="ps-sub">${r.cliente ? esc(r.cliente) + ' · ' : ''}${rotData(r.ts || 0)} · ${esc(resumoPag(r.linhas))}${r.garantiaId ? ` · garantia${r.doc ? ' nº ' + esc(r.doc) : ''}` : ''}</span></span>
          <b class="${r.lucro > 0 ? 'ok' : r.lucro < 0 ? 'neg' : ''}">${sinal(Number(r.lucro) || 0)}</b></span></button>`).join('')
        : '<div class="ps-msg">Nenhuma venda neste período.</div>'}`);
}

function paraResultado(r) {
    const R = { cliente: r.cliente || '', ts: r.ts, produtos: r.produtos && r.produtos.length ? r.produtos : [{ nome: r.produto, qtd: 1, valor: Number(r.base) || 0 }], base: Number(r.base) || 0, linhas: r.linhas, real: Number(r.real) || 0, lucro: Number(r.lucro) || 0 };
    if (r.parcial) R.parcial = true;
    if (r.garantiaId) { R.garantia = { id: r.garantiaId, doc: r.doc || '' }; R.totalGarantia = r.totalGarantia; R.soma = r2(r.linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0)); }
    return R;
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
        if (MAPA && MAPA.data) delete MAPA.data[id];
        _exc = null;
        renderRegistros();
        toast('Registro excluído.');
        pintarHistorico();
    } catch (e) { toast('Não consegui excluir: ' + ((e && e.message) || 'erro de conexão')); }
}

// ── Histórico de recibos: painel "Dev · Valor líquido" dentro do card expandido ──
async function garantirMapa(forcar) {
    if (!forcar && MAPA && Date.now() - MAPA_TS < 120000) return;
    const db = getDb(); if (!db) return;
    try {
        MAPA = { data: (await get(ref(db, `${BASE}/${chavePerfil()}`))).val() || {} };
        MAPA_TS = Date.now();
    } catch (e) { if (!MAPA) MAPA = { data: {} }; }
}

const ehDocValido = d => d && d.type !== 'orcamento' && d.type !== 'situacao' && !(d.items && d.items[0] && d.items[0].isSituation) && totalItens(d.items) > 0;
const rotCartao = l => `${l.parcelas === 0 ? 'Débito' : 'Cartão ' + l.parcelas + 'x'}${l.bandeira ? ' · ' + nomeBand(l.bandeira) + (l.pres ? ' (presumida)' : '') : ''} · ${nomeMaq(l.maq)}`;

function htmlResumoHist(R) {
    const prods = listaProdutos(R);
    const lin = R.linhas.map(l => {
        if (l.k === 'cartao') return `<div class="fia-hl"><span>${esc(rotCartao(l))}</span><b>${brl(l.valor)}</b></div><div class="fia-hl fia-hs"><span>taxa ${fmtTaxa(l.taxa)} → líquido</span><span>${brl(l.liq)}</span></div>`;
        if (l.k === 'pix') return `<div class="fia-hl"><span>${l.boleto ? 'Boleto' : 'Pix / dinheiro'}</span><b>${brl(l.valor)}</b></div>`;
        return `<div class="fia-hl"><span>Troca${l.aparelho ? ' · ' + esc(l.aparelho) : ''}</span><b>${brl(l.valor)}</b></div>`;
    }).join('');
    const parc = R.parcial ? `<div class="fia-am fia-sm">Pagamento incompleto: faltam ${brl(r2((R.totalGarantia || 0) - (R.soma || 0)))} do total. O lucro abaixo ainda não vale: complete pelo botão “Corrigir pagamento”.</div>` : '';
    return `${parc}<div class="fia-hl"><span>Vendido por (garantia)</span><b>${brl(R.totalGarantia != null ? R.totalGarantia : R.soma)}</b></div>
      <div class="fia-hr"></div><div class="fia-cap">PAGAMENTO</div>${lin}
      <div class="fia-hr"></div><div class="fia-hl"><b>Valor real recebido</b><b>${brl(R.real)}</b></div>
      <div class="fia-cap">NO CTW</div>
      ${prods.map(p => `<div class="fia-hl fia-hs"><span>${esc(p.nome || 'Produto')}${p.qtd > 1 ? ' × ' + p.qtd : ''}</span><span>− ${brl(r2(p.valor * (p.qtd || 1)))}</span></div>`).join('')}
      <div class="fia-hr"></div>
      <div class="fia-hl"><span class="fia-cap">${R.lucro < 0 ? 'Prejuízo' : 'Lucro extra'}</span><b class="fia-val ${R.lucro > 0 ? 'ok' : R.lucro < 0 ? 'neg' : ''}">${sinal(R.lucro)}</b></div>`;
}

function htmlPainelHist(doc, rec) {
    if (!rec) {
        const novo = (doc.items || []).filter(i => i && !i.isSituation).every(i => i.ctw);
        return novo
            ? '<p>O pagamento não foi detalhado nesta garantia. O produto do CTW já está vinculado: falta só informar como foi pago.</p><button type="button" class="ps-btn" data-liq="abrir">Informar pagamento</button>'
            : '<p>Garantia anterior ao líquido automático: o app não sabe qual produto do CTW nem como foi pago.</p><button type="button" class="ps-btn" data-liq="abrir">Informar produto e pagamento</button>';
    }
    const mudou = Math.abs((Number(rec.totalGarantia) || 0) - totalItens(doc.items)) >= 0.01;
    return `${mudou ? `<div class="fia-am fia-sm">O valor da garantia mudou (agora ${brl(totalItens(doc.items))}). O cálculo abaixo é da versão anterior: corrija o pagamento.</div>` : ''}
      ${htmlResumoHist(paraResultado(rec))}
      <div class="fia-2"><button type="button" class="ps-btn" data-liq="copiar">Copiar resumo</button><button type="button" class="ps-btn" data-liq="abrir">Corrigir pagamento</button></div>`;
}

function pintarSlot(s) {
    const doc = LISTA_H.find(d => d.id === s.dataset.id);
    const rec = doc && MAPA && MAPA.data[doc.id], aberto = s.dataset.aberto === '1';
    if (!doc || !ehDocValido(doc) || !(doc.detalhada || rec)) { s.innerHTML = ''; return; }   // só garantias feitas na Detalhada (ou que já têm líquido)
    let cls = '', lado = 'sem cálculo';
    if (rec) {
        const mudou = Math.abs((Number(rec.totalGarantia) || 0) - totalItens(doc.items)) >= 0.01;
        cls = mudou || rec.parcial ? 'am' : rec.lucro > 0 ? 'ok' : rec.lucro < 0 ? 'neg' : '';
        lado = mudou ? 'desatualizado' : rec.parcial ? 'incompleto' : sinal(rec.lucro);
    }
    s.innerHTML = `<button type="button" class="fia-hbtn ${cls}" data-liq="toggle" aria-expanded="${aberto}"><span class="fia-dev">Dev</span><span class="ps-grow">Valor líquido</span><span>${lado} ${aberto ? '▴' : '▾'}</span></button>${aberto ? `<div class="fia-hpan">${htmlPainelHist(doc, rec)}</div>` : ''}`;
}

function pintarHistorico() {
    if (!CONT_H || !MAPA) return;
    CONT_H.querySelectorAll('.ctw-liq-slot').forEach(pintarSlot);
}

async function decorarHistorico(container, lista) {
    if (!container || !ehDev()) return;
    CONT_H = container; LISTA_H = lista || [];
    if (!container._liqLigado) {
        container._liqLigado = true;
        container.addEventListener('click', e => {
            const b = e.target.closest('[data-liq]'); if (!b) return;
            const s = b.closest('.ctw-liq-slot'); if (!s) return;
            const doc = LISTA_H.find(d => d.id === s.dataset.id); if (!doc) return;
            const a = b.dataset.liq, rec = MAPA && MAPA.data[doc.id];
            if (a === 'toggle') { s.dataset.aberto = s.dataset.aberto === '1' ? '0' : '1'; pintarSlot(s); }
            else if (a === 'abrir') editarNaDetalhada(doc);
            else if (a === 'copiar' && rec) copiar(resumoTexto(paraResultado(rec))).then(ok => { b.textContent = ok ? 'Copiado ✓' : 'Não consegui copiar'; });
        });
    }
    await garantirMapa();
    pintarHistorico();
    lucPintar();                                  // a lista de garantias chegou (ou mudou): a busca de lucro se atualiza
}

// ── Histórico da Detalhada: busca por lucro ("+50" = vendas que fecharam com pelo menos R$ 50,00 de líquido) ──
// Usa só o líquido já gravado (settings/fechamentosIA): o app não recalcula nada aqui. Fica de fora o que não tem líquido válido:
// pagamento incompleto, valor da garantia mudado depois do cálculo, ou garantia da Detalhada sem pagamento informado (contados no aviso).
const LUC_PER = [['dia', 'Hoje'], ['semana', 'Semana'], ['mes', 'Mês'], ['tudo', 'Tudo']];
const LUC_RAPIDO = [['+30', '+30'], ['+50', '+50'], ['+100', '+100'], ['+200', '+200'], ['-1', 'Prejuízo']];
const LUC = { q: '', per: 'mes', exp: false, aberto: null, dados: null, escopo: '', ts: 0, erro: '', carregando: false, seq: 0 };
const sanePerfil = n => String(n || '').trim().replace(/[.#$\[\]\/]/g, '_').slice(0, 60);

// "+50", "50", "+1.250,50", "R$ 80" → { n: 50 }; "-20" → { n: -20, perda: true }; vazio → null; ilegível → { erro: true }
function lucParse(q) {
    const t = String(q || '').replace(/\s/g, '').replace(/^([+-]?)R\$/i, '$1');
    if (!t) return null;
    const m = /^([+-]?)(\d{1,3}(?:\.\d{3})+|\d+)(?:[,.](\d{1,2}))?$/.exec(t);
    if (!m) return { erro: true };
    const n = parseFloat(m[2].replace(/\./g, '') + (m[3] ? '.' + m[3] : ''));
    return m[1] === '-' ? { n: -n, perda: true } : { n };
}
const lucBate = (lucro, r) => r.perda ? lucro <= r.n + 0.005 : (r.n === 0 ? lucro > 0.005 : lucro >= r.n - 0.005);
const lucIni = p => p === 'dia' ? inicioDia(Date.now()).getTime() : desde(p);   // 'tudo' → 0
function lucDia(doc, rec) {                      // dia da venda: a data digitada na garantia; sem ela, o dia em que foi criada
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(doc.dataVenda || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : inicioDia(doc.criadoEm || (rec && rec.ts) || Date.now()).getTime();
}
const lucEscopo = () => { const f = window.activeProfileFilter; return !f || f === 'todos' ? 'todos' : sanePerfil(f); };
const lucRotEscopo = () => { const f = window.activeProfileFilter; return !f || f === 'todos' ? 'Todos os perfis' : (sanePerfil(f) === chavePerfil() ? 'Meus arquivos' : f); };

// Registros do escopo atual. O do próprio perfil vem do MAPA (sempre atual); os outros são lidos do banco (cache curto).
async function lucCarregar(forcar) {
    const esc = lucEscopo(), proprio = esc === chavePerfil(), n = ++LUC.seq;
    LUC.erro = '';
    if (!forcar && LUC.escopo === esc && (proprio || (LUC.dados && Date.now() - LUC.ts < 30000))) { LUC.carregando = false; return lucPintar(); }
    LUC.escopo = esc; LUC.carregando = true; lucPintar();
    try {
        if (proprio) { await garantirMapa(forcar); LUC.dados = null; }
        else {
            const db = getDb(); if (!db) throw new Error('Sem conexão com o banco.');
            const v = (await get(ref(db, esc === 'todos' ? BASE : `${BASE}/${esc}`))).val() || {};
            const L = [];
            if (esc === 'todos') Object.values(v).forEach(p => Object.entries(p || {}).forEach(([id, rec]) => L.push([id, rec])));
            else Object.entries(v).forEach(e => L.push(e));
            if (n !== LUC.seq) return;
            LUC.dados = L; LUC.ts = Date.now();
        }
    } catch (e) { if (n === LUC.seq) { LUC.erro = (e && e.message) || 'erro de conexão'; LUC.dados = null; LUC.escopo = ''; } }
    if (n === LUC.seq) { LUC.carregando = false; lucPintar(); }
}

// Junta os registros com as garantias da lista: [{ id, doc, rec, dia, lucro, ok }]. null = a lista de garantias ainda não chegou.
function lucBase() {
    if (!LISTA_H.length) return null;
    const docs = new Map(LISTA_H.map(d => [d.id, d])), por = new Map();
    const linhas = LUC.escopo === chavePerfil() ? Object.entries((MAPA && MAPA.data) || {}) : (LUC.dados || []);
    linhas.forEach(([id, rec]) => {
        const doc = docs.get(id), lucro = rec && Number(rec.lucro);
        if (!doc || !ehDocValido(doc) || !rec || !Array.isArray(rec.linhas) || rec.lucro === null || rec.lucro === '' || !isFinite(lucro)) return;
        const ok = !rec.parcial && Math.abs((Number(rec.totalGarantia) || 0) - totalItens(doc.items)) < 0.01;
        const novo = { id, doc, rec, dia: lucDia(doc, rec), lucro, ok };
        const ant = por.get(id);
        if (!ant || (ok && !ant.ok)) por.set(id, novo);      // o mesmo id em dois perfis: vale o que está em dia
    });
    const f = window.activeProfileFilter;
    LISTA_H.forEach(doc => {                                // garantia da Detalhada sem pagamento informado: não tem líquido, só entra no aviso
        if (por.has(doc.id) || !doc.detalhada || !ehDocValido(doc) || (f && f !== 'todos' && doc.criadoPor !== f)) return;
        por.set(doc.id, { id: doc.id, doc, rec: null, dia: lucDia(doc, null), lucro: 0, ok: false });
    });
    return [...por.values()];
}

const lucPlural = (n, s, p) => n + ' ' + (n === 1 ? s : p);
function lucResultado() {
    const r = lucParse(LUC.q);
    if (r === null) return { vazio: true };
    if (r.erro) return { erro: true };
    if (LUC.erro) return { falha: LUC.erro };
    const base = lucBase();
    if (!base || LUC.carregando) return { carregando: true, r };
    const cont = p => base.filter(x => x.ok && x.dia >= lucIni(p) && lucBate(x.lucro, r)).length;
    const ini = lucIni(LUC.per), noPer = base.filter(x => x.dia >= ini);
    const L = noPer.filter(x => x.ok && lucBate(x.lucro, r)).sort((a, b) => b.dia - a.dia || b.lucro - a.lucro);
    return { r, cont, L, fora: noPer.filter(x => !x.ok).length };
}

function lucCartao(x) {
    const d = new Date(x.dia), dt = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
    const prods = (x.doc.items || []).filter(i => i && !i.isSituation).map(i => i.nome).filter(Boolean).join(' · ');
    const aberto = LUC.aberto === x.id, f = window.activeProfileFilter;
    const doc = esc(x.doc.docNumber || x.rec.doc || '');
    return `<div class="gd-lc${aberto ? ' open' : ''}"><button type="button" class="gd-lct" data-gd="luc-abrir" data-id="${esc(x.id)}" aria-expanded="${aberto}">
        <span class="gd-lcd">${doc || '—'}</span><span class="gd-lcn"><b>${esc(x.doc.nome || 'Consumidor')}</b><small>${esc(prods || 'Sem produto')}</small></span>
        <span class="gd-lcr"><b class="${x.lucro < 0 ? 'neg' : ''}">${sinal(x.lucro)}</b><small>${dt}${(!f || f === 'todos') && x.doc.criadoPor ? ' · ' + esc(x.doc.criadoPor) : ''}</small></span></button>
      ${aberto ? `<div class="gd-lcb">${htmlResumoHist(paraResultado(x.rec))}<div class="gd-acts"><button type="button" data-gd="luc-editar" data-id="${esc(x.id)}">Abrir garantia</button><button type="button" data-gd="luc-copiar" data-id="${esc(x.id)}">Copiar resumo</button></div></div>` : ''}</div>`;
}

function lucPintar() {
    const sum = GO && GO.querySelector('#gdLucSum'); if (!sum) return;
    const per = GO.querySelector('#gdLucPer'), res = GO.querySelector('#gdLucRes'), av = GO.querySelector('#gdLucAv'), hist = GO.querySelector('#gdHist');
    const R = lucResultado(), q = lucParse(LUC.q);
    GO.querySelector('#gdLucIn').classList.toggle('bad', !!(q && q.erro));
    per.innerHTML = R.cont ? LUC_PER.map(p => `<button type="button" data-gd="luc-per" data-v="${p[0]}" class="${LUC.per === p[0] ? 'on' : ''}">${p[1]}<b>${R.cont(p[0])}</b></button>`).join('') : '';
    const crit = R.r && (R.r.perda ? `prejuízo de ${brl(-R.r.n)} ou mais` : R.r.n === 0 ? 'lucro' : `lucro de ${brl(R.r.n)} ou mais`);
    const rot = { dia: 'hoje', semana: 'nesta semana', mes: 'neste mês', tudo: 'em todo o tempo' }[LUC.per];
    let html = '', aviso = '', lista = '';
    if (R.erro) html = '<div class="gd-luc-s nada">Não entendi esse valor. Use por exemplo <b>+50</b>, <b>80</b> ou <b>+120,50</b>. Para prejuízo, <b>-20</b>.</div>';
    else if (R.falha) html = `<div class="gd-luc-s nada">Não consegui ler os registros: ${esc(R.falha)}. <b>Tente de novo</b> em instantes.</div>`;
    else if (R.carregando) html = '<div class="gd-luc-s nada">Procurando…</div>';
    else if (R.L) {
        const L = R.L, tot = r2(L.reduce((s, x) => s + x.lucro, 0)), top = L.slice().sort((a, b) => b.lucro - a.lucro)[0];
        html = L.length ? `<div class="gd-luc-s"><b>${lucPlural(L.length, 'venda', 'vendas')}</b> com ${crit} ${rot}. ${L.length > 1 ? 'Somam' : 'Soma'} <b>${sinal(tot)}</b>${L.length > 1 && !R.r.perda ? `, a maior foi de <b>${esc(top.doc.nome || 'Consumidor')}</b> (${brl(top.lucro)})` : ''}.</div>`
            : `<div class="gd-luc-s nada">Nenhuma venda com ${crit} ${rot}. Tente um valor menor ou outro período.</div>`;
        if (R.fora) aviso = `${lucPlural(R.fora, 'venda sem líquido válido ficou', 'vendas sem líquido válido ficaram')} de fora (pagamento não informado, incompleto ou desatualizado).`;
        lista = L.map(lucCartao).join('');
    }
    sum.innerHTML = html; av.textContent = aviso; res.innerHTML = lista;
    GO.querySelector('#gdLucEsc').textContent = R.L && q && !q.erro ? `${LUC.q.trim()} · ${lucPlural(R.L.length, 'venda', 'vendas')}` : lucRotEscopo();   // fechado, o título ainda diz o que está filtrado
    GO.querySelector('#gdLucBody').hidden = !LUC.exp;
    const hd = GO.querySelector('#gdLucHd'); hd.setAttribute('aria-expanded', LUC.exp); hd.classList.toggle('open', LUC.exp);
    hist.classList.toggle('gd-busca', !!(q && !q.erro));        // com uma busca ativa, a lista comum sai de cena
}

function lucMontar() {
    const hist = GO && GO.querySelector('#gdHist'); if (!hist || hist.querySelector('#gdLucSum')) return;
    hist.insertAdjacentHTML('afterbegin', `<div class="gd-luc"><button type="button" class="gd-luc-h" id="gdLucHd" data-gd="luc-mod" aria-controls="gdLucBody">${ico('trend')}<b>Buscar lucro</b><small id="gdLucEsc"></small>${ico('down')}</button>
        <div class="gd-luc-b" id="gdLucBody" hidden><div class="gd-luc-v"><input class="gd-in" id="gdLucIn" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="+50" aria-label="Lucro mínimo da venda" value="${esc(LUC.q)}"><button type="button" data-gd="luc-limpa" aria-label="Limpar busca">${ico('x')}</button></div>
        <div class="gd-luc-q">${LUC_RAPIDO.map(r => `<button type="button" data-gd="luc-rapido" data-v="${r[0]}">${r[1]}</button>`).join('')}</div>
        <div class="gd-luc-p" id="gdLucPer"></div><div id="gdLucSum"></div><p class="gd-luc-w" id="gdLucAv"></p></div></div><div class="gd-luc-r" id="gdLucRes"></div>`);
    lucPintar(); lucCarregar(false);
}

function lucClique(a, b) {
    if (a === 'luc-mod') { LUC.exp = !LUC.exp; lucPintar(); if (LUC.exp) { const i = GO.querySelector('#gdLucIn'); if (i && !LUC.q) i.focus(); } return; }
    if (a === 'luc-per') { LUC.per = b.dataset.v; LUC.aberto = null; }
    else if (a === 'luc-rapido') { LUC.q = b.dataset.v; LUC.aberto = null; GO.querySelector('#gdLucIn').value = LUC.q; }
    else if (a === 'luc-limpa') { LUC.q = ''; LUC.aberto = null; const i = GO.querySelector('#gdLucIn'); i.value = ''; i.focus(); }
    else if (a === 'luc-abrir') LUC.aberto = LUC.aberto === b.dataset.id ? null : b.dataset.id;
    else {
        const x = (lucBase() || []).find(y => y.id === b.dataset.id); if (!x || !x.rec) return;
        if (a === 'luc-editar') { editarNaDetalhada(x.doc); return; }
        if (a === 'luc-copiar') { copiar(resumoTexto(paraResultado(x.rec))).then(ok => { b.textContent = ok ? 'Copiado ✓' : 'Não consegui copiar'; }); return; }
        return;
    }
    lucPintar();
}

async function removerDaGarantia(id) {
    if (!ehDev() || !id) return;
    const db = getDb(); if (!db) return;
    try {
        await remove(ref(db, `${BASE}/${chavePerfil()}/${id}`));
        if (MAPA && MAPA.data) delete MAPA.data[id];
    } catch (e) { console.warn('[líquido] não removi o registro da garantia:', e.message); }
}

// ── Eventos ─────────────────────────────────────────────────────
const achar = id => F && F.pag.find(l => String(l.id) === String(id));

function voltar() {
    if (TELA === 'entrada') return fechar();
    if (TELA === 'produto' && F.volta) return fechar();
    if (TELA === 'produto' || TELA === 'resultado') return telaConferir();
    if (TELA === 'detalhe') return renderRegistros();
    if (F && F.modo !== 'solto') return fechar();
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
    if (act === 'trocarprod') { F.edIdx = parseInt(b.dataset.i, 10) || 0; return telaProduto(); }
    if (act === 'escprod') {
        const p = (window.products || []).find(x => String(x.id) === String(id)), it = F.itens[F.edIdx]; if (!p || !it) return;
        const lido = (it.prod && it.prod.lido) || it.nome;
        it.prod = { nome: p.nome, id: p.id, valor: parseFloat(p.valor) || 0, manual: false, duvida: false, lido: it.prod && it.prod.lido };
        const ensinou = aprender(lido, p), voltou = F.volta;
        if (voltou) return fechar();
        telaConferir();
        ensinou.then(ok => { if (ok && overlay) toast(`Aprendi: “${lido}” é “${p.nome}”.`); });
        return;
    }
    if (act === 'usarmanual') {
        const it = F.itens[F.edIdx]; if (!it) return;
        const nome = overlay.querySelector('[data-f="mnome"]').value.trim(), v = dinheiro(overlay.querySelector('[data-f="mvalor"]').value);
        if (!(v > 0)) return toast('Informe o valor do produto no CTW.');
        it.prod = { nome: nome || (it.prod && (it.prod.nome || it.prod.lido)) || it.nome || 'Produto', id: null, valor: r2(v), manual: true, duvida: false, lido: it.prod && it.prod.lido };
        return F.volta ? fechar() : telaConferir();
    }
    if (act === 'add') {
        const k = b.dataset.k, o = k === 'cartao' ? { manual: true, parcDuv: true, band: bandPadrao() } : { manual: true };
        F.pag.push(novaLinha(F, k, o)); F.erros = [];
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
        const r = calcular(F);
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
    if (f === 'valor') { l.valor = t.value; atualizarNota(l); atualizarSoma(); }
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

// ── Entradas do módulo ──────────────────────────────────────────
function abrir() {
    if (!ehDev()) return;
    if (!getDb()) { if (window.showCustomModal) window.showCustomModal({ message: 'O banco de dados ainda está conectando. Tente de novo em alguns segundos.' }); return; }
    F = novoEstado('solto');
    abrirOverlay();
    telaEntrada();
}

// Pontos de ligação com o app (app.js e index.html chamam estes nomes)
carregarAliases();                                 // nomes ensinados prontos antes da leitura da IA
window.ctwLiqSalvar = aoSalvarGarantia;
window.ctwGdEmCurso = () => !!(G && G.salvando);
window.ctwGdPreviaCancelada = gdPreviaCancelada;
window.ctwGdVoltar = gdVoltar;
window.ctwGdEditar = editarNaDetalhada;

export { abrir, abrirGarantiaDet, aoSalvarGarantia, decorarHistorico, removerDaGarantia, gdAtivo };
