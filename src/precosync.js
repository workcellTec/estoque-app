// ================================================================
// precosync.js — Sincronizar preços: catálogo do Stock 2.0 (PDF) → CTW
// Atualiza SOMENTE o campo "valor" de products/{id}. Nada mais é tocado.
// Casamento: nome idêntico (normalizado) → vínculo já aprendido → pergunta ao admin.
// Firebase: settings/precosync/{aliases, ignoradosPdf, ignoradosCtw, log}
// ================================================================

import { ref, get, update, push, query, orderByKey, limitToLast }
    from "https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js";

const PDFJS_URL    = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
// As regras do Firebase só liberam caminhos conhecidos; "settings" já é liberado e usado por outros recursos.
const BASE = 'settings/precosync';
const DIAS_EM_FALTA = 15;          // produto "em falta" some da revisão por esse tempo; depois volta a aparecer
const MAX_LOGS = 10;               // o nó "settings" é baixado a cada abertura do app: mantém só os últimos registros
const LIMITE_SUSPEITO = 0.30;      // variação acima disso exige confirmação explícita
const LIMIAR_PERGUNTA = 0.5;       // semelhança mínima de nome para perguntar ao admin
const LIMIAR_VINCULO  = 0.25;      // idem, na revisão manual de produtos do CTW

// ── Normalização de nomes ───────────────────────────────────────
const COR = new Set(['PRETO', 'PRETA', 'BRANCO', 'BRANCA', 'AZUL', 'LARANJA', 'ROSA', 'VERDE', 'CINZA', 'DOURADO',
    'DOURADA', 'PRATA', 'VERMELHO', 'VERMELHA', 'AMARELO', 'ROXO', 'LILAS', 'GRAFITE', 'TITANIO', 'NATURAL', 'E']);
const RUIDO = new Set(['DE', 'DO', 'DA', 'COM', 'GB', 'RAM', 'SSD', 'CELULAR', 'SMARTPHONE', 'APARELHO', 'GALAXY',
    'SAMSUNG', 'XIAOMI', 'MOTOROLA', 'MOTO', 'APPLE', 'REALME', 'OPPO', 'HONOR', 'TERRA']);
const NAO_SINCRONIZAR = /N[AÃ]O\s*VENDER|TIRAR\s*PE[CÇ]AS|\bB\.?\s?O\.?\s+DE\s+PLACA/i;

function semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
const norm = x => semAcento(x).toUpperCase().replace(/\s+/g, " ").trim();

// Quebra o nome em: núcleo (modelo), armazenamento, RAM e estado (novo/seminovo).
function analisar(nomeBruto) {
    let s = semAcento(nomeBruto).toUpperCase();
    s = s.replace(/\bI\s+PHONE\b/g, 'IPHONE').replace(/\bPROMAX\b/g, 'PRO MAX').replace(/\+/g, ' PLUS ');
    s = s.replace(/\b1\s*TERRA(\s*GB)?\b/g, ' 1TB ');
    let cond = '';
    if (/\bSEMI[\s-]?NOVO\b|\bSEMI\b/.test(s)) cond = 'SEMINOVO';
    else if (/\bNOVO\b/.test(s)) cond = 'NOVO';
    s = s.replace(/\bSEMI[\s-]?NOVO\b|\bSEMI\b|\bNOVO\b/g, ' ');
    s = s.replace(/[^A-Z0-9/%. ]/g, ' ').replace(/\s+/g, ' ');
    let st = 0, ram = 0, m;
    if ((m = s.match(/\b(\d{1,4})\s*(?:GB)?\s*\/\s*(\d{1,4})\s*(?:GB)?\b/))) {
        st = Math.max(+m[1], +m[2]); ram = Math.min(+m[1], +m[2]);
        s = s.replace(m[0], ' ');
    }
    if ((m = s.match(/\b(\d{1,2})\s*GB\s+RAM\b/))) { ram = +m[1]; s = s.replace(m[0], ' '); }
    if ((m = s.match(/\b(\d{1,2})\s*TB\b/))) { st = +m[1] * 1024; s = s.replace(m[0], ' '); }
    if (!st && (m = s.match(/\b(\d{2,4})\s*GB\b/))) { st = +m[1]; s = s.replace(m[0], ' '); }
    if (!st && (m = s.match(/\bDE\s+(64|128|256|512|1024)\b/))) { st = +m[1]; s = s.replace(m[0], ' '); }
    if (!st && (m = s.match(/\b(64|128|256|512|1024)\b/))) { st = +m[1]; s = s.replace(m[0], ' '); }
    if (!ram && (m = s.match(/\b(\d{1,2})\s*GB\b/))) { ram = +m[1]; s = s.replace(m[0], ' '); }   // "128GB 4GB": o que sobrar é RAM
    const nucleo = s.split(' ').filter(t => t && !RUIDO.has(t) && !COR.has(t)).map(t => t.replace(/\.$/, ''));
    const key = nucleo.slice().sort().join(' ') + '|S' + st + '|R' + ram + '|' + cond;
    return { nucleo, st, ram, cond, key };
}

function parcial(a, b) {
    if (a === b) return 1;
    const da = a.replace(/^[A-Z]+(?=\d)/, ''), db = b.replace(/^[A-Z]+(?=\d)/, '');
    return (da && da === db && /\d/.test(da)) ? 0.7 : 0;
}

function similaridade(A, B) {
    if (!A.length || !B.length) return 0;
    const usados = new Set();
    let soma = 0, forte = false;
    for (const a of A) {
        let melhor = 0, idx = -1;
        B.forEach((b, i) => { if (usados.has(i)) return; const v = parcial(a, b); if (v > melhor) { melhor = v; idx = i; } });
        if (idx >= 0) {
            usados.add(idx); soma += melhor;
            if (!(/^\d+$/.test(a) && /^\d+$/.test(B[idx]))) forte = true;   // só o número em comum ("15") não basta
        }
    }
    return forte ? 2 * soma / (A.length + B.length) : 0;
}

// Diferenças que mudam o produto (256 GB ≠ 512 GB, novo ≠ seminovo…)
function diferencas(a, b) {
    const d = [];
    if (a.st && b.st && a.st !== b.st) d.push({ forte: true, t: `armazenamento ${a.st} ≠ ${b.st}` });
    else if (!!a.st !== !!b.st) d.push({ forte: false, t: 'armazenamento só em um dos lados' });
    if (a.ram && b.ram && a.ram !== b.ram) d.push({ forte: true, t: `RAM ${a.ram} ≠ ${b.ram}` });
    if (a.cond && b.cond && a.cond !== b.cond) d.push({ forte: true, t: `${a.cond.toLowerCase()} ≠ ${b.cond.toLowerCase()}` });
    else if (!!a.cond !== !!b.cond) d.push({ forte: false, t: 'estado (novo/seminovo) só em um dos lados' });
    return d;
}

const assinatura = a => `${a.st}|${a.ram}|${a.cond}`;
const chaveFb = txt => String(txt).replace(/[^A-Z0-9]+/g, '_').slice(0, 140);
const chaveNome = a => 'n' + chaveFb(a.key);
const chaveCodigo = c => 'c' + chaveFb(c);

// ── Utilidades ──────────────────────────────────────────────────
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = n => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const igual = (a, b) => Math.abs(a - b) < 0.005;

function valorCtw(p) {
    if (typeof p.valor === 'number') return p.valor;
    let t = String(p.valor == null ? '' : p.valor).replace(/R\$|\s/g, '');
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(t);
    return isFinite(n) ? n : 0;
}

function getDb() { return window._firebaseDB || null; }

function carregarScript(url) {
    return new Promise((ok, erro) => {
        if (document.querySelector(`script[src="${url}"]`) && window.pdfjsLib) return ok();
        const s = document.createElement('script');
        s.src = url; s.onload = () => ok(); s.onerror = () => erro(new Error('Sem internet para carregar o leitor de PDF.'));
        document.head.appendChild(s);
    });
}

// ── Leitura do PDF do Stock 2.0 ─────────────────────────────────
const RE_PRECO = /R\$\s*([\d.]+,\d{2})/;

async function lerPdf(arquivo) {
    await carregarScript(PDFJS_URL);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const pdf = await window.pdfjsLib.getDocument({ data: await arquivo.arrayBuffer() }).promise;
    const linhas = [], avisos = [];
    let xCod = null;                       // o cabeçalho só aparece na 1ª página: as outras herdam a posição das colunas
    for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        // o PDF costuma quebrar letras acentuadas em pedaços ("REL" + "Ó" + "GIO"): une os que se encostam
        const brutos = (await page.getTextContent()).items
            .map(i => ({ t: String(i.str), x: i.transform[4], y: i.transform[5], w: i.width || 0 }))
            .filter(i => i.t.trim())                         // espaçadores do layout (largos) atrapalham a junção
            .sort((a, b) => b.y - a.y || a.x - b.x);
        const itens = [];
        for (const it of brutos) {
            const ult = itens[itens.length - 1];
            if (ult && Math.abs(ult.y - it.y) <= 2.5 && it.x - ult.fim < 1.2 && it.x - ult.fim > -1.5) { ult.t += it.t; ult.fim = it.x + it.w; }
            else itens.push({ t: it.t, x: it.x, y: it.y, fim: it.x + it.w });
        }
        itens.forEach(i => { i.t = i.t.trim(); });
        itens.splice(0, itens.length, ...itens.filter(i => i.t));
        // agrupa por linha (mesmo y)
        itens.sort((a, b) => b.y - a.y || a.x - b.x);
        const rows = [];
        for (const it of itens) {
            const r = rows.find(r => Math.abs(r.y - it.y) <= 2.5);
            if (r) r.itens.push(it); else rows.push({ y: it.y, itens: [it] });
        }
        rows.forEach(r => r.itens.sort((a, b) => a.x - b.x));
        const cab = rows.find(r => r.itens.some(i => semAcento(i.t).toUpperCase() === 'CODIGO') && r.itens.some(i => /^PRODUTO$/i.test(i.t)));
        if (cab) xCod = cab.itens.find(i => semAcento(i.t).toUpperCase() === 'CODIGO').x;
        if (xCod === null) { if (rows.some(r => RE_PRECO.test(r.itens.map(i => i.t).join(' ')))) avisos.push(`Página ${p}: cabeçalho da tabela não reconhecido.`); continue; }
        for (const r of rows) {
            if (cab && r.y >= cab.y - 1) continue;                // acima/na linha do cabeçalho
            const texto = r.itens.map(i => i.t).join(' ');
            const nome = r.itens.filter(i => i.x < xCod - 5).map(i => i.t).join(' ').replace(/\s+/g, ' ').trim();
            const pm = texto.match(RE_PRECO);
            if (!pm) { if (nome) avisos.push(`Linha sem valor ignorada: “${nome}”`); continue; }
            const cod = r.itens.find(i => i.x >= xCod - 5 && /^\d{1,9}$/.test(i.t));
            const valor = parseFloat(pm[1].replace(/\./g, '').replace(',', '.'));
            if (!nome) { avisos.push('Linha com valor mas sem nome ignorada: ' + pm[0]); continue; }
            linhas.push({ nome, codigo: cod ? cod.t : '', valor });
        }
    }
    return { linhas, avisos };
}

// ── Estado e acesso ao banco ────────────────────────────────────
let S = null;           // estado da importação em andamento
let APR = { aliases: {}, ignoradosPdf: {}, ignoradosCtw: {}, catAliases: {}, catIgnorados: {}, catalogo: null, esg: {}, contas: {}, contasZip: {}, naoWhats: {} };

// Contas de WhatsApp: cada uma tem catálogo, esgotados e lista de pendências próprios. "loja" é a original (caminhos antigos).
// Vínculos de nomes são compartilhados. O PDF do Stock 2.0 alimenta todas as contas de uma vez.
let CONTA = (() => { try { return localStorage.getItem('ctwPsConta') || 'loja'; } catch (e) { return 'loja'; } })();
const raiz = (id = CONTA) => id === 'loja' ? BASE : `${BASE}/contas/${id}`;
function usarConta(id) {
    if (!APR.contas[id]) id = 'loja';
    CONTA = id; try { localStorage.setItem('ctwPsConta', id); } catch (e) {}
    APR.catalogo = APR.contas[id].catalogo; APR.esg = APR.contas[id].esg;
}
async function criarConta(nome) {
    nome = String(nome || '').trim().slice(0, 30); if (!nome) return;
    let id = semAcento(nome).toLowerCase().replace(/[^a-z0-9]+/g, '') || 'conta', k = id, n = 1;
    while (APR.contas[id]) id = k + (++n);
    await update(ref(getDb()), { [`${BASE}/contasNomes/${id}`]: nome });
    APR.contas[id] = { nome, catalogo: null, esg: {}, zap: {}, fixos: {} };
    usarConta(id);
}
async function renomearConta(id, nome) {
    nome = String(nome || '').trim().slice(0, 30); if (!nome || !APR.contas[id]) return;
    await update(ref(getDb()), { [id === 'loja' ? `${BASE}/lojaNome` : `${BASE}/contasNomes/${id}`]: nome });   // a conta original guarda o nome à parte (os caminhos dela são os antigos)
    APR.contas[id].nome = nome;
}
async function excluirConta(id) {
    if (id === 'loja' || !APR.contas[id]) return;
    const upd = { [`${BASE}/contasNomes/${id}`]: null, [`${BASE}/contas/${id}`]: null };
    Object.entries(APR.contasZip).forEach(([k, cid]) => { if (cid === id) upd[`${BASE}/contasZip/${k}`] = null; });
    await update(ref(getDb()), upd);
    delete APR.contas[id];
    if (CONTA === id) usarConta('loja');
}

async function carregarAprendizado() {
    const snap = await get(ref(getDb(), BASE));
    const v = snap.val() || {};
    APR = { aliases: v.aliases || {}, ignoradosPdf: v.ignoradosPdf || {}, ignoradosCtw: v.ignoradosCtw || {}, catAliases: v.catAliases || {}, catIgnorados: v.catIgnorados || {}, catalogo: v.catalogo || null, esg: v.esg || {}, contas: {}, contasZip: v.contasZip || {}, naoWhats: v.naoWhats || {} };
    APR.contas.loja = { nome: v.lojaNome || 'Loja', catalogo: v.catalogo || null, esg: v.esg || {}, zap: v.zap || {}, fixos: v.fixos || {} };
    Object.entries(v.contasNomes || {}).forEach(([id, nome]) => { if (id === 'loja') return; const d = (v.contas || {})[id] || {}; APR.contas[id] = { nome, catalogo: d.catalogo || null, esg: d.esg || {}, zap: d.zap || {}, fixos: d.fixos || {} }; });
    usarConta(CONTA);
}

function usuario() { try { return localStorage.getItem('ctwUserProfile') || ''; } catch (e) { return ''; } }

// ── Apoio: idade do catálogo, pendências por conta, aviso "Desfazer", navegação ──
const DIAS_ANTIGO = 14;           // catálogo mais velho que isso: o aviso de esgotado pode estar errado
const idadeDias = cat => (cat && cat.atualizado) ? Math.floor((Date.now() - cat.atualizado) / 86400000) : null;
const idadeTxt = cat => { const d = idadeDias(cat); return d === null ? 'sem catálogo' : d === 0 ? 'de hoje' : d === 1 ? 'de há 1 dia' : `de há ${d} dias`; };
const catAntigo = cat => { const d = idadeDias(cat); return d !== null && d > DIAS_ANTIGO; };
function pend(id) {
    const c = APR.contas[id] || {}, e = Object.values(c.esg || {});
    return { preco: Object.keys(c.zap || {}).length, desativar: e.filter(x => x.estado === 'desativar').length, reativar: e.filter(x => x.estado === 'reativar').length, adicionar: e.filter(x => x.estado === 'adicionar').length };
}
const totalPend = id => { const p = pend(id); return p.preco + p.desativar + p.reativar + p.adicionar; };

let TELA = 'hub';                 // para o botão ‹ saber voltar
let _toastT = null, _toastFn = null;
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
function titulo(t) { const el = overlay && overlay.querySelector('.ps-topo b'); if (el) el.textContent = t; }

// ── Classificação ───────────────────────────────────────────────
function classificar(linhasPdf, produtos) {
    const ctw = produtos.map(p => ({ p, id: p.id, nome: p.nome || '', valor: valorCtw(p), an: analisar(p.nome || '') }));
    const porId = new Map(ctw.map(c => [c.id, c]));
    const porKey = new Map();
    ctw.forEach(c => { if (!porKey.has(c.an.key)) porKey.set(c.an.key, []); porKey.get(c.an.key).push(c); });

    const pdf = linhasPdf.map((l, i) => ({ ...l, i, an: analisar(l.nome), ignorar: NAO_SINCRONIZAR.test(l.nome) }));
    const contaKey = new Map();
    pdf.filter(r => !r.ignorar).forEach(r => { (contaKey.get(r.an.key) || contaKey.set(r.an.key, []).get(r.an.key)).push(r); });

    const reivindicado = new Map();     // id CTW → linha do PDF
    const resultado = { casados: [], perguntas: [], semCtw: [], naoVender: pdf.filter(r => r.ignorar), semMudancaAvisos: [] };

    const reivindicar = (r, c, origem) => {
        if (reivindicado.has(c.id)) return false;
        reivindicado.set(c.id, r);
        resultado.casados.push({ r, c, origem });
        return true;
    };

    const pendentes = [];
    for (const r of pdf) {
        if (r.ignorar) continue;
        // 1) vínculo aprendido (código do Stock 2.0 primeiro, depois nome)
        const al = (r.codigo && APR.aliases[chaveCodigo(r.codigo)]) || APR.aliases[chaveNome(r.an)];
        if (al && porId.has(al.pid) && al.spec === assinatura(r.an) && reivindicar(r, porId.get(al.pid), 'aprendido')) continue;
        pendentes.push(r);
    }
    const restantes = [];
    for (const r of pendentes) {
        // 2) nome idêntico — só se for inequívoco dos dois lados
        const iguais = (porKey.get(r.an.key) || []).filter(c => !reivindicado.has(c.id));
        const mesmasLinhas = contaKey.get(r.an.key) || [];
        const conflito = mesmasLinhas.length > 1 && mesmasLinhas.some(o => !igual(o.valor, r.valor));
        if (iguais.length === 1 && !conflito && reivindicar(r, iguais[0], 'igual')) continue;
        restantes.push(r);
    }
    for (const r of restantes) {
        // "Não existe no CTW" respondido antes: não pergunta de novo (só "Decidir depois" volta a perguntar)
        const jaIgnorado = (r.codigo && APR.ignoradosPdf[chaveCodigo(r.codigo)]) || APR.ignoradosPdf[chaveNome(r.an)];
        if (jaIgnorado) { resultado.semCtw.push(r); continue; }
        const cands = candidatos(r, ctw, reivindicado, LIMIAR_PERGUNTA);
        if (cands.length) resultado.perguntas.push(r); else resultado.semCtw.push(r);
    }
    return { ctw, pdf, reivindicado, ...resultado };
}

function candidatos(r, ctw, reivindicado, limiar) {
    return ctw
        .filter(c => !reivindicado.has(c.id))
        .map(c => ({ c, s: similaridade(r.an.nucleo, c.an.nucleo), d: diferencas(r.an, c.an) }))
        .filter(x => x.s >= limiar)
        .sort((a, b) => (a.d.some(z => z.forte) - b.d.some(z => z.forte)) || b.s - a.s)
        .slice(0, 4);
}

// ── Interface ───────────────────────────────────────────────────
let overlay = null;

function abrirOverlay(titulo) {
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.className = 'ps-overlay';
    overlay.innerHTML = `<div class="ps-topo"><button type="button" class="ps-x" data-act="voltar" aria-label="Voltar">‹</button><b>${esc(titulo || 'WhatsApp e Preços')}</b></div><div class="ps-corpo" id="psCorpo"></div>`;
    overlay.addEventListener('click', aoClicar);
    overlay.addEventListener('input', aoDigitar);
    overlay.addEventListener('change', aoMudar);
    document.body.appendChild(overlay);
    document.documentElement.classList.add('ps-aberto');
}

function fechar() {
    if (overlay) { overlay.remove(); overlay = null; }
    document.documentElement.classList.remove('ps-aberto');
    S = null; CAT = null; ESC_.pdf = null; ESC_.zips = {}; clearTimeout(_toastT); _toastFn = null;
}

function tela(html) {
    const c = overlay && overlay.querySelector('#psCorpo');
    if (c) { c.innerHTML = html; c.scrollTop = 0; }
}

const chip = (t, forte) => `<span class="ps-chip${forte ? ' ps-forte' : ''}">${esc(t)}</span>`;

const ESC_ = { pdf: null, zips: {} };   // arquivos escolhidos, ainda não analisados: pdf e { conta: { nome, texto, pasta, nota } }
const chipsContas = (comTotal, ativa = CONTA) => `<div class="ps-contas">${Object.entries(APR.contas).map(([id, c]) => `<button type="button" class="${id === ativa ? 'on' : ''}" data-act="conta" data-id="${esc(id)}">${esc(c.nome)}${comTotal ? ' · ' + totalPend(id) : ''}</button>`).join('')}</div>`;

// ── 1 · Início ──────────────────────────────────────────────────
async function telaInicio() {
    TELA = 'hub'; titulo('WhatsApp e Preços');
    tela('<div class="ps-msg">Carregando…</div>');
    try { await carregarAprendizado(); }
    catch (e) { return tela(`<div class="ps-msg ps-erro">Não consegui acessar o banco de dados (${esc(e.message)}). Verifique a internet e tente de novo.</div>`); }
    const ids = Object.keys(APR.contas), conta = APR.contas[CONTA], p = pend(CONTA);
    const avisos = ids.filter(id => !APR.contas[id].catalogo || catAntigo(APR.contas[id].catalogo));
    tela(`
      <div class="ps-card ps-grande">
        <div class="ps-cap">Passo 1</div>
        <b class="ps-tit">Atualizar preços</b>
        <p>Mande o PDF do Stock 2.0. O app atualiza o CTW e já diz o que fazer em cada WhatsApp.</p>
        <button type="button" class="ps-btn ps-prim ps-grande" data-act="enviar">Começar</button>
      </div>
      <div class="ps-card ps-grande">
        <div class="ps-cap">Passo 2 · Fazer no WhatsApp</div>
        ${chipsContas(true)}
        <div class="ps-tiles">
          <div class="ps-tile"><b class="ps-c-verm">${p.preco}</b><span>Corrigir preço</span></div>
          <div class="ps-tile"><b class="ps-c-amar">${p.desativar}</b><span>Desativar</span></div>
          <div class="ps-tile"><b class="ps-c-azul">${p.reativar}</b><span>Reativar</span></div>
          <div class="ps-tile"><b class="ps-c-verde">${p.adicionar}</b><span>Adicionar</span></div>
        </div>
        <button type="button" class="ps-btn" data-act="zap">Abrir a lista de ${esc(conta.nome)}</button>
      </div>
      ${avisos.map(id => `<div class="ps-aviso-card"><b>${APR.contas[id].catalogo ? `Catálogo de ${esc(APR.contas[id].nome)} está antigo` : `${esc(APR.contas[id].nome)} ainda não tem catálogo`}</b>
        <span>${APR.contas[id].catalogo ? `O último ZIP é ${idadeTxt(APR.contas[id].catalogo)}. Os avisos de esgotado dessa conta podem estar errados.` : 'Sem o ZIP, essa conta não recebe aviso de esgotado.'}</span></div>`).join('')}
      <button type="button" class="ps-btn ps-suave" data-act="avancado">Avançado ›</button>`);
}

// ── 2 · Atualizar preços (PDF + ZIP de cada conta) ──────────────
function telaEnviar() {
    TELA = 'enviar'; titulo('Atualizar preços');
    const nZip = Object.keys(ESC_.zips).length;
    const arq = (f, texto) => f ? `<div class="ps-nome">${esc(f.name)}</div><div class="ps-sub">${texto}</div>` : '';
    tela(`
      <div class="ps-card">
        <div class="ps-passo"><span class="ps-n on">1</span><b>PDF do Stock 2.0</b></div>
        <div class="ps-arq"><span class="ps-tipo ps-pdf">PDF</span><div class="ps-grow">${ESC_.pdf ? arq(ESC_.pdf, 'pronto para analisar') : '<div class="ps-sub">Escolha o “Catálogo de produtos” gerado no Stock 2.0.</div>'}</div>
          <label class="ps-link"><input type="file" id="psArquivo" accept="application/pdf,.pdf" hidden>${ESC_.pdf ? 'Trocar' : 'Escolher'}</label></div>
        <div class="ps-sub">Vale para todas as contas de WhatsApp.</div>
      </div>
      <div class="ps-card">
        <div class="ps-passo"><span class="ps-n">2</span><b class="ps-grow">Catálogo de cada WhatsApp</b><span class="ps-opc">opcional</span></div>
        ${Object.entries(APR.contas).map(([id, c]) => { const z = ESC_.zips[id]; return `
          <div class="ps-arq${!z && catAntigo(c.catalogo) ? ' ps-arq-aviso' : ''}"><div class="ps-grow">
            <div class="ps-nome">${esc(c.nome)}</div>
            <div class="ps-sub${!z && catAntigo(c.catalogo) ? ' ps-c-amar' : ''}">${z ? `${esc(z.nome)} · pronto para analisar${z.pasta ? '' : ''}` : c.catalogo ? `ZIP ${idadeTxt(c.catalogo)} · ${Object.keys(c.catalogo.itens || {}).length} produtos${catAntigo(c.catalogo) ? ' · antigo' : ''}` : 'Ainda sem ZIP'}</div>
            ${z && z.nota ? `<div class="ps-sub ps-c-amar">${esc(z.nota)}</div>` : ''}</div>
            <label class="ps-link"><input type="file" class="psZipIn" data-conta="${esc(id)}" accept=".zip,.csv,application/zip,text/csv" hidden>${z ? 'Trocar' : c.catalogo ? 'Atualizar' : 'Escolher'}</label></div>`; }).join('')}
        <div class="ps-sub">Ao escolher um ZIP o app lê o nome da loja dentro do arquivo e já sabe de qual conta ele é.</div>
      </div>
      <button type="button" class="ps-btn ps-prim ps-grande" data-act="analisar"${ESC_.pdf || nZip ? '' : ' disabled'}>${ESC_.pdf ? 'Analisar' : nZip ? 'Guardar catálogo' : 'Escolha o PDF para analisar'}</button>`);
}

// Lê o ZIP/CSV agora (o texto fica na memória até "Analisar") e descobre de qual conta ele é pela pasta de dentro do ZIP
async function aoEscolherZip(arq, cid) {
    if (!arq) return;
    tela('<div class="ps-msg">Lendo o arquivo…</div>');
    try {
        let texto, pasta = '';
        if (/\.zip$/i.test(arq.name)) { const r = await lerZip(await arq.arrayBuffer()); texto = r.texto; pasta = r.pasta; }
        else texto = await arq.text();
        if (!itensDoCsv(texto).length) throw new Error('Não encontrei produtos com preço nesse arquivo.');
        let alvo = cid, nota = '';
        const chave = pasta ? chaveFb(norm(pasta)) : '';
        const mapeada = chave && APR.contasZip[chave];
        if (mapeada && APR.contas[mapeada] && mapeada !== cid) { alvo = mapeada; nota = `Reconhecido: este ZIP é da conta ${APR.contas[mapeada].nome}.`; }
        else if (mapeada && APR.contas[mapeada]) nota = 'Conta confirmada pelo nome da loja no ZIP.';
        ESC_.zips[alvo] = { nome: arq.name, texto, pasta, nota };
    } catch (e) {
        telaEnviar();
        return overlay.querySelector('#psCorpo').insertAdjacentHTML('afterbegin', `<div class="ps-msg ps-erro">${esc(e.message)}</div>`);
    }
    telaEnviar();
}

async function analisarTudo() {
    const { pdf, zips } = ESC_, ids = Object.keys(zips);
    if (!pdf && !ids.length) return;
    ESC_.pdf = null; ESC_.zips = {}; S = null; CAT = null;
    for (const cid of ids) {
        usarConta(cid);
        tela(`<div class="ps-msg">Lendo o catálogo de ${esc(APR.contas[cid].nome)}…</div>`);
        await importarCatalogo(zips[cid].texto, true);
        const k = zips[cid].pasta ? chaveFb(norm(zips[cid].pasta)) : '';
        if (k && APR.contasZip[k] !== cid) {                    // lembra: esta pasta é desta conta
            await update(ref(getDb()), { [`${BASE}/contasZip/${k}`]: cid }); APR.contasZip[k] = cid;
        }
    }
    if (!pdf) return fimCatalogo();
    return aoEscolherPdf(pdf);
}

async function aoEscolherPdf(arq) {
    if (!arq) return;
    tela('<div class="ps-msg">Lendo o PDF…</div>');
    try {
        const { linhas, avisos } = await lerPdf(arq);
        if (!linhas.length) throw new Error('Não encontrei nenhum produto com valor nesse PDF. É o “Catálogo de produtos” do Stock 2.0?');
        const produtos = (window.products || []).filter(p => p && p.id);
        if (!produtos.length) throw new Error('O CTW ainda não carregou os produtos. Aguarde alguns segundos e tente de novo.');
        await carregarAprendizado();
        const cl = classificar(linhas, produtos);
        S = { arquivo: arq.name, avisos, cl, linhas, decisoes: [], novosAliases: [], novosIgnoradosPdf: [], pularResto: false, fila: cl.perguntas.slice(), total: cl.perguntas.length, aceitar: {} };
        proximaPergunta();
    } catch (e) {
        tela(`<div class="ps-msg ps-erro">${esc(e.message)}</div><button type="button" class="ps-btn" data-act="inicio">Voltar</button>`);
    }
}

function proximaPergunta() {
    if (!S.fila.length || S.pularResto) return telaPrevia();
    const r = S.fila[0];
    const cands = candidatos(r, S.cl.ctw, S.cl.reivindicado, LIMIAR_PERGUNTA);
    if (!cands.length) { S.cl.semCtw.push(r); S.fila.shift(); return proximaPergunta(); }
    S.fase = 'pdf'; TELA = 'pergunta'; titulo('É este produto?');
    const n = S.total - S.fila.length + 1;
    tela(`
      <div class="ps-prog">Pergunta ${n} de ${S.total}</div>
      <div class="ps-card">
        <div class="ps-cap">No Stock 2.0</div>
        <div class="ps-nome">${esc(r.nome)}</div>
        <div class="ps-valor">${brl(r.valor)}</div>
      </div>
      <div class="ps-cap ps-esp">É o mesmo produto de qual item do CTW?</div>
      ${cands.map(x => `
        <button type="button" class="ps-cand" data-act="mesmo" data-id="${esc(x.c.id)}">
          <span class="ps-nome">${esc(x.c.nome)}</span>
          <span class="ps-sub">hoje ${brl(x.c.valor)} → ${brl(r.valor)}</span>
          <span class="ps-chips">${x.d.length ? x.d.map(z => chip(z.t, z.forte)).join('') : chip('especificações iguais')}</span>
        </button>`).join('')}
      <div class="ps-busca"><input type="search" id="psBusca" placeholder="Buscar outro produto do CTW…" autocomplete="off"></div>
      <div id="psBuscaRes"></div>
      <button type="button" class="ps-btn ps-prim" data-act="pular">Pular por agora</button>
      <button type="button" class="ps-btn" data-act="naoexiste">Não existe no CTW</button>
      <button type="button" class="ps-btn ps-suave" data-act="maisopc">Mais opções ${S.maisOpc ? '⌃' : '›'}</button>
      ${S.maisOpc ? `<button type="button" class="ps-btn" data-act="addform" data-origem="pergunta" data-i="${r.i}">Adicionar ao CTW (editar nome e preço)</button>
      <button type="button" class="ps-btn" data-act="pularresto">Pular as ${S.fila.length} perguntas restantes</button>` : ''}`);
}

function resultadoBusca(q) {
    const box = overlay.querySelector('#psBuscaRes'); if (!box) return;
    const t = semAcento(q).toUpperCase().split(/\s+/).filter(Boolean);
    if (!t.length) { box.innerHTML = ''; return; }
    const r = S.fila[0];
    const lista = S.cl.ctw.filter(c => !S.cl.reivindicado.has(c.id) && t.every(w => semAcento(c.nome).toUpperCase().includes(w))).slice(0, 8);
    box.innerHTML = lista.map(c => {
        const d = diferencas(r.an, c.an);
        return `<button type="button" class="ps-cand" data-act="mesmo" data-id="${esc(c.id)}"><span class="ps-nome">${esc(c.nome)}</span><span class="ps-sub">hoje ${brl(c.valor)} → ${brl(r.valor)}</span><span class="ps-chips">${d.map(z => chip(z.t, z.forte)).join('')}</span></button>`;
    }).join('') || '<div class="ps-cap">Nada encontrado.</div>';
}

function aoDigitar(e) {
    if (e.target.id === 'psBuscaVinc') {
        const q = norm(e.target.value).split(' ').filter(Boolean);
        overlay.querySelectorAll('.ps-it[data-q]').forEach(el => { el.hidden = !q.every(t => el.dataset.q.includes(t)); });
    }
    if (e.target.id === 'psBusca' && S) resultadoBusca(e.target.value);
    if (e.target.id === 'psBuscaPdf' && S && S.vinculo) resultadoBuscaPdf(e.target.value);
    if (e.target.id === 'psBuscaAdd' && S) { const box = overlay.querySelector('#psAddRes'); if (box) box.innerHTML = listaAdicionar(e.target.value); }
}
function aoMudar(e) {
    if (e.target.id === 'psArquivo') { ESC_.pdf = (e.target.files && e.target.files[0]) || ESC_.pdf; telaEnviar(); }
    if (e.target.classList && e.target.classList.contains('psZipIn')) aoEscolherZip(e.target.files && e.target.files[0], e.target.dataset.conta);
    if (e.target.id === 'psCatExtra') { const n = numero(e.target.value); try { localStorage.setItem('ctwCatExtra', String(n)); } catch (x) {} }
    if (e.target.id === 'psPrints') aoEscolherPrints(e.target.files);
    if (S && e.target.dataset && e.target.dataset.sus !== undefined) {
        S.aceitar[e.target.dataset.sus] = e.target.checked;
        const bt = overlay.querySelector('[data-act="aplicar"]');
        const n = S.mud.filter(x => x.mudou && !x.invalido && (!x.suspeito || S.aceitar[x.id])).length;
        if (bt && n) bt.textContent = `Atualizar ${n} preço(s) no CTW`;
    }
}

function confirmarVinculo(r, c) {
    S.cl.reivindicado.set(c.id, r);
    S.cl.casados.push({ r, c, origem: 'confirmado' });
    S.novosAliases.push({ r, c });
}

// ── Prévia ──────────────────────────────────────────────────────
function montarMudancas() {
    return S.cl.casados.map(({ r, c, origem }) => {
        const de = c.valor, para = r.valor;
        const mudou = !igual(de, para);
        const pct = de > 0 ? (para - de) / de : null;
        const invalido = !(para > 0);
        const suspeito = !invalido && mudou && (pct === null ? false : Math.abs(pct) > LIMITE_SUSPEITO);
        return { r, c, origem, de, para, mudou, pct, invalido, suspeito, id: c.id };
    });
}

function telaPrevia() {
    TELA = 'previa'; titulo('Conferir antes de atualizar');
    S.mud = montarMudancas();
    const m = S.mud;
    const muda = m.filter(x => x.mudou && !x.invalido);
    const sem = m.filter(x => !x.mudou && !x.invalido);
    const inval = m.filter(x => x.invalido);
    muda.forEach(x => { if (x.suspeito && !(x.id in S.aceitar)) S.aceitar[x.id] = false; });
    const linha = x => `
      <div class="ps-it${x.suspeito ? ' ps-sus' : ''}">
        ${x.suspeito ? `<label class="ps-ck"><input type="checkbox" data-sus="${esc(x.id)}" ${S.aceitar[x.id] ? 'checked' : ''}></label>` : ''}
        <div class="ps-grow"><div class="ps-nome">${esc(x.c.nome)}</div>
          <div class="ps-sub">${brl(x.de)} → <b>${brl(x.para)}</b>${x.pct === null ? ' · sem preço antes' : ` · ${x.pct > 0 ? '+' : ''}${(x.pct * 100).toFixed(0)}%`}${x.origem !== 'igual' ? ` · ${x.origem}` : ''}</div>
          ${x.suspeito ? '<div class="ps-aviso">Variação grande — marque a caixa para aplicar.</div>' : ''}</div>
      </div>`;
    const nAplicar = muda.filter(x => !x.suspeito || S.aceitar[x.id]).length;
    tela(`
      <div class="ps-card">
        <div class="ps-lin"><span>Preços que vão mudar</span><b>${muda.length}</b></div>
        <div class="ps-lin"><span>Já estão iguais ao Stock 2.0</span><b>${sem.length}</b></div>
        <div class="ps-lin"><span>Sem correspondência no CTW (não mexo)</span><b>${S.cl.semCtw.length + S.fila.length}</b></div>
        ${inval.length ? `<div class="ps-lin"><span>Valor inválido no PDF (não aplico)</span><b>${inval.length}</b></div>` : ''}
        ${S.avisos.length ? `<details class="ps-det"><summary>${S.avisos.length} aviso(s) na leitura do PDF</summary>${S.avisos.map(a => `<div class="ps-sub">${esc(a)}</div>`).join('')}</details>` : ''}
      </div>
      ${cartaoWhats(calcTodasEsg())}
      ${muda.length ? muda.map(linha).join('') : '<div class="ps-msg">Nenhum preço precisa mudar.</div>'}
      <button type="button" class="ps-btn ps-prim" data-act="aplicar">${muda.length ? `Atualizar ${nAplicar} preço(s) no CTW` : 'Concluir'}</button>
      <button type="button" class="ps-btn ps-suave" data-act="inicio">Cancelar (nada é alterado)</button>`);
}

// ── Esgotados: o que está no catálogo e não veio no PDF → desativar no WhatsApp ──
// Estados por produto (settings/precosync/esg/{pid}): desativar (aviso pendente) → desativado (você confirmou)
// → reativar (voltou ao PDF) → some quando você reativa. "ainda" = "ainda tem": não avisa até a data.
const DIAS_AINDA_TEM = 15;
const LIMITE_ESGOTADOS = 0.15;     // mais que isso de uma vez = provável PDF incompleto: pergunta antes
const MAX_ZAPLOG = 40;

function presencaPdf() {
    const set = new Set(S.cl.reivindicado.keys());
    (S.mud || []).forEach(x => set.add(x.id));
    S.novosAliases.forEach(a => set.add(a.c.id));
    return set;
}

// Produtos do CTW que podem ser a mesma coisa que um item do PDF ainda sem resposta: não conta como "ausente"
function duvidaPdf() {
    const set = new Set();
    const ignorado = r => S.novosIgnoradosPdf.includes(r) || (r.codigo && APR.ignoradosPdf[chaveCodigo(r.codigo)]) || APR.ignoradosPdf[chaveNome(r.an)];
    S.fila.concat(S.cl.semCtw).filter(r => !ignorado(r) && !(S.vinculados && S.vinculados.has(r.i)))
        .forEach(r => candidatos(r, S.cl.ctw, S.cl.reivindicado, LIMIAR_PERGUNTA).forEach(x => set.add(x.c.id)));
    return set;
}

// `faltando`: produtos do CTW que estão no PDF de hoje (têm estoque) mas não no catálogo da conta → "Adicionar no WhatsApp".
// Só vale com catálogo exato (ZIP) e sem nome duvidoso pendente; `faltando` = { pid: { nome, preco } } já sem os "não vou colocar".
function calcEsgotados(presenca, duvida, catalogo, esgAtual, faltando) {
    const cat = (catalogo && catalogo.itens) || {}, esg = esgAtual || {}, agora = Date.now();
    const upd = {}; let novos = 0;
    const duvCat = (catalogo && catalogo.duv) || {}, podeAdd = !!faltando && catalogo && catalogo.origem === 'zip';
    const novosAdd = [];
    new Set([...Object.keys(cat), ...Object.keys(esg), ...(podeAdd ? Object.keys(faltando) : [])]).forEach(pid => {
        const e = esg[pid], c = cat[pid];
        if (duvida.has(pid)) return;
        if (e && e.estado === 'adicionar') {          // já está no catálogo ou o PDF de hoje não traz mais (acabou): sai da lista
            if (c || !presenca.has(pid)) upd[pid] = null;
            return;
        }
        if (!e && !c && podeAdd && faltando[pid] && !duvCat[pid]) { novosAdd.push(pid); return; }
        if (presenca.has(pid)) {
            if (e && e.estado === 'desativado') upd[pid] = { ...e, estado: 'reativar', desde: agora };
            else if (e && (e.estado === 'desativar' || e.estado === 'ainda')) upd[pid] = null;
            return;
        }
        if (!c && !(e && (e.estado === 'desativado' || e.estado === 'reativar'))) return;     // fora do catálogo e sem histórico
        if (!e) { upd[pid] = { nome: c.n, preco: c.p, estado: 'desativar', desde: agora }; novos++; }
        else if (e.estado === 'ainda' && (e.ate || 0) <= agora) { upd[pid] = { ...e, estado: 'desativar', desde: agora }; novos++; }
        else if (e.estado === 'reativar') upd[pid] = { ...e, estado: 'desativado' };            // faltou de novo antes de você reativar
    });
    // ZIP errado/incompleto faria quase tudo "faltar": acima do limite não avisa nada e mostra o alerta
    const muitos = novosAdd.length > Math.max(10, Math.ceil(presenca.size * 0.4));
    if (!muitos) novosAdd.forEach(pid => { upd[pid] = { nome: faltando[pid].nome, preco: faltando[pid].preco, estado: 'adicionar', desde: agora }; });
    const final = { ...esg };
    Object.entries(upd).forEach(([pid, v]) => { if (v === null) delete final[pid]; else final[pid] = v; });
    const tam = Object.keys(cat).length;
    return {
        upd, novos, adicionar: Object.values(final).filter(e => e.estado === 'adicionar').length, muitosFaltando: muitos ? novosAdd.length : 0,
        suspeito: novos > Math.max(5, Math.ceil(tam * LIMITE_ESGOTADOS)),
        desativar: Object.values(final).filter(e => e.estado === 'desativar').length,
        reativar: Object.values(final).filter(e => e.estado === 'reativar').length
    };
}

function contagemEsg(esg) {
    const v = Object.values(esg || {});
    return { desativar: v.filter(e => e.estado === 'desativar').length, reativar: v.filter(e => e.estado === 'reativar').length, adicionar: v.filter(e => e.estado === 'adicionar').length };
}

function aplicarEsgLocal(esg, upd) {
    Object.entries(upd).forEach(([pid, v]) => { if (v === null) delete esg[pid]; else esg[pid] = v; });
}

// Esgotados/voltaram de cada conta que tem catálogo guardado, a partir do PDF analisado
function calcTodasEsg() {
    const pres = presencaPdf(), duv = duvidaPdf(), out = {}, extra = catExtra();
    const novoPreco = new Map((S.mud || []).filter(x => !x.invalido).map(x => [x.id, x.mudou && (!x.suspeito || S.aceitar[x.id]) ? x.para : x.de]));
    const faltando = {};      // produtos do CTW com estoque hoje (estão no PDF) que ainda não "não vou colocar"
    (window.products || []).forEach(p => {
        if (!p || !pres.has(p.id) || APR.naoWhats[p.id]) return;
        faltando[p.id] = { nome: p.nome || '', preco: Math.round(((novoPreco.get(p.id) ?? valorCtw(p)) + extra) * 100) / 100 };
    });
    Object.entries(APR.contas).forEach(([id, c]) => {
        if (!c.catalogo || !Object.keys(c.catalogo.itens || {}).length) return;
        out[id] = { nome: c.nome, ...calcEsgotados(pres, duv, c.catalogo, c.esg, faltando) };
    });
    return out;
}

function cartaoWhats(esgs, comBotao) {
    const ids = Object.keys(esgs || {});
    if (!ids.length) return '';
    return ids.map(id => {
        const eg = esgs[id], multi = Object.keys(APR.contas).length > 1;
        return `<div class="ps-card ${eg.suspeito ? 'ps-alerta' : ''}">
        <div class="ps-cap">WhatsApp${multi ? ' · ' + esc(eg.nome) : ' (catálogo)'}</div>
        ${eg.suspeito ? `<div class="ps-aviso">${eg.novos} produtos do catálogo parecem esgotados de uma vez. O PDF veio completo? Nada é avisado até você confirmar.</div>
          ${comBotao ? `<button type="button" class="ps-btn ps-perigo" data-act="esgaplicar" data-conta="${esc(id)}">Sim, o PDF está completo: avisar os esgotados</button>` : ''}`
        : `<div class="ps-lin"><span>Esgotaram (desativar no WhatsApp)</span><b>${eg.desativar}</b></div>`}
        ${eg.reativar ? `<div class="ps-lin"><span>Voltaram ao estoque (reativar)</span><b>${eg.reativar}</b></div>` : ''}
        ${eg.adicionar ? `<div class="ps-lin"><span>Faltam no catálogo (adicionar)</span><b>${eg.adicionar}</b></div>` : ''}
        ${eg.muitosFaltando ? `<div class="ps-aviso">${eg.muitosFaltando} produtos do PDF parecem faltar no catálogo de uma vez. Confira se o ZIP é o certo: não avisei nenhum.</div>` : ''}
      </div>`;
    }).join('');
}

async function logZap(entrada, upd, cid = CONTA) {
    const db = getDb(), R = raiz(cid);
    const log = (await get(ref(db, R + '/zapLog'))).val() || {};
    const key = push(ref(db, R + '/zapLog')).key;
    Object.keys(log).sort().slice(0, -(MAX_ZAPLOG - 1)).forEach(k => { upd[`${R}/zapLog/${k}`] = null; });
    upd[`${R}/zapLog/${key}`] = { quando: Date.now(), usuario: usuario(), ...entrada };
    return key;
}

// ── Aplicar ─────────────────────────────────────────────────────
async function gravar(itens, aliases, ignoradosPdf, arquivo, tipo, extra) {
    const db = getDb();
    const logId = push(ref(db, BASE + '/log')).key;
    const upd = {};
    const logItens = {};
    for (const x of itens) {
        upd[`products/${x.id}/valor`] = Math.round(x.para * 100) / 100;
        logItens[x.id] = { de: x.de, para: Math.round(x.para * 100) / 100 };
    }
    if (itens.length) {
        upd[`${BASE}/log/${logId}`] = { quando: Date.now(), arquivo: arquivo || '', usuario: usuario(), tipo: tipo || 'importacao', itens: logItens };
    }
    for (const { r, c } of aliases) {
        const val = { pid: c.id, nomeEstoque: r.nome, nomeCtw: c.nome, codigo: r.codigo || '', spec: assinatura(r.an), quando: Date.now() };
        upd[`${BASE}/aliases/${chaveNome(r.an)}`] = val;
        if (r.codigo) upd[`${BASE}/aliases/${chaveCodigo(r.codigo)}`] = val;
        upd[`${BASE}/ignoradosPdf/${chaveNome(r.an)}`] = null;
        if (r.codigo) upd[`${BASE}/ignoradosPdf/${chaveCodigo(r.codigo)}`] = null;
        upd[`${BASE}/ignoradosCtw/${c.id}`] = null;
    }
    for (const r of ignoradosPdf) upd[`${BASE}/ignoradosPdf/${r.codigo ? chaveCodigo(r.codigo) : chaveNome(r.an)}`] = { nome: r.nome, quando: Date.now() };
    if (itens.length) {   // cada preço alterado vira pendência na lista "Alterar no WhatsApp"
        const lista = itens.map(x => ({ id: x.id, nome: x.c.nome, de: x.de, para: Math.round(x.para * 100) / 100 }));
        for (const id of Object.keys(APR.contas)) {      // todas as contas de WhatsApp recebem a pendência
            const zap = (await get(ref(db, raiz(id) + '/zap'))).val() || {};
            const fixos = (await get(ref(db, raiz(id) + '/fixos'))).val() || {};
            Object.assign(upd, window.ctwZapCalcular(zap, lista, usuario(), raiz(id) + '/zap', fixos));
        }
    }
    Object.assign(upd, extra || {});
    if (!Object.keys(upd).length) return;
    if (itens.length) {                // poda registros antigos junto com a gravação
        const antigos = Object.keys((await get(ref(db, BASE + '/log'))).val() || {}).sort().slice(0, -(MAX_LOGS - 1));
        antigos.forEach(k => { upd[`${BASE}/log/${k}`] = null; });
    }
    await update(ref(db), upd);       // tudo ou nada: preços + log + vínculos juntos
    return itens.length ? logId : null;
}

async function aplicar() {
    const alvo = S.mud.filter(x => x.mudou && !x.invalido && (!x.suspeito || S.aceitar[x.id]));
    // garante que o preço do CTW não foi mexido por outra pessoa durante a importação
    const atuais = new Map((window.products || []).map(p => [p.id, valorCtw(p)]));
    const mexidos = alvo.filter(x => !igual(atuais.get(x.id) ?? x.de, x.de));
    const seguros = alvo.filter(x => !mexidos.includes(x));
    tela('<div class="ps-msg">Aplicando…</div>');
    try {
        // quem voltou a aparecer no PDF deixa de ser "em falta"/"fora do estoque"
        const voltou = {};
        S.cl.casados.forEach(({ c }) => { if (APR.ignoradosCtw[c.id]) voltou[`${BASE}/ignoradosCtw/${c.id}`] = null; });
        S.esg = calcTodasEsg();          // esgotados / voltaram, em relação ao catálogo guardado de cada conta
        Object.entries(S.esg).forEach(([id, e]) => { if (!e.suspeito) Object.entries(e.upd).forEach(([pid, v]) => { voltou[`${raiz(id)}/esg/${pid}`] = v; }); });
        S.logId = await gravar(seguros, S.novosAliases, S.novosIgnoradosPdf, S.arquivo, 'importacao', voltou);
        Object.keys(voltou).filter(k => k.includes('/ignoradosCtw/')).forEach(k => delete APR.ignoradosCtw[k.split('/').pop()]);
        Object.entries(S.esg).forEach(([id, e]) => { if (!e.suspeito) { aplicarEsgLocal(APR.contas[id].esg, e.upd); Object.assign(e, contagemEsg(APR.contas[id].esg)); } });
    } catch (e) {
        const regra = /permission/i.test(e.message || '') ? ' O Firebase precisa liberar escrita no caminho “settings/precosync” nas regras do banco.' : '';
        tela(`<div class="ps-msg ps-erro">Não consegui gravar (${esc(e.message)}). Nada foi alterado.${regra}</div><button type="button" class="ps-btn" data-act="previa">Voltar à prévia</button>`);
        return;
    }
    S.aplicados = seguros; S.mexidos = mexidos; S.pulados = S.mud.filter(x => x.suspeito && !S.aceitar[x.id]);
    telaRelatorio();
}

// ── Relatório ───────────────────────────────────────────────────
// "Em falta" vale por alguns dias; depois volta para a revisão. Quem não é mais trabalhado é excluído do CTW.
const ctwEscondido = id => { const e = APR.ignoradosCtw[id]; return !!e && !!e.ate && e.ate > Date.now(); };   // marcas antigas sem prazo voltam a aparecer

function ctwSemPdf() {
    return S.cl.ctw.filter(c => !S.cl.reivindicado.has(c.id) && !ctwEscondido(c.id)
        && !(S.ctwDescartados && S.ctwDescartados.has(c.id)));
}

async function telaRelatorio() {
    TELA = 'resultado'; titulo('Pronto');
    try { await carregarAprendizado(); } catch (e) { /* segue com o que já está na memória */ }
    const aplic = S.aplicados.filter(x => x.origem !== 'vinculo' || x.para !== x.de);
    const sobem = aplic.filter(x => x.para > x.de).length, descem = aplic.filter(x => x.para < x.de).length;
    const ids = Object.keys(APR.contas);
    const soma = k => ids.reduce((t, id) => t + pend(id)[k], 0);
    const chipsP = k => `<div class="ps-chipsl">${ids.map(id => `<span>${esc(APR.contas[id].nome)} ${pend(id)[k]}</span>`).join('')}</div>`;
    const urgentes = ids.reduce((t, id) => t + Object.values(APR.contas[id].zap || {}).filter(z => z.para > z.de).length, 0);
    const emVarias = {};      // produto que esgotou em mais de uma conta
    ids.forEach(id => Object.entries(APR.contas[id].esg || {}).forEach(([pid, e]) => { if (e.estado === 'desativar') (emVarias[pid] = emVarias[pid] || { nome: e.nome, contas: [] }).contas.push(APR.contas[id].nome); }));
    const exemplos = Object.values(emVarias).filter(x => x.contas.length > 1).slice(0, 2);
    const faltam = ctwSemPdf(), poolPdf = poolSemCtw();
    const duvCat = CAT && CAT.fila ? CAT.fila.length : 0;
    const suspeitas = Object.fromEntries(Object.entries(S.esg || {}).filter(([, e]) => e.suspeito));
    const cartao = (cor, n, tit, sub, act, aba, extra) => `<button type="button" class="ps-resumo" data-act="${act}"${aba ? ` data-aba="${aba}"` : ''}><span class="ps-num ${cor}">${n}</span><span class="ps-grow"><b>${tit}</b><span class="ps-sub">${sub}</span>${extra || ''}</span><span class="ps-seta">›</span></button>`;
    const semCat = ids.filter(id => !APR.contas[id].catalogo || catAntigo(APR.contas[id].catalogo));
    tela(`
      <div class="ps-sub">${esc(S.arquivo || '')}</div>
      <div class="ps-resumo ps-feito"><span class="ps-num ps-c-verde">${aplic.length}</span><span class="ps-grow"><b>${aplic.length ? 'Preços atualizados no CTW' : 'Nenhum preço mudou no CTW'}</b>
        <span class="ps-sub">${aplic.length ? `${sobem} subiram · ${descem} desceram` : 'Tudo já estava igual ao Stock 2.0'}</span></span>
        ${aplic.length && S.logId ? `<button type="button" class="ps-link" data-act="desfazer" data-id="${esc(S.logId)}">Desfazer</button>` : ''}</div>
      ${cartao('ps-c-verm', soma('preco'), 'Corrigir preço no WhatsApp', urgentes ? `${urgentes} estão mais baratos que deveriam` : 'Nenhum mais barato que deveria', 'zap', 'preco', chipsP('preco'))}
      ${cartao('ps-c-amar', soma('desativar'), 'Sem estoque: desativar', 'Estão no catálogo e não vieram no PDF de hoje', 'zap', 'desativar', chipsP('desativar') + (exemplos.length ? `<span class="ps-sub">${exemplos.map(x => `${esc(x.nome)}: ativo em ${x.contas.map(esc).join(' e ')}`).join('<br>')}</span>` : ''))}
      ${cartao('ps-c-azul', soma('reativar'), 'Voltaram: reativar', 'Estavam desativados e voltaram no PDF', 'zap', 'reativar', chipsP('reativar'))}
      ${soma('adicionar') ? cartao('ps-c-verde', soma('adicionar'), 'Adicionar no WhatsApp', 'Estão no PDF e no CTW, mas não no catálogo', 'zap', 'adicionar', chipsP('adicionar')) : ''}
      ${cartaoWhats(suspeitas, true)}
      ${faltam.length ? cartao('ps-c-neutro', faltam.length, 'Produtos do CTW sem correspondência', 'Não achei no Stock 2.0 · o preço não foi mexido', 'revisar') : ''}
      ${poolPdf.length ? cartao('ps-c-neutro', poolPdf.length, 'Itens do Stock 2.0 que não estão no CTW', 'Dá para adicionar ao CTW, se quiser', 'adicionar') : ''}
      ${duvCat ? cartao('ps-c-neutro', duvCat, 'Nomes duvidosos do catálogo', 'O app pergunta uma vez e decora', 'catperguntas') : ''}
      ${semCat.map(id => `<div class="ps-aviso-card"><b>${esc(APR.contas[id].nome)}: ${APR.contas[id].catalogo ? 'catálogo antigo' : 'sem catálogo'}</b><span>${APR.contas[id].catalogo ? `ZIP ${idadeTxt(APR.contas[id].catalogo)}: envie um novo para os avisos ficarem confiáveis.` : 'Envie o ZIP para essa conta receber aviso de esgotado.'}</span></div>`).join('')}
      <details class="ps-det"><summary>Detalhes da importação</summary>
        <div class="ps-lin"><span>Atualizados sem perguntar</span><b>${S.aplicados.filter(x => x.origem === 'igual' || x.origem === 'aprendido').length}</b></div>
        <div class="ps-lin"><span>Atualizados após sua confirmação</span><b>${S.aplicados.filter(x => x.origem === 'confirmado' || x.origem === 'vinculo').length}</b></div>
        <div class="ps-lin"><span>Nomes ligados novos</span><b>${S.novosAliases.length}</b></div>
        ${S.criados ? `<div class="ps-lin"><span>Produtos adicionados ao CTW</span><b>${S.criados}</b></div>` : ''}
        ${S.excluidos ? `<div class="ps-lin"><span>Produtos excluídos do CTW</span><b>${S.excluidos}</b></div>` : ''}
        <div class="ps-lin"><span>Já estavam com o preço certo</span><b>${S.mud.filter(x => !x.mudou && !x.invalido).length}</b></div>
        ${S.pulados.length ? `<div class="ps-lin"><span>Variação grande, não aplicada</span><b>${S.pulados.length}</b></div>` : ''}
        ${S.mexidos.length ? `<div class="ps-lin"><span>Alterados por outra pessoa durante a importação</span><b>${S.mexidos.length}</b></div>` : ''}
      </details>
      <button type="button" class="ps-btn ps-prim ps-grande" data-act="zap">Ver o que fazer no WhatsApp</button>
      <button type="button" class="ps-btn ps-suave" data-act="fechar">Fechar</button>`);
}

// ── Revisão manual: produto do CTW → item do Stock 2.0 ──────────
function proximoCtw() {
    const fila = ctwSemPdf();
    if (S.vinculo && S.vinculo.c && fila[0] && fila[0].id !== S.vinculo.c.id) S.confirmaTodos = false;
    if (!fila.length) { S.vinculo = null; return telaRelatorio(); }
    const c = fila[0];
    if (S.maisPara !== c.id) { S.maisOpc = false; S.maisPara = c.id; }
    S.fase = 'ctw'; TELA = 'revisar'; titulo('Qual item do Stock 2.0?');
    const pool = S.cl.semCtw.concat(S.fila).filter(r => !S.vinculados || !S.vinculados.has(r.i));
    const cands = pool.map(r => ({ r, s: similaridade(r.an.nucleo, c.an.nucleo), d: diferencas(r.an, c.an) }))
        .filter(x => x.s >= LIMIAR_VINCULO)
        .sort((a, b) => (a.d.some(z => z.forte) - b.d.some(z => z.forte)) || b.s - a.s).slice(0, 4);
    S.vinculo = { c, pool, sel: null };
    tela(`
      <div class="ps-prog">${fila.length} produto(s) do CTW sem correspondência</div>
      <div class="ps-card"><div class="ps-cap">No CTW</div><div class="ps-nome">${esc(c.nome)}</div><div class="ps-valor">${brl(c.valor)}</div></div>
      <div class="ps-cap ps-esp">Qual item do Stock 2.0 é esse produto?</div>
      ${cands.map(x => botaoPdf(x.r, c, x.d)).join('') || '<div class="ps-cap">Nenhuma sugestão parecida.</div>'}
      <div class="ps-busca"><input type="search" id="psBuscaPdf" placeholder="Buscar na lista do Stock 2.0…" autocomplete="off"></div>
      <div id="psBuscaRes"></div>
      <button type="button" class="ps-btn ps-prim" data-act="pularctw">Pular por agora</button>
      <button type="button" class="ps-btn" data-act="emfalta">Sem estoque agora</button>
      <div class="ps-sub ps-centro">“Sem estoque agora” esconde este produto por ${DIAS_EM_FALTA} dias.</div>
      <button type="button" class="ps-btn ps-suave" data-act="maisopc">Mais opções ${S.maisOpc ? '⌃' : '›'}</button>
      ${S.maisOpc ? `${fila.length > 1 ? `<button type="button" class="ps-btn${S.confirmaTodos ? ' ps-perigo' : ''}" data-act="emfaltatodos">${S.confirmaTodos ? `Confirmar: ${fila.length} produtos sem estoque agora` : `Marcar os ${fila.length} restantes como sem estoque`}</button>` : ''}
      <button type="button" class="ps-btn ps-perigo" data-act="excluirctw">Não trabalhamos mais (excluir do CTW)</button>
      <button type="button" class="ps-btn ps-suave" data-act="relatorio">Voltar ao resultado</button>` : ''}`);
}

function botaoPdf(r, c, d) {
    return `<button type="button" class="ps-cand" data-act="escolherpdf" data-i="${r.i}"><span class="ps-nome">${esc(r.nome)}</span><span class="ps-sub">hoje ${brl(c.valor)} → ${brl(r.valor)}</span><span class="ps-chips">${d.map(z => chip(z.t, z.forte)).join('')}</span></button>`;
}

function resultadoBuscaPdf(q) {
    const box = overlay.querySelector('#psBuscaRes'); if (!box) return;
    const t = semAcento(q).toUpperCase().split(/\s+/).filter(Boolean);
    if (!t.length) { box.innerHTML = ''; return; }
    const { c, pool } = S.vinculo;
    const lista = pool.filter(r => !(S.vinculados && S.vinculados.has(r.i)) && t.every(w => semAcento(r.nome).toUpperCase().includes(w))).slice(0, 8);
    box.innerHTML = lista.map(r => botaoPdf(r, c, diferencas(r.an, c.an))).join('') || '<div class="ps-cap">Nada encontrado.</div>';
}

function telaConfirmarVinculo(r) {
    const c = S.vinculo.c;
    const pct = c.valor > 0 ? (r.valor - c.valor) / c.valor : null;
    const sus = pct !== null && Math.abs(pct) > LIMITE_SUSPEITO;
    const d = diferencas(r.an, c.an);
    S.vinculo.sel = r;
    tela(`
      <div class="ps-card"><div class="ps-cap">CTW</div><div class="ps-nome">${esc(c.nome)}</div>
        <div class="ps-cap ps-esp">Stock 2.0</div><div class="ps-nome">${esc(r.nome)}</div>
        <div class="ps-valor">${brl(c.valor)} → ${brl(r.valor)}${pct === null ? '' : ` (${pct > 0 ? '+' : ''}${(pct * 100).toFixed(0)}%)`}</div>
        <div class="ps-chips">${d.map(z => chip(z.t, z.forte)).join('')}</div>
        ${sus ? '<div class="ps-aviso">Variação grande. Confira antes de confirmar.</div>' : ''}</div>
      <button type="button" class="ps-btn ps-prim" data-act="vincular">${igual(c.valor, r.valor) ? 'Vincular (preço já igual)' : (sus ? 'Vincular e atualizar mesmo assim' : 'Vincular e atualizar preço')}</button>
      <button type="button" class="ps-btn ps-suave" data-act="revisar">Voltar</button>`);
}

// ── Adicionar ao CTW um item do Stock 2.0 que não existe lá ──────
function poolSemCtw() {
    return S.cl.semCtw.concat(S.fila).filter(r => !(S.vinculados && S.vinculados.has(r.i)));
}

function listaAdicionar(q) {
    const t = semAcento(q || '').toUpperCase().split(/\s+/).filter(Boolean);
    const lista = poolSemCtw().filter(r => t.every(w => semAcento(r.nome).toUpperCase().includes(w)));
    return (lista.slice(0, 60).map(r => `
      <div class="ps-it"><div class="ps-grow"><div class="ps-nome">${esc(r.nome)}</div><div class="ps-sub">${brl(r.valor)}</div></div>
        <button type="button" class="ps-mini" data-act="addform" data-i="${r.i}">Adicionar</button></div>`).join('')
        || '<div class="ps-msg">Nada por aqui.</div>')
        + (lista.length > 60 ? `<div class="ps-cap">Mostrando 60 de ${lista.length}. Use a busca.</div>` : '');
}

function telaAdicionar() {
    S.vinculo = null; TELA = 'adicionar'; titulo('Adicionar ao CTW');
    tela(`
      <div class="ps-prog">Itens do Stock 2.0 que não existem no CTW (${poolSemCtw().length})</div>
      <div class="ps-busca"><input type="search" id="psBuscaAdd" placeholder="Buscar…" autocomplete="off"></div>
      <div id="psAddRes" class="ps-col">${listaAdicionar('')}</div>
      <button type="button" class="ps-btn ps-suave" data-act="relatorio">Voltar ao resultado</button>`);
}

function telaFormAdicionar(r, origem) {
    S.addSel = r; S.addOrigem = origem || 'lista';
    tela(`
      <div class="ps-card"><div class="ps-cap">No Stock 2.0</div><div class="ps-nome">${esc(r.nome)}</div><div class="ps-valor">${brl(r.valor)}</div></div>
      <div class="ps-cap ps-esp">Nome no CTW (pode ajustar)</div>
      <div class="ps-busca"><input type="text" id="psNomeNovo" value="${esc(r.nome)}" maxlength="120" autocomplete="off"></div>
      <div class="ps-cap ps-esp">Valor no CTW</div>
      <div class="ps-busca"><input type="text" id="psValorNovo" inputmode="decimal" value="${esc(r.valor.toFixed(2).replace('.', ','))}" autocomplete="off"></div>
      <div class="ps-sub">O app lembra que esse nome do CTW é o mesmo produto do Stock 2.0, então nas próximas importações o preço atualiza sozinho. Entra com quantidade 0 e sem cor.</div>
      <button type="button" class="ps-btn ps-prim" data-act="addconfirmar">Adicionar ao CTW</button>
      <button type="button" class="ps-btn ps-suave" data-act="${S.addOrigem === 'pergunta' ? 'voltarpergunta' : 'adicionar'}">Voltar</button>`);
}

async function adicionarProduto(r, nome, valorTxt) {
    nome = String(nome || '').replace(/\s+/g, ' ').trim();
    if (!nome) throw new Error('Digite o nome do produto.');
    const igualNome = semAcento(nome).toLowerCase();
    if ((window.products || []).some(p => semAcento(p.nome || '').toLowerCase().trim() === igualNome)) throw new Error('Já existe um produto com esse nome no CTW. Ajuste o nome ou use “Mesmo produto” na importação.');
    const valor = parseFloat(String(valorTxt == null ? r.valor : valorTxt).replace(/R\$|\s/g, '').replace(/\./g, '').replace(',', '.'));
    if (!(valor > 0)) throw new Error('Digite um valor válido (maior que zero).');
    const db = getDb();
    const id = push(ref(db, 'products')).key;
    const upd = { [`products/${id}`]: { nome, valor: Math.round(valor * 100) / 100, quantidade: 0, cores: [], ignorarContagem: false, tag: 'Nenhuma' } };
    const val = { pid: id, nomeEstoque: r.nome, nomeCtw: nome, codigo: r.codigo || '', spec: assinatura(r.an), quando: Date.now() };
    upd[`${BASE}/aliases/${chaveNome(r.an)}`] = val;
    upd[`${BASE}/ignoradosPdf/${chaveNome(r.an)}`] = null;
    if (r.codigo) { upd[`${BASE}/aliases/${chaveCodigo(r.codigo)}`] = val; upd[`${BASE}/ignoradosPdf/${chaveCodigo(r.codigo)}`] = null; }
    await update(ref(db), upd);
    APR.aliases[chaveNome(r.an)] = val;
    S.cl.reivindicado.set(id, r);
    (S.vinculados = S.vinculados || new Set()).add(r.i);   // sai da lista de "não existe no CTW"
    S.criados = (S.criados || 0) + 1;
}

// ── Excluir do CTW um produto que não está no Stock 2.0 ─────────
function telaExcluirCtw() {
    const c = S.vinculo.c;
    tela(`
      <div class="ps-card"><div class="ps-cap">Não trabalhamos mais — excluir do CTW</div><div class="ps-nome">${esc(c.nome)}</div><div class="ps-valor">${brl(c.valor)}</div>
        <div class="ps-aviso">O produto é apagado do CTW (estoque, busca e vendas). Isso não dá para desfazer por aqui.</div></div>
      <button type="button" class="ps-btn ps-perigo" data-act="excluirctw2">Sim, excluir definitivamente</button>
      <button type="button" class="ps-btn ps-suave" data-act="revisar">Cancelar</button>`);
}

async function marcarCtw(c, dias) {
    const val = { nome: c.nome, quando: Date.now(), ate: Date.now() + dias * 86400000 };
    await update(ref(getDb()), { [`${BASE}/ignoradosCtw/${c.id}`]: val });
    APR.ignoradosCtw[c.id] = val;
}

async function excluirProduto(c) {
    const upd = { [`products/${c.id}`]: null, [`${BASE}/ignoradosCtw/${c.id}`]: null };
    for (const [k, v] of Object.entries(APR.aliases)) if (v && v.pid === c.id) upd[`${BASE}/aliases/${k}`] = null;
    await update(ref(getDb()), upd);
    S.cl.reivindicado.set(c.id, { excluido: true });       // some da fila de revisão
    S.excluidos = (S.excluidos || 0) + 1;
}

// ── Avançado ────────────────────────────────────────────────────
async function telaAvancado() {
    TELA = 'avancado'; titulo('Avançado');
    try { await carregarAprendizado(); } catch (e) { return tela(`<div class="ps-msg ps-erro">${esc(e.message)}</div>`); }
    const nLig = new Set(Object.values(APR.aliases).map(v => v.pid + '|' + v.nomeEstoque)).size + Object.keys(APR.catAliases).length;
    const nFix = Object.values(APR.contas).reduce((t, c) => t + Object.keys(c.fixos || {}).length, 0);
    const nIg = Object.keys(APR.ignoradosPdf).length + Object.keys(APR.ignoradosCtw).length + Object.keys(APR.catIgnorados).length + Object.keys(APR.naoWhats).length;
    const nomes = Object.values(APR.contas).map(c => c.nome).join(', ');
    const lin = (act, tit, sub) => `<button type="button" class="ps-resumo" data-act="${act}"><span class="ps-grow"><b>${tit}</b><span class="ps-sub">${sub}</span></span><span class="ps-seta">›</span></button>`;
    tela(`
      <div class="ps-sub">Coisas que você quase não usa. Nada daqui atrapalha o dia a dia.</div>
      ${lin('avcontas', 'Contas de WhatsApp', `${esc(nomes)} · criar, renomear`)}
      <div class="ps-resumo"><span class="ps-grow"><b>Extra à vista</b><span class="ps-sub">Preço do catálogo = valor do CTW + extra</span></span>
        <input type="text" id="psCatExtra" class="ps-inp ps-extra" inputmode="decimal" value="${esc(String(catExtra()).replace('.', ','))}" aria-label="Extra à vista em reais"></div>
      ${lin('vinculos', 'Nomes ligados', `${nLig} · buscar, desligar o que ficou errado`)}
      ${lin('avignorados', 'Sem estoque e ignorados', nIg ? `${nIg} · voltar a perguntar em massa` : 'Nada marcado')}
      ${lin('avfixos', 'Preços mantidos de propósito', nFix ? `${nFix} produto(s) · voltar a avisar` : 'Nenhum')}
      ${lin('avprints', 'Catálogo por prints', 'Só se você não tiver o ZIP')}
      ${lin('avhist', 'Histórico', 'Importações de preço e o que foi feito no WhatsApp')}`);
}

async function telaAvContas(msg) {
    TELA = 'av-contas'; titulo('Contas de WhatsApp');
    try { await carregarAprendizado(); } catch (e) { return tela(`<div class="ps-msg ps-erro">${esc(e.message)}</div>`); }
    tela(`${msg ? `<div class="ps-msg">${esc(msg)}</div>` : ''}
      <div class="ps-sub">Cada conta tem catálogo, avisos e histórico próprios. O PDF do Stock 2.0 vale para todas.</div>
      ${Object.entries(APR.contas).map(([id, c]) => `<div class="ps-card">
        <div class="ps-nome">${esc(c.nome)}</div>
        <div class="ps-sub">${c.catalogo ? `ZIP ${idadeTxt(c.catalogo)}` : 'Sem catálogo'} · ${totalPend(id)} pendência(s)${id === 'loja' ? ' · conta original' : ''}</div>
        <div class="ps-busca"><input type="text" id="psRen-${esc(id)}" value="${esc(c.nome)}" maxlength="30" autocomplete="off"></div>
        <button type="button" class="ps-btn" data-act="renomear" data-id="${esc(id)}">Salvar novo nome</button>
        ${id === 'loja' ? '' : `<button type="button" class="ps-btn ps-suave" data-act="excluirconta" data-id="${esc(id)}">Excluir esta conta…</button>`}
      </div>`).join('')}
      <div class="ps-card"><div class="ps-nome">Nova conta</div>
        <div class="ps-busca"><input type="text" id="psNovaConta" placeholder="Nome (ex.: Colega)" maxlength="30" autocomplete="off"></div>
        <button type="button" class="ps-btn ps-prim" data-act="criarconta">Criar conta</button></div>`);
}

function telaAvExcluirConta(id) {
    TELA = 'av-contas'; const c = APR.contas[id]; if (!c) return telaAvContas();
    tela(`<div class="ps-card"><div class="ps-cap">Excluir conta</div><div class="ps-nome">${esc(c.nome)}</div>
      <div class="ps-aviso">Apaga o catálogo, as pendências e o histórico dessa conta. Os produtos do CTW e os nomes ligados não são mexidos. Não dá para desfazer.</div></div>
      <button type="button" class="ps-btn ps-perigo" data-act="excluirconta2" data-id="${esc(id)}">Sim, excluir ${esc(c.nome)}</button>
      <button type="button" class="ps-btn ps-suave" data-act="avcontas">Cancelar</button>`);
}

async function telaAvIgnorados() {
    TELA = 'av-ign'; titulo('Sem estoque e ignorados');
    try { await carregarAprendizado(); } catch (e) { return tela(`<div class="ps-msg ps-erro">${esc(e.message)}</div>`); }
    const bloco = (n, tit, sub, act) => `<div class="ps-card"><div class="ps-lin"><span>${tit}</span><b>${n}</b></div><div class="ps-sub">${sub}</div>${n ? `<button type="button" class="ps-btn" data-act="${act}">Voltar a perguntar (${n})</button>` : ''}</div>`;
    tela(`
      ${bloco(Object.keys(APR.ignoradosCtw).length, 'Produtos do CTW “sem estoque agora”', 'Voltam sozinhos depois de ' + DIAS_EM_FALTA + ' dias.', 'esquecerctw')}
      ${bloco(Object.keys(APR.ignoradosPdf).length, 'Itens do Stock 2.0 “não existe no CTW”', 'O app não pergunta mais sobre eles.', 'esquecerpdf')}
      ${bloco(Object.keys(APR.naoWhats).length, 'Produtos “não vou colocar no WhatsApp”', 'O app não cobra adicionar nenhuma conta.', 'esquecernw')}
      ${bloco(Object.keys(APR.catIgnorados).length, 'Itens do catálogo “não é do CTW”', 'O app não pergunta mais sobre eles.', 'esquecercat')}`);
}

async function telaAvFixos() {
    TELA = 'av-fixos'; titulo('Preços mantidos');
    try { await carregarAprendizado(); } catch (e) { return tela(`<div class="ps-msg ps-erro">${esc(e.message)}</div>`); }
    const multi = Object.keys(APR.contas).length > 1;
    const blocos = Object.entries(APR.contas).map(([cid, c]) => {
        const l = Object.entries(c.fixos || {});
        return l.length ? (multi ? `<div class="ps-cap ps-esp">${esc(c.nome)} · ${l.length}</div>` : '') + l.map(([id, f]) => `<div class="ps-it"><div class="ps-grow"><div class="ps-nome">${esc(f.nome)}</div><div class="ps-sub">Catálogo fica em ${brl(f.preco)} (CTW ${brl(f.ctw)}) · avisa se o CTW mudar</div></div><button type="button" class="ps-mini" data-act="fixodesfazer" data-conta="${esc(cid)}" data-id="${esc(id)}">Voltar a avisar</button></div>`).join('') : '';
    }).join('');
    tela(`<div class="ps-sub">Produtos que você deixou com o preço do WhatsApp diferente de propósito. O app só avisa de novo se o valor no CTW mudar.</div>${blocos || '<div class="ps-msg">Nenhum preço mantido.</div>'}`);
}

function telaAvPrints() {
    TELA = 'av-prints'; titulo('Catálogo por prints');
    tela(`
      <div class="ps-sub">Use só se você não tiver o ZIP. Os prints são lidos por IA e podem ter erros; o ZIP é exato.</div>
      ${Object.keys(APR.contas).length > 1 ? `<div class="ps-cap">Prints de qual conta?</div>${chipsContas(false)}` : ''}
      <div class="ps-card"><div class="ps-nome">Prints do catálogo de ${esc(APR.contas[CONTA].nome)}</div>
        <div class="ps-sub">Até ${CAT_MAX_PRINTS} imagens por vez, mostrando a lista de produtos com preço.</div>
        <label class="ps-btn ps-prim ps-lbl"><input type="file" id="psPrints" accept="image/*" multiple hidden>Escolher prints</label></div>`);
}

async function telaAvHist() {
    TELA = 'av-hist'; titulo('Histórico');
    tela('<div class="ps-msg">Carregando…</div>');
    let logs, zl;
    try { await carregarAprendizado(); const db = getDb(); logs = (await get(ref(db, BASE + '/log'))).val() || {}; zl = (await get(ref(db, raiz() + '/zapLog'))).val() || {}; }
    catch (e) { return tela(`<div class="ps-msg ps-erro">${esc(e.message)}</div>`); }
    const quando = t => new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const imp = Object.entries(logs).sort((a, b) => b[0].localeCompare(a[0]));
    const rot = { preco: 'Preço corrigido', desativar: 'Desativado', reativar: 'Reativado', adicionar: 'Adicionado ao catálogo', naovou: 'Não vou colocar no WhatsApp', fixo: 'Mantido de propósito' };
    const h = Object.values(zl).sort((a, b) => (b.quando || 0) - (a.quando || 0));
    tela(`
      <div class="ps-cap">Importações de preço no CTW</div>
      ${imp.map(([id, v]) => `<div class="ps-it"><div class="ps-grow"><div class="ps-nome">${esc(v.arquivo || (v.tipo === 'vinculo' ? 'Vínculo manual' : 'Importação'))}</div>
        <div class="ps-sub">${Object.keys(v.itens || {}).length} preço(s) · ${quando(v.quando)}${v.usuario ? ' · ' + esc(v.usuario) : ''}${v.desfeito ? ' · desfeita' : ''}</div></div>
        ${v.desfeito ? '' : `<button type="button" class="ps-mini" data-act="desfazer" data-id="${esc(id)}">Desfazer</button>`}</div>`).join('') || '<div class="ps-msg">Nenhuma importação ainda.</div>'}
      <div class="ps-cap ps-esp">Feito no WhatsApp</div>
      ${Object.keys(APR.contas).length > 1 ? chipsContas(false) : ''}
      ${h.map(x => `<div class="ps-it"><div class="ps-grow"><div class="ps-nome">${esc(x.nome || '')}</div>
        <div class="ps-sub">${rot[x.tipo] || esc(x.tipo)}${x.tipo === 'preco' ? `: ${brl(x.de)} → ${brl(x.para)}` : x.tipo === 'fixo' ? `: catálogo ${brl(x.de)} (o certo seria ${brl(x.para)})` : ''}</div>
        <div class="ps-sub">${x.quando ? quando(x.quando) : ''}${x.usuario ? ' · ' + esc(x.usuario) : ''}</div></div></div>`).join('') || `<div class="ps-msg">Ainda não há histórico. Guarda as últimas ${MAX_ZAPLOG} ações.</div>`}`);
}

async function telaVinculos() {
    TELA = 'av-vinc'; titulo('Nomes ligados');
    tela('<div class="ps-msg">Carregando…</div>');
    try { await carregarAprendizado(); } catch (e) { tela(`<div class="ps-msg ps-erro">${esc(e.message)}</div>`); return; }
    const vistos = new Set();
    const al = Object.entries(APR.aliases).filter(([k, v]) => { const id = v.pid + '|' + v.nomeEstoque; if (vistos.has(id)) return false; vistos.add(id); return true; });
    const nomeCtw = pid => { const c = (window.products || []).find(x => x && x.id === pid); return c ? c.nome : '(produto removido do CTW)'; };
    const nomesCat = {};      // nome original do WhatsApp, quando algum catálogo guardado ainda o tem
    Object.values(APR.contas).forEach(c => Object.values((c.catalogo && c.catalogo.itens) || {}).forEach(x => { try { nomesCat[chaveNome(analisar(x.n))] = x.n; } catch (e) {} }));
    const bonito = (k, v) => v.n || nomesCat[k] || k.replace(/^n/, '').replace(/_/g, ' ').replace(/\bS0\b|\bR0\b/g, '').replace(/\bS(\d+)\b/g, '$1GB').replace(/\bR(\d+)\b/g, '$1GB RAM').replace(/\s+/g, ' ').trim();
    const catVinc = Object.entries(APR.catAliases).sort((a, b) => nomeCtw(a[1].pid).localeCompare(nomeCtw(b[1].pid)));
    tela(`
      <div class="ps-sub">Cada nome diferente de um mesmo produto fica ligado a ele. Desligue só o que ficou errado: o app volta a perguntar na próxima vez.</div>
      <input type="search" id="psBuscaVinc" class="ps-inp ps-busca" placeholder="Buscar (nome do WhatsApp, Stock 2.0 ou CTW)…">
      ${catVinc.length ? `<div class="ps-cap ps-esp">Nomes do WhatsApp (${catVinc.length})</div>` + catVinc.map(([k, v]) => `<div class="ps-it" data-q="${esc(norm(bonito(k, v) + ' ' + nomeCtw(v.pid)))}"><div class="ps-grow"><div class="ps-nome">${esc(bonito(k, v))}</div><div class="ps-sub">= ${esc(nomeCtw(v.pid))}</div></div><button type="button" class="ps-mini" data-act="rmcatvin" data-k="${esc(k)}">Desligar</button></div>`).join('') : ''}
      <div class="ps-cap ps-esp">Nomes do Stock 2.0 (${al.length})</div>
      ${al.map(([k, v]) => `<div class="ps-it" data-q="${esc(norm(v.nomeEstoque + ' ' + v.nomeCtw))}"><div class="ps-grow"><div class="ps-nome">${esc(v.nomeEstoque)}</div><div class="ps-sub">= ${esc(v.nomeCtw)}</div></div><button type="button" class="ps-mini" data-act="rmvinculo" data-pid="${esc(v.pid)}" data-nome="${esc(v.nomeEstoque)}">Desligar</button></div>`).join('') || '<div class="ps-msg">Nenhum nome ligado ainda.</div>'}`);
}

async function removerVinculo(pid, nomeEstoque) {
    const upd = {};
    for (const [k, v] of Object.entries(APR.aliases)) if (v.pid === pid && v.nomeEstoque === nomeEstoque) upd[`${BASE}/aliases/${k}`] = null;
    if (Object.keys(upd).length) await update(ref(getDb()), upd);
}

async function desfazer(id) {
    tela('<div class="ps-msg">Desfazendo…</div>');
    try {
        const snap = await get(ref(getDb(), `${BASE}/log/${id}`));
        const log = snap.val();
        if (!log || log.desfeito) throw new Error('Essa importação já foi desfeita.');
        const atuais = new Map((window.products || []).map(p => [p.id, valorCtw(p)]));
        const upd = {}; let ok = 0, mexidos = 0;
        for (const [pid, it] of Object.entries(log.itens || {})) {
            if (!atuais.has(pid)) continue;
            if (!igual(atuais.get(pid), it.para)) { mexidos++; continue; }   // alguém mudou depois: não sobrescreve
            upd[`products/${pid}/valor`] = it.de; ok++;
        }
        upd[`${BASE}/log/${id}/desfeito`] = Date.now();
        const nomes = new Map((window.products || []).map(p => [p.id, p.nome || '']));
        const lista = Object.entries(log.itens || {}).filter(([pid]) => upd[`products/${pid}/valor`] !== undefined).map(([pid, it]) => ({ id: pid, nome: nomes.get(pid), de: it.para, para: it.de }));
        await carregarAprendizado();
        for (const cid of Object.keys(APR.contas)) {
            const zap = (await get(ref(getDb(), raiz(cid) + '/zap'))).val() || {};
            Object.assign(upd, window.ctwZapCalcular(zap, lista, usuario(), raiz(cid) + '/zap'));
        }
        await update(ref(getDb()), upd);
        tela(`<div class="ps-card ps-ok"><b>Importação desfeita</b><div class="ps-lin"><span>Preços restaurados</span><b>${ok}</b></div>${mexidos ? `<div class="ps-lin"><span>Mantidos (já tinham sido alterados depois)</span><b>${mexidos}</b></div>` : ''}</div><button type="button" class="ps-btn" data-act="inicio">Voltar</button>`);
    } catch (e) {
        tela(`<div class="ps-msg ps-erro">${esc(e.message)}</div><button type="button" class="ps-btn" data-act="inicio">Voltar</button>`);
    }
}

// ── Cliques ─────────────────────────────────────────────────────
function voltar() {
    if (TELA === 'hub') return fechar();
    if (TELA.startsWith('av-')) return telaAvancado();
    if ((TELA === 'revisar' || TELA === 'adicionar') && S && S.aplicados) return telaRelatorio();
    return telaInicio();
}

// Executa uma ação da lista "Fazer no WhatsApp" e oferece "Desfazer" por 6 segundos
async function acaoLista(act, id) {
    const cid = CONTA, R = raiz(cid), db = getDb(), pz = `${R}/zap/${id}`, pe = `${R}/esg/${id}`, pf = `${R}/fixos/${id}`, pn = `${BASE}/naoWhats/${id}`;
    const todosEsg = Object.keys(APR.contas).map(c => `${raiz(c)}/esg/${id}`);
    const antes = {};
    for (const k of new Set([pz, pe, pf, pn, ...todosEsg])) antes[k] = (await get(ref(db, k))).val();
    const z = antes[pz], e = antes[pe], upd = {}, extra = catExtra();
    let log = null, nome = '';
    if (act === 'zapok' && z) { nome = z.nome; upd[pz] = null; log = { tipo: 'preco', nome: z.nome || '', de: (z.de || 0) + extra, para: (z.para || 0) + extra }; }
    else if (act === 'zapfixo' && z) {
        nome = z.nome; upd[pf] = { nome: z.nome || '', preco: Math.round((z.de + extra) * 100) / 100, ctw: z.para, extra, quando: Date.now(), usuario: usuario() }; upd[pz] = null;
        log = { tipo: 'fixo', nome: z.nome || '', de: z.de + extra, para: z.para + extra };
    }
    else if (act === 'esgdesativei' && e && e.estado === 'desativar') { nome = e.nome; upd[pe] = { ...e, estado: 'desativado', desde: Date.now() }; log = { tipo: 'desativar', nome: e.nome || '' }; }
    else if (act === 'esgreativei' && e && e.estado === 'reativar') { nome = e.nome; upd[pe] = null; log = { tipo: 'reativar', nome: e.nome || '' }; }
    else if (act === 'esgadicionei' && e && e.estado === 'adicionar') { nome = e.nome; upd[pe] = null; log = { tipo: 'adicionar', nome: e.nome || '', para: e.preco }; }
    else if (act === 'esgnaovou' && e && e.estado === 'adicionar') {      // vale para todas as contas
        nome = e.nome; upd[pn] = { nome: e.nome || '', quando: Date.now(), usuario: usuario() };
        todosEsg.forEach(k => { if (antes[k] && antes[k].estado === 'adicionar') upd[k] = null; });
        log = { tipo: 'naovou', nome: e.nome || '' };
    }
    else if (act === 'esgainda' && e && e.estado === 'desativar') { nome = e.nome; upd[pe] = { ...e, estado: 'ainda', ate: Date.now() + DIAS_AINDA_TEM * 86400000 }; }
    else return telaZap(S_zapAba);               // outra pessoa já resolveu esse item
    const desfeito = Object.keys(upd).reduce((o, k) => (o[k] = antes[k] === undefined ? null : antes[k], o), {});
    const key = log ? await logZap(log, upd, cid) : null;
    await update(ref(db), upd);
    await telaZap(S_zapAba);
    toast(`Feito: ${nome || 'item'}`, async () => {
        if (key) desfeito[`${R}/zapLog/${key}`] = null;
        await update(ref(db), desfeito);
        await telaZap(S_zapAba);
    });
}

async function aoClicar(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    try {
        if (act === 'fechar') return fechar();
        if (act === 'voltar') return voltar();
        if (act === 'inicio') return telaInicio();
        if (act === 'avancado') return telaAvancado();
        if (act === 'enviar') return telaEnviar();
        if (act === 'vinculos') return telaVinculos();
        if (act === 'avcontas') return telaAvContas();
        if (act === 'avignorados') return telaAvIgnorados();
        if (act === 'avfixos') return telaAvFixos();
        if (act === 'avprints') return telaAvPrints();
        if (act === 'avhist') return telaAvHist();
        if (act === 'desfazer') return desfazer(b.dataset.id);
        if (act === 'toastdesfazer') {
            const f = _toastFn; _toastFn = null; clearTimeout(_toastT);
            const t = overlay.querySelector('.ps-toast'); if (t) t.remove();
            if (f) await f();
            return;
        }
        if (act === 'mais') { const m = b.closest('.ps-lc'), menu = m && m.querySelector('.ps-menu'); if (menu) menu.hidden = !menu.hidden; return; }
        if (act === 'rmvinculo') { await removerVinculo(b.dataset.pid, b.dataset.nome); return telaVinculos(); }
        if (act === 'rmcatvin') { const k = b.dataset.k; await update(ref(getDb()), { [`${BASE}/catAliases/${k}`]: null }); delete APR.catAliases[k]; return telaVinculos(); }
        if (act === 'esquecercat') { await update(ref(getDb()), { [`${BASE}/catIgnorados`]: null }); APR.catIgnorados = {}; return telaAvIgnorados(); }
        if (act === 'esquecernw') { await update(ref(getDb()), { [`${BASE}/naoWhats`]: null }); APR.naoWhats = {}; return telaAvIgnorados(); }
        if (act === 'esquecerctw') { await update(ref(getDb()), { [`${BASE}/ignoradosCtw`]: null }); APR.ignoradosCtw = {}; return telaAvIgnorados(); }
        if (act === 'esquecerpdf') { await update(ref(getDb()), { [`${BASE}/ignoradosPdf`]: null }); APR.ignoradosPdf = {}; return telaAvIgnorados(); }
        if (act === 'analisar') {
            if (!ESC_.pdf && !Object.keys(ESC_.zips).length) return;
            extraDoCampo();
            b.disabled = true;
            return analisarTudo();
        }
        if (act === 'conta') {
            usarConta(b.dataset.id);
            if (TELA === 'zap') return telaZap(S_zapAba);
            if (TELA === 'av-prints') return telaAvPrints();
            if (TELA === 'av-hist') return telaAvHist();
            return telaInicio();
        }
        if (act === 'criarconta') {
            const i = overlay.querySelector('#psNovaConta');
            if (!i || !i.value.trim()) throw new Error('Digite o nome da conta.');
            await criarConta(i.value); return telaAvContas('Conta criada.');
        }
        if (act === 'renomear') {
            const i = overlay.querySelector(`[id="psRen-${b.dataset.id}"]`);
            if (!i || !i.value.trim()) throw new Error('Digite o nome da conta.');
            await renomearConta(b.dataset.id, i.value); return telaAvContas('Nome salvo.');
        }
        if (act === 'excluirconta') return telaAvExcluirConta(b.dataset.id);
        if (act === 'excluirconta2') { b.disabled = true; await excluirConta(b.dataset.id); return telaAvContas('Conta excluída.'); }
        if (act === 'zapaba') return telaZap(b.dataset.aba);
        if (act === 'zap') {
            let aba = b.dataset.aba;
            if (aba && pend(CONTA)[aba] === 0) { const o = Object.keys(APR.contas).find(id => pend(id)[aba] > 0); if (o) usarConta(o); }
            return telaZap(aba);
        }
        if (act === 'esgaplicar') {
            if (!S) return;
            b.disabled = true;
            const cid = b.dataset.conta, e = S.esg[cid];
            const upd = {}; Object.entries(e.upd).forEach(([pid, v]) => { upd[`${raiz(cid)}/esg/${pid}`] = v; });
            await update(ref(getDb()), upd); aplicarEsgLocal(APR.contas[cid].esg, e.upd);
            S.esg[cid] = { ...e, ...contagemEsg(APR.contas[cid].esg), suspeito: false };
            return telaRelatorio();
        }
        if (act === 'fixodesfazer') {
            b.disabled = true;
            const cid = b.dataset.conta || CONTA, id = b.dataset.id, upd = {}, R = raiz(cid), extra = catExtra();
            const f = ((await get(ref(getDb(), `${R}/fixos/${id}`))).val()) || {};
            upd[`${R}/fixos/${id}`] = null;
            const de = Math.round((f.preco - (f.extra || extra)) * 100) / 100;
            if (f.preco > 0 && f.ctw > 0 && !igual(de, f.ctw)) upd[`${R}/zap/${id}`] = { nome: f.nome || '', de, para: f.ctw, quando: Date.now(), usuario: usuario() };
            await update(ref(getDb()), upd);
            return telaAvFixos();
        }
        if (act === 'zapok' || act === 'zapfixo' || act === 'esgdesativei' || act === 'esgreativei' || act === 'esgainda' || act === 'esgadicionei' || act === 'esgnaovou') {
            b.disabled = true;
            return acaoLista(act, b.dataset.id);
        }
        if (act === 'catperguntas') return CAT && telaCatPergunta();
        if (act === 'catfim') return catFim();
        if (act === 'catmesmo' || act === 'catnao' || act === 'catdepois') { if (CAT) { b.disabled = true; await catResponder(act, b.dataset.id); } return; }
        if (!S) return;
        if (act === 'maisopc') { S.maisOpc = !S.maisOpc; return S.fase === 'pdf' ? proximaPergunta() : proximoCtw(); }
        if (act === 'mesmo') {
            const r = S.fila[0], c = S.cl.ctw.find(x => x.id === b.dataset.id);
            if (!r || !c || S.cl.reivindicado.has(c.id)) return;
            confirmarVinculo(r, c); S.fila.shift(); return proximaPergunta();
        }
        // "Não existe no CTW" é lembrado (não pergunta mais); "Pular por agora" não grava nada e volta a perguntar
        if (act === 'naoexiste') { const r = S.fila.shift(); S.novosIgnoradosPdf.push(r); S.cl.semCtw.push(r); return proximaPergunta(); }
        if (act === 'pular') { const r = S.fila.shift(); S.cl.semCtw.push(r); return proximaPergunta(); }
        if (act === 'pularresto') { S.pularResto = true; return telaPrevia(); }
        if (act === 'previa') return telaPrevia();
        if (act === 'aplicar') return aplicar();
        if (act === 'relatorio') return telaRelatorio();
        if (act === 'revisar') return proximoCtw();
        if (act === 'adicionar') return telaAdicionar();
        if (act === 'addform') {
            const pergunta = b.dataset.origem === 'pergunta';
            const r = pergunta ? S.fila[0] : poolSemCtw().find(x => String(x.i) === b.dataset.i);
            if (r) telaFormAdicionar(r, pergunta ? 'pergunta' : 'lista');
            return;
        }
        if (act === 'voltarpergunta') return proximaPergunta();
        if (act === 'addconfirmar') {
            const nome = overlay.querySelector('#psNomeNovo').value;
            b.disabled = true;
            await adicionarProduto(S.addSel, nome, overlay.querySelector('#psValorNovo').value);
            if (S.addOrigem === 'pergunta') { S.fila.shift(); return proximaPergunta(); }
            return telaAdicionar();
        }
        if (act === 'excluirctw') return telaExcluirCtw();
        if (act === 'excluirctw2') { b.disabled = true; await excluirProduto(S.vinculo.c); return proximoCtw(); }
        if (act === 'escolherpdf') { const r = S.vinculo.pool.find(x => String(x.i) === b.dataset.i); if (r) telaConfirmarVinculo(r); return; }
        if (act === 'pularctw') { (S.ctwDescartados = S.ctwDescartados || new Set()).add(S.vinculo.c.id); return proximoCtw(); }
        if (act === 'emfaltatodos') {
            if (!S.confirmaTodos) { S.confirmaTodos = true; return proximoCtw(); }
            S.confirmaTodos = false; b.disabled = true;
            const fila = ctwSemPdf(), agora = Date.now(), upd = {};
            fila.forEach(c => { const v = { nome: c.nome, quando: agora, ate: agora + DIAS_EM_FALTA * 86400000 }; upd[`${BASE}/ignoradosCtw/${c.id}`] = v; APR.ignoradosCtw[c.id] = v; });
            if (Object.keys(upd).length) await update(ref(getDb()), upd);
            return proximoCtw();
        }
        if (act === 'emfalta') { await marcarCtw(S.vinculo.c, DIAS_EM_FALTA); return proximoCtw(); }
        if (act === 'vincular') {
            const { c, sel: r } = S.vinculo;
            const para = r.valor, de = c.valor;
            const item = { id: c.id, c, de, para, origem: 'vinculo' };
            const atual = valorCtw((window.products || []).find(p => p.id === c.id) || { valor: de });
            if (!igual(atual, de)) throw new Error('Esse preço foi alterado por outra pessoa agora. Volte e tente de novo.');
            b.disabled = true;
            await gravar(!igual(de, para) && para > 0 ? [item] : [], [{ r, c }], [], S.arquivo, 'vinculo');
            S.cl.reivindicado.set(c.id, r);
            (S.vinculados = S.vinculados || new Set()).add(r.i);
            APR.aliases[chaveNome(r.an)] = { pid: c.id };
            if (!igual(de, para) && para > 0) { c.valor = para; S.aplicados.push(item); }
            S.novosAliases.push({ r, c });
            return proximoCtw();
        }
    } catch (err) {
        if (b) b.disabled = false;
        const c = overlay && overlay.querySelector('#psCorpo');
        if (c) c.insertAdjacentHTML('afterbegin', `<div class="ps-msg ps-erro">${esc(err.message)}</div>`);
    }
}

// ── Conferir catálogo do WhatsApp (prints) ──────────────────────
const CAT_MAX_PX = 1600;
const CAT_MAX_PRINTS = 10;
const CAT_PROMPT = 'Estas imagens são capturas de tela do CATÁLOGO do WhatsApp Business de uma loja de celulares. ' +
    'Leia TODOS os produtos visíveis, com o nome exatamente como aparece e o preço exatamente como escrito. ' +
    'Responda SOMENTE com JSON no formato {"itens":[{"nome":"...","preco":"R$ 1.529,00"}]}. ' +
    'Regras: não invente nem complete nomes; se o mesmo produto aparece em mais de uma imagem (a rolagem repete itens), liste UMA vez; ' +
    'ignore produtos sem preço e textos da interface do WhatsApp.';
let CAT = null;     // { itens, extra, certos, errados, perguntas, semPar, ignorados, feitos:Set, fila }

function catExtra() {
    try {
        const salvo = localStorage.getItem('ctwCatExtra');
        if (salvo !== null && salvo !== '' && isFinite(Number(salvo))) return Number(salvo);
        const e = Number((JSON.parse(localStorage.getItem('ctwAvistaCfg') || '{}') || {}).extra);
        return e > 0 ? e : 30;
    } catch (e) { return 30; }
}

function numero(txt) {
    let t = String(txt == null ? '' : txt).replace(/R\$|\s/g, '');
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    const n = parseFloat(t);
    return isFinite(n) ? n : 0;
}

function imagemBase64(arq) {
    return new Promise((resolve, reject) => {
        const img = new Image(), url = URL.createObjectURL(arq);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const k = Math.min(1, CAT_MAX_PX / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            resolve(c.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui abrir a imagem ' + arq.name)); };
        img.src = url;
    });
}

function interpretarResposta(txt) {
    const i = txt.indexOf('{'), j = txt.lastIndexOf('}');
    if (i < 0 || j <= i) throw new Error('A IA não devolveu a lista de produtos. Tente de novo (prints mais nítidos ajudam).');
    let obj; try { obj = JSON.parse(txt.slice(i, j + 1)); } catch (e) { throw new Error('Não consegui entender a resposta da IA. Tente de novo.'); }
    const vistos = new Set(), itens = [];
    (Array.isArray(obj.itens) ? obj.itens : []).forEach(x => {
        const nome = String((x && x.nome) || '').replace(/\s+/g, ' ').trim(), preco = numero(x && x.preco);
        const k = analisar(nome).key + '|' + preco;
        if (!nome || preco <= 0 || vistos.has(k)) return;
        vistos.add(k); itens.push({ nome, preco, an: analisar(nome), colecao: colecaoDe(nome, '') });
    });
    return itens;
}

function classificarCat(itens, produtos, extra) {
    const ctw = produtos.map(p => ({ p, id: p.id, nome: p.nome || '', valor: valorCtw(p), an: analisar(p.nome || '') }));
    const porId = new Map(ctw.map(c => [c.id, c]));
    const porKey = new Map();
    ctw.forEach(c => { if (!porKey.has(c.an.key)) porKey.set(c.an.key, []); porKey.get(c.an.key).push(c); });
    const out = { certos: [], errados: [], perguntas: [], semPar: [], ignorados: [] };
    itens.forEach((it, i) => {
        it.i = i;
        if (APR.catIgnorados[chaveNome(it.an)]) { out.ignorados.push(it); return; }
        const al = APR.catAliases[chaveNome(it.an)];
        let c = al && porId.has(al.pid) && al.spec === assinatura(it.an) ? porId.get(al.pid) : null;
        if (!c) { const iguais = porKey.get(it.an.key) || []; if (iguais.length === 1) c = iguais[0]; }
        if (c) return out[igual(it.preco, c.valor + extra) ? 'certos' : 'errados'].push({ it, c });
        const cands = candidatos(it, ctw, new Map(), LIMIAR_PERGUNTA);
        (cands.length ? out.perguntas : out.semPar).push(it);
    });
    return { ...out, ctw };
}

async function lerPrints(arquivos) {
    await window.ctwCarregarModulo('creditoscan');
    if (typeof window.ctwIAVisao !== 'function') throw new Error('A leitura por IA não está disponível agora. Abra o CreditoScan uma vez e tente de novo.');
    const content = [];
    for (const f of arquivos) content.push({ type: 'image_url', image_url: { url: await imagemBase64(f) } });
    content.push({ type: 'text', text: CAT_PROMPT });
    return interpretarResposta(await window.ctwIAVisao([{ role: 'user', content }]));
}

// Compara a lista lida (prints ou arquivo) com o CTW e abre o relatório
// Guarda o catálogo lido (produto do CTW → nome e preço no catálogo): é daí que sai o aviso de esgotado.
// ZIP/CSV é exato e substitui tudo; prints podem ser parciais e só acrescentam/atualizam.
async function guardarCatalogo(pares, origem, duv) {
    const db = getDb(), upd = {}, agora = Date.now(), R = raiz(), conta = APR.contas[CONTA];
    const itens = {};
    pares.forEach(({ it, c }) => { itens[c.id] = { n: it.nome, p: it.preco }; });
    if (origem === 'zip') {
        upd[`${R}/catalogo`] = { atualizado: agora, origem, itens, duv: duv || null };
        Object.entries(conta.esg || {}).forEach(([pid, e]) => {            // saiu do catálogo e ninguém desativou: pendência não faz mais sentido
            if (!itens[pid] && (e.estado === 'desativar' || e.estado === 'ainda')) upd[`${R}/esg/${pid}`] = null;
        });
    } else {
        Object.entries(itens).forEach(([pid, v]) => { upd[`${R}/catalogo/itens/${pid}`] = v; });
        upd[`${R}/catalogo/atualizado`] = agora; upd[`${R}/catalogo/origem`] = (conta.catalogo && conta.catalogo.origem) || origem;
    }
    Object.entries(conta.esg || {}).forEach(([pid, e]) => { if (e.estado === 'adicionar' && itens[pid]) upd[`${R}/esg/${pid}`] = null; });   // já entrou no catálogo
    await update(ref(db), upd);
    conta.catalogo = origem === 'zip' ? { atualizado: agora, origem, itens, duv: duv || null } : { atualizado: agora, origem: (conta.catalogo && conta.catalogo.origem) || origem, itens: { ...((conta.catalogo && conta.catalogo.itens) || {}), ...itens } };
    Object.entries(upd).forEach(([k, v]) => { if (v === null && k.includes('/esg/')) delete conta.esg[k.split('/').pop()]; });
    APR.catalogo = conta.catalogo;
}

async function concluirCatalogo(itens, extra, exato, silencioso) {
    const produtos = (window.products || []).filter(p => p && p.id);
    if (!produtos.length) throw new Error('O CTW ainda não carregou os produtos. Aguarde alguns segundos e tente de novo.');
    await carregarAprendizado();
    CAT = { extra, itens, exato: !!exato, feitos: new Set(), ...classificarCat(itens, produtos, extra) };
    CAT.fila = CAT.perguntas.slice();
    const fx = (await get(ref(getDb(), raiz() + '/fixos'))).val() || {};
    CAT.fixos = [];      // preço errado de propósito (e o CTW não mudou desde então): não é para corrigir
    CAT.errados = CAT.errados.filter(x => { if (fixoAtivo(fx[x.c.id], x)) { CAT.fixos.push(x); return false; } return true; });
    if (exato) await zapAlinhar(CAT.certos.concat(CAT.errados, CAT.fixos), extra).catch(e => console.warn('[zap]', e.message));   // arquivo exato: a lista "Alterar no WhatsApp" passa a refletir o catálogo
    const duv = {};      // produtos do CTW que podem ser um item do catálogo ainda sem resposta: não dá para dizer que "faltam"
    CAT.perguntas.forEach(it => candidatos(it, CAT.ctw, new Map(), LIMIAR_PERGUNTA).forEach(x => { duv[x.c.id] = 1; }));
    await guardarCatalogo(CAT.certos.concat(CAT.errados, CAT.fixos), exato ? 'zip' : 'prints', duv).catch(e => console.warn('[catálogo]', e.message));
    if (!silencioso) fimCatalogo();
}

function extraDoCampo() {
    const campo = overlay && overlay.querySelector('#psCatExtra');
    if (campo) { try { localStorage.setItem('ctwCatExtra', String(numero(campo.value))); } catch (x) {} }
    return catExtra();
}

async function aoEscolherPrints(lista) {
    const arquivos = Array.from(lista || []);
    if (!arquivos.length) return;
    try {
        if (arquivos.length > CAT_MAX_PRINTS) throw new Error(`Escolha até ${CAT_MAX_PRINTS} prints por vez.`);
        const extra = extraDoCampo();
        tela(`<div class="ps-msg">Lendo ${arquivos.length} print(s) com a IA… pode levar cerca de 1 minuto.</div>`);
        const itens = await lerPrints(arquivos);
        if (!itens.length) throw new Error('Não encontrei produtos com preço nos prints. Eles mostram a lista do catálogo?');
        await concluirCatalogo(itens, extra);
    } catch (e) {
        tela(`<div class="ps-msg ps-erro">${esc(e.message)}</div><button type="button" class="ps-btn" data-act="inicio">Voltar</button>`);
    }
}

// ── Arquivo exportado do catálogo (ZIP ou CSV da extensão): leitura exata, sem IA ──
function lerCsv(txt) {
    const linhas = []; let campo = '', lin = [], aspas = false;
    for (let i = 0; i < txt.length; i++) {
        const ch = txt[i];
        if (aspas) { if (ch === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += ch; }
        else if (ch === '"') aspas = true;
        else if (ch === ',') { lin.push(campo); campo = ''; }
        else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[i + 1] === '\n') i++; lin.push(campo); campo = ''; linhas.push(lin); lin = []; }
        else campo += ch;
    }
    if (campo !== '' || lin.length) { lin.push(campo); linhas.push(lin); }
    return linhas;
}

// Grupos do relatório. O arquivo exportado só traz a coleção de alguns produtos, então o grupo sai do nome
// (ordem pedida: Poco, Redmi/Xiaomi, Samsung…); o que não casar usa a coleção do catálogo, se houver.
const GRUPOS = [
    [/\bpoco\b/i, 'Xiaomi Poco'],
    [/redmi|xiaomi|\bmi\s?\d/i, 'Xiaomi Redmi / Mi'],
    [/samsung|galaxy/i, 'Samsung'],
    [/motorola|\bmoto\b/i, 'Motorola'],
    [/iphone|apple|ipad|airpods|macbook/i, 'Apple'],
    [/realme|honor|tecno|oppo|infinix|vivo\b/i, 'Realme / Honor / Tecno / Oppo'],
    [/notebook|tablet|vivobook|nitro|ideapad|macbook/i, 'Notebooks e tablets'],
    [/smartwatch|watch|haylou|rel[oó]gio|band\b/i, 'Smartwatch'],
    [/\btv\b|smart\s?tv|polegadas|projetor/i, 'TVs'],
    [/fone|buds|airdots|jbl|caixa de som|bombox|boombox|aiwa|alexa|headset|\bqcy\b/i, 'Áudio'],
    [/carregador|cabo|capa|pel[ií]cula|suporte|caneta|adaptador|fonte\b/i, 'Carregadores e variedades']
];
function colecaoDe(nome, colecaoCatalogo) {
    const g = GRUPOS.find(([re]) => re.test(nome));
    if (g) return g[1];
    const lista = String(colecaoCatalogo || '').split('|').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    return lista.find(x => !/promo[cç]/i.test(x)) || 'Outros';
}
const ordemGrupo = g => { const i = GRUPOS.findIndex(x => x[1] === g); return i < 0 ? 99 : i; };

function itensDoCsv(txt) {
    const linhas = lerCsv(txt.replace(/^\uFEFF/, '')).filter(l => l.some(c => c !== ''));
    const cab = (linhas.shift() || []).map(h => h.trim().toLowerCase());
    const iT = cab.indexOf('title'), iP = cab.indexOf('price'), iPT = cab.indexOf('price_text'), iC = cab.indexOf('collections');
    if (iT < 0 || (iP < 0 && iPT < 0)) throw new Error('Esse arquivo não parece o catálogo exportado (faltam as colunas title e price).');
    const itens = [];
    linhas.forEach(l => {
        const nome = String(l[iT] || '').replace(/\s+/g, ' ').trim();
        // Em promoção o preço vem vazio e o texto traz "R$ atual R$ antigo": vale o primeiro valor
        const valores = (String(l[iPT] || '').match(/[\d.]+,\d{2}/g) || []).map(numero);
        const preco = (iP >= 0 && numero(l[iP]) > 0) ? numero(l[iP]) : (valores[0] || 0);
        if (!nome || preco <= 0) return;
        itens.push({ nome, preco, an: analisar(nome), de: valores.length > 1 ? valores[1] : 0, colecao: colecaoDe(nome, iC >= 0 ? l[iC] : '') });
    });
    return itens;
}

async function lerZip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let fim = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { fim = i; break; }
    if (fim < 0) throw new Error('Não consegui abrir o ZIP.');
    let pos = dv.getUint32(fim + 16, true);
    for (let n = dv.getUint16(fim + 10, true); n > 0; n--) {
        if (dv.getUint32(pos, true) !== 0x02014b50) break;
        const metodo = dv.getUint16(pos + 10, true), tam = dv.getUint32(pos + 20, true), nl = dv.getUint16(pos + 28, true), el = dv.getUint16(pos + 30, true), cl = dv.getUint16(pos + 32, true), loc = dv.getUint32(pos + 42, true);
        const nome = new TextDecoder().decode(u8.subarray(pos + 46, pos + 46 + nl));
        if (/(^|\/)items\.csv$/i.test(nome)) {
            const ini = loc + 30 + dv.getUint16(loc + 26, true) + dv.getUint16(loc + 28, true), dados = u8.subarray(ini, ini + tam);
            const pasta = nome.includes('/') ? nome.slice(0, nome.indexOf('/')) : '';
            if (metodo === 0) return { texto: new TextDecoder().decode(dados), pasta };
            if (metodo !== 8 || typeof DecompressionStream === 'undefined') throw new Error('Esse navegador não abre este ZIP. Extraia o items.csv e escolha ele.');
            const fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            return { texto: new TextDecoder().decode(await new Response(fluxo).arrayBuffer()), pasta };
        }
        pos += 46 + nl + el + cl;
    }
    throw new Error('Não achei o arquivo items.csv dentro do ZIP.');
}

async function importarCatalogo(texto, silencioso) {
    const itens = itensDoCsv(texto);
    if (!itens.length) throw new Error('Não encontrei produtos com preço nesse arquivo.');
    await concluirCatalogo(itens, catExtra(), true, silencioso);
}

// Depois de ler um catálogo sem PDF: perguntas de nome duvidoso (se houver) ou direto para a lista
function fimCatalogo() { return CAT && CAT.fila.length ? telaCatPergunta() : telaZap(); }
// Fim das perguntas de nome duvidoso: volta ao resultado do PDF (se houver) ou vai para a lista do WhatsApp
function catFim() { return S && S.aplicados ? telaRelatorio() : telaZap(); }

function telaCatPergunta() {
    const c = CAT, it = c.fila[0];
    if (!it) return catFim();
    TELA = 'catperg'; titulo('É este produto?');
    const cands = candidatos(it, c.ctw, new Map(), LIMIAR_PERGUNTA);
    tela(`
      <div class="ps-prog">Nome duvidoso · faltam ${c.fila.length}</div>
      <div class="ps-card"><div class="ps-cap">No catálogo</div><div class="ps-nome">${esc(it.nome)}</div><div class="ps-valor">${brl(it.preco)}</div></div>
      <div class="ps-cap">É qual produto do CTW?</div>
      ${cands.map(x => `<button type="button" class="ps-cand" data-act="catmesmo" data-id="${esc(x.c.id)}">
          <span class="ps-nome">${esc(x.c.nome)}</span><span class="ps-sub">CTW ${brl(x.c.valor)} → catálogo deveria ser ${brl(x.c.valor + c.extra)}</span>
          ${x.d.length ? `<span class="ps-chips">${x.d.map(d => chip(d.t, d.forte)).join('')}</span>` : ''}</button>`).join('')}
      <button type="button" class="ps-btn ps-prim" data-act="catdepois">Pular por agora</button>
      <button type="button" class="ps-btn" data-act="catnao">Não é do CTW (não perguntar mais)</button>
      <button type="button" class="ps-btn ps-suave" data-act="catfim">Parar por aqui</button>`);
}

async function catResponder(act, id) {
    const c = CAT, it = c.fila.shift();
    if (!it) return catFim();
    if (act === 'catmesmo') {
        const ct = c.ctw.find(x => x.id === id);
        if (!ct) { c.fila.unshift(it); return telaCatPergunta(); }
        await update(ref(getDb()), { [`${BASE}/catAliases/${chaveNome(it.an)}`]: { pid: ct.id, spec: assinatura(it.an), n: it.nome } });
        APR.catAliases[chaveNome(it.an)] = { pid: ct.id, spec: assinatura(it.an), n: it.nome };
        (igual(it.preco, ct.valor + c.extra) ? c.certos : c.errados).push({ it, c: ct });
        if (c.exato) await zapAlinhar([{ it, c: ct }], c.extra).catch(e => console.warn('[zap]', e.message));
        await guardarCatalogo([{ it, c: ct }], 'prints').catch(e => console.warn('[catálogo]', e.message));   // acrescenta ao guardado, sem apagar o resto
    } else if (act === 'catnao') {
        await update(ref(getDb()), { [`${BASE}/catIgnorados/${chaveNome(it.an)}`]: true });
        APR.catIgnorados[chaveNome(it.an)] = true; c.ignorados.push(it);
    } else c.semPar.push(it);   // "decidir depois": não grava; volta a perguntar na próxima conferência
    return telaCatPergunta();
}

// ── Fazer no WhatsApp (só perfil Dev) ───────────────────────────
// Cada mudança de preço no CTW vira uma pendência (app.js: ctwZapCalcular). Sai quando você toca em "Já fiz"
// ou quando o ZIP do catálogo mostra que o preço já está certo.
const tempoAtras = t => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} dia(s)`; };
let S_zapAba = 'preco';

async function telaZap(aba) {
    const reabre = TELA === 'zap', corpo0 = overlay && overlay.querySelector('#psCorpo'), rolagem = reabre && corpo0 ? corpo0.scrollTop : 0;
    TELA = 'zap'; titulo('Fazer no WhatsApp');
    if (!reabre) tela('<div class="ps-msg">Carregando…</div>');
    try { await carregarAprendizado(); }
    catch (e) { return tela(`<div class="ps-msg ps-erro">Não consegui acessar o banco de dados (${esc(e.message)}).</div>`); }
    if (!overlay || TELA !== 'zap') return;             // fechou ou mudou de tela enquanto carregava
    const c = APR.contas[CONTA], p = pend(CONTA), extra = catExtra(), agora = Date.now();
    if (!aba) aba = p.preco ? 'preco' : p.desativar ? 'desativar' : p.reativar ? 'reativar' : p.adicionar ? 'adicionar' : 'preco';
    S_zapAba = aba;
    const precos = Object.entries(c.zap || {}).map(([id, z]) => ({ id, ...z }));
    const esg = Object.entries(c.esg || {}).map(([id, e]) => ({ id, ...e }));
    const desativar = esg.filter(e => e.estado === 'desativar'), reativar = esg.filter(e => e.estado === 'reativar'), adicionar = esg.filter(e => e.estado === 'adicionar');
    const sobe = z => z.para > z.de;           // preço do CTW subiu: o catálogo está mais barato que deveria
    const agrupar = (lista, nomeDe, ordenar) => {
        const g = new Map();
        lista.forEach(z => { const k = colecaoDe(nomeDe(z) || '', ''); if (!g.has(k)) g.set(k, []); g.get(k).push(z); });
        g.forEach(l => l.sort(ordenar));
        return [...g].sort((x, y) => ordemGrupo(x[0]) - ordemGrupo(y[0]));
    };
    const cab = (g, l) => `<div class="ps-cap ps-esp">${esc(g)} · ${l.length}</div>`;
    const botoes = (acao, rotulo, id, menu) => `<div class="ps-lbtns"><button type="button" class="ps-ja" data-act="${acao}" data-id="${esc(id)}">${rotulo}</button>${menu ? '<button type="button" class="ps-mais" data-act="mais" aria-label="Mais opções">⋯</button>' : ''}</div>${menu ? `<div class="ps-menu" hidden>${menu}</div>` : ''}`;
    const cartaoPreco = z => `
        <div class="ps-lc${sobe(z) ? ' ps-lc-urg' : ''}">
          ${sobe(z) ? '<span class="ps-tag-urg">MAIS BARATO QUE DEVERIA</span>' : ''}
          <div class="ps-nome">${esc(z.nome)}</div>
          <div class="ps-sub2">Está ${brl(z.de + extra)} → mude para <b>${brl(z.para + extra)}</b></div>
          ${sobe(z) ? '' : '<div class="ps-sub">Preço desceu · sem pressa</div>'}
          <div class="ps-sub">${z.quando ? tempoAtras(z.quando) : ''}${z.usuario ? ' · ' + esc(z.usuario) : ''}</div>
          ${botoes('zapok', 'Já fiz', z.id, `<button type="button" class="ps-btn" data-act="zapfixo" data-id="${esc(z.id)}">Manter assim</button><div class="ps-sub">Use quando o preço do catálogo está diferente de propósito. O app só avisa de novo se o CTW mudar.</div>`)}
        </div>`;
    const cartaoEsg = e => `
        <div class="ps-lc">
          <div class="ps-nome">${esc(e.nome)}</div>
          <div class="ps-sub2">${e.estado === 'reativar' ? 'Voltou no Stock 2.0: reative no catálogo' : e.estado === 'adicionar' ? `Tem estoque e não está no catálogo · cadastre por <b>${brl(e.preco)}</b>` : `Sem estoque · está no catálogo por ${brl(e.preco)}`}</div>
          <div class="ps-sub">${tempoAtras(e.desde || agora)}</div>
          ${e.estado === 'reativar' ? botoes('esgreativei', 'Já reativei', e.id)
            : e.estado === 'adicionar' ? botoes('esgadicionei', 'Já adicionei', e.id, `<button type="button" class="ps-btn" data-act="esgnaovou" data-id="${esc(e.id)}">Não vou colocar no WhatsApp</button><div class="ps-sub">Vale para todas as contas. O app para de cobrar este produto (dá para voltar em Avançado).</div>`)
            : botoes('esgdesativei', 'Já desativei', e.id, `<button type="button" class="ps-btn" data-act="esgainda" data-id="${esc(e.id)}">Ainda tem estoque</button><div class="ps-sub">Não avisa de novo por ${DIAS_AINDA_TEM} dias.</div>`)}
        </div>`;
    const abas = [['preco', 'Preço', precos.length], ['desativar', 'Desativar', desativar.length], ['reativar', 'Reativar', reativar.length], ['adicionar', 'Adicionar', adicionar.length]];
    let corpo;
    if (aba === 'preco') corpo = precos.length ? agrupar(precos, z => z.nome, (a, b) => sobe(b) - sobe(a) || (b.quando || 0) - (a.quando || 0)).map(([g, l]) => cab(g, l) + l.map(cartaoPreco).join('')).join('') : '<div class="ps-msg">Nenhum preço para corrigir. 🎉</div>';
    else {
        const lista = aba === 'desativar' ? desativar : aba === 'reativar' ? reativar : adicionar;
        const intro = { desativar: 'Estão no catálogo do WhatsApp e não vieram no PDF do Stock 2.0. No CTW eles continuam normais.', reativar: 'Estavam desativados no WhatsApp e voltaram no Stock 2.0.', adicionar: 'Estão no PDF de hoje (com estoque) e no CTW, mas não no catálogo desta conta. O preço já inclui o extra à vista.' }[aba];
        const vazio = { desativar: 'Nada para desativar.', reativar: 'Nada para reativar.', adicionar: c.catalogo && c.catalogo.origem === 'zip' ? 'Nada para adicionar.' : 'Esta conta precisa de um ZIP do catálogo para saber o que falta.' }[aba];
        corpo = `<div class="ps-sub">${intro}</div>`
            + (lista.length ? agrupar(lista, e => e.nome, (a, b) => (b.desde || 0) - (a.desde || 0)).map(([g, l]) => cab(g, l) + l.map(cartaoEsg).join('')).join('') : `<div class="ps-msg">${vazio} 🎉</div>`);
    }
    const aviso = !c.catalogo ? `<div class="ps-aviso-card"><b>${esc(c.nome)} ainda não tem catálogo</b><span>Sem o ZIP, essa conta não recebe aviso de esgotado.</span></div>`
        : catAntigo(c.catalogo) ? `<div class="ps-aviso-card"><b>Catálogo de ${esc(c.nome)} ${idadeTxt(c.catalogo).replace('de há', 'com')}</b><span>Envie um ZIP novo para os avisos ficarem confiáveis.</span></div>` : '';
    tela(`
      ${Object.keys(APR.contas).length > 1 ? chipsContas(true) : ''}
      <div class="ps-abas">${abas.map(([k, nome, n]) => `<button type="button" class="${k === aba ? 'on' : ''}" data-act="zapaba" data-aba="${k}">${nome} ${n}</button>`).join('')}</div>
      ${aviso}${corpo}
      <button type="button" class="ps-btn ps-suave" data-act="enviar">Enviar PDF ou ZIP novo</button>`);
    const novo = overlay.querySelector('#psCorpo'); if (novo && rolagem) novo.scrollTop = rolagem;
}

async function zapRemover(id) { await update(ref(getDb()), { [`${raiz()}/zap/${id}`]: null }); }

// Alinha a lista com o que o ZIP mostrou: preço certo sai; preço errado entra (catálogo atual = preço lido − extra)
// Exceção "manter assim": vale enquanto o valor do CTW e o preço do catálogo continuam os mesmos de quando você decidiu
const fixoAtivo = (f, x) => !!f && Math.abs(Number(f.ctw) - x.c.valor) < 0.005 && Math.abs(Number(f.preco) - x.it.preco) < 0.005;

async function zapAlinhar(pares, extra) {
    const db = getDb();
    const atual = (await get(ref(db, raiz() + '/zap'))).val() || {};
    const fixos = (await get(ref(db, raiz() + '/fixos'))).val() || {};
    const upd = {}; let total = Object.keys(atual).length;
    pares.forEach(({ it, c }) => {
        const f = fixos[c.id];
        if (f) {
            if (fixoAtivo(f, { it, c })) { if (atual[c.id]) { upd[`${raiz()}/zap/${c.id}`] = null; total--; } return; }
            upd[`${raiz()}/fixos/${c.id}`] = null;       // CTW ou catálogo mudaram: a exceção caiu
        }
        if (igual(it.preco, c.valor + extra)) { if (atual[c.id]) { upd[`${raiz()}/zap/${c.id}`] = null; total--; } return; }
        if (!atual[c.id]) { if (total >= 200) return; total++; }
        upd[`${raiz()}/zap/${c.id}`] = { nome: c.nome, de: Math.round((it.preco - extra) * 100) / 100, para: c.valor, quando: Date.now(), usuario: usuario(), origem: 'zip' };
    });
    if (Object.keys(upd).length) await update(ref(db), upd);
}

// ── Entrada ─────────────────────────────────────────────────────
function abrir() {
    if (!(window.ctwEhDev && window.ctwEhDev())) return;
    if (!getDb()) { if (window.showCustomModal) window.showCustomModal({ message: 'O banco de dados ainda está conectando. Tente de novo em alguns segundos.' }); return; }
    abrirOverlay();
    telaInicio();
}

export { abrir };
