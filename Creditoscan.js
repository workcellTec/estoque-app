// ================================================================
// creditoscan.js — CréditoScan v8 (Workcell CTW - Arquitetura JSON Blindada)
// ================================================================
(function () {
    'use strict';

    var GROQ_KEY_LS  = 'ctwGroqApiKey';
    var GROQ_MODEL   = 'meta-llama/llama-4-scout-17b-16e-instruct';
    var SAVE_PATH    = 'creditoscan';
    var MAX_IMG_PX   = 1280;
    var MAX_DOCS     = 30;   
    var MAX_PDF_PGS  = 50;   
    var MAX_IMG_GROQ = 5;    
    var HIST_DAYS    = 30;

    var el      = function(id){ return document.getElementById(id); };
    var safeGet = function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } };
    var R$      = function(v){ return 'R$ '+Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); };

    async function getGroqKey() {
        var local = safeGet(GROQ_KEY_LS);
        if (local) return local;
        try {
            var fb = await import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js');
            var db = window._firebaseDB; if (!db) return '';
            var snap = await fb.get(fb.ref(db, 'settings/groqKey'));
            var key = snap.val() || '';
            if (key) try { localStorage.setItem(GROQ_KEY_LS, key); } catch(e){}
            return key;
        } catch(e) { return ''; }
    }

    var _docs  = [];
    var _busy  = false;
    var _last  = null;

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
                window.pdfjsLib.GlobalWorkerOptions.workerSrc=
                    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            }
            var ab  = await file.arrayBuffer();
            var pdf = await window.pdfjsLib.getDocument({data:ab}).promise;
            var total = pdf.numPages;
            var limit = Math.min(total, MAX_PDF_PGS);
            if (total > MAX_PDF_PGS) {
                window.showCustomModal && window.showCustomModal({message:'PDF tem '+total+' páginas. Lendo as primeiras '+MAX_PDF_PGS+'.'});
            }
            var out = [];
            for (var i=1;i<=limit;i++) {
                var pg=await pdf.getPage(i), vp=pg.getViewport({scale:1.5});
                var cv=document.createElement('canvas'); cv.width=vp.width; cv.height=vp.height;
                await pg.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
                var fc=cv;
                if (vp.width>MAX_IMG_PX||vp.height>MAX_IMG_PX){
                    var sc=Math.min(MAX_IMG_PX/vp.width,MAX_IMG_PX/vp.height);
                    fc=document.createElement('canvas'); fc.width=Math.round(vp.width*sc); fc.height=Math.round(vp.height*sc);
                    fc.getContext('2d').drawImage(cv,0,0,fc.width,fc.height);
                }
                var b64=await new Promise(function(res){
                    fc.toBlob(function(bl){var r=new FileReader();r.onload=function(){res(r.result.split(',')[1]);};r.readAsDataURL(bl);},'image/jpeg',0.88);
                });
                out.push({base64:b64,dataUrl:fc.toDataURL('image/jpeg',0.6)});
            }
            return out;
        } catch(e){console.warn('[CS] PDF:',e);return [];}
    }

    async function groqCall(docs, prompt, key) {
        var parts = docs.map(function(d){return{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+d.base64}};});
        parts.push({type:'text',text:prompt});
        var resp = await fetch('https://api.groq.com/openai/v1/chat/completions',{
            method:'POST',
            headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
            body:JSON.stringify({model:GROQ_MODEL,max_tokens:4096,temperature:0.2,
                messages:[{role:'user',content:parts}]})
        });
        if (!resp.ok){var e=await resp.json().catch(function(){return{};});throw new Error((e.error&&e.error.message)||'HTTP '+resp.status);}
        var d=await resp.json();
        return ((d.choices&&d.choices[0]&&d.choices[0].message&&d.choices[0].message.content)||'').trim();
    }

    async function carregarTesseract() {
        if (window.Tesseract) return;
        await new Promise(function(ok, fail) {
            var s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.4/tesseract.min.js';
            s.onload = ok; s.onerror = fail;
            document.head.appendChild(s);
        });
    }

    async function tesseractOCR(docs) {
        await carregarTesseract();
        var worker = await Tesseract.createWorker('por+eng', 1, { logger: function() {} });
        var textos = [];
        for (var i = 0; i < docs.length; i++) {
            try {
                setProg('OCR página ' + (i + 1) + ' de ' + docs.length + '...', 10 + Math.round(55 * i / docs.length));
                var dataUrl = 'data:image/jpeg;base64,' + docs[i].base64;
                var result = await worker.recognize(dataUrl);
                textos.push(result.data.text || '');
            } catch (e) { textos.push(''); }
        }
        await worker.terminate();
        return textos;
    }

    function filtrarLinhasRelevantes(textos) {
        var RELEVANTE = [
            /R\$[\s\d.,]+/i, /[\d]{1,3}[.,][\d]{3}[.,][\d]{2}/, /[\d]+[.,][\d]{2}/,
            /salário|salario|líquido|liquido|bruto|vencimento|desconto|inss|fgts|ir |irrf/i,
            /saldo|extrato|lançamento|lancamento|credito|débito|debito/i,
            /pix|ted|doc|boleto|parcela|empréstimo|emprestimo|financiamento/i,
            /entrada|saída|saida|transferência|transferencia|depósito|deposito|saque/i,
            /bet|esportiv|pixbet|blaze|vaidebet|betnacional|apostas?/i,
            /admissão|admissao|cargo|empresa|competência|competencia|holerite|contracheque/i,
            /janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro/i,
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
                linhasFiltradas.push('--- Página ' + (idx + 1) + ' ---');
                linhasFiltradas = linhasFiltradas.concat(relevantes);
            }
        });
        return linhasFiltradas.join('\n');
    }

    async function groqCallTexto(textoOcr, prompt, key) {
        var promptCompleto = prompt +
            '\n\n=== TEXTO EXTRAÍDO DOS DOCUMENTOS VIA OCR ===\n' +
            '(Dados brutos extraídos automaticamente — use para análise)\n\n' + textoOcr;
        var resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({
                model: GROQ_MODEL, max_tokens: 4096, temperature: 0.2,
                messages: [{ role: 'user', content: [{ type: 'text', text: promptCompleto }] }]
            })
        });
        if (!resp.ok) { var e = await resp.json().catch(function() { return {}; }); throw new Error((e.error && e.error.message) || 'HTTP ' + resp.status); }
        var d = await resp.json();
        return ((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '').trim();
    }

    // --- O NOVO PROMPT QUE EXIGE JSON ---
    function buildPrompt(nomeCliente, produto, valor) {
        var vf = Number(valor).toLocaleString('pt-BR',{minimumFractionDigits:2});
        var vn = Number(valor);
        var e30 = (vn*0.30).toLocaleString('pt-BR',{minimumFractionDigits:2});
        var e35 = (vn*0.35).toLocaleString('pt-BR',{minimumFractionDigits:2});
        var e60 = (vn*0.60).toLocaleString('pt-BR',{minimumFractionDigits:2});

        return (
'Você é um analista de crédito sênior da Workcell, financeira e loja de celulares.\n'+
'Sua resposta DEVE ser estritamente um objeto JSON válido, sem nenhum texto adicional fora do JSON.\n\n'+
'CLIENTE: '+(nomeCliente||'Não informado')+'\n'+
'PRODUTO PEDIDO: '+produto+'\n'+
'VALOR BASE: R$ '+vf+'\n\n'+
'=== PASSO 1 — EXTRAIR A RENDA REAL ===\n'+
'ATENÇÃO: A regra muda dependendo do tipo de documento:\n'+
'- Se for EXTRATO BANCÁRIO: Some as entradas reais. Para não inflar a renda artificialmente, NÃO some transferências recebidas do próprio cliente (mesma titularidade).\n'+
'- Se for CONTRACHEQUE/HOLERITE: A Renda Real é EXATAMENTE o "VALOR LÍQUIDO" (o que sobra no final da folha). JAMAIS some "Adiantamento", "Empréstimo" ou descontos.\n\n'+
'=== REGRA DO HOLERITE (EMPRÉSTIMOS E ADIANTAMENTOS) ===\n'+
'Olhe atentamente a coluna de Descontos do contracheque.\n'+
'Se o cliente tiver descontos de "Empréstimo", "Crédito Consignado" ou "Adiantamento" que comem grande parte do salário base dele, OBRIGATORIAMENTE rebaixe o perfil para FRACO (nota máxima 59). Esse cliente está estrangulado financeiramente.\n\n'+
'=== ALERTA DE GIRO CEGO (SAÍDAS PARA A PRÓPRIA CONTA) ===\n'+
'Analise as SAÍDAS no extrato bancário. Fique atento a transferências/PIX para OUTRAS CONTAS DE MESMA TITULARIDADE (do próprio cliente).\n'+
'REGRA DE TOLERÂNCIA E PUNIÇÃO:\n'+
'- TOLERÂNCIA: Até 5 transferências no mês para si mesmo, ou valores que somados não passem de 40% da renda, é comportamento NORMAL. NÃO tire pontos.\n'+
'- PUNIÇÃO: Se houver 6 OU MAIS transferências para si mesmo no mês, OU se o valor dessas saídas ultrapassar 60% da Renda Estimada, ele está escondendo os gastos em outro banco (Conta Ponte).\n'+
'- Nesses casos de abuso, rebaixe o perfil em APENAS UM NÍVEL (Ex: de FORTE para MÉDIO, ou de MÉDIO para FRACO). Não reprove direto, apenas exija uma entrada um pouco maior para compensar o risco cego.\n\n'+
'=== PASSO 2 — CLASSIFICAR O PERFIL ===\n'+
'Atribua uma nota de 0 a 100 e classifique:\n'+
'- FORTE (Nota 80-100): Salário fixo/holerite formal, entradas regulares, saldo positivo.\n'+
'- MÉDIO (Nota 60-79): Entradas frequentes mas oscilam, certo controle financeiro.\n'+
'- FRACO (Nota 40-59): Autônomo, entradas "picadas", gasta quase tudo, ou caiu nas regras de punição acima.\n'+
'- REPROVADO (Nota 0-39): Fraude, saldo negativo crônico, desorganização extrema.\n\n'+
'=== REGRA DO TEMPO DE EMPREGO (PERÍODO DE EXPERIÊNCIA) ===\n'+
'Procure a "Data de Admissão" no contracheque.\n'+
'- SE TIVER MENOS DE 3 MESES: O cliente está no período de experiência (risco extremo de demissão). O perfil DEVE ser rebaixado obrigatoriamente para FRACO (nota máxima 59), forçando a entrada de 60%.\n'+
'- SE NÃO TIVER DATA ESCRITA: Aplique a Regra de Neutralidade. Não assuma que é recente e não penalize.\n\n'+
'=== PASSO 3 — BALANÇA DE RISCO (Entradas Mínimas) ===\n'+
'FORTE  → Entrada mínima: 30% = R$ '+e30+'\n'+
'MÉDIO  → Entrada mínima: 35% = R$ '+e35+'\n'+
'FRACO  → Entrada mínima: 60% = R$ '+e60+' (entrada massiva = proteção máxima)\n\n'+
'=== PASSO 4 — TESTE DE FOGO (Limite da Parcela) ===\n'+
'O limite máximo de comprometimento de renda MUDA por perfil. Calcule o Teto da Parcela:\n'+
'- FORTE: parcela tolerada em ATÉ 30% da RENDA_ESTIMADA\n'+
'- MÉDIO: parcela tolerada em ATÉ 25% da RENDA_ESTIMADA\n'+
'- FRACO: parcela ESTRITA ≤ 10% da RENDA_ESTIMADA (margem de erro zero)\n\n'+
'Estime a parcela base: (Valor Base - Entrada Mínima) / 12 + juros 6%am\n\n'+
'Avalie e escolha UMA das 4 decisões abaixo:\n'+
'VENDER               → Parcela estimada está DENTRO do Teto da Parcela do perfil. Aprovado normal com a Entrada Mínima.\n'+
'SUGESTAO_ENTRADA_ALTA→ Parcela excede o Teto. Você DEVE calcular a Entrada Turbinada.\n'+
'SUGESTAO_DOWNGRADE   → Entrada turbinada ficaria surreal (>80% do valor). Aprove um teto de crédito realista para outro aparelho.\n'+
'REPROVADO            → Nota < 40. Risco extremo. Não há cenário viável.\n\n'+
'** MACETE PARA CALCULAR A ENTRADA TURBINADA EM 12x: **\n'+
'1) Ache o Teto da Parcela.\n'+
'2) Multiplique o Teto por 8,4 para achar o Saldo Máximo Financiado.\n'+
'3) Entrada Turbinada = Valor Base - Saldo Máximo Financiado.\n\n'+
'=== FORMATO DE SAÍDA OBRIGATÓRIO (JSON) ===\n'+
'A sua resposta DEVE ser EXCLUSIVAMENTE o código JSON abaixo preenchido, sem formatação markdown, sem blocos de código e sem explicações extras. Se você escrever qualquer coisa fora do JSON, o sistema irá falhar gravemente.\n'+
'{\n'+
'  "perfilCliente": "Descreva o vínculo empregatício e tipo de renda.",\n'+
'  "analiseFinanceira": "Descreva como o cliente gasta e recebe.",\n'+
'  "rascunhoCalculos": "Rascunho matemático: demonstre aqui seus cálculos de Renda, Teto da Parcela e Entrada Turbinada.",\n'+
'  "rendaEstimada": 1500.00,\n'+
'  "nota": 75,\n'+
'  "nivel": "FORTE",\n'+
'  "decisao": "VENDER",\n'+
'  "entradaTurbinadaCalculada": 0.00,\n'+
'  "motivosReprovacao": "Preencha apenas se a decisão for REPROVADO, senão deixe vazio."\n'+
'}\n'
        );
    }

    // --- A NOVA EXTRAÇÃO QUE LÊ O JSON BLINDADO ---
    function extrair(texto) {
        var d = {};
        var jsonStr = texto;
        try {
            // Garante que só vai pegar a parte do JSON caso a IA teime em escrever texto fora
            var i1 = texto.indexOf('{');
            var i2 = texto.lastIndexOf('}');
            if (i1 !== -1 && i2 !== -1 && i2 > i1) {
                jsonStr = texto.substring(i1, i2 + 1);
            }
            var obj = JSON.parse(jsonStr);

            var dec = (obj.decisao || '').toUpperCase();
            var downgrade = dec.includes('DOWNGRADE');
            var entradaAlta = dec.includes('ENTRADA_ALTA');
            var vender = dec.includes('VENDER');
            var aprov = vender || downgrade || entradaAlta;

            var nota = typeof obj.nota === 'number' ? obj.nota : parseInt(obj.nota || 0);
            var renda = typeof obj.rendaEstimada === 'number' ? obj.rendaEstimada : parseFloat(obj.rendaEstimada || 0);
            var entAltaCalc = typeof obj.entradaTurbinadaCalculada === 'number' ? obj.entradaTurbinadaCalculada : parseFloat(obj.entradaTurbinadaCalculada || 0);

            var risco = 'REPROVADO';
            var entradaPct = 0.60;
            if (nota >= 80) { risco = 'FORTE'; entradaPct = 0.30; }
            else if (nota >= 60) { risco = 'MÉDIO'; entradaPct = 0.35; }
            else if (nota >= 40) { risco = 'FRACO'; entradaPct = 0.60; }
            else { risco = 'REPROVADO'; aprov = false; }

            if (downgrade) risco += ' · DOWNGRADE';
            if (entradaAlta) risco += ' · ENTRADA TURBINADA';

            return {
                aprov: aprov, downgrade: downgrade, entradaAlta: entradaAlta, reprovado: !aprov,
                nota: nota, risco: risco, entradaPct: entradaPct, rendaEstimada: renda,
                taxa: 6, parcelas: 12, entrada: entAltaCalc || null, 
                perfil: obj.perfilCliente || '', analise: obj.analiseFinanceira || '', 
                rascunho: obj.rascunhoCalculos || '', motivos: obj.motivosReprovacao || ''
            };
        } catch(e) {
            console.error('[CS] Falha no Parse JSON', e);
            return {
                aprov: false, downgrade: false, entradaAlta: false, reprovado: true,
                nota: 0, risco: 'ERRO DE LEITURA (JSON)', entradaPct: 0.60, rendaEstimada: 0,
                perfil: 'A Inteligência Artificial gerou um formato inválido.', analise: texto, 
                rascunho: '', motivos: 'Falha grave na formatação do Llama. Tente analisar novamente.'
            };
        }
    }

    function price(valor, entrada, n, taxaMes) {
        var s=valor-entrada; if(s<=0||n<=0)return 0;
        var t=taxaMes/100; if(t===0)return s/n;
        return s*(t*Math.pow(1+t,n))/(Math.pow(1+t,n)-1);
    }

    // --- GERADOR DE MENSAGEM DO WHATSAPP 100% CONTROLADO PELO SEU JAVASCRIPT ---
    function gerarWpp(produto, en, np, vp, d) {
        if (!d.aprov) return '';
        if (d.downgrade) {
            return 'Olá amigo(a)! Boas notícias, liberamos crédito pra você! ✅\n\n'+
                   'O '+produto+' ultrapassou sua margem ideal, MAS temos um limite mais acessível aprovado AGORA! 🚀\n'+
                   'Temos ótimas opções no estoque que cabem perfeitamente no seu bolso!\n'+
                   'Me fala qual modelo te interessa 👇';
        }
        if (d.entradaAlta) {
            return 'Olá amigo(a), tudo bem? 😊📲\n'+
                   'Seu cadastro foi avaliado na Workcell! ✅\n\n'+
                   'Para liberar o aparelho e manter a parcela suave no seu bolso, o sistema pediu uma entrada maior de '+R$(en)+'.\n'+
                   'O lado bom é que sua parcela despenca para apenas '+np+'x de '+R$(vp)+'! 📉\n\n'+
                   'Você consegue dar esse valor de entrada agora ou prefere olhar um modelo com entrada menor? 👇';
        }
        return 'Olá amigo(a), tudo bem? 😊📲\n'+
               'Seu cadastro foi APROVADO aqui na Workcell! ✅\n\n'+
               '📱 '+produto+'\n'+
               '💰 Entrada: '+R$(en)+'\n'+
               '💳 + '+np+'x de '+R$(vp)+' no boleto\n\n'+
               '✔ Aparelho revisado e com garantia\n'+
               'Me confirma aqui pra gente seguir com a liberação 👇';
    }

    async function salvarFB(nome, produto, texto, d) {
        try {
            var fb=await import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js');
            var db=window._firebaseDB; if(!db)return;
            var now=Date.now();
            await fb.push(fb.ref(db,SAVE_PATH),{
                nomeCliente:nome, produto:produto,
                decisao:d.reprovado?'REPROVADO':d.downgrade?'DOWNGRADE':d.entradaAlta?'ENTRADA_ALTA':'APROVADO',
                nota:d.nota, risco:d.risco,
                entrada:d.entrada||null, parcelas:d.parcelas||null,
                vparcela:d.vparcela||null, taxa:d.taxa||null, total:d.total||null,
                textoCompleto:texto, ts:now, expira:now+HIST_DAYS*86400000,
                operador:window.currentUserProfile||safeGet('ctwUserProfile')||'—'
            });
            var snap=await fb.get(fb.ref(db,SAVE_PATH));
            if(snap.exists()) snap.forEach(function(c){var v=c.val();if(v&&v.expira&&v.expira<now)fb.remove(fb.ref(db,SAVE_PATH+'/'+c.key));});
        } catch(e){console.warn('[CS]',e);}
    }

    function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

    // --- RENDERIZADOR QUE SÓ LÊ DADOS DO JSON BLINDADO ---
    function formatResult(texto, d, valorBase) {
        var nc = d.nota !== null ? (d.nota>=80 ? '#16a34a' : d.nota>=60 ? '#d97706' : d.nota>=40 ? '#f59e0b' : '#dc2626') : '#888';

        var html = '<h4 class="cs-rt">Perfil do Cliente</h4><p class="cs-rp">'+esc(d.perfil)+'</p>'+
                   '<h4 class="cs-rt">Análise Financeira</h4><p class="cs-rp">'+esc(d.analise)+'</p>';
        
        if (d.reprovado && d.motivos) {
            html += '<h4 class="cs-rt" style="color:#ef4444">Motivos da Reprovação</h4><p class="cs-rp" style="color:#fca5a5">'+esc(d.motivos)+'</p>';
        }

        if (d.rascunho) {
            html += '<h4 class="cs-rt">Rascunho de Cálculos</h4><p class="cs-rp" style="opacity:0.7; font-size: 0.8em;">'+esc(d.rascunho).replace(/\n/g, '<br>')+'</p>';
        }

        var riscoLabel = d.risco.split(' · ')[0];
        var nota_html = '<div class="cs-nota-row">'+
                '<div class="cs-nota-c" style="border-color:'+nc+';color:'+nc+';background:'+nc+'18">'+d.nota+'</div>'+
                '<div>'+
                    '<div class="cs-nota-lbl">Pontuação · <span style="color:'+nc+';font-weight:800">'+riscoLabel+'</span></div>'+
                    (d.rendaEstimada>0 ? '<div class="cs-nota-renda">💵 Renda estimada: <strong>'+R$(d.rendaEstimada)+'</strong></div>' : '')+
                '</div>'+
              '</div>';

        var banner = '';
        if (d.entradaAlta) {
            banner = '<div class="cs-dec" style="background:rgba(245,158,11,.12);border:2px solid rgba(245,158,11,.4);color:#f59e0b"><i class="bi bi-exclamation-triangle-fill"></i> PLANO C — ENTRADA TURBINADA</div>';
        } else if (d.downgrade) {
            banner = '<div class="cs-dec" style="background:rgba(59,130,246,.12);border:2px solid rgba(59,130,246,.4);color:#60a5fa"><i class="bi bi-info-circle-fill"></i> PLANO B — LIMITE APROVADO</div>';
        } else if (d.aprov) {
            banner = '<div class="cs-dec cs-dec-yes"><i class="bi bi-check-circle-fill"></i> APROVADO — PODE VENDER</div>';
        } else {
            banner = '<div class="cs-dec cs-dec-no"><i class="bi bi-x-circle-fill"></i> REPROVADO — NÃO VENDER</div>';
        }

        if (!d.aprov) {
            return '<div class="cs-ri">'+banner+nota_html+'<div class="cs-rb">'+html+'</div></div>';
        }

        var vn = valorBase || 0;
        var enMin = Math.ceil(vn * d.entradaPct / 10) * 10;
        var en  = d.entrada  ? Math.max(parseFloat(d.entrada), enMin) : enMin;
        var np  = d.parcelas ? parseInt(d.parcelas)  : 12; 
        var tx  = d.taxa     ? parseFloat(d.taxa)    : 6;
        var vp  = price(vn, en, np, tx);
        var tt  = en + vp * np;

        var initialWpp = gerarWpp(d._produto || 'Aparelho', en, np, vp, d);
        var wpp_block = '<div class="cs-wpp">'+
            '<div class="cs-wpp-lbl"><i class="bi bi-whatsapp"></i> Mensagem pronta — toque para copiar</div>'+
            '<div class="cs-wpp-txt" id="cs_wpp_txt" title="Toque para copiar">'+esc(initialWpp).replace(/\n/g,'<br>')+'</div>'+
            '<div class="cs-wpp-cp-hint" id="cs_wpp_hint"><i class="bi bi-clipboard-fill"></i> Toque no texto acima para copiar</div>'+
          '</div>';

        if (d.downgrade) {
            return '<div class="cs-ri">'+banner+nota_html+wpp_block+'<div class="cs-rb">'+html+'</div></div>';
        }

        var parcOpts = '';
        for (var px=1; px<=12; px++) { parcOpts += '<option value="'+px+'"'+(px===np?' selected':'')+'>'+px+'x</option>'; }

        var sim_grid = '<div class="cs-sim-grid">'+
                        '<div><label class="cs-lbl">Entrada (R$)</label>'+
                            '<input class="cs-in" type="number" id="cs_en" value="'+en.toFixed(2)+'" min="'+enMin.toFixed(2)+'" step="10"></div>'+
                        '<div><label class="cs-lbl">Parcelas</label>'+
                            '<select class="cs-in" id="cs_np">'+parcOpts+'</select></div>'+
                        '<div><label class="cs-lbl">Juros %am</label>'+
                            '<input class="cs-in" type="number" id="cs_tx" value="'+tx.toFixed(1)+'" min="0" max="30" step="0.5"></div>'+
                    '</div>'+
                    '<div class="cs-pills" id="cs_pills">'+
                        '<div class="cs-pill'+(d.entradaAlta?' cs-pill-o':'')+'">💰 Entrada: <strong>'+R$(en)+'</strong></div>'+
                        '<div class="cs-pill">📆 <strong>'+np+'x</strong> de <strong>'+R$(vp)+'</strong></div>'+
                        '<div class="cs-pill cs-pill-j">📈 Juros: <strong>'+tx+'%am</strong></div>'+
                        '<div class="cs-pill cs-pill-t">💳 Total: <strong>'+R$(tt)+'</strong></div>'+
                    '</div>';

        var sim = '';
        if (d.entradaAlta) {
            sim = '<div class="cs-sim cs-sim-orange">'+
                    '<div class="cs-sim-ttl"><i class="bi bi-lightning-charge-fill"></i> Entrada Turbinada — Condição especial</div>'+
                    '<div class="cs-sim-aviso cs-sim-aviso-orange"><i class="bi bi-lock-fill"></i> Entrada mínima travada em '+
                        R$(enMin)+' ('+Math.round(d.entradaPct*100)+'% do valor)</div>'+
                    sim_grid + '</div>';
        } else {
            sim = '<div class="cs-sim">'+
                '<div class="cs-sim-ttl"><i class="bi bi-sliders"></i> Simular condições</div>'+
                '<div class="cs-sim-aviso"><i class="bi bi-lock-fill"></i> Entrada mínima travada em '+
                    Math.round(d.entradaPct*100)+'% · '+R$(enMin)+' · Perfil '+riscoLabel+'</div>'+
                sim_grid + '</div>';
        }

        return '<div class="cs-ri">'+banner+nota_html+sim+wpp_block+'<div class="cs-rb">'+html+'</div></div>';
    }

    async function abrirHist() {
        var ov=el('cs_hist_ov'); if(!ov)return;
        ov.classList.add('active');
        var list=el('cs_hist_list');
        if(list)list.innerHTML='<div class="cs-hist-load"><i class="bi bi-hourglass-split"></i> Carregando...</div>';
        try {
            var fb=await import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js');
            var db=window._firebaseDB;
            if(!db){if(list)list.innerHTML='<div class="cs-hist-empty"><i class="bi bi-cloud-slash"></i><p>Firebase não disponível</p></div>';return;}
            var snap=await fb.get(fb.ref(db,SAVE_PATH));
            var items=[];
            if(snap.exists()) snap.forEach(function(c){var v=c.val();if(v)items.push(Object.assign({id:c.key},v));});
            var lim=Date.now()-HIST_DAYS*86400000;
            items=items.filter(function(i){return i.ts&&i.ts>lim;});
            items.sort(function(a,b){return(b.ts||0)-(a.ts||0);});
            if(!list)return;
            if(!items.length){list.innerHTML='<div class="cs-hist-empty"><i class="bi bi-clock-history"></i><p>Nenhuma consulta nos últimos 30 dias</p></div>';return;}
            list.innerHTML=items.map(function(it){
                var ap=it.decisao==='APROVADO'||it.decisao==='ENTRADA_ALTA'||it.decisao==='DOWNGRADE';
                var dt=it.ts?new Date(it.ts).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
                var bc=ap?'rgba(74,222,128,.07)':'rgba(239,68,68,.07)';
                var bd=ap?'rgba(74,222,128,.22)':'rgba(239,68,68,.22)';
                var tc=ap?'#4ade80':'#f87171';
                var tags='';
                if(ap){
                    if(it.entrada)  tags+='<span class="cs-htag">Entrada: '+R$(it.entrada)+'</span>';
                    if(it.parcelas&&it.vparcela)tags+='<span class="cs-htag">'+it.parcelas+'x '+R$(it.vparcela)+'</span>';
                    if(it.taxa)     tags+='<span class="cs-htag cs-htag-j">'+it.taxa+'%am</span>';
                }
                return '<div class="cs-hitem" style="background:'+bc+';border-color:'+bd+'">'+
                    '<div class="cs-hrow1"><span class="cs-hnome">'+esc(it.nomeCliente||'—')+'</span>'+
                    '<span style="font-size:.7rem;font-weight:800;color:'+tc+'">'+(ap?'✓ APROVADO':'✗ REPROVADO')+'</span></div>'+
                    '<div class="cs-hprod">'+esc(it.produto||'—')+'</div>'+
                    (it.nota!=null?'<div class="cs-hnota">'+it.nota+'/100 · '+esc(it.risco||'')+'</div>':'')+
                    (tags?'<div class="cs-htags">'+tags+'</div>':'')+
                    '<div class="cs-hfoot"><span>'+dt+'</span><span>'+esc(it.operador||'—')+'</span></div>'+
                '</div>';
            }).join('');
        } catch(e){if(list)list.innerHTML='<div style="padding:16px;color:#f87171">Erro: '+e.message+'</div>';}
    }

    function renderDocs(){
        var g=el('cs_docs'); if(!g)return;
        if(!_docs.length){g.innerHTML='';g.classList.add('cs-h');updateCounter();return;}
        g.classList.remove('cs-h');
        g.innerHTML=_docs.map(function(d,i){
            return '<div class="cs-dt">'+
                (d.dataUrl?'<img src="'+d.dataUrl+'" alt="">'
                :'<div class="cs-dt-pdf"><i class="bi bi-file-earmark-pdf-fill"></i><span>PDF</span></div>')+
                '<button class="cs-dt-rm" data-i="'+i+'"><i class="bi bi-x"></i></button>'+
            '</div>';
        }).join('');
        g.querySelectorAll('.cs-dt-rm').forEach(function(b){
            b.addEventListener('click',function(e){
                _docs.splice(parseInt(e.currentTarget.dataset.i),1);
                renderDocs();setBtnState();
            });
        });
        updateCounter();
    }

    function updateCounter(){
        var c=el('cs_counter');
        if(!c)return;
        var n=_docs.length;
        c.textContent=n+'/'+MAX_DOCS+' arquivo'+(n===1?'':'s');
        c.style.color = n>=MAX_DOCS ? '#f87171' : n>0 ? '#4ade80' : 'rgba(255,255,255,.35)';
    }

    function setBtnState(){ el('cs_btn_analisar')&&(el('cs_btn_analisar').disabled=!_docs.length||_busy); }
    function setProg(msg,pct){ el('cs_prog_lbl')&&(el('cs_prog_lbl').textContent=msg); el('cs_prog_bar')&&(el('cs_prog_bar').style.width=pct+'%'); }

    async function handleFiles(files){
        for(var i=0;i<files.length;i++){
            var f=files[i];
            if(_docs.length>=MAX_DOCS){
                window.showCustomModal&&window.showCustomModal({message:'Máximo '+MAX_DOCS+' arquivos atingido.'});
                break;
            }
            if(f.type.startsWith('image/')){
                var b=await resizeToBase64(f);if(!b)continue;
                _docs.push({file:f,dataUrl:URL.createObjectURL(f),base64:b});
            } else if(f.type==='application/pdf'||f.name.toLowerCase().endsWith('.pdf')){
                var imgs=await pdfToImages(f);
                if(!imgs.length){
                    window.showCustomModal&&window.showCustomModal({message:'PDF não convertido. Tente fotos.'});
                    continue;
                }
                imgs.forEach(function(im){if(_docs.length<MAX_DOCS)_docs.push({file:f,dataUrl:im.dataUrl,base64:im.base64});});
            }
        }
        renderDocs();setBtnState();
    }

    function upload(accept,capture){
        var inp=document.createElement('input');inp.type='file';inp.accept=accept;inp.multiple=true;
        if(capture)inp.capture='environment';
        inp.onchange=function(e){handleFiles(e.target.files);};inp.click();
    }

    function openOverlay(){var ov=el('cs_ov');if(!ov)return;ov.classList.add('active');_docs=[];_busy=false;_last=null;resetForm();}
    function closeOverlay(){el('cs_ov')&&el('cs_ov').classList.remove('active');}
    function resetForm(){
        _docs=[];renderDocs();setBtnState();
        ['cs_nome','cs_produto','cs_valor'].forEach(function(id){el(id)&&(el(id).value='');});
        el('cs_res')&&(el('cs_res').innerHTML='');el('cs_res')&&el('cs_res').classList.add('cs-h');
        el('cs_prog')&&el('cs_prog').classList.add('cs-h');
    }

    async function executar(){
        if(_busy||!_docs.length)return;
        var key=await getGroqKey();
        if(!key){window.showCustomModal&&window.showCustomModal({message:'Chave Groq não configurada.'});return;}
        var nome=((el('cs_nome')&&el('cs_nome').value)||'').trim()||'Cliente';
        var prod=((el('cs_produto')&&el('cs_produto').value)||'').trim();
        var val =parseFloat(((el('cs_valor')&&el('cs_valor').value)||'0').replace(',','.'))||0;
        if(!prod){window.showCustomModal&&window.showCustomModal({message:'Informe o produto.'});return;}
        if(!val) {window.showCustomModal&&window.showCustomModal({message:'Informe o valor.'});return;}

        _busy=true;setBtnState();
        el('cs_prog')&&el('cs_prog').classList.remove('cs-h');
        el('cs_res')&&(el('cs_res').innerHTML='');el('cs_res')&&el('cs_res').classList.add('cs-h');
        setProg('Iniciando OCR local...',5);
        try {
            var textosBrutos = await tesseractOCR(_docs);
            setProg('Filtrando dados financeiros...',68);
            var textoFiltrado = filtrarLinhasRelevantes(textosBrutos);
            if (!textoFiltrado.trim()) { textoFiltrado = textosBrutos.join('\n\n'); }
            setProg('IA analisando crédito...',75);
            var resp=await groqCallTexto(textoFiltrado,buildPrompt(nome,prod,val),key);
            setProg('Finalizando...',90);
            var d=extrair(resp);
            d._produto=prod; 
            _last={nome:nome,produto:prod,valor:val,dados:d,
                   entradaMin: Math.ceil(val * d.entradaPct / 10)*10};
            await salvarFB(nome,prod,resp,d);
            setProg('Pronto!',100);
            el('cs_prog')&&el('cs_prog').classList.add('cs-h');
            if(el('cs_res')){
                el('cs_res').innerHTML=formatResult(resp,d,val);
                el('cs_res').classList.remove('cs-h');
                el('cs_res').scrollIntoView({behavior:'smooth',block:'start'});
            }
            wireRes();
        } catch(e){
            console.error('[CS]',e);
            el('cs_prog')&&el('cs_prog').classList.add('cs-h');
            window.showCustomModal&&window.showCustomModal({message:'Erro: '+e.message});
        } finally{_busy=false;setBtnState();}
    }

    function copiarWpp(){
        var el_txt=el('cs_wpp_txt'); if(!el_txt)return;
        var t=el_txt.innerText||el_txt.textContent||''; if(!t)return;
        var hint=el('cs_wpp_hint');
        function sucesso(){
            if(el_txt){el_txt.style.background='rgba(37,211,102,.18)';el_txt.style.borderColor='rgba(37,211,102,.5)';}
            if(hint){hint.innerHTML='<i class="bi bi-check-lg"></i> Copiado!';hint.style.color='#4ade80';}
            setTimeout(function(){
                if(el_txt){el_txt.style.background='';el_txt.style.borderColor='';}
                if(hint){hint.innerHTML='<i class="bi bi-clipboard-fill"></i> Toque no texto acima para copiar';hint.style.color='';}
            },1800);
        }
        if(navigator.clipboard&&navigator.clipboard.writeText){
            navigator.clipboard.writeText(t).then(sucesso).catch(function(){
                try{var r=document.createRange();r.selectNodeContents(el_txt);var s=window.getSelection();s.removeAllRanges();s.addRange(r);document.execCommand('copy');s.removeAllRanges();sucesso();}catch(e2){}
            });
        } else {
            try{var r2=document.createRange();r2.selectNodeContents(el_txt);var s2=window.getSelection();s2.removeAllRanges();s2.addRange(r2);document.execCommand('copy');s2.removeAllRanges();sucesso();}catch(e3){}
        }
    }

    function wireRes(){
        if(!_last)return;
        var d       = _last.dados;
        var vn      = _last.valor;
        var enMin   = _last.entradaMin;
        var produto = _last.produto;

        var wt=el('cs_wpp_txt');
        if(wt){
            wt.style.cursor='pointer';
            var wt2=wt.cloneNode(true); wt.parentNode&&wt.parentNode.replaceChild(wt2,wt);
            wt2.addEventListener('click', copiarWpp);
        }

        if(!d || d.downgrade || !d.aprov) return;

        function recalcular(){
            var enEl=el('cs_en'), npEl=el('cs_np'), txEl=el('cs_tx');
            if(!enEl||!npEl||!txEl) return;

            var en = parseFloat(enEl.value)||0;
            var np = parseInt(npEl.value)||1;
            var tx = parseFloat(txEl.value)||0;

            if(en < enMin){ en=enMin; enEl.value=enMin.toFixed(2); }
            if(en >= vn)  { en=enMin; enEl.value=enMin.toFixed(2); }

            var vp = price(vn, en, np, tx);
            var tt = en + vp * np;

            var pills=el('cs_pills');
            if(pills) pills.innerHTML=
                '<div class="cs-pill'+(d.entradaAlta?' cs-pill-o':'')+
                    '">💰 Entrada: <strong>'+R$(en)+'</strong></div>'+
                '<div class="cs-pill">📆 <strong>'+np+'x</strong> de <strong>'+R$(vp)+'</strong></div>'+
                '<div class="cs-pill cs-pill-j">📈 Juros: <strong>'+tx+'%am</strong></div>'+
                '<div class="cs-pill cs-pill-t">💳 Total: <strong>'+R$(tt)+'</strong></div>';

            var novoWpp = gerarWpp(produto, en, np, vp, d);
            var wEl=el('cs_wpp_txt');
            if(wEl){ wEl.innerHTML=esc(novoWpp).replace(/\n/g,'<br>'); }
        }

        ['cs_en','cs_np','cs_tx'].forEach(function(id){
            var inp=el(id);
            if(inp){
                var ni=inp.cloneNode(true); inp.parentNode&&inp.parentNode.replaceChild(ni,inp);
                ni.addEventListener('input',recalcular);
                ni.addEventListener('change',recalcular);
            }
        });

        var enEl2=el('cs_en');
        if(enEl2){
            enEl2.addEventListener('blur',function(){
                var v=parseFloat(enEl2.value)||0;
                if(v<enMin){ enEl2.value=enMin.toFixed(2); recalcular(); }
            });
        }
        
        recalcular();
    }

    function injectCSS(){
        if(el('cs-st'))return;
        var s=document.createElement('style');s.id='cs-st';
        s.textContent=`
#cs_ov{display:none;position:fixed;inset:0;z-index:3000;background:var(--bg-color,#0b1325);flex-direction:column;overflow:hidden}
#cs_ov.active{display:flex}
.cs-hdr{display:flex;align-items:center;gap:10px;padding:12px 14px 10px;flex-shrink:0;border-bottom:1px solid rgba(255,255,255,.06)}
.cs-hdr-ico{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,rgba(139,92,246,.28),rgba(239,68,68,.22));display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0}
.cs-hdr-ttl{font-size:.93rem;font-weight:800;color:var(--text-color,#fff)}
.cs-hdr-sub{font-size:.59rem;color:var(--text-secondary,rgba(255,255,255,.5))}
.cs-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px 14px 100px;display:flex;flex-direction:column;gap:13px}
.cs-sec{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:15px;padding:13px}
.cs-sec-ttl{font-size:.58rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--primary-color,#7c3aed);margin-bottom:10px;display:flex;align-items:center;gap:6px}
.cs-counter{font-size:.62rem;font-weight:700;margin-left:auto;color:rgba(255,255,255,.35);transition:color .2s}
.cs-fld{margin-bottom:10px}.cs-fld:last-child{margin-bottom:0}
.cs-lbl{font-size:.63rem;font-weight:600;color:var(--text-secondary,rgba(255,255,255,.5));margin-bottom:5px;display:block}
.cs-row2{display:grid;grid-template-columns:1fr 120px;gap:10px;align-items:end}
.cs-in{width:100%;background:rgba(0,0,0,.3);border:1.5px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 12px;color:var(--text-color,#fff);font-family:'Poppins',sans-serif;font-size:.86rem;outline:none;box-sizing:border-box;transition:border-color .18s}
.cs-in:focus{border-color:var(--primary-color,#7c3aed)}
select.cs-in{appearance:none;-webkit-appearance:none;cursor:pointer}
.cs-uz{border:2px dashed rgba(255,255,255,.13);border-radius:13px;padding:17px 14px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s}
.cs-uz.drag-over{border-color:var(--primary-color,#7c3aed);background:rgba(139,92,246,.07)}
.cs-uz-ico{font-size:1.7rem;margin-bottom:5px;opacity:.7}
.cs-uz-txt{font-size:.81rem;font-weight:600;color:var(--text-color,#fff);margin-bottom:3px}
.cs-uz-sub{font-size:.63rem;color:var(--text-secondary,rgba(255,255,255,.45))}
.cs-ubtns{display:flex;gap:7px;margin-top:10px}
.cs-ubtn{flex:1;padding:9px 6px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:var(--text-color,#fff);font-family:'Poppins',sans-serif;font-size:.7rem;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;transition:background .14s}
.cs-ubtn:active{background:rgba(139,92,246,.2)}
.cs-docs{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.cs-dt{position:relative;width:68px;height:68px;border-radius:10px;overflow:hidden;border:1.5px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04)}
.cs-dt img{width:100%;height:100%;object-fit:cover}
.cs-dt-pdf{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:#f87171;font-size:1.4rem}
.cs-dt-pdf span{font-size:.54rem;font-weight:700;color:#f87171}
.cs-dt-rm{position:absolute;top:3px;right:3px;width:19px;height:19px;border-radius:50%;background:rgba(0,0,0,.78);border:none;color:#fff;font-size:.62rem;cursor:pointer;display:flex;align-items:center;justify-content:center}
.cs-btn-analisar{width:100%;padding:15px;border-radius:14px;border:none;background:linear-gradient(135deg,#7c3aed,#b91c1c);color:#fff;font-family:'Poppins',sans-serif;font-size:.93rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 20px rgba(139,92,246,.3);transition:opacity .18s,transform .12s}
.cs-btn-analisar:active{transform:scale(.98)}.cs-btn-analisar:disabled{opacity:.38;cursor:not-allowed}
.cs-btn-hist{padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:var(--text-secondary,rgba(255,255,255,.5));font-family:'Poppins',sans-serif;font-size:.73rem;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;transition:background .14s;white-space:nowrap}
.cs-btn-hist:active{background:rgba(255,255,255,.08)}
.cs-prog{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:13px}
.cs-prog-lbl{font-size:.74rem;font-weight:600;color:var(--text-secondary,rgba(255,255,255,.6));margin-bottom:8px;display:flex;align-items:center;gap:7px}
.cs-prog-lbl::before{content:'';width:10px;height:10px;border-radius:50%;border:2px solid var(--primary-color,#7c3aed);border-top-color:transparent;animation:cs-spin .7s linear infinite;flex-shrink:0}
@keyframes cs-spin{to{transform:rotate(360deg)}}
.cs-prog-trk{height:5px;background:rgba(255,255,255,.08);border-radius:99px;overflow:hidden}
.cs-prog-bar{height:100%;background:linear-gradient(90deg,#7c3aed,#b91c1c);border-radius:99px;transition:width .4s ease;width:0%}
.cs-res{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:15px;padding:15px;font-size:.82rem;line-height:1.7;color:var(--text-color,#fff)}
.cs-ri{display:flex;flex-direction:column;gap:12px}
.cs-dec{display:flex;align-items:center;gap:10px;padding:13px 16px;border-radius:12px;font-size:1rem;font-weight:800}
.cs-dec-yes{background:rgba(74,222,128,.12);border:2px solid rgba(74,222,128,.4);color:#4ade80}
.cs-dec-no{background:rgba(239,68,68,.12);border:2px solid rgba(239,68,68,.4);color:#f87171}
.cs-nota-row{display:flex;align-items:center;gap:12px;padding:4px 0}
.cs-nota-c{width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.3rem;font-weight:800;flex-shrink:0;border:3px solid}
.cs-nota-lbl{font-size:.67rem;color:var(--text-secondary)}
.cs-nota-risco{font-weight:800;font-size:.84rem}
.cs-alert{display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border-radius:9px;background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);font-size:.78rem;color:#fca5a5;margin:3px 0;line-height:1.5}
.cs-alert i{color:#f87171;flex-shrink:0;margin-top:2px;font-size:.74rem}
.cs-alert-red{background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.35)}
.cs-alert-green{background:rgba(74,222,128,.07);border-color:rgba(74,222,128,.25);color:#86efac}
.cs-alert-green i{color:#4ade80}
.cs-sim{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:13px;padding:13px}
.cs-sim-ttl{font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--primary-color,#a78bfa);margin-bottom:8px;display:flex;align-items:center;gap:6px}
.cs-sim-aviso{font-size:.65rem;color:#fbbf24;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.2);border-radius:8px;padding:6px 10px;margin-bottom:10px;display:flex;align-items:center;gap:6px}
.cs-sim-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px}
.cs-pills{display:flex;flex-wrap:wrap;gap:6px}
.cs-pill{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:99px;padding:5px 13px;font-size:.76rem;color:var(--text-color,#fff)}
.cs-pill-j{background:rgba(251,191,36,.08);border-color:rgba(251,191,36,.25);color:#fbbf24}
.cs-pill-t{background:rgba(59,130,246,.08);border-color:rgba(59,130,246,.25);color:#60a5fa}
.cs-wpp{background:rgba(37,211,102,.06);border:1px solid rgba(37,211,102,.2);border-radius:12px;padding:13px;display:flex;flex-direction:column;gap:9px}
.cs-wpp-lbl{font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#25d366;display:flex;align-items:center;gap:6px}
.cs-wpp-txt{font-size:.83rem;line-height:1.7;color:var(--text-color,#fff);background:rgba(0,0,0,.2);border-radius:9px;padding:11px;white-space:pre-wrap;user-select:all;cursor:pointer;border:1.5px solid transparent;transition:background .18s,border-color .18s}
.cs-wpp-txt:hover{background:rgba(37,211,102,.08);border-color:rgba(37,211,102,.3)}
.cs-wpp-txt:active{background:rgba(37,211,102,.18)}
.cs-wpp-cp-hint{display:flex;align-items:center;justify-content:center;gap:7px;padding:8px 16px;border-radius:9px;border:1px solid rgba(37,211,102,.2);background:rgba(37,211,102,.06);color:rgba(37,211,102,.7);font-family:'Poppins',sans-serif;font-size:.72rem;font-weight:600;transition:color .3s}
.cs-rt{font-size:.86rem;font-weight:800;color:var(--primary-color,#a78bfa);margin:13px 0 5px;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,.06)}
.cs-rp{margin:5px 0}.cs-rb ul,.cs-rb li{list-style:disc;padding-left:16px;margin:4px 0}
#cs_hist_ov{display:none;position:fixed;inset:0;z-index:3100;background:var(--bg-color,#0b1325);flex-direction:column;overflow:hidden}
#cs_hist_ov.active{display:flex}
.cs-hhdr{display:flex;align-items:center;gap:11px;padding:12px 14px 10px;flex-shrink:0;border-bottom:1px solid rgba(255,255,255,.06)}
.cs-hhdr-ttl{font-size:.92rem;font-weight:800;color:var(--text-color,#fff);flex:1}
.cs-hhdr-sub{font-size:.61rem;color:var(--text-secondary,rgba(255,255,255,.4))}
.cs-hbody{flex:1;overflow-y:auto;padding:12px 13px 80px;display:flex;flex-direction:column;gap:9px}
.cs-hitem{border:1px solid;border-radius:13px;padding:11px 13px;display:flex;flex-direction:column;gap:5px}
.cs-hrow1{display:flex;justify-content:space-between;align-items:center}
.cs-hnome{font-size:.87rem;font-weight:700;color:var(--text-color,#fff)}
.cs-hprod{font-size:.73rem;color:var(--text-secondary,rgba(255,255,255,.55))}
.cs-hnota{font-size:.67rem;color:var(--text-secondary,rgba(255,255,255,.4))}
.cs-htags{display:flex;flex-wrap:wrap;gap:5px;margin-top:2px}
.cs-htag{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:99px;padding:3px 10px;font-size:.67rem;color:var(--text-color,#fff)}
.cs-htag-j{background:rgba(251,191,36,.08);border-color:rgba(251,191,36,.2);color:#fbbf24}
.cs-hfoot{display:flex;justify-content:space-between;font-size:.59rem;color:rgba(255,255,255,.3);margin-top:3px}
.cs-hist-empty,.cs-hist-load{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:60px 20px;color:var(--text-secondary,rgba(255,255,255,.4));font-size:.83rem;text-align:center}
.cs-hist-empty i,.cs-hist-load i{font-size:2.4rem;opacity:.4}
.ctw-card.c-rose{background:rgba(225,29,72,.09);border-color:rgba(225,29,72,.2)}
.ctw-card.c-rose .ctw-card-icon{background:rgba(225,29,72,.16);color:#fb7185}
.ctw-card.c-rose .ctw-card-title{color:#fca5a5}.ctw-card.c-rose .ctw-card-sub{color:#fca5a5}
.ctw-card.c-rose:hover{background:rgba(225,29,72,.14);border-color:rgba(225,29,72,.38);transform:translateY(-3px)}
[data-theme="light"] .ctw-card.c-rose{background:rgba(225,29,72,.07)}
.cs-h{display:none!important}
.cs-dec-orange{background:rgba(249,115,22,.12);border:2px solid rgba(249,115,22,.45);color:#fb923c}
.cs-dec-blue{background:rgba(59,130,246,.12);border:2px solid rgba(59,130,246,.45);color:#60a5fa}
.cs-nota-renda{font-size:.72rem;color:var(--text-secondary,rgba(255,255,255,.55));margin-top:3px}
.cs-nota-renda strong{color:var(--text-color,#fff)}
.cs-sim-orange{border-color:rgba(249,115,22,.25)!important}
.cs-sim-aviso-orange{background:rgba(249,115,22,.08)!important;border-color:rgba(249,115,22,.25)!important;color:#fb923c!important}
.cs-pill-o{background:rgba(249,115,22,.1);border-color:rgba(249,115,22,.3);color:#fb923c}
`;
        document.head.appendChild(s);
    }

    function injectHTML(){
        if(el('cs_ov'))return;
        var o1=document.createElement('div');o1.id='cs_ov';
        o1.innerHTML=
        '<div class="cs-hdr">'+
            '<button class="btn-back" id="cs_close" style="flex-shrink:0"><i class="bi bi-arrow-left"></i></button>'+
            '<div class="cs-hdr-ico">🧠</div>'+
            '<div style="flex:1"><div class="cs-hdr-ttl">CreditoScan</div><div class="cs-hdr-sub">Análise de crédito via IA</div></div>'+
            '<button class="cs-btn-hist" id="cs_hist_open"><i class="bi bi-clock-history"></i> Histórico</button>'+
        '</div>'+
        '<div class="cs-body">'+
            '<div class="cs-sec">'+
                '<div class="cs-sec-ttl"><i class="bi bi-person-fill"></i> Cliente & Produto</div>'+
                '<div class="cs-fld"><label class="cs-lbl">Nome do cliente</label>'+
                    '<input type="text" class="cs-in" id="cs_nome" placeholder="Ex: João da Silva" maxlength="80"></div>'+
                '<div class="cs-fld"><label class="cs-lbl">Produto a vender</label>'+
                    '<div class="cs-row2">'+
                        '<input type="text" class="cs-in" id="cs_produto" placeholder="Ex: iPhone 13 128GB Seminovo" maxlength="80">'+
                        '<div><label class="cs-lbl">Valor (R$)</label>'+
                            '<input type="number" class="cs-in" id="cs_valor" placeholder="2200" min="1" step="1"></div>'+
                    '</div>'+
                '</div>'+
            '</div>'+
            '<div class="cs-sec">'+
                '<div class="cs-sec-ttl">'+
                    '<i class="bi bi-file-earmark-text-fill"></i> Documentos do Cliente'+
                    '<span class="cs-counter" id="cs_counter">0/'+MAX_DOCS+' arquivos</span>'+
                '</div>'+
                '<div class="cs-uz" id="cs_uz">'+
                    '<div class="cs-uz-ico">📄</div>'+
                    '<div class="cs-uz-txt">Fotos ou PDF do extrato, contracheque ou holerite</div>'+
                    '<div class="cs-uz-sub">Até '+MAX_DOCS+' arquivos · JPG PNG PDF</div>'+
                '</div>'+
                '<div class="cs-ubtns">'+
                    '<button class="cs-ubtn" id="cs_cam"><i class="bi bi-camera-fill"></i> Câmera</button>'+
                    '<button class="cs-ubtn" id="cs_gal"><i class="bi bi-image-fill"></i> Galeria</button>'+
                    '<button class="cs-ubtn" id="cs_pdf"><i class="bi bi-file-earmark-pdf-fill"></i> PDF</button>'+
                '</div>'+
                '<div class="cs-docs cs-h" id="cs_docs"></div>'+
            '</div>'+
            '<button class="cs-btn-analisar" id="cs_btn_analisar" disabled>'+
                '<i class="bi bi-cpu-fill"></i> Analisar Crédito</button>'+
            '<div class="cs-prog cs-h" id="cs_prog">'+
                '<div class="cs-prog-lbl" id="cs_prog_lbl">Processando...</div>'+
                '<div class="cs-prog-trk"><div class="cs-prog-bar" id="cs_prog_bar"></div></div>'+
            '</div>'+
            '<div class="cs-res cs-h" id="cs_res"></div>'+
        '</div>';
        document.body.appendChild(o1);

        var o2=document.createElement('div');o2.id='cs_hist_ov';
        o2.innerHTML=
        '<div class="cs-hhdr">'+
            '<button class="btn-back" id="cs_hist_close" style="flex-shrink:0"><i class="bi bi-arrow-left"></i></button>'+
            '<span class="cs-hhdr-ttl">Histórico de Consultas</span>'+
            '<span class="cs-hhdr-sub">últimos 30 dias</span>'+
        '</div>'+
        '<div class="cs-hbody" id="cs_hist_list"></div>';
        document.body.appendChild(o2);
    }

    function injectMenuBtns(){
        var mc=el('menuClassic');
        if(mc&&!el('goCS1')){
            var b=document.createElement('button');b.className='btn-menu';b.id='goCS1';
            b.innerHTML='<i class="bi bi-cpu-fill"></i> CreditoScan — Análise IA';
            b.addEventListener('click',openOverlay);mc.appendChild(b);
        }

        // ✅ CORREÇÃO: se o botão já existe no HTML, apenas adiciona o listener
        var goCS2=el('goCS2');
        if(goCS2&&!goCS2._csListenerOk){
            goCS2.addEventListener('click',openOverlay);
            goCS2._csListenerOk=true;
        } else if(!goCS2){
            var mg=el('menuCards');
            if(mg){
                var b2=document.createElement('button');b2.className='ctw-card c-rose';b2.id='goCS2';
                b2.innerHTML='<div class="ctw-card-icon"><i class="bi bi-cpu-fill"></i></div>'+
                    '<span class="ctw-card-title">CreditoScan</span>'+
                    '<span class="ctw-card-sub">Análise de crédito IA</span>';
                b2.addEventListener('click',openOverlay);mg.appendChild(b2);
            }
        }
    }

    function wireEvents(){
        el('cs_close')     &&el('cs_close').addEventListener('click',closeOverlay);
        el('cs_hist_open') &&el('cs_hist_open').addEventListener('click',abrirHist);
        el('cs_hist_close')&&el('cs_hist_close').addEventListener('click',function(){el('cs_hist_ov')&&el('cs_hist_ov').classList.remove('active');});
        el('cs_uz')        &&el('cs_uz').addEventListener('click',function(){upload('image/*,application/pdf');});
        el('cs_uz')        &&el('cs_uz').addEventListener('dragover',function(e){e.preventDefault();el('cs_uz').classList.add('drag-over');});
        el('cs_uz')        &&el('cs_uz').addEventListener('dragleave',function(){el('cs_uz').classList.remove('drag-over');});
        el('cs_uz')        &&el('cs_uz').addEventListener('drop',function(e){e.preventDefault();el('cs_uz').classList.remove('drag-over');handleFiles(e.dataTransfer.files);});
        el('cs_cam')       &&el('cs_cam').addEventListener('click',function(){upload('image/*',true);});
        el('cs_gal')       &&el('cs_gal').addEventListener('click',function(){upload('image/*');});
        el('cs_pdf')       &&el('cs_pdf').addEventListener('click',function(){upload('application/pdf,.pdf');});
        el('cs_btn_analisar')&&el('cs_btn_analisar').addEventListener('click',executar);
    }

    function init(){injectCSS();injectHTML();injectMenuBtns();wireEvents();}
    if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}else{init();}
    window._creditoScanOpen=openOverlay;
})();
