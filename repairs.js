// repairs.js — Gerenciamento de Consertos
// Depende de: window._firebaseDB, window.currentUserProfile, window.showCustomModal

import { ref, push, update, remove, onValue, off }
    from "https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js";

// ============================================================
// CONSTANTES
// ============================================================
const REPAIRS_PATH      = 'manutencao';
const CLOUDINARY_CLOUD  = 'dmvynrze6';
const CLOUDINARY_PRESET = 'g8rdi3om';
const CLOUDINARY_URL    = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`;

// Status do workflow
const STATUS = {
    LOJA_SEM_ANALISE: 'loja_sem_analise',   // Levar ao técnico
    EM_REPARO:        'em_reparo',           // Em reparo
    LOJA_REPARADO:    'loja_reparado',       // Finalizado Loja
    FINALIZADO:       'finalizado',          // Entregue ao cliente
};

const STATUS_LABEL = {
    [STATUS.LOJA_SEM_ANALISE]: '🔴 Levar ao Técnico',
    [STATUS.EM_REPARO]:        '🟡 Em Reparo',
    [STATUS.LOJA_REPARADO]:    '🔵 Finalizado Loja',
    [STATUS.FINALIZADO]:       '🟢 Entregue!',
};

const STATUS_COLOR = {
    [STATUS.LOJA_SEM_ANALISE]: 'var(--rep-red)',
    [STATUS.EM_REPARO]:        'var(--rep-yellow)',
    [STATUS.LOJA_REPARADO]:    'var(--rep-blue)',
    [STATUS.FINALIZADO]:       'var(--rep-green)',
};

// Mapa de status anterior (para o undo)
const PREV_STATUS = {
    [STATUS.EM_REPARO]:     STATUS.LOJA_SEM_ANALISE,
    [STATUS.LOJA_REPARADO]: STATUS.EM_REPARO,
    [STATUS.FINALIZADO]:    STATUS.LOJA_REPARADO,
};
// Chave da timeline que deve ser removida ao desfazer
const PREV_TL_KEY = {
    [STATUS.EM_REPARO]:     'em_reparo',
    [STATUS.LOJA_REPARADO]: 'loja_reparado',
    [STATUS.FINALIZADO]:    'finalizado',
};

// ============================================================
// STATE
// ============================================================
let db;
let repairsListener = null;
let allRepairs = [];
let activeFilter = 'all';
let repairPhotoBlob = null;
let repairPhotoUrl  = '';
let stepPhotoBlob   = null;
let stepPhotoUrl    = '';

// ============================================================
// HELPERS
// ============================================================
function getDb() {
    if (db) return db;
    db = window._firebaseDB;
    return db;
}

function getUser() {
    return window.currentUserProfile || localStorage.getItem('ctwUserProfile') || 'Desconhecido';
}

function tsNow() { return Date.now(); }

function formatDate(isoOrTs) {
    if (!isoOrTs) return '—';
    const d = typeof isoOrTs === 'number' ? new Date(isoOrTs) : new Date(isoOrTs);
    return d.toLocaleDateString('pt-BR');
}

function formatDateTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function diasDesde(ts) {
    if (!ts) return 0;
    return Math.floor((Date.now() - ts) / 86400000);
}

// Retorna horas até o prazo (negativo = vencido)
function horasAte(isoDate, horaMaxima) {
    if (!isoDate) return null;
    const hora = horaMaxima || '23:59';
    const prazo = new Date(isoDate + 'T' + hora + ':00');
    return (prazo - Date.now()) / 3600000;
}

function prazoStatus(repair) {
    if (repair.status === STATUS.FINALIZADO) return 'ok';
    const horas = horasAte(repair.dataMaxima, repair.horaMaxima);
    if (horas === null) return 'ok';
    if (horas < 0)  return 'vencido';
    if (horas <= 8) return 'proximo';   // < 8 horas = próximo
    return 'ok';
}

async function comprimirFoto(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const MAX = 1920, Q = 0.88;
            let w = img.width, h = img.height;
            if (w > MAX || h > MAX) {
                const r = Math.min(MAX / w, MAX / h);
                w = Math.round(w * r); h = Math.round(h * r);
            }
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            c.toBlob(b => b ? resolve(b) : reject(new Error('Compressão falhou')), 'image/webp', Q);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida')); };
        img.src = url;
    });
}

async function uploadFoto(blob) {
    if (!blob) return '';
    const fd = new FormData();
    fd.append('file', blob, 'reparo.webp');
    fd.append('upload_preset', CLOUDINARY_PRESET);
    fd.append('folder', 'consertos_fotos');
    try {
        const r = await fetch(CLOUDINARY_URL, { method: 'POST', body: fd });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        return data.secure_url || '';
    } catch(e) {
        console.warn('Upload falhou:', e);
        return '';
    }
}

function showToast(msg) {
    if (typeof window.showCustomModal === 'function') {
        window.showCustomModal({ message: msg }); return;
    }
    alert(msg);
}

function whatsappLink(tel) {
    const t = (tel || '').replace(/\D/g, '');
    return t ? `https://wa.me/55${t}` : null;
}

// ============================================================
// FIREBASE CRUD
// ============================================================
async function saveRepair(data) {
    const d = getDb();
    if (data.id) {
        const { id, ...payload } = data;
        await update(ref(d, `${REPAIRS_PATH}/${id}`), payload);
        return id;
    } else {
        const r = await push(ref(d, REPAIRS_PATH), data);
        return r.key;
    }
}

async function deleteRepair(id) {
    await remove(ref(getDb(), `${REPAIRS_PATH}/${id}`));
}

function listenRepairs(callback) {
    if (repairsListener) off(ref(getDb(), REPAIRS_PATH), 'value', repairsListener);
    repairsListener = onValue(ref(getDb(), REPAIRS_PATH), snap => {
        const items = [];
        if (snap.exists()) {
            snap.forEach(c => { items.push({ id: c.key, ...c.val() }); });
        }
        allRepairs = items;
        callback(items);
        checkDeadlineAlerts(items);
        autoDeleteOldRecords(items);
    });
}

function stopListenRepairs() {
    if (repairsListener) {
        off(ref(getDb(), REPAIRS_PATH), 'value', repairsListener);
        repairsListener = null;
    }
}

async function autoDeleteOldRecords(items) {
    const UM_ANO = 365 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const item of items) {
        if (item.status !== STATUS.FINALIZADO) continue;
        const tsFinalizacao = item.timeline?.finalizado?.ts;
        if (!tsFinalizacao) continue;
        if ((now - tsFinalizacao) >= UM_ANO) {
            await deleteRepair(item.id);
        }
    }
}

// ============================================================
// ALERTAS DE PRAZO
// ============================================================
function checkDeadlineAlerts(items) {
    const notifs = [];
    items.forEach(item => {
        if (item.status === STATUS.FINALIZADO) return;
        const ps = prazoStatus(item);
        if (ps === 'ok') return;
        const horas = horasAte(item.dataMaxima, item.horaMaxima);
        let msg;
        if (ps === 'vencido') {
            const atrasoH = Math.abs(Math.round(horas));
            msg = `⚠️ PRAZO VENCIDO: <b>${item.nomeCliente}</b> (${item.descricaoDefeito}) — ${atrasoH}h em atraso`;
        } else {
            const restH = Math.ceil(horas);
            msg = `🕐 Prazo próximo: <b>${item.nomeCliente}</b> (${item.descricaoDefeito}) — ${restH}h restantes`;
        }
        notifs.push({
            notificationId: `repair_deadline_${item.id}`,
            message: msg,
            isGeneral: false,
            repairId: item.id,
        });
    });
    const existing = (window._currentNotifications || []).filter(n => !n.notificationId?.startsWith('repair_deadline_'));
    if (typeof window.updateNotificationUI === 'function') {
        window.updateNotificationUI([...existing, ...notifs]);
    }
}

// ============================================================
// FILTROS
// ============================================================
function getFiltered(filter) {
    switch(filter) {
        case 'levar_tecnico':     return allRepairs.filter(r => r.status === STATUS.LOJA_SEM_ANALISE);
        case 'em_reparo':         return allRepairs.filter(r => r.status === STATUS.EM_REPARO);
        case 'finalizados_loja':  return allRepairs.filter(r => r.status === STATUS.LOJA_REPARADO);
        case 'proximo':           return allRepairs.filter(r => prazoStatus(r) === 'proximo');
        case 'tempo_esgotado':    return allRepairs.filter(r => prazoStatus(r) === 'vencido');
        case 'entregue':          return allRepairs.filter(r => r.status === STATUS.FINALIZADO);
        default:                  return [...allRepairs];
    }
}

// ============================================================
// SWIPE GESTURE (estilo Gmail)
// ← arrastar esquerda  = avançar etapa (pede foto)
// → arrastar direita   = desfazer etapa (pede confirmação)
// ============================================================
function attachSwipeToCard(card, repId) {
    const header = card.querySelector('.rep-card-header');
    if (!header) return;

    const THRESHOLD    = 72;   // px mínimos para disparar a ação
    const CANCEL_VERT  = 18;   // px vertical antes de cancelar swipe
    const MAX_DRAG     = 110;  // px máximos de deslocamento visual

    let startX = 0, startY = 0;
    let dragging = false, cancelled = false;
    let rafId = null;

    // Elementos de hint que surgem atrás do header durante o swipe
    let hintEl = null;

    function getHint() {
        if (hintEl) return hintEl;
        hintEl = document.createElement('div');
        hintEl.className = 'rep-swipe-hint';
        card.insertBefore(hintEl, header);
        return hintEl;
    }

    function reset(animate) {
        dragging = false;
        cancelled = false;
        if (rafId) cancelAnimationFrame(rafId);
        if (animate) {
            header.style.transition = 'transform .25s cubic-bezier(.25,.8,.25,1)';
        }
        header.style.transform = '';
        header.style.borderRadius = '';
        const hint = card.querySelector('.rep-swipe-hint');
        if (hint) { hint.style.opacity = '0'; hint.textContent = ''; hint.className = 'rep-swipe-hint'; }
        setTimeout(() => { header.style.transition = ''; }, 260);
    }

    header.addEventListener('touchstart', e => {
        // Não interfere se o card está expandido (body visível) — swipe só no collapsed
        const body = card.querySelector('.rep-card-body');
        const isCollapsed = body.classList.contains('rep-collapsed');
        if (!isCollapsed) return;

        startX    = e.touches[0].clientX;
        startY    = e.touches[0].clientY;
        dragging  = true;
        cancelled = false;
    }, { passive: true });

    header.addEventListener('touchmove', e => {
        if (!dragging || cancelled) return;

        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;

        // Cancela se movimento vertical maior que horizontal
        if (Math.abs(dy) > CANCEL_VERT && Math.abs(dy) > Math.abs(dx)) {
            cancelled = true;
            reset(true);
            return;
        }

        // Só processa se horizontal dominante
        if (Math.abs(dx) < 6) return;
        e.preventDefault();

        const repair    = allRepairs.find(r => r.id === repId);
        if (!repair) return;

        const canNext   = !!buildNextBtn(repair);
        const canUndo   = !!PREV_STATUS[repair.status];

        // Limita o drag e aplica resistência perto do limite
        let clamped = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, dx));
        if ((dx < 0 && !canNext) || (dx > 0 && !canUndo)) {
            clamped = dx * 0.12; // resistência elástica se ação não disponível
        }

        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
            header.style.transition = 'none';
            header.style.transform  = `translateX(${clamped}px)`;

            const hint      = getHint();
            const pct       = Math.abs(clamped) / THRESHOLD;
            const activated = Math.abs(clamped) >= THRESHOLD;

            if (dx < -8 && canNext) {
                // Arrastar pra esquerda = AVANÇAR
                hint.className  = `rep-swipe-hint rep-swipe-hint-next ${activated ? 'activated' : ''}`;
                hint.innerHTML  = activated ? '📸 Avançar!' : `<i class="bi bi-arrow-right-circle-fill"></i> Avançar`;
                hint.style.opacity = Math.min(1, pct).toFixed(2);
                hint.style.right = '0'; hint.style.left = 'auto';
            } else if (dx > 8 && canUndo) {
                // Arrastar pra direita = DESFAZER
                hint.className  = `rep-swipe-hint rep-swipe-hint-undo ${activated ? 'activated' : ''}`;
                hint.innerHTML  = activated ? '↩️ Desfazer!' : `<i class="bi bi-arrow-counterclockwise"></i> Desfazer`;
                hint.style.opacity = Math.min(1, pct).toFixed(2);
                hint.style.left = '0'; hint.style.right = 'auto';
            } else {
                hint.style.opacity = '0';
            }
        });
    }, { passive: false });

    header.addEventListener('touchend', e => {
        if (!dragging || cancelled) { dragging = false; return; }
        const dx     = e.changedTouches[0].clientX - startX;
        const repair = allRepairs.find(r => r.id === repId);
        reset(true);
        if (!repair) return;

        if (dx < -THRESHOLD && buildNextBtn(repair)) {
            // Swipe left confirmado → avança
            const map = {
                [STATUS.LOJA_SEM_ANALISE]: [STATUS.EM_REPARO,     '📸 Foto: Entrega ao Técnico',    'Registrar entrega ao técnico'],
                [STATUS.EM_REPARO]:        [STATUS.LOJA_REPARADO, '📸 Foto: Devolução pelo Técnico', 'Confirmar retorno à loja'],
                [STATUS.LOJA_REPARADO]:    [STATUS.FINALIZADO,    '📸 Foto: Entrega ao Cliente',    'Confirmar entrega ao cliente'],
            };
            const info = map[repair.status];
            if (info) openStepModal(repair, info[0], info[1], info[2]);
        } else if (dx > THRESHOLD && PREV_STATUS[repair.status]) {
            // Swipe right confirmado → desfaz (com confirmação)
            confirmUndo(repair);
        }
    }, { passive: true });

    header.addEventListener('touchcancel', () => reset(true), { passive: true });
}

// ============================================================
// RENDER
// ============================================================
function render(items) {
    renderStats(items);
    renderList(getFiltered(activeFilter));
}

function renderStats(items) {
    const levarTecnico   = items.filter(r => r.status === STATUS.LOJA_SEM_ANALISE).length;
    const emReparo       = items.filter(r => r.status === STATUS.EM_REPARO).length;
    const tempoEsgotado  = items.filter(r => prazoStatus(r) === 'vencido').length;
    const proximos       = items.filter(r => prazoStatus(r) === 'proximo').length;
    const finaisLoja     = items.filter(r => r.status === STATUS.LOJA_REPARADO).length;

    const s = id => document.getElementById(id);
    if (s('repStat_preparacao')) s('repStat_preparacao').textContent = levarTecnico;
    if (s('repStat_reparo'))     s('repStat_reparo').textContent     = emReparo;
    if (s('repStat_atrasados'))  s('repStat_atrasados').textContent  = tempoEsgotado;
    if (s('repStat_proximos'))   s('repStat_proximos').textContent   = proximos;
    if (s('repStat_finais'))     s('repStat_finais').textContent     = finaisLoja;
}

function renderList(items) {
    const container = document.getElementById('repairsList');
    if (!container) return;

    if (items.length === 0) {
        container.innerHTML = `
            <div class="rep-empty">
                <div style="font-size:2.5rem;margin-bottom:10px;">🔧</div>
                <div style="font-weight:600;margin-bottom:4px;">Nenhum conserto aqui</div>
                <div style="font-size:.8rem;opacity:.6;">Cadastre um novo aparelho para começar</div>
            </div>`;
        return;
    }

    // Vencidos primeiro, depois próximos, depois por data
    items.sort((a, b) => {
        const pa = prazoStatus(a), pb = prazoStatus(b);
        const order = { vencido: 0, proximo: 1, ok: 2 };
        if (order[pa] !== order[pb]) return order[pa] - order[pb];
        return (b.tsCadastro || 0) - (a.tsCadastro || 0);
    });

    container.innerHTML = items.map(r => buildCard(r)).join('');

    container.querySelectorAll('[data-rep-action]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            handleAction(btn.dataset.repAction, btn.dataset.repId);
        });
    });
    container.querySelectorAll('[data-rep-whatsapp]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const link = whatsappLink(btn.dataset.repWhatsapp);
            if (link) window.open(link, '_blank');
        });
    });
    container.querySelectorAll('.rep-card-header').forEach(h => {
        h.addEventListener('click', () => {
            const body = h.closest('.rep-card').querySelector('.rep-card-body');
            body.classList.toggle('rep-collapsed');
            h.querySelector('.rep-chevron').classList.toggle('rep-chevron-open');
        });
    });

    // Swipe estilo Gmail: ← avança etapa | → desfaz etapa
    container.querySelectorAll('.rep-card').forEach(card => {
        const repId = card.querySelector('[data-rep-id]')?.dataset.repId;
        if (repId) attachSwipeToCard(card, repId);
    });
}

function buildCard(r) {
    const ps        = prazoStatus(r);
    const horas     = horasAte(r.dataMaxima, r.horaMaxima);
    const vencido   = ps === 'vencido';
    const proximo   = ps === 'proximo';
    const finaliz   = r.status === STATUS.FINALIZADO;

    let prazoLabel = '';
    if (!finaliz && r.dataMaxima) {
        if (vencido) {
            const h = Math.abs(Math.round(horas));
            prazoLabel = `<span class="rep-badge rep-badge-danger">⚠️ ${h}h em atraso</span>`;
        } else if (proximo) {
            const h = Math.ceil(horas);
            prazoLabel = `<span class="rep-badge rep-badge-warn">⏰ ${h}h restantes</span>`;
        } else if (horas !== null) {
            const d = Math.floor(horas / 24);
            prazoLabel = `<span class="rep-badge rep-badge-ok">📅 ${d}d restantes</span>`;
        }
    }

    let diasNoStatus = '';
    if (r.status === STATUS.EM_REPARO && r.timeline?.em_reparo?.ts) {
        const d = diasDesde(r.timeline.em_reparo.ts);
        diasNoStatus = `<span class="rep-badge rep-badge-info">🕒 ${d}d com técnico</span>`;
    }

    const nextBtn   = buildNextBtn(r);
    const thumb     = r.fotoUrl
        ? `<img src="${r.fotoUrl}" class="rep-thumb" alt="foto" onclick="window._repAbrirFoto('${r.fotoUrl}')">`
        : `<div class="rep-thumb-placeholder"><i class="bi bi-phone"></i></div>`;
    const timelineHtml = buildTimeline(r);

    // Horário de entrega formatado
    const prazoFormatado = r.dataMaxima
        ? formatDate(r.dataMaxima) + (r.horaMaxima ? ' às ' + r.horaMaxima : '')
        : null;

    return `
    <div class="rep-card ${vencido ? 'rep-card-vencido' : proximo ? 'rep-card-proximo' : finaliz ? 'rep-card-finalizado' : ''}">
        <div class="rep-card-header">
            <div class="rep-card-header-left">
                ${thumb}
                <div class="rep-card-info">
                    <div class="rep-card-name">${escHtml(r.nomeCliente)}</div>
                    <div class="rep-card-defect">${escHtml(r.descricaoDefeito)}</div>
                    <div class="rep-card-badges">
                        <span class="rep-status-pill" style="background:${STATUS_COLOR[r.status]}22;color:${STATUS_COLOR[r.status]};border:1px solid ${STATUS_COLOR[r.status]}44;">${STATUS_LABEL[r.status]}</span>
                        ${prazoLabel}
                        ${diasNoStatus}
                    </div>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
                ${r.numeroCliente ? `<button class="rep-icon-btn rep-wpp" data-rep-whatsapp="${escHtml(r.numeroCliente)}" title="WhatsApp"><i class="bi bi-whatsapp"></i></button>` : ''}
                <i class="bi bi-chevron-down rep-chevron"></i>
            </div>
        </div>
        <div class="rep-card-body rep-collapsed">
            <div class="rep-card-meta">
                <span><i class="bi bi-calendar3"></i> Cadastro: ${formatDate(r.tsCadastro)}</span>
                ${prazoFormatado ? `<span><i class="bi bi-flag-fill"></i> Entrega: ${prazoFormatado}</span>` : ''}
                ${r.valorCobrado ? `<span><i class="bi bi-cash-coin"></i> R$ ${Number(r.valorCobrado).toFixed(2).replace('.',',')}</span>` : ''}
                <span><i class="bi bi-person-fill"></i> ${escHtml(r.criadoPor || '—')}</span>
            </div>
            ${timelineHtml}
            <div class="rep-card-actions">
                ${nextBtn}
                ${buildUndoBtn(r)}
                <button class="rep-btn rep-btn-ghost rep-btn-sm" data-rep-action="edit" data-rep-id="${r.id}"><i class="bi bi-pencil-fill"></i> Editar</button>
                <button class="rep-btn rep-btn-danger rep-btn-sm" data-rep-action="delete" data-rep-id="${r.id}"><i class="bi bi-trash-fill"></i></button>
            </div>
        </div>
    </div>`;
}

function buildNextBtn(r) {
    const map = {
        [STATUS.LOJA_SEM_ANALISE]: { action: 'to_em_reparo',    icon: 'bi-arrow-right-circle-fill', label: 'Entregar ao Técnico', color: 'rep-btn-yellow' },
        [STATUS.EM_REPARO]:        { action: 'to_loja_reparado', icon: 'bi-check-circle-fill',       label: 'Retornou p/ Loja',    color: 'rep-btn-blue'  },
        [STATUS.LOJA_REPARADO]:    { action: 'to_finalizado',    icon: 'bi-bag-check-fill',          label: 'Entregar ao Cliente', color: 'rep-btn-green' },
    };
    const info = map[r.status];
    if (!info) return '';
    return `<button class="rep-btn ${info.color}" data-rep-action="${info.action}" data-rep-id="${r.id}">
        <i class="bi ${info.icon}"></i> ${info.label}
    </button>`;
}

function buildUndoBtn(r) {
    if (!PREV_STATUS[r.status]) return '';
    return `<button class="rep-btn rep-btn-undo rep-btn-sm" data-rep-action="undo_step" data-rep-id="${r.id}">
        <i class="bi bi-arrow-counterclockwise"></i> Desfazer etapa
    </button>`;
}

function buildTimeline(r) {
    if (!r.timeline) return '';
    const steps = [
        { key: 'cadastro',      icon: '📋', label: 'Cadastrado' },
        { key: 'em_reparo',     icon: '🔧', label: 'Entregue ao Técnico' },
        { key: 'loja_reparado', icon: '📦', label: 'Retornou à Loja' },
        { key: 'finalizado',    icon: '✅', label: 'Entregue ao Cliente' },
    ];
    const items = steps.filter(s => r.timeline[s.key]).map(s => {
        const ev   = r.timeline[s.key];
        const foto = ev.fotoUrl ? `<a href="${ev.fotoUrl}" target="_blank" class="rep-tl-photo"><i class="bi bi-image-fill"></i> Ver foto</a>` : '';
        return `<div class="rep-tl-item">
            <span class="rep-tl-dot">${s.icon}</span>
            <div class="rep-tl-content">
                <div class="rep-tl-label">${s.label}</div>
                <div class="rep-tl-meta">${formatDateTime(ev.ts)} · ${escHtml(ev.user || '—')} ${foto}</div>
            </div>
        </div>`;
    }).join('');
    return items ? `<div class="rep-timeline">${items}</div>` : '';
}

function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
// ACTIONS
// ============================================================
async function handleAction(action, id) {
    const repair = allRepairs.find(r => r.id === id);
    if (!repair && action !== 'new') return;
    switch(action) {
        case 'edit':             openRepairForm(repair); break;
        case 'delete':           confirmDelete(id); break;
        case 'undo_step':        confirmUndo(repair); break;
        case 'to_em_reparo':     openStepModal(repair, STATUS.EM_REPARO,     '📸 Foto: Entrega ao Técnico',    'Registrar entrega ao técnico'); break;
        case 'to_loja_reparado': openStepModal(repair, STATUS.LOJA_REPARADO, '📸 Foto: Devolução pelo Técnico', 'Confirmar retorno à loja');     break;
        case 'to_finalizado':    openStepModal(repair, STATUS.FINALIZADO,    '📸 Foto: Entrega ao Cliente',    'Confirmar entrega ao cliente'); break;
    }
}

function confirmUndo(repair) {
    if (!repair || !PREV_STATUS[repair.status]) return;
    const overlay = document.getElementById('repUndoOverlay');
    const msgEl   = document.getElementById('repUndoMsg');
    const btnYes  = document.getElementById('repUndoYes');
    const btnNo   = document.getElementById('repUndoNo');
    if (!overlay) return;

    const labelAtual    = STATUS_LABEL[repair.status];
    const labelAnterior = STATUS_LABEL[PREV_STATUS[repair.status]];
    const corAtual      = STATUS_COLOR[repair.status];

    msgEl.innerHTML = `
        <strong>${escHtml(repair.nomeCliente)}</strong><br>
        <span style="font-size:.8rem;opacity:.7;">${escHtml(repair.descricaoDefeito)}</span>
        <div style="margin-top:12px;padding:10px 12px;background:rgba(255,255,255,.04);border-radius:8px;font-size:.83rem;line-height:1.8;">
            Status atual: <span style="color:${corAtual};font-weight:600;">${labelAtual}</span><br>
            Voltará para: <span style="font-weight:600;">${labelAnterior}</span><br>
            <span style="opacity:.55;font-size:.75rem;">A foto e o registro desta etapa serão removidos.</span>
        </div>`;

    overlay.classList.add('active');
    const cleanup = () => overlay.classList.remove('active');
    btnNo.onclick  = cleanup;
    btnYes.onclick = async () => { cleanup(); await executeUndo(repair); };
}

async function executeUndo(repair) {
    const prevStatus = PREV_STATUS[repair.status];
    const tlKey      = PREV_TL_KEY[repair.status];
    if (!prevStatus || !tlKey) return;
    try {
        const newTimeline = { ...repair.timeline };
        delete newTimeline[tlKey];
        await saveRepair({ ...repair, status: prevStatus, timeline: newTimeline });
        showToast(`↩️ Voltou para: ${STATUS_LABEL[prevStatus]}`);
    } catch(e) {
        showToast('❌ Erro ao desfazer: ' + e.message);
    }
}

function confirmDelete(id) {
    const repair = allRepairs.find(r => r.id === id);
    if (!repair) return;
    const overlay = document.getElementById('repConfirmOverlay');
    const msg     = document.getElementById('repConfirmMsg');
    const btnYes  = document.getElementById('repConfirmYes');
    const btnNo   = document.getElementById('repConfirmNo');
    if (!overlay) return;
    msg.textContent = `Excluir conserto de "${repair.nomeCliente}"? Esta ação não pode ser desfeita.`;
    overlay.classList.add('active');
    const cleanup = () => overlay.classList.remove('active');
    btnNo.onclick  = cleanup;
    btnYes.onclick = async () => { cleanup(); await deleteRepair(id); showToast('Conserto excluído.'); };
}

// ============================================================
// FORMULÁRIO DE CADASTRO / EDIÇÃO
// ============================================================
function openRepairForm(repair = null) {
    repairPhotoBlob = null;
    repairPhotoUrl  = repair?.fotoUrl || '';

    const overlay  = document.getElementById('repFormOverlay');
    const title    = document.getElementById('repFormTitle');
    const idInput  = document.getElementById('repFormId');
    const nome     = document.getElementById('repFormNome');
    const tel      = document.getElementById('repFormTel');
    const defeito  = document.getElementById('repFormDefeito');
    const prazo    = document.getElementById('repFormPrazo');
    const hora     = document.getElementById('repFormHora');
    const imgEl    = document.getElementById('repFormPhotoImg');
    const preview  = document.getElementById('repFormPhotoPreview');
    const lbl      = document.getElementById('repFormPhotoBtnLabel');
    const ph       = document.getElementById('repFormPhotoPlaceholder');

    if (!overlay || !title) return;

    title.textContent  = repair ? 'Editar Conserto' : 'Novo Conserto';
    idInput.value      = repair?.id || '';
    nome.value         = repair?.nomeCliente || '';
    tel.value          = repair?.numeroCliente || '';
    defeito.value      = repair?.descricaoDefeito || '';
    prazo.value        = repair?.dataMaxima || '';
    if (hora) hora.value = repair?.horaMaxima || '';
    const valorEl = document.getElementById('repFormValor');
    if (valorEl) valorEl.value = repair?.valorCobrado || '';

    if (repairPhotoUrl && imgEl && preview) {
        imgEl.src = repairPhotoUrl;
        preview.style.display = 'block';
        if (ph) ph.style.display = 'none';
        if (lbl) lbl.textContent = 'Substituir foto';
    } else {
        if (preview) preview.style.display = 'none';
        if (ph) ph.style.display = 'flex';
        if (lbl) lbl.textContent = 'Galeria';
    }

    overlay.classList.add('active');
    nome.focus();
}

function closeRepairForm() {
    document.getElementById('repFormOverlay')?.classList.remove('active');
    repairPhotoBlob = null;
    repairPhotoUrl  = '';
}

async function submitRepairForm() {
    const id      = document.getElementById('repFormId').value;
    const nome    = document.getElementById('repFormNome').value.trim();
    const tel     = document.getElementById('repFormTel').value.trim();
    const defeito = document.getElementById('repFormDefeito').value.trim();
    const prazo   = document.getElementById('repFormPrazo').value;
    const hora    = document.getElementById('repFormHora')?.value || null;
    const valor   = parseFloat(document.getElementById('repFormValor')?.value) || null;

    if (!nome || !defeito) {
        showToast('⚠️ Nome do cliente e defeito são obrigatórios.'); return;
    }

    const btn = document.getElementById('repFormSaveBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Salvando...'; }

    try {
        if (repairPhotoBlob) repairPhotoUrl = await uploadFoto(repairPhotoBlob);
        const existing = id ? allRepairs.find(r => r.id === id) : null;
        const data = {
            nomeCliente:      nome,
            numeroCliente:    tel,
            descricaoDefeito: defeito,
            dataMaxima:       prazo || null,
            horaMaxima:       hora || null,
            valorCobrado:     valor,
            fotoUrl:          repairPhotoUrl || null,
            status:           existing?.status || STATUS.LOJA_SEM_ANALISE,
            tsCadastro:       existing?.tsCadastro || tsNow(),
            criadoPor:        existing?.criadoPor || getUser(),
            timeline:         existing?.timeline || { cadastro: { ts: tsNow(), user: getUser() } },
        };
        if (id) data.id = id;
        await saveRepair(data);
        closeRepairForm();
        showToast(id ? '✅ Conserto atualizado!' : '✅ Conserto cadastrado!');
    } catch(e) {
        showToast('❌ Erro ao salvar: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-lg"></i> Salvar'; }
    }
}

// ============================================================
// MODAL DE ETAPA (mudança de status)
// ============================================================
let _stepRepair    = null;
let _stepNewStatus = null;

function openStepModal(repair, newStatus, photoTitle, btnLabel) {
    _stepRepair    = repair;
    _stepNewStatus = newStatus;
    stepPhotoBlob  = null;
    stepPhotoUrl   = '';

    const overlay = document.getElementById('repStepOverlay');
    const titleEl = document.getElementById('repStepTitle');
    const btnSave = document.getElementById('repStepSaveBtn');
    const preview = document.getElementById('repStepPhotoPreview');
    const imgEl   = document.getElementById('repStepPhotoImg');
    const notice  = document.getElementById('repStepPhotoNotice');

    titleEl.textContent  = photoTitle;
    btnSave.textContent  = btnLabel;
    btnSave.disabled     = true;
    if (preview) preview.style.display = 'none';
    if (notice)  notice.style.display  = 'block';
    if (imgEl)   imgEl.src = '';

    overlay.classList.add('active');
}

function closeStepModal() {
    document.getElementById('repStepOverlay')?.classList.remove('active');
    _stepRepair    = null;
    _stepNewStatus = null;
    stepPhotoBlob  = null;
    stepPhotoUrl   = '';
}

async function submitStepModal() {
    if (!_stepRepair || !_stepNewStatus) return;
    if (!stepPhotoBlob && !stepPhotoUrl) {
        showToast('⚠️ A foto é obrigatória para avançar o status.'); return;
    }
    const btn = document.getElementById('repStepSaveBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Salvando...'; }
    try {
        if (stepPhotoBlob) stepPhotoUrl = await uploadFoto(stepPhotoBlob);
        const tlKey = _stepNewStatus;
        const update_data = {
            ..._stepRepair,
            status: _stepNewStatus,
            timeline: {
                ..._stepRepair.timeline,
                [tlKey]: { ts: tsNow(), user: getUser(), fotoUrl: stepPhotoUrl || null },
            },
        };
        await saveRepair(update_data);
        closeStepModal();
        showToast('✅ Status atualizado!');
    } catch(e) {
        showToast('❌ Erro: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = 'Confirmar'; }
    }
}

// ============================================================
// PHOTO HANDLERS
// ============================================================
function initPhotoInput(inputId, previewId, imgId, lblId, onBlobReady) {
    const input   = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    const imgEl   = document.getElementById(imgId);
    const lbl     = document.getElementById(lblId);
    if (!input) return;
    input.addEventListener('change', async e => {
        const file = e.target.files[0];
        input.value = '';
        if (!file) return;
        try {
            const blob = await comprimirFoto(file);
            const url  = URL.createObjectURL(blob);
            if (imgEl)   imgEl.src = url;
            if (preview) preview.style.display = 'block';
            if (lbl)     lbl.textContent = 'Substituir foto';
            onBlobReady(blob);
        } catch(err) {
            showToast('❌ Erro ao processar imagem.');
        }
    });
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================
export function initRepairs() {
    if (!window._firebaseDB) {
        setTimeout(initRepairs, 500);
        return;
    }
    db = window._firebaseDB;
    wireFormEvents();
    wireStepEvents();
    wireUndoEvents();
    wireFilterBtns();
    wireSearchInput();
    listenRepairs(items => render(items));
}

export function destroyRepairs() { stopListenRepairs(); }

function wireFormEvents() {
    document.getElementById('repNewBtn')?.addEventListener('click', () => openRepairForm());
    document.getElementById('repFormClose')?.addEventListener('click',  closeRepairForm);
    document.getElementById('repFormCancel')?.addEventListener('click', closeRepairForm);
    document.getElementById('repFormOverlay')?.addEventListener('click', e => {
        if (e.target === document.getElementById('repFormOverlay')) closeRepairForm();
    });
    document.getElementById('repFormSaveBtn')?.addEventListener('click', submitRepairForm);

    initPhotoInput('repFormPhotoInputCamera',  'repFormPhotoPreview', 'repFormPhotoImg', 'repFormPhotoBtnLabel', b => {
        repairPhotoBlob = b;
        document.getElementById('repFormPhotoPlaceholder')?.style && (document.getElementById('repFormPhotoPlaceholder').style.display = 'none');
    });
    initPhotoInput('repFormPhotoInputGallery', 'repFormPhotoPreview', 'repFormPhotoImg', 'repFormPhotoBtnLabel', b => {
        repairPhotoBlob = b;
        document.getElementById('repFormPhotoPlaceholder')?.style && (document.getElementById('repFormPhotoPlaceholder').style.display = 'none');
    });
    document.getElementById('repFormPhotoBtnCamera')?.addEventListener('click', () => document.getElementById('repFormPhotoInputCamera')?.click());
    document.getElementById('repFormPhotoBtnGallery')?.addEventListener('click', () => document.getElementById('repFormPhotoInputGallery')?.click());
    document.getElementById('repFormPhotoRemove')?.addEventListener('click', () => {
        repairPhotoBlob = null; repairPhotoUrl = '';
        const preview = document.getElementById('repFormPhotoPreview');
        const imgEl   = document.getElementById('repFormPhotoImg');
        const lbl     = document.getElementById('repFormPhotoBtnLabel');
        const ph      = document.getElementById('repFormPhotoPlaceholder');
        if (preview) preview.style.display = 'none';
        if (imgEl)   imgEl.src = '';
        if (lbl)     lbl.textContent = 'Galeria';
        if (ph)      ph.style.display = 'flex';
    });
}

function wireStepEvents() {
    document.getElementById('repStepClose')?.addEventListener('click',   closeStepModal);
    document.getElementById('repStepCancel')?.addEventListener('click',  closeStepModal);
    document.getElementById('repStepSaveBtn')?.addEventListener('click', submitStepModal);
    document.getElementById('repStepOverlay')?.addEventListener('click', e => {
        if (e.target === document.getElementById('repStepOverlay')) closeStepModal();
    });
    initPhotoInput('repStepPhotoInputCamera',  'repStepPhotoPreview', 'repStepPhotoImg', 'repStepPhotoBtnLabel', b => {
        stepPhotoBlob = b;
        const btn = document.getElementById('repStepSaveBtn');
        const notice = document.getElementById('repStepPhotoNotice');
        if (btn) btn.disabled = false;
        if (notice) notice.style.display = 'none';
    });
    initPhotoInput('repStepPhotoInputGallery', 'repStepPhotoPreview', 'repStepPhotoImg', 'repStepPhotoBtnLabel', b => {
        stepPhotoBlob = b;
        const btn = document.getElementById('repStepSaveBtn');
        const notice = document.getElementById('repStepPhotoNotice');
        if (btn) btn.disabled = false;
        if (notice) notice.style.display = 'none';
    });
    document.getElementById('repStepPhotoBtnCamera')?.addEventListener('click',  () => document.getElementById('repStepPhotoInputCamera')?.click());
    document.getElementById('repStepPhotoBtnGallery')?.addEventListener('click', () => document.getElementById('repStepPhotoInputGallery')?.click());
}

function wireUndoEvents() {
    document.getElementById('repUndoOverlay')?.addEventListener('click', e => {
        if (e.target === document.getElementById('repUndoOverlay'))
            document.getElementById('repUndoOverlay').classList.remove('active');
    });
    // btnYes e btnNo são wired dinamicamente em confirmUndo()
}

function wireFilterBtns() {
    document.querySelectorAll('[data-rep-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            activeFilter = btn.dataset.repFilter;
            document.querySelectorAll('[data-rep-filter]').forEach(b => b.classList.remove('rep-filter-active'));
            btn.classList.add('rep-filter-active');
            renderList(getFiltered(activeFilter));
        });
    });
}

function wireSearchInput() {
    const input = document.getElementById('repSearchInput');
    if (!input) return;
    input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        if (!q) { renderList(getFiltered(activeFilter)); return; }
        const filtered = getFiltered(activeFilter).filter(r =>
            r.nomeCliente?.toLowerCase().includes(q) ||
            r.descricaoDefeito?.toLowerCase().includes(q) ||
            r.numeroCliente?.includes(q)
        );
        renderList(filtered);
    });
}

// Auto-init
(function() {
    function selfInit() {
        var rc = document.getElementById('repairsContainer');
        if (!rc) return;
        var isVisible = rc.style.display !== 'none' && !rc.classList.contains('hidden');
        if (isVisible && !window._repairsInited) {
            window._repairsInited = true;
            initRepairs();
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', selfInit);
    } else {
        setTimeout(selfInit, 100);
    }
})();

// Keyboard-aware modal
(function() {
    var overlayIds = ['repFormOverlay', 'repStepOverlay', 'repConfirmOverlay'];
    function adjust() {
        var vv = window.visualViewport;
        if (!vv) return;
        var kbHeight = window.innerHeight - (vv.offsetTop + vv.height);
        if (kbHeight < 0) kbHeight = 0;
        overlayIds.forEach(function(id) {
            var el = document.getElementById(id);
            if (el && el.classList.contains('active')) {
                el.style.transform  = kbHeight > 0 ? 'translateY(-' + kbHeight + 'px)' : '';
                el.style.transition = 'transform 0.15s ease';
            }
        });
    }
    function reset() {
        overlayIds.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) { el.style.transform = ''; el.style.transition = 'transform 0.15s ease'; }
        });
    }
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', adjust);
        window.visualViewport.addEventListener('scroll', adjust);
    }
    document.addEventListener('focusout', function() {
        setTimeout(function() {
            var active = document.activeElement;
            var inModal = active && (
                active.closest('#repFormOverlay') ||
                active.closest('#repStepOverlay') ||
                active.closest('#repConfirmOverlay')
            );
            if (!inModal) reset();
        }, 200);
    });
})();

// Abrir foto em overlay
window._repAbrirFoto = function(url) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.95);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
    ov.innerHTML = `<img src="${url}" style="max-width:95vw;max-height:90vh;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.8);">`;
    ov.addEventListener('click', () => ov.remove());
    document.body.appendChild(ov);
};
