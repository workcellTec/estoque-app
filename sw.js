   GERENCIAMENTO DE CONSERTOS — CSS
   ============================================================ */

:root {
    --rep-red:    #ef4444;
    --rep-yellow: #f59e0b;
    --rep-blue:   #3b82f6;
    --rep-green:  #10b981;
    --rep-teal:   #06b6d4;
    --rep-orange: #f97316;
}

/* Container principal */
#repairsContainer {
    flex-direction: column;
    padding: 16px;
    padding-bottom: 100px;
    max-width: 100% !important;
    margin: 0 !important;
    width: 100%;
    overflow-x: hidden; /* previne vazamento lateral */
    align-items: stretch !important;
}

/* Filters: wrap to avoid overflow-x:hidden conflict with parent */
#repairsContainer .rep-filters {
    flex-wrap: wrap;
    overflow-x: visible;
}


/* ── Stats bar ── */
.rep-stats-bar {
    display: grid;
    grid-template-columns: repeat(4, 1fr) 1.3fr;
    gap: 6px;
    margin-bottom: 16px;
    width: 100%;
}
.rep-stat {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 14px;
    padding: 10px 4px;
    text-align: center;
    backdrop-filter: blur(5px);
    min-width: 0;        /* permite shrink no grid */
    overflow: hidden;
}
/* Bloco urgente unificado */
.rep-stat-urgente {
    padding: 8px 6px;
    transition: border-color .3s, background .3s;
}
.rep-stat-urgente-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    line-height: 1;
    margin-bottom: 3px;
}
.rep-stat-urgente-num {
    font-size: 1.15rem;
    font-weight: 800;
    font-family: 'Poppins', sans-serif;
}
.rep-urgente-red    { color: #ef4444; }
.rep-urgente-orange { color: #fb923c; }
.rep-stat-urgente-sep {
    font-size: .7rem;
    color: var(--text-secondary);
    font-weight: 600;
    opacity: .5;
}
.rep-stat-num {
    display: block;
    font-size: 1.3rem;
    font-weight: 800;
    line-height: 1;
    font-family: 'Poppins', sans-serif;
}
.rep-stat-lbl {
    font-size: .52rem;
    font-weight: 500;
    opacity: .65;
    display: block;
    margin-top: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0 2px;
}
.rep-stat-yellow .rep-stat-num { color: var(--rep-yellow); }
.rep-stat-red    .rep-stat-num { color: var(--rep-red);    }
.rep-stat-orange .rep-stat-num { color: #fb923c;           }
.rep-stat-green  .rep-stat-num { color: var(--rep-green);  }
.rep-stat-gray   .rep-stat-num { color: var(--text-secondary); }

/* ── Toolbar ── */
.rep-toolbar {
    display: flex;
    gap: 10px;
    margin-bottom: 12px;
    align-items: center;
}
.rep-search-wrap {
    flex: 1;
    position: relative;
}
.rep-search-icon {
    position: absolute;
    left: 12px; top: 50%;
    transform: translateY(-50%);
    color: var(--text-secondary);
    font-size: .9rem;
}
.rep-search-input {
    width: 100%;
    background: var(--input-bg);
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    padding: 10px 12px 10px 36px;
    color: var(--text-color);
    font-size: .85rem;
    outline: none;
    transition: border-color .2s;
}
.rep-search-input:focus { border-color: var(--primary-color); }

/* ── Filters ── */
.rep-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding-bottom: 4px;
    margin-bottom: 16px;
}
.rep-filter-btn {
    flex-shrink: 0;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 999px;
    padding: 6px 14px;
    font-size: .72rem;
    font-weight: 600;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all .18s;
    white-space: nowrap;
    -webkit-tap-highlight-color: transparent;
}
.rep-filter-btn.rep-filter-active,
.rep-filter-btn:hover {
    background: rgba(var(--primary-color-rgb), .12);
    border-color: var(--primary-color);
    color: var(--primary-color);
}

/* ── Card ── */
.rep-list { display: flex; flex-direction: column; gap: 12px; }

.rep-card {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 18px;
    overflow: hidden;
    backdrop-filter: blur(5px);
    transition: box-shadow .2s;
}
.rep-card-vencido  { border-color: rgba(239,68,68,.4);   background: rgba(239,68,68,.05); }
.rep-card-proximo  { border-color: rgba(245,158,11,.35); background: rgba(245,158,11,.04); }
.rep-card-finalizado { opacity: .72; }

.rep-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 14px 14px 12px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.rep-card-header-left {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
}
.rep-thumb {
    width: 50px; height: 50px;
    border-radius: 12px;
    object-fit: cover;
    flex-shrink: 0;
    border: 1px solid var(--glass-border);
    cursor: zoom-in;
}
.rep-thumb-placeholder {
    width: 50px; height: 50px;
    border-radius: 12px;
    background: rgba(var(--primary-color-rgb),.08);
    border: 1px solid var(--glass-border);
    display: flex; align-items: center; justify-content: center;
    font-size: 1.3rem;
    color: var(--text-secondary);
    flex-shrink: 0;
}
.rep-card-info { flex: 1; min-width: 0; }
.rep-card-name {
    font-weight: 700;
    font-size: .9rem;
    color: var(--text-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.rep-card-defect {
    font-size: .75rem;
    color: var(--text-secondary);
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.rep-card-model {
    font-size: .72rem;
    color: var(--primary-color);
    opacity: .8;
    margin-top: 1px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.rep-card-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 6px;
}

/* ── Header badges (compacto) ── */
.rep-header-badges {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
}

/* Status dot — bolinha colorida minimalista */
.rep-status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    display: inline-block;
}

/* Body top: defeito + status pill — chip gradiente */
.rep-body-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 11px 14px;
    margin-bottom: 10px;
    border-radius: 12px;
    background: linear-gradient(135deg, rgba(var(--primary-color-rgb),.08) 0%, rgba(var(--primary-color-rgb),.02) 100%);
    border: 1px solid rgba(var(--primary-color-rgb),.18);
    position: relative;
    overflow: hidden;
}
.rep-body-top::before {
    content: '';
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 3px;
    background: var(--primary-color);
    border-radius: 3px 0 0 3px;
}
.rep-card-defect-full {
    font-size: .95rem;
    color: var(--text-color);
    font-weight: 700;
    flex: 1;
    min-width: 0;
    line-height: 1.4;
    padding-left: 4px;
}

/* Ações secundárias (ícones pequenos) */
.rep-card-actions-secondary {
    display: flex;
    gap: 6px;
    margin-left: auto;
    align-items: center;
}

/* Status pill */
.rep-status-pill {
    font-size: .62rem;
    font-weight: 800;
    padding: 4px 10px;
    border-radius: 8px;
    white-space: nowrap;
    letter-spacing: .02em;
    text-transform: uppercase;
}

/* Badges */
.rep-badge {
    font-size: .58rem;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 999px;
    white-space: nowrap;
}
.rep-badge-danger { background: rgba(239,68,68,.15);   color: #ef4444; border: 1px solid rgba(239,68,68,.3); }
.rep-badge-warn   { background: rgba(245,158,11,.15);  color: #f59e0b; border: 1px solid rgba(245,158,11,.3); }
.rep-badge-ok     { background: rgba(16,185,129,.12);  color: #10b981; border: 1px solid rgba(16,185,129,.25); }
.rep-badge-info   { background: rgba(59,130,246,.12);  color: #3b82f6; border: 1px solid rgba(59,130,246,.25); }

/* Chevron */
.rep-chevron { transition: transform .22s; color: var(--text-secondary); font-size: .85rem; }
.rep-chevron-open { transform: rotate(-180deg); }

/* Card body */
.rep-card-body { padding: 0 14px 14px; }
.rep-collapsed { display: none; }

.rep-card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    font-size: .7rem;
    color: var(--text-secondary);
    margin-bottom: 12px;
    padding-top: 4px;
    border-top: 1px solid var(--glass-border);
}
.rep-card-meta span { display: flex; align-items: center; gap: 4px; }

/* Card actions */
.rep-card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
}

/* ── Timeline ── */
.rep-timeline {
    display: flex;
    flex-direction: column;
    gap: 0;
    margin: 10px 0;
    padding-left: 4px;
    border-left: 2px solid rgba(var(--primary-color-rgb),.2);
}
.rep-tl-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 6px 0 6px 12px;
    position: relative;
}
.rep-tl-item::before {
    content: '';
    position: absolute;
    left: -5px; top: 50%;
    transform: translateY(-50%);
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--primary-color);
}
.rep-tl-dot { font-size: .95rem; flex-shrink: 0; }
.rep-tl-label { font-size: .75rem; font-weight: 700; color: var(--text-color); }
.rep-tl-meta  { font-size: .65rem; color: var(--text-secondary); margin-top: 1px; }
.rep-tl-photo {
    color: var(--primary-color);
    text-decoration: none;
    margin-left: 6px;
    font-size: .65rem;
    font-weight: 600;
}

/* ── Buttons ── */
.rep-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: 10px;
    border: none;
    cursor: pointer;
    font-size: .78rem;
    font-weight: 600;
    font-family: 'Poppins', sans-serif;
    transition: all .18s;
    -webkit-tap-highlight-color: transparent;
    white-space: nowrap;
}
.rep-btn:disabled { opacity: .45; cursor: not-allowed; }
.rep-btn-sm { padding: 6px 10px; font-size: .7rem; }
.rep-btn-primary { background: var(--primary-color); color: #fff; }
.rep-btn-primary:hover { filter: brightness(1.1); }
.rep-btn-ghost   { background: rgba(255,255,255,.07); color: var(--text-color); border: 1px solid var(--glass-border); }
.rep-btn-ghost:hover { background: rgba(255,255,255,.13); }
.rep-btn-yellow  { background: rgba(245,158,11,.15); color: #f59e0b; border: 1px solid rgba(245,158,11,.3); }
.rep-btn-blue    { background: rgba(59,130,246,.15);  color: #3b82f6; border: 1px solid rgba(59,130,246,.3); }
.rep-btn-green   { background: rgba(16,185,129,.15);  color: #10b981; border: 1px solid rgba(16,185,129,.3); }
.rep-btn-teal    { background: rgba(6,182,212,.15);   color: #06b6d4; border: 1px solid rgba(6,182,212,.3); }
.rep-btn-orange  { background: rgba(249,115,22,.15);  color: #f97316; border: 1px solid rgba(249,115,22,.3); }
.rep-btn-danger  { background: rgba(239,68,68,.13);   color: #ef4444; border: 1px solid rgba(239,68,68,.25); }
.rep-btn-danger:hover { background: rgba(239,68,68,.22); }

/* WhatsApp icon btn */
.rep-icon-btn {
    width: 34px; height: 34px;
    border-radius: 50%;
    border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 1rem;
    transition: all .18s;
    -webkit-tap-highlight-color: transparent;
}
.rep-wpp { background: rgba(37,211,102,.12); color: #25d366; }
.rep-wpp:hover { background: rgba(37,211,102,.22); }

/* ── Empty state ── */
.rep-empty {
    text-align: center;
    padding: 48px 20px;
    color: var(--text-secondary);
}

/* ── Photo notice ── */
.rep-photo-notice {
    background: rgba(245,158,11,.1);
    border: 1px solid rgba(245,158,11,.3);
    border-radius: 12px;
    padding: 12px 14px;
    font-size: .8rem;
    color: #f59e0b;
    margin-bottom: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
}
.rep-photo-btns { display: flex; gap: 8px; flex-wrap: wrap; }
.rep-photo-wrap { display: flex; flex-direction: column; gap: 8px; }

/* ── Modal ── */
.rep-modal-overlay {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 15000;
    background: rgba(0,0,0,0.7);
    backdrop-filter: blur(4px);
    align-items: flex-end;
    justify-content: center;
    padding: 0;
    /* box-sizing garante que paddingBottom (teclado) não expanda o overlay */
    box-sizing: border-box;
}
.rep-modal-overlay.active { display: flex; }

.rep-modal {
    background: var(--bg-color, #0b1325);
    border: 1px solid var(--glass-border);
    border-radius: 24px 24px 0 0;
    width: 100%;
    max-width: 560px;
    /* usa dvh quando disponível; fallback para vh */
    max-height: min(92vh, 92dvh);
    display: flex;
    flex-direction: column;
    box-shadow: 0 -8px 40px rgba(0,0,0,.5);
    animation: rep-modal-in .28s cubic-bezier(.2,.8,.2,1);
}
.rep-modal-sm { max-height: 60vh; border-radius: 20px; margin: 16px; width: calc(100% - 32px); }

@keyframes rep-modal-in {
    from { transform: translateY(40px); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
}

.rep-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px 14px;
    font-weight: 700;
    font-size: .95rem;
    color: var(--text-color);
    border-bottom: 1px solid var(--glass-border);
    flex-shrink: 0;
}
.rep-modal-close {
    background: rgba(255,255,255,.08);
    border: none; cursor: pointer;
    width: 30px; height: 30px;
    border-radius: 50%;
    color: var(--text-secondary);
    display: flex; align-items: center; justify-content: center;
    font-size: .8rem;
    transition: background .15s;
}
.rep-modal-close:hover { background: rgba(255,255,255,.15); }

.rep-modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    -webkit-overflow-scrolling: touch;
}

.rep-modal-footer {
    display: flex;
    gap: 10px;
    padding: 14px 20px 20px;
    border-top: 1px solid var(--glass-border);
    flex-shrink: 0;
}
.rep-modal-footer .rep-btn { flex: 1; justify-content: center; }

/* Form fields inside modal */
.rep-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 14px;
}
.rep-field label {
    font-size: .75rem;
    font-weight: 600;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 6px;
}

/* Light theme */
[data-theme="light"] .rep-modal { background: #fff; }
[data-theme="light"] .rep-card  { background: rgba(0,0,0,.03); }
[data-theme="light"] .rep-filter-btn { background: rgba(0,0,0,.04); }
[data-theme="light"] .rep-btn-ghost  { background: rgba(0,0,0,.04); color: #1a1a2e; }

/* V2 card teal (consertos) */
.ctw-card.c-teal {
    background: rgba(6,182,212,.09);
    border-color: rgba(6,182,212,.2);
}
.ctw-card.c-teal .ctw-card-icon { background: rgba(6,182,212,.15); color: #22d3ee; }
.ctw-card.c-teal .ctw-card-title { color: #67e8f9; }
.ctw-card.c-teal .ctw-card-sub   { color: #67e8f9; }
.ctw-card.c-teal:hover { background: rgba(6,182,212,.15); border-color: rgba(6,182,212,.38); transform: translateY(-3px); }

/* Full width card (5th item in 2x2 grid) */
.ctw-card-full {
    grid-column: 1 / -1;
    min-height: 72px;
    flex-direction: row;
    gap: 14px;
    padding: 14px 20px;
}
.ctw-card-full .ctw-card-title { font-size: .88rem; }
.ctw-card-full .ctw-card-sub   { font-size: .7rem; }


/* ═══ Foto do aparelho — silhueta grande ═══ */
.rep-photo-placeholder {
    width: 100%;
    min-height: 220px;
    border: 2px dashed rgba(255,255,255,0.15);
    border-radius: 16px;
    background: rgba(255,255,255,0.03);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 28px 16px 20px;
    transition: border-color .18s, background .18s;
    -webkit-tap-highlight-color: transparent;
}
[data-theme="light"] .rep-photo-placeholder {
    border-color: rgba(0,0,0,0.13);
    background: rgba(0,0,0,0.03);
}
.rep-photo-silhouette {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    opacity: .4;
}
.rep-photo-hint {
    font-size: .72rem;
    color: var(--text-secondary);
    margin-top: 8px;
    opacity: .6;
}

/* ============================================================
   VARIÁVEIS EXTRAS + BASE (app standalone)
   ============================================================ */
:root {
    --primary-color: #2979FF;
    --primary-color-rgb: 41, 121, 255;
    --tertiary-color: #0B1120;
    --text-color: #E2E8F0;
    --text-color-strong: #FFFFFF;
    --text-secondary: #94A3B8;
    --glass-bg: rgba(30, 41, 59, 0.7);
    --glass-border: rgba(148, 163, 184, 0.1);
    --shadow-color: rgba(0, 0, 0, 0.4);
    --input-bg: rgba(15, 23, 42, 0.6);
    --input-border: rgba(56, 189, 248, 0.1);
    --border-radius: 16px;
    --bg-color: #0b1325;
    /* Cor roxa para status Recebido */
    --rep-purple: #a855f7;
}

[data-theme="light"] {
    --primary-color: #2979FF;
    --primary-color-rgb: 41, 121, 255;
    --tertiary-color: #f0f4ff;
    --text-color: #1e293b;
    --text-color-strong: #000;
    --text-secondary: #52525b;
    --glass-bg: rgba(255,255,255,.85);
    --glass-border: rgba(0,0,0,.1);
    --shadow-color: rgba(0,0,0,.15);
    --input-bg: #f8fafc;
    --input-border: #cbd5e1;
    --bg-color: #f0f4ff;
}

html, body { height: 100%; box-sizing: border-box; }
*, *:before, *:after { box-sizing: inherit; }
body {
    font-family: 'Poppins', sans-serif;
    background-color: var(--tertiary-color);
    color: var(--text-color);
    margin: 0;
    padding: 0;
    min-height: 100vh;
}
.form-control, .form-select {
    background-color: var(--input-bg);
    color: var(--text-color);
    border: 1px solid var(--input-border);
}
.form-control::placeholder { color: var(--text-secondary); opacity: .7; }
.form-control:focus, .form-select:focus {
    background-color: var(--input-bg);
    color: var(--text-color);
    border-color: var(--primary-color);
    box-shadow: 0 0 0 .2rem rgba(var(--primary-color-rgb),.25);
}
.input-group-text {
    background-color: var(--input-bg);
    color: var(--text-secondary);
    border-color: var(--input-border);
}
.section-header {
    width: 100%; margin-bottom: 20px; padding-bottom: 10px;
    border-bottom: 1px solid var(--glass-border);
    display: flex; align-items: center; gap: 8px;
}
.section-header h3 {
    margin: 0; font-size: 1.4rem; font-weight: 600; color: var(--text-color);
    display: flex; align-items: center; gap: 6px;
}

/* ── Status label pequeno no header do card ── */
.rep-status-label-small {
    font-size: .65rem;
    font-weight: 600;
    opacity: .9;
}

/* ── Botão de garantia — verde ── */
.rep-btn-garantia {
    background: rgba(16,185,129,.12);
    color: var(--rep-green);
    border: 1px solid rgba(16,185,129,.3);
}

/* ============================================================
   MODAL DE GARANTIA
   ============================================================ */
.rep-gar-info-row {
    display: flex;
    gap: 10px;
    align-items: baseline;
    padding: 4px 0;
    border-bottom: 1px solid var(--glass-border);
    margin-bottom: 6px;
}
.rep-gar-info-lbl {
    font-size: .72rem;
    color: var(--text-secondary);
    font-weight: 600;
    min-width: 72px;
    text-transform: uppercase;
    letter-spacing: .04em;
}
.rep-gar-info-val {
    font-size: .88rem;
    font-weight: 500;
    color: var(--text-color);
}
.rep-gar-dias-btns {
    display: flex;
    gap: 8px;
    margin: 8px 0 4px;
}
.rep-gar-dias-btn {
    flex: 1;
    padding: 10px 6px;
    border-radius: 10px;
    border: 1.5px solid var(--glass-border);
    background: rgba(255,255,255,.04);
    color: var(--text-color);
    font-size: .85rem;
    font-weight: 600;
    cursor: pointer;
    font-family: 'Poppins', sans-serif;
    transition: all .15s;
}
.rep-gar-dias-btn.selected,
.rep-gar-dias-btn:hover {
    border-color: var(--primary-color);
    background: rgba(var(--primary-color-rgb),.12);
    color: var(--primary-color);
}

/* ============================================================
   PDF — ÁREA DE IMPRESSÃO
   ============================================================ */

/* repPrintArea — não precisa de display especial, html2pdf renderiza off-screen */
#repPrintArea { display: none; }

/* @media print apenas para fallback de impressão direta */
@media print {
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body > *:not(#repPrintArea) { display: none !important; }
    #repPrintArea {
        display: block !important;
        position: static !important;
        width: 100% !important;
    }
    @page { margin: 8mm; size: A4; }
}

/* ============================================================

/* ============================================================
   APP LAYOUT
   ============================================================ */
.app-screen {
    flex-direction: column;
    padding: 16px;
    padding-bottom: 100px;
    max-width: 100%;
    margin: 0;
    width: 100%;
    overflow-x: hidden;
    align-items: stretch;
    min-height: 100vh;
    display: none;
}
#repairsContainer { padding-bottom: 100px !important; }

/* ── NAV — copiado direto do CTW ────────────────────────── */
.ctw-bottom-nav {
    position: fixed;
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    left: 50%;
    transform: translateX(-50%);
    z-index: 1060;
    display: flex;
    align-items: center;
    justify-content: space-around;
    gap: 4px;
    background: rgba(15, 20, 40, 0.82);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 999px;
    padding: 10px 28px;
    width: min(320px, calc(100vw - 32px));
    box-shadow:
        0 8px 32px rgba(0,0,0,0.45),
        0 2px 8px rgba(0,0,0,0.3),
        inset 0 1px 0 rgba(255,255,255,0.07);
}
.ctw-nav-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 6px 16px;
    border-radius: 999px;
    transition: background 0.18s, transform 0.18s;
    -webkit-tap-highlight-color: transparent;
    min-width: 64px;
    position: relative;
}
.ctw-nav-btn:active {
    transform: scale(0.88);
    background: rgba(255,255,255,0.08);
}
.ctw-nav-btn.ctw-nav-active {
    background: rgba(var(--primary-color-rgb), 0.15);
}
.ctw-nav-icon {
    position: relative;
    font-size: 1.3rem;
    color: rgba(255,255,255,0.55);
    line-height: 1;
    transition: color 0.18s, transform 0.18s;
}
.ctw-nav-btn.ctw-nav-active .ctw-nav-icon {
    color: var(--primary-color);
}
.ctw-nav-btn:hover .ctw-nav-icon {
    color: rgba(255,255,255,0.9);
    transform: translateY(-2px);
}
.ctw-nav-badge {
    position: absolute;
    top: -4px; right: -6px;
    min-width: 16px; height: 16px;
    background: #ef4444;
    border-radius: 999px;
    border: 2px solid rgba(15,20,40,0.9);
    font-size: .55rem; font-weight: 700;
    color: #fff;
    display: flex; align-items: center; justify-content: center;
    padding: 0 3px;
    line-height: 1;
}
.ctw-nav-label {
    font-size: .58rem;
    font-weight: 600;
    letter-spacing: .5px;
    color: rgba(255,255,255,0.4);
    font-family: 'Poppins', sans-serif;
    transition: color 0.18s;
}
.ctw-nav-btn.ctw-nav-active .ctw-nav-label {
    color: var(--primary-color);
}
[data-theme="light"] .ctw-bottom-nav {
    background: rgba(255,255,255,0.88);
    border-color: rgba(0,0,0,0.1);
    box-shadow: 0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.1);
}
[data-theme="light"] .ctw-nav-icon { color: rgba(0,0,0,0.35); }
[data-theme="light"] .ctw-nav-btn:hover .ctw-nav-icon { color: rgba(0,0,0,0.75); }
[data-theme="light"] .ctw-nav-label { color: rgba(0,0,0,0.35); }
[data-theme="light"] .ctw-nav-badge { border-color: rgba(255,255,255,0.9); }

/* ── SHEET: títulos e cards de notif ──────────────────── */
.ps-sheet-title {
    padding: 14px 20px 10px;
    font-size: .7rem;
    font-weight: 700;
    letter-spacing: .1em;
    text-transform: uppercase;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--glass-border);
}
.ps-sheet-empty {
    text-align: center;
    padding: 24px 20px;
    font-size: .85rem;
    color: var(--text-secondary);
}
.notif-card {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 20px;
    border-bottom: 1px solid rgba(255,255,255,.05);
    cursor: pointer;
    transition: background .12s;
    -webkit-tap-highlight-color: transparent;
}
.notif-card:last-child { border-bottom: none; }
.notif-card:active { background: rgba(255,255,255,.04); }
[data-theme="light"] .notif-card:active { background: rgba(0,0,0,.04); }

/* ── LOADING SCREEN — Modo Vendas ──────────────────────── */
/* ── SPLASH — Abertura do App ──────────────────────────── */
#appSplashScreen {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 99999;
    background: var(--bg-color, #0b1325);
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
}
.splash-frame {
    width: 100px; height: 100px;
    border-radius: 28px;
    background: rgba(var(--primary-color-rgb), .12);
    border: 2px solid rgba(var(--primary-color-rgb), .3);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: vendaPulse 1.2s ease-in-out infinite;
    box-shadow: 0 0 0 0 rgba(var(--primary-color-rgb), .4);
}
.splash-icon { font-size: 2.8rem; color: var(--primary-color); line-height: 1; }
.splash-text {
    font-size: 1rem;
    font-weight: 700;
    color: var(--text-color);
    letter-spacing: .04em;
    opacity: .85;
}
.splash-dots {
    display: flex;
    gap: 6px;
}
.splash-dots span {
    width: 7px; height: 7px;
    border-radius: 50%;
    background: var(--primary-color);
    animation: vendaDot 1.2s ease-in-out infinite;
}
.splash-dots span:nth-child(2) { animation-delay: .2s; }
.splash-dots span:nth-child(3) { animation-delay: .4s; }

/* ── LOADING — Modo Consertos (volta do modo vendas) ───── */
#consertosLoadingScreen {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 99998;
    background: var(--tertiary-color);
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
}

#vendaLoadingScreen {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 99998;
    background: var(--tertiary-color);
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
}
.venda-loading-frame {
    width: 100px; height: 100px;
    border-radius: 28px;
    background: rgba(var(--primary-color-rgb), .12);
    border: 2px solid rgba(var(--primary-color-rgb), .3);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: vendaPulse 1.2s ease-in-out infinite;
    box-shadow: 0 0 0 0 rgba(var(--primary-color-rgb), .4);
}
@keyframes vendaPulse {
    0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(var(--primary-color-rgb),.4); }
    50%       { transform: scale(1.06); box-shadow: 0 0 0 16px rgba(var(--primary-color-rgb),0); }
}
.venda-loading-icon { font-size: 3rem; line-height: 1; }
.venda-loading-text {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-color);
    letter-spacing: .04em;
}
.venda-loading-dots {
    display: flex;
    gap: 6px;
}
.venda-loading-dots span {
    width: 7px; height: 7px;
    border-radius: 50%;
    background: var(--primary-color);
    animation: vendaDot 1.2s ease-in-out infinite;
}
.venda-loading-dots span:nth-child(2) { animation-delay: .2s; }
.venda-loading-dots span:nth-child(3) { animation-delay: .4s; }
@keyframes vendaDot {
    0%, 80%, 100% { opacity: .2; transform: scale(.8); }
    40%           { opacity: 1;  transform: scale(1.2); }
}

/* ── HISTÓRICO DE RECIBOS ──────────────────────────────── */
.historico-card {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 14px;
    padding: 14px 16px;
    margin-bottom: 10px;
}
.historico-card-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 10px;
}
.historico-card-nome {
    font-size: .88rem;
    font-weight: 600;
    color: var(--text-color);
}
.historico-card-produto {
    font-size: .75rem;
    color: var(--text-secondary);
    margin-top: 2px;
}
.historico-card-valor {
    font-size: .9rem;
    font-weight: 700;
    color: var(--rep-green);
    white-space: nowrap;
}
.historico-card-pgto {
    font-size: .68rem;
    color: var(--text-secondary);
    text-align: right;
    margin-top: 2px;
}
.historico-card-bottom {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid var(--glass-border);
    padding-top: 8px;
    font-size: .72rem;
    color: var(--text-secondary);
    gap: 8px;
}

/* ── ACTIVE SCREEN ─────────────────────────────────────── */
.active-screen { display: flex !important; }
.notif-banner {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 14px;
    border-left: 3px solid transparent;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 4px 20px rgba(0,0,0,.35);
    overflow: hidden;
    max-height: 200px;
    margin-bottom: 0;
}
.notif-banner-danger {
    background: rgba(20, 10, 10, .88);
    border-left-color: #ef4444;
}
.notif-banner-warn {
    background: rgba(20, 15, 5, .88);
    border-left-color: #f59e0b;
}
[data-theme="light"] .notif-banner-danger { background: rgba(254,242,242,.95); }
[data-theme="light"] .notif-banner-warn   { background: rgba(255,251,235,.95); }

.notif-banner-icon { font-size: 1.1rem; flex-shrink: 0; margin-top: 1px; }
.notif-banner-body { flex: 1; min-width: 0; }
.notif-banner-text { font-size: .8rem; color: var(--text-color); line-height: 1.45; }
.notif-banner-text strong { color: var(--text-color-strong); }
.notif-banner-actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.notif-banner-btn {
    padding: 5px 12px;
    border-radius: 8px;
    font-size: .72rem;
    font-weight: 600;
    cursor: pointer;
    font-family: 'Poppins', sans-serif;
    border: none;
    transition: opacity .15s;
}
.notif-banner-btn:active { opacity: .7; }
.notif-banner-btn-ghost {
    background: rgba(255,255,255,.1);
    color: var(--text-color);
    border: 1px solid var(--glass-border);
}
[data-theme="light"] .notif-banner-btn-ghost { background: rgba(0,0,0,.06); }
.notif-banner-close {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: .8rem;
    cursor: pointer;
    padding: 2px 4px;
    flex-shrink: 0;
    opacity: .6;
    -webkit-tap-highlight-color: transparent;
}
.notif-banner-close:hover { opacity: 1; }

/* ── PROFILE BOTTOM SHEET ───────────────────────────────── */
.ps-overlay {
    position: fixed;
    inset: 0;
    z-index: 5000;
    background: rgba(0,0,0,.5);
    backdrop-filter: blur(4px);
    display: none;
    align-items: flex-end;
    justify-content: center;
}
.ps-overlay.active {
    display: flex;
}
.ps-sheet {
    width: calc(100% - 28px);
    max-width: 480px;
    background: #111d2e;
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 22px;
    padding: 0 0 14px;
    margin-bottom: 10px;
    transform: translateY(calc(100% + 20px));
    transition: transform .3s cubic-bezier(.34,1.1,.64,1);
    box-shadow: 0 0 40px rgba(0,0,0,.55);
}
.ps-overlay.active .ps-sheet {
    transform: translateY(0);
}
[data-theme="light"] .ps-sheet { background: rgba(255,255,255,.97); }
.ps-handle {
    width: 40px; height: 4px;
    background: rgba(255,255,255,.2);
    border-radius: 2px;
    margin: 10px auto 0;
}
[data-theme="light"] .ps-handle { background: rgba(0,0,0,.15); }
.ps-header {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 16px 20px;
}
.ps-avatar {
    width: 48px; height: 48px;
    border-radius: 50%;
    background: rgba(var(--primary-color-rgb),.2);
    border: 2px solid var(--primary-color);
    display: flex; align-items: center; justify-content: center;
    font-size: 1.3rem;
    color: var(--primary-color);
    flex-shrink: 0;
}
.ps-label {
    font-size: .65rem;
    font-weight: 700;
    letter-spacing: .08em;
    color: var(--text-secondary);
    text-transform: uppercase;
}
.ps-name {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-color-strong);
    margin-top: 2px;
}
.ps-divider {
    height: 1px;
    background: var(--glass-border);
    margin: 0 20px 8px;
}
.ps-item {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    padding: 13px 20px;
    background: none;
    border: none;
    color: var(--text-color);
    font-family: 'Poppins', sans-serif;
    cursor: pointer;
    text-align: left;
    -webkit-tap-highlight-color: transparent;
    transition: background .15s;
}
.ps-item:active { background: rgba(255,255,255,.06); }
[data-theme="light"] .ps-item:active { background: rgba(0,0,0,.04); }
.ps-item-icon {
    width: 40px; height: 40px;
    border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    color: #fff;
    font-size: 1rem;
    flex-shrink: 0;
}
.ps-item-text { flex: 1; min-width: 0; }
.ps-item-title { font-size: .9rem; font-weight: 500; color: var(--text-color); }
.ps-item-sub   { font-size: .72rem; color: var(--text-secondary); margin-top: 1px; }

/* ── CONFIG SCREEN ──────────────────────────────────────── */
.cfg-section {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    padding: 18px;
    margin-bottom: 16px;
}
[data-theme="light"] .cfg-section { background: rgba(255,255,255,.9); }
.cfg-section-title {
    font-size: .7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: var(--primary-color);
    margin-bottom: 14px;
}
.cfg-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
    font-size: .92rem;
    font-weight: 500;
    color: var(--text-color);
}
.cfg-colors-label {
    font-size: .78rem;
    color: var(--text-secondary);
    margin: 14px 0 10px;
    font-weight: 500;
}
.cfg-colors { display: flex; gap: 12px; flex-wrap: wrap; }
.cfg-color-btn {
    width: 36px; height: 36px;
    border-radius: 50%;
    border: 3px solid transparent;
    cursor: pointer;
    transition: transform .15s, border-color .15s;
    flex-shrink: 0;
}
.cfg-color-btn:hover  { transform: scale(1.12); }
.cfg-color-btn.active { border-color: #fff; box-shadow: 0 0 0 2px var(--primary-color); transform: scale(1.1); }

/* Toggle */
.cfg-toggle {
    position: relative;
    display: inline-block;
    width: 44px; height: 24px;
    flex-shrink: 0;
}
.cfg-toggle input { opacity: 0; width: 0; height: 0; }
.cfg-toggle-slider {
    position: absolute;
    cursor: pointer;
    inset: 0;
    background: rgba(255,255,255,.15);
    border-radius: 24px;
    transition: .3s;
}
[data-theme="light"] .cfg-toggle-slider { background: rgba(0,0,0,.2); }
.cfg-toggle-slider::before {
    content: '';
    position: absolute;
    width: 18px; height: 18px;
    left: 3px; bottom: 3px;
    background: #fff;
    border-radius: 50%;
    transition: .3s;
}
.cfg-toggle input:checked + .cfg-toggle-slider { background: var(--primary-color); }
.cfg-toggle input:checked + .cfg-toggle-slider::before { transform: translateX(20px); }

.cfg-vendas-card {
    display: flex; align-items: center; gap: 14px; padding: 4px 0;
}
.cfg-vendas-icon {
    width: 44px; height: 44px;
    background: rgba(var(--primary-color-rgb),.12);
    border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    font-size: 1.2rem; color: var(--primary-color); flex-shrink: 0;
}
.cfg-vendas-info { flex: 1; }
.cfg-vendas-title { font-size: .9rem; font-weight: 600; color: var(--text-color); }
.cfg-vendas-sub   { font-size: .72rem; color: var(--text-secondary); margin-top: 2px; line-height: 1.4; }

/* ── VENDAS SCREEN ──────────────────────────────────────── */
.vendas-form { display: flex; flex-direction: column; gap: 4px; }
.vendas-btn-gerar { width: 100%; margin-top: 12px; padding: 14px; font-size: 1rem; font-weight: 700; }

/* ── VENDAS — Estilo Dark Premium (Opção 1) ─────────────── */
#vendasScreen { padding-bottom: 100px; }

.vd-header {
    margin-bottom: 14px;
}
.vd-header-title {
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text-color);
    display: flex;
    align-items: center;
    gap: 8px;
}
.vd-header-title i { color: var(--primary-color); font-size: 1rem; }

/* Tabs */
.vd-tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 18px;
}
.vd-tab {
    flex: 1;
    padding: 9px 0;
    border-radius: 12px;
    font-size: .78rem;
    font-weight: 600;
    font-family: 'Poppins', sans-serif;
    text-align: center;
    cursor: pointer;
    border: 1.5px solid rgba(255,255,255,.07);
    background: rgba(255,255,255,.04);
    color: #64748b;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: all .18s;
    -webkit-tap-highlight-color: transparent;
}
.vd-tab i { font-size: .8rem; }
.vd-tab.vd-tab-active {
    background: rgba(var(--primary-color-rgb), .15);
    border-color: rgba(var(--primary-color-rgb), .4);
    color: var(--primary-color);
}
.vd-tab:active { opacity: .75; transform: scale(.97); }
[data-theme="light"] .vd-tab {
    border-color: #e2e8f0;
    background: #fff;
    color: #94a3b8;
}
[data-theme="light"] .vd-tab.vd-tab-active {
    background: rgba(var(--primary-color-rgb),.08);
    border-color: rgba(var(--primary-color-rgb),.35);
    color: var(--primary-color);
}

/* Form */
.vd-form { display: flex; flex-direction: column; gap: 12px; }

.vd-field { display: flex; flex-direction: column; gap: 5px; }

.vd-label {
    font-size: .65rem;
    font-weight: 600;
    color: #64748b;
    letter-spacing: .05em;
    text-transform: uppercase;
    display: flex;
    align-items: center;
    gap: 5px;
}
.vd-label i { font-size: .65rem; }
[data-theme="light"] .vd-label { color: #94a3b8; }

.vd-input {
    width: 100%;
    padding: 11px 14px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,.08);
    background: rgba(255,255,255,.04);
    color: var(--text-color);
    font-size: .88rem;
    font-family: 'Poppins', sans-serif;
    transition: border-color .18s, box-shadow .18s;
    outline: none;
    -webkit-appearance: none;
}
.vd-input::placeholder { color: #475569; }
.vd-input:focus {
    border-color: rgba(var(--primary-color-rgb), .5);
    box-shadow: 0 0 0 3px rgba(var(--primary-color-rgb), .1);
}
[data-theme="light"] .vd-input {
    border-color: #e2e8f0;
    background: #fff;
    color: #334155;
    box-shadow: 0 1px 3px rgba(0,0,0,.05);
}
[data-theme="light"] .vd-input::placeholder { color: #cbd5e1; }

.vd-textarea { resize: none; }
.vd-select { cursor: pointer; }

/* Input com prefixo R$ */
.vd-input-prefix { display: flex; align-items: stretch; }
.vd-prefix-tag {
    padding: 11px 13px;
    background: rgba(var(--primary-color-rgb), .12);
    border: 1px solid rgba(var(--primary-color-rgb), .25);
    border-right: none;
    border-radius: 12px 0 0 12px;
    font-size: .82rem;
    font-weight: 700;
    color: var(--primary-color);
    display: flex;
    align-items: center;
    flex-shrink: 0;
}
.vd-input-right {
    border-radius: 0 12px 12px 0 !important;
    flex: 1;
}
[data-theme="light"] .vd-prefix-tag {
    background: rgba(var(--primary-color-rgb),.06);
    border-color: #e2e8f0;
}

/* Botão gerar */
.vd-btn-gerar {
    width: 100%;
    margin-top: 4px;
    padding: 14px;
    border-radius: 14px;
    border: none;
    background: var(--primary-color);
    color: #fff;
    font-size: .92rem;
    font-weight: 700;
    font-family: 'Poppins', sans-serif;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    box-shadow: 0 4px 18px rgba(var(--primary-color-rgb), .38);
    transition: opacity .18s, transform .18s;
    -webkit-tap-highlight-color: transparent;
}
.vd-btn-gerar:active { opacity: .85; transform: scale(.98); }
.vd-btn-gerar i { font-size: .95rem; }

/* ── NOTIFICATION SHEET (bell button) ──────────────────── */
.notif-sheet-overlay {
    position: fixed;
    inset: 0;
    z-index: 5000;
    background: rgba(0,0,0,.5);
    backdrop-filter: blur(4px);
    display: none;
    align-items: flex-end;
    justify-content: center;
}
.notif-sheet-overlay.active { display: flex; }
.notif-sheet {
    width: calc(100% - 24px);
    max-width: 500px;
    background: #0f1c2e;
    border: 1px solid var(--glass-border);
    border-radius: 24px;
    padding: 0 0 24px;
    margin-bottom: 12px;
    transform: translateY(calc(100% + 20px));
    transition: transform .32s cubic-bezier(.34,1.1,.64,1);
    box-shadow: 0 -4px 40px rgba(0,0,0,.5);
    max-height: 80vh;
    overflow-y: auto;
}
.notif-sheet-overlay.active .notif-sheet { transform: translateY(0); }
[data-theme="light"] .notif-sheet { background: rgba(255,255,255,.97); }
[data-theme="light"] .ps-sheet     { background: rgba(255,255,255,.97); }

.notif-sheet-handle {
    width: 40px; height: 4px;
    background: rgba(255,255,255,.2);
    border-radius: 2px;
    margin: 10px auto 0;
}
[data-theme="light"] .notif-sheet-handle { background: rgba(0,0,0,.15); }
.notif-sheet-title {
    padding: 14px 20px 10px;
    font-size: .75rem;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--glass-border);
    margin-bottom: 4px;
}
.notif-sheet-empty {
    text-align: center;
    padding: 28px 20px;
    font-size: .85rem;
    color: var(--text-secondary);
    opacity: .6;
}
.notif-sheet-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 13px 20px;
    border-bottom: 1px solid var(--glass-border);
    cursor: pointer;
    transition: background .12s;
    -webkit-tap-highlight-color: transparent;
}
.notif-sheet-item:last-child { border-bottom: none; }
.notif-sheet-item:active { background: rgba(255,255,255,.04); }
.notif-sheet-item-icon {
    width: 36px; height: 36px;
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    font-size: .95rem;
    flex-shrink: 0;
    margin-top: 1px;
}
.notif-sheet-item-icon.danger { background: rgba(239,68,68,.15); }
.notif-sheet-item-icon.warn   { background: rgba(245,158,11,.15); }
.notif-sheet-item-icon.info   { background: rgba(var(--primary-color-rgb),.12); }
.notif-sheet-item-body { flex: 1; min-width: 0; }
.notif-sheet-item-title {
    font-size: .84rem;
    font-weight: 600;
    color: var(--text-color);
    line-height: 1.4;
}
.notif-sheet-item-sub {
    font-size: .72rem;
    color: var(--text-secondary);
    margin-top: 2px;
}

/* ── FLOATING NOTIF CARDS — posição CTW (topo/centro) ─── */
#notifFloatingWrap {
    position: fixed;
    top: 16px;
    left: 14px; right: 14px;
    z-index: 4000;
    display: flex;
    flex-direction: column;
    gap: 10px;
    pointer-events: none;
}
#notifFloatingWrap.has-cards { pointer-events: all; }
.notif-float-card {
    background: #111d2e;
    border: 1px solid rgba(255,255,255,.1);
    border-radius: 16px;
    padding: 13px 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    box-shadow: 0 8px 28px rgba(0,0,0,.55);
    transform: translateY(-12px);
    opacity: 0;
    transition: transform .3s cubic-bezier(.34,1.2,.64,1), opacity .22s ease;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.notif-float-card.show { transform: translateY(0); opacity: 1; }
.notif-float-card:active { opacity: .8; }
[data-theme="light"] .notif-float-card {
    background: rgba(255,255,255,.97);
    border-color: rgba(0,0,0,.08);
    box-shadow: 0 8px 28px rgba(0,0,0,.14);
}
.notif-float-icon {
    width: 38px; height: 38px;
    border-radius: 10px;
    background: rgba(239,68,68,.15);
    display: flex; align-items: center; justify-content: center;
    font-size: .95rem;
    flex-shrink: 0;
}
.notif-float-icon.warn { background: rgba(245,158,11,.15); }
.notif-float-body { flex: 1; min-width: 0; }
.notif-float-msg {
    font-size: .8rem;
    font-weight: 500;
    color: var(--text-color);
    line-height: 1.4;
}
.notif-float-close {
    font-size: .8rem;
    color: var(--text-secondary);
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    flex-shrink: 0;
    opacity: .5;
    font-family: 'Poppins', sans-serif;
    line-height: 1;
}
.notif-float-close:active { opacity: 1; }
#notifFloatingBg {
    position: fixed;
    inset: 0;
    z-index: 3999;
    background: rgba(0,0,0,.4);
    backdrop-filter: blur(3px);
    display: none;
    opacity: 0;
    transition: opacity .2s;
}
#notifFloatingBg.show { display: block; opacity: 1; }

/* ── SPLIT BUTTONS (Recebido → dois caminhos) ──────────── */
.rep-next-split {
    display: flex;
    gap: 8px;
    width: 100%;
}
.rep-btn-split {
    flex: 1;
    font-size: .72rem !important;
    padding: 8px 6px !important;
    justify-content: center;
    text-align: center;
}

/* ── STATS CLICÁVEIS ──────────────────────────────────────*/
.rep-stat-clickable {
    cursor: pointer;
    transition: transform .15s, box-shadow .15s;
    border-radius: 10px;
}
.rep-stat-clickable:active {
    transform: scale(.94);
    box-shadow: 0 0 0 2px var(--primary-color);
}

/* ── FORNECEDOR BLOCO (card body) ────────────────────────── */
.rep-forn-bloco {
    background: rgba(245,158,11,.07);
    border: 1px solid rgba(245,158,11,.2);
    border-radius: 10px;
    padding: 10px 12px;
    margin: 6px 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.rep-forn-title {
    font-size: .68rem;
    font-weight: 700;
    color: var(--rep-yellow);
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 5px;
}
.rep-forn-row {
    display: flex;
    gap: 8px;
    font-size: .75rem;
    color: var(--text-color);
    align-items: baseline;
}
.rep-forn-lbl {
    font-size: .62rem;
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: .04em;
    min-width: 70px;
    flex-shrink: 0;
}

/* Filtro urgente — cor dinâmica via JS */
.rep-filter-urgente {
    border-color: rgba(239,68,68,.35) !important;
    color: #ef4444 !important;
}
.rep-filter-urgente.rep-filter-active {
    background: rgba(239,68,68,.15) !important;
    border-color: #ef4444 !important;
}

/* ── SENHA LATERAL NO CARD EXPANDIDO ─────────────────────── */
.rep-senha-lateral {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    margin: 6px 0;
    border-radius: 12px;
    background: rgba(var(--primary-color-rgb), .06);
    border: 1px solid rgba(var(--primary-color-rgb), .18);
}
.rep-senha-lateral-left {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    min-width: 42px;
}
.rep-senha-lateral-right {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: flex-end;
}

/* Mini SVG do padrão */
.rep-ptn-svg-mini {
    width: 96px;
    height: 96px;
    border-radius: 10px;
    background: rgba(255,255,255,.03);
    border: 1px solid var(--glass-border);
    display: block;
}
[data-theme="light"] .rep-ptn-svg-mini {
    background: rgba(0,0,0,.03);
}
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(var(--primary-color-rgb), .07);
    border: 1px solid rgba(var(--primary-color-rgb), .2);
    border-radius: 10px;
    padding: 8px 12px;
    margin: 4px 0;
    font-size: .8rem;
}
.rep-senha-icon { color: var(--primary-color); font-size: .85rem; }
.rep-senha-tipo {
    font-size: .65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .05em;
    color: var(--text-secondary);
    background: rgba(255,255,255,.06);
    border-radius: 5px;
    padding: 2px 6px;
}
.rep-senha-valor {
    font-weight: 700;
    color: var(--text-color);
    font-family: monospace;
    font-size: .9rem;
    letter-spacing: .08em;
}
.rep-senha-padrao-dots {
    display: flex;
    gap: 3px;
    flex-wrap: wrap;
    align-items: center;
}
.rep-ptn-mini-dot {
    width: 18px; height: 18px;
    border-radius: 50%;
    background: rgba(var(--primary-color-rgb), .15);
    border: 1px solid rgba(var(--primary-color-rgb), .3);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: .55rem;
    font-weight: 700;
    color: var(--text-secondary);
}
.rep-ptn-mini-dot.rep-ptn-mini-on {
    background: rgba(var(--primary-color-rgb), .3);
    border-color: var(--primary-color);
    color: var(--primary-color);
}

/* ── MULTI-PHOTO GRID ────────────────────────────────────── */
.rep-photos-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
}
.rep-photo-thumb {
    position: relative;
    width: 80px;
    height: 80px;
    border-radius: 10px;
    overflow: hidden;
    flex-shrink: 0;
}
.rep-photo-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.rep-photo-rm {
    position: absolute;
    top: 3px; right: 3px;
    width: 22px; height: 22px;
    border-radius: 50%;
    background: rgba(0,0,0,.7);
    border: none;
    color: #fff;
    font-size: .6rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
}
.rep-photo-add-slot {
    width: 80px;
    height: 80px;
    border-radius: 10px;
    border: 1.5px dashed rgba(var(--primary-color-rgb),.4);
    background: rgba(var(--primary-color-rgb),.06);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    position: relative;
    flex-shrink: 0;
    transition: background .15s;
    -webkit-tap-highlight-color: transparent;
}
.rep-photo-add-slot:active { background: rgba(var(--primary-color-rgb),.14); }
.rep-photo-add-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    pointer-events: none;
}
.rep-photo-add-inner i { font-size: 1.2rem; color: var(--primary-color); opacity: .8; }
.rep-photo-add-inner span { font-size: .55rem; color: var(--text-secondary); font-weight: 600; }
.rep-photo-gal-btn {
    position: absolute;
    bottom: 3px; right: 3px;
    width: 22px; height: 22px;
    border-radius: 50%;
    background: rgba(var(--primary-color-rgb),.2);
    border: 1px solid rgba(var(--primary-color-rgb),.4);
    color: var(--primary-color);
    font-size: .6rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    z-index: 2;
}
.rep-thumb-count {
    position: absolute;
    bottom: 3px; right: 3px;
    background: rgba(0,0,0,.7);
    color: #fff;
    font-size: .55rem;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 999px;
}

/* ═══════════════════════════════════════════════════
   SENHA DO APARELHO — tipo tabs
═══════════════════════════════════════════════════ */
.senha-tipo-tabs {
    display: flex;
    gap: 6px;
    margin-bottom: 10px;
}
.senha-tipo-tab {
    flex: 1;
    padding: 7px 0;
    border-radius: 8px;
    border: 1px solid var(--glass-border);
    background: transparent;
    color: var(--text-secondary);
    font-size: .72rem;
    font-weight: 600;
    cursor: pointer;
    transition: all .15s;
    font-family: 'Poppins', sans-serif;
}
.senha-tipo-tab.senha-tipo-active {
    background: var(--primary-color);
    border-color: var(--primary-color);
    color: #fff;
}

/* ═══════════════════════════════════════════════════
   PADRÃO ANDROID — pattern lock grid
═══════════════════════════════════════════════════ */
.ptn-wrap {
    position: relative;
    width: 180px;
    height: 180px;
    margin: 0 auto;
    user-select: none;
    touch-action: none;
    border-radius: 12px;
    background: rgba(255,255,255,.03);
    border: 1px solid var(--glass-border);
}
.ptn-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    border-radius: 12px;
}
.ptn-dots-grid {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(3, 1fr);
    pointer-events: none;
}
.ptn-dot {
    display: flex;
    align-items: center;
    justify-content: center;
}
.ptn-dot::after {
    content: '';
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--text-secondary);
    opacity: .4;
    transition: background .1s, transform .12s, opacity .1s;
}
.ptn-dot.ptn-active::after {
    background: var(--primary-color);
    opacity: 1;
    transform: scale(1.5);
}

/* ═══════════════════════════════════════════════════
   AUTO-DELETE — opções de rádio
═══════════════════════════════════════════════════ */
.autodel-options {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.autodel-opt {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-radius: 10px;
    border: 1px solid var(--glass-border);
    cursor: pointer;
    transition: border-color .15s, background .15s;
}
.autodel-opt:has(input:checked) {
    border-color: var(--primary-color);
    background: rgba(var(--primary-color-rgb), .08);
}
.autodel-opt input[type="radio"] {
    accent-color: var(--primary-color);
    width: 17px;
    height: 17px;
    cursor: pointer;
    flex-shrink: 0;
}
.autodel-opt-label {
    font-size: .85rem;
    font-weight: 600;
    color: var(--text-color);
}
.autodel-opt-sub {
    font-size: .7rem;
    opacity: .5;
    margin-top: 1px;
}
/* --- Novo Layout Lado a Lado: Meta + Senha --- */
.rep-body-mid {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 12px;
    padding-top: 8px;
    border-top: 1px solid var(--glass-border);
}

/* Remove a borda antiga da meta para não duplicar */
.rep-body-mid .rep-card-meta {
    flex: 1;
    border-top: none;
    padding-top: 0;
    margin-bottom: 0;
}

/* Bloco reduzido da senha no canto direito */
.rep-senha-mini {
    flex-shrink: 0;
    background: rgba(var(--primary-color-rgb), .06);
    border: 1px solid rgba(var(--primary-color-rgb), .18);
    border-radius: 10px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 65px;
}

.rep-senha-mini-title {
    font-size: .55rem;
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    display: flex;
    align-items: center;
    gap: 3px;
}

.rep-senha-mini-title i {
    color: var(--primary-color);
}

.rep-senha-mini-content {
    display: flex;
    align-items: center;
    justify-content: center;
}

/* Reduz o tamanho do SVG do padrão especificamente neste bloco */
.rep-senha-mini-content .rep-ptn-svg-mini {
    width: 50px;
    height: 50px;
    border-radius: 6px;
}

.rep-senha-mini-content .rep-senha-valor {
    font-size: .85rem;
    font-weight: 700;
    color: var(--text-color);
    letter-spacing: .05em;
}

/* ============================================================
   ESCOLHER ETAPA MANUAL
   ============================================================ */
.rep-btn-choose-step {
    width: 100%;
    margin-top: 6px;
    font-size: .78rem;
    opacity: .65;
    border: 1px dashed rgba(255,255,255,.15);
    transition: opacity .2s, border-color .2s;
}

.rep-btn-choose-step:hover {
    opacity: 1;
    border-color: rgba(255,255,255,.3);
}

.rep-choose-step-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.rep-choose-step-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 12px 14px;
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 10px;
    cursor: pointer;
    font-size: .88rem;
    text-align: left;
    transition: background .18s, transform .12s;
    color: var(--text-color);
}

.rep-choose-step-btn:hover:not(:disabled) {
    background: rgba(255,255,255,.09);
    transform: translateX(2px);
}

.rep-choose-step-btn--current {
    opacity: .4;
    cursor: default;
    pointer-events: none;
}

.rep-choose-step-tag {
    font-size: .68rem;
    font-weight: 600;
    background: rgba(255,255,255,.1);
    border-radius: 4px;
    padding: 2px 6px;
    text-transform: uppercase;
    letter-spacing: .04em;
    opacity: .7;
}

/* ── ETIQUETA TÉRMICA — preview no app ───────────────────── */
.etiqueta-preview-wrap {
    display: flex;
    justify-content: center;
    padding: 12px 0;
}
.etq-label {
    width: 220px;
    background: #fff;
    border-radius: 8px;
    border: 1px solid #ddd;
    overflow: hidden;
    font-family: Arial, sans-serif;
    box-shadow: 0 4px 16px rgba(0,0,0,.15);
}
.etq-header {
    background: #1a1a2e;
    color: #fff;
    padding: 5px 9px;
    display: flex;
    align-items: center;
    gap: 5px;
}
.etq-logo {
    max-height: 18px;
    max-width: 38px;
    object-fit: contain;
    filter: brightness(10);
}
.etq-assist {
    flex: 1;
    font-size: .62rem;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.etq-id {
    font-size: .55rem;
    opacity: .7;
    white-space: nowrap;
}
.etq-body {
    padding: 7px 9px;
    display: flex;
    flex-direction: column;
    gap: 5px;
}
.etq-row {
    display: flex;
    align-items: flex-start;
    gap: 5px;
    line-height: 1.35;
}
.etq-lbl {
    font-size: .5rem;
    color: #888;
    text-transform: uppercase;
    font-weight: 700;
    min-width: 44px;
    padding-top: 1px;
    flex-shrink: 0;
}
.etq-val {
    font-size: .72rem;
    color: #111;
    font-weight: 600;
}
.etq-nome {
    font-size: .82rem;
    font-weight: 800;
}
.etq-defeito .etq-val {
    font-size: .65rem;
    font-weight: 400;
    color: #444;
}
.etq-padrao {
    display: flex;
    align-items: center;
}

/* ── NÚMERO DO CONSERTO/VENDA ────────────────────────────── */
.rep-card-num {
    display: inline-flex;
    align-items: center;
    background: rgba(var(--primary-color-rgb),.15);
    color: var(--primary-color);
    border: 1px solid rgba(var(--primary-color-rgb),.3);
    border-radius: 6px;
    font-size: .6rem;
    font-weight: 800;
    padding: 1px 5px;
    letter-spacing: .04em;
    vertical-align: middle;
    margin-right: 3px;
}

/* ── Ver mais — lista de consertos ─────────────────────── */
#repVerMaisWrap{padding:4px 0 16px;text-align:center;}
.rep-ver-mais-btn{
    display:inline-flex;align-items:center;gap:7px;
    background:rgba(255,255,255,.06);
    border:1px solid var(--glass-border);
    border-radius:14px;
    color:var(--text-color);
    font-size:.83rem;font-weight:600;
    font-family:'Poppins',sans-serif;
    padding:10px 24px;
    cursor:pointer;
    transition:background .15s,border-color .15s;
}
.rep-ver-mais-btn:active{background:rgba(var(--primary-color-rgb),.15);border-color:rgba(var(--primary-color-rgb),.4);}
.rep-ver-mais-btn i{color:var(--primary-color);}

/* ── Botão remover logo ─────────────────────────────────── */
.cfg-upload-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    margin-top: 10px;
    padding: 9px 14px;
    border-radius: 12px;
    border: 1px solid rgba(239, 68, 68, 0.35);
    background: rgba(239, 68, 68, 0.08);
    color: #f87171;
    font-size: .8rem;
    font-weight: 600;
    font-family: 'Poppins', sans-serif;
    cursor: pointer;
    transition: background .18s, border-color .18s, transform .12s;
    letter-spacing: .01em;
}
.cfg-upload-remove:active {
    background: rgba(239, 68, 68, 0.18);
    border-color: rgba(239, 68, 68, 0.6);
    transform: scale(.97);
}
[data-theme="light"] .cfg-upload-remove {
    background: rgba(239, 68, 68, 0.07);
    color: #dc2626;
}

/* ── Checklist de Revisão ─────────────────────────────────── */
.rep-checklist-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 12px;
    border-radius: 10px;
    border: 1.5px solid rgba(255,255,255,.08);
    background: rgba(255,255,255,.04);
    cursor: pointer;
    user-select: none;
    transition: background .15s, border-color .15s;
}
.rep-checklist-item:active {
    transform: scale(.97);
}
.rep-checklist-box {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    border: 2px solid rgba(255,255,255,.2);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background .15s, border-color .15s;
}
.rep-checklist-icon {
    font-size: 14px;
    color: transparent;
    transition: color .12s;
}
.rep-checklist-label {
    font-size: .82rem;
    font-weight: 600;
    color: var(--text-secondary);
    transition: color .12s;
}
/* Estado marcado */
.rep-checklist-checked {
    background: rgba(6,182,212,.12);
    border-color: rgba(6,182,212,.4);
}
.rep-checklist-checked .rep-checklist-box {
    background: var(--rep-teal);
    border-color: var(--rep-teal);
}
.rep-checklist-checked .rep-checklist-icon {
    color: #fff;
}
.rep-checklist-checked .rep-checklist-label {
    color: var(--rep-teal);
}
[data-theme="light"] .rep-checklist-item {
    border-color: rgba(0,0,0,.1);
    background: rgba(0,0,0,.03);
}
[data-theme="light"] .rep-checklist-checked {
    background: rgba(6,182,212,.1);
    border-color: rgba(6,182,212,.5);
}
[data-theme="light"] .rep-checklist-label {
    color: var(--text-secondary);
}

/* ── Badges de pagamento ──────────────────────────────────── */
.rep-badge-pag-pendente { background: rgba(245,158,11,.15); color: #f59e0b; border: 1px solid rgba(245,158,11,.35); }
.rep-badge-pag-vencido  { background: rgba(239,68,68,.15);  color: #ef4444; border: 1px solid rgba(239,68,68,.35); }

/* ── Tag neutra de valor cobrado (não confunde com "a receber") ── */
.rep-valor-cobrado-pill {
    background: rgba(148,163,184,.1);
    color: var(--text-secondary);
    border: 1px solid rgba(148,163,184,.2);
    font-weight: 600;
}

/* ── Badge numérico no botão Entregue ─────────────────────── */
.rep-filter-btn { position: relative; }
.rep-pag-badge {
    position: absolute;
    top: -6px;
    right: -6px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 20px;
    background: #f59e0b;
    color: #000;
    font-size: .65rem;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    box-shadow: 0 2px 8px rgba(245,158,11,.5);
    pointer-events: none;
}

/* ── Sub-filtro de pagamento ──────────────────────────────── */
.rep-paysub-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: 20px;
    border: 1px solid rgba(245,158,11,.35);
    background: rgba(245,158,11,.08);
    color: #f59e0b;
    font-size: .8rem;
    font-weight: 600;
    font-family: 'Poppins', sans-serif;
    cursor: pointer;
    transition: background .15s, border-color .15s;
}
.rep-paysub-btn:active { background: rgba(245,158,11,.2); }
.rep-paysub-btn.rep-paysub-active {
    background: rgba(245,158,11,.22);
    border-color: rgba(245,158,11,.7);
}
.rep-paysub-count {
    background: #f59e0b;
    color: #000;
    font-size: .68rem;
    font-weight: 800;
    border-radius: 20px;
    padding: 1px 6px;
    line-height: 1.4;
}

/* ── Pill de pagamento clicável ───────────────────────────── */
.rep-pag-pill-btn {
    cursor: pointer;
    border: none;
    font-family: 'Poppins', sans-serif;
    font-size: inherit;
    transition: opacity .15s, transform .1s;
    display: inline-flex !important;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    line-height: 1.2;
}
.rep-pag-pill-btn:active { opacity: .75; transform: scale(.96); }
.rep-pag-pill-main {
    font-size: .75rem;
    font-weight: 700;
    white-space: nowrap;
}
.rep-pag-pill-sub {
    font-size: .62rem;
    font-weight: 500;
    opacity: .8;
    white-space: nowrap;
}
.rep-pag-pill-confirming {
    background: rgba(16,185,129,.18) !important;
    color: #10b981 !important;
    border-color: rgba(16,185,129,.4) !important;
}
.rep-badge-pag-ok {
    background: rgba(16,185,129,.12);
    color: #10b981;
    border: 1px solid rgba(16,185,129,.3);
}

/* ══════════════════════════════════════════════════════════
   TELA FINANCEIRA
══════════════════════════════════════════════════════════ */

/* Período selector */
.fin-periodo-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px 12px;
    flex-wrap: wrap;
}
.fin-periodo-btn {
    padding: 5px 14px;
    border-radius: 20px;
    border: 1px solid var(--glass-border);
    background: transparent;
    color: var(--text-secondary);
    font-size: .78rem;
    font-weight: 600;
    font-family: 'Poppins', sans-serif;
    cursor: pointer;
    transition: background .15s, color .15s, border-color .15s;
}
.fin-periodo-btn.fin-periodo-active {
    background: rgba(var(--primary-color-rgb), .15);
    border-color: rgba(var(--primary-color-rgb), .5);
    color: var(--primary-color);
}
.fin-mes-nav {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
}
.fin-mes-btn {
    background: rgba(255,255,255,.06);
    border: 1px solid var(--glass-border);
    color: var(--text-color);
    border-radius: 8px;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: .8rem;
    transition: background .15s;
}
.fin-mes-btn:active { background: rgba(255,255,255,.14); }
.fin-mes-label {
    font-size: .78rem;
    font-weight: 600;
    color: var(--text-color);
    text-transform: capitalize;
    min-width: 110px;
    text-align: center;
}

/* Cards de resumo */
.fin-cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    padding: 0 12px 14px;
}
.fin-card {
    border-radius: 14px;
    padding: 12px 10px;
    border: 1px solid var(--glass-border);
    background: rgba(255,255,255,.04);
    text-align: center;
}
.fin-card-label {
    font-size: .65rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: .04em;
}
.fin-card-valor {
    font-size: .88rem;
    font-weight: 700;
    color: var(--text-color);
    word-break: break-all;
}
.fin-card-receita { border-color: rgba(16,185,129,.25); }
.fin-card-receita .fin-card-valor { color: #10b981; }
.fin-card-despesa { border-color: rgba(239,68,68,.2); }
.fin-card-despesa .fin-card-valor { color: #ef4444; }
.fin-card-lucro { border-color: rgba(var(--primary-color-rgb),.25); }

/* Botões de ação */
.fin-acoes {
    display: flex;
    gap: 8px;
    padding: 0 12px 14px;
}
.fin-acao-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 11px 12px;
    border-radius: 12px;
    border: none;
    font-size: .82rem;
    font-weight: 700;
    font-family: 'Poppins', sans-serif;
    cursor: pointer;
    transition: opacity .15s;
}
.fin-acao-btn:active { opacity: .75; }
.fin-acao-despesa {
    background: rgba(239,68,68,.15);
    border: 1px solid rgba(239,68,68,.35);
    color: #ef4444;
}
.fin-acao-receita {
    background: rgba(16,185,129,.15);
    border: 1px solid rgba(16,185,129,.35);
    color: #10b981;
}

/* Lista header */
.fin-lista-header {
    padding: 4px 14px 8px;
    font-size: .75rem;
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: .06em;
}

/* Lista de lançamentos */
.fin-lista {
    padding: 0 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-bottom: 100px;
}
.fin-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 12px;
    border-radius: 12px;
    background: rgba(255,255,255,.04);
    border: 1px solid var(--glass-border);
}
.fin-item-icon {
    font-size: 1.2rem;
    flex-shrink: 0;
    width: 28px;
    text-align: center;
}
.fin-item-info {
    flex: 1;
    min-width: 0;
}
.fin-item-desc {
    font-size: .83rem;
    font-weight: 600;
    color: var(--text-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.fin-item-data {
    font-size: .7rem;
    color: var(--text-secondary);
    margin-top: 2px;
}
.fin-item-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    flex-shrink: 0;
}
.fin-item-valor {
    font-size: .85rem;
    font-weight: 700;
}
.fin-del-btn {
    background: none;
    border: none;
    color: rgba(239,68,68,.5);
    font-size: .72rem;
    cursor: pointer;
    padding: 0;
    transition: color .15s;
}
.fin-del-btn:active { color: #ef4444; }

/* Light theme adjustments */
[data-theme="light"] .fin-card { background: rgba(0,0,0,.03); }
[data-theme="light"] .fin-item { background: rgba(0,0,0,.03); }

/* ══════════════════════════════════════════════════════════════
   GARANTIA — Tab pulsante + badges + botão
   ══════════════════════════════════════════════════════════════ */

@keyframes garantia-pulse {
    0%, 100% {
        box-shadow: 0 0 0 0 rgba(245,158,11,.6), 0 0 8px rgba(245,158,11,.3);
        border-color: rgba(245,158,11,.7);
    }
    50% {
        box-shadow: 0 0 0 5px rgba(245,158,11,.0), 0 0 18px rgba(245,158,11,.55);
        border-color: #f59e0b;
    }
}

@keyframes garantia-shine {
    0%   { background-position: -200% center; }
    100% { background-position: 200% center; }
}

/* Tab Garantias — brilha e pulsa */
.rep-filter-garantia {
    color: #f59e0b !important;
    border-color: rgba(245,158,11,.45) !important;
    background: rgba(245,158,11,.08) !important;
    animation: garantia-pulse 2s ease-in-out infinite;
    font-weight: 700 !important;
    position: relative;
    overflow: hidden;
}
.rep-filter-garantia::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(105deg, transparent 30%, rgba(255,220,100,.35) 50%, transparent 70%);
    background-size: 200% 100%;
    animation: garantia-shine 2.4s linear infinite;
    pointer-events: none;
    border-radius: inherit;
}
.rep-filter-garantia.rep-filter-active {
    background: rgba(245,158,11,.18) !important;
    border-color: #f59e0b !important;
}

/* Badge contador na tab */
.rep-garantia-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    background: #f59e0b;
    color: #000;
    border-radius: 8px;
    font-size: .6rem;
    font-weight: 800;
    margin-left: 4px;
    vertical-align: middle;
}

/* Pill "Em garantia" no card */
.rep-badge-garantia-ativa {
    background: rgba(245,158,11,.15);
    color: #f59e0b;
    border: 1px solid rgba(245,158,11,.4);
    animation: garantia-pulse 2s ease-in-out infinite;
}
.rep-badge-garantia-vencida {
    background: rgba(239,68,68,.12);
    color: #ef4444;
    border: 1px solid rgba(239,68,68,.35);
}

/* Card com garantia ativa — borda dourada pulsante */
.rep-card.rep-garantia-card {
    border: 1.5px solid rgba(245,158,11,.5) !important;
    animation: garantia-pulse 2s ease-in-out infinite;
}

/* Botão "Acionar Garantia" nas ações do card */
.rep-btn-garantia {
    background: rgba(245,158,11,.15);
    color: #f59e0b;
    border: 1px solid rgba(245,158,11,.4);
    font-weight: 700;
    gap: 5px;
}
.rep-btn-garantia:active {
    background: rgba(245,158,11,.28);
}
.rep-btn-cancelar-garantia {
    color: rgba(239,68,68,.7);
}

/* ══════════════════════════════════════════════════════════════
   TAGS / ETIQUETAS
   ══════════════════════════════════════════════════════════════ */

/* Pills no card (header) */
.rep-tag-pills-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
    width: 100%;
}
.rep-tag-pill {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 20px;
    font-size: .65rem;
    font-weight: 700;
    letter-spacing: .02em;
    white-space: nowrap;
}

/* Grid de seleção no modal */
.rep-tags-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 4px 0;
}
.rep-tag-option {
    padding: 7px 14px;
    border-radius: 20px;
    border: 1.5px solid var(--tag-cor, #6366f1);
    background: transparent;
    color: var(--tag-cor, #6366f1);
    font-size: .82rem;
    font-weight: 600;
    cursor: pointer;
    transition: background .15s, transform .1s;
}
.rep-tag-option.selected {
    background: color-mix(in srgb, var(--tag-cor, #6366f1) 20%, transparent);
    transform: scale(1.04);
}
.rep-tag-option:active { transform: scale(.97); }

/* Lista na Config */
.cfg-tags-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 4px;
}
.cfg-tag-item {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    padding: 8px 12px;
}
.cfg-tag-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
}
.cfg-tag-nome {
    flex: 1;
    font-size: .85rem;
    font-weight: 600;
    color: var(--text-primary);
    outline: none;
    min-width: 0;
    border-bottom: 1px dashed transparent;
    transition: border-color .15s;
}
.cfg-tag-nome:focus {
    border-color: var(--primary-color);
}
.cfg-tag-cor-btn {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid rgba(255,255,255,.25);
    cursor: pointer;
    flex-shrink: 0;
    transition: transform .15s, border-color .15s;
}
.cfg-tag-cor-btn:active { transform: scale(.9); }
.cfg-tag-del {
    background: none;
    border: none;
    color: rgba(239,68,68,.5);
    cursor: pointer;
    font-size: .8rem;
    padding: 4px;
    border-radius: 6px;
    transition: color .15s, background .15s;
    flex-shrink: 0;
}
.cfg-tag-del:active {
    color: #ef4444;
    background: rgba(239,68,68,.1);
}

[data-theme="light"] .cfg-tag-item { background: rgba(0,0,0,.03); }

/* Grade de cores para etiquetas */
.tag-cor-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    padding: 8px 0;
}
.tag-cor-grid-inline {
    padding: 10px 12px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    margin-bottom: 6px;
}
.tag-cor-swatch {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    font-size: .7rem;
    font-weight: 800;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform .12s, border-color .12s;
    flex-shrink: 0;
}
.tag-cor-swatch:active { transform: scale(.88); }
.tag-cor-swatch.selected {
    border-color: #fff;
    transform: scale(1.15);
}

/* ══════════════════════════════════════════════════════════════
   BANCO DE CLIENTES — Autocomplete + Config
   ══════════════════════════════════════════════════════════════ */

/* Dropdown de sugestões */
.cliente-autocomplete-drop {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: var(--secondary-color, #1a1f36);
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    z-index: 9999;
    box-shadow: 0 8px 24px rgba(0,0,0,.4);
    overflow: hidden;
    max-height: 240px;
    overflow-y: auto;
}
.cliente-autocomplete-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 14px;
    cursor: pointer;
    border-bottom: 1px solid var(--glass-border);
    transition: background .12s;
}
.cliente-autocomplete-item:last-child { border-bottom: none; }
.cliente-autocomplete-item:active,
.cliente-autocomplete-item:hover { background: rgba(255,255,255,.06); }
.cac-nome {
    font-size: .87rem;
    font-weight: 600;
    color: var(--text-primary);
}
.cac-tel {
    font-size: .74rem;
    color: var(--text-secondary);
}

/* Lista de clientes na Config */
.cfg-clientes-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 340px;
    overflow-y: auto;
}
.cfg-cliente-item {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    padding: 10px 12px;
}
.cfg-cliente-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.cfg-cliente-nome {
    font-size: .87rem;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.cfg-cliente-sub {
    font-size: .73rem;
    color: var(--text-secondary);
}
[data-theme="light"] .cliente-autocomplete-drop { background: #fff; }
[data-theme="light"] .cfg-cliente-item { background: rgba(0,0,0,.03); }

/* ══════════════════════════════════════════════════════════════
   ANOTAÇÃO INTERNA
   ══════════════════════════════════════════════════════════════ */

/* Bloco destacado no card expandido */
.rep-anotacao-bloco {
    background: rgba(245,158,11,.08);
    border: 1.5px solid rgba(245,158,11,.35);
    border-left: 4px solid #f59e0b;
    border-radius: 10px;
    padding: 10px 12px;
    margin: 8px 0 4px;
}
.rep-anotacao-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: .72rem;
    font-weight: 700;
    color: #f59e0b;
    margin-bottom: 6px;
    letter-spacing: .04em;
    text-transform: uppercase;
}
.rep-anotacao-edit-btn {
    background: none;
    border: none;
    color: rgba(245,158,11,.7);
    cursor: pointer;
    font-size: .78rem;
    padding: 2px 4px;
    border-radius: 5px;
    transition: color .15s, background .15s;
}
.rep-anotacao-edit-btn:active {
    color: #f59e0b;
    background: rgba(245,158,11,.15);
}
.rep-anotacao-texto {
    font-size: .84rem;
    color: var(--text-primary);
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
}

/* Botão "Adicionar anotação" quando não tem */
/* ── Linha anotação + senha lado a lado ── */
.rep-anotacao-row {
    display: flex;
    align-items: stretch;
    gap: 8px;
    margin: 8px 0 4px;
}
.rep-anotacao-row-com-senha .rep-anotacao-add-btn {
    margin: 0;
    height: 100%;
}
.rep-anotacao-row-com-senha .rep-senha-mini {
    flex-shrink: 0;
    margin-top: 0;
}

.rep-anotacao-add-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    margin: 8px 0 4px;
    padding: 8px 12px;
    background: none;
    border: 1.5px dashed rgba(245,158,11,.3);
    border-radius: 10px;
    color: rgba(245,158,11,.6);
    font-size: .8rem;
    font-weight: 600;
    cursor: pointer;
    transition: border-color .15s, color .15s, background .15s;
    text-align: left;
}
.rep-anotacao-add-btn:active {
    border-color: #f59e0b;
    color: #f59e0b;
    background: rgba(245,158,11,.07);
}

/* Textarea de anotação */
.rep-anotacao-input {
    font-size: .88rem;
    line-height: 1.55;
    resize: none;
    min-height: 90px;
}

/* Pill no header do card (quando recolhido) */
.rep-anotacao-pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 7px;
    border-radius: 20px;
    font-size: .63rem;
    font-weight: 700;
    background: rgba(245,158,11,.15);
    color: #f59e0b;
    border: 1px solid rgba(245,158,11,.35);
    margin-top: 4px;
}

/* ══════════════════════════════════════════════════════════════
   FOTOS POR ETAPA — Step modal e timeline
   ══════════════════════════════════════════════════════════════ */

/* Grade de fotos no modal de etapa */
.rep-step-photos-grid {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 10px;
    min-height: 0;
}
.rep-step-photo-thumb {
    position: relative;
    width: calc(33.333% - 6px);
    aspect-ratio: 1;
    border-radius: 10px;
    overflow: hidden;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
}
.rep-step-photo-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.rep-step-photo-del {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(0,0,0,.65);
    border: none;
    color: #fff;
    font-size: .6rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background .15s;
}
.rep-step-photo-del:active { background: rgba(239,68,68,.85); }

/* Miniaturas de fotos na timeline */
.rep-tl-fotos {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 6px;
}
.rep-tl-foto-thumb {
    width: 52px;
    height: 52px;
    border-radius: 8px;
    overflow: hidden;
    border: 1.5px solid var(--glass-border);
    background: var(--glass-bg);
    padding: 0;
    cursor: pointer;
    transition: transform .12s, border-color .12s;
}
.rep-tl-foto-thumb:active { transform: scale(.93); }
.rep-tl-foto-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

/* ══════════════════════════════════════════════════════════════
   LOADING OVERLAY DE UPLOAD
   ══════════════════════════════════════════════════════════════ */
#repSaveLoadingOverlay {
    position: fixed;
    inset: 0;
    z-index: 99999;
    background: rgba(10, 14, 30, 0.75);
    display: none;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
}
.rep-save-loading-box {
    background: var(--secondary-color, #1a1f36);
    border: 1px solid var(--glass-border);
    border-radius: 18px;
    padding: 28px 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    min-width: 200px;
    box-shadow: 0 20px 60px rgba(0,0,0,.5);
}
.rep-save-loading-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(255,255,255,.1);
    border-top-color: var(--primary-color, #6366f1);
    border-radius: 50%;
    animation: repSpin .75s linear infinite;
}
@keyframes repSpin { to { transform: rotate(360deg); } }
.rep-save-loading-msg {
    font-size: .88rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-align: center;
}



/* Header da tela */
#finScreen .section-header {
    padding: 18px 16px 16px;
    margin: 0;
    border-radius: 0;
}

/* Seletor de período */
.fin-periodo-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--glass-border);
    flex-wrap: wrap;
    flex-shrink: 0;
}
.fin-periodo-btn {
    padding: 5px 14px;
    border-radius: 20px;
    border: 1px solid var(--glass-border);
    background: transparent;
    color: var(--text-secondary);
    font-size: .8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background .15s, color .15s, border-color .15s;
}
.fin-periodo-btn.fin-periodo-active {
    background: var(--primary-color);
    color: #fff;
    border-color: var(--primary-color);
}
.fin-nav-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
}
.fin-nav-row button {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 1px solid var(--glass-border);
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: .8rem;
    transition: background .15s;
}
.fin-nav-row button:active { background: var(--glass-bg); }
#finPeriodoLabel {
    font-size: .78rem;
    font-weight: 600;
    color: var(--text-primary);
    min-width: 110px;
    text-align: center;
}

/* Cards de resumo */
.fin-cards-row {
    display: flex;
    gap: 8px;
    padding: 12px;
    flex-shrink: 0;
}
.fin-card {
    flex: 1;
    border-radius: 14px;
    padding: 12px 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--glass-border);
    background: var(--glass-bg);
}
.fin-card-icon { font-size: 1.1rem; }
.fin-card-label {
    font-size: .65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: var(--text-secondary);
}
.fin-card-valor {
    font-size: .88rem;
    font-weight: 800;
    white-space: nowrap;
}
.fin-card-green { border-color: rgba(16,185,129,.3); }
.fin-card-green .fin-card-icon,
.fin-card-green .fin-card-valor { color: #10b981; }

.fin-card-yellow { border-color: rgba(245,158,11,.3); }
.fin-card-yellow .fin-card-icon,
.fin-card-yellow .fin-card-valor { color: #f59e0b; }

.fin-card-blue { border-color: rgba(99,102,241,.3); }
.fin-card-blue .fin-card-icon,
.fin-card-blue .fin-card-valor { color: var(--primary-color); }

/* Título de seção */
.fin-section-title {
    font-size: .7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--text-secondary);
    padding: 8px 0 6px;
}

/* Item de lançamento */
.fin-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 11px 12px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    margin-bottom: 6px;
}
.fin-item-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex: 1;
}
.fin-item-icon { font-size: 1.1rem; flex-shrink: 0; }
.fin-item-nome {
    font-size: .84rem;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.fin-item-sub {
    font-size: .7rem;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.fin-item-valor {
    font-size: .88rem;
    font-weight: 800;
    flex-shrink: 0;
}

[data-theme="light"] .fin-card { background: rgba(0,0,0,.03); }
[data-theme="light"] .fin-item { background: rgba(0,0,0,.03); }



/* Toggle tipo despesa/receita */
.fin-tipo-toggle {
    display: flex;
    gap: 8px;
}
.fin-tipo-btn {
    flex: 1;
    padding: 9px;
    border-radius: 10px;
    border: 1.5px solid var(--glass-border);
    background: transparent;
    font-size: .85rem;
    font-weight: 700;
    cursor: pointer;
    transition: background .15s, border-color .15s, color .15s;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
}
.fin-tipo-despesa.fin-tipo-active {
    background: rgba(239,68,68,.15);
    border-color: #ef4444;
    color: #ef4444;
}
.fin-tipo-receita.fin-tipo-active {
    background: rgba(16,185,129,.15);
    border-color: #10b981;
    color: #10b981;
}

/* Botões inline do item */
.fin-item-edit-btn, .fin-item-del-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px 5px;
    border-radius: 6px;
    font-size: .72rem;
    color: var(--text-secondary);
    transition: color .15s, background .15s;
}
.fin-item-edit-btn:active { color: var(--primary-color); background: rgba(99,102,241,.1); }
.fin-item-del-btn:active  { color: #ef4444; background: rgba(239,68,68,.1); }

/* Range customizado */
.fin-custom-range-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
}

/* Dia "Hoje" label */
#finPeriodoPrev:disabled, #finPeriodoNext:disabled {
    opacity: .3;
    cursor: default;
}


.fin-cards-2x2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 12px;
    flex-shrink: 0;
}
.fin-card-red { border-color: rgba(239,68,68,.3); }
.fin-card-red .fin-card-icon,
.fin-card-red .fin-card-valor { color: #ef4444; }

/* ══════════════════════════════════════════════════════════════
   FINANCEIRO — Opção 3: Premium Minimal
   ══════════════════════════════════════════════════════════════ */

/* ── Header ─────────────────────────────────────────────────── */
.fin-header {
    padding: 18px 16px 14px;
    flex-shrink: 0;
    background: linear-gradient(180deg, rgba(15,30,60,.92) 0%, rgba(9,17,31,.65) 100%);
    border-bottom: 1px solid rgba(255,255,255,.06);
    position: relative;
    overflow: hidden;
}
/* Linha decorativa verde embaixo do header */
.fin-header::after {
    content: '';
    position: absolute;
    bottom: 0; left: 10%; right: 10%;
    height: 1.5px;
    border-radius: 99px;
    background: linear-gradient(90deg, transparent, rgba(52,211,153,.5), transparent);
}
.fin-header-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 14px;
}
.fin-header-title {
    font-size: 1.22rem;
    font-weight: 800;
    color: #fff;
    letter-spacing: -.02em;
    line-height: 1.1;
}
.fin-header-sub {
    font-size: .65rem;
    color: #34d399;
    font-weight: 600;
    letter-spacing: .04em;
    margin-top: 3px;
}
.fin-header-badge {
    background: rgba(52,211,153,.12);
    border: 1px solid rgba(52,211,153,.25);
    border-radius: 12px;
    padding: 5px 14px;
    font-size: .72rem;
    font-weight: 700;
    color: #34d399;
    white-space: nowrap;
    flex-shrink: 0;
}
.fin-header-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

/* Pills de período */
.fin-periodo-bar {
    display: flex;
    gap: 4px;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
}
.fin-periodo-bar::-webkit-scrollbar { display: none; }
.fin-periodo-btn {
    padding: 4px 10px;
    border-radius: 20px;
    font-size: .72rem;
    font-weight: 600;
    border: 1px solid rgba(255,255,255,.1);
    background: transparent;
    color: rgba(255,255,255,.4);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: background .15s, color .15s, border-color .15s;
}
.fin-periodo-btn.fin-periodo-active {
    background: rgba(255,255,255,.12);
    border-color: rgba(255,255,255,.22);
    color: #fff;
}

/* Setas de navegação */
.fin-nav-row {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
}
.fin-nav-row button {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: none;
    background: rgba(255,255,255,.08);
    color: rgba(255,255,255,.5);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: .78rem;
    transition: background .15s, color .15s;
}
.fin-nav-row button:active { background: rgba(255,255,255,.18); color: #fff; }
.fin-nav-row button:disabled { opacity: .25; cursor: default; }

/* Range customizado */
.fin-custom-range-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--glass-border);
    flex-shrink: 0;
}

/* ── Faixa de 4 cards flat ──────────────────────────────────── */
.fin-cards-strip {
    display: flex;
    border-bottom: 1px solid rgba(255,255,255,.05);
    flex-shrink: 0;
}
.fin-strip-card {
    flex: 1;
    padding: 12px 4px 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    border-right: 1px solid rgba(255,255,255,.05);
    position: relative;
    min-width: 0;
}
.fin-strip-card:last-child { border-right: none; }
/* Barra colorida embaixo de cada card */
.fin-strip-card::before {
    content: '';
    position: absolute;
    bottom: 0; left: 18%; right: 18%;
    height: 2px;
    border-radius: 2px 2px 0 0;
}
.fin-strip-card i { font-size: .9rem; }
.fin-strip-lbl {
    font-size: .5rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .05em;
    color: var(--text-secondary);
    text-align: center;
}
.fin-strip-val {
    font-size: .76rem;
    font-weight: 800;
    white-space: nowrap;
    text-align: center;
}
.fin-strip-g i, .fin-strip-g .fin-strip-val { color: #10b981; }
.fin-strip-g::before { background: #10b981; }
.fin-strip-y i, .fin-strip-y .fin-strip-val { color: #f59e0b; }
.fin-strip-y::before { background: #f59e0b; }
.fin-strip-r i, .fin-strip-r .fin-strip-val { color: #ef4444; }
.fin-strip-r::before { background: #ef4444; }
.fin-strip-b i, .fin-strip-b .fin-strip-val { color: var(--primary-color); }
.fin-strip-b::before { background: var(--primary-color); }

/* ── Seção + itens ──────────────────────────────────────────── */
.fin-section-title {
    font-size: .62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .07em;
    color: var(--text-secondary);
}
.fin-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 11px 12px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    margin-bottom: 6px;
}
.fin-item-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex: 1;
}
.fin-item-icon { font-size: 1.1rem; flex-shrink: 0; }
.fin-item-nome {
    font-size: .84rem;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.fin-item-sub {
    font-size: .7rem;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.fin-item-valor { font-size: .88rem; font-weight: 800; flex-shrink: 0; }
.fin-item-edit-btn, .fin-item-del-btn {
    background: none; border: none; cursor: pointer;
    padding: 4px 5px; border-radius: 6px;
    font-size: .72rem; color: var(--text-secondary);
    transition: color .15s, background .15s;
}
.fin-item-edit-btn:active { color: var(--primary-color); background: rgba(99,102,241,.1); }
.fin-item-del-btn:active  { color: #ef4444; background: rgba(239,68,68,.1); }

/* ── Toggle despesa/receita no modal ────────────────────────── */
.fin-tipo-toggle { display: flex; gap: 8px; }
.fin-tipo-btn {
    flex: 1; padding: 9px; border-radius: 10px;
    border: 1.5px solid var(--glass-border);
    background: transparent; font-size: .85rem; font-weight: 700;
    cursor: pointer; color: var(--text-secondary);
    display: flex; align-items: center; justify-content: center; gap: 6px;
    transition: background .15s, border-color .15s, color .15s;
}
.fin-tipo-despesa.fin-tipo-active { background: rgba(239,68,68,.15); border-color: #ef4444; color: #ef4444; }
.fin-tipo-receita.fin-tipo-active { background: rgba(16,185,129,.15); border-color: #10b981; color: #10b981; }

[data-theme="light"] .fin-header { background: linear-gradient(180deg, rgba(230,245,255,.95) 0%, rgba(240,248,255,.7) 100%); }
[data-theme="light"] .fin-header-title { color: #0f172a; }
[data-theme="light"] .fin-header-sub { color: #059669; }
[data-theme="light"] .fin-header-badge { background: rgba(5,150,105,.1); border-color: rgba(5,150,105,.25); color: #059669; }
[data-theme="light"] .fin-periodo-btn { border-color: rgba(0,0,0,.12); color: rgba(0,0,0,.4); }
[data-theme="light"] .fin-periodo-btn.fin-periodo-active { background: rgba(0,0,0,.08); border-color: rgba(0,0,0,.2); color: #0f172a; }
[data-theme="light"] .fin-nav-row button { background: rgba(0,0,0,.06); color: rgba(0,0,0,.4); }
[data-theme="light"] .fin-item { background: rgba(0,0,0,.03); }

/* ============================================================
   TAB BAR — Layout Tab do card de conserto
   ============================================================ */

/* Barra de abas */
.rep-tabs {
    display: flex;
    border-bottom: 1px solid var(--glass-border);
    margin: 0 -14px;          /* sangra até a borda do card */
    padding: 0 14px;
    gap: 0;
    background: rgba(255,255,255,.02);
}

.rep-tab-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 9px 4px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--text-secondary);
    font-size: .7rem;
    font-weight: 700;
    font-family: 'Poppins', sans-serif;
    cursor: pointer;
    transition: color .18s, border-color .18s;
    white-space: nowrap;
    -webkit-tap-highlight-color: transparent;
    position: relative;
}

.rep-tab-btn:hover { color: var(--text-color); }

.rep-tab-active {
    color: var(--primary-color) !important;
    border-bottom-color: var(--primary-color) !important;
}

/* Badge numérico (saldo pendente) na aba Pagamento */
.rep-tab-pag-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: .55rem;
    font-weight: 800;
    padding: 1px 5px;
    border-radius: 999px;
    background: rgba(249,115,22,.2);
    color: var(--rep-orange);
    border: 1px solid rgba(249,115,22,.35);
    margin-left: 2px;
    line-height: 1.4;
}
.rep-tab-pag-badge-ok {
    background: rgba(16,185,129,.15);
    color: var(--rep-green);
    border-color: rgba(16,185,129,.3);
}

/* Painéis das abas */
.rep-tab-panel {
    display: none;
    padding-top: 12px;
}
.rep-tab-panel-active {
    display: block;
}

/* ── Aba Pagamento: resumo (Total / Pago / Saldo) ── */
.rep-tab-pag-resumo {
    display: flex;
    align-items: stretch;
    gap: 0;
    background: rgba(255,255,255,.04);
    border: 1px solid var(--glass-border);
    border-radius: 14px;
    overflow: hidden;
    margin-bottom: 12px;
}
.rep-tab-pag-resumo-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 10px 6px;
    gap: 3px;
}
.rep-tab-pag-resumo-sep {
    width: 1px;
    background: var(--glass-border);
    align-self: stretch;
    margin: 8px 0;
}
.rep-tab-pag-resumo-lbl {
    font-size: .6rem;
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: .3px;
}
.rep-tab-pag-resumo-val {
    font-size: .82rem;
    font-weight: 800;
    line-height: 1.1;
    text-align: center;
}

/* ── Histórico de pagamentos ── */
.rep-tab-pag-historico {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 10px;
}

.rep-tab-pag-linha {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgba(255,255,255,.03);
    border: 1px solid var(--glass-border);
}

.rep-tab-pag-linha-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
}
.rep-tab-pag-linha-desc {
    font-size: .76rem;
    font-weight: 700;
    color: var(--text-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.rep-tab-pag-linha-data {
    font-size: .62rem;
    color: var(--text-secondary);
}
.rep-tab-pag-linha-right {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
}
.rep-tab-pag-linha-valor {
    font-size: .8rem;
    font-weight: 800;
    color: var(--rep-green);
    white-space: nowrap;
}

/* Botões de editar/excluir linha — pequenos */
.rep-tab-pag-edit-btn,
.rep-tab-pag-del-btn {
    padding: 4px 7px !important;
    font-size: .62rem !important;
}

/* Estado vazio */
.rep-tab-pag-vazio {
    font-size: .76rem;
    color: var(--text-secondary);
    opacity: .65;
    text-align: center;
    padding: 12px 0;
    line-height: 1.6;
}

/* Título do histórico */
.rep-tab-pag-historico-titulo {
    font-size: .72rem;
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: .04em;
    margin-bottom: 6px;
    opacity: .7;
}

/* Estado sem valor cobrado */
.rep-tab-pag-sem-valor {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 20px 0 10px;
}
.rep-tab-pag-sem-valor-icone {
    font-size: 1.8rem;
    margin-bottom: 6px;
    opacity: .5;
}
.rep-tab-pag-sem-valor-titulo {
    font-size: .82rem;
    font-weight: 700;
    color: var(--text-color);
    opacity: .7;
}
.rep-tab-pag-sem-valor-sub {
    font-size: .72rem;
    color: var(--text-secondary);
    margin-top: 3px;
    opacity: .6;
}

/* Botão "Registrar pagamento" na aba */
.rep-tab-pag-novo-btn {
    width: 100%;
    justify-content: center !important;
    padding: 11px !important;
    margin-top: 2px;
}

/* ── Light theme overrides ── */
[data-theme="light"] .rep-tabs { background: rgba(0,0,0,.02); }
[data-theme="light"] .rep-tab-pag-resumo { background: rgba(0,0,0,.03); }
[data-theme="light"] .rep-tab-pag-linha { background: rgba(0,0,0,.03); }

/* ── Search Type Chips ── */
.rep-search-chip {
    padding: 4px 12px;
    border-radius: 20px;
    border: 1px solid rgba(255,255,255,.1);
    background: rgba(255,255,255,.05);
    color: rgba(255,255,255,.45);
    font-size: .72rem;
    font-weight: 600;
    cursor: pointer;
    transition: all .15s;
}
.rep-search-chip-active {
    background: rgba(255,255,255,.12);
    color: #fff;
    border-color: rgba(255,255,255,.2);
}
.rep-search-chip[data-tipo="final"].rep-search-chip-active {
    background: rgba(139,92,246,.2);
    color: #c4b5fd;
    border-color: rgba(139,92,246,.4);
}
.rep-search-chip-lojista.rep-search-chip-active {
    background: rgba(59,130,246,.2);
    color: #93c5fd;
    border-color: rgba(59,130,246,.4);
}

/* ── Botão Cíclico Tipo Cliente ── */
.rep-tipo-cycle-btn {
    padding: 0 12px;
    height: 40px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,.1);
    background: rgba(255,255,255,.05);
    color: rgba(255,255,255,.4);
    font-size: .72rem;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
    transition: all .2s;
}
.rep-tipo-cycle-btn[data-estado="lojista"] {
    background: rgba(59,130,246,.15);
    color: #60a5fa;
    border-color: rgba(59,130,246,.35);
}
.rep-tipo-cycle-btn[data-estado="final"] {
    background: rgba(139,92,246,.15);
    color: #c4b5fd;
    border-color: rgba(139,92,246,.35);
}

/* ── Estado do Aparelho — checkboxes ─────────────────────── */
.rep-estado-chk {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 9px 10px;
    border-radius: 10px;
    border: 1.5px solid rgba(255,255,255,.1);
    background: rgba(255,255,255,.03);
    cursor: pointer;
    font-size: .8rem;
    font-weight: 500;
    color: var(--text-color);
    transition: background .15s, border-color .15s;
    user-select: none;
}
.rep-estado-chk input[type="checkbox"] {
    width: 15px; height: 15px;
    accent-color: var(--primary-color);
    cursor: pointer;
    flex-shrink: 0;
}
.rep-estado-chk:has(input:checked) {
    border-color: var(--primary-color);
    background: rgba(99,102,241,.1);
}
