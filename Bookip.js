// bookip.js — Funções auxiliares do módulo Bookip / Recibo
// Depende de: window.resetFormulariosBookip, window.showCustomModal
// Cloudinary: upload de fotos do produto

// ============================================================
// CLOUDINARY — config
// ============================================================
const BOOKIP_CLOUDINARY_CLOUD  = 'dmvynrze6';
const BOOKIP_CLOUDINARY_PRESET = 'g8rdi3om';
const BOOKIP_CLOUDINARY_URL    = `https://api.cloudinary.com/v1_1/${BOOKIP_CLOUDINARY_CLOUD}/image/upload`;

// Fotos do produto — até 4 por garantia: [{ url, blob, preview }]
window._bookipFotos = [];
const BOOKIP_MAX_FOTOS = 4;

// ============================================================
// ABRIR RECIBO SIMPLES
// ============================================================
window.abrirReciboSimples = function() {
    // 1. Configura variáveis globais
    window.isSimpleReceiptMode = true;
    window.currentEditingBookipId = null;

    // 2. Faxina (limpa campos e zera produtos)
    if (typeof window.resetFormulariosBookip === 'function') {
        window.resetFormulariosBookip();
    }

    // 3. Títulos
    const titulo = document.querySelector('#areaBookipWrapper h3');
    if (titulo) titulo.innerText = 'Novo Recibo (Simples)';

    const txtNovo = document.getElementById('txtToggleNovo');
    if (txtNovo) txtNovo.innerHTML = '<i class="bi bi-plus-lg"></i> Novo Recibo';

    // 4. Interface (esconde busca, mostra toggle)
    const toggle = document.getElementById('toggleModoInputContainer');
    if (toggle) toggle.style.display = 'flex';

    const buscaContainer = document.querySelector('#camposProduto .search-wrapper');
    if (buscaContainer) buscaContainer.classList.add('hidden');

    // 5. Troca a tela
    const menus = document.querySelectorAll('#mainMenu, #documentsHome, .section-content');
    menus.forEach(m => m.style.display = 'none');

    const tela = document.getElementById('areaBookipWrapper');
    if (tela) tela.style.display = 'block';

    // Garante aba "Novo" ativa visualmente
    const tabToggle = document.getElementById('bookipModeToggle');
    if (tabToggle) {
        tabToggle.checked = false;
        tabToggle.dispatchEvent(new Event('change'));
    }
};

// ============================================================
// ABRIR FOTO DO PRODUTO (overlay tela cheia)
// ============================================================
window.abrirFotoBookip = function(fotoUrl, nome) {
    if (!fotoUrl) return;

    const overlay = document.createElement('div');
    overlay.id = 'fotoBookipOverlay';
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 19999;
        background: rgba(0,0,0,0.95);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 16px;
        animation: notif-overlay-in 0.2s ease;
    `;

    // Estado de loading
    overlay.innerHTML = `
        <div style="position:relative;width:110px;height:110px;display:flex;align-items:center;justify-content:center;">
            <div style="position:absolute;width:90px;height:90px;border-radius:50%;border:2px solid transparent;border-top-color:var(--primary-color);animation:fav-tr-spin 0.9s linear infinite;"></div>
            <div style="position:absolute;width:110px;height:110px;border-radius:50%;border:2px solid transparent;border-bottom-color:#8b5cf6;animation:fav-tr-spin 1.4s linear infinite reverse;"></div>
            <span style="font-size:2.2rem;">🖼️</span>
        </div>
        <div style="color:rgba(255,255,255,0.5);font-size:0.8rem;font-family:'Poppins',sans-serif;">Carregando imagem...</div>
    `;

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.id === 'fotoBookipOverlay') {
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity 0.2s';
            setTimeout(() => overlay.remove(), 200);
        }
    });

    document.body.appendChild(overlay);

    const img = new Image();
    img.onload = () => {
        overlay.innerHTML = `
            <div style="position:relative;max-width:min(95vw,600px);">
                <img src="${fotoUrl}"
                    style="width:100%;max-height:80vh;object-fit:contain;border-radius:12px;display:block;box-shadow:0 8px 40px rgba(0,0,0,0.8);">
                <button onclick="document.getElementById('fotoBookipOverlay').remove()" style="
                    position:absolute;top:-12px;right:-12px;
                    background:rgba(0,0,0,0.8);border:1px solid rgba(255,255,255,0.2);
                    border-radius:50%;width:36px;height:36px;
                    color:#fff;font-size:1rem;cursor:pointer;
                    display:flex;align-items:center;justify-content:center;">✕</button>
            </div>
            <div style="color:rgba(255,255,255,0.4);font-size:0.72rem;font-family:'Poppins',sans-serif;text-align:center;">
                ${nome} · Toque fora para fechar
            </div>
        `;
    };
    img.onerror = () => {
        overlay.innerHTML = `
            <div style="color:rgba(255,255,255,0.5);font-size:0.9rem;text-align:center;padding:20px;">
                ⚠️ Não foi possível carregar a foto<br><br>
                <button onclick="document.getElementById('fotoBookipOverlay').remove()"
                    style="background:var(--primary-color);border:none;border-radius:8px;color:#fff;padding:8px 20px;cursor:pointer;">
                    Fechar
                </button>
            </div>
        `;
    };
    img.src = fotoUrl;
};

// ============================================================
// COMPRIMIR FOTO (canvas → WebP 88%, max 1920px)
// ============================================================
function comprimirFotoBookip(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(objUrl);
            const MAX = 1920, Q = 0.88;
            let w = img.width, h = img.height;
            if (w > MAX || h > MAX) {
                const r = Math.min(MAX / w, MAX / h);
                w = Math.round(w * r);
                h = Math.round(h * r);
            }
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            // Tenta WebP; se o dispositivo nao suportar, cai pra JPEG
            c.toBlob(blob => {
                if (blob) { resolve(blob); return; }
                c.toBlob(blobJpeg => {
                    blobJpeg ? resolve(blobJpeg) : reject(new Error('Compressao falhou'));
                }, 'image/jpeg', Q);
            }, 'image/webp', Q);
        };
        img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('Imagem invalida')); };
        img.src = objUrl;
    });
}

// ============================================================
// UPLOAD PARA CLOUDINARY — retorna URL segura
// ============================================================
window.uploadFotoCloudinary = async function(blob) {
    if (!blob) return '';
    try {
        const formData = new FormData();
        formData.append('file', blob, 'foto.webp');
        formData.append('upload_preset', BOOKIP_CLOUDINARY_PRESET);
        formData.append('folder', 'bookip_fotos');

        const resp = await fetch(BOOKIP_CLOUDINARY_URL, { method: 'POST', body: formData });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        if (data.secure_url) return data.secure_url;
        console.warn('Cloudinary resposta inesperada:', data);
        return '';
    } catch(e) {
        console.warn('Upload Cloudinary falhou:', e);
        return '';
    }
};

// ============================================================
// INICIALIZAR CÂMERA / GALERIA DO BOOKIP (até 4 fotos)
// ============================================================

// Desenha as miniaturas e atualiza botões/label
window._bookipRenderFotos = function() {
    const thumbs     = document.getElementById('bookipPhotosThumbs');
    const preview    = document.getElementById('bookipPhotoPreview');
    const btnLabel   = document.getElementById('bookipPhotoBtnLabel');
    const btnCamera  = document.getElementById('bookipPhotoBtnCamera');
    const btnGallery = document.getElementById('bookipPhotoBtnGallery');
    const fotos = window._bookipFotos || [];
    if (!thumbs) return;

    thumbs.innerHTML = '';
    fotos.forEach((f, i) => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative;width:74px;height:74px;';
        const img = document.createElement('img');
        img.src = f.preview || f.url;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:12px;border:1px solid rgba(255,255,255,.15);cursor:pointer;display:block;';
        img.addEventListener('click', () => {
            if (typeof window.abrirFotoBookip === 'function') window.abrirFotoBookip(f.url || f.preview, 'Foto ' + (i + 1));
        });
        const x = document.createElement('button');
        x.type = 'button';
        x.textContent = '✕';
        x.style.cssText = 'position:absolute;top:-7px;right:-7px;width:22px;height:22px;border-radius:50%;border:none;background:#ef4444;color:#fff;font-size:.7rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;';
        x.addEventListener('click', (e) => {
            e.stopPropagation();
            const rem = fotos.splice(i, 1)[0];
            if (rem && rem.preview) { try { URL.revokeObjectURL(rem.preview); } catch(_) {} }
            window._bookipRenderFotos();
        });
        wrap.appendChild(img);
        wrap.appendChild(x);
        thumbs.appendChild(wrap);
    });

    if (preview) preview.classList.toggle('hidden', fotos.length === 0);
    if (btnLabel) btnLabel.textContent = fotos.length ? (fotos.length + '/' + BOOKIP_MAX_FOTOS + ' fotos') : 'Da galeria';
    const cheio = fotos.length >= BOOKIP_MAX_FOTOS;
    [btnCamera, btnGallery].forEach(b => { if (b) { b.disabled = cheio; b.style.opacity = cheio ? '.45' : ''; } });
};

// Define as fotos a partir de URLs salvas (usado ao carregar edição)
window._bookipSetFotos = function(urls) {
    (window._bookipFotos || []).forEach(f => { if (f.preview) { try { URL.revokeObjectURL(f.preview); } catch(_) {} } });
    window._bookipFotos = (urls || []).slice(0, BOOKIP_MAX_FOTOS).map(u => ({ url: u, blob: null, preview: '' }));
    window._bookipRenderFotos();
};

// Adiciona uma foto (File/Blob) comprimindo — usado pelo Zap I.A para anexar a foto da caixa
window._bookipAddFotoFile = async function(file) {
    if (!file || (window._bookipFotos || []).length >= BOOKIP_MAX_FOTOS) return false;
    try {
        const compressed = await comprimirFotoBookip(file);
        window._bookipFotos.push({ url: '', blob: compressed, preview: URL.createObjectURL(compressed) });
        window._bookipRenderFotos();
        return true;
    } catch(e) { console.warn('Foto não processada:', e); return false; }
};

function initBookipPhoto() {
    const inputCamera  = document.getElementById('bookipPhotoInputCamera');
    const inputGallery = document.getElementById('bookipPhotoInputGallery');
    const btnCamera    = document.getElementById('bookipPhotoBtnCamera');
    const btnGallery   = document.getElementById('bookipPhotoBtnGallery');
    const btnLabel     = document.getElementById('bookipPhotoBtnLabel');
    if (!inputCamera || !inputGallery) return;

    if (btnCamera)  btnCamera.addEventListener('click',  () => inputCamera.click());
    if (btnGallery) btnGallery.addEventListener('click', () => inputGallery.click());

    async function handleFiles(fileList) {
        const files = Array.from(fileList || []);
        if (!files.length) return;

        const livres = BOOKIP_MAX_FOTOS - (window._bookipFotos || []).length;
        if (livres <= 0) {
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'Máximo de ' + BOOKIP_MAX_FOTOS + ' fotos por garantia.' });
            return;
        }
        const selecionadas = files.slice(0, livres);
        if (files.length > livres && typeof window.showCustomModal === 'function') {
            window.showCustomModal({ message: 'Máximo de ' + BOOKIP_MAX_FOTOS + ' fotos — apenas as ' + livres + ' primeiras foram adicionadas.' });
        }

        if (btnLabel)   btnLabel.textContent = 'Comprimindo...';
        if (btnCamera)  btnCamera.disabled   = true;
        if (btnGallery) btnGallery.disabled  = true;

        for (const file of selecionadas) {
            try {
                const compressed = await comprimirFotoBookip(file);
                window._bookipFotos.push({ url: '', blob: compressed, preview: URL.createObjectURL(compressed) });
            } catch(e) {
                console.warn('Foto ignorada (compressão falhou):', e);
                if (typeof window.showCustomModal === 'function') {
                    window.showCustomModal({ message: 'Uma das fotos não pôde ser processada e foi ignorada.' });
                }
            }
        }

        if (btnCamera)  btnCamera.disabled  = false;
        if (btnGallery) btnGallery.disabled = false;
        window._bookipRenderFotos();
    }

    inputCamera.addEventListener('change',  () => { handleFiles(inputCamera.files);  inputCamera.value  = ''; });
    inputGallery.addEventListener('change', () => { handleFiles(inputGallery.files); inputGallery.value = ''; });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBookipPhoto);
} else {
    initBookipPhoto();
}
