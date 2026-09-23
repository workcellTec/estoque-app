// ================================================================
// Reposicao.js v2 — Lista de Reposição / Compras (CTW)
// Novidades: banners por categoria, avatar de foto, busca rápida
//            categoria inteligente por palavras-chave
// Firebase paths: reposicao/  ·  reposicao_avatars/
// Cloudinary: dmvynrze6 / g8rdi3om
// ================================================================

import { ref, push, update, remove, onValue, off }
    from "https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js";

// ── Constantes ──────────────────────────────────────────────────
const REPO_PATH    = 'reposicao';
const AVATARS_PATH = 'reposicao_avatars';
const CLD_CLOUD    = 'dmvynrze6';
const CLD_PRESET   = 'g8rdi3om';
const CLD_URL      = `https://api.cloudinary.com/v1_1/${CLD_CLOUD}/image/upload`;

const CATEGORIES = [
    { key: 'peliculas', label: 'Películas', icon: 'bi-display',       color: '#6366f1' },
    { key: 'capinhas',  label: 'Capinhas',  icon: 'bi-phone-fill',    color: '#10b981' },
    { key: 'outros',    label: 'Outros',    icon: 'bi-box-seam-fill', color: '#f59e0b' },
];

// Palavras-chave para detecção automática de categoria
const CAT_KEYWORDS = {
    peliculas: ['pelicula','película','peliculas','películas','vidro','glass','protetor','source','pel '],
    capinhas:  ['capinha','case ','capa ','capas','cases','bumper','cover','capa de','capinha de'],
};

// ── Estado ──────────────────────────────────────────────────────
let db               = null;
let repoListener     = null;
let avatarListener   = null;
let allItems         = [];
let allAvatars       = {};
let collapsedBanners = {};
let photoBlob        = null;
let photoUrl         = '';
let editingId        = null;
let filterMode       = 'pending';
let searchQuery      = '';

function getDb() {
    if (window._firebaseDB) db = window._firebaseDB;
    return db;
}

// ── Boot ─────────────────────────────────────────────────────────
function waitForDB(cb, attempts = 60) {
    if (window._firebaseDB) { db = window._firebaseDB; cb(db); return; }
    if (attempts <= 0) { console.error('[Reposicao] DB não disponível'); return; }
    if (attempts === 60) {
        document.addEventListener('ctwDBReady', function _onDB() {
            document.removeEventListener('ctwDBReady', _onDB);
            if (window._firebaseDB) { db = window._firebaseDB; cb(db); }
        }, { once: true });
    }
    setTimeout(() => waitForDB(cb, attempts - 1), 300);
}

// ── Firebase — Itens ────────────────────────────────────────────
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
        allItems.sort((a, b) => {
            if (a.comprado !== b.comprado) return a.comprado ? 1 : -1;
            return (b.criadoEm || 0) - (a.criadoEm || 0);
        });
        renderList();
        updateBadge();
    });
    startAvatarListener();
}

function stopListener() {
    if (getDb() && repoListener) {
        off(ref(getDb(), REPO_PATH), 'value', repoListener);
        repoListener = null;
    }
    if (getDb() && avatarListener) {
        off(ref(getDb(), AVATARS_PATH), 'value', avatarListener);
        avatarListener = null;
    }
}

// ── Firebase — Avatars ──────────────────────────────────────────
function startAvatarListener() {
    if (!getDb()) return;
    avatarListener = onValue(ref(getDb(), AVATARS_PATH), snap => {
        allAvatars = snap.exists() ? snap.val() : {};
    });
}

function normalizeKey(str) {
    return str.toLowerCase().trim()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 80);
}

// Tenta salvar avatar — silencioso se falhar (regra pode não existir ainda)
async function saveAvatar(nome, fotoFinalUrl) {
    if (!fotoFinalUrl || !nome || !getDb()) return;
    const key = normalizeKey(nome);
    if (!key) return;
    try {
        await update(ref(getDb(), `${AVATARS_PATH}/${key}`), {
            nome, fotoUrl: fotoFinalUrl, updatedAt: Date.now()
        });
    } catch (err) {
        console.warn('[Reposicao] Avatar não salvo (verifique regras Firebase):', err.code);
    }
}

// ── Firebase — CRUD ──────────────────────────────────────────────
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

// ── Cloudinary ───────────────────────────────────────────────────
async function uploadFoto(blob) {
    const fd = new FormData();
    fd.append('file', blob);
    fd.append('upload_preset', CLD_PRESET);
    const res  = await fetch(CLD_URL, { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.secure_url) throw new Error('Upload falhou');
    return data.secure_url;
}

// ── Helpers ───────────────────────────────────────────────────────
function getEl(id) { return document.getElementById(id); }

function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;');
}

// ── Detecção automática de categoria ─────────────────────────────
function detectCategory(nome) {
    const lower = ' ' + nome.toLowerCase() + ' '; // espaço nos dois lados facilita match parcial
    for (const [cat, keywords] of Object.entries(CAT_KEYWORDS)) {
        if (keywords.some(kw => lower.includes(kw))) return cat;
    }
    return null; // não detectado — mantém o que está
}

function applyCategoryDetection(nome) {
    const detected = detectCategory(nome);
    if (!detected) return;
    const sel = getEl('repoInputCategoria');
    if (sel && sel.value !== detected) {
        sel.value = detected;
        // Pisca o select pra indicar mudança automática
        sel.classList.add('repo-select-auto-flash');
        setTimeout(() => sel.classList.remove('repo-select-auto-flash'), 600);
    }
}

// ── UI — Formulário ──────────────────────────────────────────────
function openForm(item = null) {
    editingId = item ? item.id : null;
    photoBlob = null;
    photoUrl  = item?.fotoUrl || '';

    getEl('repoFormTitle').textContent    = item ? 'Editar Item' : 'Novo Item';
    getEl('repoInputNome').value          = item?.nome      || '';
    getEl('repoInputQtd').value           = item?.qtd       || 1;
    getEl('repoInputVariacao').value      = item?.variacao  || '';
    getEl('repoInputCategoria').value     = item?.categoria || 'outros';

    const prev = getEl('repoFotoPreview');
    const img  = getEl('repoFotoImg');
    if (photoUrl) {
        img.src = photoUrl;
        prev.classList.remove('hidden');
    } else {
        prev.classList.add('hidden');
        img.src = '';
    }

    getEl('repoAvatarSuggestions')?.classList.add('hidden');
    getEl('repoFormOverlay').classList.remove('hidden');
    getEl('repoFormOverlay').classList.add('active');
    getEl('repoInputNome').focus();
}

function closeForm() {
    getEl('repoFormOverlay').classList.remove('active');
    setTimeout(() => getEl('repoFormOverlay').classList.add('hidden'), 280);
    photoBlob = null;
    photoUrl  = '';
    editingId = null;
}

// ── UI — Render Item (helper) ────────────────────────────────────
function renderItemHtml(item) {
    const fotoHtml = item.fotoUrl
        ? `<img class="repo-item-foto" src="${item.fotoUrl}" alt="foto" loading="lazy"
               onclick="event.stopPropagation();window._repoVerFoto('${item.fotoUrl}')">`
        : `<div class="repo-item-foto-placeholder"><i class="bi bi-image"></i></div>`;

    const variacaoTag = item.variacao
        ? `<span class="repo-item-variacao-tag">${escHtml(item.variacao)}</span>` : '';

    const dataTag = item.criadoEm
        ? `<span class="repo-item-data"><i class="bi bi-calendar3"></i>${
            new Date(item.criadoEm).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})
          }</span>` : '';

    const checkIcon = item.comprado ? 'bi-check-circle-fill' : 'bi-circle';

    return `
    <div class="repo-item ${item.comprado ? 'repo-item--done' : ''}" data-id="${item.id}">
        <div class="repo-item-row" onclick="window._repoToggleExpand(this.closest('.repo-item'))">
            <div class="repo-item-foto-wrap">${fotoHtml}</div>
            <span class="repo-item-qtd-badge">${item.qtd}x</span>
            <div class="repo-item-info">
                <div class="repo-item-nome">${escHtml(item.nome)}</div>
                <div class="repo-item-sub">${variacaoTag}${dataTag}</div>
            </div>
            <i class="bi bi-chevron-down repo-item-chevron"></i>
        </div>
        <button class="repo-check-btn ${item.comprado ? 'checked' : ''}"
                onclick="event.stopPropagation(); window._repoToggle('${item.id}', ${item.comprado})">
            <i class="bi ${checkIcon}"></i>
        </button>
        <div class="repo-item-actions-panel">
            <button class="repo-edit-btn" onclick="window._repoEdit('${item.id}')" title="Editar">
                <i class="bi bi-pencil-fill"></i>
            </button>
            <button class="repo-del-btn" onclick="window._repoDel('${item.id}')" title="Remover">
                <i class="bi bi-trash3-fill"></i>
            </button>
        </div>
    </div>`;
}

// ── UI — Render Lista com Banners ────────────────────────────────
function renderList() {
    const list = getEl('repoList');
    if (!list) return;

    let items = allItems;
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        items = items.filter(i =>
            (i.nome     || '').toLowerCase().includes(q) ||
            (i.variacao || '').toLowerCase().includes(q)
        );
    }
    if (filterMode === 'pending') items = items.filter(i => !i.comprado);
    if (filterMode === 'done')    items = items.filter(i =>  i.comprado);

    if (items.length === 0) {
        const msg = searchQuery
            ? `Nenhum resultado para "<b>${escHtml(searchQuery)}</b>".`
            : filterMode === 'done'
                ? 'Nenhum item comprado ainda.'
                : 'Lista vazia! Toque em + para adicionar.';
        list.innerHTML = `<div class="repo-empty">
            <i class="bi bi-cart-x"></i><p>${msg}</p>
        </div>`;
        return;
    }

    const groups = {};
    CATEGORIES.forEach(c => { groups[c.key] = []; });
    items.forEach(item => {
        const cat = item.categoria && groups[item.categoria] !== undefined
            ? item.categoria : 'outros';
        groups[cat].push(item);
    });

    let html = '';
    CATEGORIES.forEach(cat => {
        const catItems = groups[cat.key];
        if (catItems.length === 0) return;

        const pending   = catItems.filter(i => !i.comprado).length;
        const collapsed = collapsedBanners[cat.key] ?? false;
        const badgeHtml = pending > 0
            ? `<span class="repo-banner-badge">${pending} pendente${pending > 1 ? 's' : ''}</span>`
            : '';

        html += `
        <div class="repo-banner ${collapsed ? 'repo-banner--collapsed' : ''}" data-cat="${cat.key}">
            <div class="repo-banner-header" onclick="window._repoBannerToggle('${cat.key}')">
                <div class="repo-banner-left">
                    <div class="repo-banner-icon" style="background:${cat.color}22;color:${cat.color}">
                        <i class="bi ${cat.icon}"></i>
                    </div>
                    <span class="repo-banner-label">${cat.label}</span>
                    ${badgeHtml}
                </div>
                <i class="bi bi-chevron-down repo-banner-chevron"></i>
            </div>
            <div class="repo-banner-items">
                ${catItems.map(renderItemHtml).join('')}
            </div>
        </div>`;
    });

    list.innerHTML = html;
}

function updateBadge() {
    const pending = allItems.filter(i => !i.comprado).length;
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

// ── Avatar Suggestions ──────────────────────────────────────────
function showAvatarSuggestions(query) {
    const wrap = getEl('repoAvatarSuggestions');
    if (!wrap) return;
    if (!query || query.length < 2) {
        wrap.classList.add('hidden');
        wrap.innerHTML = '';
        return;
    }
    const q = query.toLowerCase();
    const matches = Object.values(allAvatars)
        .filter(a => a.nome?.toLowerCase().includes(q))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, 5);

    if (matches.length === 0) {
        wrap.classList.add('hidden');
        wrap.innerHTML = '';
        return;
    }

    wrap.innerHTML = matches.map(a => {
        const nomeEsc = escHtml(a.nome);
        const urlEsc  = escHtml(a.fotoUrl);
        return `<button type="button" class="repo-avatar-suggestion"
            onclick="window._repoPickAvatar('${nomeEsc}','${urlEsc}')">
            <img src="${urlEsc}" alt="">
            <span>${nomeEsc}</span>
        </button>`;
    }).join('');
    wrap.classList.remove('hidden');
}

window._repoPickAvatar = (nome, fotoUrlPicked) => {
    getEl('repoInputNome').value = nome;
    photoUrl  = fotoUrlPicked;
    photoBlob = null;
    getEl('repoFotoImg').src = fotoUrlPicked;
    getEl('repoFotoPreview').classList.remove('hidden');
    getEl('repoAvatarSuggestions')?.classList.add('hidden');
    // Detecta categoria ao selecionar avatar também
    applyCategoryDetection(nome);
};

// ── Handlers Globais ─────────────────────────────────────────────
window._repoBannerToggle = (catKey) => {
    collapsedBanners[catKey] = !(collapsedBanners[catKey] ?? false);
    const banner = document.querySelector(`.repo-banner[data-cat="${catKey}"]`);
    if (banner) banner.classList.toggle('repo-banner--collapsed', collapsedBanners[catKey]);
};

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

// ── Setup dos Eventos ────────────────────────────────────────────
function setupEvents() {
    getEl('repoBtnNovo')?.addEventListener('click', () => openForm());

    getEl('repoFormClose')?.addEventListener('click', closeForm);
    getEl('repoFormOverlay')?.addEventListener('click', (e) => {
        if (e.target === getEl('repoFormOverlay')) closeForm();
    });

    // Busca rápida
    getEl('repoSearchInput')?.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim().toLowerCase();
        renderList();
    });

    // Nome: avatar suggestions + detecção de categoria
    let avatarDebounce;
    getEl('repoInputNome')?.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        // Detecção de categoria automática
        applyCategoryDetection(val);
        // Sugestões de avatar
        clearTimeout(avatarDebounce);
        avatarDebounce = setTimeout(() => showAvatarSuggestions(val), 200);
    });
    getEl('repoInputNome')?.addEventListener('blur', () => {
        setTimeout(() => getEl('repoAvatarSuggestions')?.classList.add('hidden'), 200);
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
        getEl('repoFotoPreview').classList.add('hidden');
        getEl('repoFotoImg').src = '';
    });

    // Salvar item
    getEl('repoBtnSalvar')?.addEventListener('click', async () => {
        const nome = getEl('repoInputNome').value.trim();
        if (!nome) { getEl('repoInputNome').focus(); return; }

        const qtd       = parseInt(getEl('repoInputQtd').value) || 1;
        const variacao  = getEl('repoInputVariacao').value.trim();
        const categoria = getEl('repoInputCategoria').value || 'outros';

        const btn = getEl('repoBtnSalvar');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

        try {
            let fotoFinal = photoUrl;
            if (photoBlob) fotoFinal = await uploadFoto(photoBlob);

            await saveItem({ nome, qtd, variacao, categoria, fotoUrl: fotoFinal });
            // Avatar salvo silenciosamente — não quebra o fluxo se falhar
            if (fotoFinal) saveAvatar(nome, fotoFinal);

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
            getEl('repoFotoImg').src = URL.createObjectURL(blob);
            getEl('repoFotoPreview').classList.remove('hidden');
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

export { startListener, stopListener };
