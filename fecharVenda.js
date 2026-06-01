// ================================================================
// fecharVenda.js — Fechar Venda · Layout B (Keyboard-Safe)
// DEPENDE DE (exposto pelo app.js):
//   window.products, window._fuse, window._rates,
//   window._getRate, window._areRatesLoaded,
//   window._parseBrazilianCurrencyToFloat
// ================================================================
(function () {
    'use strict';

    // ── Acesso ao estado global ───────────────────────────────────
    function ratesOk()   { return !!window._areRatesLoaded; }
    function getProds()  { return window.products || []; }
    function getFuse()   { return window._fuse || null; }
    function getRate(machine, brand, inst) {
        return typeof window._getRate === 'function'
            ? window._getRate(machine, brand, inst)
            : undefined;
    }
    function parseMoney(v) {
        return typeof window._parseBrazilianCurrencyToFloat === 'function'
            ? window._parseBrazilianCurrencyToFloat(v)
            : parseFloat(String(v).replace(/\./g,'').replace(',','.')) || 0;
    }
    function fmt(v) {
        return v.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
    }
    function safeGet(k) { try { return localStorage.getItem(k); } catch(e) { return null; } }

    // ── Estado ───────────────────────────────────────────────────
    let precoBase    = 0;
    let initialized  = false;
    const BRINDE     = 16;

    // ── DOM ───────────────────────────────────────────────────────
    const el = id => document.getElementById(id);

    // ── Máquinas ─────────────────────────────────────────────────
    function getMachines() {
        let disabled = [];
        try { disabled = JSON.parse(localStorage.getItem('disabledMachines') || '[]'); } catch(e){}
        return [
            { v:'pagbank',   l:'PagBank'    },
            { v:'infinity',  l:'InfinityPay'},
            { v:'valorante', l:'Valorante'  },
            { v:'nubank',    l:'Nubank'     },
        ].filter(m => !disabled.includes(m.v));
    }
    function maxInst(machine) {
        return {pagbank:18, infinity:12, valorante:21, nubank:12}[machine] || 18;
    }

    // ── Leitores da UI ───────────────────────────────────────────
    const getMachine = () => el('fv_machine')?.value || 'pagbank';
    const getBrand   = () => el('fv_brand')?.value   || 'visa';
    const getInst    = () => parseInt(el('fv_installments')?.value || '0');
    const getModo    = () => el('fv_modo_toggle')?.checked ? 'produto' : 'manual';
    const getBrinde  = () => !!el('fv_brinde')?.checked;

    // ── Renderiza botões de máquina ──────────────────────────────
    function renderMachineBtns() {
        const wrap = el('fv_machine_btns');
        if (!wrap) return;

        const machines = getMachines();
        // Se a máquina atual não está mais disponível, muda para a padrão ou primeira
        let cur = getMachine();
        if (!machines.find(m => m.v === cur)) {
            const saved = safeGet('ctwDefaultMachine');
            cur = (saved && machines.find(m => m.v === saved)) ? saved : (machines[0]?.v || 'pagbank');
            if (el('fv_machine')) el('fv_machine').value = cur;
        }

        wrap.innerHTML = machines.map(m =>
            `<button class="fv-mbtn${cur===m.v?' active':''}" data-m="${m.v}">${m.l}</button>`
        ).join('');
        wrap.querySelectorAll('.fv-mbtn').forEach(btn => {
            btn.addEventListener('click', () => {
                el('fv_machine').value = btn.dataset.m;
                renderMachineBtns();
                updateBrandVis();
                renderInstBtns();
                calculate();
            });
        });
    }

    // ── Bandeiras ────────────────────────────────────────────────
    function populateBrands() {
        const sel = el('fv_brand');
        if (!sel) return;
        const saved = safeGet('ctwDefaultBrand') || 'visa';
        ['visa','mastercard','elo','hipercard','hiper','amex'].forEach(b => {
            const o = document.createElement('option');
            o.value = b; o.textContent = b.charAt(0).toUpperCase()+b.slice(1);
            if (b===saved) o.selected = true;
            sel.appendChild(o);
        });
    }
    function updateBrandVis() {
        const w = el('fv_brand_wrap');
        if (w) w.style.display = getMachine() !== 'pagbank' ? 'flex' : 'none';
    }

    // ── Botões de parcelas ───────────────────────────────────────
    function renderInstBtns() {
        const wrap = el('fv_inst_btns');
        if (!wrap) return;
        const max = maxInst(getMachine());
        const cur = getInst();
        // Atualiza o max do slider dinamicamente conforme a máquina
        const slider = el('fv_installments');
        if (slider) slider.max = max;
        const vals = [0,1,8,10,12,18,21].filter(v => v===0||v<=max);
        wrap.innerHTML = vals.map(v =>
            `<button class="fv-ibtn${cur===v?' active':''}" data-v="${v}">${v===0?'Déb':`${v}x`}</button>`
        ).join('');
        wrap.querySelectorAll('.fv-ibtn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (el('fv_installments')) el('fv_installments').value = btn.dataset.v;
                renderInstBtns();
                syncInstLabel();
                calculate();
            });
        });
    }
    function syncInstLabel() {
        const v = getInst();
        const lbl = el('fv_inst_label');
        if (lbl) lbl.textContent = v===0?'Déb':`${v}x`;
    }

    // ── Modo manual / produto ────────────────────────────────────
    function onModoChange() {
        const isProd = getModo()==='produto';
        el('fv_manual_area')?.classList.toggle('fv-h', isProd);
        el('fv_produto_area')?.classList.toggle('fv-h', !isProd);
        el('fv_lbl_manual')?.classList.toggle('active', !isProd);
        el('fv_lbl_produto')?.classList.toggle('active', isProd);

        // Mostra/esconde a área de busca produto no bloco de cima
        el('fv_top_prod_area')?.classList.toggle('fv-h', !isProd);

        // Campo de valor: sempre visível exceto quando entrada à vista ativa
        const entradaAtiva = isProd && !!el('fv_entrada_check')?.checked;
        el('fv_value_wrap')?.classList.toggle('fv-h', entradaAtiva);
        el('fv_entrada_fields')?.classList.toggle('fv-h', !entradaAtiva);

        // Rótulo do campo
        const lbl = el('fv_value_label');
        if (lbl) lbl.textContent = 'Você cobrou (R$)';

        if (!isProd) {
            precoBase = 0;
            clearProdUI();
        }
        calculate();
    }

    function clearProdUI() {
        if (el('fv_prod_search')) el('fv_prod_search').value = '';
        const res = el('fv_prod_results');
        if (res) { res.innerHTML=''; res.classList.add('fv-h'); }
        const badge = el('fv_prod_badge');
        if (badge) { badge.innerHTML=''; badge.classList.add('fv-h'); }
        el('fv_entrada_wrap')?.classList.add('fv-h');
        el('fv_entrada_fields')?.classList.add('fv-h');
        el('fv_value_wrap')?.classList.remove('fv-h');
        if (el('fv_entrada_check')) el('fv_entrada_check').checked = false;
    }

    // ── Busca produto ────────────────────────────────────────────
    function onSearchInput() {
        const term = el('fv_prod_search')?.value.trim();
        const box  = el('fv_prod_results');
        if (!box) return;
        if (!term || term.length < 1) { box.innerHTML=''; box.classList.add('fv-h'); return; }

        const fuse = getFuse();
        let matches = fuse
            ? fuse.search(term).slice(0,8).map(r=>r.item)
            : getProds().filter(p=>p.nome?.toLowerCase().includes(term.toLowerCase())).slice(0,8);

        if (!matches.length) {
            box.innerHTML = `<div class="fv-no-result"><i class="bi bi-search"></i> Nenhum produto</div>`;
        } else {
            box.innerHTML = matches.map(p =>
                `<button class="fv-ri" data-id="${p.id}">
                    <span class="fv-rn">${p.nome}</span>
                    <span class="fv-rp">${fmt(parseFloat(p.valor)||0)}</span>
                 </button>`
            ).join('');
            box.querySelectorAll('.fv-ri').forEach(btn =>
                btn.addEventListener('click', () => {
                    const p = getProds().find(p=>p.id===btn.dataset.id);
                    if (p) selectProduct(p);
                })
            );
        }
        box.classList.remove('fv-h');
    }

    function selectProduct(prod) {
        precoBase = parseFloat(prod.valor) || 0;
        if (el('fv_prod_search')) el('fv_prod_search').value = prod.nome;
        const box = el('fv_prod_results');
        if (box) { box.innerHTML=''; box.classList.add('fv-h'); }

        const badge = el('fv_prod_badge');
        if (badge) {
            badge.innerHTML = `
                <i class="bi bi-box-seam-fill"></i>
                <span>${prod.nome}</span>
                <strong>${fmt(precoBase)}</strong>
                <button class="fv-pclear" id="fv_prod_clear"><i class="bi bi-x"></i></button>`;
            badge.classList.remove('fv-h');
            el('fv_prod_clear')?.addEventListener('click', () => {
                precoBase = 0; clearProdUI(); calculate();
            });
        }

        el('fv_entrada_wrap')?.classList.remove('fv-h');

        // Sugere valor cobrado
        const tax = getRate(getMachine(), getBrand(), getInst());
        if (tax !== undefined && el('fv_value') && !el('fv_entrada_check')?.checked) {
            const sug = precoBase / (1 - tax/100);
            el('fv_value').value = sug.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
        }
        calculate();
    }

    // ── Toggle entrada à vista ───────────────────────────────────
    function onEntradaToggle() {
        const checked = el('fv_entrada_check')?.checked;
        el('fv_entrada_fields')?.classList.toggle('fv-h', !checked);
        el('fv_value_wrap')?.classList.toggle('fv-h', !!checked);
        if (!checked) {
            if (el('fv_entrada_valor')) el('fv_entrada_valor').value = '';
            if (el('fv_cartao_valor'))  el('fv_cartao_valor').value  = '';
        }
        calculate();
    }

    // ── Máscara de moeda ─────────────────────────────────────────
    function moneyMask(inp) {
        if (!inp) return;
        inp.addEventListener('input', e => {
            const v = e.target.value.replace(/\D/g,'');
            e.target.value = v ? (parseFloat(v)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : '';
            calculate();
        });
    }

    // ── Cálculo principal ─────────────────────────────────────────
    function calculate() {
        const zone = el('fv_result_zone');
        if (!zone) return;

        if (!ratesOk()) {
            zone.innerHTML = `<div class="fv-wait"><i class="bi bi-hourglass-split"></i> Carregando taxas...</div>`;
            return;
        }

        const tax = getRate(getMachine(), getBrand(), getInst());
        if (tax === undefined || tax === null) {
            zone.innerHTML = `<div class="fv-wait"><i class="bi bi-exclamation-triangle"></i> Taxa indisponível.</div>`;
            return;
        }

        const brinde = getBrinde() ? BRINDE : 0;
        const isProd  = getModo() === 'produto';
        const isEnt   = isProd && !!el('fv_entrada_check')?.checked;

        // ── Entrada à vista ──────────────────────────────────────
        if (isEnt) {
            if (precoBase <= 0) {
                zone.innerHTML = `<div class="fv-wait"><i class="bi bi-info-circle"></i> Selecione um produto.</div>`;
                return;
            }
            const entrada = parseFloat(el('fv_entrada_valor')?.value)||0;
            const cartao  = parseFloat(el('fv_cartao_valor')?.value)||0;
            if (!entrada && !cartao) { zone.innerHTML=''; return; }
            const liquidCartao  = cartao*(1-tax/100);
            const total         = entrada + liquidCartao - brinde;
            const lucro         = total - precoBase;
            showResult(zone, {
                liquid: total,
                sub: `${fmt(entrada)} à vista + ${fmt(cartao)} cartão (${tax.toFixed(2)}%)`,
                lucro, brinde,
            });
            return;
        }

        // ── Modo normal ──────────────────────────────────────────
        const raw   = el('fv_value')?.value || '';
        const input = parseMoney(raw);
        if (!input || input <= 0) { zone.innerHTML=''; return; }

        const mmode  = document.querySelector('input[name="fv_manual_mode"]:checked')?.value || 'total';
        const inst   = getInst();
        const total  = (!isProd && mmode==='parcela' && inst>0) ? input*inst : input;
        const liquid = total*(1-tax/100) - brinde;
        const lucro  = isProd && precoBase>0 ? liquid-precoBase : null;
        const extra  = (!isProd && mmode==='parcela' && inst>0)
                     ? ` · ${inst}x de ${fmt(input)} = ${fmt(total)}`
                     : '';

        showResult(zone, {
            liquid,
            sub: `Taxa ${tax.toFixed(2)}% · ${inst===0?'Débito':`${inst}x`}${extra}`,
            lucro, brinde,
        });
    }

    function showResult(zone, {liquid, sub, lucro, brinde}) {
        const pos  = lucro===null || lucro>=0;
        const lHtml = lucro!==null
            ? `<div class="fv-lucro ${lucro>=0?'pos':'neg'}">
                   <i class="bi bi-${lucro>=0?'graph-up-arrow':'graph-down-arrow'}"></i>
                   Lucro: ${fmt(lucro)}
               </div>` : '';
        const bHtml = brinde>0
            ? `<div class="fv-brinde-tag"><i class="bi bi-gift"></i> Brinde −${fmt(brinde)}</div>` : '';

        zone.innerHTML = `
        <div class="fv-card ${pos?'ok':'bad'}">
            <div class="fv-clbl">Você recebe</div>
            <div class="fv-cval">${fmt(liquid)}</div>
            <div class="fv-csub">${sub}</div>
            ${bHtml}${lHtml}
        </div>`;
    }

    // ── CSS ───────────────────────────────────────────────────────
    function injectCSS() {
        if (el('fv-styles')) return;
        const s = document.createElement('style');
        s.id = 'fv-styles';
        s.textContent = `
/* ═══════════════════════════════════════
   FECHAR VENDA — Layout B keyboard-safe
═══════════════════════════════════════ */
#fecharVenda {
    display:flex; flex-direction:column;
    height:100%; max-height:100dvh;
    background:var(--bg-color); overflow:hidden;
}

/* Header */
.fv-hdr {
    display:flex; align-items:center; gap:12px;
    padding:12px 14px 8px; flex-shrink:0;
}
.fv-hdr h3 { margin:0; font-size:1rem; font-weight:700; color:var(--text-color); }

/* ─── ZONA FIXA NO TOPO ───
   Nunca é coberta pelo teclado.
   Contém TODOS os campos de digitação. */
.fv-top {
    flex-shrink:0;
    padding:0 14px 8px;
}

/* Grid 2 colunas */
.fv-grid {
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:10px;
    align-items:start;
}

/* Coluna esquerda: inputs + resultado */
.fv-left { display:flex; flex-direction:column; gap:8px; min-width:0; }

/* Coluna direita: config */
.fv-right { display:flex; flex-direction:column; gap:0; min-width:0; }

/* Card de valor */
.fv-vcard {
    background:rgba(var(--primary-color-rgb),.08);
    border:1.5px solid rgba(var(--primary-color-rgb),.25);
    border-radius:14px; padding:10px 12px;
}
.fv-vlbl {
    font-size:.58rem; font-weight:800; text-transform:uppercase;
    letter-spacing:.08em; color:var(--primary-color); margin-bottom:5px;
}
.fv-vrow {
    display:flex; align-items:center; gap:6px;
    background:rgba(0,0,0,.3);
    border:1.5px solid rgba(var(--primary-color-rgb),.3);
    border-radius:10px; padding:8px 10px;
    transition:border-color .2s, box-shadow .2s;
}
.fv-vrow:focus-within {
    border-color:var(--primary-color);
    box-shadow:0 0 0 3px rgba(var(--primary-color-rgb),.1);
}
.fv-curr { font-size:1rem; font-weight:800; color:var(--primary-color); flex-shrink:0; }
.fv-vinput {
    flex:1; min-width:0; background:transparent; border:none; outline:none;
    font-size:1.5rem; font-weight:800; color:var(--text-color);
    font-family:'Poppins',sans-serif;
}
.fv-vinput::placeholder { color:rgba(255,255,255,.15); }

/* Campos entrada à vista (substitui campo valor na col-esq) */
.fv-ent-grid {
    display:grid; grid-template-columns:1fr 1fr; gap:7px;
}
.fv-ent-lbl {
    font-size:.57rem; font-weight:700; text-transform:uppercase;
    letter-spacing:.06em; color:var(--text-secondary); margin-bottom:3px;
}
.fv-ninput {
    width:100%; background:rgba(255,255,255,.05);
    border:1px solid rgba(255,255,255,.1); border-radius:9px;
    padding:8px 10px; color:var(--text-color);
    font-family:'Poppins',sans-serif; font-size:.85rem; outline:none;
}
.fv-ninput:focus { border-color:var(--primary-color); }

/* RESULTADO */
#fv_result_zone { min-height:8px; }
.fv-card {
    border-radius:13px; padding:10px 12px;
    animation:fvIn .2s ease both;
}
.fv-card.ok {
    background:linear-gradient(135deg,rgba(74,222,128,.1),rgba(var(--primary-color-rgb),.05));
    border:1.5px solid rgba(74,222,128,.22);
}
.fv-card.bad { background:rgba(239,68,68,.07); border:1.5px solid rgba(239,68,68,.2); }
.fv-clbl { font-size:.57rem; font-weight:800; text-transform:uppercase; letter-spacing:.07em; color:var(--text-secondary); margin-bottom:2px; }
.fv-cval { font-size:1.45rem; font-weight:800; color:#4ade80; line-height:1.1; margin-bottom:2px; }
.fv-card.bad .fv-cval { color:#f87171; }
.fv-csub { font-size:.58rem; color:var(--text-secondary); line-height:1.4; }
.fv-lucro { display:flex; align-items:center; gap:5px; font-size:.68rem; font-weight:700; margin-top:5px; padding-top:5px; border-top:1px solid rgba(255,255,255,.07); }
.fv-lucro.pos { color:#4ade80; } .fv-lucro.neg { color:#f87171; }
.fv-brinde-tag { display:inline-flex; align-items:center; gap:4px; font-size:.6rem; color:#fbbf24; margin-top:3px; }
.fv-wait { padding:10px 12px; border-radius:12px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.06); color:var(--text-secondary); font-size:.76rem; display:flex; align-items:center; gap:7px; }
@keyframes fvIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }

/* ── BRINDE MINI (no bloco de cima) ── */
.fv-brinde-mini {
    display:flex; align-items:center; gap:5px;
    cursor:pointer; padding:3px 4px; margin-top:-2px;
    border-radius:6px; transition:background .15s;
    width:fit-content;
}
.fv-brinde-mini input {
    accent-color:#fbbf24; cursor:pointer;
    width:12px; height:12px; flex-shrink:0;
}
.fv-brinde-mini i { font-size:.6rem; color:rgba(251,191,36,.5); transition:color .15s; }
.fv-brinde-mini span { font-size:.6rem; font-weight:600; color:rgba(251,191,36,.5); white-space:nowrap; transition:color .15s; }
.fv-brinde-mini:has(input:checked) i,
.fv-brinde-mini:has(input:checked) span { color:#fbbf24; }

/* ── BUSCA PRODUTO NO TOPO ── */
#fv_top_prod_area { display:flex; flex-direction:column; gap:5px; }

/* Badge produto selecionado */
.fv-pbadge {
    display:flex; align-items:center; gap:7px;
    background:rgba(var(--primary-color-rgb),.08);
    border:1.5px solid rgba(var(--primary-color-rgb),.22);
    border-radius:10px; padding:7px 10px;
    font-size:.72rem; font-weight:600; color:var(--primary-color);
}
.fv-pbadge i { flex-shrink:0; }
.fv-pbadge span { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.fv-pbadge strong { flex-shrink:0; font-size:.75rem; }
.fv-pclear { background:none; border:none; color:var(--text-secondary); cursor:pointer; padding:2px; font-size:.88rem; line-height:1; display:flex; align-items:center; flex-shrink:0; }

/* BUSCA — dropdown sobe (bottom: 100%) */
.fv-srchwrap { position:relative; }
.fv-sinput {
    width:100%; background:rgba(255,255,255,.05);
    border:1px solid rgba(255,255,255,.1); border-radius:10px;
    padding:9px 12px; color:var(--text-color);
    font-family:'Poppins',sans-serif; font-size:.82rem; outline:none;
    transition:border-color .18s;
    box-sizing:border-box;
}
.fv-sinput:focus { border-color:var(--primary-color); }

/* Lista de resultados SOBE — fica acima do campo de busca */
.fv-results {
    position:absolute;
    bottom:100%; left:0; right:0;
    margin-bottom:4px;
    background:rgba(11,19,37,.98);
    border:1px solid rgba(255,255,255,.1);
    border-radius:12px; overflow:hidden;
    max-height:200px; overflow-y:auto;
    z-index:100;
    box-shadow:0 -8px 24px rgba(0,0,0,.4);
}
.fv-ri {
    display:flex; justify-content:space-between; align-items:center;
    width:100%; background:none; border:none;
    border-bottom:1px solid rgba(255,255,255,.05);
    padding:9px 13px; color:var(--text-color);
    font-family:'Poppins',sans-serif; cursor:pointer; text-align:left;
    transition:background .1s;
}
.fv-ri:last-child { border-bottom:none; }
.fv-ri:active { background:rgba(var(--primary-color-rgb),.12); }
.fv-rn { font-size:.8rem; font-weight:500; }
.fv-rp { font-size:.75rem; font-weight:700; color:var(--primary-color); }
.fv-no-result { padding:12px; text-align:center; color:var(--text-secondary); font-size:.8rem; display:flex; align-items:center; justify-content:center; gap:6px; }

/* CONFIG BOX (coluna direita) */
.fv-cbox {
    background:rgba(255,255,255,.03);
    border:1px solid rgba(255,255,255,.07);
    border-radius:14px; padding:9px 10px;
    display:flex; flex-direction:column; gap:8px;
}
.fv-clbl2 { font-size:.57rem; font-weight:800; text-transform:uppercase; letter-spacing:.07em; color:var(--text-secondary); margin-bottom:3px; }

/* Botões máquina */
.fv-mbtns { display:flex; flex-direction:column; gap:3px; }
.fv-mbtn {
    padding:5px 7px; border-radius:7px; text-align:left;
    border:1px solid rgba(255,255,255,.08); background:rgba(255,255,255,.04);
    color:var(--text-secondary); font-size:.63rem; font-weight:600;
    font-family:'Poppins',sans-serif; cursor:pointer; white-space:nowrap;
    overflow:hidden; text-overflow:ellipsis;
    transition:background .12s, border-color .12s, color .12s;
}
.fv-mbtn.active { background:rgba(var(--primary-color-rgb),.14); border-color:var(--primary-color); color:var(--primary-color); }

/* Bandeira */
.fv-brow { display:flex; align-items:center; gap:5px; }
.fv-bsel {
    flex:1; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1);
    border-radius:7px; padding:5px 7px; color:var(--text-color);
    font-size:.63rem; outline:none; font-family:'Poppins',sans-serif;
}
.fv-bsel option { background:#0b1325; }

/* Botões parcelas */
.fv-ibtns { display:flex; flex-wrap:wrap; gap:3px; }
.fv-ibtn {
    padding:4px 7px; border-radius:20px;
    border:1px solid rgba(255,255,255,.08); background:rgba(255,255,255,.04);
    color:var(--text-secondary); font-size:.62rem; font-weight:700;
    font-family:'Poppins',sans-serif; cursor:pointer;
    transition:background .12s, border-color .12s, color .12s;
}
.fv-ibtn.active { background:rgba(var(--primary-color-rgb),.17); border-color:var(--primary-color); color:var(--primary-color); }
.fv-islider { width:100%; accent-color:var(--primary-color); margin-top:2px; cursor:pointer; }

/* Divisor */
.fv-sep { height:1px; background:rgba(255,255,255,.06); margin:6px 14px; flex-shrink:0; }

/* ─── ZONA INFERIOR SCROLLÁVEL ───
   Aparece ABAIXO da zona fixa.
   Quando o teclado sobe, esta zona
   some (não importa — o usuário já
   vê o campo de valor e o resultado). */
.fv-bottom {
    flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch;
    padding:0 14px 100px;
}

/* Toggle Manual/Produto */
.fv-mtog {
    display:flex; align-items:center; gap:10px; justify-content:center;
    background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.07);
    border-radius:30px; padding:7px 14px; margin-bottom:10px;
}
.fv-tlbl { font-size:.76rem; font-weight:600; color:var(--text-secondary); transition:color .18s; white-space:nowrap; }
.fv-tlbl.active { color:var(--primary-color); }
.fv-tsw { position:relative; display:inline-block; width:38px; height:21px; flex-shrink:0; }
.fv-tsw input { opacity:0; width:0; height:0; }
.fv-tknob { position:absolute; inset:0; border-radius:30px; background:rgba(var(--primary-color-rgb),.2); cursor:pointer; transition:background .22s; }
.fv-tknob::before { content:''; position:absolute; height:15px; width:15px; left:3px; bottom:3px; border-radius:50%; background:#fff; transition:transform .22s; }
.fv-tsw input:checked + .fv-tknob { background:var(--primary-color); }
.fv-tsw input:checked + .fv-tknob::before { transform:translateX(17px); }

/* Área Manual */
.fv-atitle { font-size:.6rem; font-weight:800; text-transform:uppercase; letter-spacing:.07em; color:var(--text-secondary); margin-bottom:6px; }
.fv-rrow { display:flex; gap:7px; margin-bottom:10px; }
.fv-radio {
    flex:1; display:flex; align-items:center; gap:6px;
    background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08);
    border-radius:10px; padding:8px 10px; cursor:pointer;
    font-size:.76rem; font-weight:500; color:var(--text-color);
    transition:background .12s, border-color .12s;
}
.fv-radio:has(input:checked) { background:rgba(var(--primary-color-rgb),.1); border-color:var(--primary-color); color:var(--primary-color); }

/* Switch entrada à vista */
.fv-eslbl {
    display:flex; align-items:center; gap:9px; cursor:pointer;
    font-size:.78rem; font-weight:600; color:var(--text-secondary);
    background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08);
    border-radius:10px; padding:9px 12px; margin-bottom:8px;
    transition:background .12s;
}
.fv-eslbl:has(input:checked) { background:rgba(var(--primary-color-rgb),.09); border-color:rgba(var(--primary-color-rgb),.28); color:var(--primary-color); }
.fv-eslbl input { accent-color:var(--primary-color); }

/* Utilidade */
.fv-h { display:none !important; }
        `;
        document.head.appendChild(s);
    }

    // ── HTML ─────────────────────────────────────────────────────
    function renderHTML() {
        const c = el('fecharVenda');
        if (!c) return;
        c.innerHTML = `

        <!-- Header -->
        <div class="fv-hdr">
            <button class="btn-back" id="backFromFecharVenda" aria-label="Voltar">
                <i class="bi bi-arrow-left"></i>
            </button>
            <h3>Fechar Venda</h3>
        </div>

        <!-- ══ ZONA FIXA ══
             Teclado nunca cobre esta área.
             Contém TODOS os campos de digitação. -->
        <div class="fv-top">
            <div class="fv-grid">

                <!-- Esquerda: campo de valor + resultado + brinde + busca produto -->
                <div class="fv-left">

                    <!-- Campo principal de valor -->
                    <div class="fv-vcard" id="fv_value_wrap">
                        <div class="fv-vlbl" id="fv_value_label">Você cobrou (R$)</div>
                        <div class="fv-vrow">
                            <span class="fv-curr">R$</span>
                            <input type="tel" class="fv-vinput" id="fv_value"
                                   placeholder="0,00" inputmode="decimal" autocomplete="off">
                        </div>
                    </div>

                    <!-- Campos entrada à vista (substitui campo valor) -->
                    <div class="fv-ent-grid fv-h" id="fv_entrada_fields">
                        <div>
                            <div class="fv-ent-lbl"><i class="bi bi-cash"></i> À vista</div>
                            <input type="number" class="fv-ninput" id="fv_entrada_valor" min="0" step="0.01" placeholder="0,00">
                        </div>
                        <div>
                            <div class="fv-ent-lbl"><i class="bi bi-credit-card"></i> No cartão</div>
                            <input type="number" class="fv-ninput" id="fv_cartao_valor" min="0" step="0.01" placeholder="0,00">
                        </div>
                    </div>

                    <!-- Resultado -->
                    <div id="fv_result_zone"></div>

                    <!-- Brinde: pequeno e discreto, logo abaixo do resultado -->
                    <label class="fv-brinde-mini">
                        <input type="checkbox" id="fv_brinde">
                        <i class="bi bi-gift-fill"></i>
                        <span>Brinde −R$16</span>
                    </label>

                    <!-- Busca produto — só aparece no modo Produto -->
                    <div id="fv_top_prod_area" class="fv-h">

                        <!-- Badge produto selecionado -->
                        <div class="fv-pbadge fv-h" id="fv_prod_badge"></div>

                        <!-- Campo de busca com dropdown que SOBE (bottom:100%) -->
                        <div class="fv-srchwrap">
                            <div class="fv-results fv-h" id="fv_prod_results"></div>
                            <input type="text" class="fv-sinput" id="fv_prod_search"
                                   placeholder="Buscar produto..." autocomplete="off">
                        </div>

                    </div>

                </div><!-- /fv-left -->

                <!-- Direita: config compacta -->
                <div class="fv-right">
                    <div class="fv-cbox">

                        <!-- Máquina -->
                        <div>
                            <div class="fv-clbl2">Máquina</div>
                            <select id="fv_machine" style="display:none"></select>
                            <div class="fv-mbtns" id="fv_machine_btns"></div>
                        </div>

                        <!-- Bandeira -->
                        <div class="fv-brow fv-h" id="fv_brand_wrap">
                            <span class="fv-clbl2" style="margin:0;flex-shrink:0">Band.</span>
                            <select class="fv-bsel" id="fv_brand"></select>
                        </div>

                        <!-- Parcelas -->
                        <div>
                            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
                                <span class="fv-clbl2">Parcelas</span>
                                <span style="font-size:.65rem;font-weight:700;color:var(--primary-color)" id="fv_inst_label">Déb</span>
                            </div>
                            <div class="fv-ibtns" id="fv_inst_btns"></div>
                            <input type="range" class="fv-islider" id="fv_installments" min="0" max="21" step="1" value="0">
                        </div>

                    </div>
                </div><!-- /fv-right -->

            </div><!-- /fv-grid -->
        </div><!-- /fv-top -->

        <div class="fv-sep"></div>

        <!-- ══ ZONA SCROLLÁVEL ══
             Toggle modo, tipo de valor, entrada à vista.
             Fica abaixo quando teclado sobe — ok,
             pois o usuário não precisa ver isso
             enquanto digita. -->
        <div class="fv-bottom">

            <!-- Toggle Manual / Produto -->
            <div class="fv-mtog">
                <span class="fv-tlbl active" id="fv_lbl_manual">
                    <i class="bi bi-pencil"></i> Manual
                </span>
                <label class="fv-tsw">
                    <input type="checkbox" id="fv_modo_toggle">
                    <span class="fv-tknob"></span>
                </label>
                <span class="fv-tlbl" id="fv_lbl_produto">
                    <i class="bi bi-box-seam"></i> Produto
                </span>
            </div>

            <!-- Área Manual -->
            <div id="fv_manual_area">
                <div class="fv-atitle">Tipo de valor digitado</div>
                <div class="fv-rrow">
                    <label class="fv-radio">
                        <input type="radio" name="fv_manual_mode" value="total" checked>
                        Total da venda
                    </label>
                    <label class="fv-radio">
                        <input type="radio" name="fv_manual_mode" value="parcela">
                        Por parcela
                    </label>
                </div>
            </div>

            <!-- Área Produto — só mostra toggle entrada à vista -->
            <div id="fv_produto_area" class="fv-h">
                <div class="fv-h" id="fv_entrada_wrap">
                    <label class="fv-eslbl">
                        <input type="checkbox" id="fv_entrada_check">
                        <span><i class="bi bi-cash-coin"></i> Teve valor à vista?</span>
                    </label>
                </div>
            </div>

        </div><!-- /fv-bottom -->
        `;
    }

    // ── Eventos ───────────────────────────────────────────────────
    function bindEvents() {
        // ── Botão Voltar ─────────────────────────────────────────
        // Fix: openCalculatorSection pode não estar exposta no window (módulo ES6)
        // Usa fallback direto manipulando display dos elementos
        el('backFromFecharVenda')?.addEventListener('click', () => {
            if (typeof window.openCalculatorSection === 'function') {
                window.openCalculatorSection('calculatorHome');
            } else {
                // Fallback: esconde fecharVenda, mostra calculatorHome
                const fv   = document.getElementById('fecharVenda');
                const home = document.getElementById('calculatorHome');
                if (fv)   fv.style.display   = 'none';
                if (home) home.style.display  = 'flex';
            }
        });

        el('fv_installments')?.addEventListener('input', () => {
            syncInstLabel(); renderInstBtns(); calculate();
        });
        el('fv_brand')?.addEventListener('change', calculate);
        el('fv_modo_toggle')?.addEventListener('change', onModoChange);
        el('fv_brinde')?.addEventListener('change', calculate);

        document.querySelectorAll('input[name="fv_manual_mode"]').forEach(r =>
            r.addEventListener('change', () => {
                const lbl = el('fv_value_label');
                if (lbl) lbl.textContent = r.value==='parcela' ? 'Valor por parcela (R$)' : 'Você cobrou (R$)';
                calculate();
            })
        );

        el('fv_prod_search')?.addEventListener('input', onSearchInput);
        el('fv_prod_search')?.addEventListener('focus', onSearchInput);

        el('fv_entrada_check')?.addEventListener('change', onEntradaToggle);
        el('fv_entrada_valor')?.addEventListener('input', calculate);
        el('fv_cartao_valor')?.addEventListener('input', calculate);

        moneyMask(el('fv_value'));

        // Fecha dropdown ao clicar fora
        document.addEventListener('click', e => {
            const res = el('fv_prod_results');
            const inp = el('fv_prod_search');
            if (res && inp && !inp.contains(e.target) && !res.contains(e.target)) {
                res.classList.add('fv-h');
            }
        }, true);
    }

    // ── API chamada pelo app.js quando taxas chegam ──────────────
    window._fvOnRatesLoaded = function() { calculate(); };

    // ── Compatibilidade: precoBase externo ───────────────────────
    function watchPrecoBase() {
        let last = 0;
        setInterval(() => {
            const ext = window._fecharVendaPrecoBase || 0;
            if (ext !== last) {
                last = ext; precoBase = ext;
                el('fv_entrada_wrap')?.classList.remove('fv-h');
                calculate();
            }
        }, 500);
    }

    // ── Init ─────────────────────────────────────────────────────
    function init() {
        if (initialized) {
            // Sempre re-renderiza máquinas ao reabrir para refletir
            // mudanças feitas nas configurações de admin (desativar/ativar)
            refreshMachineSelect();
            renderMachineBtns();
            updateBrandVis();
            renderInstBtns();
            calculate();
            return;
        }
        injectCSS();
        renderHTML();

        // Popula select oculto de máquinas (respeitando padrão e desativadas)
        refreshMachineSelect();

        populateBrands();
        updateBrandVis();
        renderMachineBtns();
        renderInstBtns();
        bindEvents();
        watchPrecoBase();
        initialized = true;

        setTimeout(() => el('fv_value')?.focus(), 150);
    }

    // Atualiza o select hidden de máquinas com base no padrão e desativadas
    function refreshMachineSelect() {
        const msel = el('fv_machine');
        if (!msel) return;
        const machines = getMachines();
        const saved = safeGet('ctwDefaultMachine') || 'pagbank';
        // Se a máquina padrão está desativada, usa a primeira disponível
        const defaultV = machines.find(m => m.v === saved) ? saved : (machines[0]?.v || 'pagbank');
        msel.innerHTML = machines
            .map(m=>`<option value="${m.v}" ${m.v===defaultV?'selected':''}>${m.l}</option>`)
            .join('');
    }

    // ── API pública ──────────────────────────────────────────────
    window._initFecharVenda = () => { init(); calculate(); };
    window._fvSelectProduct = p  => { if (p) selectProduct(p); };

})();