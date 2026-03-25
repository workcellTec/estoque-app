// ================================================================
// creditoscan.js — CréditoScan v14 (Arquitetura Híbrida Anti-Fraude)
// ================================================================
(function () {
    'use strict';

    var GROQ_KEY_LS  = 'ctwGroqApiKey';
    var GROQ_MODEL   = 'meta-llama/llama-4-scout-17b-16e-instruct';
    var SAVE_PATH    = 'creditoscan';
    var MAX_IMG_PX   = 1280;
    var MAX_DOCS_ID  = 3;
    var MAX_DOCS_RND = 30;
    var MAX_PDF_PGS  = 50;
    var HIST_DAYS    = 30;

    var el      = function(id){ return document.getElementById(id); };
    var safeGet = function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } };
    var R$      = function(v){ return 'R$ '+Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); };
    var esc     = function(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };

    var _docsId   = [];
    var _docsRend = [];
    var _busy  = false;
    var _last  = null;

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
        } catch(e){return [];}
    }

    // Extrai texto de PDF digital (extratos do app do banco — zero OCR)
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
                var pageText = content.items.map(function(item){ return item.str; }).join(' ');
                textos.push(pageText);
                totalChars += pageText.length;
            }
            var ehDigital = (totalChars / limit) > 50;
            return { textos: textos, ehDigital: ehDigital };
        } catch(e) { return { textos: [], ehDigital: false }; }
    }

    // Tesseract paralelo — lotes de 4 workers simultaneos
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
        var LOTE = 4;
        var textos = new Array(docs.length).fill('');
        var totalLotes = Math.ceil(docs.length / LOTE);
        for (var lote = 0; lote < totalLotes; lote++) {
            var inicio = lote * LOTE, fim = Math.min(inicio + LOTE, docs.length);
            setProg('OCR paginas ' + (inicio+1) + '-' + fim + ' de ' + docs.length + '...', 20 + Math.round(40 * inicio / docs.length));
            var tarefas = [];
            for (var j = inicio; j < fim; j++) {
                tarefas.push((function(idx) {
                    return Tesseract.createWorker('por+eng', 1, { logger: function(){} })
                        .then(function(w) {
                            return w.recognize('data:image/jpeg;base64,' + docs[idx].base64)
                                .then(function(r) { textos[idx] = r.data.text || ''; return w.terminate(); })
                                .catch(function() { return w.terminate(); });
                        }).catch(function() {});
                })(j));
            }
            await Promise.all(tarefas);
        }
        return textos;
    }

    function filtrarLinhasRelevantes(textos) {
        var RELEVANTE = [
            /R\$[\s\d.,]+/i, /[\d]{1,3}[.,][\d]{3}[.,][\d]{2}/, /[\d]+[.,][\d]{2}/,
            /sal.rio|sal.rio|l.quido|liquido|bruto|vencimento|desconto|inss|fgts|ir |irrf/i,
            /saldo|extrato|lan.amento|lancamento|credito|d.bito|debito/i,
            /pix|ted|doc|boleto|parcela|empr.stimo|emprestimo|financiamento/i,
            /entrada|sa.da|saida|transfer.ncia|transferencia|dep.sito|deposito|saque/i,
            /bet|esportiv|pixbet|blaze|vaidebet|betnacional|apostas?/i,
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

    // Motor hibrido: imagens ID + texto renda = 1 unica chamada
    async function groqCallHibrido(docsId, textoRenda, prompt, key) {
        var parts = [];
        if (docsId.length > 0) {
            docsId.forEach(function(d) {
                parts.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + d.base64 } });
            });
        }
        if (textoRenda && textoRenda.trim()) {
            parts.push({ type: 'text', text: '=== COMPROVANTE DE RENDA (extraido localmente) ===\n' + textoRenda });
        }
        parts.push({ type: 'text', text: prompt });
        var resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({
                model: GROQ_MODEL, max_tokens: 4096, temperature: 0.0,
                messages: [{ role: 'user', content: parts }]
            })
        });
        if (!resp.ok) { var e = await resp.json().catch(function(){return{};}); throw new Error((e.error && e.error.message) || 'HTTP ' + resp.status); }
        var d = await resp.json();
        return ((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '').trim();
    }

    function buildPrompt(produto, valor) {
        var vf = Number(valor).toLocaleString('pt-BR',{minimumFractionDigits:2});
        var vn = Number(valor);
        var e20 = (vn*0.20).toLocaleString('pt-BR',{minimumFractionDigits:2});
        var e30 = (vn*0.30).toLocaleString('pt-BR',{minimumFractionDigits:2});
        var e35 = (vn*0.35).toLocaleString('pt-BR',{minimumFractionDigits:2});
        var e60 = (vn*0.60).toLocaleString('pt-BR',{minimumFractionDigits:2});
        return (
'Voce e um analista de credito senior da Workcell.\n'+
'Sua resposta DEVE ser estritamente um objeto JSON valido, sem texto adicional.\n\n'+
'PRODUTO PEDIDO: '+produto+'\n'+
'VALOR BASE: R$ '+vf+'\n\n'+
'=== PASSO 0 - TITULARIDADE E ANTI-FRAUDE ===\n'+
'Voce recebera IMAGEM(NS) do documento pessoal E TEXTO do comprovante de renda.\n\n'+
'1) OLHE VISUALMENTE as imagens do documento (RG/CNH):\n'+
'   - Extraia o nome do campo NOME do titular.\n'+
'   - IGNORE completamente os campos FILIACAO, MAE, PAI.\n'+
'   - Avalie a qualidade: ALTA (nitida), MEDIA (aceitavel), BAIXA (borrada/cortada).\n'+
'   - Sem imagem de documento: nomeDocumentoPessoal="" e confiancaLeitura="SEM_DOCUMENTO".\n\n'+
'2) LEIA O TEXTO do comprovante de renda e extraia o nome do titular.\n\n'+
'3) COMPARE OS DOIS NOMES:\n'+
'   - "Eduardo Ferreira" e "Eduardo F." -> mesma pessoa (nomesBatem: true)\n'+
'   - "Eduardo Ferreira" e "Maria Ferreira" -> fraude (nomesBatem: false)\n'+
'   - Sem documento pessoal: nomesBatem: null (analise continua normalmente)\n'+
'   - Se nomes NAO baterem: decisao="REPROVADO", nota=0\n\n'+
'=== PASSO 1 - EXTRAIR A RENDA REAL ===\n'+
'- EXTRATO: Some entradas reais. NAO some transferencias da propria pessoa.\n'+
'- HOLERITE: Renda Real = VALOR LIQUIDO exato. Jamais some descontos/adiantamentos.\n\n'+
'=== REGRAS DE REBAIXAMENTO ===\n'+
'- Desconto de Emprestimo/Consignado no holerite: perfil maximo FRACO (nota max 59).\n'+
'- Menos de 3 meses no emprego: perfil maximo FRACO.\n\n'+
'=== PASSO 2 - PERFIL ===\n'+
'- FORTE (80-100): Salario fixo/formal, regular, saldo positivo.\n'+
'- MEDIO (60-79): Entradas frequentes mas oscilam.\n'+
'- FRACO (40-59): Autonomo, gasta tudo, tem emprestimos.\n'+
'- REPROVADO (0-39): Fraude, saldo negativo cronico.\n\n'+
'=== PASSO 3 - BALANCA DE RISCO ===\n'+
'FORTE (nota 85-100): 20% = R$ '+e20+' | MEDIO (nota 60-84): 35% = R$ '+e35+' | FRACO (nota 40-59): 60% = R$ '+e60+'\n\n'+
'=== PASSO 4 - TESTE DE FOGO ===\n'+
'Teto: FORTE (30% renda) | MEDIO (20%) | FRACO (10%).\n'+
'Parcela base = (Valor - Entrada Minima) / 12 + juros 6%am.\n'+
'Se parcela > Teto: decisao=SUGESTAO_ENTRADA_ALTA. EntradaTurbinada = Valor - (Teto x 8,4).\n'+
'Se EntradaTurbinada > 80% do Valor: decisao=SUGESTAO_DOWNGRADE.\n\n'+
'=== JSON OBRIGATORIO ===\n'+
'{\n'+
'  "nomeDocumentoPessoal": "Nome visual do RG/CNH (ignorar filiacao)",\n'+
'  "nomeComprovanteRenda": "Nome do extrato ou holerite",\n'+
'  "nomesBatem": true,\n'+
'  "confiancaLeitura": "ALTA",\n'+
'  "perfilCliente": "DETALHADO: Tipo de vinculo (CLT, autonomo, funcao publica), cargo se visivel, empresa se visivel, tempo de emprego (mencione a data de admissao se encontrada), tipo de renda (salario fixo, pixs de clientes, comissoes). Explique POR QUE o perfil e FORTE/MEDIO/FRACO com exemplos concretos dos documentos.",\n'+
'  "analiseFinanceira": "DETALHADO: Renda mensal estimada em R$. Principais fontes de entrada. Maiores despesas identificadas (cite nomes: Academia, apostas, 99 Tecnologia etc). Se houver apostas/jogos: cite quantas ocorrencias e valores totais. Saldo medio do periodo. Comprometimento de renda em %. Diz se o cliente guarda dinheiro ou gasta tudo. Aponte comportamentos de risco especificos encontrados nos documentos.",\n'+
'  "rascunhoCalculos": "Renda estimada: R$ X. Teto de parcela (perfil%): R$ X. Parcela base calculada: (R$ valor - R$ entrada) / 12 + juros 6%am = R$ X. Resultado: DENTRO ou ACIMA do teto. Se ACIMA: Entrada Turbinada = Valor - (Teto x 8,4) = R$ X.",\n'+
'  "rendaEstimada": 1500.00,\n'+
'  "nota": 70,\n'+
'  "nivel": "MEDIO",\n'+
'  "decisao": "VENDER",\n'+
'  "entradaTurbinadaCalculada": 0.00,\n'+
'  "motivosReprovacao": "Preencha APENAS se reprovado."\n'+
'}\n'
        );
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

            if (!nomesBatem) {
                dec = 'REPROVADO'; nota = 0; obj.nivel = 'REPROVADO';
                obj.motivosReprovacao = 'Alerta de Fraude: Divergencia de Titularidade.\nDocumento Pessoal: ' +
                    (obj.nomeDocumentoPessoal||'Nao encontrado') + '\nComprovante de Renda: ' +
                    (obj.nomeComprovanteRenda||'Nao encontrado');
            }

            var downgrade   = dec.includes('DOWNGRADE');
            var entradaAlta = dec.includes('ENTRADA_ALTA');
            var aprov = dec.includes('VENDER') || downgrade || entradaAlta;
            if (dec === 'REPROVADO') aprov = false;

            var renda       = typeof obj.rendaEstimada === 'number' ? obj.rendaEstimada : parseFloat(obj.rendaEstimada || 0);
            var entAltaCalc = typeof obj.entradaTurbinadaCalculada === 'number' ? obj.entradaTurbinadaCalculada : parseFloat(obj.entradaTurbinadaCalculada || 0);
            var nomeCompleto   = obj.nomeComprovanteRenda || obj.nomeDocumentoPessoal || 'Amigo(a)';
            var primeiroNome   = nomeCompleto.split(' ')[0];
            var confianca      = (obj.confiancaLeitura || 'ALTA').toUpperCase();

            var risco = 'REPROVADO', entradaPct = 0.60;
            if (nota >= 85) { risco = 'FORTE';      entradaPct = 0.20; }
            else if (nota >= 60) { risco = 'MEDIO'; entradaPct = 0.35; }
            else if (nota >= 40) { risco = 'FRACO'; entradaPct = 0.60; }
            else { risco = 'REPROVADO'; aprov = false; }

            if (downgrade)   risco += ' · DOWNGRADE';
            if (entradaAlta) risco += ' · ENTRADA TURBINADA';

            return {
                aprov: aprov, downgrade: downgrade, entradaAlta: entradaAlta, reprovado: !aprov,
                nota: nota, risco: risco, entradaPct: entradaPct, rendaEstimada: renda,
                taxa: 6, parcelas: 12, entrada: entAltaCalc || null,
                nomeCliente: primeiroNome, nomeCompleto: nomeCompleto,
                nomeDocPessoal: obj.nomeDocumentoPessoal || '',
                nomeRenda: obj.nomeComprovanteRenda || '',
                nomesBatem: obj.nomesBatem, confianca: confianca,
                perfil: obj.perfilCliente || '', analise: obj.analiseFinanceira || '',
                rascunho: obj.rascunhoCalculos || '', motivos: obj.motivosReprovacao || '',
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

    function gerarWpp(produto, en, np, vp, d) {
        if (!d.aprov) return '';
        if (d.downgrade)   return 'Ola '+d.nomeCliente+'! Boas noticias, liberamos credito pra voce! \u2705\n\nO '+produto+' ultrapassou sua margem ideal, MAS temos um limite mais acessivel aprovado AGORA! \ud83d\ude80\nTemos otimas opcoes no estoque que cabem no seu bolso!\nMe fala qual modelo te interessa \ud83d\udc47';
        if (d.entradaAlta) return 'Ola '+d.nomeCliente+', tudo bem? \ud83d\ude0a\ud83d\udcf2\nSeu cadastro foi avaliado na Workcell! \u2705\n\nPara liberar o aparelho e manter a parcela suave, o sistema calculou uma entrada de '+R$(en)+'.\nSua parcela fica em apenas '+np+'x de '+R$(vp)+'! \ud83d\udcc9\n\nVoce tem esse valor disponivel (FGTS, acerto, poupanca)? \ud83d\udc47';
        return 'Ola '+d.nomeCliente+', tudo bem? \ud83d\ude0a\ud83d\udcf2\nSeu cadastro foi APROVADO aqui na Workcell! \u2705\n\n\ud83d\udcf1 '+produto+'\n\ud83d\udcb0 Entrada: '+R$(en)+'\n\ud83d\udcb3 + '+np+'x de '+R$(vp)+' no boleto\n\n\u2714 Aparelho revisado e com garantia\nMe confirma aqui pra gente seguir com a liberacao \ud83d\udc47';
    }

    async function salvarFB(nome, produto, texto, d) {
        try {
            var fb=await import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js');
            var db=window._firebaseDB; if(!db)return;
            var now=Date.now();
            var resumoIA = d.aprov ? (d.rascunho || 'Aprovado conforme criterios.') : (d.motivos || 'Reprovado por risco financeiro.');
            await fb.push(fb.ref(db,SAVE_PATH),{
                nomeCliente:nome, produto:produto,
                decisao:d.reprovado?'REPROVADO':d.downgrade?'DOWNGRADE':d.entradaAlta?'ENTRADA_ALTA':'APROVADO',
                nota:d.nota, risco:d.risco, entrada:d.entrada||null, parcelas:d.parcelas||null,
                vparcela:d.vparcela||null, taxa:d.taxa||null, total:d.total||null,
                resumo: resumoIA, confianca: d.confianca||'ALTA',
                textoCompleto:texto, ts:now, expira:now+HIST_DAYS*86400000,
                operador:window.currentUserProfile||safeGet('ctwUserProfile')||'--'
            });
            var snap=await fb.get(fb.ref(db,SAVE_PATH));
            if(snap.exists()) snap.forEach(function(c){var v=c.val();if(v&&v.expira&&v.expira<now)fb.remove(fb.ref(db,SAVE_PATH+'/'+c.key));});
        } catch(e){}
    }

    function formatResult(texto, d, valorBase) {
        var nc = d.nota !== null ? (d.nota>=80 ? '#16a34a' : d.nota>=60 ? '#d97706' : d.nota>=40 ? '#f59e0b' : '#dc2626') : '#888';
        var html = '<h4 class="cs-rt">Perfil do Cliente: '+esc(d.nomeCompleto)+'</h4><p class="cs-rp">'+esc(d.perfil)+'</p><h4 class="cs-rt">Analise Financeira</h4><p class="cs-rp">'+esc(d.analise)+'</p>';
        if (d.reprovado && d.motivos) html += '<h4 class="cs-rt" style="color:#ef4444">Motivos da Reprovacao</h4><p class="cs-rp" style="color:#fca5a5">'+esc(d.motivos).replace(/\n/g,'<br>')+'</p>';
        if (d.rascunho) html += '<h4 class="cs-rt">Rascunho de Calculos</h4><p class="cs-rp" style="opacity:0.7;font-size:0.8em;">'+esc(d.rascunho).replace(/\n/g,'<br>')+'</p>';

        var riscoLabel = d.risco.split(' \u00b7 ')[0];
        var nota_html = '<div class="cs-nota-row"><div class="cs-nota-c" style="border-color:'+nc+';color:'+nc+';background:'+nc+'18">'+d.nota+'</div><div><div class="cs-nota-lbl">Pontuacao &middot; <span style="color:'+nc+';font-weight:800">'+riscoLabel+'</span></div>'+(d.rendaEstimada>0?'<div class="cs-nota-renda">\ud83d\udcb5 Renda estimada: <strong>'+R$(d.rendaEstimada)+'</strong></div>':'')+'</div></div>';

        // Alvo de Venda Ideal — menor entre teto de parcela e trava de renda
        var alvo_html = '';
        if (d.rendaEstimada > 0 && d.nota !== null && !d.reprovado) {
            var alvoPct   = d.nota >= 85 ? 0.30 : d.nota >= 60 ? 0.20 : 0.10;
            var alvoTeto  = d.rendaEstimada * alvoPct;
            var alvoFinan = alvoTeto * 8.4;
            var alvoMaxParcela = Math.floor((alvoFinan / (1 - d.entradaPct)) / 10) * 10;
            // Trava de multiplicador de renda por perfil
            var multRenda = d.nota >= 85 ? 3.0 : d.nota >= 60 ? 2.2 : 1.0;
            var alvoMaxRenda = Math.floor((d.rendaEstimada * multRenda) / 10) * 10;
            // Usa o menor dos dois limites
            var alvoMax = Math.min(alvoMaxParcela, alvoMaxRenda);
            // Identifica qual trava limitou
            var travaAtiva = alvoMaxRenda < alvoMaxParcela ? 'renda' : 'parcela';
            var alvoColor = d.nota >= 85 ? '#4ade80' : d.nota >= 60 ? '#fbbf24' : '#fb923c';
            var alvoSub = travaAtiva === 'renda'
                ? 'Limitado pela renda (' + multRenda + 'x = ' + R$(alvoMaxRenda) + ') &middot; entrada de ' + Math.round(d.entradaPct*100) + '%'
                : 'Parcela caberia em ' + Math.round(alvoPct*100) + '% da renda &middot; entrada de ' + Math.round(d.entradaPct*100) + '%';
            // Texto explicativo do tooltip
            var alvoNomeCliente = d.nomeCliente || 'este cliente';
            var alvoPerfilLabel = d.nota >= 85 ? 'FORTE' : d.nota >= 60 ? 'MEDIO' : 'FRACO';
            var alvoExplicacao = 'Recomendamos aparelhos ate ' + R$(alvoMax) + ' para ' + alvoNomeCliente +
                ', pois sua renda estimada e de ' + R$(d.rendaEstimada) + '. ' +
                'Com perfil ' + alvoPerfilLabel + ', o limite e de ' + multRenda + 'x a renda' +
                (travaAtiva === 'renda' ? ' — acima disso o risco de inadimplencia aumenta muito.' :
                ' — a parcela comprometeria ' + Math.round(alvoPct*100) + '% da renda mensal.');
            var alvoTooltipId = 'cs_alvo_tip_' + Date.now();
            alvo_html = '<div id="'+alvoTooltipId+'_wrap" style="position:relative;cursor:pointer" onclick="(function(el,id){'+
                'var tip=document.getElementById(id);'+
                'if(tip){var show=tip.style.opacity!=\'1\';tip.style.opacity=show?\'1\':\'0\';tip.style.pointerEvents=show?\'auto\':\'none\';'+
                'if(show)setTimeout(function(){tip.style.opacity=\'0\';tip.style.pointerEvents=\'none\';},4500);}'+
                '})(this,\''+alvoTooltipId+'\')">' +
                '<div style="display:flex;align-items:center;gap:10px;padding:9px 13px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08)">'+
                    '<i class="bi bi-bullseye" style="color:'+alvoColor+';font-size:1rem;flex-shrink:0"></i>'+
                    '<div style="flex:1">'+
                        '<div style="font-size:.58rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:rgba(255,255,255,.4)">Alvo de Venda Ideal <i class="bi bi-info-circle" style="font-size:.6rem;opacity:.5"></i></div>'+
                        '<div style="font-size:.88rem;font-weight:800;color:'+alvoColor+'">Aparelhos de ate '+R$(alvoMax)+'</div>'+
                        '<div style="font-size:.62rem;color:rgba(255,255,255,.4)">'+alvoSub+'</div>'+
                    '</div>'+
                '</div>'+
                '<div id="'+alvoTooltipId+'" style="opacity:0;pointer-events:none;transition:opacity .3s;position:absolute;top:0;left:0;right:0;z-index:10;background:rgba(15,20,40,.97);border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:11px 13px;font-size:.76rem;line-height:1.6;color:#e2e8f0;">'+
                    esc(alvoExplicacao)+
                '</div>'+
            '</div>';
        }


        var titularidade_html = '';
        if (d.nomeDocPessoal || d.nomeRenda) {
            var matchColor = d.nomesBatem === true ? '#4ade80' : d.nomesBatem === false ? '#f87171' : '#fbbf24';
            var matchIcon  = d.nomesBatem === true ? '\u2705' : d.nomesBatem === false ? '\ud83d\udea8' : '\u26a0\ufe0f';
            var matchLabel = d.nomesBatem === true ? 'Titularidade confirmada' : d.nomesBatem === false ? 'FRAUDE - nomes divergem' : 'Sem documento pessoal';
            titularidade_html =
                '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:11px;padding:10px 13px;display:flex;flex-direction:column;gap:5px;">'+
                    '<div style="font-size:.58rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.4)">Verificacao de Titularidade</div>'+
                    (d.nomeDocPessoal ? '<div style="font-size:.78rem;color:#e2e8f0">\ud83c\uddee\ud83c\udced <strong>Doc:</strong> '+esc(d.nomeDocPessoal)+'</div>' : '')+
                    (d.nomeRenda ? '<div style="font-size:.78rem;color:#e2e8f0">\ud83d\udcc4 <strong>Renda:</strong> '+esc(d.nomeRenda)+'</div>' : '')+
                    '<div style="font-size:.78rem;font-weight:800;color:'+matchColor+'">'+matchIcon+' '+matchLabel+'</div>'+
                '</div>';
        }

        var confianca_html = '';
        if (d.confianca === 'BAIXA') {
            confianca_html = '<div class="cs-alert" style="background:rgba(251,191,36,.08);border-color:rgba(251,191,36,.3);color:#fbbf24"><i class="bi bi-exclamation-triangle-fill" style="color:#fbbf24"></i><span><strong>Atencao:</strong> Foto do documento com qualidade baixa. Resultado pode ser impreciso. Peca uma foto melhor.</span></div>';
        } else if (d.confianca === 'MEDIA') {
            confianca_html = '<div class="cs-alert" style="background:rgba(251,191,36,.04);border-color:rgba(251,191,36,.15);color:rgba(251,191,36,.7)"><i class="bi bi-eye-fill" style="color:rgba(251,191,36,.7)"></i><span>Documento lido com qualidade media. Verifique o nome manualmente.</span></div>';
        }

        var banner = '';
        if (d.entradaAlta) banner = '<div class="cs-dec" style="background:rgba(245,158,11,.12);border:2px solid rgba(245,158,11,.4);color:#f59e0b"><i class="bi bi-exclamation-triangle-fill"></i> PLANO C \u2014 ENTRADA TURBINADA</div>';
        else if (d.downgrade) banner = '<div class="cs-dec" style="background:rgba(59,130,246,.12);border:2px solid rgba(59,130,246,.4);color:#60a5fa"><i class="bi bi-info-circle-fill"></i> PLANO B \u2014 LIMITE APROVADO</div>';
        else if (d.aprov) banner = '<div class="cs-dec cs-dec-yes"><i class="bi bi-check-circle-fill"></i> APROVADO \u2014 PODE VENDER</div>';
        else banner = '<div class="cs-dec cs-dec-no"><i class="bi bi-x-circle-fill"></i> REPROVADO \u2014 NAO VENDER</div>';

        if (!d.aprov) return '<div class="cs-ri">'+banner+confianca_html+titularidade_html+nota_html+alvo_html+'<div class="cs-rb">'+html+'</div></div>';

        var vn = valorBase || 0;
        var enBaseMin = Math.ceil(vn * d.entradaPct / 10) * 10;
        // Entrada turbinada: usa d.entrada (calculada pelo reavaliarDecisao), nao o % base
        var enTurb = d.entradaAlta && d.entrada ? Math.ceil(parseFloat(d.entrada)/10)*10 : enBaseMin;
        var enMin  = d.entradaAlta ? enTurb : enBaseMin;
        var en = enMin;
        var np = d.parcelas ? parseInt(d.parcelas) : 12, tx = d.taxa ? parseFloat(d.taxa) : 6;
        var vp = price(vn, en, np, tx), tt = en + vp * np;
        var initialWpp = gerarWpp(d._produto || 'Aparelho', en, np, vp, d);
        var wpp_block = '<div class="cs-wpp"><div class="cs-wpp-lbl"><i class="bi bi-whatsapp"></i> Mensagem pronta \u2014 toque para copiar</div><div class="cs-wpp-txt" id="cs_wpp_txt" title="Toque para copiar">'+esc(initialWpp).replace(/\n/g,'<br>')+'</div><div class="cs-wpp-cp-hint" id="cs_wpp_hint"><i class="bi bi-clipboard-fill"></i> Toque no texto acima para copiar</div></div>';
        if (d.downgrade) return '<div class="cs-ri">'+banner+confianca_html+titularidade_html+nota_html+alvo_html+wpp_block+'<div class="cs-rb">'+html+'</div></div>';
        var parcOpts = ''; for (var px=1; px<=12; px++) parcOpts += '<option value="'+px+'"'+(px===np?' selected':'')+'>'+px+'x</option>';
        var sim_grid = '<div class="cs-sim-grid"><div><label class="cs-lbl">Entrada (R$)</label><input class="cs-in" type="number" id="cs_en" value="'+en.toFixed(2)+'" step="10"></div><div><label class="cs-lbl">Parcelas</label><select class="cs-in" id="cs_np">'+parcOpts+'</select></div><div><label class="cs-lbl">Juros %am</label><input class="cs-in" type="number" id="cs_tx" value="'+tx.toFixed(1)+'" min="0" max="30" step="0.5"></div></div><div class="cs-pills" id="cs_pills"><div class="cs-pill'+(d.entradaAlta?' cs-pill-o':'')+'"> Entrada: <strong>'+R$(en)+'</strong></div><div class="cs-pill"> <strong>'+np+'x</strong> de <strong>'+R$(vp)+'</strong></div><div class="cs-pill cs-pill-j"> Juros: <strong>'+tx+'%am</strong></div><div class="cs-pill cs-pill-t"> Total: <strong>'+R$(tt)+'</strong></div></div>';
        var sim = (d.entradaAlta)
            ? '<div class="cs-sim cs-sim-orange"><div class="cs-sim-ttl"><i class="bi bi-lightning-charge-fill"></i> Entrada Turbinada</div><div class="cs-sim-aviso cs-sim-aviso-orange"><i class="bi bi-lock-fill"></i> Entrada minima travada em '+R$(enMin)+' ('+Math.round(enMin/vn*100)+'% do valor) — parcela cabe no orcamento</div>'+sim_grid+'</div>'
            : '<div class="cs-sim"><div class="cs-sim-ttl"><i class="bi bi-sliders"></i> Simular condicoes</div><div class="cs-sim-aviso"><i class="bi bi-lock-fill"></i> Entrada minima: '+Math.round(d.entradaPct*100)+'% = '+R$(enMin)+' | Perfil '+riscoLabel+'</div>'+sim_grid+'</div>';
        return '<div class="cs-ri">'+banner+confianca_html+titularidade_html+nota_html+alvo_html+sim+wpp_block+'<div class="cs-rb">'+html+'</div></div>';
    }

    async function abrirHist() {
        if(!document.getElementById('cs-reuso-css')){
            var s=document.createElement('style'); s.id='cs-reuso-css';
            s.textContent='.cs-btn-reuso{width:100%;padding:8px;border-radius:8px;border:1px solid rgba(139,92,246,.3);background:rgba(139,92,246,.08);color:#a78bfa;font-family:"Poppins",sans-serif;font-size:.72rem;font-weight:700;cursor:pointer;margin-top:8px;display:flex;align-items:center;justify-content:center;gap:6px;transition:all .15s}.cs-btn-reuso:active{background:rgba(139,92,246,.2);transform:scale(0.98)}';
            document.head.appendChild(s);
        }
        var ov=el('cs_hist_ov'); if(!ov)return; ov.classList.add('active');
        var list=el('cs_hist_list'); if(list)list.innerHTML='<div class="cs-hist-load"><i class="bi bi-hourglass-split"></i> Carregando...</div>';
        try {
            var fb=await import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js');
            var db=window._firebaseDB; if(!db){if(list)list.innerHTML='<div class="cs-hist-empty">Firebase nao disponivel</div>';return;}
            var snap=await fb.get(fb.ref(db,SAVE_PATH)), items=[];
            if(snap.exists()) snap.forEach(function(c){var v=c.val();if(v)items.push(Object.assign({id:c.key},v));});
            items=items.filter(function(i){return i.ts&&i.ts>(Date.now()-HIST_DAYS*86400000);}).sort(function(a,b){return(b.ts||0)-(a.ts||0);});
            window._histItems=items;
            if(!list)return;
            if(!items.length){list.innerHTML='<div class="cs-hist-empty">Nenhuma consulta recente</div>';return;}
            list.innerHTML=items.map(function(it,i){
                var ap=it.decisao==='APROVADO'||it.decisao==='ENTRADA_ALTA'||it.decisao==='DOWNGRADE';
                var dt=it.ts?new Date(it.ts).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'--';
                var tc=ap?'#4ade80':'#f87171', tags='';
                if(ap){if(it.entrada)tags+='<span class="cs-htag">Entrada: '+R$(it.entrada)+'</span>';if(it.vparcela)tags+='<span class="cs-htag">12x '+R$(it.vparcela)+'</span>';}
                var resumoLimpo=it.resumo?it.resumo.substring(0,120)+(it.resumo.length>120?'...':''):'Sem detalhes.';
                var btnReuso=ap?'<button class="cs-btn-reuso" data-i="'+i+'"><i class="bi bi-person-check-fill"></i> Reaproveitar Perfil (0 Tokens)</button>':'';
                return '<div class="cs-hitem" style="border-left:4px solid '+tc+'"><div class="cs-hrow1"><span class="cs-hnome">'+esc(it.nomeCliente)+'</span><span style="font-size:.65rem;font-weight:800;color:'+tc+'">'+(ap?'V APROVADO':'X NEGADO')+'</span></div><div class="cs-hprod" style="margin-bottom:4px">'+esc(it.produto)+'</div><div style="font-size:.68rem;color:rgba(255,255,255,0.5);font-style:italic;line-height:1.2;margin-bottom:8px">"'+esc(resumoLimpo)+'"</div><div class="cs-htags">'+tags+'</div><div class="cs-hfoot"><span>'+dt+'</span><span>Op: '+esc(it.operador)+'</span></div>'+btnReuso+'</div>';
            }).join('');
            list.querySelectorAll('.cs-btn-reuso').forEach(function(btn){btn.addEventListener('click',function(e){usarPerfilHistorico(parseInt(e.currentTarget.dataset.i));});});
        } catch(e){if(list)list.innerHTML='<div style="padding:16px;color:#f87171">Erro</div>';}
    }

    function usarPerfilHistorico(idx) {
        var it=window._histItems[idx];
        if(!it||!it.textoCompleto){alert('Dados antigos incompletos.');return;}
        var modal=el('cs_reuso_modal');
        if(!modal){
            modal=document.createElement('div');modal.id='cs_reuso_modal';
            modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:4000;display:flex;align-items:center;justify-content:center;padding:20px;';
            modal.innerHTML='<div style="background:#0b1325;border:1.5px solid rgba(139,92,246,.3);border-radius:16px;width:100%;max-width:380px;padding:20px;display:flex;flex-direction:column;gap:12px;box-shadow:0 10px 40px rgba(0,0,0,0.6)"><div style="font-size:.95rem;font-weight:800;color:#fff;display:flex;align-items:center;gap:8px"><i class="bi bi-person-check-fill" style="color:#a78bfa"></i> Recompra: <span id="cs_rm_nome" style="color:#a78bfa"></span></div><div style="font-size:.7rem;color:rgba(255,255,255,.5);margin-bottom:5px;line-height:1.4">Informe o novo produto e valor (0 Tokens).</div><div class="cs-fld"><label class="cs-lbl">Novo Produto</label><input type="text" class="cs-in" id="cs_rm_prod"></div><div class="cs-fld"><label class="cs-lbl">Valor (R$)</label><input type="number" class="cs-in" id="cs_rm_val" placeholder="Ex: 2500"></div><div style="display:flex;gap:10px;margin-top:10px"><button id="cs_rm_cancel" style="flex:1;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#fff;font-family:\'Poppins\',sans-serif;font-size:.8rem;font-weight:700;cursor:pointer">Cancelar</button><button id="cs_rm_ok" style="flex:1;padding:12px;border-radius:10px;border:none;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;font-family:\'Poppins\',sans-serif;font-size:.8rem;font-weight:700;cursor:pointer">Simular</button></div></div>';
            document.body.appendChild(modal);
            el('cs_rm_cancel').addEventListener('click',function(){el('cs_reuso_modal').style.display='none';});
        }
        el('cs_rm_nome').textContent=it.nomeCliente;el('cs_rm_prod').value=it.produto;el('cs_rm_val').value='';
        modal.style.display='flex';el('cs_rm_val').focus();
        var btnOk=el('cs_rm_ok'),novoBtnOk=btnOk.cloneNode(true);btnOk.parentNode.replaceChild(novoBtnOk,btnOk);
        novoBtnOk.addEventListener('click',function(){
            var p=el('cs_rm_prod').value.trim(),val=parseFloat((el('cs_rm_val').value||'0').replace(',','.'));
            if(!p||!val){alert('Preencha produto e valor.');return;}
            var d=extrair(it.textoCompleto);d._produto=p;
            // Reavalia viabilidade com o novo valor antes de mostrar
            reavaliarDecisao(d, val);
            _last={nome:it.nomeCliente,produto:p,valor:val,dados:d,entradaMin:Math.ceil(val*d.entradaPct/10)*10,docsHash:-1};
            if(el('cs_produto'))el('cs_produto').value=p;if(el('cs_valor'))el('cs_valor').value=val;
            el('cs_reuso_modal').style.display='none';el('cs_hist_ov').classList.remove('active');
            if(el('cs_btn_analisar'))el('cs_btn_analisar').classList.add('cs-h');
            if(el('cs_btn_duo'))el('cs_btn_duo').classList.remove('cs-h');
            if(el('cs_prog'))el('cs_prog').classList.add('cs-h');
            var res=el('cs_res');if(res){res.innerHTML=formatResult(it.textoCompleto,d,val);res.classList.remove('cs-h');}
            wireRes();if(res)res.scrollIntoView({behavior:'smooth',block:'start'});
        });
    }

    function resetUIState(){if(el('cs_btn_analisar'))el('cs_btn_analisar').classList.remove('cs-h');if(el('cs_btn_duo'))el('cs_btn_duo').classList.add('cs-h');}

    function renderDocsId(){
        var g=el('cs_docs_id');if(!g)return;
        if(!_docsId.length){g.innerHTML='';g.classList.add('cs-h');return;}
        g.classList.remove('cs-h');
        g.innerHTML=_docsId.map(function(d,i){return '<div class="cs-dt"><img src="'+d.dataUrl+'" alt=""><button class="cs-dt-rm cs-dt-rm-id" data-i="'+i+'"><i class="bi bi-x"></i></button></div>';}).join('');
        g.querySelectorAll('.cs-dt-rm-id').forEach(function(b){b.addEventListener('click',function(e){_docsId.splice(parseInt(e.currentTarget.dataset.i),1);_last=null;resetUIState();renderDocsId();setBtnState();});});
        updateCounterById();
    }

    function renderDocsRend(){
        var g=el('cs_docs_rend');if(!g)return;
        if(!_docsRend.length){g.innerHTML='';g.classList.add('cs-h');return;}
        g.classList.remove('cs-h');
        g.innerHTML=_docsRend.map(function(d,i){
            var thumb=d.dataUrl?'<img src="'+d.dataUrl+'" alt="">':'<div class="cs-dt-pdf"><i class="bi bi-file-earmark-pdf-fill"></i><span>'+(d.tipo==='texto_digital'?'PDF '+(d.paginas||'?')+'p':'PDF')+'</span></div>';
            return '<div class="cs-dt">'+thumb+'<button class="cs-dt-rm cs-dt-rm-rend" data-i="'+i+'"><i class="bi bi-x"></i></button></div>';
        }).join('');
        g.querySelectorAll('.cs-dt-rm-rend').forEach(function(b){b.addEventListener('click',function(e){_docsRend.splice(parseInt(e.currentTarget.dataset.i),1);_last=null;resetUIState();renderDocsRend();setBtnState();});});
        updateCounterByRend();
    }

    function updateCounterById(){var c=el('cs_counter_id');if(!c)return;var n=_docsId.length;c.textContent=n+'/'+MAX_DOCS_ID;c.style.color=n>=MAX_DOCS_ID?'#f87171':n>0?'#4ade80':'rgba(255,255,255,.35)';}
    function updateCounterByRend(){var c=el('cs_counter_rend');if(!c)return;var n=_docsRend.length;c.textContent=n+'/'+MAX_DOCS_RND+' arquivos';c.style.color=n>=MAX_DOCS_RND?'#f87171':n>0?'#4ade80':'rgba(255,255,255,.35)';}
    function setBtnState(){var canRun=_docsRend.length>0&&!_busy;if(el('cs_btn_analisar'))el('cs_btn_analisar').disabled=!canRun;if(el('cs_btn_nova'))el('cs_btn_nova').disabled=!canRun;}
    function setProg(msg,pct){el('cs_prog_lbl')&&(el('cs_prog_lbl').textContent=msg);el('cs_prog_bar')&&(el('cs_prog_bar').style.width=pct+'%');}

    var MAX_PDF_PGS_ID = 3; // PDF de documento pessoal: maximo 3 paginas (RG frente/verso/CNH)

    async function handleFilesId(files){
        for(var i=0;i<files.length;i++){
            var f=files[i];
            if(_docsId.length>=MAX_DOCS_ID){window.showCustomModal&&window.showCustomModal({message:'Maximo '+MAX_DOCS_ID+' fotos de documento pessoal.'});break;}
            if(f.type.startsWith('image/')){
                var b64=await resizeToBase64(f);
                if(b64)_docsId.push({base64:b64,dataUrl:URL.createObjectURL(f)});
            } else if(f.type==='application/pdf'||f.name.toLowerCase().endsWith('.pdf')){
                // Verifica quantas paginas tem ANTES de processar
                var numPags = 0;
                try {
                    if(!window.pdfjsLib) await new Promise(function(ok,fail){var s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';s.onload=ok;s.onerror=fail;document.head.appendChild(s);});
                    if(window.pdfjsLib&&!window.pdfjsLib.GlobalWorkerOptions.workerSrc)window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                    var ab=await f.arrayBuffer();
                    var pdfDoc=await window.pdfjsLib.getDocument({data:ab}).promise;
                    numPags=pdfDoc.numPages;
                } catch(e){}
                if(numPags>MAX_PDF_PGS_ID){
                    window.showCustomModal&&window.showCustomModal({message:'Este PDF tem '+numPags+' paginas. Documentos pessoais (RG/CNH) tem no maximo '+MAX_PDF_PGS_ID+' paginas. Coloque extratos e holerites na secao COMPROVANTE DE RENDA.'});
                    continue;
                }
                // PDF ok: usa so a primeira pagina como imagem
                var imgs=await pdfToImages(f);
                if(imgs.length>0&&_docsId.length<MAX_DOCS_ID)_docsId.push({base64:imgs[0].base64,dataUrl:imgs[0].dataUrl});
            }
        }
        _last=null;resetUIState();renderDocsId();setBtnState();
    }

    async function handleFilesRend(files){
        for(var i=0;i<files.length;i++){
            var f=files[i];
            if(_docsRend.length>=MAX_DOCS_RND){window.showCustomModal&&window.showCustomModal({message:'Maximo atingido.'});break;}
            if(f.type.startsWith('image/')){var b=await resizeToBase64(f);if(b)_docsRend.push({dataUrl:URL.createObjectURL(f),base64:b,tipo:'imagem'});}
            else if(f.type==='application/pdf'||f.name.toLowerCase().endsWith('.pdf')){
                var resultado=await extrairTextoPdfDigital(f);
                if(resultado.ehDigital&&resultado.textos.join('').trim().length>100){
                    if(_docsRend.length<MAX_DOCS_RND)
                        _docsRend.push({dataUrl:null,base64:null,tipo:'texto_digital',textos:resultado.textos,paginas:resultado.textos.length,nome:f.name});
                } else {
                    var imgs=await pdfToImages(f);
                    imgs.forEach(function(im){if(_docsRend.length<MAX_DOCS_RND)_docsRend.push({dataUrl:im.dataUrl,base64:im.base64,tipo:'imagem'});});
                }
            }
        }
        _last=null;resetUIState();renderDocsRend();setBtnState();
    }

    function uploadId(capture,mode){var inp=document.createElement('input');inp.type='file';inp.accept=(mode==='pdf')?'application/pdf,.pdf':'image/*,application/pdf';inp.multiple=true;if(capture&&capture!==false)inp.capture='environment';inp.onchange=function(e){handleFilesId(e.target.files);};inp.click();}
    function uploadRend(accept,capture){var inp=document.createElement('input');inp.type='file';inp.accept=accept||'image/*,application/pdf';inp.multiple=true;if(capture)inp.capture='environment';inp.onchange=function(e){handleFilesRend(e.target.files);};inp.click();}

    function openOverlay(){var ov=el('cs_ov');if(!ov)return;ov.classList.add('active');_docsId=[];_docsRend=[];_busy=false;_last=null;if(el('cs_produto'))el('cs_produto').value='';if(el('cs_valor'))el('cs_valor').value='';el('cs_res').classList.add('cs-h');el('cs_prog').classList.add('cs-h');resetUIState();renderDocsId();renderDocsRend();setBtnState();}
    function closeOverlay(){el('cs_ov')&&el('cs_ov').classList.remove('active');}

    async function executar(){
        if(_busy)return;
        var key=await getGroqKey();if(!key){alert('Chave nao configurada.');return;}
        var prod=el('cs_produto').value.trim(),val=parseFloat((el('cs_valor').value||'0').replace(',','.'))||0;
        if(!prod||!val){alert('Preencha produto e valor.');return;}
        if(_docsRend.length===0){window.showCustomModal&&window.showCustomModal({message:'Adicione ao menos um comprovante de renda.'});return;}
        if(_docsId.length===0){window.showCustomModal&&window.showCustomModal({message:'Sem documento pessoal. A verificacao de titularidade sera ignorada.'});}

        _busy=true;setBtnState();el('cs_prog').classList.remove('cs-h');el('cs_res').classList.add('cs-h');

        try {
            // Rota A: PDFs digitais (extratos do app bancario) — texto limpo, SEM filtro OCR
            var textosDigitaisRaw=[];
            _docsRend.filter(function(d){return d.tipo==='texto_digital';}).forEach(function(d){
                var combinado=(d.textos||[d.texto||'']).join('\n').substring(0,6000);
                textosDigitaisRaw.push('=== '+(d.nome||'Extrato')+' ('+(d.paginas||1)+'p) ===\n'+combinado);
            });

            // Rota B: imagens e PDFs escaneados — OCR paralelo + filtro de linhas relevantes
            var docsParaOCR=_docsRend.filter(function(d){return d.tipo==='imagem'&&d.base64;});
            var textosOCR=[];
            if(docsParaOCR.length>0){
                setProg('OCR nos comprovantes...',10);
                var ocrBrutos=await tesseractOCR(docsParaOCR);
                var filtrado=filtrarLinhasRelevantes(ocrBrutos);
                textosOCR.push(filtrado||ocrBrutos.join('\n\n').substring(0,6000));
            }

            setProg('Preparando analise...',58);
            var partes=[];
            if(textosDigitaisRaw.length)partes.push('=== EXTRATOS DIGITAIS ===\n'+textosDigitaisRaw.join('\n\n'));
            if(textosOCR.length)partes.push('=== EXTRATOS OCR ===\n'+textosOCR.join('\n\n'));
            var textoRendaFiltrado=partes.join('\n\n').substring(0,12000);

            setProg('IA analisando (visao + texto)...',65);
            var resp=await groqCallHibrido(_docsId,textoRendaFiltrado,buildPrompt(prod,val),key);

            setProg('Finalizando...',90);
            var d=extrair(resp);d._produto=prod;
            // Reavalia com a matemática local ANTES de salvar e renderizar
            reavaliarDecisao(d, val);
            var nomeExtraido=d.nomeCompleto;
            _last={nome:nomeExtraido,produto:prod,valor:val,dados:d,entradaMin:Math.ceil(val*d.entradaPct/10)*10,docsHash:_docsRend.length};
            await salvarFB(nomeExtraido,prod,resp,d);
            setProg('Pronto!',100);
            el('cs_prog').classList.add('cs-h');
            el('cs_res').innerHTML=formatResult(resp,d,val);
            el('cs_res').classList.remove('cs-h');
            el('cs_res').scrollIntoView({behavior:'smooth',block:'start'});
            el('cs_btn_analisar').classList.add('cs-h');
            el('cs_btn_duo').classList.remove('cs-h');
            wireRes();
        } catch(e){alert('Erro: '+e.message);el('cs_prog').classList.add('cs-h');}
        finally{_busy=false;setBtnState();}
    }

    // ── Motor Matemático Offline: reavalia decisão sem chamar a API ──
    function reavaliarDecisao(d, novoValor) {
        // Se já era reprovado definitivo ou renda desconhecida, mantém
        if (d.reprovado || !(d.rendaEstimada > 0)) return d;

        // Teto da parcela conforme nota
        var tetoPct = d.nota >= 85 ? 0.30 : d.nota >= 60 ? 0.20 : 0.10;
        var teto    = d.rendaEstimada * tetoPct;

        // Entrada mínima (arredonda para dezena superior)
        var enMin   = Math.ceil(novoValor * d.entradaPct / 10) * 10;
        var saldo   = novoValor - enMin;
        var parcela = saldo / 8.4; // fator fixo 12x a 6%am

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
            var entTurb = novoValor - (teto * 8.4);
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
        var rascParc = R$(parcela) + ' [(R$ ' + novoValor.toFixed(2) + ' - R$ ' + enMin.toFixed(2) + ') / 8,4]';
        var rascStatus = parcela <= teto ? 'DENTRO do teto ✔' : 'ACIMA do teto ⚠️';
        var rascExtra = '';
        if (d.entradaAlta) rascExtra = '\nEntrada turbinada necessaria: R$ ' + d.entrada.toFixed(2);
        if (d.downgrade) rascExtra = '\nEntrada turbinada surreal (>80% do valor) → DOWNGRADE';
        // Calcula o alvo para incluir no rascunho
        var rascMultRenda = d.nota >= 85 ? 3.0 : d.nota >= 60 ? 2.2 : 1.0;
        var rascAlvoMaxParcela = Math.floor((teto * 8.4 / (1 - d.entradaPct)) / 10) * 10;
        var rascAlvoMaxRenda   = Math.floor((d.rendaEstimada * rascMultRenda) / 10) * 10;
        var rascAlvoFinal      = Math.min(rascAlvoMaxParcela, rascAlvoMaxRenda);
        var rascAlvoMotivo     = rascAlvoMaxRenda < rascAlvoMaxParcela
            ? 'limitado pela trava de ' + rascMultRenda + 'x a renda (' + R$(rascAlvoMaxRenda) + ')'
            : 'limitado pelo teto de parcela (' + R$(rascAlvoMaxParcela) + ')';
        d.rascunho = 'Renda: ' + R$(d.rendaEstimada) + ' | Teto parcela: ' + rascTeto + '\n' +
            'Parcela base: ' + rascParc + ' = ' + rascStatus + rascExtra + '\n' +
            'Alvo ideal: ate ' + R$(rascAlvoFinal) + ' (' + rascAlvoMotivo + ')';

        return d;
    }

        function recalcularLocal(){
        if(!_last||!_last.dados)return;
        var prod=el('cs_produto').value.trim(),val=parseFloat((el('cs_valor').value||'0').replace(',','.'))||0;
        if(!prod||!val){alert('Preencha produto e valor.');return;}
        _last.produto=prod;_last.valor=val;_last.dados._produto=prod;
        // Reavalia a viabilidade com o novo valor ANTES de renderizar
        reavaliarDecisao(_last.dados, val);
        _last.entradaMin=Math.ceil(val*_last.dados.entradaPct/10)*10;
        el('cs_res').innerHTML=formatResult('',_last.dados,val);
        wireRes();el('cs_res').scrollIntoView({behavior:'smooth',block:'start'});
    }

    function copiarWpp(){var t=el('cs_wpp_txt').innerText;if(!t)return;if(navigator.clipboard){navigator.clipboard.writeText(t).then(function(){el('cs_wpp_hint').innerHTML='<i class="bi bi-check-lg"></i> Copiado!';setTimeout(function(){el('cs_wpp_hint').innerHTML='<i class="bi bi-clipboard-fill"></i> Toque no texto acima para copiar';},1500);});}}

    function wireRes(){
        if(!_last)return;
        var d=_last.dados,vn=_last.valor,produto=_last.produto;
        // Trava correta: turbinada quando entradaAlta, base caso contrario
        var enMin = (d.entradaAlta && d.entrada) ? Math.ceil(parseFloat(d.entrada)/10)*10 : _last.entradaMin;
        var wt=el('cs_wpp_txt');if(wt){var wt2=wt.cloneNode(true);wt.parentNode.replaceChild(wt2,wt);wt2.addEventListener('click',copiarWpp);}
        if(!d||d.downgrade||!d.aprov)return;
        // recalcular: aceita qualquer valor enquanto digita, corrige só no blur
        function recalcular(forcarTrava){
            var enEl=el('cs_en'),npEl=el('cs_np'),txEl=el('cs_tx');if(!enEl||!npEl||!txEl)return;
            var enRaw=parseFloat(enEl.value);
            // Durante digitacao (forcarTrava=false): se campo vazio ou zero nao recalcula
            if(!forcarTrava && (isNaN(enRaw)||enRaw<=0)) return;
            var en=isNaN(enRaw)?enMin:enRaw;
            var np=parseInt(npEl.value)||1,tx=parseFloat(txEl.value)||0;
            // Trava de minimo apenas quando forcarTrava=true (blur/change) ou se tentou ir abaixo
            if(forcarTrava && en<enMin){en=enMin;enEl.value=enMin.toFixed(2);}
            if(en>=vn){en=vn-10;enEl.value=en.toFixed(2);}
            var vp=price(vn,en,np,tx),tt=en+vp*np;
            var pills=el('cs_pills');
            if(pills)pills.innerHTML='<div class="cs-pill'+(d.entradaAlta?' cs-pill-o':'')+'"> Entrada: <strong>'+R$(en)+'</strong></div><div class="cs-pill"> <strong>'+np+'x</strong> de <strong>'+R$(vp)+'</strong></div><div class="cs-pill cs-pill-j"> Juros: <strong>'+tx+'%am</strong></div><div class="cs-pill cs-pill-t"> Total: <strong>'+R$(tt)+'</strong></div>';
            var novoWpp=gerarWpp(produto,en,np,vp,d);var wEl=el('cs_wpp_txt');if(wEl)wEl.innerHTML=esc(novoWpp).replace(/\n/g,'<br>');
        }
        ['cs_np','cs_tx'].forEach(function(id){var i=el(id);if(i){var ni=i.cloneNode(true);i.parentNode.replaceChild(ni,i);ni.addEventListener('change',function(){recalcular(true);});}});
        var enElW=el('cs_en');if(enElW){var newEnEl=enElW.cloneNode(true);enElW.parentNode.replaceChild(newEnEl,enElW);
            newEnEl.addEventListener('input',function(){recalcular(false);});
            newEnEl.addEventListener('blur',function(){recalcular(true);});}
        recalcular(true);
    }

    function injectCSS(){
        if(el('cs-st'))return;
        var s=document.createElement('style');s.id='cs-st';
        s.textContent='#cs_ov{display:none;position:fixed;inset:0;z-index:3000;background:var(--bg-color,#0b1325);flex-direction:column;overflow:hidden}#cs_ov.active{display:flex}.cs-hdr{display:flex;align-items:center;gap:10px;padding:12px 14px 10px;flex-shrink:0;border-bottom:1px solid rgba(255,255,255,.06)}.cs-hdr-ico{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,rgba(139,92,246,.28),rgba(239,68,68,.22));display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0}.cs-hdr-ttl{font-size:.93rem;font-weight:800;color:var(--text-color,#fff)}.cs-hdr-sub{font-size:.59rem;color:var(--text-secondary,rgba(255,255,255,.5))}.cs-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px 14px 100px;display:flex;flex-direction:column;gap:13px}.cs-sec{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:15px;padding:13px}.cs-sec-ttl{font-size:.58rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--primary-color,#7c3aed);margin-bottom:10px;display:flex;align-items:center;gap:6px}.cs-counter{font-size:.62rem;font-weight:700;margin-left:auto;color:rgba(255,255,255,.35);transition:color .2s}.cs-fld{margin-bottom:10px}.cs-fld:last-child{margin-bottom:0}.cs-lbl{font-size:.63rem;font-weight:600;color:var(--text-secondary,rgba(255,255,255,.5));margin-bottom:5px;display:block}.cs-row2{display:grid;grid-template-columns:1fr 120px;gap:10px;align-items:end}.cs-in{width:100%;background:rgba(0,0,0,.3);border:1.5px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 12px;color:var(--text-color,#fff);font-family:\'Poppins\',sans-serif;font-size:.86rem;outline:none;box-sizing:border-box;transition:border-color .18s}.cs-in:focus{border-color:var(--primary-color,#7c3aed)}select.cs-in{appearance:none;-webkit-appearance:none;cursor:pointer}.cs-uz{border:2px dashed rgba(255,255,255,.13);border-radius:13px;padding:14px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s}.cs-uz-id{border-color:rgba(74,222,128,.2)}.cs-uz-id:hover{border-color:rgba(74,222,128,.5);background:rgba(74,222,128,.04)}.cs-uz-rend{border-color:rgba(139,92,246,.2)}.cs-uz-rend:hover{border-color:rgba(139,92,246,.5);background:rgba(139,92,246,.04)}.cs-uz-ico{font-size:1.5rem;margin-bottom:4px;opacity:.8}.cs-uz-txt{font-size:.78rem;font-weight:600;color:var(--text-color,#fff);margin-bottom:2px}.cs-uz-sub{font-size:.6rem;color:var(--text-secondary,rgba(255,255,255,.45))}.cs-ubtns{display:flex;gap:7px;margin-top:8px}.cs-ubtn{flex:1;padding:8px 6px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:var(--text-color,#fff);font-family:\'Poppins\',sans-serif;font-size:.68rem;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;transition:background .14s}.cs-ubtn:active{background:rgba(139,92,246,.2)}.cs-docs{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.cs-dt{position:relative;width:64px;height:64px;border-radius:10px;overflow:hidden;border:1.5px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04)}.cs-dt img{width:100%;height:100%;object-fit:cover}.cs-dt-pdf{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:#f87171;font-size:1.3rem}.cs-dt-pdf span{font-size:.5rem;font-weight:700;color:#f87171}.cs-dt-rm{position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,.78);border:none;color:#fff;font-size:.6rem;cursor:pointer;display:flex;align-items:center;justify-content:center}.cs-btn-analisar{width:100%;padding:15px;border-radius:14px;border:none;background:linear-gradient(135deg,#7c3aed,#b91c1c);color:#fff;font-family:\'Poppins\',sans-serif;font-size:.93rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 20px rgba(139,92,246,.3);transition:opacity .18s,transform .12s}.cs-btn-analisar:active{transform:scale(.98)}.cs-btn-analisar:disabled{opacity:.38;cursor:not-allowed}.cs-btn-hist{padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:var(--text-secondary,rgba(255,255,255,.5));font-family:\'Poppins\',sans-serif;font-size:.73rem;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;transition:background .14s;white-space:nowrap}.cs-btn-hist:active{background:rgba(255,255,255,.08)}.cs-prog{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:13px}.cs-prog-lbl{font-size:.74rem;font-weight:600;color:var(--text-secondary,rgba(255,255,255,.6));margin-bottom:8px;display:flex;align-items:center;gap:7px}.cs-prog-lbl::before{content:\'\';width:10px;height:10px;border-radius:50%;border:2px solid var(--primary-color,#7c3aed);border-top-color:transparent;animation:cs-spin .7s linear infinite;flex-shrink:0}@keyframes cs-spin{to{transform:rotate(360deg)}}.cs-prog-trk{height:5px;background:rgba(255,255,255,.08);border-radius:99px;overflow:hidden}.cs-prog-bar{height:100%;background:linear-gradient(90deg,#7c3aed,#b91c1c);border-radius:99px;transition:width .4s ease;width:0%}.cs-res{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:15px;padding:15px;font-size:.82rem;line-height:1.7;color:var(--text-color,#fff)}.cs-ri{display:flex;flex-direction:column;gap:12px}.cs-dec{display:flex;align-items:center;gap:10px;padding:13px 16px;border-radius:12px;font-size:1rem;font-weight:800}.cs-dec-yes{background:rgba(74,222,128,.12);border:2px solid rgba(74,222,128,.4);color:#4ade80}.cs-dec-no{background:rgba(239,68,68,.12);border:2px solid rgba(239,68,68,.4);color:#f87171}.cs-nota-row{display:flex;align-items:center;gap:12px;padding:4px 0}.cs-nota-c{width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.3rem;font-weight:800;flex-shrink:0;border:3px solid}.cs-nota-lbl{font-size:.67rem;color:var(--text-secondary)}.cs-nota-risco{font-weight:800;font-size:.84rem}.cs-alert{display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border-radius:9px;background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);font-size:.78rem;color:#fca5a5;margin:3px 0;line-height:1.5}.cs-alert i{color:#f87171;flex-shrink:0;margin-top:2px;font-size:.74rem}.cs-alert-red{background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.35)}.cs-alert-green{background:rgba(74,222,128,.07);border-color:rgba(74,222,128,.25);color:#86efac}.cs-alert-green i{color:#4ade80}.cs-sim{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:13px;padding:13px}.cs-sim-ttl{font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--primary-color,#a78bfa);margin-bottom:8px;display:flex;align-items:center;gap:6px}.cs-sim-aviso{font-size:.65rem;color:#fbbf24;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.2);border-radius:8px;padding:6px 10px;margin-bottom:10px;display:flex;align-items:center;gap:6px}.cs-sim-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px}.cs-pills{display:flex;flex-wrap:wrap;gap:6px}.cs-pill{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:99px;padding:5px 13px;font-size:.76rem;color:var(--text-color,#fff)}.cs-pill-j{background:rgba(251,191,36,.08);border-color:rgba(251,191,36,.25);color:#fbbf24}.cs-pill-t{background:rgba(59,130,246,.08);border-color:rgba(59,130,246,.25);color:#60a5fa}.cs-wpp{background:rgba(37,211,102,.06);border:1px solid rgba(37,211,102,.2);border-radius:12px;padding:13px;display:flex;flex-direction:column;gap:9px}.cs-wpp-lbl{font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#25d366;display:flex;align-items:center;gap:6px}.cs-wpp-txt{font-size:.83rem;line-height:1.7;color:var(--text-color,#fff);background:rgba(0,0,0,.2);border-radius:9px;padding:11px;white-space:pre-wrap;user-select:all;cursor:pointer;border:1.5px solid transparent;transition:background .18s,border-color .18s}.cs-wpp-txt:hover{background:rgba(37,211,102,.08);border-color:rgba(37,211,102,.3)}.cs-wpp-txt:active{background:rgba(37,211,102,.18)}.cs-wpp-cp-hint{display:flex;align-items:center;justify-content:center;gap:7px;padding:8px 16px;border-radius:9px;border:1px solid rgba(37,211,102,.2);background:rgba(37,211,102,.06);color:rgba(37,211,102,.7);font-family:\'Poppins\',sans-serif;font-size:.72rem;font-weight:600;transition:color .3s}.cs-rt{font-size:.86rem;font-weight:800;color:var(--primary-color,#a78bfa);margin:13px 0 5px;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,.06)}.cs-rp{margin:5px 0}.cs-rb ul,.cs-rb li{list-style:disc;padding-left:16px;margin:4px 0}#cs_hist_ov{display:none;position:fixed;inset:0;z-index:3100;background:var(--bg-color,#0b1325);flex-direction:column;overflow:hidden}#cs_hist_ov.active{display:flex}.cs-hhdr{display:flex;align-items:center;gap:11px;padding:12px 14px 10px;flex-shrink:0;border-bottom:1px solid rgba(255,255,255,.06)}.cs-hhdr-ttl{font-size:.92rem;font-weight:800;color:var(--text-color,#fff);flex:1}.cs-hhdr-sub{font-size:.61rem;color:var(--text-secondary,rgba(255,255,255,.4))}.cs-hbody{flex:1;overflow-y:auto;padding:12px 13px 80px;display:flex;flex-direction:column;gap:9px}.cs-hitem{border:1px solid;border-radius:13px;padding:11px 13px;display:flex;flex-direction:column;gap:5px}.cs-hrow1{display:flex;justify-content:space-between;align-items:center}.cs-hnome{font-size:.87rem;font-weight:700;color:var(--text-color,#fff)}.cs-hprod{font-size:.73rem;color:var(--text-secondary,rgba(255,255,255,.55))}.cs-hnota{font-size:.67rem;color:var(--text-secondary,rgba(255,255,255,.4))}.cs-htags{display:flex;flex-wrap:wrap;gap:5px;margin-top:2px}.cs-htag{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:99px;padding:3px 10px;font-size:.67rem;color:var(--text-color,#fff)}.cs-htag-j{background:rgba(251,191,36,.08);border-color:rgba(251,191,36,.2);color:#fbbf24}.cs-hfoot{display:flex;justify-content:space-between;font-size:.59rem;color:rgba(255,255,255,.3);margin-top:3px}.cs-hist-empty,.cs-hist-load{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:60px 20px;color:var(--text-secondary,rgba(255,255,255,.4));font-size:.83rem;text-align:center}.cs-hist-empty i,.cs-hist-load i{font-size:2.4rem;opacity:.4}.ctw-card.c-rose{background:rgba(225,29,72,.09);border-color:rgba(225,29,72,.2)}.ctw-card.c-rose .ctw-card-icon{background:rgba(225,29,72,.16);color:#fb7185}.ctw-card.c-rose .ctw-card-title{color:#fca5a5}.ctw-card.c-rose .ctw-card-sub{color:#fca5a5}.ctw-card.c-rose:hover{background:rgba(225,29,72,.14);border-color:rgba(225,29,72,.38);transform:translateY(-3px)}[data-theme="light"] .ctw-card.c-rose{background:rgba(225,29,72,.07)}.cs-h{display:none!important}.cs-dec-orange{background:rgba(249,115,22,.12);border:2px solid rgba(249,115,22,.45);color:#fb923c}.cs-dec-blue{background:rgba(59,130,246,.12);border:2px solid rgba(59,130,246,.45);color:#60a5fa}.cs-nota-renda{font-size:.72rem;color:var(--text-secondary,rgba(255,255,255,.55));margin-top:3px}.cs-nota-renda strong{color:var(--text-color,#fff)}.cs-sim-orange{border-color:rgba(249,115,22,.25)!important}.cs-sim-aviso-orange{background:rgba(249,115,22,.08)!important;border-color:rgba(249,115,22,.25)!important;color:#fb923c!important}.cs-pill-o{background:rgba(249,115,22,.1);border-color:rgba(249,115,22,.3);color:#fb923c}';
        document.head.appendChild(s);
    }

    function injectHTML(){
        if(el('cs_ov'))return;
        var o1=document.createElement('div');o1.id='cs_ov';
        o1.innerHTML=
        '<div class="cs-hdr">'+
            '<button class="btn-back" id="cs_close" style="flex-shrink:0"><i class="bi bi-arrow-left"></i></button>'+
            '<div class="cs-hdr-ico">\ud83e\udde0</div>'+
            '<div style="flex:1"><div class="cs-hdr-ttl">CreditoScan</div><div class="cs-hdr-sub">Analise de credito via IA</div></div>'+
            '<button class="cs-btn-hist" id="cs_hist_open"><i class="bi bi-clock-history"></i> Historico</button>'+
        '</div>'+
        '<div class="cs-body">'+
            '<div class="cs-sec">'+
                '<div class="cs-sec-ttl"><i class="bi bi-phone-fill"></i> Produto da Venda</div>'+
                '<div class="cs-fld"><div class="cs-row2">'+
                    '<div style="flex:1"><label class="cs-lbl">Produto</label><input type="text" class="cs-in" id="cs_produto" placeholder="Ex: iPhone 13" maxlength="80"></div>'+
                    '<div><label class="cs-lbl">Valor (R$)</label><input type="number" class="cs-in" id="cs_valor" placeholder="2200" min="1" step="1"></div>'+
                '</div></div>'+
            '</div>'+
            '<div class="cs-sec">'+
                '<div class="cs-sec-ttl" style="color:#4ade80"><i class="bi bi-person-badge-fill"></i> Documento Pessoal (RG/CNH)<span class="cs-counter" id="cs_counter_id" style="color:rgba(255,255,255,.35)">0/'+MAX_DOCS_ID+'</span></div>'+
                '<div class="cs-uz cs-uz-id" id="cs_uz_id"><div class="cs-uz-ico">\ud83c\uddee\ud83c\udced</div><div class="cs-uz-txt">Foto do RG ou CNH do cliente</div><div class="cs-uz-sub">Opcional \u00b7 Ativa verificacao anti-fraude \u00b7 JPG PNG PDF</div></div>'+
                '<div class="cs-ubtns"><button class="cs-ubtn" id="cs_id_cam"><i class="bi bi-camera-fill"></i> Camera</button><button class="cs-ubtn" id="cs_id_gal"><i class="bi bi-image-fill"></i> Galeria</button><button class="cs-ubtn" id="cs_id_pdf"><i class="bi bi-file-earmark-pdf-fill"></i> PDF</button></div>'+
                '<div class="cs-docs cs-h" id="cs_docs_id"></div>'+
            '</div>'+
            '<div class="cs-sec">'+
                '<div class="cs-sec-ttl"><i class="bi bi-file-earmark-text-fill"></i> Comprovante de Renda<span class="cs-counter" id="cs_counter_rend" style="color:rgba(255,255,255,.35)">0/'+MAX_DOCS_RND+' arquivos</span></div>'+
                '<div class="cs-uz cs-uz-rend" id="cs_uz_rend"><div class="cs-uz-ico">\ud83d\udcc4</div><div class="cs-uz-txt">Extratos bancarios e holerites</div><div class="cs-uz-sub">Obrigatorio \u00b7 PDF digital detectado automaticamente \u00b7 JPG PNG PDF</div></div>'+
                '<div class="cs-ubtns"><button class="cs-ubtn" id="cs_rend_cam"><i class="bi bi-camera-fill"></i> Camera</button><button class="cs-ubtn" id="cs_rend_gal"><i class="bi bi-image-fill"></i> Galeria</button><button class="cs-ubtn" id="cs_rend_pdf"><i class="bi bi-file-earmark-pdf-fill"></i> PDF</button></div>'+
                '<div class="cs-docs cs-h" id="cs_docs_rend"></div>'+
            '</div>'+
            '<div id="cs_action_area" style="display:flex;flex-direction:column;gap:10px;">'+
                '<button class="cs-btn-analisar" id="cs_btn_analisar" disabled><i class="bi bi-cpu-fill"></i> Analisar Credito</button>'+
                '<div id="cs_btn_duo" class="cs-h" style="display:flex;gap:10px;">'+
                    '<button class="cs-btn-analisar" id="cs_btn_recalc" style="background:rgba(139,92,246,.15);border:1.5px dashed rgba(139,92,246,.4);color:#a78bfa;flex:1.2;font-size:.75rem;padding:10px;height:auto;"><div style="display:flex;flex-direction:column;align-items:center;"><span style="font-size:.85rem;margin-bottom:2px;font-weight:800"><i class="bi bi-arrow-repeat"></i> Atualizar Produto</span><span style="font-weight:normal;font-size:.65rem">0 Tokens</span></div></button>'+
                    '<button class="cs-btn-analisar" id="cs_btn_nova" style="flex:1;font-size:.75rem;padding:10px;height:auto;"><div style="display:flex;flex-direction:column;align-items:center;"><span style="font-size:.85rem;margin-bottom:2px;font-weight:800"><i class="bi bi-stars"></i> Nova Analise</span><span style="font-weight:normal;font-size:.65rem">Gastar Token</span></div></button>'+
                '</div>'+
            '</div>'+
            '<div class="cs-prog cs-h" id="cs_prog"><div class="cs-prog-lbl" id="cs_prog_lbl">Processando...</div><div class="cs-prog-trk"><div class="cs-prog-bar" id="cs_prog_bar"></div></div></div>'+
            '<div class="cs-res cs-h" id="cs_res"></div>'+
        '</div>';
        document.body.appendChild(o1);
        var o2=document.createElement('div');o2.id='cs_hist_ov';
        o2.innerHTML='<div class="cs-hhdr"><button class="btn-back" id="cs_hist_close" style="flex-shrink:0"><i class="bi bi-arrow-left"></i></button><span class="cs-hhdr-ttl">Historico de Consultas</span><span class="cs-hhdr-sub">ultimos 30 dias</span></div><div class="cs-hbody" id="cs_hist_list"></div>';
        document.body.appendChild(o2);
    }

    function injectMenuBtns(){
        var mc=el('menuClassic');
        if(mc&&!el('goCS1')){var b=document.createElement('button');b.className='btn-menu';b.id='goCS1';b.innerHTML='<i class="bi bi-cpu-fill"></i> CreditoScan - Analise IA';b.addEventListener('click',openOverlay);mc.appendChild(b);}
        var goCS2=el('goCS2');
        if(goCS2&&!goCS2._csListenerOk){goCS2.addEventListener('click',openOverlay);goCS2._csListenerOk=true;}
        else if(!goCS2){var mg=el('menuCards');if(mg){var b2=document.createElement('button');b2.className='ctw-card c-rose';b2.id='goCS2';b2.innerHTML='<div class="ctw-card-icon"><i class="bi bi-cpu-fill"></i></div><span class="ctw-card-title">CreditoScan</span><span class="ctw-card-sub">Analise de credito IA</span>';b2.addEventListener('click',openOverlay);mg.appendChild(b2);}}
    }

    function wireEvents(){
        el('cs_close')      &&el('cs_close').addEventListener('click',closeOverlay);
        el('cs_hist_open')  &&el('cs_hist_open').addEventListener('click',abrirHist);
        el('cs_hist_close') &&el('cs_hist_close').addEventListener('click',function(){el('cs_hist_ov')&&el('cs_hist_ov').classList.remove('active');});
        el('cs_uz_id')      &&el('cs_uz_id').addEventListener('click',function(){uploadId();});
        el('cs_id_cam')     &&el('cs_id_cam').addEventListener('click',function(){uploadId(true);});
        el('cs_id_gal')     &&el('cs_id_gal').addEventListener('click',function(){uploadId();});
        el('cs_id_pdf')     &&el('cs_id_pdf').addEventListener('click',function(){uploadId(false,'pdf');});
        el('cs_uz_rend')    &&el('cs_uz_rend').addEventListener('click',function(){uploadRend('image/*,application/pdf');});
        el('cs_rend_cam')   &&el('cs_rend_cam').addEventListener('click',function(){uploadRend('image/*',true);});
        el('cs_rend_gal')   &&el('cs_rend_gal').addEventListener('click',function(){uploadRend('image/*');});
        el('cs_rend_pdf')   &&el('cs_rend_pdf').addEventListener('click',function(){uploadRend('application/pdf,.pdf');});
        el('cs_btn_analisar')&&el('cs_btn_analisar').addEventListener('click',executar);
        el('cs_btn_recalc') &&el('cs_btn_recalc').addEventListener('click',recalcularLocal);
        el('cs_btn_nova')   &&el('cs_btn_nova').addEventListener('click',executar);
    }

    function init(){injectCSS();injectHTML();injectMenuBtns();wireEvents();}
    if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}else{init();}
    window._creditoScanOpen=openOverlay;
})();
