// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
//  cs-ia  —  Edge Function do Supabase para o CreditoScan (Central Workcell)
//
//  1) FILA DE ANÁLISES: o app envia os documentos uma vez; o servidor lê a renda, analisa e guarda o resultado.
//     O celular pode fechar à vontade. Processa 2 análises por vez, em ordem de chegada (fila de até 30).
//  2) CHAMADA AVULSA DA IA (modo antigo / outras telas): POST {id,corpo}, GET ?id=…, DELETE ?id=…
//
//  Rotas (todas exigem o cabeçalho  x-app-token = APP_TOKEN):
//    POST /cs-ia/enviar     { id, nome, tel, cpf, docsId[], docsRend[] }   -> 201 { id, estado, posicao }
//    GET  /cs-ia/lista                                                      -> { analises:[…] }
//    GET  /cs-ia/resultado?id=…                                             -> resultado da IA + renda calculada
//    POST /cs-ia/cancelar   { id }     POST /cs-ia/repetir { id }     POST /cs-ia/coletar { id }
//    POST /cs-ia/tick  e  /cs-ia/passo  (uso interno: empurram a fila)
//
//  Segredos (Edge Functions > Secrets):  OPENROUTER_KEY  e  APP_TOKEN
//  Documentos e resultados ficam guardados 30 dias e depois são apagados sozinhos.
// ─────────────────────────────────────────────────────────────────────────────

const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL_VL = 'qwen/qwen3-vl-235b-a22b-instruct';
const MODEL_TXT = 'qwen/qwen3-235b-a22b-2507';
const MAX_IMGS_AI = 25;
const LIMITE_IA_MS = 140000;        // chamada avulsa: a função inteira morre em 150 s no plano grátis
const JOB_PRESO_MS = 165000;        // 'run' mais velho que isso = a função morreu no meio
const RETENCAO_MS = 3600000;        // respostas avulsas apagadas depois de 1 hora
const MAX_BODY = 14000000;          // ~14 MB de pedido
const SLOTS = 2;                    // análises rodando ao mesmo tempo
const MAX_FILA = 30;                // análises esperando + rodando
const RETENCAO_DIAS = 30;           // documentos e resultados
// Plano grátis: a função morre em 150 s. No plano pago pode-se criar o segredo PASSO_LIMITE_S (ex.: 330) para dar mais tempo à IA.
const PASSO_LIMITE_MS = Math.min(Math.max(Number(Deno.env.get('PASSO_LIMITE_S')) || 135, 60), 380) * 1000;
const LEASE_S = Math.round(PASSO_LIMITE_MS / 1000) + 35;   // "estou trabalhando nisso"; passou disso, a fila resgata
const RE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_MODELO = /^[\w.\-]+\/[\w.\-:]+$/;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-app-token, apikey, authorization, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

// ── Motor de renda e prompts: o MESMO código do app (gerado automaticamente), para os números serem idênticos ──
const MOTOR = (function (R$) {
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

  return { calcularRenda, unirRendaArquivos, montarTextoDigital, buildPromptRenda, buildPrompt, lerRendaPorTrechos, criarLimitador, PARALELO_IA, LIMITE_RENDA_ARQUIVO, dividirTrechos, somarTrechos };
})((v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function resp(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));
const agoraIso = () => new Date().toISOString();
const segundos = (ini: string | number, fim: string | number) => Math.max(0, Math.round((new Date(fim).getTime() - new Date(ini).getTime()) / 1000));

// ── Banco (PostgREST, com a chave secreta que o Supabase já injeta na função) ──
function cfgBanco(): { url: string; key: string } {
  const url = Deno.env.get('SUPABASE_URL') || '';
  let key = '';
  try {
    const ks = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    key = ks.default || (Object.values(ks)[0] as string) || '';
  } catch (_) { /* segue para a chave antiga */ }
  if (!key) key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  return { url, key };
}

function cabecalhos(prefer?: string): Record<string, string> {
  const { key } = cfgBanco();
  const h: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  if (key && !key.startsWith('sb_')) h['Authorization'] = 'Bearer ' + key;   // chave antiga (JWT) pede Bearer
  if (prefer) h['Prefer'] = prefer;
  return h;
}

async function banco(tabela: string, caminho: string, init: RequestInit & { prefer?: string } = {}): Promise<Response> {
  const { url } = cfgBanco();
  return await fetch(url + '/rest/v1/' + tabela + caminho, { method: init.method, body: init.body, headers: cabecalhos(init.prefer) });
}

async function atualizar(id: string, campos: Record<string, unknown>): Promise<void> {
  const r = await banco('cs_jobs', '?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(campos) });
  if (!r.ok) console.error('[cs-ia] falha ao gravar', id, r.status, await r.text());
}

async function buscar(id: string): Promise<Record<string, any> | null> {
  const r = await banco('cs_jobs', '?id=eq.' + id + '&select=*', { method: 'GET' });
  if (!r.ok) throw new Error('banco ' + r.status);
  const rows = await r.json();
  return rows && rows[0] ? rows[0] : null;
}

// ── Chamada avulsa da IA em segundo plano (modo antigo) ──
async function executar(id: string, corpo: string): Promise<void> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), LIMITE_IA_MS);
  try {
    const r = await fetch(OR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Deno.env.get('OPENROUTER_KEY') },
      body: corpo,
      signal: ctl.signal,
    });
    const txt = await r.text();
    await atualizar(id, { status: 'done', http: r.status, resposta: txt });
  } catch (e) {
    const abortou = !!e && (e as Error).name === 'AbortError';
    await atualizar(id, {
      status: 'error', tipo: 'rede',
      erro: abortou ? 'IA sem resposta em ' + Math.round(LIMITE_IA_MS / 1000) + 's' : String((e as Error)?.message || e),
    });
  } finally {
    clearTimeout(timer);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  FILA DE ANÁLISES
// ═══════════════════════════════════════════════════════════════════
const ANALISE_LISTA = 'id,nome,tel,estado,etapa,progresso,criado_em,iniciado_em,concluido_em,erro,tempos,passo';

async function analiseBuscar(id: string, colunas: string): Promise<Record<string, any> | null> {
  const r = await banco('cs_analises', '?id=eq.' + id + '&select=' + colunas, { method: 'GET' });
  if (!r.ok) throw new Error('banco ' + r.status);
  const rows = await r.json();
  return rows && rows[0] ? rows[0] : null;
}

// só altera se a análise ainda estiver no estado esperado (ex.: quem cancelou no meio não é sobrescrito)
async function analiseAtualizar(id: string, campos: Record<string, unknown>, seEstado?: string): Promise<boolean> {
  const r = await banco('cs_analises', '?id=eq.' + id + (seEstado ? '&estado=eq.' + seEstado : '') + '&select=id', {   // select=id: nao devolve os documentos (MBs) a cada gravacao
    
    method: 'PATCH', body: JSON.stringify(campos), prefer: 'return=representation',
  });
  if (!r.ok) { console.error('[cs-ia] falha ao gravar análise', id, r.status, await r.text()); return false; }
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

// Espelha o PASSO 2 do app: separa imagens, texto dos PDFs digitais (por arquivo) e decide o caminho da IA
function prepararEntrada(docsId: any[], docsRend: any[]) {
  let imagens: any[] = [];
  const arquivos: any[][] = [], pos: Record<string, number> = {};
  (docsId || []).forEach((d) => { if (d.base64) imagens.push(d); });
  (docsRend || []).forEach((d) => {
    if (d.ehDigital && d.textos && d.textos.length) {
      if (pos[d.aid] === undefined) { pos[d.aid] = arquivos.length; arquivos.push([]); }
      arquivos[pos[d.aid]] = arquivos[pos[d.aid]].concat(d.textos);
    } else if (d.base64) imagens.push(d);
  });
  if (imagens.length > MAX_IMGS_AI) {
    const passo = imagens.length / MAX_IMGS_AI, amostra: any[] = [];
    for (let i = 0; i < MAX_IMGS_AI; i++) amostra.push(imagens[Math.min(Math.floor(i * passo), imagens.length - 1)]);
    imagens = amostra;
  }
  let textoDigitalStr = '';
  if (arquivos.length) {
    const m = MOTOR.montarTextoDigital(arquivos);
    if (m.texto) textoDigitalStr = '=== EXTRATO BANCARIO DIGITAL (texto extraido do PDF) ===\n' + m.texto;
  }
  const fotoRenda = (docsRend || []).some((d) => !d.ehDigital && d.base64);
  let textosLocais: string[] = [];
  (docsRend || []).forEach((d) => { if (d.textos && d.textos.length) textosLocais = textosLocais.concat(d.textos); });
  return {
    imagens, arquivos, textoDigitalStr,
    temSoTexto: imagens.length === 0 && !!textoDigitalStr,
    usaEtapaRenda: !!textoDigitalStr && !fotoRenda,
    textoParaApostas: textosLocais.join('\n'),
  };
}

// Chamada à OpenRouter em streaming, com tentativas (429/5xx/rede/sem resposta) dentro do tempo que sobrou ao passo.
// Streaming serve para duas coisas: (1) abortar rápido quando o provedor nem começa a responder (em vez de esperar o passo inteiro)
// e (2) saber, quando falha, o que de fato aconteceu (quantos caracteres gerou, em quanto tempo, qual provedor): vai em `diag` e na mensagem de erro.
const SEM_INICIO_MS = (Number(Deno.env.get('IA_SEM_INICIO_S')) || 50) * 1000;   // nenhum pedaço de resposta em 50 s -> tenta de novo (outro provedor)
const PARADO_MS = (Number(Deno.env.get('IA_PARADO_S')) || 40) * 1000;           // começou e parou de gerar por 40 s -> tenta de novo
// Provedor que responde "pingando" (ex.: Venice gerou 1293 caracteres em 135 s): o tempo parado nunca estoura, mas a análise leva minutos e o servidor morre no meio.
// Depois de LENTO_APOS_S segundos gerando, se a velocidade estiver abaixo de LENTO_MIN_CPS caracteres/s, troca de provedor. Os normais fazem ~100 caracteres/s.
const LENTO_APOS_S = Number(Deno.env.get('IA_LENTO_APOS_S')) || 20;
const LENTO_MIN_CPS = Number(Deno.env.get('IA_LENTO_MIN_CPS')) || 25;
// Provedores que nunca devem ser usados (separados por vírgula) + os que já falharam/ficaram lentos nesta chamada.
const PROV_IGNORAR = (Deno.env.get('IA_IGNORAR') ?? 'Venice').split(',').map(x => x.trim()).filter(Boolean);
async function chamarIA(modelo: string, messages: any[], prazo: number, maxMs = 120000, opc: { temp?: number; diag?: any } = {}): Promise<string> {
  let ultimo = '';
  const ignorar = PROV_IGNORAR.slice();
  for (let t = 0; t < 3; t++) {
    const restante = Math.min(prazo - Date.now(), maxMs);
    if (restante < 8000) break;
    const ctl = new AbortController();
    const ini = Date.now();
    let motivo = '', texto = '', primeiro = 0, fim = '', prov = '';
    const tmTotal = setTimeout(() => { motivo = 'total'; ctl.abort(); }, restante);
    let tmIdle: any = null;
    const armar = (ms: number, m: string) => { if (tmIdle) clearTimeout(tmIdle); tmIdle = setTimeout(() => { motivo = m; ctl.abort(); }, ms); };
    armar(SEM_INICIO_MS, 'inicio');
    const resumo = () => 'gerou ' + texto.length + ' caracteres em ' + Math.round((Date.now() - ini) / 1000) + 's' + (primeiro ? ', 1º trecho em ' + Math.round((primeiro - ini) / 1000) + 's' : ', nada recebido') + (prov ? ', provedor ' + prov : '');
    try {
      const r = await fetch(OR_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Deno.env.get('OPENROUTER_KEY') },
        body: JSON.stringify({ model: modelo, max_tokens: 6000, temperature: Math.min(1, (opc.temp || 0) + 0.3 * t), stream: true, provider: ignorar.length ? { sort: 'throughput', ignore: ignorar } : { sort: 'throughput' }, messages }),
        signal: ctl.signal,
      });
      if (!r.ok) {
        const txt = await r.text();
        let m = 'HTTP ' + r.status;
        try { m = JSON.parse(txt).error.message || m; } catch (_) { /* fica o HTTP */ }
        if ([429, 502, 503, 504, 524].includes(r.status) && t < 2) { ultimo = m; await dorme(2500 * (t + 1)); continue; }
        throw new Error(m);
      }
      const leitor = r.body!.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n')) !== -1) {
          const linha = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!linha.startsWith('data:')) continue;   // ': OPENROUTER PROCESSING' (keep-alive) e linhas vazias
          const dado = linha.slice(5).trim();
          if (!dado || dado === '[DONE]') continue;
          let j: any; try { j = JSON.parse(dado); } catch (_) { continue; }
          if (j.error) throw new Error(String(j.error.message || 'erro da IA'));
          if (j.provider) prov = String(j.provider);
          const c = j.choices && j.choices[0];
          if (c && c.delta && c.delta.content) {
            if (!primeiro) primeiro = Date.now();
            texto += c.delta.content; armar(PARADO_MS, 'parou');
            const gerandoS = (Date.now() - primeiro) / 1000;
            if (gerandoS > LENTO_APOS_S && texto.length / gerandoS < LENTO_MIN_CPS) { motivo = 'lento'; ctl.abort(); }
            // laço de geração (o modelo repete o mesmo trecho até estourar o limite): detecta e refaz em vez de esperar o passo inteiro
            if (texto.length > 6000 && texto.indexOf(texto.slice(-300)) < texto.length - 600) { motivo = 'laco'; ctl.abort(); }
          }
          if (c && c.finish_reason) fim = String(c.finish_reason);
        }
      }
      if (opc.diag) Object.assign(opc.diag, { prov, ttfb_s: primeiro ? Math.round((primeiro - ini) / 100) / 10 : null, chars: texto.length, fim, s: Math.round((Date.now() - ini) / 100) / 10, tent: t + 1 });
      return texto.trim();
    } catch (e) {
      const nome = (e as Error)?.name;
      if (nome === 'AbortError') {
        if (prov && motivo !== 'total' && !ignorar.includes(prov)) ignorar.push(prov);   // a próxima tentativa evita este provedor
        if (opc.diag) Object.assign(opc.diag, { prov, chars: texto.length, abort: motivo, s: Math.round((Date.now() - ini) / 100) / 10, tent: t + 1 });
        if (motivo === 'total') { ultimo = 'IA sem resposta no tempo (' + resumo() + ')'; break; }
        ultimo = motivo === 'inicio' ? 'IA não começou a responder em ' + SEM_INICIO_MS / 1000 + 's (' + resumo() + ')' : motivo === 'laco' ? 'IA entrou em repetição (' + resumo() + ')' : motivo === 'lento' ? 'IA muito lenta (' + resumo() + ')' : 'IA parou de gerar (' + resumo() + ')';
        continue;   // outro provedor pode responder: tenta de novo enquanto houver tempo no passo
      }
      if (nome === 'TypeError' && t < 2) { ultimo = String((e as Error).message || e); await dorme(1500 * (t + 1)); continue; }
      throw e;
    } finally {
      clearTimeout(tmTotal); if (tmIdle) clearTimeout(tmIdle);
    }
  }
  throw new Error(ultimo || 'IA indisponível');
}

// Etapa 1 da renda: cada PDF é lido em TRECHOS pequenos (em paralelo, no máximo PARALELO_IA chamadas juntas) e o código soma os trechos
// (a IA errava a soma de 50-60 Pix de um mês numa resposta só). Se a soma não fechar com o total impresso, relê com trechos menores.
async function passoRenda(ent: any, prazo: number) {
  const limitar = MOTOR.criarLimitador(MOTOR.PARALELO_IA);
  const leituras = await Promise.all(ent.arquivos.map((arq: string[]) => {
    const m = MOTOR.montarTextoDigital([arq], MOTOR.LIMITE_RENDA_ARQUIVO);
    if (!m.texto) return Promise.resolve(undefined);   // undefined = PDF sem texto
    return MOTOR.lerRendaPorTrechos(m.texto, (prompt: string) => chamarIA(MODEL_TXT, [{ role: 'user', content: prompt }], prazo, 60000), {
      limitar, sobra: () => prazo - Date.now(),
    });
  }));
  // um PDF que a IA não conseguiu ler faria a renda sair de menos meses sem ninguém saber: a análise final calcula tudo
  if (leituras.some((l: any) => l === null)) return null;
  const uniao = MOTOR.unirRendaArquivos(leituras.filter(Boolean));
  const c = uniao.rendaMeses.length ? MOTOR.calcularRenda(uniao) : null;
  return c && c.renda > 0 ? c : null;
}

async function passoAnalise(ent: any, rendaPre: any, prazo: number, opc: { temp?: number; diag?: any } = {}): Promise<string> {
  const prompt = MOTOR.buildPrompt(rendaPre);
  if (ent.temSoTexto) {
    return await chamarIA(MODEL_TXT, [{ role: 'user', content: '=== EXTRATO ===\n' + ent.textoDigitalStr + '\n\n' + prompt }], prazo, PASSO_LIMITE_MS, opc);
  }
  const content: any[] = ent.imagens.map((img: any) => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + img.base64 } }));
  if (ent.textoDigitalStr && ent.textoDigitalStr.trim()) content.push({ type: 'text', text: ent.textoDigitalStr });
  content.push({ type: 'text', text: prompt });
  return await chamarIA(MODEL_VL, [{ role: 'user', content }], prazo, PASSO_LIMITE_MS, opc);
}

class ErroFinal extends Error {}

// Caminho desta função no Supabase, aprendido da própria requisição (o nome/slug muda conforme como a função foi criada: cs-ia, cs-ia-ts, smart-handler...).
// Com o nome errado o encadeamento dá 404 e cada passo só anda quando o lease vence (~170 s de espera por passo): foi o que deixou as análises lentas.
// No Supabase o caminho que a função enxerga NÃO traz o nome dela (só /passo, /enviar...), então o nome vem do segredo FN_SLUG (ex.: smart-handler).
// Sem o segredo, tenta aprender do caminho da requisição; sem nenhum dos dois, usa cs-ia.
let FN_BASE = '/functions/v1/' + ((Deno.env.get('FN_SLUG') || 'cs-ia').replace(/^\/+|\/+$/g, ''));

// Dispara o próximo passo numa invocação nova (orçamento de 150 s próprio). Se falhar, o lease vence e a fila resgata.
function encadear(id: string): void {
  const { url } = cfgBanco();
  // @ts-ignore: EdgeRuntime existe no Supabase
  EdgeRuntime.waitUntil(fetch(url + FN_BASE + '/passo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-token': Deno.env.get('APP_TOKEN') || '' },
    body: JSON.stringify({ id }),
  }).then((r) => r.text()).catch((e) => console.error('[cs-ia] não consegui encadear', id, e)));
}

async function falhar(id: string, e: any, tentativas: number): Promise<void> {
  const bruto = String((e && e.message) || e || 'erro desconhecido').slice(0, 280);
  const msg = e instanceof ErroFinal ? bruto : 'Falha ao consultar a IA: ' + bruto;
  console.error('[cs-ia] passo falhou', id, msg);
  if (e instanceof ErroFinal || tentativas + 1 >= 3) {
    await analiseAtualizar(id, { estado: 'erro', etapa: 'Falhou', erro: msg, lease_ate: null, tentativas: tentativas + 1 }, 'rodando');
  } else {
    await analiseAtualizar(id, { estado: 'fila', etapa: 'Na fila (nova tentativa)', erro: msg, lease_ate: null, tentativas: tentativas + 1 }, 'rodando');
  }
  tickEmSegundoPlano();
}

async function executarPasso(id: string): Promise<void> {
  const t0 = Date.now();
  const prazo = t0 + PASSO_LIMITE_MS;
  let row: any;
  try { row = await analiseBuscar(id, 'id,estado,passo,docs,passos,criado_em,iniciado_em,tempos,tentativas'); } catch (_) { return; }
  if (!row || row.estado !== 'rodando') return;
  try {
    const docs = row.docs || {};
    const ent = prepararEntrada(docs.docsId || [], docs.docsRend || []);
    if (!ent.imagens.length && !ent.textoDigitalStr) throw new ErroFinal('Nenhum documento legível. Envie fotos mais nítidas ou o PDF original do banco.');
    const passo = row.passo || (ent.usaEtapaRenda ? 'renda' : 'analise');
    const tempos = { ...(row.tempos || {}) };
    if (tempos.fila_s === undefined) tempos.fila_s = segundos(row.criado_em, row.iniciado_em || agoraIso());
    const lease = () => new Date(Date.now() + LEASE_S * 1000).toISOString();

    if (passo === 'renda') {
      await analiseAtualizar(id, { passo: 'renda', etapa: 'Lendo extratos (renda)', progresso: 25, lease_ate: lease() }, 'rodando');
      const rendaPre = await passoRenda(ent, prazo);
      tempos.renda_s = Math.round((Date.now() - t0) / 1000);
      const gravou = await analiseAtualizar(id, { passos: { rendaPre }, passo: 'analise', etapa: 'Analisando comportamento', progresso: 55, lease_ate: lease(), tempos }, 'rodando');
      if (gravou) encadear(id);
      return;
    }

    await analiseAtualizar(id, { passo: 'analise', etapa: 'Analisando comportamento', progresso: 60, lease_ate: lease() }, 'rodando');
    const rendaPre = (row.passos && row.passos.rendaPre) || null;
    // 1ª tentativa determinística (temperature 0); se a anterior travou/falhou, as próximas variam um pouco (evita repetir o mesmo laço de geração)
    const diag: any = {};
    let texto = '';
    try { texto = await passoAnalise(ent, rendaPre, prazo, { temp: [0, 0.3, 0.5][Math.min(row.tentativas || 0, 2)], diag }); }
    catch (e) { console.error('[cs-ia] análise', id, JSON.stringify(diag)); throw e; }
    if (!texto) throw new Error('A IA devolveu resposta vazia');
    tempos.ia = diag;
    tempos.analise_s = Math.round((Date.now() - t0) / 1000);
    tempos.total_s = segundos(row.criado_em, agoraIso());
    const fim = await analiseAtualizar(id, {
      estado: 'pronta', etapa: 'Pronta', progresso: 100, concluido_em: agoraIso(), lease_ate: null, erro: null, tempos,
      resultado: { resp: texto, rendaPre, textoParaApostas: ent.textoParaApostas },
    }, 'rodando');
    if (fim) tickEmSegundoPlano();
  } catch (e) {
    await falhar(id, e, row.tentativas || 0);
  }
}

// Pega as próximas análises da fila (respeitando SLOTS) e começa a trabalhar nelas
async function tick(): Promise<void> {
  try {
    await banco('cs_analises', '?criado_em=lt.' + encodeURIComponent(new Date(Date.now() - RETENCAO_DIAS * 86400000).toISOString()), { method: 'DELETE' });
    const { url } = cfgBanco();
    const r = await fetch(url + '/rest/v1/rpc/cs_reivindicar', { method: 'POST', headers: cabecalhos(), body: JSON.stringify({ p_max: SLOTS, p_lease_s: LEASE_S }) });
    if (!r.ok) { console.error('[cs-ia] reivindicar falhou', r.status, await r.text()); return; }
    const linhas = await r.json();
    (Array.isArray(linhas) ? linhas : []).forEach((l: any) => {
      // @ts-ignore: EdgeRuntime existe no Supabase
      EdgeRuntime.waitUntil(executarPasso(l.o_id || l.id));
    });
  } catch (e) { console.error('[cs-ia] tick', e); }
}

function tickEmSegundoPlano(): void {
  // @ts-ignore: EdgeRuntime existe no Supabase
  EdgeRuntime.waitUntil(tick());
}

const UF = (s: unknown, n: number) => String(s == null ? '' : s).slice(0, n);

function limparDoc(d: any) {
  return {
    base64: typeof d.base64 === 'string' ? d.base64 : '',
    textos: Array.isArray(d.textos) ? d.textos.map((t: unknown) => UF(t, 200000)).slice(0, 200) : [],
    ehDigital: !!d.ehDigital, tipo: UF(d.tipo, 20), arq: UF(d.arq, 120), aid: d.aid === undefined ? null : d.aid,
  };
}

async function rotaFila(req: Request, rota: string, u: URL): Promise<Response> {
  if (rota === 'status') {
    // confere se o SQL foi rodado: a tabela e a função da fila precisam existir
    let banco_ok = 'ok';
    try {
      const t = await banco('cs_analises', '?select=id&limit=1', { method: 'GET' });
      if (!t.ok) banco_ok = 'tabela cs_analises com problema (HTTP ' + t.status + '): rode o cs-ia.sql no SQL Editor do Supabase';
      else {
        const { url } = cfgBanco();
        const f = await fetch(url + '/rest/v1/rpc/cs_reivindicar', { method: 'POST', headers: cabecalhos(), body: JSON.stringify({ p_max: 0, p_lease_s: LEASE_S }) });
        if (!f.ok) banco_ok = 'função cs_reivindicar com problema (HTTP ' + f.status + '): rode o cs-ia.sql de novo no SQL Editor';
      }
    } catch (e) { banco_ok = 'banco inacessível: ' + String((e as Error)?.message || e).slice(0, 120); }
    return resp({ fila: true, versao: 2, slots: SLOTS, max_fila: MAX_FILA, banco: banco_ok });
  }

  if (rota === 'lista' && req.method === 'GET') {
    const corte = encodeURIComponent(new Date(Date.now() - RETENCAO_DIAS * 86400000).toISOString());
    const r = await banco('cs_analises', '?coletada_em=is.null&estado=neq.cancelada&criado_em=gt.' + corte + '&select=' + ANALISE_LISTA + '&order=criado_em.asc', { method: 'GET' });
    if (!r.ok) return resp({ erro: 'banco ' + r.status }, 500);
    const linhas: any[] = await r.json();
    let pos = 0;
    linhas.forEach((l) => { if (l.estado === 'fila') l.posicao = ++pos; });
    if (linhas.some((l) => l.estado === 'fila' || l.estado === 'rodando')) tickEmSegundoPlano();   // empurra a fila e resgata travadas
    return resp({ agora: agoraIso(), slots: SLOTS, max_fila: MAX_FILA, analises: linhas });
  }

  if (rota === 'resultado' && req.method === 'GET') {
    const id = u.searchParams.get('id') || '';
    if (!RE_ID.test(id)) return resp({ erro: 'id invalido' }, 400);
    const row = await analiseBuscar(id, 'id,nome,tel,cpf,estado,resultado,tempos,erro');
    if (!row) return resp({ erro: 'nao_existe' }, 404);
    return resp(row);
  }

  if (req.method !== 'POST') return resp({ erro: 'metodo nao permitido' }, 405);
  const txt = await req.text();
  let p: any; try { p = JSON.parse(txt); } catch (_) { return resp({ erro: 'json invalido' }, 400); }
  const id = String(p?.id || '');
  if (rota !== 'tick' && !RE_ID.test(id)) return resp({ erro: 'id invalido' }, 400);

  if (rota === 'tick') { tickEmSegundoPlano(); return resp({ ok: true }, 202); }

  if (rota === 'passo') {
    // @ts-ignore: EdgeRuntime existe no Supabase
    EdgeRuntime.waitUntil(executarPasso(id));
    return resp({ ok: true }, 202);
  }

  if (rota === 'cancelar') {
    const row = await analiseBuscar(id, 'id,estado');
    if (!row) return resp({ erro: 'nao_existe' }, 404);
    if (row.estado !== 'cancelada') {
      await analiseAtualizar(id, { estado: 'cancelada', etapa: 'Cancelada', lease_ate: null, docs: {}, passos: null, resultado: null });
      tickEmSegundoPlano();
    }
    return resp({ ok: true });
  }

  if (rota === 'coletar') {
    await analiseAtualizar(id, { coletada_em: agoraIso() });
    return resp({ ok: true });
  }

  if (rota === 'repetir') {
    // refaz uma análise que deu erro (ou cujo resultado o app não conseguiu usar); os documentos ainda estão guardados
    const row = await analiseBuscar(id, 'id,estado,tempos');
    if (!row) return resp({ erro: 'nao_existe' }, 404);
    if (row.estado !== 'erro' && row.estado !== 'pronta') return resp({ erro: 'so analises com erro ou prontas podem ser repetidas' }, 409);
    const t0r = row.tempos || {}, temposBase: any = {};
    ['cpf_s', 'prep_s', 'mb'].forEach((k) => { if (t0r[k]) temposBase[k] = t0r[k]; });
    await analiseAtualizar(id, {
      estado: 'fila', etapa: 'Na fila', progresso: 0, passo: null, passos: null, tentativas: 0, erro: null, lease_ate: null,
      iniciado_em: null, concluido_em: null, coletada_em: null, resultado: null, tempos: Object.keys(temposBase).length ? temposBase : null, criado_em: agoraIso(),
    }, row.estado);
    tickEmSegundoPlano();
    return resp({ ok: true });
  }

  if (rota === 'enviar') {
    const tam = txt.length;
    if (tam > MAX_BODY) return resp({ erro: 'pedido grande demais' }, 413);
    const docsRend = Array.isArray(p.docsRend) ? p.docsRend.filter((d: any) => d && typeof d === 'object').slice(0, 100).map(limparDoc) : [];
    const docsId = Array.isArray(p.docsId) ? p.docsId.filter((d: any) => d && typeof d === 'object').slice(0, 3).map(limparDoc) : [];
    if (!docsRend.length) return resp({ erro: 'envie ao menos um comprovante de renda' }, 400);
    if (!Deno.env.get('OPENROUTER_KEY')) return resp({ erro: 'OPENROUTER_KEY nao configurada no servidor' }, 500);

    // já existe (app reenviou depois de cair)? devolve o que está lá, sem duplicar
    const ja = await analiseBuscar(id, 'id,estado');
    if (ja) return resp({ id, estado: ja.estado, repetido: true }, 200);

    const ativos = await banco('cs_analises', '?estado=in.(fila,rodando)&select=id', { method: 'GET' });
    if (ativos.ok) {
      const n = (await ativos.json()).length;
      if (n >= MAX_FILA) return resp({ erro: 'fila_cheia', max: MAX_FILA }, 429);
    }
    const ins = await banco('cs_analises', '?select=id', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
      body: JSON.stringify({
        id, estado: 'fila', etapa: 'Na fila', progresso: 0,
        nome: UF(p.nome, 80), tel: UF(p.tel, 20).replace(/\D/g, ''), cpf: UF(p.cpf, 14).replace(/\D/g, ''),
        tempos: (() => { const t: any = {}; if (Number(p.cpf_s) > 0) t.cpf_s = Math.min(Math.round(Number(p.cpf_s)), 900); if (Number(p.prep_s) > 0) t.prep_s = Math.min(Math.round(Number(p.prep_s)), 7200); if (Number(p.mb) > 0) t.mb = Math.min(Math.round(Number(p.mb) * 10) / 10, 50); return Object.keys(t).length ? t : null; })(),
        docs: { docsId, docsRend },
      }),
    });
    if (!ins.ok) return resp({ erro: 'banco ' + ins.status + ' ' + (await ins.text()).slice(0, 120) }, 500);
    tickEmSegundoPlano();
    return resp({ id, estado: 'fila' }, 201);
  }

  return resp({ erro: 'rota desconhecida' }, 404);
}

export async function tratar(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const esperado = Deno.env.get('APP_TOKEN') || '';
  const recebido = req.headers.get('x-app-token') || '';
  if (!esperado) return resp({ erro: 'APP_TOKEN nao configurado no servidor' }, 500);
  if (!iguais(recebido, esperado)) return resp({ erro: 'nao autorizado' }, 401);

  const u = new URL(req.url);
  const partes = u.pathname.replace(/\/+$/, '').split('/');
  const rota = partes[partes.length - 1] || '';
  const idq = u.searchParams.get('id') || '';

  try {
    if (['enviar', 'lista', 'resultado', 'cancelar', 'repetir', 'coletar', 'tick', 'passo', 'status'].includes(rota)) {
      const base = partes.slice(0, -1).join('/');
      if (base) FN_BASE = base.startsWith('/functions/v1') ? base : '/functions/v1' + (base.startsWith('/') ? '' : '/') + base;
      return await rotaFila(req, rota, u);
    }

    // ── modo antigo: chamada avulsa da IA ──
    if (req.method === 'GET') {
      if (!RE_ID.test(idq)) return resp({ erro: 'id invalido' }, 400);
      const row = await buscar(idq);
      if (!row) return resp({ status: 'nao_existe' }, 404);
      if (row.status === 'run' && Date.now() - new Date(row.criado_em).getTime() > JOB_PRESO_MS) {
        await atualizar(idq, { status: 'error', tipo: 'rede', erro: 'o servidor parou antes de terminar' });
        return resp({ status: 'error', tipo: 'rede', erro: 'o servidor parou antes de terminar' });
      }
      return resp({ status: row.status, http: row.http, resposta: row.resposta, erro: row.erro, tipo: row.tipo });
    }

    if (req.method === 'DELETE') {
      if (!RE_ID.test(idq)) return resp({ erro: 'id invalido' }, 400);
      await banco('cs_jobs', '?id=eq.' + idq, { method: 'DELETE' });
      return resp({ ok: true });
    }

    if (req.method !== 'POST') return resp({ erro: 'metodo nao permitido' }, 405);

    if (!Deno.env.get('OPENROUTER_KEY')) return resp({ erro: 'OPENROUTER_KEY nao configurada no servidor' }, 500);
    const tam = parseInt(req.headers.get('content-length') || '0', 10);
    if (tam > MAX_BODY) return resp({ erro: 'pedido grande demais' }, 413);

    let pedido: any;
    try { pedido = JSON.parse(await req.text()); } catch (_) { return resp({ erro: 'json invalido' }, 400); }
    const id = String(pedido?.id || '');
    const corpo = pedido?.corpo;
    if (!RE_ID.test(id)) return resp({ erro: 'id invalido' }, 400);
    if (!corpo || typeof corpo !== 'object' || !Array.isArray(corpo.messages) || !RE_MODELO.test(String(corpo.model || ''))) {
      return resp({ erro: 'pedido invalido' }, 400);
    }

    // limpeza: nada fica mais de 1 hora
    await banco('cs_jobs', '?criado_em=lt.' + encodeURIComponent(new Date(Date.now() - RETENCAO_MS).toISOString()), { method: 'DELETE' });

    // cria o job; repetir o mesmo id (app reenviou depois de congelar) NÃO chama a IA de novo
    const ins = await banco('cs_jobs', '', { method: 'POST', body: JSON.stringify({ id, status: 'run' }), prefer: 'resolution=ignore-duplicates,return=representation' });
    if (!ins.ok) return resp({ erro: 'banco ' + ins.status }, 500);
    const criados = await ins.json();
    if (!criados || !criados.length) {
      const ja = await buscar(id);
      return resp({ id, status: ja ? ja.status : 'run' }, 202);
    }

    // @ts-ignore: EdgeRuntime existe no Supabase
    EdgeRuntime.waitUntil(executar(id, JSON.stringify(corpo)));
    return resp({ id, status: 'run' }, 202);
  } catch (e) {
    console.error('[cs-ia]', e);
    return resp({ erro: String((e as Error)?.message || e) }, 500);
  }
}

Deno.serve(tratar);
