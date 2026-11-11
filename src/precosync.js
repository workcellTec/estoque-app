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
let APR = { aliases: {}, ignoradosPdf: {}, ignoradosCtw: {}, catAliases: {}, catIgnorados: {}, catalogo: null, esg: {} };

async function carregarAprendizado() {
    const snap = await get(ref(getDb(), BASE));
    const v = snap.val() || {};
    APR = { aliases: v.aliases || {}, ignoradosPdf: v.ignoradosPdf || {}, ignoradosCtw: v.ignoradosCtw || {}, catAliases: v.catAliases || {}, catIgnorados: v.catIgnorados || {}, catalogo: v.catalogo || null, esg: v.esg || {} };
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
    overlay.innerHTML = `<div class="ps-topo"><button type="button" class="ps-x" data-act="fechar" aria-label="Fechar">‹</button><b>${esc(titulo || 'Sincronizar preços')}</b></div><div class="ps-corpo" id="psCorpo"></div>`;
    overlay.addEventListener('click', aoClicar);
    overlay.addEventListener('input', aoDigitar);
    overlay.addEventListener('change', aoMudar);
    document.body.appendChild(overlay);
    document.documentElement.classList.add('ps-aberto');
}

function fechar() {
    if (overlay) { overlay.remove(); overlay = null; }
    document.documentElement.classList.remove('ps-aberto');
    S = null; CAT = null; ESC_.pdf = ESC_.cat = null;
}

function tela(html) {
    const c = overlay && overlay.querySelector('#psCorpo');
    if (c) { c.innerHTML = html; c.scrollTop = 0; }
}

const chip = (t, forte) => `<span class="ps-chip${forte ? ' ps-forte' : ''}">${esc(t)}</span>`;

const ESC_ = { pdf: null, cat: null };   // arquivos escolhidos na entrada, ainda não analisados

async function telaInicio() {
    const tit = overlay && overlay.querySelector('.ps-topo b'); if (tit) tit.textContent = 'Sincronizar preços';
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
    let nPend = 0, cat = null;
    try {
        const [z, e, c] = await Promise.all([get(ref(getDb(), BASE + '/zap')), get(ref(getDb(), BASE + '/esg')), get(ref(getDb(), BASE + '/catalogo'))]);
        nPend = Object.keys(z.val() || {}).length + Object.values(e.val() || {}).filter(x => x.estado === 'desativar' || x.estado === 'reativar').length;
        cat = c.val();
    } catch (e) { /* painel segue sem os contadores */ }
    const arqTxt = (f, vazio) => f ? `<div class="ps-nome">${esc(f.name)}</div><div class="ps-sub">${(f.size / 1024).toFixed(0)} KB · pronto para analisar</div>` : `<div class="ps-sub">${vazio}</div>`;
    tela(`
      <div class="ps-sub">Um fluxo só: o PDF do Stock 2.0 atualiza os preços do CTW e o app já diz o que mudar, desativar ou reativar no WhatsApp.</div>
      <div class="ps-card">
        <div class="ps-passo"><span class="ps-n on">1</span><b>Lista do Stock 2.0 (PDF)</b></div>
        <div class="ps-arq"><span class="ps-tipo ps-pdf">PDF</span><div class="ps-grow">${arqTxt(ESC_.pdf, 'Gere o “Catálogo de produtos” no Stock 2.0 e escolha o arquivo. Só o valor dos produtos do CTW é atualizado.')}</div>
          <label class="ps-link"><input type="file" id="psArquivo" accept="application/pdf,.pdf" hidden>${ESC_.pdf ? 'Trocar' : 'Escolher'}</label></div>
      </div>
      <div class="ps-card">
        <div class="ps-passo"><span class="ps-n">2</span><b class="ps-grow">Catálogo do WhatsApp</b><span class="ps-opc">opcional</span></div>
        <div class="ps-sub">O app guarda o último catálogo importado. Só envie outro de vez em quando ou ao cadastrar produto novo.</div>
        <div class="ps-arq"><span class="ps-tipo ps-zip">ZIP</span><div class="ps-grow">${ESC_.cat ? arqTxt(ESC_.cat, '') : (cat ? `<div class="ps-nome">Último: ${tempoAtras(cat.atualizado)} (${cat.origem === 'zip' ? 'ZIP' : 'prints'})</div><div class="ps-sub">${Object.keys(cat.itens || {}).length} produtos guardados</div>` : '<div class="ps-sub">Ainda não guardado. Envie o ZIP uma vez para o app avisar os esgotados.</div>')}</div>
          <label class="ps-link"><input type="file" id="psCatArq" accept=".zip,.csv,application/zip,text/csv" hidden>${ESC_.cat || cat ? 'Atualizar' : 'Escolher'}</label></div>
        <div class="ps-lin"><span>Extra à vista (R$)</span><input type="text" inputmode="decimal" id="psCatExtra" class="ps-inp" value="${esc(String(catExtra()).replace('.', ','))}"></div>
        <label class="ps-link ps-esp"><input type="file" id="psPrints" accept="image/*" multiple hidden>Sem o ZIP? Usar prints do catálogo</label>
      </div>
      <button type="button" class="ps-btn ps-prim" data-act="analisar"${ESC_.pdf || ESC_.cat ? '' : ' disabled'}>${ESC_.pdf ? 'Analisar tudo' : ESC_.cat ? 'Guardar catálogo' : 'Escolha o PDF para analisar'}</button>
      <div class="ps-lin ps-esp"><span>Alterar no WhatsApp</span><button type="button" class="ps-mini${nPend ? ' ps-prim' : ''}" data-act="zap">${nPend ? nPend + ' pendentes · abrir' : 'Abrir'}</button></div>
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
    if (e.target.id === 'psArquivo') { ESC_.pdf = (e.target.files && e.target.files[0]) || ESC_.pdf; telaInicio(); }
    if (e.target.id === 'psCatExtra') { const n = numero(e.target.value); try { localStorage.setItem('ctwCatExtra', String(n)); } catch (x) {} }
    if (e.target.id === 'psPrints') aoEscolherPrints(e.target.files);
    if (e.target.id === 'psCatArq') { ESC_.cat = (e.target.files && e.target.files[0]) || ESC_.cat; telaInicio(); }
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
      ${cartaoWhats(calcEsgotados(presencaPdf(), duvidaPdf()))}
      ${muda.length ? muda.map(linha).join('') : '<div class="ps-msg">Nenhum preço precisa mudar.</div>'}
      <button type="button" class="ps-btn ps-prim" data-act="aplicar">${muda.length ? `Aplicar ${nAplicar} preço(s)` : 'Concluir'}</button>
      <button type="button" class="ps-btn ps-suave" data-act="fechar">Cancelar (nada é alterado)</button>`);
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

function calcEsgotados(presenca, duvida) {
    const cat = (APR.catalogo && APR.catalogo.itens) || {}, esg = APR.esg || {}, agora = Date.now();
    const upd = {}; let novos = 0;
    new Set([...Object.keys(cat), ...Object.keys(esg)]).forEach(pid => {
        const e = esg[pid], c = cat[pid];
        if (duvida.has(pid)) return;
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
    const final = { ...esg };
    Object.entries(upd).forEach(([pid, v]) => { if (v === null) delete final[pid]; else final[pid] = v; });
    const tam = Object.keys(cat).length;
    return {
        upd, novos,
        suspeito: novos > Math.max(5, Math.ceil(tam * LIMITE_ESGOTADOS)),
        desativar: Object.values(final).filter(e => e.estado === 'desativar').length,
        reativar: Object.values(final).filter(e => e.estado === 'reativar').length
    };
}

function contagemEsg() {
    const v = Object.values(APR.esg || {});
    return { desativar: v.filter(e => e.estado === 'desativar').length, reativar: v.filter(e => e.estado === 'reativar').length };
}

function aplicarEsgLocal(upd) {
    APR.esg = APR.esg || {};
    Object.entries(upd).forEach(([pid, v]) => { if (v === null) delete APR.esg[pid]; else APR.esg[pid] = v; });
}

function cartaoWhats(eg) {
    if (!eg || !Object.keys(APR.catalogo && APR.catalogo.itens || {}).length) return '';
    return `<div class="ps-card ${eg.suspeito ? 'ps-alerta' : ''}">
        <div class="ps-cap">WhatsApp (catálogo)</div>
        ${eg.suspeito ? `<div class="ps-aviso">${eg.novos} produtos do catálogo parecem esgotados de uma vez. O PDF veio completo? Nada é avisado até você confirmar.</div>
          <button type="button" class="ps-btn ps-perigo" data-act="esgaplicar">Sim, o PDF está completo: avisar os esgotados</button>`
        : `<div class="ps-lin"><span>Esgotaram (desativar no WhatsApp)</span><b>${eg.desativar}</b></div>`}
        ${eg.reativar ? `<div class="ps-lin"><span>Voltaram ao estoque (reativar)</span><b>${eg.reativar}</b></div>` : ''}
      </div>`;
}

async function logZap(entrada, upd) {
    const db = getDb();
    const log = (await get(ref(db, BASE + '/zapLog'))).val() || {};
    const key = push(ref(db, BASE + '/zapLog')).key;
    Object.keys(log).sort().slice(0, -(MAX_ZAPLOG - 1)).forEach(k => { upd[`${BASE}/zapLog/${k}`] = null; });
    upd[`${BASE}/zapLog/${key}`] = { quando: Date.now(), usuario: usuario(), ...entrada };
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
        const zap = (await get(ref(db, BASE + '/zap'))).val() || {};
        Object.assign(upd, window.ctwZapCalcular(zap, itens.map(x => ({ id: x.id, nome: x.c.nome, de: x.de, para: Math.round(x.para * 100) / 100 })), usuario()));
    }
    Object.assign(upd, extra || {});
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
        // quem voltou a aparecer no PDF deixa de ser "em falta"/"fora do estoque"
        const voltou = {};
        S.cl.casados.forEach(({ c }) => { if (APR.ignoradosCtw[c.id]) voltou[`${BASE}/ignoradosCtw/${c.id}`] = null; });
        S.esg = calcEsgotados(presencaPdf(), duvidaPdf());          // esgotados / voltaram, em relação ao catálogo guardado
        if (!S.esg.suspeito) Object.entries(S.esg.upd).forEach(([pid, v]) => { voltou[`${BASE}/esg/${pid}`] = v; });
        await gravar(seguros, S.novosAliases, S.novosIgnoradosPdf, S.arquivo, 'importacao', voltou);
        Object.keys(voltou).filter(k => k.includes('/ignoradosCtw/')).forEach(k => delete APR.ignoradosCtw[k.split('/').pop()]);
        if (!S.esg.suspeito) { aplicarEsgLocal(S.esg.upd); Object.assign(S.esg, contagemEsg()); }
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

function telaRelatorio() {
    const m = S.mud;
    const semPerguntar = S.aplicados.filter(x => x.origem === 'igual' || x.origem === 'aprendido').length;
    const confirmados = S.aplicados.filter(x => x.origem === 'confirmado' || x.origem === 'vinculo').length;
    const semMudanca = m.filter(x => !x.mudou && !x.invalido).length;
    const faltam = ctwSemPdf();
    const emFalta = S.cl.ctw.filter(c => !S.cl.reivindicado.has(c.id) && ctwEscondido(c.id) && APR.ignoradosCtw[c.id].ate).length;
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
        ${emFalta ? `<div class="ps-lin"><span>Em falta (escondidos por ${DIAS_EM_FALTA} dias, voltam depois)</span><b>${emFalta}</b></div>` : ''}
        ${faltam.length ? `<button type="button" class="ps-btn ps-prim" data-act="revisar">Ver e vincular manualmente</button>` : ''}
      </div>
      ${cartaoWhats(S.esg)}
      <button type="button" class="ps-btn ps-prim" data-act="zap">Abrir “Alterar no WhatsApp”</button>
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
      <button type="button" class="ps-btn" data-act="emfalta">Em falta no estoque (esconder por ${DIAS_EM_FALTA} dias)</button>
      <button type="button" class="ps-btn ps-perigo" data-act="excluirctw">Não trabalhamos mais (excluir do CTW)</button>
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

// ── Vínculos e ignorados ────────────────────────────────────────
async function telaVinculos() {
    tela('<div class="ps-msg">Carregando…</div>');
    try { await carregarAprendizado(); } catch (e) { tela(`<div class="ps-msg ps-erro">${esc(e.message)}</div>`); return; }
    const vistos = new Set();
    const al = Object.entries(APR.aliases).filter(([k, v]) => { const id = v.pid + '|' + v.nomeEstoque; if (vistos.has(id)) return false; vistos.add(id); return true; });
    const nIgP = Object.keys(APR.ignoradosPdf).length, nIgC = Object.keys(APR.ignoradosCtw).length, nIgCat = Object.keys(APR.catIgnorados).length;
    const nomeCtw = pid => { const c = (window.products || []).find(x => x && x.id === pid); return c ? c.nome : '(produto removido do CTW)'; };
    const catVinc = Object.entries(APR.catAliases).sort((a, b) => nomeCtw(a[1].pid).localeCompare(nomeCtw(b[1].pid)));
    tela(`
      <div class="ps-card">
        <div class="ps-lin"><span>Itens do Stock 2.0 marcados “não existe no CTW”</span><b>${nIgP}</b></div>
        <div class="ps-lin"><span>Produtos do CTW marcados “em falta”</span><b>${nIgC}</b></div>
        ${(nIgP || nIgC) ? '<button type="button" class="ps-btn" data-act="esquecerign">Voltar a perguntar sobre esses itens</button>' : ''}
      </div>
      ${catVinc.length ? `<div class="ps-cap ps-esp">Vínculos do catálogo do WhatsApp (${catVinc.length})</div>` + catVinc.map(([k, v]) => `<div class="ps-it"><div class="ps-grow"><div class="ps-nome">${esc(v.n || k.replace(/_/g, ' '))}</div><div class="ps-sub">= ${esc(nomeCtw(v.pid))}</div></div><button type="button" class="ps-mini" data-act="rmcatvin" data-k="${esc(k)}">Desvincular</button></div>`).join('') : ''}
      ${nIgCat ? `<div class="ps-card"><div class="ps-lin"><span>Itens do catálogo marcados “não é do CTW”</span><b>${nIgCat}</b></div><button type="button" class="ps-btn" data-act="esquecercat">Voltar a perguntar sobre esses itens</button></div>` : ''}
      <div class="ps-cap ps-esp">Vínculos do Stock 2.0 (${al.length})</div>
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
        const zap = (await get(ref(getDb(), BASE + '/zap'))).val() || {};
        const nomes = new Map((window.products || []).map(p => [p.id, p.nome || '']));
        Object.assign(upd, window.ctwZapCalcular(zap, Object.entries(log.itens || {}).filter(([pid]) => upd[`products/${pid}/valor`] !== undefined).map(([pid, it]) => ({ id: pid, nome: nomes.get(pid), de: it.para, para: it.de })), usuario()));
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
        if (act === 'rmcatvin') { const k = b.dataset.k; await update(ref(getDb()), { [`${BASE}/catAliases/${k}`]: null }); delete APR.catAliases[k]; return telaVinculos(); }
        if (act === 'esquecercat') { await update(ref(getDb()), { [`${BASE}/catIgnorados`]: null }); APR.catIgnorados = {}; return telaVinculos(); }
        if (act === 'esquecerign') { await update(ref(getDb()), { [`${BASE}/ignoradosPdf`]: null, [`${BASE}/ignoradosCtw`]: null }); return telaVinculos(); }
        if (act === 'analisar') {
            const { pdf, cat } = ESC_;
            if (!pdf && !cat) return;
            extraDoCampo();
            ESC_.pdf = ESC_.cat = null;
            if (!pdf) return aoEscolherCatalogo(cat);
            if (cat) await aoEscolherCatalogo(cat, true);      // atualiza o catálogo guardado em silêncio e segue para o PDF
            return aoEscolherPdf(pdf);
        }
        if (act === 'zapaba') return telaZap(b.dataset.aba);
        if (act === 'zap') return telaZap('preco');
        if (act === 'esgaplicar') {
            b.disabled = true;
            const upd = {}; Object.entries(S.esg.upd).forEach(([pid, v]) => { upd[`${BASE}/esg/${pid}`] = v; });
            await update(ref(getDb()), upd); aplicarEsgLocal(S.esg.upd);
            S.esg = { ...S.esg, ...contagemEsg(), suspeito: false };
            return telaRelatorio();
        }
        if (act === 'zapok' || act === 'esgdesativei' || act === 'esgreativei' || act === 'esgainda') {
            b.disabled = true;
            const id = b.dataset.id, upd = {};
            try {
                if (act === 'zapok') {
                    const z = ((await get(ref(getDb(), `${BASE}/zap/${id}`))).val()) || {};
                    upd[`${BASE}/zap/${id}`] = null;
                    await logZap({ tipo: 'preco', nome: z.nome || '', de: (z.de || 0) + catExtra(), para: (z.para || 0) + catExtra() }, upd);
                } else {
                    const e = ((await get(ref(getDb(), `${BASE}/esg/${id}`))).val()) || {};
                    if (act === 'esgdesativei') { upd[`${BASE}/esg/${id}`] = { ...e, estado: 'desativado', desde: Date.now() }; await logZap({ tipo: 'desativar', nome: e.nome || '' }, upd); }
                    else if (act === 'esgreativei') { upd[`${BASE}/esg/${id}`] = null; await logZap({ tipo: 'reativar', nome: e.nome || '' }, upd); }
                    else upd[`${BASE}/esg/${id}`] = { ...e, estado: 'ainda', ate: Date.now() + DIAS_AINDA_TEM * 86400000 };
                }
                await update(ref(getDb()), upd);
            } catch (er) { console.warn('[zap]', er.message); }
            return telaZap(S_zapAba);
        }
        if (act === 'catfeito') {
            if (!CAT) return;
            const i = Number(b.dataset.i), x = CAT.errados.find(e => e.it.i === i);
            CAT.feitos.add(i);
            if (x) await zapRemover(x.c.id).catch(() => {});
            return telaCatRelatorio();
        }
        if (act === 'caturgentes') { if (CAT) { CAT.soUrgentes = !CAT.soUrgentes; telaCatRelatorio(); } return; }
        if (act === 'catperguntas') return CAT && telaCatPergunta();
        if (act === 'catrelatorio') return CAT && telaCatRelatorio();
        if (act === 'catmesmo' || act === 'catnao' || act === 'catdepois') { if (CAT) { b.disabled = true; await catResponder(act, b.dataset.id); } return; }
        if (!S) return;
        if (act === 'mesmo') {
            const r = S.fila[0], c = S.cl.ctw.find(x => x.id === b.dataset.id);
            if (!r || !c || S.cl.reivindicado.has(c.id)) return;
            confirmarVinculo(r, c); S.fila.shift(); return proximaPergunta();
        }
        // "Não existe no CTW" é lembrado (não pergunta mais); "Decidir depois" não grava nada e volta a perguntar
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
async function guardarCatalogo(pares, origem) {
    const db = getDb(), upd = {}, agora = Date.now();
    const itens = {};
    pares.forEach(({ it, c }) => { itens[c.id] = { n: it.nome, p: it.preco }; });
    if (origem === 'zip') {
        upd[`${BASE}/catalogo`] = { atualizado: agora, origem, itens };
        Object.entries(APR.esg || {}).forEach(([pid, e]) => {            // saiu do catálogo e ninguém desativou: pendência não faz mais sentido
            if (!itens[pid] && (e.estado === 'desativar' || e.estado === 'ainda')) upd[`${BASE}/esg/${pid}`] = null;
        });
    } else {
        Object.entries(itens).forEach(([pid, v]) => { upd[`${BASE}/catalogo/itens/${pid}`] = v; });
        upd[`${BASE}/catalogo/atualizado`] = agora; upd[`${BASE}/catalogo/origem`] = (APR.catalogo && APR.catalogo.origem) || origem;
    }
    await update(ref(db), upd);
    APR.catalogo = origem === 'zip' ? { atualizado: agora, origem, itens } : { atualizado: agora, origem: (APR.catalogo && APR.catalogo.origem) || origem, itens: { ...((APR.catalogo && APR.catalogo.itens) || {}), ...itens } };
    Object.entries(upd).forEach(([k, v]) => { if (v === null && k.includes('/esg/')) delete APR.esg[k.split('/').pop()]; });
}

async function concluirCatalogo(itens, extra, exato, silencioso) {
    const produtos = (window.products || []).filter(p => p && p.id);
    if (!produtos.length) throw new Error('O CTW ainda não carregou os produtos. Aguarde alguns segundos e tente de novo.');
    await carregarAprendizado();
    CAT = { extra, itens, exato: !!exato, feitos: new Set(), ...classificarCat(itens, produtos, extra) };
    CAT.fila = CAT.perguntas.slice();
    if (exato) await zapAlinhar(CAT.certos.concat(CAT.errados), extra).catch(e => console.warn('[zap]', e.message));   // arquivo exato: a lista "Alterar no WhatsApp" passa a refletir o catálogo
    await guardarCatalogo(CAT.certos.concat(CAT.errados), exato ? 'zip' : 'prints').catch(e => console.warn('[catálogo]', e.message));
    if (!silencioso) telaCatRelatorio();
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

async function textoDoZip(buf) {
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
            if (metodo === 0) return new TextDecoder().decode(dados);
            if (metodo !== 8 || typeof DecompressionStream === 'undefined') throw new Error('Esse navegador não abre este ZIP. Extraia o items.csv e escolha ele.');
            const fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            return new TextDecoder().decode(await new Response(fluxo).arrayBuffer());
        }
        pos += 46 + nl + el + cl;
    }
    throw new Error('Não achei o arquivo items.csv dentro do ZIP.');
}

async function aoEscolherCatalogo(arq, silencioso) {
    if (!arq) return;
    try {
        const extra = extraDoCampo();
        tela('<div class="ps-msg">Lendo o catálogo…</div>');
        const txt = /\.zip$/i.test(arq.name) ? await textoDoZip(await arq.arrayBuffer()) : await arq.text();
        const itens = itensDoCsv(txt);
        if (!itens.length) throw new Error('Não encontrei produtos com preço nesse arquivo.');
        await concluirCatalogo(itens, extra, true, silencioso);
    } catch (e) {
        tela(`<div class="ps-msg ps-erro">${esc(e.message)}</div><button type="button" class="ps-btn" data-act="inicio">Voltar</button>`);
    }
}

function telaCatRelatorio() {
    const c = CAT, pend = c.errados.filter(x => !c.feitos.has(x.it.i));
    const esperado = x => x.c.valor + c.extra;
    const barato = x => x.it.preco < esperado(x) - 0.005;      // vendendo mais barato que deveria: urgente
    const urgentes = pend.filter(barato).length;
    const lista = c.soUrgentes ? pend.filter(barato) : pend;
    // Agrupa por coleção do catálogo (na ordem em que aparecem); dentro de cada grupo, os urgentes primeiro
    const grupos = new Map();
    lista.forEach(x => { const g = x.it.colecao || 'Outros'; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(x); });
    grupos.forEach(l => l.sort((a, b) => barato(b) - barato(a)));
    const gruposOrd = [...grupos].sort((a, b) => ordemGrupo(a[0]) - ordemGrupo(b[0]));
    const linha = x => `
        <div class="ps-it${barato(x) ? ' ps-urg' : ''}"><div class="ps-grow">
          ${barato(x) ? '<span class="ps-tag-urg">MAIS BARATO QUE DEVERIA</span>' : ''}
          <div class="ps-nome">${esc(x.it.nome)}</div>
          <div class="ps-sub">No catálogo ${brl(x.it.preco)}${x.it.de ? ` (em promoção, preço antigo ${brl(x.it.de)})` : ''} → <b>colocar ${brl(esperado(x))}</b></div>
          <div class="ps-sub">CTW: ${esc(x.c.nome)} · ${brl(x.c.valor)}</div></div>
          <button type="button" class="ps-mini" data-act="catfeito" data-i="${x.it.i}">Já corrigi</button></div>`;
    tela(`
      <div class="ps-card ${pend.length ? 'ps-alerta' : 'ps-ok'}">
        <div class="ps-lin"><span>Preço certo</span><b>${c.certos.length}</b></div>
        <div class="ps-lin"><span>Para corrigir no catálogo</span><b>${pend.length}</b></div>
        ${urgentes ? `<div class="ps-lin ps-urgente"><span>⚠ Mais baratos que deveriam</span><b>${urgentes}</b></div>` : ''}
        <div class="ps-lin"><span>Nome duvidoso (sem resposta)</span><b>${c.fila.length}</b></div>
        <div class="ps-lin"><span>Sem par no CTW</span><b>${c.semPar.length}</b></div>
        <div class="ps-sub">Regra: preço do catálogo = valor do CTW + ${brl(c.extra)}</div>
      </div>
      ${c.fila.length ? `<button type="button" class="ps-btn ps-prim" data-act="catperguntas">Resolver ${c.fila.length} nome(s) duvidoso(s)</button>` : ''}
      ${urgentes ? `<button type="button" class="ps-btn${c.soUrgentes ? ' ps-perigo' : ''}" data-act="caturgentes">${c.soUrgentes ? 'Mostrar todos os para corrigir' : 'Mostrar só os mais baratos que deveriam'}</button>` : ''}
      ${lista.length ? gruposOrd.map(([g, l]) => `<div class="ps-cap ps-esp">${esc(g)} · ${l.length}${l.some(barato) ? ` · ⚠ ${l.filter(barato).length}` : ''}</div>` + l.map(linha).join('')).join('')
        : '<div class="ps-msg">Nenhum preço para corrigir.</div>'}
      ${c.semPar.length ? `<details class="ps-det ps-esp"><summary>Sem par no CTW (${c.semPar.length})</summary>${c.semPar.map(i => `<div class="ps-sub">${esc(i.nome)} · ${brl(i.preco)}</div>`).join('')}</details>` : ''}
      <button type="button" class="ps-btn ps-suave" data-act="inicio">Voltar</button>`);
}

function telaCatPergunta() {
    const c = CAT, it = c.fila[0];
    if (!it) return telaCatRelatorio();
    const cands = candidatos(it, c.ctw, new Map(), LIMIAR_PERGUNTA);
    tela(`
      <div class="ps-prog">Nome duvidoso · faltam ${c.fila.length}</div>
      <div class="ps-card"><div class="ps-cap">No catálogo</div><div class="ps-nome">${esc(it.nome)}</div><div class="ps-valor">${brl(it.preco)}</div></div>
      <div class="ps-cap">É qual produto do CTW?</div>
      ${cands.map(x => `<button type="button" class="ps-cand" data-act="catmesmo" data-id="${esc(x.c.id)}">
          <span class="ps-nome">${esc(x.c.nome)}</span><span class="ps-sub">CTW ${brl(x.c.valor)} → catálogo deveria ser ${brl(x.c.valor + c.extra)}</span>
          ${x.d.length ? `<span class="ps-chips">${x.d.map(d => chip(d.t, d.forte)).join('')}</span>` : ''}</button>`).join('')}
      <button type="button" class="ps-btn" data-act="catnao">Não é do CTW (não perguntar mais)</button>
      <button type="button" class="ps-btn ps-suave" data-act="catdepois">Decidir depois</button>
      <button type="button" class="ps-btn ps-suave" data-act="catrelatorio">Ver relatório</button>`);
}

async function catResponder(act, id) {
    const c = CAT, it = c.fila.shift();
    if (!it) return telaCatRelatorio();
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

// ── Lista "Alterar no WhatsApp" (só perfil Dev) ──────────────────
// Cada mudança de preço no CTW vira uma pendência (app.js: ctwZapCalcular). Sai quando você toca em "Já corrigi"
// ou quando a conferência com o ZIP do catálogo mostra que o preço já está certo.
const tempoAtras = t => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} dia(s)`; };

async function telaZap(aba) {
    aba = aba || 'preco';
    const tit = overlay && overlay.querySelector('.ps-topo b'); if (tit) tit.textContent = 'Alterar no WhatsApp';
    tela('<div class="ps-msg">Carregando…</div>');
    let zap, esg, hist = {};
    try {
        const db = getDb();
        [zap, esg] = (await Promise.all([get(ref(db, BASE + '/zap')), get(ref(db, BASE + '/esg'))])).map(x => x.val() || {});
        if (aba === 'hist') hist = (await get(ref(db, BASE + '/zapLog'))).val() || {};
    } catch (e) { return tela(`<div class="ps-msg ps-erro">Não consegui acessar o banco de dados (${esc(e.message)}).</div>`); }
    APR.esg = esg;
    const extra = catExtra();
    const precos = Object.entries(zap).map(([id, z]) => ({ id, ...z }));
    const agora = Date.now();
    const desativar = Object.entries(esg).filter(([, e]) => e.estado === 'desativar').map(([id, e]) => ({ id, ...e }));
    const reativar = Object.entries(esg).filter(([, e]) => e.estado === 'reativar').map(([id, e]) => ({ id, ...e }));
    const sobe = z => z.para > z.de;           // preço do CTW subiu: o catálogo está mais barato que deveria
    const agrupar = (lista, nomeDe, ordenar) => {
        const g = new Map();
        lista.forEach(z => { const k = colecaoDe(nomeDe(z) || '', ''); if (!g.has(k)) g.set(k, []); g.get(k).push(z); });
        g.forEach(l => l.sort(ordenar));
        return [...g].sort((x, y) => ordemGrupo(x[0]) - ordemGrupo(y[0]));
    };
    const cab = (g, l, extraTxt) => `<div class="ps-cap ps-esp">${esc(g)} · ${l.length}${extraTxt || ''}</div>`;
    const linhaPreco = z => `
        <div class="ps-it${sobe(z) ? ' ps-urg' : ''}"><div class="ps-grow">
          ${sobe(z) ? '<span class="ps-tag-urg">MAIS BARATO QUE DEVERIA</span>' : ''}
          <div class="ps-nome">${esc(z.nome)}</div>
          <div class="ps-sub">Catálogo está em ${brl(z.de + extra)} → <b>colocar ${brl(z.para + extra)}</b></div>
          <div class="ps-sub">${z.quando ? tempoAtras(z.quando) : ''}${z.usuario ? ' · ' + esc(z.usuario) : ''}</div></div>
          <button type="button" class="ps-mini" data-act="zapok" data-id="${esc(z.id)}">Já corrigi</button></div>`;
    const linhaEsg = e => `
        <div class="ps-it"><div class="ps-grow">
          <div class="ps-nome">${esc(e.nome)}</div>
          <div class="ps-sub">${e.estado === 'reativar' ? 'Voltou no Stock 2.0 · reative no catálogo' : `No catálogo por ${brl(e.preco)} · não veio no PDF`} · ${tempoAtras(e.desde || agora)}</div>
          <div class="ps-acoes">
            <button type="button" class="ps-mini ps-prim" data-act="${e.estado === 'reativar' ? 'esgreativei' : 'esgdesativei'}" data-id="${esc(e.id)}">${e.estado === 'reativar' ? 'Já reativei' : 'Já desativei'}</button>
            ${e.estado === 'desativar' ? `<button type="button" class="ps-mini" data-act="esgainda" data-id="${esc(e.id)}">Ainda tem</button>` : ''}
          </div></div></div>`;
    const abas = [['preco', 'Preço', precos.length], ['desativar', 'Desativar', desativar.length], ['reativar', 'Reativar', reativar.length], ['hist', 'Histórico', 0]];
    let corpo = '';
    if (aba === 'preco') {
        const ord = agrupar(precos, z => z.nome, (a, b) => sobe(b) - sobe(a) || (b.quando || 0) - (a.quando || 0));
        const urg = precos.filter(sobe).length;
        corpo = `<div class="ps-card ${precos.length ? 'ps-alerta' : 'ps-ok'}">
            <div class="ps-lin"><span>Preços para corrigir</span><b>${precos.length}</b></div>
            ${urg ? `<div class="ps-lin ps-urgente"><span>⚠ Mais baratos que deveriam</span><b>${urg}</b></div>` : ''}
            <div class="ps-sub">Preço do catálogo = valor do CTW + ${brl(extra)}. A lista se atualiza sozinha quando um preço muda no CTW.</div></div>`
            + (precos.length ? ord.map(([g, l]) => cab(g, l, l.some(sobe) ? ` · ⚠ ${l.filter(sobe).length}` : '') + l.map(linhaPreco).join('')).join('') : '<div class="ps-msg">Nenhum preço para corrigir. 🎉</div>');
    } else if (aba === 'desativar' || aba === 'reativar') {
        const lista = aba === 'desativar' ? desativar : reativar;
        corpo = `<div class="ps-card ${lista.length ? 'ps-alerta' : 'ps-ok'}"><div class="ps-sub">${aba === 'desativar'
            ? 'Estão no catálogo do WhatsApp e não vieram no Stock 2.0 de hoje. No CTW eles continuam normais. “Ainda tem” esconde o aviso por ' + DIAS_AINDA_TEM + ' dias.'
            : 'Estavam desativados no WhatsApp e voltaram no Stock 2.0: reative no catálogo.'}</div></div>`
            + (lista.length ? agrupar(lista, e => e.nome, (a, b) => (b.desde || 0) - (a.desde || 0)).map(([g, l]) => cab(g, l) + l.map(linhaEsg).join('')).join('') : `<div class="ps-msg">Nada para ${aba === 'desativar' ? 'desativar' : 'reativar'}. 🎉</div>`);
    } else {
        const h = Object.entries(hist).sort((a, b) => b[0].localeCompare(a[0])).map(([, v]) => v);
        const rot = { preco: 'Preço corrigido', desativar: 'Desativado', reativar: 'Reativado' };
        corpo = h.length ? h.map(x => `<div class="ps-it"><div class="ps-grow"><div class="ps-nome">${esc(x.nome || '')}</div>
            <div class="ps-sub">${rot[x.tipo] || x.tipo}${x.tipo === 'preco' ? `: ${brl(x.de)} → ${brl(x.para)}` : ''}</div>
            <div class="ps-sub">${new Date(x.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}${x.usuario ? ' · ' + esc(x.usuario) : ''}</div></div></div>`).join('')
            : '<div class="ps-msg">Ainda não há histórico. Ele guarda as últimas ' + MAX_ZAPLOG + ' correções.</div>';
    }
    tela(`
      <div class="ps-abas">${abas.map(([k, nome, n]) => `<button type="button" class="${k === aba ? 'on' : ''}" data-act="zapaba" data-aba="${k}">${nome}${n ? ' ' + n : ''}</button>`).join('')}</div>
      ${corpo}
      <button type="button" class="ps-btn" data-act="inicio">Conferir com o ZIP do catálogo</button>`);
    S_zapAba = aba;
}
let S_zapAba = 'preco';

async function zapRemover(id) { await update(ref(getDb()), { [`${BASE}/zap/${id}`]: null }); }

// Alinha a lista com o que o ZIP mostrou: preço certo sai; preço errado entra (catálogo atual = preço lido − extra)
async function zapAlinhar(pares, extra) {
    const db = getDb();
    const atual = (await get(ref(db, BASE + '/zap'))).val() || {};
    const upd = {}; let total = Object.keys(atual).length;
    pares.forEach(({ it, c }) => {
        if (igual(it.preco, c.valor + extra)) { if (atual[c.id]) { upd[`${BASE}/zap/${c.id}`] = null; total--; } return; }
        if (!atual[c.id]) { if (total >= 200) return; total++; }
        upd[`${BASE}/zap/${c.id}`] = { nome: c.nome, de: Math.round((it.preco - extra) * 100) / 100, para: c.valor, quando: Date.now(), usuario: usuario(), origem: 'zip' };
    });
    if (Object.keys(upd).length) await update(ref(db), upd);
}

// ── Entrada ─────────────────────────────────────────────────────
function abrir() {
    if (!getDb()) { if (window.showCustomModal) window.showCustomModal({ message: 'O banco de dados ainda está conectando. Tente de novo em alguns segundos.' }); return; }
    abrirOverlay();
    telaInicio();
}

function abrirZap() {
    if (!(window.ctwEhDev && window.ctwEhDev())) return;
    if (!getDb()) { if (window.showCustomModal) window.showCustomModal({ message: 'O banco de dados ainda está conectando. Tente de novo em alguns segundos.' }); return; }
    abrirOverlay('Alterar no WhatsApp');
    telaZap('preco');
}

export { abrir, abrirZap };
