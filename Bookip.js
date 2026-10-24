const f="dmvynrze6",g="g8rdi3om",b=`https://api.cloudinary.com/v1_1/${f}/image/upload`;window._bookipFotoUrl="",window._bookipFotoBlob=null,window.abrirReciboSimples=function(){typeof window.ctwTrocarModoDoc=="function"&&window.ctwTrocarModoDoc("garantia"),window.isSimpleReceiptMode=!0,window.currentEditingBookipId=null,typeof window.resetFormulariosBookip=="function"&&window.resetFormulariosBookip();const n=document.getElementById("txtToggleNovo");n&&(n.innerHTML='<i class="bi bi-plus-lg"></i> Novo Recibo');const t=document.getElementById("toggleModoInputContainer");t&&(t.style.display="flex");const o=document.querySelector("#camposProduto .search-wrapper");o&&o.classList.add("hidden"),document.querySelectorAll("#mainMenu, .section-content").forEach(a=>a.style.display="none");const i=document.getElementById("areaBookipWrapper");i&&(i.style.display="block");const r=document.getElementById("bookipModeToggle");r&&(r.checked=!1,r.dispatchEvent(new Event("change")))},window.abrirFotoBookip=function(n,t){if(!n)return;const o=document.createElement("div");o.id="fotoBookipOverlay",o.style.cssText=`
        position: fixed; inset: 0; z-index: 19999;
        background: rgba(0,0,0,0.95);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 16px;
        animation: notif-overlay-in 0.2s ease;
    `,o.innerHTML=`
        <div style="position:relative;width:110px;height:110px;display:flex;align-items:center;justify-content:center;">
            <div style="position:absolute;width:90px;height:90px;border-radius:50%;border:2px solid transparent;border-top-color:var(--primary-color);animation:fav-tr-spin 0.9s linear infinite;"></div>
            <div style="position:absolute;width:110px;height:110px;border-radius:50%;border:2px solid transparent;border-bottom-color:#8b5cf6;animation:fav-tr-spin 1.4s linear infinite reverse;"></div>
            <span style="font-size:2.2rem;">\u{1F5BC}\uFE0F</span>
        </div>
        <div style="color:rgba(255,255,255,0.5);font-size:0.8rem;font-family:'Poppins',sans-serif;">Carregando imagem...</div>
    `,o.addEventListener("click",i=>{(i.target===o||i.target.id==="fotoBookipOverlay")&&(o.style.opacity="0",o.style.transition="opacity 0.2s",setTimeout(()=>o.remove(),200))}),document.body.appendChild(o);const e=new Image;e.onload=()=>{o.innerHTML=`
            <div style="position:relative;max-width:min(95vw,600px);">
                <img src="${n}"
                    style="width:100%;max-height:80vh;object-fit:contain;border-radius:12px;display:block;box-shadow:0 8px 40px rgba(0,0,0,0.8);">
                <button onclick="document.getElementById('fotoBookipOverlay').remove()" style="
                    position:absolute;top:-12px;right:-12px;
                    background:rgba(0,0,0,0.8);border:1px solid rgba(255,255,255,0.2);
                    border-radius:50%;width:36px;height:36px;
                    color:#fff;font-size:1rem;cursor:pointer;
                    display:flex;align-items:center;justify-content:center;">\u2715</button>
            </div>
            <div style="color:rgba(255,255,255,0.4);font-size:0.72rem;font-family:'Poppins',sans-serif;text-align:center;">
                ${t} \xB7 Toque fora para fechar
            </div>
        `},e.onerror=()=>{o.innerHTML=`
            <div style="color:rgba(255,255,255,0.5);font-size:0.9rem;text-align:center;padding:20px;">
                \u26A0\uFE0F N\xE3o foi poss\xEDvel carregar a foto<br><br>
                <button onclick="document.getElementById('fotoBookipOverlay').remove()"
                    style="background:var(--primary-color);border:none;border-radius:8px;color:var(--on-primary);padding:8px 20px;cursor:pointer;">
                    Fechar
                </button>
            </div>
        `},e.src=n};function y(n){return new Promise((t,o)=>{const e=new Image,i=URL.createObjectURL(n);e.onload=()=>{URL.revokeObjectURL(i);const r=1920,a=.88;let l=e.width,d=e.height;if(l>r||d>r){const c=Math.min(r/l,r/d);l=Math.round(l*c),d=Math.round(d*c)}const s=document.createElement("canvas");s.width=l,s.height=d,s.getContext("2d").drawImage(e,0,0,l,d),s.toBlob(c=>{if(c){t(c);return}s.toBlob(p=>{p?t(p):o(new Error("Compressao falhou"))},"image/jpeg",a)},"image/webp",a)},e.onerror=()=>{URL.revokeObjectURL(i),o(new Error("Imagem invalida"))},e.src=i})}window.uploadFotoCloudinary=async function(n){if(!n)return"";try{const t=new FormData;t.append("file",n,"foto.webp"),t.append("upload_preset",g),t.append("folder","bookip_fotos");const o=await fetch(b,{method:"POST",body:t});if(!o.ok)throw new Error("HTTP "+o.status);const e=await o.json();return e.secure_url?e.secure_url:(console.warn("Cloudinary resposta inesperada:",e),"")}catch(t){return console.warn("Upload Cloudinary falhou:",t),""}};function m(){const n=document.getElementById("bookipPhotoInputCamera"),t=document.getElementById("bookipPhotoInputGallery"),o=document.getElementById("bookipPhotoBtnCamera"),e=document.getElementById("bookipPhotoBtnGallery"),i=document.getElementById("bookipPhotoPreview"),r=document.getElementById("bookipPhotoImg"),a=document.getElementById("bookipPhotoBtnLabel"),l=document.getElementById("bookipPhotoRemove");if(!n||!t)return;o&&o.addEventListener("click",()=>n.click()),e&&e.addEventListener("click",()=>t.click());async function d(s){if(s){a&&(a.textContent="Comprimindo..."),o&&(o.disabled=!0),e&&(e.disabled=!0);try{const c=await y(s),p=Math.round(c.size/1024),u=URL.createObjectURL(c);r&&(r.src=u),i&&i.classList.remove("hidden"),a&&(a.textContent=`Foto pronta (${p}KB)`),window._bookipFotoBlob=c,window._bookipFotoUrl=""}catch{a&&(a.textContent="Da galeria"),typeof window.showCustomModal=="function"&&window.showCustomModal({message:"N\xE3o foi poss\xEDvel processar a foto. Tente novamente."})}o&&(o.disabled=!1),e&&(e.disabled=!1)}}n.addEventListener("change",()=>{d(n.files[0]),n.value=""}),t.addEventListener("change",()=>{d(t.files[0]),t.value=""}),window._bookipHandlePhotoFile=d,l&&l.addEventListener("click",s=>{s.stopPropagation(),r&&(r.src=""),i&&i.classList.add("hidden"),a&&(a.textContent="Da galeria"),window._bookipFotoBlob=null,window._bookipFotoUrl=""})}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",m):m();
