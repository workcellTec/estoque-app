// ================================================================
// fechamentoia.js — Valor líquido da venda (somente dev)
// A IA só LÊ (texto e/ou imagens): produto, cliente e a lista de pagamentos.
// Quem faz a conta é o app, com as taxas cadastradas em Taxas (window._getRate).
// Três portas de entrada, todas com a mesma conferência e o mesmo cálculo:
//   • solto     — Taxas > Fechar venda > "Fechar venda IA" (texto/imagens → conferir → resultado)
//   • garantia  — botão "Valor líquido" no histórico de recibos (parte da garantia já salva)
//   • rascunho  — "Colar do Zap (IA)" na garantia nova: o líquido vai junto quando a garantia é salva
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
let RASC = null;                                   // rascunho do formulário da garantia nova (Colar do Zap IA)
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
    const eraRasc = F && F === RASC;
    if (eraRasc) F.volta = false;
    F = null; REG = [];
    if (eraRasc) renderCartaoForm();
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

// Acrescentado ao prompt do "Colar do Zap (IA)" da garantia, só para dev
function promptExtra(imgs) {
    const n = (imgs && imgs.comprovantes) || 0;
    const sobreImagens = n ? `\n\n=== IMAGENS ENVIADAS ===
${imgs.produto ? `A imagem 1 é a FOTO DO PRODUTO. As ${n} imagem(ns) seguinte(s)` : `As ${n} imagem(ns) enviada(s) (NÃO há foto do produto)`} ${n > 1 ? 'são COMPROVANTES' : 'é COMPROVANTE'} de pagamento (recibo da maquininha ou comprovante de Pix).
- Nome, cor e IMEI do produto saem só do texto${imgs.produto ? ' e da foto do produto' : ''}: nunca de um comprovante.
- Os comprovantes servem para "pagamentosDetalhe" (valor, parcelas, bandeira, maquininha, e o valorTotal da venda). O mesmo comprovante em mais de uma foto conta uma vez.` : '';
    return `${sobreImagens}\n\n=== INSTRUÇÕES ADICIONAIS (valor líquido da venda) ===
Além de todos os campos acima, acrescente ao JSON a chave "pagamentosDetalhe": uma lista com UM item por pagamento da venda, só LENDO o que está escrito (não calcule taxa nem líquido), neste formato:
[ ${FORMATO_PAG} ]
REGRAS DOS PAGAMENTOS:
${REGRAS_PAG}
REGRA DA TROCA (vale para o valorTotal): se houver troca, o valor da troca TAMBÉM entra no valorTotal. valorTotal = dinheiro/Pix + total do cartão + troca. Exemplo: troca de 500 + 2000 em dinheiro = valorTotal 2500.
Se a mensagem não trouxer pagamentos, "pagamentosDetalhe" deve ser [].
Acrescente também a chave "produtoQtd": quantas unidades do produto foram vendidas (número inteiro). Se não estiver escrito, 1. O valorTotal continua sendo o total da venda inteira, não o preço de uma unidade.`;
}

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
const nomeProdutos = E => { const n = E.itens.map(it => (it.prod && it.prod.nome) || it.nome).filter(Boolean); return (n[0] || 'Produto sem nome') + (n.length > 1 ? ` + ${n.length - 1}` : ''); };

// Itens da garantia/lista do formulário → itens do estado. O produto do CTW vem, nesta ordem, de:
// escolha já feita aqui → registro salvo (traz o custo do dia corrigido) → vínculo gravado no próprio item (ctw) → busca por nome (só no histórico, com "confira")
function sincItens(E, lista, salvos, semBusca) {
    const velhos = E.itens || [];
    E.itens = (lista || []).filter(i => i && !i.isSituation).map(i => {
        const nome = String(i.nome || '').trim(), qtd = Math.max(1, parseInt(i.qtd, 10) || 1), k = norm(nome);
        const ex = velhos.find(v => norm(v.nome) === k);
        const sv = (salvos || []).find(p => norm(p.nome) === k || norm(p.lido) === k);
        let prod;
        if (ex && ex.prod && (ex.prod.id || ex.prod.manual)) prod = ex.prod;
        else if (sv) prod = { nome: sv.nomeCtw || sv.nome, id: sv.id || null, valor: Number(sv.valor) || 0, manual: !!sv.manual, duvida: false, lido: nome, hoje: sv.hoje != null ? Number(sv.hoje) : undefined };
        else if (i.ctw) prod = { nome: i.ctw.nome || nome, id: i.ctw.id || null, valor: Number(i.ctw.valor) || 0, manual: !!i.ctw.manual, duvida: !!i.ctw.duvida, lido: nome };
        else if (ex && ex.prod) prod = ex.prod;
        else prod = semBusca ? { nome, id: null, valor: null, manual: false, duvida: false, lido: nome } : acharProduto(nome);
        return { nome, qtd, valorG: parseFloat(i.valor) || 0, prod };
    });
}

// ── Garantia: estado de partida ─────────────────────────────────
function linhasDeRegistro(E, linhas) {
    return (linhas || []).map(l => {
        if (l.k === 'cartao') return novaLinha(E, 'cartao', { valor: fmtIn(l.valor), parc: l.parcelas, band: l.bandeira || '', maq: l.maq || maqPadrao(), manual: true });
        if (l.k === 'pix') return novaLinha(E, 'pix', { valor: fmtIn(l.valor), boleto: !!l.boleto, manual: true });
        return novaLinha(E, 'troca', { valor: fmtIn(l.valor), aparelho: l.aparelho || '', manual: true });
    });
}

// Sem registro ainda: as formas de pagamento marcadas na garantia viram linhas para completar
function semearPagamentos(E, texto, total) {
    const t = norm(texto), l = [];
    if (/credit/.test(t)) l.push(novaLinha(E, 'cartao', { manual: true, parcDuv: true, band: bandPadrao(), bandDuv: true }));
    if (/debit/.test(t)) l.push(novaLinha(E, 'cartao', { manual: true, parc: 0, band: bandPadrao(), bandDuv: true }));
    if (/dinheiro|pix/.test(t)) l.push(novaLinha(E, 'pix', { manual: true }));
    if (/troca/.test(t)) l.push(novaLinha(E, 'troca', { manual: true }));
    if (l.length === 1 && total > 0) l[0].valor = fmtIn(total);
    return l;
}

function estadoDeGarantia(doc, rec) {
    const E = novoEstado('garantia'), total = totalItens(doc.items);
    E.garantia = { id: doc.id, doc: doc.docNumber || '', total, ts: Date.parse(doc.criadoEm) || 0 };
    E.cliente = doc.nome && doc.nome !== 'Consumidor' ? doc.nome : '';
    sincItens(E, doc.items, rec && rec.produtos);
    E.pag = rec ? linhasDeRegistro(E, rec.linhas) : semearPagamentos(E, doc.pagamento, total);
    return E;
}

// ── Formulário da garantia nova: Resumido / Detalhado (dev) ─────
// Só dev, só garantia/recibo novos. Resumido = o formulário de sempre. Detalhado = três passos num card só, sem digitar valor de produto:
//   1 Produtos: escolhidos do CTW (o custo o sistema já sabe); a IA do Zap preenche este mesmo card e mostra o que leu × o que escolheu;
//   2 Pagamento: pagamentos parciais por botões (Pix/Dinheiro, Boleto, Troca, Débito, Crédito); o total da venda é a soma deles;
//   3 Lucro: o que caiu na conta menos o custo, ao vivo.
// O documento divide o total entre os produtos na proporção do custo (item.ctwSemPreco = "o valor vem do pagamento"). As formas de
// pagamento do documento são marcadas sozinhas e o líquido é gravado ao salvar. Sem detalhar nada, a garantia salva como sempre.
const CHECKS = { pix: 'pagPix', boleto: 'pagBoleto', troca: 'pagTroca', deb: 'pagDebito', cred: 'pagCredito' };
const ROT_DOC = { pix: 'Dinheiro/Pix', boleto: 'Boleto', troca: 'Troca', deb: 'Débito', cred: 'Crédito' };
const tipoForma = l => (l.k === 'cartao' ? (l.parc === 0 ? 'deb' : 'cred') : l.k === 'troca' ? 'troca' : l.boleto ? 'boleto' : 'pix');
const rotForma = l => (l.k === 'cartao' ? (l.parc === 0 ? 'Débito' : l.parc == null ? 'Cartão' : 'Crédito ' + l.parc + 'x') : l.k === 'troca' ? 'Troca' : l.boleto ? 'Boleto' : 'Pix / Dinheiro');
const ctwLista = () => (window.ctwBookipLista ? window.ctwBookipLista() : []);
const totalGar = E => (E.garantia ? E.garantia.total : totalItens(E.lista));
const qtdItem = i => Math.max(1, parseInt(i.qtd, 10) || 1);
const itensForm = E => (E.lista || []).filter(i => i && !i.isSituation);
const prodDe = (E, k) => ((E.itens || [])[k] || {}).prod || null;
// ok = ligado ao CTW · duvida = ligado, mas a IA não teve certeza ("confira") · nao = sem produto (ou sem valor) no CTW
const estadoDe = p => (!p || !(p.valor > 0) ? 'nao' : p.duvida ? 'duvida' : 'ok');
const condDe = nome => (/semi ?novo/i.test(nome) ? 'Seminovo' : /novo|lacrad/i.test(nome) ? 'Novo / Lacrado' : '');
const buscaInicial = nome => semCondicao(nome).replace(/[-–—|]+/g, ' ').replace(/\s+/g, ' ').trim();
const produtoPorId = id => (window.products || []).find(x => String(x.id) === String(id));
const refrescarForm = () => (window.ctwBookipRefrescar ? window.ctwBookipRefrescar() : renderCartaoForm());

// Detalhado: total da venda = soma dos pagamentos. Faltam = itens sem produto (ou sem valor) no CTW.
function totaisDet(E) {
    const l = itensForm(E), faltam = l.filter((i, k) => estadoDe(prodDe(E, k)) === 'nao');
    return { l, faltam, soma: somaPagamentos(E) };
}

// O total da venda é dividido entre os produtos na proporção do custo (qtd × custo). Mexe nos itens da lista do formulário
// (mesmos objetos) e devolve true se algum valor mudou. Sem total, ou com produto ainda sem custo, os valores ficam em 0.
function aplicarPrecos(E) {
    const t = totaisDet(E), l = t.l, ok = l.length > 0 && !t.faltam.length && t.soma > 0;
    const peso = l.map((i, k) => { const p = prodDe(E, k) || {}, c = p.hoje != null ? p.hoje : p.valor; return qtdItem(i) * (c > 0 ? c : 0); });
    const somaPeso = peso.reduce((s, x) => s + x, 0);
    const un = l.map((i, k) => (ok && somaPeso > 0 ? r2(r2(t.soma * peso[k] / somaPeso) / qtdItem(i)) : 0));
    if (ok && somaPeso > 0) {                          // sobra de arredondamento vai para o último item de quantidade 1
        const res = r2(t.soma - l.reduce((s, i, k) => s + un[k] * qtdItem(i), 0)), k1 = l.map(qtdItem).lastIndexOf(1);
        if (Math.abs(res) >= 0.005 && k1 >= 0) un[k1] = r2(un[k1] + res);
    }
    let mudou = false;
    l.forEach((i, k) => {
        i.ctwSemPreco = true;
        if (Math.abs((parseFloat(i.valor) || 0) - un[k]) > 0.0001) { i.valor = un[k]; mudou = true; }
    });
    return mudou;
}
let APLICANDO = false;

function taxaDe(maq, band, parc) {
    if (!window._areRatesLoaded || typeof window._getRate !== 'function') return null;
    let t; try { t = window._getRate(maq, band, parc); } catch (e) { t = undefined; }
    return typeof t === 'number' && isFinite(t) ? t : null;
}

function novoRasc() {
    const E = novoEstado('rascunho');
    E.lista = []; E.det = false; E.snap = null; E.novo = ''; E.busca = ''; E.cond = 'Novo / Lacrado'; E.abre = {}; E.sheet = null; E.aviso = '';
    return E;
}
const garantirRasc = () => RASC || (RASC = novoRasc());

function rascunhoDaIA(dados, lista) {
    const E = RASC = novoRasc();
    E.cliente = String(dados.nome || '').trim();
    E.lista = lista || [];
    sincItens(E, E.lista, null, true);
    E.pag = linhasDeIA(E, dados.pagamentosDetalhe);
    E.det = E.pag.length > 0 && somaPagamentos(E) > 0;   // a IA leu pagamentos com valor: já abre em Detalhado (o valor do produto sai deles)
    renderCartaoForm(E.lista);
}

function limparRascunho() {
    RASC = null;
    fecharSheet(true); tirarHosts(); sincChecks(null, false);
}

function formaVisivel(lista) {
    const tipo = document.querySelector('input[name="tipoInput"]:checked');
    return ehDev() && window.ctwDocModo !== 'orcamento' && !(window.ctwBookipEditando && window.ctwBookipEditando()) && !(lista || []).some(i => i && i.isSituation) && !(tipo && tipo.value === 'situacao');
}

// Em Detalhado o grupo "Forma(s) de Pagamento" some e as caixas são marcadas pelos pagamentos lançados
// (sem nenhum lançado, valem as que já estavam marcadas). Voltando ao Resumido, o que estava marcado antes é devolvido.
function sincChecks(E, ativo) {
    const rot = document.getElementById('bookipPagamentoLabel'), box = rot && rot.parentElement;
    const caixas = Object.values(CHECKS).map(id => document.getElementById(id)).filter(Boolean);
    if (!ativo) {
        if (E && E.snap) { caixas.forEach(c => { c.checked = E.snap.includes(c.id); }); E.snap = null; }
        if (box) box.classList.remove('fia-oculto');
        return;
    }
    if (!E.snap) E.snap = caixas.filter(c => c.checked).map(c => c.id);
    const usadas = new Set(E.pag.map(l => CHECKS[tipoForma(l)]));
    caixas.forEach(c => { c.checked = E.pag.length ? usadas.has(c.id) : E.snap.includes(c.id); });
    if (box) box.classList.add('fia-oculto');
}

function tirarHosts() { ocultarForm(false); ['ctwLiqModo', 'ctwLiqPag'].forEach(id => { const h = document.getElementById(id); if (h) h.remove(); }); }

// Em Detalhado o formulário de produto do app (busca, campos, botão) e a lista com o total saem de cena: o card do Detalhado
// faz esse papel. Os elementos continuam no lugar (só escondidos), então o app e a IA do Zap seguem achando tudo pelo id.
function ocultarForm(on) {
    const tot = document.getElementById('bookipTotalDisplay'), add = document.getElementById('btnAdicionarItemLista');
    [document.getElementById('camposProduto'), add && (add.closest('.col-12') || add.parentElement), document.getElementById('bookipItensLabel'),
        document.getElementById('bookipListaItens'), tot && (tot.closest('.text-end') || tot.parentElement)]
        .forEach(n => { if (n) n.classList.toggle('fia-oculto', !!on); });
}

function hostDe(id, ref, pos) {
    let h = document.getElementById(id);
    if (!h) {
        h = document.createElement('div'); h.id = id; h.className = 'fia-fc'; h.setAttribute('data-dev-only', '');
        ['click', 'input'].forEach(t => h.addEventListener(t, aoFormEvento));
        ref.insertAdjacentElement(pos, h);
    }
    return h;
}

function renderCartaoForm(lista) {
    const l = lista || ctwLista();
    const painel = document.getElementById('camposProduto'), total = document.getElementById('bookipTotalDisplay');
    const topo = painel && (painel.closest('.p-3') || painel.parentElement), fim = total && (total.closest('.text-end') || total.parentElement);
    if (!topo || !fim || !document.getElementById('bookipItensLabel') || !formaVisivel(l)) { tirarHosts(); fecharSheet(true); sincChecks(RASC, false); return; }
    const E = garantirRasc();
    E.lista = l; E.erros = []; sincItens(E, l, null, true);
    if (E.det && !APLICANDO && window.ctwBookipRefrescar && aplicarPrecos(E)) {
        // os valores dos itens mudaram: a lista é redesenhada e chama este render de novo (já com tudo no lugar)
        APLICANDO = true; try { window.ctwBookipRefrescar(); } finally { APLICANDO = false; }
        return;
    }
    ocultarForm(E.det);
    hostDe('ctwLiqModo', topo, 'beforebegin'); hostDe('ctwLiqPag', topo, 'beforeend');
    const pag = document.getElementById('ctwLiqPag'), ativo = document.activeElement;
    if (E.det && topo.lastElementChild !== pag) topo.appendChild(pag);       // o card do Detalhado fica dentro do painel do produto
    const foco = ativo && pag.contains(ativo) && ativo.dataset && ativo.dataset.f ? { f: ativo.dataset.f, i: ativo.dataset.i, a: ativo.selectionStart, b: ativo.selectionEnd } : null;
    document.getElementById('ctwLiqModo').innerHTML = htmlModo(E);
    pag.innerHTML = E.det ? htmlDetalhado(E) : '';
    if (foco) {                                        // o card é redesenhado a cada mudança: o foco e o cursor do campo voltam
        const n = pag.querySelector('[data-f="' + foco.f + '"]' + (foco.i != null ? '[data-i="' + foco.i + '"]' : ''));
        if (n) { n.focus({ preventScroll: true }); try { n.setSelectionRange(foco.a, foco.b); } catch (e) { /* campo sem seleção */ } }
    }
    sincChecks(E, E.det);
}

function htmlModo(E) {
    return `<div class="fia-seg" role="group" aria-label="Modo do pagamento">
        <button type="button" class="${E.det ? '' : 'on'}" data-liq="resumido">Resumido</button>
        <button type="button" class="${E.det ? 'on' : ''}" data-liq="detalhado">Detalhado <span class="fia-dev">Dev</span></button></div>
      <div class="fia-t">${E.det ? 'Escolha os produtos, lance os pagamentos e veja o lucro. Sem digitar valor de produto.' : 'Igual ao de hoje, para venda rápida. Sem cálculo de lucro.'}</div>`;
}

function subLinha(l) {
    const v = dinheiro(l.valor) || 0;
    if (l.k === 'troca') return (l.aparelho || 'aparelho não informado') + ' · conta como dinheiro';
    if (l.k === 'pix') return 'cai o valor cheio';
    if (l.parc == null || (l.maq !== 'pagbank' && !l.band)) return 'toque para completar (parcelas ou bandeira)';
    const t = taxaDe(l.maq, l.band, l.parc);
    return nomeMaq(l.maq) + (l.parc > 0 ? ' · ' + l.parc + 'x' : '') + (t == null ? ' · sem taxa cadastrada' : ' · cai ' + brl(r2(v * (1 - t / 100))));
}

const passo = (n, rot) => `<div class="fia-step"><i>${n}</i>${rot}</div>`;

function htmlDetalhado(E) {
    return htmlItensDet(E) + htmlPagamento(E) + htmlLucro(E);
}

// ── 1 · Produtos ─────────────────────────────────────────────────
function htmlItensDet(E) {
    const q = (E.busca || '').trim(), sug = q ? buscarProdutos(q, 5) : [];
    const res = q ? `<div class="fia-res">${sug.length
        ? sug.map(p => `<button type="button" data-liq="add" data-pid="${esc(p.id)}"><span>${esc(p.nome)}</span><i class="bi bi-plus-lg"></i></button>`).join('')
        : '<div class="fia-t">Nada encontrado no CTW. Tente menos palavras.</div>'}</div>` : '';
    const cond = c => `<button type="button" class="fia-tg${E.cond === c ? ' on' : ''}" data-liq="cond" data-c="${c}">${c}</button>`;
    const cards = itensForm(E).map((item, k) => {
        const p = prodDe(E, k) || {}, est = estadoDe(p), q2 = qtdItem(item), cd = condDe(item.nome);
        const nome = est === 'nao' ? (p.id ? esc(p.nome) + ' · sem valor no CTW' : 'Não achei no CTW') : esc(p.nome) + (cd ? ' · ' + cd : '');
        const escreveu = item.nome && (est === 'nao' || chaveAlias(item.nome) !== chaveAlias(p.nome || '')) ? `<span class="fia-lido">Você escreveu: ${esc(item.nome)}</span>` : '';
        const sub = est === 'nao' ? 'Toque em “Escolher produto”' : 'custo ' + brl(p.valor) + (q2 > 1 ? ' cada' : '') + (p.hoje != null && p.valor !== p.hoje ? ' · corrigido' : '');
        const doc = (parseFloat(item.valor) || 0) > 0 ? `<span class="fia-doc1">no documento ${brl(r2(item.valor * q2))}</span>` : '';
        const acoes = est === 'ok' ? '' : `<div class="fia-ab">${est === 'duvida' ? `<button type="button" class="fia-sim" data-liq="certo" data-i="${k}">Está certo</button>` : ''}
            <button type="button" data-liq="trocar" data-i="${k}">${est === 'nao' ? 'Escolher produto' : 'Trocar'}</button></div>`;
        const aberto = E.abre && E.abre[k];
        return `<div class="fia-it ${est}">
          <div class="fia-ih"><span class="fia-ic">${est === 'ok' ? '✓' : est === 'duvida' ? '?' : '!'}</span>
            <div class="fia-ig"><span class="fia-nm">${nome}</span>${escreveu}<small>${esc(sub)}</small></div>
            <button type="button" class="fia-x" data-liq="tirar" data-i="${k}" aria-label="Remover produto"><i class="bi bi-trash"></i></button></div>
          ${acoes}
          <div class="fia-ib"><div class="fia-qty"><button type="button" data-liq="menos" data-i="${k}" aria-label="Menos">−</button><b>${q2}</b><button type="button" data-liq="mais" data-i="${k}" aria-label="Mais">+</button></div>
            <div class="fia-id">${doc}<button type="button" class="fia-lk2" data-liq="imei" data-i="${k}">+ IMEI / cor</button></div></div>
          ${aberto ? `<div class="fia-iv"><input class="form-control" data-f="obs" data-i="${k}" placeholder="IMEI / Serial" autocomplete="off" value="${esc(item.obs || '')}" aria-label="IMEI ou serial">
            <input class="form-control" data-f="cor" data-i="${k}" placeholder="Cor" autocomplete="off" value="${esc(item.cor || '')}" aria-label="Cor"></div>` : ''}</div>`;
    }).join('');
    return `${passo(1, 'Produtos')}
      <div class="fia-bw"><i class="bi bi-search"></i><input class="form-control" data-f="busca" placeholder="Buscar produto no CTW..." autocomplete="off" value="${esc(E.busca || '')}" aria-label="Buscar produto no CTW"></div>
      ${res}
      <div class="fia-cd"><span class="fia-t">No documento sai:</span>${cond('Novo / Lacrado')}${cond('Seminovo')}</div>
      ${E.aviso ? `<div class="fia-t ok">${esc(E.aviso)}</div>` : ''}
      ${cards ? `<div class="fia-ls">${cards}</div>` : '<div class="fia-t fia-vz0">Toque em um produto da busca para adicionar.</div>'}`;
}

// ── 2 · Pagamento ────────────────────────────────────────────────
function dicaNovo(E) {
    const t = totaisDet(E);
    if (!t.l.length) return { t: 'Escolha os produtos primeiro, lá em cima.', c: '' };
    if (dinheiro(E.novo) > 0) return { t: 'Agora toque em como foi pago.', c: 'ok' };
    return { t: 'Digite quanto o cliente pagou e toque em como foi pago.', c: '' };
}
const novoPronto = E => totaisDet(E).l.length > 0 && dinheiro(E.novo) > 0;

function htmlPagamento(E) {
    const t = totaisDet(E), d = dicaNovo(E), pronto = novoPronto(E);
    const linhas = E.pag.length ? `<div class="fia-ls">${E.pag.map(l => `<div class="fia-li" data-liq="editar" data-id="${l.id}" role="button" tabindex="0">
        <div class="fia-lg"><span>${rotForma(l)}</span><small>${esc(subLinha(l))}</small></div>
        <b>${brl(dinheiro(l.valor) || 0)}</b>
        <button type="button" class="fia-x" data-liq="rem" data-id="${l.id}" aria-label="Remover pagamento"><i class="bi bi-trash"></i></button></div>`).join('')}
        <div class="fia-kv fia-tt"><span>Total da venda</span><b>${brl(t.soma)}</b></div></div>` : '';
    const botoes = [['pix', 'Pix / Dinheiro'], ['boleto', 'Boleto'], ['troca', 'Troca'], ['deb', 'Débito'], ['cred', 'Crédito']]
        .map(b => `<button type="button" class="fia-fb${pronto ? '' : ' off'}" data-liq="forma" data-forma="${b[0]}">${b[1]}</button>`).join('');
    return `${passo(2, 'Pagamento')}${linhas}
      <div><div class="fia-lbl">${E.pag.length ? 'Quanto foi neste outro pagamento?' : 'Quanto o cliente pagou?'}</div>
        <input class="form-control fia-money" inputmode="decimal" placeholder="0,00" autocomplete="off" data-f="novo" value="${esc(E.novo)}" aria-label="Valor deste pagamento">
        <div class="fia-t${d.c ? ' ' + d.c : ''}" id="fiaPgDica">${esc(d.t)}</div></div>
      <div class="fia-fbs">${botoes}</div>`;
}

// Digitando o valor deste pagamento: só atualiza dica e botões (o campo não é redesenhado, senão o teclado fecha)
function atualizarNovo(E) {
    const h = document.getElementById('ctwLiqPag'); if (!h) return;
    const d = dicaNovo(E), el = h.querySelector('#fiaPgDica'), ok = novoPronto(E);
    if (el) { el.textContent = d.t; el.className = 'fia-t' + (d.c ? ' ' + d.c : ''); }
    h.querySelectorAll('.fia-fb').forEach(b => b.classList.toggle('off', !ok));
}

// ── 3 · Lucro (discreto: uma linha) ──────────────────────────────
function htmlLucro(E) {
    const t = totaisDet(E);
    let corpo;
    if (!t.l.length) corpo = '<div class="fia-t">Escolha os produtos para começar.</div>';
    else if (t.faltam.length) corpo = `<div class="fia-t am">Falta escolher no CTW: ${t.faltam.map(i => esc(i.nome)).join(', ')}.</div>`;
    else if (!E.pag.length) corpo = '<div class="fia-t">Lance o primeiro pagamento para ver o lucro.</div>';
    else {
        const calc = calcular(E);
        if (calc.erros.length) corpo = `<div class="fia-t am">${Array.from(new Set(calc.erros.map(x => x.msg))).map(esc).join('<br>')}</div>`;
        else {
            const r = calc.res, cl = r.lucro > 0 ? 'ok' : r.lucro < 0 ? 'neg' : '';
            corpo = `<div class="fia-kv"><span>Caiu na conta</span><b>${brl(r.real)}</b></div>
              <div class="fia-kv"><span>Custo dos produtos</span><b>${brl(r.base)}</b></div>
              <div class="fia-kv fia-lk"><span>${r.lucro < 0 ? 'Prejuízo' : 'Lucro'}</span><b class="${cl}">${sinal(r.lucro)}</b></div>
              <div class="fia-t">Muda a cada pagamento que você lança.</div>`;
        }
    }
    let custos = '';
    if (t.l.length && !t.faltam.length && E.pag.length) {
        custos = `<div class="fia-pn"><div class="fia-t">Algum produto custava menos no dia da venda? Toque no lápis.</div>
          ${E.itens.map((it, i) => {
            const p = it.prod || {}, mudou = p.hoje != null && p.valor !== p.hoje;
            return `<div class="fia-ci"><span class="fia-cn">${esc(p.nome || it.nome)}</span><span class="fia-cv${mudou ? ' am' : ''}">${brl(p.valor)}${it.qtd > 1 ? ' (cada)' : ''}</span>
              <button type="button" class="fia-x" data-liq="custo" data-i="${i}" aria-label="Corrigir custo"><i class="bi bi-pencil-fill"></i></button></div>`;
        }).join('')}</div>`;
    }
    const usadas = Array.from(new Set(E.pag.map(l => ROT_DOC[tipoForma(l)])));
    return `${passo(3, 'Lucro')}<div class="fia-pn fia-rs">${corpo}</div>${custos}
      <div class="fia-t fia-doc">Forma(s) de pagamento no documento: ${usadas.length ? esc(usadas.join(' + ')) : 'marcadas sozinhas conforme você lança o pagamento'}.</div>`;
}

function aoFormEvento(e) {
    const E = RASC; if (!E) return;
    if (e.type === 'input') {
        const f = e.target.dataset && e.target.dataset.f, i = parseInt(e.target.dataset && e.target.dataset.i, 10), item = itensForm(E)[i];
        if (f === 'novo') { E.novo = e.target.value; atualizarNovo(E); }
        else if (f === 'busca') { E.busca = e.target.value; renderCartaoForm(); }
        else if ((f === 'obs' || f === 'cor') && item) item[f] = e.target.value;
        return;
    }
    const d = e.target.closest('[data-liq]'); if (!d) return;
    const a = d.dataset.liq, id = d.dataset.id, k = parseInt(d.dataset.i, 10), item = itensForm(E)[k];
    E.aviso = '';
    if (a === 'resumido' || a === 'detalhado') { E.det = a === 'detalhado'; return renderCartaoForm(); }
    if (a === 'add') return adicionarProduto(E, produtoPorId(d.dataset.pid));
    if (a === 'cond') { E.cond = E.cond === d.dataset.c ? '' : d.dataset.c; return renderCartaoForm(); }
    if (a === 'menos' || a === 'mais') { if (item) { item.qtd = Math.max(1, Math.min(99, qtdItem(item) + (a === 'mais' ? 1 : -1))); refrescarForm(); } return; }
    if (a === 'tirar') { if (item) { ctwLista().splice(ctwLista().indexOf(item), 1); E.abre = {}; refrescarForm(); } return; }
    if (a === 'imei') { E.abre[k] = !E.abre[k]; return renderCartaoForm(); }
    if (a === 'certo') return confirmarProduto(E, k);
    if (a === 'trocar') return item && abrirSheet(E, { tipo: 'produto', i: k, busca: buscaInicial(item.nome) });
    if (a === 'forma') return lancar(E, d.dataset.forma);
    if (a === 'editar') { const l = E.pag.find(x => String(x.id) === String(id)); return l && abrirSheet(E, sheetDeLinha(l)); }
    if (a === 'rem') { E.pag = E.pag.filter(x => String(x.id) !== String(id)); return renderCartaoForm(); }
    if (a === 'custo') return abrirSheet(E, sheetDeCusto(E, k));
}

// Produto escolhido na busca do card: entra na lista do formulário já ligado ao CTW, sem valor (ele sai dos pagamentos)
function adicionarProduto(E, p) {
    if (!p) return;
    const nome = p.nome + (E.cond ? ' - ' + E.cond : ''), igual = itensForm(E).find(i => i.ctw && String(i.ctw.id) === String(p.id) && i.nome === nome);
    if (igual) igual.qtd = Math.min(99, qtdItem(igual) + 1);      // mesmo produto e condição: soma na quantidade
    else ctwLista().push({ nome, qtd: 1, valor: 0, cor: '', obs: '', isSituation: false, ctwSemPreco: true,
        ctw: { id: p.id, nome: p.nome, valor: parseFloat(p.valor) || 0, manual: false, duvida: false } });
    E.busca = '';
    refrescarForm();
}

// "Está certo": a ligação deixa de ser dúvida e o app guarda o nome para as próximas leituras
function confirmarProduto(E, k) {
    const item = itensForm(E)[k], p = prodDe(E, k); if (!item || !p) return;
    p.duvida = false; if (item.ctw) item.ctw.duvida = false;
    aprender(item.nome, { id: p.id, nome: p.nome });
    E.aviso = 'Guardei: da próxima vez que vier “' + item.nome + '”, já sei que é ' + p.nome + '.';
    renderCartaoForm();
}

// Produto escolhido na gaveta ("Trocar" / "Escolher produto")
function escolherProduto(E, k, p) {
    const item = itensForm(E)[k]; if (!item || !p) return;
    const valor = parseFloat(p.valor) || 0;
    item.ctw = { id: p.id, nome: p.nome, valor, manual: false, duvida: false };
    if (E.itens[k]) E.itens[k].prod = { nome: p.nome, id: p.id, valor, manual: false, duvida: false, lido: item.nome };
    aprender(item.nome, { id: p.id, nome: p.nome });
    E.aviso = 'Guardei: da próxima vez que vier “' + item.nome + '”, já sei que é ' + p.nome + '.';
}

function lancar(E, forma) {
    const ve = dinheiro(E.novo) || 0; if (!novoPronto(E)) return;
    if (forma === 'pix' || forma === 'boleto') {
        E.pag.push(novaLinha(E, 'pix', { valor: fmtIn(ve), manual: true, boleto: forma === 'boleto' }));
        E.novo = '';
        return renderCartaoForm();
    }
    if (forma === 'troca') return abrirSheet(E, { tipo: 'troca', valor: ve, aparelho: '', vtxt: '' });
    abrirSheet(E, { tipo: 'cartao', forma, valor: ve, maq: maqPadrao(), band: bandPadrao(), bandTocada: false, parc: forma === 'deb' ? 0 : null, vtxt: '' });
}

// ── Gavetas (mesmo estilo das outras do app) ────────────────────
const sheetDeLinha = l => {
    if (l.k === 'cartao') {
        const deb = l.parc === 0;
        return { tipo: 'cartao', forma: deb ? 'deb' : 'cred', editId: l.id, vtxt: l.valor, maq: l.maq, band: l.band || bandPadrao(), bandTocada: !l.bandDuv && !!l.band, parc: l.parc };
    }
    if (l.k === 'troca') return { tipo: 'troca', editId: l.id, vtxt: l.valor, aparelho: l.aparelho };
    return { tipo: 'pix', editId: l.id, vtxt: l.valor, boleto: !!l.boleto };
};

function sheetDeCusto(E, i) {
    const p = (E.itens[i] && E.itens[i].prod) || {};
    return { tipo: 'custo', i, txt: p.hoje != null && p.valor !== p.hoje || (p.manual && !p.id) ? fmtIn(p.valor) : '' };
}

const chip = (c, v, rot, on) => `<button type="button" class="fia-chip${on ? ' on' : ''}" data-sh="chip" data-c="${c}" data-v="${esc(v)}">${esc(rot)}</button>`;
const campoValorSheet = sh => `<div class="fia-shl">Valor (R$)</div><input class="form-control fia-money" inputmode="decimal" placeholder="0,00" autocomplete="off" data-f="sh-valor" value="${esc(sh.vtxt)}" aria-label="Valor">`;

function infoSheet(E) {
    const sh = E.sheet;
    if (sh.tipo === 'produto') return { t: '', ok: false, rot: '' };
    if (sh.tipo === 'custo') {
        const ok = !sh.txt.trim() || dinheiro(sh.txt) > 0;
        return { t: ok ? '' : 'Informe um valor maior que zero.', ok, rot: 'Salvar' };
    }
    const v = r2(sh.editId ? dinheiro(sh.vtxt) || 0 : sh.valor);
    if (sh.tipo !== 'cartao') return { t: '', ok: v > 0, rot: sh.editId ? 'Salvar' : sh.tipo === 'troca' ? 'Lançar troca' : 'Lançar' };
    const deb = sh.forma === 'deb', ehPag = sh.maq === 'pagbank';
    const rot = sh.editId ? 'Salvar' : deb ? 'Lançar débito' : 'Lançar crédito' + (sh.parc ? ' ' + sh.parc + 'x' : '');
    if (!(v > 0)) return { t: 'Informe o valor.', ok: false, rot };
    if (!deb && sh.parc == null) return { t: '', ok: false, rot: 'Escolha as vezes' };
    if (!ehPag && !sh.band) return { t: '', ok: false, rot: 'Escolha a bandeira' };
    if (!window._areRatesLoaded) return { t: 'As taxas ainda estão carregando.', ok: false, rot };
    const t = taxaDe(sh.maq, sh.band, deb ? 0 : sh.parc);
    if (t == null) return { t: `Não há taxa cadastrada para ${nomeMaq(sh.maq)}${ehPag ? '' : ' ' + nomeBand(sh.band)} ${rotParc(deb ? 0 : sh.parc)}. Cadastre em Taxas ou mude a escolha.`, ok: false, rot, am: true };
    return { t: `Vai cair ${brl(r2(v * (1 - t / 100)))} na conta (taxa ${fmtTaxa(t)}).`, ok: true, rot };
}

function htmlResSheet(sh) {
    const r = sh.busca && sh.busca.trim() ? buscarProdutos(sh.busca, 6) : [];
    return r.length ? r.map(p => `<button type="button" data-sh="pick" data-pid="${esc(p.id)}"><span>${esc(p.nome)}</span><small>custo ${brl(parseFloat(p.valor) || 0)}</small></button>`).join('')
        : '<div class="fia-t">Nada encontrado. Tente menos palavras (ex.: só o modelo).</div>';
}

function htmlSheet(E) {
    const sh = E.sheet, grab = '<div class="ui-grab"></div>';
    if (sh.tipo === 'produto') {
        const it = itensForm(E)[sh.i];
        return `${grab}<div class="ui-sheet-title">Qual é o produto?</div>
          ${it && it.nome ? `<div class="fia-t">Você escreveu: <span class="fia-lido">${esc(it.nome)}</span></div>` : ''}
          <input class="form-control" data-f="sh-busca" placeholder="Buscar no CTW..." autocomplete="off" value="${esc(sh.busca)}" aria-label="Buscar no CTW">
          <div class="fia-res" id="fiaShRes">${htmlResSheet(sh)}</div>
          <div class="fia-t">Ao escolher, o app guarda: da próxima vez que vier esse nome, já sabe qual é.</div>`;
    }
    const ok = '<button type="button" class="btn btn-primary w-100 fia-ok" data-sh="ok" id="fiaShOk"></button>';
    if (sh.tipo === 'cartao') {
        const deb = sh.forma === 'deb', ehPag = sh.maq === 'pagbank', max = MAX_PARC[sh.maq] || 18;
        let vezes = '';
        for (let n = 1; n <= max; n++) vezes += chip('parc', n, n + 'x', sh.parc === n);
        return `${grab}<div class="ui-sheet-title">${deb ? 'Débito' : 'Crédito'}${sh.editId ? '' : ' · ' + brl(sh.valor)}</div>
          ${sh.editId ? campoValorSheet(sh) : ''}
          <div class="fia-shl">Maquininha</div><div class="fia-chips">${maqsAtivas().map(m => chip('maq', m[0], m[1], sh.maq === m[0])).join('')}</div>
          ${ehPag ? '' : `<div class="fia-shl">Bandeira</div><div class="fia-chips">${BANDEIRAS.map(b => chip('band', b[0], b[1], sh.band === b[0])).join('')}</div>`}
          ${deb ? '' : `<div class="fia-shl">Em quantas vezes?</div><div class="fia-chips fia-vz">${vezes}</div>`}
          <div class="fia-t" id="fiaShInfo"></div>${ok}`;
    }
    if (sh.tipo === 'troca') {
        return `${grab}<div class="ui-sheet-title">Troca${sh.editId ? '' : ' · ' + brl(sh.valor)}</div>
          ${sh.editId ? campoValorSheet(sh) : ''}
          <div class="fia-shl">Qual aparelho o cliente deu?</div>
          <input class="form-control" placeholder="Ex.: Samsung A15" autocomplete="off" data-f="sh-aparelho" value="${esc(sh.aparelho)}" aria-label="Aparelho da troca">
          <div class="fia-t">A troca conta como dinheiro, pelo valor combinado.</div>${ok}`;
    }
    if (sh.tipo === 'pix') {
        return `${grab}<div class="ui-sheet-title">${sh.boleto ? 'Boleto' : 'Pix / Dinheiro'}</div>${campoValorSheet(sh)}
          <div class="fia-chips">${chip('tipo', 'pix', 'Pix / Dinheiro', !sh.boleto)}${chip('tipo', 'boleto', 'Boleto', sh.boleto)}</div>${ok}`;
    }
    const it = E.itens[sh.i] || { nome: '', prod: {} }, p = it.prod || {}, hoje = p.hoje != null ? p.hoje : p.valor;
    return `${grab}<div class="ui-sheet-title">${esc(p.nome || it.nome)}</div>
      <div class="fia-t">${p.id ? `No CTW hoje custa <b>${brl(hoje)}</b>. Se no dia da venda custava menos, escreva quanto era.` : 'Valor deste produto no CTW. Corrija se for outro.'}</div>
      <input class="form-control fia-money" inputmode="decimal" placeholder="${esc(fmtIn(hoje))}" autocomplete="off" data-f="sh-custo" value="${esc(sh.txt)}" aria-label="Custo no dia da venda">
      <div class="fia-t am" id="fiaShInfo"></div>
      <div class="fia-2"><button type="button" class="btn btn-outline-secondary" data-sh="hoje">Usar o de hoje</button>${ok}</div>`;
}

function pintarSheet(E) {
    const w = document.getElementById('ctwLiqSheet'), s = w && w.querySelector('.ui-sheet');
    if (!s || !E.sheet) return;
    s.innerHTML = htmlSheet(E);
    atualizarSheet(E);
}

// Digitar no campo da gaveta só atualiza a informação e o botão (sem redesenhar, para o teclado não fechar)
function atualizarSheet(E) {
    const w = document.getElementById('ctwLiqSheet'); if (!w || !E.sheet || E.sheet.tipo === 'produto') return;
    const i = infoSheet(E), inf = w.querySelector('#fiaShInfo'), b = w.querySelector('#fiaShOk');
    if (inf) { inf.textContent = i.t; inf.className = 'fia-t' + (i.am ? ' am' : ''); }
    if (b) { b.textContent = i.rot; b.disabled = !i.ok; }
}

function abrirSheet(E, sh) {
    fecharSheet(true);
    E.sheet = sh;
    const w = document.createElement('div');
    w.id = 'ctwLiqSheet'; w.className = 'ui-sheet-wrap'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true');
    w.innerHTML = '<button type="button" class="ui-dim" data-sh="fechar" aria-label="Fechar"></button><div class="ui-sheet fia-sh"></div>';
    ['click', 'input'].forEach(t => w.addEventListener(t, aoSheetEvento));
    document.body.appendChild(w);
    pintarSheet(E);
    void w.offsetHeight;
    w.classList.add('ui-open');
}

function fecharSheet(sem) {
    const w = document.getElementById('ctwLiqSheet'); if (!w) return;
    if (RASC) RASC.sheet = null;
    w.id = '';
    if (sem) { w.remove(); return; }
    w.classList.remove('ui-open');
    setTimeout(() => w.remove(), 280);
}

function aoSheetEvento(e) {
    const E = RASC, sh = E && E.sheet; if (!sh) return;
    if (e.type === 'input') {
        const f = e.target.dataset && e.target.dataset.f; if (!f) return;
        if (f === 'sh-busca') { sh.busca = e.target.value; const r = document.getElementById('fiaShRes'); if (r) r.innerHTML = htmlResSheet(sh); return; }
        if (f === 'sh-valor') sh.vtxt = e.target.value;
        else if (f === 'sh-aparelho') sh.aparelho = e.target.value;
        else if (f === 'sh-custo') sh.txt = e.target.value;
        return atualizarSheet(E);
    }
    const b = e.target.closest('[data-sh]'); if (!b) return;
    const a = b.dataset.sh;
    if (a === 'fechar') return fecharSheet();
    if (a === 'pick') { escolherProduto(E, sh.i, produtoPorId(b.dataset.pid)); fecharSheet(); return renderCartaoForm(); }
    if (a === 'chip') {
        const c = b.dataset.c, v = b.dataset.v;
        if (c === 'maq') { sh.maq = v; if (sh.parc > (MAX_PARC[v] || 18)) sh.parc = null; }
        else if (c === 'band') { sh.band = v; sh.bandTocada = true; }
        else if (c === 'parc') sh.parc = parseInt(v, 10);
        else if (c === 'tipo') sh.boleto = v === 'boleto';
        return pintarSheet(E);
    }
    if (a === 'hoje') { sh.txt = ''; return confirmarSheet(E); }
    if (a === 'ok') return confirmarSheet(E);
}

function confirmarSheet(E) {
    const sh = E.sheet, i = infoSheet(E); if (!sh || !i.ok) return;
    if (sh.tipo === 'custo') {
        const p = E.itens[sh.i] && E.itens[sh.i].prod;
        if (p) {
            const hoje = p.hoje != null ? p.hoje : p.valor, v = dinheiro(sh.txt);
            if (!sh.txt.trim() || r2(v) === r2(hoje)) { p.valor = hoje; delete p.hoje; if (p.id) p.manual = false; }
            else { p.hoje = hoje; p.valor = r2(v); p.manual = true; p.duvida = false; }
        }
        fecharSheet(); return renderCartaoForm();
    }
    const v = r2(sh.editId ? dinheiro(sh.vtxt) : sh.valor), alvo = sh.editId ? E.pag.find(x => String(x.id) === String(sh.editId)) : null;
    let o;
    if (sh.tipo === 'cartao') {
        const deb = sh.forma === 'deb', ehPag = sh.maq === 'pagbank';
        o = { k: 'cartao', valor: fmtIn(v), parc: deb ? 0 : sh.parc, band: ehPag ? '' : sh.band, maq: sh.maq, bandDuv: !ehPag && !sh.bandTocada, parcDuv: false, manual: true };
    } else if (sh.tipo === 'troca') o = { k: 'troca', valor: fmtIn(v), aparelho: sh.aparelho.trim(), manual: true };
    else o = { k: 'pix', valor: fmtIn(v), boleto: !!sh.boleto, manual: true };
    if (alvo) Object.assign(alvo, o); else E.pag.push(novaLinha(E, o.k, o));
    E.novo = ''; E.aviso = '';
    fecharSheet(); renderCartaoForm();
}

// Chamado depois que a garantia é salva: grava o líquido ligado a ela (se o pagamento foi detalhado)
async function aoSalvarGarantia(dados) {
    if (!RASC || !ehDev() || !dados || !dados.id) return;
    const E = RASC;
    // Produto escolhido na busca da garantia com nome diferente do digitado: ensina (o que a IA ligou sozinha não conta)
    (dados.items || []).forEach(i => { if (i && i.ctw && i.ctw.id && !i.ctw.auto && !i.ctw.duvida) aprender(i.nome, i.ctw); });
    limparRascunho();                                  // a garantia já existe: o rascunho cumpriu o papel
    if (!E.det || !E.pag.length) return;               // Resumido ou nada lançado: nada a gravar (dá para informar depois, pelo histórico)
    sincItens(E, dados.items, null, true);
    const r = calcular(E);
    if (r.erros.length) {
        if (window.showCustomModal) window.showCustomModal({ message: 'Garantia salva. O valor líquido NÃO foi salvo: ' + r.erros[0].msg + ' Abra o histórico, expanda o card e toque em “Dev · Valor líquido” para completar.' });
        return;
    }
    const total = totalItens(dados.items), soma = somaPagamentos(E);
    r.res.garantia = { id: dados.id, doc: dados.docNumber || '', total };
    r.res.soma = soma; r.res.totalGarantia = total;
    r.res.cliente = r.res.cliente || String(dados.nome || '').trim();
    await garantirMapa();
    await gravarRegistro(r.res, dados.id, Date.parse(dados.criadoEm) || Date.now());
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
    if (!doc || !ehDocValido(doc)) { s.innerHTML = ''; return; }
    const rec = MAPA && MAPA.data[doc.id], aberto = s.dataset.aberto === '1';
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
            else if (a === 'abrir') abrirDaGarantia(doc);
            else if (a === 'copiar' && rec) copiar(resumoTexto(paraResultado(rec))).then(ok => { b.textContent = ok ? 'Copiado ✓' : 'Não consegui copiar'; });
        });
    }
    await garantirMapa();
    pintarHistorico();
}

async function abrirDaGarantia(doc) {
    if (!ehDev() || !ehDocValido(doc)) return;
    if (!getDb()) { if (window.showCustomModal) window.showCustomModal({ message: 'O banco de dados ainda está conectando. Tente de novo em alguns segundos.' }); return; }
    await garantirMapa(true);
    F = estadoDeGarantia(doc, MAPA && MAPA.data && MAPA.data[doc.id]);
    abrirOverlay();
    telaConferir();
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

// Pontos de ligação para o formulário da garantia (app.js chama estes nomes)
carregarAliases();                                 // nomes ensinados prontos antes da leitura da IA
window.ctwLiqRender = renderCartaoForm;
document.addEventListener('change', e => { if (e.target && e.target.name === 'tipoInput') renderCartaoForm(); });   // produto ↔ situação: o card some/volta
window.ctwLiqLimpar = limparRascunho;
window.ctwLiqSalvar = aoSalvarGarantia;
// Vínculo com o produto do CTW para itens que a IA preenche (o produto não foi escolhido na busca)
// Detalhado ativo no formulário novo: o preço unitário do item é opcional (o total pago divide entre os itens)
// Itens do CTW ainda sem valor (Detalhado sem total informado): a garantia não pode ser salva assim. Devolve a mensagem ou ''.
// Antes de salvar: no Detalhado todo produto precisa estar ligado ao CTW e ter pagamento lançado (sem isso o valor do documento não existe)
window.ctwLiqValidar = lista => {
    const E = RASC;
    if (E && E.det && ehDev() && formaVisivel(lista)) {
        sincItens(E, lista || [], null, true);
        const t = totaisDet(E);
        if (t.faltam.length) return 'Falta escolher no CTW: ' + t.faltam.map(i => i.nome).join(', ') + '. Toque em “Escolher produto” (ou volte ao Resumido).';
        if (!(t.soma > 0)) return 'Lance pelo menos um pagamento no Detalhado (ou volte ao Resumido).';
    }
    return (lista || []).some(i => i && i.ctwSemPreco && !(parseFloat(i.valor) > 0)) ? 'Há produto sem valor no documento. Lance o pagamento ou volte ao Resumido.' : '';
};
window.ctwLiqAcharProduto = nome => { const p = acharProduto(String(nome || '').trim()); return p && p.id ? { id: p.id, nome: p.nome, valor: p.valor, duvida: !!p.duvida, auto: true } : null; };

export { abrir, abrirDaGarantia, rascunhoDaIA, promptExtra, aoSalvarGarantia, decorarHistorico, removerDaGarantia, renderCartaoForm, limparRascunho };
