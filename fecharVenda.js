(function(){"use strict";function I(){return!!window._areRatesLoaded}function w(){return window.products||[]}function F(){return window._fuse||null}function y(e,r,o){return typeof window._getRate=="function"?window._getRate(e,r,o):void 0}function D(e){return typeof window._parseBrazilianCurrencyToFloat=="function"?window._parseBrazilianCurrencyToFloat(e):parseFloat(String(e).replace(/\./g,"").replace(",","."))||0}function d(e){return e.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}function g(e){try{return localStorage.getItem(e)}catch{return null}}let l=0,k=!1;const H=16,a=e=>document.getElementById(e);function L(){let e=[];try{e=JSON.parse(localStorage.getItem("disabledMachines")||"[]")}catch{}return[{v:"pagbank",l:"PagBank"},{v:"infinity",l:"InfinityPay"},{v:"valorante",l:"Valorante"},{v:"nubank",l:"Nubank"}].filter(r=>!e.includes(r.v))}function A(e){return{pagbank:18,infinity:12,valorante:21,nubank:12}[e]||18}const f=()=>a("fv_machine")?.value||"pagbank",$=()=>a("fv_brand")?.value||"visa",p=()=>parseInt(a("fv_installments")?.value||"0"),z=()=>a("fv_modo_toggle")?.checked?"produto":"manual",q=()=>!!a("fv_brinde")?.checked;function m(){const e=a("fv_machine_btns");if(!e)return;const r=L();let o=f();if(!r.find(t=>t.v===o)){const t=g("ctwDefaultMachine");o=t&&r.find(i=>i.v===t)?t:r[0]?.v||"pagbank",a("fv_machine")&&(a("fv_machine").value=o)}e.innerHTML=r.map(t=>`<button class="fv-mbtn${o===t.v?" active":""}" data-m="${t.v}">${t.l}</button>`).join(""),e.querySelectorAll(".fv-mbtn").forEach(t=>{t.addEventListener("click",()=>{a("fv_machine").value=t.dataset.m,m(),x(),u(),n()})})}function N(){const e=a("fv_brand");if(!e)return;const r=g("ctwDefaultBrand")||"visa";["visa","mastercard","elo","hipercard","hiper","amex"].forEach(o=>{const t=document.createElement("option");t.value=o,t.textContent=o.charAt(0).toUpperCase()+o.slice(1),o===r&&(t.selected=!0),e.appendChild(t)})}function x(){const e=a("fv_brand_wrap");e&&(e.style.display=f()!=="pagbank"?"flex":"none")}function u(){const e=a("fv_inst_btns");if(!e)return;const r=A(f()),o=p(),t=a("fv_installments");t&&(t.max=r);const i=[0,1,8,10,12,18,21].filter(s=>s===0||s<=r);e.innerHTML=i.map(s=>`<button class="fv-ibtn${o===s?" active":""}" data-v="${s}">${s===0?"D\xE9b":`${s}x`}</button>`).join(""),e.querySelectorAll(".fv-ibtn").forEach(s=>{s.addEventListener("click",()=>{a("fv_installments")&&(a("fv_installments").value=s.dataset.v),u(),B(),n()})})}function B(){const e=p(),r=a("fv_inst_label");r&&(r.textContent=e===0?"D\xE9b":`${e}x`)}function V(){const e=z()==="produto";a("fv_manual_area")?.classList.toggle("fv-h",e),a("fv_produto_area")?.classList.toggle("fv-h",!e),a("fv_lbl_manual")?.classList.toggle("active",!e),a("fv_lbl_produto")?.classList.toggle("active",e),a("fv_top_prod_area")?.classList.toggle("fv-h",!e);const r=e&&!!a("fv_entrada_check")?.checked;a("fv_value_wrap")?.classList.toggle("fv-h",r),a("fv_entrada_fields")?.classList.toggle("fv-h",!r);const o=a("fv_value_label");o&&(o.textContent="Voc\xEA cobrou (R$)"),e||(l=0,E()),n()}function E(){a("fv_prod_search")&&(a("fv_prod_search").value="");const e=a("fv_prod_results");e&&(e.innerHTML="",e.classList.add("fv-h"));const r=a("fv_prod_badge");r&&(r.innerHTML="",r.classList.add("fv-h")),a("fv_entrada_wrap")?.classList.add("fv-h"),a("fv_entrada_fields")?.classList.add("fv-h"),a("fv_value_wrap")?.classList.remove("fv-h"),a("fv_entrada_check")&&(a("fv_entrada_check").checked=!1)}function M(){const e=a("fv_prod_search")?.value.trim(),r=a("fv_prod_results");if(!r)return;if(!e||e.length<1){r.innerHTML="",r.classList.add("fv-h");return}const o=F();let t=o?o.search(e).slice(0,8).map(i=>i.item):w().filter(i=>i.nome?.toLowerCase().includes(e.toLowerCase())).slice(0,8);t.length?(r.innerHTML=t.map(i=>`<button class="fv-ri" data-id="${i.id}">
                    <span class="fv-rn">${i.nome}</span>
                    <span class="fv-rp">${d(parseFloat(i.valor)||0)}</span>
                 </button>`).join(""),r.querySelectorAll(".fv-ri").forEach(i=>i.addEventListener("click",()=>{const s=w().find(c=>c.id===i.dataset.id);s&&T(s)}))):r.innerHTML='<div class="fv-no-result"><i class="bi bi-search"></i> Nenhum produto</div>',r.classList.remove("fv-h")}function T(e){l=parseFloat(e.valor)||0,a("fv_prod_search")&&(a("fv_prod_search").value=e.nome);const r=a("fv_prod_results");r&&(r.innerHTML="",r.classList.add("fv-h"));const o=a("fv_prod_badge");o&&(o.innerHTML=`
                <i class="bi bi-box-seam-fill"></i>
                <span>${e.nome}</span>
                <strong>${d(l)}</strong>
                <button class="fv-pclear" id="fv_prod_clear"><i class="bi bi-x"></i></button>`,o.classList.remove("fv-h"),a("fv_prod_clear")?.addEventListener("click",()=>{l=0,E(),n()})),a("fv_entrada_wrap")?.classList.remove("fv-h");const t=y(f(),$(),p());if(t!==void 0&&a("fv_value")&&!a("fv_entrada_check")?.checked){const i=l/(1-t/100);a("fv_value").value=i.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}n()}function j(){const e=a("fv_entrada_check")?.checked;a("fv_entrada_fields")?.classList.toggle("fv-h",!e),a("fv_value_wrap")?.classList.toggle("fv-h",!!e),e||(a("fv_entrada_valor")&&(a("fv_entrada_valor").value=""),a("fv_cartao_valor")&&(a("fv_cartao_valor").value="")),n()}function U(e){e&&e.addEventListener("input",r=>{const o=r.target.value.replace(/\D/g,"");r.target.value=o?(parseFloat(o)/100).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}):"",n()})}function n(){const e=a("fv_result_zone");if(!e)return;if(!I()){e.innerHTML='<div class="fv-wait"><i class="bi bi-hourglass-split"></i> Carregando taxas...</div>';return}const r=y(f(),$(),p());if(r==null){e.innerHTML='<div class="fv-wait"><i class="bi bi-exclamation-triangle"></i> Taxa indispon\xEDvel.</div>';return}const o=q()?H:0,t=z()==="produto";if(t&&!!a("fv_entrada_check")?.checked){if(l<=0){e.innerHTML='<div class="fv-wait"><i class="bi bi-info-circle"></i> Selecione um produto.</div>';return}const h=parseFloat(a("fv_entrada_valor")?.value)||0,_=parseFloat(a("fv_cartao_valor")?.value)||0;if(!h&&!_){e.innerHTML="";return}const W=_*(1-r/100),R=h+W-o,ee=R-l;C(e,{liquid:R,sub:`${d(h)} \xE0 vista + ${d(_)} cart\xE3o (${r.toFixed(2)}%)`,lucro:ee,brinde:o});return}const s=a("fv_value")?.value||"",c=D(s);if(!c||c<=0){e.innerHTML="";return}const b=document.querySelector('input[name="fv_manual_mode"]:checked')?.value||"total",v=p(),O=!t&&b==="parcela"&&v>0?c*v:c,S=O*(1-r/100)-o,Q=t&&l>0?S-l:null,K=!t&&b==="parcela"&&v>0?` \xB7 ${v}x de ${d(c)} = ${d(O)}`:"";C(e,{liquid:S,sub:`Taxa ${r.toFixed(2)}% \xB7 ${v===0?"D\xE9bito":`${v}x`}${K}`,lucro:Q,brinde:o})}function C(e,{liquid:r,sub:o,lucro:t,brinde:i}){const s=t===null||t>=0,c=t!==null?`<div class="fv-lucro ${t>=0?"pos":"neg"}">
                   <i class="bi bi-${t>=0?"graph-up-arrow":"graph-down-arrow"}"></i>
                   Lucro: ${d(t)}
               </div>`:"",b=i>0?`<div class="fv-brinde-tag"><i class="bi bi-gift"></i> Brinde \u2212${d(i)}</div>`:"";e.innerHTML=`
        <div class="fv-card ${s?"ok":"bad"}">
            <div class="fv-clbl">Voc\xEA recebe</div>
            <div class="fv-cval">${d(r)}</div>
            <div class="fv-csub">${o}</div>
            ${b}${c}
        </div>`}function X(){if(a("fv-styles"))return;const e=document.createElement("style");e.id="fv-styles",e.textContent=`
/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   FECHAR VENDA \u2014 Layout B keyboard-safe
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
#fecharVenda {
    display:flex; flex-direction:column;
    height:100%; max-height:100dvh;
    background:var(--bg-color); overflow:hidden;
}

/* \u2500\u2500\u2500 ZONA FIXA NO TOPO \u2500\u2500\u2500
   Nunca \xE9 coberta pelo teclado.
   Cont\xE9m TODOS os campos de digita\xE7\xE3o. */
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
    background:var(--card-bg);
    border:1px solid var(--ui-edge);
    border-radius:var(--radius-card, 22px); padding:12px 14px;
}
.fv-vlbl {
    font-size:.58rem; font-weight:800; text-transform:uppercase;
    letter-spacing:.08em; color:var(--primary-color); margin-bottom:5px;
}
.fv-vrow {
    display:flex; align-items:center; gap:6px;
    background:var(--input-bg);
    border:1.5px solid transparent;
    border-radius:16px; padding:8px 12px;
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
.fv-vinput::placeholder { color:var(--ui-tx3); opacity:.6; }

/* Campos entrada \xE0 vista (substitui campo valor na col-esq) */
.fv-ent-grid {
    display:grid; grid-template-columns:1fr 1fr; gap:7px;
}
.fv-ent-lbl {
    font-size:.57rem; font-weight:700; text-transform:uppercase;
    letter-spacing:.06em; color:var(--text-secondary); margin-bottom:3px;
}
.fv-ninput {
    width:100%; background:var(--input-bg);
    border:1.5px solid transparent; border-radius:14px;
    padding:9px 12px; color:var(--text-color);
    font-family:'Poppins',sans-serif; font-size:.85rem; outline:none;
}
.fv-ninput:focus, 
/* RESULTADO */
#fv_result_zone { min-height:8px; }
.fv-card {
    border-radius:18px; padding:12px 14px;
    animation:fvIn .2s ease both;
}
.fv-card.ok {
    background:var(--ui-icbg);
    border:1px solid rgba(var(--primary-color-rgb),.28);
}
.fv-card.bad { background:var(--ui-bad-bg); border:1px solid var(--status-bad); }
.fv-clbl { font-size:.57rem; font-weight:800; text-transform:uppercase; letter-spacing:.07em; color:var(--text-secondary); margin-bottom:2px; }
.fv-cval { font-size:1.45rem; font-weight:800; color:var(--primary-color); line-height:1.1; margin-bottom:2px; }
.fv-card.bad .fv-cval { color:var(--status-bad); }
.fv-csub { font-size:.58rem; color:var(--text-secondary); line-height:1.4; }
.fv-lucro { display:flex; align-items:center; gap:5px; font-size:.68rem; font-weight:700; margin-top:5px; padding-top:5px; border-top:1px solid var(--ui-edge); }
.fv-lucro.pos { color:var(--primary-color); } .fv-lucro.neg { color:var(--status-bad); }
.fv-brinde-tag { display:inline-flex; align-items:center; gap:4px; font-size:.6rem; color:var(--status-warn); margin-top:3px; }
.fv-wait { padding:10px 12px; border-radius:12px; background:var(--card-bg); border:1px solid var(--ui-edge); color:var(--text-secondary); font-size:.76rem; display:flex; align-items:center; gap:7px; }
@keyframes fvIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }

/* \u2500\u2500 BRINDE MINI (no bloco de cima) \u2500\u2500 */
.fv-brinde-mini {
    display:flex; align-items:center; gap:5px;
    cursor:pointer; padding:3px 4px; margin-top:-2px;
    border-radius:6px; transition:background .15s;
    width:fit-content;
}
.fv-brinde-mini input {
    accent-color:var(--status-warn); cursor:pointer;
    width:12px; height:12px; flex-shrink:0;
}
.fv-brinde-mini i { font-size:.6rem; color:var(--ui-tx3); transition:color .15s; }
.fv-brinde-mini span { font-size:.6rem; font-weight:600; color:var(--ui-tx3); white-space:nowrap; transition:color .15s; }
.fv-brinde-mini:has(input:checked) i,
.fv-brinde-mini:has(input:checked) span { color:var(--status-warn); }

/* \u2500\u2500 BUSCA PRODUTO NO TOPO \u2500\u2500 */
#fv_top_prod_area { display:flex; flex-direction:column; gap:5px; }

/* Badge produto selecionado */
.fv-pbadge {
    display:flex; align-items:center; gap:7px;
    background:var(--ui-icbg);
    border:1px solid rgba(var(--primary-color-rgb),.28);
    border-radius:14px; padding:8px 12px;
    font-size:.72rem; font-weight:600; color:var(--primary-color);
}
.fv-pbadge i { flex-shrink:0; }
.fv-pbadge span { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.fv-pbadge strong { flex-shrink:0; font-size:.75rem; }
.fv-pclear { background:none; border:none; color:var(--text-secondary); cursor:pointer; padding:2px; font-size:.88rem; line-height:1; display:flex; align-items:center; flex-shrink:0; }

/* BUSCA \u2014 dropdown sobe (bottom: 100%) */
.fv-srchwrap { position:relative; }
.fv-sinput {
    width:100%; background:var(--input-bg);
    border:1.5px solid transparent; border-radius:14px;
    padding:10px 12px; color:var(--text-color);
    font-family:'Poppins',sans-serif; font-size:.82rem; outline:none;
    transition:border-color .18s;
    box-sizing:border-box;
}
.fv-sinput:focus { border-color:var(--primary-color); }

/* Lista de resultados SOBE \u2014 fica acima do campo de busca */
.fv-results {
    position:absolute;
    bottom:100%; left:0; right:0;
    margin-bottom:4px;
    background:var(--card-bg);
    border:1px solid var(--ui-edge);
    border-radius:16px; overflow:hidden;
    max-height:200px; overflow-y:auto;
    z-index:100;
    box-shadow:0 -8px 24px rgba(0,0,0,.4);
}
.fv-ri {
    display:flex; justify-content:space-between; align-items:center;
    width:100%; background:none; border:none;
    border-bottom:1px solid var(--ui-edge);
    padding:10px 14px; color:var(--text-color);
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
    background:var(--card-bg);
    border:1px solid var(--ui-edge);
    border-radius:var(--radius-card, 22px); padding:12px;
    display:flex; flex-direction:column; gap:8px;
}
.fv-clbl2 { font-size:.57rem; font-weight:800; text-transform:uppercase; letter-spacing:.07em; color:var(--text-secondary); margin-bottom:3px; }

/* Bot\xF5es m\xE1quina */
.fv-mbtns { display:flex; flex-direction:column; gap:3px; }
.fv-mbtn {
    padding:6px 9px; border-radius:11px; text-align:left;
    border:1px solid transparent; background:var(--input-bg);
    color:var(--text-secondary); font-size:.63rem; font-weight:600;
    font-family:'Poppins',sans-serif; cursor:pointer; white-space:nowrap;
    overflow:hidden; text-overflow:ellipsis;
    transition:background .12s, border-color .12s, color .12s;
}
.fv-mbtn.active { background:var(--ui-icbg); border-color:var(--primary-color); color:var(--primary-color); }

/* Bandeira */
.fv-brow { display:flex; align-items:center; gap:5px; }
.fv-bsel {
    flex:1; background:var(--input-bg); border:1px solid transparent;
    border-radius:10px; padding:5px 8px; color:var(--text-color);
    font-size:.63rem; outline:none; font-family:'Poppins',sans-serif;
}
.fv-bsel option { background:var(--card-bg); color:var(--text-color); }

/* Bot\xF5es parcelas */
.fv-ibtns { display:flex; flex-wrap:wrap; gap:3px; }
.fv-ibtn {
    padding:4px 9px; border-radius:999px;
    border:1px solid transparent; background:var(--input-bg);
    color:var(--text-secondary); font-size:.62rem; font-weight:700;
    font-family:'Poppins',sans-serif; cursor:pointer;
    transition:background .12s, border-color .12s, color .12s;
}
.fv-ibtn.active { background:var(--ui-icbg); border-color:var(--primary-color); color:var(--primary-color); }
.fv-islider { width:100%; accent-color:var(--primary-color); margin-top:2px; cursor:pointer; }

/* Divisor */
.fv-sep { height:1px; background:var(--ui-edge); margin:6px 14px; flex-shrink:0; }

/* \u2500\u2500\u2500 ZONA INFERIOR SCROLL\xC1VEL \u2500\u2500\u2500
   Aparece ABAIXO da zona fixa.
   Quando o teclado sobe, esta zona
   some (n\xE3o importa \u2014 o usu\xE1rio j\xE1
   v\xEA o campo de valor e o resultado). */
.fv-bottom {
    flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch;
    padding:0 14px 100px;
}

/* Toggle Manual/Produto */
.fv-mtog {
    display:flex; align-items:center; gap:10px; justify-content:center;
    background:var(--card-bg); border:1px solid var(--ui-edge);
    border-radius:999px; padding:8px 14px; margin-bottom:10px;
}
.fv-tlbl { font-size:.76rem; font-weight:600; color:var(--text-secondary); transition:color .18s; white-space:nowrap; }
.fv-tlbl.active { color:var(--primary-color); }
.fv-tsw { position:relative; display:inline-block; width:38px; height:21px; flex-shrink:0; }
.fv-tsw input { opacity:0; width:0; height:0; }
.fv-tknob { position:absolute; inset:0; border-radius:30px; background:var(--ui-track); cursor:pointer; transition:background .22s; }
.fv-tknob::before { content:''; position:absolute; height:15px; width:15px; left:3px; bottom:3px; border-radius:50%; background:#fff; transition:transform .22s; }
.fv-tsw input:checked + .fv-tknob { background:var(--primary-color); }
.fv-tsw input:checked + .fv-tknob::before { transform:translateX(17px); }

/* \xC1rea Manual */
.fv-atitle { font-size:.6rem; font-weight:800; text-transform:uppercase; letter-spacing:.07em; color:var(--text-secondary); margin-bottom:6px; }
.fv-rrow { display:flex; gap:7px; margin-bottom:10px; }
.fv-radio {
    flex:1; display:flex; align-items:center; gap:6px;
    background:var(--card-bg); border:1px solid var(--ui-edge);
    border-radius:14px; padding:10px 12px; cursor:pointer;
    font-size:.76rem; font-weight:500; color:var(--text-color);
    transition:background .12s, border-color .12s;
}
.fv-radio:has(input:checked) { background:var(--ui-icbg); border-color:var(--primary-color); color:var(--primary-color); }

/* Switch entrada \xE0 vista */
.fv-eslbl {
    display:flex; align-items:center; gap:9px; cursor:pointer;
    font-size:.78rem; font-weight:600; color:var(--text-secondary);
    background:var(--card-bg); border:1px solid var(--ui-edge);
    border-radius:14px; padding:10px 12px; margin-bottom:8px;
    transition:background .12s;
}
.fv-eslbl:has(input:checked) { background:var(--ui-icbg); border-color:rgba(var(--primary-color-rgb),.28); color:var(--primary-color); }
.fv-eslbl input { accent-color:var(--primary-color); }

/* Utilidade */
.fv-h { display:none !important; }
        `,document.head.appendChild(e)}function Z(){const e=a("fecharVenda");e&&(e.innerHTML=`

        <!-- \u2550\u2550 ZONA FIXA \u2550\u2550
             Teclado nunca cobre esta \xE1rea.
             Cont\xE9m TODOS os campos de digita\xE7\xE3o. -->
        <div class="fv-top">
            <div class="fv-grid">

                <!-- Esquerda: campo de valor + resultado + brinde + busca produto -->
                <div class="fv-left">

                    <!-- Campo principal de valor -->
                    <div class="fv-vcard" id="fv_value_wrap">
                        <div class="fv-vlbl" id="fv_value_label">Voc\xEA cobrou (R$)</div>
                        <div class="fv-vrow">
                            <span class="fv-curr">R$</span>
                            <input type="tel" class="fv-vinput" id="fv_value"
                                   placeholder="0,00" inputmode="decimal" autocomplete="off">
                        </div>
                    </div>

                    <!-- Campos entrada \xE0 vista (substitui campo valor) -->
                    <div class="fv-ent-grid fv-h" id="fv_entrada_fields">
                        <div>
                            <div class="fv-ent-lbl"><i class="bi bi-cash"></i> \xC0 vista</div>
                            <input type="number" class="fv-ninput" id="fv_entrada_valor" min="0" step="0.01" placeholder="0,00">
                        </div>
                        <div>
                            <div class="fv-ent-lbl"><i class="bi bi-credit-card"></i> No cart\xE3o</div>
                            <input type="number" class="fv-ninput" id="fv_cartao_valor" min="0" step="0.01" placeholder="0,00">
                        </div>
                    </div>

                    <!-- Resultado -->
                    <div id="fv_result_zone"></div>

                    <!-- Brinde: pequeno e discreto, logo abaixo do resultado -->
                    <label class="fv-brinde-mini">
                        <input type="checkbox" id="fv_brinde">
                        <i class="bi bi-gift-fill"></i>
                        <span>Brinde \u2212R$16</span>
                    </label>

                    <!-- Busca produto \u2014 s\xF3 aparece no modo Produto -->
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

                        <!-- M\xE1quina -->
                        <div>
                            <div class="fv-clbl2">M\xE1quina</div>
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
                                <span style="font-size:.65rem;font-weight:700;color:var(--primary-color)" id="fv_inst_label">D\xE9b</span>
                            </div>
                            <div class="fv-ibtns" id="fv_inst_btns"></div>
                            <input type="range" class="fv-islider" id="fv_installments" min="0" max="21" step="1" value="0">
                        </div>

                    </div>
                </div><!-- /fv-right -->

            </div><!-- /fv-grid -->
        </div><!-- /fv-top -->

        <div class="fv-sep"></div>

        <!-- \u2550\u2550 ZONA SCROLL\xC1VEL \u2550\u2550
             Toggle modo, tipo de valor, entrada \xE0 vista.
             Fica abaixo quando teclado sobe \u2014 ok,
             pois o usu\xE1rio n\xE3o precisa ver isso
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

            <!-- \xC1rea Manual -->
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

            <!-- \xC1rea Produto \u2014 s\xF3 mostra toggle entrada \xE0 vista -->
            <div id="fv_produto_area" class="fv-h">
                <div class="fv-h" id="fv_entrada_wrap">
                    <label class="fv-eslbl">
                        <input type="checkbox" id="fv_entrada_check">
                        <span><i class="bi bi-cash-coin"></i> Teve valor \xE0 vista?</span>
                    </label>
                </div>
            </div>

        </div><!-- /fv-bottom -->
        `)}function G(){a("fv_installments")?.addEventListener("input",()=>{B(),u(),n()}),a("fv_brand")?.addEventListener("change",n),a("fv_modo_toggle")?.addEventListener("change",V),a("fv_brinde")?.addEventListener("change",n),document.querySelectorAll('input[name="fv_manual_mode"]').forEach(e=>e.addEventListener("change",()=>{const r=a("fv_value_label");r&&(r.textContent=e.value==="parcela"?"Valor por parcela (R$)":"Voc\xEA cobrou (R$)"),n()})),a("fv_prod_search")?.addEventListener("input",M),a("fv_prod_search")?.addEventListener("focus",M),a("fv_entrada_check")?.addEventListener("change",j),a("fv_entrada_valor")?.addEventListener("input",n),a("fv_cartao_valor")?.addEventListener("input",n),U(a("fv_value")),document.addEventListener("click",e=>{const r=a("fv_prod_results"),o=a("fv_prod_search");r&&o&&!o.contains(e.target)&&!r.contains(e.target)&&r.classList.add("fv-h")},!0)}window._fvOnRatesLoaded=function(){n()};function Y(){let e=window._fecharVendaPrecoBase||0,r=0;const o=()=>{const t=e||0;t!==r&&(r=t,l=t,a("fv_entrada_wrap")?.classList.remove("fv-h"),n())};Object.defineProperty(window,"_fecharVendaPrecoBase",{configurable:!0,get(){return e},set(t){e=t,o()}}),o()}function J(){if(k){P(),m(),x(),u(),n();return}X(),Z(),P(),N(),x(),m(),u(),G(),Y(),k=!0,setTimeout(()=>a("fv_value")?.focus(),150)}function P(){const e=a("fv_machine");if(!e)return;const r=L(),o=g("ctwDefaultMachine")||"pagbank",t=r.find(i=>i.v===o)?o:r[0]?.v||"pagbank";e.innerHTML=r.map(i=>`<option value="${i.v}" ${i.v===t?"selected":""}>${i.l}</option>`).join("")}window._initFecharVenda=()=>{J(),n()},window._fvSelectProduct=e=>{e&&T(e)}})();
