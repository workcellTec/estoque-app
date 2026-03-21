// ================================================================
// Reposicao.js — Lista de Reposição / Compras (CTW)
// Depende de: window._firebaseDB, window.showCustomModal
// Firebase path: reposicao/
// Cloudinary: dmvynrze6 / g8rdi3om
// ================================================================

import { ref, push, update, remove, onValue, off }
    from "https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js";

// ── Constantes ──────────────────────────────────────────────────
const REPO_PATH        = 'reposicao';
const CLD_CLOUD        = 'dmvynrze6';
const CLD_PRESET       = 'g8rdi3om';
const CLD_URL          = `https://api.cloudinary.com/v1_1/${CLD_CLOUD}/image/upload`;

// ── Estado ──────────────────────────────────────────────────────
let db              = null;
let repoListener    = null;
let allItems        = [];      // [{id, nome, qtd, variacao, fotoUrl, comprado, criadoEm}]
let photoBlob       = null;    // blob pendente para upload
let photoUrl        = '';      // url já upada (edição)
let editingId       = null;    // id do item em edição (null = novo)
let filterMode      = 'all';   // 'all' | 'pending' | 'done'

// Sempre pega o DB autenticado mais recente (igual ao repairs.js)
function getDb() {
    if (window._firebaseDB) db = window._firebaseDB;
    return db;
}

// ── Boot ─────────────────────────────────────────────────────────
function waitForDB(cb, attempts = 60) {
    if (window._firebaseDB) { db = window._firebaseDB; cb(db); return; }
    if (attempts <= 0) { console.error('[Reposicao] DB não disponível'); return; }
    if (attempts === 60) {
        // Responde imediatamente quando app.js sinalizar que o DB está pronto
        document.addEventListener('ctwDBReady', function _onDB() {
            document.removeEventListener('ctwDBReady', _onDB);
            if (window._firebaseDB) { db = window._firebaseDB; cb(db); }
        }, { once: true });
    }
    setTimeout(() => waitForDB(cb, attempts - 1), 300);
}

// ── Firebase ─────────────────────────────────────────────────────
function startListener() {
    if (!getDb()) return;
    const r = ref(getDb(), REPO_PATH);
    repoListener = onValue(r, snap => {
        allItems = [];
        if (snap.exists()) {
            snap.forEach(child => {
                allItems.push({ id: child.key, ...child.val() });
            });
        }
        // Ordena: pendentes primeiro, depois por data
        allItems.sort((a, b) => {
            if (a.comprado !== b.comprado) return a.comprado ? 1 : -1;
            return (b.criadoEm || 0) - (a.criadoEm || 0);
        });
        renderList();
        updateBadge();
    });
}

function stopListener() {
    if (getDb() && repoListener) {
        off(ref(getDb(), REPO_PATH), 'value', repoListener);
        repoListener = null;
    }
}

async function saveItem(dados) {
    if (!getDb()) return;
    if (editingId) {
        await update(ref(getDb(), `${REPO_PATH}/${editingId}`), dados);
    } else {
        await push(ref(getDb(), REPO_PATH), { ...dados, comprado: false, criadoEm: Date.now() });
    }
}

async function toggleComprado(id, current) {
    if (!getDb()) return;
    await update(ref(getDb(), `${REPO_PATH}/${id}`), { comprado: !current });
}

async function deleteItem(id) {
    if (!getDb()) return;
    await remove(ref(getDb(), `${REPO_PATH}/${id}`));
}

async function clearComprados() {
    if (!getDb()) return;
    const done = allItems.filter(i => i.comprado);
    const updates = {};
    done.forEach(i => { updates[`${REPO_PATH}/${i.id}`] = null; });
    if (Object.keys(updates).length > 0) {
        await update(ref(getDb(), '/'), updates);
    }
}

// ── Cloudinary Upload ────────────────────────────────────────────
async function uploadFoto(blob) {
    const fd = new FormData();
    fd.append('file', blob);
    fd.append('upload_preset', CLD_PRESET);
    const res  = await fetch(CLD_URL, { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.secure_url) throw new Error('Upload falhou');
    return data.secure_url;
}

// ── UI — Formulário ──────────────────────────────────────────────
function getEl(id) { return document.getElementById(id); }

function openForm(item = null) {
    editingId  = item ? item.id : null;
    photoBlob  = null;
    photoUrl   = item?.fotoUrl || '';

    getEl('repoFormTitle').textContent   = item ? 'Editar Item' : 'Novo Item';
    getEl('repoInputNome').value         = item?.nome      || '';
    getEl('repoInputQtd').value          = item?.qtd       || 1;
    getEl('repoInputVariacao').value     = item?.variacao  || '';
    getEl('repoInputNome').focus();

    // Preview da foto
    const prev = getEl('repoFotoPreview');
    const img  = getEl('repoFotoImg');
    if (photoUrl) {
        img.src = photoUrl;
        prev.classList.remove('hidden');
    } else {
        prev.classList.add('hidden');
        img.src = '';
    }

    getEl('repoFormOverlay').classList.remove('hidden');
    getEl('repoFormOverlay').classList.add('active');
}

function closeForm() {
    getEl('repoFormOverlay').classList.remove('active');
    setTimeout(() => getEl('repoFormOverlay').classList.add('hidden'), 280);
    photoBlob = null;
    photoUrl  = '';
    editingId = null;
}

// ── UI — Render Lista ────────────────────────────────────────────
function renderList() {
    const list = getEl('repoList');
    if (!list) return;

    let items = allItems;
    if (filterMode === 'pending') items = allItems.filter(i => !i.comprado);
    if (filterMode === 'done')    items = allItems.filter(i =>  i.comprado);

    if (items.length === 0) {
        const msg = filterMode === 'done'
            ? 'Nenhum item comprado ainda.'
            : 'Lista vazia! Adicione itens para começar.';
        list.innerHTML = `<div class="repo-empty">
            <i class="bi bi-cart-x"></i>
            <p>${msg}</p>
        </div>`;
        return;
    }

    list.innerHTML = items.map(item => {
        const fotoHtml = item.fotoUrl
            ? `<img class="repo-item-foto" src="${item.fotoUrl}" alt="foto" loading="lazy">`
            : `<div class="repo-item-foto-placeholder"><i class="bi bi-image"></i></div>`;

        const variacaoTag = item.variacao
            ? `<span class="repo-item-variacao-tag">${escHtml(item.variacao)}</span>` : '';

        const dataTag = item.criadoEm
            ? `<span class="repo-item-data"><i class="bi bi-calendar3"></i>${new Date(item.criadoEm).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}</span>` : '';

        const checkIcon = item.comprado ? 'bi-check-circle-fill' : 'bi-circle';

        return `
        <div class="repo-item ${item.comprado ? 'repo-item--done' : ''}" data-id="${item.id}">

            <!-- Linha principal -->
            <div class="repo-item-row" onclick="window._repoToggleExpand(this.closest('.repo-item'))">
                <div class="repo-item-foto-wrap">${fotoHtml}</div>
                <span class="repo-item-qtd-badge">${item.qtd}x</span>
                <div class="repo-item-info">
                    <div class="repo-item-nome">${escHtml(item.nome)}</div>
                    <div class="repo-item-sub">${variacaoTag}${dataTag}</div>
                </div>
                <i class="bi bi-chevron-down repo-item-chevron"></i>
            </div>

            <!-- Check sempre visível — fora da área de expansão -->
            <button class="repo-check-btn ${item.comprado ? 'checked' : ''}"
                    onclick="event.stopPropagation(); window._repoToggle('${item.id}', ${item.comprado})">
                <i class="bi ${checkIcon}"></i>
            </button>

            <!-- Ações expandidas -->
            <div class="repo-item-actions-panel">
                <button class="repo-edit-btn" onclick="window._repoEdit('${item.id}')" title="Editar">
                    <i class="bi bi-pencil-fill"></i>
                </button>
                <button class="repo-del-btn" onclick="window._repoDel('${item.id}')" title="Remover">
                    <i class="bi bi-trash3-fill"></i>
                </button>
            </div>
        </div>`;
    }).join('');
}

function updateBadge() {
    const pending = allItems.filter(i => !i.comprado).length;
    // Atualiza ambos os badges (menu clássico e card v2)
    ['repoBadge', 'repoBadge2'].forEach(id => {
        const badge = getEl(id);
        if (!badge) return;
        if (pending > 0) {
            badge.textContent = pending;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    });
}

function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Handlers globais (chamados por onclick inline) ────────────────
window._repoToggleExpand = (el) => {
    document.querySelectorAll('.repo-item.expanded').forEach(other => {
        if (other !== el) other.classList.remove('expanded');
    });
    el.classList.toggle('expanded');
};

window._repoToggle = async (id, current) => {
    await toggleComprado(id, current);
    if (!current && navigator.vibrate) navigator.vibrate(40);
};

window._repoEdit = (id) => {
    const item = allItems.find(i => i.id === id);
    if (item) openForm(item);
};

window._repoDel = (id) => {
    window.showCustomModal?.({
        message: 'Remover este item da lista?',
        confirmText: 'Remover',
        cancelText: 'Cancelar',
        onConfirm: () => deleteItem(id)
    }) ?? deleteItem(id);
};

window._repoVerFoto = (url) => {
    if (!url) return;
    // Abre a foto em tela cheia num overlay simples
    let ov = getEl('repoFotoFullOverlay');
    if (!ov) {
        ov = document.createElement('div');
        ov.id = 'repoFotoFullOverlay';
        ov.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
        ov.innerHTML = '<img style="max-width:92vw;max-height:88vh;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.6);" id="repoFotoFullImg">';
        ov.addEventListener('click', () => ov.classList.add('hidden'));
        document.body.appendChild(ov);
    }
    getEl('repoFotoFullImg').src = url;
    ov.classList.remove('hidden');
};

// ── Setup dos eventos do formulário e da tela ────────────────────
function setupEvents() {
    // Botão novo item
    getEl('repoBtnNovo')?.addEventListener('click', () => openForm());

    // Fechar form
    getEl('repoFormClose')?.addEventListener('click', closeForm);
    getEl('repoFormOverlay')?.addEventListener('click', (e) => {
        if (e.target === getEl('repoFormOverlay')) closeForm();
    });

    // Foto — câmera e galeria
    getEl('repoBtnCamera')?.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
        inp.onchange = e => handleFotoInput(e.target.files[0]);
        inp.click();
    });

    getEl('repoBtnGaleria')?.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*';
        inp.onchange = e => handleFotoInput(e.target.files[0]);
        inp.click();
    });

    getEl('repoBtnRemoverFoto')?.addEventListener('click', () => {
        photoBlob = null;
        photoUrl  = '';
        const prev = getEl('repoFotoPreview');
        const img  = getEl('repoFotoImg');
        prev.classList.add('hidden');
        img.src = '';
    });

    // Salvar item
    getEl('repoBtnSalvar')?.addEventListener('click', async () => {
        const nome = getEl('repoInputNome').value.trim();
        if (!nome) {
            getEl('repoInputNome').focus();
            return;
        }
        const qtd      = parseInt(getEl('repoInputQtd').value) || 1;
        const variacao = getEl('repoInputVariacao').value.trim();

        const btn = getEl('repoBtnSalvar');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

        try {
            let fotoFinal = photoUrl;
            if (photoBlob) {
                fotoFinal = await uploadFoto(photoBlob);
            }

            await saveItem({ nome, qtd, variacao, fotoUrl: fotoFinal });
            closeForm();
        } catch (err) {
            console.error('[Reposicao] Erro ao salvar:', err);
            window.showCustomModal?.({ message: 'Erro ao salvar: ' + err.message });
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-check-circle-fill"></i> Salvar';
        }
    });

    // Limpar comprados
    getEl('repoBtnLimpar')?.addEventListener('click', () => {
        const done = allItems.filter(i => i.comprado).length;
        if (done === 0) {
            window.showCustomModal?.({ message: 'Nenhum item marcado como comprado.' });
            return;
        }
        window.showCustomModal?.({
            message: `Apagar ${done} ${done === 1 ? 'item comprado' : 'itens comprados'}?`,
            confirmText: 'Apagar',
            cancelText: 'Cancelar',
            onConfirm: clearComprados
        }) ?? clearComprados();
    });

    // Filtros
    getEl('repoFilterAll')?.addEventListener('click',     () => setFilter('all'));
    getEl('repoFilterPending')?.addEventListener('click', () => setFilter('pending'));
    getEl('repoFilterDone')?.addEventListener('click',    () => setFilter('done'));
}

function setFilter(mode) {
    filterMode = mode;
    ['All','Pending','Done'].forEach(f => {
        getEl(`repoFilter${f}`)?.classList.toggle('active', mode === f.toLowerCase());
    });
    renderList();
}

async function handleFotoInput(file) {
    if (!file) return;
    // Comprime para WebP via canvas
    const img = new Image();
    img.onload = () => {
        const MAX = 800;
        let w = img.width, h = img.height;
        if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => {
            photoBlob = blob;
            const url = URL.createObjectURL(blob);
            const prevEl = getEl('repoFotoPreview');
            const imgEl  = getEl('repoFotoImg');
            imgEl.src = url;
            prevEl.classList.remove('hidden');
        }, 'image/webp', 0.82);
    };
    img.src = URL.createObjectURL(file);
}

// ── Init ─────────────────────────────────────────────────────────
function init() {
    waitForDB(dbInstance => {
        db = dbInstance;
        startListener();
    });
    setupEvents();
}

// Aguarda DOM e inicia
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Expõe para showMainSection poder parar/iniciar o listener
export { startListener, stopListener };
