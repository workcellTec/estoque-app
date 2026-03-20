// favorites.js — favoritos (stories), transição, balões de notificação
// Depende de: window.showMainSection, window._currentNotifications, window.verBoletoDeNotificacao

// ============================================================
// Abre o boleto no histórico de contratos
window.verBoletoDeNotificacao = function(boletoId) {
    if (!boletoId) return;
    if (typeof window.showMainSection === 'function') {
        window.showMainSection('contract');
        setTimeout(() => {
            const toggle = document.getElementById('boletoModeToggle');
            if (toggle && !toggle.checked) {
                toggle.checked = true;
                toggle.dispatchEvent(new Event('change'));
            }
            setTimeout(() => {
                const btn = document.querySelector(`#heading-${boletoId} button`);
                if (btn) {
                    const targetId = btn.getAttribute('data-bs-target')?.substring(1);
                    const collapseEl = targetId ? document.getElementById(targetId) : null;
                    if (collapseEl && window.bootstrap) {
                        const bsCollapse = bootstrap.Collapse.getOrCreateInstance(collapseEl, { toggle: false });
                        bsCollapse.show();
                        collapseEl.addEventListener('shown.bs.collapse', () => {
                            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, { once: true });
                    }
                }
            }, 300);
        }, 150);
    }
};


// ⚡ TRANSIÇÃO + ⭐ FAVORITOS
// ============================================================

// Mostra overlay de transição, executa ação, depois esconde
function favTransition(emoji, label, action) {
    const overlay = document.getElementById('favTransitionOverlay');
    const emojiEl = document.getElementById('favTransitionEmoji');
    const labelEl = document.getElementById('favTransitionLabel');
    if (!overlay) { action(); return; }

    // Seta conteúdo
    if (emojiEl) emojiEl.textContent = emoji;
    if (labelEl) labelEl.textContent = label;

    // MOSTRAR: força display:flex + opacity via style (sem depender de animation CSS)
    overlay.style.display = 'flex';
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.15s ease';
    overlay.classList.remove('hidden', 'entering', 'leaving');

    // Força reflow para o browser registrar o estado opacity:0 antes de animar
    void overlay.offsetHeight;

    // Agora anima para opaco
    overlay.style.opacity = '1';

    // Após 200ms overlay está visível → executa navegação por baixo
    setTimeout(() => {
        action();
    }, 200);

    // Após 700ms total → fade out e esconde
    setTimeout(() => {
        overlay.style.opacity = '0';
        setTimeout(() => {
            overlay.style.display = 'none';
            overlay.classList.add('hidden');
            overlay.style.transition = '';
            overlay.style.opacity = '';
        }, 180);
    }, 700);
}

// Opções disponíveis para favoritar
const FAV_OPTIONS = [
    { id: 'calculadora',  emoji: '🧮', label: 'Abrindo Calculadora...',       action: () => window.showMainSection?.('calculator') },
    { id: 'fecharVenda',  emoji: '💰', label: 'Abrindo Fechar Venda...',      action: () => { window.showMainSection?.('calculator'); setTimeout(() => document.getElementById('openFecharVenda')?.click(), 300); } },
    { id: 'repassar',     emoji: '↔️', label: 'Abrindo Repassar Valores...', action: () => { window.showMainSection?.('calculator'); setTimeout(() => document.getElementById('openRepassarValores')?.click(), 300); } },
    { id: 'emprestar',    emoji: '🤝', label: 'Abrindo Emprestar Valores...', action: () => { window.showMainSection?.('calculator'); setTimeout(() => document.getElementById('openEmprestarValores')?.click(), 300); } },
    { id: 'emprestimo',   emoji: '🏦', label: 'Abrindo Calc. Empréstimo...', action: () => { window.showMainSection?.('calculator'); setTimeout(() => document.getElementById('openCalcularEmprestimo')?.click(), 300); } },
    { id: 'porAparelho',  emoji: '📱', label: 'Abrindo Calc. p/ Aparelho...', action: () => { window.showMainSection?.('calculator'); setTimeout(() => document.getElementById('openCalcularPorAparelho')?.click(), 300); } },
    { id: 'contrato',     emoji: '📋', label: 'Abrindo Contratos...',         action: () => { window.showMainSection?.('contract'); setTimeout(() => window.openDocumentsSection?.('contrato'), 300); } },
    { id: 'bookip',       emoji: '📒', label: 'Abrindo Bookip...',            action: () => { window.showMainSection?.('contract'); setTimeout(() => document.getElementById('openBookipView')?.click(), 300); } },
    { id: 'clientes',     emoji: '👥', label: 'Abrindo Clientes...',          action: () => window.showMainSection?.('clients') },
    { id: 'estoque',      emoji: '📦', label: 'Abrindo Estoque...',           action: () => {
        if (typeof window.showCustomModal === 'function') {
            window.showCustomModal({
                message: 'Digite a senha para acessar o Estoque:',
                showPassword: true,
                confirmText: 'Acessar',
                onConfirm: (pwd) => {
                    if (pwd === '220390') { window.showMainSection?.('stock'); }
                    else { window.showCustomModal({ message: '❌ Senha incorreta.' }); }
                },
                onCancel: () => {}
            });
        }
    } },
    { id: 'admin',        emoji: '⚙️', label: 'Abrindo Administração...',     action: () => window.showMainSection?.('administracao') },
    { id: 'consertos',    emoji: '🔧', label: 'Abrindo Consertos...',          action: () => window.showMainSection?.('repairs') },
    { id: 'reposicao',    emoji: '🛒', label: 'Abrindo Reposição...',          action: () => window.showMainSection?.('reposicao') },
];

const MAX_FAVS = 5;

// ── Favoritos: localStorage (cache) + Firebase (sync) ────────
function getFavKey(nome) {
    const p = nome || localStorage.getItem('ctwUserProfile') || 'default';
    return 'ctw_favs_' + p.toLowerCase().replace(/\s+/g, '_');
}

function getProfileIdForFav(nome) {
    const lista = window.teamProfilesList || {};
    for (const id in lista) {
        if ((lista[id].name || '').toLowerCase() === nome.toLowerCase()) return id;
    }
    try {
        const cache = JSON.parse(localStorage.getItem('cache_equipe_local') || '{}');
        for (const id in cache) {
            if ((cache[id].name || '').toLowerCase() === nome.toLowerCase()) return id;
        }
    } catch(e) {}
    return null;
}

// Lê favs: Firebase em memória (teamProfilesList) → localStorage
function getFavs() {
    const nome  = localStorage.getItem('ctwUserProfile') || '';
    const lista = window.teamProfilesList || {};
    for (const id in lista) {
        if ((lista[id].name || '').toLowerCase() === nome.toLowerCase()) {
            const fbFavs = lista[id].favorites;
            if (Array.isArray(fbFavs) && fbFavs.length > 0) {
                localStorage.setItem(getFavKey(nome), JSON.stringify(fbFavs));
                return fbFavs;
            }
            break;
        }
    }
    try { return JSON.parse(localStorage.getItem(getFavKey(nome)) || '[]'); } catch(e) { return []; }
}

function saveFavs(ids) {
    const nome   = localStorage.getItem('ctwUserProfile') || '';
    const profId = getProfileIdForFav(nome);

    // 1. localStorage
    localStorage.setItem(getFavKey(nome), JSON.stringify(ids));

    // 2. teamProfilesList em memória (getFavs acha imediatamente)
    if (profId && window.teamProfilesList && window.teamProfilesList[profId]) {
        window.teamProfilesList[profId].favorites = ids;
    }

    // 3. Firebase
    const _db     = window._firebaseDB;
    const _ref    = window._dbRef;
    const _update = window._dbUpdate;
    if (profId && _db && _ref && _update) {
        _update(_ref(_db, 'team_profiles/' + profId), { favorites: ids })
            .then(() => console.log('[Favs] ✅ Firebase salvo'))
            .catch(e => console.warn('[Favs] Firebase erro:', e.message));
    }
}

// Carrega favoritos do Firebase para o perfil atual
function loadFavsFromFirebase() {
    const nome  = localStorage.getItem('ctwUserProfile') || '';
    if (!nome) return;
    const lista = window.teamProfilesList || {};
    for (const id in lista) {
        if ((lista[id].name || '').toLowerCase() === nome.toLowerCase()) {
            const firebaseFavs = lista[id].favorites || null;
            if (firebaseFavs && Array.isArray(firebaseFavs)) {
                // Atualiza cache local e re-renderiza
                localStorage.setItem(getFavKey(), JSON.stringify(firebaseFavs));
                renderFavStories();
            }
            break;
        }
    }
}

function renderFavStories() {
    const wrap = document.getElementById('favStoriesWrap');
    if (!wrap) return;
    const favIds = getFavs();
    const mainMenu = document.getElementById('mainMenu');
    wrap.innerHTML = '';

    if (favIds.length === 0) {
        const s = document.createElement('div');
        s.className = 'fav-story fav-story-add';
        s.innerHTML = `<div class="fav-story-ring"><div class="fav-story-inner">＋</div></div><span class="fav-story-label">Adicionar</span>`;
        s.addEventListener('click', openFavModal);
        wrap.appendChild(s);
        mainMenu?.classList.remove('has-favorites');
        return;
    }

    mainMenu?.classList.add('has-favorites');

    favIds.forEach(id => {
        const opt = FAV_OPTIONS.find(o => o.id === id);
        if (!opt) return;
        const s = document.createElement('div');
        s.className = 'fav-story';
        s.innerHTML = `<div class="fav-story-ring"><div class="fav-story-inner">${opt.emoji}</div></div><span class="fav-story-label">${opt.label.replace('Abrindo ','').replace('...','')}</span>`;
        s.addEventListener('click', () => {
            // Animação no ring
            const ring = s.querySelector('.fav-story-ring');
            ring.style.transform = 'scale(0.88)';
            setTimeout(() => { ring.style.transform = ''; }, 160);
            // Transição com emoji e label
            setTimeout(() => favTransition(opt.emoji, opt.label, opt.action), 80);
        });
        wrap.appendChild(s);
    });
}

function openFavModal() {
    const overlay = document.getElementById('favModalOverlay');
    const grid = document.getElementById('favModalGrid');
    if (!overlay || !grid) return;

    // Estado local de ordenação (cópia mutável)
    window._favDraftOrder = [...getFavs()];

    renderFavModal(grid);
    overlay.classList.remove('hidden');
}

function renderFavModal(grid) {
    const order = window._favDraftOrder;
    grid.innerHTML = '';

    // --- SEÇÃO 1: ORDEM ATUAL ---
    if (order.length > 0) {
        const orderSection = document.createElement('div');
        orderSection.style.cssText = 'margin-bottom:16px;';
        orderSection.innerHTML = `<div style="font-size:0.7rem;color:var(--text-secondary);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;padding:0 2px;">⟺ Segure e arraste para reordenar</div>`;

        const chipWrap = document.createElement('div');
        chipWrap.id = 'fav-chip-wrap';
        chipWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:4px 2px 12px;';

        order.forEach((id, i) => {
            const opt = FAV_OPTIONS.find(o => o.id === id);
            if (!opt) return;
            const label = opt.label.replace('Abrindo ','').replace('...','');

            const chip = document.createElement('div');
            chip.className = 'fav-chip';
            chip.draggable = true;
            chip.dataset.id = id;
            chip.dataset.index = i;
            chip.style.cssText = `
                display:inline-flex;align-items:center;gap:6px;
                background:rgba(var(--primary-color-rgb),0.12);
                border:1px solid rgba(var(--primary-color-rgb),0.3);
                border-radius:20px;padding:6px 10px 6px 8px;
                cursor:grab;font-size:0.72rem;color:var(--text-color);
                font-weight:500;user-select:none;touch-action:none;
                transition:opacity 0.15s,transform 0.15s;
            `;
            chip.innerHTML = `
                <span style="font-size:0.95rem;line-height:1;">${opt.emoji}</span>
                <span>${label}</span>
                <span style="margin-left:2px;color:var(--text-secondary);font-size:0.7rem;cursor:pointer;" 
                    data-remove="${id}">✕</span>
            `;

            // Remove ao clicar no ✕
            chip.querySelector('[data-remove]').addEventListener('click', (e) => {
                e.stopPropagation();
                window._favDraftOrder = window._favDraftOrder.filter(x => x !== id);
                saveFavs(window._favDraftOrder);
                renderFavStories();
                renderFavModal(grid);
            });

            // Drag & Drop desktop
            chip.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', id);
                chip.style.opacity = '0.4';
                window._favDragId = id;
            });
            chip.addEventListener('dragend', () => {
                chip.style.opacity = '1';
                window._favDragId = null;
                document.querySelectorAll('.fav-chip').forEach(c => c.classList.remove('drag-over'));
            });
            chip.addEventListener('dragover', (e) => { e.preventDefault(); chip.classList.add('drag-over'); });
            chip.addEventListener('dragleave', () => chip.classList.remove('drag-over'));
            chip.addEventListener('drop', (e) => {
                e.preventDefault();
                chip.classList.remove('drag-over');
                const fromId = e.dataTransfer.getData('text/plain');
                const toId = id;
                if (fromId === toId) return;
                const arr = window._favDraftOrder;
                const fi = arr.indexOf(fromId), ti = arr.indexOf(toId);
                if (fi < 0 || ti < 0) return;
                arr.splice(fi, 1);
                arr.splice(ti, 0, fromId);
                saveFavs(window._favDraftOrder);
                renderFavStories();
                renderFavModal(grid);
            });

            // Touch drag para mobile
            let touchStartY, touchStartX, touchClone, touchIdx;
            chip.addEventListener('touchstart', (e) => {
                touchStartY = e.touches[0].clientY;
                touchStartX = e.touches[0].clientX;
                touchIdx = window._favDraftOrder.indexOf(id);
                chip.style.opacity = '0.5';
            }, { passive: true });

            chip.addEventListener('touchmove', (e) => {
                e.preventDefault();
                const t = e.touches[0];
                const el = document.elementFromPoint(t.clientX, t.clientY);
                const target = el?.closest('.fav-chip');
                document.querySelectorAll('.fav-chip').forEach(c => c.style.outline = '');
                if (target && target !== chip) target.style.outline = '2px solid var(--primary-color)';
            }, { passive: false });

            chip.addEventListener('touchend', (e) => {
                chip.style.opacity = '1';
                document.querySelectorAll('.fav-chip').forEach(c => c.style.outline = '');
                const t = e.changedTouches[0];
                const el = document.elementFromPoint(t.clientX, t.clientY);
                const target = el?.closest('.fav-chip[data-id]');
                if (target && target.dataset.id !== id) {
                    const arr = window._favDraftOrder;
                    const fi = arr.indexOf(id), ti = arr.indexOf(target.dataset.id);
                    if (fi >= 0 && ti >= 0) {
                        arr.splice(fi, 1);
                        arr.splice(ti, 0, id);
                        saveFavs(window._favDraftOrder);
                        renderFavStories();
                        renderFavModal(grid);
                    }
                }
            }, { passive: true });

            chipWrap.appendChild(chip);
        });

        orderSection.appendChild(chipWrap);
        grid.appendChild(orderSection);
    }

    // Separador
    const sep = document.createElement('div');
    sep.style.cssText = 'font-size:0.7rem;color:var(--text-secondary);letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;padding:0 2px;';
    sep.textContent = order.length > 0 ? '+ Adicionar' : 'Escolha até 5 favoritos';
    grid.appendChild(sep);

    // --- SEÇÃO 2: OPÇÕES ---
    const optGrid = document.createElement('div');
    optGrid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding-bottom:4px;';

    FAV_OPTIONS.forEach(opt => {
        const label = opt.label.replace('Abrindo ','').replace('...','');
        const isSelected = order.includes(opt.id);

        const el = document.createElement('div');
        el.className = 'fav-option' + (isSelected ? ' selected' : '');
        el.dataset.id = opt.id;
        el.innerHTML = `<div class="fav-option-icon">${opt.emoji}</div><div class="fav-option-label">${label}</div>`;

        el.addEventListener('click', () => {
            const arr = window._favDraftOrder;
            if (arr.includes(opt.id)) {
                window._favDraftOrder = arr.filter(x => x !== opt.id);
            } else {
                if (arr.length >= MAX_FAVS) return; // já cheio
                window._favDraftOrder.push(opt.id);
            }
            saveFavs(window._favDraftOrder);
            renderFavStories();
            renderFavModal(grid);
        });

        optGrid.appendChild(el);
    });

    grid.appendChild(optGrid);
}

function closeFavModal() {
    const overlay = document.getElementById('favModalOverlay');
    if (!overlay) return;
    window._favDraftOrder = null;
    overlay.classList.add('hidden');
}

function initFavoritos() {
    document.getElementById('favEditBtn')?.addEventListener('click', openFavModal);
    document.getElementById('favModalClose')?.addEventListener('click', () => closeFavModal());
    // save button removed — auto-save on selection
    document.getElementById('favModalOverlay')?.addEventListener('click', e => {
        if (e.target.id === 'favModalOverlay') closeFavModal();
    });
    renderFavStories();
}

// Ao trocar perfil: renderiza os favs do novo perfil (getFavs lê Firebase em memória)
const _origSetProfileFav = window.setProfile;
if (typeof window.setProfile === 'function') {
    window.setProfile = function(nome) {
        _origSetProfileFav(nome);
        setTimeout(renderFavStories, 350);
    };
}

// Carrega favs para um perfil específico (chamado ao logar)
window._loadFavsForProfile = function(nome) {
    const lista = window.teamProfilesList || {};
    for (const id in lista) {
        if ((lista[id].name || '').toLowerCase() === nome.toLowerCase()) {
            const firebaseFavs = lista[id].favorites || null;
            if (firebaseFavs && Array.isArray(firebaseFavs) && firebaseFavs.length > 0) {
                // Firebase tem dados — usa e atualiza cache local
                localStorage.setItem(getFavKey(), JSON.stringify(firebaseFavs));
                renderFavStories();
            } else {
                // Firebase não tem favs — migra do localStorage para Firebase
                const localFavs = getFavs();
                if (localFavs.length > 0) {
                    console.log('📤 Migrando favoritos locais para Firebase:', localFavs);
                    saveFavs(localFavs); // saveFavs agora salva no Firebase também
                }
                renderFavStories();
            }
            return;
        }
    }
    // teamProfilesList ainda vazio — tenta de novo em 1s
    setTimeout(function() { window._loadFavsForProfile && window._loadFavsForProfile(nome); }, 1000);
};

// Quando Firebase retorna novos dados de perfil, recarrega os favs
window._onFavsFirebaseUpdate = function() {
    const nome = localStorage.getItem('ctwUserProfile') || '';
    if (nome) window._loadFavsForProfile(nome);
};

// Módulo carrega após DOM pronto — chama diretamente
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initFavoritos, 300));
} else {
    setTimeout(initFavoritos, 300);
}

// ============================================================
// Favorites CSS (injetado via JS para garantir que está presente)
// ============================================================
(function injectFavCSS() {
    if (document.getElementById('fav-css')) return;
    const style = document.createElement('style');
    style.id = 'fav-css';
    style.textContent = `.fav-section{width:100%;margin-bottom:18px}.fav-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:0 2px}.fav-title{font-size:.75rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-secondary)}.fav-edit-btn{background:none;border:none;color:var(--text-secondary);font-size:.75rem;cursor:pointer;padding:4px 8px;border-radius:8px;transition:color .2s,background .2s}.fav-edit-btn:hover{color:var(--primary-color);background:rgba(var(--primary-color-rgb),.1)}.fav-stories-wrap{display:flex;gap:14px;overflow-x:auto;padding:4px 2px 8px;scrollbar-width:none;-webkit-overflow-scrolling:touch}.fav-stories-wrap::-webkit-scrollbar{display:none}.fav-story{display:flex;flex-direction:column;align-items:center;gap:5px;cursor:pointer;flex-shrink:0;-webkit-tap-highlight-color:transparent;animation:fav-pop .3s ease backwards}.fav-story:nth-child(1){animation-delay:.05s}.fav-story:nth-child(2){animation-delay:.1s}.fav-story:nth-child(3){animation-delay:.15s}.fav-story:nth-child(4){animation-delay:.2s}.fav-story:nth-child(5){animation-delay:.25s}@keyframes fav-pop{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:scale(1)}}.fav-story-ring{width:62px;height:62px;border-radius:50%;padding:2.5px;background:linear-gradient(135deg,var(--primary-color),#8b5cf6,#00e5ff);transition:transform .18s ease,filter .18s ease}.fav-story:active .fav-story-ring{transform:scale(.9);filter:brightness(1.15)}.fav-story-inner{width:100%;height:100%;border-radius:50%;background:var(--tertiary-color);border:2.5px solid var(--tertiary-color);display:flex;align-items:center;justify-content:center;font-size:1.55rem;position:relative;overflow:hidden}.fav-story-inner::after{content:'';position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle at 35% 35%,rgba(255,255,255,.15),transparent 60%)}.fav-story-label{font-size:.6rem;font-weight:500;color:var(--text-secondary);text-align:center;max-width:62px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fav-story-add .fav-story-ring{background:var(--glass-bg);border:1.5px dashed var(--glass-border);padding:0}.fav-story-add .fav-story-inner{background:transparent;border:none;color:var(--text-secondary);font-size:1.3rem}.fav-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(8px);z-index:9000;display:flex;align-items:flex-end;justify-content:center;animation:fav-overlay-in .2s ease}.fav-modal-overlay.hidden{display:none}@keyframes fav-overlay-in{from{opacity:0}to{opacity:1}}.fav-modal{background:var(--glass-bg);backdrop-filter:blur(20px);border:1px solid var(--glass-border);border-radius:24px 24px 0 0;padding:0;width:100%;max-width:520px;height:82vh;max-height:82vh;display:flex;flex-direction:column;overflow:hidden;animation:fav-modal-up .28s cubic-bezier(.34,1.56,.64,1)}@keyframes fav-modal-up{from{transform:translateY(100%)}to{transform:translateY(0)}}.fav-modal-header{display:flex;align-items:center;justify-content:space-between;font-weight:600;font-size:1rem;color:var(--text-color-strong);flex-shrink:0;padding:20px 20px 16px}.fav-modal-close{background:rgba(255,255,255,.08);border:none;border-radius:50%;width:32px;height:32px;color:var(--text-color);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s}.fav-modal-close:hover{background:rgba(255,255,255,.15)}.fav-modal-grid{overflow-y:auto;flex:1;min-height:0;padding:0 20px 16px;-webkit-overflow-scrolling:touch}.fav-option{display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;padding:10px 4px;border-radius:14px;border:1.5px solid transparent;transition:border-color .2s,background .2s,transform .15s;background:rgba(255,255,255,.03);-webkit-tap-highlight-color:transparent}.fav-option:active{transform:scale(.94)}.fav-option.selected{border-color:var(--primary-color);background:rgba(var(--primary-color-rgb),.12)}.fav-option-icon{font-size:1.5rem;line-height:1}.fav-option-label{font-size:.58rem;text-align:center;color:var(--text-secondary);line-height:1.3;font-weight:500}.fav-option.selected .fav-option-label{color:var(--primary-color)}.fav-modal-save{width:100%;padding:18px;border:none;border-radius:0;background:var(--primary-color);color:#fff;font-weight:700;font-size:.95rem;cursor:pointer;letter-spacing:.5px;transition:opacity .2s;flex-shrink:0}.fav-modal-save:active{opacity:.85}.has-favorites .btn-menu{padding:14px 20px;font-size:.9rem}.fav-chip.drag-over{outline:2px solid var(--primary-color);opacity:0.8;transform:scale(1.04)}`;
    document.head.appendChild(style);
})();




// ============================================================
// 🎈 BALÕES DE NOTIFICAÇÃO — lado direito, empilhados
// ============================================================

window.toggleNotifBalloons = function() {
    const existing = document.getElementById('notif-balloons-container');
    if (existing) {
        closeBalloons(existing);
        return;
    }

    const notifs = window._currentNotifications || [];
    if (!notifs.length) return;

    // Container fixo no lado direito
    const container = document.createElement('div');
    container.id = 'notif-balloons-container';
    container.style.cssText = `
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        z-index: 8999;
        pointer-events: none;
    `;
    document.body.appendChild(container);

    // Overlay escuro sutil para fechar ao clicar fora
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: absolute;
        inset: 0;
        pointer-events: all;
        background: rgba(0,0,0,0.25);
        backdrop-filter: blur(2px);
        animation: notif-overlay-in 0.2s ease;
    `;
    overlay.addEventListener('click', () => closeBalloons(container));
    container.appendChild(overlay);

    // Injeta keyframes se não existir
    if (!document.getElementById('notif-balloon-styles')) {
        const s = document.createElement('style');
        s.id = 'notif-balloon-styles';
        s.textContent = `
            @keyframes notif-overlay-in { from{opacity:0} to{opacity:1} }
            @keyframes notif-slide-in {
                from { opacity:0; transform: translateX(120px) scale(0.85); }
                to   { opacity:1; transform: translateX(0)     scale(1); }
            }
            @keyframes notif-slide-out {
                from { opacity:1; transform: translateX(0) scale(1); }
                to   { opacity:0; transform: translateX(80px) scale(0.9); }
            }
        `;
        document.head.appendChild(s);
    }

    // Painel lateral direito
    const panel = document.createElement('div');
    panel.id = 'notif-balloons-panel';
    panel.style.cssText = `
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
    `;
    container.appendChild(panel);

    // Cria um card por notificação com delay escalonado
    notifs.forEach((notif, idx) => {
        setTimeout(() => {
            const card = createNotifCard(notif, idx);
            panel.appendChild(card);
        }, idx * 100);
    });
};

// Modal centralizado para mensagens longas
function _abrirModalMensagemCompleta(texto, icon, accentH, accentRGB) {
    // Remove modal anterior se existir
    const old = document.getElementById('notif-full-modal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'notif-full-modal';
    modal.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 99999;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        background: rgba(0,0,0,0.7);
        backdrop-filter: blur(4px);
        animation: notif-overlay-in 0.2s ease;
        padding: 0;
    `;

    modal.innerHTML = `
        <div style="
            width: 100%;
            max-width: 480px;
            background: #0d1526;
            border: 1px solid rgba(${accentRGB},0.3);
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
                    background:rgba(${accentRGB},0.12);
                    border:1px solid rgba(${accentRGB},0.25);
                    display:flex;align-items:center;justify-content:center;
                    font-size:1.2rem;
                ">${icon}</div>
                <span style="
                    font-family:'Poppins',sans-serif;
                    font-size:0.85rem;font-weight:700;
                    color:rgba(255,255,255,0.95);flex:1;
                ">📢 Mensagem Completa</span>
                <button id="notif-full-modal-close" style="
                    background:none;border:none;
                    color:rgba(255,255,255,0.4);
                    font-size:1.1rem;cursor:pointer;padding:4px;
                    line-height:1;
                ">✕</button>
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
                ">${texto}</p>
            </div>
        </div>
    `;

    // Injeta keyframe do sheet se não existir
    if (!document.getElementById('notif-sheet-style')) {
        const s = document.createElement('style');
        s.id = 'notif-sheet-style';
        s.textContent = `@keyframes notif-sheet-up {
            from { transform: translateY(100%); opacity:0; }
            to   { transform: translateY(0);    opacity:1; }
        }`;
        document.head.appendChild(s);
    }

    document.body.appendChild(modal);

    const fechar = () => {
        modal.style.transition = 'opacity 0.2s';
        modal.style.opacity = '0';
        setTimeout(() => modal.remove(), 200);
    };

    modal.querySelector('#notif-full-modal-close').addEventListener('click', (e) => {
        e.stopPropagation();
        fechar();
    });

    // Toque no fundo fecha
    modal.addEventListener('click', (e) => {
        if (e.target === modal) fechar();
    });
}

function closeBalloons(container) {
    const overlay = container.querySelector('div');
    if (overlay) {
        overlay.style.transition = 'opacity 0.2s';
        overlay.style.opacity = '0';
    }

    const cards = container.querySelectorAll('.notif-card');
    cards.forEach((c, i) => {
        setTimeout(() => {
            c.style.animation = 'notif-slide-out 0.22s ease forwards';
        }, i * 50);
    });

    setTimeout(() => container.remove(), cards.length * 50 + 280);
}

function createNotifCard(notif, idx) {
    // Texto puro
    const tmp = document.createElement('div');
    tmp.innerHTML = notif.message || '';
    const texto = tmp.textContent.trim();

    // Tipo → ícone, cor, ação
    let icon, accentH, accentRGB, actionPrimary, actionSecondary;

    if (notif.isBirthday) {
        icon = '🎂';
        accentH = '#ff6d00';
        accentRGB = '255,109,0';
        actionPrimary = notif.clienteTel
            ? { label: '💬 Mandar parabéns no WhatsApp', fn: () => abrirWhatsApp(notif.clienteTel, `Olá ${notif.clienteNome || ''}! 🎂 Feliz aniversário! Desejamos tudo de bom pra você nesse dia especial! 🎉`) }
            : null;
    } else if (!notif.isGeneral) {
        icon = '💳';
        accentH = '#ef4444';
        accentRGB = '239,68,68';
        actionPrimary = notif.clienteTel
            ? { label: '💬 WhatsApp do cliente', fn: () => abrirWhatsApp(notif.clienteTel) }
            : null;
        actionSecondary = notif.boletoId
            ? { label: '📋 Ver contrato', fn: () => { if(typeof verBoletoDeNotificacao === 'function') verBoletoDeNotificacao(notif.boletoId); } }
            : null;
    } else {
        icon = '📢';
        accentH = '#00e5ff';
        accentRGB = '0,229,255';
        actionPrimary = null;
    }

    const card = document.createElement('div');
    card.className = 'notif-card';
    card.style.cssText = `
        pointer-events: all;
        background: rgba(8, 14, 28, 0.96);
        border: 1px solid rgba(${accentRGB}, 0.35);
        border-left: 3px solid ${accentH};
        border-radius: 14px;
        padding: 14px 14px 12px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(${accentRGB},0.1);
        animation: notif-slide-in 0.35s cubic-bezier(0.34,1.56,0.64,1) ${idx * 0.08}s both;
        cursor: default;
        position: relative;
        overflow: hidden;
    `;

    // Glow sutil no fundo
    const isLong = texto.length > 160;
    card.innerHTML = `
        <div style="position:absolute;inset:0;border-radius:14px;background:radial-gradient(ellipse at top right,rgba(${accentRGB},0.07),transparent 65%);pointer-events:none;"></div>

        <div style="display:flex;align-items:flex-start;gap:10px;position:relative;">
            <!-- Ícone -->
            <div style="
                width:38px;height:38px;border-radius:10px;
                background:rgba(${accentRGB},0.12);
                border:1px solid rgba(${accentRGB},0.25);
                display:flex;align-items:center;justify-content:center;
                font-size:1.25rem;flex-shrink:0;
            ">${icon}</div>

            <!-- Conteúdo -->
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
                    margin-bottom:${isLong ? '6px' : (actionPrimary || actionSecondary ? '10px' : '0')};
                ">${texto}</div>

                ${isLong ? `<button class="notif-vermais-btn" data-action="vermais" style="
                    background:none;border:none;padding:0;
                    color:rgba(${accentRGB},0.9);
                    font-size:0.67rem;font-weight:700;
                    font-family:'Poppins',sans-serif;cursor:pointer;
                    margin-bottom:${actionPrimary || actionSecondary ? '8px' : '0'};
                    letter-spacing:.3px;">Ver mensagem completa ↗</button>` : ''}

                ${actionPrimary || actionSecondary ? `
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    ${actionPrimary ? `
                    <button class="notif-action-btn" data-action="primary" style="
                        flex:1;min-width:0;
                        background:rgba(${accentRGB},0.15);
                        border:1px solid rgba(${accentRGB},0.35);
                        border-radius:8px;
                        color:${accentH};
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
                    ">${actionPrimary.label}</button>
                    ` : ''}
                    ${actionSecondary ? `
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
                    ">${actionSecondary.label}</button>
                    ` : ''}
                </div>
                ` : ''}
            </div>

            <!-- Fechar -->
            <button onclick="event.stopPropagation();window.dismissNotifBalloon('${notif.notificationId}',this.closest('.notif-card'))" style="
                background:none;border:none;
                color:rgba(255,255,255,0.3);
                cursor:pointer;padding:2px;
                font-size:0.8rem;flex-shrink:0;
                line-height:1;
                transition:color 0.15s;
            ">✕</button>
        </div>
    `;

    // Wira botão "Ver mensagem completa"
    if (isLong) {
        card.querySelector('[data-action="vermais"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            _abrirModalMensagemCompleta(texto, icon, accentH, accentRGB);
        });
    }

    // Wira os botões de ação
    if (actionPrimary) {
        card.querySelector('[data-action="primary"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            actionPrimary.fn();
            const c = document.getElementById('notif-balloons-container');
            if (c) closeBalloons(c);
        });
    }
    if (actionSecondary) {
        card.querySelector('[data-action="secondary"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            actionSecondary.fn();
            const c = document.getElementById('notif-balloons-container');
            if (c) closeBalloons(c);
        });
    }

    return card;
}

function abrirWhatsApp(tel, mensagem) {
    const t = (tel || '').replace(/\D/g, '');
    if (!t) return;
    const url = mensagem
        ? `https://wa.me/55${t}?text=${encodeURIComponent(mensagem)}`
        : `https://wa.me/55${t}`;
    window.open(url, '_blank');
}

window.dismissNotifBalloon = function(notifId, cardEl) {
    const key = 'ctwDismissedNotifs';
    let list = [];
    try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) {}
    if (!list.includes(notifId)) { list.push(notifId); localStorage.setItem(key, JSON.stringify(list)); }

    if (cardEl) {
        cardEl.style.animation = 'notif-slide-out 0.2s ease forwards';
        setTimeout(() => cardEl.remove(), 220);
    }
};

// ESC fecha tudo
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        const c = document.getElementById('notif-balloons-container');
        if (c) closeBalloons(c);
    }
});
