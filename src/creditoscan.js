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
    var TOL_SOMA_PCT  = 0.05;   // soma lida pela IA x 'Total de creditos' impresso no extrato: tolerancia de 5%
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
'Liste em excluidasDetalhe as MAIORES entradas excluidas (ate 8, mes + valor + motivo curto, ex.: "autotransferencia", "estorno") para o vendedor conferir.\n'+
'Um item por MES CALENDARIO coberto pelos documentos. NUNCA some meses diferentes no mesmo item; mes sem entradas = item com zeros. Informe tambem o periodo coberto em periodoDocumentos (primeira e ultima data dos documentos). Formato de cada item:\n'+
'  {"mes":"AAAA-MM","fixa":0.00,"variavel":0.00,"app":0.00,"excluidas":0.00,"totalCreditos":0.00,"parcial":false}\n'+
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
        var divergentes = [], excl = 0, tot = 0;
        meses.forEach(function (m) {
            var soma = m.fixa + m.variavel + m.app + m.excluidas;
            excl += m.excluidas; tot += soma;
            if (m.totalCreditos > 0) {
                var dif = Math.abs(soma - m.totalCreditos);
                if (dif > Math.max(m.totalCreditos * TOL_SOMA_PCT, 20)) divergentes.push({ mes: m.mes, soma: arred2(soma), total: arred2(m.totalCreditos) });
            }
        });
        var pct = tot > 0 ? excl / tot : 0;
        var det = (Array.isArray(obj && obj.excluidasDetalhe) ? obj.excluidasDetalhe : []).filter(function (e) { return e && typeof e === 'object' && numPos(e.valor) > 0; })
            .map(function (e) { return { mes: String(e.mes || ''), valor: numPos(e.valor), motivo: String(e.motivo || '').slice(0, 60) }; })
            .sort(function (a, b) { return b.valor - a.valor; }).slice(0, 8);
        return { divergentes: divergentes, excluidasTotal: arred2(excl), pctExcluido: pct, excluidasDetalhe: det, duvidosa: divergentes.length > 0 || (tot > 0 && pct > DUVIDOSA_PCT) };
    }

    // ── Calculo da renda ─────────────────────────────────────────────
    // Devolve { renda, fonte:'codigo'|'ia', ... } ou null se nao ha nenhum dado.
    //  - 'codigo': calculado aqui a partir de rendaMeses
    //  - 'ia': a IA nao detalhou os meses; usa o numero que ela deu (formato antigo)
    function calcularRenda(obj) {
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
            var fixa = numPos(m.fixa), variavel = numPos(m.variavel), app = numPos(m.app);
            return {
                mes: String(m.mes || ''), fixa: fixa, variavel: variavel, app: app, excluidas: numPos(m.excluidas),
                totalCreditos: numPos(m.totalCreditos),
                parcial: (function () { var pp = mesParcialPeloPeriodo(m.mes, per); return pp !== null ? pp : (m.parcial === true || m.parcial === 'true'); })(),
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
                divergentes: aud.divergentes, excluidasTotal: aud.excluidasTotal, pctExcluido: aud.pctExcluido, excluidasDetalhe: aud.excluidasDetalhe, duvidosa: true
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
                    divergentes: aud.divergentes, excluidasTotal: aud.excluidasTotal, pctExcluido: aud.pctExcluido, excluidasDetalhe: aud.excluidasDetalhe,
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
            divergentes: aud.divergentes, excluidasTotal: aud.excluidasTotal, pctExcluido: aud.pctExcluido, excluidasDetalhe: aud.excluidasDetalhe,
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
    // Classifica UMA entrada pelas mesmas regras do prompt. Devolve { g: 'fixa'|'variavel'|'app'|'excluidas', motivo }
    function nuClassificar(txt, titular, cpfMeio) {
        var u = nuSemAcento(txt);
        if (/^RESGATE (RDB|DE |CDB|INVEST)|^RESGATE/.test(u)) return { g: 'excluidas', motivo: 'resgate RDB' };
        if (/^(REEMBOLSO|ESTORNO|DEVOLUCAO)/.test(u)) return { g: 'excluidas', motivo: u.indexOf('ESTORNO') === 0 ? 'estorno' : 'reembolso' };
        if (/^(RENDIMENTO|JUROS|CASHBACK)/.test(u)) return { g: 'excluidas', motivo: 'rendimento' };
        if (/^CREDITO EM CONTA/.test(u)) return { g: 'excluidas', motivo: 'crédito em conta sem origem' };
        if (/EMPRESTIMO|FINANCIAMENTO|CONSIGNADO|ANTECIPACAO|SAQUE.ANIVERSARIO/.test(u)) return { g: 'excluidas', motivo: 'empréstimo' };
        if ((titular && u.indexOf(titular) !== -1) || (cpfMeio && u.indexOf(cpfMeio) !== -1)) return { g: 'excluidas', motivo: 'autotransferência' };
        if (/\b(UBER|99 ?TECNOLOGIA|99 ?POP|INDRIVER|IFOOD|RAPPI|LOGGI)\b/.test(u)) return { g: 'app', motivo: '' };
        if (/SALARIO|PROVENTOS|FOLHA DE PAG|\bINSS\b|APOSENTADORIA|PENSAO|BENEFICIO/.test(u)) return { g: 'fixa', motivo: '' };
        return { g: 'variavel', motivo: '' };
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
        var totMes = null, per = null, pm = /Total de entradas \+(\d[\d.]*,\d{2})/.exec(texto.replace(/\s+/g, ' '));
        if (pm) totMes = nuValor(pm[1]);
        if (totMes === null) {   // no texto do app os valores do resumo vem em linhas separadas, na ordem: saldo inicial, rendimento (+), entradas (+), saidas (-)
            for (var j = ini; j < Math.min(linhas.length - 2, ini + 40); j++) {
                var ra = /^\+(\d[\d.]*,\d{2})$/.exec(linhas[j]), rb = /^\+(\d[\d.]*,\d{2})$/.exec(linhas[j + 1]);
                if (ra && rb && /^-\d[\d.]*,\d{2}$/.test(linhas[j + 2])) { totMes = nuValor(rb[1]); break; }
            }
        }
        var datas = [], rd = /(\d{1,2}) DE ([A-ZÇ]+) DE (\d{4})/g, md;
        while ((md = rd.exec(nuSemAcento(texto))) && datas.length < 2) { var mn = NU_MES_NOME[md[2]]; if (mn) datas.push({ a: +md[3], m: mn, d: +md[1] }); }
        if (datas.length === 2) per = { inicio: nuIsoData(datas[0].a, datas[0].m, datas[0].d), fim: nuIsoData(datas[1].a, datas[1].m, datas[1].d) };

        var dias = [], dia = null, modo = '', pend = null, pulando = false;
        var RE_INICIO = /^(Transfer[eê]ncia|Resgate|Reembolso|Estorno|Cr[eé]dito|Dep[oó]sito|Pix\b|Rendimento|Pagamento|Cashback|Devolu|Aplica|Compra|Ajuste|Boleto|Saque|Estorno)/;
        // Uma entrada = a linha de inicio + as linhas de continuacao (nome do pagador, banco, agencia). O valor e a UNICA linha que termina em "1.234,56".
        function fecharEntrada() {
            if (!pend) return true;
            var valores = [];
            pend.forEach(function (l) { var mv = /(?:^|\s)(\d[\d.]*,\d{2})$/.exec(l); if (mv) valores.push(nuValor(mv[1])); });
            if (valores.length !== 1 || !dia) return false;
            var cl = nuClassificar(pend.join(' '), titular, cpfMeio);
            dia.itens.push({ v: valores[0], g: cl.g, motivo: cl.motivo });
            pend = null;
            return true;
        }
        for (var i = ini + 2; i < linhas.length; i++) {
            var ln = linhas[i];
            if (/^(===|---)/.test(ln)) continue;
            if (/^(Tem alguma d[uú]vida|Asseguramos a autenticidade)/.test(ln)) { pulando = true; continue; }
            if (pulando) { if (/^Extrato gerado/.test(ln)) pulando = false; continue; }
            if (/^\d+ de \d+$/.test(ln)) continue;   // "5 de 16" (numero da pagina, quebrado em outra linha)
            if (nuSemAcento(ln) === titular || /CPF.*Ag[eê]ncia.*Conta|VALORES EM R\$|^\d{5,}-\d$/.test(ln)) continue;   // cabecalho repetido em cada pagina
            var dh = /^(?:(\d{1,2}) ([A-Z]{3}) (\d{4}) )?Total de entradas \+ (\d[\d.]*,\d{2})$/.exec(ln);
            var ds = /^(?:(\d{1,2}) ([A-Z]{3}) (\d{4}) )?Total de sa[ií]das /.test(ln);
            var dd = /^(\d{1,2}) ([A-Z]{3}) (\d{4}) /.exec(ln);
            if (dh || ds || dd) {
                if (!fecharEntrada()) return nuNao(3);
                if (dh) {
                    var ant = dia;
                    if (dh[1]) { var mm = NU_MES_ABREV[dh[2]]; if (!mm) return nuNao(4); dia = { a: +dh[3], m: mm, d: +dh[1], tot: nuValor(dh[4]), itens: [] }; }
                    else if (ant) dia = { a: ant.a, m: ant.m, d: ant.d, tot: nuValor(dh[4]), itens: [] };   // dia que quebrou de pagina: a data veio na pagina anterior
                    else return nuNao(5);
                    dias.push(dia); modo = 'in';
                } else {
                    modo = 'out';
                    if (dd && !dh) { if (!NU_MES_ABREV[dd[2]]) return nuNao(6); dia = { a: +dd[3], m: NU_MES_ABREV[dd[2]], d: +dd[1], tot: 0, itens: [], soSaidas: true }; }
                }
                continue;
            }
            if (modo !== 'in') continue;
            if (RE_INICIO.test(ln)) { if (!fecharEntrada()) return nuNao(7); pend = [ln]; }
            else if (pend) pend.push(ln);
            else return nuNao(9);
        }
        if (!fecharEntrada() || !dias.length) return nuNao(10);
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
            });
        });
        if (ordem.length === 1 && totMes !== null) porMes[ordem[0]].totalCreditos = arred2(totMes);   // extrato de mais de um mes: o total impresso e do periodo, nao de um mes
        det.sort(function (a, b) { return b.valor - a.valor; });
        return {
            titular: nome, periodoDocumentos: per, rendaMeses: ordem.map(function (k) { return porMes[k]; }),
            excluidasDetalhe: det.slice(0, 8), leituraCodigo: 'nubank'
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
        return c.divergentes.reduce(function (a, d) { return a + (d.total > 0 ? Math.abs(d.total - d.soma) / d.total : 0); }, 0);
    }

    // Le UM arquivo (texto) em trechos. chamar(prompt, rotulo) -> Promise<texto da IA>.
    // opts: { limitar(fn), sobra() -> ms restantes, fatal(e) -> true se o erro deve abortar tudo (ex.: cancelado) }
    // Devolve o objeto somado ({rendaMeses...}) ou null se algum trecho nao pode ser lido (leitura incompleta nao vale).
    // Se a soma ainda nao fechar com o total impresso, relê UMA vez com trechos menores e fica com a melhor.
    async function lerRendaPorTrechos(texto, chamar, opts) {
        opts = opts || {};
        var nb = lerExtratoNubank(texto);   // extrato Nubank que fecha com os totais impressos: sem IA
        if (nb) return nb;
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
        var fechou = function (p) { return !!(p && p.c && p.c.fonte === 'codigo' && p.c.renda > 0 && !(p.c.divergentes && p.c.divergentes.length)); };
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
            '{"titular":"","periodoDocumentos":{"inicio":"AAAA-MM-DD","fim":"AAAA-MM-DD"},"rendaMeses":[{"mes":"AAAA-MM","fixa":0.00,"variavel":0.00,"app":0.00,"excluidas":0.00,"totalCreditos":0.00,"parcial":false}],"excluidasDetalhe":[{"mes":"AAAA-MM","valor":0.00,"motivo":""}]}\n' +
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
        { k: 'financiamento', re: /financ/g },
        { k: 'empréstimo', re: /empr[eé]stimo|consignado/g },
        { k: 'consórcio', re: /cons[oó]rcio/g },
        { k: 'aluguel', re: /alugu[eé]l|imobili[aá]ri/g },
        { k: 'boleto', re: /boleto/g },
        { k: 'mensalidade', re: /mensalidade|faculdade|col[eé]gio/g },
        { k: 'seguro/plano', re: /seguro|plano de sa[uú]de|unimed|\bamil\b/g },
        { k: 'carnê/crediário', re: /carn[eê]|credi[aá]rio/g }
    ];
    // Frases fixas dos extratos (propaganda, tabela de tarifas, rodape) que repetem as palavras acima sem ser compromisso
    var SINAIS_PROPAGANDA = /parcelamento em at[eé] \d+x|valor da mensalidade|mensalidade dos pacotes|mais seguro online|[íi]ndices econ[oô]micos ?\/ ?financeiros/g;
    var SINAIS_MINIMO = 3;   // ocorrencias no texto para a IA ter que justificar "nenhum compromisso"

    function detectarSinaisCompromisso(texto) {
        var t = String(texto || '').toLowerCase();
        if (!t) return null;
        t = t.replace(SINAIS_PROPAGANDA, ' ');
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
                porNome[k] = { desc: desc, tipo: String(c.tipo || '').substring(0, 30), valor: arred2(v), meses: numPos(c.meses) || 0 };
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
        var saldos = lerSaldos(raw), fl = d.fluxo, pct = d.comprometimentoPct;
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

    async function salvarFB(nome, produto, texto, d, cpf_cliente, chaveFixa) {
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
            (_docsRend.length ? (filaProvavel() ? 'Os documentos vão para o servidor. Depois de "Enviado" pode fechar o app.' : 'Roda em segundo plano. Pode sair desta tela, avisamos quando ficar pronta.') : 'Adicione ao menos um comprovante de renda.');
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
            '<div class="cs-job-foot"><span class="cs-job-sub">' + (filaProvavel() ? 'Preparando e enviando · só saia do app depois de aparecer "Enviado"' : 'Pode sair desta tela · mantenha o app aberto') + '</span>' + cancelar + '</div></div>';
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
        var noServidor = filaItensTela();
        var prontas = prontasDeHoje();
        var html = filaAvisoHtml();
        if (andam.length || noServidor.length) {
            html += '<div class="cs-sec-h"><span>Em andamento</span><em>' + (andam.length + noServidor.length) + '</em></div>' +
                andam.map(cardAndamento).join('') + noServidor.map(cardServidor).join('');
        }
        if (prontas.length) {
            html += '<div class="cs-sec-h"><span>Prontas</span><em>hoje</em></div>' + prontas.map(function (p) { return p.html; }).join('');
        }
        box.innerHTML = html;
    }

    function atualizarBadge() {
        filaAtualizarCartaoHome();
        var n = _jobs.filter(function (j) { return (j.estado === 'pronta' && !j.visto) || j.estado === 'aguarda' || j.estado === 'erro'; }).length +
            _fila.itens.filter(function (a) { return a.estado === 'erro'; }).length + hojeNaoVistas();
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
        renderRascunho(); aplicarForm(); renderLista();
        filaBuscar(); hojeBuscar();   // atualiza por tras; a lista que ja esta na tela aparece na hora
    }
    function closeOverlay() { el('cs_ov') && el('cs_ov').classList.remove('active'); }

    // Fecha tudo do CreditoScan (as analises continuam rodando em segundo plano)
    function fecharTudo() {
        ['cs_ov', 'cs_hist_ov', 'cs_res_ov'].forEach(function (id) { el(id) && el(id).classList.remove('active'); });
        if (el('cs_cfg_ov')) el('cs_cfg_ov').classList.remove('active');
    }

    function acaoLista(e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
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
    // Com o servidor ligado a IA roda la e a analise sobrevive ao app fechado (l_retomar.js);
    // sem ele, roda enquanto o app estiver aberto.
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

    function iniciarAnalise() {
        if (!_docsRend.length || _enviando > 0) return;
        var campoTel = el('cs_tel');
        var job = criarJob(_docsId, _docsRend, normalizarTelefone(campoTel ? campoTel.value : ''));
        if (campoTel) { campoTel.value = ''; mascararTelefone(campoTel, 'cs_tel_hint'); }
        _docsId = []; _docsRend = [];
        _jobs.unshift(job);
        _formAberto = false;
        if (filaProvavel()) upIniciar(job);   // tela de envio: trava o app ate o servidor confirmar o recebimento
        persistirJob(job);   // copia no aparelho: se o Android fechar o app, a analise e retomada ao reabrir
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
        job.uid = novoIdJob(); job.srvIds = [];   // outra rodada: nao reaproveita respostas guardadas da anterior
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
        var tIni = Date.now();
        job.tempos = job.tempos || {};
        var cpf = '';
        if (job.docsId.length > 0) {
            try {
                var promptId = 'Extraia o CPF e o Nome do titular deste documento. Retorne APENAS um JSON valido: {"cpf": "123.456.789-00", "nome": "Nome do Titular"}. Se nao achar CPF, retorne {"cpf": ""}';
                var respId = await aiCallVision(job.docsId, '', promptId, chaveIA(job, 'cpf'));
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
        job.tempos.cpf_s = Math.round((Date.now() - tIni) / 1000);
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
            job.fbKey = await salvarFB(dAposta.nomeCompleto, '', apostas.detalhe, dAposta, cpf, job.uid);
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
        prepararDados(d);

        job.fbKey = await salvarFB(d.nomeCompleto, '', resp, d, cpf, job.uid);
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
                limitar: limitar, fatal: function (e) { return e === CANCELADO; }, sobra: function () { return 150000 - (Date.now() - inicio); }
            });
        }));
        // um PDF que a IA nao conseguiu ler faria a renda sair de menos meses sem ninguem saber: nesse caso a etapa 2 calcula tudo
        if (leituras.some(function (l) { return l === null; })) return null;
        var uniao = unirRendaArquivos(leituras.filter(Boolean));
        var c = uniao.rendaMeses.length ? calcularRenda(uniao) : null;
        return c && c.renda > 0 ? c : null;
    }

    function concluirJob(job, d, texto) {
        checar(job);
        encerrarPersistencia(job);
        job.dados = d; job.texto = texto;
        if (d.nomeCompleto && d.nomeCompleto !== 'Cliente' && d.nomeCompleto !== 'Amigo(a)') job.nome = d.nomeCompleto;
        job.estado = 'pronta'; job.prog = 100; job.etapa = 'Pronta'; job.pergunta = null; job.tsFim = Date.now();
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
            id: job.uid, nome: job.nome || '', tel: job.tel || '', cpf: cpf || '',
            cpf_s: (job.tempos && job.tempos.cpf_s) || 0,
            prep_s: Math.max(0, Math.round((Date.now() - (job.ts || Date.now())) / 1000)),   // do toque em Analisar até aqui: leitura dos arquivos no celular
            docsId: job.docsId.map(docParaServidor), docsRend: job.docsRend.map(docParaServidor)
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
            _fila.itens.push({ id: job.uid, nome: job.nome || '', estado: j.estado === 'rodando' ? 'rodando' : 'fila', etapa: 'Na fila', progresso: 0, criado_em: new Date(criada).toISOString(), posicao: null });
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
            renderLista(); atualizarBadge();
            filaAgendar();
        })();
        return _filaBuscando;
    }

    function filaAtivo() { return _fila.itens.some(function (a) { return a.estado === 'fila' || a.estado === 'rodando' || a.estado === 'pronta'; }); }
    function csAberto() { var o = el('cs_ov'); return !!(o && o.classList.contains('active')); }

    function filaAgendar() {
        if (_filaTimer) { clearTimeout(_filaTimer); _filaTimer = null; }
        if (!filaToken() || _fila.suporte === false || document.hidden) return;
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

    function filaColetarProntas() {
        _fila.itens.forEach(function (it) {
            if (it.estado !== 'pronta') return;
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
                job.fbKey = await salvarFB(job.dados.nomeCompleto, '', job.texto, job.dados, job.cpf, job.uid);
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
                uid: j.id, nome: j.nome || '', cpf: j.cpf || '', ts: Date.parse(it.criado_em) || Date.now(),
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
        var nome = esc(a.nome || ('Cliente · ' + quando));
        var cancelar = '<button type="button" class="cs-link bad" data-act="s-cancelar" data-sid="' + a.id + '">Cancelar</button>';
        if (a.estado === 'fila') {
            return '<div class="cs-card cs-job"><div class="cs-job-top"><div class="cs-job-info"><div class="cs-job-nome">Na fila' + (a.posicao ? ' · ' + a.posicao + 'ª' : '') + '</div>' +
                '<div class="cs-job-sub">' + nome + ' · enviada ' + quando + ' · começa quando uma anterior terminar</div></div>' + cancelar + '</div></div>';
        }
        if (a.estado === 'erro') {
            return '<div class="cs-card cs-job bad"><div class="cs-job-top"><div class="cs-job-info"><div class="cs-job-nome">' + nome + '</div>' +
                '<div class="cs-job-sub">Enviada ' + quando + '</div></div></div>' +
                '<div class="cs-job-erro"><i class="bi bi-exclamation-circle-fill"></i><span>' + esc(a.erro || 'A análise não foi concluída.') + '</span></div>' +
                '<div class="cs-job-foot"><button type="button" class="cs-btn cs-btn-pri cs-btn-sm" data-act="s-retry" data-sid="' + a.id + '">Tentar de novo</button>' +
                '<button type="button" class="cs-link bad" data-act="s-descartar" data-sid="' + a.id + '">Descartar</button></div></div>';
        }
        if (a.estado === 'pronta') {
            return '<div class="cs-card cs-job run"><div class="cs-job-top"><div class="cs-job-info"><div class="cs-job-nome">' + nome + '</div>' +
                '<div class="cs-job-sub">Pronta · recebendo o resultado...</div></div><span class="cs-job-pct">100%</span></div>' +
                '<div class="cs-bar"><div style="width:100%"></div></div></div>';
        }
        // rodando
        var ini = a.iniciado_em ? Date.parse(a.iniciado_em) : 0;
        var ha = ini ? filaDur((Date.now() + _fila.dif - ini) / 1000) : '';
        var pct = Math.max(2, Math.min(99, a.progresso || 5));
        return '<div class="cs-card cs-job run"><div class="cs-job-top"><div class="cs-job-info"><div class="cs-job-nome">' + nome + '</div>' +
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
        _hoje.itens = (Array.isArray(c) ? c : []).filter(function (it) { return it && it.id && it.ts >= ini && ehMinha(it); });
    }

    // Itens de hoje que NAO estao ja na lista da sessao (as da sessao tem prioridade: carregam estado como a calculadora aberta)
    function hojeSemSessao() {
        var ini = inicioDoDia(), chaves = {};
        _jobs.forEach(function (j) { if (j.fbKey) chaves[j.fbKey] = 1; });
        return _hoje.itens.filter(function (it) { return it.ts >= ini && ehMinha(it) && !chaves[it.id]; });
    }
    function hojeNaoVistas() { return hojeSemSessao().filter(function (it) { return !hojeVisto(it.id); }).length; }

    // Lista unica de "Prontas de hoje": sessao + historico, mais nova primeiro
    function prontasDeHoje() {
        var ini = inicioDoDia(), lista = [];
        _jobs.forEach(function (j) { if (j.estado === 'pronta' && (j.tsFim || j.ts) >= ini) lista.push({ t: j.tsFim || j.ts, html: cardPronta(j) }); });
        hojeSemSessao().forEach(function (it) { lista.push({ t: it.ts, html: cardHoje(it) }); });
        lista.sort(function (a, b) { return b.t - a.t; });
        return lista.slice(0, HOJE_MAX);
    }

    function cardHoje(it) {
        var nota = typeof it.nota === 'number' ? it.nota : (parseInt(it.nota) || 0), rep = it.decisao === 'REPROVADO', c = rep ? 'bad' : cor(nota);
        var sub = rep ? 'Reprovado' + (it.casasJogo ? ' · apostas detectadas' : '') :
            'Aprovado' + (it.rendaEstimada > 0 ? ' · renda ' + R$(it.rendaEstimada).replace(',00', '') + '/mês' : '');
        return '<button type="button" class="cs-card cs-pronta" data-act="abrir-h" data-hid="' + esc(it.id) + '">' +
            '<span class="cs-ring-sm ' + c + '">' + nota + '</span>' +
            '<span class="cs-job-info"><span class="cs-job-nome">' + esc(it.nomeCliente || 'Cliente') + '</span><span class="cs-job-sub ' + c + '">' + sub + '</span></span>' +
            (hojeVisto(it.id) ? '<i class="bi bi-chevron-right cs-chev"></i>' : '<span class="cs-tag-nova">Nova</span>') + '</button>';
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
            catch (e1) { snap = await fb.get(fb.ref(db, SAVE_PATH)); }   // sem indice/consulta: le tudo e filtra aqui
            var itens = [];
            snap.forEach(function (c) { var v = c.val(); if (v && v.ts >= ini && ehMinha(v)) itens.push(Object.assign({ id: c.key }, v)); });
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

        // Nota + decisao
        h += '<div class="cs-hero ' + c + '">' +
            '<div class="cs-ring"><svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">' +
                '<circle cx="48" cy="48" r="42" class="trk"/><circle cx="48" cy="48" r="42" class="val" stroke-dasharray="' + dash + ' 264" transform="rotate(-90 48 48)"/></svg>' +
                '<div class="cs-ring-in"><b>' + d.nota + '</b><small>' + esc(riscoLabel) + '</small></div></div>' +
            '<div class="cs-hero-info"><div class="cs-hero-nome">' + esc(d.nomeCompleto || nomeDoJob(job)) + '</div>' +
            '<span class="cs-pill ' + c + '"><i class="bi ' + (reprov ? 'bi-x-lg' : 'bi-check-lg') + '"></i>' + (reprov ? 'Reprovado — não vender' : 'Aprovado — pode vender') + '</span></div></div>';

        if (job.tempos && temposTexto(job.tempos)) h += '<div class="cs-tempos"><i class="bi bi-stopwatch"></i><span>' + esc(temposTexto(job.tempos)) + '</span></div>';

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

        h += cartaoTelefone(job);

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
    function abrirRegistro(idx) { abrirRegistroObj((window._histItems || [])[idx]); }
    function abrirRegistroObj(it) {
        if (!it) return;
        var d = dadosDoRegistro(it);
        abrirResultado({
            id: 'h' + it.id, estado: 'pronta', ts: it.ts, nome: String(it.nomeCliente || ''),
            dados: d, texto: it.textoCompleto || '', fbKey: it.id, criadoAqui: false, tel: normalizarTelefone(it.telefone),
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
                '<div class="cs-card cs-tel-form">'+
                    '<div class="cs-up-h"><i class="bi bi-whatsapp"></i><b>WhatsApp do cliente</b><small>Opcional</small></div>'+
                    '<input id="cs_tel" class="cs-in" type="tel" inputmode="tel" autocomplete="off" maxlength="24" placeholder="(62) 99999-9999" aria-label="WhatsApp do cliente">'+
                    '<div class="cs-hint" id="cs_tel_hint" style="margin-top:-2px">Com o número, os botões de WhatsApp abrem direto na conversa do cliente.</div>'+
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
        on('cs_tel','input',function(e){mascararTelefone(e.target,'cs_tel_hint');});
        on('cs_btn_novaform','click',function(){_formAberto=true;aplicarForm();});
        on('cs_form','click',function(e){var x=e.target.closest('.cs-file-x');if(x)removerArquivo(x.getAttribute('data-t'),x.getAttribute('data-aid'));});
        on('cs_lista','click',acaoLista);
        // Resultado: botoes e simulador (delegado — o conteudo e refeito a cada abertura)
        var rb=el('cs_res_body');
        if(rb){
            rb.addEventListener('click',acaoResultado);
            rb.addEventListener('input',function(e){if(e.target.id==='cs_en')atualizarSim(false);else if(e.target.id==='cs_tel_res')mascararTelefone(e.target,'cs_tel_res_hint');});
            rb.addEventListener('change',function(e){if(e.target.id==='cs_tel_res')salvarTelefoneResultado(e.target.value);else if(e.target.id==='cs_en'||e.target.id==='cs_np'||e.target.id==='cs_tx')atualizarSim(true);});
            rb.addEventListener('focusout',function(e){if(e.target.id==='cs_en'||e.target.id==='cs_tx')atualizarSim(true);});
            rb.addEventListener('keydown',function(e){if(e.key==='Enter'&&(e.target.id==='cs_c_val'||e.target.id==='cs_c_prod')){e.preventDefault();e.target.blur();calcular();}});
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

    function init(){injectCSS();injectHTML();injectMenuBtns();wireEvents();apWire();filaIniciar();hojeIniciar();atualizarBadge();retomarAnalises();}
    if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}else{init();}
    window._creditoScanOpen=openOverlay;
    // Botao voltar do celular: fecha a camada mais de cima do CreditoScan (true = tratou)
    window._creditoScanBack=function(){
        if(upBloqueando())return true;   // enviando documentos ao servidor: o botao voltar nao faz nada
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

