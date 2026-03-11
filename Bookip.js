// bookip.js — Funções auxiliares do módulo Bookip / Recibo
// Depende de: window.resetFormulariosBookip, window.showCustomModal
// Cloudinary: upload de fotos do produto

// ============================================================
// CLOUDINARY — config
// ============================================================
const BOOKIP_CLOUDINARY_CLOUD  = 'dmvynrze6';
const BOOKIP_CLOUDINARY_PRESET = 'g8rdi3om';
const BOOKIP_CLOUDINARY_URL    = `https://api.cloudinary.com/v1_1/${BOOKIP_CLOUDINARY_CLOUD}/image/upload`;

window._bookipFotoUrl  = '';
window._bookipFotoBlob = null;

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
            c.toBlob(
                blob => blob ? resolve(blob) : reject(new Error('Compressão falhou')),
                'image/webp', Q
            );
        };
        img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('Imagem inválida')); };
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
// INICIALIZAR CÂMERA / GALERIA DO BOOKIP
// ============================================================
function initBookipPhoto() {
    const inputCamera  = document.getElementById('bookipPhotoInputCamera');
    const inputGallery = document.getElementById('bookipPhotoInputGallery');
    const btnCamera    = document.getElementById('bookipPhotoBtnCamera');
    const btnGallery   = document.getElementById('bookipPhotoBtnGallery');
    const preview      = document.getElementById('bookipPhotoPreview');
    const imgEl        = document.getElementById('bookipPhotoImg');
    const btnLabel     = document.getElementById('bookipPhotoBtnLabel');
    const removeBtn    = document.getElementById('bookipPhotoRemove');
    if (!inputCamera || !inputGallery) return;

    if (btnCamera)  btnCamera.addEventListener('click',  () => inputCamera.click());
    if (btnGallery) btnGallery.addEventListener('click', () => inputGallery.click());

    async function handleFile(file) {
        if (!file) return;
        if (btnLabel)  btnLabel.textContent   = 'Comprimindo...';
        if (btnCamera) btnCamera.disabled     = true;
        if (btnGallery) btnGallery.disabled   = true;
        try {
            const compressed = await comprimirFotoBookip(file);
            const kb = Math.round(compressed.size / 1024);
            const previewUrl = URL.createObjectURL(compressed);
            if (imgEl)   imgEl.src = previewUrl;
            if (preview) preview.classList.remove('hidden');
            if (btnLabel) btnLabel.textContent = `Foto pronta (${kb}KB)`;
            window._bookipFotoBlob = compressed;
            window._bookipFotoUrl  = '';
        } catch(e) {
            if (btnLabel) btnLabel.textContent = 'Da galeria';
            if (typeof window.showCustomModal === 'function') {
                window.showCustomModal({ message: 'Não foi possível processar a foto. Tente novamente.' });
            }
        }
        if (btnCamera)  btnCamera.disabled  = false;
        if (btnGallery) btnGallery.disabled = false;
    }

    inputCamera.addEventListener('change',  () => { handleFile(inputCamera.files[0]);  inputCamera.value  = ''; });
    inputGallery.addEventListener('change', () => { handleFile(inputGallery.files[0]); inputGallery.value = ''; });

    if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (imgEl)   imgEl.src = '';
            if (preview) preview.classList.add('hidden');
            if (btnLabel) btnLabel.textContent = 'Da galeria';
            window._bookipFotoBlob = null;
            window._bookipFotoUrl  = '';
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBookipPhoto);
} else {
    initBookipPhoto();
}
