window.verBoletoDeNotificacao=function(e){e&&typeof window.showMainSection=="function"&&(window.showMainSection("contract"),setTimeout(()=>{const o=document.getElementById("boletoModeToggle");o&&!o.checked&&(o.checked=!0,o.dispatchEvent(new Event("change"))),setTimeout(()=>{const n=document.querySelector(`#heading-${e} button`);if(n){const t=n.getAttribute("data-bs-target")?.substring(1),a=t?document.getElementById(t):null;a&&window.bootstrap&&(bootstrap.Collapse.getOrCreateInstance(a,{toggle:!1}).show(),a.addEventListener("shown.bs.collapse",()=>{n.scrollIntoView({behavior:"smooth",block:"center"})},{once:!0}))}},300)},150))};function _(e,o,n){const t=document.getElementById("favTransitionOverlay"),a=document.getElementById("favTransitionEmoji"),i=document.getElementById("favTransitionLabel");if(!t){n();return}a&&(a.textContent=e),i&&(i.textContent=o),t.style.display="flex",t.style.opacity="0",t.style.transition="opacity 0.15s ease",t.classList.remove("hidden","entering","leaving"),t.offsetHeight,t.style.opacity="1",setTimeout(()=>{n()},200),setTimeout(()=>{t.style.opacity="0",setTimeout(()=>{t.style.display="none",t.classList.add("hidden"),t.style.transition="",t.style.opacity=""},180)},700)}const L=[{id:"calculadora",emoji:"\u{1F9EE}",label:"Abrindo Calculadora...",action:()=>window.showMainSection?.("calculator")},{id:"fecharVenda",emoji:"\u{1F4B0}",label:"Abrindo Fechar Venda...",action:()=>{window.showMainSection?.("calculator"),setTimeout(()=>document.getElementById("openFecharVenda")?.click(),300)}},{id:"repassar",emoji:"\u2194\uFE0F",label:"Abrindo Repassar Valores...",action:()=>{window.showMainSection?.("calculator"),setTimeout(()=>document.getElementById("openRepassarValores")?.click(),300)}},{id:"emprestar",emoji:"\u{1F91D}",label:"Abrindo Emprestar Valores...",action:()=>{window.showMainSection?.("calculator"),setTimeout(()=>document.getElementById("openEmprestarValores")?.click(),300)}},{id:"emprestimo",emoji:"\u{1F3E6}",label:"Abrindo Calc. Empr\xE9stimo...",action:()=>{window.showMainSection?.("calculator"),setTimeout(()=>document.getElementById("openCalcularEmprestimo")?.click(),300)}},{id:"porAparelho",emoji:"\u{1F4F1}",label:"Abrindo Calc. p/ Aparelho...",action:()=>{window.showMainSection?.("calculator"),setTimeout(()=>document.getElementById("openCalcularPorAparelho")?.click(),300)}},{id:"contrato",emoji:"\u{1F4CB}",label:"Abrindo Contratos...",action:()=>{window.showMainSection?.("contract"),setTimeout(()=>window.openDocumentsSection?.("contrato"),300)}},{id:"bookip",emoji:"\u{1F4D2}",label:"Abrindo Bookip...",action:()=>{window.showMainSection?.("contract"),setTimeout(()=>document.getElementById("openBookipView")?.click(),300)}},{id:"clientes",emoji:"\u{1F465}",label:"Abrindo Clientes...",action:()=>window.showMainSection?.("clients")},{id:"estoque",emoji:"\u{1F4E6}",label:"Abrindo Estoque...",action:()=>{typeof window.showCustomModal=="function"&&window.showCustomModal({message:"Digite a senha para acessar o Estoque:",showPassword:!0,confirmText:"Acessar",onConfirm:e=>{e==="220390"?window.showMainSection?.("stock"):window.showCustomModal({message:"\u274C Senha incorreta."})},onCancel:()=>{}})}},{id:"admin",emoji:"\u2699\uFE0F",label:"Abrindo Administra\xE7\xE3o...",action:()=>window.showMainSection?.("administracao")},{id:"consertos",emoji:"\u{1F527}",label:"Abrindo Consertos...",action:()=>window.showMainSection?.("repairs")},{id:"reposicao",emoji:"\u{1F6D2}",label:"Abrindo Reposi\xE7\xE3o...",action:()=>window.showMainSection?.("reposicao")}],B=5;function w(e){return"ctw_favs_"+(e||localStorage.getItem("ctwUserProfile")||"default").toLowerCase().replace(/\s+/g,"_")}function P(e){const o=window.teamProfilesList||{};for(const n in o)if((o[n].name||"").toLowerCase()===e.toLowerCase())return n;try{const n=JSON.parse(localStorage.getItem("cache_equipe_local")||"{}");for(const t in n)if((n[t].name||"").toLowerCase()===e.toLowerCase())return t}catch{}return null}function S(){const e=localStorage.getItem("ctwUserProfile")||"",o=window.teamProfilesList||{};for(const n in o)if((o[n].name||"").toLowerCase()===e.toLowerCase()){const t=o[n].favorites;if(Array.isArray(t)&&t.length>0)return localStorage.setItem(w(e),JSON.stringify(t)),t;break}try{return JSON.parse(localStorage.getItem(w(e))||"[]")}catch{return[]}}function h(e){const o=localStorage.getItem("ctwUserProfile")||"",n=P(o);localStorage.setItem(w(o),JSON.stringify(e)),n&&window.teamProfilesList&&window.teamProfilesList[n]&&(window.teamProfilesList[n].favorites=e);const t=window._firebaseDB,a=window._dbRef,i=window._dbUpdate;n&&t&&a&&i&&i(a(t,"team_profiles/"+n),{favorites:e}).then(()=>console.log("[Favs] \u2705 Firebase salvo")).catch(r=>console.warn("[Favs] Firebase erro:",r.message))}function j(){const e=localStorage.getItem("ctwUserProfile")||"";if(!e)return;const o=window.teamProfilesList||{};for(const n in o)if((o[n].name||"").toLowerCase()===e.toLowerCase()){const t=o[n].favorites||null;t&&Array.isArray(t)&&(localStorage.setItem(w(),JSON.stringify(t)),v());break}}function v(){const e=document.getElementById("favStoriesWrap");if(!e)return;const o=S(),n=document.getElementById("mainMenu");if(e.innerHTML="",o.length===0){const t=document.createElement("div");t.className="fav-story fav-story-add",t.innerHTML='<div class="fav-story-ring"><div class="fav-story-inner">\uFF0B</div></div><span class="fav-story-label">Adicionar</span>',t.addEventListener("click",T),e.appendChild(t),n?.classList.remove("has-favorites");return}n?.classList.add("has-favorites"),o.forEach(t=>{const a=L.find(r=>r.id===t);if(!a)return;const i=document.createElement("div");i.className="fav-story",i.innerHTML=`<div class="fav-story-ring"><div class="fav-story-inner">${a.emoji}</div></div><span class="fav-story-label">${a.label.replace("Abrindo ","").replace("...","")}</span>`,i.addEventListener("click",()=>{const r=i.querySelector(".fav-story-ring");r.style.transform="scale(0.88)",setTimeout(()=>{r.style.transform=""},160),setTimeout(()=>_(a.emoji,a.label,a.action),80)}),e.appendChild(i)})}function T(){const e=document.getElementById("favModalOverlay"),o=document.getElementById("favModalGrid");!e||!o||(window._favDraftOrder=[...S()],x(o),e.classList.remove("hidden"))}function x(e){const o=window._favDraftOrder;if(e.innerHTML="",o.length>0){const a=document.createElement("div");a.style.cssText="margin-bottom:16px;",a.innerHTML='<div style="font-size:0.7rem;color:var(--text-secondary);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;padding:0 2px;">\u27FA Segure e arraste para reordenar</div>';const i=document.createElement("div");i.id="fav-chip-wrap",i.style.cssText="display:flex;flex-wrap:wrap;gap:8px;padding:4px 2px 12px;",o.forEach((r,s)=>{const c=L.find(d=>d.id===r);if(!c)return;const p=c.label.replace("Abrindo ","").replace("...",""),l=document.createElement("div");l.className="fav-chip",l.draggable=!0,l.dataset.id=r,l.dataset.index=s,l.style.cssText=`
                display:inline-flex;align-items:center;gap:6px;
                background:rgba(var(--primary-color-rgb),0.12);
                border:1px solid rgba(var(--primary-color-rgb),0.3);
                border-radius:20px;padding:6px 10px 6px 8px;
                cursor:grab;font-size:0.72rem;color:var(--text-color);
                font-weight:500;user-select:none;touch-action:none;
                transition:opacity 0.15s,transform 0.15s;
            `,l.innerHTML=`
                <span style="font-size:0.95rem;line-height:1;">${c.emoji}</span>
                <span>${p}</span>
                <span style="margin-left:2px;color:var(--text-secondary);font-size:0.7rem;cursor:pointer;" 
                    data-remove="${r}">\u2715</span>
            `,l.querySelector("[data-remove]").addEventListener("click",d=>{d.stopPropagation(),window._favDraftOrder=window._favDraftOrder.filter(m=>m!==r),h(window._favDraftOrder),v(),x(e)}),l.addEventListener("dragstart",d=>{d.dataTransfer.setData("text/plain",r),l.style.opacity="0.4",window._favDragId=r}),l.addEventListener("dragend",()=>{l.style.opacity="1",window._favDragId=null,document.querySelectorAll(".fav-chip").forEach(d=>d.classList.remove("drag-over"))}),l.addEventListener("dragover",d=>{d.preventDefault(),l.classList.add("drag-over")}),l.addEventListener("dragleave",()=>l.classList.remove("drag-over")),l.addEventListener("drop",d=>{d.preventDefault(),l.classList.remove("drag-over");const m=d.dataTransfer.getData("text/plain"),E=r;if(m===E)return;const f=window._favDraftOrder,u=f.indexOf(m),b=f.indexOf(E);u<0||b<0||(f.splice(u,1),f.splice(b,0,m),h(window._favDraftOrder),v(),x(e))});let g,y,z,F;l.addEventListener("touchstart",d=>{g=d.touches[0].clientY,y=d.touches[0].clientX,F=window._favDraftOrder.indexOf(r),l.style.opacity="0.5"},{passive:!0}),l.addEventListener("touchmove",d=>{d.preventDefault();const m=d.touches[0],f=document.elementFromPoint(m.clientX,m.clientY)?.closest(".fav-chip");document.querySelectorAll(".fav-chip").forEach(u=>u.style.outline=""),f&&f!==l&&(f.style.outline="2px solid var(--primary-color)")},{passive:!1}),l.addEventListener("touchend",d=>{l.style.opacity="1",document.querySelectorAll(".fav-chip").forEach(u=>u.style.outline="");const m=d.changedTouches[0],f=document.elementFromPoint(m.clientX,m.clientY)?.closest(".fav-chip[data-id]");if(f&&f.dataset.id!==r){const u=window._favDraftOrder,b=u.indexOf(r),C=u.indexOf(f.dataset.id);b>=0&&C>=0&&(u.splice(b,1),u.splice(C,0,r),h(window._favDraftOrder),v(),x(e))}},{passive:!0}),i.appendChild(l)}),a.appendChild(i),e.appendChild(a)}const n=document.createElement("div");n.style.cssText="font-size:0.7rem;color:var(--text-secondary);letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;padding:0 2px;",n.textContent=o.length>0?"+ Adicionar":"Escolha at\xE9 5 favoritos",e.appendChild(n);const t=document.createElement("div");t.style.cssText="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding-bottom:4px;",L.forEach(a=>{const i=a.label.replace("Abrindo ","").replace("...",""),r=o.includes(a.id),s=document.createElement("div");s.className="fav-option"+(r?" selected":""),s.dataset.id=a.id,s.innerHTML=`<div class="fav-option-icon">${a.emoji}</div><div class="fav-option-label">${i}</div>`,s.addEventListener("click",()=>{const c=window._favDraftOrder;if(c.includes(a.id))window._favDraftOrder=c.filter(p=>p!==a.id);else{if(c.length>=B)return;window._favDraftOrder.push(a.id)}h(window._favDraftOrder),v(),x(e)}),t.appendChild(s)}),e.appendChild(t)}function I(){const e=document.getElementById("favModalOverlay");e&&(window._favDraftOrder=null,e.classList.add("hidden"))}function A(){document.getElementById("favEditBtn")?.addEventListener("click",T),document.getElementById("favModalClose")?.addEventListener("click",()=>I()),document.getElementById("favModalOverlay")?.addEventListener("click",e=>{e.target.id==="favModalOverlay"&&I()}),v()}const $=window.setProfile;typeof window.setProfile=="function"&&(window.setProfile=function(e){$(e),setTimeout(v,350)}),window._loadFavsForProfile=function(e){const o=window.teamProfilesList||{};for(const n in o)if((o[n].name||"").toLowerCase()===e.toLowerCase()){const t=o[n].favorites||null;if(t&&Array.isArray(t)&&t.length>0)localStorage.setItem(w(),JSON.stringify(t)),v();else{const a=S();a.length>0&&(console.log("\u{1F4E4} Migrando favoritos locais para Firebase:",a),h(a)),v()}return}setTimeout(function(){window._loadFavsForProfile&&window._loadFavsForProfile(e)},1e3)},window._onFavsFirebaseUpdate=function(){const e=localStorage.getItem("ctwUserProfile")||"";e&&window._loadFavsForProfile(e)},document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>setTimeout(A,300)):setTimeout(A,300),(function(){if(document.getElementById("fav-css"))return;const o=document.createElement("style");o.id="fav-css",o.textContent=".fav-section{width:100%;margin-bottom:20px;background:var(--card-bg);border-radius:20px;padding:16px;box-sizing:border-box}.fav-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.fav-title{font-size:.68rem;font-weight:600;letter-spacing:.3px;text-transform:uppercase;color:#8A8D96}.fav-edit-btn{background:none;border:none;color:#8A8D96;font-size:.75rem;cursor:pointer;padding:4px 8px;border-radius:8px;transition:color .2s,background .2s}.fav-edit-btn:hover{color:var(--primary-color);background:rgba(var(--primary-color-rgb),.1)}.fav-stories-wrap{display:flex;gap:16px;overflow-x:auto;padding:0 0 2px;scrollbar-width:none;-webkit-overflow-scrolling:touch}.fav-stories-wrap::-webkit-scrollbar{display:none}.fav-story{display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;flex-shrink:0;-webkit-tap-highlight-color:transparent;animation:fav-pop .3s ease backwards}.fav-story:nth-child(1){animation-delay:.05s}.fav-story:nth-child(2){animation-delay:.1s}.fav-story:nth-child(3){animation-delay:.15s}.fav-story:nth-child(4){animation-delay:.2s}.fav-story:nth-child(5){animation-delay:.25s}@keyframes fav-pop{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:scale(1)}}.fav-story-ring{width:46px;height:46px;border-radius:14px;padding:0;background:#26272B;border:none;transition:transform .18s ease}.fav-story:active .fav-story-ring{transform:scale(.92)}.fav-story-inner{width:100%;height:100%;border-radius:14px;background:transparent;display:flex;align-items:center;justify-content:center;font-size:1.1rem;position:relative;overflow:hidden}.fav-story-label{font-size:.56rem;font-weight:500;color:#8A8D96;text-align:center;max-width:52px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fav-story-add .fav-story-ring{background:rgba(255,255,255,.04);border:1.5px dashed var(--glass-border)}.fav-story-add .fav-story-inner{background:transparent;border:none;color:#8A8D96;font-size:1.1rem}.fav-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;display:flex;align-items:flex-end;justify-content:center;animation:fav-overlay-in .2s ease}.fav-modal-overlay.hidden{display:none}@keyframes fav-overlay-in{from{opacity:0}to{opacity:1}}.fav-modal{background:var(--card-bg);border:1px solid var(--glass-border);border-radius:24px 24px 0 0;padding:0;width:100%;max-width:520px;height:82vh;max-height:82vh;display:flex;flex-direction:column;overflow:hidden;animation:fav-modal-up .28s cubic-bezier(.34,1.56,.64,1)}@keyframes fav-modal-up{from{transform:translateY(100%)}to{transform:translateY(0)}}.fav-modal-header{display:flex;align-items:center;justify-content:space-between;font-weight:600;font-size:1rem;color:var(--text-color-strong);flex-shrink:0;padding:20px 20px 16px}.fav-modal-close{background:rgba(255,255,255,.08);border:none;border-radius:50%;width:32px;height:32px;color:var(--text-color);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s}.fav-modal-close:hover{background:rgba(255,255,255,.15)}.fav-modal-grid{overflow-y:auto;flex:1;min-height:0;padding:0 20px 16px;-webkit-overflow-scrolling:touch}.fav-option{display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;padding:10px 4px;border-radius:14px;border:1.5px solid transparent;transition:border-color .2s,background .2s,transform .15s;background:rgba(255,255,255,.03);-webkit-tap-highlight-color:transparent}.fav-option:active{transform:scale(.94)}.fav-option.selected{border-color:var(--primary-color);background:rgba(var(--primary-color-rgb),.12)}.fav-option-icon{font-size:1.5rem;line-height:1}.fav-option-label{font-size:.58rem;text-align:center;color:var(--text-secondary);line-height:1.3;font-weight:500}.fav-option.selected .fav-option-label{color:var(--primary-color)}.fav-modal-save{width:100%;padding:18px;border:none;border-radius:0;background:var(--primary-color);color:var(--on-primary);font-weight:700;font-size:.95rem;cursor:pointer;letter-spacing:.5px;transition:opacity .2s;flex-shrink:0}.fav-modal-save:active{opacity:.85}.has-favorites .btn-menu{padding:14px 20px;font-size:.9rem}.fav-chip.drag-over{outline:2px solid var(--primary-color);opacity:0.8;transform:scale(1.04)}",document.head.appendChild(o)})(),window.toggleNotifBalloons=function(){const e=document.getElementById("notif-balloons-container");if(e){k(e);return}const o=typeof window.ctwAlertasAtuais=="function"?window.ctwAlertasAtuais():window._currentNotifications||[];if(!o.length)return;const n=document.createElement("div");n.id="notif-balloons-container",n.style.cssText=`
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        z-index: 8999;
        pointer-events: none;
    `,document.body.appendChild(n);const t=document.createElement("div");if(t.style.cssText=`
        position: absolute;
        inset: 0;
        pointer-events: all;
        background: rgba(0,0,0,0.25);

        animation: notif-overlay-in 0.2s ease;
    `,t.addEventListener("click",()=>k(n)),n.appendChild(t),!document.getElementById("notif-balloon-styles")){const i=document.createElement("style");i.id="notif-balloon-styles",i.textContent=`
            @keyframes notif-overlay-in { from{opacity:0} to{opacity:1} }
            @keyframes notif-slide-in {
                from { opacity:0; transform: translateX(120px) scale(0.85); }
                to   { opacity:1; transform: translateX(0)     scale(1); }
            }
            @keyframes notif-slide-out {
                from { opacity:1; transform: translateX(0) scale(1); }
                to   { opacity:0; transform: translateX(80px) scale(0.9); }
            }
        `,document.head.appendChild(i)}const a=document.createElement("div");a.id="notif-balloons-panel",a.style.cssText=`
        position: absolute;
        top: 60px;
        right: 12px;
        width: 300px;
        max-width: calc(100vw - 24px);
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
        z-index: 9000;
    `,n.appendChild(a),o.forEach((i,r)=>{setTimeout(()=>{const s=D(i,r);a.appendChild(s)},r*100)})};function O(e,o,n,t){const a=document.getElementById("notif-full-modal");a&&a.remove();const i=document.createElement("div");if(i.id="notif-full-modal",i.style.cssText=`
        position: fixed;
        inset: 0;
        z-index: 99999;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        background: rgba(0,0,0,0.7);

        animation: notif-overlay-in 0.2s ease;
        padding: 0;
    `,i.innerHTML=`
        <div style="
            width: 100%;
            max-width: 480px;
            background: #0d1526;
            border: 1px solid rgba(${t},0.3);
            border-bottom: none;
            border-radius: 20px 20px 0 0;
            padding: 0;
            animation: notif-sheet-up 0.3s cubic-bezier(0.34,1.2,0.64,1) both;
            display: flex;
            flex-direction: column;
            max-height: 80vh;
        ">
            <!-- Handle -->
            <div style="display:flex;justify-content:center;padding:10px 0 4px;">
                <div style="width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,0.15);"></div>
            </div>

            <!-- Header -->
            <div style="
                display:flex;align-items:center;gap:10px;
                padding:12px 18px 10px;
                border-bottom:1px solid rgba(255,255,255,0.07);
            ">
                <div style="
                    width:36px;height:36px;border-radius:10px;flex-shrink:0;
                    background:rgba(${t},0.12);
                    border:1px solid rgba(${t},0.25);
                    display:flex;align-items:center;justify-content:center;
                    font-size:1.2rem;
                ">${o}</div>
                <span style="
                    font-family:'Poppins',sans-serif;
                    font-size:0.85rem;font-weight:700;
                    color:rgba(255,255,255,0.95);flex:1;
                ">\u{1F4E2} Mensagem Completa</span>
                <button id="notif-full-modal-close" style="
                    background:none;border:none;
                    color:rgba(255,255,255,0.4);
                    font-size:1.1rem;cursor:pointer;padding:4px;
                    line-height:1;
                ">\u2715</button>
            </div>

            <!-- Corpo com scroll -->
            <div style="
                overflow-y: auto;
                padding: 16px 18px 32px;
                flex: 1;
                -webkit-overflow-scrolling: touch;
            ">
                <p style="
                    font-family:'Poppins',sans-serif;
                    font-size:0.82rem;
                    line-height:1.65;
                    color:rgba(255,255,255,0.88);
                    white-space:pre-wrap;
                    word-break:break-word;
                    margin:0;
                ">${e}</p>
            </div>
        </div>
    `,!document.getElementById("notif-sheet-style")){const s=document.createElement("style");s.id="notif-sheet-style",s.textContent=`@keyframes notif-sheet-up {
            from { transform: translateY(100%); opacity:0; }
            to   { transform: translateY(0);    opacity:1; }
        }`,document.head.appendChild(s)}document.body.appendChild(i);const r=()=>{i.style.transition="opacity 0.2s",i.style.opacity="0",setTimeout(()=>i.remove(),200)};i.querySelector("#notif-full-modal-close").addEventListener("click",s=>{s.stopPropagation(),r()}),i.addEventListener("click",s=>{s.target===i&&r()})}function k(e){const o=e.querySelector("div");o&&(o.style.transition="opacity 0.2s",o.style.opacity="0");const n=e.querySelectorAll(".notif-card");n.forEach((t,a)=>{setTimeout(()=>{t.style.animation="notif-slide-out 0.22s ease forwards"},a*50)}),setTimeout(()=>e.remove(),n.length*50+280)}function D(e,o){const n=document.createElement("div");n.innerHTML=e.message||"";const t=n.textContent.trim();let a,i,r,s,c;e.isBirthday?(a="\u{1F382}",i="#ff6d00",r="255,109,0",s=e.clienteTel?{label:"\u{1F4AC} Mandar parab\xE9ns no WhatsApp",fn:()=>M(e.clienteTel,`Ol\xE1 ${e.clienteNome||""}! \u{1F382} Feliz anivers\xE1rio! Desejamos tudo de bom pra voc\xEA nesse dia especial! \u{1F389}`)}:null):e.isGeneral?(a="\u{1F4E2}",i="#00e5ff",r="0,229,255",s=null):(a="\u{1F4B3}",i="#ef4444",r="239,68,68",s=e.clienteTel?{label:"\u{1F4AC} WhatsApp do cliente",fn:()=>M(e.clienteTel)}:null,c=e.boletoId?{label:"\u{1F4CB} Ver contrato",fn:()=>{typeof verBoletoDeNotificacao=="function"&&verBoletoDeNotificacao(e.boletoId)}}:null);const p=document.createElement("div");p.className="notif-card",p.style.cssText=`
        pointer-events: all;
        background: rgba(8, 14, 28, 0.96);
        border: 1px solid rgba(${r}, 0.35);
        border-left: 3px solid ${i};
        border-radius: 14px;
        padding: 14px 14px 12px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(${r},0.1);
        animation: notif-slide-in 0.35s cubic-bezier(0.34,1.56,0.64,1) ${o*.08}s both;
        cursor: default;
        position: relative;
        overflow: hidden;
    `;const l=t.length>160;return p.innerHTML=`
        <div style="position:absolute;inset:0;border-radius:14px;background:radial-gradient(ellipse at top right,rgba(${r},0.07),transparent 65%);pointer-events:none;"></div>

        <div style="display:flex;align-items:flex-start;gap:10px;position:relative;">
            <!-- \xCDcone -->
            <div style="
                width:38px;height:38px;border-radius:10px;
                background:rgba(${r},0.12);
                border:1px solid rgba(${r},0.25);
                display:flex;align-items:center;justify-content:center;
                font-size:1.25rem;flex-shrink:0;
            ">${a}</div>

            <!-- Conte\xFAdo -->
            <div style="flex:1;min-width:0;">
                <div style="
                    font-size:0.78rem;
                    color:rgba(255,255,255,0.92);
                    line-height:1.45;
                    font-weight:500;
                    font-family:'Poppins',sans-serif;
                    display:-webkit-box;
                    -webkit-line-clamp:3;
                    -webkit-box-orient:vertical;
                    overflow:hidden;
                    word-break:break-word;
                    margin-bottom:${l?"6px":s||c?"10px":"0"};
                ">${t}</div>

                ${l?`<button class="notif-vermais-btn" data-action="vermais" style="
                    background:none;border:none;padding:0;
                    color:rgba(${r},0.9);
                    font-size:0.67rem;font-weight:700;
                    font-family:'Poppins',sans-serif;cursor:pointer;
                    margin-bottom:${s||c?"8px":"0"};
                    letter-spacing:.3px;">Ver mensagem completa \u2197</button>`:""}

                ${s||c?`
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    ${s?`
                    <button class="notif-action-btn" data-action="primary" style="
                        flex:1;min-width:0;
                        background:rgba(${r},0.15);
                        border:1px solid rgba(${r},0.35);
                        border-radius:8px;
                        color:${i};
                        font-size:0.65rem;
                        font-weight:600;
                        padding:6px 8px;
                        cursor:pointer;
                        text-align:center;
                        white-space:nowrap;
                        overflow:hidden;
                        text-overflow:ellipsis;
                        font-family:'Poppins',sans-serif;
                        transition:background 0.15s;
                    ">${s.label}</button>
                    `:""}
                    ${c?`
                    <button class="notif-action-btn" data-action="secondary" style="
                        flex:1;min-width:0;
                        background:rgba(255,255,255,0.05);
                        border:1px solid rgba(255,255,255,0.1);
                        border-radius:8px;
                        color:rgba(255,255,255,0.55);
                        font-size:0.65rem;
                        font-weight:600;
                        padding:6px 8px;
                        cursor:pointer;
                        text-align:center;
                        white-space:nowrap;
                        overflow:hidden;
                        text-overflow:ellipsis;
                        font-family:'Poppins',sans-serif;
                        transition:background 0.15s;
                    ">${c.label}</button>
                    `:""}
                </div>
                `:""}
            </div>

            <!-- Fechar -->
            <button onclick="event.stopPropagation();window.dismissNotifBalloon('${e.notificationId}',this.closest('.notif-card'))" style="
                background:none;border:none;
                color:rgba(255,255,255,0.3);
                cursor:pointer;padding:2px;
                font-size:0.8rem;flex-shrink:0;
                line-height:1;
                transition:color 0.15s;
            ">\u2715</button>
        </div>
    `,l&&p.querySelector('[data-action="vermais"]')?.addEventListener("click",g=>{g.stopPropagation(),O(t,a,i,r)}),s&&p.querySelector('[data-action="primary"]')?.addEventListener("click",g=>{g.stopPropagation(),s.fn();const y=document.getElementById("notif-balloons-container");y&&k(y)}),c&&p.querySelector('[data-action="secondary"]')?.addEventListener("click",g=>{g.stopPropagation(),c.fn();const y=document.getElementById("notif-balloons-container");y&&k(y)}),p}function M(e,o){const n=(e||"").replace(/\D/g,"");if(!n)return;const t=o?`https://wa.me/55${n}?text=${encodeURIComponent(o)}`:`https://wa.me/55${n}`;window.open(t,"_blank")}window.dismissNotifBalloon=function(e,o){const n="ctwDismissedNotifs";let t=[];try{t=JSON.parse(localStorage.getItem(n)||"[]")}catch{}t.includes(e)||(t.push(e),localStorage.setItem(n,JSON.stringify(t))),o&&(o.style.animation="notif-slide-out 0.2s ease forwards",setTimeout(()=>o.remove(),220))},document.addEventListener("keydown",e=>{if(e.key==="Escape"){const o=document.getElementById("notif-balloons-container");o&&k(o)}});
