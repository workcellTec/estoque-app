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
    var _docMeta    = {};    // aid -> { rot: etiqueta mostrada (RG/CNH, Extrato...), incerto: o sistema nao soube separar }
    var _enviando   = 0;     // arquivos sendo lidos agora
    var _jobs       = [];    // analises desta sessao (a mais nova primeiro)
    var _jobSeq     = 0;
    var _view       = null;  // analise aberta na tela de resultado
    var _formAberto = null;  // formulario de nova analise visivel?
    var _filaRaiz = false;   // a Fila do gestor e a primeira tela (voltar fecha o CreditoScan) ou foi aberta de dentro da Nova analise (voltar volta pra ela)

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

    async function pdfToImages(file, maxPag) {
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
            var limit = Math.min(pdf.numPages, maxPag || MAX_PDF_PGS);
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
    async function extrairTextoPdfDigital(file, maxPag) {
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
            var limit = Math.min(pdf.numPages, maxPag || MAX_PDF_PGS);
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
                    // Remove caracteres de controle (ex: \u0000) que alguns PDFs
                    // gerados via impressão de página (Chromium/Skia) embutem na
                    // camada de texto interna — invisíveis no PDF, mas que o
                    // Postgres (via PostgREST, ao gravar o job em cs_analises)
                    // rejeita com erro 22P05 ao receber via JSON.
                    curLine.push(String(item.str || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''));
                    lastY = y;
                });
                if (curLine.length) lines.push(curLine.join(' '));
                var pageText = lines.join('\n');
                textos.push(pageText);
                totalChars += pageText.length;
            }
            var ehDigital = (totalChars / limit) > 50;
            return { textos: textos, ehDigital: ehDigital, numPaginas: pdf.numPages };
        } catch(e) { return { textos: [], ehDigital: false, numPaginas: 0 }; }
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

    // Servidor (Supabase Edge Function): a IA roda la, entao o Android pode congelar o app
    // (ex.: voce foi ao WhatsApp) que a analise continua. Sem senha salva, usa o caminho direto.
    var SRV_URL_PADRAO = 'https://mgjkjwsotzwmhrcwefhg.supabase.co/functions/v1/cs-ia';
    var SRV_URL_LS = 'ctwServerUrl';     // endereco da funcao escolhido em Configuracoes (vazio = o padrao acima)
    var SRV_TOKEN_LS = 'ctwServerToken';
    var SRV_POLL_MS = 2000;
    var SRV_ESPERA_MAX_MS = 600000;      // desiste de esperar o servidor depois de 10 min
    var _srvFalhouEm = 0;                // quando o servidor falhou: nao insiste por 5 min

    // Endereco da funcao: so https://<projeto>.supabase.co/functions/v1/<nome> (a senha do servidor e enviada para la).
    // Devolve o endereco limpo (sem ?query, #, nem barra no fim) ou '' se nao serve.
    function normalizarUrlServidor(txt) {
        var s = String(txt == null ? '' : txt).trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
        return /^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/[A-Za-z0-9_-]+$/i.test(s) ? s : '';
    }
    function srvUrl() { return normalizarUrlServidor(safeGet(SRV_URL_LS)) || SRV_URL_PADRAO; }

    // Outro aparelho pode ter mudado o endereco: o do Firebase vale (so troca quando e valido)
    async function urlServidorSincronizar() {
        try {
            await esperarFirebase(8000); if (!window._firebaseDB) return;
            var fb = await import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js');
            var u = normalizarUrlServidor((await fb.get(fb.ref(window._firebaseDB, 'settings/serverUrl'))).val());
            if (u && u !== safeGet(SRV_URL_LS)) localStorage.setItem(SRV_URL_LS, u);
        } catch (e) {}
    }

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

    async function getServerToken() {
        var local = safeGet(SRV_TOKEN_LS);
        if (local) return local;
        try {
            var fb = await import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js');
            var db = window._firebaseDB; if (!db) return '';
            var snap = await fb.get(fb.ref(db, 'settings/serverToken'));
            var tk = snap.val() || '';
            if (tk) try { localStorage.setItem(SRV_TOKEN_LS, tk); } catch (e) {}
            if (tk) await urlServidorSincronizar();   // aparelho novo: pega tambem o endereco da funcao
            return tk;
        } catch (e) { return ''; }
    }

    function novoIdJob() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        var b = new Uint8Array(16); crypto.getRandomValues(b);
        b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
        var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
        return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    }

    // Id fixo de uma chamada da analise (uid da analise + etapa + tentativa) no formato UUID que o servidor aceita.
    // Se o app for fechado e reaberto, a mesma chamada gera o mesmo id e o servidor devolve a resposta que ja guardou.
    async function idFixoChamada(chave, tent) {
        try {
            if (!chave || !chave.uid || !(window.crypto && crypto.subtle && crypto.subtle.digest)) return '';
            var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(chave.uid + '|' + chave.passo + '|' + tent));
            var h = Array.prototype.map.call(new Uint8Array(buf).slice(0, 16), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
            return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32);
        } catch (e) { return ''; }
    }

    // Apaga do servidor as respostas guardadas de uma analise (fim, erro ou cancelamento). O que sobrar expira em 1 hora.
    async function limparRespostasServidor(ids) {
        if (!ids || !ids.length) return;
        var lista = ids.splice(0, ids.length);
        var tk = safeGet(SRV_TOKEN_LS); if (!tk) return;
        lista.forEach(function (id) { fetchComTempo(srvUrl() + '?id=' + id, { method: 'DELETE', headers: srvHeaders(tk) }, 15000).catch(function () {}); });
    }

    function srvHeaders(token) { return { 'Content-Type': 'application/json', 'x-app-token': token }; }

    // Espera ate 'ms' ou ate o app voltar a ficar visivel (o que vier primeiro)
    function esperarOuVoltar(ms) {
        return new Promise(function (resolve) {
            var feito = false;
            function fim() { if (feito) return; feito = true; document.removeEventListener('visibilitychange', onVis); clearTimeout(tm); resolve(); }
            function onVis() { if (!document.hidden) fim(); }
            var tm = setTimeout(fim, ms);
            document.addEventListener('visibilitychange', onVis);
        });
    }

    // fetch que desiste depois de 'ms' (rede movel as vezes deixa a requisicao pendurada)
    async function fetchComTempo(url, init, ms) {
        var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var tm = ctl ? setTimeout(function () { ctl.abort(); }, ms) : null;
        try { init.signal = ctl ? ctl.signal : undefined; return await fetch(url, init); }
        finally { if (tm) clearTimeout(tm); }
    }

    function erroSrvIndisponivel(msg) { var e = new Error(msg); e.srvIndisponivel = true; return e; }

    // Manda o pedido ao servidor e espera o resultado. Devolve algo parecido com a resposta do fetch
    // ({ ok, status, json() }) para o resto do codigo nao mudar. Se o servidor nao responde/recusa o
    // pedido, lanca erro com srvIndisponivel=true e o chamador usa o caminho direto.
    async function chamarViaServidor(token, corpo, idFixo, ids) {
        var id = idFixo || novoIdJob(), inicio = Date.now(), aceito = false;
        if (idFixo && ids) ids.push(id);   // com id fixo a resposta fica guardada ate a analise acabar (permite retomar)
        // 1) entrega o pedido (repetir o mesmo id e seguro: o servidor nao chama a IA duas vezes)
        for (var tp = 0; tp < 3 && !aceito; tp++) {
            try {
                var rp = await fetchComTempo(srvUrl(), { method: 'POST', headers: srvHeaders(token), body: '{"id":"' + id + '","corpo":' + corpo + '}' }, 90000);
                if (rp.status === 202) aceito = true;
                else throw erroSrvIndisponivel('servidor recusou o pedido (HTTP ' + rp.status + ')');
            } catch (e) {
                if (e && e.srvIndisponivel) throw e;
                if (tp === 2) throw erroSrvIndisponivel('sem conexao com o servidor');
                await aguardarAppPronto(60000); await pausa(1200 * (tp + 1));
            }
        }
        // 2) consulta o resultado ate sair (o servidor continua trabalhando mesmo com o app congelado)
        var falhas = 0;
        while (Date.now() - inicio < SRV_ESPERA_MAX_MS) {
            await esperarOuVoltar(SRV_POLL_MS);
            var j = null;
            try {
                var rg = await fetchComTempo(srvUrl() + '?id=' + id, { method: 'GET', headers: srvHeaders(token) }, 20000);
                if (rg.status === 404) { var e404 = new Error('servidor perdeu o pedido'); e404.name = 'TypeError'; throw e404; }
                if (!rg.ok) throw new TypeError('HTTP ' + rg.status);
                j = await rg.json(); falhas = 0;
            } catch (e) {
                if (e && e.message === 'servidor perdeu o pedido') throw e;
                // falha com o app em segundo plano ou sem internet nao conta: so conta com o app aberto e online
                if (!document.hidden && navigator.onLine !== false && ++falhas >= 15) { var ef = new Error('sem resposta do servidor'); ef.name = 'TypeError'; throw ef; }
                continue;
            }
            if (j.status === 'done') {
                if (!idFixo) fetchComTempo(srvUrl() + '?id=' + id, { method: 'DELETE', headers: srvHeaders(token) }, 15000).catch(function () {});   // nao deixa a resposta guardada
                var corpoResp; try { corpoResp = JSON.parse(j.resposta); } catch (e) { corpoResp = {}; }
                return { ok: j.http >= 200 && j.http < 300, status: j.http, json: function () { return Promise.resolve(corpoResp); } };
            }
            if (j.status === 'error') {
                var ee = new Error(j.erro || 'erro no servidor');
                if (j.tipo === 'rede') ee.name = 'AbortError';
                ee.doServidor = true;
                throw ee;
            }
        }
        var et = new Error('sem resposta do servidor em ' + Math.round(SRV_ESPERA_MAX_MS / 60000) + ' min'); et.name = 'AbortError'; et.doServidor = true; throw et;
    }

    async function fetchDireto(key, corpo) {
        var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timer = ctl ? setTimeout(function () { ctl.abort(); }, OR_TIMEOUT_MS) : null;
        try {
            return await fetch(OR_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
                body: corpo,
                signal: ctl ? ctl.signal : undefined
            });
        } finally { if (timer) clearTimeout(timer); }
    }

    async function openRouterCall(model, messages, chave) {
        var key = await getApiKey();
        var tokenSrv = await getServerToken();
        var usarServidor = !!tokenSrv && (Date.now() - _srvFalhouEm > 300000);
        if (!key && !usarServidor) throw new Error('Chave OpenRouter nao configurada. Salve em Firebase > settings/openrouterKey');
        var corpo = JSON.stringify({ model: model, max_tokens: 6000, temperature: 0, messages: messages });
        var erroRede = null, t0 = Date.now(), tent = 0;
        while (tent < OR_TENTATIVAS) {
            tent++;
            try {
                var resp;
                if (usarServidor) {
                    try { resp = await chamarViaServidor(tokenSrv, corpo, await idFixoChamada(chave, tent), chave && chave.ids); }
                    catch (eSrv) {
                        if (!(eSrv && eSrv.srvIndisponivel)) throw eSrv;
                        // servidor fora do ar ou recusou: segue pelo caminho direto (como antes)
                        usarServidor = false; _srvFalhouEm = Date.now();
                        console.warn('[CreditoScan] servidor indisponivel, usando caminho direto:', eSrv.message);
                        if (!key) throw new Error('Servidor indisponivel (' + eSrv.message + ') e chave OpenRouter nao configurada.');
                        resp = await fetchDireto(key, corpo);
                    }
                } else {
                    resp = await fetchDireto(key, corpo);
                }
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
                var ehRede = err && (err.name === 'TypeError' || err.name === 'AbortError');
                if (!ehRede) throw err;
                erroRede = err;
                console.warn('[CreditoScan] falha de rede ' + tent + '/' + OR_TENTATIVAS, err && err.message, '| envio', fmtMB(corpo.length), '| online', navigator.onLine, '| oculto', document.hidden);
                if (tent < OR_TENTATIVAS) { await aguardarAppPronto(120000); await pausa(1500 * tent); }
            }
        }
        var motivo = (erroRede && erroRede.doServidor) ? erroRede.message : (erroRede && erroRede.name === 'AbortError') ? 'sem resposta em ' + Math.round(OR_TIMEOUT_MS / 1000) + 's' : ((erroRede && erroRede.message) || 'falha de rede');
        throw new Error(motivo + ' [envio ' + fmtMB(corpo.length) + ' · ' + tent + ' tentativas · ' + Math.round((Date.now() - t0) / 1000) + 's · ' +
            (navigator.onLine === false ? 'sem internet' : 'online') + (document.hidden ? ' · app em segundo plano' : '') + ']');
    }

    // Configuracoes: guarda a senha do servidor (aparelho + Firebase) e testa se o servidor aceita
    async function testarServidor(token, base) {
        base = base || srvUrl();
        try {
            var r = await fetchComTempo(base + '?id=' + novoIdJob(), { method: 'GET', headers: srvHeaders(token) }, 15000);
            if (r.status === 401 || r.status === 403) {
                var j401 = await r.json().catch(function () { return {}; });
                // resposta da NOSSA funcao = senha errada; qualquer outra = o Supabase barrou antes de chegar nela
                if (j401 && j401.erro === 'nao autorizado') return { ok: false, msg: 'Senha não confere com a do servidor (APP_TOKEN).' };
                var det = (j401 && (j401.message || j401.msg || j401.error_description)) ? ' Resposta: "' + String(j401.message || j401.msg || j401.error_description).slice(0, 80) + '".' : ' (HTTP ' + r.status + ')';
                return { ok: false, msg: 'O Supabase barrou antes de chegar na função.' + det + ' Confira se "Verify JWT" está desligado e SALVO (Edge Functions > cs-ia > Settings > Save changes).' };
            }
            if (r.status === 404 && !(await r.clone().json().catch(function () { return {}; })).status) return { ok: false, msg: 'Função não encontrada nesse endereço. Copie o endereço completo da função no painel do Supabase (Edge Functions) e cole no campo de cima.' };
            if (r.status === 404 || r.status === 200) {
                var fila = null;
                try { var rs = await fetchComTempo(base + '/status', { method: 'GET', headers: srvHeaders(token) }, 15000); var js = await rs.json().catch(function () { return {}; }); fila = !!(rs.status === 200 && js && js.fila); if (fila && js.banco && js.banco !== 'ok') return { ok: false, msg: 'A função nova está no ar, mas o banco não está pronto: ' + js.banco + '.' }; } catch (e) {}
                _fila.suporte = fila === null ? null : fila; _fila.suporteTs = Date.now();
                return { ok: true, msg: 'Servidor respondeu e aceitou a senha.' + (fila ? ' Fila de análises ativa.' : fila === false ? ' Atenção: a função no servidor é a versão antiga (sem fila). Cole a nova versão para a análise rodar toda no servidor.' : '') };
            }
            if (r.status === 500) { var j = await r.json().catch(function () { return {}; }); return { ok: false, msg: 'Servidor com problema: ' + (j.erro || 'HTTP 500') }; }
            return { ok: false, msg: 'Servidor respondeu HTTP ' + r.status + '. Confira o endereço da função.' };
        } catch (e) { return { ok: false, msg: 'Não consegui falar com o servidor (sem internet, ou o endereço da função está errado).' }; }
    }

    async function salvarSenhaServidor() {
        var inp = el('cs_cfg_srv'), st = el('cs_cfg_srv_status'); if (!inp || !st) return;
        var tk = inp.value.trim(), urlTxt = (el('cs_cfg_url') || { value: '' }).value.trim();
        var cor = function (ok) { return ok ? 'var(--primary-color)' : 'var(--cs-bad)'; };
        if (!tk) {   // vazio = desligar o servidor e voltar ao caminho direto
            try { localStorage.removeItem(SRV_TOKEN_LS); } catch (e) {}
            try { var fb0 = await import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js'); if (window._firebaseDB) fb0.remove(fb0.ref(window._firebaseDB, 'settings/serverToken')); } catch (e) {}
            _srvFalhouEm = 0;
            st.innerHTML = '<span style="color:' + cor(true) + '">Servidor desligado: a IA volta a rodar direto no celular.</span>'; return;
        }
        if (tk.length < 12 || /\s/.test(tk)) { st.innerHTML = '<span style="color:' + cor(false) + '">Use uma senha com 12+ caracteres, sem espaços.</span>'; return; }
        var urlNova = normalizarUrlServidor(urlTxt);
        if (urlTxt && !urlNova) { st.innerHTML = '<span style="color:' + cor(false) + '">Endereço inválido. Use o formato https://…supabase.co/functions/v1/nome-da-funcao (copie do painel do Supabase) ou deixe vazio.</span>'; return; }
        st.textContent = 'Testando...';
        var r = await testarServidor(tk, urlNova || SRV_URL_PADRAO);
        if (r.ok) {
            try { localStorage.setItem(SRV_TOKEN_LS, tk); if (urlNova) localStorage.setItem(SRV_URL_LS, urlNova); else localStorage.removeItem(SRV_URL_LS); } catch (e) {}
            try {
                var fb = await import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js');
                if (window._firebaseDB) { fb.set(fb.ref(window._firebaseDB, 'settings/serverToken'), tk); if (urlNova) fb.set(fb.ref(window._firebaseDB, 'settings/serverUrl'), urlNova); else fb.remove(fb.ref(window._firebaseDB, 'settings/serverUrl')); }
            } catch (e) {}
            _srvFalhouEm = 0;
        }
        st.innerHTML = '<span style="color:' + cor(r.ok) + '">' + (r.ok ? '✅ Salvo. ' : '❌ Não salvei. ') + r.msg + '</span>';
    }

    // Motor Vision: manda imagens + texto pro Qwen-VL via OpenRouter
    async function aiCallVision(imagens, textoExtra, prompt, chave) {
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
        return openRouterCall(OR_MODEL_VL, [{ role: 'user', content: content }], chave);
    }

    // Leitura de imagens por outros módulos (Sincronizar preços > Conferir catálogo): mesma IA, mesmo servidor/chave.
    window.ctwIAVisao = function (messages) { return openRouterCall(OR_MODEL_VL, messages); };
    // IA só de texto (busca por IA no Por aparelho): modelo de texto, mesma chave/servidor.
    window.ctwIATexto = function (messages) { return openRouterCall(OR_MODEL_TXT, messages); };

    // ── Qwen3-235B texto — análise financeira consistente ──
    async function aiCallTexto(prompt, chave) {
        return openRouterCall(OR_MODEL_TXT, [{ role: 'user', content: prompt }], chave);
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
    var MAX_MESES     = 3;      // so valem os 3 meses mais recentes do comprovante (regra do dono)
    var JANELA_MESES  = 4;      // extrato de "3 meses" costuma tocar 4 meses de calendario (pontas parciais)
    var TOL_SOMA_PCT  = 0.03;   // soma lida pela IA x 'Total de creditos' impresso no extrato: tolerancia de 3% ou R$ 50 (o que for maior)
    var TOL_SOMA_MIN  = 50;
    var TOL_LEITURA   = 0.20;   // regra do dono: a leitura pode errar ate 20% do total impresso. Dentro disso vale o TOTAL do extrato (a sobra entra como "margem de erro"); acima disso a leitura e recusada
    var DUVIDOSA_PCT  = 0.60;   // mais que isso das entradas excluidas = renda duvidosa (confira o extrato)
    var MESES_ABREV   = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

    // Regras de renda: UM texto so, usado no prompt de texto e no de imagem
    var REGRAS_RENDA =
'Voce NAO calcula a renda final nem media: voce CLASSIFICA e SOMA as entradas (creditos) de cada mes. O sistema faz media, mediana e abatimentos.\n'+
'Classifique cada entrada em um destes grupos:\n'+
'  fixa     = salario/proventos (holerite: valor LIQUIDO), beneficio (INSS, aposentadoria, pensao) ou qualquer pagador FIXO que paga todo mes. TED "Proventos"/"Salario" do mesmo CPF vindo de outro banco tambem e fixa.\n'+
'  variavel = Pix/TED recebido de TERCEIROS: clientes, vendas, servicos, comissoes, repasses, maquininha. CONTE como variavel MESMO QUE a pessoa repasse tudo depois (conta de passagem nao importa: o sistema ja aplica o desconto de custo). Transferencia de familiar/conjuge (mesmo sobrenome, descricao "mae", "esposa", "ajuda") SO entra aqui se se repetir em 2+ meses; se aparecer em 1 mes so, e excluida.\n'+
'  app      = repasses de apps de transporte/entrega (Uber, 99, InDrive, iFood, Rappi, Loggi...). Informe o valor BRUTO: o sistema desconta o custo operacional. NAO desconte nada voce mesmo.\n'+
'SO SAO EXCLUIDAS (campo "excluidas") as entradas que SE ENQUADRAM CLARAMENTE em um destes casos:\n'+
'  - autotransferencia: Pix/TED do proprio CPF/nome entre contas proprias\n'+
'  - credito de emprestimo, financiamento, consignado, antecipacao, saque-aniversario FGTS\n'+
'  - estorno, reembolso, devolucao de Pix, cashback, rendimento, juros, correcao monetaria\n'+
'  - resgate de investimento, poupanca ou CDB\n'+
'  - deposito em dinheiro sem origem identificavel\n'+
'  - premio ou saque de casa de aposta\n'+
'  - 13o salario, ferias, PLR, rescisao (nao se repetem todo mes)\n'+
'  - venda de bem (carro, moto, imovel) ou emprestimo entre pessoas, SO quando a descricao disser isso\n'+
'NA DUVIDA, CONTE (variavel). Nao exclua uma entrada so porque o valor e alto ou diferente das outras.\n'+
'Confira a conta: fixa + variavel + app + excluidas = TUDO que entrou no mes. Se o extrato imprime o total (ex.: "Total de Creditos", "Total de entradas"), copie em totalCreditos; se nao imprime, use 0.\n'+
'Em cada mes, liste em "pagadores" os ATE 6 MAIORES pagadores do grupo variavel (nome do pagador como aparece no extrato + soma que ele pagou naquele mes). O sistema usa isso para reconhecer quem paga TODO MES (salario sem holerite, cliente fixo) e nao descontar o custo desse valor.\n'+
'Liste em excluidasDetalhe as MAIORES entradas excluidas (ate 8, mes + valor + motivo curto, ex.: "autotransferencia", "estorno") para o vendedor conferir.\n'+
'Um item por MES CALENDARIO coberto pelos documentos. NUNCA some meses diferentes no mesmo item; mes sem entradas = item com zeros. Informe tambem o periodo coberto em periodoDocumentos (primeira e ultima data dos documentos). Formato de cada item:\n'+
'  {"mes":"AAAA-MM","fixa":0.00,"variavel":0.00,"app":0.00,"excluidas":0.00,"totalCreditos":0.00,"parcial":false,"pagadores":[{"nome":"","valor":0.00}]}\n'+
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
        var ini = a[3] ? Date.UTC(+a[1], +a[2] - 1, +a[3]) : null, fim = b[3] ? Date.UTC(+b[1], +b[2] - 1, +b[3]) : null;
        var dias = ini !== null && fim !== null ? Math.round((fim - ini) / 86400000) + 1 : null;
        return { meses: n, dias: dias !== null && dias >= 1 ? dias : null, ini: ini, fim: fim };
    }

    function fmtDataUtc(ms) { var d = new Date(ms); return ('0' + d.getUTCDate()).slice(-2) + '/' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '/' + String(d.getUTCFullYear()).slice(-2); }

    // O mes esta so em parte nos documentos? (decide pelas DATAS do periodo, nao pelo palpite da IA). null = sem como saber.
    function mesParcialPeloPeriodo(mes, per) {
        var mm = /^(\d{4})-(\d{1,2})$/.exec(String(mes || '').trim());
        if (!mm || !per || per.ini === null || per.fim === null) return null;
        var primeiro = Date.UTC(+mm[1], +mm[2] - 1, 1), ultimo = Date.UTC(+mm[1], +mm[2], 0);
        return per.ini > primeiro + 2 * 86400000 || per.fim < ultimo - 2 * 86400000;
    }

    // Conferencia da leitura da IA: soma por mes x "Total de creditos" do extrato, e peso das entradas excluidas
    function auditarMeses(meses, obj) {
        var divergentes = [], margens = [], excl = 0, tot = 0, somaMargem = 0, somaTotal = 0;
        meses.forEach(function (m) {
            if (m.margem > 0) { margens.push({ mes: m.mes, valor: m.margem, tipo: m.margemTipo, total: m.totalCreditos }); somaMargem += m.margem; }
            somaTotal += m.totalCreditos;
            var soma = m.fixa + m.variavel + m.app + m.excluidas;
            excl += m.excluidas; tot += soma;
            if (m.totalCreditos > 0) {
                var dif = Math.abs(soma - m.totalCreditos);
                if (dif > Math.max(m.totalCreditos * TOL_SOMA_PCT, TOL_SOMA_MIN)) divergentes.push({ mes: m.mes, soma: arred2(soma), total: arred2(m.totalCreditos) });
            }
        });
        var pct = tot > 0 ? excl / tot : 0;
        var det = (Array.isArray(obj && obj.excluidasDetalhe) ? obj.excluidasDetalhe : []).filter(function (e) { return e && typeof e === 'object' && numPos(e.valor) > 0; })
            .map(function (e) { return { mes: String(e.mes || ''), valor: numPos(e.valor), motivo: String(e.motivo || '').slice(0, 60) }; })
            .sort(function (a, b) { return b.valor - a.valor; }).slice(0, 8);
        return { divergentes: divergentes, margens: margens, excluidasTotal: arred2(excl), pctExcluido: pct, excluidasDetalhe: det, duvidosa: divergentes.length > 0 || (tot > 0 && pct > DUVIDOSA_PCT) || (somaTotal > 0 && somaMargem / somaTotal > 0.10) };
    }

    // ── Pagador FIXO: quem paga todo mes (salario sem holerite, cliente fixo) nao leva o desconto de custo ──
    // A IA/leitor listam, por mes, os maiores pagadores do grupo "variavel". Quem aparece em 2+ meses com valor parecido
    // (dentro de 35% da mediana e pelo menos PAGADOR_MIN) passa de "variavel" para "fixa". Nunca altera o objeto original.
    var PAGADOR_MIN = 300, PAGADOR_VARIACAO = 0.35;
    function chavePagador(nome) { return nuSemAcento(nome).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
    function somarPagadores(a, b) {
        var mapa = {}, ordem = [];
        [a, b].forEach(function (l) {
            (Array.isArray(l) ? l : []).forEach(function (p) {
                if (!p || typeof p !== 'object') return;
                var k = chavePagador(p.nome), v = numPos(p.valor);
                if (!k || !(v > 0)) return;
                if (!mapa[k]) { mapa[k] = { nome: String(p.nome).trim().slice(0, 60), valor: 0 }; ordem.push(k); }
                mapa[k].valor = arred2(mapa[k].valor + v);
            });
        });
        return ordem.map(function (k) { return mapa[k]; }).sort(function (x, y) { return y.valor - x.valor; }).slice(0, 12);
    }
    function promoverPagadoresFixos(lista) {
        var porNome = {}, meses = {};
        lista.forEach(function (m) {
            var mes = String(m.mes || '').trim();
            if (!mes || !Array.isArray(m.pagadores)) return;
            meses[mes] = true;
            somarPagadores(m.pagadores, null).forEach(function (p) {
                var k = chavePagador(p.nome);
                if (!porNome[k]) porNome[k] = { nome: p.nome, porMes: {} };
                porNome[k].porMes[mes] = arred2((porNome[k].porMes[mes] || 0) + p.valor);
            });
        });
        var fixos = {}, detalhe = [];
        Object.keys(porNome).forEach(function (k) {
            var vs = Object.keys(porNome[k].porMes).map(function (x) { return porNome[k].porMes[x]; });
            if (vs.length < 2) return;
            var ord = vs.slice().sort(function (a, b) { return a - b; }), med = ord.length % 2 ? ord[(ord.length - 1) / 2] : (ord[ord.length / 2 - 1] + ord[ord.length / 2]) / 2;
            if (med < PAGADOR_MIN) return;
            if (vs.some(function (v) { return Math.abs(v - med) / med > PAGADOR_VARIACAO; })) return;
            fixos[k] = true;
            detalhe.push({ nome: porNome[k].nome, meses: vs.length, media: arred2(vs.reduce(function (a, v) { return a + v; }, 0) / vs.length) });
        });
        if (!detalhe.length) return { lista: lista, detalhe: [] };
        var nova = lista.map(function (m) {
            if (!Array.isArray(m.pagadores)) return m;
            var mover = 0;
            somarPagadores(m.pagadores, null).forEach(function (p) { if (fixos[chavePagador(p.nome)]) mover += p.valor; });
            mover = Math.min(mover, numPos(m.variavel));
            if (!(mover > 0)) return m;
            var c = Object.assign({}, m);
            c.variavel = arred2(numPos(m.variavel) - mover); c.fixa = arred2(numPos(m.fixa) + mover);
            return c;
        });
        return { lista: nova, detalhe: detalhe.sort(function (a, b) { return b.media - a.media; }) };
    }

    // ── Calculo da renda ─────────────────────────────────────────────
    // Devolve { renda, fonte:'codigo'|'ia', ... } ou null se nao ha nenhum dado.
    //  - 'codigo': calculado aqui a partir de rendaMeses
    //  - 'ia': a IA nao detalhou os meses; usa o numero que ela deu (formato antigo)
    function calcularRenda(obj) {
        if (!obj) return null;
        var lm = Array.isArray(obj.rendaMeses) ? obj.rendaMeses.filter(function (m) { return m && typeof m === 'object'; }) : [];
        var fx = lm.length > 1 ? promoverPagadoresFixos(lm) : { lista: lm, detalhe: [] };
        var r = calcularRendaBase(fx.detalhe.length ? Object.assign({}, obj, { rendaMeses: fx.lista }) : obj);
        if (r && fx.detalhe.length) r.pagadoresFixos = fx.detalhe;
        return r;
    }
    function calcularRendaBase(obj) {
        if (!obj) return null;
        var iaNum = numPos(obj.rendaEstimada) || numPos(obj.rendaMensal);
        var lista = Array.isArray(obj.rendaMeses) ? obj.rendaMeses.filter(function (m) { return m && typeof m === 'object'; }) : [];
        // so os MAX_MESES mais recentes (a lista pode vir fora de ordem ou com mais meses que o pedido)
        if (lista.every(function (m) { return /^\d{4}-\d{1,2}$/.test(String(m.mes || '').trim()); })) {
            lista = lista.slice().sort(function (a, b) { return String(a.mes).trim().localeCompare(String(b.mes).trim(), 'en', { numeric: true }); });
        }
        if (lista.length > JANELA_MESES) lista = lista.slice(-JANELA_MESES);
        var per = periodoDoc(obj.periodoDocumentos);

        var meses = lista.map(function (m) {
            var fixa = numPos(m.fixa), variavel = numPos(m.variavel), app = numPos(m.app), exc = numPos(m.excluidas), tot = numPos(m.totalCreditos), margem = 0, margemTipo = '';
            // Regra dos 20%: o total impresso no extrato e a verdade. Soma lida ate 20% fora do total: vale o total (faltou = entra como renda "aleatoria", com o desconto
            // de ganho variavel; passou = reduz tudo na mesma proporcao). Acima de 20% nada e ajustado: a divergencia segue para a conferencia (leitura recusada).
            if (tot > 0) {
                var s0 = fixa + variavel + app + exc, dif0 = tot - s0;
                if (Math.abs(dif0) > Math.max(tot * TOL_SOMA_PCT, TOL_SOMA_MIN) && Math.abs(dif0) <= tot * TOL_LEITURA) {
                    if (dif0 > 0) { variavel = arred2(variavel + dif0); margem = arred2(dif0); margemTipo = 'falta'; }
                    else { var fc = tot / s0; fixa = arred2(fixa * fc); variavel = arred2(variavel * fc); app = arred2(app * fc); exc = arred2(exc * fc); margem = arred2(-dif0); margemTipo = 'excesso'; }
                }
            }
            var o = {
                mes: String(m.mes || ''), fixa: fixa, variavel: variavel, app: app, excluidas: exc,
                totalCreditos: tot,
                parcial: (function () { var pp = mesParcialPeloPeriodo(m.mes, per); return pp !== null ? pp : (m.parcial === true || m.parcial === 'true'); })(),
                liquido: arred2(fixa + variavel * (1 - DESC_VARIAVEL) + app * (1 - DESC_APP)),
                abatido: arred2(variavel * DESC_VARIAVEL + app * DESC_APP)
            };
            if (margem > 0) { o.margem = margem; o.margemTipo = margemTipo; }
            ['saidas', 'saidasInvest', 'saidasProprias', 'saldoInicial', 'saldoFinal', 'menorSaldo'].forEach(function (f) { if (typeof m[f] === 'number' && isFinite(m[f])) o[f] = m[f]; });   // lidos e provados pelo codigo (Nubank/universal)
            return o;
        });

        var soma = meses.reduce(function (a, m) { return a + m.fixa + m.variavel + m.app; }, 0);
        if (!meses.length || soma <= 0) {
            // sem detalhamento utilizavel: confia no numero da IA (formato antigo / resposta incompleta)
            if (iaNum > 0) return { renda: arred2(iaNum), fonte: 'ia', meses: [] };
            // a IA detalhou e nao achou nenhuma entrada valida: renda 0 de verdade
            return meses.length ? { renda: 0, fonte: 'codigo', meses: meses, usados: meses, media: 0, mediana: 0, destoa: false, abatidoMedio: 0, parciaisIgnorados: 0 } : null;
        }

        // Periodo informado pela IA (limitado aos MAX_MESES mais recentes). Meses que a IA nao listou NAO diluem a renda:
        // usa-se a media dos meses lidos e o aviso fica na tela. So quando a IA enfiou o periodo inteiro num unico item
        // (impossivel saber o que e de cada mes) o total e dividido pelos meses do periodo.
        var aud = auditarMeses(meses, obj);
        var span = per ? Math.min(per.meses, MAX_MESES) : 1;
        var curto = per && per.dias !== null ? per.dias < DIAS_MINIMO : meses.length < 3;
        var distintos = {};
        meses.forEach(function (m, i) { distintos[m.mes || ('#' + i)] = true; });
        var nItens = Object.keys(distintos).length;
        var faltando = span > nItens ? span - nItens : 0;
        if (span > 1 && nItens === 1) {
            var totalLiq = meses.reduce(function (a, m) { return a + m.liquido; }, 0);
            return {
                renda: arred2(totalLiq / span), fonte: 'codigo', meses: meses, usados: meses, media: arred2(totalLiq / span), mediana: arred2(totalLiq / span),
                destoa: false, abatidoMedio: 0, parciaisIgnorados: 0, agrupado: true, span: span, itens: nItens, total: arred2(totalLiq), curto: curto, dias: per ? per.dias : null,
                divergentes: aud.divergentes, margens: aud.margens, excluidasTotal: aud.excluidasTotal, pctExcluido: aud.pctExcluido, excluidasDetalhe: aud.excluidasDetalhe, duvidosa: true
            };
        }

        // Menos de MAX_MESES meses completos mas ha pontas parciais (ex.: 24/jul a 24/out): usa o PERIODO INTEIRO,
        // total dos dias cobertos / (dias / 30,4). Assim "3 meses de extrato" valem 3 meses, nao 2.
        var completos = meses.filter(function (m) { return !m.parcial; });
        if (per && per.ini !== null && completos.length < MAX_MESES && completos.length < meses.length) {
            var mp = /^(\d{4})-(\d{1,2})$/.exec(String(meses[0].mes).trim());
            var iniEf = mp ? Math.max(per.ini, Date.UTC(+mp[1], +mp[2] - 1, 1)) : per.ini;
            var diasEf = Math.round((per.fim - iniEf) / 86400000) + 1;
            if (diasEf >= 28) {
                var eq = diasEf / 30.4;
                var totLiqP = meses.reduce(function (a, m) { return a + m.liquido; }, 0), totAbP = meses.reduce(function (a, m) { return a + m.abatido; }, 0);
                var mf = /^(\d{4})-(\d{1,2})$/.exec(new Date(per.fim).toISOString().slice(0, 7));
                var esperados = mp && mf ? (+mf[1] - +mp[1]) * 12 + (+mf[2] - +mp[2]) + 1 : nItens;
                var faltaP = Math.max(0, esperados - nItens);
                return {
                    renda: arred2(totLiqP / eq), fonte: 'codigo', meses: meses, usados: meses, media: arred2(totLiqP / eq), mediana: arred2(totLiqP / eq),
                    destoa: false, abatidoMedio: arred2(totAbP / eq), parciaisIgnorados: 0, metodo: 'periodo', diasPeriodo: diasEf, equivMeses: arred2(eq), totalLiquido: arred2(totLiqP),
                    periodoTxt: fmtDataUtc(per.ini) + ' a ' + fmtDataUtc(per.fim), curto: per.dias < DIAS_MINIMO, dias: per.dias, faltando: faltaP,
                    divergentes: aud.divergentes, margens: aud.margens, excluidasTotal: aud.excluidasTotal, pctExcluido: aud.pctExcluido, excluidasDetalhe: aud.excluidasDetalhe,
                    duvidosa: aud.duvidosa || faltaP > 0
                };
            }
        }
        // mes parcial so e ignorado se sobrar pelo menos um mes completo; valem os MAX_MESES completos mais recentes
        var usados = completos.length ? completos.slice(-MAX_MESES) : meses.slice(-MAX_MESES);
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
            periodoTxt: per && per.ini !== null ? fmtDataUtc(per.ini) + ' a ' + fmtDataUtc(per.fim) : '',
            curto: curto, dias: per ? per.dias : null, faltando: faltando,
            divergentes: aud.divergentes, margens: aud.margens, excluidasTotal: aud.excluidasTotal, pctExcluido: aud.pctExcluido, excluidasDetalhe: aud.excluidasDetalhe,
            duvidosa: aud.duvidosa || faltando > 0
        };
    }

    // Une as leituras de renda de varios PDFs (1 chamada de IA por arquivo) em um unico objeto no formato de calcularRenda.
    // Mesmo mes em dois arquivos:
    //  - periodos que se sobrepoem (mais de 3 dias): e o mesmo extrato lido duas vezes, fica o de maior soma;
    //  - periodos em sequencia (ex.: 21/jul-20/ago e 21/ago-20/set): cada arquivo traz uma METADE do mes, as metades SOMAM.
    // Periodo unido = do menor inicio ao maior fim.
    function sobreposicaoDias(a, b) {
        if (!a || !b || a.ini === null || b.ini === null || a.fim === null || b.fim === null) return Infinity;   // sem datas: trata como o mesmo extrato
        return Math.round((Math.min(a.fim, b.fim) - Math.max(a.ini, b.ini)) / 86400000) + 1;
    }
    function unirPeriodos(a, b) {
        if (!a || !b || a.ini === null || b.ini === null || a.fim === null || b.fim === null) return a && a.ini !== null ? a : b;
        return { ini: Math.min(a.ini, b.ini), fim: Math.max(a.fim, b.fim) };
    }
    // Metades do mesmo mes em dois arquivos: saidas somam; saldo final vale o do arquivo mais recente, saldo inicial o do mais antigo, menor saldo o menor.
    // Se so um dos arquivos foi lido pelo codigo (com prova), o dado fica sem valor: o mes inteiro nao esta provado.
    function unirSaidasSaldos(a, b, perA, perB) {
        ['saidas', 'saidasInvest', 'saidasProprias'].forEach(function (f) {
            if (typeof a[f] === 'number' && typeof b[f] === 'number') a[f] = arred2(a[f] + b[f]); else delete a[f];
        });
        if (typeof a.saldoFinal === 'number' && typeof b.saldoFinal === 'number' && perA && perB && perA.fim !== perB.fim) {
            var bDepois = perB.fim > perA.fim;
            a.saldoFinal = bDepois ? b.saldoFinal : a.saldoFinal;
            a.saldoInicial = typeof a.saldoInicial === 'number' && typeof b.saldoInicial === 'number' ? (bDepois ? a.saldoInicial : b.saldoInicial) : undefined;
            if (typeof a.menorSaldo === 'number' && typeof b.menorSaldo === 'number') a.menorSaldo = Math.min(a.menorSaldo, b.menorSaldo); else delete a.menorSaldo;
            if (a.saldoInicial === undefined) delete a.saldoInicial;
        } else { delete a.saldoFinal; delete a.saldoInicial; delete a.menorSaldo; }
    }
    function unirRendaArquivos(lista) {
        var porMes = {}, ordem = [], ini = '', fim = '', det = [], titular = '';
        (lista || []).forEach(function (o) {
            if (!o || typeof o !== 'object') return;
            if (!titular && o.titular) titular = String(o.titular);
            var p = o.periodoDocumentos, pd = periodoDoc(p);
            if (p && typeof p === 'object') {
                if (p.inicio && (!ini || String(p.inicio) < ini)) ini = String(p.inicio);
                if (p.fim && (!fim || String(p.fim) > fim)) fim = String(p.fim);
            }
            var per = pd && pd.ini !== null ? { ini: pd.ini, fim: pd.fim } : null;
            (Array.isArray(o.rendaMeses) ? o.rendaMeses : []).forEach(function (m) {
                if (!m || typeof m !== 'object') return;
                var k = String(m.mes || '').trim() || ('#' + ordem.length);
                var v = numPos(m.fixa) + numPos(m.variavel) + numPos(m.app) + numPos(m.excluidas);
                var atual = porMes[k];
                if (!atual) { ordem.push(k); porMes[k] = { v: v, m: Object.assign({}, m), per: per }; return; }
                if (sobreposicaoDias(atual.per, per) > 3) {
                    if (v > atual.v) { atual.m = Object.assign({}, m); atual.v = v; }
                } else {
                    ['fixa', 'variavel', 'app', 'excluidas', 'totalCreditos'].forEach(function (f) { atual.m[f] = numPos(atual.m[f]) + numPos(m[f]); });
                    unirSaidasSaldos(atual.m, m, atual.per, per);
                    if (Array.isArray(m.pagadores) || Array.isArray(atual.m.pagadores)) atual.m.pagadores = somarPagadores(atual.m.pagadores, m.pagadores);
                    atual.v += v;
                }
                atual.per = unirPeriodos(atual.per, per);
            });
            if (Array.isArray(o.excluidasDetalhe)) det = det.concat(o.excluidasDetalhe);
        });
        return {
            titular: titular, periodoDocumentos: ini && fim ? { inicio: ini, fim: fim } : null,
            rendaMeses: ordem.map(function (k) { return porMes[k].m; }), excluidasDetalhe: det
        };
    }

    // ── Leitura do extrato em TRECHOS ─────────────────────────────────
    // A IA erra a soma quando precisa somar de cabeca 50-60 Pix de um mes numa resposta so (perde entradas e ate meses).
    // Entao o extrato e lido em trechos pequenos (em paralelo) e o CODIGO soma os trechos e confere com o total impresso.
    var LIMITE_RENDA_ARQUIVO = 240000;   // caracteres lidos por PDF na etapa de renda (a leitura e em trechos, entao cabe bem mais que o limite da analise final)
    var ALVO_TRECHO  = 7000;    // caracteres por trecho (≈ 3 a 4 paginas de extrato)
    var MIN_TRECHO   = 2500;    // na releitura o trecho encolhe, mas nunca abaixo disso
    var MAX_TRECHOS  = 16;      // por arquivo
    var PARALELO_IA  = 6;       // chamadas de IA simultaneas por analise

    // Corta o texto do arquivo (paginas separadas por SEP_PAGINA) em trechos de ~alvo caracteres, sempre entre paginas
    // (ou entre linhas, se uma pagina sozinha for maior que o alvo).
    function dividirTrechos(texto, alvo) {
        texto = String(texto || '');
        alvo = Math.max(MIN_TRECHO / 2, alvo || ALVO_TRECHO);
        alvo = Math.max(alvo, Math.ceil(texto.length / MAX_TRECHOS));
        if (texto.length <= alvo * 1.3) return [texto];
        var partes = [];
        texto.split(SEP_PAGINA).forEach(function (pg) {
            if (pg.length <= alvo * 1.3) { partes.push(pg); return; }
            var cur = '';
            pg.split('\n').forEach(function (ln) {
                if (cur && cur.length + ln.length + 1 > alvo) { partes.push(cur); cur = ''; }
                cur += (cur ? '\n' : '') + ln;
            });
            if (cur) partes.push(cur);
        });
        var trechos = [], atual = '';
        partes.forEach(function (pg) {
            if (atual && atual.length + pg.length > alvo) { trechos.push(atual); atual = ''; }
            atual += (atual ? SEP_PAGINA : '') + pg;
        });
        if (atual) trechos.push(atual);
        return trechos.length > MAX_TRECHOS ? dividirTrechos(texto, Math.ceil(alvo * 1.25)) : trechos;   // empacotamento deixou sobra: folga maior
    }

    // Soma as leituras de varios trechos do MESMO arquivo: valores somam, o total impresso e o maior visto,
    // o periodo e a uniao. (Diferente de unirRendaArquivos, que trata arquivos que podem se sobrepor.)
    function somarTrechos(lista) {
        var porMes = {}, ordem = [], ini = '', fim = '', det = [], titular = '';
        (lista || []).forEach(function (o) {
            if (!o || typeof o !== 'object') return;
            if (!titular && o.titular) titular = String(o.titular);
            var p = o.periodoDocumentos;
            if (p && typeof p === 'object') {
                if (p.inicio && (!ini || String(p.inicio) < ini)) ini = String(p.inicio);
                if (p.fim && (!fim || String(p.fim) > fim)) fim = String(p.fim);
            }
            (Array.isArray(o.rendaMeses) ? o.rendaMeses : []).forEach(function (m) {
                if (!m || typeof m !== 'object') return;
                var k = String(m.mes || '').trim().replace(/^(\d{4})-(\d)$/, '$1-0$2');   // 2026-8 e 2026-08 sao o mesmo mes
                if (!k) return;
                var a = porMes[k];
                if (!a) { ordem.push(k); a = porMes[k] = { mes: k, fixa: 0, variavel: 0, app: 0, excluidas: 0, totalCreditos: 0, parcial: false }; }
                ['fixa', 'variavel', 'app', 'excluidas'].forEach(function (f) { a[f] = arred2(a[f] + numPos(m[f])); });
                if (Array.isArray(m.pagadores)) a.pagadores = somarPagadores(a.pagadores, m.pagadores);
                a.totalCreditos = Math.max(a.totalCreditos, numPos(m.totalCreditos));
                if (m.parcial === true || m.parcial === 'true') a.parcial = true;
            });
            if (Array.isArray(o.excluidasDetalhe)) det = det.concat(o.excluidasDetalhe);
        });
        return {
            titular: titular, periodoDocumentos: ini && fim ? { inicio: ini, fim: fim } : null,
            rendaMeses: ordem.map(function (k) { return porMes[k]; }), excluidasDetalhe: det
        };
    }

    // ── Leitura DETERMINISTICA de extrato Nubank (sem IA) ──────────────
    // O extrato do Nubank imprime o "Total de entradas" de CADA DIA e do mes. O codigo le cada entrada, soma e CONFERE com esses totais:
    // so aceita se TODOS os dias e o mes fecharem ao centavo; senao devolve null e a leitura volta para a IA (outros bancos, fotos, layout diferente).
    // A IA errava a soma de 150+ lancamentos (perdia uns, contava outros duas vezes) e o aviso amarelo "nao bate com o extrato" aparecia.
    var NU_MES_ABREV = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };
    var NU_MES_NOME = { JANEIRO: 1, FEVEREIRO: 2, MARCO: 3, ABRIL: 4, MAIO: 5, JUNHO: 6, JULHO: 7, AGOSTO: 8, SETEMBRO: 9, OUTUBRO: 10, NOVEMBRO: 11, DEZEMBRO: 12 };
    function nuSemAcento(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase(); }
    function nuValor(s) { return parseFloat(String(s).replace(/\./g, '').replace(',', '.')); }
    function nuIsoMes(a, m) { return a + '-' + (m < 10 ? '0' : '') + m; }
    function nuIsoData(a, m, d) { return nuIsoMes(a, m) + '-' + (d < 10 ? '0' : '') + d; }
    // Nome de quem pagou: o texto entre a descricao ("Transferencia recebida pelo Pix") e o primeiro " - " (CPF/CNPJ do pagador)
    function nuPagador(txt) {
        var t = String(txt || '').replace(/^(Transfer[eê]ncia recebida pelo Pix|Transfer[eê]ncia Recebida|Pix recebido|Transfer[eê]ncia recebida)\s+/i, '');
        var i = t.indexOf(' - ');
        return (i > 0 ? t.slice(0, i) : t).replace(/\s+/g, ' ').trim().slice(0, 60);
    }
    // Classifica UMA entrada pelas mesmas regras do prompt. Devolve { g: 'fixa'|'variavel'|'app'|'excluidas', motivo }
    function nuClassificar(txt, titular, cpfMeio) {
        var u = nuSemAcento(txt);
        if (/^RESGATE (RDB|DE |CDB|INVEST)|^RESGATE/.test(u)) return { g: 'excluidas', motivo: 'resgate RDB' };
        if (/^(REEMBOLSO|ESTORNO|DEVOLUCAO)/.test(u)) return { g: 'excluidas', motivo: u.indexOf('ESTORNO') === 0 ? 'estorno' : 'reembolso' };
        if (/^(RENDIMENTO|JUROS|CASHBACK)/.test(u)) return { g: 'excluidas', motivo: 'rendimento' };
        if (/^VALOR ADICIONADO NA CONTA/.test(u)) return { g: 'excluidas', motivo: 'valor adicionado por cartão de crédito' };   // Pix no crédito: o cliente usa o limite do cartão, não é renda
        if (/^CREDITO EM CONTA/.test(u)) return { g: 'excluidas', motivo: 'crédito em conta sem origem' };
        if (/EMPRESTIMO|FINANCIAMENTO|CONSIGNADO|ANTECIPACAO|SAQUE.ANIVERSARIO/.test(u)) return { g: 'excluidas', motivo: 'empréstimo' };
        if ((titular && u.indexOf(titular) !== -1) || (cpfMeio && u.indexOf(cpfMeio) !== -1)) return { g: 'excluidas', motivo: 'autotransferência' };
        if (/\b(UBER|99 ?TECNOLOGIA|99 ?POP|INDRIVER|IFOOD|RAPPI|LOGGI)\b/.test(u)) return { g: 'app', motivo: '' };
        if (/SALARIO|PROVENTOS|FOLHA DE PAG|\bINSS\b|APOSENTADORIA|PENSAO|BENEFICIO/.test(u)) return { g: 'fixa', motivo: '' };
        return { g: 'variavel', motivo: '' };
    }
    // Saidas e saldos do Nubank, lidos pelo CODIGO e provados: cada dia fecha com o "Total de saidas" impresso, a soma dos dias com o resumo
    // do extrato, e saldo inicial + entradas - saidas = saldo final. Prova que falha = os campos nao sao gravados (a tela volta a usar a IA).
    // Grava em cada mes: saidas (gasto real), saidasInvest (aplicacao), saidasProprias (Pix para a propria conta), saldoInicial/saldoFinal/menorSaldo (fim de cada dia).
    function nuAnexarSaidas(porMes, dias, saiDias, saiOrdem, saiOk, resumo) {
        if (!saiOk || !saiOrdem.length) return;
        var somaSai = 0, somaEnt = 0;
        for (var q = 0; q < saiOrdem.length; q++) {
            var sd = saiDias[saiOrdem[q]];
            if (Math.abs(sd.itens.reduce(function (a, it) { return a + it.v; }, 0) - sd.tot) > 0.011) return;
            somaSai += sd.tot;
        }
        if (resumo && Math.abs(somaSai - resumo.saidas) > 0.011) return;
        dias.forEach(function (d) { somaEnt += d.tot; });
        var ch = (resumo ? resumo.inicial + somaEnt - somaSai : null);
        var saldosOk = !!resumo && Math.abs(ch - resumo.final) <= 0.011;
        Object.keys(porMes).forEach(function (k) { var m = porMes[k]; m.saidas = 0; m.saidasInvest = 0; m.saidasProprias = 0; });
        saiOrdem.forEach(function (k) {
            var sd = saiDias[k], m = porMes[nuIsoMes(sd.a, sd.m)];
            if (!m) return;   // mes sem nenhuma entrada no extrato: nao entra na conta
            sd.itens.forEach(function (it) {
                var f = it.tipo === 'invest' ? 'saidasInvest' : it.tipo === 'proprio' ? 'saidasProprias' : 'saidas';
                m[f] = arred2(m[f] + it.v);
            });
        });
        if (!saldosOk) return;
        var ev = {};   // saldo no fim de cada dia (a ordem dentro do dia nao e impressa)
        dias.forEach(function (d) { var k = d.a * 10000 + d.m * 100 + d.d; ev[k] = (ev[k] || 0) + d.tot; });
        saiOrdem.forEach(function (k) { var sd = saiDias[k], kk = sd.a * 10000 + sd.m * 100 + sd.d; ev[kk] = (ev[kk] || 0) - sd.tot; });
        var saldo = resumo.inicial, st = {};
        Object.keys(ev).map(Number).sort(function (a, b) { return a - b; }).forEach(function (kk) {
            var mk = nuIsoMes(Math.floor(kk / 10000), Math.floor(kk / 100) % 100);
            if (!st[mk]) st[mk] = { ini: saldo, min: saldo };
            saldo = arred2(saldo + ev[kk]);
            st[mk].min = Math.min(st[mk].min, saldo); st[mk].fim = saldo;
        });
        Object.keys(st).forEach(function (mk) {
            if (!porMes[mk]) return;
            porMes[mk].saldoInicial = arred2(st[mk].ini); porMes[mk].saldoFinal = arred2(st[mk].fim); porMes[mk].menorSaldo = arred2(st[mk].min);
        });
    }
    // texto = texto do PDF (como montarTextoDigital entrega). Devolve o objeto no formato de somarTrechos ou null.
    var NU_ULTIMO = 0;   // numero do motivo da ultima recusa (diagnostico)
    function nuNao(n) { NU_ULTIMO = n; return null; }
    function lerExtratoNubank(texto) {
        var linhas = String(texto || '').split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
        var ini = 0;
        while (ini < linhas.length && /^(===|---)/.test(linhas[ini])) ini++;
        var nome = linhas[ini] || '', cab = linhas[ini + 1] || '';
        if (!/CPF/.test(cab) || !/Conta/.test(cab) || !/VALORES EM R\$/.test(texto) || !/Movimenta[cç][oõ]es/.test(texto)) return nuNao(1);
        var titular = nuSemAcento(nome), cpf = /(\d{3}\.\d{3})-/.exec(cab), cpfMeio = cpf ? cpf[1] : '';
        if (titular.length < 5) return nuNao(2);
        // total do mes e periodo (cabecalho da primeira pagina)
        var totMes = null, per = null, resumo = null, pm = /Total de entradas \+(\d[\d.]*,\d{2})/.exec(texto.replace(/\s+/g, ' '));
        if (pm) totMes = nuValor(pm[1]);
        if (totMes === null) {   // no texto do app os valores do resumo vem em linhas separadas, na ordem: saldo inicial, rendimento (+), entradas (+), saidas (-), saldo final
            for (var j = ini; j < Math.min(linhas.length - 2, ini + 40); j++) {
                var ra = /^\+(\d[\d.]*,\d{2})$/.exec(linhas[j]), rb = /^\+(\d[\d.]*,\d{2})$/.exec(linhas[j + 1]), rc = /^-(\d[\d.]*,\d{2})$/.exec(linhas[j + 2]);
                if (ra && rb && rc) {
                    totMes = nuValor(rb[1]);
                    var rsi = /^(\d[\d.]*,\d{2})$/.exec(linhas[j - 1] || ''), rsf = /^(\d[\d.]*,\d{2})$/.exec(linhas[j + 3] || '');
                    if (rsi && rsf) resumo = { inicial: nuValor(rsi[1]), rendimento: nuValor(ra[1]), entradas: totMes, saidas: nuValor(rc[1]), final: nuValor(rsf[1]) };
                    break;
                }
            }
        }
        var datas = [], rd = /(\d{1,2}) DE ([A-ZÇ]+) DE (\d{4})/g, md;
        while ((md = rd.exec(nuSemAcento(texto))) && datas.length < 2) { var mn = NU_MES_NOME[md[2]]; if (mn) datas.push({ a: +md[3], m: mn, d: +md[1] }); }
        if (datas.length === 2) per = { inicio: nuIsoData(datas[0].a, datas[0].m, datas[0].d), fim: nuIsoData(datas[1].a, datas[1].m, datas[1].d) };

        var dias = [], dia = null, modo = '', pend = null, pulando = false;
        var saiDias = {}, saiOrdem = [], diaSai = null, pendS = null, saiOk = true;   // SAIDAS: lidas e provadas dia a dia contra o "Total de saidas" impresso; se algo nao fechar, so as saidas ficam sem prova (a renda segue valendo)
        var RE_INICIO = /^(Transfer[eê]ncia|Resgate|Reembolso|Estorno|Cr[eé]dito|Dep[oó]sito|Pix\b(?!\s*$)|Valor adicionado na conta|Rendimento|Pagamento|Cashback|Devolu|Aplica|Compra|Ajuste|Boleto|Saque|Estorno)/;
        // Uma entrada = a linha de inicio + as linhas de continuacao (nome do pagador, banco, agencia). O valor e a UNICA linha que termina em "1.234,56".
        function fecharEntrada() {
            if (!pend) return true;
            var valores = [];
            pend.forEach(function (l) { var mv = /(?:^|\s)(\d[\d.]*,\d{2})$/.exec(l); if (mv) valores.push(nuValor(mv[1])); });
            if (valores.length !== 1 || !dia) return false;
            var cl = nuClassificar(pend.join(' '), titular, cpfMeio);
            dia.itens.push({ v: valores[0], g: cl.g, motivo: cl.motivo, nome: cl.g === 'variavel' ? nuPagador(pend.join(' ')) : '' });
            pend = null;
            return true;
        }
        var RE_INICIO_SAIDA = /^(Transfer[eê]ncia|Pagamento|Aplica|Compra|Boleto|Saque|Pix\b(?!\s*$)|Plano|D[eé]bito|Tarifa|Recarga|Anuidade|IOF|Fatura|Parcela|Seguro|Mensalidade|Ajuste|Estorno|Resgate)/;
        // Uma saida = mesma ideia da entrada. 'invest' (aplicacao RDB) e 'proprio' (Pix para a propria conta do titular) nao sao gasto.
        function fecharSaida() {
            if (!pendS) return true;
            var valores = [];
            pendS.forEach(function (l) { var mv = /(?:^|\s)(\d[\d.]*,\d{2})$/.exec(l); if (mv) valores.push(nuValor(mv[1])); });
            var u = nuSemAcento(pendS.join(' '));
            pendS = null;
            if (valores.length !== 1 || !diaSai) return false;
            var tipo = /^APLICA/.test(u) ? 'invest' : ((titular && u.indexOf(titular) !== -1) || (cpfMeio && u.indexOf(cpfMeio) !== -1)) ? 'proprio' : 'real';
            diaSai.itens.push({ v: valores[0], tipo: tipo });
            return true;
        }
        function abrirDiaSaida(a, m, d, tot) {
            var k = a + '-' + m + '-' + d;
            if (!saiDias[k]) { saiDias[k] = { a: a, m: m, d: d, tot: 0, itens: [] }; saiOrdem.push(k); }
            saiDias[k].tot = arred2(saiDias[k].tot + tot);
            return saiDias[k];
        }
        for (var i = ini + 2; i < linhas.length; i++) {
            var ln = linhas[i];
            if (/^(===|---)/.test(ln)) { pulando = false; continue; }   // fim da pagina: o rodape acaba junto (extrato sem a linha "Extrato gerado" nao pode engolir o resto)
            if (/^(Tem alguma d[uú]vida|Asseguramos a autenticidade)/.test(ln)) { pulando = true; continue; }
            if (pulando) { if (/^Extrato gerado/.test(ln)) pulando = false; continue; }
            if (/^\d+ de \d+$/.test(ln)) continue;   // "5 de 16" (numero da pagina, quebrado em outra linha)
            if (nuSemAcento(ln) === titular || /CPF.*Ag[eê]ncia.*Conta|VALORES EM R\$|^\d{5,}-\d$/.test(ln)) continue;   // cabecalho repetido em cada pagina
            var dh = /^(?:(\d{1,2}) ([A-Z]{3}) (\d{4}) )?Total de entradas \+ (\d[\d.]*,\d{2})$/.exec(ln);
            var ds = /^(?:(\d{1,2}) ([A-Z]{3}) (\d{4}) )?Total de sa[ií]das /.test(ln);
            var dsv = ds ? /^(?:(\d{1,2}) ([A-Z]{3}) (\d{4}) )?Total de sa[ií]das - ?(\d[\d.]*,\d{2})$/.exec(ln) : null;
            var dd = /^(\d{1,2}) ([A-Z]{3}) (\d{4}) /.exec(ln);
            if (dh || ds || dd) {
                if (!fecharEntrada()) return nuNao(3);
                if (!fecharSaida()) saiOk = false;
                if (dh) {
                    var ant = dia;
                    if (dh[1]) { var mm = NU_MES_ABREV[dh[2]]; if (!mm) return nuNao(4); dia = { a: +dh[3], m: mm, d: +dh[1], tot: nuValor(dh[4]), itens: [] }; }
                    else if (ant) dia = { a: ant.a, m: ant.m, d: ant.d, tot: nuValor(dh[4]), itens: [] };   // dia que quebrou de pagina: a data veio na pagina anterior
                    else return nuNao(5);
                    dias.push(dia); modo = 'in';
                } else {
                    modo = 'out';
                    if (dd && !dh) { if (!NU_MES_ABREV[dd[2]]) return nuNao(6); dia = { a: +dd[3], m: NU_MES_ABREV[dd[2]], d: +dd[1], tot: 0, itens: [], soSaidas: true }; }
                    if (dsv && dia) diaSai = abrirDiaSaida(dia.a, dia.m, dia.d, nuValor(dsv[4]));   // o dia da saida e o da linha (ou o do bloco de entradas logo acima)
                    else { diaSai = null; saiOk = false; }
                }
                continue;
            }
            if (modo === 'out') {   // itens de saida (so conferencia: qualquer duvida aqui NAO derruba a leitura da renda). Item novo = 1a linha depois do total do dia ou linha de inicio conhecida
                if (!pendS || RE_INICIO_SAIDA.test(ln)) { if (!fecharSaida()) saiOk = false; pendS = [ln]; }
                else pendS.push(ln);
                continue;
            }
            if (modo !== 'in') continue;
            if (RE_INICIO.test(ln)) { if (!fecharEntrada()) return nuNao(7); pend = [ln]; }
            else if (pend) pend.push(ln);
            else return nuNao(9);
        }
        if (!fecharEntrada() || !dias.length) return nuNao(10);
        if (!fecharSaida()) saiOk = false;
        // conferencia: cada dia fecha ao centavo e a soma dos dias fecha com o total do mes impresso
        var somaDias = 0;
        for (var k = 0; k < dias.length; k++) {
            var s = dias[k].itens.reduce(function (a, it) { return a + it.v; }, 0);
            if (Math.abs(s - dias[k].tot) > 0.011) return nuNao(11);
            somaDias += dias[k].tot;
        }
        if (totMes !== null && Math.abs(somaDias - totMes) > 0.011) return nuNao(12);
        var porMes = {}, ordem = [], det = [];
        dias.forEach(function (d) {
            var k = nuIsoMes(d.a, d.m);
            if (!porMes[k]) { ordem.push(k); porMes[k] = { mes: k, fixa: 0, variavel: 0, app: 0, excluidas: 0, totalCreditos: 0, parcial: false }; }
            d.itens.forEach(function (it) {
                porMes[k][it.g] = arred2(porMes[k][it.g] + it.v);
                if (it.g === 'excluidas') det.push({ mes: k, valor: it.v, motivo: it.motivo });
                else if (it.g === 'variavel' && it.nome) porMes[k].pagadores = somarPagadores(porMes[k].pagadores, [{ nome: it.nome, valor: it.v }]);
            });
        });
        if (ordem.length === 1 && totMes !== null) porMes[ordem[0]].totalCreditos = arred2(totMes);   // extrato de mais de um mes: o total impresso e do periodo, nao de um mes
        det.sort(function (a, b) { return b.valor - a.valor; });
        nuAnexarSaidas(porMes, dias, saiDias, saiOrdem, saiOk, resumo);
        return {
            titular: nome, periodoDocumentos: per, rendaMeses: ordem.map(function (k) { return porMes[k]; }),
            excluidasDetalhe: det.slice(0, 8), leituraCodigo: 'nubank'
        };
    }

    // ── Leitura UNIVERSAL de extrato digital (qualquer banco, sem leitor por banco) ──────────────────────────
    // O CODIGO acha todos os lancamentos (data, descricao, valor, saldo) e PROVA que nao faltou nenhum pela cadeia de saldos:
    // cada linha traz o saldo depois dela, entao saldo(linha) - saldo(linha anterior) tem que ser igual ao valor da linha.
    // Linha perdida, valor lido errado ou pagina faltando QUEBRAM a cadeia. O sinal (entrada/saida) tambem sai dessa conta,
    // sem depender de coluna Credito/Debito. A IA so CLASSIFICA a lista numerada de entradas; quem soma e o codigo.
    // Se a cadeia nao fechar em tudo, devolve null e a leitura volta para o leitor de antes (nunca fica pior).
    var UN_ULTIMO = '';   // motivo da ultima recusa (diagnostico)
    var UN_FOLGA_DIAS = 15;
    var UN_LOTE = 120;    // entradas por chamada da IA
    function unNao(m) { UN_ULTIMO = m; return null; }
    function unNormalizarLinha(s) {
        return String(s == null ? '' : s)
            .replace(/R\s*\$/g, 'R$')
            .replace(/(\d)\s+([.,])\s*(?=\d)/g, '$1$2')                                          // "13 , 58" -> "13,58"
            .replace(/(\d[.,])\s+(?=\d)/g, '$1')
            .replace(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/g, '$1/$2/$3')                 // "13 / 11 / 2026"
            .replace(/\s+/g, ' ').trim();
    }
    // Todos os valores em reais da linha, com o sinal impresso (-1 saida, +1 entrada, 0 sem sinal): -R$ 1,00 | R$ -1,00 | 1,00 D | 1,00- | (-) 1,00
    function unAchaDinheiro(ln) {
        var re = /\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)/g, m, out = [];
        while ((m = re.exec(ln))) {
            var ini = m.index, fim = ini + m[0].length;
            if (ini > 0 && /[\d.,]/.test(ln.charAt(ini - 1))) continue;
            if (ln.charAt(fim) === '%') continue;
            var pre = ln.slice(Math.max(0, ini - 12), ini), sinal = 0, ini2 = ini, fim2 = fim, mp;
            if ((mp = /(\(\s?-\s?\)|[-+−–])? ?R\$ ?([-+−–])?$/.exec(pre))) {   // com R$: o sinal vem antes ou depois do R$
                var sg = mp[2] || mp[1] || '';
                sinal = sg === '+' ? 1 : sg ? -1 : 0;
                ini2 = ini - mp[0].length;
            } else if ((mp = /(\(\s?-\s?\) ?|[-+−–])$/.exec(pre))) {   // sem R$: so vale o sinal COLADO no numero ("- 1.000,00" com espaco e separador de coluna)
                sinal = mp[1].charAt(0) === '+' ? 1 : -1;
                ini2 = ini - mp[0].length;
            }
            var suf = ln.slice(fim, fim + 3), ms;
            if ((ms = /^ ?([CD])(?![A-Za-z])/.exec(suf))) { sinal = ms[1] === 'C' ? 1 : -1; fim2 = fim + ms[0].length; }
            else if (/^-(?![\w])/.test(suf)) { sinal = -1; fim2 = fim + 1; }
            out.push({ v: nuValor(m[0]), s: sinal, ini: ini2, fim: fim2 });
        }
        return out;
    }
    // Datas da linha: dd/mm/aaaa (/ - .), dd/mm/aa, "12 de novembro (de) 2026" e, com anoRef, "dd/mm" colado no inicio da linha
    function unAchaDatas(ln, anoRef) {
        var out = [], m, re = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})(?!\d)/g;
        while ((m = re.exec(ln))) {
            if (m.index > 0 && /[\d\/\-.,]/.test(ln.charAt(m.index - 1))) continue;
            var a = +m[3]; if (a < 100) a += 2000;
            if (+m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12 && a >= 2000 && a <= 2100) out.push({ a: a, m: +m[2], d: +m[1], ini: m.index, fim: m.index + m[0].length });
        }
        var re2 = /(\d{1,2}) de ([A-Za-zÀ-ÿ]+)(?: de)? (\d{4})/g, n;
        while ((n = re2.exec(ln))) {
            var mm = NU_MES_NOME[nuSemAcento(n[2])];
            if (mm && +n[1] >= 1 && +n[1] <= 31) out.push({ a: +n[3], m: mm, d: +n[1], ini: n.index, fim: n.index + n[0].length });
        }
        if (anoRef && !out.length) {   // extrato sem ano nas datas ("05/08 PIX ..."): o ano vem do cabecalho
            var m3 = /^(?:[A-Za-zÀ-ÿ\-]{0,14}[, ]+)?(\d{1,2})\/(\d{1,2})(?![\d\/])/.exec(ln);
            if (m3 && +m3[1] >= 1 && +m3[1] <= 31 && +m3[2] >= 1 && +m3[2] <= 12) out.push({ a: anoRef, m: +m3[2], d: +m3[1], ini: m3[0].length - (m3[1].length + m3[2].length + 1), fim: m3[0].length });
        }
        return out.sort(function (x, y) { return x.ini - y.ini; });
    }
    function unIso(d) { return d ? nuIsoData(d.a, d.m, d.d) : ''; }
    // Linha de saldo (nao e lancamento). "TRANSF SALDO C/SAL" e lancamento: so vale o inicio da frase ou as expressoes de saldo conhecidas.
    var UN_RE_SALDO = /^(?:\([+=\-]\) ?)?SALDO (?:DO DIA|FINAL|INICIAL|ANTERIOR|EM CONTA|DE CONTA|DISPONIVEL|BLOQUEADO|AO FINAL|PARCIAL|TOTAL|ATUAL|DA CONTA|CONTABIL|EM \d)|SALDO (?:AO FINAL DO DIA|DO DIA)\b/;
    var UN_RE_RESUMO = /^(?:\([+=\-]\) ?)?(?:(?:ENTRADAS?|SAIDAS?|CREDITOS|DEBITOS) ?:|TOTAL |LIMITE |RESUMO\b|JUROS (?:VENCIDOS|REMANESC|PREVISTOS)|TARIFAS (?:VENCIDAS|REMANESC)|PREVISAO|CHEQUE ESPECIAL|ENCARGOS|VENCIMENTO |TAXA |CUSTO EFETIVO|IOF PREV|SALDO BLOQUEADO)/;
    var UN_RE_CAB = /^DATA\b.*\b(?:DESCRICAO|HISTORICO|LANCAMENTOS?|MOVIMENTA\w*)\b.*\bSALDO\b/;   // cabecalho da tabela de lancamentos com coluna de saldo (reabre a leitura depois de um saldo final; tabelas de cartao/comprovantes nao reabrem)
    var UN_RE_ANO = /\b(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)[A-Z]*\/(20\d\d)\b/;
    var UN_RE_DATA_PREFIXO = /\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2} de [A-Za-zÀ-ÿ]+(?: de)? \d{4}|^\d{1,2}:\d{2}(?::\d{2})?|^\d{1,2}\/\d{1,2}(?![\d\/])/g;

    // Prova na ordem do tempo: entre dois saldos conhecidos (saldo de uma linha, saldo anterior, saldo final, saldo do dia),
    // a soma das linhas tem que ser a diferenca dos saldos. Devolve { ok, ... } ou { erro }.
    function unProvar(rs, anc, rev) {
        var n = rs.length, i, q, viol = 0, dm = [], maxD = '', desord = false;
        for (q = 0; q < n; q++) {   // datas na ordem do tempo; alguns bancos (Santander) datam compras de debito uns dias fora do lugar: ai so valem os saldos de linha, nao os "saldo em dd/mm"
            var dq = unIso(rs[q].data);
            if (maxD && dq < maxD) { viol++; if (Math.round((Date.parse(maxD) - Date.parse(dq)) / 86400000) > 5) desord = true; }
            if (dq > maxD) maxD = dq;
            dm.push(maxD);
        }
        if (viol > Math.max(2, n * 0.05)) desord = true;
        var ini = dm[0], fim = dm[n - 1], A = [];
        rs.forEach(function (r, k) { if (r.saldo !== null) A.push({ pos: k + 1, bal: r.saldo }); });
        anc.forEach(function (a) {
            var pos = -1;
            if (a.tipo === 'abertura') pos = 0;
            else if (a.tipo === 'fechamento') pos = n;
            else if (a.tipo === 'linha') pos = Math.max(0, Math.min(n, rev ? n - a.idx : a.idx));   // saldo impresso entre dois lancamentos (Itau: "saldo do dia" antes dos lancamentos do dia)
            else if (a.data) { var d = unIso(a.data); pos = d < ini ? 0 : d >= fim ? n : desord ? -1 : dm.filter(function (x) { return x <= d; }).length; }
            if (pos >= 0) A.push({ pos: pos, bal: a.bal });
        });
        A.sort(function (x, y) { return x.pos - y.pos; });
        var P = [];   // uma ancora por posicao (as repetidas tem que concordar)
        for (i = 0; i < A.length; i++) {
            if (P.length && P[P.length - 1].pos === A[i].pos) { if (Math.abs(P[P.length - 1].bal - A[i].bal) > 0.011) return { erro: 'dois saldos diferentes na mesma posicao (' + P[P.length - 1].bal + ' x ' + A[i].bal + ')' }; }
            else P.push(A[i]);
        }
        if (P.length < (desord ? 3 : 2)) return { erro: (desord ? 'datas fora de ordem e poucos saldos (' : 'saldos insuficientes (') + P.length + ')' };
        var fora = P[0].pos + (n - P[P.length - 1].pos);
        var melhorD = null;
        [1, -1].forEach(function (d) {   // sinal das linhas sem sinal impresso quando ha mais de uma por trecho: todas entrada (+1) ou todas saida (-1)
            var sinal = new Array(n), quebras = 0, primeira = '', k;
            for (k = 0; k < n; k++) sinal[k] = rs[k].s || 0;
            for (var s = 0; s + 1 < P.length; s++) {
                var a0 = P[s], b0 = P[s + 1], conh = 0, U = [];
                for (k = a0.pos; k < b0.pos; k++) { if (sinal[k]) conh += sinal[k] * rs[k].v; else U.push(k); }
                var alvo = b0.bal - a0.bal - conh, ok = false;
                if (!U.length) ok = Math.abs(alvo) <= 0.011;
                else if (U.length === 1) {
                    var vv = rs[U[0]].v;
                    if (Math.abs(alvo - vv) <= 0.011) { sinal[U[0]] = 1; ok = true; } else if (Math.abs(alvo + vv) <= 0.011) { sinal[U[0]] = -1; ok = true; }
                } else {
                    var tot = 0; U.forEach(function (u) { tot += d * rs[u].v; });
                    if (Math.abs(alvo - tot) <= 0.011) { U.forEach(function (u) { sinal[u] = d; }); ok = true; }
                }
                if (!ok) { quebras++; if (!primeira) primeira = 'trecho linhas ' + (a0.pos + 1) + '-' + b0.pos + ' saldo ' + a0.bal + ' -> ' + b0.bal + ', soma lida ' + (b0.bal - a0.bal - alvo).toFixed(2) + ' (faltam ' + alvo.toFixed(2) + '): ' + (rs[a0.pos] ? (rs[a0.pos].antes + ' ' + rs[a0.pos].linha).slice(0, 40) : ''); }
            }
            if (!melhorD || quebras < melhorD.quebras) melhorD = { sinal: sinal, quebras: quebras, primeira: primeira };
        });
        if (melhorD.quebras) return { erro: 'saldos nao fecham em ' + melhorD.quebras + ' de ' + (P.length - 1) + ' trechos, primeiro: ' + melhorD.primeira };
        return { ok: true, sinal: melhorD.sinal, ancoras: P.length, fora: fora, foraIni: P[0].pos };
    }

    // Layout "Relatorio de movimentacoes" (InfinitePay/CloudWalk): linhas "HH:MM Tipo Nome Detalhe +/-valor" SEM data na linha (a data vem dos rotulos
    // "05 Out, 2026" impressos no fim de cada pagina, um por bloco de dia) e "Saldo do dia" fechando cada dia. O resumo do topo traz saldo inicial,
    // total de entradas, total de saidas e saldo final. PROVA: saldo anterior + soma do dia = "Saldo do dia", entradas/saidas somadas = totais impressos
    // e o saldo final fecha. Devolve undefined (nao e esse layout), null (e esse layout mas a prova nao fechou) ou o mesmo formato do leitor universal.
    var UN_RE_ROTULO_DIA = /^(\d{1,2}) (JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)[A-Z]*\.?,? (\d{4})$/i;
    var UN_RE_VALOR_FIM = /([+\-−–]+)\s*(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
    var UN_MES_ABREV = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };
    function unLerPorDia(linhas) {
        if (!/Relat[oó]rio de movimenta/i.test(linhas.slice(0, 12).join(' '))) return undefined;
        if (!linhas.some(function (l) { return /^Data Hora Tipo de transa/i.test(l); }) || !linhas.some(function (l) { return /^Saldo do dia\b/i.test(l); })) return undefined;
        var assinado = function (sg, num) { return (/\+/.test(sg) ? 1 : -1) * nuValor(num); };
        var rotulo = function (m) { return { a: +m[3], m: UN_MES_ABREV[m[2].toUpperCase()], d: +m[1] }; };
        var NUM = '([+\\-−–]) ?(\\d{1,3}(?:\\.\\d{3})*,\\d{2})$', R = {
            ini: new RegExp('^Saldo inicial ' + NUM, 'i'), ent: new RegExp('^Total de entradas ' + NUM, 'i'),
            sai: new RegExp('^Total de sa[ií]das ' + NUM, 'i'), fim: new RegExp('^Saldo fi ?nal do per[ií]odo ' + NUM, 'i'), dia: new RegExp('^Saldo do dia ' + NUM, 'i')
        };
        var resumo = {}, per = null, titular = '', pag = 0, totPag = 0, vistas = {}, rotulos = {}, segsPag = {}, segs = [], seg = null, aberta = null, m, i;
        for (i = 0; i < linhas.length; i++) {
            var ln = linhas[i];
            if ((m = /^P[aá]gina (\d+) de (\d+)\b/i.exec(ln))) { pag = +m[1]; totPag = +m[2]; vistas[pag] = 1; rotulos[pag] = []; segsPag[pag] = []; continue; }
            if (/^Relat[oó]rio de movimenta/i.test(ln) || / - \d{4} - [\dXx-]+$/.test(ln)) continue;   // cabecalho repetido em toda pagina (nome da conta, banco - agencia - conta)
            if (/CNPJ:|CPF:/.test(ln)) { if (!titular && (m = /^(?:[\d.]+ )?(.+?) - (?:CNPJ|CPF):/i.exec(ln))) titular = nuSemAcento(m[1]).replace(/\s+/g, ' ').trim(); continue; }
            if (/^Data Hora Tipo de transa/i.test(ln)) {
                if (aberta) return unNao('linha sem valor (' + aberta.txt.slice(0, 40) + ')');
                seg = { pag: pag, idx: segsPag[pag] ? segsPag[pag].length : 0, rows: [], saldoFim: null }; segs.push(seg); if (segsPag[pag]) segsPag[pag].push(seg);
                continue;
            }
            if (!seg) {   // resumo do topo da 1a pagina
                if (!per && (m = /^(\d{1,2}) (JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)[A-Z]*\.?,? (\d{4}) - (\d{1,2}) (JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)[A-Z]*\.?,? (\d{4})/i.exec(ln))) {
                    per = { inicio: unIso(rotulo([0, m[1], m[2], m[3]])), fim: unIso(rotulo([0, m[4], m[5], m[6]])) }; continue;
                }
                ['ini', 'ent', 'sai', 'fim'].forEach(function (k) { var r = R[k].exec(ln); if (r && !(k in resumo)) resumo[k] = k === 'ini' || k === 'fim' ? assinado(r[1], r[2]) : Math.abs(assinado(r[1], r[2])); });   // entradas/saidas ficam positivas
                continue;
            }
            if (!aberta && (m = R.dia.exec(ln))) { seg.saldoFim = assinado(m[1], m[2]); seg.fechado = true; continue; }
            if (!aberta && (m = UN_RE_ROTULO_DIA.exec(ln))) { if (rotulos[pag]) rotulos[pag].push(rotulo(m)); continue; }
            if ((m = /^(\d{1,2}):(\d{2})\b ?(.*)$/.exec(ln))) {
                if (aberta) return unNao('linha sem valor (' + aberta.txt.slice(0, 40) + ')');
                if (seg.fechado) return unNao('lancamento depois do saldo do dia');
                aberta = { txt: m[3] || '' };
            } else if (aberta) aberta.txt += ' ' + ln;
            else continue;   // sobra de pagina (rodape, aviso): so vale linha que abre com hora
            var mv = UN_RE_VALOR_FIM.exec(aberta.txt);
            if (mv) { seg.rows.push({ v: assinado(mv[1], mv[2]), desc: aberta.txt.slice(0, mv.index).replace(/\s+/g, ' ').trim() }); aberta = null; }
        }
        if (aberta) return unNao('linha sem valor no fim (' + aberta.txt.slice(0, 40) + ')');
        if (!per || ['ini', 'ent', 'sai', 'fim'].some(function (k) { return typeof resumo[k] !== 'number' || !isFinite(resumo[k]); })) return unNao('resumo do topo (saldo inicial, entradas, saidas, saldo final) nao encontrado');
        for (i = 1; i <= totPag; i++) if (!vistas[i]) return unNao('pagina ' + i + ' de ' + totPag + ' ausente no texto');
        if (!totPag) return unNao('paginas nao numeradas');
        // data de cada bloco = rotulo de mesmo numero na pagina; sem rotulos certos so vale se o periodo inteiro e um mes so
        var umMes = per.inicio.slice(0, 7) === per.fim.slice(0, 7), lanc = [], corrente = resumo.ini, ent = 0, sai = 0, ultData = '', dias = 0;
        for (i = 0; i < segs.length; i++) {
            var sg = segs[i], rs = rotulos[sg.pag] || [], ps = segsPag[sg.pag] || [], dt = null;
            if (rs.length === ps.length) dt = rs[sg.idx]; else if (umMes) { var pi = (ultData || per.inicio).split('-'); dt = { a: +pi[0], m: +pi[1], d: +pi[2] }; } else return unNao('rotulos de dia nao batem com os blocos na pagina ' + sg.pag + ' (' + rs.length + ' x ' + ps.length + ')');
            var iso = unIso(dt);
            if (iso < per.inicio || iso > per.fim) return unNao('dia ' + iso + ' fora do periodo ' + per.inicio + ' a ' + per.fim);
            if (iso < ultData) return unNao('dias fora de ordem em ' + iso);
            ultData = iso;
            for (var r = 0; r < sg.rows.length; r++) {
                var row = sg.rows[r];
                corrente = arred2(corrente + row.v);
                if (row.v > 0) ent = arred2(ent + row.v); else sai = arred2(sai - row.v);
                var d2 = row.desc;
                if (titular && /\b(?:PIX|TED)\b/.test(nuSemAcento(d2)) && nuSemAcento(d2).indexOf(titular) !== -1) d2 += ' (propria conta)';   // Pix/TED com o nome do proprio titular
                lanc.push({ i: lanc.length, data: iso, mes: nuIsoMes(dt.a, dt.m), valor: row.v, saldo: corrente, desc: d2.slice(0, 150) });
            }
            if (sg.saldoFim !== null) { dias++; if (Math.abs(corrente - sg.saldoFim) > 0.011) return unNao('saldo do dia ' + iso + ' nao fecha: lido ' + corrente.toFixed(2) + ' x impresso ' + sg.saldoFim.toFixed(2)); }
        }
        if (lanc.length < 1) return unNao('nenhum lancamento (layout por hora)');
        if (Math.abs(ent - resumo.ent) > 0.005 || Math.abs(sai - resumo.sai) > 0.005) return unNao('totais nao fecham: entradas ' + ent.toFixed(2) + ' x ' + resumo.ent.toFixed(2) + ', saidas ' + sai.toFixed(2) + ' x ' + resumo.sai.toFixed(2));
        if (Math.abs(corrente - resumo.fim) > 0.011) return unNao('saldo final nao fecha: ' + corrente.toFixed(2) + ' x ' + resumo.fim.toFixed(2));
        return { lanc: lanc, periodo: per, cabecalho: linhas.slice(0, 8).join(' | ').slice(0, 300), prova: { dir: 'asc', pares: dias + 1, linhas: lanc.length, fora: 0, secoes: 1 } };
    }

    // texto = texto do PDF (como montarTextoDigital entrega). Devolve { lanc:[{i,data,mes,valor,saldo,desc}], periodo, ... } ou null.
    function lerExtratoUniversal(texto) {
        var T = String(texto || '');
        if (T.indexOf('RESTANTE DESTE ARQUIVO CORTADO') !== -1) return unNao('arquivo cortado por tamanho');
        var linhas = [];
        T.split('\n').forEach(function (l) { if (/^(---|===)/.test(l)) return; var n = unNormalizarLinha(l); if (n) linhas.push(n); });
        if (linhas.length < 8) return unNao('texto curto');
        var porDia = unLerPorDia(linhas);   // layout por hora com "Saldo do dia" (InfinitePay): leitor proprio, com a mesma prova
        if (porDia !== undefined) return porDia;
        // ano de referencia (extratos com datas "05/08"): primeira data completa ou "agosto/2026" do cabecalho
        var anoRef = 0, cheias = 0, ia, anosMes = 0, anos = {};
        for (ia = 0; ia < linhas.length; ia++) {
            var dc = unAchaDatas(linhas[ia]);
            if (dc.length && dc[0].ini <= 12) cheias++;
            if (ia < 80) {   // "agosto/2026" no cabecalho vale mais que uma data solta (ex.: "versao 27/11/2024" impressa em toda pagina)
                var my = UN_RE_ANO.exec(nuSemAcento(linhas[ia])); if (my && !anosMes) anosMes = +my[1];
                dc.forEach(function (x) { anos[x.a] = (anos[x.a] || 0) + 1; });
            }
        }
        anoRef = anosMes || +Object.keys(anos).sort(function (x, y) { return anos[y] - anos[x]; })[0] || 0;
        var semAno = anoRef && cheias < 3 ? anoRef : 0;   // so aceita "dd/mm" quando o extrato quase nao tem data completa (evita confundir "4/12" de pagina)
        // ── 1) lancamentos e linhas de saldo ──
        var secs = [], sec = { recs: [], anc: [], fechada: false }, pend = [], dataAtual = null, ultimo = null, rotulo = '', fecha = [];
        secs.push(sec);
        for (var i = 0; i < linhas.length; i++) {
            var ln = linhas[i], din = unAchaDinheiro(ln), dts = unAchaDatas(ln, semAno);
            var inicia = (dts.length > 0 && dts[0].ini <= 12 && /^[A-Za-zÀ-ÿ\-]{0,14}[, ]*$/.test(ln.slice(0, dts[0].ini))) || /^\d{1,2}:\d{2}(?::\d{2})?\b/.test(ln);
            var resto = ln;
            for (var k = din.length - 1; k >= 0; k--) resto = resto.slice(0, din[k].ini) + ' ' + resto.slice(din[k].fim);
            var cabPeriodo = dts.length >= 2 && !din.length && /PERIODO|\bAL\b|\bATE\b|\bA\b/.test(nuSemAcento(ln));   // "De 01-09-2026 al 30-09-2026": periodo do cabecalho, nao abre lancamento
            if (dts.length && inicia && !cabPeriodo) dataAtual = dts[0];
            var rotAnt = rotulo; rotulo = '';
            var rs = resto.replace(/\s+/g, ' ').trim(), corpo = rs.replace(UN_RE_DATA_PREFIXO, ' ').replace(/\s+/g, ' ').trim();
            var U = nuSemAcento(rs).replace(/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4} /, '').replace(/^\d{1,2}\/\d{1,2} /, '').replace(/^\d{1,2}:\d{2}(?::\d{2})? /, '');
            if (!din.length) {
                if (sec.fechada && UN_RE_CAB.test(U)) { sec = { recs: [], anc: [], fechada: false }; secs.push(sec); ultimo = null; pend = []; continue; }   // depois do saldo final so volta a ler lancamentos num novo cabecalho de tabela
                if (sec.fechada) continue;
                if (inicia) {   // linha que abre um lancamento (data/hora) sem valor ainda
                    if (pend.length && ultimo && ultimo.unica) ultimo.depois = pend.join(' ').slice(0, 120);
                    pend = [];
                    if (corpo.length > 2 && !UN_RE_SALDO.test(nuSemAcento(corpo)) && !UN_RE_RESUMO.test(nuSemAcento(corpo))) pend.push(corpo);
                } else if (UN_RE_SALDO.test(U)) {   // "Saldo em conta" numa linha e o valor na seguinte
                    if (U.length < 40) rotulo = /SALDO (?:ANTERIOR|INICIAL)/.test(U) ? 'abertura' : /SALDO (?:FINAL|ATUAL)/.test(U) ? 'fechamento' : 'linha';
                } else if (!UN_RE_RESUMO.test(U)) pend.push(rs);
                if (pend.length > 12) pend = pend.slice(-12);
                continue;
            }
            // linha com valor: saldo (ancora), resumo ou lancamento
            if (sec.fechada) continue;   // tabelas depois do saldo final (resumo por periodo, comprovantes...) nao sao lancamentos
            if (rotAnt && !dts.length && !rs) {   // valor da linha de saldo que veio so com o rotulo na linha de cima
                var vb = din[din.length - 1], balR = (vb.s < 0 ? -1 : 1) * vb.v;
                if (rotAnt === 'abertura') sec.anc.push({ tipo: 'abertura', data: null, bal: balR, soft: true });
                else if (rotAnt === 'fechamento') fecha.push({ tipo: 'fechamento', data: null, bal: balR, soft: true });
                else sec.anc.push({ tipo: 'linha', idx: sec.recs.length, bal: balR, soft: true });
                pend = []; continue;
            }
            if (UN_RE_SALDO.test(U) || /\bSALDO (?:DO DIA|AO FINAL DO DIA|FINAL DO DIA)\b/.test(U)) {
                var tl = din[din.length - 1], tf = din[0];
                var bal = (din.length >= 2 && tl.v === 0 && tf.v > 0) ? (tf.s < 0 ? -1 : 1) * tf.v : (tl.s < 0 ? -1 : 1) * tl.v;   // "SALDO ANTERIOR 4.659,16 C 0,00 C": o saldo e o primeiro
                var emD = /\bEM (\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(rs), dtA = dts[0] || null;
                if (!dtA && emD && anoRef) dtA = { a: emD[3] ? (+emD[3] < 100 ? 2000 + +emD[3] : +emD[3]) : anoRef, m: +emD[2], d: +emD[1] };
                var tipo = /SALDO (?:ANTERIOR|INICIAL)/.test(U) ? 'abertura' : /SALDO (?:FINAL|ATUAL)(?! DO DIA)/.test(U) && !dtA ? 'fechamento' : (dtA ? 'dia' : '');
                if (tipo) {
                    var a1 = { tipo: tipo, data: dtA, bal: bal }, ult = sec.recs.length ? sec.recs[sec.recs.length - 1] : null;
                    var ehFim = tipo === 'fechamento' || (/SALDO (?:FINAL|ATUAL|EM \d)/.test(U) && !/DO DIA/.test(U) && dtA && ult && unIso(dtA) >= unIso(ult.data));
                    if (ehFim && ult && (ult.saldo !== null ? Math.abs(ult.saldo - bal) <= 0.011 : true)) { sec.anc.push(a1); sec.fechada = true; }   // fecha com o ultimo lancamento: o que vem depois (resumos, comprovantes) nao e lancamento
                    else if (tipo === 'fechamento') fecha.push(a1);   // saldo final impresso fora do lugar (topo/rodape da 1a pagina): vale no fim do extrato
                    else sec.anc.push(a1);
                }
                pend = []; continue;
            }
            if (UN_RE_RESUMO.test(U)) { pend = []; continue; }
            if (inicia && dts.length && !corpo && !pend.length && din.length === 1) {   // so data e valor: saldo do dia sem o rotulo (Itau)
                sec.anc.push({ tipo: 'linha', idx: sec.recs.length, bal: (din[0].s < 0 ? -1 : 1) * din[0].v, soft: true });
                continue;
            }
            if (!dataAtual) { pend = []; continue; }   // valor antes de qualquer data (cabecalho/resumo)
            var unica = inicia;
            if (ultimo && ultimo.unica && pend.length) { ultimo.depois = pend.join(' ').slice(0, 120); pend = []; }
            var vt = din.length >= 2 ? din[din.length - 2] : din[din.length - 1], st = din.length >= 2 ? din[din.length - 1] : null;
            var rec = {
                i: sec.recs.length, data: dataAtual, v: vt.v, s: vt.s, saldo: st ? (st.s < 0 ? -1 : 1) * st.v : null, unica: unica,
                antes: pend.join(' ').slice(0, 140), linha: corpo.slice(0, 120), depois: ''
            };
            sec.recs.push(rec); ultimo = rec; pend = [];
        }
        secs = secs.filter(function (z) { return z.recs.length || z.anc.length; });
        if (secs.length) fecha.forEach(function (a) { secs[secs.length - 1].anc.push(a); });
        var total = 0; secs.forEach(function (z) { total += z.recs.length; });
        if (total < 5) return unNao('poucos lancamentos (' + total + ')');
        // ── 2) prova de cada secao (na ordem do tempo: tenta como esta e invertida) ──
        var lanc = [], fora = 0, foraIni = 0, pares = 0, dirs = [], falha = '';
        for (var zs = 0; zs < secs.length && !falha; zs++) {
            var zc = secs[zs], recs = zc.recs, nz = recs.length, prova = null, erros = [];
            if (!nz) continue;
            var duras = zc.anc.filter(function (a) { return !a.soft; }), jogos = duras.length < zc.anc.length ? [zc.anc, duras] : [zc.anc];   // saldos "adivinhados" (rotulo solto, data+valor) valem primeiro; se estragarem a conta, tenta sem eles
            jogos.forEach(function (av) {
                [{ dir: 'asc', rs: recs.slice() }, { dir: 'desc', rs: recs.slice().reverse() }].forEach(function (t) {
                    if (prova) return;
                    var r = unProvar(t.rs, av, t.dir === 'desc');
                    if (r.ok) prova = { dir: t.dir, rs: t.rs, r: r }; else erros.push(t.dir + ': ' + r.erro);
                });
            });
            if (!prova) { falha = (secs.length > 1 ? 'secao ' + (zs + 1) + ' de ' + secs.length + ' (' + nz + ' linhas): ' : '') + erros.join(' | '); break; }
            if (prova.r.fora > Math.max(1, Math.floor(nz * 0.01))) { falha = 'linhas fora de qualquer trecho com saldo: ' + prova.r.fora + ' de ' + nz + ' (' + prova.dir + ')'; break; }
            var rsC = prova.rs, sinal = prova.r.sinal;
            rsC.forEach(function (r, z) {   // linhas fora dos trechos (so a primeira, no maximo): sinal impresso, ou pelo texto
                if (sinal[z]) return;
                var tx = nuSemAcento(r.antes + ' ' + r.linha + ' ' + r.depois);
                sinal[z] = /RECEBID|CREDIT|DEPOSIT|ESTORN|RENDIMENT|RESGAT|SALARIO|PROVENTO|REEMBOLS|DEVOLUC/.test(tx) && !/ENVIAD|DEBIT|COMPRA|PAGAMENTO|TARIFA|SAQUE/.test(tx) ? 1 : -1;
            });
            for (var y = 0; y < nz && !falha; y++) if (rsC[y].s && rsC[y].s !== sinal[y]) falha = 'sinal impresso contradiz os saldos na linha ' + (y + 1);
            rsC.forEach(function (r, idx) {
                lanc.push({ i: lanc.length, data: unIso(r.data), mes: nuIsoMes(r.data.a, r.data.m), valor: sinal[idx] * r.v, saldo: r.saldo, desc: (r.antes + ' ' + r.linha + ' ' + r.depois).replace(/\s+/g, ' ').trim().slice(0, 150) });
            });
            fora += prova.r.fora; foraIni += prova.r.foraIni; pares += prova.r.ancoras - 1; dirs.push(prova.dir);
        }
        if (falha) return unNao(falha);
        var n = lanc.length, minD = lanc[0].data, maxD = lanc[0].data;
        lanc.forEach(function (l) { if (l.data < minD) minD = l.data; if (l.data > maxD) maxD = l.data; });
        // periodo impresso no cabecalho (primeira linha com duas datas); senao do primeiro ao ultimo lancamento
        var per = null;
        for (var h = 0; h < Math.min(linhas.length, 40) && !per; h++) {
            var dh = unAchaDatas(linhas[h]);
            if (dh.length >= 2 && /PERIODO|DE .* A |ATE|EXTRATO/.test(nuSemAcento(linhas[h]))) per = { inicio: unIso(dh[0]) < unIso(dh[1]) ? unIso(dh[0]) : unIso(dh[1]), fim: unIso(dh[0]) < unIso(dh[1]) ? unIso(dh[1]) : unIso(dh[0]) };
        }
        if (per && (minD < per.inicio.slice(0, 7) + '-01' || maxD > per.fim)) per = null;   // cabecalho que nao combina com os lancamentos
        // sem saldo anterior conhecido, uma pagina perdida no comeco/fim do arquivo nao quebra a conta: confere as pontas com o periodo impresso (tolerancia: conta parada por 15 dias)
        if (per && fora > 0) {
            var dd = function (a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); };
            if (dd(per.inicio, minD) > UN_FOLGA_DIAS || dd(maxD, per.fim) > UN_FOLGA_DIAS) return unNao('lancamentos nao cobrem o periodo ' + per.inicio + '..' + per.fim + ' (lido ' + minD + '..' + maxD + ')');
        }
        return {
            lanc: lanc, periodo: per || { inicio: minD, fim: maxD }, cabecalho: linhas.slice(0, 8).join(' | ').slice(0, 300),
            prova: { dir: dirs.join('+'), pares: pares, linhas: n, fora: fora, secoes: secs.length }
        };
    }

    // Nome de quem pagou, tirado da descricao (para reconhecer quem paga todo mes)
    function unNomePagador(desc) {
        var t = String(desc || '');
        for (var k = 0; k < 4; k++) t = t.replace(/^(?:PIX|TED|DOC|TRANSF\w*|TRANSFER[EÊ]NCIA|RECEBID[OA]S?|RECEBIMENTO|CR[EÉ]DITO|DEP[OÓ]SITO|REM|DE|DO|DA|POR|CP)\b[:.\s-]*/i, '');
        t = t.replace(/["“”]/g, ' ').replace(/[•*\d.\-\/]{5,}/g, ' ').replace(/\s+/g, ' ').replace(/ (?:Recebido|Enviado|Devolvido|Revertido)$/i, '').trim();   // InfinitePay: o status vem colado no nome
        return t.split(' ').slice(0, 5).join(' ').slice(0, 40);
    }
    function unPromptClassificar(cabecalho, lote) {
        var L = lote.map(function (l, j) { return (j + 1) + ' | ' + l.data + ' | ' + l.valor.toFixed(2).replace('.', ',') + ' | ' + l.desc; }).join('\n');
        return 'Voce CLASSIFICA entradas (creditos) de um extrato bancario brasileiro. NAO some, NAO calcule, NAO pule nenhuma: devolva um codigo para CADA numero da lista.\n' +
            'Codigos:\n' +
            '  F = fixa: salario/proventos, beneficio (INSS, aposentadoria, pensao) ou pagador FIXO que paga todo mes.\n' +
            '  V = variavel: Pix/TED recebido de TERCEIROS (clientes, vendas, servicos, comissoes, repasses, maquininha), MESMO que a pessoa repasse tudo depois.\n' +
            '  A = app: repasse de app de transporte/entrega (Uber, 99, InDrive, iFood, Rappi, Loggi).\n' +
            '  X = excluida (escreva "X:motivo curto"): so quando CLARAMENTE for autotransferencia (Pix/TED do proprio titular entre contas dele), credito de emprestimo/financiamento/consignado/antecipacao/saque-aniversario, estorno/reembolso/devolucao/cashback/rendimento/juros, resgate de investimento/poupanca/CDB, deposito em dinheiro sem origem, premio ou saque de casa de aposta, 13o/ferias/PLR/rescisao, venda de bem ou emprestimo entre pessoas (so se a descricao disser), valor adicionado por cartao de credito.\n' +
            'NA DUVIDA use V. Nao exclua uma entrada so porque o valor e alto ou diferente das outras.\n' +
            'A descricao pode ter o nome de quem pagou antes ou depois do tipo da operacao. O titular da conta aparece no cabecalho abaixo (use para achar autotransferencia).\n' +
            'CABECALHO DO EXTRATO: ' + cabecalho + '\n\n' +
            'Responda SO com um JSON {"1":"V","2":"X:autotransferencia",...} com TODOS os numeros de 1 a ' + lote.length + '.\n' +
            'LISTA (numero | data | valor | descricao):\n' + L + '\n';
    }
    // Le a resposta da IA (JSON, ou pares "numero":"codigo" soltos) e preenche cls[l.i]
    function unLerClasses(resposta, lote, cls) {
        var r = String(resposta || ''), re = /"?(\d{1,4})"?\s*:\s*"?\s*([FVAXfvax])(?![A-Za-z])\s*(?::\s*([^",}\n]*))?/g, m;
        while ((m = re.exec(r))) {
            var l = lote[+m[1] - 1];
            if (l && !cls[l.i]) cls[l.i] = { g: { F: 'fixa', V: 'variavel', A: 'app', X: 'excluidas' }[m[2].toUpperCase()], motivo: String(m[3] || '').trim().slice(0, 50) };
        }
    }
    // Saidas e saldos pelo codigo (a cadeia de saldos ja deu o sinal de cada linha). So grava quando TODAS as linhas ficaram dentro de trechos provados.
    // saidas = debitos reais; aplicacao/investimento e Pix para a propria conta ficam de fora. Saldo do mes = o da ultima linha com saldo impresso.
    var UN_RE_INVEST = /APLICA[CÇ]|\bRDB\b|INVESTIMENT|INVEST FACIL|\bCDB\b|POUPAN|TESOURO|COMPRA DE (?:FUNDO|TITULO)|FUNDOS? DE INVEST/;
    var UN_RE_PROPRIO = /PROPRIA CONTA|CONTA PROPRIA|MESMA TITULARIDADE|ENTRE CONTAS (?:PROPRIAS|MESMA)|MESMO TITULAR/;
    function unAnexarSaidas(u, porMes) {
        if (!u || !u.prova || u.prova.fora !== 0) return;
        var meses = Object.keys(porMes);
        meses.forEach(function (k) { porMes[k].saidas = 0; porMes[k].saidasInvest = 0; porMes[k].saidasProprias = 0; });
        var ult = {}, menor = {}, ini = {}, linhas = {}, comSaldo = {}, soma = {};   // saldo do mes so vale se TODAS as linhas do mes trazem saldo e a conta fecha
        u.lanc.forEach(function (l) {
            var m = porMes[l.mes];
            if (!m) return;
            if (l.valor < 0) {
                var v = -l.valor, t = nuSemAcento(l.desc);
                var f = UN_RE_INVEST.test(t) ? 'saidasInvest' : UN_RE_PROPRIO.test(t) ? 'saidasProprias' : 'saidas';
                m[f] = arred2(m[f] + v);
            }
            linhas[l.mes] = (linhas[l.mes] || 0) + 1; soma[l.mes] = (soma[l.mes] || 0) + l.valor;
            if (typeof l.saldo === 'number') {
                comSaldo[l.mes] = (comSaldo[l.mes] || 0) + 1;
                if (!(l.mes in ini)) ini[l.mes] = arred2(l.saldo - l.valor);
                ult[l.mes] = l.saldo; menor[l.mes] = l.mes in menor ? Math.min(menor[l.mes], l.saldo) : l.saldo;
            }
        });
        meses.forEach(function (k) {
            if (comSaldo[k] !== linhas[k] || Math.abs(ini[k] + soma[k] - ult[k]) > 0.011) return;
            porMes[k].saldoInicial = ini[k]; porMes[k].saldoFinal = arred2(ult[k]); porMes[k].menorSaldo = arred2(Math.min(menor[k], ini[k]));
        });
    }
    // Leitura universal completa: o codigo acha e PROVA os lancamentos; a IA so classifica as entradas; o codigo soma por mes.
    // Devolve o mesmo formato do leitor Nubank ({ rendaMeses... }) ou null (volta para o leitor de antes).
    async function lerExtratoUniversalIA(texto, chamar, opts) {
        opts = opts || {};
        var u = lerExtratoUniversal(texto);
        if (!u) { if (opts.log) opts.log('universal recusou: ' + UN_ULTIMO); return null; }
        var cred = u.lanc.filter(function (l) { return l.valor > 0; }), cls = {}, pendentes = cred.slice();
        var limitar = opts.limitar || criarLimitador(PARALELO_IA);
        for (var tent = 0; tent < 2 && pendentes.length; tent++) {
            var lotes = [];
            for (var j = 0; j < pendentes.length; j += UN_LOTE) lotes.push(pendentes.slice(j, j + UN_LOTE));
            await Promise.all(lotes.map(function (lote, li) {
                return limitar(async function () {
                    try { unLerClasses(await chamar(unPromptClassificar(u.cabecalho, lote), 'u' + tent + '-' + li), lote, cls); }
                    catch (e) { if (opts.fatal && opts.fatal(e)) throw e; }
                });
            }));
            pendentes = cred.filter(function (l) { return !cls[l.i]; });
        }
        if (pendentes.length > Math.max(3, Math.floor(cred.length * 0.1))) { if (opts.log) opts.log('universal recusou: IA nao classificou ' + pendentes.length + ' de ' + cred.length + ' entradas'); return null; }
        pendentes.forEach(function (l) { cls[l.i] = { g: 'variavel', motivo: '' }; });   // na duvida, conta como variavel (regra do dono)
        var porMes = {}, ordem = [], det = [];
        u.lanc.forEach(function (l) {
            if (!porMes[l.mes]) { ordem.push(l.mes); porMes[l.mes] = { mes: l.mes, fixa: 0, variavel: 0, app: 0, excluidas: 0, totalCreditos: 0, parcial: false }; }
        });
        cred.forEach(function (l) {
            var c = cls[l.i], m = porMes[l.mes];
            m[c.g] = arred2(m[c.g] + l.valor);
            m.totalCreditos = arred2(m.totalCreditos + l.valor);
            if (c.g === 'excluidas') det.push({ mes: l.mes, valor: l.valor, motivo: c.motivo || 'excluida' });
            else if (c.g === 'variavel') { var nm = unNomePagador(l.desc); if (nm) m.pagadores = somarPagadores(m.pagadores, [{ nome: nm, valor: l.valor }]); }
        });
        ordem.sort();
        det.sort(function (a, b) { return b.valor - a.valor; });
        unAnexarSaidas(u, porMes);
        if (opts.log) opts.log('universal leu ' + u.lanc.length + ' lancamentos (' + cred.length + ' entradas, cadeia ' + u.prova.dir + ' ' + u.prova.pares + ' pares)' + (pendentes.length ? ', ' + pendentes.length + ' sem classe (contadas como variavel)' : ''));
        return {
            titular: '', periodoDocumentos: u.periodo, rendaMeses: ordem.map(function (k) { return porMes[k]; }),
            excluidasDetalhe: det.slice(0, 8), leituraCodigo: 'universal'
        };
    }

    // Limita quantas funcoes assincronas rodam ao mesmo tempo (fila simples). Devolve run(fn) -> Promise.
    function criarLimitador(max) {
        var ativos = 0, fila = [];
        function proximo() {
            while (ativos < max && fila.length) {
                var it = fila.shift(); ativos++;
                it.fn().then(it.ok, it.err).then(function () { ativos--; proximo(); });
            }
        }
        return function (fn) { return new Promise(function (ok, err) { fila.push({ fn: fn, ok: ok, err: err }); proximo(); }); };
    }

    // O quanto a soma lida ficou longe do total impresso (0 = fechou). Serve para escolher a melhor de duas leituras.
    function desvioDivergencia(c) {
        if (!c || !c.divergentes) return 0;
        return c.divergentes.reduce(function (a, d) { return a + (d.total > 0 ? Math.abs(d.total - d.soma) / d.total : 0); }, 0) +
            (c.margens || []).reduce(function (a, d) { return a + (d.total > 0 ? d.valor / d.total : 0); }, 0);
    }

    // Renda que o codigo fechou: vale mesmo sendo R$ 0 (todas as entradas sao autotransferencia, emprestimo, cartao...),
    // desde que cada mes tenha o total impresso e a soma bata com ele. Sem isso, o R$ 0 pode ser so leitura falha: a etapa 2 recalcula.
    function rendaFechada(c) {
        if (!c || c.fonte !== 'codigo') return false;
        if (c.renda > 0) return true;
        return (c.usados || []).length > 0 && !(c.divergentes || []).length && !(c.faltando > 0) && c.usados.every(function (m) { return m.totalCreditos > 0; });
    }

    // Le UM arquivo (texto) em trechos. chamar(prompt, rotulo) -> Promise<texto da IA>.
    // opts: { limitar(fn), sobra() -> ms restantes, fatal(e) -> true se o erro deve abortar tudo (ex.: cancelado) }
    // Devolve o objeto somado ({rendaMeses...}) ou null se algum trecho nao pode ser lido (leitura incompleta nao vale).
    // Se a soma ainda nao fechar com o total impresso, relê UMA vez com trechos menores e fica com a melhor.
    async function lerRendaPorTrechos(texto, chamar, opts) {
        opts = opts || {};
        var nb = lerExtratoNubank(texto);   // extrato Nubank que fecha com os totais impressos: sem IA
        if (nb) return nb;
        if (opts.log && NU_ULTIMO > 1) opts.log('nubank recusou: motivo ' + NU_ULTIMO);   // 1 = nao e Nubank; os outros dizem onde o leitor do Nubank parou
        if (opts.universal) {   // qualquer banco: o codigo le e prova pela cadeia de saldos, a IA so classifica (se nao fechar, segue o leitor de antes)
            var un = await lerExtratoUniversalIA(texto, chamar, opts);
            if (un) return un;
        }
        var limitar = opts.limitar || criarLimitador(PARALELO_IA);
        async function lerTrecho(tx, n, de, tag) {
            var base = '=== EXTRATO BANCARIO DIGITAL (texto extraido do PDF) ===\n' + tx;
            for (var t = 0; t < 2; t++) {
                try {
                    var r = await chamar(buildPromptRenda(base, { n: n, de: de }), tag + '-' + n + '-' + t);
                    var a = r.indexOf('{'), b = r.lastIndexOf('}');
                    if (a !== -1 && b > a) { var o = JSON.parse(r.substring(a, b + 1)); if (o && Array.isArray(o.rendaMeses)) return o; }
                } catch (e) { if (opts.fatal && opts.fatal(e)) throw e; }
            }
            return null;
        }
        async function passada(alvo, tag) {
            var trechos = dividirTrechos(texto, alvo);
            var leituras = await Promise.all(trechos.map(function (tx, i) {
                return limitar(function () { return lerTrecho(tx, i + 1, trechos.length, tag); });
            }));
            if (leituras.some(function (l) { return l === null; })) return null;
            var obj = somarTrechos(leituras);
            var c = obj.rendaMeses.length ? calcularRenda(obj) : null;
            return { obj: obj, c: c, n: trechos.length, alvo: alvo };
        }
        var p1 = await passada(ALVO_TRECHO, 'a');
        var fechou = function (p) { return !!(p && p.c && p.c.fonte === 'codigo' && p.c.renda > 0 && !(p.c.divergentes && p.c.divergentes.length) && !(p.c.margens && p.c.margens.length)); };   // com margem de erro ainda vale tentar a releitura (trechos menores)
        if (!p1 || fechou(p1)) return p1 ? p1.obj : null;
        var menor = Math.max(MIN_TRECHO, Math.floor(p1.alvo / 2));
        if (menor >= p1.alvo || dividirTrechos(texto, menor).length <= p1.n || (opts.sobra && opts.sobra() < 40000)) return p1.obj;   // sem trechos novos a releitura seria igual
        var p2 = await passada(menor, 'b');
        if (!p2) return p1.obj;
        if (fechou(p2)) return p2.obj;
        return desvioDivergencia(p2.c) < desvioDivergencia(p1.c) ? p2.obj : p1.obj;
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
            auditoriaRenda(c, L);
            return L.join('\n');
        }
        if (c.metodo === 'periodo') {
            L.push('Extratos de ' + c.periodoTxt + ' (' + c.diasPeriodo + ' dias).');
            L.push('Entradas válidas por mês: ' + c.usados.map(function (m) { return labelMes(m.mes) + ' ' + reaisCurto(m.liquido) + (m.parcial ? ' (parcial)' : ''); }).join(' · '));
            L.push('Menos de ' + MAX_MESES + ' meses completos: a renda usa o período inteiro — ' + reaisCurto(c.totalLiquido) + ' em ' + c.diasPeriodo + ' dias (≈ ' + String(c.equivMeses).replace('.', ',') + ' meses) = ' + reaisCurto(c.renda) + ' por mês.');
            var vP = c.usados.reduce(function (a, m) { return a + m.variavel; }, 0), pP = c.usados.reduce(function (a, m) { return a + m.app; }, 0);
            if (vP > 0 || pP > 0) L.push('Abatimento de custo: ' + [vP > 0 ? Math.round(DESC_VARIAVEL * 100) + '% sobre ganhos de autônomo/clientes' : '', pP > 0 ? Math.round(DESC_APP * 100) + '% sobre repasses de app' : ''].filter(Boolean).join(' e ') + ' (já descontado nos valores acima).');
            if (c.curto) L.push(avisoCurto(c));
            auditoriaRenda(c, L);
            return L.join('\n');
        }
        if (c.periodoTxt) L.push('Extratos de ' + c.periodoTxt + '.');
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
        if (c.pagadoresFixos && c.pagadoresFixos.length) L.push('Paga todo mês (conta como renda fixa, sem o desconto de custo): ' + c.pagadoresFixos.slice(0, 4).map(function (p) { return p.nome + ' ≈ ' + reaisCurto(p.media); }).join(' · ') + '.');
        if (c.parciaisIgnorados) L.push(c.parciaisIgnorados + (c.parciaisIgnorados > 1 ? ' meses parciais ignorados.' : ' mês parcial ignorado.'));
        if (c.curto) L.push(avisoCurto(c));
        auditoriaRenda(c, L);
        return L.join('\n');
    }

    // Linhas de conferencia (⚠ = destacada na tela): meses que nao fecham com o extrato, meses nao lidos e entradas excluidas
    function auditoriaRenda(c, L) {
        if (c.faltando > 0) L.push('⚠ A IA detalhou só ' + c.usados.length + ' de ' + (c.usados.length + c.faltando) + ' meses do período: a renda usa os meses lidos. Confira o extrato.');
        (c.divergentes || []).forEach(function (d) {
            L.push('⚠ ' + labelMes(d.mes) + ': a soma das entradas lidas (' + reaisCurto(d.soma) + ') não bate com o total do extrato (' + reaisCurto(d.total) + '). Confira.');
        });
        (c.margens || []).forEach(function (g) {
            var pg = g.total > 0 ? Math.round(g.valor / g.total * 100) : 0;
            L.push((pg > 10 ? '⚠ ' : '') + labelMes(g.mes) + ': margem de erro de leitura de ' + reaisCurto(g.valor) + ' (' + pg + '% do extrato). ' +
                (g.tipo === 'falta' ? 'Valeu o total do extrato; a diferença entrou como renda aleatória (com o desconto de ganho variável).' : 'Valeu o total do extrato; o excesso lido foi descartado.'));
        });
        if (c.excluidasTotal > 0 && c.pctExcluido > 0) {
            var pct = Math.round(c.pctExcluido * 100);
            L.push((c.pctExcluido > DUVIDOSA_PCT ? '⚠ ' : '') + reaisCurto(c.excluidasTotal) + ' (' + pct + '%) das entradas não entraram na renda' +
                (c.excluidasDetalhe && c.excluidasDetalhe.length ? ': ' + c.excluidasDetalhe.slice(0, 5).map(function (e) { return reaisCurto(e.valor) + (e.motivo ? ' ' + e.motivo : ''); }).join(' · ') : '') +
                (c.pctExcluido > DUVIDOSA_PCT ? '. Confira se estão certas.' : '.'));
        }
    }

    // Linha de alerta (comeca com ⚠: a tela destaca) quando o comprovante tem menos de ~3 meses
    function avisoCurto(c) {
        return '⚠ Comprovante curto' + (c.dias ? ' (' + c.dias + ' dias)' : ' (menos de 3 meses)') + ': o ideal são os 3 últimos meses. Renda e nota ficam menos confiáveis; peça o extrato completo.';
    }

    // ── Prompt da etapa 1 (so texto digital): apenas a renda ─────────
    // trecho = { n, de } quando o texto e so UMA PARTE do extrato (a soma de cada parte e feita pelo codigo)
    function buildPromptRenda(textoExtrato, trecho) {
        return 'Voce e um analista financeiro. Leia o extrato bancario abaixo e levante a RENDA MENSAL REAL do titular, mes a mes.\n\n' +
            'EXTRATO:\n' + textoExtrato + '\n\n' +
            '=== REGRAS DE RENDA ===\n' +
            'Identifique o nome e o CPF do TITULAR no cabecalho.\n' +
            REGRAS_RENDA + '\n' +
            (trecho && trecho.de > 1
                ? '=== ATENCAO: ESTE TEXTO E O TRECHO ' + trecho.n + ' DE ' + trecho.de + ' DE UM EXTRATO MAIOR ===\n' +
                  'Some SOMENTE as entradas que aparecem NESTE trecho (o codigo soma os trechos). Liste apenas os meses que aparecem aqui; um trecho sem nenhuma entrada devolve rendaMeses vazio.\n' +
                  'totalCreditos: copie o total impresso do mes SOMENTE se este trecho mostrar esse total; senao use 0 (a soma deste trecho nao precisa fechar com ele).\n' +
                  'periodoDocumentos: primeira e ultima data que aparecem NESTE trecho.\n\n'
                : '') +
            'Retorne APENAS JSON valido, sem texto extra:\n' +
            '{"titular":"","periodoDocumentos":{"inicio":"AAAA-MM-DD","fim":"AAAA-MM-DD"},"rendaMeses":[{"mes":"AAAA-MM","fixa":0.00,"variavel":0.00,"app":0.00,"excluidas":0.00,"totalCreditos":0.00,"parcial":false,"pagadores":[{"nome":"","valor":0.00}]}],"excluidasDetalhe":[{"mes":"AAAA-MM","valor":0.00,"motivo":""}]}\n' +
            'Nao invente. Se nao houver nenhuma entrada valida, retorne rendaMeses com os valores zerados.';
    }

    // ═══════════════════════════════════════════════════════════════════
    //  FAIXAS: o sistema decide por SINAIS de calote + PILARES (estabilidade,
    //  capacidade, caixa). Nao ha soma de pontos: um item bom nao apaga um sinal
    //  grave, e gasto que nao causa calote nao tira nota. A nota (0-100) e
    //  consequencia da faixa e da folga dentro dela.
    // ═══════════════════════════════════════════════════════════════════
    var NOTA_TETO = 92;   // nenhum cliente e perfeito
    var FAIXAS = {
        FORTE:     { min: 85, max: 92, entradaPct: 0.38 },
        MEDIO:     { min: 60, max: 84, entradaPct: 0.40 },
        FRACO:     { min: 51, max: 59, entradaPct: 0.60 },
        REPROVADO: { min: 15, max: 45, entradaPct: 0.60 }
    };
    // Limites dos sinais. Percentuais = compromissos / renda final; cv = variacao da renda entre os meses.
    var LIM = {
        compForte: 30, compMedio: 50, compGrave: 60, compReprova: 80,   // comprometimento da renda (%)
        fluxoLeve: 105, fluxoGrave: 110,                                 // saidas / entradas (%)
        quedaEstavel: 0.30, quedaGrave: 0.45,                            // oscilacao PARA BAIXO da renda entre os meses (so meses abaixo da media contam)
        credoresGrave: 3, credoresComCompGrave: 40,                      // dividas: qtde e % da renda em que a qtde vira sinal grave
        reservaMinPct: 0.05, reservaZeroPct: 0.02                        // saldo medio de fim de mes / entradas mensais
    };

    // Faixa do cliente APROVADO pela nota (entrada exigida); reprovado nao passa por aqui
    function riscoPorNota(nota) {
        var r = nota >= FAIXAS.FORTE.min ? 'FORTE' : nota >= FAIXAS.MEDIO.min ? 'MEDIO' : 'FRACO';
        return { risco: r, entradaPct: FAIXAS[r].entradaPct };
    }

    // Decisao pela nota: 50 ou menos reprova (FRACO = 51 a 59)
    function classificarPorNota(d) {
        if (d.nomesBatem === false) return;
        if (d.nota > NOTA_REPROVA) {
            var r = riscoPorNota(d.nota);
            d.aprov = true; d.reprovado = false; d.risco = r.risco; d.entradaPct = r.entradaPct;
        } else { d.aprov = false; d.reprovado = true; d.risco = 'REPROVADO'; d.entradaPct = FAIXAS.REPROVADO.entradaPct; }
    }

    // ── Compromissos fixos ───────────────────────────────────────────
    // Sinais no TEXTO do extrato (zero tokens): palavras que quase sempre indicam um compromisso mensal.
    var SINAIS_COMPROMISSO = [
        { k: 'fatura de cartão', re: /fatura/g },
        { k: 'parcela', re: /parcel|presta[cç][aã]o/g },
        { k: 'financiamento', re: /financiamento/g },
        { k: 'empréstimo', re: /empr[eé]stimo|consignado/g },
        { k: 'consórcio', re: /cons[oó]rcio/g },
        { k: 'aluguel', re: /alugu[eé]l|imobili[aá]ri/g },
        { k: 'boleto', re: /boleto/g },
        { k: 'mensalidade', re: /mensalidade|faculdade|col[eé]gio/g },
        { k: 'seguro/plano', re: /\bseguro\b|plano de sa[uú]de|unimed|\bamil\b/g },
        { k: 'carnê/crediário', re: /carn[eê]|credi[aá]rio/g }
    ];
    // Frases fixas dos extratos (propaganda, tabela de tarifas, rodape) que repetem as palavras acima sem ser compromisso
    var SINAIS_PROPAGANDA = /parcelamento em at[eé] \d+x|valor da mensalidade|mensalidade dos pacotes|mais seguro online|[íi]ndices econ[oô]micos ?\/ ?financeiros/g;
    // Nome de banco/instituicao que contem as palavras acima (PagSeguro, CredSeguro, "Nu Financeira ... financiamento e investimento", "servicos financeiros") nao e compromisso
    var SINAIS_INSTITUICAO = /pag ?seguro|cred ?seguro|nu financeira|financeira s\.?a|sociedade de cr[eé]dito[^\n]{0,60}|servi[cç]os? financeiros?|solu[cç][oõ]es financeiras?/g;
    var SINAIS_MINIMO = 3;   // ocorrencias no texto para a IA ter que justificar "nenhum compromisso"

    function detectarSinaisCompromisso(texto) {
        var t = String(texto || '').toLowerCase();
        if (!t) return null;
        t = t.replace(SINAIS_PROPAGANDA, ' ').replace(SINAIS_INSTITUICAO, ' ');
        var termos = [], total = 0;
        SINAIS_COMPROMISSO.forEach(function (s) {
            var m = t.match(s.re);
            if (m && m.length) { termos.push(s.k + ' (' + m.length + ')'); total += m.length; }
        });
        return total ? { total: total, termos: termos } : null;
    }

    // Pagamentos que se repetem em 2+ meses para o mesmo favorecido (boleto, fatura, parcela, financiamento, seguro, aluguel...), lidos do TEXTO pelo codigo.
    // Serve quando a IA nao lista compromisso nenhum: o sistema nao reprova por "palavra no extrato", ele mostra o que achou. Devolve [{ desc, tipo, valor, meses }] (maior valor primeiro).
    var RECOR_TERMO = /boleto|fatura|parcel|presta[cç][aã]o|financiamento|empr[eé]stimo|consignado|cons[oó]rcio|alugu[eé]l|mensalidade|\bseguro\b|plano de sa[uú]de|carn[eê]|credi[aá]rio/;
    var RECOR_IGNORA = /receb|estorn|devol|reembols|cashback|rendimento|cr[eé]dito em conta/;
    var RECOR_VALOR = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
    // extrato com coluna de saldo: a linha termina em "valor saldo" (o valor e o primeiro dos dois)
    var RECOR_VALOR_SALDO = /(\d{1,3}(?:\.\d{3})*,\d{2})\s+(?:R\$\s*)?-?\d{1,3}(?:\.\d{3})*,\d{2}\s*$/;
    var RECOR_MESES = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };
    var RECOR_VAZIAS = { DE: 1, DA: 1, DO: 1, DAS: 1, DOS: 1, E: 1, EM: 1, PAGAMENTO: 1, PAGTO: 1, PAG: 1, EFETUADO: 1, EFETUADA: 1, BOLETO: 1, FATURA: 1, PARCELA: 1, PIX: 1, TRANSFERENCIA: 1, ENVIADA: 1, ENVIADO: 1, COM: 1, PARA: 1, CARTAO: 1, DEBITO: 1, LTDA: 1, SA: 1, ME: 1, EPP: 1 };
    function dataDaLinha(ln) {
        var m = /^\s*(\d{1,2}) ([A-Za-z]{3}) (\d{4})\b/.exec(ln);
        if (m && RECOR_MESES[m[2].toUpperCase()]) return m[3] + '-' + (RECOR_MESES[m[2].toUpperCase()] < 10 ? '0' : '') + RECOR_MESES[m[2].toUpperCase()];
        m = /^\s*(\d{2})[\/-](\d{2})[\/-](\d{4})\s*$/.exec(ln) || /^\s*(\d{2})\/(\d{2})\/(\d{4})\b/.exec(ln);
        if (m && +m[2] >= 1 && +m[2] <= 12) return m[3] + '-' + m[2];
        return null;
    }
    function detectarRecorrencias(texto) {
        var linhas = String(texto || '').replace(SINAIS_PROPAGANDA, ' ').split('\n'), mes = null, grupos = {};
        for (var i = 0; i < linhas.length; i++) {
            var ln = linhas[i], dm = dataDaLinha(ln);
            if (dm) mes = dm;
            var baixo = ln.toLowerCase().replace(SINAIS_INSTITUICAO, ' ');
            if (!mes || !RECOR_TERMO.test(baixo) || RECOR_IGNORA.test(baixo)) continue;
            var corpo = ln.replace(/\s+/g, ' ').trim(), mv = RECOR_VALOR_SALDO.exec(corpo) || RECOR_VALOR.exec(corpo);
            if (!mv) {   // o valor pode vir na linha de baixo (extratos que quebram a linha)
                for (var j = i + 1; j <= i + 2 && j < linhas.length && !mv; j++) {
                    var nx = linhas[j].replace(/\s+/g, ' ').trim();
                    if (dataDaLinha(nx) || RECOR_TERMO.test(nx.toLowerCase())) break;
                    mv = RECOR_VALOR.exec(nx);
                    if (!mv && nx) corpo += ' ' + nx;
                }
                if (!mv) continue;
            }
            var valor = parseFloat(mv[1].replace(/\./g, '').replace(',', '.'));
            if (!(valor > 0)) continue;
            var nome = corpo.replace(RECOR_VALOR_SALDO, ' ').replace(RECOR_VALOR, ' ').replace(/[+\-−]\s*$/, '');
            var toks = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(function (t) { return t.length >= 2 && /[A-Z]/.test(t) && !RECOR_VAZIAS[t]; });
            if (!toks.length) continue;
            var chave = toks.slice(0, 2).join(' ');
            var g = grupos[chave] || (grupos[chave] = { chave: chave, meses: {}, valores: [], desc: '' });
            g.meses[mes] = true; g.valores.push(valor);
            if (!g.desc) g.desc = toks.slice(0, 4).join(' ').toLowerCase().replace(/(^| )([a-z])/g, function (x, a1, a2) { return a1 + a2.toUpperCase(); });
        }
        var out = [];
        Object.keys(grupos).forEach(function (k) {
            var g = grupos[k], nm = Object.keys(g.meses).length;
            if (nm < 2) return;
            var v = g.valores.slice().sort(function (a, b) { return a - b; }), med = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
            out.push({ desc: 'Pago todo mês: ' + g.desc, tipo: 'recorrente', valor: arred2(med), meses: nm });
        });
        out.sort(function (a, b) { return b.valor - a.valor; });
        return out.slice(0, 8);
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
                porNome[k] = { desc: desc, tipo: String(c.tipo || '').substring(0, 30), valor: arred2(v), meses: numPos(c.meses) || 0 };
                ordem.push(porNome[k]);
            });
            return { fonte: 'lista', itens: ordem, total: arred2(ordem.reduce(function (a, i) { return a + i.valor; }, 0)) };
        }
        var comp = numIA(raw.compromissosMensais);
        return isFinite(comp) && comp >= 0 ? { fonte: 'total', itens: [], total: arred2(comp) } : null;
    }

    // Entradas x saidas lidas pelo CODIGO (extrato Nubank/universal, com prova): entradas = fixa + variavel + app (sem resgate, estorno,
    // autotransferencia, emprestimo) e saidas = gasto real (sem aplicacao e sem Pix para a propria conta). Sem prova em todos os meses = null.
    function fluxoDoCodigo(calc) {
        var ms = calc && calc.meses ? calc.meses.slice(-MAX_MESES) : [];
        if (!ms.length || ms.some(function (m) { return typeof m.saidas !== 'number'; })) return null;
        var ent = 0, sai = 0;
        ms.forEach(function (m) { ent += m.fixa + m.variavel + m.app; sai += m.saidas; });
        if (!(ent > 0)) return null;
        return { entradas: arred2(ent), saidas: arred2(sai), pct: Math.round(sai / ent * 100), meses: ms.length, fonte: 'codigo' };
    }
    // Saldo de fim de mes lido pelo codigo (so quando TODOS os meses tem): mesmo formato de lerSaldos
    function saldosDoCodigo(calc) {
        var ms = calc && calc.meses ? calc.meses.slice(-MAX_MESES) : [];
        if (!ms.length || ms.some(function (m) { return typeof m.saldoFinal !== 'number'; })) return null;
        var neg = ms.filter(function (m) { return m.saldoFinal < 0 || (typeof m.menorSaldo === 'number' && m.menorSaldo < 0); }).length;
        return { n: ms.length, negativos: neg, media: arred2(ms.reduce(function (a, m) { return a + m.saldoFinal; }, 0) / ms.length), fonte: 'codigo' };
    }
    // Fluxo para a nota: o do codigo quando existe; senao o da IA, mas so se as ENTRADAS dela ficarem a ate 20% das entradas ja conferidas
    // (a IA le saidas sem total impresso para conferir: se ela erra as entradas, as saidas dela nao merecem confianca).
    function fluxoConfiavel(raw, calc) {
        var cod = fluxoDoCodigo(calc);
        if (cod) return cod;
        var ia = calcularFluxo(raw), ms = calc && calc.meses ? calc.meses.slice(-MAX_MESES) : [];
        if (!ia || !ms.length) return null;
        var ref = 0; ms.forEach(function (m) { ref += m.fixa + m.variavel + m.app; });
        if (ref > 0 && Math.abs(ia.entradas - ref) > ref * TOL_LEITURA) return { descartado: true, entradasIA: ia.entradas, entradasRef: arred2(ref) };
        return null;
    }
    // Entradas x saidas por mes (informativo; nao entra na nota): quanto do que entrou foi embora
    function calcularFluxo(raw) {
        var lista = Array.isArray((raw || {}).fluxoMeses) ? raw.fluxoMeses : [];
        var ent = 0, sai = 0, n = 0;
        lista.filter(function (m) { return m && typeof m === 'object' && numIA(m.entradas) > 0 && numIA(m.saidas) >= 0; }).slice(-MAX_MESES).forEach(function (m) {
            ent += numIA(m.entradas); sai += numIA(m.saidas); n++;
        });
        if (!(ent > 0)) return null;
        return { entradas: arred2(ent), saidas: arred2(sai), pct: Math.round(sai / ent * 100), meses: n };
    }

    // Comprometimento em R$ (lista de compromissos da IA) -> % da renda FINAL.
    // Lista vazia com varios sinais no extrato = duvida: o item nao pontua e a tela avisa.
    function calcularComprometimento(d) {
        var l = listarCompromissos(d.rawJson);
        if ((!l || l.total === 0) && d.compromissosCodigo && d.compromissosCodigo.length) {   // a IA nao listou, mas o codigo achou pagamentos que se repetem no extrato
            l = { fonte: 'codigo', itens: d.compromissosCodigo.map(function (i) { return { desc: i.desc, tipo: i.tipo, valor: i.valor, meses: i.meses }; }), total: arred2(d.compromissosCodigo.reduce(function (a, i) { return a + i.valor; }, 0)) };
        }
        d.compromissos = l ? l.total : null;
        d.compromissosLista = l ? l.itens : [];
        d.compromissoDuvida = !!(l && l.total === 0 && d.sinaisCompromisso && d.sinaisCompromisso.total >= SINAIS_MINIMO);
        d.comprometimentoPct = (!d.compromissoDuvida && d.compromissos !== null && d.rendaEstimada > 0) ? Math.round(d.compromissos / d.rendaEstimada * 100) : null;
        var fc = d.fluxoCodigo;   // do codigo (provado) ou {descartado:true} quando a IA errou as entradas
        d.fluxo = fc ? (fc.descartado ? null : fc) : calcularFluxo(d.rawJson);
        d.fluxoDescartado = !!(fc && fc.descartado);
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

    // ── Fatos que a IA informa (ela NAO pontua): saldos, sinais de aperto e dividas ──
    function mesesInt(v) { var n = Math.round(numIA(v)); return isFinite(n) ? Math.max(0, Math.min(MAX_MESES, n)) : 0; }

    // Saldos de fim de mes -> { n, negativos (meses no vermelho), media } ou null se a IA nao informou
    function lerSaldos(raw) {
        var l = Array.isArray((raw || {}).saldosMeses) ? raw.saldosMeses : [], vs = [], neg = 0;
        l.filter(function (m) { return m && typeof m === 'object'; }).slice(-MAX_MESES).forEach(function (m) {
            var fim = numIA(m.saldoFinal), min = numIA(m.menorSaldo);
            if (!isFinite(fim) && !isFinite(min)) return;
            var f = isFinite(fim) ? fim : min;
            vs.push(f);
            if (f < 0 || (isFinite(min) && min < 0)) neg++;
        });
        return vs.length ? { n: vs.length, negativos: neg, media: arred2(vs.reduce(function (a, v) { return a + v; }, 0) / vs.length) } : null;
    }

    // Confere no TEXTO do extrato (zero tokens) o que a IA disse: palavras de cheque especial, rotativo e atraso
    var SINAIS_RISCO = {
        chequeEspecial: /cheque especial|chq\.? ?especial|juros (do )?limite|adiantamento a depositante/g,
        rotativo: /rotativo|pagamento m[ií]nimo|pgto\.? m[ií]nimo|parcelamento (da )?fatura|encargos (do )?cart[aã]o/g,
        atraso: /juros de mora|\bmora\b|multa|encargos? (por )?atraso|pagamento em atraso/g
    };
    function detectarSinaisRisco(texto) {
        var t = String(texto || '').toLowerCase();
        if (!t) return null;
        t = t.replace(SINAIS_PROPAGANDA, ' ');
        var r = {};
        Object.keys(SINAIS_RISCO).forEach(function (k) { var m = t.match(SINAIS_RISCO[k]); r[k] = m ? m.length : 0; });
        return r;
    }

    var RANK_SINAL = { grave: 2, leve: 1 };
    // Repetido em 2+ meses = grave; em 1 mes = leve. Sem confirmacao no extrato (IA viu, o texto nao) cai um degrau.
    function sevMeses(m, confirmado) {
        if (m >= 2) return confirmado ? 'grave' : 'leve';
        return m === 1 && confirmado ? 'leve' : null;
    }
    function ehDivida(it) { return /empr[eé]st|consign|financ|crediar|carn[eê]|parcel|cons[oó]rcio/i.test((it.tipo || '') + ' ' + (it.desc || '')); }
    // Quanto a renda oscila PARA BAIXO da media (desvio so dos meses abaixo dela, em % da media).
    // Mes bom acima da media nao e risco de calote; mes fraco e.
    function oscilacaoParaBaixo(vals) {
        var n = vals.length, mu = vals.reduce(function (a, v) { return a + v; }, 0) / n;
        if (!(mu > 0)) return null;
        return Math.sqrt(vals.reduce(function (a, v) { var f = Math.max(0, mu - v); return a + f * f; }, 0) / n) / mu;
    }
    function limitar01(x) { return Math.max(0, Math.min(1, x)); }

    // Avalia o cliente. Cada GRUPO de sinais correlacionados conta UMA vez (o mais grave do grupo):
    // assim o mesmo comportamento nao e punido duas vezes. Reprova com 2+ grupos graves.
    function avaliarFaixa(d) {
        var raw = d.rawJson || {}, calc = d.rendaCalc, scan = d.sinaisRisco || null;
        var sin = raw.sinais && typeof raw.sinais === 'object' ? raw.sinais : {};
        var saldos = d.saldosCodigo || lerSaldos(raw), fl = d.fluxo, pct = d.comprometimentoPct;
        var graves = [], leves = [], obs = [];
        function grupo(sev, nome, texto) {
            if (sev === 'grave') graves.push({ grupo: nome, texto: texto });
            else if (sev === 'leve') leves.push({ grupo: nome, texto: texto });
        }
        function maior(a, b) { return (RANK_SINAL[a] || 0) >= (RANK_SINAL[b] || 0) ? a : b; }
        function plural(n) { return n + (n > 1 ? ' meses' : ' mês'); }

        // 1) atrasos e multas
        var mAtr = mesesInt(sin.atrasosMeses);
        grupo(sevMeses(mAtr, !scan || scan.atraso > 0), 'atraso', 'Pagamentos com multa/juros de atraso em ' + plural(mAtr));
        if (!mAtr && scan && scan.atraso >= 2) obs.push('O extrato cita multa/mora (' + scan.atraso + 'x) e a IA não confirmou atraso: confira.');

        // 2) fatura no minimo / rotativo
        var mRot = mesesInt(sin.faturaMinimoMeses);
        grupo(sevMeses(mRot, !scan || scan.rotativo > 0), 'rotativo', 'Fatura paga no mínimo ou rotativo em ' + plural(mRot));
        if (!mRot && scan && scan.rotativo >= 2) obs.push('O extrato cita rotativo/pagamento mínimo (' + scan.rotativo + 'x) e a IA não confirmou: confira.');

        // 3) caixa no vermelho: cheque especial, saldo negativo e gastar mais do que entra (mesmo problema, conta uma vez)
        var mCh = mesesInt(sin.chequeEspecialMeses);
        if (mCh && scan && !(scan.chequeEspecial > 0)) mCh = Math.min(mCh, 1);
        var mVerm = Math.max(mCh, saldos ? saldos.negativos : 0), sCx = mVerm >= 2 ? 'grave' : mVerm === 1 ? 'leve' : null, tCx = [];
        if (mVerm) tCx.push('Cheque especial/saldo negativo em ' + plural(mVerm));
        if (fl && fl.pct > LIM.fluxoLeve) {
            sCx = maior(sCx, fl.pct > LIM.fluxoGrave ? 'grave' : 'leve');
            tCx.push('Saídas = ' + fl.pct + '% das entradas (gasta mais do que entra)');
        }
        grupo(sCx, 'caixa', tCx.join(' · ') + (mVerm >= 2 && fl && fl.pct > LIM.fluxoGrave ? ' (provado nos dois lados: reprova)' : ''));
        if (!mCh && scan && scan.chequeEspecial >= 2) obs.push('O extrato cita cheque especial (' + scan.chequeEspecial + 'x) e a IA não confirmou uso: confira.');

        // 4) endividamento: comprometimento da renda, quantidade de dividas, divida nova
        var credores = (d.compromissosLista || []).filter(ehDivida).length, sEn = null, tEn = [];
        if (pct !== null && pct > LIM.compGrave) { sEn = 'grave'; tEn.push('Compromissos fixos = ' + pct + '% da renda' + (pct > LIM.compReprova ? ' (acima de ' + LIM.compReprova + '%: reprova)' : '')); }
        else if (pct !== null && pct > LIM.compMedio) { sEn = 'leve'; tEn.push('Compromissos fixos = ' + pct + '% da renda'); }
        if (credores >= LIM.credoresGrave) {
            sEn = maior(sEn, pct !== null && pct > LIM.credoresComCompGrave ? 'grave' : 'leve');
            tEn.push(credores + ' dívidas/parcelamentos ativos');
        } else if (credores === 2) { sEn = maior(sEn, 'leve'); tEn.push('2 dívidas/parcelamentos ativos'); }
        if (sin.emprestimoNovoUltimoMes === true || String(sin.emprestimoNovoUltimoMes).toLowerCase() === 'true') { sEn = maior(sEn, 'leve'); tEn.push('Empréstimo/dívida nova no último mês'); }
        if (d.compromissoDuvida) { sEn = maior(sEn, 'leve'); tEn.push('Compromissos não confirmados (o extrato tem sinais e a IA não achou nenhum)'); }
        else if (pct === null) { sEn = maior(sEn, 'leve'); tEn.push('Compromissos fixos não informados pela IA'); }
        grupo(sEn, 'endividamento', tEn.join(' · '));

        // 5) estabilidade da renda: variacao entre os meses COMPLETOS
        var meses = calc && calc.usados ? calc.usados.filter(function (m) { return !m.parcial && m.liquido > 0; }) : [];
        var cv = meses.length >= 2 ? oscilacaoParaBaixo(meses.map(function (m) { return m.liquido; })) : null;
        var estavel = cv !== null && cv <= LIM.quedaEstavel, motivoInstavel = '';
        if (cv === null) motivoInstavel = 'menos de 2 meses completos comprovados: não dá para medir a estabilidade';
        else if (cv > LIM.quedaGrave) grupo('grave', 'renda', 'Renda muito irregular (meses fracos ficam ' + Math.round(cv * 100) + '% abaixo da média)');
        else if (cv > LIM.quedaEstavel) grupo('leve', 'renda', 'Renda irregular (meses fracos ficam ' + Math.round(cv * 100) + '% abaixo da média)');

        // 6) reserva: so pesa se ha dividas a pagar
        var entMedia = fl && fl.meses ? fl.entradas / fl.meses : 0;
        var caixaPositivo = !!(saldos && entMedia > 0 && saldos.negativos === 0 && saldos.media >= LIM.reservaMinPct * entMedia);
        if (saldos && entMedia > 0 && d.compromissos > 0 && saldos.media / entMedia < LIM.reservaZeroPct && saldos.negativos === 0) {
            grupo('leve', 'reserva', 'Sem reserva: saldo médio de fim de mês de ' + reaisCurto(saldos.media) + ' com dívidas a pagar');
        }

        // faixa
        // caixa no vermelho provado pelos dois lados (saldo/cheque especial em 2+ meses E saidas muito acima das entradas) = reprova
        var caixaDupla = mVerm >= 2 && !!fl && fl.pct > LIM.fluxoGrave;
        var reprova = (pct !== null && pct > LIM.compReprova) || graves.length >= 2 || caixaDupla;
        var compOk = function (lim) { return pct === null || pct <= lim; };   // desconhecido ja entrou como sinal leve
        var medio = !reprova && !graves.length && leves.length <= 1 && estavel && compOk(LIM.compMedio);
        var forte = medio && !leves.length && pct !== null && pct <= LIM.compForte && caixaPositivo && meses.length >= 3 && !(calc && calc.curto);
        var faixa = reprova ? 'REPROVADO' : forte ? 'FORTE' : medio ? 'MEDIO' : 'FRACO';

        // nota dentro da faixa: folga na renda comprometida, estabilidade e caixa; cada sinal leve tira um pouco
        var partes = [];
        if (pct !== null) partes.push(limitar01((LIM.compGrave - pct) / LIM.compGrave));
        if (cv !== null) partes.push(limitar01(1 - cv / LIM.quedaGrave));
        if (saldos && entMedia > 0) partes.push(limitar01(saldos.media / (0.2 * entMedia)));
        var forca = partes.length ? partes.reduce(function (a, v) { return a + v; }, 0) / partes.length : 0.5;
        forca = limitar01(forca - 0.15 * leves.length - (reprova ? 0 : 0.1 * graves.length));
        var fx = FAIXAS[faixa], nota = Math.min(NOTA_TETO, fx.min + Math.round((fx.max - fx.min) * forca));

        // o que impede a faixa de cima (ajuda o vendedor a explicar)
        var falta = [];
        if (faixa === 'FRACO') {
            graves.forEach(function (g) { falta.push(g.texto); });
            if (leves.length > 1) leves.forEach(function (g) { falta.push(g.texto); });
            if (!estavel && motivoInstavel) falta.push(motivoInstavel);
            if (pct !== null && pct > LIM.compMedio && !graves.some(function (g) { return g.grupo === 'endividamento'; }) && !leves.some(function (g) { return g.grupo === 'endividamento'; })) falta.push('Compromissos fixos = ' + pct + '% da renda');
        } else if (faixa === 'MEDIO') {
            leves.forEach(function (g) { falta.push(g.texto); });
            if (pct !== null && pct > LIM.compForte) falta.push('Compromissos fixos = ' + pct + '% da renda (para FORTE: até ' + LIM.compForte + '%)');
            if (!caixaPositivo) falta.push(saldos ? 'Caixa baixo: saldo médio de fim de mês de ' + reaisCurto(saldos.media) : 'Saldos de fim de mês não informados');
            if (meses.length < 3 || (calc && calc.curto)) falta.push('Menos de 3 meses completos de comprovante');
        }
        return { faixa: faixa, nota: nota, forca: forca, graves: graves, leves: leves, obs: obs, falta: falta, estavel: estavel, cv: cv,
                 motivoInstavel: motivoInstavel, comprometimentoPct: pct, caixaPositivo: caixaPositivo, saldos: saldos, credores: credores };
    }

    function textoFaixa(av) {
        var L = ['Faixa: ' + av.faixa + ' · nota ' + av.nota + ' (decidida pelos sinais abaixo, sem soma de pontos)'];
        L.push(av.graves.length ? 'Sinais graves:' : 'Sinais graves: nenhum');
        av.graves.forEach(function (g) { L.push('⚠ ' + g.texto); });
        L.push(av.leves.length ? 'Sinais leves:' : 'Sinais leves: nenhum');
        av.leves.forEach(function (g) { L.push('• ' + g.texto); });
        L.push('Pilares:');
        L.push((av.estavel ? '✓ Estabilidade da renda: ok (meses fracos ficam ' + Math.round(av.cv * 100) + '% abaixo da média)' : '✗ Estabilidade da renda: ' + (av.motivoInstavel || (av.cv !== null ? 'meses fracos ficam ' + Math.round(av.cv * 100) + '% abaixo da média' : 'não medida'))));
        L.push(av.comprometimentoPct === null ? '? Capacidade: compromissos não confirmados' : (av.comprometimentoPct <= LIM.compMedio ? '✓' : '✗') + ' Capacidade: compromissos fixos = ' + av.comprometimentoPct + '% da renda');
        L.push(av.saldos ? (av.caixaPositivo ? '✓' : '✗') + ' Caixa: saldo médio de fim de mês de ' + reaisCurto(av.saldos.media) + (av.saldos.negativos ? ' (' + av.saldos.negativos + ' mês no vermelho)' : '') : '? Caixa: saldos não informados');
        if (av.falta.length) { L.push(av.faixa === 'FRACO' ? 'Para subir de faixa:' : 'Para chegar a FORTE:'); av.falta.forEach(function (t) { L.push('– ' + t); }); }
        av.obs.forEach(function (t) { L.push('ℹ ' + t); });
        return L.join('\n');
    }

    // A faixa vale sempre que ha renda: a IA nao pontua mais, entao dado que faltou (meses, compromissos, saldos) vira
    // incerteza e a faixa fica conservadora (FRACO), com a explicacao na tela. Sem renda, as regras de renda reprovam.
    function faixaAplicavel(d) {
        return d.rendaEstimada > 0;
    }

    // Aplica renda calculada + faixa. Idempotente. calcPre = renda da etapa 1 (so texto), se houver.
    function finalizarPontuacao(d, calcPre) {
        var raw = d.rawJson || {};
        var calc = calcPre || calcularRenda(raw);
        separarCasasJogo(d);
        d.rendaCalc = calc || null;
        d.fluxoCodigo = fluxoConfiavel(raw, calc);   // saidas e saldos provados pelo codigo (ou fluxo da IA descartado); fica salvo com a analise
        d.saldosCodigo = saldosDoCodigo(calc);
        if (calc && calc.fonte === 'codigo') { d.rendaEstimada = calc.renda; d.rendaDetalhe = descreverRenda(calc); }
        else d.rendaDetalhe = '';

        calcularComprometimento(d);

        d.faixaAplicada = false;
        if (d.nomesBatem === false || !faixaAplicavel(d)) return d;
        var av = avaliarFaixa(d);
        if (d.calculoIA === undefined) d.calculoIA = d.calculo || '';
        d.nota = av.nota; d.avaliacao = av; d.faixaAplicada = true;
        var eraReprovado = d.reprovado;
        classificarPorNota(d);
        if (d.reprovado && !d.motivos) {
            d.motivos = 'Faixa REPROVADO (nota ' + d.nota + ').' + (av.graves.length ? '\n' + av.graves.map(function (g) { return '• ' + g.texto; }).join('\n') : '');
        } else if (eraReprovado && !d.reprovado) d.motivos = '';
        d.calculo = textoFaixa(av) + (d.calculoIA ? '\n\nResumo da IA:\n' + d.calculoIA : '');
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
    // Confiança da leitura (regra do dono: dinheiro próprio, na dúvida REPROVA e escreve o motivo).
    // Só vale quando nenhuma outra regra já reprovou (apostas, nota, titularidade, renda mínima).
    function textoCompromissoDuvida(d) {
        var termos = d.sinaisCompromisso && d.sinaisCompromisso.termos || [];
        return 'a IA não achou nenhum, mas o extrato tem ' + d.sinaisCompromisso.total + ' menções a ' +
            (termos.length ? termos.map(function (t) { return t.replace(/\s*\(\d+\)$/, ''); }).join(', ') : 'fatura, parcela, aluguel ou similares');
    }
    function motivosConfiancaBaixa(d) {
        var L = [], c = d.rendaCalc;
        if (c && c.fonte === 'codigo') {
            if ((c.divergentes || []).length) L.push({ t: 'Não consegui ler o extrato', x: c.divergentes.map(function (v) { return labelMes(v.mes) + ': lido ' + reaisCurto(v.soma) + ', o extrato diz ' + reaisCurto(v.total) + '.'; }).join(' ') + ' A leitura errou mais de ' + Math.round(TOL_LEITURA * 100) + '% do total impresso: sem número confiável não dá para saber a renda. Peça o PDF baixado direto do app do banco.' });
            var inc = [];
            if (c.faltando > 0) inc.push('a IA detalhou só ' + c.usados.length + ' de ' + (c.usados.length + c.faltando) + ' meses do período');
            if (c.agrupado) inc.push('a leitura juntou o período inteiro num item só, sem separar por mês');
            if (c.curto) inc.push(c.dias != null ? 'o extrato cobre só ' + c.dias + ' dias (o mínimo é ' + DIAS_MINIMO + ')' : 'o extrato tem menos de 3 meses');
            if (inc.length) { var t = inc.join('; '); L.push({ t: 'Extrato incompleto', x: t.charAt(0).toUpperCase() + t.slice(1) + '.' }); }
        }
        if (d.compromissoDuvida) L.push({ t: 'Compromissos fixos não confirmados', x: textoCompromissoDuvida(d).replace(/^a IA/, 'A IA') + '.' });
        if (d.confianca === 'BAIXA') L.push({ t: 'Documento difícil de ler', x: 'A IA não conseguiu ler o documento com segurança. Peça uma foto ou um PDF melhor.' });
        return L;
    }
    function aplicarConfiancaBaixa(d) {
        if (d.reprovado) return;
        var L = motivosConfiancaBaixa(d);
        if (!L.length) return;
        d.confBaixa = true; d.confMotivos = L;
        d.aprov = false; d.reprovado = true; d.downgrade = false; d.entradaAlta = false;
        d.nota = Math.min(d.nota, NOTA_REPROVA); d.risco = 'REPROVADO'; d.entradaPct = FAIXAS.REPROVADO.entradaPct;
        d.motivos = 'Confiança baixa na leitura. Reprovado por segurança:\n' + L.map(function (m, i) { return (i + 1) + '. ' + m.t + ' — ' + m.x; }).join('\n');
    }

    function avisoDivergencia(d) {
        if (!d.rawJson || d.nomesBatem === false) return '';
        var ia = iaReprovou(d), casas = (d.casasJogo || []).filter(Boolean);
        if (ia && !d.reprovado) {
            var susp = (d.suspeitasJogo || []).filter(Boolean);
            var porAposta = casas.length > 0 || susp.length > 0 || /aposta|jog|bet/i.test(String((d.rawJson.motivosReprovacao || '') + ' ' + (d.resumoExec || '')));
            return 'A IA recomendou reprovar, mas pelas regras do sistema o cliente passa (nota ' + d.nota + ').' +
                (porAposta ? ' Apostas: ' + (casas.length ? casas.length + (casas.length > 1 ? ' casas sinalizadas' : ' casa sinalizada') + ' neste registro, analisado antes da regra "qualquer casa confirmada reprova".'
                        : susp.length ? susp.length + (susp.length > 1 ? ' nomes suspeitos' : ' nome suspeito') + ' (' + susp.slice(0, 2).join(', ') + '), que não são casas de aposta confirmadas e por isso não descontam nota.'
                        : 'sinais no extrato, sem casa confirmada.') + ' Confira a transação em "Casas de jogo" antes de fechar.'
                    : ' Confira a análise completa antes de fechar.');
        }
        if (!ia && d.reprovado) return 'A IA tinha aprovado, mas o sistema reprovou' + (d.motivos ? ': ' + String(d.motivos).split('\n')[0] : '.');
        return '';
    }

    // ════════════════════════════════════════════�
    //  WHATSAPP DO CLIENTE (opcional): numero limpo + link que abre direto na conversa
    // ════════════════════════════════════════════�
    // Devolve so os digitos (DDD + numero, 10 ou 11) ou '' se nao for um celular/fixo brasileiro valido.
    // Aceita +55, 55, zero na frente, espacos, parenteses e traco.
    function normalizarTelefone(txt) {
        var dig = String(txt == null ? '' : txt).replace(/\D/g, '');
        if (dig.length >= 12 && dig.length <= 13 && dig.indexOf('55') === 0) dig = dig.slice(2);
        if (dig.length === 11 && dig.charAt(0) === '0') dig = dig.slice(1);   // 0 + DDD + 8 digitos
        else if (dig.length === 12 && dig.charAt(0) === '0') dig = dig.slice(1);
        if (dig.length !== 10 && dig.length !== 11) return '';
        if (/^0/.test(dig) || dig.slice(0, 2) === '00') return '';
        if (dig.length === 11 && dig.charAt(2) !== '9') return '';              // celular com 9 digitos comeca em 9
        return dig;
    }
    // (62) 99999-9999
    function formatarTelefone(dig) {
        dig = String(dig || '').replace(/\D/g, '');
        if (dig.length <= 2) return dig;
        var ddd = '(' + dig.slice(0, 2) + ') ';
        if (dig.length <= 6) return ddd + dig.slice(2);
        if (dig.length <= 10) return ddd + dig.slice(2, dig.length - 4) + (dig.length > 6 ? '-' + dig.slice(-4) : '');
        return ddd + dig.slice(2, 7) + '-' + dig.slice(7, 11);
    }
    // Sem numero valido: abre o WhatsApp para a pessoa escolher a conversa (como era antes)
    function linkWhatsapp(tel, msg) {
        var n = normalizarTelefone(tel);
        return 'https://wa.me/' + (n ? '55' + n : '') + '?text=' + encodeURIComponent(msg || '');
    }

    // ════════════════════════════════════════════
    //  TEXTO DO EXTRATO DIGITAL: cabe no limite SEM perder meses inteiros
    // ════════════════════════════════════════════
    var LIMITE_TEXTO_DIGITAL = 100000;   // caracteres (≈ 35 mil tokens) enviados a IA no total
    var SEP_PAGINA = '\n--- PROXIMA PAGINA ---\n';

    // Tira espacos repetidos e linhas vazias; descarta paginas sem nenhum valor em R$ (propaganda/avisos),
    // desde que o arquivo tenha outras paginas com valores.
    function compactarTextoPdf(paginas) {
        var temValor = /\d[\d.]*,\d{2}/;
        var lim = (paginas || []).map(function (t) {
            return String(t || '').split(/\r?\n/).map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean).join('\n');
        }).filter(Boolean);
        var comValor = lim.filter(function (t) { return temValor.test(t); });
        return (comValor.length ? comValor : lim).join(SEP_PAGINA);
    }

    // arquivos = [[pagina, pagina...], [pagina...]] (um item por PDF, na ordem enviada).
    // Se tudo cabe, vai tudo. Se nao, cada arquivo recebe uma cota igual (o que sobra de um arquivo
    // pequeno e repassado aos maiores) e so o FINAL de cada arquivo grande e cortado.
    // Devolve { texto, cortado } — cortado=true se algo ficou de fora.
    function montarTextoDigital(arquivos, limite) {
        limite = limite || LIMITE_TEXTO_DIGITAL;
        var docs = (arquivos || []).map(compactarTextoPdf).filter(Boolean);
        if (!docs.length) return { texto: '', cortado: false };
        var ordem = docs.map(function (d, i) { return i; }).sort(function (a, b) { return docs[a].length - docs[b].length; });
        var cotas = [], restante = limite, faltam = docs.length;
        ordem.forEach(function (i) {
            var cota = Math.floor(restante / faltam);
            cotas[i] = Math.min(docs[i].length, cota);
            restante -= cotas[i]; faltam--;
        });
        var cortado = false;
        var partes = docs.map(function (d, i) {
            var t = d;
            if (d.length > cotas[i]) {
                cortado = true;
                var corte = d.lastIndexOf('\n', cotas[i]);
                t = d.substring(0, corte > 0 ? corte : cotas[i]) + '\n[... RESTANTE DESTE ARQUIVO CORTADO POR TAMANHO ...]';
            }
            return docs.length > 1 ? '=== ARQUIVO ' + (i + 1) + ' de ' + docs.length + ' ===\n' + t : t;
        });
        return { texto: partes.join('\n\n'), cortado: cortado };
    }

    function buildPrompt(rendaPre) {
        return (
'Voce e um analista de credito senior da Workcell, loja de celulares em Goiania-GO.\n'+
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

'=== NOTA E FAIXA: DECIDIDAS PELO SISTEMA ===\n'+
'Voce NAO pontua nem soma nota. O sistema decide a faixa (FORTE, MEDIO, FRACO ou REPROVADO) e a nota a partir de FATOS que voce informa. A nota mede a chance de o cliente PAGAR em dia; o TAMANHO da renda NAO entra (so define o valor do aparelho).\n'+
'O que indica calote: atrasos e multas, cheque especial constante, fatura paga no minimo/rotativo, muitas dividas e parcelas, compromissos que consomem boa parte da renda, gastar mais do que entra, renda irregular. Delivery, lazer e compras NAO sao sinal de calote: cite so como observacao em PADROES DE RISCO. Repassar o dinheiro de clientes/vendas (conta de passagem) nao e gasto da pessoa.\n'+
'Informe SO o que o extrato prova (na duvida: 0 ou false e explique no texto):\n'+
'  sinais.atrasosMeses: em quantos dos meses (0 a 3) ha pagamento com multa, juros de mora ou encargo por atraso\n'+
'  sinais.chequeEspecialMeses: em quantos meses houve uso do cheque especial/limite (juros de limite, IOF de adiantamento, saldo negativo)\n'+
'  sinais.faturaMinimoMeses: em quantos meses a fatura do cartao foi paga no minimo, em rotativo ou parcelada\n'+
'  sinais.emprestimoNovoUltimoMes: true SO se entrou credito de emprestimo/financiamento/consignado no ultimo mes, ou ha compromisso novo que nao existia nos meses anteriores\n'+
'  sinais.evidencias: ate 5 linhas curtas "mes: lancamento" que provam os sinais acima\n'+
'  saldosMeses: por mes, saldoFinal e menorSaldo (o menor saldo do mes, se o extrato mostrar saldo diario; senao repita o saldo final)\n'+
'\n'+
'=== APENAS 2 REPROVACOES OBRIGATORIAS ===\n'+
'1. Renda real < R$ 1.000/mes = REPROVADO (nao tem como pagar)\n'+
'2. Apostador compulsivo = REPROVADO\n'+
'   Casas: PHOENIX GAMING, PIXBET, BLAZE, APOSTARAIZ, BANKS TECH, ATM PUBLICIDADE,\n'+
'   SMART CLUSTER, M V D S M TECHNOLOGY, LOTTOPAY, GM INTERMEDIACAO, WIINPAY,\n'+
'   AJC GATEWAY, NEXUMPAY, UNIVEBET, VAIDEBET, BETNACIONAL, R TORRES, NORBE FINTECH,\n'+
'   GOLD NOW, LUXTAK, ou nome contendo BET/GAMING/APOSTAS/CASSINO.\n'+
'   "SAQUE DIN LOTERICO" NAO e aposta — e operacao bancaria.\n'+
'   QUALQUER casa confirmada (ate 1 unica transacao) = REPROVADO. O sistema aplica; voce so lista a casa.\n'+
'   So liste em casasDeJogoEncontradas o que tem CERTEZA que e casa de aposta. Na duvida use suspeitasJogo.\n\n'+

'Nota 50 ou menos tambem reprova (o sistema decide). Todo o resto APROVA com condicoes (o sistema aplica depois):\n'+
'  FORTE (85-100): entrada 38% | teto parcela 30% da renda\n'+
'  MEDIO (60-84):  entrada 40% | teto parcela 20% da renda\n'+
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
'calculoPontuacao: 2 a 3 frases curtas com o que mais pesa A FAVOR e CONTRA o cliente (sem numero de nota: o sistema decide a faixa).\n'+
(rendaPre ? '' : 'rendaEstimada: sua estimativa da renda mensal (reserva; o sistema recalcula a partir de rendaMeses).\n')+
'compromissos: lista dos compromissos FIXOS do cliente. ANTES de responder, percorra os DEBITOS de cada mes procurando cada tipo abaixo, um por um:\n'+
'  fatura de cartao de credito (pagamento da fatura), emprestimo/consignado, financiamento, consorcio, crediario/carne/boleto de loja, parcelamento,\n'+
'  aluguel, plano de saude/seguro, mensalidade (escola, faculdade, academia), pensao, e Pix/TED RECORRENTE (mesmo valor ou quase, mesmo destinatario, em 2+ meses).\n'+
'  NAO entram: mercado, farmacia, restaurante, luz, agua, internet, combustivel, transporte e Pix avulso (aparecem em SALDOS e na sobra).\n'+
'  Uma linha por compromisso (NAO repita o mesmo credor por mes), com o nome do credor em descricao. valorMensal = quanto ele pesa POR MES (valor medio por mes no periodo; se pagou em so 1 dos meses, divida pelos meses do periodo). meses = em quantos meses apareceu.\n'+
'  Lista vazia [] SO se voce realmente procurou todos os tipos acima e nao achou nenhum. Na duvida, liste e explique em COMPROMISSOS FIXOS.\n'+
'fluxoMeses: por mes, entradas = soma dos creditos REAIS (sem estornos, sem transferencias entre contas do proprio titular, sem resgate de investimento) e saidas = soma dos debitos REAIS, pela mesma regra (sem transferencias para contas do proprio titular, sem aplicacao em investimento/poupanca, sem estorno). Entradas e saidas precisam usar o MESMO criterio. O sistema mede se o cliente gasta mais do que entra a partir desses dois numeros, entao confira a soma.\n'+
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
'  "calculoPontuacao": "O que mais pesa a favor e contra o cliente.",\n'+
'  "sinais": {"atrasosMeses":0,"chequeEspecialMeses":0,"faturaMinimoMeses":0,"emprestimoNovoUltimoMes":false,"evidencias":[]},\n'+
'  "saldosMeses": [{"mes":"AAAA-MM","saldoFinal":0.00,"menorSaldo":0.00}],\n'+
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

    // Conferência de titularidade EM CÓDIGO: a IA sozinha aprovou "Pastelaria do junior" no documento de "Otair ... Junior" (casou só o "Junior").
    // Só gera aviso (não reprova): MEI/empresa legítima existe; quem decide é a pessoa. Fraude clara continua sendo decidida pela IA (nomesBatem=false).
    var TIT_IGNORA = { DE: 1, DA: 1, DO: 1, DAS: 1, DOS: 1, E: 1 };
    var TIT_SUFIXO = { JUNIOR: 1, JR: 1, FILHO: 1, FILHA: 1, NETO: 1, NETA: 1, NETTO: 1, SOBRINHO: 1, SEGUNDO: 1, SEGUNDA: 1 };  // sozinhos não provam que é a mesma pessoa
    function titTokens(s) {
        return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ')
            .filter(function (t) { return t.length > 1 && !TIT_IGNORA[t]; });
    }
    function conferirTitularidade(nomeDoc, nomeRenda) {
        var D = titTokens(nomeDoc), C = titTokens(nomeRenda);
        if (!D.length || !C.length) return null;
        var empresa = /\b(LTDA|MEI|EPP|EIRELI|CNPJ|S\s?\/?\s?A)\b/i.test(String(nomeRenda)) || /\d{8,}/.test(String(nomeRenda).replace(/[.\-\/\s]/g, ''));
        var nomeC = C.filter(function (t) { return !/\d/.test(t) && !TIT_SUFIXO[t]; });
        var comum = nomeC.filter(function (t) { return D.indexOf(t) !== -1; }).length;
        var minimo = nomeC.length >= 3 ? 2 : 1;      // nome longo no extrato precisa bater em pelo menos 2 partes; nome curto ("Elvando") em 1
        if (comum >= minimo && !(empresa && comum < 2)) return null;
        return { tipo: empresa ? 'empresa' : 'nome', doc: String(nomeDoc || ''), comp: String(nomeRenda || '') };
    }
    function avisoTitularidade(t) {
        if (!t) return '';
        return t.tipo === 'empresa'
            ? 'O extrato está em nome de empresa (' + t.comp + ') e o documento é de ' + t.doc + '. Confirme que o cliente é sócio/dono antes de vender.'
            : 'O nome do extrato (' + t.comp + ') não confere com o documento (' + t.doc + '). Se for nome de empresa/fantasia, confirme que o cliente é sócio/dono; senão, confirme que a conta é dele antes de vender.';
    }

    function extrair(texto) {
        var jsonStr = texto;
        try {
            var i1 = texto.indexOf('{'), i2 = texto.lastIndexOf('}');
            if (i1 !== -1 && i2 !== -1 && i2 > i1) jsonStr = texto.substring(i1, i2 + 1);
            var obj = JSON.parse(jsonStr);

            var nomesBatem = obj.nomesBatem !== false;
            var titConferir = nomesBatem ? conferirTitularidade(obj.nomeDocumentoPessoal, obj.nomeComprovanteRenda) : null;
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
            if (nota >= 85) { risco = 'FORTE';      entradaPct = 0.38; }
            else if (nota >= 60) { risco = 'MEDIO'; entradaPct = 0.40; }
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
                nomesBatem: obj.nomesBatem, titConferir: titConferir, confianca: confianca,
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
        // sem produto informado (ou o padrao "Aparelho"), a frase fica genérica
        var nomeAp = String(produto || '').trim();
        if (!nomeAp || nomeAp === 'Aparelho') nomeAp = 'aparelho';
        if (d.downgrade) return 'Ol\u00e1 '+d.nomeCliente+'! Boas not\u00edcias, liberamos cr\u00e9dito pra voc\u00ea! \u2705\n\nO '+produto+' ultrapassou sua margem ideal, MAS temos um limite mais acess\u00edvel aprovado AGORA! \ud83d\ude80\nTemos \u00f3timas op\u00e7\u00f5es no estoque que cabem no seu bolso!\nMe fala qual modelo te interessa \ud83d\udc47';
        if (d.entradaAlta) return 'Ol\u00e1 '+d.nomeCliente+', tudo bem? \ud83d\ude0a\ud83d\udcf2\nSeu cadastro foi avaliado na Workcell! \u2705\n\nPara liberar o '+nomeAp+' e manter a parcela suave, o sistema calculou uma entrada de '+R$(en)+'.\nSua parcela fica em apenas '+np+'x de '+R$(vp)+' MENSAL no boleto! \ud83d\udcc9\n\nVoc\u00ea tem esse valor dispon\u00edvel (FGTS, acerto, poupan\u00e7a)? \ud83d\udc47';
        return 'Ol\u00e1 '+d.nomeCliente+', tudo bem? \ud83d\ude0a\ud83d\udcf2\nSeu cadastro foi APROVADO aqui na Workcell! \u2705\n\n\ud83d\udcf1 '+produto+'\n\ud83d\udcb0 Entrada: '+R$(en)+'\n\ud83d\udcb3 + '+np+'x de '+R$(vp)+' MENSAL no boleto\n\n\u2714 Aparelho revisado e com garantia\nMe confirma aqui pra gente seguir com a libera\u00e7\u00e3o \ud83d\udc47';
    }

    // operador = perfil que mandou a analise (vem do servidor); sem ele, o perfil deste aparelho
    async function salvarFB(nome, produto, texto, d, cpf_cliente, chaveFixa, operador) {
        try {
            var fb = await import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js');
            var db = window._firebaseDB; if (!db) return null;
            var now = Date.now();
            var resumoIA = d.aprov ? (d.resumoExec || d.rascunho || 'Aprovado conforme criterios.') : (d.motivos || 'Reprovado por risco financeiro.');

            var dados = {
                nomeCliente: nome || 'Cliente',
                cpf: cpf_cliente || '',
                telefone: d.telefone || null,
                produto: produto || '',
                decisao: d.reprovado ? 'REPROVADO' : d.downgrade ? 'DOWNGRADE' : d.entradaAlta ? 'ENTRADA_ALTA' : 'APROVADO',
                nota: d.nota,
                risco: d.risco,
                rendaEstimada: d.rendaEstimada || null,
                rendaDetalhe: d.rendaDetalhe || null,
                calculoFinal: d.calculo || null,
                sinaisCompromisso: d.sinaisCompromisso ? d.sinaisCompromisso.total : null,
                compromissosCodigo: d.compromissosCodigo && d.compromissosCodigo.length ? JSON.stringify(d.compromissosCodigo) : null,
                fluxoCodigo: d.fluxoCodigo ? JSON.stringify(d.fluxoCodigo) : null,
                saldosCodigo: d.saldosCodigo ? JSON.stringify(d.saldosCodigo) : null,
                casasJogo: (d.casasJogo || []).filter(Boolean).join(','),
                entrada: d.entrada || null,
                parcelas: d.parcelas || null,
                vparcela: d.vparcela || null,
                taxa: d.taxa || null,
                total: d.total || null,
                resumo: resumoIA,
                confianca: d.confianca || 'ALTA',
                confBaixa: d.confBaixa ? true : null,
                confMotivos: d.confBaixa ? d.confMotivos : null,
                textoCompleto: texto || '',
                ts: now,
                expira: now + HIST_DAYS * 86400000,
                operador: operador || window.currentUserProfile || safeGet('ctwUserProfile') || '--'
            };
            // chave fixa (id da analise): salvar de novo depois de uma retomada sobrescreve o mesmo registro, nao cria outro
            if (chaveFixa) {
                var k = 'cs' + String(chaveFixa).replace(/-/g, '');
                await fb.set(fb.ref(db, SAVE_PATH + '/' + k), dados);
                return k;
            }
            var ref = await fb.push(fb.ref(db, SAVE_PATH), dados);
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

            // Cada analise guarda o texto completo, entao o no inteiro e pesado: le so o periodo pedido
            // (consulta por "ts", a mesma da lista de hoje; sem indice o Firebase le tudo e filtra aqui, como antes)
            // e com limite de tempo, para nunca ficar girando sem fim.
            function lerPeriodo(dias){
                var ini=Date.now()-dias*86400000, q=fb.query(fb.ref(db,SAVE_PATH),fb.orderByChild('ts'),fb.startAt(ini));
                return comLimite(fb.get(q),30000).catch(function(e){
                    if(!semIndiceTs(e)) throw e;
                    // regras sem ".indexOn": "ts": cai na leitura do no inteiro (lenta; compartilhada, 1x a cada poucos minutos)
                    var _l=document.getElementById('cs_hist_items');
                    if(_l)_l.innerHTML='<div class="cs-hist-load"><i class="bi bi-hourglass-split"></i> Carregando todo o historico (pode demorar)...</div>';
                    return lerNoInteiro(fb,db);
                }).then(function(snap){
                    var lista=[];
                    snap.forEach(function(c){var v=c.val();if(v&&v.ts&&v.ts>=ini)lista.push(Object.assign({id:c.key},v));});
                    return lista.sort(function(a,b){return(b.ts||0)-(a.ts||0);});
                });
            }
            var periodDays = 30; // default
            var diasCarregados = periodDays;
            var items=await lerPeriodo(diasCarregados);
            window._histItems=items;
            if(!listWrap)return;

            // ── PERIOD CHIPS ──────────────────────────────────────────────
            function setPeriodChips(){
                document.querySelectorAll('.cs-pchip').forEach(function(b){
                    var isActive = parseInt(b.dataset.days) === periodDays;
                    b.classList.toggle('cs-pchip-ativo', isActive);
                });
            }
            // cloneNode descarta os cliques das aberturas anteriores (antes cada abertura empilhava mais um)
            document.querySelectorAll('.cs-pchip').forEach(function(b0){
                var b=b0.cloneNode(true);b0.parentNode.replaceChild(b,b0);
                b.addEventListener('click',async function(){
                    var dias=parseInt(this.dataset.days);
                    // periodo maior que o ja baixado: busca de novo ja com o periodo maior
                    if(dias>diasCarregados){
                        var _it=document.getElementById('cs_hist_items')||listWrap;
                        _it.innerHTML='<div class="cs-hist-load"><i class="bi bi-hourglass-split"></i> Carregando...</div>';
                        try{
                            items=await lerPeriodo(dias);diasCarregados=dias;window._histItems=items;
                        }catch(e){
                            _it.innerHTML='<div style="padding:16px;color:#f87171">Erro: '+esc(String(e.message||e))+'</div>';
                            return;
                        }
                    }
                    periodDays=dias;
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
                if(restrito()){var sw0=document.getElementById('cs_hist_stats');if(sw0)sw0.innerHTML='';return;}   // vendedor nao ve nota media nem distribuicao
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
                var rest=restrito(), frow=document.getElementById('cs_hist_filtros'); if(frow)frow.style.display=rest?'none':'flex';   // filtro "aprovados" entregaria a decisao
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
                var itemsDiv=document.getElementById('cs_hist_items')||listWrap;if(!filtrados.length){itemsDiv.innerHTML='<div class="cs-hist-empty">'+(items.length?'Nenhum resultado encontrado':'Nenhuma consulta recente')+'</div>';return;}
                var htmlParts=[];
                filtrados.forEach(function(it){
                    try{
                        var idx=items.indexOf(it);
                        var ap=it.decisao==='APROVADO'||it.decisao==='ENTRADA_ALTA'||it.decisao==='DOWNGRADE';
                        var opIt=it.operador&&it.operador!=='--'?it.operador:'', meu=ehDono(opIt), oculta=rest&&(ap||!meu);   // vendedor: so ve a nota da propria reprovada
                        var dt=it.ts?new Date(it.ts).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'--';
                        var tc=rest&&ap?'#9ca3af':ap?'#4ade80':'#f87171';
                        var notaNum=typeof it.nota==='number'?it.nota:(parseInt(it.nota)||null);
                        var notaVal=notaNum!==null?notaNum:'--';
                        var notaCor=notaNum!==null?(notaNum>=80?'#16a34a':notaNum>=60?'#d97706':notaNum>=40?'#f59e0b':'#dc2626'):'#6b7280';
                        if(oculta){notaVal='\u2014';notaCor='#6b7280';}
                        // resumo — forçar string para evitar crash em registros antigos
                        var resumoRaw=String(it.resumo||'');
                        var resumoLimpo=resumoRaw.length>100?resumoRaw.substring(0,100)+'...':resumoRaw;
                        var tags='';
                        if(ap&&!rest){
                            if(it.entrada!=null)tags+='<span class="cs-htag">'+R$(it.entrada)+' entrada</span>';
                            if(it.vparcela!=null)tags+='<span class="cs-htag">12x '+R$(it.vparcela)+'</span>';
                        }
                        if(oculta)resumoLimpo='';
                        var btnReuso=rest&&!meu?'':'<button class="cs-btn-reuso" data-i="'+idx+'"><i class="bi bi-box-arrow-up-right"></i> '+(rest&&ap?'Ver pedido de produtos':'Abrir resultado (0 Tokens)')+'</button>';
                        htmlParts.push(
                            '<div class="cs-hitem2">'+
                                '<div style="display:flex;align-items:flex-start;gap:9px">'+
                                    '<div style="min-width:40px;height:40px;border-radius:10px;background:'+notaCor+'18;border:1.5px solid '+notaCor+';display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0">'+
                                        '<span style="font-size:.95rem;font-weight:900;color:'+notaCor+';line-height:1">'+notaVal+'</span>'+
                                    '</div>'+
                                    '<div style="flex:1;min-width:0">'+
                                        '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px">'+
                                            '<span style="font-size:.82rem;font-weight:800;color:var(--text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(String(it.nomeCliente||'--'))+'</span>'+
                                            '<span style="font-size:.6rem;font-weight:800;color:'+tc+';white-space:nowrap;flex-shrink:0">'+(rest&&ap?'CONCLU\u00cdDA':ap?'\u2705 APROV':'\u274c NEG')+'</span>'+
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

        } catch(e){
            console.error('Erro abrirHist:',e);
            var _errd=document.getElementById('cs_hist_items')||listWrap;
            if(_errd){
                _errd.innerHTML='<div style="padding:16px;color:#f87171">Erro: '+esc(String(e.message||e))+'</div><div style="text-align:center"><button type="button" id="cs_hist_retry" style="padding:8px 16px;border-radius:99px;border:1px solid var(--ui-edge);background:var(--ui-icbg);color:var(--text-color);font-size:.75rem;font-weight:700;cursor:pointer;font-family:inherit"><i class="bi bi-arrow-clockwise"></i> Tentar de novo</button></div>';
                var _rb=document.getElementById('cs_hist_retry');if(_rb)_rb.addEventListener('click',function(){abrirHist();});
            }
        }
    }

    // Sem ".indexOn": "ts" em /creditoscan nas regras do Firebase, a consulta por periodo falha com "Index not defined".
    function semIndiceTs(e){ return /index not defined|indexon/i.test(String((e && e.message) || e)); }

    // Leitura do no INTEIRO (cada analise guarda o texto completo: e pesada e ocupa a conexao do app com o Firebase).
    // Todas as telas que cairem aqui dividem o mesmo resultado por 10 min, em vez de baixar de novo a cada abertura/volta ao app.
    var _lerCheio = null;
    function lerNoInteiro(fb,db){
        if(_lerCheio && Date.now()-_lerCheio.ts<600000) return _lerCheio.p;
        var p=comLimite(fb.get(fb.ref(db,SAVE_PATH)),120000), reg={ts:Date.now(),p:p};
        _lerCheio=reg;
        p.catch(function(){ if(_lerCheio===reg)_lerCheio=null; });
        return p;
    }

    // Promessa com limite de tempo: o get() do Firebase nao tem timeout proprio e, com sinal ruim, ficava pendente para sempre.
    function comLimite(p,ms){
        return new Promise(function(res,rej){
            var t=setTimeout(function(){rej(new Error('Demorou demais para responder. Confira a internet e tente de novo.'));},ms);
            p.then(function(v){clearTimeout(t);res(v);},function(e){clearTimeout(t);rej(e);});
        });
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

    // Lista unica de arquivos (RG/CNH e comprovantes juntos, na ordem em que entraram), cada um com a etiqueta do que o sistema entendeu
    function docsHtml() {
        var grupos = [], pos = {};
        function juntar(lista, kind) {
            lista.forEach(function (d) {
                if (pos[d.aid] === undefined) { pos[d.aid] = grupos.length; grupos.push({ aid: d.aid, kind: kind, nome: d.arq || 'arquivo', n: 0, thumb: d.dataUrl || '' }); }
                grupos[pos[d.aid]].n++;
            });
        }
        juntar(_docsId, 'id'); juntar(_docsRend, 'rend');
        grupos.sort(function (a, b) { return a.aid - b.aid; });
        return grupos.map(function (g) {
            var m = _docMeta[g.aid] || {}, rot = m.rot || (g.kind === 'id' ? 'RG/CNH' : 'Comprovante');
            var ico = g.thumb ? '<img src="' + esc(g.thumb) + '" alt="">' : '<i class="bi bi-file-earmark-check"></i>';
            var sub = m.incerto ? 'Não consegui identificar · toque para escolher' : g.n > 1 ? g.n + ' páginas' : g.kind === 'id' ? 'Documento pessoal' : 'Comprovante de renda';
            var chips = m.incerto
                ? '<button type="button" class="cs-chip warn" data-aid="' + g.aid + '" data-para="id">RG/CNH</button><button type="button" class="cs-chip warn" data-aid="' + g.aid + '" data-para="rend">Comprovante</button>'
                : '<button type="button" class="cs-chip" data-aid="' + g.aid + '" data-para="' + (g.kind === 'id' ? 'rend' : 'id') + '" aria-label="' + esc(rot) + ' (toque para trocar o tipo)">' + esc(rot) + '</button>';
            return '<div class="cs-file">' + ico +
                '<div class="cs-fi"><b>' + esc(g.nome) + '</b><em' + (m.incerto ? ' class="warn"' : '') + '>' + esc(sub) + '</em></div>' + chips +
                '<button type="button" class="cs-file-x" data-t="' + g.kind + '" data-aid="' + g.aid + '" aria-label="Remover"><i class="bi bi-x-lg"></i></button>' +
            '</div>';
        }).join('');
    }
    function chkLinha(ok, nome, tag, obrig) {
        return ok ? '<div class="cs-chk ok"><i class="bi bi-check-lg"></i>' + nome + ' · anexado</div>'
                  : '<div class="cs-chk' + (obrig ? ' warn' : '') + '"><span class="cs-dot"></span>' + nome + ' · ' + tag + '</div>';
    }
    function passoEstado(id, ok, num) { var e = el(id); if (!e) return; e.classList.toggle('ok', ok); e.innerHTML = ok ? '<i class="bi bi-check-lg"></i>' : num; }

    function renderRascunho() {
        var lista = el('cs_docs_all'); if (lista) lista.innerHTML = docsHtml();
        var aids = {}; _docsId.concat(_docsRend).forEach(function (d) { aids[d.aid] = 1; });
        var total = Object.keys(aids).length;
        var z = el('cs_zone'), mais = el('cs_doc_mais'), cnt = el('cs_docs_cnt');
        if (z) z.classList.toggle('cs-h', total > 0);
        if (mais) mais.classList.toggle('cs-h', total === 0);
        if (cnt) cnt.textContent = total ? total + (total > 1 ? ' arquivos' : ' arquivo') : '';
        var chk = el('cs_docs_chk');
        if (chk) chk.innerHTML = chkLinha(_docsRend.length > 0, 'Comprovante de renda', 'obrigatório', true) + chkLinha(_docsId.length > 0, 'RG ou CNH', 'opcional', false);
        var pin = el('cs_pp_in_f'), temProd = _ppSel.f.length > 0 || !!(pin && pin.value.trim().length >= 2);
        passoEstado('cs_step1', _docsRend.length > 0, '1'); passoEstado('cs_step2', temProd, '2');
        var b = el('cs_btn_analisar'); if (b) b.disabled = !(_docsRend.length > 0) || !temProd || _enviando > 0;
        var st = el('cs_up_status'); if (st) st.classList.toggle('cs-h', !(_enviando > 0));
        var falta = []; if (!_docsRend.length) falta.push('o comprovante de renda'); if (!temProd) falta.push('o produto');
        var hint = el('cs_hint_analisar');
        if (hint) hint.textContent = _enviando > 0 ? 'Aguarde terminar de ler os arquivos...' : falta.length ? 'Falta ' + falta.join(' e ') + '.' :
            (filaProvavel() ? 'Os documentos vão para o servidor. Depois de "Enviado" pode fechar o app.' : 'Roda em segundo plano. Pode sair desta tela, avisamos quando ficar pronta.');
    }

    function statusUpload(msg) { var s = el('cs_up_status_txt'); if (s) s.textContent = msg; }

    function tirarPorAid(arr, aid) {   // tira de dentro do proprio array (uma leitura em andamento continua escrevendo nele)
        var tirados = [];
        for (var i = arr.length - 1; i >= 0; i--) if (String(arr[i].aid) === String(aid)) tirados.unshift(arr.splice(i, 1)[0]);
        return tirados;
    }
    function removerArquivo(tipo, aid) {
        var arr = tipo === 'id' ? _docsId : _docsRend;
        tirarPorAid(arr, aid).forEach(liberarDoc);
        delete _docMeta[aid];
        renderRascunho();
    }

    // Le UM arquivo de documento pessoal (foto ou PDF curto) e acrescenta em `destino`. Usado pelo envio normal e pelo Lote.
    async function lerArquivoId(f, aid, destino) {
        try {
            if (f.type.startsWith('image/')) {
                var b64 = await resizeToBase64(f);
                if (b64) destino.push({ base64: b64, dataUrl: URL.createObjectURL(f), arq: f.name, aid: aid });
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
                    return;
                }
                // PDF ok: usa so a primeira pagina como imagem
                var imgs = await pdfToImages(f);
                if (imgs.length > 0 && destino.length < MAX_DOCS_ID) destino.push({ base64: imgs[0].base64, dataUrl: imgs[0].dataUrl, arq: f.name, aid: aid });
            }
        } catch (eF) { console.warn('Falha ao ler arquivo:', f.name, eF); avisar('Não consegui ler "' + f.name + '". Tente outro arquivo.'); }
    }

    // Le UM comprovante de renda (foto ou PDF; PDF digital ja traz o texto) e acrescenta em `destino`. Usado pelo envio normal e pelo Lote.
    async function lerArquivoRend(f, aid, destino, rotulo) {
        try {
            if (f.type.startsWith('image/')) {
                statusUpload('Lendo foto ' + rotulo + '...');
                var b = await resizeToBase64(f);
                if (b) destino.push({ dataUrl: URL.createObjectURL(f), base64: b, tipo: 'imagem', textos: [], ehDigital: false, arq: f.name, aid: aid });
            } else if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
                statusUpload('Lendo PDF ' + rotulo + '...');
                // Extrai texto com posicao Y (PDF digital nao precisa gastar imagem na IA)
                var txtResult = await extrairTextoPdfDigital(f);
                var textos = txtResult.textos || [];
                var digital = txtResult.ehDigital;
                // Renderiza imagens pra preview (e pra IA se escaneado)
                var imgs = await pdfToImages(f);
                imgs.forEach(function (im, idx) {
                    if (destino.length < MAX_DOCS_RND)
                        destino.push({
                            dataUrl: im.dataUrl, base64: im.base64, tipo: 'imagem',
                            textos: textos[idx] ? [textos[idx]] : [], ehDigital: digital,
                            arq: f.name, aid: aid
                        });
                });
            }
        } catch (eF) { console.warn('Falha ao ler arquivo:', f.name, eF); avisar('Não consegui ler "' + f.name + '". Tente outro arquivo.'); }
    }

    // ── Campo unico de documentos: o sistema separa RG/CNH de comprovante de renda sozinho ──
    // PDF digital: pelo texto (o mesmo do Lote). Foto e PDF escaneado: a IA olha. Sem certeza: vira comprovante e a etiqueta pede confirmacao.
    function rotuloRenda(texto) {
        var T = nuSemAcento(texto || '');
        if (/HOLERITE|CONTRACHEQUE|DEMONSTRATIVO DE PAGAMENTO/.test(T)) return 'Holerite';
        if (/EXTRATO|MOVIMENTA|SALDO|\bPIX\b/.test(T)) return 'Extrato';
        return 'Comprovante';
    }
    async function classificarPorIA(f) {
        var b64 = '';
        if (f.type.indexOf('image/') === 0) b64 = await resizeToBase64(f);
        else { var imgs = await pdfToImages(f, 1); b64 = imgs.length ? imgs[0].base64 : ''; }
        if (!b64) return null;
        var resp = await aiCallVision([{ base64: b64 }], '', LT_PROMPT_IA, null);
        var i1 = resp.indexOf('{'), i2 = resp.lastIndexOf('}');
        if (i1 === -1 || i2 <= i1) return null;
        var t = String(JSON.parse(resp.substring(i1, i2 + 1)).tipo || '').toLowerCase();
        return t === 'renda' ? { tipo: 'rend', rot: 'Comprovante' } : t === 'doc' ? { tipo: 'id', rot: 'RG/CNH' } : null;
    }
    async function classificarArquivo(f) {
        var duvida = { tipo: 'rend', rot: 'Comprovante', incerto: true };
        try {
            if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '')) {
                var r = await extrairTextoPdfDigital(f, 2), t1 = (r.textos || []).join('\n'), np = r.numPaginas || 0, tp = ltTipoPdf(t1, np, r.ehDigital);
                if (tp === 'ext') return { tipo: 'rend', rot: rotuloRenda(t1) };
                if (tp === 'doc') return { tipo: 'id', rot: 'RG/CNH' };
                if (np > MAX_PDF_PGS_ID) return { tipo: 'rend', rot: 'Comprovante' };   // PDF longo nunca e documento pessoal
            }
            return (await classificarPorIA(f)) || duvida;
        } catch (e) { console.warn('CreditoScan: nao consegui classificar', f && f.name, e); return duvida; }
    }

    async function handleFilesDocs(files) {
        files = Array.prototype.slice.call(files || []);
        if (!files.length) return;
        _enviando++; renderRascunho();
        try {
            for (var i = 0; i < files.length; i++) {
                var f = files[i], nome = f.name || 'arquivo';
                if (!/^image\//.test(f.type) && f.type !== 'application/pdf' && !/\.pdf$/i.test(nome)) { avisar('"' + nome + '" não é foto nem PDF.'); continue; }
                statusUpload('Identificando ' + (i + 1) + '/' + files.length + ' · ' + nome + '...');
                var c = await classificarArquivo(f), aid = ++_arqSeq;
                if (c.tipo === 'id') {
                    if (_docsId.length >= MAX_DOCS_ID) { avisar('Máximo de ' + MAX_DOCS_ID + ' fotos de documento pessoal.'); continue; }
                    await lerArquivoId(f, aid, _docsId);
                } else {
                    if (_docsRend.length >= MAX_DOCS_RND) { avisar('Máximo de ' + MAX_DOCS_RND + ' páginas atingido.'); break; }
                    await lerArquivoRend(f, aid, _docsRend, (i + 1) + '/' + files.length + ' · ' + nome);
                }
                if (_docsId.concat(_docsRend).some(function (d) { return d.aid === aid; })) _docMeta[aid] = { rot: c.rot, incerto: !!c.incerto };   // so guarda se o arquivo foi lido
                renderRascunho();
            }
        } finally { _enviando--; renderRascunho(); }
    }
    function uploadDocs(camera) {
        var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*,application/pdf'; inp.multiple = true;
        if (camera) inp.capture = 'environment';
        inp.onchange = function (e) { handleFilesDocs(e.target.files); };
        inp.click();
    }
    // Toque na etiqueta: troca o arquivo entre documento pessoal e comprovante de renda (o sistema errou, ou estava em duvida)
    function trocarTipoDoc(aid, para) {
        var meta = _docMeta[aid] || (_docMeta[aid] = {});
        if (para === 'rend') {
            var doId = tirarPorAid(_docsId, aid); if (!doId.length) { meta.incerto = false; renderRascunho(); return; }
            doId.forEach(function (d) { _docsRend.push({ dataUrl: d.dataUrl, base64: d.base64, tipo: 'imagem', textos: [], ehDigital: false, arq: d.arq, aid: d.aid }); });
            meta.rot = 'Comprovante';
        } else {
            if (_docsId.some(function (d) { return String(d.aid) === String(aid); })) { meta.incerto = false; renderRascunho(); return; }
            if (_docsId.length >= MAX_DOCS_ID) { avisar('Máximo de ' + MAX_DOCS_ID + ' fotos de documento pessoal.'); return; }
            var doRend = tirarPorAid(_docsRend, aid); if (!doRend.length) return;
            _docsId.push({ base64: doRend[0].base64, dataUrl: doRend[0].dataUrl, arq: doRend[0].arq, aid: doRend[0].aid });
            meta.rot = 'RG/CNH';
        }
        meta.incerto = false;
        renderRascunho();
    }

    // ════════════════════════════════════════════════════════════════════════════
    // LOTE: vários documentos + vários extratos de uma vez; o sistema descobre de quem é cada arquivo pelo NOME (e pelo CPF quando dá).
    // Esta parte é só código (sem IA, sem tela): leitura do nome no extrato, comparação de nomes e agrupamento em pessoas.
    // Regra de ouro: NUNCA casar por um nome só ("Pastelaria do Junior" x "Otair Junior"). Na dúvida não casa sozinho: vira "confirmar".
    // ════════════════════════════════════════════════════════════════════════════
    var LT_STOP = /^(?:DE|DA|DO|DAS|DOS|LTDA|ME|MEI|EPP|EIRELI|SA)$/;
    // "Maria de Souza", "SANTOS, MARIA", "51.602.474 ANA CAROLINA ..." -> ['MARIA','SOUZA'] (sem acento, sem preposição, sem número). Inicial solta ("S") fica.
    function ltTokens(nome) {
        var s = nuSemAcento(nome).replace(/\s+/g, ' ').trim();
        var vir = /^([^,]{2,40}),\s*(.+)$/.exec(s);
        if (vir) s = vir[2] + ' ' + vir[1];
        return s.replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(function (t) { return t && (t.length === 1 ? t !== 'E' : !LT_STOP.test(t)); });
    }
    function ltIniciaisOk(a, b) { return (a.length === 1 && b.charAt(0) === a) || (b.length === 1 && a.charAt(0) === b); }
    // Compara duas listas de tokens: ex = palavras iguais, tudo = a lista menor cabe inteira na maior (inicial vale como palavra), dice = parecença 0..1
    function ltCompara(A, B) {
        var P = A.length <= B.length ? A : B, G = A.length <= B.length ? B : A, usados = {}, ex = 0, ok = 0, i, j;
        var casouP = new Array(P.length);
        for (i = 0; i < P.length; i++) for (j = 0; j < G.length; j++) if (!usados[j] && P[i] === G[j]) { usados[j] = 1; casouP[i] = 1; ex++; ok++; break; }
        for (i = 0; i < P.length; i++) {
            if (casouP[i]) continue;
            for (j = 0; j < G.length; j++) if (!usados[j] && ltIniciaisOk(P[i], G[j])) { usados[j] = 1; casouP[i] = 1; ok++; break; }
        }
        var primeiro = P.length > 0 && G.indexOf(P[0]) !== -1;   // o 1º nome da lista menor aparece na maior (ex.: "Caroline Silva" x "Ana Caroline Silva")
        return { ex: ex, tudo: P.length > 0 && ok === P.length, dice: A.length + B.length ? 2 * ok / (A.length + B.length) : 0, primeiro: primeiro, nP: P.length };
    }
    // Quanto um nome (e CPF parcial) combina com outro. n: 2 = certo (CPF igual + ao menos 1 palavra), 1 = casa sozinho (>=2 palavras iguais, a menor lista cabe
    // inteira na maior e o 1º nome bate), 0.5 = "talvez" (só sugere), 0 = não.
    function ltForca(a, b) {
        var c = ltCompara(a.tok, b.tok), cpfIgual = !!(a.cpfMeio && b.cpfMeio && a.cpfMeio === b.cpfMeio);
        var n = 0;
        if (a.cpfMeio && b.cpfMeio && !cpfIgual) return { n: 0, dice: c.dice, ex: c.ex };   // CPFs diferentes = pessoas diferentes (homônimos), por mais parecido que seja o nome
        if (cpfIgual && c.ex >= 1) n = 2;
        else if (c.ex >= 2 && c.tudo && c.primeiro) n = 1;
        else if (c.ex >= 1 && c.dice >= 0.4) n = 0.5;
        return { n: n, dice: c.dice, ex: c.ex };
    }
    // CPF impresso no extrato/documento -> os 6 dígitos do MEIO (o Nubank esconde o começo e o fim: •••.047.201-••). '' se não achar.
    function ltCpfMeio(texto) {
        var t = String(texto || ''), m = /(?:^|[^\d])(?:\d{3}|[•*Xx.]{2,3})\.(\d{3})\.(\d{3})-(?:\d{2}|[•*Xx]{2})(?!\d)/.exec(t);
        if (m) return m[1] + m[2];
        m = /CPF(?:\/CNPJ)?\s*:?\s*(\d{11})(?!\d)/i.exec(t);   // sem pontuação (Mercado Pago)
        return m ? m[1].slice(3, 9) : '';
    }
    function ltCpfMeioDeCpf(cpf) { var d = String(cpf || '').replace(/\D/g, ''); return d.length === 11 ? d.slice(3, 9) : ''; }
    // Nome de pessoa (mais folgado que nomeValido: nome completo de brasileiro chega a 9 palavras) ou '' se parece rótulo/empresa
    function ltNomeOk(n) {
        n = String(n || '').replace(/[^A-Za-zÀ-ÿ'. -]/g, ' ').replace(/\s+/g, ' ').trim();
        if (n.length < 6 || n.length > 80 || NOME_PROIBIDO.test(n)) return '';
        var pal = n.split(' ').filter(Boolean), reais = pal.filter(function (w) { return !/^(d[eao]s?|e)$/i.test(w); });
        return reais.length >= 2 && pal.length <= 12 && reais.every(function (w) { return w.length >= 2; }) ? n : '';
    }
    // Nome do titular no texto da 1ª página do extrato: InfinitePay ("12.345.678 NOME - CNPJ: ..."), "Nome" numa linha e o nome na seguinte (Santander),
    // depois "Nome: X" e "NOME + CPF" (Nubank, Itaú, Mercado Pago, Inter).
    function ltNomeExtrato(texto) {
        var linhas = String(texto || '').split(/\r?\n/).map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean).slice(0, 100), m, i, n;
        for (i = 0; i < linhas.length; i++) {
            m = /^(?:[\d.\/-]{6,} )?(.{6,80}?) - (?:CNPJ|CPF):/i.exec(linhas[i]);
            if (m && (n = ltNomeOk(m[1]))) return n;
        }
        for (i = 0; i + 1 < linhas.length; i++) {
            if (/^(?:nome|titular|nome do cliente|cliente)\s*:?$/i.test(linhas[i]) && (n = ltNomeOk(linhas[i + 1]))) return n;
        }
        return nomeNoTexto(linhas.join('\n'));
    }
    // Tipo do PDF pelo texto: 'ext' (extrato/comprovante), 'doc' (RG/CNH digital) ou '' (texto não diz: a IA olha a 1ª página).
    // CNH digital (CNH-e) costuma trazer só o aviso de assinatura digital no texto: por isso PDF curto SEM palavra de extrato fica '' e não 'ext'.
    function ltTipoPdf(texto, numPag, digital) {
        if (!digital) return '';
        if (numPag > 3) return 'ext';
        var T = nuSemAcento(texto), ehExtrato = /EXTRATO|SALDO|HOLERITE|CONTRACHEQUE|MOVIMENTA|COMPROVANTE DE RENDA|DEMONSTRATIVO DE PAGAMENTO|\bPIX\b/.test(T);
        if (!ehExtrato && /CARTEIRA NACIONAL DE HABILITA|REGISTRO GERAL|CARTEIRA DE IDENTIDADE|DOCUMENTO DE IDENTIFICA|REPUBLICA FEDERATIVA DO BRASIL/.test(T)) return 'doc';
        return ehExtrato ? 'ext' : '';
    }
    // Junta tudo em PESSOAS. arqs: [{aid, tipo:'doc'|'ext', nome (da pessoa, '' se não leu), cpfMeio, ancora?, removido?}].
    // 1) extratos que são da mesma pessoa viram um grupo; 2) cada documento vai para o grupo que combina (sem empate); 3) ajustes manuais (ancora).
    // Devolve { pessoas:[{id, nome, exts:[arq], docs:[arq], talvez:[{doc, dice}]}], semExtrato:[doc], soltos:[arq] }
    function ltAgrupar(arqs) {
        var vivos = arqs.filter(function (a) { return !a.removido; });
        vivos.forEach(function (a) { a.tok = ltTokens(a.nome || ''); });
        var exts = vivos.filter(function (a) { return a.tipo === 'ext' && a.tok.length >= 2; });
        var docs = vivos.filter(function (a) { return a.tipo === 'doc' && a.tok.length >= 2; });
        var soltos = vivos.filter(function (a) { return a.tok.length < 2 || (a.tipo !== 'ext' && a.tipo !== 'doc'); });
        var pai = {}; exts.forEach(function (a) { pai[a.aid] = a.aid; });
        var raiz = function (x) { while (pai[x] !== x) { pai[x] = pai[pai[x]]; x = pai[x]; } return x; };
        for (var i = 0; i < exts.length; i++) for (var j = i + 1; j < exts.length; j++) {
            if (!exts[i].sep && !exts[j].sep && ltForca(exts[i], exts[j]).n >= 1) pai[raiz(exts[i].aid)] = raiz(exts[j].aid);   // sep = o usuário separou este extrato
        }
        var porRaiz = {}, pessoas = [];
        exts.forEach(function (a) {
            var r = raiz(a.aid);
            if (!porRaiz[r]) { porRaiz[r] = { id: 0, nome: '', tok: [], cpfMeio: '', exts: [], docs: [], talvez: [] }; pessoas.push(porRaiz[r]); }
            var p = porRaiz[r]; p.exts.push(a);
            if (a.tok.length > p.tok.length) { p.tok = a.tok; p.nome = a.nome; }   // o nome mais completo do grupo
            if (!p.cpfMeio && a.cpfMeio) p.cpfMeio = a.cpfMeio;
        });
        pessoas.forEach(function (p) { p.id = Math.min.apply(null, p.exts.map(function (a) { return a.aid; })); });
        // documentos: vai para o grupo que combina; empate (dois grupos quase iguais) = não anexa, só sugere
        var semExtrato = [];
        docs.forEach(function (d) {
            var cand = pessoas.map(function (p) { var f = ltForca({ tok: p.tok, cpfMeio: p.cpfMeio }, d); return { p: p, n: f.n, dice: f.dice }; })
                .filter(function (c) { return c.n > 0; }).sort(function (x, y) { return y.n - x.n || y.dice - x.dice; });
            var melhor = cand[0], segundo = cand[1];
            if (melhor && melhor.n >= 1 && (!segundo || segundo.n < melhor.n || melhor.dice - segundo.dice >= 0.2)) {
                melhor.p.docs.push(d); d.pessoaId = melhor.p.id;
            } else if (melhor && melhor.n >= 1) {   // empate entre pessoas: o usuário decide
                cand.filter(function (c) { return c.n >= 1; }).forEach(function (c) { c.p.talvez.push({ doc: d, dice: c.dice }); });
                semExtrato.push(d);
            } else {
                cand.forEach(function (c) { c.p.talvez.push({ doc: d, dice: c.dice }); });   // fraco ("talvez"): só sugere
                semExtrato.push(d);
            }
        });
        // dois documentos no mesmo grupo que são de pessoas diferentes (ex.: "Ana Paula Silva" e "Ana Clara Silva" para o grupo "Ana Silva"): desanexa os dois
        pessoas.forEach(function (p) {
            var ruim = {};
            for (var i = 0; i < p.docs.length; i++) for (var j = i + 1; j < p.docs.length; j++) {
                if (ltForca(p.docs[i], p.docs[j]).n < 1) { ruim[p.docs[i].aid] = 1; ruim[p.docs[j].aid] = 1; }
            }
            if (!Object.keys(ruim).length) return;
            p.docs = p.docs.filter(function (d) { if (!ruim[d.aid]) return true; d.pessoaId = null; p.talvez.push({ doc: d, dice: 0.5 }); semExtrato.push(d); return false; });
        });
        // ajustes manuais: arquivo com "ancora" (aid de um arquivo da pessoa de destino) vai para essa pessoa
        var achar = function (aid) { return pessoas.filter(function (p) { return p.exts.concat(p.docs).some(function (a) { return a.aid === aid; }); })[0] || null; };
        var manuais = vivos.filter(function (a) { return a.ancora; });
        manuais.forEach(function (a) {
            var alvo = achar(a.ancora);
            if (!alvo && a.ancora === a.aid) return;
            pessoas.forEach(function (p) { p.exts = p.exts.filter(function (x) { return x !== a; }); p.docs = p.docs.filter(function (x) { return x !== a; }); });
            semExtrato = semExtrato.filter(function (x) { return x !== a; }); soltos = soltos.filter(function (x) { return x !== a; });
            if (!alvo) { (a.tipo === 'doc' && a.tok.length >= 2 ? semExtrato : soltos).push(a); return; }
            if (a.tipo === 'ext') alvo.exts.push(a); else alvo.docs.push(a);
            a.pessoaId = alvo.id;
        });
        var vazias = pessoas.filter(function (p) { return !p.exts.length; });   // grupo que perdeu todos os extratos
        vazias.forEach(function (p) { p.docs.forEach(function (d) { semExtrato.push(d); }); });
        pessoas = pessoas.filter(function (p) { return p.exts.length; });
        pessoas.forEach(function (p) { p.id = Math.min.apply(null, p.exts.map(function (a) { return a.aid; })); });   // o id acompanha os arquivos depois dos ajustes manuais
        pessoas.forEach(function (p) {
            var feitos = {}; p.talvez = p.talvez.filter(function (t) { if (feitos[t.doc.aid] || p.docs.indexOf(t.doc) !== -1 || semExtrato.indexOf(t.doc) === -1) return false; feitos[t.doc.aid] = 1; return true; })
                .sort(function (x, y) { return y.dice - x.dice; }).slice(0, 2);
        });
        pessoas.sort(function (x, y) { return x.id - y.id; });
        return { pessoas: pessoas, semExtrato: semExtrato, soltos: soltos };
    }

    // ── LOTE: leitura dos arquivos (nome, tipo) e tela ──────────────────────────────────────────────────────────
    var _lote = { arqs: [], lendo: false, analisando: false, excl: {}, status: '' };
    var LT_PROMPT_IA = 'Esta imagem e um documento de uma pessoa brasileira. Responda APENAS um JSON valido: {"tipo":"doc","nome":"","cpf":""}. ' +
        'tipo = "doc" para RG, CNH ou outro documento de identificacao pessoal (inclusive so o verso); "renda" para extrato bancario, holerite, contracheque ou comprovante de renda. ' +
        'nome = nome completo da PESSOA (titular do documento ou do extrato), exatamente como impresso; vazio se nao houver nome legivel (ex.: verso do RG). ' +
        'cpf = somente os 11 digitos se aparecerem, senao vazio. Nao invente nada.';

    function loteChave(f) { return [f.name, f.size, f.lastModified].join('|'); }
    function loteStatus(msg) { _lote.status = msg || ''; var s = el('cs_lt_status'); if (s) s.textContent = _lote.status; }

    // Foto, ou 1ª página de PDF escaneado: a IA diz se é documento/comprovante e lê o nome (e o CPF, que vale mais que o nome)
    async function loteLerPorIA(a) {
        var f = a.file, b64 = '';
        if (f.type.indexOf('image/') === 0) b64 = await resizeToBase64(f);
        else { var imgs = await pdfToImages(f, 1); b64 = imgs.length ? imgs[0].base64 : ''; }
        if (!b64) { a.aviso = 'Não consegui abrir a imagem.'; return; }
        var resp = await aiCallVision([{ base64: b64 }], '', LT_PROMPT_IA, null);
        var i1 = resp.indexOf('{'), i2 = resp.lastIndexOf('}');
        if (i1 === -1 || i2 <= i1) { a.aviso = 'A IA não respondeu direito.'; return; }
        var o = JSON.parse(resp.substring(i1, i2 + 1));
        if (!a.tipo || a.tipo === '?') a.tipo = String(o.tipo).toLowerCase() === 'renda' ? 'ext' : 'doc';
        var nome = ltNomeOk(o.nome); if (nome && !a.nome) a.nome = nome;
        var cpf = String(o.cpf || '').replace(/\D/g, '');
        if (cpfValido(cpf)) { a.cpfFull = cpf; a.cpfMeio = ltCpfMeioDeCpf(cpf); }
    }

    // Descobre o tipo e o nome de UM arquivo, lendo só o começo (a leitura completa fica para depois da confirmação)
    async function loteIdentificar(a) {
        var f = a.file, ehPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
        if (!ehPdf && f.type.indexOf('image/') !== 0) { a.estado = 'erro'; a.aviso = 'Formato não aceito (use foto ou PDF).'; return; }
        a.tipo = '?';
        if (!ehPdf) { a.thumb = URL.createObjectURL(f); await loteLerPorIA(a); return; }
        var r = await extrairTextoPdfDigital(f, 2), t1 = (r.textos || []).join('\n');
        a.numPag = r.numPaginas || 0;
        var tipo = ltTipoPdf(t1, a.numPag, r.ehDigital);
        if (tipo === 'ext') { a.tipo = 'ext'; a.nome = ltNomeExtrato(t1); a.cpfMeio = ltCpfMeio(t1); if (!a.nome) await loteLerPorIA(a); return; }
        await loteLerPorIA(a);   // RG/CNH em PDF ou PDF escaneado
        if (a.numPag > 3) a.tipo = 'ext';   // PDF longo nunca é documento pessoal
    }

    async function loteAdicionar(files) {
        files = Array.prototype.slice.call(files || []);
        if (!files.length) return;
        var vistos = {}, dup = 0;
        _lote.arqs.forEach(function (a) { if (!a.removido) vistos[a.chave] = 1; });
        files.forEach(function (f) {
            var k = loteChave(f);
            if (vistos[k]) { dup++; return; }
            vistos[k] = 1;
            _lote.arqs.push({ aid: ++_arqSeq, file: f, arq: f.name || 'arquivo', chave: k, tipo: '?', nome: '', cpfMeio: '', cpfFull: '', numPag: 0, estado: 'fila', aviso: '', thumb: '' });
        });
        if (dup) avisar(dup + (dup > 1 ? ' arquivos já estavam na lista e foram ignorados.' : ' arquivo já estava na lista e foi ignorado.'));
        renderLote();
        if (_lote.lendo) return;
        _lote.lendo = true;
        try {
            for (;;) {
                var a = _lote.arqs.filter(function (x) { return x.estado === 'fila' && !x.removido; })[0];
                if (!a) break;
                a.estado = 'lendo'; renderLote();
                try { await loteIdentificar(a); if (a.estado === 'lendo') a.estado = 'ok'; }
                catch (e) { console.warn('Lote: falha ao identificar', a.arq, e); a.estado = 'erro'; a.aviso = 'Não consegui ler este arquivo.'; }
                renderLote();
            }
        } finally { _lote.lendo = false; renderLote(); }
    }

    function loteLiberar(a) { try { if (a && a.thumb) URL.revokeObjectURL(a.thumb); } catch (e) {} if (a) a.thumb = ''; }
    function loteRemover(a) { loteLiberar(a); a.removido = true; a.ancora = 0; }
    function loteNomePessoa(p) { return capNome(p.docs.length && p.docs[0].nome ? p.docs[0].nome : p.nome); }
    function loteLimpar() { _lote.arqs.forEach(loteLiberar); _lote.arqs = []; _lote.excl = {}; _lote.status = ''; }

    function loteArqHtml(a, g, atual) {
        var ico = a.thumb ? '<img src="' + esc(a.thumb) + '" alt="">' : '<i class="bi ' + (a.tipo === 'doc' ? 'bi-person-vcard' : 'bi-file-earmark-text') + '"></i>';
        var igual = !!(atual && a.nome && ltTokens(a.nome).join(' ') === ltTokens(loteNomePessoa(atual)).join(' '));   // nome igual ao da pessoa: não repete, só confirma
        var info = a.estado === 'lendo' || a.estado === 'fila' ? 'Lendo…' : a.estado === 'erro' ? a.aviso :
            [igual ? '✓ nome confere' : a.nome ? esc(capNome(a.nome)) : 'sem nome legível', a.numPag > 1 ? a.numPag + ' páginas' : ''].filter(Boolean).join(' · ');
        var opc = '<option value="">Mover…</option>';
        g.pessoas.forEach(function (p) { if (p !== atual) opc += '<option value="p:' + p.exts[0].aid + '">Para ' + esc(loteNomePessoa(p)) + '</option>'; });
        if (a.tipo === 'ext' && atual && atual.exts.length > 1) opc += '<option value="sep">Separar em outra pessoa</option>';
        opc += '<option value="x">Remover da lista</option>';
        return '<div class="cs-lt-f' + (a.estado === 'erro' ? ' erro' : '') + '">' + ico +
            '<span class="cs-lt-n"><b>' + esc(a.arq) + '</b><small' + (a.estado === 'erro' || !a.nome ? ' class="w"' : '') + '>' + info + '</small></span>' +
            '<button type="button" class="cs-lt-tp" data-lt="tipo" data-aid="' + a.aid + '" aria-label="Trocar entre documento e comprovante">' + (a.tipo === 'doc' ? 'Doc' : a.tipo === 'ext' ? 'Extrato' : '?') + '</button>' +
            '<select class="cs-lt-sel" data-lt="mover" data-aid="' + a.aid + '" aria-label="Mover arquivo">' + opc + '</select></div>';
    }

    function renderLote() {
        var corpo = el('cs_lt_body'); if (!corpo) return;
        var g = ltAgrupar(_lote.arqs), h = '', pend = _lote.arqs.filter(function (a) { return !a.removido && (a.estado === 'fila' || a.estado === 'lendo'); }).length;
        var incl = g.pessoas.filter(function (p) { return !_lote.excl[p.id]; }).length;
        if (!_lote.arqs.some(function (a) { return !a.removido; })) h += '<p class="cs-hint">Selecione de uma vez os documentos (RG/CNH) e os extratos de vários clientes. O sistema lê o nome de cada arquivo e junta tudo por pessoa.</p>';
        g.pessoas.forEach(function (p) {
            var nome = loteNomePessoa(p), marcado = !_lote.excl[p.id];
            h += '<div class="cs-card cs-lt-p' + (marcado ? '' : ' off') + '">' +
                '<label class="cs-lt-hd"><input type="checkbox" data-lt="incl" data-id="' + p.id + '"' + (marcado ? ' checked' : '') + '><b>' + esc(nome) + '</b></label>' +
                (p.docs.length ? '<span class="cs-lt-bd ok"><i class="bi bi-check-circle-fill"></i> Documento anexado</span>' : '<span class="cs-lt-bd warn"><i class="bi bi-exclamation-circle"></i> Sem documento · usa o nome do extrato</span>') +
                p.docs.map(function (a) { return loteArqHtml(a, g, p); }).join('') +
                p.exts.map(function (a) { return loteArqHtml(a, g, p); }).join('') +
                p.talvez.map(function (t) { return '<div class="cs-lt-sug">Documento possível: <b>' + esc(capNome(t.doc.nome)) + '</b> <button type="button" class="cs-link" data-lt="anexar" data-aid="' + t.doc.aid + '" data-id="' + p.exts[0].aid + '">Anexar</button></div>'; }).join('') +
                '</div>';
        });
        if (g.semExtrato.length) h += '<div class="cs-card cs-lt-p"><div class="cs-lt-hd"><b>Documentos sem extrato</b></div><p class="cs-hint" style="text-align:left">Sem extrato não dá para analisar. Se o extrato desta pessoa estiver na lista com outro nome, mova o documento para ela.</p>' + g.semExtrato.map(function (a) { return loteArqHtml(a, g, null); }).join('') + '</div>';
        if (g.soltos.length) h += '<div class="cs-card cs-lt-p"><div class="cs-lt-hd"><b>Não identificados</b></div><p class="cs-hint" style="text-align:left">Não deu para ler o nome. Mova cada arquivo para a pessoa certa (ou toque em Doc/Extrato se o tipo estiver errado).</p>' + g.soltos.map(function (a) { return loteArqHtml(a, g, null); }).join('') + '</div>';
        corpo.innerHTML = h;
        var st = el('cs_lt_status'), btn = el('cs_lt_go'), add = el('cs_lt_add');
        if (st) st.textContent = _lote.analisando ? _lote.status : pend ? 'Lendo arquivos… ' + pend + ' restante' + (pend > 1 ? 's' : '') : '';
        if (btn) { btn.disabled = !incl || !!pend || _lote.analisando; btn.innerHTML = '<i class="bi bi-check2-circle"></i> ' + (incl ? 'Analisar ' + incl + (incl > 1 ? ' pessoas' : ' pessoa') : 'Nada para analisar'); }
        if (add) add.disabled = _lote.analisando;
    }

    function loteAcao(e) {
        var t = e.target, bt = t.closest && t.closest('[data-lt]'); if (!bt) return;
        var act = bt.getAttribute('data-lt'), aid = +bt.getAttribute('data-aid'), a = _lote.arqs.filter(function (x) { return x.aid === aid; })[0];
        if (_lote.analisando) return;
        if (act === 'incl') { _lote.excl[+bt.getAttribute('data-id')] = !bt.checked; renderLote(); return; }
        if (!a) return;
        if (act === 'tipo') { a.tipo = a.tipo === 'doc' ? 'ext' : 'doc'; a.ancora = 0; renderLote(); }
        else if (act === 'anexar') { a.ancora = +bt.getAttribute('data-id'); renderLote(); }
        else if (act === 'mover') {
            var v = bt.value; if (!v) return;
            if (v === 'x') loteRemover(a);
            else if (v === 'sep') { a.sep = true; a.ancora = 0; }
            else if (v.indexOf('p:') === 0) { a.ancora = +v.slice(2); a.sep = false; }
            renderLote();
        }
    }

    function loteAbrir() { var o = el('cs_lote_ov'); if (!o || !ehDevPerfil()) return; renderLote(); o.classList.add('active'); }   // Lote e so do dev
    function loteFechar() { var o = el('cs_lote_ov'); if (o) o.classList.remove('active'); }
    function loteEscolher() {
        var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*,application/pdf'; inp.multiple = true;
        inp.onchange = function () { loteAdicionar(inp.files); };
        inp.click();
    }

    // Uma análise normal por pessoa (mesmos arquivos, mesma fila, mesmo servidor); o nome vai da conferência para a lista
    async function loteAnalisar() {
        if (_lote.analisando || _lote.lendo) return;
        var g = ltAgrupar(_lote.arqs), alvo = g.pessoas.filter(function (p) { return !_lote.excl[p.id]; });
        if (!alvo.length) return;
        _lote.analisando = true; renderLote();
        var feitos = 0, falhas = [];
        try {
            for (var i = 0; i < alvo.length; i++) {
                var p = alvo[i], nome = loteNomePessoa(p), docsId = [], docsRend = [], k;
                loteStatus('Preparando ' + (i + 1) + ' de ' + alvo.length + ' · ' + nome + '…');
                var docs = p.docs.slice(0, MAX_DOCS_ID);
                for (k = 0; k < docs.length; k++) await lerArquivoId(docs[k].file, docs[k].aid, docsId);
                var exts = p.exts.slice().sort(function (x, y) { return x.aid - y.aid; });
                for (k = 0; k < exts.length; k++) await lerArquivoRend(exts[k].file, exts[k].aid, docsRend, (k + 1) + '/' + exts.length + ' · ' + exts[k].arq);
                var incompleto = exts.filter(function (x) {   // extrato que perdeu paginas na leitura = mes faltando na renda: nao lanca
                    var lidas = docsRend.filter(function (d) { return d.aid === x.aid; }).length;
                    return !lidas || (x.numPag && lidas < Math.min(x.numPag, MAX_PDF_PGS));
                });
                if (incompleto.length) { falhas.push(nome + ' (' + incompleto.map(function (x) { return x.arq; }).join(', ') + ')'); continue; }
                lancarJob(docsId, docsRend, '', { usuario: usuarioAtual(), nome: nome.substring(0, 80) });
                processarFila();
                feitos++;
                p.docs.concat(p.exts).forEach(function (a) { loteRemover(a); });   // já foi para a fila: sai da conferência
            }
        } finally {
            _lote.analisando = false; loteStatus('');
            _lote.arqs = _lote.arqs.filter(function (a) { return !a.removido; });
            if (feitos) { _formAberto = false; aplicarForm(); renderLista(); }
            renderLote();
        }
        if (falhas.length) avisar('Não consegui ler os extratos de: ' + falhas.join(', ') + '. Essas pessoas continuam na lista.');
        if (feitos && !_lote.arqs.some(function (a) { return a.tipo === 'ext'; })) { loteLimpar(); loteFechar(); }
    }

    // ================================================================
    // TELA INICIAL: nova analise + andamento + prontas
    // ================================================================
    // Abas da tela inicial: "Nova analise" (formulario) e "Historico do dia" (em andamento + prontas)
    function aplicarForm() {
        var nova = _formAberto !== false;
        var f = el('cs_form'), l = el('cs_lista'), tn = el('cs_tab_nova'), th = el('cs_tab_hist');
        if (f) f.classList.toggle('cs-h', !nova);
        if (l) l.classList.toggle('cs-h', nova);
        if (tn) { tn.classList.toggle('on', nova); tn.setAttribute('aria-selected', nova ? 'true' : 'false'); }
        if (th) { th.classList.toggle('on', !nova); th.setAttribute('aria-selected', nova ? 'false' : 'true'); }
    }

    function cor(nota) { return nota >= 60 ? 'ok' : nota > NOTA_REPROVA ? 'warn' : 'bad'; }

    function cardAndamento(j) {
        var nome = esc(nomeDoJob(j)), tag = tagUsuario(j.usuario || usuarioAtual());
        var qtd = (j.docsId || []).length + (j.docsRend || []).length;
        var sub = 'Iniciada ' + horaCurta(j.ts) + (qtd ? ' · ' + qtd + (qtd > 1 ? ' arquivos' : ' arquivo') : '');
        var cancelar = '<button type="button" class="cs-link bad" data-act="cancelar" data-id="' + j.id + '">Cancelar</button>';
        if (j.estado === 'fila') {
            return '<div class="cs-card cs-job"><div class="cs-job-top"><div class="cs-job-info"><div class="cs-job-nome">Aguardando na fila</div>' +
                '<div class="cs-job-sub">' + nome + tag + ' · começa quando uma anterior terminar</div></div>' + cancelar + '</div></div>';
        }
        if (j.estado === 'aguarda') {
            return '<div class="cs-card cs-job warn"><div class="cs-job-top"><div class="cs-job-info"><div class="cs-job-nome">' + nome + tag + '</div>' +
                '<div class="cs-job-sub">Precisa da sua decisão para continuar</div></div></div>' +
                '<div class="cs-job-foot"><button type="button" class="cs-btn cs-btn-pri cs-btn-sm" data-act="responder" data-id="' + j.id + '">Responder</button>' + cancelar + '</div></div>';
        }
        if (j.estado === 'erro') {
            return '<div class="cs-card cs-job bad"><div class="cs-job-top"><div class="cs-job-info"><div class="cs-job-nome">' + nome + tag + '</div>' +
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
        return '<div class="cs-card cs-job run"><div class="cs-job-top"><div class="cs-job-info"><div class="cs-job-nome">' + nome + tag + '</div>' +
            '<div class="cs-job-sub">' + sub + '</div></div><span class="cs-job-pct">' + Math.round(j.prog) + '%</span></div>' +
            '<div class="cs-bar"><div style="width:' + Math.max(2, Math.min(100, j.prog)) + '%"></div></div>' +
            '<div class="cs-steps">' + passos + '</div>' +
            '<div class="cs-job-foot"><span class="cs-job-sub">' + (filaProvavel() ? 'Preparando e enviando · só saia do app depois de aparecer "Enviado"' : 'Pode sair desta tela · mantenha o app aberto') + '</span>' + cancelar + '</div></div>';
    }

    function cardPronta(j) {
        var d = j.dados, c = d.reprovado ? 'bad' : cor(d.nota);
        if (restrito()) return cardRestrito({ key: j.fbKey || fbKeyDe(j.uid), nome: nomeDoJob(j), dono: j.usuario || usuarioAtual(), reprovado: !!d.reprovado, nota: d.nota,
            extra: (d.confBaixa ? ' · confiança baixa' : '') + (d.casasJogo && d.casasJogo.length ? ' · apostas detectadas' : ''), nova: !j.visto, act: 'abrir', attr: 'data-id="' + j.id + '"' });
        var sub = d.reprovado ? 'Reprovado' + (d.confBaixa ? ' · confiança baixa' : '') + (d.casasJogo && d.casasJogo.length ? ' · apostas detectadas' : '') :
            'Aprovado' + (d.rendaEstimada > 0 ? ' · renda ' + R$(d.rendaEstimada).replace(',00', '') + '/mês' : '') + pedSufixoGestor(j.fbKey || (j.uid ? fbKeyDe(j.uid) : ''));
        return '<button type="button" class="cs-card cs-pronta" data-act="abrir" data-id="' + j.id + '">' +
            '<span class="cs-ring-sm ' + c + '">' + d.nota + '</span>' +
            '<span class="cs-job-info"><span class="cs-job-nome">' + esc(nomeDoJob(j)) + tagUsuario(j.usuario || usuarioAtual()) + '</span><span class="cs-job-sub ' + c + '">' + sub + '</span></span>' +
            (j.visto ? '<i class="bi bi-chevron-right cs-chev"></i>' : '<span class="cs-tag-nova">Nova</span>') + '</button>';
    }

    // "Meus | Todos": ve so o que este perfil mandou, ou a fila e as prontas de todos os usuarios
    function filtroHtml() {
        var f = filtroUsuario(), me = usuarioAtual();
        return '<div class="cs-seg" role="group" aria-label="Quem mandou">' +
            '<button type="button" data-act="filtro" data-v="meus" class="' + (f === 'meus' ? 'on' : '') + '">Meus' + (me ? ' · ' + esc(me) : '') + '</button>' +
            '<button type="button" data-act="filtro" data-v="todos" class="' + (f === 'todos' ? 'on' : '') + '">Todos</button></div>';
    }

    function renderLista() {
        pedFormToggle();
        var box = el('cs_lista'); if (!box) return;
        var andam = _jobs.filter(function (j) { return j.estado !== 'pronta' && passaFiltro(j.usuario); });
        var noServidor = filaItensTela().filter(function (a) { return passaFiltro(a.usuario); });
        var prontas = prontasDeHoje();
        var nTab = andam.length + noServidor.length + prontas.length, tn = el('cs_tab_n');
        if (tn) { tn.textContent = nTab || ''; tn.classList.toggle('cs-h', !nTab); }
        var html = filaAvisoHtml() + filtroHtml();
        if (andam.length || noServidor.length) {
            html += '<div class="cs-sec-h"><span>Em andamento</span><em>' + (andam.length + noServidor.length) + '</em></div>' +
                andam.map(cardAndamento).join('') + noServidor.map(cardServidor).join('');
        }
        if (prontas.length) {
            html += '<div class="cs-sec-h"><span>Prontas</span><em>hoje</em></div>' + prontas.map(function (p) { return p.html; }).join('');
        }
        box.innerHTML = html;
    }

    // ── Widgets do Android (só no APK): resumo das análises do perfil ativo, enviado ao aparelho ──
    var _wg = { timer: null, ultimo: '', ts: 0 };
    var WG_FAIXA = { FORTE: 'FORTE', MEDIO: 'MÉDIO', FRACO: 'FRACO' };
    var WG_ORDEM = { aguarda: 0, erro: 1, andamento: 2, aprovada: 3, reprovada: 3 };

    // "Maria da Silva" -> "Maria S." (o widget é pequeno e fica à vista de quem passa)
    function wgNomeCurto(nome) {
        var n = String(nome || 'Cliente').trim().replace(/\s+/g, ' ');
        if (/^Cliente\s*·/.test(n)) return n;
        var p = n.split(' ');
        var primeiro = p[0].charAt(0).toUpperCase() + p[0].slice(1).toLowerCase();
        return p.length < 2 ? primeiro : primeiro + ' ' + p[p.length - 1].charAt(0).toUpperCase() + '.';
    }
    function wgMeu(dono) { var me = usuarioAtual(); return !dono || !me || dono === me; }

    function wgResumo() {
        var itens = [], emAnalise = 0, ini = inicioDoDia();
        _jobs.forEach(function (j) {
            if (!wgMeu(j.usuario)) return;
            var it = { id: 'j:' + j.uid, nome: wgNomeCurto(nomeDoJob(j)), t: j.tsFim || j.ts };
            if (j.estado === 'pronta') {
                var d = j.dados;
                if (!d || it.t < ini) return;
                var nota = Math.round(Number(d.nota) || 0);
                if (d.reprovado === true) { it.est = 'reprovada'; it.nota = nota; }
                else if (d.aprov === true && restrito()) it.est = 'aguarda';   // vendedor nao ve nota nem aprovacao: o toque abre o pedido
                else if (d.aprov === true) { it.est = 'aprovada'; it.nota = nota; it.faixa = WG_FAIXA[d.risco] || ''; }
                else it.est = 'aguarda';   // sem decisao automatica (ex.: nomes nao batem): o vendedor decide no app
            } else if (j.estado === 'aguarda') it.est = 'aguarda';
            else if (j.estado === 'erro') it.est = 'erro';
            else { it.est = 'andamento'; it.pct = Math.max(0, Math.min(99, Math.round(j.prog || 0))); it.txt = j.estado === 'fila' ? 'Na fila' : String(j.etapa || ''); emAnalise++; }
            itens.push(it);
        });
        _fila.itens.forEach(function (a) {   // analises que estao no servidor
            if (!wgMeu(a.usuario) || (a.estado !== 'rodando' && a.estado !== 'fila' && a.estado !== 'erro')) return;
            var it = { id: 's:' + a.id, nome: wgNomeCurto(a.nome || ('Cliente · ' + horaCurta(a.t || Date.parse(a.criado_em)))), t: a.t || Date.parse(a.criado_em) || 0 };
            if (a.estado === 'erro') it.est = 'erro';
            else { it.est = 'andamento'; it.pct = a.estado === 'fila' ? 0 : Math.max(2, Math.min(99, Math.round(a.progresso || 5))); it.txt = a.estado === 'fila' ? 'Na fila' : String(a.etapa || ''); emAnalise++; }
            itens.push(it);
        });
        hojeSemSessao(false).forEach(function (h) {   // prontas de hoje que vieram do historico
            var nota = Math.round(Number(h.nota) || 0), rep = h.decisao === 'REPROVADO';
            if (restrito() && !rep) itens.push({ id: 'h:' + h.id, nome: wgNomeCurto(h.nomeCliente), t: h.ts, est: 'aguarda' });
            else itens.push({ id: 'h:' + h.id, nome: wgNomeCurto(h.nomeCliente), t: h.ts, est: rep ? 'reprovada' : 'aprovada', nota: nota, faixa: rep ? '' : (WG_FAIXA[riscoPorNota(nota).risco] || '') });
        });
        itens.sort(function (a, b) { return (WG_ORDEM[a.est] - WG_ORDEM[b.est]) || (b.t - a.t); });
        return { ts: Date.now(), perfil: usuarioAtual(), emAnalise: emAnalise, itens: itens.slice(0, 3).map(function (it) { delete it.t; return it; }) };
    }

    // Manda o resumo ao aparelho. Sem mudança, só renova a hora (o widget mostra "Abra o app" se ela envelhecer com análise rodando).
    function wgPublicar() {
        var n = window.ctwNativo;
        if (!n || !n.ativo()) return;
        var r = wgResumo(), chave = JSON.stringify([r.perfil, r.emAnalise, r.itens]);
        if (chave === _wg.ultimo && Date.now() - _wg.ts < 55000) return;
        _wg.ultimo = chave; _wg.ts = Date.now();
        n.chamar('CtwWidget', 'atualizar', { json: JSON.stringify(r) }).catch(function () {});
    }
    function wgAgendar() {
        if (_wg.timer || !window.ctwNativo || !window.ctwNativo.ativo()) return;
        _wg.timer = setTimeout(function () { _wg.timer = null; wgPublicar(); }, 1500);   // junta rajadas de andamento
    }

    // Toque no widget: a ponte do APK (index.html) lê o pedido e chama aqui (abrir análise, nova análise, lista)
    function wgExecutar(acao, id) {
        openOverlay();
        if (acao === 'nova') { _formAberto = true; aplicarForm(); return; }
        if (acao !== 'abrir' || !id) return;
        var tipo = id.charAt(0), chave = id.slice(2);
        if (tipo === 'h') { hojeAbrir(chave); return; }
        if (tipo !== 'j') return;   // análise no servidor: a lista já mostra o andamento
        var job = null;
        _jobs.forEach(function (j) { if (String(j.uid) === chave) job = j; });
        if (!job) return;
        if (job.estado === 'aguarda' && job.pergunta) abrirPergunta(job);
        else if (job.estado === 'pronta' && job.dados) abrirResultado(job);
    }
    function wgIniciar() {
        var n = window.ctwNativo;
        if (!n || !n.ativo()) return;
        document.addEventListener('visibilitychange', function () { if (!document.hidden) wgPublicar(); });
        setInterval(wgPublicar, 60000);
        wgAgendar();
    }
    window.ctwCSWidget = { publicar: wgAgendar, executar: wgExecutar };   // o app avisa quando o perfil muda

    function atualizarBadge() {
        filaAtualizarCartaoHome();
        wgAgendar();
        var n = _jobs.filter(function (j) { return (j.estado === 'pronta' && !j.visto) || j.estado === 'aguarda' || j.estado === 'erro'; }).length +
            _fila.itens.filter(function (a) { return a.estado === 'erro'; }).length + hojeNaoVistas() + pedBadgeN();
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
        if (_formAberto === null) _formAberto = _jobs.length === 0 && !filaItensTela().length;
        navAltura(); renderRascunho(); aplicarForm(); renderLista(); pedFormRender();
        pedIniciar();
        filaBuscar(); hojeBuscar();   // atualiza por tras; a lista que ja esta na tela aparece na hora
    }
    // O menu de baixo do app fica por cima da tela: o botao fixo "Analisar credito" sobe essa altura para nao ficar escondido
    function navAltura() {
        var ov = el('cs_ov'), nav = el('ctwBottomNav'), h = 96; if (!ov) return;
        try { if (nav && getComputedStyle(nav).display !== 'none') { var r = nav.getBoundingClientRect(); if (r.height > 0) h = Math.max(0, Math.round(window.innerHeight - r.top) + 12); } } catch (e) {}
        ov.style.setProperty('--cs-nav', h + 'px');
    }
    function closeOverlay() { el('cs_ov') && el('cs_ov').classList.remove('active'); }

    // Fecha tudo do CreditoScan (as analises continuam rodando em segundo plano)
    function fecharTudo() {
        ['cs_ov', 'cs_hist_ov', 'cs_res_ov', 'cs_lote_ov', 'cs_fila_ov', 'cs_ped_ov'].forEach(function (id) { el(id) && el(id).classList.remove('active'); });
        if (el('cs_cfg_ov')) el('cs_cfg_ov').classList.remove('active');
    }

    function acaoLista(e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        if (b.getAttribute('data-act') === 'filtro') { lsGravar(FILTRO_LS, b.getAttribute('data-v') === 'todos' ? 'todos' : 'meus'); renderLista(); return; }
        var sid = b.getAttribute('data-sid');
        if (sid) { filaAcaoLista(b.getAttribute('data-act'), sid); return; }   // analise que esta no servidor
        if (b.getAttribute('data-act') === 'abrir-h') { hojeAbrir(b.getAttribute('data-hid')); return; }   // pronta de hoje que veio do historico
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
                if (a === 'pver') { var bid = b.getAttribute('data-id'); removerBanner(bid); if (veTudo()) { var jaAb = el('cs_ov') && el('cs_ov').classList.contains('active'); openOverlay(); _filaRaiz = !jaAb; _pedAba = 'pend'; el('cs_fila_ov').classList.add('active'); filaRender(); var pk = bid.slice(2); if (_ped[pk]) pedAbrir(pk); } else pedAbrir(bid.slice(2)); return; }
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

    // Aviso do sistema (barra de notificacoes) com o app em segundo plano. No Android o Chrome so aceita pelo service worker.
    function notificarSistema(titulo, corpo, tag) {
        try {
            if (!document.hidden) return;
            if (window.ctwNativo && window.ctwNativo.ativo()) { window.ctwNativo.notificar(titulo, corpo); return; }   // no APK o aviso e nativo
            if (!window.Notification || Notification.permission !== 'granted') return;
            if (navigator.serviceWorker && navigator.serviceWorker.ready) {
                navigator.serviceWorker.ready.then(function (reg) {
                    return reg.showNotification(titulo, { body: corpo, tag: tag, renotify: true, icon: './icon-192.png', badge: './badge.png', vibrate: [200, 100, 200] });
                }).catch(function () {});
            } else new Notification(titulo, { body: corpo, tag: tag });
        } catch (e) {}
    }

    function avisarJob(job, tipo) {
        // o aviso e do dono da analise: outro perfil que baixou o resultado nao recebe "Analise pronta" de outra pessoa
        if (job.usuario && usuarioAtual() && job.usuario !== usuarioAtual()) return;
        var box = caixaAvisos();
        removerBanner(job.id);
        var t, sub, btn, c = 'ok', ico = 'bi-check-lg';
        var nome = nomeDoJob(job);
        if (tipo === 'pronta') {
            var d = job.dados;
            t = 'Análise pronta'; btn = 'Ver resultado';
            sub = restrito() && !d.reprovado ? nome + ' · concluída' : nome + ' · nota ' + d.nota + ' · ' + (d.reprovado ? 'Reprovado' : 'Aprovado');
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
        notificarSistema(t, sub, 'creditoscan-' + job.id);
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
        if (d.reprovado || d.faixaAplicada) return;   // com a faixa o comprometimento ja foi avaliado
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
            var textoIA = [d.analise||'', d.perfil||'', d.motivos||''].join('. ').toLowerCase()
            .split(/[.!?;\n]+/).filter(function(fr){ return !/\b(n[aã]o|nenhum\w*|sem|aus[eê]ncia|nada|nunca|inexistente|descart\w*|suspeit\w*)\b/.test(fr); }).join(' . ');
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
             'casino online'
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
        } else if (casas.length >= 1) {
            // 1-2 casas confirmadas → REPROVADO direto (a nota nunca fica acima de 50)
            var notaAntes = d.nota;
            d.nota = Math.min(d.nota, NOTA_REPROVA);
            d.casasJogo = casas;
            d.aprov = false; d.reprovado = true;
            d.risco = 'REPROVADO'; d.entradaPct = 0.60;
            d.motivos = 'REPROVADO — casa de aposta confirmada\n' + casas.join(', ') +
                (d.motivos ? '\n' + d.motivos : '');
            d.calculo = (d.calculo || '') +
                '\nREGRA: casa de aposta confirmada (' + casas.length + ') = REPROVADO' +
                (notaAntes !== d.nota ? ' (nota limitada de ' + notaAntes + ' para ' + d.nota + ')' : '');
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
            var todasDatas = datasPorExtenso(textoTotal);   // "22 de outubro 2026"; as dd/mm/aaaa entram logo abaixo
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
    // Com o servidor ligado a IA roda la e a analise sobrevive ao app fechado (l_retomar.js);
    // sem ele, roda enquanto o app estiver aberto.
    // ================================================================
    // Datas escritas por extenso ("3 de maio de 2026", "22 de outubro 2026") -> timestamps. O periodo do extrato nao pode
    // depender so de dd/mm/aaaa: em varios bancos essa data aparece apenas no rodape de "gerado em", igual em todas as paginas.
    function datasPorExtenso(texto) {
        var meses = { janeiro: 0, fevereiro: 1, marco: 2, 'março': 2, abril: 3, maio: 4, junho: 5, julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11 };
        var re = /\b(\d{1,2})\s+de\s+(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(?:de\s+)?(20\d{2})\b/gi, m, r = [];
        while ((m = re.exec(texto)) !== null) {
            var dia = parseInt(m[1], 10), ts = new Date(parseInt(m[3], 10), meses[m[2].toLowerCase()], dia).getTime();
            if (dia >= 1 && dia <= 31 && ts > 0 && ts <= Date.now() + 86400000) r.push(ts);
        }
        return r;
    }

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

    // Monta o objeto de uma analise. uid = identidade que atravessa o fechamento do app
    // (ids das chamadas de IA, registro no Firebase e copia guardada no aparelho).
    function criarJob(docsId, docsRend, tel, extra) {
        return Object.assign({
            id: ++_jobSeq, uid: novoIdJob(), srvIds: [], estado: 'fila', ts: Date.now(), nome: '',
            docsId: docsId, docsRend: docsRend,
            prog: 0, etapa: 'Na fila', passo: 0,
            dados: null, texto: '', cpf: '', fbKey: null, criadoAqui: false, podeSalvarCalc: true,
            visto: false, erro: '', cancelado: false, pergunta: null, calc: null,
            tel: tel || ''   // WhatsApp do cliente (opcional)
        }, extra || {});
    }

    // Cria a analise e coloca na lista/fila de envio. Quem chama decide quando rodar processarFila() e redesenhar (envio normal e Lote).
    function lancarJob(docsId, docsRend, tel, extra) {
        var job = criarJob(docsId, docsRend, tel, extra);
        try {
            if (window.ctwNativo && window.ctwNativo.ativo()) window.ctwNativo.pedirNotificacao();
            else if (window.Notification && Notification.permission === 'default') Notification.requestPermission();
        } catch (e) {}   // para o aviso "Analise pronta" com o app em segundo plano
        _jobs.unshift(job);
        _formAberto = false;
        if (filaProvavel()) upIniciar(job);   // tela de envio: trava o app ate o servidor confirmar o recebimento
        persistirJob(job);   // copia no aparelho: se o Android fechar o app, a analise e retomada ao reabrir
        return job;
    }

    function iniciarAnalise() {
        if (!_docsRend.length || _enviando > 0) return;
        var campoTel = el('cs_tel'), docsId = _docsId, docsRend = _docsRend;
        ppFecharTexto('f');   // o que foi digitado e nao adicionado entra junto
        var prodsEnvio = _ppSel.f.slice();
        if (!prodsEnvio.length) {   // produto e obrigatorio: e ele que decide se responde sozinho ou vai para o gestor
            var cp = el('cs_prod_card'), ip = el('cs_pp_in_f');
            avisar('Informe o produto que o cliente quer.');
            if (cp && cp.scrollIntoView) cp.scrollIntoView({ block: 'center', behavior: 'smooth' });
            if (ip) ip.focus();
            return;
        }
        var jobNovo = lancarJob(docsId, docsRend, normalizarTelefone(campoTel ? campoTel.value : ''), { usuario: usuarioAtual(), produtos: prodsEnvio });
        pedCriarNoEnvio(jobNovo);   // produtos pedidos no envio: o pedido nasce agora e fecha quando a analise terminar
        _ppSel.f = []; ppTop('f');
        if (campoTel) { campoTel.value = ''; mascararTelefone(campoTel, 'cs_tel_hint'); }
        _docsId = []; _docsRend = []; _docMeta = {};
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
                encerrarPersistencia(job);   // erro e definitivo: nao retoma sozinha ao reabrir (o botao "tentar de novo" cria outra)
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
        pedCancelar(job);
        if (job.doServidor && job.estado === 'erro') filaPost('cancelar', job.uid).then(function () { filaBuscar(); });   // descarta tambem no servidor
        encerrarPersistencia(job);
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
        if (job.doServidor) { filaRepetirDoJob(job); return; }   // o resultado ja veio do servidor mas nao serviu: o servidor refaz
        job.estado = 'fila'; job.erro = ''; job.prog = 0; job.passo = 0; job.etapa = 'Na fila';
        var uidAntigo = job.uid;
        job.uid = novoIdJob(); job.srvIds = [];   // outra rodada: nao reaproveita respostas guardadas da anterior
        pedCancelar({ uid: uidAntigo }); pedCriarNoEnvio(job);   // o pedido de produtos acompanha o novo codigo da analise
        persistirJob(job);
        if (filaProvavel()) upIniciar(job);
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
            upDesenhar();   // a tela de envio sai da frente enquanto a pergunta espera
            // quem esta esperando o envio esta com o app na mao: abre a pergunta na hora, por cima da tela de envio
            if (_up.pend[job.uid]) setTimeout(function () { abrirPergunta(job); }, 60);
        });
    }

    function responderPergunta(job, valor) {
        var p = job.pergunta; if (!p) return;
        job.pergunta = null; job.modalAberto = false;
        if (job.estado === 'aguarda') job.estado = 'rodando';
        removerBanner(job.id);
        upDesenhar();
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
            mostrarModalReuso(job, p.dados.registro, p.dados.cpf, p.dados.porNome);
        }
    }

    // CPF so vale com 11 digitos e digitos verificadores certos (a IA que le a foto do documento erra digito: ja veio com 12 digitos e com 9)
    function cpfValido(c) {
        c = String(c || '').replace(/\D/g, '');
        if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
        for (var t = 9; t < 11; t++) {
            var soma = 0;
            for (var i = 0; i < t; i++) soma += +c.charAt(i) * (t + 1 - i);
            var dv = (soma * 10) % 11 % 10;
            if (dv !== +c.charAt(t)) return false;
        }
        return true;
    }
    // Nome para comparar clientes: sem acento, so letras, pelo menos 2 palavras; '' se curto demais para confiar
    function nomeParaBusca(n) {
        n = String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
        return n.length >= 8 && n.split(' ').length >= 2 ? n : '';
    }
    // Mesma pessoa que um registro do historico? CPF certo dos dois lados decide; se algum CPF nao confere, vale o nome igual.
    function mesmaPessoa(v, cpf, nome) {
        var cv = String(v.cpf || '').replace(/\D/g, '');
        if (cpf && cpfValido(cv)) return cv === cpf;
        return !!nome && nomeParaBusca(v.nomeCliente) === nome;
    }

    function mostrarModalReuso(job, registro, cpfFormatado, porNome) {
        var modal = document.createElement('div');
        modal.id = 'cs_alerta_reuso';
        modal.className = 'cs-modal cs-scope';
        var dt = new Date(registro.ts).toLocaleDateString('pt-BR');
        var ap = registro.decisao === 'APROVADO' || registro.decisao === 'DOWNGRADE' || registro.decisao === 'ENTRADA_ALTA';
        modal.innerHTML =
            '<div class="cs-modal-box">' +
                '<div class="cs-modal-ttl"><i class="bi bi-exclamation-triangle-fill"></i> Cliente já analisado</div>' +
                '<div class="cs-modal-txt"><strong>' + esc(registro.nomeCliente) + '</strong> ' + (cpfFormatado ? '(CPF: ' + esc(cpfFormatado) + ') ' : '') + 'fez uma análise nos últimos ' + HIST_DAYS + ' dias (' + dt + ').' +
                (porNome ? '<br><small>Achado pelo nome: o CPF lido do documento não foi confiável. Confira se é a mesma pessoa.</small>' : '') + '</div>' +
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
        var tIni = Date.now();
        job.tempos = job.tempos || {};
        var cpf = '';
        if (job.docsId.length > 0) {
            try {
                var promptId = 'Extraia o CPF e o Nome do titular deste documento. Retorne APENAS um JSON valido: {"cpf": "123.456.789-00", "nome": "Nome do Titular"}. Se nao achar CPF, retorne {"cpf": ""}';
                // a IA le a foto e erra digito: confere os digitos verificadores e relê UMA vez se nao fechar
                for (var tCpf = 0; tCpf < 2 && !cpfValido(cpf); tCpf++) {
                    var respId = await aiCallVision(job.docsId, '', promptId + (tCpf ? ' ATENCAO: o CPF tem exatamente 11 digitos. Leia digito por digito, sem inventar e sem repetir digitos.' : ''), chaveIA(job, tCpf ? 'cpf2' : 'cpf'));
                    var ir1 = respId.indexOf('{'), ir2 = respId.lastIndexOf('}');
                    if (ir1 !== -1 && ir2 > ir1) {
                        var objId = JSON.parse(respId.substring(ir1, ir2 + 1));
                        cpf = objId.cpf ? String(objId.cpf).replace(/\D/g, '') : '';
                        if (objId.nome && (!job.nome || tCpf === 0)) job.nome = String(objId.nome).trim().substring(0, 80);
                    }
                }
            } catch (e) { console.warn('Falha na leitura antecipada do documento:', e); }
        } else {
            var mc = textosLocais.join(' ').match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/);
            if (mc) cpf = mc[0].replace(/\D/g, '');
        }
        if (!cpfValido(cpf)) cpf = '';   // CPF que nao fecha nao vale: nao busca nem grava errado (a busca cai para o nome)
        var nomeBusca = nomeParaBusca(job.nome);
        job.tempos.cpf_s = Math.round((Date.now() - tIni) / 1000);
        andamento(job, 'Consultando histórico...', 14);

        if (cpf || nomeBusca) {
            try {
                fb = fb || await import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js');
                var db = window._firebaseDB;
                if (db) {
                    var limite = Date.now() - HIST_DAYS * 86400000, snap;
                    // so os ultimos HIST_DAYS dias (indexado por "ts"); sem o indice nas regras, le o no inteiro como antes
                    try { snap = await comLimite(fb.get(fb.query(fb.ref(db, SAVE_PATH), fb.orderByChild('ts'), fb.startAt(limite))), 30000); }
                    catch (eIdx) { if (!semIndiceTs(eIdx)) throw eIdx; snap = await fb.get(fb.ref(db, SAVE_PATH)); }
                    var itens = [];
                    if (snap.exists()) {
                        snap.forEach(function (c) {
                            var v = c.val();
                            if (v && v.ts > limite && mesmaPessoa(v, cpf, nomeBusca)) itens.push(Object.assign({ id: c.key }, v));
                        });
                    }
                    checar(job);
                    if (itens.length > 0) {
                        itens.sort(function (a, b) { return b.ts - a.ts; });
                        var cpfMask = cpf ? cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '';
                        var escolha = await perguntar(job, 'reuso', { registro: itens[0], cpf: cpfMask, porNome: !cpf || !cpfValido(itens[0].cpf) });
                        checar(job);
                        if (escolha === 'reusar') {
                            var dReuso = dadosDoRegistro(itens[0]);
                            job.fbKey = itens[0].id; job.criadoAqui = false; job.podeSalvarCalc = !itens[0].produto;
                            // numero: o digitado agora vale; senao usa o que ja estava salvo; se mudou, atualiza o registro
                            var telSalvo = normalizarTelefone(itens[0].telefone);
                            job.tel = job.tel || telSalvo;
                            if (job.tel && job.tel !== telSalvo) atualizarFB(job.fbKey, { telefone: job.tel });
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
            dAposta.telefone = job.tel || '';
            prepararDados(dAposta);
            checar(job);
            job.fbKey = await salvarFB(dAposta.nomeCompleto, '', apostas.detalhe, dAposta, cpf, job.uid, job.usuario);
            job.criadoAqui = true;
            concluirJob(job, dAposta, apostas.detalhe);
            return;
        }

        // ── Servidor com fila: envia os documentos e pronto (a renda e a analise rodam la; o resultado volta pela lista) ──
        if (await filaDisponivel()) {
            await enviarParaFila(job, cpf);
            return;
        }
        upFinalizar(job);   // sem fila no servidor: segue no modo direto, sem tela de envio
        if (filaToken()) andamento(job, 'Servidor indisponível · analisando neste celular', 30, 2);   // senha salva mas sem fila: mantenha o app aberto

        // ── PASSO 2: payload hibrido (imagens + texto digital) ──
        andamento(job, 'Preparando dados...', 32, 2);
        var imagensParaIA = [];
        var arquivosDigitais = [], posArq = {};   // paginas de texto agrupadas por PDF
        job.docsId.forEach(function (d) { if (d.base64) imagensParaIA.push(d); });
        job.docsRend.forEach(function (d) {
            if (d.ehDigital && d.textos && d.textos.length) {
                if (posArq[d.aid] === undefined) { posArq[d.aid] = arquivosDigitais.length; arquivosDigitais.push([]); }
                arquivosDigitais[posArq[d.aid]] = arquivosDigitais[posArq[d.aid]].concat(d.textos);
            }
            else if (d.base64) imagensParaIA.push(d);
        });
        if (imagensParaIA.length > MAX_IMGS_AI) {
            var step = imagensParaIA.length / MAX_IMGS_AI, sampled = [];
            for (var si = 0; si < MAX_IMGS_AI; si++) sampled.push(imagensParaIA[Math.min(Math.floor(si * step), imagensParaIA.length - 1)]);
            imagensParaIA = sampled;
        }
        var textoDigitalStr = '';
        if (arquivosDigitais.length) {
            var montado = montarTextoDigital(arquivosDigitais);
            if (montado.texto) textoDigitalStr = '=== EXTRATO BANCARIO DIGITAL (texto extraido do PDF) ===\n' + montado.texto;
            if (montado.cortado) console.warn('[CreditoScan] extrato maior que o limite: parte do texto ficou de fora');
        }
        if (imagensParaIA.length === 0 && !textoDigitalStr) {
            throw new Error('Nenhum documento legível. Envie fotos mais nítidas ou o PDF original do banco.');
        }

        // ── PASSO 3: pipeline de IA ──
        var temSoTexto = (imagensParaIA.length === 0 && textoDigitalStr);
        // Etapa 1 (renda por PDF, so texto digital) vale tambem com RG em foto; so nao vale se houver foto de comprovante de renda
        var fotoRenda = job.docsRend.some(function (d) { return !d.ehDigital && d.base64; });
        var usaEtapaRenda = !!textoDigitalStr && !fotoRenda;
        var rendaPre = null;   // renda da etapa 1, calculada aqui no codigo
        if (usaEtapaRenda) {
            andamento(job, 'Calculando renda (1/2)...', 45, 2);
            var tRenda = Date.now();
            try { rendaPre = await calcularRendaDosArquivos(arquivosDigitais, job); job.tempos.renda_s = Math.round((Date.now() - tRenda) / 1000); }
            catch (eR) { if (eR === CANCELADO) throw eR; console.warn('Etapa 1 falhou, prosseguindo sem renda pre-calculada:', eR); }
            checar(job);
            andamento(job, 'Analisando comportamento (2/2)...', 65, 2);
        } else {
            var modoDesc = imagensParaIA.length + (imagensParaIA.length === 1 ? ' imagem' : ' imagens') + (textoDigitalStr ? ' + texto' : '');
            andamento(job, 'IA lendo ' + modoDesc + '...', 50, 2);
        }

        var resp, tAnalise = Date.now();
        try {
            if (temSoTexto) {
                var textoParaAnalise = '=== EXTRATO ===\n' + textoDigitalStr + '\n\n';
                resp = await aiCallTexto(textoParaAnalise + buildPrompt(rendaPre), chaveIA(job, 'analise'));
            } else {
                resp = await aiCallVision(imagensParaIA, textoDigitalStr, buildPrompt(rendaPre), chaveIA(job, 'analise'));
            }
        } catch (eAI) {
            throw new Error('Falha ao consultar a IA: ' + ((eAI && eAI.message) || eAI));
        }
        checar(job);
        job.tempos.analise_s = Math.round((Date.now() - tAnalise) / 1000);
        job.tempos.total_s = Math.round((Date.now() - job.ts) / 1000);

        await concluirComResposta(job, resp, rendaPre, textoParaApostas, cpf);
    }

    // ── PASSO 4: nota final. Mesmo codigo para a analise feita no celular e para a que volta do servidor ──
    async function concluirComResposta(job, resp, rendaPre, textoParaApostas, cpf) {
        andamento(job, 'Finalizando...', 90, 3);
        var d = extrair(resp);
        if (/^ERRO/.test(d.risco || '')) throw new Error('A IA devolveu uma resposta inválida. Tente de novo.');
        d._produto = '';
        d.telefone = job.tel || '';
        d.sinaisCompromisso = detectarSinaisCompromisso(textoParaApostas);   // confere a lista de compromissos da IA com o texto do extrato
        d.compromissosCodigo = detectarRecorrencias(textoParaApostas);       // pagamentos que se repetem no extrato (usados so se a IA nao listou nenhum)
        d.sinaisRisco = detectarSinaisRisco(textoParaApostas);               // confere atraso/cheque especial/rotativo que a IA disse ter visto

        finalizarPontuacao(d, rendaPre);   // renda (media/mediana/abatimentos) + faixa por sinais e pilares, no codigo
        validarApostasNaResposta(d);
        validarComprometimento(d);
        completarNome(d, job, textoParaApostas);

        if (d.rendaEstimada > 0 && d.rendaEstimada < 1000 && !d.reprovado) {
            d.aprov = false; d.reprovado = true; d.nota = Math.min(d.nota, 30);
            d.risco = 'REPROVADO'; d.entradaPct = 0.60;
            d.motivos = (d.motivos ? d.motivos + '\n' : '') + 'Renda de R$ ' + d.rendaEstimada + ' abaixo do minimo de R$ 1.000. Impossivel parcelar.' +
                (d.rendaCalc && d.rendaCalc.duvidosa ? '\nRenda duvidosa: confira no extrato as entradas excluídas e a soma dos meses (veja os alertas ⚠ no cálculo da renda).' : '');
        }
        if (!(d.rendaEstimada > 0) && !d.reprovado) {
            d.aprov = false; d.reprovado = true; d.nota = 0;
            d.risco = 'REPROVADO'; d.entradaPct = 0.60;
            d.motivos = (d.motivos ? d.motivos + '\n' : '') + 'Renda estimada = R$ 0,00. Impossivel aprovar sem comprovacao de renda.';
        }
        aplicarConfiancaBaixa(d);
        prepararDados(d);

        job.fbKey = await salvarFB(d.nomeCompleto, '', resp, d, cpf, job.uid, job.usuario);
        job.criadoAqui = true;
        concluirJob(job, d, resp);
    }

    // Etapa 1 da renda: cada PDF e lido em TRECHOS pequenos (em paralelo) e o codigo soma os trechos
    // (a IA errava a soma de 50-60 Pix de um mes numa resposta so). Se a soma nao fechar com o "Total de creditos"
    // impresso, relê com trechos menores (ver lerRendaPorTrechos).
    async function calcularRendaDosArquivos(arquivos, job) {
        var limitar = criarLimitador(PARALELO_IA);
        var inicio = Date.now();
        var leituras = await Promise.all(arquivos.map(function (arq, idx) {
            var m = montarTextoDigital([arq], LIMITE_RENDA_ARQUIVO);
            if (!m.texto) return Promise.resolve(undefined);   // PDF sem texto (nada a ler)
            return lerRendaPorTrechos(m.texto, function (prompt, rotulo) { return aiCallTexto(prompt, chaveIA(job, 'renda-' + idx + '-' + rotulo)); }, {
                limitar: limitar, fatal: function (e) { return e === CANCELADO; }, sobra: function () { return 150000 - (Date.now() - inicio); }, universal: true
            });
        }));
        // um PDF que a IA nao conseguiu ler faria a renda sair de menos meses sem ninguem saber: nesse caso a etapa 2 calcula tudo
        if (leituras.some(function (l) { return l === null; })) return null;
        var uniao = unirRendaArquivos(leituras.filter(Boolean));
        var c = uniao.rendaMeses.length ? calcularRenda(uniao) : null;
        return rendaFechada(c) ? c : null;
    }

    function concluirJob(job, d, texto) {
        checar(job);
        encerrarPersistencia(job);
        job.dados = d; job.texto = texto;
        if (d.nomeCompleto && d.nomeCompleto !== 'Cliente' && d.nomeCompleto !== 'Amigo(a)') job.nome = d.nomeCompleto;
        job.estado = 'pronta'; job.prog = 100; job.etapa = 'Pronta'; job.pergunta = null; job.tsFim = Date.now();
        job.calc = { aberto: false, produto: '', valor: 0 };
        liberarDocsDoJob(job);
        pedFinalizar(job);   // pedido de produtos: reprovada apaga, aprovada separa o que responde sozinho do que vai ao gestor
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
                nota: nota, risco: reprovado ? 'REPROVADO' : riscoPorNota(nota).risco,
                entradaPct: reprovado ? FAIXAS.REPROVADO.entradaPct : riscoPorNota(nota).entradaPct,
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
        if (it.confBaixa && Array.isArray(it.confMotivos)) { d.confBaixa = true; d.confMotivos = it.confMotivos; }
        if (typeof it.nota === 'number' || it.nota) d.nota = nota;
        if (!d.reprovado) { var rr = riscoPorNota(d.nota); d.risco = rr.risco; d.entradaPct = rr.entradaPct; }   // risco/entrada seguem a nota SALVA (o JSON da IA guarda a nota dela)
        if (d.rawJson) separarCasasJogo(d, it.casasJogo != null ? String(it.casasJogo).split(',').map(function (x) { return x.trim(); }).filter(Boolean) : null);
        if (!(d.rendaEstimada > 0) && parseFloat(it.rendaEstimada) > 0) d.rendaEstimada = parseFloat(it.rendaEstimada);
        // analise nova: a renda e o detalhe salvos valem (a etapa de texto nao deixa os meses no JSON)
        if (it.rendaDetalhe && parseFloat(it.rendaEstimada) > 0) { d.rendaEstimada = parseFloat(it.rendaEstimada); d.rendaDetalhe = String(it.rendaDetalhe); }
        if (d.rawJson) {
            if (parseInt(it.sinaisCompromisso) > 0) d.sinaisCompromisso = { total: parseInt(it.sinaisCompromisso), termos: [] };
            if (it.fluxoCodigo) { try { var fx0 = JSON.parse(it.fluxoCodigo); if (fx0 && typeof fx0 === 'object') d.fluxoCodigo = fx0; } catch (e) {} }
            if (it.saldosCodigo) { try { var sd0 = JSON.parse(it.saldosCodigo); if (sd0 && typeof sd0 === 'object') d.saldosCodigo = sd0; } catch (e) {} }
            if (it.compromissosCodigo) { try { var cc0 = JSON.parse(it.compromissosCodigo); if (Array.isArray(cc0)) d.compromissosCodigo = cc0.filter(function (i) { return i && i.valor > 0; }); } catch (e) {} }
            calcularComprometimento(d);
        }
        if (it.calculoFinal) d.calculo = String(it.calculoFinal);
        return prepararDados(d);
    }

    // ================================================================
    // RETOMAR ANALISES
    // Cada analise em andamento tem uma copia no aparelho (IndexedDB): documentos, telefone e identidade (uid).
    // As chamadas de IA usam ids fixos derivados do uid, entao ao reabrir o app a analise recomeca do inicio mas
    // o servidor devolve na hora o que ja respondeu (nada e cobrado duas vezes) e o registro do Firebase tem chave
    // fixa (nao duplica). A copia e apagada ao concluir, falhar ou cancelar, e descartada depois de 2 horas.
    // ================================================================
    var SNAP_DB         = 'ctwCreditoScan';
    var SNAP_STORE      = 'analises';
    var SNAP_VALIDADE   = 7200000;    // 2 h
    var SNAP_BATIDA_MS  = 5000;       // a analise viva renova o "estou rodando" a cada 5 s
    var SNAP_LEASE_MS   = 20000;      // sem batida ha 20 s = ninguem esta rodando essa analise
    var LEASE_PREFIXO   = 'ctwCsLease_';

    function chaveIA(job, passo) { return job && job.uid ? { uid: job.uid, passo: passo, ids: job.srvIds } : null; }

    function snapAbrir() {
        return new Promise(function (resolve, reject) {
            try {
                var rq = indexedDB.open(SNAP_DB, 1);
                rq.onupgradeneeded = function () { rq.result.createObjectStore(SNAP_STORE, { keyPath: 'uid' }); };
                rq.onsuccess = function () { resolve(rq.result); };
                rq.onerror = function () { reject(rq.error); };
            } catch (e) { reject(e); }
        });
    }

    // Executa fn(store) numa transacao e devolve o resultado do pedido quando ela termina
    function snapTx(modo, fn) {
        return snapAbrir().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(SNAP_STORE, modo), rq;
                try { rq = fn(tx.objectStore(SNAP_STORE)); } catch (e) { db.close(); reject(e); return; }
                tx.oncomplete = function () { db.close(); resolve(rq ? rq.result : undefined); };
                tx.onerror = tx.onabort = function () { db.close(); reject(tx.error || new Error('transacao abortada')); };
            });
        });
    }

    function leaseLer(uid) { try { return parseInt(localStorage.getItem(LEASE_PREFIXO + uid), 10) || 0; } catch (e) { return 0; } }
    function leaseGravar(uid) { try { localStorage.setItem(LEASE_PREFIXO + uid, String(Date.now())); } catch (e) {} }
    function leaseLimpar(uid) { try { localStorage.removeItem(LEASE_PREFIXO + uid); } catch (e) {} }

    function snapDoJob(job) {
        // PDF digital: a IA le so o texto, entao a imagem das paginas nao precisa ser guardada
        function doc(d) {
            var soTexto = d.ehDigital && d.textos && d.textos.length;
            return { base64: soTexto ? '' : (d.base64 || ''), textos: d.textos || [], tipo: d.tipo || 'imagem', ehDigital: !!d.ehDigital, arq: d.arq || '', aid: d.aid };
        }
        return { uid: job.uid, ts: job.ts, nome: job.nome || '', tel: job.tel || '', salvoEm: Date.now(),
            docsId: (job.docsId || []).map(doc), docsRend: (job.docsRend || []).map(doc) };
    }

    // Guarda a analise no aparelho e comeca a renovar o "estou rodando". Falhar aqui nunca atrapalha a analise.
    function persistirJob(job) {
        if (!job || !job.uid) return;
        leaseGravar(job.uid);
        if (job._batida) clearInterval(job._batida);
        job._batida = setInterval(function () { leaseGravar(job.uid); }, SNAP_BATIDA_MS);
        try {
            if (!window.indexedDB) return;
            var reg = snapDoJob(job);
            snapTx('readwrite', function (st) { return st.put(reg); }).catch(function (e) { console.warn('[CreditoScan] nao consegui guardar a analise no aparelho:', e); });
        } catch (e) { console.warn('[CreditoScan] copia da analise falhou:', e); }
    }

    // Fim da analise (concluida, falhou ou cancelada): apaga a copia, para a batida e limpa as respostas do servidor
    function encerrarPersistencia(job) {
        if (!job) return;
        upFinalizar(job);
        if (job._batida) { clearInterval(job._batida); job._batida = null; }
        if (job.uid) {
            leaseLimpar(job.uid);
            try { if (window.indexedDB) snapTx('readwrite', function (st) { return st.delete(job.uid); }).catch(function () {}); } catch (e) {}
        }
        limparRespostasServidor(job.srvIds);
    }

    function esperarFirebase(maxMs) {
        return new Promise(function (resolve) {
            var fim = Date.now() + maxMs;
            (function tick() { if (window._firebaseDB || Date.now() >= fim) return resolve(); setTimeout(tick, 400); })();
        });
    }

    // Ao abrir o app: continua as analises que ficaram pela metade
    var _retomarRodou = false;
    async function retomarAnalises() {
        try {
            if (!window.indexedDB) return;
            var lista = await snapTx('readonly', function (st) { return st.getAll(); });
            if (!lista || !lista.length) return;
            var agora = Date.now(), reabrir = [], esperaLease = false;
            lista.forEach(function (sn) {
                if (!sn || !sn.uid) return;
                if (agora - (sn.ts || 0) > SNAP_VALIDADE) { leaseLimpar(sn.uid); snapTx('readwrite', function (st) { return st.delete(sn.uid); }).catch(function () {}); return; }
                if (_jobs.some(function (j) { return j.uid === sn.uid; })) return;   // ja esta rodando nesta sessao
                if (agora - leaseLer(sn.uid) < SNAP_LEASE_MS) { esperaLease = true; return; }   // outra aba/sessao ainda esta cuidando dela
                reabrir.push(sn);
            });
            if (esperaLease && !_retomarRodou) { _retomarRodou = true; setTimeout(retomarAnalises, SNAP_LEASE_MS + 1500); }
            if (!reabrir.length) return;
            await esperarFirebase(20000);
            reabrir.sort(function (a, b) { return a.ts - b.ts; });
            reabrir.forEach(function (sn) {
                if (_jobs.some(function (j) { return j.uid === sn.uid; })) return;
                function refazer(d) { return Object.assign({}, d, { dataUrl: '' }); }
                var job = criarJob((sn.docsId || []).map(refazer), (sn.docsRend || []).map(refazer), sn.tel, {
                    uid: sn.uid, ts: sn.ts, nome: sn.nome || '', etapa: 'Retomando...', retomado: true
                });
                _jobs.unshift(job);
                if (filaProvavel()) upIniciar(job);
                leaseGravar(job.uid);
                job._batida = setInterval(function () { leaseGravar(job.uid); }, SNAP_BATIDA_MS);
            });
            _formAberto = false; aplicarForm();   // recolhe o formulario: a lista "Em andamento" fica no topo, como logo depois de tocar em analisar
            renderLista();
            avisar(reabrir.length === 1 ? 'Retomando a análise que ficou pela metade...' : 'Retomando ' + reabrir.length + ' análises que ficaram pela metade...');
            processarFila();
        } catch (e) { console.warn('[CreditoScan] nao consegui retomar analises:', e); }
    }

    // ================================================================
    // FILA NO SERVIDOR
    // O celular so le o CPF, faz as perguntas e ENVIA os documentos. A renda e a analise rodam no servidor,
    // uma fila de 2 por vez (ate 30 esperando). O resultado volta pela lista: o app consulta o servidor,
    // baixa o que ficou pronto, aplica as mesmas regras de sempre (concluirComResposta) e salva no historico.
    // Sem senha do servidor, ou com a funcao antiga (sem fila), tudo continua como antes (IA direto do celular).
    // ================================================================
    var FILA_POLL_ATIVO_MS   = 4000;     // tela do CreditoScan aberta e com analise andando
    var FILA_POLL_FUNDO_MS   = 12000;    // CreditoScan fechado, mas ha analise andando (para avisar quando ficar pronta)
    var FILA_POLL_OCIOSO_MS  = 15000;    // aberto e sem nada andando (pega o que foi enviado de outro aparelho)
    var FILA_TIMEOUT_MS      = 12000;
    var FILA_MAX_CORPO       = 13500000; // o servidor recusa pedidos acima de 14 MB
    var FILA_REVALIDA_MS     = 60000;    // "funcao antiga" e lembrado por 1 min (da tempo de colar a nova)

    var _fila = { suporte: null, suporteTs: 0, itens: [], ok: false, buscou: false, ts: 0, dif: 0, falhas: 0, max: 30, slots: 2, senhaErrada: false, motivo: '' };
    var _filaTimer = null, _filaBuscando = null, _coletando = {};

    function filaToken() { return safeGet(SRV_TOKEN_LS) || ''; }
    function filaProvavel() { return !!filaToken() && _fila.suporte !== false; }

    // ── A funcao no servidor tem fila? (true / false / null = sem conexao / 'senha' = senha errada) ──
    async function filaSuporte() {
        var tk = filaToken(); if (!tk) return false;
        if (_fila.suporte === true) return true;
        if (_fila.suporte === false && Date.now() - _fila.suporteTs < FILA_REVALIDA_MS) return false;
        try {
            var r = await fetchComTempo(srvUrl() + '/status', { method: 'GET', headers: srvHeaders(tk) }, FILA_TIMEOUT_MS);
            var j = await r.json().catch(function () { return {}; });
            if (r.status === 401 || r.status === 403) { _fila.senhaErrada = true; return 'senha'; }
            _fila.senhaErrada = false;
            if (r.status === 200 && j && j.fila) { _fila.suporte = true; _fila.max = j.max_fila || 30; _fila.slots = j.slots || 2; return true; }
            _fila.suporte = false; _fila.suporteTs = Date.now();   // funcao antiga: segue no modo direto
            return false;
        } catch (e) { return null; }
    }

    async function filaDisponivel() {
        if (!filaToken()) return false;
        var s = await filaSuporte();
        if (s === null) throw new Error('Sem conexão com o servidor. Confira a internet e toque em "Tentar de novo".');
        if (s === 'senha') throw new Error('A senha do servidor não confere. Corrija em Configurações > Servidor.');
        return s === true;
    }

    // ================================================================
    // TELA DE ENVIO (trava o app ate o servidor confirmar o recebimento)
    // ================================================================
    var _up = { pend: {}, total: 0, feitos: 0, okTimer: null, wake: null };

    function upQtdPend() { return Object.keys(_up.pend).length; }
    function upAtivo() { return upQtdPend() > 0 || !!_up.okTimer; }
    function upBloqueando() { var o = el('cs_up_ov'); return !!(o && o.classList.contains('on')); }

    function upCriar() {
        var o = el('cs_up_ov'); if (o) return o;
        o = document.createElement('div');
        o.id = 'cs_up_ov'; o.className = 'cs-scope';
        o.setAttribute('role', 'alertdialog'); o.setAttribute('aria-live', 'polite');
        o.innerHTML = '<div class="cs-up-box">' +
            '<div class="cs-up-ico" id="cs_up_ico"><i class="bi bi-cloud-arrow-up-fill"></i></div>' +
            '<div class="cs-up-t" id="cs_up_t"></div>' +
            '<div class="cs-up-s" id="cs_up_s"></div>' +
            '<div class="cs-bar" id="cs_up_bar"><div id="cs_up_b" style="width:3%"></div></div>' +
            '<div class="cs-up-w" id="cs_up_w"></div>' +
            '<button type="button" class="cs-btn cs-btn-pri cs-h" id="cs_up_fechar">Ok</button>' +
            '</div>';
        document.body.appendChild(o);
        el('cs_up_fechar').addEventListener('click', function () { upEsconder(); });
        return o;
    }

    function upEsconder() {
        if (_up.okTimer) { clearTimeout(_up.okTimer); _up.okTimer = null; }
        var o = el('cs_up_ov'); if (o) o.classList.remove('on');
        _up.total = 0; _up.feitos = 0;
        upSoltarTela();
    }

    function upManterTela() {
        try {
            if (navigator.wakeLock && !_up.wake) navigator.wakeLock.request('screen').then(function (w) { _up.wake = w; w.addEventListener('release', function () { _up.wake = null; }); }).catch(function () {});
        } catch (e) {}
    }
    function upSoltarTela() { try { if (_up.wake) { _up.wake.release(); _up.wake = null; } } catch (e) {} }

    function upDesenhar() {
        var pend = Object.keys(_up.pend).map(function (k) { return _up.pend[k]; });
        // quem esta esperando uma resposta do vendedor nao segura a tela (a pergunta abre por cima)
        var andando = pend.filter(function (p) { return p.job.estado !== 'aguarda'; });
        if (!pend.length) return;   // o aviso "Enviado" e desenhado por upConcluir
        var o = upCriar();
        if (!andando.length) { o.classList.remove('on'); return; }
        var p = andando[0];
        o.classList.add('on');
        el('cs_up_ico').className = 'cs-up-ico';
        el('cs_up_ico').innerHTML = '<i class="bi bi-cloud-arrow-up-fill"></i>';
        el('cs_up_fechar').classList.add('cs-h');
        el('cs_up_bar').classList.remove('cs-h');
        var n = Math.min(_up.total, _up.feitos + 1);
        el('cs_up_t').textContent = _up.total > 1 ? 'Enviando ' + n + ' de ' + _up.total + '...' : 'Enviando para o servidor...';
        var pct = p.total ? Math.round(p.enviado / p.total * 100) : 0;
        var s = esc(nomeDoJob(p.job));
        if (p.fase === 'enviando') s += ' · ' + fmtMB(p.enviado) + ' de ' + fmtMB(p.total) + ' (' + pct + '%)';
        else s += ' · preparando os documentos';
        el('cs_up_s').innerHTML = s;
        el('cs_up_b').style.width = (p.fase === 'enviando' ? Math.max(3, pct) : 3) + '%';
        el('cs_up_w').textContent = 'Não feche nem saia do app até aparecer "Enviado".';
    }

    function upIniciar(job) {
        if (!job || !job.uid || _up.pend[job.uid]) return;
        if (_up.okTimer) { clearTimeout(_up.okTimer); _up.okTimer = null; _up.total = 0; _up.feitos = 0; }
        _up.pend[job.uid] = { job: job, fase: 'preparando', enviado: 0, total: 0 };
        _up.total++;
        upManterTela();
        upDesenhar();
    }

    function upProgresso(job, enviado, total) {
        var p = _up.pend[job.uid]; if (!p) return;
        p.fase = 'enviando'; p.enviado = enviado; p.total = total;
        upDesenhar();
    }

    // Saiu sem enviar (erro, cancelou, reaproveitou resultado antigo): nao conta como enviada
    function upFinalizar(job) {
        if (!job || !_up.pend[job.uid]) return;
        delete _up.pend[job.uid];
        _up.total = Math.max(0, _up.total - 1);
        if (!upQtdPend()) upEsconder(); else upDesenhar();
    }

    // Servidor confirmou o recebimento
    function upConcluir(job) {
        if (!_up.pend[job.uid]) return;
        delete _up.pend[job.uid];
        _up.feitos++;
        if (upQtdPend()) { upDesenhar(); return; }
        var o = upCriar();
        o.classList.add('on');
        var tot = _up.feitos;
        el('cs_up_ico').className = 'cs-up-ico ok';
        el('cs_up_ico').innerHTML = '<i class="bi bi-check-lg"></i>';
        el('cs_up_t').textContent = tot > 1 ? tot + ' análises enviadas' : 'Enviado';
        el('cs_up_s').textContent = 'Pode sair do app. A análise continua no servidor e o resultado aparece aqui.';
        el('cs_up_bar').classList.add('cs-h');
        el('cs_up_w').textContent = '';
        el('cs_up_fechar').classList.remove('cs-h');
        upSoltarTela();
        _up.okTimer = setTimeout(function () { _up.okTimer = null; upEsconder(); }, 3500);
    }

    // ================================================================
    // ENVIO
    // ================================================================
    function docParaServidor(d) {
        // PDF digital: a IA le so o texto, entao a imagem das paginas nao precisa subir
        var soTexto = d.ehDigital && d.textos && d.textos.length;
        return { base64: soTexto ? '' : (d.base64 || ''), textos: d.textos || [], tipo: d.tipo || 'imagem', ehDigital: !!d.ehDigital, arq: d.arq || '', aid: d.aid };
    }

    // POST com progresso de envio (XHR). Aborta se o envio parar de andar por 45 s.
    function xhrPost(url, token, corpo, aoProgredir, limiteMs) {
        return new Promise(function (resolve, reject) {
            var x = new XMLHttpRequest(), ultimo = Date.now(), vigia = null, fim = false;
            function terminar(fn, v) { if (fim) return; fim = true; clearInterval(vigia); fn(v); }
            x.open('POST', url, true);
            x.setRequestHeader('Content-Type', 'application/json');
            x.setRequestHeader('x-app-token', token);
            x.timeout = limiteMs;
            x.upload.onprogress = function (e) { ultimo = Date.now(); if (e.lengthComputable) aoProgredir(e.loaded, e.total); };
            x.onload = function () { var j = null; try { j = JSON.parse(x.responseText); } catch (e) {} terminar(resolve, { status: x.status, json: j }); };
            x.onerror = function () { terminar(reject, new Error('falha de rede')); };
            x.ontimeout = function () { terminar(reject, new Error('tempo esgotado')); };
            x.onabort = function () { terminar(reject, new Error('envio interrompido')); };
            vigia = setInterval(function () { if (!document.hidden && Date.now() - ultimo > 45000) { try { x.abort(); } catch (e) {} } }, 5000);
            x.send(corpo);
        });
    }

    async function jaEstaNoServidor(id, tk) {
        try { var r = await fetchComTempo(srvUrl() + '/resultado?id=' + id, { method: 'GET', headers: srvHeaders(tk) }, 15000); return r.status === 200; }
        catch (e) { return false; }
    }

    async function enviarParaFila(job, cpf) {
        var tk = filaToken();
        andamento(job, 'Enviando ao servidor...', 30, 2);
        var corpo = JSON.stringify({
            id: job.uid, nome: job.nome || '', usuario: job.usuario || usuarioAtual(), tel: job.tel || '', cpf: cpf || '',
            cpf_s: (job.tempos && job.tempos.cpf_s) || 0,
            prep_s: Math.max(0, Math.round((Date.now() - (job.ts || Date.now())) / 1000)),   // do toque em Analisar até aqui: leitura dos arquivos no celular
            docsId: job.docsId.map(docParaServidor), docsRend: job.docsRend.map(docParaServidor),
            universal: true   // leitor universal de extratos (so o beta pede; o app estavel nao manda e segue o leitor de antes)
        });
        var envioMB = Math.round(corpo.length / 100000) / 10;   // tamanho do envio, em MB (o tempo de envio depende dele)
        corpo = corpo.slice(0, -1) + ',"mb":' + envioMB + '}';
        if (corpo.length > FILA_MAX_CORPO) {
            throw new Error('Os documentos somam ' + fmtMB(corpo.length) + ', mais do que o servidor aceita (13 MB). Envie menos páginas ou o PDF original do banco.');
        }
        var limite = Math.min(240000, Math.max(90000, Math.round(corpo.length / 15)));
        var res = null, ultimoErro = '';
        for (var t = 1; t <= 3 && !res; t++) {
            checar(job);
            try {
                res = await xhrPost(srvUrl() + '/enviar', tk, corpo, function (a, b) { upProgresso(job, a, b); }, limite);
            } catch (e) {
                ultimoErro = (e && e.message) || 'falha de rede';
                if (await jaEstaNoServidor(job.uid, tk)) { res = { status: 200, json: { repetido: true, estado: 'fila' } }; break; }   // a resposta se perdeu, o envio nao
                if (t < 3) { await aguardarAppPronto(60000); await pausa(2000 * t); }
            }
        }
        checar(job);
        if (!res) throw new Error('Não consegui enviar os documentos (' + ultimoErro + ', ' + fmtMB(corpo.length) + '). Confira a internet e toque em "Tentar de novo".');
        var j = res.json || {};
        if (res.status === 429) throw new Error('A fila do servidor está cheia (' + (j.max || _fila.max) + ' análises). Espere algumas terminarem e toque em "Tentar de novo".');
        if (res.status === 401 || res.status === 403) throw new Error('A senha do servidor não confere. Corrija em Configurações > Servidor.');
        if (res.status === 413) throw new Error('Os documentos são grandes demais para o servidor. Envie menos páginas ou o PDF original do banco.');
        if (res.status !== 200 && res.status !== 201) throw new Error('O servidor recusou o envio (' + (j.erro || 'HTTP ' + res.status) + ').');

        // confirmado: o servidor guardou os documentos. A partir daqui o app nao e mais necessario.
        var criada = Date.now();
        upConcluir(job);
        encerrarPersistencia(job);
        liberarDocsDoJob(job);
        removerBanner(job.id);
        var i = _jobs.indexOf(job); if (i !== -1) _jobs.splice(i, 1);
        if (!_fila.itens.some(function (x) { return x.id === job.uid; })) {
            _fila.itens.push({ id: job.uid, nome: job.nome || '', usuario: job.usuario || usuarioAtual(), estado: j.estado === 'rodando' ? 'rodando' : 'fila', etapa: 'Na fila', progresso: 0, criado_em: new Date(criada).toISOString(), posicao: null });
        }
        _formAberto = false; aplicarForm();
        renderLista(); atualizarBadge();
        filaBuscar();
    }

    // ================================================================
    // LISTA DO SERVIDOR
    // ================================================================
    function filaLer(j) {
        _fila.itens = (j.analises || []).map(function (a) { a.t = Date.parse(a.criado_em) || Date.now(); return a; });
        _fila.dif = (Date.parse(j.agora) || Date.now()) - Date.now();
        if (j.max_fila) _fila.max = j.max_fila;
        if (j.slots) _fila.slots = j.slots;
        _fila.suporte = true; _fila.ok = true; _fila.buscou = true; _fila.demorou = false; _fila.falhas = 0; _fila.motivo = ''; _fila.ts = Date.now(); _fila.senhaErrada = false;
    }

    function filaBuscar() {
        var tk = filaToken();
        if (!tk) { _fila.itens = []; _fila.ok = false; _fila.buscou = true; renderLista(); atualizarBadge(); return Promise.resolve(); }
        if (_fila.suporte === false && Date.now() - _fila.suporteTs < FILA_REVALIDA_MS) return Promise.resolve();
        if (_filaBuscando) return _filaBuscando;
        _filaBuscando = (async function () {
            try {
                var r = await fetchComTempo(srvUrl() + '/lista', { method: 'GET', headers: srvHeaders(tk) }, FILA_TIMEOUT_MS);
                if (r.status === 200) filaLer(await r.json());
                else if (r.status === 401 || r.status === 403) { _fila.senhaErrada = true; _fila.ok = false; _fila.falhas++; }
                else if (r.status === 400 || r.status === 404) { _fila.suporte = false; _fila.suporteTs = Date.now(); _fila.itens = []; _fila.ok = true; _fila.buscou = true; }   // funcao antiga, sem fila
                else {
                    var jr = await r.json().catch(function () { return {}; });
                    _fila.ok = false; _fila.falhas++;
                    _fila.motivo = 'HTTP ' + r.status + (jr && (jr.erro || jr.message) ? ' · ' + String(jr.erro || jr.message).slice(0, 140) : '');
                }
            } catch (e) { _fila.ok = false; _fila.falhas++; _fila.motivo = (e && e.name === 'AbortError') ? 'o servidor não respondeu em ' + (FILA_TIMEOUT_MS / 1000) + ' s' : 'sem conexão com o servidor (' + String((e && e.message) || e).slice(0, 80) + ')'; }
            finally { _filaBuscando = null; }
            _fila.buscou = true;
            filaColetarProntas();
            filaAvisarErros();
            renderLista(); atualizarBadge();
            filaAgendar();
        })();
        return _filaBuscando;
    }

    function filaAtivo() { return _fila.itens.some(function (a) { return a.estado === 'fila' || a.estado === 'rodando' || a.estado === 'pronta'; }); }
    function csAberto() { var o = el('cs_ov'); return !!(o && o.classList.contains('active')); }

    // analise deste perfil ainda na fila/rodando: com o app em segundo plano continua consultando, para avisar quando ficar pronta
    function temAnaliseMinhaAndando() {
        var me = usuarioAtual();
        return _fila.itens.some(function (a) { return (a.estado === 'fila' || a.estado === 'rodando') && (!a.usuario || !me || a.usuario === me); });
    }

    function filaAgendar() {
        if (_filaTimer) { clearTimeout(_filaTimer); _filaTimer = null; }
        if (!filaToken() || _fila.suporte === false) return;
        if (document.hidden && !temAnaliseMinhaAndando()) return;
        var ms = csAberto() ? (filaAtivo() ? FILA_POLL_ATIVO_MS : FILA_POLL_OCIOSO_MS) : (filaAtivo() ? FILA_POLL_FUNDO_MS : 0);
        if (!ms) return;
        ms *= Math.min(4, 1 + _fila.falhas);   // servidor fora do ar: espaca as tentativas
        _filaTimer = setTimeout(function () { _filaTimer = null; filaBuscar(); }, ms);
    }

    // O CreditoScan so abre depois de ter lido a lista do servidor (ou desistido apos o tempo limite)
    window._csAguardarLista = async function () {
        if (!filaToken()) {
            try { await Promise.race([getServerToken(), pausa(4000)]); } catch (e) {}   // aparelho novo: a senha vem do Firebase
            if (!filaToken()) return 'sem-servidor';
        }
        if (_fila.buscou && _fila.ok) { filaBuscar(); return 'ok'; }   // ja tem lista: mostra e atualiza por tras
        await Promise.race([filaBuscar(), pausa(5500)]);
        if (!_fila.ok) _fila.demorou = true;   // o servidor nao respondeu a tempo: abre com aviso e segue tentando por tras
        return _fila.ok ? 'ok' : 'sem-lista';
    };

    function filaIniciar() {
        urlServidorSincronizar();   // endereco da funcao vindo de outro aparelho (a lista abaixo ja usa o do aparelho)
        var ini = window._csListaInicial;   // leitura rapida feita pelo index.html antes do modulo carregar
        if (ini && ini.j && Date.now() - ini.ts < 30000) { filaLer(ini.j); window._csListaInicial = null; renderLista(); atualizarBadge(); filaColetarProntas(); filaAgendar(); }
        else filaBuscar();
        document.addEventListener('visibilitychange', function () { if (!document.hidden && filaToken()) filaBuscar(); else if (_filaTimer) { clearTimeout(_filaTimer); _filaTimer = null; } });
        window.addEventListener('online', function () { if (filaToken()) filaBuscar(); });
        window.addEventListener('beforeunload', function (e) { if (upAtivo()) { e.preventDefault(); e.returnValue = ''; return ''; } });
    }

    // ================================================================
    // RESULTADO PRONTO NO SERVIDOR -> mesma finalizacao de sempre
    // ================================================================
    function jobPorUid(uid) {
        for (var i = 0; i < _jobs.length; i++) if (_jobs[i].uid === uid) return _jobs[i];
        return null;
    }

    // Quem baixa o resultado: o dono da analise. Se ele nao abrir o app em COLETA_ESPERA_MS, qualquer aparelho baixa,
    // para o resultado nao ficar parado no servidor (o aviso "Analise pronta" continua sendo so do dono).
    var COLETA_ESPERA_MS = 300000;
    function ehDonoOuAtrasada(it) {
        var me = usuarioAtual();
        if (!it.usuario || !me || it.usuario === me) return true;
        var fim = Date.parse(it.concluido_em || '') || 0;
        return !fim || (Date.now() + (_fila.dif || 0) - fim) > COLETA_ESPERA_MS;
    }

    // Analise deste perfil que estava andando e agora deu erro no servidor: avisa (o "pronta" e avisado ao baixar o resultado)
    var _estadoAnt = {};
    function filaAvisarErros() {
        var me = usuarioAtual();
        _fila.itens.forEach(function (a) {
            var ant = _estadoAnt[a.id]; _estadoAnt[a.id] = a.estado;
            if (a.estado !== 'erro' || (ant !== 'fila' && ant !== 'rodando')) return;
            if (a.usuario && me && a.usuario !== me) return;
            var msg = (a.nome || 'Cliente') + ' · ' + String(a.erro || 'não foi concluída').slice(0, 90);
            notificarSistema('Análise não concluída', msg, 'creditoscan-' + a.id);
            avisar('Análise não concluída: ' + msg);
        });
    }

    function filaColetarProntas() {
        _fila.itens.forEach(function (it) {
            if (it.estado !== 'pronta') return;
            if (!ehDonoOuAtrasada(it)) return;
            var lj = jobPorUid(it.id);
            if (lj) {   // ja processada aqui; se o aviso ao servidor falhou, repete
                if (lj.estado === 'pronta' && !lj.coletadaNoServidor && !_coletando[it.id + ':aviso']) filaMarcarColetada(lj);
                return;
            }
            if (_coletando[it.id]) return;
            _coletando[it.id] = true;
            filaColetarUma(it);
        });
    }

    async function filaMarcarColetada(job) {
        var tk = filaToken(); if (!tk) return;
        _coletando[job.uid + ':aviso'] = true;
        try {
            // so libera o resultado no servidor depois de ele estar no historico
            if (!job.fbKey && job.dados) {
                job.fbKey = await salvarFB(job.dados.nomeCompleto, '', job.texto, job.dados, job.cpf, job.uid, job.usuario);
                if (!job.fbKey) return;
            }
            var r = await fetchComTempo(srvUrl() + '/coletar', { method: 'POST', headers: srvHeaders(tk), body: JSON.stringify({ id: job.uid }) }, 15000);
            if (r.ok) { job.coletadaNoServidor = true; _fila.itens = _fila.itens.filter(function (x) { return x.id !== job.uid; }); renderLista(); atualizarBadge(); }
        } catch (e) { /* tenta de novo na proxima consulta */ }
        finally { delete _coletando[job.uid + ':aviso']; }
    }

    async function filaColetarUma(it) {
        var tk = filaToken(), job = null;
        try {
            await esperarFirebase(20000);   // o historico e salvo no Firebase: precisa estar conectado
            if (!window._firebaseDB) { delete _coletando[it.id]; return; }   // sem Firebase o resultado nao entraria no historico: tenta na proxima consulta
            var r = await fetchComTempo(srvUrl() + '/resultado?id=' + it.id, { method: 'GET', headers: srvHeaders(tk) }, 30000);
            if (r.status !== 200) throw new Error('HTTP ' + r.status);
            var j = await r.json();
            if (j.estado !== 'pronta' || !j.resultado || !j.resultado.resp) { delete _coletando[it.id]; return; }   // outro aparelho repetiu ou cancelou
            if (jobPorUid(it.id)) return;
            job = criarJob([], [], j.tel || '', {
                uid: j.id, nome: j.nome || '', usuario: j.usuario || it.usuario || '', cpf: j.cpf || '', ts: Date.parse(it.criado_em) || Date.now(),
                estado: 'rodando', etapa: 'Recebendo resultado...', prog: 92, passo: 3, tempos: j.tempos || {}, doServidor: true
            });
            _jobs.unshift(job);
            renderLista();
            await concluirComResposta(job, j.resultado.resp, j.resultado.rendaPre || null, j.resultado.textoParaApostas || '', j.cpf || '');
            await filaMarcarColetada(job);
        } catch (e) {
            if (job) {
                // resposta da IA inutilizavel: o botao "Tentar de novo" manda o servidor refazer
                job.estado = 'erro'; job.etapa = 'Falhou'; job.erro = String((e && e.message) || e || 'Erro ao receber o resultado');
                encerrarPersistencia(job);
                pedirRender(); avisarJob(job, 'erro');
            } else {
                delete _coletando[it.id];   // falha de rede: tenta de novo na proxima consulta
            }
        }
    }

    // ================================================================
    // ACOES NA LISTA (analises que estao no servidor)
    // ================================================================
    async function filaPost(rota, id) {
        var tk = filaToken(); if (!tk) return false;
        try {
            var r = await fetchComTempo(srvUrl() + '/' + rota, { method: 'POST', headers: srvHeaders(tk), body: JSON.stringify({ id: id }) }, 20000);
            return r.ok;
        } catch (e) { return false; }
    }

    async function filaAcaoServidor(acao, id) {
        var rota = acao === 'retry' ? 'repetir' : 'cancelar';
        var item = _fila.itens.filter(function (x) { return x.id === id; })[0];
        if (item) {   // some da tela na hora; o servidor confirma na proxima consulta
            if (rota === 'cancelar') _fila.itens = _fila.itens.filter(function (x) { return x.id !== id; });
            else { item.estado = 'fila'; item.erro = null; item.etapa = 'Na fila'; item.progresso = 0; }
            renderLista();
        }
        var ok = await filaPost(rota, id);
        if (!ok) avisar('Não consegui falar com o servidor agora. Tente de novo em instantes.');
        filaBuscar();
    }

    // Analise que chegou do servidor mas cujo resultado nao serviu: "Tentar de novo" e "Descartar" agem no servidor
    async function filaRepetirDoJob(job) {
        var i = _jobs.indexOf(job); if (i !== -1) _jobs.splice(i, 1);
        delete _coletando[job.uid];
        removerBanner(job.id);
        renderLista();
        if (!(await filaPost('repetir', job.uid))) avisar('Não consegui falar com o servidor agora. Tente de novo em instantes.');
        filaBuscar();
    }

    // ================================================================
    // CARTOES DA LISTA E RESUMO
    // ================================================================
    function filaDur(s) {
        s = Math.max(0, Math.round(s));
        return s < 60 ? s + 's' : Math.floor(s / 60) + 'min ' + ('0' + (s % 60)).slice(-2) + 's';
    }

    function temposTexto(t) {
        if (!t) return '';
        var p = [];
        if (t.prep_s > 4) p.push('celular ' + filaDur(t.prep_s) + (t.mb ? ' (' + String(t.mb).replace('.', ',') + ' MB)' : ''));
        if (t.cpf_s !== undefined) p.push('CPF ' + filaDur(t.cpf_s));
        if (t.fila_s > 4) p.push('fila ' + filaDur(t.fila_s));
        if (t.renda_s !== undefined) p.push('renda ' + filaDur(t.renda_s));
        if (t.analise_s !== undefined) p.push('análise ' + filaDur(t.analise_s));
        if (t.total_s !== undefined) p.push('total ' + filaDur(t.total_s));
        return p.join(' · ');
    }

    function cardServidor(a) {
        var quando = horaCurta(a.t || Date.parse(a.criado_em));
        var nome = esc(a.nome || ('Cliente · ' + quando)), tag = tagUsuario(a.usuario);
        var cancelar = '<button type="button" class="cs-link bad" data-act="s-cancelar" data-sid="' + a.id + '">Cancelar</button>';
        if (a.estado === 'fila') {
            return '<div class="cs-card cs-job"><div class="cs-job-top"><div class="cs-job-info"><div class="cs-job-nome">Na fila' + (a.posicao ? ' · ' + a.posicao + 'ª' : '') + '</div>' +
                '<div class="cs-job-sub">' + nome + tag + ' · enviada ' + quando + ' · começa quando uma anterior terminar</div></div>' + cancelar + '</div></div>';
        }
        if (a.estado === 'erro') {
            return '<div class="cs-card cs-job bad"><div class="cs-job-top"><div class="cs-job-info"><div class="cs-job-nome">' + nome + tag + '</div>' +
                '<div class="cs-job-sub">Enviada ' + quando + '</div></div></div>' +
                '<div class="cs-job-erro"><i class="bi bi-exclamation-circle-fill"></i><span>' + esc(a.erro || 'A análise não foi concluída.') + '</span></div>' +
                '<div class="cs-job-foot"><button type="button" class="cs-btn cs-btn-pri cs-btn-sm" data-act="s-retry" data-sid="' + a.id + '">Tentar de novo</button>' +
                '<button type="button" class="cs-link bad" data-act="s-descartar" data-sid="' + a.id + '">Descartar</button></div></div>';
        }
        if (a.estado === 'pronta') {
            return '<div class="cs-card cs-job run"><div class="cs-job-top"><div class="cs-job-info"><div class="cs-job-nome">' + nome + tag + '</div>' +
                '<div class="cs-job-sub">Pronta · recebendo o resultado...</div></div><span class="cs-job-pct">100%</span></div>' +
                '<div class="cs-bar"><div style="width:100%"></div></div></div>';
        }
        // rodando
        var ini = a.iniciado_em ? Date.parse(a.iniciado_em) : 0;
        var ha = ini ? filaDur((Date.now() + _fila.dif - ini) / 1000) : '';
        var pct = Math.max(2, Math.min(99, a.progresso || 5));
        return '<div class="cs-card cs-job run"><div class="cs-job-top"><div class="cs-job-info"><div class="cs-job-nome">' + nome + tag + '</div>' +
            '<div class="cs-job-sub">' + esc(a.etapa || 'Rodando') + (ha ? ' · há ' + ha : '') + '</div></div><span class="cs-job-pct">' + pct + '%</span></div>' +
            '<div class="cs-bar"><div style="width:' + pct + '%"></div></div>' +
            '<div class="cs-job-foot"><span class="cs-job-sub">Pode sair do app · a análise continua no servidor</span>' + cancelar + '</div></div>';
    }

    function filaItensTela() {
        var ordem = { rodando: 0, pronta: 1, fila: 2, erro: 3 };
        return _fila.itens.filter(function (a) { return ordem[a.estado] !== undefined; })
            .sort(function (a, b) { return (ordem[a.estado] - ordem[b.estado]) || ((a.t || 0) - (b.t || 0)); });
    }

    function filaAvisoHtml() {
        if (!filaToken() || _fila.suporte === false) return '';
        if (_fila.senhaErrada) return '<div class="cs-alert warn"><i class="bi bi-exclamation-triangle-fill"></i><span>A senha do servidor não confere. Corrija em Configurações > Servidor.</span></div>';
        if (!_fila.ok && (_fila.falhas > 0 || _fila.demorou)) {
            var dica = /banco|cs_analises|cs_reivindicar/i.test(_fila.motivo || '') ? ' Provável causa: o SQL (cs-ia.sql) ainda não foi rodado no Supabase.' : '';
            return '<div class="cs-alert warn"><i class="bi bi-wifi-off"></i><span>Não consegui consultar o servidor agora. Mostrando só o que está neste aparelho. Tentando de novo...' +
                (_fila.motivo ? '<br><small>Motivo: ' + esc(_fila.motivo) + '.' + dica + '</small>' : '') + '</span></div>';
        }
        return '';
    }

    // Contagem para o cartao da tela inicial: "2 em análise · 1 pronta"
    function filaResumoTexto(locais, servidor) {
        var and = 0, pro = hojeNaoVistas(), err = 0;
        locais.forEach(function (j) { if (j.estado === 'pronta') { if (!j.visto) pro++; } else if (j.estado === 'erro') err++; else and++; });
        servidor.forEach(function (a) { if (a.estado === 'fila' || a.estado === 'rodando') and++; else if (a.estado === 'pronta') pro++; else if (a.estado === 'erro') err++; });
        var p = [];
        if (and) p.push(and + ' em análise');
        if (pro) p.push(pro + (pro > 1 ? ' prontas' : ' pronta'));
        if (err) p.push(err + (err > 1 ? ' com erro' : ' com erro'));
        return p.join(' · ');
    }

    function filaAtualizarCartaoHome() {
        var b = el('goCS2'); if (!b) return;
        var sm = b.querySelector('small'); if (!sm) return;
        if (!sm.hasAttribute('data-orig')) sm.setAttribute('data-orig', sm.textContent);
        var t = filaResumoTexto(_jobs, _fila.itens);
        sm.textContent = t || sm.getAttribute('data-orig');
        sm.style.color = t ? 'var(--primary-color)' : '';
    }

    function filaAcaoLista(act, sid) {
        if (act === 's-cancelar' || act === 's-descartar') filaAcaoServidor('cancelar', sid);
        else if (act === 's-retry') filaAcaoServidor('retry', sid);
    }

    // ================================================================
    // PRONTAS DE HOJE: as analises do dia continuam na lista mesmo depois de fechar e abrir o app.
    // Vem do historico (Firebase) + o que acabou de ficar pronto nesta sessao (sem repetir).
    // "Nova" e lembrada no aparelho ate a analise ser aberta.
    // ================================================================
    var HOJE_LS = 'cs_hoje_v1', VISTOS_LS = 'cs_vistos_v1', HOJE_MAX = 30;
    var _hoje = { itens: [], carregando: false };

    function inicioDoDia() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
    function operadorAtual() { return window.currentUserProfile || safeGet('ctwUserProfile') || '--'; }
    // Perfil do app que esta usando este aparelho ('' se nao houver). E o nome que vai na etiqueta e no aviso "Analise pronta".
    function usuarioAtual() { var u = window.currentUserProfile || safeGet('ctwUserProfile') || ''; return String(u).trim(); }
    // Filtro "Meus | Todos" da tela inicial (lembrado no aparelho). Meus = o que este perfil mandou; analise sem dono (antiga) entra em Meus.
    var FILTRO_LS = 'cs_filtro_usr_v1';
    function filtroUsuario() { return lsLer(FILTRO_LS, 'meus') === 'todos' ? 'todos' : 'meus'; }
    function passaFiltro(dono) { var me = usuarioAtual(); return filtroUsuario() === 'todos' || !dono || !me || dono === me; }
    function tagUsuario(dono) { return dono ? '<span class="cs-tag-usr">' + esc(dono) + '</span>' : ''; }
    // so as do operador deste aparelho (registros sem operador, ou aparelho sem perfil, entram)
    function ehMinha(it) { var me = operadorAtual(); return !it.operador || it.operador === '--' || me === '--' || it.operador === me; }

    function lsLer(k, padrao) { try { var v = JSON.parse(safeGet(k) || 'null'); return v === null ? padrao : v; } catch (e) { return padrao; } }
    function lsGravar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem espaco/privado: segue sem guardar */ } }

    function hojeVisto(id) { return !!(id && lsLer(VISTOS_LS, {})[id]); }
    function hojeMarcarVisto(id) {
        if (!id) return;
        var v = lsLer(VISTOS_LS, {}), limite = Date.now() - 4 * 86400000, k;
        v[id] = Date.now();
        for (k in v) if (v[k] < limite) delete v[k];   // nao cresce para sempre
        lsGravar(VISTOS_LS, v);
    }

    // Resumo leve (o texto completo da analise fica so no Firebase; e buscado ao abrir)
    function leveDoRegistro(it) {
        return { id: it.id, nomeCliente: it.nomeCliente || '', nota: it.nota, decisao: it.decisao || '', casasJogo: it.casasJogo || '',
            rendaEstimada: it.rendaEstimada || null, ts: it.ts, operador: it.operador || '', telefone: it.telefone || null, produto: it.produto || '' };
    }

    function hojeCarregarCache() {
        var c = lsLer(HOJE_LS, []), ini = inicioDoDia();
        _hoje.itens = (Array.isArray(c) ? c : []).filter(function (it) { return it && it.id && it.ts >= ini; });
    }

    // Itens de hoje que NAO estao ja na lista da sessao (as da sessao tem prioridade: carregam estado como a calculadora aberta)
    function hojeSemSessao(filtrar) {
        var ini = inicioDoDia(), chaves = {};
        _jobs.forEach(function (j) { if (j.fbKey) chaves[j.fbKey] = 1; });
        return _hoje.itens.filter(function (it) { return it.ts >= ini && !chaves[it.id] && (filtrar ? passaFiltro(it.operador) : ehMinha(it)); });
    }
    // o numero no cartao do CreditoScan conta so o que e deste perfil, qualquer que seja o filtro da tela
    function hojeNaoVistas() { return hojeSemSessao(false).filter(function (it) { return !hojeVisto(it.id); }).length; }

    // Lista unica de "Prontas de hoje": sessao + historico, mais nova primeiro
    function prontasDeHoje() {
        var ini = inicioDoDia(), lista = [];
        _jobs.forEach(function (j) { if (j.estado === 'pronta' && (j.tsFim || j.ts) >= ini && passaFiltro(j.usuario)) lista.push({ t: j.tsFim || j.ts, html: cardPronta(j) }); });
        hojeSemSessao(true).forEach(function (it) { lista.push({ t: it.ts, html: cardHoje(it) }); });
        lista.sort(function (a, b) { return b.t - a.t; });
        return lista.slice(0, HOJE_MAX);
    }

    function cardHoje(it) {
        var nota = typeof it.nota === 'number' ? it.nota : (parseInt(it.nota) || 0), rep = it.decisao === 'REPROVADO', c = rep ? 'bad' : cor(nota);
        if (restrito()) return cardRestrito({ key: it.id, nome: it.nomeCliente || 'Cliente', dono: it.operador && it.operador !== '--' ? it.operador : '', reprovado: rep, nota: nota,
            extra: it.casasJogo ? ' · apostas detectadas' : '', nova: ehMinha(it) && !hojeVisto(it.id), act: 'abrir-h', attr: 'data-hid="' + esc(it.id) + '"' });
        var sub = rep ? 'Reprovado' + (it.casasJogo ? ' · apostas detectadas' : '') :
            'Aprovado' + (it.rendaEstimada > 0 ? ' · renda ' + R$(it.rendaEstimada).replace(',00', '') + '/mês' : '') + pedSufixoGestor(it.id);
        return '<button type="button" class="cs-card cs-pronta" data-act="abrir-h" data-hid="' + esc(it.id) + '">' +
            '<span class="cs-ring-sm ' + c + '">' + nota + '</span>' +
            '<span class="cs-job-info"><span class="cs-job-nome">' + esc(it.nomeCliente || 'Cliente') + tagUsuario(it.operador && it.operador !== '--' ? it.operador : '') + '</span><span class="cs-job-sub ' + c + '">' + sub + '</span></span>' +
            (ehMinha(it) && !hojeVisto(it.id) ? '<span class="cs-tag-nova">Nova</span>' : '<i class="bi bi-chevron-right cs-chev"></i>') + '</button>';
    }

    // Busca no Firebase o que foi feito hoje (por tras: a lista guardada no aparelho ja esta na tela)
    async function hojeBuscar() {
        if (_hoje.carregando) return;
        _hoje.carregando = true;
        try {
            await esperarFirebase(8000);
            var db = window._firebaseDB; if (!db) return;
            var fb = await import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js'), ini = inicioDoDia(), snap;
            try { snap = await fb.get(fb.query(fb.ref(db, SAVE_PATH), fb.orderByChild('ts'), fb.startAt(ini))); }
            catch (e1) {
                // sem indice/consulta: le tudo e filtra aqui (leitura dividida). So com o CreditoScan aberto: em segundo plano
                // (abrir o app, voltar a ele) baixar o no inteiro entope a conexao e deixa o resto do app lento.
                var _ov = el('cs_ov');
                if (!_ov || !_ov.classList.contains('active')) return;
                snap = await lerNoInteiro(fb, db);
            }
            var itens = [];
            snap.forEach(function (c) { var v = c.val(); if (v && v.ts >= ini) itens.push(Object.assign({ id: c.key }, v)); });
            itens.sort(function (a, b) { return b.ts - a.ts; });
            _hoje.itens = itens.map(leveDoRegistro);
            lsGravar(HOJE_LS, _hoje.itens);
            _hoje.completos = {}; itens.forEach(function (it) { _hoje.completos[it.id] = it; });
            renderLista(); atualizarBadge();
        } catch (e) { console.warn('[CreditoScan] nao consegui carregar as de hoje:', e); }
        finally { _hoje.carregando = false; }
    }

    async function hojeAbrir(id) {
        var it = _hoje.completos && _hoje.completos[id];
        if (!it) {   // veio so do cache do aparelho: busca o texto completo
            try {
                await esperarFirebase(8000);
                var fb = await import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js');
                var s = await fb.get(fb.ref(window._firebaseDB, SAVE_PATH + '/' + id));
                if (s.exists()) it = Object.assign({ id: id }, s.val());
            } catch (e) { /* mostra o aviso abaixo */ }
        }
        if (!it) { avisar('Não consegui abrir agora. Confira a internet e tente de novo.'); return; }
        abrirRegistroObj(it);
    }

    function hojeIniciar() {
        hojeCarregarCache();
        hojeBuscar();
        document.addEventListener('visibilitychange', function () { if (!document.hidden) hojeBuscar(); });
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

    // ── Catalogo: produto do CTW com acrescimo de 20% (so o valor com o acrescimo entra no calculo do boleto) ──
    var ACRESCIMO_CATALOGO = 0.20;
    // v + 20%, arredondado SEMPRE PARA CIMA ate o proximo final 9,90 (235 -> 239,90; 3.228 -> 3.229,90; 239,90 fica 239,90)
    function precoComAcrescimo(v) {
        var x = Math.round(Number(v) * (1 + ACRESCIMO_CATALOGO) * 100) / 100;
        var n = Math.max(0, Math.ceil((x - 9.9) / 10 - 1e-9));
        return Math.round((n * 10 + 9.9) * 100) / 100;
    }
    function semAcentoBusca(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
    // Busca nos produtos do CTW (window.products): todas as palavras digitadas precisam estar no nome. null = lista ainda nao carregou.
    function buscarCatalogo(termo) {
        var lista = window.products;
        if (!Array.isArray(lista) || !lista.length) return null;
        var ps = semAcentoBusca(termo).split(' ').filter(Boolean);
        if (!ps.length) return [];
        var sem = window.ctwSemEstoque;
        var out = [];
        lista.forEach(function (p) {
            var valor = Number(p && p.valor);
            if (!p || !p.id || !p.nome || !(valor > 0)) return;
            var n = semAcentoBusca(p.nome);
            for (var i = 0; i < ps.length; i++) if (n.indexOf(ps[i]) === -1) return;
            out.push({ id: String(p.id), nome: String(p.nome), base: valor, preco: precoComAcrescimo(valor), sem: !!(sem && sem.has && sem.has(p.id)), pos: n.indexOf(ps[0]), tam: n.length });
        });
        out.sort(function (a, b) { return a.sem - b.sem || a.pos - b.pos || a.tam - b.tam || (a.nome < b.nome ? -1 : 1); });
        return out.slice(0, 8);
    }
    var _catSug = [];   // ultimos resultados mostrados (o toque na linha busca aqui pelo id)
    function renderSugestoes(termo) {
        var box = el('cs_c_sug'); if (!box) return;
        _catSug = [];
        termo = String(termo || '').trim();
        if (termo.length < 2) { box.innerHTML = ''; return; }
        var r = buscarCatalogo(termo);
        if (r === null) { box.innerHTML = '<div class="cs-sug-nota">Catálogo ainda não carregou. Digite o valor na mão.</div>'; return; }
        if (!r.length) { box.innerHTML = '<div class="cs-sug-nota">Não achei no catálogo. Digite o valor para calcular um produto novo.</div>'; return; }
        _catSug = r;
        box.innerHTML = r.map(function (p) {
            return '<button type="button" class="cs-sug-row' + (p.sem ? ' sem' : '') + '" data-act="cat-pick" data-id="' + esc(p.id) + '"' + (p.sem ? ' title="Sem estoque no último PDF"' : '') + '>' +
                '<span>' + esc(p.nome) + '</span><b>' + R$(p.preco) + '</b></button>';
        }).join('');
    }
    // Linha embaixo do valor: de onde veio o numero e o botao de somar/desfazer os 20%
    function notaCatalogoHtml(c) {
        var pct = Math.round(ACRESCIMO_CATALOGO * 100);
        if (c && c.base > 0) {
            var cru = Math.round(c.base * (1 + ACRESCIMO_CATALOGO) * 100) / 100;
            return '<span>Base ' + R$(c.base) + ' + ' + pct + '% = ' + R$(cru) + ' → arredondado para ' + R$(c.sug) + '. Pode editar.</span> ' +
                '<button type="button" class="cs-link" data-act="acr-toggle">Desfazer +' + pct + '%</button>';
        }
        return '<button type="button" class="cs-link" data-act="acr-toggle">Somar +' + pct + '% ao valor digitado</button>';
    }
    function pintarNotaCatalogo(c) { var n = el('cs_c_nota'); if (n) n.innerHTML = notaCatalogoHtml(c); }
    // Toque num produto da busca: nome e valor (ja com 20%) vao para os campos
    function escolherDoCatalogo(job, id) {
        var p = null; _catSug.forEach(function (x) { if (x.id === id) p = x; });
        if (!p || !job.calc) return;
        var c = job.calc, ip = el('cs_c_prod'), iv = el('cs_c_val');
        c.produto = p.nome; c.pickNome = p.nome; c.pid = p.id; c.base = p.base; c.sug = p.preco; c.valor = p.preco;
        if (ip) ip.value = p.nome;
        if (iv) iv.value = fmtNum(p.preco);
        var box = el('cs_c_sug'); if (box) box.innerHTML = '';
        _catSug = [];
        pintarNotaCatalogo(c);
        var erro = el('cs_c_erro'); if (erro) erro.textContent = '';
    }
    // Produto novo (fora do catalogo): o valor digitado vale como esta; o botao soma os 20% nele (ou desfaz)
    function alternarAcrescimo(job) {
        var c = job.calc, iv = el('cs_c_val'), erro = el('cs_c_erro'); if (!c || !iv) return;
        if (c.base > 0) {   // desfaz: volta ao valor de antes dos 20%
            iv.value = fmtNum(c.base); c.valor = c.base; c.base = 0; c.sug = 0; c.pid = '';
        } else {
            var v = numBR(iv.value);
            if (!(v > 0)) { if (erro) erro.textContent = 'Digite o valor antes de somar os 20%.'; return; }
            if (erro) erro.textContent = '';
            c.base = v; c.sug = precoComAcrescimo(v); c.valor = c.sug; c.pid = '';
            iv.value = fmtNum(c.sug);
        }
        pintarNotaCatalogo(c);
    }

    function dataAnalise(ts) {
        var dt = new Date(ts || Date.now()), hoje = new Date();
        var hora = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        if (dt.toDateString() === hoje.toDateString()) return 'hoje, ' + hora;
        return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ', ' + hora;
    }

    function blocoTexto(txt) { return esc(txt).replace(/\n/g, '<br>'); }

    function abrirResultado(job) {
        if (!job || !job.dados) return;
        if (restrito() && pedInterceptar(job)) return;   // vendedor: aprovada abre o pedido (sem nota); so abre as proprias
        _view = job; job.visto = true;
        hojeMarcarVisto(job.fbKey);   // lembra que ja abriu (a etiqueta "Nova" nao volta ao reabrir o app)
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

        var cb = !!d.confBaixa;
        // Nota + decisao
        h += '<div class="cs-hero ' + c + '">' +
            '<div class="cs-ring"><svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">' +
                '<circle cx="48" cy="48" r="42" class="trk"/><circle cx="48" cy="48" r="42" class="val" stroke-dasharray="' + dash + ' 264" transform="rotate(-90 48 48)"/></svg>' +
                '<div class="cs-ring-in"><b>' + d.nota + '</b><small>' + esc(riscoLabel) + '</small></div></div>' +
            '<div class="cs-hero-info"><div class="cs-hero-nome">' + esc(d.nomeCompleto || nomeDoJob(job)) + '</div>' +
            (!reprov && d.titConferir ? '<span class="cs-pill warn"><i class="bi bi-exclamation-triangle-fill"></i>Conferir titularidade antes de vender</span>' : '<span class="cs-pill ' + c + '"><i class="bi ' + (reprov ? 'bi-x-lg' : 'bi-check-lg') + '"></i>' + (reprov ? (d.confBaixa ? 'Reprovado — confiança baixa' : 'Reprovado — não vender') : 'Aprovado — pode vender') + '</span>') + '</div></div>';

        // Parcela confortavel (estimativa sem aparelho): logo abaixo da nota, e a primeira coisa que o vendedor precisa
        if (!reprov && d.rendaEstimada > 0) {
            h += '<div class="cs-card cs-conf"><div><span class="cs-lab">Parcela confortável (estimativa)</span>' +
                '<strong>até ' + R$(d.rendaEstimada * tetoPct(d.nota)).replace(',00', '') + ' / mês</strong></div>' +
                '<span class="cs-lab r">' + Math.round(tetoPct(d.nota) * 100) + '% da<br>renda</span></div>';
        }

        // confiança baixa: o motivo vem logo abaixo da decisão, antes de renda e indicadores
        if (reprov && d.confBaixa && d.confMotivos && d.confMotivos.length) h += '<div class="cs-card cs-motivos cs-cb"><span class="cs-lab">Por que foi reprovado</span>' + d.confMotivos.map(function (m, i) {
            return '<div class="cs-cb-m"><span class="cs-cb-n">' + (i + 1) + '</span><div><b>' + esc(m.t) + '</b><span>' + esc(m.x) + '</span></div></div>';
        }).join('') + '</div>';

        if (job.tempos && temposTexto(job.tempos)) h += '<div class="cs-tempos"><i class="bi bi-stopwatch"></i><span>' + esc(temposTexto(job.tempos)) + '</span></div>';

        // confiança baixa: os motivos vão todos no cartão "Por que foi reprovado"; os avisos soltos não se repetem
        String(d.rendaDetalhe || '').split('\n').filter(function (l) { return !cb && l.charAt(0) === '⚠'; }).forEach(function (l) {
            h += '<div class="cs-alert warn"><i class="bi bi-exclamation-triangle-fill"></i><span>' + esc(l.replace(/^⚠\s*/, '')) + '</span></div>';
        });
        if (d.titConferir) h += '<div class="cs-alert warn"><i class="bi bi-exclamation-triangle-fill"></i><span><strong>Conferir titularidade:</strong> ' + esc(avisoTitularidade(d.titConferir)) + '</span></div>';
        var divg = cb ? '' : avisoDivergencia(d);
        if (divg) h += '<div class="cs-alert warn"><i class="bi bi-exclamation-triangle-fill"></i><span>' + esc(divg) + '</span></div>';

        if (d.compromissoDuvida && !cb) h += '<div class="cs-alert warn"><i class="bi bi-exclamation-triangle-fill"></i><span><strong>Compromissos fixos não confirmados:</strong> ' + esc(textoCompromissoDuvida(d)) + '. Confira no extrato antes de aprovar. Esse item não entrou na nota.</span></div>';

        if (d.confianca === 'BAIXA' && !cb) h += '<div class="cs-alert warn"><i class="bi bi-exclamation-triangle-fill"></i><span><strong>Atenção:</strong> documento com qualidade baixa. Peça uma foto melhor.</span></div>';
        else if (d.confianca === 'MEDIA' && !cb) h += '<div class="cs-alert warn soft"><i class="bi bi-eye-fill"></i><span>Qualidade média — confira o nome manualmente.</span></div>';

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
        var tit = d.titConferir && d.nomesBatem !== false ? ['Conferir', 'warn'] : d.nomesBatem === true ? ['Confirmada', 'ok'] : d.nomesBatem === false ? ['Divergência', 'bad'] : ['Sem documento', 'warn'];
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
                '<span class="cs-det">De cada R$ 100 que entraram, saíram R$ ' + fp + ' (entradas ' + R$(d.fluxo.entradas) + ' · saídas ' + R$(d.fluxo.saidas) + ' em ' + d.fluxo.meses + (d.fluxo.meses === 1 ? ' mês' : ' meses') + '). ' + (d.fluxo.fonte === 'codigo' ? 'Lido e conferido pelo sistema, centavo a centavo.' : 'Valores aproximados.') + '</span></div>';
        } else if (d.fluxoDescartado) {
            h += '<div class="cs-card cs-ind cs-fluxo"><span class="cs-lab">Saídas ÷ entradas</span><b class="warn">—</b>' +
                '<span class="cs-det">Não deu para conferir as saídas deste extrato (a leitura das entradas não bateu). Este item ficou fora da análise.</span></div>';
        }

        h += cartaoTelefone(job);

        // Calcular aparelho (recolhido)
        if (!reprov) {
            var cc = job.calc;
            h += '<button type="button" class="cs-calc-toggle' + (cc.aberto ? ' open' : '') + '" data-act="calc-toggle">' +
                '<i class="bi bi-calculator-fill"></i><span><b>Calcular aparelho</b><small>Informe o valor. Usa esta nota, sem nova análise.</small></span>' +
                '<i class="bi bi-chevron-down cs-chev"></i></button>' +
                '<div id="cs_calc" class="cs-calc' + (cc.aberto ? ' open' : '') + '">' +
                    '<div class="cs-card cs-calc-form">' +
                        '<div class="cs-field"><label for="cs_c_prod">Produto <em>(busca no catálogo ou digite um novo)</em></label><input id="cs_c_prod" class="cs-in" type="text" maxlength="80" placeholder="Ex: iPhone 13 128 GB" value="' + esc(cc.produto) + '" autocomplete="off"><div id="cs_c_sug" class="cs-sug"></div></div>' +
                        '<div class="cs-field"><label for="cs_c_val">Valor do aparelho (R$)</label><input id="cs_c_val" class="cs-in" type="text" inputmode="decimal" placeholder="Ex: 2.000,00" value="' + (cc.valor > 0 ? fmtNum(cc.valor) : '') + '" autocomplete="off"><div id="cs_c_nota" class="cs-det">' + notaCatalogoHtml(cc) + '</div></div>' +
                        '<div class="cs-err" id="cs_c_erro"></div>' +
                        '<button type="button" class="cs-btn cs-btn-pri" data-act="calc-go"><i class="bi bi-calculator"></i> Calcular</button>' +
                    '</div>' +
                    '<div id="cs_calc_out"></div>' +
                '</div>';
        }

        // Aparelhos liberados para a renda deste cliente (aba fechada, abaixo do Calcular aparelho)
        h += apHtmlCard(d);

        // Reprovado: motivos + mensagem
        if (reprov && d.motivos && !cb) h += '<div class="cs-card cs-motivos"><span class="cs-lab">Motivos da reprovação</span><p>' + blocoTexto(d.motivos) + '</p></div>';

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
            '<div class="cs-ap-btns"><button type="button" class="cs-btn cs-btn-ghost" id="cs_wpp_btn" data-act="copiar"><i class="bi bi-clipboard"></i> Copiar</button>' +
            '<button type="button" class="cs-btn cs-btn-pri" id="cs_wpp_send" data-act="wpp-msg"><i class="bi bi-whatsapp"></i> Enviar no WhatsApp</button></div></div>';
    }

    // ── WhatsApp do cliente (opcional) ──
    // Mascara enquanto digita e avisa (sem bloquear) quando o numero nao esta completo
    function mascararTelefone(inp, idDica) {
        var dig = String(inp.value || '').replace(/\D/g, '');
        if (dig.length >= 12 && dig.indexOf('55') === 0) dig = dig.slice(2);   // colou +55...
        inp.value = formatarTelefone(dig.slice(0, 11));
        var dica = el(idDica); if (!dica) return;
        var n = normalizarTelefone(inp.value);
        dica.textContent = !dig.length ? 'Com o número, os botões de WhatsApp abrem direto na conversa do cliente.' :
            n ? 'Os botões de WhatsApp vão abrir a conversa com ' + formatarTelefone(n) + '.' :
            'Número incompleto: o WhatsApp vai abrir sem destinatário e você escolhe o contato.';
        dica.style.color = dig.length && !n ? 'var(--cs-warn)' : '';
    }

    // Digitou/alterou o numero na tela de resultado: vale para os botoes e fica salvo no registro
    function salvarTelefoneResultado(valor) {
        var job = _view; if (!job) return;
        var n = normalizarTelefone(valor);
        var antes = job.tel || '';
        job.tel = n;
        if (n !== antes && job.fbKey) atualizarFB(job.fbKey, { telefone: n || null });
    }

    function cartaoTelefone(job) {
        return '<div class="cs-card cs-tel-res"><div class="cs-tel-row"><i class="bi bi-whatsapp"></i>' +
            '<input id="cs_tel_res" class="cs-in" type="tel" inputmode="tel" autocomplete="off" maxlength="24" placeholder="WhatsApp do cliente (opcional)" aria-label="WhatsApp do cliente" value="' + esc(formatarTelefone(job.tel)) + '"></div>' +
            '<div class="cs-hint" id="cs_tel_res_hint">' + (job.tel ? 'Os botões de WhatsApp vão abrir a conversa com ' + esc(formatarTelefone(job.tel)) + '.' : 'Com o número, os botões de WhatsApp abrem direto na conversa do cliente.') + '</div></div>';
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
        // o valor so e "do catalogo" enquanto continua o que o catalogo + 20% deu; mexeu no valor ou no nome, deixa de ser
        if (c.base > 0 && Math.abs(val - c.sug) > 0.005) { c.base = 0; c.sug = 0; c.pid = ''; pintarNotaCatalogo(c); }
        else if (c.pid && prod !== c.pickNome) c.pid = '';
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
            valorBase: c.base > 0 ? c.base : null, acrescimoPct: c.base > 0 ? Math.round(ACRESCIMO_CATALOGO * 100) : null, produtoId: c.pid || null,
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
    function abrirRegistro(idx) { abrirRegistroObj((window._histItems || [])[idx]); }
    function abrirRegistroObj(it) {
        if (!it) return;
        var d = dadosDoRegistro(it);
        abrirResultado({
            id: 'h' + it.id, estado: 'pronta', ts: it.ts, nome: String(it.nomeCliente || ''),
            dados: d, texto: it.textoCompleto || '', fbKey: it.id, criadoAqui: false, tel: normalizarTelefone(it.telefone),
            usuario: it.operador && it.operador !== '--' ? it.operador : '', resumoReg: String(it.resumo || ''),
            podeSalvarCalc: !it.produto, visto: true, calc: { aberto: false, produto: '', valor: 0 }
        });
    }

    function acaoResultado(e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var a = b.getAttribute('data-act'), job = _view; if (!job) return;
        if (a === 'copiar') copiarTexto(textoParaCopiar(), el('cs_wpp_btn'));
        else if (a === 'wpp-msg') { var mt = textoParaCopiar(); if (mt) window.open(linkWhatsapp(job.tel, mt), '_blank'); }
        else if (a === 'ap-toggle') apToggleAba(job);
        else if (a === 'ap-sel') apToggleSel(job, b.getAttribute('data-id'));
        else if (a === 'ap-copy') copiarTexto(apMensagemAtual(job), b);
        else if (a === 'ap-wpp') apAbrirWpp(job);
        else if (a === 'ap-cfg') abrirConfig('ap');
        else if (a === 'calc-go') calcular();
        else if (a === 'cat-pick') escolherDoCatalogo(job, b.getAttribute('data-id'));
        else if (a === 'acr-toggle') alternarAcrescimo(job);
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
        '#cs_ov,#cs_hist_ov,#cs_fila_ov,#cs_ped_ov,#cs_res_ov,#cs_cfg_ov,#cs_lote_ov{display:none;position:fixed;inset:0;background:var(--bg-color,#16171A);color:var(--text-color);flex-direction:column;overflow:hidden;font-family:"Poppins",sans-serif}',
        '#cs_ov{z-index:1050}#cs_hist_ov{z-index:1051}#cs_res_ov{z-index:1052}#cs_cfg_ov{z-index:1053}#cs_lote_ov{z-index:1054}',
        '#cs_fila_ov,#cs_ped_ov{z-index:1051}',
        '#cs_ov.active,#cs_hist_ov.active,#cs_fila_ov.active,#cs_ped_ov.active,#cs_res_ov.active,#cs_cfg_ov.active,#cs_lote_ov.active{display:flex}',
        '.cs-scope{--cs-warn:#E9B44C;--cs-bad:#EF6B6B;--cs-info:#6FA8DC;--cs-ok:var(--primary-color)}',
        '[data-theme="light"] .cs-scope{--cs-warn:#B7791F;--cs-bad:#D14343;--cs-info:#2F6FAE}',
        '.cs-h{display:none!important}',
        /* ── cabecalho ── */
        '.cs-hdr,.cs-hhdr{display:flex;align-items:center;gap:10px;padding:calc(14px + env(safe-area-inset-top,0px)) 16px 12px;flex-shrink:0}',
        '.cs-hdr-ttl,.cs-hhdr-ttl{font-size:18px;font-weight:700;line-height:1.2;color:var(--text-color)}',
        '.cs-hdr-sub,.cs-hhdr-sub{font-size:12px;color:var(--text-secondary)}',
        '.cs-hlink{min-height:44px;padding:0 12px;border:0;border-radius:12px;background:transparent;color:var(--text-secondary);font:500 12px "Poppins",sans-serif;display:flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0;white-space:nowrap}.cs-hlink:active{background:var(--glass-border)}',
        '.cs-back,.cs-ibtn{display:flex;align-items:center;justify-content:center;gap:8px;min-height:44px;border:1px solid var(--glass-border);background:var(--card-bg);color:var(--text-color);font:500 13px "Poppins",sans-serif;cursor:pointer;flex-shrink:0;-webkit-tap-highlight-color:transparent}',
        '.cs-back{width:44px;border-radius:50%;padding:0;font-size:1.1rem}',
        '.cs-ibtn{width:44px;border-radius:14px;padding:0}',
        '.cs-back:active,.cs-ibtn:active{transform:scale(.96)}',
        /* ── corpo rolavel (folga para o menu inferior) ── */
        '.cs-body,.cs-hbody{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:6px 16px 28px;display:flex;flex-direction:column;gap:12px;min-height:0}',
        'body.ctw-v2-active .cs-body,body.ctw-v2-active .cs-hbody{padding-bottom:calc(112px + env(safe-area-inset-bottom,0px))}',
        '.cs-body>*,.cs-hbody>*{flex-shrink:0}',
        'html.cs-kb-on body .cs-body,html.cs-kb-on body .cs-hbody{padding-bottom:calc(var(--cs-kb,0px) + 24px) !important}',
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
        /* ── tela inicial: abas, documentos juntos, botao fixo ── */
        '.cs-tab-n{margin-left:6px;min-width:20px;height:20px;padding:0 6px;box-sizing:border-box;border-radius:10px;background:var(--glass-border);color:var(--text-color);font-size:11px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle}',
        '.cs-seg button.on .cs-tab-n{background:#0d1f15;color:var(--primary-color)}',
        '.cs-step{width:28px;height:28px;border-radius:50%;border:1.5px solid var(--primary-color);color:var(--primary-color);font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-sizing:border-box}',
        '.cs-step.ok{background:var(--primary-color);color:#0d1f15}',
        '.cs-step i.bi{font-size:14px!important;color:inherit!important}',
        '#cs_ov .cs-body>*,#cs_form>*{flex-shrink:0}',
        '.cs-zone{border:1.5px dashed rgba(var(--primary-color-rgb),.55);border-radius:14px;padding:16px 12px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}',
        '.cs-zone>i.bi{font-size:1.6rem;color:var(--primary-color)}',
        '.cs-zone>b{font-size:14px;font-weight:600}',
        '.cs-zone>span{font-size:12px;color:var(--text-secondary);line-height:1.5}',
        '.cs-zone .cs-ubtns{width:100%}',
        '.cs-more{height:44px;border-radius:12px;border:1.5px dashed rgba(var(--primary-color-rgb),.55);background:transparent;color:var(--primary-color);font:600 13px "Poppins",sans-serif;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;width:100%}',
        '.cs-file{min-height:52px}',
        '.cs-fi{flex:1;min-width:0;display:flex;flex-direction:column}',
        '.cs-fi b{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.cs-fi em{font-style:normal;font-size:11px;color:var(--text-secondary)}',
        '.cs-fi em.warn{color:var(--cs-warn)}',
        '.cs-chip{min-height:32px;padding:0 10px;border-radius:16px;border:0;background:rgba(var(--primary-color-rgb),.16);color:var(--primary-color);font:600 12px "Poppins",sans-serif;cursor:pointer;flex-shrink:0}',
        '.cs-chip.warn{background:rgba(255,179,0,.18);color:var(--cs-warn)}',
        '.cs-chks{display:flex;flex-direction:column;gap:8px}',
        '.cs-chk{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary)}',
        '.cs-chk.ok{color:var(--primary-color)}.cs-chk.warn{color:var(--cs-warn)}',
        '.cs-dot{width:16px;height:16px;border-radius:50%;border:1.5px solid currentColor;box-sizing:border-box;flex-shrink:0}',
        '.cs-lote-link{align-self:center;border:0;background:none;color:var(--text-secondary);font:500 12px "Poppins",sans-serif;min-height:44px;display:flex;align-items:center;gap:6px;padding:0 12px;cursor:pointer}',
        '.cs-tag-dev{border:1px solid var(--glass-border);border-radius:10px;padding:1px 7px;font-size:10px}',
        '.cs-sbar{position:sticky;bottom:var(--cs-nav,96px);z-index:5;margin:0 -16px;padding:10px 16px 6px;background:var(--bg-color,#16171A);border-top:1px solid var(--glass-border);display:flex;flex-direction:column;gap:8px}',
        '.cs-sbar::after{content:"";position:absolute;left:0;right:0;top:100%;height:var(--cs-nav,96px);background:var(--bg-color,#16171A)}',
        'html.cs-kb-on .cs-sbar{position:static}html.cs-kb-on .cs-sbar::after{display:none}',
        '#cs_ov .cs-body{padding-bottom:calc(var(--cs-nav,96px) + 16px)}',
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
        '.cs-tag-usr{display:inline-block;vertical-align:middle;margin-left:7px;font-size:10px;font-weight:600;line-height:1;background:rgba(255,255,255,.08);color:var(--text-secondary);border:1px solid var(--input-border);border-radius:20px;padding:3px 8px;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.cs-seg{display:flex;gap:4px;padding:3px;margin:0 0 12px;background:var(--input-bg);border:1px solid var(--input-border);border-radius:12px}',
        '.cs-seg button{flex:1;min-height:38px;border:0;border-radius:9px;background:transparent;color:var(--text-secondary);font:inherit;font-size:13px;font-weight:600;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.cs-seg button.on{background:var(--primary-color);color:#0d1f15}',
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
        '.cs-cb{gap:12px}.cs-cb-m{display:flex;gap:10px;align-items:flex-start}.cs-cb-n{flex:none;width:24px;height:24px;border-radius:50%;background:var(--cs-bad);color:#fff;font:700 13px "Poppins",sans-serif;display:flex;align-items:center;justify-content:center}',
        '.cs-cb-m>div{min-width:0}.cs-cb-m b{display:block;font-size:14px;font-weight:600}.cs-cb-m span:not(.cs-cb-n){display:block;font-size:13px;line-height:1.5;color:var(--text-secondary)}',
        '.cs-detalhe{background:var(--card-bg);border:1px solid var(--glass-border);border-radius:16px;overflow:hidden}',
        '.cs-detalhe summary{min-height:52px;padding:0 16px;display:flex;align-items:center;justify-content:space-between;font:500 14px "Poppins",sans-serif;cursor:pointer;list-style:none}',
        '.cs-detalhe summary::-webkit-details-marker{display:none}',
        '.cs-detalhe summary i{color:var(--text-secondary);transition:transform .2s}.cs-detalhe[open] summary i{transform:rotate(180deg)}',
        '.cs-detalhe-in{padding:0 16px 14px;font-size:13px;line-height:1.6;color:var(--text-color);text-align:left}',
        '.cs-detalhe-in h4{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--primary-color);margin:12px 0 4px;text-align:left}',
        '.cs-detalhe-in p{margin:0}.cs-detalhe-in p.mono{font-size:12px;color:var(--text-secondary)}',
        /* ── calcular aparelho ── */
        '.cs-sug{display:flex;flex-direction:column;border-radius:12px;overflow:hidden}.cs-sug:empty{display:none}.cs-sug:not(:empty){border:1px solid var(--input-border);background:var(--card-bg)}',
        '.cs-sug-row{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:44px;padding:8px 12px;border:0;border-bottom:1px solid var(--input-border);background:transparent;color:var(--text-color);font:500 14px "Poppins",sans-serif;text-align:left;cursor:pointer}',
        '.cs-sug-row:last-child{border-bottom:0}.cs-sug-row span{min-width:0}.cs-sug-row b{color:var(--primary-color);font-weight:600;white-space:nowrap}',
        '.cs-sug-row.sem span,.cs-sug-row.sem b{color:var(--cs-bad)}',
        '.cs-sug-nota{padding:10px 12px;font-size:12px;color:var(--text-secondary)}',
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
        /* ── envio ao servidor (trava o app ate confirmar) ── */
        '#cs_up_ov{display:none;position:fixed;inset:0;z-index:9500;background:rgba(8,10,12,.88);align-items:center;justify-content:center;padding:24px;font-family:"Poppins",sans-serif;-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);touch-action:none}',
        '#cs_up_ov.on{display:flex}',
        '.cs-up-box{width:100%;max-width:340px;background:var(--card-bg);border:1px solid var(--glass-border);border-radius:24px;padding:26px 22px;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;color:var(--text-color)}',
        '.cs-up-ico{width:64px;height:64px;border-radius:50%;background:rgba(var(--primary-color-rgb),.16);color:var(--primary-color);display:flex;align-items:center;justify-content:center;font-size:1.9rem;animation:cs-pulso 1.4s ease-in-out infinite}',
        '.cs-up-ico.ok{background:var(--primary-color);color:#0d1f15;animation:none}',
        '@keyframes cs-pulso{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}',
        '.cs-up-t{font-size:18px;font-weight:700}.cs-up-s{font-size:13px;color:var(--text-secondary);line-height:1.5;overflow-wrap:anywhere}',
        '#cs_up_bar{width:100%}.cs-up-w{font-size:12px;font-weight:600;color:var(--cs-warn)}',
        '.cs-tempos{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary);padding:0 4px}.cs-tempos i{color:var(--primary-color)}',
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
        '.cs-tel-form{display:flex;flex-direction:column;gap:10px}',
        '.cs-up-h i.bi-whatsapp:first-child{color:#25d366}',
        '.cs-tel-res{display:flex;flex-direction:column;gap:8px}',
        '.cs-tel-res .cs-tel-row{display:flex;align-items:center;gap:10px}',
        '.cs-tel-res .cs-tel-row>i{font-size:1.3rem;color:#25d366}',
        '.cs-tel-res .cs-tel-row .cs-in{flex:1;min-width:0}',
        '.cs-tel-res .cs-hint{text-align:left}',
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
        '.cs-apc-res{font-size:13px;line-height:1.5;text-align:left}.cs-apc-res .ok{color:var(--cs-ok)}.cs-apc-res .bad{color:var(--cs-bad)}',
        '.cs-lt-p{gap:8px}.cs-lt-p.off{opacity:.55}',
        '.cs-lt-hd{display:flex;align-items:center;gap:10px;font-size:14px;min-height:36px;cursor:pointer}.cs-lt-hd input{width:20px;height:20px;accent-color:var(--primary-color);flex-shrink:0}.cs-lt-hd b{min-width:0;overflow-wrap:anywhere}',
        '.cs-lt-bd{font-size:12px;display:flex;align-items:center;gap:6px}.cs-lt-bd.ok{color:var(--cs-ok)}.cs-lt-bd.warn{color:var(--cs-warn)}',
        '.cs-lt-f{display:flex;align-items:center;gap:8px;background:rgba(var(--primary-color-rgb),.08);border-radius:12px;padding:6px 8px;min-width:0}.cs-lt-f.erro{background:rgba(239,107,107,.12)}',
        '.cs-lt-f img{width:32px;height:32px;border-radius:7px;object-fit:cover;flex-shrink:0}.cs-lt-f>i.bi{color:var(--primary-color);font-size:1.1rem;flex-shrink:0}',
        '.cs-lt-n{flex:1;min-width:0;display:flex;flex-direction:column}.cs-lt-n b{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cs-lt-n small{font-size:11px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cs-lt-n small.w{color:var(--cs-warn)}',
        '.cs-lt-tp{min-height:36px;padding:0 10px;border-radius:99px;border:1px solid var(--glass-border);background:transparent;color:var(--text-secondary);font:600 11px "Poppins",sans-serif;cursor:pointer;flex-shrink:0}',
        '.cs-lt-sel{min-height:36px;max-width:96px;border-radius:10px;border:1px solid var(--glass-border);background:var(--card-bg);color:var(--text-color);font:500 11px "Poppins",sans-serif;flex-shrink:0}',
        '.cs-lt-sug{font-size:12px;color:var(--text-secondary);display:flex;align-items:center;gap:4px;flex-wrap:wrap}',
        /* ── gestor: produtos, pedido e fila ── */
        '.cs-ro{cursor:default}',
        '.cs-hint.left{text-align:left}',
        '.cs-fila-n{min-width:22px;height:22px;padding:0 6px;box-sizing:border-box;border-radius:11px;background:var(--primary-color);color:#0d1f15;font-size:12px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}',
        '.cs-pp{display:flex;flex-direction:column;gap:8px}',
        '.cs-pp-top{display:flex;flex-direction:column;gap:8px}',
        '.cs-pp-lab{font-size:11px;color:var(--text-secondary);font-weight:600;letter-spacing:.3px}',
        '.cs-pp-sel{display:flex;flex-direction:column;gap:6px}',
        '.cs-pp-tag{display:flex;align-items:center;gap:8px;padding:8px 10px 8px 12px;border-radius:12px;background:rgba(var(--primary-color-rgb),.1);border:1px solid rgba(var(--primary-color-rgb),.35)}',
        '.cs-pp-tag.fora{background:rgba(233,180,76,.1);border-color:rgba(233,180,76,.45)}',
        '.cs-pp-tag>span{flex:1;min-width:0;display:flex;flex-direction:column}',
        '.cs-pp-tag b{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis}',
        '.cs-pp-tag small{font-size:11px;color:var(--primary-color)}.cs-pp-tag.fora small{color:var(--cs-warn)}',
        '.cs-pp-tag button{width:32px;height:32px;border:0;border-radius:50%;background:transparent;color:var(--text-secondary);font-size:.85rem;cursor:pointer;flex-shrink:0}',
        '.cs-pp-chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}.cs-pp-chips::-webkit-scrollbar{display:none}',
        '.cs-pp-chip{flex:none;min-height:36px;padding:0 12px;border-radius:99px;border:1px solid var(--glass-border);background:transparent;color:var(--text-color);font:500 12px "Poppins",sans-serif;cursor:pointer;white-space:nowrap}',
        '.cs-pp-row{display:flex;gap:8px}.cs-pp-row .cs-btn{width:52px;padding:0;flex-shrink:0}',
        '.cs-pp-sug{display:flex;flex-direction:column}',
        '.cs-g-banner{display:flex;align-items:center;gap:12px;border-radius:16px;padding:12px 14px;border:1px solid}',
        '.cs-g-banner>i{font-size:1.3rem}.cs-g-banner>div{display:flex;flex-direction:column}.cs-g-banner b{font-size:14px;font-weight:600}.cs-g-banner span{font-size:12px;color:var(--text-secondary)}',
        '.cs-g-banner.ok{background:rgba(var(--primary-color-rgb),.12);border-color:rgba(var(--primary-color-rgb),.4)}.cs-g-banner.ok>i,.cs-g-banner.ok b{color:var(--cs-ok)}',
        '.cs-g-banner.warn{background:rgba(233,180,76,.1);border-color:rgba(233,180,76,.4)}.cs-g-banner.warn>i,.cs-g-banner.warn b{color:var(--cs-warn)}',
        '.cs-g-prod-h{display:flex;align-items:center;gap:8px}.cs-g-prod-h b{flex:1;min-width:0;font-size:14px;font-weight:600}',
        '.cs-g-prod.recusado{box-shadow:inset 3px 0 0 var(--cs-bad)}',
        '.cs-g-tag{flex:none;font-size:11px;font-weight:600;padding:3px 9px;border-radius:9px;background:rgba(var(--primary-color-rgb),.15);color:var(--cs-ok)}',
        '.cs-g-tag.warn{background:rgba(233,180,76,.16);color:var(--cs-warn)}.cs-g-tag.bad{background:rgba(239,107,107,.16);color:var(--cs-bad)}',
        '.cs-g-note{font-size:12px;color:var(--text-secondary);line-height:1.45}',
        '.cs-g-vals{display:flex;gap:8px}.cs-g-vals>div{flex:1;background:rgba(0,0,0,.18);border-radius:12px;padding:8px 10px;display:flex;flex-direction:column}',
        '[data-theme="light"] .cs-g-vals>div{background:rgba(0,0,0,.05)}',
        '.cs-g-vals span{font-size:11px;color:var(--text-secondary)}.cs-g-vals b{font-size:15px;font-weight:600}',
        '.cs-g-addbtn{flex:none;min-height:46px;border-radius:23px;border:1.5px dashed var(--glass-border);background:transparent;color:var(--primary-color);font:600 14px "Poppins",sans-serif;cursor:pointer}',
        '.cs-g-sum-n{display:flex;gap:8px}.cs-g-sum-n>div{flex:1;background:rgba(0,0,0,.18);border-radius:14px;padding:10px 12px;display:flex;flex-direction:column}.cs-g-sum-n>div.w{flex:1.4}',
        '[data-theme="light"] .cs-g-sum-n>div{background:rgba(0,0,0,.05)}',
        '.cs-g-sum-n span{font-size:11px;color:var(--text-secondary)}.cs-g-sum-n b{font-size:20px;font-weight:700;line-height:1.3}.cs-g-sum-n .w b{font-size:17px;font-weight:600}',
        '.cs-g-sum-n b.ok{color:var(--cs-ok)}.cs-g-sum-n b.warn{color:var(--cs-warn)}.cs-g-sum-n b.bad{color:var(--cs-bad)}',
        '.cs-g-sum-f{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--text-secondary)}.cs-g-sum-f b{color:var(--text-color);font-weight:600}',
        '.cs-g-seg{display:flex;gap:4px;padding:4px;background:var(--input-bg);border:1px solid var(--input-border);border-radius:16px}',
        '.cs-g-seg button{flex:1;min-height:38px;border:0;border-radius:12px;background:transparent;color:var(--text-secondary);font:500 13px "Poppins",sans-serif;cursor:pointer}',
        '.cs-g-seg button.on{font-weight:700}.cs-g-seg button.on.ok{background:var(--primary-color);color:#0d1f15}.cs-g-seg button.on.bad{background:var(--cs-bad);color:#fff}',
        '.cs-g-row{display:flex;gap:8px}',
        '.cs-g-f{display:flex;flex-direction:column;gap:4px;min-width:0}.cs-g-f>span{font-size:11px;color:var(--text-secondary)}',
        '.cs-g-err{font-size:12px;color:var(--cs-bad);min-height:0}.cs-g-err:empty{display:none}',
        '.cs-g-info{display:flex;gap:10px;padding:2px 6px;font-size:12px;line-height:1.45;color:var(--text-secondary)}.cs-g-info i{margin-top:2px}',
        '.cs-g-fila{cursor:pointer;gap:8px;position:relative}',
        '.cs-g-fila.ok{box-shadow:inset 3px 0 0 var(--cs-ok)}.cs-g-fila.warn{box-shadow:inset 3px 0 0 var(--cs-warn)}.cs-g-fila.bad{box-shadow:inset 3px 0 0 var(--cs-bad)}',
        '.cs-g-fila-h{display:flex;align-items:center;gap:8px}.cs-g-fila-h b{flex:1;min-width:0;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.cs-g-fila-p{display:flex;align-items:center;gap:8px;font-size:13px}.cs-g-fila-p i{color:var(--text-secondary)}',
        '.cs-g-fila-f{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--text-secondary)}.cs-g-fila-f b{color:var(--text-color);font-weight:600}',
        '.cs-g-fila-f .ok{color:var(--cs-ok)}.cs-g-fila-f .warn{color:var(--cs-warn)}.cs-g-fila-f .bad{color:var(--cs-bad)}'
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
            '<button type="button" class="cs-ibtn" id="cs_hist_open" aria-label="Histórico completo"><i class="bi bi-clock-history"></i></button>'+
            '<button type="button" class="cs-ibtn" id="cs_cfg_open" aria-label="Configurações"><i class="bi bi-gear-fill"></i></button>'+
        '</div>'+
        '<div class="cs-body">'+
            '<div class="cs-seg" role="tablist" aria-label="Tela">'+
                '<button type="button" role="tab" class="on" id="cs_tab_nova" aria-selected="true">Nova análise</button>'+
                '<button type="button" role="tab" id="cs_tab_hist" aria-selected="false">Histórico do dia<span class="cs-tab-n cs-h" id="cs_tab_n"></span></button>'+
            '</div>'+
            '<button type="button" class="cs-btn cs-btn-ghost cs-h" id="cs_btn_fila"><i class="bi bi-hourglass-split"></i> Fila do gestor <span class="cs-fila-n cs-h" id="cs_fila_n"></span></button>'+
            '<div id="cs_form" style="display:flex;flex-direction:column;gap:14px">'+
                '<div class="cs-card">'+
                    '<div class="cs-up-h"><span class="cs-step" id="cs_step1">1</span><b>Documentos do cliente</b><span class="cs-cnt" id="cs_docs_cnt"></span></div>'+
                    '<div class="cs-zone" id="cs_zone"><i class="bi bi-upload"></i><b>Anexe tudo de uma vez</b><span>RG ou CNH, extratos e holerites juntos.<br>O sistema separa cada documento sozinho.</span>'+
                        '<div class="cs-ubtns"><button type="button" class="cs-ubtn" id="cs_doc_cam"><i class="bi bi-camera"></i> Câmera</button><button type="button" class="cs-ubtn" id="cs_doc_gal"><i class="bi bi-image"></i> Galeria</button><button type="button" class="cs-ubtn" id="cs_doc_pdf"><i class="bi bi-file-earmark-pdf"></i> PDF</button></div>'+
                    '</div>'+
                    '<div class="cs-files" id="cs_docs_all"></div>'+
                    '<button type="button" class="cs-more cs-h" id="cs_doc_mais"><i class="bi bi-plus-lg"></i> Adicionar mais documentos</button>'+
                    '<div class="cs-chks" id="cs_docs_chk"></div>'+
                '</div>'+
                '<div class="cs-card" id="cs_prod_card">'+
                    '<div class="cs-up-h"><span class="cs-step" id="cs_step2">2</span><b>Produto que o cliente quer</b><small class="req">Obrigatório</small></div>'+
                    ppHtml('f')+
                    '<div class="cs-hint" style="margin-top:-2px">Produto da lista responde sozinho quando a análise terminar. Os outros vão para o gestor.</div>'+
                '</div>'+
                '<div class="cs-card cs-tel-form">'+
                    '<div class="cs-up-h"><i class="bi bi-whatsapp"></i><b>WhatsApp do cliente</b><small>Opcional</small></div>'+
                    '<input id="cs_tel" class="cs-in" type="tel" inputmode="tel" autocomplete="off" maxlength="24" placeholder="(62) 99999-9999" aria-label="WhatsApp do cliente">'+
                    '<div class="cs-hint" id="cs_tel_hint" style="margin-top:-2px">Com o número, os botões de WhatsApp abrem direto na conversa do cliente.</div>'+
                '</div>'+
                '<div class="cs-up-status cs-h" id="cs_up_status"><i class="bi bi-arrow-repeat"></i><span id="cs_up_status_txt">Lendo arquivos...</span></div>'+
                '<button type="button" class="cs-lote-link cs-h" id="cs_btn_lote"><i class="bi bi-people-fill"></i> Lote · vários clientes <span class="cs-tag-dev">dev</span></button>'+
                '<div class="cs-sbar" id="cs_bar">'+
                    '<button type="button" class="cs-btn cs-btn-pri cs-btn-big" id="cs_btn_analisar" disabled><i class="bi bi-check2-circle"></i> Analisar crédito</button>'+
                    '<p class="cs-hint" id="cs_hint_analisar">Falta o comprovante de renda e o produto.</p>'+
                '</div>'+
            '</div>'+
            '<div id="cs_lista" style="display:flex;flex-direction:column;gap:10px"></div>'+
        '</div>');

        // ── Lote: varios documentos + varios extratos, o sistema separa por pessoa ──
        slot('cs_lote_ov','',
        '<div class="cs-hhdr"><button type="button" class="cs-back" id="cs_lote_close" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button><div style="flex:1"><span class="cs-hhdr-ttl">Lote</span><div class="cs-hhdr-sub">Vários clientes de uma vez</div></div></div>'+
        '<div class="cs-hbody" style="padding:8px 16px 28px;gap:12px">'+
            '<button type="button" class="cs-btn cs-btn-ghost" id="cs_lt_add"><i class="bi bi-plus-lg"></i> Adicionar documentos e extratos</button>'+
            '<p class="cs-hint" id="cs_lt_status"></p>'+
            '<button type="button" class="cs-btn cs-btn-pri cs-btn-big" id="cs_lt_go" disabled><i class="bi bi-check2-circle"></i> Nada para analisar</button>'+
            '<div id="cs_lt_body" style="display:flex;flex-direction:column;gap:12px"></div>'+
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

        // ── Gestor: fila e pedido (mesma camada do historico; o resultado completo abre por cima) ──
        slot('cs_fila_ov','',
        '<div class="cs-hhdr"><button type="button" class="cs-back" id="cs_fila_close" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button><div style="flex:1"><span class="cs-hhdr-ttl">Fila do gestor</span><div class="cs-hhdr-sub">Pedidos esperando resposta</div></div><button type="button" class="cs-hlink" id="cs_fila_nova"><i class="bi bi-plus-lg"></i> Fazer análise</button></div>'+
        '<div class="cs-hbody" id="cs_fila_body" style="padding:8px 16px 28px;gap:10px"></div>');
        slot('cs_ped_ov','',
        '<div class="cs-hhdr"><button type="button" class="cs-back" id="cs_ped_close" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button><div style="flex:1;min-width:0"><span class="cs-hhdr-ttl" id="cs_ped_ttl">Pedido</span><div class="cs-hhdr-sub" id="cs_ped_sub"></div></div></div>'+
        '<div class="cs-hbody" id="cs_ped_body" style="padding:8px 16px 28px;gap:12px"></div>');

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
                '<div class="cs-cfg-info" style="display:flex;flex-direction:column;gap:8px">'+
                    '<div class="cs-up-h"><i class="bi bi-cloud-check-fill"></i><b>Servidor (análise em segundo plano)</b></div>'+
                    '<p class="cs-hint" style="text-align:left">Com a senha do servidor, você só envia os documentos: a análise roda lá numa fila (2 por vez) e continua mesmo com o app fechado. Documentos e resultados ficam guardados no servidor por 30 dias e depois são apagados. Deixe vazio para rodar direto no celular.</p>'+
                    '<input type="url" class="cs-in" id="cs_cfg_url" placeholder="Endereço da função (vazio = padrão)" style="font-size:13px" autocomplete="off" autocapitalize="off" spellcheck="false">'+
                    '<p class="cs-hint" style="text-align:left;margin:0">Cole o endereço completo da função (painel do Supabase > Edge Functions > copiar). Só muda se a função tiver outro endereço.</p>'+
                    '<input type="password" class="cs-in" id="cs_cfg_srv" placeholder="Senha do servidor (APP_TOKEN)" style="font-size:13px" autocomplete="off">'+
                    '<button type="button" class="cs-btn cs-btn-sec" id="cs_cfg_srv_save">Testar e salvar</button>'+
                    '<div id="cs_cfg_srv_status" style="font-size:12px;text-align:center;min-height:18px"></div>'+
                '</div>'+
            '</div>'+
        '</div>');
        ligarTecladoCS();
    }

    // O app usa viewport "overlays-content": o teclado do Android cobre a tela em vez de empurra-la. Entao, enquanto o teclado
    // esta aberto, a area rolavel do CreditoScan ganha folga embaixo (= altura do teclado) e o campo focado sobe para a parte
    // de cima da tela, ficando visivel acima do teclado.
    var _tecladoLigado = false;
    function ligarTecladoCS() {
        var vv = window.visualViewport; if (_tecladoLigado || !vv) return; _tecladoLigado = true;
        var raiz = document.documentElement;
        function alturaTeclado() { var kb = Math.round(window.innerHeight - vv.height - vv.offsetTop); return kb > 120 ? kb : 0; }   // barras do navegador nao contam
        function subirCampo() {
            var a = document.activeElement; if (!a || !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
            var corpo = a.closest('.cs-body,.cs-hbody'); if (!corpo) return;
            var dy = a.getBoundingClientRect().top - Math.round(vv.height * 0.28);
            if (Math.abs(dy) > 4) corpo.scrollBy({ top: dy, behavior: 'smooth' });
        }
        function atualizar() {
            var kb = alturaTeclado();
            raiz.style.setProperty('--cs-kb', kb + 'px'); raiz.classList.toggle('cs-kb-on', kb > 0);
            if (kb > 0) subirCampo();
        }
        vv.addEventListener('resize', atualizar);
        document.addEventListener('focusin', function (e) {
            if (!e.target.closest || !e.target.closest('.cs-body,.cs-hbody')) return;
            setTimeout(function () { atualizar(); subirCampo(); }, 320);   // espera o teclado terminar de abrir
        });
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
        on('cs_doc_cam','click',function(){uploadDocs(true);});
        // Galeria e PDF abrem o seletor do Android que pergunta o app (Arquivos, Pasta Segura da Samsung...)
        on('cs_doc_gal','click',function(){uploadDocs();});
        on('cs_doc_pdf','click',function(){uploadDocs();});
        on('cs_doc_mais','click',function(){uploadDocs();});
        on('cs_tab_nova','click',function(){_formAberto=true;aplicarForm();});
        on('cs_tab_hist','click',function(){_formAberto=false;aplicarForm();});
        window.addEventListener('resize',navAltura);
        on('cs_btn_analisar','click',iniciarAnalise);
        on('cs_btn_lote','click',loteAbrir);
        on('cs_btn_fila','click',filaAbrir);
        on('cs_fila_close','click',filaFechar);
        on('cs_fila_nova','click',filaParaAnalise);
        on('cs_ped_close','click',pedFechar);
        var fbd=el('cs_fila_body');if(fbd)fbd.addEventListener('click',filaAcao);
        var pbd=el('cs_ped_body');if(pbd){pbd.addEventListener('click',pedAcao);pbd.addEventListener('input',pedCampo);pbd.addEventListener('keydown',ppEnter);}
        var pcd=el('cs_prod_card');if(pcd){pcd.addEventListener('click',ppAcao);pcd.addEventListener('input',ppDigitou);pcd.addEventListener('keydown',ppEnter);}
        on('cs_lote_close','click',loteFechar);
        on('cs_lt_add','click',loteEscolher);
        on('cs_lt_go','click',loteAnalisar);
        var lb=el('cs_lt_body');if(lb){lb.addEventListener('click',loteAcao);lb.addEventListener('change',loteAcao);}
        on('cs_tel','input',function(e){mascararTelefone(e.target,'cs_tel_hint');});
        on('cs_form','click',function(e){var x=e.target.closest('.cs-file-x');if(x)return removerArquivo(x.getAttribute('data-t'),x.getAttribute('data-aid'));var c=e.target.closest('.cs-chip');if(c)trocarTipoDoc(c.getAttribute('data-aid'),c.getAttribute('data-para'));});
        on('cs_lista','click',acaoLista);
        // Resultado: botoes e simulador (delegado — o conteudo e refeito a cada abertura)
        var rb=el('cs_res_body');
        if(rb){
            rb.addEventListener('click',acaoResultado);
            rb.addEventListener('input',function(e){if(e.target.id==='cs_en')atualizarSim(false);else if(e.target.id==='cs_tel_res')mascararTelefone(e.target,'cs_tel_res_hint');else if(e.target.id==='cs_c_prod')renderSugestoes(e.target.value);});
            rb.addEventListener('focusin',function(e){if(e.target.id==='cs_c_val'){var sg=el('cs_c_sug');if(sg)sg.innerHTML='';_catSug=[];}});
            rb.addEventListener('change',function(e){if(e.target.id==='cs_tel_res')salvarTelefoneResultado(e.target.value);else if(e.target.id==='cs_en'||e.target.id==='cs_np'||e.target.id==='cs_tx')atualizarSim(true);});
            rb.addEventListener('focusout',function(e){if(e.target.id==='cs_en'||e.target.id==='cs_tx')atualizarSim(true);});
            rb.addEventListener('keydown',function(e){if(e.key==='Enter'&&(e.target.id==='cs_c_val'||e.target.id==='cs_c_prod')){e.preventDefault();if(e.target.id==='cs_c_prod'&&_catSug.length){escolherDoCatalogo(_view,_catSug[0].id);var v=el('cs_c_val');if(v)v.focus();return;}e.target.blur();calcular();}});
        }
        // Config
        on('cs_cfg_open','click',abrirConfig);
        on('cs_cfg_close','click',function(){el('cs_cfg_ov')&&el('cs_cfg_ov').classList.remove('active');});
        on('cs_cfg_save','click',salvarConfig);
        on('cs_cfg_srv_save','click',salvarSenhaServidor);
        on('cs_cfg_open','click',function(){var i=el('cs_cfg_srv'),u=el('cs_cfg_url'),st=el('cs_cfg_srv_status');if(i)i.value=safeGet(SRV_TOKEN_LS)||'';if(u)u.value=normalizarUrlServidor(safeGet(SRV_URL_LS));if(st)st.textContent='';});
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
        window.open(linkWhatsapp(job.tel, msg), '_blank');
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

    // ================================================================
    // GESTOR: pedidos de produto e fila do gestor
    // Vendedor (perfil comum): manda os documentos + os produtos que o cliente quer. Reprovada: ele ve nota e motivos.
    // Aprovada: ele NAO ve nota/renda/aprovacao; so o andamento do pedido. Produto da lista de aparelhos liberados (e renda
    // suficiente) responde sozinho; o resto vai para a fila do gestor, que informa entrada e parcelas na mao.
    // Perfil gestor (tag dada pelo perfil dev) e perfil dev veem tudo e respondem a fila.
    // Os pedidos ficam em settings/creditoscanPedidos/{chave da analise}.
    // Obs.: os perfis do app nao sao login de verdade; esconder nota/renda e uma regra de TELA.
    // ================================================================
    var PED_PATH = 'settings/creditoscanPedidos';
    var PED_VISTO_LS = 'ctwCsPedVisto';
    var PED_MAX_PROD = 6;
    var _ped = {};              // chave da analise -> pedido (espelho do banco)
    var _pedLido = false;       // a primeira leitura do banco ja chegou
    var _pedIniciado = false;
    var _pedKey = null;         // pedido aberto na tela
    var _pedMeta = null;        // dados da analise (para criar o pedido quando ainda nao existe)
    var _pedAba = 'pend';       // aba da fila: 'pend' | 'resp'
    var _pedForm = {};          // respostas do gestor ainda nao enviadas: pid -> { dec, entrada, parcelas, parcela, motivo }
    var _pedAddAberto = false;  // seletor "Pedir outro produto" aberto
    var _pedEnviando = false;
    var _ppSel = { f: [], p: [] };   // produtos escolhidos: f = tela "Nova analise", p = tela do pedido
    var _ppSug = { f: [], p: [] };   // sugestoes do catalogo mostradas

    function ehGestor() { return !!(window.ctwPerfilGestor && window.ctwPerfilGestor()); }
    function ehDevPerfil() { return !!(window.ctwPerfilDev && window.ctwPerfilDev()); }
    function veTudo() { return ehGestor(); }   // so quem tem a tag de gestor ve nota/renda de todas e responde a fila (dev sem a tag e vendedor comum)
    function restrito() { return !veTudo(); }
    function fbKeyDe(uid) { return 'cs' + String(uid).replace(/-/g, ''); }
    function pedNorm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
    function pedNovoId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
    function ehDono(vendedor) { var me = usuarioAtual(); return !vendedor || !me || vendedor === me; }

    function pedProdutos(p) {
        var o = (p && p.produtos) || {}, arr = [];
        Object.keys(o).forEach(function (k) { var x = o[k]; if (x && typeof x === 'object') { x.pid = k; arr.push(x); } });
        arr.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
        return arr;
    }
    function pedAguardando(p) { return pedProdutos(p).filter(function (x) { return x.estado === 'aguardando'; }); }
    function pedAprovados(p) { return pedProdutos(p).filter(function (x) { return x.estado === 'aprovado' || x.estado === 'liberado'; }); }
    function pedRespGestor(p) { return pedProdutos(p).some(function (x) { return x.origem === 'gestor' && (x.estado === 'aprovado' || x.estado === 'recusado'); }); }
    function pedAtivo(p) { return !!p && p.fase === 'ativo'; }

    // Quando: "hoje às 15:05" / "26/11 às 15:05"
    function pedQuando(ts) {
        if (!ts) return '';
        var d = new Date(ts), hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        var hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return (ts >= hoje.getTime() ? 'hoje' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })) + ' às ' + hm;
    }
    function pedEspera(ts) {
        var m = Math.max(0, Math.floor((Date.now() - (ts || Date.now())) / 60000));
        if (m < 1) return 'agora';
        if (m < 60) return 'há ' + m + ' min';
        var h = Math.floor(m / 60);
        if (h < 24) return 'há ' + h + ' h';
        var dd = Math.floor(h / 24);
        return 'há ' + dd + (dd > 1 ? ' dias' : ' dia');
    }
    function pedCorEspera(ts) {
        var m = (Date.now() - (ts || Date.now())) / 60000;
        return m >= 1440 ? 'bad' : m >= 60 ? 'warn' : 'ok';
    }

    // ── "Nova" do vendedor: resposta do gestor que ele ainda nao abriu (lembrada no aparelho) ──
    function pedVistoLer() { return lsLer(PED_VISTO_LS, {}); }
    function pedMarcarVisto(key) {
        var p = _ped[key]; if (!p || !p.tsResp) return;
        var v = pedVistoLer(); v[key] = p.tsResp;
        var ks = Object.keys(v); if (ks.length > 200) ks.slice(0, ks.length - 200).forEach(function (k) { delete v[k]; });
        lsGravar(PED_VISTO_LS, v);
    }
    function pedNova(key) {
        var p = _ped[key];
        return !!(p && p.tsResp && restrito() && ehDono(p.vendedor) && p.tsResp > (pedVistoLer()[key] || 0));
    }

    // Situacao do pedido para o cartao da lista do vendedor
    function pedStatus(key) {
        var p = _ped[key];
        if (p && p.fase === 'analisando') return { txt: 'Preparando o pedido', cls: 'warn', ico: 'bi-hourglass-split' };
        if (!pedAtivo(p) || !pedProdutos(p).length) return { txt: 'Concluída · escolha o produto', cls: 'warn', ico: 'bi-phone' };
        var prods = pedProdutos(p);
        if (pedAguardando(p).length) return { txt: 'Aguardando o gestor', cls: 'warn', ico: 'bi-hourglass-split' };
        if (prods.every(function (x) { return x.estado === 'recusado'; })) return { txt: 'Não aprovado pelo gestor', cls: 'bad', ico: 'bi-x-lg' };
        if (pedRespGestor(p)) return { txt: 'Gestor respondeu', cls: 'ok', ico: 'bi-check-lg' };
        return { txt: 'Resposta pronta', cls: 'ok', ico: 'bi-check-lg' };
    }
    // O que o gestor ve a mais no cartao da lista
    function pedSufixoGestor(key) {
        var p = _ped[key]; if (!pedAtivo(p)) return '';
        if (pedAguardando(p).length) return ' · com o gestor';
        if (pedRespGestor(p)) return ' · respondido';
        return '';
    }

    // ── Classificacao de um produto: na lista (e renda ok) responde sozinho; senao vai para o gestor ──
    function pedClassificar(nome, apId, renda) {
        var alvo = pedNorm(nome), ap = null;
        (_aps || []).forEach(function (a) { if (!ap && a.ativo && ((apId && a.id === apId) || (alvo && pedNorm(a.nome) === alvo))) ap = a; });
        var x = { nome: ap ? ap.nome : String(nome || '').replace(/\s+/g, ' ').trim().slice(0, 80), apId: ap ? ap.id : null, ts: Date.now(), obs: null };
        if (ap && ap.rendaMin <= (Number(renda) || 0) + 0.005) {
            x.estado = 'liberado'; x.origem = 'lista'; x.entrada = ap.entrada; x.parcelas = ap.parcelas; x.parcela = ap.parcela;
        } else {
            x.estado = 'aguardando'; x.origem = null;
            if (ap) x.obs = 'Está na lista, mas pede renda a partir de ' + apRs(ap.rendaMin);
        }
        return x;
    }
    function pedNaLista(nome, apId) {
        var alvo = pedNorm(nome), achou = false;
        (_aps || []).forEach(function (a) { if (a.ativo && ((apId && a.id === apId) || (alvo && pedNorm(a.nome) === alvo))) achou = true; });
        return achou;
    }

    // ── Banco ──
    function pedTransacao(key, fn) {
        return apFB().then(function (c) { return c.fb.runTransaction(c.fb.ref(c.db, PED_PATH + '/' + key), fn); });
    }
    function pedEsperarLeitura() {
        return new Promise(function (resolve) {
            var fim = Date.now() + 10000;
            (function tick() { if (_pedLido || Date.now() >= fim) return resolve(); setTimeout(tick, 250); })();
        });
    }

    function pedMetaDados(job) {
        var d = job.dados || {};
        var resumo = d.reprovado ? '' : String(d.resumoExec || d.rascunho || job.resumoReg || '').replace(/\s+/g, ' ').trim().slice(0, 300);
        return {
            nome: String(d.nomeCompleto || nomeDoJob(job) || 'Cliente').slice(0, 80),
            nota: Math.round(Number(d.nota) || 0), renda: Number(d.rendaEstimada) || 0,
            resumo: resumo, tel: job.tel || '', vendedor: job.usuario || ''
        };
    }

    // No envio: guarda o pedido (produtos ainda "analisando"). A chave e a mesma do historico, entao qualquer aparelho que
    // termine a analise sabe qual pedido fechar.
    function pedCriarNoEnvio(job) {
        var prods = job.produtos || [];
        if (!prods.length || !job.uid) return;
        var key = fbKeyDe(job.uid), now = Date.now(), obj = {};
        prods.forEach(function (x) { obj[pedNovoId()] = { nome: x.nome, apId: x.apId || null, estado: 'analisando', ts: now }; });
        apFB().then(function (c) {
            return c.fb.set(c.fb.ref(c.db, PED_PATH + '/' + key), {
                fase: 'analisando', vendedor: job.usuario || usuarioAtual() || '', tel: job.tel || null, nome: job.nome || null,
                ts: now, tsAtual: now, expira: now + HIST_DAYS * 86400000, produtos: obj
            });
        }).catch(function (e) { console.warn('[CreditoScan] nao consegui guardar o pedido:', e); });
    }

    // A analise terminou: reprovada apaga o pedido (o vendedor ve o motivo na propria analise); aprovada classifica cada produto
    async function pedFinalizar(job) {
        try {
            var d = job.dados, key = job.fbKey || (job.uid ? fbKeyDe(job.uid) : '');
            if (!d || !key) return;
            await pedEsperarLeitura();
            if (!_ped[key] || _ped[key].fase !== 'analisando') return;   // sem produtos no envio (ou outro aparelho ja fechou)
            await apCarregar(false);
            var meta = pedMetaDados(job), now = Date.now();
            await pedTransacao(key, function (at) {
                if (!at || at.fase !== 'analisando') return;
                if (d.reprovado) return null;
                var prods = at.produtos || {}, novo = {};
                Object.keys(prods).forEach(function (k) {
                    var x = pedClassificar(prods[k].nome, prods[k].apId, meta.renda);
                    x.ts = prods[k].ts || now; novo[k] = x;
                });
                at.fase = 'ativo'; at.nome = meta.nome; at.nota = meta.nota; at.renda = meta.renda; at.resumo = meta.resumo || null;
                at.tel = at.tel || meta.tel || null; at.tsAtual = now; at.produtos = novo;
                return at;
            });
        } catch (e) { console.warn('[CreditoScan] pedido: nao consegui fechar a analise:', e); }
    }

    // Analise cancelada/descartada antes de terminar: o pedido nao tem mais o que esperar
    function pedCancelar(job) {
        var key = job && job.uid ? fbKeyDe(job.uid) : '';
        if (!key || !_ped[key] || _ped[key].fase !== 'analisando') return;
        pedTransacao(key, function (at) { return at && at.fase === 'analisando' ? null : undefined; }).catch(function () {});
    }

    // Vendedor pede produto(s): cria o pedido se a analise ainda nao tem um
    async function pedAdicionar(key, meta, itens) {
        await apCarregar(false);
        var now = Date.now(), ignorados = 0;
        var r = await pedTransacao(key, function (at) {
            ignorados = 0;
            if (!at) {
                if (!meta) return;
                at = { fase: 'ativo', nome: meta.nome, nota: meta.nota, renda: meta.renda, resumo: meta.resumo || null, vendedor: meta.vendedor || usuarioAtual() || '',
                    tel: meta.tel || null, ts: now, expira: now + HIST_DAYS * 86400000, produtos: {} };
            }
            var prods = at.produtos || {}, tem = {};
            Object.keys(prods).forEach(function (k) { var x = prods[k]; if (x && x.estado !== 'recusado') tem[pedNorm(x.nome)] = 1; });
            itens.forEach(function (it) {
                var n = pedNorm(it.nome);
                if (!n || tem[n]) { ignorados++; return; }
                tem[n] = 1;
                prods[pedNovoId()] = at.fase === 'analisando' ? { nome: it.nome, apId: it.apId || null, estado: 'analisando', ts: now } : pedClassificar(it.nome, it.apId, at.renda);
            });
            at.produtos = prods; at.tsAtual = now;
            return at;
        });
        return { ok: !!(r && r.committed), ignorados: ignorados };
    }

    async function pedRemoverProduto(key, pid) {
        await pedTransacao(key, function (at) {
            if (!at || !at.produtos || !at.produtos[pid] || at.produtos[pid].estado !== 'aguardando') return;   // ja respondido: nao tira
            delete at.produtos[pid]; at.tsAtual = Date.now();
            return at;
        });
    }

    // Gestor responde: so produto que ainda esta "aguardando" (se outro gestor respondeu antes, nao sobrescreve)
    async function pedResponder(key, resp) {
        var now = Date.now(), quem = usuarioAtual(), conflitos = 0, aplicados = 0;
        var r = await pedTransacao(key, function (at) {
            conflitos = 0; aplicados = 0;
            if (!at || !at.produtos) return;
            Object.keys(resp).forEach(function (pid) {
                var x = at.produtos[pid], f = resp[pid];
                if (!x || x.estado !== 'aguardando') { conflitos++; return; }
                if (f.dec === 'aprovar') { x.estado = 'aprovado'; x.entrada = f.entrada; x.parcelas = f.parcelas; x.parcela = f.parcela; x.motivo = null; }
                else { x.estado = 'recusado'; x.motivo = f.motivo || null; x.entrada = null; x.parcelas = null; x.parcela = null; }
                x.origem = 'gestor'; x.tsResp = now; x.gestor = quem || null;
                aplicados++;
            });
            if (!aplicados) return;
            at.tsResp = now; at.tsAtual = now;
            return at;
        });
        return { ok: !!(r && r.committed), conflitos: conflitos, aplicados: aplicados };
    }

    // ── Leitura em tempo real + avisos ──
    function pedIniciar() {
        if (_pedIniciado) return;
        _pedIniciado = true;
        esperarFirebase(20000).then(apFB).then(function (c) {
            c.fb.onValue(c.fb.ref(c.db, PED_PATH), function (snap) { pedRecebeu(snap.val() || {}); },
                function (e) { console.warn('[CreditoScan] pedidos: leitura recusada:', e); });
        }).catch(function () { _pedIniciado = false; });
    }

    function pedRecebeu(novo) {
        var antes = _ped, primeira = !_pedLido;
        _ped = novo; _pedLido = true;
        if (primeira) { if (veTudo()) pedLimparExpirados(); }
        else pedAvisar(antes, novo);
        atualizarBadge(); renderLista();
        if (el('cs_fila_ov') && el('cs_fila_ov').classList.contains('active')) filaRender();
        if (_pedKey && el('cs_ped_ov') && el('cs_ped_ov').classList.contains('active') && !_pedEnviando &&
            JSON.stringify(antes[_pedKey] || null) !== JSON.stringify(novo[_pedKey] || null)) pedRender();
    }

    function pedLimparExpirados() {
        var agora = Date.now(), velhos = Object.keys(_ped).filter(function (k) { return _ped[k] && _ped[k].expira && _ped[k].expira < agora; });
        if (!velhos.length) return;
        apFB().then(function (c) { velhos.forEach(function (k) { c.fb.remove(c.fb.ref(c.db, PED_PATH + '/' + k)).catch(function () {}); }); }).catch(function () {});
    }

    function pedAvisar(antes, novo) {
        Object.keys(novo).forEach(function (key) {
            var p = novo[key], a = antes[key];
            if (!pedAtivo(p)) return;
            var ag = {}; pedAguardando(a).forEach(function (x) { ag[x.pid] = 1; });
            if (veTudo()) {
                var novos = pedAguardando(p).filter(function (x) { return !ag[x.pid]; });
                if (novos.length) pedBanner(key, 'gestor', 'Pedido novo para o gestor', (p.nome || 'Cliente') + ' · ' + novos.map(function (x) { return x.nome; }).join(', '), 'Responder');
            }
            if (ehDono(p.vendedor) && p.vendedor) {   // perfil e vendedor E gestor: avisa quando OUTRO gestor responde o pedido dele (a propria resposta nao precisa de aviso)
                var eu = usuarioAtual();
                var respondidos = pedProdutos(p).filter(function (x) { return ag[x.pid] && (x.estado === 'aprovado' || x.estado === 'recusado') && !(veTudo() && x.gestor && x.gestor === eu); });
                if (respondidos.length) pedBanner(key, 'vend', 'O gestor respondeu', (p.nome || 'Cliente') + ' · ' + respondidos.map(function (x) { return x.nome; }).join(', '), 'Ver resposta');
            }
        });
    }

    function pedBanner(key, tipo, titulo, sub, btn) {
        var box = caixaAvisos(), id = 'p:' + key;
        removerBanner(id);
        var div = document.createElement('div');
        div.className = 'cs-banner ' + (tipo === 'gestor' ? 'warn' : 'ok'); div.setAttribute('data-job', id);
        div.innerHTML =
            '<div class="cs-banner-top"><span class="cs-banner-ico"><i class="bi ' + (tipo === 'gestor' ? 'bi-hourglass-split' : 'bi-check-lg') + '"></i></span>' +
            '<div class="cs-banner-txt"><strong>' + esc(titulo) + '</strong><span>' + esc(sub) + '</span></div>' +
            '<button type="button" class="cs-banner-x" data-bact="x" data-id="' + esc(id) + '" aria-label="Dispensar"><i class="bi bi-x-lg"></i></button></div>' +
            '<button type="button" class="cs-btn cs-btn-pri" data-bact="pver" data-id="' + esc(id) + '">' + esc(btn) + '</button>';
        box.appendChild(div);
        notificarSistema(titulo, sub, 'creditoscan-ped-' + key);
    }

    function pedPendentes() {
        var lista = [];
        Object.keys(_ped).forEach(function (k) {
            var p = _ped[k], ag = pedAguardando(p);
            if (pedAtivo(p) && ag.length) lista.push({ key: k, p: p, t: Math.min.apply(null, ag.map(function (x) { return x.ts || p.ts || 0; })) });
        });
        lista.sort(function (a, b) { return a.t - b.t; });
        return lista;
    }
    function pedRespondidos() {
        var lista = [];
        Object.keys(_ped).forEach(function (k) {
            var p = _ped[k];
            if (pedAtivo(p) && !pedAguardando(p).length && pedRespGestor(p)) lista.push({ key: k, p: p, t: p.tsResp || p.tsAtual || 0 });
        });
        lista.sort(function (a, b) { return b.t - a.t; });
        return lista;
    }
    // Numero do selo: gestor = pedidos esperando; vendedor = respostas novas do gestor
    function pedBadgeN() {
        if (veTudo()) return pedPendentes().length;
        return Object.keys(_ped).filter(pedNova).length;
    }

    // ── Cartao da lista para quem NAO ve a nota ──
    // Aprovada: so o andamento do pedido. Reprovada: a nota aparece so na propria analise, na aba "Meus". Analise de outro: so status, sem abrir.
    function cardRestrito(o) {
        var meu = ehDono(o.dono), mostraNota = o.reprovado && meu && filtroUsuario() === 'meus', c, sub, anel;
        if (o.reprovado) {
            c = 'bad'; sub = 'Reprovado' + (meu && o.extra ? o.extra : ''); anel = mostraNota ? o.nota : '<i class="bi bi-x-lg"></i>';
        } else {
            var st = pedStatus(o.key); c = st.cls; sub = st.txt; anel = '<i class="bi ' + st.ico + '"></i>';
        }
        var nova = meu && (o.nova || pedNova(o.key));
        var info = '<span class="cs-ring-sm ' + c + '">' + anel + '</span>' +
            '<span class="cs-job-info"><span class="cs-job-nome">' + esc(o.nome) + tagUsuario(o.dono) + '</span><span class="cs-job-sub ' + c + '">' + esc(sub) + '</span></span>';
        if (!meu) return '<div class="cs-card cs-pronta cs-ro">' + info + '</div>';
        return '<button type="button" class="cs-card cs-pronta" data-act="' + o.act + '" ' + o.attr + '>' + info +
            (nova ? '<span class="cs-tag-nova">Nova</span>' : '<i class="bi bi-chevron-right cs-chev"></i>') + '</button>';
    }

    // Abrir uma analise: o vendedor so abre as proprias; aprovada abre o pedido (sem nota), reprovada abre o resultado normal
    function pedInterceptar(job) {
        var dono = job.usuario || '';
        if (!ehDono(dono)) { avisar('Esta análise é de outro vendedor. Só o gestor vê o resultado dela.'); return true; }
        if (job.dados.reprovado) return false;
        job.visto = true; hojeMarcarVisto(job.fbKey); removerBanner(job.id);
        var kp = job.fbKey || (job.uid ? fbKeyDe(job.uid) : '');
        if (_ped[kp] && _ped[kp].fase === 'analisando') pedFinalizar(job);   // pedido que ficou preso (outro aparelho/sem rede): fecha agora
        pedAbrir(job.fbKey || (job.uid ? fbKeyDe(job.uid) : ''), pedMetaDados(job));
        return true;
    }

    // ── Seletor de produtos (tela "Nova analise" e tela do pedido) ──
    function ppHtml(ctx) {
        return '<div class="cs-pp" data-ctx="' + ctx + '"><div class="cs-pp-top" id="cs_pp_top_' + ctx + '"></div>' +
            '<div class="cs-pp-row"><input id="cs_pp_in_' + ctx + '" class="cs-in" type="text" autocomplete="off" maxlength="80" placeholder="Outro produto, fora da lista (ex.: Redmi Note 14 Pro)" aria-label="Produto">' +
            '<button type="button" class="cs-btn cs-btn-sec cs-btn-sm" data-act="pp-add" data-ctx="' + ctx + '"><i class="bi bi-plus-lg"></i></button></div>' +
            '<div class="cs-pp-sug" id="cs_pp_sug_' + ctx + '"></div></div>';
    }
    function ppTop(ctx) {
        var box = el('cs_pp_top_' + ctx); if (!box) return;
        var sel = _ppSel[ctx], jaTem = {}, h = '';
        sel.forEach(function (x) { jaTem[pedNorm(x.nome)] = 1; });
        if (sel.length) {
            h += '<div class="cs-pp-sel">' + sel.map(function (x, i) {
                var na = pedNaLista(x.nome, x.apId);
                return '<span class="cs-pp-tag' + (na ? '' : ' fora') + '"><span><b>' + esc(x.nome) + '</b><small>' + (na ? 'Na lista' : 'Fora da lista · vai para o gestor') + '</small></span>' +
                    '<button type="button" data-act="pp-del" data-ctx="' + ctx + '" data-i="' + i + '" aria-label="Tirar"><i class="bi bi-x-lg"></i></button></span>';
            }).join('') + '</div>';
        }
        var lib = (_aps || []).filter(function (a) { return a.ativo && !jaTem[pedNorm(a.nome)]; });
        if (lib.length) {
            h += '<div class="cs-pp-lab">iPhones seminovos · escolha um ou mais</div><div class="cs-pp-chips">' + lib.map(function (a) {
                return '<button type="button" class="cs-pp-chip" data-act="pp-chip" data-ctx="' + ctx + '" data-id="' + esc(a.id) + '">+ ' + esc(a.nome) + '</button>';
            }).join('') + '</div>';
        }
        box.innerHTML = h;
    }
    function ppAdicionar(ctx, nome, apId) {
        nome = String(nome || '').replace(/\s+/g, ' ').trim();
        if (!nome) return false;
        var n = pedNorm(nome);
        if (_ppSel[ctx].some(function (x) { return pedNorm(x.nome) === n; })) { avisar('Esse produto já está na lista.'); return false; }
        if (_ppSel[ctx].length >= PED_MAX_PROD) { avisar('No máximo ' + PED_MAX_PROD + ' produtos por vez.'); return false; }
        _ppSel[ctx].push({ nome: nome.slice(0, 80), apId: apId || null });
        return true;
    }
    function ppAcao(e) {
        var b = e.target.closest('[data-act]'); if (!b) return false;
        var a = b.getAttribute('data-act'), ctx = b.getAttribute('data-ctx');
        if (a.indexOf('pp-') !== 0) return false;
        if (a === 'pp-chip') {
            var id = b.getAttribute('data-id'), ap = null; (_aps || []).forEach(function (x) { if (x.id === id) ap = x; });
            if (ap && ppAdicionar(ctx, ap.nome, ap.id)) { ppTop(ctx); ppAtualizarBotao(ctx); }
        } else if (a === 'pp-del') {
            _ppSel[ctx].splice(parseInt(b.getAttribute('data-i'), 10), 1); ppTop(ctx); ppAtualizarBotao(ctx);
        } else if (a === 'pp-add') {
            var inp = el('cs_pp_in_' + ctx);
            if (inp && ppAdicionar(ctx, inp.value)) { inp.value = ''; var sg = el('cs_pp_sug_' + ctx); if (sg) sg.innerHTML = ''; ppTop(ctx); ppAtualizarBotao(ctx); }
        } else if (a === 'pp-sug') {
            var s = _ppSug[ctx][parseInt(b.getAttribute('data-i'), 10)];
            if (s && ppAdicionar(ctx, s.nome)) { var i2 = el('cs_pp_in_' + ctx); if (i2) i2.value = ''; var sg2 = el('cs_pp_sug_' + ctx); if (sg2) sg2.innerHTML = ''; ppTop(ctx); ppAtualizarBotao(ctx); }
        }
        return true;
    }
    function ppDigitou(e) {
        var t = e.target; if (!t || !t.id || t.id.indexOf('cs_pp_in_') !== 0) return false;
        var ctx = t.id.slice(9), box = el('cs_pp_sug_' + ctx); if (!box) return true;
        if (ctx === 'f') renderRascunho();
        var termo = String(t.value || '').trim();
        _ppSug[ctx] = [];
        if (termo.length < 2) { box.innerHTML = ''; return true; }
        var r = buscarCatalogo(termo);
        if (!r || !r.length) { box.innerHTML = ''; return true; }
        _ppSug[ctx] = r;
        box.innerHTML = r.slice(0, 5).map(function (p, i) { return '<button type="button" class="cs-sug-row" data-act="pp-sug" data-ctx="' + ctx + '" data-i="' + i + '"><span>' + esc(p.nome) + '</span></button>'; }).join('');
        return true;
    }
    function ppEnter(e) {
        if (e.key !== 'Enter' || !e.target || !e.target.id || e.target.id.indexOf('cs_pp_in_') !== 0) return false;
        e.preventDefault();
        var ctx = e.target.id.slice(9);
        if (ppAdicionar(ctx, e.target.value)) { e.target.value = ''; var sg = el('cs_pp_sug_' + ctx); if (sg) sg.innerHTML = ''; ppTop(ctx); ppAtualizarBotao(ctx); }
        return true;
    }
    function ppAtualizarBotao(ctx) {
        if (ctx === 'f') { renderRascunho(); return; }
        if (ctx !== 'p') return;
        var b = el('cs_ped_enviar'); if (b) { b.disabled = !_ppSel.p.length; }
    }
    // Se ha texto digitado e ainda nao foi adicionado, entra junto (evita perder o que o vendedor escreveu)
    function ppFecharTexto(ctx) {
        var inp = el('cs_pp_in_' + ctx);
        if (inp && inp.value.trim()) { if (ppAdicionar(ctx, inp.value)) inp.value = ''; }
    }

    // "Nova analise": o card do produto aparece para todos (todo perfil vende); o gestor so ganha a Fila a mais
    function pedFormRender() {
        pedFormToggle();
        ppTop('f'); apCarregar(false).then(function () { ppTop('f'); });
    }
    function pedFormToggle() {
        var bl = el('cs_btn_lote'); if (bl) bl.classList.toggle('cs-h', !ehDevPerfil());   // Lote: discreto, so do dev
        var bf = el('cs_btn_fila');
        if (bf) {
            bf.classList.toggle('cs-h', !veTudo());
            var n = pedPendentes().length, bn = el('cs_fila_n');
            if (bn) { bn.textContent = n || ''; bn.classList.toggle('cs-h', !n); }
        }
    }

    // ── Mensagem de WhatsApp com o que ja esta aprovado (lista + gestor) ──
    function pedMensagem(p) {
        var ok = pedAprovados(p); if (!ok.length) return '';
        var nome = apPrimeiroNome(p.nome), todos = ok.every(function (x) { return apEhIphone(x.nome); });
        var blocos = ok.map(function (x) {
            return apEmoji(x.nome) + ' *' + x.nome + '*\n' +
                '💰 Entrada de ' + R$(x.entrada) + ' à vista\n' +
                '💳 + ' + x.parcelas + 'x de ' + R$(x.parcela) + ' mensais no boleto';
        });
        return 'Olá' + (nome ? ' ' + nome : '') + ', tudo bem? 😊📲\n' +
            'Boa notícia: seu cadastro foi *APROVADO* aqui na Workcell! ✅\n\n' +
            (ok.length > 1 ? 'Separei ' + (todos ? 'os iPhones' : 'os aparelhos') + ' que já estão liberados pra você 👇\n\n' : '') +
            blocos.join('\n\n') + '\n\n' +
            '📌 *Como funciona:* a entrada é paga à vista e o restante vem em parcelas *mensais* no boleto.\n' +
            '✔ Aparelhos revisados e com garantia\n\n' +
            (ok.length > 1 ? 'Qual deles mais te agradou? Me fala aqui que eu já te passo os próximos passos 🤝🚀' : 'Posso já te passar os próximos passos? 🤝🚀');
    }

    // ── Tela do pedido (vendedor e gestor) ──
    function pedAbrir(key, meta) {
        if (!key) return;
        _pedKey = key; _pedMeta = meta || null; _pedAddAberto = false; _pedForm = {}; _ppSel.p = []; _pedEnviando = false;
        openOverlay();
        pedMarcarVisto(key);
        el('cs_ped_ov').classList.add('active');
        pedRender();
        var body = el('cs_ped_body'); if (body) body.scrollTop = 0;
        atualizarBadge(); renderLista();
        if (restrito()) apCarregar(false).then(function () { if (_pedKey === key) ppTop('p'); });
    }
    function pedFechar() {
        var ov = el('cs_ped_ov'); if (ov) ov.classList.remove('active');
        _pedKey = null; _pedMeta = null;
        if (el('cs_fila_ov') && el('cs_fila_ov').classList.contains('active')) filaRender();
        renderLista();
    }

    function pedValoresHtml(x) {
        return '<div class="cs-g-vals"><div><span>Entrada</span><b>' + R$(x.entrada) + '</b></div><div><span>Parcelas</span><b>' + x.parcelas + 'x ' + R$(x.parcela) + '</b></div></div>';
    }
    function pedTag(txt, cls) { return '<span class="cs-g-tag ' + cls + '">' + esc(txt) + '</span>'; }

    function pedRender() {
        var body = el('cs_ped_body'), key = _pedKey; if (!body || !key) return;
        var p = _ped[key];
        var tt = el('cs_ped_ttl'), ss = el('cs_ped_sub');
        if (tt) tt.textContent = (p && p.nome) || (_pedMeta && _pedMeta.nome) || 'Cliente';
        if (veTudo()) { if (ss) ss.textContent = 'Pedido de produtos'; body.innerHTML = pedHtmlGestor(p); pedFormPreencher(); }
        else { if (ss) ss.textContent = 'Produtos do cliente'; body.innerHTML = pedHtmlVendedor(p); ppTop('p'); ppAtualizarBotao('p'); }
    }

    function pedHtmlVendedor(p) {
        var h = '', prods = p ? pedProdutos(p) : [], ag = p ? pedAguardando(p) : [];
        if (p && p.fase === 'analisando') {
            h += '<div class="cs-g-banner warn"><i class="bi bi-hourglass-split"></i><div><b>Analisando</b><span>Os produtos entram na avaliação assim que a análise terminar.</span></div></div>';
        } else if (ag.length) {
            h += '<div class="cs-g-banner warn"><i class="bi bi-hourglass-split"></i><div><b>Aguardando o gestor</b><span>' + ag.length + (ag.length > 1 ? ' produtos' : ' produto') + ' · ' + pedEspera(Math.min.apply(null, ag.map(function (x) { return x.ts || 0; }))) + '</span></div></div>';
        } else if (p && pedRespGestor(p)) {
            h += '<div class="cs-g-banner ok"><i class="bi bi-check-lg"></i><div><b>O gestor respondeu</b><span>' + esc(pedQuando(p.tsResp)) + '</span></div></div>';
        }
        prods.forEach(function (x) {
            var tag, corpo = '', cls = '';
            if (x.estado === 'liberado') { tag = pedTag('Liberado', 'ok'); corpo = pedValoresHtml(x); }
            else if (x.estado === 'aprovado') { tag = pedTag('Aprovado', 'ok'); corpo = pedValoresHtml(x); }
            else if (x.estado === 'recusado') {
                tag = pedTag('Não aprovado', 'bad'); cls = ' recusado';
                corpo = '<span class="cs-g-note">' + (x.motivo ? 'Motivo do gestor: ' + esc(x.motivo) : 'O gestor não aprovou este aparelho.') + '</span>';
            } else if (x.estado === 'aguardando') {
                tag = pedTag('Com o gestor', 'warn');
                corpo = '<span class="cs-g-note">Você recebe um aviso quando ele responder.</span>' +
                    '<button type="button" class="cs-link bad" data-act="ped-rem" data-pid="' + esc(x.pid) + '">Cancelar este produto</button>';
            } else { tag = pedTag('Analisando', 'warn'); corpo = '<span class="cs-g-note">Entra na avaliação quando a análise terminar.</span>'; }
            h += '<div class="cs-card cs-g-prod' + cls + '"><div class="cs-g-prod-h"><b>' + esc(x.nome) + '</b>' + tag + '</div>' + corpo + '</div>';
        });
        var msg = p ? pedMensagem(p) : '';
        if (msg) {
            h += '<div class="cs-card cs-g-wpp"><span class="cs-lab">Mensagem para o cliente</span>' +
                '<div class="cs-wpp-txt" style="cursor:default">' + blocoTexto(msg).replace(/\*([^*\n<]+)\*/g, '<b>$1</b>') + '</div>' +
                '<div class="cs-ap-btns"><button type="button" class="cs-btn cs-btn-pri" data-act="ped-copy"><i class="bi bi-clipboard"></i> Copiar texto do WhatsApp</button>' +
                '<button type="button" class="cs-btn cs-btn-ghost" data-act="ped-wpp"><i class="bi bi-whatsapp"></i> WhatsApp</button></div></div>';
        }
        if (!prods.length || _pedAddAberto) {
            h += '<div class="cs-card cs-g-add"><div class="cs-up-h"><i class="bi bi-phone"></i><b>' + (prods.length ? 'Outro produto' : 'Qual produto o cliente quer?') + '</b></div>' +
                '<div class="cs-hint left">Produto da lista responde sozinho. Os outros vão para o gestor.</div>' + ppHtml('p') +
                '<button type="button" class="cs-btn cs-btn-pri" id="cs_ped_enviar" data-act="ped-enviar" disabled><i class="bi bi-check2-circle"></i> Enviar pedido</button>' +
                (prods.length ? '<button type="button" class="cs-link" data-act="ped-addfechar">Fechar</button>' : '') + '</div>';
        } else if (p && p.fase !== 'analisando') {
            h += '<button type="button" class="cs-g-addbtn" data-act="ped-addabrir">+ Pedir outro produto</button>';
        }
        return h;
    }

    // Gestor: resumo da analise + um bloco por produto
    function pedHtmlGestor(p) {
        if (!p) return '<p class="cs-hint">Este pedido não existe mais (expira em ' + HIST_DAYS + ' dias).</p>';
        var prods = pedProdutos(p), h = '';
        var corN = p.nota >= 60 ? 'ok' : p.nota > NOTA_REPROVA ? 'warn' : 'bad';
        h += '<div class="cs-card cs-g-sum"><div class="cs-g-sum-n"><div><span>Nota</span><b class="' + corN + '">' + esc(p.nota != null ? p.nota : '—') + '</b></div>' +
            '<div class="w"><span>Renda considerada</span><b>' + (p.renda > 0 ? R$(p.renda) : '—') + '</b></div></div>' +
            (p.resumo ? '<span class="cs-g-note">' + esc(p.resumo) + '</span>' : '') +
            '<div class="cs-g-sum-f"><span>Vendedor: <b>' + esc(p.vendedor || '—') + '</b></span><button type="button" class="cs-link" data-act="ped-analise">Ver análise completa</button></div></div>';
        prods.forEach(function (x) {
            if (x.estado === 'aguardando') {
                var f = _pedForm[x.pid] || (_pedForm[x.pid] = { dec: 'aprovar', entrada: '', parcelas: '', parcela: '', motivo: '' });
                var ap = f.dec === 'aprovar';
                h += '<div class="cs-card cs-g-prod" data-pid="' + esc(x.pid) + '"><div class="cs-g-prod-h"><b>' + esc(x.nome) + '</b></div>' +
                    (x.obs ? '<span class="cs-g-note">' + esc(x.obs) + '</span>' : '<span class="cs-g-note">Fora da lista de aparelhos liberados.</span>') +
                    '<div class="cs-g-seg"><button type="button" class="' + (ap ? 'on ok' : '') + '" data-act="ped-dec" data-pid="' + esc(x.pid) + '" data-v="aprovar">Aprovar</button>' +
                    '<button type="button" class="' + (!ap ? 'on bad' : '') + '" data-act="ped-dec" data-pid="' + esc(x.pid) + '" data-v="recusar">Recusar</button></div>';
                if (ap) {
                    h += '<div class="cs-g-row"><label class="cs-g-f" style="flex:1.2"><span>Entrada (R$)</span><input class="cs-in" inputmode="decimal" autocomplete="off" placeholder="500,00" data-f="entrada" data-pid="' + esc(x.pid) + '" value="' + esc(f.entrada) + '"></label>' +
                        '<label class="cs-g-f" style="flex:.8"><span>Parcelas</span><input class="cs-in" inputmode="numeric" autocomplete="off" placeholder="12" data-f="parcelas" data-pid="' + esc(x.pid) + '" value="' + esc(f.parcelas) + '"></label></div>' +
                        '<label class="cs-g-f"><span>Valor de cada parcela (R$)</span><input class="cs-in" inputmode="decimal" autocomplete="off" placeholder="189,90" data-f="parcela" data-pid="' + esc(x.pid) + '" value="' + esc(f.parcela) + '"></label>';
                } else {
                    h += '<label class="cs-g-f"><span>Motivo (opcional)</span><input class="cs-in" type="text" maxlength="160" autocomplete="off" placeholder="Ex.: passa do que o perfil do cliente comporta" data-f="motivo" data-pid="' + esc(x.pid) + '" value="' + esc(f.motivo) + '"></label>';
                }
                h += '<div class="cs-g-err" id="cs_pf_err_' + esc(x.pid) + '"></div></div>';
            } else {
                var tag = x.estado === 'recusado' ? pedTag('Recusado', 'bad') : pedTag(x.origem === 'lista' ? 'Liberado pela lista' : 'Aprovado', 'ok');
                var corpo = x.estado === 'recusado' ? '<span class="cs-g-note">' + (x.motivo ? 'Motivo: ' + esc(x.motivo) : 'Sem motivo informado.') + '</span>' : pedValoresHtml(x);
                h += '<div class="cs-card cs-g-prod' + (x.estado === 'recusado' ? ' recusado' : '') + '"><div class="cs-g-prod-h"><b>' + esc(x.nome) + '</b>' + tag + '</div>' + corpo +
                    (x.origem === 'gestor' ? '<span class="cs-g-note">Respondido por ' + esc(x.gestor || 'gestor') + ' · ' + esc(pedQuando(x.tsResp)) + '</span>' : '') + '</div>';
            }
        });
        if (pedAguardando(p).length) {
            h += '<div class="cs-g-info"><i class="bi bi-info-circle"></i><span>Vale exatamente o que você digitar: o sistema não calcula juros aqui.</span></div>' +
                '<button type="button" class="cs-btn cs-btn-pri cs-btn-big" id="cs_ped_resp" data-act="ped-resp"><i class="bi bi-check2-circle"></i> Enviar resposta ao vendedor</button>';
        }
        return h;
    }
    function pedFormPreencher() { /* os campos ja saem com o valor guardado em _pedForm */ }

    function pedNum(v) { var n = numBR(v); return isFinite(n) ? n : NaN; }

    async function pedEnviarResposta() {
        var key = _pedKey, p = _ped[key]; if (!p || _pedEnviando) return;
        var resp = {}, erro = false, primeiro = null;
        pedAguardando(p).forEach(function (x) {
            var f = _pedForm[x.pid] || { dec: 'aprovar' }, msg = '';
            if (f.dec === 'aprovar') {
                var en = pedNum(f.entrada), np = parseInt(f.parcelas, 10), pc = pedNum(f.parcela);
                if (!String(f.entrada || '').trim() || !isFinite(en) || en < 0) msg = 'Informe a entrada (pode ser 0).';
                else if (!(np >= 1 && np <= 36)) msg = 'Informe o número de parcelas (1 a 36).';
                else if (!(pc > 0)) msg = 'Informe o valor de cada parcela.';
                else resp[x.pid] = { dec: 'aprovar', entrada: Math.round(en * 100) / 100, parcelas: np, parcela: Math.round(pc * 100) / 100 };
            } else resp[x.pid] = { dec: 'recusar', motivo: String(f.motivo || '').trim().slice(0, 160) };
            var eb = el('cs_pf_err_' + x.pid); if (eb) eb.textContent = msg;
            if (msg) { erro = true; if (!primeiro) primeiro = x.pid; }
        });
        if (erro) { var bl = document.querySelector('#cs_ped_body [data-pid="' + primeiro + '"]'); if (bl && bl.scrollIntoView) bl.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
        var btn = el('cs_ped_resp'); if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Enviando...'; }
        _pedEnviando = true;
        try {
            var r = await pedResponder(key, resp);
            if (!r.ok && !r.aplicados) throw new Error('nao gravou');
            avisar(r.conflitos ? 'Enviado. ' + r.conflitos + (r.conflitos > 1 ? ' produtos já tinham sido respondidos por outra pessoa.' : ' produto já tinha sido respondido por outra pessoa.') : 'Resposta enviada ao vendedor.');
            _pedForm = {};
        } catch (e) {
            avisar('Não consegui enviar agora. Confira a internet e tente de novo.');
        } finally { _pedEnviando = false; }
        pedRender();
        atualizarBadge();
    }

    async function pedEnviarProdutos() {
        var key = _pedKey; if (!key || _pedEnviando) return;
        ppFecharTexto('p');
        var itens = _ppSel.p.slice(); if (!itens.length) return;
        var btn = el('cs_ped_enviar'); if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Enviando...'; }
        _pedEnviando = true;
        try {
            var r = await pedAdicionar(key, _pedMeta, itens);
            if (!r.ok) throw new Error('nao gravou');
            if (r.ignorados) avisar(r.ignorados === itens.length ? 'Esse produto já está neste pedido.' : 'Alguns produtos já estavam no pedido.');
            _ppSel.p = []; _pedAddAberto = false;
        } catch (e) {
            avisar('Não consegui enviar agora. Confira a internet e tente de novo.');
        } finally { _pedEnviando = false; }
        pedRender();
        atualizarBadge(); renderLista();
    }

    function pedAcao(e) {
        if (ppAcao(e)) return;
        var b = e.target.closest('[data-act]'); if (!b) return;
        var a = b.getAttribute('data-act'), key = _pedKey, p = _ped[key];
        if (a === 'ped-addabrir') { _pedAddAberto = true; _ppSel.p = []; pedRender(); var inp = el('cs_pp_in_p'); if (inp && inp.scrollIntoView) setTimeout(function () { inp.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60); }
        else if (a === 'ped-addfechar') { _pedAddAberto = false; _ppSel.p = []; pedRender(); }
        else if (a === 'ped-enviar') pedEnviarProdutos();
        else if (a === 'ped-rem') {
            pedRemoverProduto(key, b.getAttribute('data-pid')).then(function () { pedRender(); }).catch(function () { avisar('Não consegui cancelar agora. Tente de novo.'); });
        }
        else if (a === 'ped-copy') copiarTexto(pedMensagem(p), b);
        else if (a === 'ped-wpp') { var m = pedMensagem(p); if (m) window.open(linkWhatsapp(p.tel, m), '_blank'); }
        else if (a === 'ped-dec') {
            var f = _pedForm[b.getAttribute('data-pid')]; if (!f) return;
            f.dec = b.getAttribute('data-v'); pedRender();
        }
        else if (a === 'ped-resp') pedEnviarResposta();
        else if (a === 'ped-analise') hojeAbrir(key);
    }
    function pedCampo(e) {
        var t = e.target; if (ppDigitou(e)) return;
        if (!t || !t.getAttribute) return;
        var campo = t.getAttribute('data-f'), pid = t.getAttribute('data-pid');
        if (campo && pid && _pedForm[pid]) _pedForm[pid][campo] = t.value;
    }

    // ── Fila do gestor ──
    function filaAbrir() {
        if (!veTudo()) return;
        var ja = el('cs_ov') && el('cs_ov').classList.contains('active');
        openOverlay();
        _filaRaiz = !ja;
        el('cs_fila_ov').classList.add('active');
        filaRender();
    }
    // Fila fechada pelo botao voltar: se era a primeira tela, sai do CreditoScan; senao volta para a Nova analise
    function filaFechar() {
        el('cs_fila_ov').classList.remove('active');
        if (_filaRaiz) { _filaRaiz = false; closeOverlay(); } else renderLista();
    }
    // "Fazer analise": o gestor sai da Fila e vai para a Nova analise
    function filaParaAnalise() {
        _filaRaiz = false; _formAberto = true;
        el('cs_fila_ov').classList.remove('active');
        aplicarForm(); renderLista();
    }
    function filaRender() {
        var body = el('cs_fila_body'); if (!body) return;
        var pend = pedPendentes(), resp = pedRespondidos(), lista = _pedAba === 'pend' ? pend : resp;
        var h = '<div class="cs-seg"><button type="button" data-act="fila-aba" data-v="pend" class="' + (_pedAba === 'pend' ? 'on' : '') + '">Pendentes' + (pend.length ? ' · ' + pend.length : '') + '</button>' +
            '<button type="button" data-act="fila-aba" data-v="resp" class="' + (_pedAba === 'resp' ? 'on' : '') + '">Respondidos</button></div>' +
            '<p class="cs-hint left">' + (_pedAba === 'pend' ? 'Os mais antigos primeiro. Só entram análises aprovadas com produto fora da lista.' : 'Os mais recentes primeiro. Ficam por ' + HIST_DAYS + ' dias.') + '</p>';
        if (!_pedLido) h += '<p class="cs-hint">Carregando...</p>';
        else if (!lista.length) h += '<p class="cs-hint">' + (_pedAba === 'pend' ? 'Nenhum pedido esperando. 🎉' : 'Nenhum pedido respondido ainda.') + '</p>';
        lista.forEach(function (it) {
            var p = it.p, prods = _pedAba === 'pend' ? pedAguardando(p) : pedProdutos(p).filter(function (x) { return x.origem === 'gestor'; });
            var corN = p.nota >= 60 ? 'ok' : p.nota > NOTA_REPROVA ? 'warn' : 'bad', ce = _pedAba === 'pend' ? pedCorEspera(it.t) : 'ok';
            h += '<button type="button" class="cs-card cs-g-fila ' + ce + '" data-act="fila-abrir" data-key="' + esc(it.key) + '">' +
                '<span class="cs-g-fila-h"><b>' + esc(p.nome || 'Cliente') + '</b><span class="cs-g-tag ' + corN + '">Nota ' + esc(p.nota != null ? p.nota : '—') + '</span></span>' +
                (p.vendedor && ehDono(p.vendedor) ? '<span class="cs-g-fila-p"><i class="bi bi-person-fill"></i><b>Pedido seu</b></span>' : '') +
                prods.map(function (x) {
                    return '<span class="cs-g-fila-p"><i class="bi bi-phone"></i>' + esc(x.nome) + (_pedAba === 'resp' ? ' · ' + (x.estado === 'recusado' ? 'recusado' : 'aprovado') : '') + '</span>';
                }).join('') +
                '<span class="cs-g-fila-f"><span>Vendedor: <b>' + esc(p.vendedor || '—') + '</b></span><span class="' + ce + '">' + (_pedAba === 'pend' ? 'espera ' : 'respondido ') + pedEspera(it.t) + '</span></span></button>';
        });
        body.innerHTML = h;
    }
    function filaAcao(e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var a = b.getAttribute('data-act');
        if (a === 'fila-aba') { _pedAba = b.getAttribute('data-v') === 'resp' ? 'resp' : 'pend'; filaRender(); }
        else if (a === 'fila-abrir') pedAbrir(b.getAttribute('data-key'));
    }

    function init(){injectCSS();injectHTML();injectMenuBtns();wireEvents();apWire();filaIniciar();hojeIniciar();pedIniciar();atualizarBadge();retomarAnalises();wgIniciar();}
    if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}else{init();}
    window._creditoScanOpen=function(){if(veTudo())filaAbrir();else openOverlay();};   // gestor entra direto na Fila (botao "Fazer analise" leva para a Nova analise)
    // Botao voltar do celular: fecha a camada mais de cima do CreditoScan (true = tratou)
    window._creditoScanBack=function(){
        if(upBloqueando())return true;   // enviando documentos ao servidor: o botao voltar nao faz nada
        if(document.querySelector('.cs-modal,#cs_modal_docq'))return true;
        var ids=['cs_lote_ov','cs_cfg_ov','cs_res_ov','cs_ped_ov','cs_fila_ov','cs_hist_ov','cs_ov'];
        for(var i=0;i<ids.length;i++){
            var o=el(ids[i]);
            if(o&&o.classList.contains('active')){if(ids[i]==='cs_res_ov')fecharResultado();else if(ids[i]==='cs_ped_ov')pedFechar();else if(ids[i]==='cs_fila_ov')filaFechar();else o.classList.remove('active');return true;}
        }
        return false;
    };

    // Expõe o motor de IA (mesma chave/modelo do CreditoScan) para outros
    // módulos reaproveitarem — usado pela Garantia (Bookip) com IA.
    window._ctwAiVision = aiCallVision;
    window._ctwAiGetApiKey = getApiKey;
    window._ctwResizeToBase64 = resizeToBase64;
})();

