// ================================================================
// precosync.js — Sincronizar preços: catálogo do Stock 2.0 (PDF) → CTW
// Atualiza SOMENTE o campo "valor" de products/{id}. Nada mais é tocado.
// Casamento: nome idêntico (normalizado) → vínculo já aprendido → pergunta ao admin.
// Firebase: settings/precosync/{aliases, ignoradosCtw, log}
// ================================================================

import { ref, get, update, push, query, orderByKey, limitToLast }
    from "https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js";

const PDFJS_URL    = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
// As regras do Firebase só liberam caminhos conhecidos; "settings" já é liberado e usado por outros recursos.
const BASE = 'settings/precosync';
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
let APR = { aliases: {}, ignoradosCtw: {} };

async function carregarAprendizado() {
    const snap = await get(ref(getDb(), BASE));
    const v = snap.val() || {};
    APR = { aliases: v.aliases || {}, ignoradosCtw: v.ignoradosCtw || {} };
}

function usuario() { try { return localStorage.getItem('ctwUserProfile') || ''; } catch (e) { return ''; } }

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

function abrirOverlay() {
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.className = 'ps-overlay';
    overlay.innerHTML = `<div class="ps-topo"><button type="button" class="ps-x" data-act="fechar" aria-label="Fechar">‹</button><b>Sincronizar preços</b></div><div class="ps-corpo" id="psCorpo"></div>`;
    overlay.addEventListener('click', aoClicar);
    overlay.addEventListener('input', aoDigitar);
    overlay.addEventListener('change', aoMudar);
    document.body.appendChild(overlay);
    document.documentElement.classList.add('ps-aberto');
}

function fechar() {
    if (overlay) { overlay.remove(); overlay = null; }
    document.documentElement.classList.remove('ps-aberto');
    S = null;
}

function tela(html) {
    const c = overlay && overlay.querySelector('#psCorpo');
    if (c) { c.innerHTML = html; c.scrollTop = 0; }
}

const chip = (t, forte) => `<span class="ps-chip${forte ? ' ps-forte' : ''}">${esc(t)}</span>`;

async function telaInicio() {
    tela('<div class="ps-msg">Carregando…</div>');
    let logs = [];
    try {
        await carregarAprendizado();
        const snap = await get(query(ref(getDb(), BASE + '/log'), orderByKey(), limitToLast(5)));
        const v = snap.val() || {};
        logs = Object.keys(v).sort().reverse().map(id => ({ id, ...v[id] }));
    } catch (e) {
        tela(`<div class="ps-msg ps-erro">Não consegui acessar o banco de dados (${esc(e.message)}). Verifique a internet e tente de novo.</div>`);
        return;
    }
    const nAl = Object.keys(APR.aliases).length;
    tela(`
      <div class="ps-card">
        <p>Gere o <b>Catálogo de produtos</b> no Stock 2.0 (PDF) e escolha o arquivo abaixo. Só o <b>valor</b> dos produtos do CTW é atualizado — cor, código, quantidade e nome ficam como estão.</p>
        <label class="ps-btn ps-prim"><input type="file" id="psArquivo" accept="application/pdf,.pdf" hidden>Escolher PDF do Stock 2.0</label>
      </div>
      <div class="ps-card">
        <div class="ps-lin"><span>Produtos já vinculados</span><b>${nAl}</b></div>
        <button type="button" class="ps-btn" data-act="vinculos">Gerenciar vínculos e ignorados</button>
      </div>
      ${logs.length ? `<div class="ps-cap ps-esp">Últimas alterações de preço</div>` + logs.map(l => `
        <div class="ps-it"><div class="ps-grow"><div class="ps-nome">${l.tipo === 'vinculo' ? 'Vínculo manual' : 'Importação'} · ${Object.keys(l.itens || {}).length} preço(s)</div>
          <div class="ps-sub">${new Date(l.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}${l.usuario ? ' · ' + esc(l.usuario) : ''}${l.desfeito ? ' · desfeita' : ''}</div></div>
          ${l.desfeito ? '' : `<button type="button" class="ps-mini" data-act="desfazer" data-id="${esc(l.id)}">Desfazer</button>`}</div>`).join('') : ''}`);
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
        S = { arquivo: arq.name, avisos, cl, linhas, decisoes: [], novosAliases: [], pularResto: false, fila: cl.perguntas.slice(), total: cl.perguntas.length, aceitar: {} };
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
      <button type="button" class="ps-btn ps-prim" data-act="addform" data-origem="pergunta" data-i="${r.i}">Adicionar ao CTW (editar nome e preço)</button>
      <button type="button" class="ps-btn" data-act="naoexiste">Não existe no CTW</button>
      <button type="button" class="ps-btn ps-suave" data-act="pular">Decidir depois</button>
      <button type="button" class="ps-btn ps-suave" data-act="pularresto">Pular todas as perguntas restantes (${S.fila.length})</button>`);
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
    if (e.target.id === 'psBusca' && S) resultadoBusca(e.target.value);
    if (e.target.id === 'psBuscaPdf' && S && S.vinculo) resultadoBuscaPdf(e.target.value);
    if (e.target.id === 'psBuscaAdd' && S) { const box = overlay.querySelector('#psAddRes'); if (box) box.innerHTML = listaAdicionar(e.target.value); }
}
function aoMudar(e) {
    if (e.target.id === 'psArquivo') aoEscolherPdf(e.target.files && e.target.files[0]);
    if (S && e.target.dataset && e.target.dataset.sus !== undefined) {
        S.aceitar[e.target.dataset.sus] = e.target.checked;
        const bt = overlay.querySelector('[data-act="aplicar"]');
        const n = S.mud.filter(x => x.mudou && !x.invalido && (!x.suspeito || S.aceitar[x.id])).length;
        if (bt && n) bt.textContent = `Aplicar ${n} preço(s)`;
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
      ${muda.length ? muda.map(linha).join('') : '<div class="ps-msg">Nenhum preço precisa mudar.</div>'}
      <button type="button" class="ps-btn ps-prim" data-act="aplicar">${muda.length ? `Aplicar ${nAplicar} preço(s)` : 'Concluir'}</button>
      <button type="button" class="ps-btn ps-suave" data-act="fechar">Cancelar (nada é alterado)</button>`);
}

// ── Aplicar ─────────────────────────────────────────────────────
async function gravar(itens, aliases, ignoradosCtw, arquivo, tipo) {
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
        upd[`${BASE}/ignoradosCtw/${c.id}`] = null;
    }
    for (const c of ignoradosCtw) upd[`${BASE}/ignoradosCtw/${c.id}`] = { nome: c.nome, quando: Date.now() };
    if (!Object.keys(upd).length) return;
    if (itens.length) {                // poda registros antigos junto com a gravação
        const antigos = Object.keys((await get(ref(db, BASE + '/log'))).val() || {}).sort().slice(0, -(MAX_LOGS - 1));
        antigos.forEach(k => { upd[`${BASE}/log/${k}`] = null; });
    }
    await update(ref(db), upd);       // tudo ou nada: preços + log + vínculos juntos
}

async function aplicar() {
    const alvo = S.mud.filter(x => x.mudou && !x.invalido && (!x.suspeito || S.aceitar[x.id]));
    // garante que o preço do CTW não foi mexido por outra pessoa durante a importação
    const atuais = new Map((window.products || []).map(p => [p.id, valorCtw(p)]));
    const mexidos = alvo.filter(x => !igual(atuais.get(x.id) ?? x.de, x.de));
    const seguros = alvo.filter(x => !mexidos.includes(x));
    tela('<div class="ps-msg">Aplicando…</div>');
    try {
        await gravar(seguros, S.novosAliases, [], S.arquivo, 'importacao');
    } catch (e) {
        const regra = /permission/i.test(e.message || '') ? ' O Firebase precisa liberar escrita no caminho “settings/precosync” nas regras do banco.' : '';
        tela(`<div class="ps-msg ps-erro">Não consegui gravar (${esc(e.message)}). Nada foi alterado.${regra}</div><button type="button" class="ps-btn" data-act="previa">Voltar à prévia</button>`);
        return;
    }
    S.aplicados = seguros; S.mexidos = mexidos; S.pulados = S.mud.filter(x => x.suspeito && !S.aceitar[x.id]);
    telaRelatorio();
}

// ── Relatório ───────────────────────────────────────────────────
function ctwSemPdf() {
    return S.cl.ctw.filter(c => !S.cl.reivindicado.has(c.id) && !APR.ignoradosCtw[c.id]
        && !(S.ctwDescartados && S.ctwDescartados.has(c.id)));
}

function telaRelatorio() {
    const m = S.mud;
    const semPerguntar = S.aplicados.filter(x => x.origem === 'igual' || x.origem === 'aprendido').length;
    const confirmados = S.aplicados.filter(x => x.origem === 'confirmado' || x.origem === 'vinculo').length;
    const semMudanca = m.filter(x => !x.mudou && !x.invalido).length;
    const faltam = ctwSemPdf();
    const poolPdf = poolSemCtw();
    tela(`
      <div class="ps-card ps-ok"><b>Importação concluída</b>
        <div class="ps-lin"><span>Atualizados sem perguntar (nome igual ou já aprendido)</span><b>${semPerguntar}</b></div>
        <div class="ps-lin"><span>Atualizados após sua confirmação</span><b>${confirmados}</b></div>
        <div class="ps-lin"><span>Vínculos novos aprendidos</span><b>${S.novosAliases.length}</b></div>
        ${S.criados ? `<div class="ps-lin"><span>Produtos novos adicionados ao CTW</span><b>${S.criados}</b></div>` : ''}
        ${S.excluidos ? `<div class="ps-lin"><span>Produtos excluídos do CTW</span><b>${S.excluidos}</b></div>` : ''}
        <div class="ps-lin"><span>Já estavam com o preço certo</span><b>${semMudanca}</b></div>
        ${S.pulados.length ? `<div class="ps-lin"><span>Variação grande não aplicada</span><b>${S.pulados.length}</b></div>` : ''}
        ${S.mexidos.length ? `<div class="ps-lin"><span>Alterados por outra pessoa durante a importação (não mexi)</span><b>${S.mexidos.length}</b></div>` : ''}
      </div>
      <div class="ps-card">
        <div class="ps-lin"><span>Itens do Stock 2.0 que não existem no CTW</span><b>${poolPdf.length}</b></div>
        ${S.cl.naoVender.length ? `<div class="ps-lin"><span>Marcados “não vender / tirar peças” (ignorados)</span><b>${S.cl.naoVender.length}</b></div>` : ''}
        ${poolPdf.length ? `<button type="button" class="ps-btn" data-act="adicionar">Ver lista e adicionar ao CTW (opcional)</button>` : ''}
      </div>
      <div class="ps-card ${faltam.length ? 'ps-alerta' : ''}">
        <div class="ps-lin"><span>Produtos do CTW que não achei no Stock 2.0 (preço não mexido)</span><b>${faltam.length}</b></div>
        ${faltam.length ? `<button type="button" class="ps-btn ps-prim" data-act="revisar">Ver e vincular manualmente</button>` : ''}
      </div>
      <button type="button" class="ps-btn" data-act="fechar">Fechar</button>`);
}

// ── Revisão manual: produto do CTW → item do Stock 2.0 ──────────
function proximoCtw() {
    const fila = ctwSemPdf();
    if (!fila.length) { S.vinculo = null; return telaRelatorio(); }
    const c = fila[0];
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
      <button type="button" class="ps-btn" data-act="semestoque">Não está no Stock 2.0 (manter no CTW)</button>
      <button type="button" class="ps-btn ps-perigo" data-act="excluirctw">Excluir do CTW</button>
      <button type="button" class="ps-btn ps-suave" data-act="pularctw">Decidir depois</button>
      <button type="button" class="ps-btn ps-suave" data-act="relatorio">Voltar ao relatório</button>`);
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
    S.vinculo = null;
    tela(`
      <div class="ps-prog">Itens do Stock 2.0 que não existem no CTW (${poolSemCtw().length})</div>
      <div class="ps-busca"><input type="search" id="psBuscaAdd" placeholder="Buscar…" autocomplete="off"></div>
      <div id="psAddRes" class="ps-col">${listaAdicionar('')}</div>
      <button type="button" class="ps-btn ps-suave" data-act="relatorio">Voltar ao relatório</button>`);
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
    if (r.codigo) upd[`${BASE}/aliases/${chaveCodigo(r.codigo)}`] = val;
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
      <div class="ps-card"><div class="ps-cap">Excluir do CTW</div><div class="ps-nome">${esc(c.nome)}</div><div class="ps-valor">${brl(c.valor)}</div>
        <div class="ps-aviso">O produto é apagado do CTW (estoque, busca e vendas). Isso não dá para desfazer por aqui.</div></div>
      <button type="button" class="ps-btn ps-perigo" data-act="excluirctw2">Sim, excluir definitivamente</button>
      <button type="button" class="ps-btn ps-suave" data-act="revisar">Cancelar</button>`);
}

async function excluirProduto(c) {
    const upd = { [`products/${c.id}`]: null, [`${BASE}/ignoradosCtw/${c.id}`]: null };
    for (const [k, v] of Object.entries(APR.aliases)) if (v && v.pid === c.id) upd[`${BASE}/aliases/${k}`] = null;
    await update(ref(getDb()), upd);
    S.cl.reivindicado.set(c.id, { excluido: true });       // some da fila de revisão
    S.excluidos = (S.excluidos || 0) + 1;
}

// ── Vínculos e ignorados ────────────────────────────────────────
async function telaVinculos() {
    tela('<div class="ps-msg">Carregando…</div>');
    try { await carregarAprendizado(); } catch (e) { tela(`<div class="ps-msg ps-erro">${esc(e.message)}</div>`); return; }
    const vistos = new Set();
    const al = Object.entries(APR.aliases).filter(([k, v]) => { const id = v.pid + '|' + v.nomeEstoque; if (vistos.has(id)) return false; vistos.add(id); return true; });
    const nIgC = Object.keys(APR.ignoradosCtw).length;
    tela(`
      <div class="ps-card">
        <div class="ps-lin"><span>Produtos do CTW marcados “não está no Stock 2.0”</span><b>${nIgC}</b></div>
        ${nIgC ? '<button type="button" class="ps-btn" data-act="esquecerign">Voltar a perguntar sobre esses itens</button>' : ''}
      </div>
      <div class="ps-cap ps-esp">Vínculos aprendidos (${al.length})</div>
      ${al.map(([k, v]) => `<div class="ps-it"><div class="ps-grow"><div class="ps-nome">${esc(v.nomeEstoque)}</div><div class="ps-sub">= ${esc(v.nomeCtw)}</div></div><button type="button" class="ps-mini" data-act="rmvinculo" data-pid="${esc(v.pid)}" data-nome="${esc(v.nomeEstoque)}">Remover</button></div>`).join('') || '<div class="ps-msg">Nenhum vínculo ainda.</div>'}
      <button type="button" class="ps-btn ps-suave" data-act="inicio">Voltar</button>`);
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
        await update(ref(getDb()), upd);
        tela(`<div class="ps-card ps-ok"><b>Importação desfeita</b><div class="ps-lin"><span>Preços restaurados</span><b>${ok}</b></div>${mexidos ? `<div class="ps-lin"><span>Mantidos (já tinham sido alterados depois)</span><b>${mexidos}</b></div>` : ''}</div><button type="button" class="ps-btn" data-act="inicio">Voltar</button>`);
    } catch (e) {
        tela(`<div class="ps-msg ps-erro">${esc(e.message)}</div><button type="button" class="ps-btn" data-act="inicio">Voltar</button>`);
    }
}

// ── Cliques ─────────────────────────────────────────────────────
async function aoClicar(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    try {
        if (act === 'fechar') return fechar();
        if (act === 'inicio') return telaInicio();
        if (act === 'vinculos') return telaVinculos();
        if (act === 'desfazer') return desfazer(b.dataset.id);
        if (act === 'rmvinculo') { await removerVinculo(b.dataset.pid, b.dataset.nome); return telaVinculos(); }
        if (act === 'esquecerign') { await update(ref(getDb()), { [`${BASE}/ignoradosCtw`]: null }); return telaVinculos(); }
        if (!S) return;
        if (act === 'mesmo') {
            const r = S.fila[0], c = S.cl.ctw.find(x => x.id === b.dataset.id);
            if (!r || !c || S.cl.reivindicado.has(c.id)) return;
            confirmarVinculo(r, c); S.fila.shift(); return proximaPergunta();
        }
        // "Não existe no CTW" não grava nada: na próxima importação pergunta de novo (o produto pode ser cadastrado depois)
        if (act === 'naoexiste') { const r = S.fila.shift(); S.cl.semCtw.push(r); return proximaPergunta(); }
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
        if (act === 'semestoque') {
            const c = S.vinculo.c;
            await gravar([], [], [c], S.arquivo, 'vinculo');
            APR.ignoradosCtw[c.id] = { nome: c.nome };
            return proximoCtw();
        }
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

// ── Entrada ─────────────────────────────────────────────────────
function abrir() {
    if (!getDb()) { if (window.showCustomModal) window.showCustomModal({ message: 'O banco de dados ainda está conectando. Tente de novo em alguns segundos.' }); return; }
    abrirOverlay();
    telaInicio();
}

export { abrir };
