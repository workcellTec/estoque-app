(function(){"use strict";const L="ctwGroqApiKey",S="scFotografadosHoje";function I(){if(window.safeStorage?.getItem){const e=window.safeStorage.getItem(L);if(e)return e}try{const e=localStorage.getItem(L);if(e)return e}catch{}return""}function B(){return new Date().toISOString().slice(0,10)}function q(){try{return JSON.parse(localStorage.getItem(S)||"{}")}catch{return{}}}function R(e){const o=q();o[e]=B();try{localStorage.setItem(S,JSON.stringify(o))}catch{}}function $(e){return q()[e]===B()}function O(e){try{const o=Date.now();if(window.checkedItems&&(window.checkedItems[e]={checked:!0,timestamp:o}),typeof window.saveCheckedItems=="function")window.saveCheckedItems();else try{const t="ctwCheckedItems",n=JSON.parse(localStorage.getItem(t)||"{}");n[e]={checked:!0,timestamp:o},localStorage.setItem(t,JSON.stringify(n))}catch{}typeof window.updateProductInDB=="function"&&window.updateProductInDB(e,{lastCheckedTimestamp:o})}catch(o){console.error("StockCount _marcarComoConferido:",o)}}const f=[];let k=!1,b=[],g=null,p=null,h=null;function A(){N(),H(),j(),z(),D()}function N(){if(document.getElementById("scStyles"))return;const e=document.createElement("style");e.id="scStyles",e.textContent=`
            @keyframes scPulse { 0%,100%{opacity:1} 50%{opacity:.6} }
            .sc-cam-btn {
                width:34px; height:34px; border-radius:8px; border:none; cursor:pointer;
                background:rgba(0,184,148,.18); color:#00b894;
                display:flex; align-items:center; justify-content:center; font-size:.95rem;
                flex-shrink:0; transition:background .2s; position:relative;
            }
            .sc-cam-btn:active { background:rgba(0,184,148,.35); }
            .sc-cam-btn.sc-busy { background:rgba(251,146,60,.15); color:#fb923c; animation:scPulse 1.4s infinite; }
            .sc-cam-btn.sc-done-today {
                background:rgba(74,222,128,.15); color:#4ade80;
                border:1px solid rgba(74,222,128,.3);
            }
            /* Badge de quantidade de fotos no bot\xE3o */
            .sc-foto-count {
                position:absolute; top:-5px; right:-5px;
                background:#fb923c; color:#000;
                font-size:.6rem; font-weight:700; min-width:16px; height:16px;
                border-radius:8px; display:flex; align-items:center; justify-content:center;
                padding:0 3px; pointer-events:none;
            }
            #scBadge {
                display:none; position:fixed; bottom:76px; right:14px; z-index:9999;
                background:#00b894; color:#000; border-radius:20px;
                padding:5px 13px; font-size:.76rem; font-weight:700;
                box-shadow:0 4px 14px rgba(0,0,0,.35);
                animation:scPulse 1.4s infinite;
            }
            .sc-erros-banner {
                background:rgba(251,146,60,.1); border:1px solid rgba(251,146,60,.35);
                border-radius:12px; padding:10px 14px; margin-bottom:10px; font-size:.8rem;
            }
            /* Autocomplete */
            #scAutoComplete {
                position:absolute; left:0; right:0; top:100%;
                background:var(--card-bg,#1a1a2e); border:1px solid var(--glass-border,rgba(255,255,255,.1));
                border-top:none; border-radius:0 0 12px 12px; z-index:1000;
                max-height:260px; overflow-y:auto; box-shadow:0 8px 24px rgba(0,0,0,.4);
            }
            .sc-ac-item {
                padding:10px 14px; cursor:pointer; font-size:.85rem;
                border-bottom:1px solid rgba(255,255,255,.05);
                color:var(--text-color,#fff); display:flex; align-items:center; gap:8px;
            }
            .sc-ac-item:last-child { border-bottom:none; }
            .sc-ac-item:hover, .sc-ac-item.sc-ac-active { background:rgba(0,184,148,.15); }
            .sc-ac-dot { width:10px; height:10px; border-radius:50%; border:1px solid rgba(255,255,255,.2); flex-shrink:0; }
            .sc-ac-nome { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .sc-ac-qty { font-size:.75rem; color:var(--text-secondary,#999); flex-shrink:0; }
            .sc-ac-today { font-size:.68rem; background:rgba(74,222,128,.2); color:#4ade80; border-radius:6px; padding:1px 5px; flex-shrink:0; }
            #scSearchWrap { position:relative; flex:1; min-width:180px; }
        `,document.head.appendChild(e)}function H(){g=document.createElement("input"),g.type="file",g.accept="image/*",g.capture="environment",g.style.display="none",document.body.appendChild(g),g.addEventListener("change",async e=>{const o=e.target.files?.[0];if(e.target.value="",!o||!p)return;const t=p;t.fotos=t.fotos||[],t.fotos.push(o);const n=t.fotos.length;if(t.btn){let r=t.btn.querySelector(".sc-foto-count");r||(r=document.createElement("span"),r.className="sc-foto-count",t.btn.appendChild(r)),r.textContent=n,t.btn.classList.add("sc-busy"),t.btn.querySelector("i").className="bi bi-hourglass-split",t.btn.title=`${n} foto(s) \u2014 processando...`}await G(t.id,t.nome,t.fotos,t.btn)})}function j(){h=document.createElement("div"),h.id="scBadge",h.innerHTML='\u23F3 Detectando cores... <span id="scBadgeN">0</span>',document.body.appendChild(h)}function C(){if(!h)return;const e=f.length;h.style.display=e>0?"block":"none";const o=document.getElementById("scBadgeN");o&&(o.textContent=e)}function z(){const e=document.getElementById("stockTableBody");if(!e){setTimeout(z,600);return}E(e),new MutationObserver(()=>E(e)).observe(e,{childList:!0});let o=0;const t=setInterval(()=>{E(e),++o>=10&&clearInterval(t)},2e3)}function E(e){e.querySelectorAll(".stock-item-card[data-id]").forEach(o=>{if(o.querySelector(".sc-cam-btn"))return;const t=o.dataset.id,n=(window.products||[]).find(i=>i.id===t);if(!n)return;const r=$(t),a=document.createElement("button");if(a.className="sc-cam-btn"+(r?" sc-done-today":""),a.title=r?"J\xE1 fotografado hoje \u2014 toque para fotografar de novo":"Detectar cores por foto",a.innerHTML='<i class="bi bi-camera-fill"></i>',r){a.innerHTML='<i class="bi bi-camera-fill"></i>';const i=document.createElement("span");i.className="sc-foto-count",i.style.background="#4ade80",i.textContent="\u2713",a.appendChild(i)}a.addEventListener("click",i=>{i.stopPropagation(),F(t,n.nome,a)});const s=o.querySelector(".d-flex.align-items-center.gap-2");s&&s.appendChild(a)})}function F(e,o,t){if(!I()){typeof window.showCustomModal=="function"&&window.showCustomModal({message:`\u{1F511} Chave Groq n\xE3o configurada.

V\xE1 em Administra\xE7\xE3o \u2192 Taxas \u2192 "IA para Scan de Estoque", cole a chave e toque em Salvar.`});return}!p||p.id!==e?p={id:e,nome:o,btn:t,fotos:[]}:p.btn=t,g.click()}async function G(e,o,t,n){const r=[];for(const s of t){const i=await J(s)||await V(s);i&&r.push(i)}if(r.length===0){v(e,o,"Erro ao ler imagens"),w(n,!1);return}const a=f.findIndex(s=>s.id===e);a>-1&&f.splice(a,1),f.push({id:e,nome:o,fotos:r,btn:n}),C(),k||T()}async function T(){if(f.length===0){k=!1,C();return}k=!0;const e=f[0];try{const o=[];let t=0;for(const n of e.fotos){const r=await U(n.b64,n.mime,e.nome);r&&r.cores&&(r.cores.forEach(a=>{o.some(s=>s.hex.toLowerCase()===a.hex.toLowerCase())||o.push(a)}),t+=r.quantidade||0)}f.shift(),o.length>0||t>0?Q(e,o,t):(v(e.id,e.nome,"IA n\xE3o identificou cores"),w(e.btn,!1))}catch(o){console.error("StockCount:",o),f.shift(),v(e.id,e.nome,o.message||"Erro"),w(e.btn,!1)}C(),M(),await new Promise(o=>setTimeout(o,500)),T()}function Q(e,o,t){if(e.btn){e.btn.classList.remove("sc-busy");const i=e.btn.querySelector(".sc-foto-count");i&&i.remove(),e.btn.innerHTML='<i class="bi bi-check2-circle" style="color:#facc15"></i>',e.btn.title="Aguardando confirma\xE7\xE3o..."}const n=document.getElementById(`scConfirm_${e.id}`);n&&n.remove();const r=document.querySelector(`.stock-item-card[data-id="${e.id}"]`);if(!r){P(e.id,o,t,e.btn);return}const a=o.map(i=>`<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,.08);border-radius:6px;padding:2px 7px;font-size:.75rem;">
                <span style="width:10px;height:10px;border-radius:50%;background:${i.hex};border:1px solid rgba(255,255,255,.2);flex-shrink:0;"></span>
                ${i.nome}
            </span>`).join(""),s=document.createElement("div");s.id=`scConfirm_${e.id}`,s.style.cssText="background:rgba(250,204,21,.08);border:1px solid rgba(250,204,21,.35);border-radius:10px;padding:10px 12px;margin-top:8px;",s.innerHTML=`
            <div style="font-size:.78rem;font-weight:700;color:#facc15;margin-bottom:6px;">
                <i class="bi bi-cpu-fill"></i> IA detectou \u2014 confirme antes de salvar
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
                <span style="font-size:.75rem;color:var(--text-secondary);">Qtd:</span>
                <div style="display:flex;align-items:center;gap:4px;">
                    <button id="scQDec_${e.id}" style="width:24px;height:24px;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:#fff;cursor:pointer;font-size:.9rem;display:flex;align-items:center;justify-content:center;">\u2212</button>
                    <input id="scQInput_${e.id}" type="number" value="${t}" min="0" style="width:55px;text-align:center;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#fff;font-size:.85rem;padding:2px 4px;">
                    <button id="scQInc_${e.id}" style="width:24px;height:24px;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:#fff;cursor:pointer;font-size:.9rem;display:flex;align-items:center;justify-content:center;">+</button>
                </div>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px;">${a||'<span style="font-size:.75rem;color:var(--text-secondary)">Nenhuma cor detectada</span>'}</div>
            <div style="display:flex;gap:8px;">
                <button id="scConfirmOk_${e.id}" style="flex:1;background:#4ade80;color:#000;border:none;border-radius:8px;padding:6px;font-size:.8rem;font-weight:700;cursor:pointer;">
                    <i class="bi bi-check-lg"></i> Confirmar
                </button>
                <button id="scConfirmX_${e.id}" style="background:rgba(248,113,113,.15);color:#f87171;border:1px solid rgba(248,113,113,.3);border-radius:8px;padding:6px 10px;font-size:.8rem;cursor:pointer;">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>`,r.appendChild(s),document.getElementById(`scQDec_${e.id}`)?.addEventListener("click",()=>{const i=document.getElementById(`scQInput_${e.id}`);i&&(i.value=Math.max(0,(parseInt(i.value)||0)-1))}),document.getElementById(`scQInc_${e.id}`)?.addEventListener("click",()=>{const i=document.getElementById(`scQInput_${e.id}`);i&&(i.value=(parseInt(i.value)||0)+1)}),document.getElementById(`scConfirmOk_${e.id}`)?.addEventListener("click",()=>{const i=parseInt(document.getElementById(`scQInput_${e.id}`)?.value)||t;s.remove(),P(e.id,o,i,e.btn)}),document.getElementById(`scConfirmX_${e.id}`)?.addEventListener("click",()=>{s.remove(),w(e.btn,!1),e.btn&&(e.btn.innerHTML='<i class="bi bi-camera-fill"></i>',e.btn.title="Detectar cores por foto",e.btn.classList.remove("sc-busy"))})}async function P(e,o,t,n){try{console.log("[StockCount] Salvando:",e,"cores:",o.length,"qtd:",t);const r=window.updateProductInDB;if(typeof r=="function"){const a={};o&&o.length>0&&(a.cores=o),a.quantidade=t,await r(e,a),console.log("[StockCount] Firebase atualizado:",a)}else console.error("[StockCount] window.updateProductInDB n\xE3o dispon\xEDvel!");O(e),R(e),b=b.filter(a=>a.id!==e),w(n,!0),typeof window.filterStockProducts=="function"&&window.filterStockProducts()}catch(r){console.error("[StockCount] Erro ao salvar:",r),v(e,"?",r.message)}}function w(e,o){let t=e;if(t&&!document.body.contains(t)||!t)return;t.classList.remove("sc-busy");const n=t.querySelector(".sc-foto-count");if(n&&n.remove(),o===!0){t.classList.add("sc-done-today"),t.innerHTML='<i class="bi bi-camera-fill"></i>',t.title="Cores atualizadas! Toque para fotografar novamente.";const r=document.createElement("span");r.className="sc-foto-count",r.style.background="#4ade80",r.textContent="\u2713",t.appendChild(r)}else t.innerHTML='<i class="bi bi-exclamation-circle-fill" style="color:#f87171"></i>',t.title="Falhou \u2014 toque para tentar de novo";p&&t===p.btn&&(p=null)}async function U(e,o,t){const n=I();if(!n)throw new Error("Chave Groq n\xE3o configurada");const r=`Foto de prateleira com caixas de celulares.

Foque APENAS nas caixas do produto: "${t}"
Ignore qualquer outro modelo/marca vis\xEDvel.

Para CADA caixa do "${t}" que voc\xEA encontrar:
- Leia a COR escrita na etiqueta (ex: "Midnight Black", "Coral Green", "Glacier Blue", "Lavender Purple")
- Conte 1 unidade por caixa f\xEDsica

Responda SOMENTE com JSON:
{"cores":["Midnight Black","Coral Green"],"quantidade":3}

Se n\xE3o encontrar esse produto: {"cores":[],"quantidade":0}`,a=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${n}`},body:JSON.stringify({model:"meta-llama/llama-4-scout-17b-16e-instruct",max_completion_tokens:200,temperature:.05,response_format:{type:"json_object"},messages:[{role:"user",content:[{type:"text",text:r},{type:"image_url",image_url:{url:`data:${o};base64,${e}`}}]}]})});if(!a.ok){const m=await a.json().catch(()=>({}));throw new Error(m.error?.message||`Erro HTTP ${a.status}`)}const i=((await a.json()).choices?.[0]?.message?.content||"").trim();console.log(`StockCount [${t}]:`,i);const l=JSON.parse(i.replace(/```json|```/gi,"").trim()),d=(Array.isArray(l?.cores)?l.cores:[]).map(m=>W(m)).filter(Boolean).filter((m,_,y)=>y.findIndex(x=>x.hex.toLowerCase()===m.hex.toLowerCase())===_),u=parseInt(l?.quantidade)||0;return{cores:d,quantidade:u}}function D(){const e=document.getElementById("stockSearchInput");if(!e){setTimeout(D,800);return}const o=e.parentElement;if(document.getElementById("scSearchWrap"))return;const t=document.createElement("div");t.id="scSearchWrap",t.style.cssText="position:relative; flex:1; min-width:180px;",o.insertBefore(t,e),t.appendChild(e),e.style.flex="",e.style.minWidth="";let n=null,r=-1;function a(){n&&(n.remove(),n=null),r=-1}function s(c){a(),c.length&&(n=document.createElement("div"),n.id="scAutoComplete",c.forEach((d,u)=>{const m=(d.cores||[]).slice(0,6).map(x=>`<span class="sc-ac-dot" style="background:${x.hex}" title="${x.nome}"></span>`).join(""),_=$(d.id),y=document.createElement("div");y.className="sc-ac-item",y.innerHTML=`
                    <span style="display:flex;gap:3px">${m}</span>
                    <span class="sc-ac-nome">${d.nome}</span>
                    <span class="sc-ac-qty">${d.quantidade||0} un.</span>
                    ${_?'<span class="sc-ac-today">\u{1F4F7} hoje</span>':""}`,y.addEventListener("mousedown",x=>{x.preventDefault(),i(d)}),y.addEventListener("touchstart",x=>{x.preventDefault(),i(d)},{passive:!1}),n.appendChild(y)}),t.appendChild(n))}function i(c){e.value=c.nome,a(),typeof window.filterStockProducts=="function"&&window.filterStockProducts()}function l(c){n&&(n.querySelectorAll(".sc-ac-item").forEach((d,u)=>d.classList.toggle("sc-ac-active",u===c)),r=c)}e.addEventListener("input",()=>{const c=e.value.trim().toLowerCase();if(c.length<1){a();return}const d=(window.products||[]).filter(u=>u.nome&&u.nome.toLowerCase().includes(c)&&!u.ignorarContagem).slice(0,8);s(d)}),e.addEventListener("keydown",c=>{if(!n)return;const d=n.querySelectorAll(".sc-ac-item");if(c.key==="ArrowDown")c.preventDefault(),l(Math.min(r+1,d.length-1));else if(c.key==="ArrowUp")c.preventDefault(),l(Math.max(r-1,0));else if(c.key==="Enter"&&r>=0){c.preventDefault();const u=(window.products||[]).filter(m=>m.nome&&m.nome.toLowerCase().includes(e.value.trim().toLowerCase())&&!m.ignorarContagem).slice(0,8);u[r]&&i(u[r])}else c.key==="Escape"&&a()}),e.addEventListener("blur",()=>setTimeout(a,150)),e.addEventListener("focus",()=>{e.value.trim().length>=1&&e.dispatchEvent(new Event("input"))})}function v(e,o,t){b=b.filter(n=>n.id!==e),b.push({id:e,nome:o,motivo:t}),M()}function M(){const e=document.getElementById("stockTableBody");if(!e)return;let o=document.getElementById("scErrosPainel");if(b.length===0){o&&o.remove();return}o||(o=document.createElement("div"),o.id="scErrosPainel",e.parentElement?.insertBefore(o,e));const t=n=>String(n).replace(/[&<>"']/g,r=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[r]);o.innerHTML=`<div class="sc-erros-banner">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <strong style="color:#fb923c;font-size:.82rem"><i class="bi bi-exclamation-triangle-fill"></i> ${b.length} produto(s) sem cor \u2014 corrija manualmente</strong>
                <button onclick="document.getElementById('scErrosPainel').remove()" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:1rem">\u2715</button>
            </div>
            ${b.map(n=>`<div style="display:flex;justify-content:space-between;padding:3px 0;border-top:1px solid rgba(255,255,255,.05);font-size:.75rem"><span>${t(n.nome)}</span><span style="color:var(--text-secondary)">${t(n.motivo)}</span></div>`).join("")}
        </div>`}function J(e){return new Promise(o=>{const t=new Image,n=URL.createObjectURL(e);t.onload=()=>{URL.revokeObjectURL(n);const r=1024;let a=t.width,s=t.height;(a>r||s>r)&&(a>s?(s=Math.round(s*r/a),a=r):(a=Math.round(a*r/s),s=r));const i=document.createElement("canvas");i.width=a,i.height=s,i.getContext("2d").drawImage(t,0,0,a,s),i.toBlob(l=>{const c=new FileReader;c.onload=()=>o({b64:c.result.split(",")[1],mime:"image/jpeg"}),c.readAsDataURL(l)},"image/jpeg",.82)},t.onerror=()=>{URL.revokeObjectURL(n),o(null)},t.src=n})}function V(e){return new Promise((o,t)=>{const n=new FileReader;n.onload=()=>o({b64:n.result.split(",")[1],mime:e.type||"image/jpeg"}),n.onerror=t,n.readAsDataURL(e)})}function W(e){if(!e)return null;const o=window.colorPalette||[],t=e.toLowerCase().trim(),n=o.find(s=>s.nome.toLowerCase()===t);if(n)return n;for(const s of o)if(t.includes(s.nome.toLowerCase())||s.nome.toLowerCase().includes(t))return s;const r=[{test:/\bgreen\b|\bverde\b/i,nome:"Verde"},{test:/\bblue\b|\bazul\b/i,nome:"Azul"},{test:/\bblack\b|\bpreto\b/i,nome:"Preto"},{test:/\bwhite\b|\bbranco\b/i,nome:"Branco"},{test:/\bgold\b|\bdourado\b/i,nome:"Dourado"},{test:/\byellow\b|\bamarelo\b/i,nome:"Amarelo"},{test:/\bpurple\b|\broxo\b/i,nome:"Roxo"},{test:/\bpink\b|\brosa\b/i,nome:"Rosa"},{test:/\bgray\b|\bgrey\b|\bcinza\b/i,nome:"Grafite"},{test:/\bsilver\b|\bprata\b/i,nome:"Prata"},{test:/\bred\b|\bvermelho\b/i,nome:"Vermelho"},{test:/\borange\b|\blaranja\b/i,nome:"Laranja"}];if(t.includes(" ")){for(const s of r)if(s.test.test(t)){const i=o.find(l=>l.nome===s.nome);if(i)return i}}const a={preto:"Preto",black:"Preto",branco:"Branco",white:"Branco",cinza:"Grafite",gray:"Grafite",grey:"Grafite",prata:"Prata",silver:"Prata",azul:"Azul",blue:"Azul",verde:"Verde",green:"Verde",roxo:"Roxo",purple:"Roxo",rosa:"Rosa",pink:"Rosa",dourado:"Dourado",gold:"Dourado",amarelo:"Amarelo",yellow:"Amarelo",laranja:"Laranja",orange:"Laranja",vermelho:"Vermelho",red:"Vermelho",titanio:"Titanio Natural",titanium:"Titanio Natural",lavender:"Lilas",midnight:"Preto",glacier:"Azul",coral:"Coral"};for(const[s,i]of Object.entries(a))if(t.includes(s)){const l=o.find(c=>c.nome===i);if(l)return l}return{nome:e,hex:"#888888"}}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>setTimeout(A,1e3)):setTimeout(A,1e3)})();
