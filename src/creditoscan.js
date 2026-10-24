// ================================================================
// creditoscan.js — CreditoScan v17 (analise em segundo plano, OpenRouter + Qwen-VL-235B)
// ================================================================
(function () {
    'use strict';

    var OR_MODEL_VL  = 'qwen/qwen3-vl-235b-a22b-instruct';
    var OR_MODEL_TXT = 'qwen/qwen3-235b-a22b-2507';
    var OR_URL       = 'https://openrouter.ai/api/v1/chat/completions';
    var OR_KEY_LS    = 'ctwOpenRouterKey';
    var SAVE_PATH    = 'creditoscan';
    var MAX_IMG_PX   = 1280;
    var MAX_DOCS_ID  = 3;
    var MAX_DOCS_RND = 100;
    var MAX_PDF_PGS  = 50;
    var MAX_IMGS_AI  = 25;
    var HIST_DAYS    = 30;
    var TAXA_PADRAO          = 8;   // juros ao mes (%) do calculo do aparelho
    var PARCELAS_PADRAO      = 12;
    var MAX_JOBS_SIMULTANEOS = 2;   // analises rodando juntas; as demais esperam na fila

    var el      = function(id){ return document.getElementById(id); };
    var safeGet = function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } };
    var R$      = function(v){ return 'R$ '+Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); };
    var esc     = function(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };

    var _docsId     = [];    // rascunho da proxima analise: RG/CNH
    var _docsRend   = [];    // rascunho da proxima analise: comprovantes
    var _enviando   = 0;     // arquivos sendo lidos agora
    var _jobs       = [];    // analises desta sessao (a mais nova primeiro)
    var _jobSeq     = 0;
    var _view       = null;  // analise aberta na tela de resultado
    var _formAberto = null;  // formulario de nova analise visivel?

    async function getApiKey() {
        var local = safeGet(OR_KEY_LS);
        if (local) return local;
        try {
            var fb = await import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js');
            var db = window._firebaseDB; if (!db) return '';
            var snap = await fb.get(fb.ref(db, 'settings/openrouterKey'));
            var key = snap.val() || '';
            if (key) try { localStorage.setItem(OR_KEY_LS, key); } catch(e){}
            return key;
        } catch(e) { return ''; }
    }

    function resizeToBase64(file) {
        return new Promise(function(resolve) {
            var img = new Image(), url = URL.createObjectURL(file);
            img.onload = function() {
                URL.revokeObjectURL(url);
                var w = img.width, h = img.height, M = MAX_IMG_PX;
                if (w>M||h>M){if(w>h){h=Math.round(h*M/w);w=M;}else{w=Math.round(w*M/h);h=M;}}
                var c = document.createElement('canvas'); c.width=w; c.height=h;
                c.getContext('2d').drawImage(img,0,0,w,h);
                c.toBlob(function(bl){
                    var r=new FileReader(); r.onload=function(){resolve(r.result.split(',')[1]);}; r.readAsDataURL(bl);
                },'image/jpeg',0.88);
            };
            img.onerror=function(){URL.revokeObjectURL(url);resolve(null);};
            img.src=url;
        });
    }

    async function pdfToImages(file) {
        try {
            if (!window.pdfjsLib) {
                await new Promise(function(ok,fail){
                    var s=document.createElement('script');
                    s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
                    s.onload=ok; s.onerror=fail; document.head.appendChild(s);
                });
                window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            }
            var ab  = await file.arrayBuffer();
            var pdf = await window.pdfjsLib.getDocument({data:ab}).promise;
            var limit = Math.min(pdf.numPages, MAX_PDF_PGS);
            var out = [];
            var OCR_MAX = 1280;
            for (var i=1;i<=limit;i++) {
                var pg=await pdf.getPage(i), vp=pg.getViewport({scale:1.5});
                var cv=document.createElement('canvas'); cv.width=vp.width; cv.height=vp.height;
                await pg.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
                var fc=cv;
                if (vp.width>OCR_MAX||vp.height>OCR_MAX){
                    var sc=Math.min(OCR_MAX/vp.width,OCR_MAX/vp.height);
                    fc=document.createElement('canvas'); fc.width=Math.round(vp.width*sc); fc.height=Math.round(vp.height*sc);
                    fc.getContext('2d').drawImage(cv,0,0,fc.width,fc.height);
                }
                var b64=await new Promise(function(res){
                    fc.toBlob(function(bl){var r=new FileReader();r.onload=function(){res(r.result.split(',')[1]);};r.readAsDataURL(bl);},'image/jpeg',0.85);
                });
                out.push({base64:b64,dataUrl:fc.toDataURL('image/jpeg',0.5)});
            }
            return out;
        } catch(e){return [];}
    }

    // Extrai texto de PDF digital (extratos do app do banco — zero OCR)
    // Reconstroi quebras de linha baseado na posicao Y dos itens
    async function extrairTextoPdfDigital(file) {
        try {
            if (!window.pdfjsLib) {
                await new Promise(function(ok,fail){
                    var s=document.createElement('script');
                    s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
                    s.onload=ok; s.onerror=fail; document.head.appendChild(s);
                });
                window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            }
            var ab  = await file.arrayBuffer();
            var pdf = await window.pdfjsLib.getDocument({data:ab}).promise;
            var limit = Math.min(pdf.numPages, MAX_PDF_PGS);
            var textos = [], totalChars = 0;
            for (var i=1;i<=limit;i++) {
                var pg = await pdf.getPage(i);
                var content = await pg.getTextContent();
                // Agrupa itens por posicao Y para reconstruir linhas
                var lastY = null, lines = [], curLine = [];
                content.items.forEach(function(item) {
                    var y = item.transform ? Math.round(item.transform[5]) : 0;
                    if (lastY !== null && Math.abs(y - lastY) > 3) {
                        if (curLine.length) lines.push(curLine.join(' '));
                        curLine = [];
                    }
                    curLine.push(item.str);
                    lastY = y;
                });
                if (curLine.length) lines.push(curLine.join(' '));
                var pageText = lines.join('\n');
                textos.push(pageText);
                totalChars += pageText.length;
            }
            var ehDigital = (totalChars / limit) > 50;
            return { textos: textos, ehDigital: ehDigital };
        } catch(e) { return { textos: [], ehDigital: false }; }
    }

    function filtrarLinhasRelevantes(textos) {
        var RELEVANTE = [
            /R\$[\s\d.,]+/i, /[\d]{1,3}[.,][\d]{3}[.,][\d]{2}/, /[\d]+[.,][\d]{2}/,
            /sal.rio|sal.rio|l.quido|liquido|bruto|vencimento|desconto|inss|fgts|ir |irrf/i,
            /saldo|extrato|lan.amento|lancamento|credito|d.bito|debito/i,
            /pix|ted|doc|boleto|parcela|empr.stimo|emprestimo|financiamento/i,
            /entrada|sa.da|saida|transfer.ncia|transferencia|dep.sito|deposito|saque/i,
            /bet|esportiv|pixbet|blaze|vaidebet|betnacional|apostas?|gaming|phoenix|banks tech|smart cluster|m v d s m|lottopay|apostaraiz|royal crest|atm publicidade|univebet|r torres|norbe|gold now|wiinpay|nexumpay|luxtak/i,
            /admiss.o|admissao|cargo|empresa|compet.ncia|competencia|holerite|contracheque/i,
            /janeiro|fevereiro|mar.o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro/i,
            /\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{2}\/\d{2}/
        ];
        var linhasFiltradas = [];
        textos.forEach(function(texto, idx) {
            var linhas = texto.split('\n');
            var relevantes = linhas.filter(function(linha) {
                var l = linha.trim();
                if (l.length < 4) return false;
                return RELEVANTE.some(function(re) { return re.test(l); });
            });
            if (relevantes.length > 0) {
                linhasFiltradas.push('--- Pagina ' + (idx + 1) + ' ---');
                linhasFiltradas = linhasFiltradas.concat(relevantes);
            }
        });
        return linhasFiltradas.join('\n');
    }
    // ── OpenRouter API: chamada generica ──
    // Celular em rede movel derruba envios grandes ("Failed to fetch"): por isso ha
    // 3 tentativas, espera o app voltar ao primeiro plano/rede e um limite de tempo.
    var OR_TENTATIVAS = 3;
    var OR_TIMEOUT_MS = 180000;

    function pausa(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function aguardarAppPronto(maxMs) {
        return new Promise(function (resolve) {
            var fim = Date.now() + maxMs;
            (function tick() {
                var pronto = navigator.onLine !== false && !document.hidden;
                if (pronto || Date.now() >= fim) return resolve();
                setTimeout(tick, 700);
            })();
        });
    }

    function fmtMB(chars) { return chars < 1048576 ? Math.round(chars / 1024) + ' KB' : (chars / 1048576).toFixed(1).replace('.', ',') + ' MB'; }

    async function openRouterCall(model, messages) {
        var key = await getApiKey();
        if (!key) throw new Error('Chave OpenRouter nao configurada. Salve em Firebase > settings/openrouterKey');
        var corpo = JSON.stringify({ model: model, max_tokens: 6000, temperature: 0, messages: messages });
        var erroRede = null, t0 = Date.now(), tent = 0;
        while (tent < OR_TENTATIVAS) {
            tent++;
            var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            var timer = ctl ? setTimeout(function () { ctl.abort(); }, OR_TIMEOUT_MS) : null;
            try {
                var resp = await fetch(OR_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
                    body: corpo,
                    signal: ctl ? ctl.signal : undefined
                });
                if (timer) clearTimeout(timer);
                if (!resp.ok) {
                    var e = await resp.json().catch(function () { return {}; });
                    var msg = (e.error && e.error.message) || 'HTTP ' + resp.status;
                    // sobrecarga temporaria do provedor: vale tentar de novo
                    if ([429, 502, 503, 504, 524].indexOf(resp.status) !== -1 && tent < OR_TENTATIVAS) { erroRede = new Error(msg); await pausa(2500 * tent); continue; }
                    throw new Error(msg);
                }
                var d = await resp.json();
                return ((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '').trim();
            } catch (err) {
                if (timer) clearTimeout(timer);
                var ehRede = err && (err.name === 'TypeError' || err.name === 'AbortError');
                if (!ehRede) throw err;
                erroRede = err;
                console.warn('[CreditoScan] falha de rede ' + tent + '/' + OR_TENTATIVAS, err && err.message, '| envio', fmtMB(corpo.length), '| online', navigator.onLine, '| oculto', document.hidden);
                if (tent < OR_TENTATIVAS) { await aguardarAppPronto(120000); await pausa(1500 * tent); }
            }
        }
        var motivo = (erroRede && erroRede.name === 'AbortError') ? 'sem resposta em ' + Math.round(OR_TIMEOUT_MS / 1000) + 's' : ((erroRede && erroRede.message) || 'falha de rede');
        throw new Error(motivo + ' [envio ' + fmtMB(corpo.length) + ' · ' + tent + ' tentativas · ' + Math.round((Date.now() - t0) / 1000) + 's · ' +
            (navigator.onLine === false ? 'sem internet' : 'online') + (document.hidden ? ' · app em segundo plano' : '') + ']');
    }

    // Motor Vision: manda imagens + texto pro Qwen-VL via OpenRouter
    async function aiCallVision(imagens, textoExtra, prompt) {
        var content = [];
        imagens.forEach(function(img) {
            content.push({
                type: 'image_url',
                image_url: { url: 'data:image/jpeg;base64,' + img.base64 }
            });
        });
        if (textoExtra && textoExtra.trim()) {
            content.push({ type: 'text', text: textoExtra });
        }
        content.push({ type: 'text', text: prompt });
        return openRouterCall(OR_MODEL_VL, [{ role: 'user', content: content }]);
    }

    // ── Qwen3-235B texto — análise financeira consistente ──
    async function aiCallTexto(prompt) {
        return openRouterCall(OR_MODEL_TXT, [{ role: 'user', content: prompt }]);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  RENDA E NOTA: a IA CLASSIFICA e SOMA as entradas de cada mes; o
    //  sistema faz a conta (media/mediana, abatimentos) e a soma da regua.
    // ═══════════════════════════════════════════════════════════════════
    var DESC_VARIAVEL = 0.30;   // autonomo/comercio: custo sobre o bruto
    var DESC_APP      = 0.35;   // motorista/entregador de app: custo operacional
    var DESTOA_PCT    = 0.40;   // mes que foge mais de 40% da mediana = fora do padrao
    var DIAS_MINIMO   = 80;     // comprovante com menos dias que isso = curto (o ideal sao os 3 ultimos meses)
    var NOTA_REPROVA  = 50;     // nota 50 ou menos = reprovado (regra do dono)
    var MAX_MESES     = 6;      // seguranca: ignora lista absurda vinda da IA
    var MESES_ABREV   = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

    // Regras de renda: UM texto so, usado no prompt de texto e no de imagem
    var REGRAS_RENDA =
'Voce NAO calcula a renda final nem media: voce CLASSIFICA e SOMA as entradas validas de cada mes. O sistema faz media, mediana e abatimentos.\n'+
'Classifique cada entrada valida em um destes 3 grupos:\n'+
'  fixa     = salario/proventos (holerite: valor LIQUIDO), beneficio (INSS, aposentadoria, pensao) ou qualquer pagador FIXO que paga todo mes. TED "Proventos"/"Salario" do mesmo CPF vindo de outro banco tambem e fixa.\n'+
'  variavel = Pix/TED de TERCEIROS: clientes, vendas, servicos, comissoes. Transferencia de familiar/conjuge (mesmo sobrenome, descricao "mae", "esposa", "ajuda") SO entra aqui se se repetir em 2+ meses; se aparecer em 1 mes so, e excluida.\n'+
'  app      = repasses de apps de transporte/entrega (Uber, 99, InDrive, iFood, Rappi, Loggi...). Informe o valor BRUTO: o sistema desconta o custo operacional. NAO desconte nada voce mesmo.\n'+
'NAO SAO RENDA (some em "excluidas"):\n'+
'  - autotransferencia: Pix/TED do proprio CPF/nome entre contas proprias\n'+
'  - credito de emprestimo, financiamento, consignado, antecipacao, saque-aniversario FGTS\n'+
'  - estorno, reembolso, devolucao de Pix, cashback, rendimento, juros, correcao monetaria\n'+
'  - resgate de investimento, poupanca ou CDB\n'+
'  - deposito em dinheiro sem origem identificavel\n'+
'  - premio ou saque de casa de aposta\n'+
'  - 13o salario, ferias, PLR, rescisao (nao se repetem todo mes)\n'+
'  - entrada unica e muito acima do padrao dos outros meses, sem relacao com a atividade (venda de bem, acerto, emprestimo entre pessoas)\n'+
'Um item por MES CALENDARIO coberto pelos documentos (maximo os 3 mais recentes). NUNCA some meses diferentes no mesmo item; mes sem entradas = item com zeros. Informe tambem o periodo coberto em periodoDocumentos (primeira e ultima data dos documentos). Formato de cada item:\n'+
'  {"mes":"AAAA-MM","fixa":0.00,"variavel":0.00,"app":0.00,"excluidas":0.00,"parcial":false}\n'+
'Valores em reais, numero puro (ex.: 2350.90), sem texto. parcial=true SO se o documento cobre apenas parte daquele mes (ex.: comeca no dia 20). Confira a soma de cada mes antes de responder.\n';

    // ── Utilitarios ──────────────────────────────────────────────────
    // Numero vindo da IA: 2350.9, "2350.90", "2.350,90", "R$ 2.350,90"
    function numIA(v) {
        if (typeof v === 'number') return isFinite(v) ? v : NaN;
        var s = String(v == null ? '' : v).replace(/[\u2212\u2013]/g, '-').replace(/[^\d,.\-]/g, '');
        if (!s || s === '-') return NaN;
        if (s.indexOf(',') !== -1) s = s.replace(/\./g, '').replace(',', '.');
        else if ((s.match(/\./g) || []).length > 1 || /^-?\d{1,3}\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
        var n = parseFloat(s);
        return isFinite(n) ? n : NaN;
    }
    function numPos(v) { var n = numIA(v); return n > 0 ? n : 0; }
    function arred2(n) { return Math.round(n * 100) / 100; }
    function reaisCurto(v) { return R$(v).replace(/,00$/, ''); }

    function labelMes(m) {
        var x = /^(\d{4})-(\d{1,2})$/.exec(String(m || '').trim());
        return x && +x[2] >= 1 && +x[2] <= 12 ? MESES_ABREV[+x[2] - 1] + '/' + x[1].slice(2) : String(m || '').trim() || 'mês';
    }

    // Periodo informado pela IA: { meses: meses de calendario tocados, dias } ou null
    function periodoDoc(p) {
        if (!p || typeof p !== 'object') return null;
        var rx = /(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/, a = rx.exec(String(p.inicio || '')), b = rx.exec(String(p.fim || ''));
        if (!a || !b) return null;
        var n = (+b[1] - +a[1]) * 12 + (+b[2] - +a[2]) + 1;
        if (!(n >= 1 && n <= 12)) return null;
        var dias = a[3] && b[3] ? Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86400000) + 1 : null;
        return { meses: n, dias: dias !== null && dias >= 1 ? dias : null };
    }

    // ── Calculo da renda ─────────────────────────────────────────────
    // Devolve { renda, fonte:'codigo'|'ia', ... } ou null se nao ha nenhum dado.
    //  - 'codigo': calculado aqui a partir de rendaMeses
    //  - 'ia': a IA nao detalhou os meses; usa o numero que ela deu (formato antigo)
    function calcularRenda(obj) {
        if (!obj) return null;
        var iaNum = numPos(obj.rendaEstimada) || numPos(obj.rendaMensal);
        var lista = Array.isArray(obj.rendaMeses) ? obj.rendaMeses.filter(function (m) { return m && typeof m === 'object'; }) : [];
        if (lista.length > MAX_MESES) lista = lista.slice(-MAX_MESES);

        var meses = lista.map(function (m) {
            var fixa = numPos(m.fixa), variavel = numPos(m.variavel), app = numPos(m.app);
            return {
                mes: String(m.mes || ''), fixa: fixa, variavel: variavel, app: app, excluidas: numPos(m.excluidas),
                parcial: m.parcial === true || m.parcial === 'true',
                liquido: arred2(fixa + variavel * (1 - DESC_VARIAVEL) + app * (1 - DESC_APP)),
                abatido: arred2(variavel * DESC_VARIAVEL + app * DESC_APP)
            };
        });

        var soma = meses.reduce(function (a, m) { return a + m.fixa + m.variavel + m.app; }, 0);
        if (!meses.length || soma <= 0) {
            // sem detalhamento utilizavel: confia no numero da IA (formato antigo / resposta incompleta)
            if (iaNum > 0) return { renda: arred2(iaNum), fonte: 'ia', meses: [] };
            // a IA detalhou e nao achou nenhuma entrada valida: renda 0 de verdade
            return meses.length ? { renda: 0, fonte: 'codigo', meses: meses, usados: meses, media: 0, mediana: 0, destoa: false, abatidoMedio: 0, parciaisIgnorados: 0 } : null;
        }

        // A IA deve listar 1 item por mes do periodo. Se listou menos (somou varios meses num so item,
        // ou pulou um), o total e dividido pelos meses do periodo: nunca superestima a renda.
        var per = periodoDoc(obj.periodoDocumentos), span = per ? per.meses : 1;
        var curto = per && per.dias !== null ? per.dias < DIAS_MINIMO : meses.length < 3;
        var distintos = {};
        meses.forEach(function (m, i) { distintos[m.mes || ('#' + i)] = true; });
        var nItens = Object.keys(distintos).length;
        if (span > 1 && nItens < span) {
            var totalLiq = meses.reduce(function (a, m) { return a + m.liquido; }, 0);
            return {
                renda: arred2(totalLiq / span), fonte: 'codigo', meses: meses, usados: meses, media: arred2(totalLiq / span), mediana: arred2(totalLiq / span),
                destoa: false, abatidoMedio: 0, parciaisIgnorados: 0, agrupado: true, span: span, itens: nItens, total: arred2(totalLiq), curto: curto, dias: per ? per.dias : null
            };
        }

        // mes parcial so e ignorado se sobrar pelo menos um mes completo
        var completos = meses.filter(function (m) { return !m.parcial; });
        var usados = completos.length ? completos : meses;
        var valores = usados.map(function (m) { return m.liquido; });
        var media = valores.reduce(function (a, v) { return a + v; }, 0) / valores.length;
        var ord = valores.slice().sort(function (a, b) { return a - b; });
        var meio = Math.floor(ord.length / 2);
        var mediana = ord.length % 2 ? ord[meio] : (ord[meio - 1] + ord[meio]) / 2;
        var destoa = mediana > 0
            ? valores.some(function (v) { return Math.abs(v - mediana) / mediana > DESTOA_PCT; })
            : valores.some(function (v) { return v > 0; });
        var base = destoa ? Math.min(media, mediana) : media;
        var abatidoMedio = usados.reduce(function (a, m) { return a + m.abatido; }, 0) / usados.length;
        return {
            renda: arred2(base), fonte: 'codigo', meses: meses, usados: usados, media: arred2(media), mediana: arred2(mediana),
            destoa: destoa, abatidoMedio: arred2(abatidoMedio), parciaisIgnorados: completos.length ? meses.length - completos.length : 0,
            curto: curto, dias: per ? per.dias : null
        };
    }

    // Texto curto e honesto de como a renda saiu (aparece na tela e vai pro historico)
    function descreverRenda(c) {
        if (!c || c.fonte !== 'codigo' || !c.usados || !c.usados.length) return '';
        var L = [];
        if (c.agrupado) {
            L.push('Período dos documentos: ' + c.span + ' meses, mas a IA detalhou só ' + c.itens + '.');
            L.push('Total de entradas válidas ' + reaisCurto(c.total) + ' dividido por ' + c.span + ' meses.');
            var vA = c.usados.reduce(function (a, m) { return a + m.variavel; }, 0), pA = c.usados.reduce(function (a, m) { return a + m.app; }, 0);
            if (vA > 0 || pA > 0) L.push('Abatimento de custo já descontado: ' + [vA > 0 ? Math.round(DESC_VARIAVEL * 100) + '% autônomo/clientes' : '', pA > 0 ? Math.round(DESC_APP * 100) + '% app' : ''].filter(Boolean).join(' e ') + '.');
            if (c.curto) L.push(avisoCurto(c));
            return L.join('\n');
        }
        L.push('Entradas válidas por mês: ' + c.usados.map(function (m) { return labelMes(m.mes) + ' ' + reaisCurto(m.liquido); }).join(' · '));
        if (c.usados.length === 1) L.push('Só 1 mês de comprovante: renda baseada nele.');
        else if (c.destoa) L.push('Mês fora do padrão: usado o menor valor entre a média (' + reaisCurto(c.media) + ') e a mediana (' + reaisCurto(c.mediana) + ').');
        else L.push('Média dos ' + c.usados.length + ' meses.');
        var vAbat = c.usados.reduce(function (a, m) { return a + m.variavel; }, 0), pAbat = c.usados.reduce(function (a, m) { return a + m.app; }, 0);
        if (vAbat > 0 || pAbat > 0) {
            var partes = [];
            if (vAbat > 0) partes.push(Math.round(DESC_VARIAVEL * 100) + '% sobre ganhos de autônomo/clientes');
            if (pAbat > 0) partes.push(Math.round(DESC_APP * 100) + '% sobre repasses de app');
            L.push('Abatimento de custo: ' + partes.join(' e ') + ' (já descontado nos valores acima).');
        }
        if (c.parciaisIgnorados) L.push(c.parciaisIgnorados + (c.parciaisIgnorados > 1 ? ' meses parciais ignorados.' : ' mês parcial ignorado.'));
        if (c.curto) L.push(avisoCurto(c));
        return L.join('\n');
    }

    // Linha de alerta (comeca com ⚠: a tela destaca) quando o comprovante tem menos de ~3 meses
    function avisoCurto(c) {
        return '⚠ Comprovante curto' + (c.dias ? ' (' + c.dias + ' dias)' : ' (menos de 3 meses)') + ': o ideal são os 3 últimos meses. Renda e nota ficam menos confiáveis; peça o extrato completo.';
    }

    // ── Prompt da etapa 1 (so texto digital): apenas a renda ─────────
    function buildPromptRenda(textoExtrato) {
        return 'Voce e um analista financeiro. Leia o extrato bancario abaixo e levante a RENDA MENSAL REAL do titular, mes a mes.\n\n' +
            'EXTRATO:\n' + textoExtrato.substring(0, 30000) + '\n\n' +
            '=== REGRAS DE RENDA ===\n' +
            'Identifique o nome e o CPF do TITULAR no cabecalho.\n' +
            REGRAS_RENDA + '\n' +
            'Retorne APENAS JSON valido, sem texto extra:\n' +
            '{"titular":"","periodoDocumentos":{"inicio":"AAAA-MM-DD","fim":"AAAA-MM-DD"},"rendaMeses":[{"mes":"AAAA-MM","fixa":0.00,"variavel":0.00,"app":0.00,"excluidas":0.00,"parcial":false}]}\n' +
            'Nao invente. Se nao houver nenhuma entrada valida, retorne rendaMeses com os valores zerados.';
    }

    // ═══════════════════════════════════════════════════════════════════
    //  REGUA DA NOTA: a IA escolhe o valor DENTRO da faixa de cada item;
    //  o sistema limita a faixa, soma e classifica.
    // ═══════════════════════════════════════════════════════════════════
    var REGUA_BASE = 50;
    var NOTA_TETO  = 92;   // nenhum cliente e perfeito
    var REGUA_ITENS = [
        { k: 'origem', nome: 'Origem e estabilidade da renda', min: -10, max: 15,
          regra: 'fixa e recorrente +15 | mista ou autonomo regular +8 | irregular 0 | muito irregular ou so 1 mes de renda -10' },
        { k: 'sobra', nome: 'Sobra do mes (entradas - saidas)', min: -15, max: 10,
          regra: 'sobra acima de 25% +10 | 10 a 25% +6 | 0 a 10% +2 | gasta mais do que entra -8 | gasta bem mais (acima de 110% das entradas) -15' },
        { k: 'saldos', nome: 'Saldos de fim de mes', min: -10, max: 8,
          regra: 'positivos e estaveis/crescentes +8 | positivos baixos +3 | zerados todo mes (tudo que entra sai) -2 | negativos ou cheque especial -10' },
        { k: 'comprometimento', nome: 'Compromissos fixos', min: -30, max: 5,
          regra: 'ate 20% +5 | 21 a 40% +2 | 41 a 60% -3 | 61 a 80% -10 | 81 a 95% -20 | acima de 95% -30 (percentual = soma dos valorMensal de "compromissos" / media das entradas validas; o sistema refaz esse item com a renda final)' },
        { k: 'gastos', nome: 'Perfil de gastos', min: -10, max: 5,
          regra: 'economico (so o essencial, guarda dinheiro) +5 | equilibrado 0 | gastador (delivery, lazer e compras por impulso pesam muito) -5 a -10' },
        { k: 'dividas', nome: 'Dividas e juros', min: -20, max: 0,
          regra: 'cada emprestimo/financiamento ativo -3 (maximo -10) | juros de cheque especial ou cartao rotativo, atrasos -5 a -10 | nenhum 0' },
        { k: 'outros', nome: 'Outros sinais', min: -10, max: 5,
          regra: 'so para algo relevante que as faixas acima nao cobrem (justifique); senao 0' }
    ];

    function reguaTextoPrompt() {
        var t = 'Parta de ' + REGUA_BASE + ' pontos e aplique os itens abaixo. Em cada item escolha UM valor dentro da faixa, conforme a gravidade, e preencha em "pontos" (numero inteiro). Nao invente itens nem pesos: o sistema limita cada valor a faixa e faz a soma.\n';
        REGUA_ITENS.forEach(function (it, i) { t += (i + 1) + '. ' + it.nome + ' [' + it.k + ': de ' + it.min + ' a +' + it.max + ']: ' + it.regra + '\n'; });
        t += (REGUA_ITENS.length + 1) + '. Apostas: o sistema pontua sozinho (use apenas casasDeJogoEncontradas); NAO desconte apostas em nenhum item.\n';
        return t;
    }

    function pontosComprometimento(pct) {
        return pct <= 20 ? 5 : pct <= 40 ? 2 : pct <= 60 ? -3 : pct <= 80 ? -10 : pct <= 95 ? -20 : -30;
    }

    // Aceita os pontos da IA (objeto k->numero). Devolve itens limitados a faixa, ou null se nao serve.
    function validarPontos(p) {
        if (!p || typeof p !== 'object') return null;
        var itens = {}, achou = 0;
        REGUA_ITENS.forEach(function (it) {
            var n = numIA(p[it.k]);
            if (isFinite(n)) { achou++; n = Math.round(Math.max(it.min, Math.min(it.max, n))); } else n = 0;
            itens[it.k] = n;
        });
        return achou >= 4 ? itens : null;
    }

    // Faixa do cliente APROVADO pela nota (entrada exigida); reprovado nao passa por aqui
    function riscoPorNota(nota) {
        return nota >= 85 ? { risco: 'FORTE', entradaPct: 0.33 } : nota >= 60 ? { risco: 'MEDIO', entradaPct: 0.35 } : { risco: 'FRACO', entradaPct: 0.60 };
    }

    // Decisao pela nota: 50 ou menos reprova (FRACO = 51 a 59)
    function classificarPorNota(d) {
        if (d.nomesBatem === false) return;
        if (d.nota > NOTA_REPROVA) {
            var r = riscoPorNota(d.nota);
            d.aprov = true; d.reprovado = false; d.risco = r.risco; d.entradaPct = r.entradaPct;
        } else { d.aprov = false; d.reprovado = true; d.risco = 'REPROVADO'; d.entradaPct = 0.60; }
    }

    // ── Compromissos fixos ───────────────────────────────────────────
    // Sinais no TEXTO do extrato (zero tokens): palavras que quase sempre indicam um compromisso mensal.
    var SINAIS_COMPROMISSO = [
        { k: 'fatura de cartão', re: /fatura/g },
        { k: 'parcela', re: /parcel|presta[cç][aã]o/g },
        { k: 'financiamento', re: /financ/g },
        { k: 'empréstimo', re: /empr[eé]stimo|consignado/g },
        { k: 'consórcio', re: /cons[oó]rcio/g },
        { k: 'aluguel', re: /alugu[eé]l|imobili[aá]ri/g },
        { k: 'boleto', re: /boleto/g },
        { k: 'mensalidade', re: /mensalidade|faculdade|col[eé]gio/g },
        { k: 'seguro/plano', re: /seguro|plano de sa[uú]de|unimed|\bamil\b/g },
        { k: 'carnê/crediário', re: /carn[eê]|credi[aá]rio/g }
    ];
    var SINAIS_MINIMO = 3;   // ocorrencias no texto para a IA ter que justificar "nenhum compromisso"

    function detectarSinaisCompromisso(texto) {
        var t = String(texto || '').toLowerCase();
        if (!t) return null;
        var termos = [], total = 0;
        SINAIS_COMPROMISSO.forEach(function (s) {
            var m = t.match(s.re);
            if (m && m.length) { termos.push(s.k + ' (' + m.length + ')'); total += m.length; }
        });
        return total ? { total: total, termos: termos } : null;
    }

    // Lista de compromissos da IA -> itens limpos e soma. Formato antigo: so o total em compromissosMensais.
    function listarCompromissos(raw) {
        raw = raw || {};
        if (Array.isArray(raw.compromissos)) {
            var porNome = {}, ordem = [];
            raw.compromissos.forEach(function (c) {
                if (!c || typeof c !== 'object') return;
                var v = numIA(c.valorMensal);
                if (!(v > 0)) return;
                var desc = String(c.descricao || c.tipo || 'Compromisso').trim().substring(0, 60) || 'Compromisso';
                var k = desc.toLowerCase();
                if (porNome[k]) { if (v > porNome[k].valor) porNome[k].valor = arred2(v); return; }   // mesmo credor repetido por mes: vale um so
                porNome[k] = { desc: desc, valor: arred2(v), meses: numPos(c.meses) || 0 };
                ordem.push(porNome[k]);
            });
            return { fonte: 'lista', itens: ordem, total: arred2(ordem.reduce(function (a, i) { return a + i.valor; }, 0)) };
        }
        var comp = numIA(raw.compromissosMensais);
        return isFinite(comp) && comp >= 0 ? { fonte: 'total', itens: [], total: arred2(comp) } : null;
    }

    // Entradas x saidas por mes (informativo; nao entra na nota): quanto do que entrou foi embora
    function calcularFluxo(raw) {
        var lista = Array.isArray((raw || {}).fluxoMeses) ? raw.fluxoMeses : [];
        var ent = 0, sai = 0, n = 0;
        lista.slice(0, MAX_MESES).forEach(function (m) {
            if (!m || typeof m !== 'object') return;
            var e = numIA(m.entradas), s = numIA(m.saidas);
            if (e > 0 && s >= 0) { ent += e; sai += s; n++; }
        });
        if (!(ent > 0)) return null;
        return { entradas: arred2(ent), saidas: arred2(sai), pct: Math.round(sai / ent * 100), meses: n };
    }

    // Comprometimento em R$ (lista de compromissos da IA) -> % da renda FINAL.
    // Lista vazia com varios sinais no extrato = duvida: o item nao pontua e a tela avisa.
    function calcularComprometimento(d) {
        var l = listarCompromissos(d.rawJson);
        d.compromissos = l ? l.total : null;
        d.compromissosLista = l ? l.itens : [];
        d.compromissoDuvida = !!(l && l.total === 0 && d.sinaisCompromisso && d.sinaisCompromisso.total >= SINAIS_MINIMO);
        d.comprometimentoPct = (!d.compromissoDuvida && d.compromissos !== null && d.rendaEstimada > 0) ? Math.round(d.compromissos / d.rendaEstimada * 100) : null;
        d.fluxo = calcularFluxo(d.rawJson);
        return d;
    }

    // Nomes que NAO sao casa de aposta (a IA confunde): titulo de capitalizacao/sorteio, clube de beneficios, loteria oficial
    var NAO_E_APOSTA = /milh[aã]o|capitaliza|clube de benef|benef[ií]cios e vantagens|tele ?sena|loteri[ac]|sorteio|cashback|viacap/i;

    // Separa o que a IA listou: confirmadas (contam) x suspeitas (so informam). Idempotente.
    // casasFinais = lista que ja foi decidida e salva (historico): vale como esta.
    function separarCasasJogo(d, casasFinais) {
        var raw = d.rawJson || {}, vistos = {}, conf = [], susp = [];
        var add = function (lista, nome) { var k = String(nome || '').trim(); if (k && !vistos[k.toLowerCase()]) { vistos[k.toLowerCase()] = true; lista.push(k); } };
        if (casasFinais) casasFinais.forEach(function (n) { add(conf, n); });
        (Array.isArray(raw.casasDeJogoEncontradas) ? raw.casasDeJogoEncontradas : []).forEach(function (n) {
            if (casasFinais || NAO_E_APOSTA.test(String(n))) add(susp, n); else add(conf, n);
        });
        (Array.isArray(raw.suspeitasJogo) ? raw.suspeitasJogo : []).forEach(function (n) { add(susp, n); });
        d.casasJogo = conf; d.suspeitasJogo = susp;
        return d;
    }

    // Aplica renda calculada + regua. Idempotente. calcPre = renda da etapa 1 (so texto), se houver.
    function finalizarPontuacao(d, calcPre) {
        var raw = d.rawJson || {};
        var calc = calcPre || calcularRenda(raw);
        separarCasasJogo(d);
        d.rendaCalc = calc || null;
        if (calc && calc.fonte === 'codigo') { d.rendaEstimada = calc.renda; d.rendaDetalhe = descreverRenda(calc); }
        else d.rendaDetalhe = '';

        calcularComprometimento(d);

        d.reguaAplicada = false;
        var pontos = validarPontos(raw.pontos);
        if (!pontos || d.nomesBatem === false) return d;
        if (d.comprometimentoPct !== null) pontos.comprometimento = pontosComprometimento(d.comprometimentoPct);
        else if (d.compromissoDuvida) pontos.comprometimento = 0;   // sem prova de que nao ha compromissos: nem bonus nem desconto

        var soma = REGUA_ITENS.reduce(function (a, it) { return a + pontos[it.k]; }, 0);
        var notaIA = d.nota;
        d.nota = Math.max(0, Math.min(NOTA_TETO, REGUA_BASE + soma));
        d.pontos = pontos; d.reguaAplicada = true;
        var eraReprovado = d.reprovado;
        classificarPorNota(d);
        if (d.reprovado && !d.motivos) {
            var neg = REGUA_ITENS.filter(function (it) { return pontos[it.k] < 0; }).sort(function (a, b) { return pontos[a.k] - pontos[b.k]; })
                .slice(0, 3).map(function (it) { return it.nome + ' (' + pontos[it.k] + ')'; });
            d.motivos = 'Pontuação ' + d.nota + ' — nota 50 ou menos reprova.' + (neg.length ? '\nMaiores descontos: ' + neg.join(', ') + '.' : '');
        } else if (eraReprovado && !d.reprovado) d.motivos = '';

        var sinal = function (n) { return (n > 0 ? '+' : '') + n; };
        var linhas = ['Base ' + REGUA_BASE];
        REGUA_ITENS.forEach(function (it) {
            var extra = it.k !== 'comprometimento' ? '' : d.comprometimentoPct !== null ? ' (' + d.comprometimentoPct + '% da renda)' : d.compromissoDuvida ? ' (não avaliado: a IA não achou compromissos, mas o extrato tem sinais)' : '';
            linhas.push(it.nome + extra + ': ' + sinal(pontos[it.k]));
        });
        linhas.push('Total: ' + d.nota + (notaIA !== d.nota && notaIA > 0 ? '  (a IA tinha estimado ' + notaIA + '; vale a soma da régua)' : ''));
        d.calculo = linhas.join('\n') + (d.calculo ? '\n\nJustificativa da IA:\n' + d.calculo : '');
        return d;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  VEREDITO: o sistema decide; se a IA pensou diferente, a tela avisa
    // ═══════════════════════════════════════════════════════════════════
    function iaReprovou(d) {
        var raw = d.rawJson || {};
        return /REPROV/i.test(String(raw.decisao || '')) || /REPROV/i.test(String(raw.nivel || ''));
    }

    // Texto do aviso quando a decisao final do sistema e diferente da recomendacao da IA ('' se concordam)
    function avisoDivergencia(d) {
        if (!d.rawJson || d.nomesBatem === false) return '';
        var ia = iaReprovou(d), casas = (d.casasJogo || []).filter(Boolean);
        if (ia && !d.reprovado) {
            var susp = (d.suspeitasJogo || []).filter(Boolean);
            var porAposta = casas.length > 0 || susp.length > 0 || /aposta|jog|bet/i.test(String((d.rawJson.motivosReprovacao || '') + ' ' + (d.resumoExec || '')));
            return 'A IA recomendou reprovar, mas pelas regras do sistema o cliente passa (nota ' + d.nota + ').' +
                (porAposta ? ' Apostas: ' + (casas.length ? casas.length + (casas.length > 1 ? ' casas sinalizadas' : ' casa sinalizada') + ' — o sistema desconta 10 pontos por 1 casa e 20 por 2, e só reprova direto com 3 casas ou mais, ou apostas frequentes.'
                        : susp.length ? susp.length + (susp.length > 1 ? ' nomes suspeitos' : ' nome suspeito') + ' (' + susp.slice(0, 2).join(', ') + '), que não são casas de aposta confirmadas e por isso não descontam nota.'
                        : 'sinais no extrato, sem casa confirmada.') + ' Confira a transação em "Casas de jogo" antes de fechar.'
                    : ' Confira a análise completa antes de fechar.');
        }
        if (!ia && d.reprovado) return 'A IA tinha aprovado, mas o sistema reprovou' + (d.motivos ? ': ' + String(d.motivos).split('\n')[0] : '.');
        return '';
    }

    function buildPrompt(rendaPre) {
        return (
'Voce e um analista de credito senior da Workcell, loja de celulares em Joinville-SC.\n'+
'Analise os documentos do cliente e retorne APENAS um JSON valido, sem texto adicional.\n\n'+

'=== CONTEXTO ===\n'+
'A Workcell vende celulares parcelados no boleto. Seu trabalho e medir o risco com PRECISAO:\n'+
'aprovar quem consegue pagar e reprovar quem nao consegue. Errar pra cima gera inadimplencia;\n'+
'errar pra baixo perde venda. Nao seja generoso nem rigido demais: seja exato.\n'+
'Voce recebera imagens (RG/CNH, holerites) e/ou texto digital de extratos bancarios.\n'+
'Ainda NAO existe produto nem valor definido: avalie apenas o PERFIL do cliente (renda e comportamento).\n'+
'O calculo de entrada e parcela e feito depois, pelo sistema.\n\n'+

'=== TITULARIDADE ===\n'+
'Se houver RG/CNH: extraia o nome (IGNORE filiacao/mae/pai) e compare com o nome do extrato.\n'+
'Nomes diferentes = fraude = nota 0 REPROVADO. Sem documento pessoal: nomesBatem null.\n'+
'SEMPRE preencha nomeComprovanteRenda com o nome do TITULAR da conta/holerite (fica no cabecalho do extrato, perto do CPF). So deixe vazio se realmente nao aparecer.\n\n'+

'=== RENDA ===\n'+
(rendaPre
  ? '⚠️ RENDA JA CALCULADA PELO SISTEMA: R$ '+Number(rendaPre.renda).toFixed(2)+' por mes. Use exatamente este valor em rendaEstimada; nao recalcule nem classifique a renda de novo.\n\n'
  : REGRAS_RENDA+'\n')+

'=== NOTA (0 a 100): REGUA FIXA ===\n'+
'Analise o comportamento financeiro como um consultor experiente (perfil de gastos, sobra, comprometimento, disciplina, dividas), mas pontue SOMENTE pela regua abaixo.\n'+
reguaTextoPrompt()+'\n'+

'=== APENAS 2 REPROVACOES OBRIGATORIAS ===\n'+
'1. Renda real < R$ 1.000/mes = REPROVADO (nao tem como pagar)\n'+
'2. Apostador compulsivo = REPROVADO\n'+
'   Casas: PHOENIX GAMING, PIXBET, BLAZE, APOSTARAIZ, BANKS TECH, ATM PUBLICIDADE,\n'+
'   SMART CLUSTER, M V D S M TECHNOLOGY, LOTTOPAY, GM INTERMEDIACAO, WIINPAY,\n'+
'   AJC GATEWAY, NEXUMPAY, UNIVEBET, VAIDEBET, BETNACIONAL, R TORRES, NORBE FINTECH,\n'+
'   GOLD NOW, LUXTAK, ou nome contendo BET/GAMING/APOSTAS/CASSINO.\n'+
'   "SAQUE DIN LOTERICO" NAO e aposta — e operacao bancaria.\n'+
'   10+ transacoes OU R$800+/mes OU 3+ meses = REPROVADO.\n'+
'   1-4 esporadicas = o sistema penaliza a nota (voce nao desconta) mas nao reprova.\n\n'+

'Nota 50 ou menos tambem reprova (o sistema decide pela nota). Todo o resto APROVA com condicoes (o sistema aplica depois):\n'+
'  FORTE (85-100): entrada 33% | teto parcela 30% da renda\n'+
'  MEDIO (60-84):  entrada 35% | teto parcela 20% da renda\n'+
'  FRACO (51-59):  entrada 60% | teto parcela 10% da renda\n\n'+

'=== INSTRUCOES DOS CAMPOS NARRATIVOS ===\n'+
'Seja DETALHADO. Use \\n dentro das strings para separar topicos. O vendedor precisa entender tudo.\n'+
'NAO escreva "aprovado", "reprovado" nem "pode vender" em nenhum texto: quem decide e o sistema, pela nota e pelas regras de apostas.\n\n'+
'analiseFinanceira: Organize em secoes com estes cabecalhos EXATOS (so inclua se tiver dados):\n'+
'  RENDA: mes a mes, fonte e valor das entradas validas, e o que foi excluido (e por que). Ex: "ALL MOTORS: R$1.795 (jan) / R$1.675 (fev)". NAO calcule media final nem aplique abatimentos: o sistema faz isso\n'+
'  CASAS DE JOGO: so as CONFIRMADAS (casasDeJogoEncontradas), mes a mes, nome, valor enviado e recebido\n'+
'  COMPROMISSOS FIXOS: cada compromisso da lista "compromissos" com credor e valor mensal (ou "nenhum encontrado")\n'+
'  COMPROMETIMENTO: soma dos compromissos fixos em reais e % da renda (ex: "R$ 900 de R$ 1.800 — aproximadamente 50%"). Gastos do dia a dia nao entram aqui: eles aparecem em SALDOS e na sobra do mes.\n'+
'  SALDOS: saldo final de cada mes\n'+
'  DIVIDAS ATIVAS: emprestimos identificados com nome da instituicao\n'+
'  PADROES DE RISCO: comportamentos que chamaram atencao\n\n'+
'calculoPontuacao: UMA frase curta de justificativa por item da regua (sem repetir os numeros e sem somar; o sistema monta a tabela e o total).\n'+
(rendaPre ? '' : 'rendaEstimada: sua estimativa da renda mensal (reserva; o sistema recalcula a partir de rendaMeses).\n')+
'compromissos: lista dos compromissos FIXOS do cliente. ANTES de responder, percorra os DEBITOS de cada mes procurando cada tipo abaixo, um por um:\n'+
'  fatura de cartao de credito (pagamento da fatura), emprestimo/consignado, financiamento, consorcio, crediario/carne/boleto de loja, parcelamento,\n'+
'  aluguel, plano de saude/seguro, mensalidade (escola, faculdade, academia), pensao, e Pix/TED RECORRENTE (mesmo valor ou quase, mesmo destinatario, em 2+ meses).\n'+
'  NAO entram: mercado, farmacia, restaurante, luz, agua, internet, combustivel, transporte e Pix avulso (aparecem em SALDOS e na sobra).\n'+
'  Uma linha por compromisso (NAO repita o mesmo credor por mes), com o nome do credor em descricao. valorMensal = quanto ele pesa POR MES (valor medio por mes no periodo; se pagou em so 1 dos meses, divida pelos meses do periodo). meses = em quantos meses apareceu.\n'+
'  Lista vazia [] SO se voce realmente procurou todos os tipos acima e nao achou nenhum. Na duvida, liste e explique em COMPROMISSOS FIXOS.\n'+
'fluxoMeses: por mes, entradas = soma de TODOS os creditos (sem estornos nem transferencias entre contas do proprio titular) e saidas = soma de TODOS os debitos. Valores aproximados servem; so informativo.\n'+
'conselho: dica especifica. Se reprovado: o que mudaria. Se aprovado: o que checar ao fechar a venda.\n\n'+
'casasDeJogoEncontradas: CAMPO CRITICO. So liste aqui quando o DESTINATARIO for CLARAMENTE uma casa de aposta, cassino ou jogo online\n'+
'(o proprio nome diz, ou e uma das casas/gateways conhecidos). Nomes EXATOS. Se nenhuma: []. Exemplos:\n'+
'R Torres, Royal Crest, Nexabet, Nexumpay, Smart Cluster, Ganha Sorte, Vendifootball,\n'+
'GM Intermediacao, Norbe Fintech, Phoenix Gaming, Pixbet, Blaze, Vaidebet, Betnacional,\n'+
'ou nome contendo BET (como palavra), GAMING, APOSTAS, CASSINO.\n'+
'NAO SAO casas de aposta (nunca liste): loterias oficiais e loterica, titulo de capitalizacao e sorteio (Pix do Milhao, Tele Sena, ViaCap), clube de beneficios, cashback, Pix para pessoa fisica (mesmo com nome parecido, ex.: Beto, Betania), academia, clube esportivo.\n'+
'Na DUVIDA, nao coloque em casasDeJogoEncontradas: coloque em suspeitasJogo (so informa o vendedor, nao penaliza). Nao use "padrao de sorteio" ou valor repetido como prova de aposta.\n\n'+
'=== JSON ===\n'+
'{\n'+
'  "nomeDocumentoPessoal": "",\n'+
'  "nomeComprovanteRenda": "",\n'+
'  "nomesBatem": true,\n'+
'  "confiancaLeitura": "ALTA",\n'+
'  "resumoExecutivo": "1 frase: nome e veredicto (nao cite valor de renda: o sistema calcula).",\n'+
'  "perfilCliente": "Perfil detalhado 4-6 linhas: fonte de renda, estabilidade, comportamento.",\n'+
'  "analiseFinanceira": "Analise completa com cabecalhos RENDA:, COMPROMETIMENTO:, SALDOS:, etc.",\n'+
'  "calculoPontuacao": "Uma frase de justificativa por item da regua.",\n'+
'  "pontos": {"origem":0,"sobra":0,"saldos":0,"comprometimento":0,"gastos":0,"dividas":0,"outros":0},\n'+
'  "compromissos": [{"descricao":"Credor ou fatura","tipo":"fatura_cartao","valorMensal":0.00,"meses":0}],\n'+
'  "fluxoMeses": [{"mes":"AAAA-MM","entradas":0.00,"saidas":0.00}],\n'+
'  "conselho": "Dica pratica especifica pro vendedor.",\n'+
'  "casasDeJogoEncontradas": [],\n'+
'  "suspeitasJogo": [],\n'+
(rendaPre
  ? '  "rendaEstimada": '+Number(rendaPre.renda).toFixed(2)+',\n'
  : '  "periodoDocumentos": {"inicio":"AAAA-MM-DD","fim":"AAAA-MM-DD"},\n'+
    '  "rendaMeses": [{"mes":"AAAA-MM","fixa":0.00,"variavel":0.00,"app":0.00,"excluidas":0.00,"parcial":false}],\n'+
    '  "rendaEstimada": 0.00,\n')+
'  "nota": 0,\n'+
'  "nivel": "FORTE ou MEDIO ou FRACO ou REPROVADO",\n'+
'  "decisao": "VENDER ou REPROVADO",\n'+
'  "motivosReprovacao": "Topicos detalhados se reprovado. Vazio se aprovado."\n'+
'}\n'
        );
    }

    // Nome em CAIXA ALTA (como vem dos documentos) -> "Carlos Alberto Ferreira"
    function capNome(s) {
        s = String(s || '').trim();
        if (!s || s !== s.toUpperCase()) return s;
        return s.toLowerCase().replace(/(^|\s)([a-zà-ÿ])/g, function (m, sp, ch) { return sp + ch.toUpperCase(); })
                .replace(/\s(De|Da|Do|Das|Dos|E)(?=\s)/g, function (m) { return m.toLowerCase(); });
    }

    function extrair(texto) {
        var jsonStr = texto;
        try {
            var i1 = texto.indexOf('{'), i2 = texto.lastIndexOf('}');
            if (i1 !== -1 && i2 !== -1 && i2 > i1) jsonStr = texto.substring(i1, i2 + 1);
            var obj = JSON.parse(jsonStr);

            var nomesBatem = obj.nomesBatem !== false;
            var dec = (obj.decisao || '').toUpperCase();
            var nota = typeof obj.nota === 'number' ? obj.nota : parseInt(obj.nota || 0);
            if (nota > 92) nota = 92; // teto: nenhum cliente e perfeito

            if (!nomesBatem) {
                dec = 'REPROVADO'; nota = 0; obj.nivel = 'REPROVADO';
                obj.motivosReprovacao = 'Alerta de Fraude: Divergencia de Titularidade.\nDocumento Pessoal: ' +
                    (obj.nomeDocumentoPessoal||'Nao encontrado') + '\nComprovante de Renda: ' +
                    (obj.nomeComprovanteRenda||'Nao encontrado');
            }

            var downgrade   = dec.includes('DOWNGRADE');
            var entradaAlta = dec.includes('ENTRADA_ALTA');
            // Aprovacao SEMPRE derivada da nota — nunca confia no REPROVADO da IA se nota >= 40
            // A IA erra a decisao mas acerta a nota. O reavaliarDecisao() cuida do resto.
            var aprov;
            if (nota > NOTA_REPROVA) {
                // Nota ok — aprova (reavaliarDecisao vai calcular entrada turbinada/downgrade se precisar)
                aprov = true;
                // Mas respeita REPROVADO por fraude (nomesBatem=false já setou nota=0) ou apostas
            } else {
                aprov = false;
            }
            // Casos especiais que a IA identifica corretamente
            if (!nomesBatem) aprov = false;

            var renda       = typeof obj.rendaEstimada === 'number' ? obj.rendaEstimada : parseFloat(obj.rendaEstimada || 0);
            var entAltaCalc = typeof obj.entradaTurbinadaCalculada === 'number' ? obj.entradaTurbinadaCalculada : parseFloat(obj.entradaTurbinadaCalculada || 0);
            var nomeCompleto   = capNome(obj.nomeComprovanteRenda || obj.nomeDocumentoPessoal || 'Amigo(a)');
            var primeiroNome   = nomeCompleto.split(' ')[0];
            var confianca      = (obj.confiancaLeitura || 'ALTA').toUpperCase();

            var risco = 'REPROVADO', entradaPct = 0.60;
            if (nota >= 85) { risco = 'FORTE';      entradaPct = 0.33; }
            else if (nota >= 60) { risco = 'MEDIO'; entradaPct = 0.35; }
            else if (nota > NOTA_REPROVA) { risco = 'FRACO'; entradaPct = 0.60; }
            else { risco = 'REPROVADO'; aprov = false; }

            if (downgrade)   risco += ' · DOWNGRADE';
            if (entradaAlta) risco += ' · ENTRADA TURBINADA';

            return {
                aprov: aprov, downgrade: downgrade, entradaAlta: entradaAlta, reprovado: !aprov,
                nota: nota, risco: risco, entradaPct: entradaPct, rendaEstimada: renda,
                taxa: TAXA_PADRAO, parcelas: PARCELAS_PADRAO, entrada: entAltaCalc || null,
                nomeCliente: primeiroNome, nomeCompleto: nomeCompleto,
                nomeDocPessoal: obj.nomeDocumentoPessoal || '',
                nomeRenda: obj.nomeComprovanteRenda || '',
                nomesBatem: obj.nomesBatem, confianca: confianca,
                perfil: obj.perfilCliente || '', analise: obj.analiseFinanceira || '',
                calculo: obj.calculoPontuacao || '', conselho: obj.conselho || '',
                resumoExec: obj.resumoExecutivo || '',
                rascunho: obj.rascunhoCalculos || '', motivos: obj.motivosReprovacao || '',
                casasJogo: Array.isArray(obj.casasDeJogoEncontradas) ? obj.casasDeJogoEncontradas.filter(Boolean) : [],
                rawJson: obj
            };
        } catch(e) {
            return {
                aprov: false, downgrade: false, entradaAlta: false, reprovado: true,
                nota: 0, risco: 'ERRO (JSON)', entradaPct: 0.60, rendaEstimada: 0,
                nomeCliente: 'Erro', nomeCompleto: 'Erro na IA', confianca: 'ALTA',
                nomeDocPessoal: '', nomeRenda: '', nomesBatem: null,
                perfil: 'Erro de formatacao.', analise: texto, rascunho: '',
                motivos: 'Falha na resposta da IA. Tente novamente.'
            };
        }
    }

    function price(valor, entrada, n, taxaMes) {
        var s=valor-entrada; if(s<=0||n<=0)return 0;
        var t=taxaMes/100; if(t===0)return s/n;
        return s*(t*Math.pow(1+t,n))/(Math.pow(1+t,n)-1);
    }

    // Fator da Tabela Price: parcela = saldo / fatorPrice(n, taxa)
    function fatorPrice(n, taxaMes) {
        var t = taxaMes / 100;
        return t === 0 ? n : (1 - Math.pow(1 + t, -n)) / t;
    }

    // ── Parser de seções da analise financeira ──
    function parsearSecoes(texto) {
        if (!texto) return {};
        var KEYS = ['RENDA','CASAS DE JOGO','COMPROMISSOS FIXOS','COMPROMETIMENTO','SALDOS','DIVIDAS ATIVAS','PADROES DE RISCO'];
        var res = {};
        KEYS.forEach(function(k) {
            var ix = texto.indexOf(k+':');
            if (ix===-1) return;
            var s = ix+k.length+1;
            var e = texto.length;
            KEYS.forEach(function(k2){ if(k2===k)return; var i2=texto.indexOf(k2+':',s); if(i2!==-1&&i2<e)e=i2; });
            res[k] = texto.substring(s,e).trim().replace(/\n{3,}/g,'\n\n').replace(/^[\s\-]+/,'');
        });
        return res;
    }

    // ── Mensagem WhatsApp REPROVADO ──
    function gerarWppReprovado(nomeCliente) {
        return 'Opa! \u263a\ufe0f\n\nEnt\u00e3o, infelizmente a financeira n\u00e3o aprovou essa tentativa no momento \ud83d\ude1e\nMas calma, isso \u00e9 normal e pode mudar com o tempo!\n\nUma sugest\u00e3o: se tiver algu\u00e9m pr\u00f3ximo (como m\u00e3e, pai, irm\u00e3o, esposa...) que possa fazer a an\u00e1lise no nome dela(e), talvez d\u00ea certo. \ud83d\ude09\n\u00c9 s\u00f3 me avisar que eu mando as informa\u00e7\u00f5es de novo rapidinho! \ud83d\udcc4\u2705\n\nE claro, seguimos com outras op\u00e7\u00f5es tamb\u00e9m: cart\u00e3o de cr\u00e9dito em at\u00e9 18x sem juros, ou modelos mais acess\u00edveis no boleto.\n\nT\u00f4 por aqui pra te ajudar no que for preciso! \ud83e\udd1d\ud83d\udcf2';
    }

    function gerarWpp(produto, en, np, vp, d) {
        if (!d.aprov) return gerarWppReprovado(d.nomeCliente);
        if (d.downgrade) return 'Ol\u00e1 '+d.nomeCliente+'! Boas not\u00edcias, liberamos cr\u00e9dito pra voc\u00ea! \u2705\n\nO '+produto+' ultrapassou sua margem ideal, MAS temos um limite mais acess\u00edvel aprovado AGORA! \ud83d\ude80\nTemos \u00f3timas op\u00e7\u00f5es no estoque que cabem no seu bolso!\nMe fala qual modelo te interessa \ud83d\udc47';
        if (d.entradaAlta) return 'Ol\u00e1 '+d.nomeCliente+', tudo bem? \ud83d\ude0a\ud83d\udcf2\nSeu cadastro foi avaliado na Workcell! \u2705\n\nPara liberar o aparelho e manter a parcela suave, o sistema calculou uma entrada de '+R$(en)+'.\nSua parcela fica em apenas '+np+'x de '+R$(vp)+' MENSAL no boleto! \ud83d\udcc9\n\nVoc\u00ea tem esse valor dispon\u00edvel (FGTS, acerto, poupan\u00e7a)? \ud83d\udc47';
        return 'Ol\u00e1 '+d.nomeCliente+', tudo bem? \ud83d\ude0a\ud83d\udcf2\nSeu cadastro foi APROVADO aqui na Workcell! \u2705\n\n\ud83d\udcf1 '+produto+'\n\ud83d\udcb0 Entrada: '+R$(en)+'\n\ud83d\udcb3 + '+np+'x de '+R$(vp)+' MENSAL no boleto\n\n\u2714 Aparelho revisado e com garantia\nMe confirma aqui pra gente seguir com a libera\u00e7\u00e3o \ud83d\udc47';
    }

    async function salvarFB(nome, produto, texto, d, cpf_cliente) {
        try {
            var fb = await import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js');
            var db = window._firebaseDB; if (!db) return null;
            var now = Date.now();
            var resumoIA = d.aprov ? (d.resumoExec || d.rascunho || 'Aprovado conforme criterios.') : (d.motivos || 'Reprovado por risco financeiro.');

            var ref = await fb.push(fb.ref(db, SAVE_PATH), {
                nomeCliente: nome || 'Cliente',
                cpf: cpf_cliente || '',
                produto: produto || '',
                decisao: d.reprovado ? 'REPROVADO' : d.downgrade ? 'DOWNGRADE' : d.entradaAlta ? 'ENTRADA_ALTA' : 'APROVADO',
                nota: d.nota,
                risco: d.risco,
                rendaEstimada: d.rendaEstimada || null,
                rendaDetalhe: d.rendaDetalhe || null,
                calculoFinal: d.calculo || null,
                sinaisCompromisso: d.sinaisCompromisso ? d.sinaisCompromisso.total : null,
                casasJogo: (d.casasJogo || []).filter(Boolean).join(','),
                entrada: d.entrada || null,
                parcelas: d.parcelas || null,
                vparcela: d.vparcela || null,
                taxa: d.taxa || null,
                total: d.total || null,
                resumo: resumoIA,
                confianca: d.confianca || 'ALTA',
                textoCompleto: texto || '',
                ts: now,
                expira: now + HIST_DAYS * 86400000,
                operador: window.currentUserProfile || safeGet('ctwUserProfile') || '--'
            });
            return (ref && ref.key) || null;
        } catch (e) { return null; }
    }

    // Completa a analise ja salva com o aparelho calculado (nao cria registro novo)
    async function atualizarFB(key, patch) {
        if (!key) return false;
        try {
            var fb = await import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js');
            var db = window._firebaseDB; if (!db) return false;
            await fb.update(fb.ref(db, SAVE_PATH + '/' + key), patch);
            return true;
        } catch (e) { return false; }
    }

    async function abrirHist() {
        var ov=el('cs_hist_ov'); if(!ov)return; ov.classList.add('active');
        // Inject search box above list if not yet present
        var listWrap=el('cs_hist_list');
        if(listWrap&&!el('cs_hist_search_wrap')){
            var sw=document.createElement('div');sw.id='cs_hist_search_wrap';
            sw.style.cssText='padding:12px 14px 8px;position:sticky;top:0;background:var(--bg-color);z-index:5;';
            sw.innerHTML='<div style="position:relative"><i class="bi bi-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--ui-tx3);font-size:.8rem"></i>'+
                '<input id="cs_hist_search" type="search" placeholder="Buscar por nome, produto ou operador..." autocomplete="off"></div>'+
                '<div id="cs_hist_filtros" style="display:flex;gap:6px;margin-top:8px">'+
                    '<button class="cs-hfiltro cs-hfiltro-ativo" data-f="todos" style="padding:4px 10px;border-radius:99px;border:1px solid var(--ui-edge);background:var(--ui-icbg);color:var(--text-color);font-size:.65rem;font-weight:700;cursor:pointer;font-family:inherit">Todos</button>'+
                    '<button class="cs-hfiltro" data-f="aprovado" style="padding:4px 10px;border-radius:99px;border:1px solid rgba(74,222,128,.25);background:rgba(74,222,128,.06);color:#4ade80;font-size:.65rem;font-weight:700;cursor:pointer;font-family:inherit">✅ Aprovados</button>'+
                    '<button class="cs-hfiltro" data-f="reprovado" style="padding:4px 10px;border-radius:99px;border:1px solid rgba(239,68,68,.25);background:rgba(239,68,68,.06);color:#f87171;font-size:.65rem;font-weight:700;cursor:pointer;font-family:inherit">❌ Reprovados</button>'+
                '</div>';
            listWrap.parentNode.insertBefore(sw,listWrap);
        }
        if(listWrap){
            if(!document.getElementById('cs_hist_stats')){
                listWrap.innerHTML='<div id="cs_hist_stats" style="display:flex;flex-direction:column;gap:9px;margin-bottom:4px"></div><div id="cs_hist_items"><div class="cs-hist-load"><i class="bi bi-hourglass-split"></i> Carregando...</div></div>';
            } else {
                var _itmD=document.getElementById('cs_hist_items');
                if(_itmD) _itmD.innerHTML='<div class="cs-hist-load"><i class="bi bi-hourglass-split"></i> Carregando...</div>';
            }
        }
        try {
            var fb=await import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js');
            var db=window._firebaseDB; if(!db){var _fd=document.getElementById('cs_hist_items')||listWrap;if(_fd)_fd.innerHTML='<div class="cs-hist-empty">Firebase nao disponivel</div>';return;}
            var snap=await fb.get(fb.ref(db,SAVE_PATH)), items=[];
            if(snap.exists()) snap.forEach(function(c){var v=c.val();if(v)items.push(Object.assign({id:c.key},v));});
            items=items.filter(function(i){return i.ts&&i.ts>(Date.now()-365*86400000);}).sort(function(a,b){return(b.ts||0)-(a.ts||0);});
            window._histItems=items;
            if(!listWrap)return;
            if(!items.length){renderDashboard();var _ed=document.getElementById('cs_hist_items')||listWrap;if(_ed)_ed.innerHTML='<div class="cs-hist-empty">Nenhuma consulta recente</div>';return;}

            // ── PERIOD CHIPS ──────────────────────────────────────────────
            var periodDays = 30; // default
            function setPeriodChips(){
                document.querySelectorAll('.cs-pchip').forEach(function(b){
                    var isActive = parseInt(b.dataset.days) === periodDays;
                    b.classList.toggle('cs-pchip-ativo', isActive);
                });
            }
            document.querySelectorAll('.cs-pchip').forEach(function(b){
                b.addEventListener('click',function(){
                    periodDays = parseInt(this.dataset.days);
                    setPeriodChips();
                    renderDashboard();
                    renderItems();
                });
            });
            setPeriodChips();

            // ── LAYOUT C DASHBOARD ────────────────────────────────────────────
            var statsWrap = document.getElementById('cs_hist_stats');
            if(!statsWrap){
                statsWrap = document.createElement('div');
                statsWrap.id = 'cs_hist_stats';
                statsWrap.style.cssText = 'display:flex;flex-direction:column;gap:9px;margin-bottom:4px';
                listWrap.insertBefore(statsWrap, listWrap.firstChild);
            }

            function isAp(it){ return it.decisao==='APROVADO'||it.decisao==='ENTRADA_ALTA'||it.decisao==='DOWNGRADE'; }

            function renderDashboard(){
                var since = Date.now() - periodDays * 86400000;
                var sub = items.filter(function(i){ return i.ts >= since; });
                var ap = sub.filter(isAp);
                var rep = sub.filter(function(i){ return !isAp(i); });
                var pct = sub.length > 0 ? Math.round(ap.length/sub.length*100) : 0;

                // Nota média
                var notas = sub.map(function(i){ return typeof i.nota==='number'?i.nota:parseInt(i.nota)||null; }).filter(function(n){ return n!==null; });
                var notaMed = notas.length ? Math.round(notas.reduce(function(a,b){return a+b;},0)/notas.length) : '--';

                // Renda média aprovados
                var rendas = ap.map(function(i){ return parseFloat(i.rendaEstimada)||null; }).filter(function(r){ return r&&r>0; });
                var rendaMed = rendas.length ? Math.round(rendas.reduce(function(a,b){return a+b;},0)/rendas.length) : null;

                // Apostas
                var repAposta = rep.filter(function(i){ return i.casasJogo && String(i.casasJogo).length > 0; }).length;

                // Perfis
                var forte = sub.filter(function(i){ return (i.nota||0)>=85; }).length;
                var medio = sub.filter(function(i){ var n=i.nota||0; return n>=60&&n<85; }).length;
                var fraco = sub.filter(function(i){ var n=i.nota||0; return n>=40&&n<60; }).length;
                var reprN = rep.length;
                var maxP = Math.max(forte,medio,fraco,reprN,1);

                // Notas para mini barras verticais (faixas de 10)
                var faixas = [0,10,20,30,40,50,60,70,80,90];
                var faixaCounts = faixas.map(function(f){
                    return sub.filter(function(i){ var n=i.nota||0; return n>=f&&n<f+10; }).length;
                });
                var maxF = Math.max.apply(null, faixaCounts.concat([1]));

                // Nota mais frequente
                var notaFreq = {};
                sub.forEach(function(i){ var n=i.nota||0; notaFreq[n]=(notaFreq[n]||0)+1; });
                var topNota='--', topCount=0;
                Object.keys(notaFreq).forEach(function(k){ if(notaFreq[k]>topCount){topCount=notaFreq[k];topNota=k;} });

                // Insight apostas pct
                var apostaPct = rep.length > 0 ? Math.round(repAposta/rep.length*100) : 0;

                function pBar(label, count, color, gradient){
                    var w = sub.length > 0 ? Math.round(count/sub.length*100) : 0;
                    return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">'+
                        '<div style="font-size:.6rem;font-weight:700;width:54px;flex-shrink:0;color:'+color+'">'+label+'</div>'+
                        '<div style="flex:1;height:22px;background:var(--ui-icbg);border-radius:7px;overflow:hidden">'+
                            '<div style="width:'+w+'%;height:100%;background:'+gradient+';border-radius:7px;display:flex;align-items:center;padding-left:'+(w>15?'8':'0')+'px;font-size:.62rem;font-weight:700;color:rgba(0,0,0,.75);white-space:nowrap;transition:width .4s">'+
                                (w>12?count+' cliente'+(count!==1?'s':''):'')+'</div>'+
                        '</div>'+
                        '<div style="font-size:.65rem;font-weight:700;color:'+color+';width:22px;text-align:right">'+count+'</div>'+
                    '</div>';
                }

                function miniBar(i, count, maxVal){
                    var h = maxVal > 0 ? Math.round(count/maxVal*50) : 0;
                    var colors = ['#ef4444','#f97316','#f97316','#eab308','#eab308','#f97316','#f97316','#22c55e','#22c55e','#10b981'];
                    return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px">'+
                        '<div style="font-size:.52rem;font-weight:700;color:var(--ui-tx2)">'+count+'</div>'+
                        '<div style="width:100%;height:'+Math.max(h,2)+'px;background:'+colors[i]+';border-radius:3px 3px 0 0;opacity:.75;min-height:2px"></div>'+
                        '<div style="font-size:.49rem;color:var(--ui-tx3)">'+(faixas[i])+'</div>'+
                    '</div>';
                }

                statsWrap.innerHTML =
                    // Card resumo grande
                    '<div style="background:linear-gradient(135deg,rgba(var(--primary-color-rgb),.16),rgba(var(--primary-color-rgb),.04));border:1px solid var(--glass-border);border-radius:14px;padding:14px">'+
                        '<div style="font-size:.52rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--ui-tx3);margin-bottom:7px">'+
                            (periodDays===1?'Hoje':periodDays===7?'Últimos 7 dias':periodDays===30?'Últimos 30 dias':periodDays===90?'Últimos 3 meses':periodDays===180?'Últimos 6 meses':'Último ano')+
                        '</div>'+
                        '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px">'+
                            '<div><div style="font-size:2.2rem;font-weight:900;line-height:1">'+sub.length+'</div>'+
                            '<div style="font-size:.68rem;color:var(--ui-tx3);margin-top:2px">análises realizadas</div></div>'+
                            '<div style="text-align:right">'+
                                '<div style="font-size:.95rem;font-weight:800;color:#4ade80">'+pct+'% aprovados</div>'+
                                '<div style="font-size:.62rem;color:var(--ui-tx3)">'+ap.length+' aprov · '+rep.length+' reprov</div>'+
                                (notaMed!=='--'?'<div style="font-size:.62rem;color:var(--ui-tx3);margin-top:3px">Nota média: <strong style="color:#fb923c">'+notaMed+'</strong></div>':'')+
                            '</div>'+
                        '</div>'+
                        '<div style="height:6px;background:var(--ui-icbg);border-radius:99px;overflow:hidden">'+
                            '<div style="width:'+pct+'%;height:100%;background:linear-gradient(90deg,#4ade80,#22d3ee);border-radius:99px;transition:width .4s"></div>'+
                        '</div>'+
                    '</div>'+
                    // Distribuição por perfil
                    (sub.length > 0 ?
                    '<div style="background:var(--ui-icbg);border:1px solid var(--ui-edge);border-radius:13px;padding:12px">'+
                        '<div style="font-size:.58rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--ui-tx3);margin-bottom:10px">📊 Distribuição de notas</div>'+
                        (topNota!=='--'?'<div style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:8px;font-size:.63rem;font-weight:600;background:rgba(var(--primary-color-rgb),.1);border:1px solid rgba(var(--primary-color-rgb),.2);color:var(--primary-color);margin-bottom:10px">🏆 Nota mais comum: <strong>'+topNota+' pts</strong> — '+topCount+' cliente'+(topCount!==1?'s':'')+'</div>':'')+
                        pBar('FORTE 85+',  forte,  '#4ade80', 'linear-gradient(90deg,#4ade80,#22d3ee)')+
                        pBar('MEDIO 60+',  medio,  '#fb923c', 'linear-gradient(90deg,#fb923c,#fbbf24)')+
                        pBar('FRACO 40+',  fraco,  '#fbbf24', 'linear-gradient(90deg,#fbbf24,#f59e0b)')+
                        pBar('REPROV.',    reprN,  '#f87171', 'linear-gradient(90deg,#f87171,#ef4444)')+
                        '<div style="height:1px;background:var(--ui-icbg);margin:8px 0 10px"></div>'+
                        '<div style="font-size:.56rem;color:var(--ui-tx3);margin-bottom:7px">Frequência por faixa de 10 pts</div>'+
                        '<div style="display:flex;align-items:flex-end;gap:4px;height:66px">'+
                            faixaCounts.map(function(c,i){ return miniBar(i,c,maxF); }).join('')+
                        '</div>'+
                    '</div>' : '')+
                    // Insights
                    (sub.length > 0 ?
                    '<div style="background:var(--ui-icbg);border:1px solid var(--ui-edge);border-radius:13px;padding:12px">'+
                        '<div style="font-size:.58rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--ui-tx3);margin-bottom:10px">💡 Insights</div>'+
                        '<div style="display:flex;flex-direction:column;gap:8px">'+
                            (repAposta>0?
                            '<div style="display:flex;align-items:center;gap:9px;font-size:.71rem;color:var(--ui-tx2)">'+
                                '<div style="width:26px;height:26px;border-radius:8px;background:rgba(239,68,68,.1);display:flex;align-items:center;justify-content:center;font-size:.8rem;flex-shrink:0">🎰</div>'+
                                '<span><strong style="color:#f87171">'+repAposta+' reprovado'+(repAposta!==1?'s':'')+'</strong> por apostas ('+apostaPct+'% das reprovações)</span>'+
                            '</div>':'')+
                            (rendaMed?
                            '<div style="display:flex;align-items:center;gap:9px;font-size:.71rem;color:var(--ui-tx2)">'+
                                '<div style="width:26px;height:26px;border-radius:8px;background:rgba(74,222,128,.08);display:flex;align-items:center;justify-content:center;font-size:.8rem;flex-shrink:0">💰</div>'+
                                '<span>Renda média dos aprovados: <strong style="color:#4ade80">R$ '+rendaMed.toLocaleString('pt-BR')+'</strong></span>'+
                            '</div>':'')+
                            (medio>0?
                            '<div style="display:flex;align-items:center;gap:9px;font-size:.71rem;color:var(--ui-tx2)">'+
                                '<div style="width:26px;height:26px;border-radius:8px;background:rgba(249,115,22,.08);display:flex;align-items:center;justify-content:center;font-size:.8rem;flex-shrink:0">📈</div>'+
                                '<span>Perfil mais frequente: <strong style="color:#fb923c">MEDIO</strong> — '+Math.round(medio/sub.length*100)+'% dos clientes</span>'+
                            '</div>':'')+
                        '</div>'+
                    '</div>' : '');
            }
            renderDashboard();

            var filtroAtual='todos', buscaAtual='';

            function renderItems(){
                var since = Date.now() - periodDays * 86400000;
                var busca=buscaAtual.toLowerCase().trim();
                var filtrados=items.filter(function(it){ if(it.ts < since) return false;
                    var ap=it.decisao==='APROVADO'||it.decisao==='ENTRADA_ALTA'||it.decisao==='DOWNGRADE';
                    if(filtroAtual==='aprovado'&&!ap) return false;
                    if(filtroAtual==='reprovado'&&ap) return false;
                    if(!busca) return true;
                    return (String(it.nomeCliente||'')).toLowerCase().indexOf(busca)!==-1||
                           (String(it.produto||'')).toLowerCase().indexOf(busca)!==-1||
                           (String(it.operador||'')).toLowerCase().indexOf(busca)!==-1||
                           (String(it.cpf||'')).toLowerCase().indexOf(busca)!==-1;
                });
                var itemsDiv=document.getElementById('cs_hist_items')||listWrap;if(!filtrados.length){itemsDiv.innerHTML='<div class="cs-hist-empty">Nenhum resultado encontrado</div>';return;}
                var htmlParts=[];
                filtrados.forEach(function(it){
                    try{
                        var idx=items.indexOf(it);
                        var ap=it.decisao==='APROVADO'||it.decisao==='ENTRADA_ALTA'||it.decisao==='DOWNGRADE';
                        var dt=it.ts?new Date(it.ts).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'--';
                        var tc=ap?'#4ade80':'#f87171';
                        var notaNum=typeof it.nota==='number'?it.nota:(parseInt(it.nota)||null);
                        var notaVal=notaNum!==null?notaNum:'--';
                        var notaCor=notaNum!==null?(notaNum>=80?'#16a34a':notaNum>=60?'#d97706':notaNum>=40?'#f59e0b':'#dc2626'):'#6b7280';
                        // resumo — forçar string para evitar crash em registros antigos
                        var resumoRaw=String(it.resumo||'');
                        var resumoLimpo=resumoRaw.length>100?resumoRaw.substring(0,100)+'...':resumoRaw;
                        var tags='';
                        if(ap){
                            if(it.entrada!=null)tags+='<span class="cs-htag">'+R$(it.entrada)+' entrada</span>';
                            if(it.vparcela!=null)tags+='<span class="cs-htag">12x '+R$(it.vparcela)+'</span>';
                        }
                        var btnReuso='<button class="cs-btn-reuso" data-i="'+idx+'"><i class="bi bi-box-arrow-up-right"></i> Abrir resultado (0 Tokens)</button>';
                        htmlParts.push(
                            '<div class="cs-hitem2">'+
                                '<div style="display:flex;align-items:flex-start;gap:9px">'+
                                    '<div style="min-width:40px;height:40px;border-radius:10px;background:'+notaCor+'18;border:1.5px solid '+notaCor+';display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0">'+
                                        '<span style="font-size:.95rem;font-weight:900;color:'+notaCor+';line-height:1">'+notaVal+'</span>'+
                                    '</div>'+
                                    '<div style="flex:1;min-width:0">'+
                                        '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px">'+
                                            '<span style="font-size:.82rem;font-weight:800;color:var(--text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(String(it.nomeCliente||'--'))+'</span>'+
                                            '<span style="font-size:.6rem;font-weight:800;color:'+tc+';white-space:nowrap;flex-shrink:0">'+(ap?'\u2705 APROV':'\u274c NEG')+'</span>'+
                                        '</div>'+
                                        '<div style="font-size:.68rem;color:var(--ui-tx3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(String(it.produto||'--'))+'</div>'+
                                        (resumoLimpo?'<div style="font-size:.67rem;color:var(--ui-tx3);line-height:1.4;margin-top:4px;font-style:italic">'+esc(resumoLimpo)+'</div>':'')+
                                        (tags?'<div class="cs-htags" style="margin-top:5px">'+tags+'</div>':'')+
                                        '<div style="display:flex;justify-content:space-between;font-size:.6rem;color:var(--ui-tx3);margin-top:6px">'+
                                            '<span>'+dt+'</span>'+
                                            '<span>Op: '+esc(String(it.operador||'--'))+'</span>'+
                                        '</div>'+
                                    '</div>'+
                                '</div>'+
                                btnReuso+
                            '</div>'
                        );
                    }catch(itemErr){ console.warn('Erro ao renderizar item do historico:',itemErr,it); }
                });
                var itemsDiv2=document.getElementById('cs_hist_items')||listWrap;itemsDiv2.innerHTML=htmlParts.join('');
                (document.getElementById('cs_hist_items')||listWrap).querySelectorAll('.cs-btn-reuso').forEach(function(btn){
                    btn.addEventListener('click',function(e){abrirRegistro(parseInt(e.currentTarget.dataset.i));});
                });
            }

            renderItems();

            // Busca
            var searchEl=el('cs_hist_search');
            if(searchEl){
                searchEl.value='';
                var novoSearch=searchEl.cloneNode(true);searchEl.parentNode.replaceChild(novoSearch,searchEl);
                novoSearch.addEventListener('input',function(){buscaAtual=this.value;renderItems();});
            }

            // Filtros
            var filtros=document.querySelectorAll('.cs-hfiltro');
            filtros.forEach(function(btn){
                var novo=btn.cloneNode(true);btn.parentNode.replaceChild(novo,btn);
                novo.addEventListener('click',function(){
                    filtroAtual=this.dataset.f;
                    document.querySelectorAll('.cs-hfiltro').forEach(function(b){b.classList.remove('cs-hfiltro-ativo');b.style.fontWeight='700';b.style.opacity='.65';});
                    this.classList.add('cs-hfiltro-ativo');this.style.opacity='1';
                    renderItems();
                });
            });

        } catch(e){ console.error('Erro abrirHist:',e); var _errd=document.getElementById('cs_hist_items')||listWrap;if(_errd)_errd.innerHTML='<div style="padding:16px;color:#f87171">Erro: '+esc(String(e.message||e))+'</div>'; }
    }

    // ================================================================
    // RASCUNHO DA PROXIMA ANALISE (upload de documentos)
    // ================================================================
    var MAX_PDF_PGS_ID = 3; // PDF de documento pessoal: maximo 3 paginas (RG frente/verso/CNH)
    var _arqSeq = 0;

    function avisar(msg) {
        if (window.showCustomModal) window.showCustomModal({ message: msg });
        else alert(msg);
    }

    function listaArquivos(docs, tipo) {
        var grupos = [], pos = {};
        docs.forEach(function (d) {
            if (pos[d.aid] === undefined) { pos[d.aid] = grupos.length; grupos.push({ aid: d.aid, nome: d.arq || 'arquivo', n: 0, thumb: d.dataUrl || '' }); }
            grupos[pos[d.aid]].n++;
        });
        return grupos.map(function (g) {
            var ico = g.thumb ? '<img src="' + esc(g.thumb) + '" alt="">' : '<i class="bi bi-file-earmark-check"></i>';
            return '<div class="cs-file">' + ico +
                '<span>' + esc(g.nome) + (g.n > 1 ? ' · ' + g.n + ' páginas' : '') + '</span>' +
                '<button type="button" class="cs-file-x" data-t="' + tipo + '" data-aid="' + g.aid + '" aria-label="Remover"><i class="bi bi-x-lg"></i></button>' +
            '</div>';
        }).join('');
    }

    function renderRascunho() {
        var gi = el('cs_docs_id'), gr = el('cs_docs_rend');
        if (gi) gi.innerHTML = listaArquivos(_docsId, 'id');
        if (gr) gr.innerHTML = listaArquivos(_docsRend, 'rend');
        var ci = el('cs_counter_id'); if (ci) ci.textContent = _docsId.length ? _docsId.length + '/' + MAX_DOCS_ID : '';
        var b = el('cs_btn_analisar'); if (b) b.disabled = !(_docsRend.length > 0) || _enviando > 0;
        var st = el('cs_up_status'); if (st) st.classList.toggle('cs-h', !(_enviando > 0));
        var hint = el('cs_hint_analisar');
        if (hint) hint.textContent = _enviando > 0 ? 'Aguarde terminar de ler os arquivos...' :
            (_docsRend.length ? 'Roda em segundo plano. Pode sair desta tela, avisamos quando ficar pronta.' : 'Adicione ao menos um comprovante de renda.');
    }

    function statusUpload(msg) { var s = el('cs_up_status_txt'); if (s) s.textContent = msg; }

    function removerArquivo(tipo, aid) {
        var arr = tipo === 'id' ? _docsId : _docsRend;
        for (var i = arr.length - 1; i >= 0; i--) {
            if (String(arr[i].aid) === String(aid)) { liberarDoc(arr[i]); arr.splice(i, 1); }
        }
        renderRascunho();
    }

    async function handleFilesId(files) {
        files = Array.prototype.slice.call(files || []);
        if (!files.length) return;
        _enviando++; renderRascunho();
        try {
            for (var i = 0; i < files.length; i++) {
                var f = files[i];
                if (_docsId.length >= MAX_DOCS_ID) { avisar('Maximo ' + MAX_DOCS_ID + ' fotos de documento pessoal.'); break; }
                statusUpload('Lendo ' + (f.name || 'arquivo') + '...');
                var aid = ++_arqSeq;
                try {
                    if (f.type.startsWith('image/')) {
                        var b64 = await resizeToBase64(f);
                        if (b64) _docsId.push({ base64: b64, dataUrl: URL.createObjectURL(f), arq: f.name, aid: aid });
                    } else if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
                        // Verifica quantas paginas tem ANTES de processar
                        var numPags = 0;
                        try {
                            if (!window.pdfjsLib) await new Promise(function (ok, fail) { var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
                            if (window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                            var ab = await f.arrayBuffer();
                            var pdfDoc = await window.pdfjsLib.getDocument({ data: ab }).promise;
                            numPags = pdfDoc.numPages;
                        } catch (e) {}
                        if (numPags > MAX_PDF_PGS_ID) {
                            avisar('Este PDF tem ' + numPags + ' paginas. Documentos pessoais (RG/CNH) tem no maximo ' + MAX_PDF_PGS_ID + ' paginas. Coloque extratos e holerites na secao COMPROVANTE DE RENDA.');
                            continue;
                        }
                        // PDF ok: usa so a primeira pagina como imagem
                        var imgs = await pdfToImages(f);
                        if (imgs.length > 0 && _docsId.length < MAX_DOCS_ID) _docsId.push({ base64: imgs[0].base64, dataUrl: imgs[0].dataUrl, arq: f.name, aid: aid });
                    }
                } catch (eF) { console.warn('Falha ao ler arquivo:', f.name, eF); avisar('Não consegui ler "' + f.name + '". Tente outro arquivo.'); }
                renderRascunho();
            }
        } finally { _enviando--; renderRascunho(); }
    }

    async function handleFilesRend(files) {
        files = Array.prototype.slice.call(files || []);
        if (!files.length) return;
        _enviando++; renderRascunho();
        try {
            for (var i = 0; i < files.length; i++) {
                var f = files[i];
                if (_docsRend.length >= MAX_DOCS_RND) { avisar('Maximo de ' + MAX_DOCS_RND + ' paginas atingido.'); break; }
                var rotulo = (i + 1) + '/' + files.length + ' · ' + (f.name || 'arquivo');
                var aid = ++_arqSeq;
                try {
                    if (f.type.startsWith('image/')) {
                        statusUpload('Lendo foto ' + rotulo + '...');
                        var b = await resizeToBase64(f);
                        if (b) _docsRend.push({ dataUrl: URL.createObjectURL(f), base64: b, tipo: 'imagem', textos: [], ehDigital: false, arq: f.name, aid: aid });
                    } else if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
                        statusUpload('Lendo PDF ' + rotulo + '...');
                        // Extrai texto com posicao Y (PDF digital nao precisa gastar imagem na IA)
                        var txtResult = await extrairTextoPdfDigital(f);
                        var textos = txtResult.textos || [];
                        var digital = txtResult.ehDigital;
                        // Renderiza imagens pra preview (e pra IA se escaneado)
                        var imgs = await pdfToImages(f);
                        imgs.forEach(function (im, idx) {
                            if (_docsRend.length < MAX_DOCS_RND)
                                _docsRend.push({
                                    dataUrl: im.dataUrl, base64: im.base64, tipo: 'imagem',
                                    textos: textos[idx] ? [textos[idx]] : [], ehDigital: digital,
                                    arq: f.name, aid: aid
                                });
                        });
                    }
                } catch (eF) { console.warn('Falha ao ler arquivo:', f.name, eF); avisar('Não consegui ler "' + f.name + '". Tente outro arquivo.'); }
                renderRascunho();
            }
        } finally { _enviando--; renderRascunho(); }
    }
    function uploadId(capture,mode){var inp=document.createElement('input');inp.type='file';inp.accept=(mode==='pdf')?'application/pdf,.pdf':'image/*,application/pdf';inp.multiple=true;if(capture&&capture!==false)inp.capture='environment';inp.onchange=function(e){handleFilesId(e.target.files);};inp.click();}
    function uploadRend(accept,capture){var inp=document.createElement('input');inp.type='file';inp.accept=accept||'image/*,application/pdf';inp.multiple=true;if(capture)inp.capture='environment';inp.onchange=function(e){handleFilesRend(e.target.files);};inp.click();}

    // ================================================================
    // TELA INICIAL: nova analise + andamento + prontas
    // ================================================================
    function aplicarForm() {
        var f = el('cs_form'), b = el('cs_btn_novaform');
        if (f) f.classList.toggle('cs-h', _formAberto === false);
        if (b) b.classList.toggle('cs-h', _formAberto !== false);
    }

    function cor(nota) { return nota >= 60 ? 'ok' : nota > NOTA_REPROVA ? 'warn' : 'bad'; }

    function cardAndamento(j) {
        var nome = esc(nomeDoJob(j));
        var qtd = (j.docsId || []).length + (j.docsRend || []).length;
        var sub = 'Iniciada ' + horaCurta(j.ts) + (qtd ? ' · ' + qtd + (qtd > 1 ? ' arquivos' : ' arquivo') : '');
        var cancelar = '<button type="button" class="cs-link bad" data-act="cancelar" data-id="' + j.id + '">Cancelar</button>';
        if (j.estado === 'fila') {
            return '<div class="cs-card cs-job"><div class="cs-job-top"><div class="cs-job-info"><div class="cs-job-nome">Aguardando na fila</div>' +
                '<div class="cs-job-sub">' + nome + ' · começa quando uma anterior terminar</div></div>' + cancelar + '</div></div>';
        }
        if (j.estado === 'aguarda') {
            return '<div class="cs-card cs-job warn"><div class="cs-job-top"><div class="cs-job-info"><div class="cs-job-nome">' + nome + '</div>' +
                '<div class="cs-job-sub">Precisa da sua decisão para continuar</div></div></div>' +
                '<div class="cs-job-foot"><button type="button" class="cs-btn cs-btn-pri cs-btn-sm" data-act="responder" data-id="' + j.id + '">Responder</button>' + cancelar + '</div></div>';
        }
        if (j.estado === 'erro') {
            return '<div class="cs-card cs-job bad"><div class="cs-job-top"><div class="cs-job-info"><div class="cs-job-nome">' + nome + '</div>' +
                '<div class="cs-job-sub">' + sub + '</div></div></div>' +
                '<div class="cs-job-erro"><i class="bi bi-exclamation-circle-fill"></i><span>' + esc(j.erro) + '</span></div>' +
                '<div class="cs-job-foot"><button type="button" class="cs-btn cs-btn-pri cs-btn-sm" data-act="retry" data-id="' + j.id + '">Tentar de novo</button>' +
                '<button type="button" class="cs-link bad" data-act="descartar" data-id="' + j.id + '">Descartar</button></div></div>';
        }
        // rodando
        var passos = PASSOS.map(function (nomePasso, i) {
            if (i < j.passo) return '<div class="cs-step done"><i class="bi bi-check2"></i>' + nomePasso + '</div>';
            if (i === j.passo) return '<div class="cs-step on"><i class="bi bi-arrow-repeat"></i>' + esc(j.etapa || nomePasso) + '</div>';
            return '<div class="cs-step"><i class="bi bi-circle"></i>' + nomePasso + '</div>';
        }).join('');
        return '<div class="cs-card cs-job run"><div class="cs-job-top"><div class="cs-job-info"><div class="cs-job-nome">' + nome + '</div>' +
            '<div class="cs-job-sub">' + sub + '</div></div><span class="cs-job-pct">' + Math.round(j.prog) + '%</span></div>' +
            '<div class="cs-bar"><div style="width:' + Math.max(2, Math.min(100, j.prog)) + '%"></div></div>' +
            '<div class="cs-steps">' + passos + '</div>' +
            '<div class="cs-job-foot"><span class="cs-job-sub">Pode sair desta tela · mantenha o app aberto</span>' + cancelar + '</div></div>';
    }

    function cardPronta(j) {
        var d = j.dados, c = d.reprovado ? 'bad' : cor(d.nota);
        var sub = d.reprovado ? 'Reprovado' + (d.casasJogo && d.casasJogo.length ? ' · apostas detectadas' : '') :
            'Aprovado' + (d.rendaEstimada > 0 ? ' · renda ' + R$(d.rendaEstimada).replace(',00', '') + '/mês' : '');
        return '<button type="button" class="cs-card cs-pronta" data-act="abrir" data-id="' + j.id + '">' +
            '<span class="cs-ring-sm ' + c + '">' + d.nota + '</span>' +
            '<span class="cs-job-info"><span class="cs-job-nome">' + esc(nomeDoJob(j)) + '</span><span class="cs-job-sub ' + c + '">' + sub + '</span></span>' +
            (j.visto ? '<i class="bi bi-chevron-right cs-chev"></i>' : '<span class="cs-tag-nova">Nova</span>') + '</button>';
    }

    function renderLista() {
        var box = el('cs_lista'); if (!box) return;
        var andam = _jobs.filter(function (j) { return j.estado !== 'pronta'; });
        var prontas = _jobs.filter(function (j) { return j.estado === 'pronta'; }).slice(0, 8);
        var html = '';
        if (andam.length) {
            html += '<div class="cs-sec-h"><span>Em andamento</span><em>' + andam.length + '</em></div>' + andam.map(cardAndamento).join('');
        }
        if (prontas.length) {
            html += '<div class="cs-sec-h"><span>Prontas</span><em>nesta sessão</em></div>' + prontas.map(cardPronta).join('');
        }
        box.innerHTML = html;
    }

    function atualizarBadge() {
        var n = _jobs.filter(function (j) { return (j.estado === 'pronta' && !j.visto) || j.estado === 'aguarda' || j.estado === 'erro'; }).length;
        ['goCS2'].forEach(function (id) {
            var b = el(id); if (!b) return;
            var tag = b.querySelector('.cs-card-badge');
            if (!n) { if (tag) tag.parentNode.removeChild(tag); return; }
            if (!tag) { tag = document.createElement('span'); tag.className = 'cs-card-badge'; b.appendChild(tag); }
            tag.textContent = n;
        });
    }

    function openOverlay() {
        var ov = el('cs_ov'); if (!ov) return;
        ov.classList.add('active');
        if (_formAberto === null) _formAberto = _jobs.length === 0;
        renderRascunho(); aplicarForm(); renderLista();
    }
    function closeOverlay() { el('cs_ov') && el('cs_ov').classList.remove('active'); }

    // Fecha tudo do CreditoScan (as analises continuam rodando em segundo plano)
    function fecharTudo() {
        ['cs_ov', 'cs_hist_ov', 'cs_res_ov'].forEach(function (id) { el(id) && el(id).classList.remove('active'); });
        if (el('cs_cfg_ov')) el('cs_cfg_ov').classList.remove('active');
    }

    function acaoLista(e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var j = jobPorId(b.getAttribute('data-id')); if (!j) return;
        var a = b.getAttribute('data-act');
        if (a === 'abrir') abrirResultado(j);
        else if (a === 'cancelar' || a === 'descartar') cancelarJob(j);
        else if (a === 'retry') tentarDeNovo(j);
        else if (a === 'responder') abrirPergunta(j);
    }

    // ================================================================
    // AVISOS (banner "Analise pronta" em qualquer tela do app)
    // ================================================================
    function caixaAvisos() {
        var box = el('cs_banners');
        if (!box) {
            box = document.createElement('div'); box.id = 'cs_banners'; box.className = 'cs-scope';
            box.addEventListener('click', function (e) {
                var b = e.target.closest('[data-bact]'); if (!b) return;
                var j = jobPorId(b.getAttribute('data-id'));
                var a = b.getAttribute('data-bact');
                if (a === 'x') { removerBanner(b.getAttribute('data-id')); return; }
                if (!j) { removerBanner(b.getAttribute('data-id')); return; }
                removerBanner(j.id);
                if (j.estado === 'pronta') abrirResultado(j);
                else { openOverlay(); if (j.estado === 'aguarda') abrirPergunta(j); }
            });
            document.body.appendChild(box);
        }
        return box;
    }

    function removerBanner(id) {
        var box = el('cs_banners'); if (!box) return;
        var b = box.querySelector('[data-job="' + id + '"]');
        if (b) b.parentNode.removeChild(b);
    }

    function avisarJob(job, tipo) {
        var box = caixaAvisos();
        removerBanner(job.id);
        var t, sub, btn, c = 'ok', ico = 'bi-check-lg';
        var nome = nomeDoJob(job);
        if (tipo === 'pronta') {
            var d = job.dados;
            t = 'Análise pronta'; btn = 'Ver resultado';
            sub = nome + ' · nota ' + d.nota + ' · ' + (d.reprovado ? 'Reprovado' : 'Aprovado');
            if (d.reprovado) { c = 'bad'; ico = 'bi-x-lg'; }
        } else if (tipo === 'erro') {
            t = 'Análise não concluída'; btn = 'Ver'; c = 'bad'; ico = 'bi-exclamation-lg';
            sub = nome + ' · ' + String(job.erro || '').substring(0, 90);
        } else {
            t = 'Precisa da sua decisão'; btn = 'Responder'; c = 'warn'; ico = 'bi-question-lg';
            sub = nome;
        }
        var div = document.createElement('div');
        div.className = 'cs-banner ' + c; div.setAttribute('data-job', job.id);
        div.innerHTML =
            '<div class="cs-banner-top"><span class="cs-banner-ico"><i class="bi ' + ico + '"></i></span>' +
            '<div class="cs-banner-txt"><strong>' + t + '</strong><span>' + esc(sub) + '</span></div>' +
            '<button type="button" class="cs-banner-x" data-bact="x" data-id="' + job.id + '" aria-label="Dispensar"><i class="bi bi-x-lg"></i></button></div>' +
            '<button type="button" class="cs-btn cs-btn-pri" data-bact="ver" data-id="' + job.id + '">' + btn + '</button>';
        box.appendChild(div);
        try {
            if (document.hidden && window.Notification && Notification.permission === 'granted') {
                new Notification(t, { body: sub, tag: 'creditoscan-' + job.id });
            }
        } catch (e) {}
    }

    // ── Detector local de apostas — roda ANTES da IA, sem gastar token ──
    var APOSTAS_KEYWORDS = [
        'phoenix gaming','m v d s m technology','atm publicidade','smart cluster',
        'banks tech','apostaraiz','royal crest','lottopay','gm intermediacao',
        'wiinpay','ajc gateway','nexumpay','univebet','vaidebet','betnacional',
        'pixbet','blaze','betano','esportes da sorte','superbet',
        'r torres','norbe fintech','norbe','gold now','luxtak','phoenix gaming ltda',
        'futbol bet','betgaming','bet gaming','betfair','sportingbet','betway',
        'bet365','pinnacle','1xbet','stake','f12 bet','galera bet','kto'
    ];
    var APOSTAS_REGEX = /\b(bet|gaming|apostas?|cassino|esportiv|pixbet|blaze|apostaraiz)\b/i;

    function detectarApostas(texto) {
        var textoLower = texto.toLowerCase();
        var porDia = {}, porMes = {}, totalOcorr = 0, totalValor = 0;
        var destinatarios = {};

        // === ESTRATEGIA 1: Busca global por keyword (funciona mesmo sem \n) ===
        APOSTAS_KEYWORDS.forEach(function(keyword) {
            var idx = 0;
            while (true) {
                var pos = textoLower.indexOf(keyword, idx);
                if (pos === -1) break;
                idx = pos + keyword.length;
                // Evita double-count de substrings (ex: "phoenix gaming ltda" contendo "phoenix gaming")
                var contexto = textoLower.substring(Math.max(0,pos-5), Math.min(textoLower.length, pos+keyword.length+10));
                var jaContado = false;
                APOSTAS_KEYWORDS.forEach(function(k2){
                    if (k2.length > keyword.length && contexto.indexOf(k2) !== -1) jaContado = true;
                });
                if (jaContado) continue;

                destinatarios[keyword] = (destinatarios[keyword] || 0) + 1;
                totalOcorr++;
                // Busca valor proximo — procura tanto ANTES quanto DEPOIS da keyword
                // Formato tipico extrato: "20,00 (-) Pix - Enviado ... PHOENIX GAMING"
                var searchBefore = texto.substring(Math.max(0, pos - 120), pos);
                var searchAfter = texto.substring(pos, Math.min(texto.length, pos + 120));
                // Regex conservador: 1-4 digitos + virgula + 2 decimais (max R$9999,99 por aposta)
                var mVal = searchBefore.match(/(\d{1,4}),(\d{2})(?:\s*\(-\))?(?:\s|$)/g) ||
                           searchAfter.match(/(\d{1,4}),(\d{2})(?:\s*\(-\))?/g);
                var valor = 0;
                if (mVal) {
                    // Pega o ultimo match (mais proximo da keyword)
                    var lastMatch = mVal[mVal.length - 1].match(/(\d{1,4}),(\d{2})/);
                    if (lastMatch) valor = parseFloat(lastMatch[1] + '.' + lastMatch[2]);
                    if (valor > 5000) valor = 0; // sanity check: aposta individual > R$5000 improvavel
                }
                totalValor += valor;
                // Busca data proxima (ate 250 chars antes)
                var before = texto.substring(Math.max(0, pos - 250), pos + 30);
                var datasEncontradas = before.match(/(\d{2})\/(\d{2})\/(\d{2,4})/g) || [];
                var mData = datasEncontradas.length > 0 ? datasEncontradas[datasEncontradas.length-1].match(/(\d{2})\/(\d{2})\/(\d{2,4})/) : null;
                if (!mData) {
                    var mShort = before.match(/(\d{2})\/(\d{2})\s/g);
                    if (mShort && mShort.length) {
                        var last = mShort[mShort.length-1].match(/(\d{2})\/(\d{2})/);
                        if (last) mData = [null, last[1], last[2], '2026'];
                    }
                }
                if (mData) {
                    var dia = mData[1], mes = mData[2], ano = mData[3] || '2026';
                    if (ano.length === 2) ano = '20' + ano;
                    var chaveDia = dia + '/' + mes + '/' + ano;
                    var chaveMes = mes + '/' + ano;
                    porDia[chaveDia] = (porDia[chaveDia] || 0) + 1;
                    if (!porMes[chaveMes]) porMes[chaveMes] = { ocorr: 0, total: 0, dias: {} };
                    porMes[chaveMes].ocorr++;
                    porMes[chaveMes].total += valor;
                    porMes[chaveMes].dias[chaveDia] = true;
                }
            }
        });

        // === ESTRATEGIA 2: Regex generico para pegar nomes nao listados ===
        var regexHits = [];
        var reGen = /\b(bet\d*|gaming|apostas?|apostador\w*|cassinos?)\b/gi;   // palavra inteira: nao pega Beto/Betania/esportivo
        var rm;
        while ((rm = reGen.exec(textoLower)) !== null) {
            // Verifica se ja nao foi contado por keywords
            var jaKeyword = APOSTAS_KEYWORDS.some(function(k){
                var start = Math.max(0, rm.index - 50);
                var trecho = textoLower.substring(start, rm.index + rm[0].length + 50);
                return trecho.indexOf(k) !== -1;
            });
            if (!jaKeyword) {
                regexHits.push(rm[0]);
                totalOcorr++;
                destinatarios[rm[0]] = (destinatarios[rm[0]] || 0) + 1;
            }
        }

        var diasComAposta = Object.keys(porDia).length;
        var mesesComAposta = Object.keys(porMes).length;
        var destStr = Object.keys(destinatarios).map(function(k){return k+' ('+destinatarios[k]+'x)';}).join(', ');

        // === GATILHOS ===
        var gatilho = null, detalhe = '';
        // G1: 15+ dias com apostas em qualquer mes
        Object.keys(porMes).forEach(function(m){
            var diasNesteMes = Object.keys(porMes[m].dias || {}).length;
            if(!gatilho && diasNesteMes >= 15){
                gatilho = 'APOSTADOR_DIARIO';
                detalhe = diasNesteMes + ' dias com apostas no mes ' + m;
            }
        });
        // G2: volume mensal >= R$ 800
        if (!gatilho) {
            Object.keys(porMes).forEach(function(m){
                if (!gatilho && porMes[m].total >= 800) {
                    gatilho = 'VOLUME_MENSAL';
                    detalhe = 'R$ '+porMes[m].total.toFixed(2)+' apostados em '+m;
                }
            });
        }
        // G3: habito cronico (3+ meses)
        if (!gatilho && mesesComAposta >= 3) {
            gatilho = 'HABITO_CRONICO';
            detalhe = 'apostas em '+mesesComAposta+' meses distintos (compulsivo)';
        }
        // G4: 10+ ocorrencias totais
        if (!gatilho && totalOcorr >= 10) {
            gatilho = 'VOLUME_TOTAL';
            detalhe = totalOcorr+' transacoes de apostas no periodo';
        }
        // G5: 5-9 ocorrencias = nota trava em 35 (reprovado)
        if (!gatilho && totalOcorr >= 5) {
            gatilho = 'APOSTADOR_FREQUENTE';
            detalhe = totalOcorr+' transacoes de apostas — nota travada em 35';
        }
        if (detalhe) detalhe += '\nTotal apostado: R$ '+totalValor.toFixed(2)+' | Casas: '+destStr;

        return { gatilho: gatilho, detalhe: detalhe, totalOcorr: totalOcorr, totalValor: totalValor, diasComAposta: diasComAposta, mesesComAposta: mesesComAposta, porMes: porMes, casas: Object.keys(destinatarios) };
    }

    function resultadoApostasReprovado(prod, nomeCliente, apostas) {
        var motivo = 'REPROVADO AUTOMATICO — Apostador Compulsivo\nGatilho: '+apostas.gatilho+'\nDetalhe: '+apostas.detalhe+'\n\nTransacoes de apostas detectadas localmente: '+apostas.totalOcorr+' | Total: R$ '+apostas.totalValor.toFixed(2)+'\nDias com apostas: '+apostas.diasComAposta+' | Meses: '+apostas.mesesComAposta;
        return {
            aprov: false, downgrade: false, entradaAlta: false, reprovado: true,
            nota: 0, risco: 'REPROVADO', entradaPct: 0.60, rendaEstimada: 0,
            nomeCliente: nomeCliente || 'Cliente', nomeCompleto: nomeCliente || 'Cliente',
            confianca: 'ALTA', nomeDocPessoal: '', nomeRenda: '', nomesBatem: null,
            perfil: 'Apostador compulsivo identificado automaticamente pela analise local do extrato.',
            analise: motivo, calculo: '', rascunho: '', motivos: motivo, _produto: prod
        };
    }

    // ── Detector local de extrato cego (Caixa Tem, poupança, só holerite) ──
    function detectarExtratoCego(texto) {
        // Normaliza acentos pra comparacao
        var tl = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        var nome = '';
        var mNome = texto.match(/(?:Nome|Cliente)[:\s]+([A-Z][A-Za-z\s]+)/);
        if (mNome) nome = mNome[1].trim();

        var ehContaCega = ['caixa tem','conta poupanca caixa','poupanca caixa',
            'conta poupanca digital','agencia digital'].some(function(i){ return tl.indexOf(i) !== -1; });

        // Conta saidas detalhadas (Pix com destinatario, compras, boletos)
        var saidasDetalhadas = 0;
        var linhas = texto.split('\n');
        linhas.forEach(function(l) {
            var ll = l.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (/pix\s*(enviado|-\s*enviado)/.test(ll)) saidasDetalhadas++;
            if (/compra com cart/i.test(ll)) saidasDetalhadas++;
            if (/boleto/i.test(ll)) saidasDetalhadas++;
            if (/debito auto/i.test(ll)) saidasDetalhadas++;
        });

        // Detecta se maioria das operacoes sao passivas
        var opsPassivasKw = ['saldo dia','credito juros','correcao monetaria','cred remuneracao',
            'programa pe de meia','credito juros mp','inc conclusao'];
        var totalOps = 0, opsPassivas = 0;
        linhas.forEach(function(l) {
            var ll = l.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
            if (ll.length < 5) return;
            if (/tipo de opera|pix|saldo|credito|debito|compra|boleto|transfer|correcao|programa/i.test(ll)) {
                totalOps++;
                if (opsPassivasKw.some(function(op){ return ll.indexOf(op) !== -1; })) opsPassivas++;
            }
        });

        var tipo = '';
        if (tl.indexOf('caixa tem') !== -1) tipo = 'Conta poupanca CAIXA Tem';
        else if (tl.indexOf('conta poupanca') !== -1) tipo = 'Conta poupanca';
        else if (tl.indexOf('agencia digital') !== -1 && tl.indexOf('poupanca') !== -1) tipo = 'Conta poupanca digital';
        else if (tl.indexOf('poupanca') !== -1) tipo = 'Conta poupanca';

        var cego = false;
        if (ehContaCega && saidasDetalhadas <= 3) {
            cego = true;
            if (!tipo) tipo = 'Conta beneficio/poupanca';
        }
        if (totalOps > 4 && opsPassivas / totalOps > 0.65 && saidasDetalhadas <= 3) {
            cego = true;
            if (!tipo) tipo = 'Extrato sem despesas detalhadas';
        }

        return { cego: cego, tipo: tipo, nome: nome, saidasDetalhadas: saidasDetalhadas };
    }

    // ── VALIDADOR POS-IA: corrige nota se calculo da IA nao bate ──────────────
    function validarNotaVsCalculo(d) {
        if (!d.calculo || d.reprovado) return;
        var texto = d.calculo;
        var mBase = texto.match(/Base:\s*(\d+)/i);
        if (!mBase) return;
        var soma = parseInt(mBase[1]);
        var teto = null;
        texto.split('\n').forEach(function(linha) {
            var l = linha.trim();
            if (!l || /^Base:/i.test(l) || /RESULTADO FINAL/i.test(l)) return;
            var mTeto = l.match(/teto\s+(\d+)/i);
            if (mTeto) { teto = parseInt(mTeto[1]); return; }
            var mAdj = l.match(/([+\-])\s*(\d+)\s*$/);
            if (mAdj) soma += (mAdj[1] === '+' ? 1 : -1) * parseInt(mAdj[2]);
        });
        var notaCalc = Math.max(0, Math.min(92, teto !== null ? Math.min(soma, teto) : soma));
        if (notaCalc === d.nota) return;
        var notaOriginal = d.nota;
        d.nota = notaCalc;
        d.calculo += '\n\n⚠️ CORRECAO SISTEMA: IA retornou ' + notaOriginal +
            ' pts mas soma do proprio calculo = ' + notaCalc + ' pts — nota corrigida automaticamente.';
        if (notaCalc >= 85) { d.entradaPct = 0.33; }
        else if (notaCalc >= 60) { d.entradaPct = 0.35; }
        else if (notaCalc >= 40) { d.entradaPct = 0.60; }
        else {
            d.aprov = false; d.reprovado = true; d.risco = 'REPROVADO'; d.entradaPct = 0.60;
            d.motivos = (d.motivos ? d.motivos + '\n' : '') +
                'Nota corrigida para ' + notaCalc + ' (abaixo de 40) — REPROVADO automatico pelo validador.';
        }
    }

    // ── VALIDADOR POS-IA: comprometimento da renda derruba a nota ──
    // Usa o mesmo % que aparece na tela (secao COMPROMETIMENTO). Total de desconto:
    // -10 acima de 80% e -30 acima de 95%. O que a IA ja descontou por comprometimento
    // no calculo da nota e abatido, para nao penalizar duas vezes.
    // Percentual de comprometimento: o calculado no codigo (compromissos / renda final); senao o texto da IA
    function pctComprometimento(d, secoes) {
        if (d.compromissoDuvida) return null;   // a IA nao achou nada, mas o extrato tem sinais: nao mostra 0%
        if (d.comprometimentoPct !== null && d.comprometimentoPct !== undefined && isFinite(d.comprometimentoPct)) return d.comprometimentoPct;
        var m = String((secoes || parsearSecoes(d.analise || ''))['COMPROMETIMENTO'] || '').match(/(\d{1,3})\s*%/);
        return m ? parseInt(m[1], 10) : null;
    }

    function validarComprometimento(d) {
        if (d.reprovado || d.reguaAplicada) return;   // com a regua o item ja entrou na soma
        var pct = pctComprometimento(d);
        if (pct === null) return;
        var alvo = pct > 95 ? 30 : pct > 80 ? 10 : 0;
        if (!alvo) return;
        var jaDescontado = 0;
        String(d.calculo || '').split('|').forEach(function (parte) {
            var mm = parte.match(/comprom[^\d\-+]*.*?[-−–]\s*(\d{1,2})\b/i);
            if (mm) jaDescontado += parseInt(mm[1], 10);
        });
        var extra = Math.max(0, alvo - jaDescontado);
        if (!extra) return;
        d.nota = Math.max(0, d.nota - extra);
        d.calculo = (d.calculo || '') + '\n\nAjuste do sistema: comprometimento de ' + pct + '% da renda — ' + extra + ' pts a menos na nota.';
        if (d.nota <= NOTA_REPROVA) {
            d.aprov = false; d.reprovado = true; d.risco = 'REPROVADO'; d.entradaPct = 0.60;
            d.motivos = (d.motivos ? d.motivos + '\n' : '') + 'Comprometimento de ' + pct + '% da renda — nota 50 ou menos.';
        } else { var rr = riscoPorNota(d.nota); d.risco = rr.risco; d.entradaPct = rr.entradaPct; }
    }
    // ── VALIDADOR POS-IA: emprestimo/financiamento no texto do PDF ──────────
    function validarEmprestimo(d, textoLocal) {
        if (d.reprovado) return;
        var calc = (d.calculo || '').toLowerCase();
        if (/empr[eé]stimo|consignado|financiamento/.test(calc)) return;
        var texto = ((textoLocal || '') + ' ' + (d.analise || '') + ' ' + (d.perfil || '')).toLowerCase();
        var detectado = [
            /resgate\s+de\s+empr[eé]stimo/, /banco\s+pan/, /will\s+financeira/,
            /cred\s+system/, /gonn\s+fundo/, /auto\s+pan/, /consignado/,
            /parcela.*financiamento/, /financiamento.*ve[ií]culo/,
            /aprovec\s+vendas/, /redemob\s+cons[oó]rcio/
        ].some(function(re){ return re.test(texto); });
        if (!detectado) return;
        d.nota = Math.max(0, d.nota - 15);
        d.calculo = (d.calculo || '') +
            '\nEmprestimo/financiamento identificado no extrato: -15' +
            '\n\n⚠️ CORRECAO JS: divida ativa detectada localmente — desconto aplicado automaticamente.';
        if (d.nota < 40) {
            d.aprov = false; d.reprovado = true; d.risco = 'REPROVADO'; d.entradaPct = 0.60;
            d.motivos = (d.motivos ? d.motivos + '\n' : '') + 'Emprestimo/financiamento ativo — nota abaixo de 40, REPROVADO automatico.';
        } else if (d.nota < 60) { d.entradaPct = 0.60; }
        else if (d.nota < 85)   { d.entradaPct = 0.35; }
    }

    // ── VALIDADOR POS-IA: se a IA viu apostas mas nao reprovou, JS forca ──
    function validarApostasNaResposta(d) {
        if (d.reprovado) return;
        // Prioridade 1: usa casasJogo estruturado retornado pela IA
        var casas = (d.casasJogo || []).filter(Boolean);

        // Prioridade 2: fallback por busca de texto se IA nao preencheu o campo
        if (casas.length === 0) {
            var textoIA = [d.analise||'', d.perfil||'', d.motivos||''].join(' ').toLowerCase();
            [
             'phoenix gaming','vaidebet','betnacional','pixbet','blaze','betano',
             'esportes da sorte','superbet','betboom','bet7k','estrelabet',
             'apostaraiz','univebet','bodog','betnow','br4bet','futbol bet',
             'ajc gateway','gm intermediacao','wiinpay','lottopay','nexumpay',
             'banks tech','smart cluster','atm publicidade','m v d s m',
             'royal crest','r torres','norbe','gold now','luxtak','betgaming',
             'sportingbet','betfair','betsson','1xbet','bet365',
             'betway','mrjack','f12.bet','f12bet','realsbet',
             'onabet','brabet','betninja','jogomix','galera.bet','galera bet',
             'estrela bet','ivi gateway','hornet pay','novus solutions',
             'vcoin','gdsp technology','syncpay','sync pay',
             'pagbet','betpix','sportbetio','sport bet','betcris',
             'rivalo','betmotion','pinnacle','betsul','sportsbet.io',
             'velozbet','veloz bet','paggue','double.bet','fortune tiger',
             'cassino','casino online','slots','apostou'
            ].forEach(function(c){ if(textoIA.indexOf(c)!==-1) casas.push(c); });
        }

        if (casas.length >= 3) {
            // 3+ casas = apostador habitual → REPROVADO
            var notaOriginal = d.nota;
            d.aprov=false; d.reprovado=true; d.nota=0;
            d.risco='REPROVADO'; d.entradaPct=0.60;
            d.casasJogo = casas;
            d.motivos = 'REPROVADO — Apostador Identificado\n'+
                casas.length+' casas detectadas: '+casas.join(', ')+'\n'+
                '(IA original: '+notaOriginal+' pts — corrigido para 0)';
            d.calculo = 'CORRIGIDO PELO SISTEMA\nIA: '+notaOriginal+' pts\n'+
                'Casas: '+casas.join(', ')+'\nRegra: 3+ casas = REPROVADO\nNota final: 0';
        } else if (casas.length >= 1 && casas.length <= 2 && d.nota > NOTA_REPROVA) {
            // 1-2 casas esporadicas → penaliza a nota; se cair a 50 ou menos, reprova
            var penalidade = casas.length === 1 ? 10 : 20;
            d.nota = Math.max(0, d.nota - penalidade);
            d.casasJogo = casas;
            d.calculo = (d.calculo||'')+
                '\nCORRECAO: '+casas.length+' casa(s) esporadica(s) detectada(s) → -'+penalidade+
                ' pts (nota ajustada: '+d.nota+')';
            classificarPorNota(d);
            if (d.reprovado) d.motivos = (d.motivos ? d.motivos + '\n' : '') + 'Apostas (' + casas.join(', ') + '): -' + penalidade + ' pts levaram a nota a ' + d.nota + ' (50 ou menos reprova).';
        }
    }

    // ── VALIDADOR: movimentação alta > R$6k/mês → +5 pontos ──
    function validarMovimentacaoAlta(d, movimentacaoMensal) {
        if (d.reprovado) return;
        // Usa movimentacao calculada na Etapa 1 ou tenta extrair do rascunho
        var mov = movimentacaoMensal || 0;
        if (mov < 6000) return;
        // Ja foi aplicado?
        if (/movimenta[çc][aã]o alta/i.test(d.calculo || '')) return;

        d.nota = Math.min(100, d.nota + 5);
        d.calculo = (d.calculo || '') +
            '\nMovimentacao alta (R$ ' + mov.toLocaleString('pt-BR', {minimumFractionDigits:2}) + '/mes): +5' +
            '\n\n💡 Perfil PJ/autonomo com alto giro financeiro.';

        // Reclassifica se subiu de faixa
        if (d.nota >= 85 && d.entradaPct > 0.33) { d.entradaPct = 0.33; }
        else if (d.nota >= 60 && d.entradaPct > 0.35) { d.entradaPct = 0.35; }
    }

    // ── Validador local de qualidade dos documentos enviados (zero tokens) ──
    function validarQualidadeDocumentos(textosLocais) {
        var problemas = [];
        var textoTotal = textosLocais.join('\n');

        // Sem texto extraivel (so imagens) → sem validacao profunda
        if (textoTotal.trim().length < 300) return { ok: true, problemas: [] };

        var linhasComValor = (textoTotal.match(/R\$\s*[\d.,]+/gi) || []).length;
        var temExtratoBancario = /(extrato|movimenta[cç][aã]o|saldo\s+(anterior|atual|disponivel)|historico\s*(de\s*)?lan[cç]amento)/i.test(textoTotal);
        var temPix = /pix\s*(enviado|recebido|credito|debito)/i.test(textoTotal.toLowerCase());

        // === V1: Comprovante de PIX avulso (nao e extrato) ===
        var temComprovante = /comprovante\s*(de\s*)?(pix|transfer[eê]ncia|pagamento|deposito)/i.test(textoTotal);
        if (temComprovante && !temExtratoBancario && linhasComValor < 8) {
            problemas.push({
                nivel: 'erro', icone: '🚫',
                titulo: 'Comprovante de PIX — nao e extrato',
                mensagem: 'O arquivo parece ser um comprovante de transacao avulsa, nao um extrato bancario completo.',
                pedirCliente: 'Abre o app do banco → toca em "Extrato" → seleciona os ultimos 3 meses → exporta o PDF completo. Comprovante de PIX isolado nao serve para analise de credito.'
            });
        }

        // === V2: Cobertura de periodo (quantos meses o extrato cobre) ===
        if (!problemas.some(function(p){ return p.nivel === 'erro'; })) {
            var todasDatas = [];
            var reData = /\b(\d{2})\/(\d{2})\/(\d{2,4})\b/g;
            var mData;
            while ((mData = reData.exec(textoTotal)) !== null) {
                var dia = parseInt(mData[1]), mes = parseInt(mData[2]), ano = parseInt(mData[3]);
                if (ano < 100) ano += 2000;
                if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31 && ano >= 2020 && ano <= 2030) {
                    var ts = new Date(ano, mes - 1, dia).getTime();
                    if (ts > 0 && ts <= Date.now() + 86400000) todasDatas.push(ts);
                }
            }
            if (todasDatas.length >= 3) {
                var minDate = Math.min.apply(null, todasDatas);
                var maxDate = Math.max.apply(null, todasDatas);
                var difDias = (maxDate - minDate) / 86400000;
                var diasAtras = (Date.now() - maxDate) / 86400000;

                if (diasAtras > 120) {
                    var dtRecente = new Date(maxDate).toLocaleDateString('pt-BR', {month:'long', year:'numeric'});
                    var dtMinima  = new Date(Date.now() - 120*86400000).toLocaleDateString('pt-BR', {month:'long', year:'numeric'});
                    problemas.push({
                        nivel: 'erro', icone: '📅',
                        titulo: 'Extrato desatualizado (' + dtRecente + ')',
                        mensagem: 'O extrato mais recente encontrado e de ' + dtRecente + ' — mais de 4 meses atras. Nao reflete a situacao financeira atual.',
                        pedirCliente: 'Este extrato esta vencido para analise. Peca ao cliente exportar o extrato atual do app do banco cobrindo a partir de ' + dtMinima + '.'
                    });
                } else if (difDias < 55 && todasDatas.length >= 5) {
                    var mesesCob = Math.round(difDias / 30 * 10) / 10;
                    problemas.push({
                        nivel: 'aviso', icone: '⚠️',
                        titulo: 'Extrato muito curto (~' + mesesCob + ' mes)',
                        mensagem: 'O extrato cobre apenas ' + Math.round(difDias) + ' dias. Precisamos de pelo menos 2–3 meses para uma analise confiavel.',
                        pedirCliente: 'Peca ao cliente abrir o app do banco → Extrato → selecionar 3 meses de periodo → exportar PDF completo. Quanto mais longo, maiores as chances de aprovacao.'
                    });
                }
            }
        }

        // === V3: Extrato cego (Caixa Tem, poupanca sem movimentacoes) ===
        var cego = detectarExtratoCego(textoTotal);
        if (cego.cego) {
            problemas.push({
                nivel: 'aviso', icone: '🔒',
                titulo: 'Extrato com visibilidade limitada',
                mensagem: 'O extrato e de ' + (cego.tipo || 'conta poupanca/beneficio') + ' e nao mostra para onde o dinheiro vai — apenas entradas.',
                pedirCliente: 'O extrato da ' + (cego.tipo || 'poupanca') + ' sozinho nao e suficiente. Se o cliente tiver conta em outro banco (Nubank, Bradesco, Itau...), peca o extrato dessa conta tambem. Vai aumentar muito as chances de aprovacao.'
            });
        }

        // === V4: So holerite, sem extrato bancario ===
        var temHolerite = /holerite|contracheque|folha\s+de\s+pagamento|proventos.*desconto|desconto.*inss|competencia\s*\d/i.test(textoTotal);
        if (temHolerite && !temExtratoBancario && !temPix) {
            problemas.push({
                nivel: 'aviso', icone: '📋',
                titulo: 'Apenas holerite — sem extrato bancario',
                mensagem: 'Identificamos um holerite, mas nao um extrato bancario. A analise ficara incompleta e pode resultar em reprovacao desnecessaria.',
                pedirCliente: 'Holerite recebido! Para analise completa peca tambem o extrato bancario dos ultimos 3 meses em PDF (app do banco → Extrato → 3 meses → Exportar PDF).'
            });
        }

        // === V5: Valores todos redondos — suspeito de extrato manipulado ===
        if (temExtratoBancario && linhasComValor >= 8) {
            var valoresEncontrados = [];
            var reVal = /R\$\s*([\d.]+),([\d]{2})/g;
            var mv;
            while ((mv = reVal.exec(textoTotal)) !== null) {
                var centavos = parseInt(mv[2]);
                valoresEncontrados.push(centavos);
            }
            if (valoresEncontrados.length >= 8) {
                var redondos = valoresEncontrados.filter(function(c){ return c === 0; }).length;
                if (redondos / valoresEncontrados.length > 0.92) {
                    problemas.push({
                        nivel: 'aviso', icone: '⚠️',
                        titulo: 'Extrato com valores suspeitos',
                        mensagem: 'Quase todas as transacoes tem valores redondos (sem centavos). Extratos reais raramente tem esse padrao — pode indicar documento editado.',
                        pedirCliente: 'Peca ao cliente exportar o extrato diretamente pelo app do banco (nao screenshot). Conferir se os valores batem com a conta real.'
                    });
                }
            }
        }

        var temErro = problemas.some(function(p){ return p.nivel === 'erro'; });
        return { ok: !temErro, problemas: problemas };
    }

    function mostrarModalDocQualidade(problemas, onContinuar, onFechar) {
        var temErro = problemas.some(function(p){ return p.nivel === 'erro'; });

        var listaHTML = problemas.map(function(p) {
            var corBg  = p.nivel==='erro' ? 'rgba(239,68,68,.1)'  : 'rgba(251,191,36,.08)';
            var corBdr = p.nivel==='erro' ? 'rgba(239,68,68,.35)' : 'rgba(251,191,36,.25)';
            var corTxt = p.nivel==='erro' ? '#f87171'             : '#fbbf24';
            return '<div style="background:'+corBg+';border:1px solid '+corBdr+';border-radius:12px;padding:13px;display:flex;flex-direction:column;gap:6px">'+
                '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:1.1rem">'+p.icone+'</span><span style="font-size:.82rem;font-weight:800;color:'+corTxt+'">'+esc(p.titulo)+'</span></div>'+
                '<p style="margin:0;font-size:.73rem;color:rgba(255,255,255,.6);line-height:1.45">'+esc(p.mensagem)+'</p>'+
                '<div style="background:rgba(255,255,255,.04);border-radius:8px;padding:9px 11px;margin-top:2px">'+
                    '<div style="font-size:.58rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.3);margin-bottom:4px">📲 O que pedir ao cliente</div>'+
                    '<p style="margin:0;font-size:.76rem;color:#e2e8f0;line-height:1.5">'+esc(p.pedirCliente)+'</p>'+
                '</div>'+
            '</div>';
        }).join('');

        var tituloPrincipal = temErro ? '⛔ Documentos Insuficientes' : '⚠️ Atencao aos Documentos';
        var subtitulo = temErro
            ? 'Ha problemas que impedem a analise. Solicite os documentos corretos antes de continuar.'
            : 'Encontramos pontos de atencao. Voce pode pedir melhorias ao cliente ou continuar com o que esta disponivel.';
        var corBorda  = temErro ? 'rgba(239,68,68,.3)' : 'rgba(251,191,36,.3)';
        var corHeader = temErro ? '#f87171' : '#fbbf24';
        var txtFechar = '← Fechar e solicitar documentos';
        var txtCont   = temErro ? 'Analisar mesmo assim (nao recomendado)' : 'Continuar mesmo assim →';
        var stiloCont = temErro
            ? 'background:transparent;border:1px solid rgba(255,255,255,.07);color:rgba(255,255,255,.22);'
            : 'background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.22);color:#fbbf24;';

        var modal = document.createElement('div');
        modal.id = 'cs_modal_docq';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:6000;display:flex;align-items:center;justify-content:center;padding:16px;';
        modal.innerHTML =
            '<div style="background:var(--card-bg);border:1.5px solid '+corBorda+';border-radius:18px;width:100%;max-width:400px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.75)">'+
                '<div style="padding:18px 18px 12px;border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0">'+
                    '<div style="font-size:1rem;font-weight:800;color:'+corHeader+'">'+tituloPrincipal+'</div>'+
                    '<div style="font-size:.67rem;color:rgba(255,255,255,.43);margin-top:4px;line-height:1.4">'+subtitulo+'</div>'+
                '</div>'+
                '<div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px;display:flex;flex-direction:column;gap:10px">'+
                    listaHTML+
                '</div>'+
                '<div style="padding:14px;border-top:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;gap:8px;flex-shrink:0">'+
                    '<button id="cs_docq_fechar" style="width:100%;padding:13px;border-radius:12px;border:none;background:var(--primary-color);color:#0d1f15;font-family:Poppins,sans-serif;font-size:.85rem;font-weight:700;cursor:pointer">'+esc(txtFechar)+'</button>'+
                    '<button id="cs_docq_continuar" style="width:100%;padding:10px;border-radius:10px;font-family:Poppins,sans-serif;font-size:.71rem;font-weight:600;cursor:pointer;'+stiloCont+'">'+esc(txtCont)+'</button>'+
                '</div>'+
            '</div>';

        document.body.appendChild(modal);
        document.getElementById('cs_docq_fechar').addEventListener('click', function(){ document.body.removeChild(modal); onFechar(); });
        document.getElementById('cs_docq_continuar').addEventListener('click', function(){ document.body.removeChild(modal); onContinuar(); });
    }

    // ================================================================
    // ANALISES EM SEGUNDO PLANO
    // Cada clique em "Analisar" vira uma analise (job). Ate
    // MAX_JOBS_SIMULTANEOS rodam juntas; as demais esperam na fila.
    // Roda enquanto o app estiver aberto (nao ha servidor).
    // ================================================================
    var CANCELADO = { cancelado: true };
    var PASSOS = ['Documentos', 'Apostas e risco', 'Extratos e renda', 'Nota final'];

    function jobPorId(id) {
        for (var i = 0; i < _jobs.length; i++) if (String(_jobs[i].id) === String(id)) return _jobs[i];
        return null;
    }

    function horaCurta(ts) {
        return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    function nomeDoJob(job) {
        return job.nome || ('Cliente · ' + horaCurta(job.ts));
    }

    function liberarDoc(d) {
        try { if (d && d.dataUrl && String(d.dataUrl).indexOf('blob:') === 0) URL.revokeObjectURL(d.dataUrl); } catch (e) {}
    }

    function liberarDocsDoJob(job) {
        (job.docsId || []).concat(job.docsRend || []).forEach(liberarDoc);
        job.docsId = []; job.docsRend = [];
    }

    function checar(job) { if (job.cancelado) throw CANCELADO; }

    function andamento(job, etapa, pct, passo) {
        checar(job);
        if (etapa !== undefined) job.etapa = etapa;
        if (pct !== undefined) job.prog = pct;
        if (passo !== undefined) job.passo = passo;
        pedirRender();
    }

    var _renderPendente = false;
    function pedirRender() {
        if (_renderPendente) return;
        _renderPendente = true;
        (window.requestAnimationFrame || setTimeout)(function () {
            _renderPendente = false;
            renderLista();
            atualizarBadge();
        });
    }

    function iniciarAnalise() {
        if (!_docsRend.length || _enviando > 0) return;
        var job = {
            id: ++_jobSeq, estado: 'fila', ts: Date.now(), nome: '',
            docsId: _docsId, docsRend: _docsRend,
            prog: 0, etapa: 'Na fila', passo: 0,
            dados: null, texto: '', cpf: '', fbKey: null, criadoAqui: false, podeSalvarCalc: true,
            visto: false, erro: '', cancelado: false, pergunta: null, calc: null
        };
        _docsId = []; _docsRend = [];
        _jobs.unshift(job);
        _formAberto = false;
        renderRascunho(); aplicarForm(); renderLista();
        processarFila();
    }

    function processarFila() {
        var ocupados = _jobs.filter(function (j) { return j.estado === 'rodando' || j.estado === 'aguarda'; }).length;
        for (var i = _jobs.length - 1; i >= 0 && ocupados < MAX_JOBS_SIMULTANEOS; i--) {
            if (_jobs[i].estado === 'fila') {
                _jobs[i].estado = 'rodando';
                _jobs[i].etapa = 'Iniciando...';
                ocupados++;
                rodarJob(_jobs[i]);
            }
        }
        pedirRender();
    }

    async function rodarJob(job) {
        try {
            await executarJob(job);
        } catch (e) {
            if (e !== CANCELADO) {
                job.estado = 'erro';
                job.erro = String((e && e.message) || e || 'Erro desconhecido');
                job.etapa = 'Falhou';
                console.warn('CreditoScan - analise falhou:', e);
                avisarJob(job, 'erro');
            }
        } finally {
            processarFila();
        }
    }

    function cancelarJob(job) {
        if (!job) return;
        job.cancelado = true;
        if (job.pergunta) { var p = job.pergunta; job.pergunta = null; p.resolve('cancelar'); }
        liberarDocsDoJob(job);
        removerBanner(job.id);
        var i = _jobs.indexOf(job);
        if (i !== -1) _jobs.splice(i, 1);
        if (_formAberto === false && _jobs.length === 0) _formAberto = true;
        aplicarForm();
        processarFila();
    }

    function tentarDeNovo(job) {
        if (!job || job.estado !== 'erro') return;
        job.estado = 'fila'; job.erro = ''; job.prog = 0; job.passo = 0; job.etapa = 'Na fila';
        removerBanner(job.id);
        processarFila();
    }

    // Pergunta ao vendedor sem travar a tela: o job fica "aguardando" e um aviso aparece.
    function perguntar(job, tipo, dados) {
        return new Promise(function (resolve) {
            job.estado = 'aguarda';
            job.etapa = 'Precisa da sua decisao';
            job.pergunta = { tipo: tipo, dados: dados, resolve: resolve };
            pedirRender();
            avisarJob(job, 'pergunta');
        });
    }

    function responderPergunta(job, valor) {
        var p = job.pergunta; if (!p) return;
        job.pergunta = null; job.modalAberto = false;
        if (job.estado === 'aguarda') job.estado = 'rodando';
        removerBanner(job.id);
        p.resolve(valor);
        pedirRender();
    }

    function abrirPergunta(job) {
        if (!job || !job.pergunta || job.modalAberto) return;
        var p = job.pergunta;
        job.modalAberto = true;
        if (p.tipo === 'qualidade') {
            mostrarModalDocQualidade(
                p.dados.problemas,
                function () { responderPergunta(job, true); },
                function () { responderPergunta(job, false); }
            );
        } else if (p.tipo === 'reuso') {
            mostrarModalReuso(job, p.dados.registro, p.dados.cpf);
        }
    }

    function mostrarModalReuso(job, registro, cpfFormatado) {
        var modal = document.createElement('div');
        modal.id = 'cs_alerta_reuso';
        modal.className = 'cs-modal cs-scope';
        var dt = new Date(registro.ts).toLocaleDateString('pt-BR');
        var ap = registro.decisao === 'APROVADO' || registro.decisao === 'DOWNGRADE' || registro.decisao === 'ENTRADA_ALTA';
        modal.innerHTML =
            '<div class="cs-modal-box">' +
                '<div class="cs-modal-ttl"><i class="bi bi-exclamation-triangle-fill"></i> Cliente já analisado</div>' +
                '<div class="cs-modal-txt"><strong>' + esc(registro.nomeCliente) + '</strong> (CPF: ' + esc(cpfFormatado) + ') fez uma análise nos últimos ' + HIST_DAYS + ' dias (' + dt + ').</div>' +
                '<div class="cs-modal-prev ' + (ap ? 'ok' : 'no') + '">' +
                    '<span>Resultado anterior</span>' +
                    '<strong>' + esc(registro.risco || registro.decisao || '--') + ' (' + (registro.nota || 0) + ' pts)</strong>' +
                '</div>' +
                '<button class="cs-btn cs-btn-pri" id="cs_btn_reaproveitar">Reaproveitar (0 custo)</button>' +
                '<button class="cs-btn cs-btn-sec" id="cs_btn_refazer">Ignorar e refazer análise (gasta token)</button>' +
            '</div>';
        document.body.appendChild(modal);
        function fechar(v) { if (modal.parentNode) modal.parentNode.removeChild(modal); responderPergunta(job, v); }
        el('cs_btn_reaproveitar').onclick = function () { fechar('reusar'); };
        el('cs_btn_refazer').onclick = function () { fechar('refazer'); };
    }

    // Nome do titular lido direto do texto do extrato (plano B quando a IA nao devolve o nome).
    var NOME_PROIBIDO = /\b(extrato|banco|conta|agencia|ag[eê]ncia|saldo|per[ií]odo|pix|ltda|s\.?a|pagamentos|institui[cç][aã]o|emitido|data|cpf|cnpj|documento|movimenta[cç][aã]o|mercado|nubank|inter|caixa|bradesco|santander|ita[uú])\b/i;
    function nomeValido(n) {
        n = String(n || '').replace(/[^A-Za-zÀ-ÿ'. -]/g, ' ').replace(/\s+/g, ' ').trim();
        if (n.length < 6 || n.length > 60 || NOME_PROIBIDO.test(n)) return '';
        var pal = n.split(' ').filter(Boolean);
        var reais = pal.filter(function (w) { return !/^(d[eao]s?|e)$/i.test(w); });
        return (reais.length >= 2 && pal.length <= 7 && reais.every(function (w) { return w.length >= 2; })) ? n : '';
    }
    function nomeNoTexto(texto) {
        var linhas = String(texto || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).slice(0, 80);
        var m, i, n;
        for (i = 0; i < linhas.length; i++) {
            m = linhas[i].match(/(?:^|\s)(?:nome(?:\s+completo|\s+do\s+titular|\s+do\s+cliente)?|titular(?:\s+da\s+conta)?|cliente|correntista)\s*[:\-–]\s*(.+)$/i);
            if (m) { n = nomeValido(m[1].split(/\s{2,}|\bCPF\b|\bCNPJ\b|\bAg[eê]ncia\b|\bConta\b|\d/i)[0]); if (n) return n; }
        }
        for (i = 0; i < linhas.length; i++) {
            if (!/\bCPF\b/i.test(linhas[i])) continue;
            n = nomeValido(linhas[i].split(/\bCPF\b/i)[0]);
            if (!n && i > 0) n = nomeValido(linhas[i - 1]);
            if (n) return n;
        }
        return '';
    }
    // Sem nome vindo da IA: usa o do extrato, depois o do RG/CNH.
    function completarNome(d, job, textoLocal) {
        if (d.nomeRenda || d.nomeDocPessoal) return;
        var n = nomeNoTexto(textoLocal) || String(job.nome || '').trim();
        if (!n) return;
        d.nomeCompleto = capNome(n);
        d.nomeCliente = d.nomeCompleto.split(' ')[0];
    }

    async function executarJob(job) {
        var fb = null;
        var textosLocais = [];
        job.docsRend.forEach(function (d) { if (d.textos && d.textos.length) textosLocais = textosLocais.concat(d.textos); });
        var textoParaApostas = textosLocais.join('\n');

        // ── PASSO 0: documento pessoal (CPF) e historico — evita gastar token a toa ──
        andamento(job, 'Lendo documentos...', 6, 0);
        var cpf = '';
        if (job.docsId.length > 0) {
            try {
                var promptId = 'Extraia o CPF e o Nome do titular deste documento. Retorne APENAS um JSON valido: {"cpf": "123.456.789-00", "nome": "Nome do Titular"}. Se nao achar CPF, retorne {"cpf": ""}';
                var respId = await aiCallVision(job.docsId, '', promptId);
                var ir1 = respId.indexOf('{'), ir2 = respId.lastIndexOf('}');
                if (ir1 !== -1 && ir2 > ir1) {
                    var objId = JSON.parse(respId.substring(ir1, ir2 + 1));
                    if (objId.cpf) cpf = String(objId.cpf).replace(/\D/g, '');
                    if (objId.nome) job.nome = String(objId.nome).trim().substring(0, 80);
                }
            } catch (e) { console.warn('Falha na leitura antecipada do documento:', e); }
        } else {
            var mc = textosLocais.join(' ').match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/);
            if (mc) cpf = mc[0].replace(/\D/g, '');
        }
        andamento(job, 'Consultando histórico...', 14);

        if (cpf.length === 11) {
            try {
                fb = fb || await import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js');
                var db = window._firebaseDB;
                if (db) {
                    var snap = await fb.get(fb.ref(db, SAVE_PATH));
                    var itens = [];
                    if (snap.exists()) {
                        var limite = Date.now() - HIST_DAYS * 86400000;
                        snap.forEach(function (c) {
                            var v = c.val();
                            if (v && v.cpf === cpf && v.ts > limite) itens.push(Object.assign({ id: c.key }, v));
                        });
                    }
                    checar(job);
                    if (itens.length > 0) {
                        itens.sort(function (a, b) { return b.ts - a.ts; });
                        var cpfMask = cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
                        var escolha = await perguntar(job, 'reuso', { registro: itens[0], cpf: cpfMask });
                        checar(job);
                        if (escolha === 'reusar') {
                            var dReuso = dadosDoRegistro(itens[0]);
                            job.fbKey = itens[0].id; job.criadoAqui = false; job.podeSalvarCalc = !itens[0].produto;
                            concluirJob(job, dReuso, itens[0].textoCompleto || '');
                            return;
                        }
                        andamento(job, 'Lendo documentos...', 16);
                    }
                }
            } catch (e) { if (e === CANCELADO) throw e; console.warn('Erro na busca do historico local:', e); }
        }
        job.cpf = cpf;

        // ── Qualidade dos documentos (zero tokens) ──
        var qualidade = validarQualidadeDocumentos(textosLocais);
        if (qualidade.problemas.length > 0) {
            var seguir = await perguntar(job, 'qualidade', { problemas: qualidade.problemas });
            checar(job);
            if (!seguir) throw new Error('Documentos insuficientes. Peça ao cliente os documentos corretos e envie de novo.');
            andamento(job, 'Lendo documentos...', 18);
        }

        // ── PASSO 1: pre-filtro local de apostas (zero tokens) ──
        andamento(job, 'Verificando apostas...', 24, 1);
        var apostas = detectarApostas(textoParaApostas);
        if (apostas.gatilho) {
            andamento(job, 'Reprovado automaticamente', 90, 3);
            var dAposta = resultadoApostasReprovado('', job.nome || nomeNoTexto(textoParaApostas), apostas);
            dAposta.nomeCliente = String(dAposta.nomeCompleto || 'Cliente').split(' ')[0];
            dAposta.casasJogo = apostas.casas || [];
            prepararDados(dAposta);
            checar(job);
            job.fbKey = await salvarFB(dAposta.nomeCompleto, '', apostas.detalhe, dAposta, cpf);
            job.criadoAqui = true;
            concluirJob(job, dAposta, apostas.detalhe);
            return;
        }

        // ── PASSO 2: payload hibrido (imagens + texto digital) ──
        andamento(job, 'Preparando dados...', 32, 2);
        var imagensParaIA = [];
        var textosDigitais = [];
        job.docsId.forEach(function (d) { if (d.base64) imagensParaIA.push(d); });
        job.docsRend.forEach(function (d) {
            if (d.ehDigital && d.textos && d.textos.length) textosDigitais = textosDigitais.concat(d.textos);
            else if (d.base64) imagensParaIA.push(d);
        });
        if (imagensParaIA.length > MAX_IMGS_AI) {
            var step = imagensParaIA.length / MAX_IMGS_AI, sampled = [];
            for (var si = 0; si < MAX_IMGS_AI; si++) sampled.push(imagensParaIA[Math.min(Math.floor(si * step), imagensParaIA.length - 1)]);
            imagensParaIA = sampled;
        }
        var textoDigitalStr = '';
        if (textosDigitais.length) {
            textoDigitalStr = '=== EXTRATO BANCARIO DIGITAL (texto extraido do PDF) ===\n' +
                textosDigitais.join('\n--- PROXIMA PAGINA ---\n').substring(0, 30000);
        }
        if (imagensParaIA.length === 0 && !textoDigitalStr) {
            throw new Error('Nenhum documento legível. Envie fotos mais nítidas ou o PDF original do banco.');
        }

        // ── PASSO 3: pipeline de IA ──
        var temSoTexto = (imagensParaIA.length === 0 && textoDigitalStr);
        var rendaPre = null;   // renda da etapa 1 (so texto digital), calculada aqui no codigo
        if (temSoTexto) {
            andamento(job, 'Calculando renda (1/2)...', 45, 2);
            try {
                var respRenda = await aiCallTexto(buildPromptRenda(textoDigitalStr));
                var j1 = respRenda.indexOf('{'), j2 = respRenda.lastIndexOf('}');
                if (j1 !== -1 && j2 > j1) {
                    var cRenda = calcularRenda(JSON.parse(respRenda.substring(j1, j2 + 1)));
                    if (cRenda && cRenda.renda > 0) rendaPre = cRenda;
                }
            } catch (eR) { if (eR === CANCELADO) throw eR; console.warn('Etapa 1 falhou, prosseguindo sem renda pre-calculada:', eR); }
            checar(job);
            andamento(job, 'Analisando comportamento (2/2)...', 65, 2);
        } else {
            var modoDesc = imagensParaIA.length + (imagensParaIA.length === 1 ? ' imagem' : ' imagens') + (textoDigitalStr ? ' + texto' : '');
            andamento(job, 'IA lendo ' + modoDesc + '...', 50, 2);
        }

        var resp;
        try {
            if (temSoTexto) {
                var textoParaAnalise = '=== EXTRATO ===\n' + textoDigitalStr.substring(0, 25000) + '\n\n';
                resp = await aiCallTexto(textoParaAnalise + buildPrompt(rendaPre));
            } else {
                resp = await aiCallVision(imagensParaIA, textoDigitalStr, buildPrompt(null));
            }
        } catch (eAI) {
            throw new Error('Falha ao consultar a IA: ' + ((eAI && eAI.message) || eAI));
        }
        checar(job);

        // ── PASSO 4: nota final ──
        andamento(job, 'Finalizando...', 90, 3);
        var d = extrair(resp);
        if (/^ERRO/.test(d.risco || '')) throw new Error('A IA devolveu uma resposta inválida. Tente de novo.');
        d._produto = '';
        d.sinaisCompromisso = detectarSinaisCompromisso(textoParaApostas);   // confere a lista de compromissos da IA com o texto do extrato

        finalizarPontuacao(d, rendaPre);   // renda (media/mediana/abatimentos) + soma da regua, no codigo
        validarApostasNaResposta(d);
        validarComprometimento(d);
        completarNome(d, job, textoParaApostas);

        if (d.rendaEstimada > 0 && d.rendaEstimada < 1000 && !d.reprovado) {
            d.aprov = false; d.reprovado = true; d.nota = Math.min(d.nota, 30);
            d.risco = 'REPROVADO'; d.entradaPct = 0.60;
            d.motivos = (d.motivos ? d.motivos + '\n' : '') + 'Renda de R$ ' + d.rendaEstimada + ' abaixo do minimo de R$ 1.000. Impossivel parcelar.';
        }
        if (!(d.rendaEstimada > 0) && !d.reprovado) {
            d.aprov = false; d.reprovado = true; d.nota = 0;
            d.risco = 'REPROVADO'; d.entradaPct = 0.60;
            d.motivos = (d.motivos ? d.motivos + '\n' : '') + 'Renda estimada = R$ 0,00. Impossivel aprovar sem comprovacao de renda.';
        }
        prepararDados(d);

        job.fbKey = await salvarFB(d.nomeCompleto, '', resp, d, cpf);
        job.criadoAqui = true;
        concluirJob(job, d, resp);
    }

    function concluirJob(job, d, texto) {
        checar(job);
        job.dados = d; job.texto = texto;
        if (d.nomeCompleto && d.nomeCompleto !== 'Cliente' && d.nomeCompleto !== 'Amigo(a)') job.nome = d.nomeCompleto;
        job.estado = 'pronta'; job.prog = 100; job.etapa = 'Pronta'; job.pergunta = null;
        job.calc = { aberto: false, produto: '', valor: 0 };
        liberarDocsDoJob(job);
        pedirRender();
        avisarJob(job, 'pronta');
    }

    // ── Dados de uma analise guardada (historico / reaproveitamento) ──
    // Volta ao estado "sem aparelho" e respeita a decisao que foi salva
    // (a IA sozinha nao sabe das reprovacoes automaticas por apostas/renda).
    function prepararDados(d) {
        d.downgrade = false; d.entradaAlta = false; d.entrada = null;
        d.risco = String(d.risco || '').split(' · ')[0];
        d.taxa = TAXA_PADRAO; d.parcelas = PARCELAS_PADRAO;
        d._produto = '';
        return d;
    }

    function dadosDoRegistro(it) {
        var d = it.textoCompleto ? extrair(it.textoCompleto) : null;
        var nota = typeof it.nota === 'number' ? it.nota : (parseInt(it.nota) || 0);
        var reprovado = it.decisao === 'REPROVADO';
        if (!d || /^ERRO/.test(d.risco || '')) {
            // texto salvo nao e JSON (ex.: reprovacao automatica por apostas): remonta pelos campos
            var nome = String(it.nomeCliente || 'Cliente');
            var casas = it.casasJogo ? String(it.casasJogo).split(',').filter(Boolean) : [];
            d = {
                aprov: !reprovado, downgrade: false, entradaAlta: false, reprovado: reprovado,
                nota: nota, risco: reprovado ? 'REPROVADO' : (nota >= 85 ? 'FORTE' : nota >= 60 ? 'MEDIO' : 'FRACO'),
                entradaPct: nota >= 85 ? 0.33 : nota >= 60 ? 0.35 : 0.60,
                rendaEstimada: parseFloat(it.rendaEstimada) || 0,
                taxa: TAXA_PADRAO, parcelas: PARCELAS_PADRAO, entrada: null,
                nomeCliente: nome.split(' ')[0], nomeCompleto: nome,
                nomeDocPessoal: '', nomeRenda: '', nomesBatem: null, confianca: it.confianca || 'ALTA',
                perfil: '', analise: String(it.textoCompleto || ''), calculo: '', conselho: '', resumoExec: '',
                rascunho: '', motivos: reprovado ? String(it.resumo || '') : '', casasJogo: casas
            };
        } else if (reprovado && !d.reprovado) {
            d.aprov = false; d.reprovado = true; d.risco = 'REPROVADO'; d.entradaPct = 0.60;
            d.motivos = d.motivos || String(it.resumo || 'Reprovado.');
        } else if (!reprovado && d.reprovado && d.nomesBatem !== false) {
            // a nota da IA era baixa, mas o sistema aprovou: vale a decisao salva
            d.aprov = true; d.reprovado = false; d.motivos = '';
        }
        if (typeof it.nota === 'number' || it.nota) d.nota = nota;
        if (!d.reprovado) { var rr = riscoPorNota(d.nota); d.risco = rr.risco; d.entradaPct = rr.entradaPct; }   // risco/entrada seguem a nota SALVA (o JSON da IA guarda a nota dela)
        if (d.rawJson) separarCasasJogo(d, it.casasJogo != null ? String(it.casasJogo).split(',').map(function (x) { return x.trim(); }).filter(Boolean) : null);
        if (!(d.rendaEstimada > 0) && parseFloat(it.rendaEstimada) > 0) d.rendaEstimada = parseFloat(it.rendaEstimada);
        // analise nova: a renda e o detalhe salvos valem (a etapa de texto nao deixa os meses no JSON)
        if (it.rendaDetalhe && parseFloat(it.rendaEstimada) > 0) { d.rendaEstimada = parseFloat(it.rendaEstimada); d.rendaDetalhe = String(it.rendaDetalhe); }
        if (d.rawJson) {
            if (parseInt(it.sinaisCompromisso) > 0) d.sinaisCompromisso = { total: parseInt(it.sinaisCompromisso), termos: [] };
            calcularComprometimento(d);
        }
        if (it.calculoFinal) d.calculo = String(it.calculoFinal);
        return prepararDados(d);
    }

    // ================================================================
    // RESULTADO DA ANALISE
    // ================================================================
    function tetoPct(nota) { return nota >= 85 ? 0.30 : nota >= 60 ? 0.20 : 0.10; }

    function entradaMinima(d, valor) {
        var base = Math.ceil(valor * d.entradaPct / 10) * 10;
        var en = (d.entradaAlta && d.entrada) ? Math.ceil(parseFloat(d.entrada) / 10) * 10 : base;
        return Math.min(en, valor);
    }

    // "2.000,50" / "2000,5" / "2000.50" / "R$ 2.000" -> numero
    function numBR(s) {
        s = String(s == null ? '' : s).replace(/[^\d.,]/g, '');
        if (!s) return 0;
        if (s.indexOf(',') !== -1) s = s.replace(/\./g, '').replace(',', '.');
        else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
        var n = parseFloat(s);
        return isFinite(n) ? n : 0;
    }
    function fmtNum(v) { return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

    function dataAnalise(ts) {
        var dt = new Date(ts || Date.now()), hoje = new Date();
        var hora = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        if (dt.toDateString() === hoje.toDateString()) return 'hoje, ' + hora;
        return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ', ' + hora;
    }

    function blocoTexto(txt) { return esc(txt).replace(/\n/g, '<br>'); }

    function abrirResultado(job) {
        if (!job || !job.dados) return;
        _view = job; job.visto = true;
        removerBanner(job.id);
        if (!job.calc) job.calc = { aberto: false, produto: '', valor: 0 };
        openOverlay();
        renderResultado();
        el('cs_res_ov').classList.add('active');
        var body = el('cs_res_body'); if (body) body.scrollTop = 0;
        pedirRender();
    }

    function fecharResultado() {
        el('cs_res_ov') && el('cs_res_ov').classList.remove('active');
        _view = null;
        renderLista();
    }

    function renderResultado() {
        var job = _view; if (!job) return;
        var d = job.dados, sec = parsearSecoes(d.analise || '');
        var reprov = !!d.reprovado, c = reprov ? 'bad' : cor(d.nota);
        var riscoLabel = String(d.risco || '').split(' · ')[0];
        var dash = Math.round(Math.max(0, Math.min(100, d.nota)) / 100 * 264);
        var sub = el('cs_res_sub'); if (sub) sub.textContent = 'Análise de ' + dataAnalise(job.ts);
        var h = '';

        // Nota + decisao
        h += '<div class="cs-hero ' + c + '">' +
            '<div class="cs-ring"><svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">' +
                '<circle cx="48" cy="48" r="42" class="trk"/><circle cx="48" cy="48" r="42" class="val" stroke-dasharray="' + dash + ' 264" transform="rotate(-90 48 48)"/></svg>' +
                '<div class="cs-ring-in"><b>' + d.nota + '</b><small>' + esc(riscoLabel) + '</small></div></div>' +
            '<div class="cs-hero-info"><div class="cs-hero-nome">' + esc(d.nomeCompleto || nomeDoJob(job)) + '</div>' +
            '<span class="cs-pill ' + c + '"><i class="bi ' + (reprov ? 'bi-x-lg' : 'bi-check-lg') + '"></i>' + (reprov ? 'Reprovado — não vender' : 'Aprovado — pode vender') + '</span></div></div>';

        String(d.rendaDetalhe || '').split('\n').filter(function (l) { return l.charAt(0) === '⚠'; }).forEach(function (l) {
            h += '<div class="cs-alert warn"><i class="bi bi-exclamation-triangle-fill"></i><span>' + esc(l.replace(/^⚠\s*/, '')) + '</span></div>';
        });
        var divg = avisoDivergencia(d);
        if (divg) h += '<div class="cs-alert warn"><i class="bi bi-exclamation-triangle-fill"></i><span>' + esc(divg) + '</span></div>';

        if (d.compromissoDuvida) h += '<div class="cs-alert warn"><i class="bi bi-exclamation-triangle-fill"></i><span><strong>Compromissos fixos não confirmados:</strong> a IA não achou nenhum, mas o extrato tem ' + d.sinaisCompromisso.total + ' menções a ' + esc(d.sinaisCompromisso.termos.length ? d.sinaisCompromisso.termos.map(function (t) { return t.replace(/\s*\(\d+\)$/, ''); }).join(', ') : 'fatura, parcela, aluguel ou similares') + '. Confira no extrato antes de aprovar. Esse item não entrou na nota.</span></div>';

        if (d.confianca === 'BAIXA') h += '<div class="cs-alert warn"><i class="bi bi-exclamation-triangle-fill"></i><span><strong>Atenção:</strong> documento com qualidade baixa. Peça uma foto melhor.</span></div>';
        else if (d.confianca === 'MEDIA') h += '<div class="cs-alert warn soft"><i class="bi bi-eye-fill"></i><span>Qualidade média — confira o nome manualmente.</span></div>';

        // Renda
        if (d.rendaEstimada > 0) {
            // Como a renda saiu (calculo do sistema); sem ele, o resumo que a IA escreveu
            var detRenda = d.rendaDetalhe ? esc(String(d.rendaDetalhe).split('\n').filter(function (l) { return l.charAt(0) !== '⚠'; }).join('\n')).replace(/\n/g, '<br>') : '';
            if (!detRenda && sec['RENDA']) {
                detRenda = sec['RENDA'].replace(/\s*\n+\s*/g, ' · ');
                if (detRenda.length > 170) detRenda = detRenda.substring(0, 167) + '...';
                detRenda = esc(detRenda);
            }
            h += '<div class="cs-card cs-renda"><span class="cs-lab">Renda média mensal</span><strong>' + R$(d.rendaEstimada) + '</strong>' +
                (detRenda ? '<span class="cs-det">' + detRenda + '</span>' : '') + '</div>';
        }

        // Indicadores
        var pct = pctComprometimento(d, sec);
        if (pct !== null) pct = Math.min(pct, 100);
        var casas = d.casasJogo || [], susp = d.suspeitasJogo || [];
        var tit = d.nomesBatem === true ? ['Confirmada', 'ok'] : d.nomesBatem === false ? ['Divergência', 'bad'] : ['Sem documento', 'warn'];
        var div = sec['DIVIDAS ATIVAS'];
        var dv = !div ? ['—', ''] : /nenhum|sem d[ií]vida|n[aã]o (h[aá]|foram|identific|possui|consta)/i.test(div) ? ['Nenhuma', 'ok'] : ['Identificadas', 'warn'];
        h += '<div class="cs-grid2">' +
            '<div class="cs-card cs-ind"><span class="cs-lab">Compromissos fixos</span><b class="' + (d.compromissoDuvida ? 'warn' : pct === null ? '' : pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok') + '">' + (pct === null ? '—' : pct + '%') + '</b></div>' +
            '<div class="cs-card cs-ind"><span class="cs-lab">Apostas</span><b class="' + (casas.length ? 'bad' : susp.length ? 'warn' : 'ok') + '">' + (casas.length ? casas.length + (casas.length > 1 ? ' casas' : ' casa') : susp.length ? 'Só suspeita' : 'Nenhuma') + '</b></div>' +
            '<div class="cs-card cs-ind"><span class="cs-lab">Titularidade</span><b class="' + tit[1] + '">' + tit[0] + '</b></div>' +
            '<div class="cs-card cs-ind"><span class="cs-lab">Dívidas</span><b class="' + dv[1] + '">' + dv[0] + '</b></div></div>';

        // Quanto do que entrou foi embora (informativo; nao muda a nota)
        if (d.fluxo) {
            var fp = d.fluxo.pct;
            h += '<div class="cs-card cs-ind cs-fluxo"><span class="cs-lab">Saídas ÷ entradas</span><b class="' + (fp >= 98 ? 'bad' : fp >= 90 ? 'warn' : 'ok') + '">' + fp + '%</b>' +
                '<span class="cs-det">De cada R$ 100 que entraram, saíram R$ ' + fp + ' (entradas ' + R$(d.fluxo.entradas) + ' · saídas ' + R$(d.fluxo.saidas) + ' em ' + d.fluxo.meses + (d.fluxo.meses === 1 ? ' mês' : ' meses') + '). Valores aproximados; não muda a nota.</span></div>';
        }

        // Parcela confortavel (estimativa sem aparelho)
        if (!reprov && d.rendaEstimada > 0) {
            h += '<div class="cs-card cs-conf"><div><span class="cs-lab">Parcela confortável (estimativa)</span>' +
                '<strong>até ' + R$(d.rendaEstimada * tetoPct(d.nota)).replace(',00', '') + ' / mês</strong></div>' +
                '<span class="cs-lab r">' + Math.round(tetoPct(d.nota) * 100) + '% da<br>renda</span></div>';
        }

        // Calcular aparelho (recolhido)
        if (!reprov) {
            var cc = job.calc;
            h += '<button type="button" class="cs-calc-toggle' + (cc.aberto ? ' open' : '') + '" data-act="calc-toggle">' +
                '<i class="bi bi-calculator-fill"></i><span><b>Calcular aparelho</b><small>Informe o valor. Usa esta nota, sem nova análise.</small></span>' +
                '<i class="bi bi-chevron-down cs-chev"></i></button>' +
                '<div id="cs_calc" class="cs-calc' + (cc.aberto ? ' open' : '') + '">' +
                    '<div class="cs-card cs-calc-form">' +
                        '<div class="cs-field"><label for="cs_c_prod">Produto <em>(opcional)</em></label><input id="cs_c_prod" class="cs-in" type="text" maxlength="80" placeholder="Ex: iPhone 13 128 GB" value="' + esc(cc.produto) + '" autocomplete="off"></div>' +
                        '<div class="cs-field"><label for="cs_c_val">Valor do aparelho (R$)</label><input id="cs_c_val" class="cs-in" type="text" inputmode="decimal" placeholder="Ex: 2.000,00" value="' + (cc.valor > 0 ? fmtNum(cc.valor) : '') + '" autocomplete="off"></div>' +
                        '<div class="cs-err" id="cs_c_erro"></div>' +
                        '<button type="button" class="cs-btn cs-btn-pri" data-act="calc-go"><i class="bi bi-calculator"></i> Calcular</button>' +
                    '</div>' +
                    '<div id="cs_calc_out"></div>' +
                '</div>';
        }

        // Aparelhos liberados para a renda deste cliente (aba fechada, abaixo do Calcular aparelho)
        h += apHtmlCard(d);

        // Reprovado: motivos + mensagem
        if (reprov && d.motivos) h += '<div class="cs-card cs-motivos"><span class="cs-lab">Motivos da reprovação</span><p>' + blocoTexto(d.motivos) + '</p></div>';

        // Parecer
        if (d.resumoExec || d.perfil) {
            h += '<div class="cs-card cs-parecer"><span class="cs-lab">' + (divg ? 'PARECER DA IA (DIVERGE DA DECISÃO)' : 'PARECER') + '</span>' +
                (d.resumoExec ? '<p class="lead">' + blocoTexto(d.resumoExec) + '</p>' : '') +
                (d.perfil ? '<p>' + blocoTexto(d.perfil) + '</p>' : '') + '</div>';
        }

        if (reprov) h += cartaoMensagem(gerarWppReprovado(d.nomeCliente));

        // Detalhes recolhidos
        var KEYS = [['RENDA', 'Renda'], ['CASAS DE JOGO', 'Casas de jogo'], ['COMPROMISSOS FIXOS', 'Compromissos fixos'], ['COMPROMETIMENTO', 'Comprometimento'], ['SALDOS', 'Saldos'], ['DIVIDAS ATIVAS', 'Dívidas ativas'], ['PADROES DE RISCO', 'Padrões de risco']];
        // Compromissos fixos: a lista e a soma sao do sistema; substitui as secoes de texto da IA sobre o assunto
        var compH = '';
        if (d.compromissosLista && d.compromissosLista.length) {
            compH = '<h4>Compromissos fixos</h4><p>' + d.compromissosLista.map(function (i) { return '• ' + esc(i.desc) + ': ' + R$(i.valor) + '/mês' + (i.meses ? ' (' + i.meses + (i.meses === 1 ? ' mês' : ' meses') + ')' : ''); }).join('<br>') +
                '<br><b>Total: ' + R$(d.compromissos) + '/mês' + (d.comprometimentoPct !== null ? ' = ' + d.comprometimentoPct + '% da renda' : '') + '</b></p>';
        } else if (d.compromissos > 0) {
            compH = '<h4>Compromissos fixos</h4><p>Total informado pela IA: ' + R$(d.compromissos) + '/mês' + (d.comprometimentoPct !== null ? ' = ' + d.comprometimentoPct + '% da renda' : '') + '.</p>';
        } else if (d.compromissos === 0) {
            compH = '<h4>Compromissos fixos</h4><p>' + (d.compromissoDuvida ? 'A IA não listou nenhum, mas o extrato tem sinais de fatura, parcela ou similar. Não confirmado.' : 'Nenhum encontrado no extrato.') + '</p>';
        }
        var analise = KEYS.filter(function (k) { return sec[k[0]] && !(compH && /^COMPROM/.test(k[0])); }).map(function (k) { return '<h4>' + k[1] + '</h4><p>' + blocoTexto(sec[k[0]]) + '</p>'; }).join('');
        if (!analise && d.analise && !compH) analise = '<p>' + blocoTexto(d.analise) + '</p>';
        analise = compH + analise;
        var titular = (d.nomeDocPessoal || d.nomeRenda) ?
            '<h4>Titularidade</h4><p>' + (d.nomeDocPessoal ? 'Documento: ' + esc(d.nomeDocPessoal) + '<br>' : '') + (d.nomeRenda ? 'Comprovante: ' + esc(d.nomeRenda) : '') + '</p>' : '';
        if (casas.length) analise += '<h4>Casas encontradas</h4><p>' + casas.map(esc).join(', ') + '</p>';
        if (susp.length) analise += '<h4>Suspeitas (não contam na nota)</h4><p>' + susp.map(esc).join(', ') + '<br><small>Nomes que a IA achou estranhos mas não são casas de aposta confirmadas. Confira no extrato.</small></p>';
        h += detalhe('Análise completa', analise + titular) +
             detalhe('Raciocínio da nota', d.calculo ? '<p class="mono">' + blocoTexto(d.calculo) + '</p>' : '') +
             detalhe('Conselho para o vendedor', d.conselho ? '<p>' + blocoTexto(d.conselho) + '</p>' : '');

        el('cs_res_body').innerHTML = h;
        apIniciarCard(job);
        if (!reprov && job.calc.valor > 0) renderCalcOut();
    }

    function detalhe(titulo, conteudo) {
        if (!conteudo) return '';
        return '<details class="cs-detalhe"><summary>' + titulo + '<i class="bi bi-chevron-down"></i></summary><div class="cs-detalhe-in">' + conteudo + '</div></details>';
    }

    function cartaoMensagem(msg) {
        return '<div class="cs-wpp"><span class="cs-wpp-lbl"><i class="bi bi-whatsapp"></i> Mensagem para o cliente</span>' +
            '<div class="cs-wpp-txt" id="cs_wpp_txt" data-act="copiar">' + blocoTexto(msg) + '</div>' +
            '<button type="button" class="cs-btn cs-btn-ghost" id="cs_wpp_btn" data-act="copiar"><i class="bi bi-clipboard"></i> Toque para copiar</button></div>';
    }

    function textoParaCopiar() {
        var job = _view; if (!job) return '';
        if (job.dados.reprovado) return gerarWppReprovado(job.dados.nomeCliente);
        return (job.calc && job.calc.msg) || '';
    }

    function copiarTexto(txt, btn) {
        if (!txt) return;
        function ok() {
            if (!btn) return;
            var antes = btn.innerHTML;
            btn.innerHTML = '<i class="bi bi-check-lg"></i> Copiado!';
            setTimeout(function () { btn.innerHTML = antes; }, 1500);
        }
        function plano() {
            var ta = document.createElement('textarea');
            ta.value = txt; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
            document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); ok(); } catch (e) {}
            document.body.removeChild(ta);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, plano);
        else plano();
    }

    // ── Calcular aparelho ──
    function calcular() {
        var job = _view; if (!job || !job.dados || job.dados.reprovado) return;
        var d = job.dados, c = job.calc;
        var erroEl = el('cs_c_erro');
        var prod = (el('cs_c_prod').value || '').trim();
        var val = numBR(el('cs_c_val').value);
        if (!(val > 0)) { if (erroEl) erroEl.textContent = 'Informe o valor do aparelho.'; return; }
        if (erroEl) erroEl.textContent = '';
        c.produto = prod; c.valor = val;
        c.en = null; c.np = PARCELAS_PADRAO; c.tx = TAXA_PADRAO;
        d._produto = prod;
        reavaliarDecisao(d, val);
        renderCalcOut();
        persistirCalc(job);
        var out = el('cs_calc_out'); if (out && out.scrollIntoView) out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function persistirCalc(job) {
        var d = job.dados, c = job.calc;
        if (!job.fbKey || !(job.criadoAqui || job.podeSalvarCalc)) return;
        var enMin = entradaMinima(d, c.valor);
        var vp = d.downgrade ? null : price(c.valor, enMin, PARCELAS_PADRAO, TAXA_PADRAO);
        var patch = {
            produto: c.produto || '', valorProduto: c.valor,
            decisao: d.reprovado ? 'REPROVADO' : d.downgrade ? 'DOWNGRADE' : d.entradaAlta ? 'ENTRADA_ALTA' : 'APROVADO',
            risco: d.risco, entrada: d.downgrade ? null : enMin,
            parcelas: d.downgrade ? null : PARCELAS_PADRAO, vparcela: vp,
            taxa: TAXA_PADRAO, total: vp == null ? null : enMin + vp * PARCELAS_PADRAO
        };
        if (d.rascunho) patch.resumo = d.rascunho;
        atualizarFB(job.fbKey, patch);
    }

    function renderCalcOut() {
        var job = _view, out = el('cs_calc_out'); if (!job || !out) return;
        var d = job.dados, c = job.calc;
        if (!(c.valor > 0)) { out.innerHTML = ''; return; }
        var vn = c.valor, riscoLabel = String(d.risco || '').split(' · ')[0];
        c.enMin = entradaMinima(d, vn);
        var nomeProd = c.produto || 'Aparelho';
        var h;
        if (d.downgrade) {
            h = '<div class="cs-plano info"><i class="bi bi-info-circle-fill"></i> PLANO B — LIMITE APROVADO</div>' +
                '<div class="cs-card cs-nota-b">O ' + esc(nomeProd) + ' (' + R$(vn) + ') ultrapassa a margem deste cliente.' +
                (d._alvo > 0 ? ' Ofereça aparelhos de até <strong>' + R$(d._alvo) + '</strong>.' : ' Ofereça um aparelho mais barato.') + '</div>';
            c.msg = gerarWpp(nomeProd, 0, 0, 0, d);
            out.innerHTML = h + cartaoMensagem(c.msg);
            return;
        }
        var plano = d.entradaAlta ?
            '<div class="cs-plano warn"><i class="bi bi-exclamation-triangle-fill"></i> PLANO C — ENTRADA TURBINADA</div>' :
            '<div class="cs-plano ok"><i class="bi bi-check-circle-fill"></i> APROVADO — PODE VENDER</div>';
        var aviso = d.entradaAlta ?
            'Entrada mínima travada em ' + R$(c.enMin) + ' (' + Math.round(c.enMin / vn * 100) + '%) — Entrada Turbinada' :
            'Entrada mínima: ' + Math.round(d.entradaPct * 100) + '% = ' + R$(c.enMin) + ' · perfil ' + esc(riscoLabel);
        var en = c.en != null ? c.en : c.enMin, np = c.np || PARCELAS_PADRAO, tx = c.tx != null ? c.tx : TAXA_PADRAO;
        var opts = ''; for (var i = 1; i <= 18; i++) opts += '<option value="' + i + '"' + (i === np ? ' selected' : '') + '>' + i + 'x</option>';
        h = plano +
            '<div class="cs-card cs-sim">' +
                '<div class="cs-lock ' + (d.entradaAlta ? 'warn' : '') + '"><i class="bi bi-lock-fill"></i><span>' + aviso + '</span></div>' +
                '<div class="cs-grid3">' +
                    '<div class="cs-field"><label for="cs_en">Entrada (R$)</label><input id="cs_en" class="cs-in" type="text" inputmode="decimal" value="' + fmtNum(en) + '" autocomplete="off"></div>' +
                    '<div class="cs-field"><label for="cs_np">Parcelas</label><select id="cs_np" class="cs-in">' + opts + '</select></div>' +
                    '<div class="cs-field"><label for="cs_tx">Juros %/mês</label><input id="cs_tx" class="cs-in" type="text" inputmode="decimal" value="' + String(tx).replace('.', ',') + '" autocomplete="off"></div>' +
                '</div>' +
                '<div class="cs-sim-res"><div><span class="cs-lab">Parcela</span><strong id="cs_sim_parc"></strong></div>' +
                '<div class="r"><span class="cs-lab">Total</span><b id="cs_sim_tot"></b></div></div>' +
                '<div class="cs-det" id="cs_sim_nota"></div>' +
            '</div>' +
            cartaoMensagem('');
        out.innerHTML = h;
        atualizarSim(true);
    }

    // Recalcula parcela/total/mensagem. Digitando (trava=false) aceita qualquer valor;
    // ao sair do campo (trava=true) aplica a entrada minima.
    function atualizarSim(trava) {
        var job = _view; if (!job || !job.calc || !(job.calc.valor > 0)) return;
        var d = job.dados, c = job.calc, vn = c.valor;
        var enEl = el('cs_en'), npEl = el('cs_np'), txEl = el('cs_tx'); if (!enEl || !npEl || !txEl) return;
        var enRaw = numBR(enEl.value);
        if (!trava && !(enRaw > 0)) return;
        var en = enRaw > 0 ? enRaw : c.enMin;
        var np = parseInt(npEl.value) || 1;
        var tx = Math.max(0, Math.min(30, numBR(txEl.value)));
        if (trava) {
            if (en < c.enMin) en = c.enMin;
            if (en >= vn) en = Math.max(vn - 10, 0);
            enEl.value = fmtNum(en);
            if (String(txEl.value).trim() === '' || numBR(txEl.value) !== tx) txEl.value = String(tx).replace('.', ',');
        }
        var vp = price(vn, Math.min(en, vn), np, tx), tt = Math.min(en, vn) + vp * np;
        c.en = en; c.np = np; c.tx = tx;
        var teto = d.rendaEstimada > 0 ? d.rendaEstimada * tetoPct(d.nota) : 0;
        var p = el('cs_sim_parc'); if (p) p.textContent = np + 'x ' + R$(vp);
        var t = el('cs_sim_tot'); if (t) t.textContent = R$(tt);
        var n = el('cs_sim_nota');
        if (n) n.textContent = teto > 0 ? (vp <= teto + 0.005 ? 'Entrada ' + R$(en) + ' + ' + np + ' parcelas mensais no boleto. Parcela dentro da faixa confortável (até ' + R$(teto) + ').' :
            'Entrada ' + R$(en) + ' + ' + np + ' parcelas mensais no boleto. Parcela acima da faixa confortável (' + R$(teto) + ').') :
            'Entrada ' + R$(en) + ' + ' + np + ' parcelas mensais no boleto.';
        c.msg = gerarWpp(c.produto || 'Aparelho', en, np, vp, d);
        var w = el('cs_wpp_txt'); if (w) w.innerHTML = blocoTexto(c.msg);
    }

    // ── Abrir uma analise do historico (sem gastar token) ──
    function abrirRegistro(idx) {
        var it = (window._histItems || [])[idx]; if (!it) return;
        var d = dadosDoRegistro(it);
        abrirResultado({
            id: 'h' + it.id, estado: 'pronta', ts: it.ts, nome: String(it.nomeCliente || ''),
            dados: d, texto: it.textoCompleto || '', fbKey: it.id, criadoAqui: false,
            podeSalvarCalc: !it.produto, visto: true, calc: { aberto: false, produto: '', valor: 0 }
        });
    }

    function acaoResultado(e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var a = b.getAttribute('data-act'), job = _view; if (!job) return;
        if (a === 'copiar') copiarTexto(textoParaCopiar(), el('cs_wpp_btn'));
        else if (a === 'ap-toggle') apToggleAba(job);
        else if (a === 'ap-sel') apToggleSel(job, b.getAttribute('data-id'));
        else if (a === 'ap-copy') copiarTexto(apMensagemAtual(job), b);
        else if (a === 'ap-wpp') apAbrirWpp(job);
        else if (a === 'ap-cfg') abrirConfig('ap');
        else if (a === 'calc-go') calcular();
        else if (a === 'calc-toggle') {
            job.calc.aberto = !job.calc.aberto;
            b.classList.toggle('open', job.calc.aberto);
            var box = el('cs_calc'); if (box) box.classList.toggle('open', job.calc.aberto);
            if (job.calc.aberto) { var v = el('cs_c_val'); if (v && !(job.calc.valor > 0)) v.focus(); }
        }
    }
    // ── Motor Matemático Offline: reavalia decisão sem chamar a API ──
    function reavaliarDecisao(d, novoValor) {
        // Se já era reprovado definitivo ou renda desconhecida, mantém
        if (d.reprovado || !(d.rendaEstimada > 0)) return d;

        // Teto da parcela conforme nota
        var tetoPct = d.nota >= 85 ? 0.30 : d.nota >= 60 ? 0.20 : 0.10;
        var teto    = d.rendaEstimada * tetoPct;

        // Entrada mínima (arredonda para dezena superior)
        var fator   = fatorPrice(PARCELAS_PADRAO, TAXA_PADRAO); // 12x a 8%am
        var enMin   = Math.ceil(novoValor * d.entradaPct / 10) * 10;
        var saldo   = novoValor - enMin;
        var parcela = saldo / fator;

        // Limpa flags de decisão antigas (mantém reprovado, nota, renda intactos)
        var riscoBase = d.risco.split(' · ')[0]; // ex: "MEDIO"

        if (parcela <= teto) {
            // Cliente passa no teste: aprovação normal
            d.aprov      = true;
            d.entradaAlta = false;
            d.downgrade  = false;
            d.risco      = riscoBase;
            d.entrada    = enMin;
        } else {
            // Não passou: calcula entrada turbinada
            var entTurb = novoValor - (teto * fator);
            if (entTurb > novoValor * 0.80) {
                // Entrada turbinada surreal → downgrade
                d.aprov       = true; // aprovado com limite menor
                d.entradaAlta = false;
                d.downgrade   = true;
                d.risco       = riscoBase + ' · DOWNGRADE';
                d.entrada     = null;
            } else {
                // Entrada turbinada viável
                d.aprov       = true;
                d.entradaAlta = true;
                d.downgrade   = false;
                d.risco       = riscoBase + ' · ENTRADA TURBINADA';
                d.entrada     = Math.ceil(entTurb / 10) * 10;
            }
        }
        // Atualiza rascunho com os numeros reais do recalculo local
        var riscoLabel2 = riscoBase;
        var rascTeto = R$(teto) + ' (' + Math.round(tetoPct*100) + '% da renda)';
        var rascParc = R$(parcela) + ' [(R$ ' + novoValor.toFixed(2) + ' - R$ ' + enMin.toFixed(2) + ') / ' + fator.toFixed(2).replace('.', ',') + ']';
        var rascStatus = parcela <= teto ? 'DENTRO do teto ✔' : 'ACIMA do teto ⚠️';
        var rascExtra = '';
        if (d.entradaAlta) rascExtra = '\nEntrada turbinada necessaria: R$ ' + d.entrada.toFixed(2);
        if (d.downgrade) rascExtra = '\nEntrada turbinada surreal (>80% do valor) → DOWNGRADE';
        // Calcula o alvo para incluir no rascunho
        var rascMultRenda = d.nota >= 85 ? 3.0 : d.nota >= 60 ? 2.2 : 1.0;
        var rascAlvoMaxParcela = Math.floor((teto * fator / (1 - d.entradaPct)) / 10) * 10;
        var rascAlvoMaxRenda   = Math.floor((d.rendaEstimada * rascMultRenda) / 10) * 10;
        var rascAlvoFinal      = Math.min(rascAlvoMaxParcela, rascAlvoMaxRenda);
        var rascAlvoMotivo     = rascAlvoMaxRenda < rascAlvoMaxParcela
            ? 'limitado pela trava de ' + rascMultRenda + 'x a renda (' + R$(rascAlvoMaxRenda) + ')'
            : 'limitado pelo teto de parcela (' + R$(rascAlvoMaxParcela) + ')';
        d.rascunho = 'Renda: ' + R$(d.rendaEstimada) + ' | Teto parcela: ' + rascTeto + '\n' +
            'Parcela base: ' + rascParc + ' = ' + rascStatus + rascExtra + '\n' +
            'Alvo ideal: ate ' + R$(rascAlvoFinal) + ' (' + rascAlvoMotivo + ')';

        d._alvo = rascAlvoFinal;
        return d;
    }

    function injectCSS(){
        if(el('cs-st'))return;
        var s=document.createElement('style');s.id='cs-st';
        s.textContent=[
        /* ── camadas: ficam ABAIXO do menu inferior do app (z 1060) para ele continuar visivel ── */
        '#cs_ov,#cs_hist_ov,#cs_res_ov,#cs_cfg_ov{display:none;position:fixed;inset:0;background:var(--bg-color,#16171A);color:var(--text-color);flex-direction:column;overflow:hidden;font-family:"Poppins",sans-serif}',
        '#cs_ov{z-index:1050}#cs_hist_ov{z-index:1051}#cs_res_ov{z-index:1052}#cs_cfg_ov{z-index:1053}',
        '#cs_ov.active,#cs_hist_ov.active,#cs_res_ov.active,#cs_cfg_ov.active{display:flex}',
        '.cs-scope{--cs-warn:#E9B44C;--cs-bad:#EF6B6B;--cs-info:#6FA8DC;--cs-ok:var(--primary-color)}',
        '[data-theme="light"] .cs-scope{--cs-warn:#B7791F;--cs-bad:#D14343;--cs-info:#2F6FAE}',
        '.cs-h{display:none!important}',
        /* ── cabecalho ── */
        '.cs-hdr,.cs-hhdr{display:flex;align-items:center;gap:10px;padding:calc(14px + env(safe-area-inset-top,0px)) 16px 12px;flex-shrink:0}',
        '.cs-hdr-ttl,.cs-hhdr-ttl{font-size:18px;font-weight:700;line-height:1.2;color:var(--text-color)}',
        '.cs-hdr-sub,.cs-hhdr-sub{font-size:12px;color:var(--text-secondary)}',
        '.cs-back,.cs-ibtn,.cs-hbtn{display:flex;align-items:center;justify-content:center;gap:8px;min-height:44px;border:1px solid var(--glass-border);background:var(--card-bg);color:var(--text-color);font:500 13px "Poppins",sans-serif;cursor:pointer;flex-shrink:0;-webkit-tap-highlight-color:transparent}',
        '.cs-back{width:44px;border-radius:50%;padding:0;font-size:1.1rem}',
        '.cs-ibtn{width:44px;border-radius:14px;padding:0}',
        '.cs-hbtn{padding:0 14px;border-radius:14px}',
        '.cs-back:active,.cs-ibtn:active,.cs-hbtn:active{transform:scale(.96)}',
        /* ── corpo rolavel (folga para o menu inferior) ── */
        '.cs-body,.cs-hbody{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:6px 16px 28px;display:flex;flex-direction:column;gap:12px;min-height:0}',
        'body.ctw-v2-active .cs-body,body.ctw-v2-active .cs-hbody{padding-bottom:calc(112px + env(safe-area-inset-bottom,0px))}',
        '.cs-body>*,.cs-hbody>*{flex-shrink:0}',
        '.cs-hbody{padding:12px 13px 28px;gap:9px}',
        '.cs-intro{text-align:left}',
        '.cs-intro h2{margin:0;font-size:22px;font-weight:700;line-height:1.25;text-align:left}',
        '.cs-intro p{margin:4px 0 0;font-size:13px;color:var(--text-secondary);line-height:1.5}',
        /* ── cartoes ── */
        '.cs-card{background:var(--card-bg);border:1px solid var(--glass-border);border-radius:18px;padding:14px;display:flex;flex-direction:column;gap:10px;color:var(--text-color);text-align:left;box-sizing:border-box;width:100%}',
        '.cs-lab{font-size:12px;color:var(--text-secondary);font-weight:500}',
        '.cs-lab.r{text-align:right;line-height:1.4;font-size:11px}',
        '.cs-det{font-size:12px;color:var(--text-secondary);line-height:1.5}',
        /* ── upload ── */
        '.cs-up-h{display:flex;align-items:center;gap:10px}',
        '.cs-up-h i.bi:first-child{font-size:1.2rem;color:var(--primary-color)}',
        '.cs-up-h b{flex:1;font-size:14px;font-weight:600}',
        '.cs-up-h small{font-size:11px;color:var(--text-secondary);border:1px solid var(--glass-border);border-radius:20px;padding:3px 10px}',
        '.cs-up-h small.req{color:var(--cs-warn);border-color:var(--cs-warn)}',
        '.cs-cnt{font-size:11px;color:var(--text-secondary)}',
        '.cs-files{display:flex;flex-direction:column;gap:6px}',
        '.cs-files:empty{display:none}',
        '.cs-file{display:flex;align-items:center;gap:8px;background:rgba(var(--primary-color-rgb),.08);border-radius:12px;padding:6px 6px 6px 10px;font-size:13px;min-width:0}',
        '.cs-file i.bi{color:var(--primary-color);font-size:1rem}',
        '.cs-file img{width:30px;height:30px;border-radius:7px;object-fit:cover;flex-shrink:0}',
        '.cs-file span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.cs-file-x{width:36px;height:36px;border:none;background:transparent;color:var(--text-secondary);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}',
        '.cs-ubtns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}',
        '.cs-ubtn{height:44px;border-radius:12px;border:1px solid var(--glass-border);background:transparent;color:var(--text-color);font:500 13px "Poppins",sans-serif;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer}',
        '.cs-ubtn:active{background:rgba(var(--primary-color-rgb),.15)}',
        '.cs-up-status{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary)}',
        '.cs-up-status i{color:var(--primary-color);animation:cs-spin .8s linear infinite}',
        '@keyframes cs-spin{to{transform:rotate(360deg)}}',
        /* ── botoes ── */
        '.cs-btn{min-height:48px;border-radius:14px;border:none;font:700 14px "Poppins",sans-serif;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;padding:0 16px;width:100%;-webkit-tap-highlight-color:transparent}',
        '.cs-btn:active{transform:scale(.98)}',
        '.cs-btn:disabled{opacity:.4;cursor:not-allowed;transform:none}',
        '.cs-btn-pri{background:var(--primary-color);color:#0d1f15}',
        '.cs-btn-big{min-height:56px;border-radius:16px;font-size:16px}',
        '.cs-btn-sec{background:transparent;border:1px solid var(--glass-border);color:var(--text-secondary);font-weight:600;font-size:13px}',
        '.cs-btn-ghost{background:transparent;border:1px solid rgba(var(--primary-color-rgb),.6);color:var(--primary-color);font-weight:600}',
        '.cs-btn-sm{min-height:44px;width:auto;font-size:13px}',
        '.cs-hint{font-size:12px;color:var(--text-secondary);text-align:center;line-height:1.5;margin:0}',
        '.cs-novaform{min-height:56px;border-radius:16px;border:1px dashed rgba(var(--primary-color-rgb),.5);background:transparent;color:var(--primary-color);font:600 14px "Poppins",sans-serif;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;width:100%}',
        '.cs-link{background:none;border:none;font:500 13px "Poppins",sans-serif;min-height:44px;padding:0 6px;cursor:pointer;color:var(--text-secondary)}',
        '.cs-link.bad{color:var(--cs-bad)}',
        /* ── listas: em andamento / prontas ── */
        '.cs-sec-h{display:flex;align-items:center;justify-content:space-between;font-size:15px;font-weight:600;margin-top:4px}',
        '.cs-sec-h em{font-style:normal;font-size:12px;color:var(--text-secondary);font-weight:400}',
        '.cs-job{gap:12px}',
        '.cs-job.run{border-color:rgba(var(--primary-color-rgb),.35)}',
        '.cs-job.warn{border-color:var(--cs-warn)}',
        '.cs-job.bad{border-color:var(--cs-bad)}',
        '.cs-job-top{display:flex;align-items:flex-start;gap:10px}',
        '.cs-job-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
        '.cs-job-nome{font-size:15px;font-weight:600;line-height:1.3;overflow:hidden;text-overflow:ellipsis}',
        '.cs-job-sub{font-size:12px;color:var(--text-secondary);line-height:1.4}',
        '.cs-job-sub.ok{color:var(--cs-ok)}.cs-job-sub.warn{color:var(--cs-warn)}.cs-job-sub.bad{color:var(--cs-bad)}',
        '.cs-job-pct{font-size:13px;font-weight:600;color:var(--primary-color)}',
        '.cs-bar{height:6px;border-radius:6px;background:rgba(148,151,160,.2);overflow:hidden}',
        '.cs-bar div{height:100%;background:var(--primary-color);border-radius:6px;transition:width .4s ease}',
        '.cs-steps{display:flex;flex-direction:column;gap:8px;font-size:13px}',
        '.cs-step{display:flex;align-items:center;gap:10px;color:var(--text-secondary);opacity:.7}',
        '.cs-step.done{opacity:1}.cs-step.done i{color:var(--primary-color)}',
        '.cs-step.on{opacity:1;color:var(--text-color);font-weight:500}.cs-step.on i{color:var(--primary-color);animation:cs-spin 1s linear infinite}',
        '.cs-job-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid var(--glass-border);padding-top:8px}',
        '.cs-job-erro{display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:1.5;color:var(--cs-bad)}',
        '.cs-pronta{flex-direction:row;align-items:center;gap:12px;cursor:pointer;font-family:"Poppins",sans-serif}',
        '.cs-pronta:active{transform:scale(.99)}',
        '.cs-ring-sm{width:48px;height:48px;border-radius:50%;border:3px solid;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;flex-shrink:0}',
        '.cs-ring-sm.ok{border-color:var(--cs-ok);color:var(--cs-ok)}.cs-ring-sm.warn{border-color:var(--cs-warn);color:var(--cs-warn)}.cs-ring-sm.bad{border-color:var(--cs-bad);color:var(--cs-bad)}',
        '.cs-tag-nova{font-size:11px;font-weight:600;background:var(--primary-color);color:#0d1f15;border-radius:20px;padding:3px 10px}',
        '.cs-chev{color:var(--text-secondary)}',
        /* ── resultado ── */
        '.cs-hero{border-radius:22px;padding:16px;display:flex;align-items:center;gap:16px;border:1px solid}',
        '.cs-hero.ok{background:rgba(var(--primary-color-rgb),.12);border-color:rgba(var(--primary-color-rgb),.45)}',
        '.cs-hero.warn{background:rgba(233,180,76,.1);border-color:var(--cs-warn)}',
        '.cs-hero.bad{background:rgba(239,107,107,.1);border-color:var(--cs-bad)}',
        '.cs-ring{position:relative;width:96px;height:96px;flex-shrink:0}',
        '.cs-ring svg circle{fill:none;stroke-width:9}.cs-ring .trk{stroke:rgba(148,151,160,.25)}.cs-ring .val{stroke-linecap:round}',
        '.cs-hero.ok .val{stroke:var(--cs-ok)}.cs-hero.warn .val{stroke:var(--cs-warn)}.cs-hero.bad .val{stroke:var(--cs-bad)}',
        '.cs-ring-in{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}',
        '.cs-ring-in b{font-size:30px;line-height:1;font-weight:700}',
        '.cs-ring-in small{font-size:9px;font-weight:600;letter-spacing:.05em;color:var(--text-secondary);margin-top:2px}',
        '.cs-hero.ok .cs-ring-in b{color:var(--cs-ok)}.cs-hero.warn .cs-ring-in b{color:var(--cs-warn)}.cs-hero.bad .cs-ring-in b{color:var(--cs-bad)}',
        '.cs-hero-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}',
        '.cs-hero-nome{font-size:17px;font-weight:700;line-height:1.25;overflow-wrap:anywhere}',
        '.cs-pill{display:inline-flex;align-self:flex-start;align-items:center;gap:6px;font-size:12px;font-weight:700;border-radius:20px;padding:5px 12px;color:#0d1f15}',
        '.cs-pill.ok{background:var(--cs-ok)}.cs-pill.warn{background:var(--cs-warn)}.cs-pill.bad{background:var(--cs-bad)}',
        '.cs-alert{display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:1.5;border-radius:12px;padding:10px 12px;border:1px solid;color:var(--cs-warn);background:rgba(233,180,76,.1);border-color:rgba(233,180,76,.4)}',
        '.cs-alert.soft{background:transparent;opacity:.85}',
        '.cs-renda{gap:4px}.cs-renda strong{font-size:26px;line-height:1.2;font-weight:700}',
        '.cs-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
        '.cs-ind{padding:12px 14px;gap:2px;border-radius:16px}.cs-ind b{font-size:18px;font-weight:700}',
        'b.ok{color:var(--cs-ok)}b.warn{color:var(--cs-warn)}b.bad{color:var(--cs-bad)}',
        '.cs-conf{flex-direction:row;align-items:center;gap:12px;border-style:dashed;border-color:rgba(var(--primary-color-rgb),.5)}',
        '.cs-conf>div{flex:1;min-width:0}.cs-conf strong{display:block;font-size:20px;font-weight:700;margin-top:2px;color:var(--primary-color)}',
        '.cs-parecer p{margin:0;font-size:14px;line-height:1.6}.cs-parecer p.lead{font-weight:600;margin-bottom:6px}',
        '.cs-motivos{border-color:var(--cs-bad);background:rgba(239,107,107,.08)}.cs-motivos p{margin:0;font-size:14px;line-height:1.6}',
        '.cs-detalhe{background:var(--card-bg);border:1px solid var(--glass-border);border-radius:16px;overflow:hidden}',
        '.cs-detalhe summary{min-height:52px;padding:0 16px;display:flex;align-items:center;justify-content:space-between;font:500 14px "Poppins",sans-serif;cursor:pointer;list-style:none}',
        '.cs-detalhe summary::-webkit-details-marker{display:none}',
        '.cs-detalhe summary i{color:var(--text-secondary);transition:transform .2s}.cs-detalhe[open] summary i{transform:rotate(180deg)}',
        '.cs-detalhe-in{padding:0 16px 14px;font-size:13px;line-height:1.6;color:var(--text-color);text-align:left}',
        '.cs-detalhe-in h4{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--primary-color);margin:12px 0 4px;text-align:left}',
        '.cs-detalhe-in p{margin:0}.cs-detalhe-in p.mono{font-size:12px;color:var(--text-secondary)}',
        /* ── calcular aparelho ── */
        '.cs-calc-toggle{min-height:72px;border-radius:18px;border:none;background:var(--primary-color);color:#0d1f15;padding:12px 16px;display:flex;align-items:center;gap:12px;text-align:left;font-family:"Poppins",sans-serif;cursor:pointer;width:100%}',
        '.cs-calc-toggle>i:first-child{font-size:1.6rem}',
        '.cs-calc-toggle span{flex:1;min-width:0;display:flex;flex-direction:column}',
        '.cs-calc-toggle b{font-size:15px;font-weight:700}.cs-calc-toggle small{font-size:12px;opacity:.8;margin-top:2px}',
        '.cs-calc-toggle .cs-chev{color:#0d1f15;transition:transform .2s}.cs-calc-toggle.open .cs-chev{transform:rotate(180deg)}',
        '.cs-calc{display:none;flex-direction:column;gap:12px}.cs-calc.open{display:flex}',
        '#cs_calc_out{display:flex;flex-direction:column;gap:12px}#cs_calc_out:empty{display:none}',
        '.cs-field{display:flex;flex-direction:column;gap:6px;min-width:0}',
        '.cs-field label{font-size:12px;font-weight:500;color:var(--text-secondary)}.cs-field label em{font-style:normal;opacity:.7}',
        '.cs-in{height:48px;border-radius:12px;border:1px solid var(--input-border);background:var(--input-bg);color:var(--text-color);padding:0 12px;font:500 15px "Poppins",sans-serif;outline:none;box-sizing:border-box;width:100%;min-width:0}',
        '.cs-in:focus{border-color:var(--primary-color)}',
        'select.cs-in{appearance:none;-webkit-appearance:none}',
        '.cs-err{font-size:12px;color:var(--cs-bad);min-height:0}.cs-err:empty{display:none}',
        '.cs-grid3{display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:8px}',
        '.cs-plano{display:flex;align-items:center;gap:10px;padding:13px 16px;border-radius:14px;font-size:14px;font-weight:800;border:1.5px solid}',
        '.cs-plano.ok{color:var(--cs-ok);border-color:rgba(var(--primary-color-rgb),.5);background:rgba(var(--primary-color-rgb),.1)}',
        '.cs-plano.warn{color:var(--cs-warn);border-color:var(--cs-warn);background:rgba(233,180,76,.1)}',
        '.cs-plano.info{color:var(--cs-info);border-color:var(--cs-info);background:rgba(111,168,220,.1)}',
        '.cs-nota-b{display:block;font-size:14px;line-height:1.6}',
        '.cs-lock{display:flex;align-items:center;gap:8px;font-size:12px;border-radius:12px;padding:8px 12px;color:var(--cs-warn);background:rgba(233,180,76,.1);border:1px solid rgba(233,180,76,.35)}',
        '.cs-sim-res{display:flex;align-items:flex-end;justify-content:space-between;gap:10px}',
        '.cs-sim-res strong{display:block;font-size:26px;line-height:1.15;font-weight:700;color:var(--primary-color)}',
        '.cs-sim-res .r{text-align:right}.cs-sim-res b{display:block;font-size:16px;font-weight:600}',
        '.cs-wpp{background:rgba(var(--primary-color-rgb),.08);border:1px solid rgba(var(--primary-color-rgb),.3);border-radius:20px;padding:14px;display:flex;flex-direction:column;gap:10px}',
        '.cs-wpp-lbl{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--primary-color);display:flex;align-items:center;gap:6px}',
        '.cs-wpp-txt{background:rgba(0,0,0,.18);border-radius:14px;padding:12px 14px;font-size:14px;line-height:1.65;cursor:pointer;overflow-wrap:anywhere;color:var(--text-color)}',
        '[data-theme="light"] .cs-wpp-txt{background:rgba(0,0,0,.05)}',
        /* ── avisos (banner) ── */
        '#cs_banners{position:fixed;left:12px;right:12px;top:calc(10px + env(safe-area-inset-top,0px));z-index:9000;display:flex;flex-direction:column;gap:8px;pointer-events:none;font-family:"Poppins",sans-serif}',
        '.cs-banner{pointer-events:auto;background:var(--card-bg);border:1px solid rgba(var(--primary-color-rgb),.55);border-radius:20px;padding:14px;display:flex;flex-direction:column;gap:12px;color:var(--text-color);animation:cs-in .25s ease-out}',
        '.cs-banner.bad{border-color:var(--cs-bad)}.cs-banner.warn{border-color:var(--cs-warn)}',
        '@keyframes cs-in{from{transform:translateY(-14px);opacity:0}to{transform:none;opacity:1}}',
        '.cs-banner-top{display:flex;align-items:flex-start;gap:12px}',
        '.cs-banner-ico{width:40px;height:40px;border-radius:50%;background:var(--primary-color);color:#0d1f15;display:flex;align-items:center;justify-content:center;font-size:1.25rem;flex-shrink:0}',
        '.cs-banner.bad .cs-banner-ico{background:var(--cs-bad)}.cs-banner.warn .cs-banner-ico{background:var(--cs-warn)}',
        '.cs-banner-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
        '.cs-banner-txt strong{font-size:15px}.cs-banner-txt span{font-size:13px;color:var(--text-secondary);line-height:1.4;overflow-wrap:anywhere}',
        '.cs-banner-x{width:44px;height:44px;margin:-8px -8px 0 0;border:none;background:transparent;color:var(--text-secondary);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}',
        '.cs-card-badge{position:absolute;top:8px;right:8px;min-width:20px;height:20px;border-radius:10px;background:#ef4444;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px;border:2px solid var(--card-bg)}',
        '#goCS2{position:relative}',
        /* ── modais ── */
        '.cs-modal{position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:"Poppins",sans-serif}',
        '.cs-modal-box{background:var(--card-bg);border:1px solid var(--glass-border);border-radius:20px;width:100%;max-width:380px;padding:22px;display:flex;flex-direction:column;gap:14px;color:var(--text-color)}',
        '.cs-modal-ttl{font-size:17px;font-weight:700;display:flex;align-items:center;gap:8px}.cs-modal-ttl i{color:var(--cs-warn)}',
        '.cs-modal-txt{font-size:14px;color:var(--text-secondary);line-height:1.5}',
        '.cs-modal-prev{padding:12px;border-radius:10px;background:rgba(148,151,160,.1);border-left:4px solid var(--cs-bad);display:flex;flex-direction:column;gap:2px}',
        '.cs-modal-prev.ok{border-left-color:var(--cs-ok)}.cs-modal-prev span{font-size:11px;text-transform:uppercase;font-weight:700;color:var(--text-secondary)}.cs-modal-prev strong{font-size:15px}',
        /* ── historico ── */
        '.cs-hist-empty,.cs-hist-load{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:60px 20px;color:var(--text-secondary);font-size:14px;text-align:center}',
        '.cs-hist-empty i,.cs-hist-load i{font-size:2.4rem;opacity:.4}',
        '.cs-pchip{flex-shrink:0;min-height:36px;padding:0 14px;border-radius:99px;border:1px solid var(--glass-border);background:var(--card-bg);color:var(--text-secondary);font:600 12px "Poppins",sans-serif;cursor:pointer;white-space:nowrap}',
        '.cs-pchip-ativo{border-color:var(--primary-color)!important;background:rgba(var(--primary-color-rgb),.18)!important;color:var(--primary-color)!important}',
        '.cs-hitem2{border:1px solid var(--glass-border);border-radius:14px;padding:11px 12px;background:var(--card-bg)}',
        '.cs-htags{display:flex;flex-wrap:wrap;gap:5px}',
        '.cs-htag{background:rgba(148,151,160,.12);border:1px solid var(--glass-border);border-radius:99px;padding:3px 10px;font-size:11px}',
        '.cs-btn-reuso{width:100%;min-height:44px;border-radius:10px;border:1px solid rgba(var(--primary-color-rgb),.4);background:rgba(var(--primary-color-rgb),.08);color:var(--primary-color);font:700 12px "Poppins",sans-serif;cursor:pointer;margin-top:8px;display:flex;align-items:center;justify-content:center;gap:6px}',
        '.cs-btn-reuso:active{background:rgba(var(--primary-color-rgb),.2)}',
        '#cs_hist_search{width:100%;box-sizing:border-box;background:var(--input-bg);border:1px solid var(--input-border);border-radius:12px;min-height:44px;padding:0 12px 0 34px;color:var(--text-color);font:500 13px "Poppins",sans-serif;outline:none}',
        '#cs_hist_search::placeholder{color:var(--text-secondary)}',
        /* ── configuracoes ── */
        '.cs-cfg-info{margin-top:16px;padding:12px;background:var(--card-bg);border:1px solid var(--glass-border);border-radius:12px}',
        '.cs-tabs{display:flex;gap:8px;align-items:center}',
        '.cs-tab{min-height:44px;padding:0 18px;border-radius:99px;border:1px solid var(--glass-border);background:var(--card-bg);color:var(--text-secondary);font:600 13px "Poppins",sans-serif;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px}',
        '.cs-tab.on{background:var(--primary-grad);color:var(--on-primary);border-color:transparent}',
        '.cs-tab.ico{width:44px;padding:0;font-size:16px}',
        /* ── aparelhos liberados (resultado) ── */
        '.cs-ap{padding:0;gap:0;overflow:hidden}',
        '.cs-ap-toggle{width:100%;min-height:68px;border:0;background:transparent;color:var(--text-color);display:flex;align-items:center;gap:12px;padding:12px 16px;text-align:left;font-family:"Poppins",sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent}',
        '.cs-ap-ico{width:42px;height:42px;border-radius:13px;flex:none;display:flex;align-items:center;justify-content:center;font-size:1.25rem;background:rgba(233,180,76,.14);color:var(--cs-warn)}',
        '.cs-ap-tt{flex:1;min-width:0;display:flex;flex-direction:column}.cs-ap-tt b{font-size:15px;font-weight:700}',
        '.cs-ap-tt small{font-size:12px;color:var(--text-secondary);margin-top:2px;line-height:1.35}',
        '.cs-ap .cs-chev{color:var(--text-secondary);transition:transform .2s;flex:none}.cs-ap.open .cs-chev{transform:rotate(180deg)}',
        '.cs-ap.open .cs-ap-toggle{border-bottom:1px solid var(--glass-border)}',
        '.cs-ap-body{display:flex;flex-direction:column;gap:12px;padding:12px 16px 16px}',
        '.cs-ap-foot .cs-link{display:inline;min-height:0;padding:8px 4px;color:var(--primary-color);font-size:11.5px;text-decoration:underline}',
        '.cs-ap-list{display:flex;flex-direction:column}',
        '.cs-ap-row{display:flex;align-items:center;gap:12px;padding:10px 0;border:0;border-top:1px solid var(--glass-border);background:none;width:100%;text-align:left;color:var(--text-color);font-family:"Poppins",sans-serif;cursor:pointer}',
        '.cs-ap-row:first-child{border-top:0}',
        '.cs-ap-ck{width:24px;height:24px;border-radius:8px;border:1.5px solid var(--text-secondary);display:flex;align-items:center;justify-content:center;flex:none;color:transparent;font-size:14px}',
        '.cs-ap-row.on .cs-ap-ck{background:var(--primary-grad);border-color:transparent;color:var(--on-primary)}',
        '.cs-ap-nm{flex:1;min-width:0;font-weight:600;font-size:14px;line-height:1.3;overflow-wrap:anywhere}',
        '.cs-ap-sub{display:block;font-size:12px;font-weight:400;color:var(--text-secondary);margin-top:2px}',
        '.cs-ap-sub .w{color:var(--cs-warn)}',
        '.cs-ap-par{flex:none;text-align:right;font-weight:700;font-size:14px;color:var(--primary-color)}',
        '.cs-ap-note{display:flex;gap:10px;align-items:center;font-size:12px;line-height:1.45;color:var(--text-secondary);background:var(--input-bg);border-radius:12px;padding:10px 12px}',
        '.cs-ap-note i{font-size:15px;flex:none}',
        '.cs-ap-btns{display:flex;gap:8px}.cs-ap-btns .cs-btn{flex:1;white-space:nowrap}',
        '.cs-ap-btns .cs-btn:disabled{opacity:.45}',
        '.cs-ap-foot{text-align:center;font-size:11.5px;color:var(--text-secondary)}',
        /* ── aparelhos liberados (configuracoes) ── */
        '.cs-apc-faixa{display:flex;justify-content:space-between;align-items:center;margin:8px 2px 0;font-size:13px;font-weight:700;text-align:left}',
        '.cs-apc-faixa span{font-weight:400;font-size:11.5px;color:var(--text-secondary)}',
        '.cs-apc-it{display:flex;align-items:center;gap:8px;background:var(--card-bg);border:1px solid var(--glass-border);border-radius:14px;padding:10px 10px 10px 12px;text-align:left}',
        '.cs-apc-it.off .cs-ap-nm{opacity:.5}',
        '.cs-apc-ib{width:36px;height:36px;border-radius:50%;border:0;background:var(--input-bg);color:var(--text-secondary);display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer;flex:none}',
        '.cs-apc-ib.d{color:var(--cs-bad)}.cs-apc-ib.d.arm{background:var(--cs-bad);color:#fff;width:auto;border-radius:18px;padding:0 12px;font:700 12px "Poppins",sans-serif}',
        '.cs-apc-bar{display:flex;gap:8px}.cs-apc-bar .cs-btn{flex:1}',
        '.cs-apc-res{font-size:13px;line-height:1.5;text-align:left}.cs-apc-res .ok{color:var(--cs-ok)}.cs-apc-res .bad{color:var(--cs-bad)}'
        ].join('');
        document.head.appendChild(s);
    }

    function injectHTML(){
        if(el('cs_ov'))return;
        function slot(id, cls, html){ var o=document.createElement('div'); o.id=id; o.className='cs-scope'; o.innerHTML=html; document.body.appendChild(o); return o; }

        // ── Tela inicial ──
        slot('cs_ov','',
        '<div class="cs-hdr">'+
            '<button type="button" class="cs-back" id="cs_close" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>'+
            '<div style="flex:1;min-width:0"><div class="cs-hdr-ttl">CreditoScan</div><div class="cs-hdr-sub">Análise de crédito</div></div>'+
            '<button type="button" class="cs-hbtn" id="cs_hist_open"><i class="bi bi-clock-history"></i> Histórico</button>'+
            '<button type="button" class="cs-ibtn" id="cs_cfg_open" aria-label="Configurações"><i class="bi bi-gear-fill"></i></button>'+
        '</div>'+
        '<div class="cs-body">'+
            '<button type="button" class="cs-novaform cs-h" id="cs_btn_novaform"><i class="bi bi-plus-lg"></i> Nova análise</button>'+
            '<div id="cs_form" style="display:flex;flex-direction:column;gap:14px">'+
                '<div class="cs-intro"><h2>Nova análise</h2><p>Envie os documentos do cliente. Produto e valor ficam para depois.</p></div>'+
                '<div class="cs-card">'+
                    '<div class="cs-up-h"><i class="bi bi-person-vcard"></i><b>RG ou CNH</b><span class="cs-cnt" id="cs_counter_id"></span><small>Opcional</small></div>'+
                    '<div class="cs-files" id="cs_docs_id"></div>'+
                    '<div class="cs-ubtns"><button type="button" class="cs-ubtn" id="cs_id_cam"><i class="bi bi-camera"></i> Câmera</button><button type="button" class="cs-ubtn" id="cs_id_gal"><i class="bi bi-image"></i> Galeria</button><button type="button" class="cs-ubtn" id="cs_id_pdf"><i class="bi bi-file-earmark-pdf"></i> PDF</button></div>'+
                '</div>'+
                '<div class="cs-card">'+
                    '<div class="cs-up-h"><i class="bi bi-file-earmark-text"></i><b>Comprovante de renda</b><small class="req">Obrigatório</small></div>'+
                    '<div class="cs-files" id="cs_docs_rend"></div>'+
                    '<div class="cs-ubtns"><button type="button" class="cs-ubtn" id="cs_rend_cam"><i class="bi bi-camera"></i> Câmera</button><button type="button" class="cs-ubtn" id="cs_rend_gal"><i class="bi bi-image"></i> Galeria</button><button type="button" class="cs-ubtn" id="cs_rend_pdf"><i class="bi bi-file-earmark-pdf"></i> PDF</button></div>'+
                    '<div class="cs-hint" style="margin-top:-2px">Extratos e holerites. PDF digital é detectado automaticamente.</div>'+
                '</div>'+
                '<div class="cs-up-status cs-h" id="cs_up_status"><i class="bi bi-arrow-repeat"></i><span id="cs_up_status_txt">Lendo arquivos...</span></div>'+
                '<div style="display:flex;flex-direction:column;gap:8px">'+
                    '<button type="button" class="cs-btn cs-btn-pri cs-btn-big" id="cs_btn_analisar" disabled><i class="bi bi-check2-circle"></i> Analisar crédito</button>'+
                    '<p class="cs-hint" id="cs_hint_analisar">Adicione ao menos um comprovante de renda.</p>'+
                '</div>'+
            '</div>'+
            '<div id="cs_lista" style="display:flex;flex-direction:column;gap:10px"></div>'+
        '</div>');

        // ── Resultado ──
        slot('cs_res_ov','',
        '<div class="cs-hdr">'+
            '<button type="button" class="cs-back" id="cs_res_close" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>'+
            '<div style="flex:1;min-width:0"><div class="cs-hdr-ttl">Resultado</div><div class="cs-hdr-sub" id="cs_res_sub"></div></div>'+
        '</div>'+
        '<div class="cs-body" id="cs_res_body"></div>');

        // ── Historico ──
        slot('cs_hist_ov','',
        '<div class="cs-hhdr"><button type="button" class="cs-back" id="cs_hist_close" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button><div style="flex:1"><span class="cs-hhdr-ttl">Histórico</span><div class="cs-hhdr-sub">Relatório de análises</div></div></div>'+
        '<div style="padding:0 13px 8px;overflow-x:auto;display:flex;gap:6px;flex-shrink:0;scrollbar-width:none" id="cs_period_row">'+
          '<button class="cs-pchip" data-days="1">Hoje</button>'+
          '<button class="cs-pchip" data-days="7">7 dias</button>'+
          '<button class="cs-pchip cs-pchip-ativo" data-days="30">30 dias</button>'+
          '<button class="cs-pchip" data-days="90">3 meses</button>'+
          '<button class="cs-pchip" data-days="180">6 meses</button>'+
          '<button class="cs-pchip" data-days="365">1 ano</button>'+
        '</div>'+
        '<div class="cs-hbody" id="cs_hist_list"></div>');

        // ── Configuracoes ──
        slot('cs_cfg_ov','',
        '<div class="cs-hhdr"><button type="button" class="cs-back" id="cs_cfg_close" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button><div style="flex:1"><span class="cs-hhdr-ttl">Configurações</span><div class="cs-hhdr-sub">Aparelhos liberados por renda</div></div></div>'+
        '<div class="cs-hbody" style="padding-top:8px;padding-left:16px;padding-right:16px;gap:14px">'+
            '<div class="cs-tabs">'+
                '<button type="button" class="cs-tab on" data-cfgtab="ap"><i class="bi bi-apple"></i> Aparelhos</button>'+
                '<button type="button" class="cs-tab ico" data-cfgtab="key" aria-label="Chave da IA"><i class="bi bi-key-fill"></i></button>'+
            '</div>'+
            '<div id="cs_cfg_p_ap" style="display:flex;flex-direction:column;gap:12px">'+
                '<div class="cs-apc-bar"><button type="button" class="cs-btn cs-btn-ghost" data-ap="abrir-colar"><i class="bi bi-clipboard-plus"></i> Colar lista</button><button type="button" class="cs-btn cs-btn-ghost" data-ap="novo"><i class="bi bi-plus-lg"></i> Adicionar</button></div>'+
                '<div class="cs-card" id="cs_ap_pastecard" style="display:none">'+
                    '<div class="cs-up-h"><i class="bi bi-clipboard-plus"></i><b>Colar lista do WhatsApp</b></div>'+
                    '<p class="cs-hint" style="text-align:left">Cole a lista como você já escreve: a faixa de renda (ex.: Renda de 2 Mil a 3 Mil) e, para cada aparelho, o modelo, a entrada e as parcelas.</p>'+
                    '<textarea id="cs_ap_paste" class="cs-in" style="height:140px;padding:10px 12px;resize:none;line-height:1.4" placeholder="Renda de 2 Mil a 3 Mil&#10;iPhone 11 – 64GB&#10;Entrada de R$ 299,00&#10;+ 12x de R$ 129,90" autocomplete="off"></textarea>'+
                    '<div id="cs_ap_pasteres" class="cs-apc-res"></div>'+
                    '<button type="button" class="cs-btn cs-btn-pri" data-ap="ler">Ler lista</button>'+
                '</div>'+
                '<div class="cs-card" id="cs_ap_edit" style="display:none">'+
                    '<div class="cs-up-h"><i class="bi bi-pencil"></i><b id="cs_ap_edit_t">Aparelho</b></div>'+
                    '<div class="cs-field"><label for="cs_ap_f_nome">Modelo</label><input id="cs_ap_f_nome" class="cs-in" type="text" maxlength="70" placeholder="Ex: iPhone 13 – 128GB" autocomplete="off"></div>'+
                    '<div class="cs-grid2">'+
                        '<div class="cs-field"><label for="cs_ap_f_ent">Entrada (R$)</label><input id="cs_ap_f_ent" class="cs-in" type="text" inputmode="decimal" placeholder="799,00" autocomplete="off"></div>'+
                        '<div class="cs-field"><label for="cs_ap_f_par">Parcela (R$)</label><input id="cs_ap_f_par" class="cs-in" type="text" inputmode="decimal" placeholder="199,90" autocomplete="off"></div>'+
                        '<div class="cs-field"><label for="cs_ap_f_np">Nº de parcelas</label><input id="cs_ap_f_np" class="cs-in" type="text" inputmode="numeric" value="12" autocomplete="off"></div>'+
                        '<div class="cs-field"><label for="cs_ap_f_renda">Renda mínima (R$)</label><input id="cs_ap_f_renda" class="cs-in" type="text" inputmode="decimal" placeholder="2.000,00" autocomplete="off"></div>'+
                    '</div>'+
                    '<div class="cs-err" id="cs_ap_err"></div>'+
                    '<div class="cs-apc-bar"><button type="button" class="cs-btn cs-btn-sec" data-ap="cancelar">Cancelar</button><button type="button" class="cs-btn cs-btn-pri" data-ap="salvar"><i class="bi bi-check-lg"></i> Salvar</button></div>'+
                '</div>'+
                '<div class="cs-err" id="cs_ap_errtop"></div>'+
                '<div id="cs_ap_list" style="display:flex;flex-direction:column;gap:8px"></div>'+
            '</div>'+
            '<div id="cs_cfg_p_key" class="cs-card" style="display:none">'+
                '<div class="cs-up-h"><i class="bi bi-key-fill"></i><b>Chave da IA (OpenRouter)</b></div>'+
                '<p class="cs-hint" style="text-align:left">Cole sua API Key do <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener" style="color:var(--primary-color)">openrouter.ai</a></p>'+
                '<input type="password" class="cs-in" id="cs_cfg_key" placeholder="sk-or-v1-..." style="font-size:13px" autocomplete="off">'+
                '<button type="button" class="cs-btn cs-btn-pri" id="cs_cfg_save">Salvar</button>'+
                '<div id="cs_cfg_status" style="font-size:12px;text-align:center;min-height:18px"></div>'+
                '<div class="cs-cfg-info"><div class="cs-lab" style="margin-bottom:6px">Status da chave</div><div id="cs_cfg_info" style="font-size:13px">Verificando...</div></div>'+
            '</div>'+
        '</div>');
    }
    function injectMenuBtns(){
        var goCS2=el('goCS2');
        if(goCS2&&!goCS2._csListenerOk){goCS2.addEventListener('click',openOverlay);goCS2._csListenerOk=true;}
    }

    function wireEvents(){
        var on=function(id,ev,fn){var n=el(id);n&&n.addEventListener(ev,fn);};
        on('cs_close','click',closeOverlay);
        on('cs_hist_open','click',abrirHist);
        on('cs_hist_close','click',function(){el('cs_hist_ov')&&el('cs_hist_ov').classList.remove('active');});
        on('cs_res_close','click',fecharResultado);
        on('cs_id_cam','click',function(){uploadId(true);});
        on('cs_id_gal','click',function(){uploadId();});
        // Galeria e PDF abrem o seletor do Android que pergunta o app (Arquivos, Pasta Segura da Samsung...)
        on('cs_id_pdf','click',function(){uploadId();});
        on('cs_rend_cam','click',function(){uploadRend('image/*',true);});
        on('cs_rend_gal','click',function(){uploadRend('image/*,application/pdf');});
        on('cs_rend_pdf','click',function(){uploadRend('image/*,application/pdf');});
        on('cs_btn_analisar','click',iniciarAnalise);
        on('cs_btn_novaform','click',function(){_formAberto=true;aplicarForm();});
        on('cs_form','click',function(e){var x=e.target.closest('.cs-file-x');if(x)removerArquivo(x.getAttribute('data-t'),x.getAttribute('data-aid'));});
        on('cs_lista','click',acaoLista);
        // Resultado: botoes e simulador (delegado — o conteudo e refeito a cada abertura)
        var rb=el('cs_res_body');
        if(rb){
            rb.addEventListener('click',acaoResultado);
            rb.addEventListener('input',function(e){if(e.target.id==='cs_en')atualizarSim(false);});
            rb.addEventListener('change',function(e){if(e.target.id==='cs_en'||e.target.id==='cs_np'||e.target.id==='cs_tx')atualizarSim(true);});
            rb.addEventListener('focusout',function(e){if(e.target.id==='cs_en'||e.target.id==='cs_tx')atualizarSim(true);});
            rb.addEventListener('keydown',function(e){if(e.key==='Enter'&&(e.target.id==='cs_c_val'||e.target.id==='cs_c_prod')){e.preventDefault();e.target.blur();calcular();}});
        }
        // Config
        on('cs_cfg_open','click',abrirConfig);
        on('cs_cfg_close','click',function(){el('cs_cfg_ov')&&el('cs_cfg_ov').classList.remove('active');});
        on('cs_cfg_save','click',salvarConfig);
        // Menu inferior do app: Inicio, Taxas, Docs e Mais fecham o CreditoScan (as analises seguem rodando)
        var nav=el('ctwBottomNav');
        if(nav)nav.addEventListener('click',function(e){var b=e.target.closest('.ui-nav-it');if(b)fecharTudo();},true);
    }
    function abrirConfig(tab){
        var ov=el('cs_cfg_ov');if(!ov)return;
        ov.classList.add('active');apTab(tab==='key'?'key':'ap');apCfgRender();apCarregar(true).then(apCfgRender);
        var inp=el('cs_cfg_key');
        var info=el('cs_cfg_info');
        var status=el('cs_cfg_status');
        if(status) status.textContent='';
        // Mostra key atual mascarada
        var currentKey=safeGet(OR_KEY_LS)||'';
        if(inp) inp.value=currentKey;
        if(info){
            if(currentKey){
                var masked=currentKey.substring(0,12)+'...' +currentKey.substring(currentKey.length-4);
                info.innerHTML='<span style="color:var(--primary-color)">✅ Key configurada:</span> '+masked;
            } else {
                info.innerHTML='<span style="color:var(--cs-bad)">❌ Nenhuma key configurada</span>';
            }
        }
    }

    function salvarConfig(){
        var inp=el('cs_cfg_key');
        var status=el('cs_cfg_status');
        var info=el('cs_cfg_info');
        if(!inp)return;
        var key=inp.value.trim();
        if(!key){if(status) status.innerHTML='<span style="color:var(--cs-bad)">Cole a key primeiro</span>';return;}
        if(!key.startsWith('sk-')){if(status) status.innerHTML='<span style="color:var(--cs-bad)">Key invalida. Deve comecar com sk-</span>';return;}
        try{localStorage.setItem(OR_KEY_LS,key);}catch(e){}
        // Tenta salvar no Firebase tambem
        try{
            import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js').then(function(fb){
                var db=window._firebaseDB;if(!db)return;
                fb.set(fb.ref(db,'settings/openrouterKey'),key);
            }).catch(function(){});
        }catch(e){}
        if(status) status.innerHTML='<span style="color:var(--primary-color)">✅ Key salva com sucesso!</span>';
        if(info){
            var masked=key.substring(0,12)+'...'+key.substring(key.length-4);
            info.innerHTML='<span style="color:var(--primary-color)">✅ Key configurada:</span> '+masked;
        }
    }

    // ================================================================
    // APARELHOS LIBERADOS POR RENDA
    // Tabela unica (Firebase, igual para todos os perfis): modelo, entrada, parcelas e a renda minima
    // que libera cada aparelho. O resultado da analise mostra o que cabe na renda do cliente.
    // ================================================================
    var AP_PATH = 'settings/creditoscanAparelhos';   // itens/{id} + atualizadoEm
    var AP_LS   = 'ctwCsAparelhos';                  // copia local (abre sem rede)
    var _aps = null, _apsTs = 0, _apsQuando = 0;     // lista, data da ultima edicao, quando foi lida
    var _apsErro = false;
    var _apEdId = null, _apLido = null, _apArmDel = null, _apArmTimer = null;

    function apFB() {
        return import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js').then(function (fb) {
            var db = window._firebaseDB; if (!db) throw new Error('sem banco');
            return { fb: fb, db: db };
        });
    }

    // Valida um registro vindo do banco ou da lista colada; null = descartar
    function apNormalizar(id, v) {
        if (!v || typeof v !== 'object') return null;
        var nome = String(v.nome == null ? '' : v.nome).replace(/\s+/g, ' ').trim().slice(0, 70);
        var entrada = Number(v.entrada), parcela = Number(v.parcela), np = parseInt(v.parcelas, 10), rm = Number(v.rendaMin);
        if (!nome || !isFinite(entrada) || entrada < 0 || !isFinite(parcela) || parcela <= 0 ||
            !(np >= 1 && np <= 36) || !isFinite(rm) || rm < 0) return null;
        return { id: id, nome: nome, entrada: entrada, parcela: parcela, parcelas: np, rendaMin: rm, ativo: v.ativo !== false };
    }
    function apOrdenar(a) {
        a.sort(function (x, y) { return x.rendaMin - y.rendaMin || x.entrada - y.entrada || x.nome.localeCompare(y.nome); });
        return a;
    }
    function apGuardarLS() {
        try { localStorage.setItem(AP_LS, JSON.stringify({ itens: _aps || [], ts: _apsTs })); } catch (e) {}
    }
    function apLerLS() {
        try {
            var j = JSON.parse(localStorage.getItem(AP_LS) || 'null');
            if (!j || !Array.isArray(j.itens)) return null;
            var arr = []; j.itens.forEach(function (x) { var n = apNormalizar(x && x.id, x); if (n && n.id) arr.push(n); });
            return { itens: apOrdenar(arr), ts: Number(j.ts) || 0 };
        } catch (e) { return null; }
    }

    // Le a tabela. Sem rede ou sem banco usa a copia local; so devolve [] de verdade quando o banco respondeu vazio.
    function apCarregar(forcar) {
        if (!_aps) { var ls = apLerLS(); if (ls) { _aps = ls.itens; _apsTs = ls.ts; } }
        if (_aps && !forcar && Date.now() - _apsQuando < 60000) return Promise.resolve(_aps);
        return apFB().then(function (c) {
            return c.fb.get(c.fb.ref(c.db, AP_PATH)).then(function (snap) {
                var v = snap.val() || {}, it = v.itens || {}, arr = [];
                Object.keys(it).forEach(function (k) { var n = apNormalizar(k, it[k]); if (n) arr.push(n); });
                _aps = apOrdenar(arr); _apsTs = Number(v.atualizadoEm) || 0; _apsQuando = Date.now(); _apsErro = false;
                apGuardarLS();
                return _aps;
            });
        }).catch(function () { if (!_aps) _apsErro = true; return _aps || []; });
    }

    function apRs(v) { return R$(v).replace(',00', ''); }
    function apEhIphone(n) { return /iphone/i.test(n); }
    function apEmoji(n) { return apEhIphone(n) ? '🍎' : '📱'; }
    function apPrimeiroNome(n) {
        var p = String(n || '').trim().split(/\s+/)[0] || '';
        return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
    }
    function apRenda(job) { var r = job && job.dados ? Number(job.dados.rendaEstimada) : 0; return r > 0 ? r : 0; }
    function apLiberados(renda) { return (_aps || []).filter(function (a) { return a.ativo && a.rendaMin <= renda + 0.005; }); }
    function apBloqueados(renda) { return (_aps || []).filter(function (a) { return a.ativo && a.rendaMin > renda + 0.005; }); }
    function apSelecionados(job) {
        var sel = job.apSel || {};
        return apLiberados(apRenda(job)).filter(function (a) { return sel[a.id] !== false; });
    }

    // ── Mensagens para o cliente ──
    function apAbertura(job) {
        var nome = apPrimeiroNome(job.dados.nomeCliente || job.dados.nomeCompleto);
        return 'Olá' + (nome ? ' ' + nome : '') + ', tudo bem? 😊📲\n' +
            'Boa notícia: seu cadastro foi *APROVADO* aqui na Workcell! ✅\n\n';
    }
    function apMensagem(job) {
        var sel = apSelecionados(job); if (!sel.length) return '';
        var todos = sel.every(function (a) { return apEhIphone(a.nome); });
        var blocos = sel.map(function (a) {
            return apEmoji(a.nome) + ' *' + a.nome + '*\n' +
                '💰 Entrada de ' + R$(a.entrada) + ' à vista\n' +
                '💳 + ' + a.parcelas + 'x de ' + R$(a.parcela) + ' mensais no boleto';
        });
        return apAbertura(job) + 'Separei ' + (todos ? 'os iPhones' : 'os aparelhos') + ' que já estão liberados pra você 👇\n\n' +
            blocos.join('\n\n') + '\n\n' +
            '📌 *Como funciona:* a entrada é paga à vista e o restante vem em parcelas *mensais* no boleto.\n' +
            '✔ Aparelhos revisados e com garantia\n\n' +
            'Qual deles mais te agradou? Me fala aqui que eu já te passo os próximos passos 🤝🚀';
    }
    function apMensagemAndroid(job) {
        return apAbertura(job) +
            'Pro seu perfil temos ótimas opções de aparelhos Android 📱 com entrada à vista e parcelas mensais no boleto.\n\n' +
            'Me fala qual modelo ou valor você procura que eu já te passo as opções 🤝';
    }
    function apMensagemAtual(job) {
        var renda = apRenda(job);
        return apLiberados(renda).length ? apMensagem(job) : apMensagemAndroid(job);
    }

    // ── Aba "aparelhos liberados" no resultado (fechada por padrao; o primeiro botao da tela e o Calcular aparelho) ──
    function apHtmlCard(d) {
        if (d.reprovado || !(Number(d.rendaEstimada) > 0)) return '';
        return '<div class="cs-card cs-ap" id="cs_ap_box"></div>';
    }

    function apRenderBox(job) {
        var box = el('cs_ap_box'); if (!box || _view !== job) return;
        var renda = apRenda(job), teto = renda * tetoPct(job.dados.nota);
        if (!job.apSel) job.apSel = {};
        var aberto = !!job.apAberto;
        box.classList.toggle('open', aberto);
        var carregado = _aps !== null, lib = carregado ? apLiberados(renda) : [], bl = carregado ? apBloqueados(renda) : [];
        var titulo = (lib.length && !lib.every(function (a) { return apEhIphone(a.nome); })) ? 'Aparelhos liberados' : 'iPhones liberados';
        var sub = !carregado ? (_apsErro ? 'Sem conexão para ler a tabela' : 'Carregando a tabela...') :
            !_aps.length ? 'Tabela ainda não cadastrada' :
            lib.length ? lib.length + (lib.length > 1 ? ' modelos' : ' modelo') + ' para a renda de ' + apRs(renda) :
            'Nenhum libera para essa renda · ofereça Android';
        var h = '<button type="button" class="cs-ap-toggle" data-act="ap-toggle" aria-expanded="' + aberto + '">' +
            '<span class="cs-ap-ico"><i class="bi bi-apple"></i></span>' +
            '<span class="cs-ap-tt"><b>' + titulo + '</b><small>' + esc(sub) + '</small></span>' +
            '<i class="bi bi-chevron-down cs-chev"></i></button>';
        if (!aberto) { box.innerHTML = h; return; }

        h += '<div class="cs-ap-body">';
        if (!carregado) {
            h += '<p class="cs-hint" style="text-align:left">' + (_apsErro ? 'Sem conexão para ler a tabela de aparelhos.' : 'Carregando a tabela...') + '</p>';
        } else if (!_aps.length) {
            h += '<p class="cs-hint" style="text-align:left">Você ainda não cadastrou a tabela de aparelhos. Cadastre uma vez e o app mostra o que libera para a renda de cada cliente.</p>' +
                '<button type="button" class="cs-btn cs-btn-ghost" data-act="ap-cfg"><i class="bi bi-plus-lg"></i> Cadastrar tabela</button>';
        } else {
            lib.forEach(function (a) { if (!(a.id in job.apSel)) job.apSel[a.id] = true; });
            var sel = lib.filter(function (a) { return job.apSel[a.id] !== false; });
            if (lib.length) {
                h += '<div class="cs-ap-list">';
                lib.forEach(function (a) {
                    var alto = teto > 0 && a.parcela > teto + 0.005;
                    h += '<button type="button" class="cs-ap-row' + (job.apSel[a.id] !== false ? ' on' : '') + '" data-act="ap-sel" data-id="' + esc(a.id) + '" role="checkbox" aria-checked="' + (job.apSel[a.id] !== false) + '">' +
                        '<span class="cs-ap-ck"><i class="bi bi-check-lg"></i></span>' +
                        '<span class="cs-ap-nm">' + esc(a.nome) + '<span class="cs-ap-sub">Entrada ' + R$(a.entrada) + (alto ? ' · <span class="w">parcela acima do confortável</span>' : '') + '</span></span>' +
                        '<span class="cs-ap-par">' + a.parcelas + 'x ' + R$(a.parcela).replace('R$ ', '') + '</span></button>';
                });
                h += '</div>';
            } else {
                var menor = null; _aps.forEach(function (a) { if (a.ativo && (menor === null || a.rendaMin < menor)) menor = a.rendaMin; });
                h += '<div class="cs-ap-note"><i class="bi bi-phone"></i><span>Nenhum aparelho da tabela libera para a renda de ' + apRs(renda) + (menor !== null ? ' (a menor faixa começa em ' + apRs(menor) + ')' : '') + '. Ofereça opções <b>Android</b>.</span></div>';
            }
            if (bl.length) {
                var menorB = bl.reduce(function (m, a) { return Math.min(m, a.rendaMin); }, Infinity);
                h += '<div class="cs-ap-note"><i class="bi bi-lock-fill"></i><span><b>' + bl.length + (bl.length > 1 ? ' modelos pedem' : ' modelo pede') + '</b> renda maior (a partir de ' + apRs(menorB) + ').</span></div>';
            }
            var msg = lib.length ? apMensagem(job) : apMensagemAndroid(job);
            if (lib.length && !sel.length) h += '<p class="cs-hint" style="text-align:left">Marque ao menos um aparelho para montar a mensagem.</p>';
            else h += '<div class="cs-wpp-txt" style="cursor:default">' + blocoTexto(msg).replace(/\*([^*\n<]+)\*/g, '<b>$1</b>') + '</div>';
            var off = (lib.length && !sel.length) ? ' disabled' : '';
            h += '<div class="cs-ap-btns"><button type="button" class="cs-btn cs-btn-pri" data-act="ap-copy"' + off + '><i class="bi bi-clipboard"></i> Copiar mensagem</button>' +
                '<button type="button" class="cs-btn cs-btn-ghost" data-act="ap-wpp"' + off + '><i class="bi bi-whatsapp"></i> WhatsApp</button></div>';
            h += '<div class="cs-ap-foot">' + (_apsTs ? 'Tabela atualizada em ' + new Date(_apsTs).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' · ' : '') +
                (lib.length ? sel.length + ' selecionado' + (sel.length === 1 ? '' : 's') : 'sem iPhone liberado') +
                ' · <button type="button" class="cs-link" data-act="ap-cfg">editar tabela</button></div>';
        }
        box.innerHTML = h + '</div>';
    }

    // Chamado depois que o resultado foi desenhado
    function apIniciarCard(job) {
        if (!el('cs_ap_box')) return;
        apRenderBox(job);
        apCarregar(false).then(function () { apRenderBox(job); });
    }

    function apToggleAba(job) {
        job.apAberto = !job.apAberto;
        apRenderBox(job);
        if (job.apAberto) {          // abre e desce ate o card para ver a lista e a mensagem
            var box = el('cs_ap_box');
            if (box && box.scrollIntoView) setTimeout(function () { box.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30);
        }
    }
    function apToggleSel(job, id) {
        if (!job.apSel) job.apSel = {};
        job.apSel[id] = job.apSel[id] === false;
        apRenderBox(job);
    }
    function apAbrirWpp(job) {
        var msg = apMensagemAtual(job); if (!msg) return;
        window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
    }

    // ── Lista colada do WhatsApp ──
    // Reconhece faixas ("Renda de 2 Mil a 3 Mil", "Renda + 3 Mil") e blocos modelo / "Entrada de R$" / "+ 12x de R$".
    function apParseLista(txt) {
        var rendaMin = null, cur = null, itens = {}, incompletos = 0;
        var money = function (t) {
            var m = t.match(/R\$\s*([\d.,]+)/i) || t.match(/([\d][\d.,]*)/);
            return m ? numBR(m[1].replace(/[.,]+$/, '')) : NaN;
        };
        var fechar = function (parcelas, par) {
            if (cur && cur.entrada != null && isFinite(cur.entrada) && rendaMin != null) {
                var n = apNormalizar('', { nome: cur.nome, entrada: cur.entrada, parcela: par, parcelas: parcelas, rendaMin: rendaMin, ativo: true });
                if (n) itens[n.nome.toLowerCase() + '|' + n.rendaMin] = n; else incompletos++;
            } else if (cur) incompletos++;
            cur = null;
        };
        String(txt || '').split(/\r?\n/).forEach(function (raw) {
            var t = raw.replace(/[`*_~‍️]/g, '').replace(/[⬇⬆➡]/g, '').replace(/\s+/g, ' ').trim();
            if (!t) return;
            if (/renda/i.test(t)) {                                     // cabecalho de faixa
                if (cur) { incompletos++; cur = null; }
                var f = null;
                if (!/abaixo|menos de|at[eé] |inferior/i.test(t)) {
                    var m = t.match(/(\d+(?:[.,]\d+)?)\s*mil/i);
                    if (m) f = parseFloat(m[1].replace(',', '.')) * 1000;
                    else { var m2 = t.match(/R\$\s*([\d.,]+)/i); if (m2) f = numBR(m2[1]); }
                }
                rendaMin = (f != null && isFinite(f) && f >= 0) ? f : null;
                return;
            }
            var combo = t.match(/^[^a-z0-9]*entrada\D*([\d.,]+)\D+(\d{1,2})\s*x\s*(?:de\s*)?(?:R\$)?\s*([\d.,]+)/i);
            if (combo) {                                                // "Entrada R$ 299,00 + 12x de R$ 129,90" na mesma linha
                if (cur) { cur.entrada = numBR(combo[1].replace(/[.,]+$/, '')); fechar(parseInt(combo[2], 10), numBR(combo[3].replace(/[.,]+$/, ''))); }
                return;
            }
            if (/^[^a-z0-9]*entrada/i.test(t)) { if (cur) cur.entrada = money(t); return; }
            var pm = t.match(/^[^a-z0-9]*(\d{1,2})\s*x\b/i);
            if (pm) {                                                   // linha das parcelas fecha o aparelho
                fechar(parseInt(pm[1], 10), money(t.replace(/^[^a-z0-9]*\d{1,2}\s*x/i, '')));
                return;
            }
            // linha de nome: tira emoji/simbolos do comeco e padroniza o traco
            var nome = t.replace(/^[^A-Za-z0-9À-ſ]+/, '').replace(/\s+[-–—]\s+/g, ' – ').trim();
            if (nome.length < 2 || nome.length > 70) { return; }
            if (cur) incompletos++;
            cur = { nome: nome, entrada: null };
        });
        if (cur) incompletos++;
        return { itens: apOrdenar(Object.keys(itens).map(function (k) { return itens[k]; })), incompletos: incompletos };
    }

    // ── Escrita (otimista: atualiza a tela na hora e o Firebase sincroniza; falha recarrega do banco) ──
    function apAposMudar() {
        apOrdenar(_aps); apGuardarLS(); apCfgRender();
        if (_view) apRenderBox(_view);
    }
    function apErroGravar() {
        var msg = 'Não consegui salvar agora. Confira a conexão e tente de novo.';
        var st = el('cs_ap_err'); if (st) st.textContent = msg;
        var top = el('cs_ap_errtop'); if (top) { top.textContent = msg; setTimeout(function () { if (top.textContent === msg) top.textContent = ''; }, 7000); }
        apCarregar(true).then(apAposMudar);
    }
    function apGravar(up) {            // up: mapa de caminhos relativos a AP_PATH
        _apsTs = Date.now(); up.atualizadoEm = _apsTs;
        return apFB().then(function (c) { return c.fb.update(c.fb.ref(c.db, AP_PATH), up); }).catch(apErroGravar);
    }
    function apNovoId() {
        return apFB().then(function (c) { return c.fb.push(c.fb.ref(c.db, AP_PATH + '/itens')).key; });
    }
    function apDados(a) { return { nome: a.nome, entrada: a.entrada, parcela: a.parcela, parcelas: a.parcelas, rendaMin: a.rendaMin, ativo: a.ativo !== false }; }

    function apSalvarForm() {
        var err = el('cs_ap_err'); err.textContent = '';
        var nome = (el('cs_ap_f_nome').value || '').replace(/\s+/g, ' ').trim();
        var ent = numBR(el('cs_ap_f_ent').value), par = numBR(el('cs_ap_f_par').value);
        var np = parseInt(el('cs_ap_f_np').value, 10), rm = numBR(el('cs_ap_f_renda').value);
        if (!nome) { err.textContent = 'Informe o modelo.'; return; }
        if (String(el('cs_ap_f_ent').value).trim() === '' || !(ent >= 0)) { err.textContent = 'Informe a entrada (pode ser 0).'; return; }
        if (!(par > 0)) { err.textContent = 'Informe o valor da parcela.'; return; }
        if (!(np >= 1 && np <= 36)) { err.textContent = 'Parcelas: de 1 a 36.'; return; }
        if (String(el('cs_ap_f_renda').value).trim() === '' || !(rm >= 0)) { err.textContent = 'Informe a renda mínima que libera este aparelho.'; return; }
        var antigo = _apEdId ? (_aps || []).filter(function (a) { return a.id === _apEdId; })[0] : null;
        var dados = { nome: nome.slice(0, 70), entrada: ent, parcela: par, parcelas: np, rendaMin: rm, ativo: antigo ? antigo.ativo : true };
        (antigo ? Promise.resolve(antigo.id) : apNovoId()).then(function (id) {
            var n = apNormalizar(id, dados); if (!n) { err.textContent = 'Dados inválidos.'; return; }
            _aps = (_aps || []).filter(function (a) { return a.id !== id; }); _aps.push(n);
            _apEdId = null; el('cs_ap_edit').style.display = 'none';
            var up = {}; up['itens/' + id] = dados;
            apGravar(up); apAposMudar();
        }).catch(function () { err.textContent = 'Sem conexão com o banco. Tente de novo.'; });
    }
    function apEditar(id) {
        var a = id ? (_aps || []).filter(function (x) { return x.id === id; })[0] : null;
        if (id && !a) return;
        _apEdId = a ? a.id : null;
        el('cs_ap_pastecard').style.display = 'none';
        el('cs_ap_edit_t').textContent = a ? 'Editar aparelho' : 'Novo aparelho';
        el('cs_ap_f_nome').value = a ? a.nome : '';
        el('cs_ap_f_ent').value = a ? fmtNum(a.entrada) : '';
        el('cs_ap_f_par').value = a ? fmtNum(a.parcela) : '';
        el('cs_ap_f_np').value = a ? a.parcelas : 12;
        el('cs_ap_f_renda').value = a ? fmtNum(a.rendaMin) : '';
        el('cs_ap_err').textContent = '';
        var box = el('cs_ap_edit'); box.style.display = 'flex';
        if (box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function apAlternar(id) {
        var a = (_aps || []).filter(function (x) { return x.id === id; })[0]; if (!a) return;
        a.ativo = !a.ativo;
        var up = {}; up['itens/' + id + '/ativo'] = a.ativo;
        apGravar(up); apAposMudar();
    }
    function apApagar(id) {
        if (_apArmDel !== id) {          // primeiro toque arma (3s), segundo apaga
            _apArmDel = id; clearTimeout(_apArmTimer);
            _apArmTimer = setTimeout(function () { _apArmDel = null; apCfgRender(); }, 3000);
            apCfgRender(); return;
        }
        _apArmDel = null; clearTimeout(_apArmTimer);
        _aps = (_aps || []).filter(function (a) { return a.id !== id; });
        var up = {}; up['itens/' + id] = null;
        apGravar(up); apAposMudar();
    }

    function apLerColada() {
        var res = el('cs_ap_pasteres'), r = apParseLista(el('cs_ap_paste').value);
        _apLido = r.itens;
        if (!r.itens.length) {
            res.innerHTML = '<span class="bad">Não encontrei aparelhos.</span> Confira se cada um tem o modelo, a linha “Entrada de R$” e a linha “12x de R$”, e se há uma faixa como “Renda de 2 Mil a 3 Mil” antes deles.';
            return;
        }
        var faixas = {}; r.itens.forEach(function (a) { faixas[a.rendaMin] = (faixas[a.rendaMin] || 0) + 1; });
        var resumo = Object.keys(faixas).map(function (k) { return apRs(Number(k)) + ': ' + faixas[k]; }).join(' · ');
        res.innerHTML = '<span class="ok">Li ' + r.itens.length + (r.itens.length > 1 ? ' aparelhos' : ' aparelho') + '.</span> ' + esc(resumo) +
            (r.incompletos ? '<br><span class="bad">' + r.incompletos + ' trecho(s) incompleto(s) foram ignorados.</span>' : '') +
            '<div class="cs-apc-bar" style="margin-top:10px"><button type="button" class="cs-btn cs-btn-pri" data-ap="imp-sub">Substituir tabela</button><button type="button" class="cs-btn cs-btn-sec" data-ap="imp-add">Somar à tabela</button></div>' +
            '<div class="cs-hint" style="text-align:left;margin-top:6px">“Substituir” apaga o que está cadastrado e usa só esta lista. “Somar” atualiza os que já existem (mesmo modelo e faixa) e adiciona os novos.</div>';
    }
    function apImportar(modo) {
        var lido = _apLido || []; if (!lido.length) return;
        apFB().then(function (c) {
            var ts = Date.now(), novos = [];
            if (modo === 'sub') {
                var obj = {};
                lido.forEach(function (a) { var id = c.fb.push(c.fb.ref(c.db, AP_PATH + '/itens')).key; obj[id] = apDados(a); novos.push(apNormalizar(id, apDados(a))); });
                _aps = novos; _apsTs = ts;
                c.fb.set(c.fb.ref(c.db, AP_PATH), { itens: obj, atualizadoEm: ts }).catch(apErroGravar);
            } else {
                var up = {}, atual = _aps || [];
                lido.forEach(function (a) {
                    var ex = atual.filter(function (x) { return x.nome.toLowerCase() === a.nome.toLowerCase() && x.rendaMin === a.rendaMin; })[0];
                    var id = ex ? ex.id : c.fb.push(c.fb.ref(c.db, AP_PATH + '/itens')).key;
                    var d = apDados(a); if (ex) d.ativo = ex.ativo;
                    up['itens/' + id] = d;
                    atual = atual.filter(function (x) { return x.id !== id; }); atual.push(apNormalizar(id, d));
                });
                _aps = atual; apGravar(up);
            }
            _apLido = null; el('cs_ap_paste').value = '';
            el('cs_ap_pasteres').innerHTML = '<span class="ok">Tabela atualizada: ' + _aps.length + ' aparelhos.</span>';
            apAposMudar();
        }).catch(function () { el('cs_ap_pasteres').innerHTML = '<span class="bad">Sem conexão com o banco. Tente de novo.</span>'; });
    }

    // ── Tela de configuracoes ──
    function apTab(t) {
        var ap = t !== 'key';
        var pa = el('cs_cfg_p_ap'), pk = el('cs_cfg_p_key'); if (!pa || !pk) return;
        pa.style.display = ap ? 'flex' : 'none'; pk.style.display = ap ? 'none' : 'flex';
        var bs = document.querySelectorAll('#cs_cfg_ov [data-cfgtab]');
        for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i].getAttribute('data-cfgtab') === (ap ? 'ap' : 'key'));
    }

    function apCfgRender() {
        var box = el('cs_ap_list'); if (!box) return;
        if (_aps === null) { box.innerHTML = '<p class="cs-hint">' + (_apsErro ? 'Sem conexão para ler a tabela.' : 'Carregando...') + '</p>'; return; }
        if (!_aps.length) {
            box.innerHTML = '<div class="cs-hist-empty" style="padding:30px 10px"><i class="bi bi-phone"></i>Nenhum aparelho cadastrado.<br>Cole sua lista do WhatsApp ou toque em Adicionar.</div>';
            return;
        }
        var h = '', faixa = null;
        _aps.forEach(function (a) {
            if (a.rendaMin !== faixa) {
                faixa = a.rendaMin;
                var n = _aps.filter(function (x) { return x.rendaMin === faixa; }).length;
                h += '<div class="cs-apc-faixa">Renda a partir de ' + esc(apRs(faixa)) + '<span>' + n + (n > 1 ? ' modelos' : ' modelo') + '</span></div>';
            }
            var arm = _apArmDel === a.id, id = esc(a.id);
            h += '<div class="cs-apc-it' + (a.ativo ? '' : ' off') + '">' +
                '<div class="cs-ap-nm">' + apEmoji(a.nome) + ' ' + esc(a.nome) + '<span class="cs-ap-sub">Entrada ' + R$(a.entrada) + ' · ' + a.parcelas + 'x ' + R$(a.parcela) + '</span></div>' +
                '<button type="button" class="ui-sw' + (a.ativo ? ' on' : '') + '" role="switch" aria-checked="' + a.ativo + '" aria-label="Disponível para oferecer" data-ap="onoff" data-id="' + id + '"></button>' +
                '<button type="button" class="cs-apc-ib" data-ap="editar" data-id="' + id + '" aria-label="Editar"><i class="bi bi-pencil"></i></button>' +
                '<button type="button" class="cs-apc-ib d' + (arm ? ' arm' : '') + '" data-ap="apagar" data-id="' + id + '" aria-label="Apagar">' + (arm ? 'Apagar?' : '<i class="bi bi-trash"></i>') + '</button></div>';
        });
        box.innerHTML = h;
    }

    function apWire() {
        var ov = el('cs_cfg_ov'); if (!ov) return;
        ov.addEventListener('click', function (e) {
            var tb = e.target.closest('[data-cfgtab]');
            if (tb) { apTab(tb.getAttribute('data-cfgtab')); return; }
            var b = e.target.closest('[data-ap]'); if (!b) return;
            var a = b.getAttribute('data-ap'), id = b.getAttribute('data-id');
            if (a === 'abrir-colar') {
                el('cs_ap_edit').style.display = 'none';
                var pc = el('cs_ap_pastecard'); pc.style.display = pc.style.display === 'none' ? 'flex' : 'none';
            }
            else if (a === 'ler') apLerColada();
            else if (a === 'imp-sub') apImportar('sub');
            else if (a === 'imp-add') apImportar('add');
            else if (a === 'novo') apEditar(null);
            else if (a === 'cancelar') { _apEdId = null; el('cs_ap_edit').style.display = 'none'; }
            else if (a === 'salvar') apSalvarForm();
            else if (a === 'editar') apEditar(id);
            else if (a === 'onoff') apAlternar(id);
            else if (a === 'apagar') apApagar(id);
        });
    }

    // Usado pelo aviso de atualizacao do app: nao reiniciar com analise correndo (perderia o trabalho)
    window._csOcupado = function () {
        return _jobs.some(function (j) { return j.estado === 'rodando' || j.estado === 'fila'; });
    };

    function init(){injectCSS();injectHTML();injectMenuBtns();wireEvents();apWire();atualizarBadge();}
    if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}else{init();}
    window._creditoScanOpen=openOverlay;
    // Botao voltar do celular: fecha a camada mais de cima do CreditoScan (true = tratou)
    window._creditoScanBack=function(){
        if(document.querySelector('.cs-modal,#cs_modal_docq'))return true;
        var ids=['cs_cfg_ov','cs_res_ov','cs_hist_ov','cs_ov'];
        for(var i=0;i<ids.length;i++){
            var o=el(ids[i]);
            if(o&&o.classList.contains('active')){if(ids[i]==='cs_res_ov')fecharResultado();else o.classList.remove('active');return true;}
        }
        return false;
    };

    // Expõe o motor de IA (mesma chave/modelo do CreditoScan) para outros
    // módulos reaproveitarem — usado pela Garantia (Bookip) com IA.
    window._ctwAiVision = aiCallVision;
    window._ctwAiGetApiKey = getApiKey;
    window._ctwResizeToBase64 = resizeToBase64;
})();

