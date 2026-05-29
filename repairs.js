// repairs.js — Gerenciamento de Consertos (App Técnico Solo)
// v1.0 — independente do CTW

import { ref, push, update, set, remove, onValue, off, runTransaction, get }
    from "https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js";

// ============================================================
// CONSTANTES — ⚠️ preencher após criar conta Cloudinary
// ============================================================

const REPAIRS_PATH      = 'concertos';
// ⚠️ AMERICACELL — preencha com os dados do Cloudinary da AMÉRICACell
const CLOUDINARY_CLOUD  = window._CLOUDINARY_CLOUD  || 'dvprweomr';
const CLOUDINARY_PRESET = window._CLOUDINARY_PRESET || 'vortex_america';
const CLOUDINARY_URL    = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`;
// Otimiza thumbnail Cloudinary: 120x120, qualidade eco, formato automático
function _thumbOptUrl(url) {
    if (!url || !url.includes('cloudinary.com')) return url;
    return url.replace('/upload/', '/upload/f_auto,q_auto:eco,w_120,h_120,c_fill/');
}


// ── Verificação de licença ─────────────────────────────────
let _licencaStatus = null; // 'ok' | 'aviso' | 'bloqueado'
let _licencaCache  = null;

async function _aplicarBloqueioVisual(bloqueado) {
    const btnNovo = document.getElementById('repNewBtn');
    if (btnNovo) {
        btnNovo.disabled = bloqueado;
        btnNovo.style.opacity = bloqueado ? '.4' : '';
        btnNovo.style.cursor  = bloqueado ? 'not-allowed' : '';
        btnNovo.title = bloqueado ? 'Sistema bloqueado — contate o suporte' : '';
    }
}

async function verificarLicenca() {
    if (!window._firebaseDB) return 'ok';
    try {
        const { get, ref } = await import('https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js');
        const snap = await get(ref(window._firebaseDB, 'config/licenca'));
        if (!snap.exists()) return 'ok';
        const cfg = snap.val();
        _licencaCache = cfg;

        // Bloqueio manual pelo admin
        if (cfg.bloqueado === true) {
            _licencaStatus = 'bloqueado';
            _mostrarBannerLicenca('bloqueado');
            _aplicarBloqueioVisual(true);
            return 'bloqueado';
        }

        // Verificar vencimento
        if (cfg.vencimento) {
            const vence = new Date(cfg.vencimento);
            const hoje  = new Date();
            const dias  = Math.ceil((vence - hoje) / 86400000);
            if (dias < 0) {
                _licencaStatus = 'bloqueado';
                _mostrarBannerLicenca('vencido');
                _aplicarBloqueioVisual(true);
                return 'bloqueado';
            } else if (dias <= 5) {
                _licencaStatus = 'aviso';
                _mostrarBannerLicenca('aviso', dias);
                return 'aviso';
            }
        }
        _licencaStatus = 'ok';
        _aplicarBloqueioVisual(false);
        return 'ok';
    } catch(e) {
        return 'ok'; // em caso de erro, não bloqueia
    }
}

function _mostrarBannerLicenca(tipo, dias) {
    const existing = document.getElementById('_licencaBanner');
    if (existing) existing.remove();

    const msgs = {
        bloqueado: {
            bg:'rgba(239,68,68,.1)', border:'rgba(239,68,68,.3)', color:'#f87171',
            linha1: '🔒 Armazenamento de dados em nuvem suspenso.',
            linha2: 'Entre em contato com o suporte para reativar o serviço.',
        },
        vencido: {
            bg:'rgba(239,68,68,.1)', border:'rgba(239,68,68,.3)', color:'#f87171',
            linha1: '⚠️ Seu armazenamento em nuvem venceu.',
            linha2: 'Entre em contato com o suporte para reativar o serviço.',
        },
        aviso: {
            bg:'rgba(245,158,11,.08)', border:'rgba(245,158,11,.3)', color:'#fbbf24',
            linha1: `⏰ Seu armazenamento em nuvem terá que ser renovado em ${dias} dia${dias===1?'':'s'}. Contate o suporte.`,
            linha2: 'A criação de novos concertos pode ficar suspenso caso não haja renovação. Entre em contato com o suporte para renovação do servico em nuvem.',
        },
    };

    const m = msgs[tipo];
    const banner = document.createElement('div');
    banner.id = '_licencaBanner';
    banner.style.cssText = `
        margin: 12px 16px 0;
        border-radius: 14px;
        padding: 11px 14px;
        background: ${m.bg};
        border: 1px solid ${m.border};
    `;
    banner.innerHTML = `
        <div style="font-size:.77rem;font-weight:700;color:${m.color};margin-bottom:3px;">${m.linha1}</div>
        <div style="font-size:.68rem;color:${m.color};opacity:.8;line-height:1.4;">${m.linha2}</div>
    `;
    // Insere dentro do container de reparos, abaixo do header — não fixa, não sobrepõe nada
    const container = document.getElementById('repairsContainer');
    if (container) container.prepend(banner);
    else document.body.prepend(banner);
}

async function _checarBloqueio() {
    if (_licencaStatus === null) await verificarLicenca();
    return _licencaStatus === 'bloqueado';
}



// Status do workflow (técnico solo)
const STATUS = {
    RECEBIDO:             'recebido',
    AGUARDANDO_PECA:      'aguardando_peca',
    EM_REPARO:            'em_reparo',
    PRONTO:               'pronto',
    REVISAR:              'revisar',
    AGUARDANDO_RETIRADA:  'aguardando_retirada',
    FINALIZADO:           'finalizado',
};

const STATUS_LABEL = {
    [STATUS.RECEBIDO]:            ' Recebido',
    [STATUS.AGUARDANDO_PECA]:     ' Aguardando Peça',
    [STATUS.EM_REPARO]:           ' Em Reparo',
    [STATUS.PRONTO]:              '✅ Finalizado',
    [STATUS.REVISAR]:             'Revisados! 🔎✅',
    [STATUS.AGUARDANDO_RETIRADA]: '📦 Ag. Retirada',
    [STATUS.FINALIZADO]:          '🤝 Entregue',
};

const STATUS_COLOR = {
    [STATUS.RECEBIDO]:            'var(--rep-purple)',
    [STATUS.AGUARDANDO_PECA]:     'var(--rep-yellow)',
    [STATUS.EM_REPARO]:           'var(--rep-blue)',
    [STATUS.PRONTO]:              'var(--rep-green)',
    [STATUS.REVISAR]:             'var(--rep-teal)',
    [STATUS.AGUARDANDO_RETIRADA]: 'var(--rep-orange)',
    [STATUS.FINALIZADO]:          'var(--rep-green)',
};

// Status de pagamento
const PAG_STATUS = {
    RECEBIDO:   'recebido',
    PENDENTE:   'pendente',
};

// Mapa de status anterior (para o undo)
const PREV_STATUS = {
    [STATUS.AGUARDANDO_PECA]: STATUS.RECEBIDO,
    [STATUS.EM_REPARO]:       STATUS.AGUARDANDO_PECA,
    [STATUS.PRONTO]:          STATUS.EM_REPARO,
    [STATUS.REVISAR]:         STATUS.PRONTO,
    [STATUS.FINALIZADO]:      STATUS.REVISAR,
};

// Chave da timeline a remover ao desfazer
const PREV_TL_KEY = {
    [STATUS.AGUARDANDO_PECA]: 'aguardando_peca',
    [STATUS.EM_REPARO]:       'em_reparo',
    [STATUS.PRONTO]:          'pronto',
    [STATUS.REVISAR]:         'revisar',
    [STATUS.FINALIZADO]:      'finalizado',
};


// ============================================================
// STATE
// ============================================================
let db;
let repairsListener = null;
let allRepairs      = [];
let activeFilter    = 'all';
let activeTipoFilter = 'todos'; // 'todos' | 'lojista' | 'final' | 'instagram' | 'fisica'
let activePayFilter = 'all';
let repairPhotoBlob = null;
let repairPhotoUrl  = '';
let repairPhotos    = [];
let stepPhotoBlob   = null; // mantido por compat — não mais usado
let stepPhotoUrl    = ''; // mantido por compat
let _stepPhotos     = []; // array [{blob, url}] até 5 fotos por etapa
const STEP_MAX_PHOTOS = 5;

// ── Banco de Clientes ─────────────────────────────────────────
const CLIENTES_PATH = 'clientes';
let _clientesCache  = []; // [{id, nome, telefone, cpf}]

async function _gerarClienteId() {
    const d = getDb();
    if (!d) return 'c_' + Date.now();
    const counterRef = ref(d, 'contadores/clientes');
    let numero = 1;
    const result = await runTransaction(counterRef, (atual) => {
        numero = (atual || 0) + 1;
        return numero;
    });
    if (result && result.snapshot) numero = result.snapshot.val();
    return 'c_' + String(numero).padStart(4, '0');
}

// Listener em tempo real — única fonte de verdade para o cache
let _clientesListener = null;
function clientesListen() {
    const d = getDb();
    if (!d || _clientesListener) return;
    _clientesListener = onValue(ref(d, CLIENTES_PATH), snap => {
        _clientesCache = [];
        if (snap.exists()) {
            snap.forEach(c => { _clientesCache.push({ id: c.key, ...c.val() }); });
        }
        if (typeof window._clientesRender === 'function') window._clientesRender();
        // Checar aniversários sempre que o cache atualizar
        if (typeof window._checarAniversarios === 'function') {
            window._checarAniversarios();
        }
    });
}

async function clientesUpsert(nome, dados) {
    // dados = objeto com campos pessoais (sem dados do aparelho)
    const d = getDb();
    if (!d || !nome) return;

    // Tenta encontrar cliente existente pelo telefone (mais confiável) ou nome
    const tel = (dados?.telefone || '').replace(/\D/g, '');
    let existing = null;

    if (tel) {
        existing = _clientesCache.find(c =>
            (c.telefone || '').replace(/\D/g, '') === tel
        );
    }
    if (!existing) {
        const nomeNorm = nome.toLowerCase().trim();
        existing = _clientesCache.find(c =>
            (c.nome || '').toLowerCase().trim() === nomeNorm
        );
    }

    const g = (key) => dados?.[key] || existing?.[key] || '';
    const payload = {
        nome:             nome,
        telefone:         g('telefone'),
        cpf:              g('cpf'),
        canal:            g('canal'),
        tipoCliente:      g('tipoCliente'),
        instagramCliente: g('instagramCliente'),
        cep:              g('cep'),
        rua:              g('rua'),
        numeroEndereco:   g('numeroEndereco'),
        complemento:      g('complemento'),
        bairro:           g('bairro'),
        cidade:           g('cidade'),
        endereco:         g('endereco'),
        dataNascimento:   g('dataNascimento'),
        tsAtual:          Date.now(),
    };

    if (existing) {
        // Atualiza cliente existente — NUNCA cria duplicata
        const idx = _clientesCache.findIndex(c => c.id === existing.id);
        if (idx >= 0) _clientesCache[idx] = { id: existing.id, ...payload };
        try {
            await set(ref(d, `${CLIENTES_PATH}/${existing.id}`), payload);
        } catch(e) {
            console.warn('[Clientes] upsert error', e);
        }
    } else {
        // Cliente novo — gera ID incremental único (c_0001, c_0002, ...)
        const novoId = await _gerarClienteId();
        _clientesCache.push({ id: novoId, ...payload });
        try {
            await set(ref(d, `${CLIENTES_PATH}/${novoId}`), payload);
        } catch(e) {
            console.warn('[Clientes] upsert error', e);
        }
    }
}

function clientesBusca(termo) {
    if (!termo || termo.length < 1) return [];
    const t = termo.toLowerCase();
    return _clientesCache
        .filter(c => c.nome && c.nome.toLowerCase().includes(t))
        .sort((a, b) => a.nome.localeCompare(b.nome))
        .slice(0, 6);
}

// ── Autocomplete genérico ─────────────────────────────────────
function montarAutocomplete({ inputId, telId, cpfId, onSelect }) {
    const input = document.getElementById(inputId);
    if (!input) return;

    // Cria dropdown
    const drop = document.createElement('div');
    drop.className = 'cliente-autocomplete-drop';
    drop.style.display = 'none';
    input.parentNode.style.position = 'relative';
    input.parentNode.appendChild(drop);

    function fechar() { drop.style.display = 'none'; drop.innerHTML = ''; }

    input.addEventListener('input', () => {
        const termo = input.value.trim();
        const res = clientesBusca(termo);
        if (!res.length || !termo) { fechar(); return; }
        drop.innerHTML = res.map(c =>
            `<div class="cliente-autocomplete-item" data-id="${c.id}">
                <span class="cac-nome">${escHtml(c.nome)}</span>
                ${c.telefone ? `<span class="cac-tel">${escHtml(c.telefone)}</span>` : ''}
            </div>`
        ).join('');
        drop.style.display = 'block';
        drop.querySelectorAll('.cliente-autocomplete-item').forEach(item => {
            function selecionarItem(e) {
                e.preventDefault();
                const id = item.dataset.id;
                const cli = _clientesCache.find(c => c.id === id);
                if (!cli) return;
                input.value = cli.nome;
                if (telId) { const el = document.getElementById(telId); if (el) el.value = cli.telefone || ''; }
                if (cpfId) { const el = document.getElementById(cpfId); if (el) el.value = cli.cpf || ''; }
                if (onSelect) onSelect(cli);
                fechar();
            }
            item.addEventListener('mousedown', selecionarItem);
            item.addEventListener('touchstart', selecionarItem, { passive: false });
        });
    });

    input.addEventListener('blur', () => setTimeout(fechar, 150));
    input.addEventListener('keydown', e => { if (e.key === 'Escape') fechar(); });
}

// ── Expor para index.html (modo venda) ───────────────────────
window._clientesBusca  = clientesBusca;
window._clientesUpsert = clientesUpsert;
window._montarAutocompleteCliente = montarAutocomplete;

// ── Tela de Clientes na Config ───────────────────────────────
// ── Helpers de aniversário ─────────────────────────────────
function _clienteAniversarioHoje(c) {
    if (!c.dataNascimento) return false;
    const hoje = new Date();
    const mm = String(hoje.getMonth() + 1).padStart(2,'0');
    const dd = String(hoje.getDate()).padStart(2,'0');
    return c.dataNascimento.slice(5) === `${mm}-${dd}`;
}

function _formatarNascimento(iso) {
    if (!iso) return '';
    const [,m,d] = iso.split('-');
    return `${d}/${m}`;
}

// ── Render lista de clientes ────────────────────────────────
window._clientesRender = function() {
    const list = document.getElementById('cfgClientesList');
    if (!list) return;
    const busca = (document.getElementById('cfgClientesBusca')?.value || '').toLowerCase();
    let items = busca
        ? _clientesCache.filter(c => c.nome?.toLowerCase().includes(busca) || c.telefone?.includes(busca) || c.cpf?.includes(busca))
        : [..._clientesCache];
    items.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

    if (!items.length) {
        list.innerHTML = '<p style="font-size:.8rem;color:var(--text-secondary);text-align:center;padding:20px 0;">' + (busca ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.') + '</p>';
        return;
    }

    list.innerHTML = items.map(c => {
        const isInsta   = c.canal === 'instagram';
        const aniv      = _clienteAniversarioHoje(c);
        const canalIcon = isInsta ? '<i class="bi bi-instagram" style="color:#e1306c;font-size:.7rem;"></i>' : '<i class="bi bi-shop-window" style="color:var(--primary-color);font-size:.7rem;"></i>';
        const nascStr   = c.dataNascimento ? `<span style="font-size:.68rem;color:#f472b6;margin-left:4px;">${aniv ? '🎂' : '🗓️'} ${_formatarNascimento(c.dataNascimento)}</span>` : '';
        const cpfStr    = (!isInsta && c.cpf) ? `<span style="font-size:.65rem;color:var(--text-secondary);margin-top:2px;display:block;"><i class="bi bi-person-vcard" style="opacity:.6;"></i> CPF: ${escHtml(c.cpf)}</span>` : '';
        const subInfo   = [
            c.telefone || '',
            isInsta ? (c.instagramCliente || '') : '',
        ].filter(Boolean).join(' · ');
        const wppNum    = (c.telefone || '').replace(/\D/g,'');
        const wppLink   = wppNum ? `https://wa.me/55${wppNum}` : '';

        return `<div class="cfg-cliente-item${aniv ? ' cfg-cliente-aniv' : ''}" data-id="${c.id}" style="${aniv ? 'border-left:3px solid #f472b6;background:rgba(244,114,182,.06);' : ''}">
            <div class="cfg-cliente-info" style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                    ${canalIcon}
                    <span class="cfg-cliente-nome">${escHtml(c.nome || '—')}</span>
                    ${nascStr}
                </div>
                <span class="cfg-cliente-sub" style="display:block;margin-top:2px;">${escHtml(subInfo)}</span>
                ${cpfStr}
                ${(c.cidade || c.bairro) ? `<span style="font-size:.65rem;color:var(--text-secondary);opacity:.6;">${escHtml([c.bairro,c.cidade].filter(Boolean).join(', '))}</span>` : ''}
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;align-items:center;">
                ${wppLink ? `<a href="${wppLink}" target="_blank" rel="noopener"
                    style="width:32px;height:32px;border-radius:10px;border:1px solid rgba(37,211,102,.3);background:rgba(37,211,102,.08);color:#25d366;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.85rem;text-decoration:none;" title="WhatsApp">
                    <i class="bi bi-whatsapp"></i>
                </a>` : ''}
                <button class="cfg-cliente-edit" data-id="${c.id}" title="Editar cliente"
                    style="width:32px;height:32px;border-radius:10px;border:1px solid rgba(99,130,230,.3);background:rgba(99,130,230,.08);color:#818cf8;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.8rem;">
                    <i class="bi bi-pencil-fill"></i>
                </button>
                <button class="cfg-tag-del cfg-cliente-del" data-id="${c.id}" title="Remover cliente"
                    style="width:32px;height:32px;border-radius:10px;border:1px solid rgba(239,68,68,.25);background:rgba(239,68,68,.07);color:#f87171;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.8rem;">
                    <i class="bi bi-trash-fill"></i>
                </button>
            </div>
        </div>`;
    }).join('');

    // ── Botão Editar ──────────────────────────────────────────
    list.querySelectorAll('.cfg-cliente-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const c = _clientesCache.find(x => x.id === btn.dataset.id);
            if (c) _abrirEditarCliente(c);
        });
    });

    // ── Botão Deletar ─────────────────────────────────────────
    list.querySelectorAll('.cfg-cliente-del').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            const c = _clientesCache.find(x => x.id === id);
            if (!c) return;
            const oldOv = document.getElementById('cfgClienteDelOverlay');
            if (oldOv) oldOv.remove();
            const ov = document.createElement('div');
            ov.id = 'cfgClienteDelOverlay';
            ov.className = 'rep-modal-overlay';
            ov.innerHTML = `
            <div class="rep-modal" style="max-width:340px;">
                <div class="rep-modal-header">
                    <span>🗑️ Remover cliente</span>
                    <button class="rep-modal-close" id="cfgCliDelClose"><i class="bi bi-x-lg"></i></button>
                </div>
                <div class="rep-modal-body" style="gap:14px;">
                    <div style="padding:14px 16px;border-radius:14px;background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);font-size:.88rem;color:var(--text-color);line-height:1.5;">
                        Deseja remover <strong style="color:#e2e8f0;">${escHtml(c.nome)}</strong> do banco de clientes?<br>
                        <span style="font-size:.75rem;color:var(--text-secondary);opacity:.7;">Esta ação não pode ser desfeita.</span>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <button id="cfgCliDelCancelar" class="rep-btn rep-btn-ghost" style="flex:1;justify-content:center;padding:12px;">Cancelar</button>
                        <button id="cfgCliDelConfirmar" class="rep-btn rep-btn-danger" style="flex:1;justify-content:center;padding:12px;">
                            <i class="bi bi-trash-fill"></i> Remover
                        </button>
                    </div>
                </div>
            </div>`;
            document.body.appendChild(ov);
            const fechar = () => { ov.classList.remove('active'); setTimeout(() => ov.remove(), 300); };
            ov.querySelector('#cfgCliDelClose').addEventListener('click', fechar);
            ov.querySelector('#cfgCliDelCancelar').addEventListener('click', fechar);
            ov.addEventListener('click', e => { if (e.target === ov) fechar(); });
            ov.querySelector('#cfgCliDelConfirmar').addEventListener('click', async () => {
                fechar();
                _clientesCache = _clientesCache.filter(x => x.id !== id);
                try { await remove(ref(db, `${CLIENTES_PATH}/${id}`)); } catch(e) {}
                window._clientesRender();
                showToast('🗑️ Cliente removido.');
            });
            ov.classList.add('active');
        });
    });
};

// ── Modal de Edição de Cliente ──────────────────────────────
function _abrirEditarCliente(c) {
    const oldOv = document.getElementById('cfgCliEditOverlay');
    if (oldOv) oldOv.remove();

    const isInsta = (c.canal === 'instagram');

    const ov = document.createElement('div');
    ov.id = 'cfgCliEditOverlay';
    ov.className = 'rep-modal-overlay';
    ov.innerHTML = `
    <div class="rep-modal" style="max-width:420px;">
        <div class="rep-modal-header">
            <span>✏️ Editar Cliente</span>
            <button class="rep-modal-close" id="cfgCliEditClose"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="rep-modal-body" style="gap:10px;">

            <!-- Avatar + nome -->
            <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid var(--glass-border);margin-bottom:2px;">
                <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--primary-color),#818cf8);display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:700;color:#fff;flex-shrink:0;">
                    ${escHtml((c.nome||'?')[0].toUpperCase())}
                </div>
                <div>
                    <div style="font-weight:700;font-size:.92rem;">${escHtml(c.nome||'')}</div>
                    <div style="font-size:.72rem;color:var(--text-secondary);margin-top:1px;">
                        ${isInsta ? '<i class="bi bi-instagram" style="color:#e1306c;"></i> Instagram' : '<i class="bi bi-shop-window" style="color:var(--primary-color);"></i> Loja Física'}
                    </div>
                </div>
            </div>

            <!-- Nome -->
            <div class="rep-field">
                <label><i class="bi bi-person-fill"></i> Nome completo</label>
                <input type="text" id="cfgCliEditNome" class="form-control" value="${escHtml(c.nome||'')}">
            </div>

            <!-- Telefone -->
            <div class="rep-field">
                <label><i class="bi bi-telephone-fill"></i> Telefone</label>
                <input type="tel" id="cfgCliEditTel" class="form-control" value="${escHtml(c.telefone||'')}">
            </div>

            ${isInsta ? `
            <!-- Instagram -->
            <div class="rep-field">
                <label><i class="bi bi-instagram" style="color:#e1306c;"></i> @Instagram</label>
                <input type="text" id="cfgCliEditInsta" class="form-control" value="${escHtml(c.instagramCliente||'')}">
            </div>
            <!-- Endereço Instagram -->
            <div style="font-size:.7rem;font-weight:700;color:var(--text-secondary);letter-spacing:.5px;text-transform:uppercase;margin:4px 0 2px;">
                <i class="bi bi-geo-alt-fill" style="color:#e1306c;"></i> Endereço para envio
            </div>
            <div class="rep-field">
                <label>CEP</label>
                <input type="text" id="cfgCliEditCep" class="form-control" value="${escHtml(c.cep||'')}" inputmode="numeric" maxlength="9">
            </div>
            <div class="rep-field">
                <label>Rua</label>
                <input type="text" id="cfgCliEditRua" class="form-control" value="${escHtml(c.rua||'')}">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div class="rep-field"><label>Número</label><input type="text" id="cfgCliEditNumero" class="form-control" value="${escHtml(c.numeroEndereco||'')}"></div>
                <div class="rep-field"><label>Complemento</label><input type="text" id="cfgCliEditCompl" class="form-control" value="${escHtml(c.complemento||'')}"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div class="rep-field"><label>Bairro</label><input type="text" id="cfgCliEditBairro" class="form-control" value="${escHtml(c.bairro||'')}"></div>
                <div class="rep-field"><label>Cidade</label><input type="text" id="cfgCliEditCidade" class="form-control" value="${escHtml(c.cidade||'')}"></div>
            </div>
            ` : `
            <!-- CPF -->
            <div class="rep-field">
                <label><i class="bi bi-person-vcard-fill"></i> CPF</label>
                <input type="text" id="cfgCliEditCpf" class="form-control" value="${escHtml(c.cpf||'')}" inputmode="numeric" maxlength="14">
            </div>
            <!-- Endereço Loja Física -->
            <div class="rep-field">
                <label><i class="bi bi-geo-alt-fill"></i> Endereço</label>
                <input type="text" id="cfgCliEditEndereco" class="form-control" value="${escHtml(c.endereco||'')}">
            </div>
            `}

            <!-- Nascimento — ambos os canais -->
            <div class="rep-field">
                <label><i class="bi bi-cake2-fill" style="color:#f472b6;"></i> Data de Nascimento</label>
                <input type="date" id="cfgCliEditNasc" class="form-control" value="${escHtml(c.dataNascimento||'')}">
            </div>

            <!-- Tipo cliente -->
            <div class="rep-field">
                <label><i class="bi bi-tag-fill"></i> Tipo</label>
                <select id="cfgCliEditTipo" class="form-control" style="background:var(--card-bg);">
                    <option value="final"   ${(c.tipoCliente||'final')==='final'   ? 'selected' : ''}>👤 Pessoa Física</option>
                    <option value="lojista" ${(c.tipoCliente||'')==='lojista' ? 'selected' : ''}>🏪 Lojista</option>
                </select>
            </div>

        </div>
        <div class="rep-modal-footer">
            <button class="rep-btn rep-btn-ghost" id="cfgCliEditCancelar">Cancelar</button>
            <button class="rep-btn rep-btn-primary" id="cfgCliEditSalvar">
                <i class="bi bi-check-lg"></i> Salvar
            </button>
        </div>
    </div>`;
    document.body.appendChild(ov);

    const fechar = () => { ov.classList.remove('active'); setTimeout(() => ov.remove(), 300); };
    ov.querySelector('#cfgCliEditClose').addEventListener('click', fechar);
    ov.querySelector('#cfgCliEditCancelar').addEventListener('click', fechar);
    ov.addEventListener('click', e => { if (e.target === ov) fechar(); });

    ov.querySelector('#cfgCliEditSalvar').addEventListener('click', async () => {
        const btn = ov.querySelector('#cfgCliEditSalvar');
        btn.disabled = true;
        btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Salvando...';

        const g = (id) => (ov.querySelector('#' + id)?.value?.trim() || '');

        const novoNome = g('cfgCliEditNome') || c.nome;
        const payload = {
            nome:           novoNome,
            telefone:       g('cfgCliEditTel'),
            canal:          c.canal || 'fisica',
            tipoCliente:    g('cfgCliEditTipo'),
            dataNascimento: g('cfgCliEditNasc'),
            tsAtual:        Date.now(),
        };

        if (isInsta) {
            payload.instagramCliente = g('cfgCliEditInsta');
            payload.cep              = g('cfgCliEditCep');
            payload.rua              = g('cfgCliEditRua');
            payload.numeroEndereco   = g('cfgCliEditNumero');
            payload.complemento      = g('cfgCliEditCompl');
            payload.bairro           = g('cfgCliEditBairro');
            payload.cidade           = g('cfgCliEditCidade');
        } else {
            payload.cpf      = g('cfgCliEditCpf');
            payload.endereco = g('cfgCliEditEndereco');
        }

        try {
            const d = getDb();
            const idOriginal = c.id; // sempre usa o ID original, nunca muda

            // Atualiza o nó original no Firebase — ID nunca muda independente do nome
            await set(ref(d, `${CLIENTES_PATH}/${idOriginal}`), payload);

            // Atualiza cache local
            const idx = _clientesCache.findIndex(cx => cx.id === idOriginal);
            if (idx >= 0) _clientesCache[idx] = { id: idOriginal, ...payload };
            else _clientesCache.push({ id: idOriginal, ...payload });

            fechar();
            if (typeof window._clientesRender === 'function') window._clientesRender();
            showToast('✅ Cliente atualizado!');
        } catch(e) {
            showToast('❌ Erro ao salvar: ' + e.message);
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-check-lg"></i> Salvar';
        }
    });

    ov.classList.add('active');
}

// ── Checar aniversários (usa o cache local já carregado) ────
window._checarAniversarios = function() {
    const aniversariantes = _clientesCache.filter(_clienteAniversarioHoje);
    // Salva globalmente para o painel de alertas usar (com dados completos para WPP)
    window._aniversariantesHoje = aniversariantes;
    // Notifica o painel de alertas para atualizar o badge e os cards
    if (typeof window._repAtualizarAniversarios === 'function') {
        window._repAtualizarAniversarios(aniversariantes);
    }
    // Banner removido — aniversários agora ficam na aba de Alertas
};

function _mostrarBannerAniversario(nomes) {
    const existente = document.getElementById('_bannerAniversario');
    if (existente) existente.remove();

    const banner = document.createElement('div');
    banner.id = '_bannerAniversario';
    banner.style.cssText = [
        'position:fixed','top:0','left:0','right:0','z-index:999997',
        'padding:14px 16px 12px',
        'background:linear-gradient(135deg,#7c3aed 0%,#db2777 100%)',
        'color:#fff','font-family:Poppins,sans-serif',
        'box-shadow:0 4px 24px rgba(0,0,0,.45)',
        'animation:_bAnivIn .35s cubic-bezier(.34,1.4,.64,1) both',
    ].join(';');
    banner.innerHTML = `
        <style>@keyframes _bAnivIn{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}</style>
        <div style="display:flex;align-items:center;gap:10px;">
            <div style="font-size:2rem;flex-shrink:0;">🎂</div>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:700;font-size:.9rem;letter-spacing:-.1px;">
                    ${nomes.length === 1 ? 'Aniversário hoje!' : `${nomes.length} aniversariantes hoje!`}
                </div>
                <div style="font-size:.78rem;opacity:.92;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    ${nomes.slice(0, 4).map(n => '🎉 ' + n).join('  ')}
                </div>
            </div>
            <button id="_bannerAnivClose"
                style="background:rgba(255,255,255,.2);border:none;color:#fff;
                       width:30px;height:30px;border-radius:50%;font-size:15px;
                       cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;">×</button>
        </div>`;
    document.body.prepend(banner);
    document.getElementById('_bannerAnivClose').addEventListener('click', e => {
        e.stopPropagation(); banner.remove();
    });
    // Auto-close após 20s
    setTimeout(() => { if (banner.parentNode) banner.remove(); }, 20000);
}

// Dispara quando clientes carregam do Firebase (onValue já ouve em tempo real)
// _checarAniversarios é chamado no listener do clientesListen após cada update
// ============================================================
// HELPERS
// ============================================================
function getDb() {
    if (db) return db;
    db = window._firebaseDB;
    return db;
}

function getTechName() {
    return localStorage.getItem('techName') || 'Técnico';
}

function getAssistenciaName() {
    return (window.cfgGet ? window.cfgGet('assistenciaName') : localStorage.getItem('assistenciaName')) || 'Assistência Técnica';
}

function tsNow() { return Date.now(); }

// ── Helpers de pagamento (array) ─────────────────────────────
function getPagamentos(r) {
    // Se já tem array de pagamentos, usa direto
    if (Array.isArray(r.pagamentos) && r.pagamentos.length > 0) return r.pagamentos;
    // Migração: valorEntrada antigo vira primeiro item
    if (r.valorEntrada && Number(r.valorEntrada) > 0) {
        const ts = (r.timeline && r.timeline.finalizado && r.timeline.finalizado.ts) || r.tsCadastro || Date.now();
        return [{ valor: Number(r.valorEntrada), ts, desc: 'Entrada' }];
    }
    // Migração: pagamento total já recebido pelo sistema antigo (sem array, sem valorEntrada)
    if (r.pagamento === PAG_STATUS.RECEBIDO && r.valorCobrado) {
        const ts = r.tsPagamentoRecebido || (r.timeline && r.timeline.finalizado && r.timeline.finalizado.ts) || r.tsCadastro || Date.now();
        return [{ valor: Number(r.valorCobrado), ts, desc: 'Recebido' }];
    }
    return [];
}
function getTotalPago(r) {
    return getPagamentos(r).reduce((s, p) => s + Number(p.valor || 0), 0);
}
function getSaldo(r) {
    return Math.max(0, Number(r.valorCobrado || 0) - getTotalPago(r));
}
function isPagamentoPendente(r) {
    if (r.status !== STATUS.FINALIZADO) return false;
    if (!r.valorCobrado) return false;
    return getSaldo(r) > 0;
}

function isVencimentoVencido(r) {
    if (!r.pagamentoVencimento) return false;
    const hoje = new Date().toISOString().slice(0, 10);
    return r.pagamentoVencimento < hoje;
}

function formatVencimento(r) {
    if (!r.pagamentoVencimento) return null;
    const [, m, d] = r.pagamentoVencimento.split('-');
    return `${d}/${m}`;
}

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

function horasAte(isoDate, horaMaxima) {
    if (!isoDate) return null;
    const hora = horaMaxima || '23:59';
    const prazo = new Date(isoDate + 'T' + hora + ':00');
    return (prazo - Date.now()) / 3600000;
}

function prazoStatus(repair) {
    if (repair.status === STATUS.FINALIZADO) return 'ok';
    if (repair.status === STATUS.REVISAR) return 'ok';
    if (repair.status === STATUS.AGUARDANDO_RETIRADA) return 'ok';
    const horas = horasAte(repair.dataMaxima, repair.horaMaxima);
    if (horas === null) return 'ok';
    if (horas < 0)  return 'vencido';
    if (horas <= 8) return 'proximo';
    return 'ok';
}

function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function whatsappLink(tel) {
    const t = (tel || '').replace(/\D/g, '');
    return t ? `https://wa.me/55${t}` : null;
}

function montarMsgWhatsApp(repair) {
    const template = (window.cfgGet ? window.cfgGet('msgWhatsAppRecibo') : localStorage.getItem('msgWhatsAppRecibo')) || '';
    const hora = new Date().getHours();
    const saudacao  = hora < 12 ? 'Bom dia'  : hora < 18 ? 'Boa tarde'  : 'Boa noite';
    const despedida = hora < 12 ? 'ótimo dia' : hora < 18 ? 'ótima tarde' : 'ótima noite';
    const nome     = (repair.nomeCliente || '').split(' ')[0];
    const aparelho = repair.modeloAparelho || repair.descricaoDefeito || 'seu aparelho';
    if (template) {
        return template
            .split('{saudacao}').join(saudacao)
            .split('{despedida}').join(despedida)
            .split('{nome}').join(nome)
            .split('{aparelho}').join(aparelho);
    }
    return saudacao + ' querido(a) ' + nome + '! 😊\nSegue o recibo do serviço no ' + aparelho + '. Qualquer dúvida estou à disposição!';
}

// ============================================================
// TOAST (self-contained, sem dependência do CTW)
// ============================================================
function showToast(msg) {
    let el = document.getElementById('repToast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'repToast';
        el.style.cssText = [
            'position:fixed', 'bottom:90px', 'left:50%', 'transform:translateX(-50%)',
            'background:#1e293b', 'color:#e2e8f0', 'padding:10px 20px', 'border-radius:12px',
            'font-size:.88rem', 'font-weight:600', 'z-index:999999', 'box-shadow:0 4px 20px rgba(0,0,0,.5)',
            'border:1px solid rgba(148,163,184,.15)', 'max-width:88vw', 'text-align:center',
            'transition:opacity .3s ease', 'pointer-events:none'
        ].join(';');
        document.body.appendChild(el);
    }
    el.innerHTML = msg;
    el.style.opacity = '1';
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.style.opacity = '0'; }, 2800);
}

// Abre janela nova para imprimir — único método confiável no Android Chrome.
// Exibe tela de loading escura enquanto renderiza (sem tela branca feia).
// Fecha automaticamente após o diálogo de impressão (onafterprint).
// Igual CTW: carrega html2canvas + html2pdf juntos
async function garantirPdfLibs() {
    function loadScript(url) {
        return new Promise((resolve, reject) => {
            if (document.querySelector('script[src="' + url + '"]')) { resolve(); return; }
            const s = document.createElement('script');
            s.src = url; s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
        });
    }
    await Promise.all([
        loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'),
        loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'),
    ]);
}

function imprimirHTML(htmlContent, isEtiqueta) {
    if (typeof window._mostrarLoadingImpressao === 'function') {
        window._mostrarLoadingImpressao(isEtiqueta ? 'Gerando etiqueta...' : 'Gerando PDF...');
    }

    // html2canvas PRECISA do elemento no DOM para capturar
    // visibility:hidden + z-index negativo = invisível mas no DOM
    const tempDiv = document.createElement('div');
    tempDiv.style.cssText = 'position:fixed;left:0;top:0;width:794px;background:#fff;font-family:Arial,sans-serif;font-size:10pt;color:#000;z-index:-1;visibility:hidden;pointer-events:none;';
    tempDiv.innerHTML = htmlContent;
    document.body.appendChild(tempDiv);

    const esconder = () => {
        if (document.body.contains(tempDiv)) document.body.removeChild(tempDiv);
        if (typeof window._esconderLoadingImpressao === 'function') window._esconderLoadingImpressao();
    };

    const nomeArquivo = isEtiqueta ? 'etiqueta.pdf' : 'recibo.pdf';
    const opt = isEtiqueta ? {
        margin: 0, filename: nomeArquivo,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 4, useCORS: true, allowTaint: true },
        jsPDF: { unit: 'mm', format: [40, 30], orientation: 'landscape' }
    } : {
        margin: [10, 10, 10, 10], filename: nomeArquivo,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, allowTaint: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    garantirPdfLibs().then(() => {
        return html2pdf().set(opt).from(tempDiv).output('blob');
    }).then(async function(pdfBlob) {
        esconder();
        const file = new File([pdfBlob], nomeArquivo, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try { await navigator.share({ files: [file], title: nomeArquivo }); }
            catch(err) {
                if (err.name !== 'AbortError') {
                    const url = URL.createObjectURL(pdfBlob);
                    const a = document.createElement('a'); a.href = url; a.download = nomeArquivo; a.click();
                    URL.revokeObjectURL(url);
                }
            }
        } else {
            const url = URL.createObjectURL(pdfBlob);
            const a = document.createElement('a'); a.href = url; a.download = nomeArquivo; a.click();
            URL.revokeObjectURL(url);
        }
    }).catch(err => {
        esconder();
        showToast('Erro: ' + err.message);
    });
}





// ============================================================
// FOTO: compressão e upload
// ============================================================
async function comprimirFoto(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const MAX = 1080, Q = 0.75;
            let w = img.width, h = img.height;
            if (w > MAX || h > MAX) {
                const r = Math.min(MAX/w, MAX/h);
                w = Math.round(w*r); h = Math.round(h*r);
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
    fd.append('file', blob, 'concerto.webp');
    fd.append('upload_preset', CLOUDINARY_PRESET);
    fd.append('folder', 'concertos_fotos');
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

// ============================================================
// FIREBASE CRUD
// ============================================================
// Gera próximo número sequencial via transação atômica no RTDB
async function proximoNumero(tipo) {
    const d = getDb();
    const counterRef = ref(d, `contadores/${tipo}`);
    let numero = 1;
    const result = await runTransaction(counterRef, (atual) => {
        numero = (atual || 0) + 1;
        return numero;
    });
    // RTDB: result.snapshot.val() tem o valor final
    if (result && result.snapshot) {
        numero = result.snapshot.val();
    }
    return numero;
}

async function saveRepair(data) {
    const d = getDb();
    if (!d) {
        console.error('[saveRepair] ❌ Firebase DB não disponível');
        throw new Error('Firebase não disponível');
    }
    if (data.id) {
        // Edição — usa set() para gravar o nó COMPLETO
        // (o caller SEMPRE deve passar o objeto inteiro com spread do existing)
        const { id, ...payload } = data;
        // Remove campos internos temporários que não devem ir ao Firebase
        delete payload._pagamentoStatus;
        delete payload._pagamentoVencimento;
        delete payload._pagamentoVencimentoTemp;
        delete payload._finalizandoGarantia;
        // Filtra undefined (Firebase rejeita undefined, null é OK e remove o campo)
        const clean = JSON.parse(JSON.stringify(payload, (k, v) => v === undefined ? null : v));
        console.log(`[saveRepair] EDIT id=${id}`, JSON.stringify(clean).slice(0, 300));
        try {
            await set(ref(d, `${REPAIRS_PATH}/${id}`), clean);
            console.log(`[saveRepair] ✅ set() confirmado id=${id}`);
        } catch(e) {
            console.error(`[saveRepair] ❌ Erro:`, e.code, e.message);
            throw e;
        }
        return id;
    } else {
        // Novo conserto — gera número sequencial
        const numero = await proximoNumero('consertos');
        console.log(`[saveRepair] NEW numero=${numero}`);
        const r = await push(ref(d, REPAIRS_PATH), { ...data, numero });
        console.log(`[saveRepair] ✅ push() confirmado key=${r.key}`);
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
        if (snap.exists()) snap.forEach(c => { items.push({ id: c.key, ...c.val() }); });
        allRepairs = items;
        window._getAllRepairs = () => allRepairs;
        if (typeof window._onRepairsUpdate === 'function') window._onRepairsUpdate(allRepairs);
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
    const diasStr = (window.cfgGet ? window.cfgGet('autoDeleteDias') : localStorage.getItem('autoDeleteDias')) || 'nunca';
    if (diasStr === 'nunca') return;
    const dias = parseInt(diasStr);
    if (!dias || isNaN(dias)) return;
    const limite = dias * 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const item of items) {
        if (item.status !== STATUS.FINALIZADO) continue;
        const tsFinalizacao = item.timeline?.finalizado?.ts;
        if (!tsFinalizacao) continue;
        if ((now - tsFinalizacao) >= limite) await deleteRepair(item.id);
    }
}

// ============================================================
// ALERTAS DE PRAZO — sistema completo
// ============================================================

// IDs de notificações já descartadas pelo usuário (persiste no localStorage)
// Formato: "repId_YYYY-MM-DD" — reseta todo dia automaticamente
function _notifDismissedKey() {
    return 'notifDismissed_' + new Date().toISOString().slice(0, 10);
}
function _getDismissed() {
    try { return JSON.parse(localStorage.getItem(_notifDismissedKey()) || '[]'); } catch(e) { return []; }
}
function _saveDismissed(arr) {
    // Limpa chaves de dias anteriores
    Object.keys(localStorage).forEach(k => {
        if (k.startsWith('notifDismissed_') && k !== _notifDismissedKey()) localStorage.removeItem(k);
    });
    localStorage.setItem(_notifDismissedKey(), JSON.stringify(arr));
}
function dismissNotif(notifId) {
    const arr = _getDismissed();
    if (!arr.includes(notifId)) arr.push(notifId);
    _saveDismissed(arr);
    // Re-renderiza sem esse item
    checkDeadlineAlerts(allRepairs);
}
window._dismissNotif = dismissNotif;

// Dispara notificação nativa do sistema (só se o usuário deu permissão)
function _fireSysNotif(title, body, tag) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
        // Prefere via Service Worker para funcionar em segundo plano
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
            navigator.serviceWorker.ready.then(reg => {
                reg.showNotification(title, {
                    body,
                    tag,           // mesmo tag = substitui notificação anterior do mesmo conserto
                    renotify: false,
                    icon: './icons/icon-192.png',
                    badge: './icons/badge-96.png',
                    vibrate: [200, 100, 200],
                });
            });
        } else {
            new Notification(title, { body, tag, icon: './icons/icon-192.png' });
        }
    } catch(e) {}
}

// Pede permissão de notificação (chama uma vez no boot)
function pedirPermissaoNotificacao() {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// Guarda quais notifIds já foram disparados nesta sessão (evita loop do Firebase)
const _firedThisSession = new Set();

function checkDeadlineAlerts(items) {
    const dismissed   = _getDismissed();
    const hoje        = new Date().toISOString().slice(0, 10);

    // Monta lista de alertas ativos (não finalizados, não descartados hoje)
    const alertas = [];
    const paraDisparar = [];

    items.forEach(r => {
        if (r.status === STATUS.FINALIZADO) return;
        const ps    = prazoStatus(r);
        if (ps === 'ok') return;

        const notifId = `${r.id}_${hoje}_${ps}`;
        const nome    = r.nomeCliente || '—';
        const modelo  = r.modeloAparelho ? ` · ${r.modeloAparelho}` : '';
        const horas   = horasAte(r.dataMaxima, r.horaMaxima);

        let msg, tipo;
        if (ps === 'vencido') {
            const h = Math.abs(Math.round(horas || 0));
            msg  = `⚠️ ${nome}${modelo} — atrasado ${h}h`;
            tipo = 'danger';
        } else {
            const h = Math.ceil(horas || 0);
            msg  = `⏰ ${nome}${modelo} — ${h}h para o prazo`;
            tipo = 'warn';
        }

        alertas.push({ notifId, msg, tipo, repId: r.id });

        // Dispara apenas se: não descartado hoje E não disparado nesta sessão
        if (!dismissed.includes(notifId) && !_firedThisSession.has(notifId)) {
            _firedThisSession.add(notifId);
            const title = ps === 'vencido' ? '🔴 Conserto atrasado' : '🟡 Prazo próximo';
            paraDisparar.push({ title, body: `${nome}${modelo}`, tag: notifId });
        }
    });

    // Dispara uma por conserto com delay entre elas (evita agrupamento indesejado)
    paraDisparar.forEach((n, i) => {
        setTimeout(() => _fireSysNotif(n.title, n.body, n.tag), i * 600);
    });

    // ── Notificações de pagamento pendente ───────────────────
    items.forEach(r => {
        if (!isPagamentoPendente(r)) return;
        const venc = r.pagamentoVencimento;
        if (!venc) return;
        const isHoje = venc === hoje;
        const isVencido = venc < hoje;
        if (!isHoje && !isVencido) return;
        const notifId = `pag_${r.id}_${hoje}`;
        if (_firedThisSession.has(notifId)) return;
        _firedThisSession.add(notifId);
        const nome = r.nomeCliente || '—';
        const title = isVencido ? '🔴 Pagamento vencido' : '💰 Pagamento vence hoje';
        const body = `${nome}${r.modeloAparelho ? ' · ' + r.modeloAparelho : ''}`;
        _fireSysNotif(title, body, notifId);
    });

    // Filtra descartados para exibição no app
    const visiveis = alertas.filter(a => !dismissed.includes(a.notifId));

    // Atualiza badge
    const badge = document.getElementById('repAlertBadge');
    if (badge) { badge.textContent = visiveis.length || ''; badge.style.display = visiveis.length ? 'flex' : 'none'; }

    // Envia para o sistema de cards flutuantes do index.html
    if (typeof window._repRenderNotifs === 'function') {
        window._repRenderNotifs(visiveis);
    }
}

// ============================================================
// FILTROS
// ============================================================
function getFiltered(filter) {
    switch(filter) {
        case 'recebido':        return allRepairs.filter(r => r.status === STATUS.RECEBIDO);
        case 'aguardando_peca': return allRepairs.filter(r => r.status === STATUS.AGUARDANDO_PECA);
        case 'em_reparo':       return allRepairs.filter(r => r.status === STATUS.EM_REPARO);
        case 'pronto':          return allRepairs.filter(r => r.status === STATUS.PRONTO);
        case 'prontos_revisar': return allRepairs.filter(r => r.status === STATUS.PRONTO);
        case 'revisar':         return allRepairs.filter(r => r.status === STATUS.REVISAR);
        case 'proximo':         return allRepairs.filter(r => ![STATUS.FINALIZADO, STATUS.REVISAR, STATUS.AGUARDANDO_RETIRADA].includes(r.status) && prazoStatus(r) === 'proximo');
        case 'atrasado':        return allRepairs.filter(r => ![STATUS.FINALIZADO, STATUS.REVISAR, STATUS.AGUARDANDO_RETIRADA].includes(r.status) && prazoStatus(r) === 'vencido');
        case 'urgente':         return allRepairs.filter(r => ![STATUS.FINALIZADO, STATUS.REVISAR, STATUS.AGUARDANDO_RETIRADA].includes(r.status) && prazoStatus(r) !== 'ok').sort((a,b) => {
            const pa = prazoStatus(a), pb = prazoStatus(b);
            if (pa === 'vencido' && pb !== 'vencido') return -1;
            if (pb === 'vencido' && pa !== 'vencido') return 1;
            return (horasAte(a.dataMaxima, a.horaMaxima)||0) - (horasAte(b.dataMaxima, b.horaMaxima)||0);
        });
        case 'aguardando_retirada': return allRepairs.filter(r => r.status === STATUS.AGUARDANDO_RETIRADA || r.status === STATUS.REVISAR);
        case 'entregue':        return allRepairs.filter(r => r.status === STATUS.FINALIZADO);
        case 'garantia':        return allRepairs.filter(r => r.garantiaAtiva === true);
        default:                return allRepairs.filter(r => r.status !== STATUS.FINALIZADO); // 'all' = ativos
    }
}

// ============================================================
// SWIPE GESTURE (← avança etapa | → desfaz etapa)
// ============================================================
function attachSwipeToCard(card, repId) {
    const header = card.querySelector('.rep-card-header');
    if (!header) return;
    const THRESHOLD = 72, CANCEL_VERT = 18, MAX_DRAG = 110;
    let startX = 0, startY = 0, dragging = false, cancelled = false, rafId = null;
    let hintEl = null;

    function getHint() {
        if (hintEl) return hintEl;
        hintEl = document.createElement('div');
        hintEl.className = 'rep-swipe-hint';
        card.insertBefore(hintEl, header);
        return hintEl;
    }

    function reset(animate) {
        dragging = false; cancelled = false;
        if (rafId) cancelAnimationFrame(rafId);
        if (animate) header.style.transition = 'transform .25s cubic-bezier(.25,.8,.25,1)';
        header.style.transform = '';
        const hint = card.querySelector('.rep-swipe-hint');
        if (hint) { hint.style.opacity = '0'; hint.textContent = ''; hint.className = 'rep-swipe-hint'; }
        setTimeout(() => { header.style.transition = ''; }, 260);
    }

    header.addEventListener('touchstart', e => {
        const body = card.querySelector('.rep-card-body');
        if (!body.classList.contains('rep-collapsed')) return;
        startX = e.touches[0].clientX; startY = e.touches[0].clientY;
        dragging = true; cancelled = false;
    }, { passive: true });

    header.addEventListener('touchmove', e => {
        if (!dragging || cancelled) return;
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;
        if (Math.abs(dy) > CANCEL_VERT && Math.abs(dy) > Math.abs(dx)) { cancelled = true; reset(true); return; }
        if (Math.abs(dx) < 6) return;
        e.preventDefault();
        const repair = allRepairs.find(r => r.id === repId);
        if (!repair) return;
        const canNext = !!buildNextBtn(repair);
        const canUndo = !!PREV_STATUS[repair.status];
        let clamped = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, dx));
        if ((dx < 0 && !canNext) || (dx > 0 && !canUndo)) clamped = dx * 0.12;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
            header.style.transition = 'none';
            header.style.transform  = `translateX(${clamped}px)`;
            const hint = getHint(), pct = Math.abs(clamped) / THRESHOLD, activated = Math.abs(clamped) >= THRESHOLD;
            if (dx < -8 && canNext) {
                hint.className = `rep-swipe-hint rep-swipe-hint-next ${activated ? 'activated' : ''}`;
                hint.innerHTML = activated ? '📸 Avançar!' : '<i class="bi bi-arrow-right-circle-fill"></i> Avançar';
                hint.style.opacity = Math.min(1, pct).toFixed(2); hint.style.right = '0'; hint.style.left = 'auto';
            } else if (dx > 8 && canUndo) {
                hint.className = `rep-swipe-hint rep-swipe-hint-undo ${activated ? 'activated' : ''}`;
                hint.innerHTML = activated ? '↩️ Desfazer!' : '<i class="bi bi-arrow-counterclockwise"></i> Desfazer';
                hint.style.opacity = Math.min(1, pct).toFixed(2); hint.style.left = '0'; hint.style.right = 'auto';
            } else {
                hint.style.opacity = '0';
            }
        });
    }, { passive: false });

    header.addEventListener('touchend', e => {
        if (!dragging || cancelled) { dragging = false; return; }
        const dx = e.changedTouches[0].clientX - startX;
        const repair = allRepairs.find(r => r.id === repId);
        reset(true);
        if (!repair) return;
        if (dx < -THRESHOLD && buildNextBtn(repair)) {
            if (repair.status === STATUS.RECEBIDO) {
                openFornecedorModal(repair);
            } else if (repair.status === STATUS.PRONTO || repair.status === STATUS.REVISAR) {
                openChecklistModal(repair);
            } else {
                const map = {
                    [STATUS.AGUARDANDO_PECA]: [STATUS.EM_REPARO,  '📸 Foto: Peça Chegou — Em Reparo','Confirmar início do reparo'],
                    [STATUS.EM_REPARO]:       [STATUS.PRONTO,     '📸 Foto: Conserto Finalizado',    'Confirmar finalização'],
                };
                const info = map[repair.status];
                if (info) openStepModal(repair, info[0], info[1], info[2]);
            }
        } else if (dx > THRESHOLD && PREV_STATUS[repair.status]) {
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
    const recebidos    = items.filter(r => r.status === STATUS.RECEBIDO).length;
    const aguardando   = items.filter(r => r.status === STATUS.AGUARDANDO_PECA).length;
    const emReparo     = items.filter(r => r.status === STATUS.EM_REPARO).length;
    const tempoEsgotado= items.filter(r => ![STATUS.FINALIZADO, STATUS.REVISAR, STATUS.AGUARDANDO_RETIRADA].includes(r.status) && prazoStatus(r) === 'vencido').length;
    const proximos     = items.filter(r => ![STATUS.FINALIZADO, STATUS.REVISAR, STATUS.AGUARDANDO_RETIRADA].includes(r.status) && prazoStatus(r) === 'proximo').length;
    const prontos      = items.filter(r => r.status === STATUS.PRONTO).length;
    const revisar      = items.filter(r => r.status === STATUS.REVISAR).length;
    const agRetirada   = items.filter(r => r.status === STATUS.AGUARDANDO_RETIRADA || r.status === STATUS.REVISAR).length;

    const s = id => document.getElementById(id);
    if (s('repStat_recebido'))        s('repStat_recebido').textContent        = recebidos;
    if (s('repStat_aguardando'))      s('repStat_aguardando').textContent      = aguardando;
    if (s('repStat_reparo'))          s('repStat_reparo').textContent          = emReparo;
    if (s('repStat_atrasados'))       s('repStat_atrasados').textContent       = tempoEsgotado;
    if (s('repStat_proximos'))        s('repStat_proximos').textContent        = proximos;
    if (s('repStat_prontos'))         s('repStat_prontos').textContent         = prontos;
    if (s('repStat_revisar'))         s('repStat_revisar').textContent         = revisar;
    if (s('repStat_prontos_revisar')) s('repStat_prontos_revisar').textContent = prontos;
    if (s('repStat_ag_retirada'))     s('repStat_ag_retirada').textContent     = agRetirada;

    // ── Badge de pagamentos pendentes no botão Entregue ──────
    const btnEntregue = document.querySelector('[data-rep-filter="entregue"]');
    if (btnEntregue) {
        const pendentes = items.filter(r => isPagamentoPendente(r)).length;
        let badge = btnEntregue.querySelector('.rep-pag-badge');
        if (pendentes > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'rep-pag-badge';
                btnEntregue.appendChild(badge);
            }
            badge.textContent = pendentes;
        } else if (badge) {
            badge.remove();
        }
    }

    // Atualiza bloco urgente unificado
    const urgEl = document.getElementById('repStatUrgente');
    const urgLbl = document.getElementById('repStatUrgenteLbl');
    if (urgEl) {
        if (tempoEsgotado > 0) {
            urgEl.style.borderTopColor = '#ef4444';
            urgEl.style.background = 'rgba(239,68,68,.07)';
            if (urgLbl) urgLbl.textContent = '⚠️ Urgente';
            urgEl.dataset.repFilter = 'urgente';
        } else if (proximos > 0) {
            urgEl.style.borderTopColor = '#fb923c';
            urgEl.style.background = 'rgba(251,146,60,.05)';
            if (urgLbl) urgLbl.textContent = '⏰ Urgente';
            urgEl.dataset.repFilter = 'urgente';
        } else {
            urgEl.style.borderTopColor = 'var(--glass-border)';
            urgEl.style.background = '';
            if (urgLbl) urgLbl.textContent = '✅ Em dia';
        }
        urgEl.style.display = (tempoEsgotado > 0 || proximos > 0) ? '' : 'none';
    }

    // ── Tab Urgente — some se não houver urgentes ──
    const urgentesAtivos = items.filter(r => ![STATUS.FINALIZADO, STATUS.REVISAR, STATUS.AGUARDANDO_RETIRADA].includes(r.status) && prazoStatus(r) !== 'ok').length;
    const btnUrgente = document.getElementById('repFilterUrgente');
    if (btnUrgente) {
        btnUrgente.style.display = urgentesAtivos > 0 ? '' : 'none';
        if (urgentesAtivos === 0 && activeFilter === 'urgente') {
            activeFilter = 'all';
            document.querySelectorAll('[data-rep-filter]').forEach(b => b.classList.toggle('rep-filter-active', b.dataset.repFilter === 'all'));
            renderList(getFiltered('all'));
        }
    }

    // ── Tab Garantias — mostra só se tiver garantias ativas ──
    const garantiasAtivas = items.filter(r => r.garantiaAtiva === true).length;
    const btnGarantia = document.getElementById('repFilterGarantia');
    const countGarantia = document.getElementById('repGarantiaCount');
    if (btnGarantia) {
        btnGarantia.style.display = garantiasAtivas > 0 ? '' : 'none';
        if (garantiasAtivas === 0 && activeFilter === 'garantia') {
            activeFilter = 'all';
            document.querySelectorAll('[data-rep-filter]').forEach(b => b.classList.toggle('rep-filter-active', b.dataset.repFilter === 'all'));
            renderList(getFiltered('all'));
        }
    }
    if (countGarantia) countGarantia.textContent = garantiasAtivas > 0 ? garantiasAtivas : '';
}

// Quantos cards mostrar por vez na lista
const LIST_PAGE_SIZE = 15;

function renderList(items) {
    const container = document.getElementById('repairsList');
    if (!container) return;

    // ── Filtro de tipo (lojista / final / instagram / fisica) ─────────────────────
    if (activeTipoFilter === 'lojista') {
        items = items.filter(r => r.tipoCliente === 'lojista');
    } else if (activeTipoFilter === 'final') {
        items = items.filter(r => r.tipoCliente !== 'lojista');
    } else if (activeTipoFilter === 'instagram') {
        items = items.filter(r => r.canal === 'instagram');
    } else if (activeTipoFilter === 'fisica') {
        items = items.filter(r => r.canal !== 'instagram');
    }

    // ── Sub-filtro de pagamento (aba Entregue) ────────────────
    let subFilterBar = document.getElementById('repPaySubFilter');
    if (activeFilter === 'entregue') {
        const pendentes = items.filter(r => isPagamentoPendente(r));
        if (pendentes.length > 0) {
            if (!subFilterBar) {
                subFilterBar = document.createElement('div');
                subFilterBar.id = 'repPaySubFilter';
                subFilterBar.style.cssText = 'display:flex;gap:8px;padding:0 12px 10px;';
                container.parentNode.insertBefore(subFilterBar, container);
            }
            const activeClass = activePayFilter === 'pendente' ? 'rep-paysub-active' : '';
            subFilterBar.innerHTML = `
                <button class="rep-paysub-btn ${activeClass}" id="repPaySubBtn">
                    💰 A receber <span class="rep-paysub-count">${pendentes.length}</span>
                </button>`;
            document.getElementById('repPaySubBtn').addEventListener('click', () => {
                activePayFilter = activePayFilter === 'pendente' ? 'all' : 'pendente';
                renderList(getFiltered('entregue'));
            });
            // Aplica sub-filtro
            if (activePayFilter === 'pendente') items = pendentes;
        } else {
            if (subFilterBar) { subFilterBar.remove(); }
            activePayFilter = 'all';
        }
    } else {
        if (subFilterBar) { subFilterBar.remove(); }
        activePayFilter = 'all';
    }

    if (items.length === 0) {
        container.innerHTML = `
            <div class="rep-empty">
                <div style="font-size:2.5rem;margin-bottom:10px;">🔧</div>
                <div style="font-weight:600;margin-bottom:4px;">Nenhum conserto aqui</div>
                <div style="font-size:.8rem;opacity:.6;">Toque em <strong>+ Novo</strong> para cadastrar</div>
            </div>`;
        return;
    }
    items.sort((a, b) => {
        const pa = prazoStatus(a), pb = prazoStatus(b);
        const order = { vencido: 0, proximo: 1, ok: 2 };
        if (order[pa] !== order[pb]) return order[pa] - order[pb];
        return (b.tsCadastro || 0) - (a.tsCadastro || 0);
    });

    // Renderiza todos os cards mas oculta os que passam do limite inicial
    const total   = items.length;
    const initial = Math.min(LIST_PAGE_SIZE, total);

    container.innerHTML = items.map((r, i) => buildCard(r, i >= LIST_PAGE_SIZE)).join('');

    // Botão "Ver mais" se necessário
    if (total > LIST_PAGE_SIZE) {
        const hidden = total - LIST_PAGE_SIZE;
        const btn = document.createElement('div');
        btn.id = 'repVerMaisWrap';
        btn.innerHTML = `
            <button class="rep-ver-mais-btn" id="repVerMaisBtn">
                <i class="bi bi-chevron-down"></i> Ver mais ${hidden} conserto${hidden !== 1 ? 's' : ''}
            </button>`;
        container.appendChild(btn);
        document.getElementById('repVerMaisBtn').addEventListener('click', () => _expandList(container));
    }

    _bindListEvents(container);
}

function _expandList(container) {
    // Mostra mais LIST_PAGE_SIZE cards ocultos de uma vez, com animação suave
    const hidden = Array.from(container.querySelectorAll('.rep-card[data-hidden="1"]'));
    const toShow = hidden.slice(0, LIST_PAGE_SIZE);
    toShow.forEach((card, i) => {
        card.removeAttribute('data-hidden');
        card.style.display = '';
        // Fade-in suave
        card.style.opacity = '0';
        card.style.transform = 'translateY(12px)';
        card.style.transition = 'opacity .25s ease, transform .25s ease';
        setTimeout(() => {
            card.style.opacity = '';
            card.style.transform = '';
            setTimeout(() => { card.style.transition = ''; }, 260);
        }, i * 40);
    });

    // Atualiza o botão
    const stillHidden = Array.from(container.querySelectorAll('.rep-card[data-hidden="1"]')).length;
    const wrap = document.getElementById('repVerMaisWrap');
    if (stillHidden > 0 && wrap) {
        document.getElementById('repVerMaisBtn').innerHTML =
            `<i class="bi bi-chevron-down"></i> Ver mais ${stillHidden} conserto${stillHidden !== 1 ? 's' : ''}`;
    } else if (wrap) {
        wrap.remove();
    }
}

function _bindListEvents(container) {
    // ── Delegação para botões de editar/excluir linha de pagamento ──
    container.querySelectorAll('[data-rep-action="editar_linha_pagamento"], [data-rep-action="excluir_linha_pagamento"]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            window._lastPagActionIdx = parseInt(btn.dataset.pagIdx ?? '0');
            handleAction(btn.dataset.repAction, btn.dataset.repId);
        });
    });

    container.querySelectorAll('[data-rep-action]').forEach(btn => {
        if (btn.dataset.repAction === 'editar_linha_pagamento' || btn.dataset.repAction === 'excluir_linha_pagamento') return;
        btn.addEventListener('click', e => { e.stopPropagation(); handleAction(btn.dataset.repAction, btn.dataset.repId); });
    });
    container.querySelectorAll('[data-rep-whatsapp]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const link = whatsappLink(btn.dataset.repWhatsapp);
            if (link) window.open(link, '_blank');
        });
    });
    container.querySelectorAll('.rep-comprovante-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const r = allRepairs.find(x => x.id === btn.dataset.repId);
            if (r) _mostrarCardComprovante(r);
        });
    });
    container.querySelectorAll('.rep-card-header').forEach(h => {
        h.addEventListener('click', () => {
            // Todos os cards expandem normalmente ao clicar no header
            const body = h.closest('.rep-card').querySelector('.rep-card-body');
            body.classList.toggle('rep-collapsed');
            h.querySelector('.rep-chevron').classList.toggle('rep-chevron-open');
        });
    });
    container.querySelectorAll('.rep-card').forEach(card => {
        const repId = card.querySelector('[data-rep-id]')?.dataset.repId;
        if (repId) attachSwipeToCard(card, repId);
    });

    // ── Tab Bar: troca de aba dentro do card ──────────────────
    container.querySelectorAll('.rep-tabs').forEach(tabBar => {
        tabBar.querySelectorAll('.rep-tab-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const cardBody = tabBar.closest('.rep-card-body');
                const targetPanel = btn.dataset.tab;

                // Atualiza botões
                tabBar.querySelectorAll('.rep-tab-btn').forEach(b => b.classList.remove('rep-tab-active'));
                btn.classList.add('rep-tab-active');

                // Atualiza painéis
                cardBody.querySelectorAll('.rep-tab-panel').forEach(p => p.classList.remove('rep-tab-panel-active'));
                const panel = cardBody.querySelector(`.rep-tab-panel[data-panel="${targetPanel}"]`);
                if (panel) panel.classList.add('rep-tab-panel-active');

                // Lazy load das fotos da timeline
                if (targetPanel === 'timeline') {
                    panel.querySelectorAll('img[data-src]').forEach(img => {
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                    });
                }
            });
        });
    });
}

function renderPatternGrid(senhaValor) {
    const active = new Set((senhaValor || '').split('-').filter(Boolean).map(Number));
    // Conecta os pontos em ordem com linhas SVG
    const seq = (senhaValor || '').split('-').filter(Boolean).map(Number);
    // Posições dos pontos: índice 1-9 → coluna/linha no grid 3x3
    const pos = {1:[16.7,16.7],2:[50,16.7],3:[83.3,16.7],4:[16.7,50],5:[50,50],6:[83.3,50],7:[16.7,83.3],8:[50,83.3],9:[83.3,83.3]};
    let lines = '';
    for (let i = 0; i < seq.length - 1; i++) {
        const a = pos[seq[i]], b = pos[seq[i+1]];
        if (a && b) lines += `<line x1="${a[0]}%" y1="${a[1]}%" x2="${b[0]}%" y2="${b[1]}%" stroke="var(--primary-color)" stroke-width="2" stroke-linecap="round" opacity="0.6"/>`;
    }
    const dots = [1,2,3,4,5,6,7,8,9].map(n => {
        const p = pos[n];
        const on = active.has(n);
        return `<circle cx="${p[0]}%" cy="${p[1]}%" r="${on ? '6%' : '4%'}" fill="${on ? 'var(--primary-color)' : 'rgba(148,163,184,0.25)'}" ${on ? 'stroke="var(--primary-color)" stroke-width="1" stroke-opacity="0.5"' : ''}/>`;
    }).join('');
    return `<svg viewBox="0 0 100 100" class="rep-ptn-svg-mini" xmlns="http://www.w3.org/2000/svg">${lines}${dots}</svg>`;
}


function buildCard(r, hidden) {
    const ps      = prazoStatus(r);
    const horas   = horasAte(r.dataMaxima, r.horaMaxima);
    const vencido = ps === 'vencido';
    const proximo = ps === 'proximo';
    const finaliz = r.status === STATUS.FINALIZADO;
    const dotColor   = STATUS_COLOR[r.status];
    const labelColor = r.status === STATUS.RECEBIDO ? 'var(--text-secondary)' : dotColor;

    let prazoLabel = '';
    if (!finaliz && r.dataMaxima) {
        if (vencido) {
            const h = Math.abs(Math.round(horas));
            prazoLabel = `<span class="rep-badge rep-badge-danger">⚠️ ${h}h atraso</span>`;
        } else if (proximo) {
            const h = Math.ceil(horas);
            prazoLabel = `<span class="rep-badge rep-badge-warn">⏰ ${h}h</span>`;
        }
    }

    let diasNoStatus = '';
    if (r.status === STATUS.EM_REPARO && r.timeline?.em_reparo?.ts) {
        const d = diasDesde(r.timeline.em_reparo.ts);
        diasNoStatus = `<span class="rep-badge rep-badge-info">🕒 ${d}d</span>`;
    }
    
    let fornBadge = '';
    if (r.status === STATUS.AGUARDANDO_PECA && r.fornecedor) {
        fornBadge = `<span class="rep-badge" style="background:rgba(245,158,11,.15);color:var(--rep-yellow);border:1px solid rgba(245,158,11,.3);">🔧 ${escHtml(r.fornecedor.peca||'Peça')}</span>`;
    }
    
    let previsaoBadge = '';
    if (r.status === STATUS.AGUARDANDO_PECA && r.fornecedor?.previsao) {
        const hoje = new Date().toISOString().slice(0,10);
        const isHoje = r.fornecedor.previsao === hoje;
        previsaoBadge = isHoje
            ? `<span class="rep-badge rep-badge-warn">📦 Chega hoje!</span>`
            : `<span class="rep-badge rep-badge-info">📦 ${formatDate(r.fornecedor.previsao)}</span>`; 
    }

    // ── Pill de pagamento ────────────────────────────────────
    let pagPill = '';
    if (finaliz) {
        const saldoFinal = getSaldo(r);
        if (r.valorCobrado && saldoFinal > 0) {
            const venc = formatVencimento(r);
            const vencidoPag = isVencimentoVencido(r);
            const pillClass = vencidoPag ? 'rep-badge-pag-vencido' : 'rep-badge-pag-pendente';
            const saldoFmt  = saldoFinal.toFixed(2).replace('.', ',');
            const pillText  = vencidoPag
                ? `<span class="rep-pag-pill-main">🔴 R$${saldoFmt}</span>`
                : venc
                    ? `<span class="rep-pag-pill-main">💰 R$${saldoFmt}</span><span class="rep-pag-pill-sub">vence ${venc}</span>`
                    : `<span class="rep-pag-pill-main">💰 R$${saldoFmt}</span>`;
            pagPill = `<button class="rep-badge ${pillClass} rep-pag-pill-btn" data-rep-action="marcar_pago" data-rep-id="${r.id}" title="Toque para registrar pagamento">${pillText}</button>`;
        } else if ((r.valorCobrado && saldoFinal === 0 && getTotalPago(r) > 0) || r.pagamento === PAG_STATUS.RECEBIDO) {
            pagPill = `<span class="rep-badge rep-badge-pag-ok">\u2705 Pago</span>`;
        }
    }

    // ── Pill de garantia ativa ────────────────────────────────
    let garantiaPill = '';
    const anotacaoPill = r.anotacaoInterna
        ? `<span class="rep-anotacao-pill"><i class="bi bi-sticky-fill"></i> Nota</span>`
        : '';
    if (r.garantiaAtiva) {
        const diasRestantes = r.garantiaVenceTs ? Math.ceil((r.garantiaVenceTs - Date.now()) / 86400000) : null;
        const vencida = diasRestantes !== null && diasRestantes < 0;
        garantiaPill = vencida
            ? `<span class="rep-badge rep-badge-garantia-vencida">🛡️ Garantia vencida</span>`
            : diasRestantes !== null
                ? `<span class="rep-badge rep-badge-garantia-ativa">🛡️ Garantia — ${diasRestantes}d restantes</span>`
                : `<span class="rep-badge rep-badge-garantia-ativa">🛡️ Em garantia</span>`;
    }

    const lojistaPill = r.tipoCliente === 'lojista'
        ? `<span class="rep-badge" style="background:rgba(59,130,246,.12);color:#60a5fa;border:1px solid rgba(59,130,246,.25);">🏪 Lojista</span>`
        : `<span class="rep-badge" style="background:rgba(139,92,246,.1);color:#a78bfa;border:1px solid rgba(139,92,246,.2);">👤 Final</span>`;
    const _thumbUrl = (r.fotosUrls && r.fotosUrls[0]) || r.fotoUrl || null;
    const _canalBar = r.canal === 'instagram'
        ? `<div class="rep-canal-bar rep-canal-bar-insta"><i class="bi bi-instagram"></i> Insta</div>`
        : `<div class="rep-canal-bar rep-canal-bar-loja"><i class="bi bi-shop-window"></i> Loja</div>`;
    const thumb = _thumbUrl
        ? `<div class="rep-thumb-wrap">
              <img src="${_thumbOptUrl(_thumbUrl)}" class="rep-thumb" alt="foto" loading="lazy" crossorigin="anonymous"
                  onerror="this.onerror=null;this.src='';this.outerHTML='<div class=\\'rep-thumb-placeholder\\'><i class=\\'bi bi-image-fill\\'></i></div>'"
                  onclick="event.stopPropagation();window._repAbrirFoto('${_thumbUrl}')">
              ${(r.fotosUrls && r.fotosUrls.length > 1) ? `<span class='rep-thumb-count'>+${r.fotosUrls.length-1}</span>` : ''}
              ${_canalBar}
           </div>`
        : `<div class="rep-thumb-wrap">
              <div class="rep-thumb-placeholder"><i class="bi bi-phone"></i></div>
              ${_canalBar}
           </div>`;

    const timelineHtml = buildTimeline(r);
    const nextBtn      = buildNextBtn(r);
    const prazoFormatado = r.dataMaxima
        ? formatDate(r.dataMaxima) + (r.horaMaxima ? ' às ' + r.horaMaxima : '')
        : null;

    // ── Tab Bar: conteúdo de cada aba ────────────────────────
    const _pags    = getPagamentos(r);
    const _totPago = getTotalPago(r);
    const _saldo   = getSaldo(r);
    const _cobrado = Number(r.valorCobrado || 0);

    // ── Aba INFO ─────────────────────────────────────────────
    const tabInfo = `
        <div class="rep-body-top">
            <div class="rep-card-defect-full">${escHtml(r.descricaoDefeito)}</div>
            <span class="rep-status-pill" style="background:${labelColor}22;color:${labelColor};border:1px solid ${labelColor}44;">${STATUS_LABEL[r.status]}</span>
        </div>

        ${(() => {
            const temSenha = r.senhaTipo && r.senhaTipo !== 'nenhuma';
            const senhaMini = temSenha ? `
            <div class="rep-senha-mini">
                <div class="rep-senha-mini-title">
                    <i class="bi bi-shield-lock-fill"></i> ${r.senhaTipo === 'pin' ? 'PIN' : r.senhaTipo === 'senha' ? 'Senha' : 'Padrão'}
                </div>
                <div class="rep-senha-mini-content">
                ${r.senhaTipo === 'padrao'
                    ? renderPatternGrid(r.senhaValor)
                    : `<span class="rep-senha-valor">${escHtml(r.senhaValor || '—')}</span>`
                }
                </div>
            </div>` : '';

            if (r.anotacaoInterna) {
                return `
                <div class="rep-anotacao-row${temSenha ? ' rep-anotacao-row-com-senha' : ''}">
                    <div class="rep-anotacao-bloco" data-rep-id="${r.id}" style="flex:1;min-width:0;">
                        <div class="rep-anotacao-header">
                            <span><i class="bi bi-sticky-fill"></i> Anotação Interna</span>
                            <button class="rep-anotacao-edit-btn" data-rep-action="editar_anotacao" data-rep-id="${r.id}" title="Editar anotação"><i class="bi bi-pencil-fill"></i></button>
                        </div>
                        <div class="rep-anotacao-texto">${escHtml(r.anotacaoInterna)}</div>
                    </div>
                    ${senhaMini}
                </div>`;
            } else {
                return `
                <div class="rep-anotacao-row${temSenha ? ' rep-anotacao-row-com-senha' : ''}">
                    <button class="rep-anotacao-add-btn" data-rep-action="editar_anotacao" data-rep-id="${r.id}" style="flex:1;">
                        <i class="bi bi-sticky-fill"></i> Adicionar anotação interna
                    </button>
                    ${senhaMini}
                </div>`;
            }
        })()}

        <div class="rep-body-mid">
            <div class="rep-card-meta">
                <span><i class="bi bi-calendar3"></i> ${formatDate(r.tsCadastro)}</span>
                ${prazoFormatado ? `<span><i class="bi bi-flag-fill"></i> Prazo: ${prazoFormatado}</span>` : ''}
                ${r.valorCobrado ? `<span><i class="bi bi-cash-coin"></i> R$ ${Number(r.valorCobrado).toFixed(2).replace('.',',')}</span>` : ''}
                ${r.numeroCliente ? `<span><i class="bi bi-whatsapp" style="color:#25d366;"></i> ${escHtml(r.numeroCliente)}</span>` : ''}
                ${r.canal === 'instagram'
                    ? `<span class="rep-origem-pill rep-origem-pill-insta"><i class="bi bi-instagram"></i> Instagram</span>`
                    : `<span class="rep-origem-pill rep-origem-pill-loja"><i class="bi bi-shop-window"></i> Loja Física</span>`}
            </div>
        </div>

        ${r.status === STATUS.AGUARDANDO_PECA && r.fornecedor ? `
        <div class="rep-forn-bloco">
            <div class="rep-forn-title"><i class="bi bi-hourglass-split"></i> Aguardando Peça</div>
            <div class="rep-forn-row"><span class="rep-forn-lbl">Peça</span><span>${escHtml(r.fornecedor.peca||'—')}</span></div>
            <div class="rep-forn-row"><span class="rep-forn-lbl">Fornecedor</span><span>${escHtml(r.fornecedor.nome||'—')}</span></div>
            ${r.fornecedor.tel ? `<div class="rep-forn-row"><span class="rep-forn-lbl">Contato</span><span>${escHtml(r.fornecedor.tel)}</span></div>` : ''}
            ${r.fornecedor.previsao ? `<div class="rep-forn-row"><span class="rep-forn-lbl">Previsão</span><span style="color:var(--rep-yellow);font-weight:600;">${formatDate(r.fornecedor.previsao)}</span></div>` : ''}
        </div>` : ''}

        <div class="rep-card-actions">
            ${nextBtn}
            ${buildUndoBtn(r)}
            ${buildManualStepBtn(r)}
            <div class="rep-card-actions-secondary">
                ${r.numeroCliente ? `<button class="rep-btn rep-btn-ghost rep-btn-sm rep-wpp" data-rep-whatsapp="${escHtml(r.numeroCliente)}" title="WhatsApp"><i class="bi bi-whatsapp"></i></button>` : ''}
                ${r.status !== STATUS.FINALIZADO ? `<button class="rep-btn rep-btn-ghost rep-btn-sm rep-comprovante-btn" data-rep-id="${r.id}" title="Comprovante de Entrada" style="border-color:rgba(124,58,237,.4);color:#a78bfa;"><i class="bi bi-file-earmark-arrow-down-fill"></i></button>` : ''}
                <button class="rep-btn rep-btn-ghost rep-btn-sm" data-rep-action="etiqueta" data-rep-id="${r.id}" title="Etiqueta Térmica"><i class="bi bi-tag-fill"></i></button>
                ${(r.status === STATUS.FINALIZADO || r.status === STATUS.REVISAR) ? `<button class="rep-btn rep-btn-ghost rep-btn-sm" data-rep-action="pdf_garantia" data-rep-id="${r.id}" title="Gerar Recibo &amp; Garantia"><i class="bi bi-file-earmark-check-fill"></i></button>` : ''}
                ${r.status === STATUS.FINALIZADO ? (r.garantiaAtiva
                    ? `<button class="rep-btn rep-btn-ghost rep-btn-sm rep-btn-cancelar-garantia" data-rep-action="cancelar_garantia" data-rep-id="${r.id}" title="Finalizar garantia"><i class="bi bi-shield-check"></i> Finalizar</button>`
                    : `<button class="rep-btn rep-btn-garantia rep-btn-sm" data-rep-action="acionar_garantia" data-rep-id="${r.id}" title="Acionar Garantia"><i class="bi bi-shield-exclamation"></i> Garantia</button>`
                ) : r.garantiaAtiva
                    ? `<button class="rep-btn rep-btn-ghost rep-btn-sm rep-btn-cancelar-garantia" data-rep-action="cancelar_garantia" data-rep-id="${r.id}" title="Finalizar garantia"><i class="bi bi-shield-check"></i> Finalizar</button>`
                    : ''}
                <button class="rep-btn rep-btn-ghost rep-btn-sm" data-rep-action="edit"   data-rep-id="${r.id}"><i class="bi bi-pencil-fill"></i></button>
                <button class="rep-btn rep-btn-danger rep-btn-sm" data-rep-action="delete" data-rep-id="${r.id}"><i class="bi bi-trash-fill"></i></button>
            </div>
        </div>`;

    // ── Aba PAGAMENTO ────────────────────────────────────────
    const pagLinhas = _pags.map((p, idx) => `
        <div class="rep-tab-pag-linha">
            <div class="rep-tab-pag-linha-info">
                <span class="rep-tab-pag-linha-desc">${escHtml(p.desc || 'Pagamento')}</span>
                <span class="rep-tab-pag-linha-data">${new Date(p.ts).toLocaleDateString('pt-BR')} ${new Date(p.ts).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span>
            </div>
            <div class="rep-tab-pag-linha-right">
                <span class="rep-tab-pag-linha-valor">+R$ ${Number(p.valor).toFixed(2).replace('.',',')}</span>
                <button class="rep-btn rep-btn-ghost rep-btn-sm rep-tab-pag-edit-btn"
                    data-rep-action="editar_linha_pagamento"
                    data-rep-id="${r.id}"
                    data-pag-idx="${idx}"
                    title="Editar pagamento">
                    <i class="bi bi-pencil-fill"></i>
                </button>
                <button class="rep-btn rep-btn-danger rep-btn-sm rep-tab-pag-del-btn"
                    data-rep-action="excluir_linha_pagamento"
                    data-rep-id="${r.id}"
                    data-pag-idx="${idx}"
                    title="Excluir pagamento">
                    <i class="bi bi-trash-fill"></i>
                </button>
            </div>
        </div>`).join('');

    const tabPagamento = _cobrado > 0 ? `
        <div class="rep-tab-pag-resumo">
            <div class="rep-tab-pag-resumo-item">
                <span class="rep-tab-pag-resumo-lbl">Total</span>
                <span class="rep-tab-pag-resumo-val" style="color:var(--text-color);">R$ ${_cobrado.toFixed(2).replace('.',',')}</span>
            </div>
            <div class="rep-tab-pag-resumo-sep"></div>
            <div class="rep-tab-pag-resumo-item">
                <span class="rep-tab-pag-resumo-lbl">Pago</span>
                <span class="rep-tab-pag-resumo-val" style="color:var(--rep-green);">R$ ${_totPago.toFixed(2).replace('.',',')}</span>
            </div>
            <div class="rep-tab-pag-resumo-sep"></div>
            <div class="rep-tab-pag-resumo-item">
                <span class="rep-tab-pag-resumo-lbl">Saldo</span>
                <span class="rep-tab-pag-resumo-val" style="color:${_saldo > 0 ? 'var(--rep-orange)' : 'var(--rep-green)'};">${_saldo > 0 ? 'R$ ' + _saldo.toFixed(2).replace('.',',') : '✅ Quitado'}</span>
            </div>
        </div>

        <div class="rep-tab-pag-historico">
            <div class="rep-tab-pag-historico-titulo">Histórico de pagamentos</div>
            ${_pags.length > 0 ? pagLinhas : '<div class="rep-tab-pag-vazio">Nenhum pagamento registrado ainda.</div>'}
        </div>

        <button class="rep-btn rep-btn-green rep-tab-pag-novo-btn" data-rep-action="registrar_pagamento" data-rep-id="${r.id}">
            <i class="bi bi-plus-circle-fill"></i> Registrar pagamento
        </button>` : `
        <div class="rep-tab-pag-sem-valor">
            <div class="rep-tab-pag-sem-valor-icone">💵</div>
            <div class="rep-tab-pag-sem-valor-titulo">Valor não informado</div>
            <div class="rep-tab-pag-sem-valor-sub">Defina o valor cobrado para registrar pagamentos</div>
            <button class="rep-btn rep-btn-ghost rep-btn-sm rep-tab-pag-novo-btn" style="margin-top:10px;" data-rep-action="definir_valor_cobrado" data-rep-id="${r.id}">
                <i class="bi bi-pencil-fill"></i> Definir valor cobrado
            </button>
        </div>
        ${_pags.length > 0 ? `
        <div class="rep-tab-pag-historico" style="margin-top:12px;">
            <div class="rep-tab-pag-historico-titulo">Histórico de pagamentos</div>
            ${pagLinhas}
        </div>` : ''}
        `;

    // ── Aba LINHA DO TEMPO ────────────────────────────────────
    const tabTimeline = `
        <div style="flex:1;min-width:0;">
            ${timelineHtml || '<div class="rep-tab-pag-vazio" style="padding:16px 0;">Sem registros na linha do tempo.</div>'}
        </div>`;

    // ── Badge de pagamento pendente (para header) ─────────────
    // pagPill mantido para exibir no header quando finalizado
    const hasPagPendente = r.valorCobrado > 0 && _saldo > 0;

    return `
    <div class="rep-card ${vencido ? 'rep-card-vencido' : proximo ? 'rep-card-proximo' : finaliz ? 'rep-card-finalizado' : ''}${r.garantiaAtiva ? ' rep-garantia-card' : ''}" ${hidden ? 'data-hidden="1" style="display:none"' : ''} data-rep-card-id="${r.id}">
        <div class="rep-card-header">
            <div class="rep-card-header-left">
                ${thumb}
                <div class="rep-card-info">
                    <div class="rep-card-name">${r.numero ? `<span class="rep-card-num">#${r.numero}</span> ` : ''}${escHtml(r.nomeCliente)}</div>
                    ${r.modeloAparelho ? `<div class="rep-card-model"><i class="bi bi-phone-fill" style="font-size:.6rem;opacity:.5;"></i> ${escHtml(r.modeloAparelho)}</div>` : ''}
                    <div class="rep-header-badges">
                        <span class="rep-status-dot" style="background:${dotColor};"></span>
                        <span class="rep-status-label-small" style="color:${labelColor};">${STATUS_LABEL[r.status]}${r.status === STATUS.PRONTO ? '<span style="font-size:.65em;opacity:.6;display:block;margin-top:1px;">(aguardando revisão)</span>' : ''}</span>
                        ${prazoLabel}${diasNoStatus}${fornBadge}${previsaoBadge}${pagPill}${garantiaPill}${lojistaPill}
                        ${anotacaoPill}
                        ${r.valorCobrado && !finaliz ? `<span class="rep-badge rep-valor-cobrado-pill">R$ ${Number(r.valorCobrado).toFixed(2).replace('.',',')}</span>` : ''}
                    </div>
                </div>
            </div>
            <i class="bi bi-chevron-down rep-chevron"></i>
        </div>

        <div class="rep-card-body rep-collapsed">
            <!-- ── Tab Bar ── -->
            <div class="rep-tabs" data-rep-card-id="${r.id}">
                <button class="rep-tab-btn rep-tab-active" data-tab="info">
                    <i class="bi bi-info-circle-fill"></i> Info
                </button>
                <button class="rep-tab-btn" data-tab="pagamento">
                <i class="bi bi-cash-coin"></i> Pagamento
                ${hasPagPendente ? `<span class="rep-tab-pag-badge">${_saldo.toFixed(2).replace('.',',')}</span>` : (_totPago > 0 ? '<span class="rep-tab-pag-badge rep-tab-pag-badge-ok">✓</span>' : '')}
            </button>
                <button class="rep-tab-btn" data-tab="timeline">
                    <i class="bi bi-clock-history"></i> Histórico
                </button>
            </div>

            <!-- ── Painéis das abas ── -->
            <div class="rep-tab-panel rep-tab-panel-active" data-panel="info">
                ${tabInfo}
            </div>
            <div class="rep-tab-panel" data-panel="pagamento">
                ${tabPagamento}
            </div>
            <div class="rep-tab-panel" data-panel="timeline">
                ${tabTimeline}
            </div>
        </div>
    </div>`;
}


function buildNextBtn(r) {
    // Status RECEBIDO: dois botões — Aguardar Peça (opcional) ou ir direto pra Em Reparo
    if (r.status === STATUS.RECEBIDO) {
        return `
        <div class="rep-next-split">
            <button class="rep-btn rep-btn-yellow rep-btn-split" data-rep-action="to_aguardando_peca" data-rep-id="${r.id}">
                <i class="bi bi-hourglass-split"></i> Ag. Peça
            </button>
            <button class="rep-btn rep-btn-blue rep-btn-split" data-rep-action="to_em_reparo_direto" data-rep-id="${r.id}">
                <i class="bi bi-tools"></i> Já tenho a peça → Reparar
            </button>
        </div>`;
    }
    const map = {
        [STATUS.AGUARDANDO_PECA]: { action: 'to_em_reparo',  icon: 'bi-tools',             label: 'Peça Chegou — Reparar', color: 'rep-btn-blue'  },
        [STATUS.EM_REPARO]:       { action: 'to_pronto',     icon: 'bi-check-circle-fill', label: 'Finalizar Conserto',    color: 'rep-btn-green' },
    };

    // PRONTO e REVISAR: dois botões — Revisar ou Entregar diretamente
    if (r.status === STATUS.PRONTO || r.status === STATUS.REVISAR) {
        const jaRevisado = r.status === STATUS.REVISAR;
        return `
        <div class="rep-next-split">
            <button class="rep-btn rep-btn-teal rep-btn-split" data-rep-action="to_checklist" data-rep-id="${r.id}">
                <i class="bi bi-check2-square"></i> ${jaRevisado ? 'Re-Revisar' : 'Revisar'}
            </button>
            <button class="rep-btn rep-btn-green rep-btn-split" data-rep-action="to_finalizado" data-rep-id="${r.id}">
                <i class="bi bi-bag-check-fill"></i> Entregar
            </button>
        </div>`;
    }
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

function buildManualStepBtn(r) {
    if (r.status === STATUS.FINALIZADO) return '';
    return `<button class="rep-btn rep-btn-ghost rep-btn-sm rep-btn-choose-step" data-rep-action="choose_step" data-rep-id="${r.id}">
        <i class="bi bi-list-check"></i> Escolher etapa
    </button>`;
}

function buildTimeline(r) {
    if (!r.timeline) return '';
    const steps = [
        { key: 'cadastro',        icon: '📋', label: 'Cadastrado' },
        { key: 'aguardando_peca', icon: '🟡', label: 'Aguardando Peça' },
        { key: 'em_reparo',       icon: '🔧', label: 'Em Reparo' },
        { key: 'pronto',          icon: '✅', label: 'Pronto p/ Retirada' },
        { key: 'finalizado',      icon: '🤝', label: 'Entregue ao Cliente' },
        { key: 'garantia',        icon: '🛡️', label: 'Retornou — Garantia' },
        { key: 'garantia_entrega',icon: '🛡️', label: 'Entregue (Garantia)' },
    ];
    const items = steps.filter(s => r.timeline[s.key]).map(s => {
        const ev = r.timeline[s.key];

        // Fotos da etapa: combina fotosUrls da etapa + fotos do cadastro (fotosUrls raiz)
        let fotos = [];
        if (s.key === 'cadastro') {
            // Fotos do cadastro ficam no nível raiz do repair
            fotos = Array.isArray(r.fotosUrls) ? r.fotosUrls : (r.fotoUrl ? [r.fotoUrl] : []);
        } else {
            fotos = Array.isArray(ev.fotosUrls) ? ev.fotosUrls : (ev.fotoUrl ? [ev.fotoUrl] : []);
        }

        const fotosHtml = fotos.length > 0
            ? `<div class="rep-tl-fotos">${fotos.map((url, i) =>
                `<button class="rep-tl-foto-thumb" onclick="event.stopPropagation();window._repAbrirFoto('${url}')" title="Ver foto ${i+1}">
                    <img data-src="${url}" alt="foto ${i+1}" style="opacity:0;" onload="this.style.opacity=1"
                         onerror="this.style.opacity=0.3">
                </button>`
              ).join('')}</div>`
            : '';

        return `<div class="rep-tl-item">
            <span class="rep-tl-dot">${s.icon}</span>
            <div class="rep-tl-content">
                <div class="rep-tl-label">${s.label}</div>
                <div class="rep-tl-meta">${formatDateTime(ev.ts)}</div>
                ${fotosHtml}
            </div>
        </div>`;
    }).join('');
    return items ? `<div class="rep-timeline">${items}</div>` : '';
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
        case 'editar_anotacao':  openAnotacaoModal(repair); break;
        case 'registrar_pagamento': abrirModalRegistrarPagamento(repair); break;
        case 'editar_entrada':   editarEntradaPagamento(repair); break;
        case 'etiqueta':         abrirEtiqueta(repair); break;
        case 'pdf_garantia':     openGarantiaModal(repair); break;
        case 'acionar_garantia': acionarGarantia(repair); break;
        case 'cancelar_garantia': finalizarGarantia(repair); break;
        case 'to_aguardando_peca':  openFornecedorModal(repair); break;
        case 'to_em_reparo_direto': avancarDiretoSemFoto(repair, STATUS.EM_REPARO); break;
        case 'to_em_reparo':       openStepModal(repair, STATUS.EM_REPARO,  '📸 Foto: Peça Chegou — Em Reparo','Confirmar início do reparo'); break;
        case 'to_pronto':          openStepModal(repair, STATUS.PRONTO,     '📸 Foto: Conserto Finalizado',    'Confirmar finalização'); break;
        case 'to_revisar':         openStepModal(repair, STATUS.REVISAR,    'Checklist de Revisao',              'Confirmar revisao');     break;
        case 'to_checklist':       openChecklistModal(repair); break;
        case 'to_finalizado':      openPagamentoModal(repair); break;
        case 'marcar_pago':        confirmarPagamentoRecebido(repair); break;
        case 'choose_step':        openManualStepModal(repair); break;
        // ── ações de linha de pagamento (idx passado via window._lastPagActionIdx) ──
        case 'editar_linha_pagamento':  abrirEditarLinhaPagamento(repair, window._lastPagActionIdx ?? 0); break;
        case 'excluir_linha_pagamento': confirmarExcluirLinhaPagamento(repair, window._lastPagActionIdx ?? 0); break;
        case 'definir_valor_cobrado':   abrirModalDefinirValor(repair); break;
    }
}

// ============================================================
// MODAL REGISTRO DE PAGAMENTO — qualquer card com valorCobrado
// ============================================================
function abrirModalRegistrarPagamento(repair) {
    const oldOv = document.getElementById('repRegPagOverlay');
    if (oldOv) oldOv.remove();

    const pags     = getPagamentos(repair);
    const total    = getTotalPago(repair);
    const saldo    = getSaldo(repair);
    const cobrado  = Number(repair.valorCobrado || 0);
    const isPago   = cobrado > 0 && saldo === 0 && total > 0;

    const ov = document.createElement('div');
    ov.id = 'repRegPagOverlay';
    ov.className = 'rep-modal-overlay';
    ov.innerHTML = `
    <div class="rep-modal" style="max-width:380px;">
        <div class="rep-modal-header">
            <span>💰 Registrar Pagamento</span>
            <button class="rep-modal-close" id="repRegPagClose"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="rep-modal-body" style="gap:10px;">
            <div style="background:rgba(255,255,255,.04);border:1px solid var(--glass-border);border-radius:12px;padding:10px 14px;">
                <div style="font-size:.92rem;font-weight:700;">${repair.numero ? `<span style="opacity:.5;font-size:.8rem;">#${repair.numero}</span> ` : ''}${escHtml(repair.nomeCliente)}</div>
                ${repair.modeloAparelho ? `<div style="font-size:.78rem;color:var(--text-secondary);">${escHtml(repair.modeloAparelho)}</div>` : ''}
                <div style="margin-top:8px;font-size:.8rem;display:flex;gap:12px;">
                    <span>Total: <strong>R$ ${cobrado.toFixed(2).replace('.',',')}</strong></span>
                    <span style="color:#10b981;">Pago: <strong>R$ ${total.toFixed(2).replace('.',',')}</strong></span>
                    ${saldo > 0 ? `<span style="color:var(--rep-orange);">Saldo: <strong>R$ ${saldo.toFixed(2).replace('.',',')}</strong></span>` : `<span style="color:#10b981;">✅ Quitado</span>`}
                </div>
            </div>

            ${pags.length > 0 ? `
            <div style="background:rgba(255,255,255,.03);border:1px solid var(--glass-border);border-radius:10px;padding:8px 12px;font-size:.75rem;">
                <div style="font-weight:600;color:var(--text-secondary);margin-bottom:4px;">Histórico</div>
                ${pags.map(p => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05);">
                    <span style="color:var(--text-secondary);">${p.desc||'Pagamento'} · ${new Date(p.ts).toLocaleDateString('pt-BR')}</span>
                    <span style="color:#10b981;font-weight:700;">+R$ ${Number(p.valor).toFixed(2).replace('.',',')}</span>
                </div>`).join('')}
            </div>` : ''}

            ${!isPago ? `
            <div>
                <label style="font-size:.83rem;font-weight:600;color:var(--text-color);display:block;margin-bottom:6px;">
                    ${total > 0 ? 'Novo pagamento' : 'Valor recebido'}
                </label>
                <div class="input-group">
                    <span class="input-group-text">R$</span>
                    <input type="number" id="repRegPagValor" class="form-control"
                        placeholder="0,00" step="0.01" min="0"
                        value="${saldo > 0 ? saldo.toFixed(2) : ''}"
                        style="font-size:1.05rem;font-weight:700;">
                </div>
                <input type="text" id="repRegPagDesc" class="form-control" style="margin-top:6px;font-size:.85rem;"
                    placeholder="Descrição" value="${pags.length === 0 ? 'Entrada' : 'Parcela ' + (pags.length + 1)}">
            </div>
            <button id="repRegPagSalvar" class="rep-btn rep-btn-green" style="width:100%;justify-content:center;padding:13px;">
                <i class="bi bi-check-circle-fill"></i> Salvar pagamento
            </button>` : `
            <div style="text-align:center;padding:12px;color:#10b981;font-weight:600;">✅ Conserto já está quitado!</div>`}

            <button id="repRegPagFechar" class="rep-btn rep-btn-ghost" style="width:100%;justify-content:center;padding:11px;">Fechar</button>
        </div>
    </div>`;
    document.body.appendChild(ov);

    const close = () => { ov.classList.remove('active'); setTimeout(() => ov.remove(), 300); };
    ov.querySelector('#repRegPagClose').addEventListener('click', close);
    ov.querySelector('#repRegPagFechar').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });

    const salvarBtn = ov.querySelector('#repRegPagSalvar');
    if (salvarBtn) {
        salvarBtn.addEventListener('click', async () => {
            const v = parseFloat(ov.querySelector('#repRegPagValor')?.value);
            if (isNaN(v) || v <= 0) { showToast('⚠️ Informe o valor.'); return; }
            const desc = ov.querySelector('#repRegPagDesc')?.value?.trim() || 'Pagamento';
            salvarBtn.disabled = true;
            salvarBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Salvando...';
            try {
                const fresh = allRepairs.find(x => x.id === repair.id) || repair;
                const pagsAtuais = getPagamentos(fresh);
                const novoPag   = { valor: v, ts: Date.now(), desc };
                const novosPags = [...pagsAtuais, novoPag];
                const novoTotal = novosPags.reduce((s, p) => s + Number(p.valor), 0);
                const cobradoFresh = Number(fresh.valorCobrado || 0);
                const quitado = cobradoFresh > 0 && novoTotal >= cobradoFresh;
                const updated = { ...fresh, pagamentos: novosPags };
                if (quitado) { updated.pagamento = PAG_STATUS.RECEBIDO; updated.tsPagamentoRecebido = Date.now(); }
                await saveRepair(updated);
                showToast('✅ Pagamento registrado!');
                window.dispatchEvent(new CustomEvent('fin:pagamento_recebido', { detail: { repair: updated } }));
                close();
            } catch(err) {
                showToast('❌ Erro: ' + err.message);
                salvarBtn.disabled = false;
                salvarBtn.innerHTML = '<i class="bi bi-check-circle-fill"></i> Salvar pagamento';
            }
        });
    }
    ov.classList.add('active');
    setTimeout(() => ov.querySelector('#repRegPagValor')?.focus(), 200);
}

function confirmarPagamentoRecebido(repair) {
    abrirBannerEntregue(repair);
}

// ============================================================
// MODAL DEFINIR VALOR COBRADO — quando não foi informado antes
// ============================================================
function abrirModalDefinirValor(repair) {
    const oldOv = document.getElementById('repDefinirValorOverlay');
    if (oldOv) oldOv.remove();

    const ov = document.createElement('div');
    ov.id = 'repDefinirValorOverlay';
    ov.className = 'rep-modal-overlay';
    ov.innerHTML = `
    <div class="rep-modal" style="max-width:360px;">
        <div class="rep-modal-header">
            <span>💵 Definir Valor Cobrado</span>
            <button class="rep-modal-close" id="repDefValClose"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="rep-modal-body" style="gap:12px;">
            <div style="background:rgba(255,255,255,.04);border:1px solid var(--glass-border);border-radius:12px;padding:10px 14px;font-size:.88rem;">
                ${repair.numero ? `<span style="opacity:.5;font-size:.8rem;">#${repair.numero}</span> ` : ''}<strong>${escHtml(repair.nomeCliente)}</strong>
                ${repair.modeloAparelho ? `<div style="font-size:.78rem;color:var(--text-secondary);margin-top:2px;">${escHtml(repair.modeloAparelho)}</div>` : ''}
            </div>
            <div>
                <label style="font-size:.83rem;font-weight:600;color:var(--text-color);display:block;margin-bottom:6px;">
                    Valor total do serviço
                </label>
                <div class="input-group">
                    <span class="input-group-text">R$</span>
                    <input type="number" id="repDefValInput" class="form-control"
                        placeholder="0,00" step="0.01" min="0"
                        style="font-size:1.05rem;font-weight:700;">
                </div>
            </div>
            <div style="display:flex;gap:8px;">
                <button id="repDefValCancelar" class="rep-btn rep-btn-ghost" style="flex:1;justify-content:center;">Cancelar</button>
                <button id="repDefValSalvar" class="rep-btn rep-btn-green" style="flex:1;justify-content:center;">
                    <i class="bi bi-check-circle-fill"></i> Salvar
                </button>
            </div>
        </div>
    </div>`;
    document.body.appendChild(ov);

    const close = () => { ov.classList.remove('active'); setTimeout(() => ov.remove(), 300); };
    ov.querySelector('#repDefValClose').addEventListener('click', close);
    ov.querySelector('#repDefValCancelar').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });

    ov.querySelector('#repDefValSalvar').addEventListener('click', async () => {
        const v = parseFloat(ov.querySelector('#repDefValInput')?.value);
        if (isNaN(v) || v <= 0) { showToast('⚠️ Informe o valor.'); return; }
        const btn = ov.querySelector('#repDefValSalvar');
        btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Salvando...';
        try {
            const fresh = allRepairs.find(x => x.id === repair.id) || repair;
            await saveRepair({ ...fresh, valorCobrado: v });
            showToast('✅ Valor definido!');
            close();
        } catch(err) {
            showToast('❌ Erro: ' + err.message);
            btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-circle-fill"></i> Salvar';
        }
    });

    ov.classList.add('active');
    setTimeout(() => ov.querySelector('#repDefValInput')?.focus(), 200);
}

// ============================================================
// EDITAR LINHA DE PAGAMENTO INDIVIDUAL
// ============================================================
function abrirEditarLinhaPagamento(repair, idx) {
    const pags = getPagamentos(repair);
    const pag  = pags[idx];
    if (!pag) return;

    const oldOv = document.getElementById('repEditLinhaPagOverlay');
    if (oldOv) oldOv.remove();

    const ov = document.createElement('div');
    ov.id = 'repEditLinhaPagOverlay';
    ov.className = 'rep-modal-overlay';
    ov.innerHTML = `
    <div class="rep-modal" style="max-width:360px;">
        <div class="rep-modal-header">
            <span>✏️ Editar Pagamento</span>
            <button class="rep-modal-close" id="repEditLinhaPagClose"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="rep-modal-body" style="gap:12px;">
            <div style="padding:8px 12px;border-radius:10px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);font-size:.8rem;color:var(--rep-orange);">
                ⚠️ Você está editando um pagamento já registrado.
            </div>
            <div>
                <label style="font-size:.82rem;font-weight:600;display:block;margin-bottom:6px;">Valor (R$)</label>
                <div class="input-group">
                    <span class="input-group-text">R$</span>
                    <input type="number" id="repEditLinhaPagValor" class="form-control"
                        step="0.01" min="0"
                        value="${Number(pag.valor).toFixed(2)}"
                        style="font-size:1.05rem;font-weight:700;">
                </div>
            </div>
            <div>
                <label style="font-size:.82rem;font-weight:600;display:block;margin-bottom:6px;">Descrição</label>
                <input type="text" id="repEditLinhaPagDesc" class="form-control"
                    value="${escHtml(pag.desc || '')}" placeholder="Ex: Entrada, Parcela 2...">
            </div>
            <div style="display:flex;gap:8px;margin-top:4px;">
                <button id="repEditLinhaPagCancelar" class="rep-btn rep-btn-ghost" style="flex:1;justify-content:center;">Cancelar</button>
                <button id="repEditLinhaPagSalvar" class="rep-btn rep-btn-green" style="flex:1;justify-content:center;"><i class="bi bi-check-lg"></i> Salvar</button>
            </div>
        </div>
    </div>`;
    document.body.appendChild(ov);

    const close = () => { ov.classList.remove('active'); setTimeout(() => ov.remove(), 300); };
    ov.querySelector('#repEditLinhaPagClose').addEventListener('click', close);
    ov.querySelector('#repEditLinhaPagCancelar').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });

    ov.querySelector('#repEditLinhaPagSalvar').addEventListener('click', async () => {
        const novoValor = parseFloat(ov.querySelector('#repEditLinhaPagValor').value);
        if (isNaN(novoValor) || novoValor <= 0) { showToast('⚠️ Informe um valor válido.'); return; }
        const novaDesc = ov.querySelector('#repEditLinhaPagDesc').value.trim() || 'Pagamento';
        const btn = ov.querySelector('#repEditLinhaPagSalvar');
        btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Salvando...';
        try {
            const fresh = allRepairs.find(x => x.id === repair.id) || repair;
            const novosPags = [...getPagamentos(fresh)];
            novosPags[idx] = { ...novosPags[idx], valor: novoValor, desc: novaDesc };
            const novoTotal = novosPags.reduce((s, p) => s + Number(p.valor), 0);
            const cobrado   = Number(fresh.valorCobrado || 0);
            const quitado   = cobrado > 0 && novoTotal >= cobrado;
            const updated   = { ...fresh, pagamentos: novosPags };
            if (quitado) { updated.pagamento = PAG_STATUS.RECEBIDO; updated.tsPagamentoRecebido = Date.now(); }
            else { delete updated.pagamento; delete updated.tsPagamentoRecebido; }
            await saveRepair(updated);
            showToast('✅ Pagamento atualizado!');
            close();
        } catch(err) {
            showToast('❌ Erro: ' + err.message);
            btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-lg"></i> Salvar';
        }
    });

    ov.classList.add('active');
    setTimeout(() => ov.querySelector('#repEditLinhaPagValor')?.focus(), 200);
}

// ============================================================
// EXCLUIR LINHA DE PAGAMENTO INDIVIDUAL
// ============================================================
function confirmarExcluirLinhaPagamento(repair, idx) {
    const pags = getPagamentos(repair);
    const pag  = pags[idx];
    if (!pag) return;

    const oldOv = document.getElementById('repDelLinhaPagOverlay');
    if (oldOv) oldOv.remove();

    const ov = document.createElement('div');
    ov.id = 'repDelLinhaPagOverlay';
    ov.className = 'rep-modal-overlay';
    ov.innerHTML = `
    <div class="rep-modal" style="max-width:340px;">
        <div class="rep-modal-header">
            <span>🗑️ Excluir Pagamento</span>
            <button class="rep-modal-close" id="repDelLinhaPagClose"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="rep-modal-body" style="gap:12px;">
            <div style="padding:12px 14px;border-radius:12px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);font-size:.84rem;">
                Deseja excluir o registro <strong>${escHtml(pag.desc || 'Pagamento')}</strong> de
                <strong style="color:var(--rep-green);">R$ ${Number(pag.valor).toFixed(2).replace('.',',')}</strong>?<br>
                <span style="font-size:.75rem;color:var(--text-secondary);">Esta ação não pode ser desfeita.</span>
            </div>
            <div style="display:flex;gap:8px;">
                <button id="repDelLinhaPagCancelar" class="rep-btn rep-btn-ghost" style="flex:1;justify-content:center;">Cancelar</button>
                <button id="repDelLinhaPagConfirmar" class="rep-btn rep-btn-danger" style="flex:1;justify-content:center;"><i class="bi bi-trash-fill"></i> Excluir</button>
            </div>
        </div>
    </div>`;
    document.body.appendChild(ov);

    const close = () => { ov.classList.remove('active'); setTimeout(() => ov.remove(), 300); };
    ov.querySelector('#repDelLinhaPagClose').addEventListener('click', close);
    ov.querySelector('#repDelLinhaPagCancelar').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });

    ov.querySelector('#repDelLinhaPagConfirmar').addEventListener('click', async () => {
        const btn = ov.querySelector('#repDelLinhaPagConfirmar');
        btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Excluindo...';
        try {
            const fresh = allRepairs.find(x => x.id === repair.id) || repair;
            const novosPags = getPagamentos(fresh).filter((_, i) => i !== idx);
            const novoTotal = novosPags.reduce((s, p) => s + Number(p.valor), 0);
            const cobrado   = Number(fresh.valorCobrado || 0);
            const quitado   = cobrado > 0 && novoTotal >= cobrado;
            const updated   = { ...fresh, pagamentos: novosPags };
            if (!quitado) { delete updated.pagamento; delete updated.tsPagamentoRecebido; }
            await saveRepair(updated);
            showToast('🗑️ Pagamento excluído!');
            close();
        } catch(err) {
            showToast('❌ Erro: ' + err.message);
            btn.disabled = false; btn.innerHTML = '<i class="bi bi-trash-fill"></i> Excluir';
        }
    });

    ov.classList.add('active');
}

// ============================================================
// BANNER DE RESUMO — aba Entregue (clique no card ou no pill)
// ============================================================
function abrirBannerEntregue(repair) {
    // Remove overlay anterior se existir
    const oldOv = document.getElementById('repEntregaBannerOverlay');
    if (oldOv) oldOv.remove();

    const valorAtual   = repair.valorCobrado ? Number(repair.valorCobrado) : 0;
    const pagsAtual    = getPagamentos(repair);
    const totalPago    = getTotalPago(repair);
    const saldo        = getSaldo(repair);
    const valorFmt     = valorAtual > 0 ? 'R$ ' + valorAtual.toFixed(2).replace('.', ',') : 'Não informado';
    const isPago       = valorAtual > 0 && saldo === 0 && totalPago > 0;

    const overlay = document.createElement('div');
    overlay.id = 'repEntregaBannerOverlay';
    overlay.className = 'rep-modal-overlay';
    overlay.innerHTML = `
    <div class="rep-modal" style="max-width:380px;">
        <div class="rep-modal-header">
            <span>🤝 Resumo da Entrega</span>
            <button class="rep-modal-close" id="repBannerClose"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="rep-modal-body" style="gap:10px;">
            <!-- Info do conserto -->
            <div style="background:rgba(255,255,255,.04);border:1px solid var(--glass-border);border-radius:14px;padding:14px 16px;margin-bottom:4px;">
                <div style="font-size:1rem;font-weight:700;color:var(--text-color);">
                    ${repair.numero ? `<span style="opacity:.5;font-size:.8rem;">#${repair.numero}</span> ` : ''}${escHtml(repair.nomeCliente)}
                </div>
                ${repair.modeloAparelho ? `<div style="font-size:.8rem;color:var(--text-secondary);margin-top:2px;">${escHtml(repair.modeloAparelho)}</div>` : ''}
                ${repair.descricaoDefeito ? `<div style="font-size:.78rem;color:var(--text-secondary);margin-top:6px;opacity:.7;">${escHtml(repair.descricaoDefeito)}</div>` : ''}
            </div>

            <!-- Status de pagamento -->
            <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:12px;background:${isPago?'rgba(16,185,129,.1)':'rgba(245,158,11,.1)'};border:1px solid ${isPago?'rgba(16,185,129,.3)':'rgba(245,158,11,.3)'};">
                <span style="font-size:1.3rem;">${isPago?'✅':'💰'}</span>
                <div>
                    <div style="font-size:.82rem;font-weight:700;color:${isPago?'var(--rep-green)':'#f59e0b'};">
                        ${isPago?'Pago — quitado':'Pagamento pendente'}
                    </div>
                    <div style="font-size:.75rem;color:var(--text-secondary);">Total: ${valorFmt}</div>
                    ${totalPago > 0 && !isPago ? `<div style="font-size:.75rem;color:var(--text-secondary);">Recebido: R$ ${totalPago.toFixed(2).replace('.',',')} · <strong style="color:var(--rep-orange);">Saldo: R$ ${saldo.toFixed(2).replace('.',',')}</strong></div>` : ''}
                </div>
            </div>

            ${pagsAtual.length > 0 ? `
            <div style="background:rgba(255,255,255,.03);border:1px solid var(--glass-border);border-radius:10px;padding:8px 12px;font-size:.76rem;">
                <div style="font-weight:600;color:var(--text-secondary);margin-bottom:5px;">Histórico de pagamentos</div>
                ${pagsAtual.map(p => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05);">
                    <span style="color:var(--text-secondary);">${p.desc||'Pagamento'} · ${new Date(p.ts).toLocaleDateString('pt-BR')}</span>
                    <span style="color:#10b981;font-weight:700;">+R$ ${Number(p.valor).toFixed(2).replace('.',',')}</span>
                </div>`).join('')}
            </div>` : ''}

            ${!isPago ? `
            <!-- Registrar pagamento -->
            <div style="margin-top:6px;">
                <label style="font-size:.83rem;font-weight:600;color:var(--text-color);display:block;margin-bottom:6px;">
                    <i class="bi bi-cash-coin" style="color:var(--rep-green);"></i> ${totalPago > 0 ? 'Registrar mais um pagamento' : 'Registrar pagamento'}
                </label>
                <div class="input-group">
                    <span class="input-group-text">R$</span>
                    <input type="number" id="repBannerValorInput" class="form-control"
                        placeholder="0,00" step="0.01" min="0"
                        value="${saldo > 0 ? saldo.toFixed(2) : valorAtual > 0 ? valorAtual.toFixed(2) : ''}"
                        style="font-size:1.05rem;font-weight:700;">
                </div>
                <input type="text" id="repBannerDescInput" class="form-control" style="margin-top:6px;font-size:.85rem;"
                    placeholder="Descrição (ex: Entrada, Parcela 2...)" value="${pagsAtual.length === 0 ? 'Pagamento total' : 'Parcela ' + (pagsAtual.length + 1)}">
                <div style="font-size:.7rem;color:var(--text-secondary);margin-top:4px;opacity:.7;">
                    Para pagamento parcelado, registre cada parte separadamente.
                </div>
            </div>
            <button id="repBannerDarBaixa" class="rep-btn rep-btn-green" style="width:100%;justify-content:center;padding:13px;margin-top:2px;">
                <i class="bi bi-check-circle-fill"></i> Registrar pagamento
            </button>
            ` : ''}

            <button id="repBannerFechar" class="rep-btn rep-btn-ghost" style="width:100%;justify-content:center;padding:11px;">
                Fechar
            </button>
        </div>
    </div>`;
    document.body.appendChild(overlay);

    const close = () => { overlay.classList.remove('active'); setTimeout(() => overlay.remove(), 300); };

    overlay.querySelector('#repBannerClose').addEventListener('click', close);
    overlay.querySelector('#repBannerFechar').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    const darBaixaBtn = overlay.querySelector('#repBannerDarBaixa');
    if (darBaixaBtn) {
        darBaixaBtn.addEventListener('click', async () => {
            const v = parseFloat(overlay.querySelector('#repBannerValorInput')?.value);
            if (isNaN(v) || v <= 0) { showToast('⚠️ Informe o valor recebido.'); return; }
            const desc = overlay.querySelector('#repBannerDescInput')?.value?.trim() || 'Pagamento';
            darBaixaBtn.disabled = true;
            darBaixaBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Salvando...';
            try {
                // Recupera repair fresco do array para ter pagamentos atualizados
                const fresh = allRepairs.find(x => x.id === repair.id) || repair;
                const pagsAtuais = getPagamentos(fresh);
                const novoPag = { valor: v, ts: Date.now(), desc };
                const novosPags = [...pagsAtuais, novoPag];
                const novoTotal = novosPags.reduce((s, p) => s + Number(p.valor), 0);
                const cobrado   = Number(fresh.valorCobrado || 0);
                const quitado   = cobrado > 0 && novoTotal >= cobrado;
                const updated   = { ...fresh, pagamentos: novosPags };
                if (quitado) { updated.pagamento = PAG_STATUS.RECEBIDO; updated.tsPagamentoRecebido = Date.now(); }
                await saveRepair(updated);
                showToast('✅ Pagamento registrado!');
                window.dispatchEvent(new CustomEvent('fin:pagamento_recebido', { detail: { repair: updated } }));
                close();
            } catch(err) {
                showToast('❌ Erro: ' + err.message);
                darBaixaBtn.disabled = false;
                darBaixaBtn.innerHTML = '<i class="bi bi-check-circle-fill"></i> Registrar pagamento';
            }
        });
    }

    overlay.classList.add('active');
    // Foca no input de valor
    setTimeout(() => { overlay.querySelector('#repBannerValorInput')?.focus(); }, 200);
}

function confirmUndo(repair) {
    if (!repair || !PREV_STATUS[repair.status]) return;

    // Se é FINALIZADO e tem pagamentos registrados, pergunta o que fazer
    if (repair.status === STATUS.FINALIZADO && getPagamentos(repair).length > 0) {
        const oldOv = document.getElementById('repUndoPayOverlay');
        if (oldOv) oldOv.remove();
        const totalPagoStr = getTotalPago(repair).toFixed(2).replace('.', ',');
        const ov = document.createElement('div');
        ov.id = 'repUndoPayOverlay';
        ov.className = 'rep-modal-overlay';
        ov.innerHTML = `
        <div class="rep-modal" style="max-width:360px;">
            <div class="rep-modal-header"><span>↩️ Desfazer entrega</span></div>
            <div class="rep-modal-body" style="gap:10px;">
                <div style="font-size:.88rem;color:var(--text-secondary);background:rgba(255,255,255,.04);border-radius:10px;padding:12px;">
                    <strong>${escHtml(repair.nomeCliente)}</strong> voltará para <strong>${STATUS_LABEL[PREV_STATUS[repair.status]]}</strong>.
                </div>
                <div style="font-size:.85rem;color:var(--rep-orange);background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:10px;padding:12px;">
                    💰 <strong>R$ ${totalPagoStr}</strong> já foram registrados como pagamento. O que fazer?
                </div>
                <button id="undoKeepPay" class="rep-btn rep-btn-ghost" style="width:100%;justify-content:center;padding:12px;">
                    ✅ Manter pagamento no financeiro
                </button>
                <button id="undoRemovePay" class="rep-btn" style="width:100%;justify-content:center;padding:12px;background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3);">
                    🗑️ Desfazer pagamento também
                </button>
                <button id="undoPayCancel" class="rep-btn rep-btn-ghost" style="width:100%;justify-content:center;padding:11px;opacity:.6;">
                    Cancelar
                </button>
            </div>
        </div>`;
        document.body.appendChild(ov);
        ov.classList.add('active');
        const closeOv = () => { ov.classList.remove('active'); setTimeout(() => ov.remove(), 300); };
        ov.querySelector('#undoPayCancel').addEventListener('click', closeOv);
        ov.querySelector('#undoKeepPay').addEventListener('click', async () => {
            closeOv(); await executeUndo(repair, true); // true = manter pagamentos
        });
        ov.querySelector('#undoRemovePay').addEventListener('click', async () => {
            closeOv(); await executeUndo(repair, false); // false = apagar pagamentos
        });
        return;
    }

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

async function executeUndo(repair, keepPayments = false) {
    const prevStatus = PREV_STATUS[repair.status];
    const tlKey      = PREV_TL_KEY[repair.status];
    if (!prevStatus || !tlKey) return;
    try {
        const newTimeline = { ...repair.timeline };
        delete newTimeline[tlKey];
        const updateData = { ...repair, status: prevStatus, timeline: newTimeline };
        // Desfazendo entrega
        if (repair.status === STATUS.FINALIZADO) {
            if (keepPayments) {
                // Mantém os pagamentos mas remove o status de entregue
                // pagamentos e tsPagamentoRecebido ficam intactos
            } else {
                // Apaga tudo relacionado a pagamento
                updateData.pagamentos          = null;
                updateData.pagamento           = null;
                updateData.tsPagamentoRecebido = null;
                updateData.valorEntrada        = null;
            }
        }
        await saveRepair(updateData);
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
function renderPhotosGrid() {
    const grid = document.getElementById('repFormPhotosGrid');
    if (!grid) return;
    // Remove all preview slots, keep add slot
    grid.querySelectorAll('.rep-photo-thumb').forEach(el => el.remove());
    repairPhotos.forEach((p, i) => {
        const div = document.createElement('div');
        div.className = 'rep-photo-thumb';
        div.innerHTML = `<img src="${p.url || (p.blob ? URL.createObjectURL(p.blob) : '')}" alt="foto ${i+1}">
            <button class="rep-photo-rm" data-idx="${i}" type="button"><i class="bi bi-x"></i></button>`;
        grid.insertBefore(div, document.getElementById('repPhotoAddSlot'));
    });
    // Hide add slot if 4 photos reached
    const addSlot = document.getElementById('repPhotoAddSlot');
    if (addSlot) addSlot.style.display = repairPhotos.length >= 5 ? 'none' : 'flex';
    // Bind remove buttons
    grid.querySelectorAll('.rep-photo-rm').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            repairPhotos.splice(parseInt(btn.dataset.idx), 1);
            renderPhotosGrid();
        });
    });
}

function openRepairForm(repair = null) {
    repairPhotos = [];
    // Load existing photos
    if (repair?.fotosUrls && Array.isArray(repair.fotosUrls)) {
        repairPhotos = repair.fotosUrls.map(u => ({ blob: null, url: u }));
    } else if (repair?.fotoUrl) {
        repairPhotos = [{ blob: null, url: repair.fotoUrl }];
    }

    const overlay = document.getElementById('repFormOverlay');
    const title   = document.getElementById('repFormTitle');
    const idInput = document.getElementById('repFormId');
    const nome    = document.getElementById('repFormNome');
    const tel     = document.getElementById('repFormTel');
    const modelo  = document.getElementById('repFormModelo');
    const defeito = document.getElementById('repFormDefeito');
    const prazo   = document.getElementById('repFormPrazoDatetime');

    if (!overlay || !title) return;

    title.textContent = repair ? 'Editar Conserto' : 'Novo Conserto';
    idInput.value     = repair?.id || '';
    nome.value        = repair?.nomeCliente || '';
    tel.value         = repair?.numeroCliente || '';
    const cpfEl = document.getElementById('repFormCpf');
    if (cpfEl) cpfEl.value = repair?.cpfCliente || '';
    const anotEl = document.getElementById('repFormAnotacao');
    if (anotEl) anotEl.value = repair?.anotacaoInterna || '';

    // Preencher toggle tipo cliente
    const tipoVal = repair?.tipoCliente || 'final';
    const tipoValEl = document.getElementById('repFormTipoClienteVal');
    const btnFinal   = document.getElementById('repFormTipoFinal');
    const btnLojista = document.getElementById('repFormTipoLojista');
    if (tipoValEl) tipoValEl.value = tipoVal;
    if (btnFinal && btnLojista) {
        if (tipoVal === 'lojista') {
            btnLojista.style.background = 'rgba(59,130,246,.18)';
            btnLojista.style.color = '#3b82f6';
            btnLojista.style.borderColor = '#3b82f6';
            btnFinal.style.background = '';
            btnFinal.style.color = '';
            btnFinal.style.borderColor = '';
        } else {
            btnFinal.style.background = 'var(--primary-color)';
            btnFinal.style.color = '#fff';
            btnFinal.style.borderColor = 'var(--primary-color)';
            btnLojista.style.background = '';
            btnLojista.style.color = '';
            btnLojista.style.borderColor = '';
        }
    }

    // Preencher canal (loja física / instagram)
    const canalVal = repair?.canal || 'fisica';
    const canalValEl = document.getElementById('repFormCanalVal');
    if (canalValEl) canalValEl.value = canalVal;
    if (typeof window._repSetCanal === 'function') window._repSetCanal(canalVal);
    // Restaurar @instagram do cliente se houver
    const instaEl = document.getElementById('repFormInstagram');
    if (instaEl) instaEl.value = repair?.instagramCliente || '';

    // Restaurar campos endereço Instagram
    const setF = (id, val) => { const el = document.getElementById(id); if(el) el.value = val || ''; };
    setF('repFormCep',         repair?.cep);
    setF('repFormRua',         repair?.rua);
    setF('repFormNumero',      repair?.numeroEndereco);
    setF('repFormComplemento', repair?.complemento);
    setF('repFormBairro',      repair?.bairro);
    setF('repFormCidade',      repair?.cidade);

    // Restaurar extras loja física
    setF('repFormEndereco',    repair?.endereco);
    setF('repFormNascimento',  repair?.dataNascimento);
    setF('repFormCor',         repair?.corAparelho);

    // Restaurar IMEI
    setF('repFormImei', repair?.imei);

    // Restaurar estado do aparelho
    const est = repair?.estadoAparelho || {};
    const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
    setChk('repFormEstBateria',   est.bateriaOk);
    setChk('repFormEstArranhoes', est.arranhoes);
    setChk('repFormEstQueda',     est.queda);
    setChk('repFormEstLiga',      est.liga);
    setChk('repFormEstNaoLiga',   est.naoLiga);
    if (modelo)  modelo.value  = repair?.modeloAparelho || '';
    defeito.value     = repair?.descricaoDefeito || '';

    if (prazo) {
        if (repair?.dataMaxima) {
            const hora = repair?.horaMaxima || '00:00';
            prazo.value = repair.dataMaxima + 'T' + hora;
        } else {
            prazo.value = '';
        }
    }

    const prazoLbl = document.getElementById('repFormPrazoLabel');
    if (prazoLbl) {
        if (repair?.dataMaxima) {
            prazoLbl.textContent = formatDate(repair.dataMaxima) + (repair.horaMaxima ? ' às ' + repair.horaMaxima : '');
        } else {
            prazoLbl.textContent = 'Toque para definir data e hora';
        }
    }

    const valorEl = document.getElementById('repFormValor');
    if (valorEl) valorEl.value = repair?.valorCobrado || '';

    // Entrada / Adiantamento
    const entradaCheck   = document.getElementById('repFormEntradaCheck');
    const entradaSection = document.getElementById('repFormEntradaSection');
    const entradaEl      = document.getElementById('repFormEntrada');
    const saldoLbl       = document.getElementById('repFormSaldoLabel');
    const temEntrada = repair?.valorEntrada > 0;
    if (entradaCheck)   entradaCheck.checked = temEntrada;
    if (entradaSection) entradaSection.style.display = temEntrada ? '' : 'none';
    if (entradaEl)      entradaEl.value = temEntrada ? (repair.valorEntrada || '') : '';
    if (saldoLbl)       saldoLbl.textContent = '';

    // Carregar senha do aparelho
    const senhaTipo = repair?.senhaTipo || 'nenhuma';
    if (typeof window._setSenhaTipo === 'function') window._setSenhaTipo(senhaTipo);
    const pinEl   = document.getElementById('repFormSenhaPin');
    const textoEl = document.getElementById('repFormSenhaTexto');
    if (pinEl)   pinEl.value   = (senhaTipo === 'pin'    && repair?.senhaValor) ? repair.senhaValor : '';
    if (textoEl) textoEl.value = (senhaTipo === 'senha'  && repair?.senhaValor) ? repair.senhaValor : '';
    window._ptnSequence = (senhaTipo === 'padrao' && repair?.senhaValor) ? repair.senhaValor : '';
    if (typeof window._ptnRestoreSequence === 'function') window._ptnRestoreSequence(window._ptnSequence);

    renderPhotosGrid();
    overlay.classList.add('active');
    nome.focus();
}

function closeRepairForm() {
    document.getElementById('repFormOverlay')?.classList.remove('active');
    repairPhotos = [];
}

async function submitRepairForm() {
    if (await _checarBloqueio()) {
        showToast('🔒 Sistema bloqueado. Entre em contato com o suporte para renovar.');
        return;
    }
    const id       = document.getElementById('repFormId').value;
    const nome     = document.getElementById('repFormNome').value.trim();
    const tel      = document.getElementById('repFormTel').value.trim();
    const cpf      = document.getElementById('repFormCpf')?.value.trim() || '';
    const modelo   = document.getElementById('repFormModelo')?.value.trim() || '';
    const defeito  = document.getElementById('repFormDefeito').value.trim();
    const anotacao = document.getElementById('repFormAnotacao')?.value.trim() || '';
    const prazoRaw = document.getElementById('repFormPrazoDatetime')?.value || '';
    const prazo    = prazoRaw ? prazoRaw.split('T')[0] : null;
    const hora     = prazoRaw ? prazoRaw.split('T')[1]?.slice(0,5) || null : null;
    const valor    = parseFloat(document.getElementById('repFormValor')?.value) || null;
    const entradaRaw = parseFloat(document.getElementById('repFormEntrada')?.value) || null;
    const entradaAtiva = document.getElementById('repFormEntradaCheck')?.checked;
    const entrada  = (entradaAtiva && entradaRaw > 0 && valor && entradaRaw < valor) ? entradaRaw : null;
    const tipoCliente = document.getElementById('repFormTipoClienteVal')?.value || 'final';
    const canal       = document.getElementById('repFormCanalVal')?.value || 'fisica';
    const instagramCliente = canal === 'instagram'
        ? (document.getElementById('repFormInstagram')?.value.trim() || '')
        : '';

    // Campos Instagram — endereço
    const cep         = canal === 'instagram' ? (document.getElementById('repFormCep')?.value.trim()         || '') : '';
    const rua         = canal === 'instagram' ? (document.getElementById('repFormRua')?.value.trim()         || '') : '';
    const numero      = canal === 'instagram' ? (document.getElementById('repFormNumero')?.value.trim()      || '') : '';
    const complemento = canal === 'instagram' ? (document.getElementById('repFormComplemento')?.value.trim() || '') : '';
    const bairro      = canal === 'instagram' ? (document.getElementById('repFormBairro')?.value.trim()      || '') : '';
    const cidade      = canal === 'instagram' ? (document.getElementById('repFormCidade')?.value.trim()      || '') : '';

    // Campos Loja Física — extras
    const endereco      = canal === 'fisica' ? (document.getElementById('repFormEndereco')?.value.trim()   || '') : '';
    const nascimento    = canal === 'fisica' ? (document.getElementById('repFormNascimento')?.value        || '') : '';
    const corAparelho   = canal === 'fisica' ? (document.getElementById('repFormCor')?.value.trim()        || '') : '';
    // IMEI + Estado do aparelho (ambos os canais)
    const imei          = document.getElementById('repFormImei')?.value.trim() || '';
    const estadoAparelho = {
        bateriaOk:   document.getElementById('repFormEstBateria')?.checked  || false,
        arranhoes:   document.getElementById('repFormEstArranhoes')?.checked || false,
        queda:       document.getElementById('repFormEstQueda')?.checked     || false,
        liga:        document.getElementById('repFormEstLiga')?.checked      || false,
        naoLiga:     document.getElementById('repFormEstNaoLiga')?.checked   || false,
    };

    if (!nome || !defeito) { showToast('⚠️ Nome do cliente e defeito são obrigatórios.'); return; }

    // Coletar senha
    const senhaTipo = window._senhaTipoAtivo || 'nenhuma';
    let senhaValor = null;
    if (senhaTipo === 'pin')    senhaValor = document.getElementById('repFormSenhaPin')?.value.trim() || null;
    if (senhaTipo === 'senha')  senhaValor = document.getElementById('repFormSenhaTexto')?.value.trim() || null;
    if (senhaTipo === 'padrao') senhaValor = (window._ptnSequence && window._ptnSequence.split('-').length >= 4) ? window._ptnSequence : null;

    const btn = document.getElementById('repFormSaveBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Salvando...'; }

    // Popup de loading (para upload de fotos)
    const hasPhotos = repairPhotos.some(p => p.blob && (!p.url || p.url.startsWith('blob:')));
    if (hasPhotos) showSaveLoading(`Enviando fotos… (0/${repairPhotos.length})`);

    try {
        // Upload PARALELO de todas as fotos pendentes
        const uploadPromises = repairPhotos.map(async (p, i) => {
            if (p.blob && (!p.url || p.url.startsWith('blob:'))) {
                const cloudUrl = await uploadFoto(p.blob);
                if (p.url?.startsWith('blob:')) URL.revokeObjectURL(p.url);
                repairPhotos[i] = { blob: null, url: cloudUrl || '' };
                updateSaveLoading(`Enviando fotos… (${repairPhotos.filter(x => x.url && !x.url.startsWith('blob:')).length}/${repairPhotos.length})`);
            }
        });
        await Promise.all(uploadPromises);
        hideSaveLoading();

        const fotosUrls = repairPhotos.map(p => p.url).filter(u => u && !u.startsWith('blob:'));
        if (hasPhotos && fotosUrls.length === 0) {
            showToast('⚠️ Falha ao enviar fotos. Verifique a conexão.');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-lg"></i> Salvar'; }
            return;
        }
        const fotoUrl = fotosUrls[0] || null;

        const existing = id ? allRepairs.find(r => r.id === id) : null;
        // CORREÇÃO: em edição, faz spread do objeto existente para preservar campos
        // que não estão no formulário (pagamentos, numero, fornecedor, garantia, etc.)
        const data = {
            // ── Preserva TODOS os campos existentes primeiro ──
            ...(existing || {}),
            // ── Sobrescreve com os valores do formulário ──
            nomeCliente:      nome,
            numeroCliente:    tel,
            cpfCliente:       cpf || null,
            anotacaoInterna:  anotacao || null,
            modeloAparelho:   modelo || null,
            descricaoDefeito: defeito,
            dataMaxima:       prazo || null,
            horaMaxima:       hora  || null,
            valorCobrado:     valor,
            valorEntrada:     entrada,
            tipoCliente:      tipoCliente || 'final',
            canal:            canal || 'fisica',
            instagramCliente: instagramCliente || null,
            // Endereço Instagram
            cep:              cep         || null,
            rua:              rua         || null,
            numeroEndereco:   numero      || null,
            complemento:      complemento || null,
            bairro:           bairro      || null,
            cidade:           cidade      || null,
            // Extras Loja Física
            endereco:         endereco    || null,
            dataNascimento:   nascimento  || null,
            corAparelho:      corAparelho || null,
            imei:             imei        || null,
            estadoAparelho:   estadoAparelho,
            fotoUrl:          fotoUrl,
            fotosUrls:        fotosUrls.length > 0 ? fotosUrls : null,
            senhaTipo:        (senhaTipo && senhaTipo !== 'nenhuma') ? senhaTipo : null,
            senhaValor:       senhaValor || null,
            status:           existing?.status || STATUS.RECEBIDO,
            tsCadastro:       existing?.tsCadastro || tsNow(),
            timeline:         existing?.timeline || { cadastro: { ts: tsNow() } },
        };
        if (id) data.id = id;
        console.log('[submitRepairForm] Salvando:', id ? 'EDIT' : 'NEW', 'senha:', data.senhaTipo, data.senhaValor);
        await saveRepair(data);
        // Alimenta o banco de clientes automaticamente
        // Alimenta o banco de clientes com todos os dados pessoais
        if (nome) await clientesUpsert(nome, {
            telefone:         tel,
            cpf:              cpf,
            canal:            canal,
            tipoCliente:      tipoCliente,
            instagramCliente: instagramCliente || null,
            cep:              cep         || null,
            rua:              rua         || null,
            numeroEndereco:   numero      || null,
            complemento:      complemento || null,
            bairro:           bairro      || null,
            cidade:           cidade      || null,
            endereco:         endereco    || null,
            dataNascimento:   nascimento  || null,
        });
        closeRepairForm();
        showToast(id ? '✅ Conserto atualizado!' : '✅ Conserto cadastrado!');
        // Mostra card de comprovante em novos cadastros
        if (!id) {
            setTimeout(() => {
                const saved = allRepairs.find(r => r.nomeCliente === nome && r.descricaoDefeito === defeito);
                if (saved) _mostrarCardComprovante(saved);
            }, 600);
        }
    } catch(e) {
        hideSaveLoading();
        showToast('❌ Erro ao salvar: ' + e.message);
    } finally {
        hideSaveLoading();
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-lg"></i> Salvar'; }
    }
}

// ============================================================
// MODAL DE ESCOLHA MANUAL DE ETAPA
const STATUS_ORDER = [STATUS.RECEBIDO, STATUS.AGUARDANDO_PECA, STATUS.EM_REPARO, STATUS.PRONTO, STATUS.REVISAR, STATUS.AGUARDANDO_RETIRADA, STATUS.FINALIZADO];

function openManualStepModal(repair) {
    const overlay = document.getElementById('repChooseStepOverlay');
    const msgEl   = document.getElementById('repChooseStepMsg');
    const listEl  = document.getElementById('repChooseStepList');
    if (!overlay) return;

    msgEl.innerHTML = `<strong>${escHtml(repair.nomeCliente)}</strong> — selecione a etapa desejada:`;

    // REVISAR é estado interno do checklist — não aparece no seletor manual
    // Repairs em 'revisar' são tratados como 'aguardando_retirada' para exibição
    const statusEfetivo = repair.status === STATUS.REVISAR ? STATUS.AGUARDANDO_RETIRADA : repair.status;
    const ordemVisivel  = STATUS_ORDER.filter(s => s !== STATUS.REVISAR);
    const currentIdx    = ordemVisivel.indexOf(statusEfetivo);

    listEl.innerHTML = ordemVisivel.map((s, idx) => {
        const isCurrent = s === statusEfetivo;
        const color     = STATUS_COLOR[s];
        const label     = STATUS_LABEL[s];
        const dirIcon   = idx > currentIdx ? '<i class="bi bi-arrow-right-circle-fill" style="opacity:.5;font-size:.75rem;"></i>'
                        : idx < currentIdx ? '<i class="bi bi-arrow-left-circle-fill" style="opacity:.5;font-size:.75rem;"></i>'
                        : '';
        return `<button
            class="rep-choose-step-btn${isCurrent ? ' rep-choose-step-btn--current' : ''}"
            style="border-left:3px solid ${color};"
            ${isCurrent ? 'disabled' : `data-choose-status="${s}"`}>
            <span style="color:${color};font-weight:600;">${label}</span>
            ${isCurrent
                ? '<span class="rep-choose-step-tag">etapa atual</span>'
                : dirIcon}
        </button>`;
    }).join('');

    overlay.classList.add('active');

    listEl.querySelectorAll('[data-choose-status]').forEach(btn => {
        btn.onclick = () => {
            overlay.classList.remove('active');
            applyManualStep(repair, btn.dataset.chooseStatus);
        };
    });

    document.getElementById('repChooseStepClose').onclick = () => overlay.classList.remove('active');
}

function applyManualStep(repair, targetStatus) {
    if (targetStatus === repair.status) return;

    const currentIdx = STATUS_ORDER.indexOf(repair.status);
    const targetIdx  = STATUS_ORDER.indexOf(targetStatus);

    if (targetIdx > currentIdx) {
        // Avançando — usa o fluxo normal com foto
        if (targetStatus === STATUS.AGUARDANDO_PECA) {
            openFornecedorModal(repair);
        } else if (targetStatus === STATUS.EM_REPARO) {
            openStepModal(repair, STATUS.EM_REPARO, '📸 Foto: Peça Chegou — Em Reparo', 'Confirmar início do reparo');
        } else if (targetStatus === STATUS.PRONTO) {
            openStepModal(repair, STATUS.PRONTO, '📸 Foto: Conserto Finalizado', 'Confirmar finalização');
        } else if (targetStatus === STATUS.REVISAR) {
            openChecklistModal(repair);
        } else if (targetStatus === STATUS.AGUARDANDO_RETIRADA) {
            openStepModal(repair, STATUS.AGUARDANDO_RETIRADA, '📦 Pronto para Retirada', 'Confirmar');
        } else if (targetStatus === STATUS.FINALIZADO) {
            openPagamentoModal(repair);
        }
    } else {
        // Voltando — força o status sem deletar timeline (apenas registra a mudança)
        confirmForceBackStatus(repair, targetStatus);
    }
}

function confirmForceBackStatus(repair, targetStatus) {
    const overlay = document.getElementById('repUndoOverlay');
    const msgEl   = document.getElementById('repUndoMsg');
    const btnYes  = document.getElementById('repUndoYes');
    const btnNo   = document.getElementById('repUndoNo');
    if (!overlay) return;

    const corAlvo = STATUS_COLOR[targetStatus];
    msgEl.innerHTML = `
        <strong>${escHtml(repair.nomeCliente)}</strong><br>
        <div style="margin-top:12px;padding:10px 12px;background:rgba(255,255,255,.04);border-radius:8px;font-size:.83rem;line-height:1.9;">
            Status atual: <span style="color:${STATUS_COLOR[repair.status]};font-weight:600;">${STATUS_LABEL[repair.status]}</span><br>
            Vai para: <span style="color:${corAlvo};font-weight:600;">${STATUS_LABEL[targetStatus]}</span><br>
            <span style="opacity:.55;font-size:.75rem;">O histórico de timeline existente será mantido.</span>
        </div>`;

    document.querySelector('#repUndoOverlay .rep-modal-header span').textContent = '⚡ Forçar mudança de etapa';
    overlay.classList.add('active');

    const cleanup = () => {
        document.querySelector('#repUndoOverlay .rep-modal-header span').textContent = '↩️ Desfazer Etapa';
        overlay.classList.remove('active');
    };

    btnNo.onclick  = cleanup;
    btnYes.onclick = async () => {
        cleanup();
        try {
            await saveRepair({ ...repair, status: targetStatus });
            showToast(`⚡ Etapa alterada para: ${STATUS_LABEL[targetStatus]}`);
        } catch (e) {
            showToast('❌ Erro ao alterar etapa.');
        }
    };
}

// ============================================================
// CHECKLIST DE REVISÃO
// ============================================================
const CHECKLIST_ITEMS = [
    { key: 'cameraFrontal',   label: 'Câmera frontal'   },
    { key: 'botoesVolume',    label: 'Botões de volume' },
    { key: 'cameraTraseira',  label: 'Câmera traseira'  },
    { key: 'botaoPower',      label: 'Botão power'      },
    { key: 'touchTela',       label: 'Touch tela'       },
    { key: 'bluetooth',       label: 'Bluetooth'        },
    { key: 'teclado',         label: 'Teclado'          },
    { key: 'microfone',       label: 'Microfone'        },
    { key: 'chipWifi',        label: 'Chip/Wifi'        },
    { key: 'carregador',      label: 'Carregador'       },
];

let _checklistRepair = null;

function openChecklistModal(repair) {
    _checklistRepair = repair;
    const overlay = document.getElementById('repChecklistOverlay');
    const container = document.getElementById('repChecklistItems');
    if (!overlay || !container) return;

    const savedChecklist = repair.checklist || {};
    container.innerHTML = CHECKLIST_ITEMS.map(item => {
        const checked = savedChecklist[item.key] === true;
        return `
        <label class="rep-checklist-item${checked ? ' rep-checklist-checked' : ''}" data-key="${item.key}">
            <span class="rep-checklist-box">
                <i class="bi bi-check-lg rep-checklist-icon"></i>
            </span>
            <span class="rep-checklist-label">${item.label}</span>
        </label>`;
    }).join('');

    // Toggle ao clicar
    container.querySelectorAll('.rep-checklist-item').forEach(lbl => {
        lbl.onclick = () => {
            lbl.classList.toggle('rep-checklist-checked');
        };
    });

    overlay.classList.add('active');
}

function closeChecklistModal() {
    document.getElementById('repChecklistOverlay')?.classList.remove('active');
    _checklistRepair = null;
}

async function submitChecklistModal() {
    if (!_checklistRepair) return;
    const repair = _checklistRepair;
    const btn = document.getElementById('repChecklistConfirm');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Salvando...'; }

    const checklist = {};
    document.querySelectorAll('#repChecklistItems .rep-checklist-item').forEach(lbl => {
        checklist[lbl.dataset.key] = lbl.classList.contains('rep-checklist-checked');
    });

    try {
        const update_data = {
            ...repair,
            status: STATUS.REVISAR,
            checklist,
            timeline: {
                ...repair.timeline,
                revisar: { ts: tsNow(), fotoUrl: null },
            },
        };
        await saveRepair(update_data);
        closeChecklistModal();
        showToast('✅ Revisão salva!');
    } catch(e) {
        showToast('❌ Erro: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check2-all"></i> Confirmar Revisão'; }
    }
}

// MODAL DE ETAPA (mudança de status com foto obrigatória)
// ============================================================
let _stepRepair    = null;
let _stepNewStatus = null;
let _stepPhotoRequired = true;

// Avança status sem exigir foto (ex: já tenho a peça → Em Reparo)
async function avancarDiretoSemFoto(repair, newStatus) {
    try {
        const tlKey = newStatus;
        const update_data = {
            ...repair,
            status: newStatus,
            timeline: {
                ...repair.timeline,
                [tlKey]: { ts: tsNow(), fotoUrl: null }
            }
        };
        await saveRepair(update_data);
        showToast('🔧 Em Reparo!');
    } catch(e) {
        showToast('❌ Erro: ' + e.message);
    }
}

function openStepModal(repair, newStatus, photoTitle, btnLabel) {
    _stepRepair = repair; _stepNewStatus = newStatus;
    _stepPhotoRequired = (newStatus !== STATUS.EM_REPARO);
    _stepPhotos = [];
    window._stepSkipPhoto = false;

    const overlay = document.getElementById('repStepOverlay');
    const titleEl = document.getElementById('repStepTitle');
    const btnSave = document.getElementById('repStepSaveBtn');
    const notice  = document.getElementById('repStepPhotoNotice');

    const skipCheck  = document.getElementById('repSkipPhotoCheck');
    const skipBanner = document.getElementById('repSkipPhotoBanner');
    if (skipCheck)  skipCheck.checked     = false;
    if (skipBanner) skipBanner.style.display = 'none';

    const skipLabel = document.getElementById('repSkipPhotoLabel');
    if (skipLabel) skipLabel.style.display = _stepPhotoRequired ? 'flex' : 'none';

    titleEl.textContent = photoTitle;
    btnSave.textContent = btnLabel;
    btnSave.disabled = _stepPhotoRequired;

    if (notice) {
        if (_stepPhotoRequired) {
            notice.innerHTML = '<i class="bi bi-camera-fill"></i> Adicione <strong>ao menos 1 foto</strong> para avançar. Máx: 5 fotos.';
            notice.style.cssText = 'display:block;';
        } else {
            notice.innerHTML = '<i class="bi bi-camera-fill"></i> Foto <strong>opcional</strong> — adicione até 5 fotos desta etapa.';
            notice.style.cssText = 'display:block;opacity:.65;';
        }
    }
    _renderStepPhotosGrid();
    overlay.classList.add('active');
}

function _renderStepPhotosGrid() {
    const grid = document.getElementById('repStepPhotosGrid');
    const addBtns = document.getElementById('repStepPhotoAddBtns');
    if (!grid) return;

    grid.innerHTML = _stepPhotos.map((p, i) => `
        <div class="rep-step-photo-thumb">
            <img src="${p.url}" alt="foto ${i+1}">
            <button class="rep-step-photo-del" data-idx="${i}" title="Remover"><i class="bi bi-x-lg"></i></button>
        </div>
    `).join('');

    grid.querySelectorAll('.rep-step-photo-del').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.idx);
            if (_stepPhotos[idx]?.url?.startsWith('blob:')) URL.revokeObjectURL(_stepPhotos[idx].url);
            _stepPhotos.splice(idx, 1);
            _renderStepPhotosGrid();
            _updateStepSaveBtn();
        });
    });

    // Oculta botões de add quando chegou no limite
    if (addBtns) addBtns.style.display = _stepPhotos.length >= STEP_MAX_PHOTOS ? 'none' : '';
    _updateStepSaveBtn();
}

function _updateStepSaveBtn() {
    const btn = document.getElementById('repStepSaveBtn');
    if (!btn) return;
    const temFoto = _stepPhotos.length > 0;
    btn.disabled = _stepPhotoRequired && !window._stepSkipPhoto && !temFoto;
}

function closeStepModal() {
    document.getElementById('repStepOverlay')?.classList.remove('active');
    _stepRepair = null; _stepNewStatus = null;
    _stepPhotos = [];
    stepPhotoBlob = null; stepPhotoUrl = '';
    window._stepSkipPhoto = false;
    const skipCheck  = document.getElementById('repSkipPhotoCheck');
    const skipBanner = document.getElementById('repSkipPhotoBanner');
    if (skipCheck)  skipCheck.checked = false;
    if (skipBanner) skipBanner.style.display = 'none';
}

// ============================================================
// MODAL DE PAGAMENTO — pergunta se recebeu antes de marcar Entregue
// ============================================================
let _pagRepair = null;

function editarEntradaPagamento(repair) {
    const overlay = document.createElement('div');
    overlay.className = 'rep-modal-overlay';
    const valorAtual   = Number(repair.valorCobrado)  || 0;
    const entradaAtual = Number(repair.valorEntrada)  || 0;
    const temEntrada   = entradaAtual > 0;

    overlay.innerHTML = `
    <div class="rep-modal" style="max-width:380px;">
        <div class="rep-modal-header">
            <span>✏️ Editar Pagamento</span>
            <button class="rep-modal-close" id="repEditEntClose"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="rep-modal-body" style="gap:12px;">

            <div style="padding:10px 14px;border-radius:12px;background:rgba(249,115,22,.08);border:1px solid rgba(249,115,22,.25);font-size:.82rem;color:var(--rep-orange);">
                ⚠️ <strong>Atenção:</strong> você está editando um pagamento já registrado.
            </div>

            <!-- Valor total -->
            <div class="rep-field">
                <label style="font-size:.82rem;font-weight:600;margin-bottom:6px;display:block;"><i class="bi bi-cash-coin" style="color:var(--rep-green);"></i> Valor total do conserto</label>
                <div class="input-group">
                    <span class="input-group-text">R$</span>
                    <input type="number" id="repEditTotal" class="form-control" placeholder="0,00" step="0.01" min="0"
                        value="${valorAtual > 0 ? valorAtual.toFixed(2) : ''}" style="font-size:1.1rem;font-weight:700;">
                </div>
            </div>

            <!-- Recebeu entrada? -->
            <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;background:rgba(6,182,212,.07);border:1px solid rgba(6,182,212,.2);cursor:pointer;user-select:none;">
                <input type="checkbox" id="repEditCheckEnt" style="width:18px;height:18px;accent-color:var(--rep-teal);cursor:pointer;" ${temEntrada ? 'checked' : ''}>
                <span style="font-size:.85rem;color:var(--rep-teal);font-weight:600;"><i class="bi bi-arrow-down-circle-fill"></i> Recebi entrada / adiantamento</span>
            </label>

            <div id="repEditEntSection" style="display:${temEntrada ? 'flex' : 'none'};flex-direction:column;gap:8px;">
                <div class="rep-field">
                    <label style="font-size:.8rem;color:var(--text-secondary);margin-bottom:6px;display:block;">Valor recebido como entrada</label>
                    <div class="input-group">
                        <span class="input-group-text">R$</span>
                        <input type="number" id="repEditEntValor" class="form-control" placeholder="0,00" step="0.01" min="0"
                            value="${entradaAtual > 0 ? entradaAtual.toFixed(2) : ''}" style="font-size:1.1rem;font-weight:700;">
                    </div>
                </div>
                <div id="repEditSaldoAnm" style="font-size:.9rem;font-weight:700;color:var(--rep-orange);padding:4px 2px;min-height:24px;transition:all .3s;"></div>
            </div>

            <div style="display:flex;gap:8px;margin-top:4px;">
                <button id="repEditEntCancelar" class="rep-btn rep-btn-ghost" style="flex:1;justify-content:center;">Cancelar</button>
                <button id="repEditEntSalvar" class="rep-btn rep-btn-primary" style="flex:1;justify-content:center;"><i class="bi bi-check-lg"></i> Salvar</button>
            </div>
        </div>
    </div>`;
    document.body.appendChild(overlay);

    const inpTotal  = overlay.querySelector('#repEditTotal');
    const inpEnt    = overlay.querySelector('#repEditEntValor');
    const checkEnt  = overlay.querySelector('#repEditCheckEnt');
    const secEnt    = overlay.querySelector('#repEditEntSection');
    const saldoAnm  = overlay.querySelector('#repEditSaldoAnm');

    // Animação de contador
    let _animTimer = null;
    function animarContador(de, para) {
        if (_animTimer) clearInterval(_animTimer);
        const dur = 500, steps = 20;
        const step = (para - de) / steps;
        let cur = de, count = 0;
        _animTimer = setInterval(() => {
            cur += step; count++;
            saldoAnm.textContent = 'Saldo: R$ ' + Math.max(0, cur).toFixed(2).replace('.', ',');
            if (count >= steps) { clearInterval(_animTimer); saldoAnm.textContent = 'Saldo: R$ ' + Math.max(0, para).toFixed(2).replace('.', ','); }
        }, dur / steps);
    }

    let _saldoAnterior = Number(repair.valorCobrado) - Number(repair.valorEntrada || 0);

    function atualizarSaldo() {
        const total  = parseFloat(inpTotal.value) || 0;
        const ent    = checkEnt.checked ? (parseFloat(inpEnt?.value) || 0) : 0;
        const novoSaldo = total > 0 && ent > 0 && ent < total ? total - ent : 0;
        if (saldoAnm && checkEnt.checked && novoSaldo !== _saldoAnterior) {
            animarContador(_saldoAnterior, novoSaldo);
            _saldoAnterior = novoSaldo;
        } else if (saldoAnm && !checkEnt.checked) { saldoAnm.textContent = ''; }
    }

    checkEnt.addEventListener('change', () => {
        secEnt.style.display = checkEnt.checked ? 'flex' : 'none';
        atualizarSaldo();
    });
    inpTotal.addEventListener('input', atualizarSaldo);
    inpEnt?.addEventListener('input', atualizarSaldo);
    atualizarSaldo();

    const fechar = () => { if (_animTimer) clearInterval(_animTimer); overlay.remove(); };
    overlay.querySelector('#repEditEntClose').addEventListener('click', fechar);
    overlay.querySelector('#repEditEntCancelar').addEventListener('click', fechar);

    overlay.querySelector('#repEditEntSalvar').addEventListener('click', async () => {
        const total = parseFloat(inpTotal.value);
        if (isNaN(total) || total <= 0) { showToast('⚠️ Informe o valor total do conserto.'); return; }
        const temEnt = checkEnt.checked;
        const entrada = temEnt ? parseFloat(inpEnt?.value) : 0;
        if (temEnt && (!entrada || entrada <= 0)) { showToast('⚠️ Informe o valor da entrada.'); return; }
        if (temEnt && entrada >= total) { showToast('⚠️ A entrada não pode ser igual ou maior que o total.'); return; }
        try {
            // Busca o repair mais recente do allRepairs para não sobrescrever dados novos
            const fresh = allRepairs.find(r => r.id === repair.id) || repair;
            const upd = { ...fresh, valorCobrado: total };
            // null = remove o campo do Firebase; sem null ele não seria deletado
            upd.valorEntrada = (temEnt && entrada > 0) ? entrada : null;
            await saveRepair(upd);
            showToast('✅ Pagamento atualizado!');
            fechar();
        } catch(e) { console.error(e); showToast('❌ Erro ao salvar.'); }
    });

    overlay.classList.add('active');
    setTimeout(() => inpTotal.focus(), 200);
}

function openPagamentoModal(repair) {
    _pagRepair = repair;
    const oldOverlay = document.getElementById('repPagamentoOverlay');
    if (oldOverlay) oldOverlay.remove();

    const valorAtual   = Number(repair.valorCobrado || 0);
    const semValor     = valorAtual <= 0;
    const totalPago    = getTotalPago(repair);
    const saldoAtual   = getSaldo(repair);
    const jaQuitado    = valorAtual > 0 && saldoAtual === 0 && totalPago > 0;
    const temParcial   = totalPago > 0 && saldoAtual > 0;

    // ── CASO 1: Já quitado — pula direto para etapa de foto/entrega ──
    if (jaQuitado) {
        _pagRepair = { ...repair, _pagamentoStatus: PAG_STATUS.RECEBIDO };
        openStepModal(_pagRepair, STATUS.FINALIZADO, '📸 Foto: Entrega ao Cliente', 'Confirmar entrega');
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'repPagamentoOverlay';
    overlay.className = 'rep-modal-overlay';

    // ── CASO 2: Tem pagamento parcial — mostra saldo restante ──
    if (temParcial) {
        const saldoFmt  = saldoAtual.toFixed(2).replace('.', ',');
        const pagoFmt   = totalPago.toFixed(2).replace('.', ',');
        const totalFmt  = valorAtual.toFixed(2).replace('.', ',');

        overlay.innerHTML = `
        <div class="rep-modal" style="max-width:380px;">
            <div class="rep-modal-header">
                <span>🤝 Confirmar Entrega</span>
                <button class="rep-modal-close" id="repPagClose"><i class="bi bi-x-lg"></i></button>
            </div>
            <div class="rep-modal-body" style="gap:12px;">

                <div style="text-align:center;padding:6px 0 8px;">
                    <div style="font-size:1.8rem;margin-bottom:6px;">🤝</div>
                    <div style="font-size:.97rem;font-weight:700;color:var(--text-color);">${escHtml(repair.nomeCliente)}</div>
                    ${repair.modeloAparelho ? `<div style="font-size:.78rem;color:var(--text-secondary);margin-top:2px;">${escHtml(repair.modeloAparelho)}</div>` : ''}
                </div>

                <!-- Resumo financeiro -->
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;">
                    <div style="background:rgba(255,255,255,.04);border:1px solid var(--glass-border);border-radius:10px;padding:10px 6px;">
                        <div style="font-size:.62rem;font-weight:700;text-transform:uppercase;color:var(--text-secondary);margin-bottom:3px;">Total</div>
                        <div style="font-size:.85rem;font-weight:800;color:var(--text-color);">R$ ${totalFmt}</div>
                    </div>
                    <div style="background:rgba(16,185,129,.07);border:1px solid rgba(16,185,129,.2);border-radius:10px;padding:10px 6px;">
                        <div style="font-size:.62rem;font-weight:700;text-transform:uppercase;color:var(--text-secondary);margin-bottom:3px;">Já pago</div>
                        <div style="font-size:.85rem;font-weight:800;color:var(--rep-green);">R$ ${pagoFmt}</div>
                    </div>
                    <div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:10px;padding:10px 6px;">
                        <div style="font-size:.62rem;font-weight:700;text-transform:uppercase;color:var(--text-secondary);margin-bottom:3px;">Saldo</div>
                        <div style="font-size:.85rem;font-weight:800;color:#f59e0b;">R$ ${saldoFmt}</div>
                    </div>
                </div>

                <div style="font-size:.82rem;color:var(--text-secondary);text-align:center;padding:4px 0;">
                    Na entrega, o cliente pagou o restante?
                </div>

                <!-- Botões -->
                <div style="display:flex;flex-direction:column;gap:8px;" id="repPagBotoes">
                    <button id="repPagSim" class="rep-btn rep-btn-green" style="justify-content:center;gap:8px;padding:13px;">
                        <i class="bi bi-check-circle-fill"></i> Sim, recebeu o saldo (R$ ${saldoFmt})
                    </button>
                    <button id="repPagNaoBtn" class="rep-btn" style="justify-content:center;gap:8px;padding:13px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.35);color:#f59e0b;">
                        <i class="bi bi-clock-fill"></i> Não — entregar com saldo pendente
                    </button>
                </div>

                <!-- Seção pendente -->
                <div id="repPagPendenteSection" style="display:none;flex-direction:column;gap:10px;">
                    <div style="padding:10px 14px;border-radius:12px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);font-size:.83rem;color:#f59e0b;font-weight:600;">
                        <i class="bi bi-clock-fill"></i> Saldo de R$ ${saldoFmt} ficará pendente
                    </div>
                    <div class="rep-field">
                        <label style="font-size:.8rem;color:var(--text-secondary);display:block;margin-bottom:6px;">
                            <i class="bi bi-calendar-event-fill"></i> Data de vencimento <span style="opacity:.6;">(opcional)</span>
                        </label>
                        <input type="date" id="repPagVencInput" class="form-control" style="border-radius:10px;">
                    </div>
                    <button id="repPagConfirmarPendente" class="rep-btn" style="justify-content:center;gap:8px;padding:13px;background:rgba(245,158,11,.18);border:1px solid rgba(245,158,11,.45);color:#f59e0b;font-weight:700;width:100%;">
                        <i class="bi bi-check2"></i> Confirmar entrega com pendente
                    </button>
                </div>

            </div>
        </div>`;
        document.body.appendChild(overlay);

        overlay.querySelector('#repPagClose').addEventListener('click', () => { _pagRepair = null; overlay.classList.remove('active'); });
        overlay.addEventListener('click', e => { if (e.target === overlay) { _pagRepair = null; overlay.classList.remove('active'); } });

        // Sim — recebeu o saldo
        overlay.querySelector('#repPagSim').addEventListener('click', () => {
            // Registra o pagamento do saldo restante no array de pagamentos
            const fresh      = allRepairs.find(x => x.id === repair.id) || repair;
            const pagsAtuais = getPagamentos(fresh);
            const novoPag    = { valor: saldoAtual, ts: Date.now(), desc: 'Pagamento na entrega' };
            _pagRepair = {
                ...fresh,
                pagamentos: [...pagsAtuais, novoPag],
                _pagamentoStatus: PAG_STATUS.RECEBIDO,
            };
            overlay.classList.remove('active');
            submitPagamentoRecebido();
        });

        // Não — entregar com saldo pendente
        overlay.querySelector('#repPagNaoBtn').addEventListener('click', () => {
            overlay.querySelector('#repPagBotoes').style.display = 'none';
            overlay.querySelector('#repPagPendenteSection').style.display = 'flex';
        });

        overlay.querySelector('#repPagConfirmarPendente').addEventListener('click', () => {
            const venc = overlay.querySelector('#repPagVencInput')?.value || '';
            _pagRepair._pagamentoVencimentoTemp = venc || null;
            overlay.classList.remove('active');
            submitPagamentoPendente();
        });

        overlay.classList.add('active');
        return;
    }

    // ── CASO 3: Nenhum pagamento ainda — fluxo completo original ──
    const valorInput   = valorAtual > 0 ? valorAtual.toFixed(2) : '';

    overlay.innerHTML = `
    <div class="rep-modal" style="max-width:380px;">
        <div class="rep-modal-header">
            <span>💰 Confirmar Entrega</span>
            <button class="rep-modal-close" id="repPagClose"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="rep-modal-body" style="gap:12px;">

            <div style="text-align:center;padding:6px 0 8px;">
                <div style="font-size:1.8rem;margin-bottom:6px;">🤝</div>
                <div style="font-size:.97rem;font-weight:700;color:var(--text-color);">${escHtml(repair.nomeCliente)}</div>
                ${repair.modeloAparelho ? `<div style="font-size:.78rem;color:var(--text-secondary);margin-top:2px;">${escHtml(repair.modeloAparelho)}</div>` : ''}
            </div>

            <!-- Valor total -->
            <div class="rep-field" style="margin-bottom:4px;">
                <label style="font-size:.82rem;font-weight:600;display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                    <i class="bi bi-cash-coin" style="color:var(--rep-green);"></i>
                    Valor total do conserto *
                    ${semValor ? '<span style="font-size:.72rem;color:#f59e0b;font-weight:700;">⚠️ Não cadastrado</span>' : `<span style="font-size:.72rem;opacity:.55;">R$ ${valorAtual.toFixed(2).replace('.',',')}</span>`}
                </label>
                <div class="input-group">
                    <span class="input-group-text">R$</span>
                    <input type="number" id="repPagValorInput" class="form-control"
                        placeholder="0,00" step="0.01" min="0" value="${valorInput}"
                        style="font-size:1.1rem;font-weight:700;">
                </div>
            </div>

            <!-- Checkbox entrada parcial -->
            <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;background:rgba(6,182,212,.07);border:1px solid rgba(6,182,212,.2);cursor:pointer;user-select:none;">
                <input type="checkbox" id="repPagCheckEntrada" style="width:18px;height:18px;accent-color:var(--rep-teal);cursor:pointer;">
                <span style="font-size:.85rem;color:var(--rep-teal);font-weight:600;"><i class="bi bi-arrow-down-circle-fill"></i> Recebi só entrada / adiantamento</span>
            </label>

            <!-- Seção entrada (oculta por padrão) -->
            <div id="repPagEntradaSection" style="display:none;flex-direction:column;gap:8px;">
                <div class="rep-field">
                    <label style="font-size:.8rem;color:var(--text-secondary);margin-bottom:6px;display:block;">Valor recebido como entrada</label>
                    <div class="input-group">
                        <span class="input-group-text">R$</span>
                        <input type="number" id="repPagEntradaInput" class="form-control"
                            placeholder="0,00" step="0.01" min="0"
                            style="font-size:1.1rem;">
                    </div>
                </div>
                <div id="repPagSaldoPreview" style="display:none;font-size:.82rem;color:var(--text-secondary);padding:2px 4px;"></div>
            </div>

            <!-- Botões de ação -->
            <div id="repPagBotoes" style="display:flex;flex-direction:column;gap:8px;margin-top:4px;">
                <button id="repPagSim" class="rep-btn rep-btn-green" style="justify-content:center;gap:8px;padding:13px;">
                    <i class="bi bi-check-circle-fill"></i> Sim, recebi tudo
                </button>
                <button id="repPagEntradaBtn" class="rep-btn" style="display:none;justify-content:center;gap:8px;padding:13px;background:rgba(6,182,212,.12);border:1px solid rgba(6,182,212,.35);color:var(--rep-teal);">
                    <i class="bi bi-arrow-down-circle-fill"></i> Confirmar entrada recebida
                </button>
                <button id="repPagNaoBtn" class="rep-btn" style="justify-content:center;gap:8px;padding:13px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.35);color:#f59e0b;">
                    <i class="bi bi-clock-fill"></i> Não recebi nada — pendente
                </button>
            </div>

            <!-- Seção pendente -->
            <div id="repPagPendenteSection" style="display:none;flex-direction:column;gap:10px;">
                <div style="padding:10px 14px;border-radius:12px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);font-size:.83rem;color:#f59e0b;font-weight:600;">
                    <i class="bi bi-clock-fill"></i> Pagamento pendente
                </div>
                <div class="rep-field">
                    <label style="font-size:.8rem;color:var(--text-secondary);display:block;margin-bottom:6px;">
                        <i class="bi bi-calendar-event-fill"></i> Data de vencimento <span style="opacity:.6;">(opcional)</span>
                    </label>
                    <input type="date" id="repPagVencInput" class="form-control" style="border-radius:10px;">
                </div>
                <button id="repPagConfirmarPendente" class="rep-btn" style="justify-content:center;gap:8px;padding:13px;background:rgba(245,158,11,.18);border:1px solid rgba(245,158,11,.45);color:#f59e0b;font-weight:700;width:100%;">
                    <i class="bi bi-check2"></i> Confirmar como pendente
                </button>
            </div>

        </div>
    </div>`;
    document.body.appendChild(overlay);

    function lerValor()   { const v = parseFloat(overlay.querySelector('#repPagValorInput')?.value);  return (isNaN(v)||v<=0)?null:v; }
    function lerEntrada() { const v = parseFloat(overlay.querySelector('#repPagEntradaInput')?.value); return (isNaN(v)||v<=0)?null:v; }

    function atualizarSaldo() {
        const total   = parseFloat(overlay.querySelector('#repPagValorInput')?.value) || 0;
        const entrada = parseFloat(overlay.querySelector('#repPagEntradaInput')?.value) || 0;
        const preview = overlay.querySelector('#repPagSaldoPreview');
        if (!preview) return;
        if (entrada > 0 && total > 0 && entrada < total) {
            const saldo = (total - entrada).toFixed(2).replace('.', ',');
            preview.style.display = 'block';
            preview.textContent = 'Saldo a receber: R$ ' + saldo;
        } else { preview.style.display = 'none'; }
    }

    const checkEntrada = overlay.querySelector('#repPagCheckEntrada');
    const secEntrada   = overlay.querySelector('#repPagEntradaSection');
    const btnSim       = overlay.querySelector('#repPagSim');
    const btnEntrada   = overlay.querySelector('#repPagEntradaBtn');
    const btnNao       = overlay.querySelector('#repPagNaoBtn');

    function toggleEntrada() {
        const checked = checkEntrada.checked;
        secEntrada.style.display = checked ? 'flex' : 'none';
        btnSim.style.display     = checked ? 'none' : 'flex';
        btnEntrada.style.display = checked ? 'flex' : 'none';
        btnNao.style.display     = checked ? 'none' : 'flex';
        atualizarSaldo();
    }
    checkEntrada.addEventListener('change', toggleEntrada);
    overlay.querySelector('#repPagValorInput')?.addEventListener('input', atualizarSaldo);
    overlay.querySelector('#repPagEntradaInput')?.addEventListener('input', atualizarSaldo);
    toggleEntrada();

    overlay.querySelector('#repPagClose').addEventListener('click', () => { _pagRepair = null; overlay.classList.remove('active'); });
    overlay.addEventListener('click', e => { if (e.target === overlay) { _pagRepair = null; overlay.classList.remove('active'); } });

    // SIM — recebi tudo
    btnSim.addEventListener('click', () => {
        const v = lerValor();
        if (v === null) { showToast('⚠️ Informe o valor do conserto.'); return; }
        _pagRepair = { ..._pagRepair, valorCobrado: v };
        overlay.classList.remove('active');
        submitPagamentoRecebido();
    });

    // ENTRADA — recebi só parte
    btnEntrada.addEventListener('click', () => {
        const v = lerValor();
        if (v === null) { showToast('⚠️ Informe o valor total do conserto.'); return; }
        const entrada = lerEntrada();
        if (!entrada) { showToast('⚠️ Informe o valor da entrada recebida.'); return; }
        if (entrada >= v) { showToast('⚠️ A entrada não pode ser igual ou maior que o valor total.'); return; }
        _pagRepair = { ..._pagRepair, valorCobrado: v, valorEntrada: entrada };
        overlay.classList.remove('active');
        submitPagamentoPendente();
    });

    // NÃO — pendente total
    btnNao.addEventListener('click', () => {
        const v = lerValor();
        if (v === null) { showToast('⚠️ Informe o valor do conserto.'); return; }
        _pagRepair = { ..._pagRepair, valorCobrado: v };
        overlay.querySelector('#repPagBotoes').style.display = 'none';
        overlay.querySelector('#repPagPendenteSection').style.display = 'flex';
    });

    // CONFIRMAR PENDENTE
    overlay.querySelector('#repPagConfirmarPendente').addEventListener('click', () => {
        const venc = overlay.querySelector('#repPagVencInput')?.value || '';
        overlay.classList.remove('active');
        _pagRepair._pagamentoVencimentoTemp = venc || null;
        submitPagamentoPendente();
    });

    overlay.classList.add('active');
    setTimeout(() => { overlay.querySelector('#repPagValorInput')?.focus(); }, 200);
}

function submitPagamentoRecebido() {
    const repair = _pagRepair;
    _pagRepair = null;
    repair._pagamentoStatus = PAG_STATUS.RECEBIDO;
    // Se tinha garantia ativa, finaliza junto
    if (repair.garantiaAtiva) repair._finalizandoGarantia = true;
    openStepModal(repair, STATUS.FINALIZADO, '📸 Foto: Entrega ao Cliente', 'Confirmar entrega');
}

function submitPagamentoPendente() {
    const repair = _pagRepair;
    const venc = repair._pagamentoVencimentoTemp || null;
    _pagRepair = null;
    repair._pagamentoStatus = PAG_STATUS.PENDENTE;
    repair._pagamentoVencimento = venc;
    // Se tinha garantia ativa, finaliza junto
    if (repair.garantiaAtiva) repair._finalizandoGarantia = true;
    openStepModal(repair, STATUS.FINALIZADO, '📸 Foto: Entrega ao Cliente', 'Confirmar entrega');
}

async function submitStepModal() {
    if (!_stepRepair || !_stepNewStatus) return;
    if (_stepPhotoRequired && !window._stepSkipPhoto && _stepPhotos.length === 0) {
        showToast('⚠️ A foto é obrigatória para avançar.');
        return;
    }
    const btn = document.getElementById('repStepSaveBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Salvando...'; }
    try {
        // Upload PARALELO de todas as fotos da etapa
        if (_stepPhotos.length > 0) showSaveLoading(`Enviando fotos da etapa…`);
        await Promise.all(_stepPhotos.map(async (p, i) => {
            if (p.blob && (!p.url || p.url.startsWith('blob:'))) {
                const cloudUrl = await uploadFoto(p.blob);
                if (p.url?.startsWith('blob:')) URL.revokeObjectURL(p.url);
                _stepPhotos[i] = { blob: null, url: cloudUrl || '' };
            }
        }));
        hideSaveLoading();
        const fotosUrls = _stepPhotos.map(p => p.url).filter(Boolean);

        const tlKey = _stepNewStatus;
        const tsEntrega = tsNow();
        const update_data = {
            ..._stepRepair,
            status: _stepNewStatus,
            timeline: {
                ..._stepRepair.timeline,
                [tlKey]: {
                    ts: tsEntrega,
                    fotoUrl:   fotosUrls[0] || null,   // compat com versões antigas
                    fotosUrls: fotosUrls.length > 0 ? fotosUrls : null,
                },
            },
        };
        // Persiste status de pagamento se veio do modal de pagamento
        if (_stepNewStatus === STATUS.FINALIZADO) {
            update_data.pagamento = _stepRepair._pagamentoStatus || PAG_STATUS.PENDENTE;
            if (_stepRepair._pagamentoStatus === PAG_STATUS.RECEBIDO) {
                update_data.tsPagamentoRecebido = Date.now();
            }
            if (_stepRepair._pagamentoVencimento) {
                update_data.pagamentoVencimento = _stepRepair._pagamentoVencimento;
            }
            // Garante que o valorCobrado atualizado no modal de pagamento seja salvo
            if (_stepRepair.valorCobrado !== undefined) {
                update_data.valorCobrado = _stepRepair.valorCobrado;
            }
            // Se estava finalizando uma garantia, limpa o flag
            if (_stepRepair._finalizandoGarantia) {
                update_data.garantiaAtiva = false;
                update_data.garantiaTs    = null;
                update_data.timeline = {
                    ...update_data.timeline,
                    garantia_entrega: { ts: tsEntrega },
                };
            }
        }
        await saveRepair(update_data);
        if (_stepNewStatus === STATUS.FINALIZADO && update_data.pagamento === PAG_STATUS.RECEBIDO) {
            window.dispatchEvent(new CustomEvent('fin:pagamento_recebido', { detail: { repair: update_data } }));
        }
        const savedStatus = _stepNewStatus; // salva ANTES do closeStepModal zerar
        closeStepModal();
        if (savedStatus === STATUS.FINALIZADO) {
            // Mostra banner perguntando se quer gerar recibo agora
            showReceiptBanner({ ...update_data });
        } else {
            showToast('✅ Status atualizado!');
        }
    } catch(e) {
        hideSaveLoading();
        showToast('❌ Erro: ' + e.message);
    } finally {
        hideSaveLoading();
        if (btn) { btn.disabled = false; btn.innerHTML = 'Confirmar'; }
    }
}

// ============================================================
// BANNER — Recibo após marcar Entregue ao Cliente
// ============================================================
function showReceiptBanner(repair) {
    // Remove banner anterior se existir
    const existing = document.getElementById('repReceiptBanner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'repReceiptBanner';
    banner.style.cssText = [
        'position:fixed',
        'bottom:0',
        'left:0',
        'right:0',
        'z-index:999998',
        'padding:0 12px 12px 12px',
        'pointer-events:none',
        'transform:translateY(100%)',
        'transition:transform .35s cubic-bezier(.34,1.56,.64,1)',
    ].join(';');

    banner.innerHTML = `
    <div style="
        background:linear-gradient(135deg,#0f1f3d 0%,#1a2c52 100%);
        border:1px solid rgba(99,130,230,.35);
        border-radius:18px;
        padding:18px 16px 14px;
        box-shadow:0 -4px 40px rgba(0,0,0,.6), 0 0 0 1px rgba(99,130,230,.15);
        pointer-events:all;
        position:relative;
        overflow:hidden;
    ">
        <!-- Brilho decorativo -->
        <div style="position:absolute;top:-30px;right:-20px;width:120px;height:120px;background:radial-gradient(circle,rgba(99,130,230,.18) 0%,transparent 70%);pointer-events:none;"></div>

        <!-- Botão fechar -->
        <button id="repReceiptBannerClose" style="
            position:absolute;top:10px;right:12px;
            background:rgba(255,255,255,.07);border:none;color:rgba(255,255,255,.5);
            width:28px;height:28px;border-radius:50%;font-size:14px;cursor:pointer;
            display:flex;align-items:center;justify-content:center;line-height:1;
        ">×</button>

        <!-- Ícone + Título -->
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
            <div style="
                width:40px;height:40px;border-radius:12px;flex-shrink:0;
                background:linear-gradient(135deg,#22c55e,#16a34a);
                display:flex;align-items:center;justify-content:center;
                font-size:20px;box-shadow:0 4px 12px rgba(34,197,94,.35);
            ">✅</div>
            <div>
                <div style="font-size:.95rem;font-weight:700;color:#e2e8f0;line-height:1.2;">Entregue ao cliente!</div>
                <div style="font-size:.75rem;color:rgba(148,163,184,.8);margin-top:1px;">
                    ${escHtml(repair.nomeCliente)} · ${repair.modeloAparelho ? escHtml(repair.modeloAparelho) : 'sem modelo'}
                </div>
            </div>
        </div>

        <!-- Pergunta -->
        <div style="
            font-size:.82rem;color:rgba(203,213,225,.85);
            margin:10px 0 12px;padding:10px 12px;
            background:rgba(255,255,255,.04);border-radius:10px;
            border-left:3px solid rgba(99,130,230,.5);
            line-height:1.5;
        ">
            <i class="bi bi-file-earmark-check-fill" style="color:#818cf8;margin-right:4px;"></i>
            Deseja gerar e enviar o <strong style="color:#e2e8f0;">recibo</strong> agora?
        </div>

        <!-- Botões -->
        <div style="display:flex;gap:8px;">
            <button id="repReceiptBannerNow" style="
                flex:1;padding:11px 0;border:none;border-radius:12px;cursor:pointer;
                background:linear-gradient(135deg,#6366f1,#4f46e5);
                color:#fff;font-size:.88rem;font-weight:700;
                box-shadow:0 4px 14px rgba(99,102,241,.4);
                display:flex;align-items:center;justify-content:center;gap:6px;
                transition:opacity .15s;
            ">
                <i class="bi bi-send-fill" style="font-size:.8rem;"></i> Gerar agora
            </button>
            <button id="repReceiptBannerLater" style="
                flex:1;padding:11px 0;border:1px solid rgba(148,163,184,.25);border-radius:12px;cursor:pointer;
                background:rgba(255,255,255,.05);
                color:rgba(203,213,225,.8);font-size:.88rem;font-weight:600;
                display:flex;align-items:center;justify-content:center;gap:6px;
                transition:opacity .15s;
            ">
                <i class="bi bi-clock" style="font-size:.8rem;"></i> Depois
            </button>
        </div>
    </div>`;

    document.body.appendChild(banner);

    // Anima entrada
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            banner.style.transform = 'translateY(0)';
        });
    });

    const closeBanner = () => {
        banner.style.transform = 'translateY(110%)';
        banner.style.transition = 'transform .25s ease-in';
        setTimeout(() => banner.remove(), 280);
    };

    document.getElementById('repReceiptBannerClose').addEventListener('click', closeBanner);

    document.getElementById('repReceiptBannerLater').addEventListener('click', () => {
        closeBanner();
        showToast('✅ Entregue! Recibo disponível no card.');
    });

    document.getElementById('repReceiptBannerNow').addEventListener('click', () => {
        closeBanner();
        // Mesmo fluxo do botão de recibo: abre o modal de garantia
        openGarantiaModal(repair);
    });

    // Fecha automaticamente após 12s se o usuário não interagir
    const autoClose = setTimeout(closeBanner, 12000);
    banner.addEventListener('click', () => clearTimeout(autoClose), { once: true });
}

// ============================================================
// PDF — RECIBO DE ENTRADA
// ============================================================
function gerarReciboPDF(repair) { openGarantiaModal(repair); }


// ============================================================
// PDF — MODAL DE GARANTIA
// ============================================================
let _garantiaRepair = null;

function openGarantiaModal(repair) {
    _garantiaRepair = repair;
    const overlay  = document.getElementById('repGarantiaOverlay');
    const nomeEl   = document.getElementById('repGarNomeCliente');
    const modeloEl = document.getElementById('repGarModelo');
    const servicoEl= document.getElementById('repGarServico');
    const valorEl  = document.getElementById('repGarValor');
    const diasEl   = document.getElementById('repGarDiasCustom');

    if (nomeEl)    nomeEl.textContent   = repair.nomeCliente || '—';
    if (modeloEl)  modeloEl.textContent = repair.modeloAparelho || '—';
    if (servicoEl) servicoEl.value      = repair.descricaoDefeito || '';
    if (valorEl)   valorEl.textContent  = repair.valorCobrado
                                          ? `R$ ${Number(repair.valorCobrado).toFixed(2).replace('.',',')}`
                                          : '—';
    if (diasEl) diasEl.value = '';

    // Reset botões de seleção
    document.querySelectorAll('.rep-gar-dias-btn').forEach(b => b.classList.remove('selected'));

    overlay.classList.add('active');
}

function closeGarantiaModal() {
    document.getElementById('repGarantiaOverlay')?.classList.remove('active');
    _garantiaRepair = null;
}

// ── Dados da loja por canal (sem fallback cruzado) ───────────
function _getLojaConfig(canal) {
    const g = k => (window.cfgGet ? window.cfgGet(k) : localStorage.getItem(k)) || '';
    if (canal === 'instagram') {
        return {
            nome:      g('insta_nome')   || 'Loja Online',
            telefone:  g('insta_tel')    || '',
            endereco:  g('insta_end')    || '',
            instagram: g('insta_handle') || '',
            logo:      g('empresaLogoInstagram') || '',
        };
    }
    return {
        nome:      g('fisica_nome')  || g('assistenciaName') || 'Assistencia Tecnica',
        telefone:  g('fisica_tel')   || g('lojaTelefone')    || '',
        endereco:  g('fisica_end')   || g('lojaEndereco')    || '',
        instagram: g('fisica_insta') || g('lojaInstagram')   || '',
        logo:      g('empresaLogo')  || '',
    };
}

// ── Helper: carregar jsPDF ────────────────────────────────────
async function _loadJsPDF() {
    if (!window.jspdf) {
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
    }
    return window.jspdf.jsPDF;
}

// ── Helper: loading overlay ───────────────────────────────────
function _loadingOverlay(msg) {
    const el = document.createElement('div');
    el.innerHTML = `<div style="position:fixed;inset:0;z-index:99999;background:rgba(10,14,30,.93);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;"><div style="width:46px;height:46px;border:3px solid rgba(255,255,255,.1);border-top-color:#818cf8;border-radius:50%;animation:_rSp .75s linear infinite;"></div><div style="font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:rgba(255,255,255,.7);">${msg}</div><style>@keyframes _rSp{to{transform:rotate(360deg)}}</style></div>`;
    document.body.appendChild(el);
    return el;
}

// ── Helper: modal envio PDF ───────────────────────────────────
function _modalEnvioPDF(repair, pdfBlob, nomeArquivo, titulo) {
    return new Promise(resolve => {
        const msgWpp = montarMsgWhatsApp(repair);
        const tel    = (repair.numeroCliente || '').replace(/\D/g, '');
        const file   = new File([pdfBlob], nomeArquivo, { type: 'application/pdf' });

        const ch = document.createElement('div');
        ch.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(6px);padding:24px;box-sizing:border-box;';
        ch.innerHTML = `
        <div style="width:100%;max-width:320px;background:linear-gradient(160deg,#0f1623,#0c1220);border:1px solid rgba(37,211,102,.18);border-radius:24px;box-shadow:0 24px 60px rgba(0,0,0,.6);overflow:hidden;">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 20px 12px;border-bottom:1px solid rgba(255,255,255,.06);">
                <div>
                    <div style="font-size:1rem;font-weight:700;color:#fff;">📤 ${escHtml(titulo)}</div>
                    <div style="font-size:.72rem;color:rgba(255,255,255,.4);margin-top:2px;">${escHtml(repair.nomeCliente||'cliente')}</div>
                </div>
                <button id="chClose" style="width:32px;height:32px;border-radius:50%;border:none;background:rgba(255,255,255,.08);color:rgba(255,255,255,.5);font-size:.85rem;cursor:pointer;">✕</button>
            </div>
            <div style="padding:16px 16px 20px;display:flex;flex-direction:column;gap:10px;">
                <p style="font-size:.72rem;color:rgba(255,255,255,.38);margin:0 0 4px;text-align:center;text-transform:uppercase;letter-spacing:.3px;">Faça as ações em qualquer ordem</p>
                <button id="chTexto" style="display:flex;align-items:center;gap:14px;width:100%;padding:16px 18px;border-radius:16px;cursor:pointer;background:rgba(37,211,102,.1);border:1.5px solid rgba(37,211,102,.3);text-align:left;transition:opacity .2s,background .2s;">
                    <div style="width:40px;height:40px;border-radius:12px;flex-shrink:0;background:rgba(37,211,102,.15);display:flex;align-items:center;justify-content:center;font-size:1.1rem;color:#25d366;"><i class="bi bi-chat-text-fill"></i></div>
                    <div><div id="chTextoLabel" style="font-size:.88rem;font-weight:700;color:#25d366;margin-bottom:2px;">Enviar mensagem</div><div style="font-size:.68rem;color:rgba(255,255,255,.38);">${tel ? 'Abre o WhatsApp na conversa' : 'Copia o texto'}</div></div>
                </button>
                <button id="chArquivo" style="display:flex;align-items:center;gap:14px;width:100%;padding:16px 18px;border-radius:16px;cursor:pointer;background:rgba(37,211,102,.1);border:1.5px solid rgba(37,211,102,.3);text-align:left;transition:opacity .2s,background .2s;">
                    <div style="width:40px;height:40px;border-radius:12px;flex-shrink:0;background:rgba(37,211,102,.15);display:flex;align-items:center;justify-content:center;font-size:1.1rem;color:#25d366;"><i class="bi bi-file-earmark-arrow-up-fill"></i></div>
                    <div><div id="chArqLabel" style="font-size:.88rem;font-weight:700;color:#25d366;margin-bottom:2px;">Enviar arquivo PDF</div><div style="font-size:.68rem;color:rgba(255,255,255,.38);">Copia o texto + abre compartilhador</div></div>
                </button>
                <button id="chFechar" style="margin-top:4px;width:100%;padding:13px;border-radius:14px;cursor:pointer;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.4);font-size:.82rem;font-weight:600;">Concluído</button>
            </div>
        </div>`;
        document.body.appendChild(ch);

        const fechar = () => { ch.remove(); resolve(); };
        ch.querySelector('#chClose').addEventListener('click', fechar);
        ch.querySelector('#chFechar').addEventListener('click', fechar);

        const marcar = (btn, labelEl, txt) => {
            btn.style.background = 'rgba(255,255,255,.03)';
            btn.style.border = '1.5px solid rgba(255,255,255,.08)';
            btn.style.opacity = '.55';
            labelEl.innerHTML = '<i class="bi bi-check-circle-fill" style="color:#25d366;"></i> ' + txt;
        };

        let fezTexto = false, fezArquivo = false;
        ch.querySelector('#chTexto').addEventListener('click', () => {
            if (fezTexto) return; fezTexto = true;
            if (tel) { window.open('https://wa.me/55' + tel + '?text=' + encodeURIComponent(msgWpp), '_blank'); }
            else { try { navigator.clipboard.writeText(msgWpp); } catch(e) {} showToast('📋 Texto copiado!', 2500); }
            marcar(ch.querySelector('#chTexto'), ch.querySelector('#chTextoLabel'), 'Texto enviado ✓');
            if (fezTexto && fezArquivo) fechar();
        });

        ch.querySelector('#chArquivo').addEventListener('click', async () => {
            if (fezArquivo) return; fezArquivo = true;
            try { await navigator.clipboard.writeText(msgWpp); } catch(e) {
                try { const ta=document.createElement('textarea');ta.value=msgWpp;ta.style.cssText='position:fixed;opacity:0;';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta); } catch(e2) {}
            }
            showToast('📋 Texto copiado! Cole no WhatsApp após enviar o PDF.', 3200);
            marcar(ch.querySelector('#chArquivo'), ch.querySelector('#chArqLabel'), 'PDF enviado ✓');
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try { await navigator.share({ files: [file], title: nomeArquivo }); }
                catch(e) { if (e.name !== 'AbortError') { const u=URL.createObjectURL(pdfBlob);const a=document.createElement('a');a.href=u;a.download=nomeArquivo;a.click();setTimeout(()=>URL.revokeObjectURL(u),5000); } }
            } else {
                const u=URL.createObjectURL(pdfBlob);const a=document.createElement('a');a.href=u;a.download=nomeArquivo;a.click();setTimeout(()=>URL.revokeObjectURL(u),5000);
            }
            if (fezTexto && fezArquivo) fechar();
        });
    });
}

// ── Helper: desenhar header da loja ──────────────────────────
function _docHeader(doc, logo, assistName, lojaTelefone, lojaInstagram, lojaEndereco, W) {
    const PURPLE = [123, 47, 190];
    const DARK   = [20, 20, 20];

    // Linha separadora embaixo do header
    const headerH = 28;

    // Logo (se houver)
    let logoW = 0;
    if (logo) {
        try {
            const ex = logo.startsWith('data:image/png') ? 'PNG' : logo.startsWith('data:image/webp') ? 'WEBP' : 'JPEG';
            doc.addImage(logo, ex, 8, 6, 22, 22, '', 'FAST');
            logoW = 26;
        } catch(e) {}
    }

    // Nome da loja
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...PURPLE);
    doc.text(assistName.substring(0, 26), 10 + logoW, 14);

    // Contatos linha direita
    let cx = W - 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(80, 80, 80);
    if (lojaTelefone) { doc.text(lojaTelefone, cx, 11, { align: 'right' }); }
    if (lojaInstagram) { doc.text(lojaInstagram, cx, 17, { align: 'right' }); }
    if (lojaEndereco) {
        const endL = doc.splitTextToSize(lojaEndereco, 80);
        doc.text(endL[0], cx, 23, { align: 'right' });
    }

    // Linha separadora
    doc.setDrawColor(123, 47, 190);
    doc.setLineWidth(0.5);
    doc.line(8, headerH + 2, W - 8, headerH + 2);

    return headerH + 4; // retorna Y onde continuar
}

// ── Helper: campo de linha ────────────────────────────────────
function _docField(doc, label, value, x, y, w, darkColor, labelColor) {
    doc.setFontSize(6);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...(labelColor || [140, 140, 140]));
    doc.text(label.toUpperCase(), x + 2, y + 4);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...(darkColor || [20, 20, 20]));
    doc.text(String(value || '—').substring(0, 38), x + 2, y + 10);
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.rect(x, y, w, 14);
}

// ── Helper: checkbox OS ───────────────────────────────────────
function _docChk(doc, label, checked, x, y) {
    doc.setDrawColor(150, 150, 150);
    doc.setLineWidth(0.4);
    doc.rect(x, y, 5, 5);
    if (checked) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(123, 47, 190);
        doc.text('✓', x + 0.8, y + 4);
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 30, 30);
    doc.text(label, x + 7, y + 4);
}

// ── Helper: padrão 3x3 ───────────────────────────────────────
function _docPadrao(doc, sequenceStr, x, y) {
    const seq = (sequenceStr || '').split('-').map(Number).filter(n => !isNaN(n));
    const positions = [
        [x,      y     ], [x+6,  y     ], [x+12, y     ],
        [x,      y+6   ], [x+6,  y+6   ], [x+12, y+6   ],
        [x,      y+12  ], [x+6,  y+12  ], [x+12, y+12  ],
    ];
    // Linhas de conexão
    doc.setDrawColor(123, 47, 190);
    doc.setLineWidth(0.6);
    for (let i = 0; i < seq.length - 1; i++) {
        const [ax, ay] = positions[seq[i] - 1] || [0, 0];
        const [bx, by] = positions[seq[i+1] - 1] || [0, 0];
        if (ax && bx) doc.line(ax, ay, bx, by);
    }
    // Pontos
    positions.forEach(([px, py], idx) => {
        const on = seq.includes(idx + 1);
        doc.setFillColor(on ? 30 : 200, on ? 30 : 200, on ? 30 : 200);
        doc.circle(px, py, on ? 1.8 : 1.2, 'F');
    });
}

// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// CARD DE COMPROVANTE — pergunta ao usuário baixar ou compartilhar
// ══════════════════════════════════════════════════════════════
function _mostrarCardComprovante(repair) {
    const existente = document.getElementById('_cardComprovanteOverlay');
    if (existente) existente.remove();

    const ov = document.createElement('div');
    ov.id = '_cardComprovanteOverlay';
    ov.style.cssText = [
        'position:fixed','inset:0','z-index:999995',
        'display:flex','align-items:center','justify-content:center',
        'padding:20px',
        'background:rgba(0,0,0,.55)',
        'backdrop-filter:blur(4px)',
        '-webkit-backdrop-filter:blur(4px)',
    ].join(';');

    const nome = repair.nomeCliente || 'cliente';

    ov.innerHTML = `
    <div style="
        width:100%;max-width:340px;
        background:linear-gradient(160deg,#0f1623,#0c1220);
        border:1px solid rgba(124,58,237,.25);
        border-radius:24px;
        box-shadow:0 24px 60px rgba(0,0,0,.6);
        overflow:hidden;
        animation:_slideDown .3s cubic-bezier(.34,1.4,.64,1) both;
    ">
        <style>@keyframes _slideDown{from{transform:translateY(-30px);opacity:0}to{transform:translateY(0);opacity:1}}</style>

        <!-- Header do card -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 20px 14px;border-bottom:1px solid rgba(255,255,255,.07);">
            <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:38px;height:38px;border-radius:12px;background:rgba(124,58,237,.15);border:1px solid rgba(124,58,237,.3);display:flex;align-items:center;justify-content:center;font-size:1.1rem;">📋</div>
                <div>
                    <div style="font-size:.9rem;font-weight:700;color:#fff;">Comprovante de Entrada</div>
                    <div style="font-size:.7rem;color:rgba(255,255,255,.4);margin-top:1px;">${escHtml(nome)}</div>
                </div>
            </div>
            <button id="_cardComprovanteFechar" style="width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.06);border:none;color:rgba(255,255,255,.4);font-size:.9rem;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
        </div>

        <!-- Texto -->
        <div style="padding:16px 20px 8px;">
            <p style="font-size:.82rem;color:rgba(255,255,255,.65);line-height:1.6;margin:0;">
                Deseja gerar o comprovante de recebimento do aparelho para entregar ao cliente?
            </p>
        </div>

        <!-- Botões -->
        <div style="display:flex;flex-direction:column;gap:8px;padding:10px 20px 20px;">
            <button id="_cardComprovanteCompartilhar" style="
                display:flex;align-items:center;gap:12px;
                width:100%;padding:14px 16px;
                border-radius:16px;cursor:pointer;
                background:rgba(124,58,237,.12);
                border:1.5px solid rgba(124,58,237,.3);
                text-align:left;transition:all .2s;
            ">
                <div style="width:36px;height:36px;border-radius:10px;background:rgba(124,58,237,.15);display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">
                    <i class="bi bi-share-fill" style="color:#a78bfa;"></i>
                </div>
                <div>
                    <div style="font-size:.85rem;font-weight:700;color:#a78bfa;">Compartilhar</div>
                    <div style="font-size:.68rem;color:rgba(255,255,255,.35);margin-top:1px;">Abre o compartilhamento do celular</div>
                </div>
            </button>

            <button id="_cardComprovanteDownload" style="
                display:flex;align-items:center;gap:12px;
                width:100%;padding:14px 16px;
                border-radius:16px;cursor:pointer;
                background:rgba(124,58,237,.06);
                border:1.5px solid rgba(255,255,255,.08);
                text-align:left;transition:all .2s;
            ">
                <div style="width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,.05);display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">
                    <i class="bi bi-download" style="color:rgba(255,255,255,.5);"></i>
                </div>
                <div>
                    <div style="font-size:.85rem;font-weight:700;color:rgba(255,255,255,.6);">Baixar PDF</div>
                    <div style="font-size:.68rem;color:rgba(255,255,255,.3);margin-top:1px;">Salva o arquivo no dispositivo</div>
                </div>
            </button>

            <button id="_cardComprovanteAgora" style="
                margin-top:2px;width:100%;padding:11px;
                border-radius:14px;cursor:pointer;
                background:transparent;border:none;
                color:rgba(255,255,255,.25);font-size:.76rem;
            ">Agora não</button>
        </div>
    </div>`;

    document.body.appendChild(ov);

    const fechar = () => { ov.style.opacity='0'; setTimeout(() => ov.remove(), 200); };

    document.getElementById('_cardComprovanteFechar').addEventListener('click', fechar);
    document.getElementById('_cardComprovanteAgora').addEventListener('click', fechar);
    ov.addEventListener('click', e => { if (e.target === ov) fechar(); });

    document.getElementById('_cardComprovanteCompartilhar').addEventListener('click', async () => {
        fechar();
        await gerarComprovantePDF(repair, 'compartilhar');
    });

    document.getElementById('_cardComprovanteDownload').addEventListener('click', async () => {
        fechar();
        await gerarComprovantePDF(repair, 'baixar');
    });
}

// ══════════════════════════════════════════════════════════════
// COMPROVANTE DE ENTRADA — mesmo estilo da OS
// ══════════════════════════════════════════════════════════════
async function gerarComprovantePDF(repair, modo) {
    // modo: 'compartilhar' | 'baixar' | undefined (abre modal padrão)
    const loadEl = _loadingOverlay('Gerando comprovante...');
    try {
        const jsPDF   = await _loadJsPDF();
        const _loja   = _getLojaConfig(repair.canal);
        const logo    = _loja.logo;
        const tel     = _loja.telefone;
        const insta   = _loja.instagram;
        const end     = _loja.endereco;
        const nome    = _loja.nome;

        const doc  = new jsPDF({ unit: 'mm', format: [210, 297], orientation: 'portrait' });
        const W = 210, H = 297;
        const P = 10;

        // Mesma paleta da OS
        const BL  = [30, 58, 138];
        const DK  = [15, 23, 42];
        const GR  = [120, 130, 145];
        const BD  = [210, 215, 225];
        const BG  = [248, 250, 252];
        const WH  = [255, 255, 255];

        const F  = (st,sz) => { doc.setFont('helvetica',st); doc.setFontSize(sz); };
        const C  = (r,g,b) => doc.setTextColor(r,g,b);
        const D  = (r,g,b,w) => { doc.setDrawColor(r,g,b); doc.setLineWidth(w||0.3); };
        const FL = (r,g,b) => doc.setFillColor(r,g,b);

        const card = (x,y,w,h) => {
            FL(...BG); D(...BD,0.25); doc.roundedRect(x,y,w,h,1.5,1.5,'FD');
        };
        const campo = (lbl,val,x,y,w) => {
            card(x,y,w,13);
            F('normal',5.5); C(...GR); doc.text(lbl.toUpperCase(), x+2.5, y+4.5);
            F('bold',9); C(...DK);
            const v = doc.splitTextToSize(String(val||'---'), w-4);
            doc.text(v[0]||'---', x+2.5, y+10.5);
        };

        const idCurto  = repair.numero ? String(repair.numero).padStart(4,'0') : (repair.id||'').slice(-4).toUpperCase();
        const dataCad  = repair.tsCadastro ? formatDate(repair.tsCadastro) : formatDate(Date.now());
        const horaCad  = repair.tsCadastro ? new Date(repair.tsCadastro).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '';
        const dataSaida= repair.dataMaxima || '---';
        const valorStr = repair.valorCobrado ? 'R$ '+Number(repair.valorCobrado).toFixed(2).replace('.',',') : '---';

        let y = P;

        // ── HEADER: logo centralizada ──────────────────────────
        const LOGO_MAX_W = W - P*2;
        const LOGO_MAX_H = 32;
        let imgW = LOGO_MAX_H * 2.5, imgH = LOGO_MAX_H;

        if (logo) {
            await new Promise(resolve => {
                const tmp = new Image();
                tmp.onload = function() {
                    const ratio = tmp.naturalWidth / tmp.naturalHeight;
                    if (ratio >= 1) { imgW = Math.min(LOGO_MAX_W, LOGO_MAX_H * ratio); imgH = imgW / ratio; }
                    else { imgH = LOGO_MAX_H; imgW = imgH * ratio; }
                    resolve();
                };
                tmp.onerror = resolve;
                tmp.src = logo;
            });
        }

        const logoX = P + (LOGO_MAX_W - imgW) / 2;
        if (logo) {
            try {
                const ext = logo.startsWith('data:image/png')?'PNG':logo.startsWith('data:image/webp')?'WEBP':'JPEG';
                doc.addImage(logo, ext, logoX, y, imgW, imgH, '', 'FAST');
            } catch(e) {}
        }
        y += imgH + 5;

        // Separador + contatos
        D(...BD,0.3); doc.line(P, y, W-P, y); y += 4;
        if (tel || insta || end) {
            const cItems = [tel, insta, end].filter(Boolean);
            const sep = '   |   ';
            const full = cItems.join(sep);
            const tw = doc.getStringUnitWidth(full) * 7.5 / doc.internal.scaleFactor;
            let curX = (W - tw) / 2;
            F('bold',7.5); C(...DK);
            cItems.forEach((item, idx) => {
                const iw = doc.getStringUnitWidth(item)*7.5/doc.internal.scaleFactor;
                doc.text(item, curX, y); curX += iw;
                if (idx < cItems.length-1) {
                    F('normal',7.5); C(...BL);
                    const sw = doc.getStringUnitWidth(sep)*7.5/doc.internal.scaleFactor;
                    doc.text(sep, curX, y); curX += sw;
                    F('bold',7.5); C(...DK);
                }
            });
            y += 5;
        }

        // Linha azul
        FL(...BL); doc.rect(0, y, W, 2, 'F'); y += 5;

        // ── BARRA TÍTULO ───────────────────────────────────────
        FL(...BL); doc.roundedRect(P, y, W-P*2, 13, 1.5, 1.5, 'F');
        F('bold', 11); C(...WH); doc.text('COMPROVANTE DE ENTRADA', P+5, y+9);
        F('normal', 8.5); C(180,200,240); doc.text('No.'+idCurto, W-P*2+P-4, y+9, {align:'right'});
        y += 16;

        // Via
        F('normal',7); C(...GR);
        doc.text('1a Via - Loja  |  2a Via - Cliente', W/2, y+4, {align:'center'});
        y += 11;

        // ── DATAS ──────────────────────────────────────────────
        const w2 = (W-P*2-4)/2;
        campo('Data de Entrada', dataCad+(horaCad?' as '+horaCad:''), P,      y, w2);
        campo('Previsao de Saida', dataSaida,                          P+w2+4, y, w2);
        y += 16;

        // ── CLIENTE ────────────────────────────────────────────
        campo('Nome do Cliente', repair.nomeCliente, P, y, W-P*2); y += 16;
        const cpfLbl = repair.canal==='instagram'?'@Instagram':'CPF / CNPJ';
        const cpfVal = repair.canal==='instagram'?(repair.instagramCliente||'---'):(repair.cpfCliente||'---');
        campo('Telefone', repair.numeroCliente, P,      y, w2);
        campo(cpfLbl,     cpfVal,               P+w2+4, y, w2);
        y += 16;

        // ── APARELHO ───────────────────────────────────────────
        const w3 = (W-P*2-8)/3;
        campo('Aparelho / Modelo', repair.modeloAparelho, P,        y, w3*2+4);
        campo('Cor',               repair.corAparelho||'---', P+w3*2+8, y, w3);
        y += 16;
        campo('IMEI',        repair.imei||'---', P,      y, w2);
        campo('Valor Orcado', valorStr,           P+w2+4, y, w2);
        y += 16;

        // ── SENHA DE BLOQUEIO + ESTADO ─────────────────────────
        const swW = 44, diagH = 32;
        const estW = W-P*2-swW-4;

        // Card senha
        FL(...BG); D(...BD,0.25); doc.roundedRect(P, y, swW, diagH, 1.5, 1.5, 'FD');
        F('normal',5.5); C(...GR); doc.text('SENHA DE BLOQUEIO', P+2.5, y+5.5);
        if (repair.senhaTipo==='padrao' && repair.senhaValor) {
            const seq=(repair.senhaValor||'').split('-').map(Number).filter(n=>!isNaN(n));
            const ox=P+8, oy=y+11, g=7;
            const pts=[];
            for(let r=0;r<3;r++) for(let c=0;c<3;c++) pts.push([ox+c*g, oy+r*g]);
            D(...BL,0.7);
            for(let i=0;i<seq.length-1;i++){
                const a=pts[seq[i]-1],b=pts[seq[i+1]-1];
                if(a&&b) doc.line(a[0],a[1],b[0],b[1]);
            }
            pts.forEach(([px,py],idx)=>{
                const on=seq.includes(idx+1);
                FL(...(on?BL:BD)); doc.circle(px,py,on?2.2:1.5,'F');
            });
        } else if (repair.senhaTipo==='pin'||repair.senhaTipo==='senha') {
            F('bold',12); C(...DK);
            doc.text(String(repair.senhaValor||'---'), P+swW/2, y+diagH/2+3, {align:'center'});
        } else {
            F('normal',7.5); C(...GR);
            doc.text('Sem senha', P+swW/2, y+diagH/2+2, {align:'center'});
        }

        // Card estado do aparelho
        const ex = P+swW+4;
        const est = repair.estadoAparelho || {};
        FL(...BG); D(...BD,0.25); doc.roundedRect(ex, y, estW, diagH, 1.5, 1.5, 'FD');
        F('normal',5.5); C(...GR); doc.text('ESTADO DO APARELHO', ex+2.5, y+5.5);
        const estItens=[
            ['Bateria OK', est.bateriaOk],
            ['Arranhoes',  est.arranhoes],
            ['Queda',      est.queda],
            ['Liga',       est.liga],
            ['Nao liga',   est.naoLiga],
        ];
        // Linha 1: primeiros 3
        let ex2 = ex+3;
        const circ = (lbl,on,cx,cy) => {
            const r=2.5;
            D(...(on?BL:BD),0.5);
            if(on){FL(...BL);doc.circle(cx+r,cy+r,r,'FD');}
            else{FL(...[255,255,255]);doc.circle(cx+r,cy+r,r,'D');}
            F(on?'bold':'normal',6.5); C(...(on?DK:GR));
            doc.text(lbl, cx+r*2+2, cy+r+1.3);
        };
        let ex3 = ex+3;
        estItens.slice(0,3).forEach(([lbl,chk])=>{
            circ(lbl,chk,ex3,y+9);
            ex3 += doc.getStringUnitWidth(lbl)*6.5/doc.internal.scaleFactor+13;
        });
        let ex4 = ex+3;
        estItens.slice(3).forEach(([lbl,chk])=>{
            circ(lbl,chk,ex4,y+20);
            ex4 += doc.getStringUnitWidth(lbl)*6.5/doc.internal.scaleFactor+13;
        });
        y += diagH+5;

        // ── DEFEITO ────────────────────────────────────────────
        FL(...BG); D(...BD,0.25);
        doc.roundedRect(P, y, W-P*2, 22, 1.5, 1.5, 'FD');
        F('normal',5.5); C(...GR); doc.text('DEFEITO RELATADO PELO CLIENTE', P+2.5, y+5);
        F('bold',9); C(...DK);
        const defL = doc.splitTextToSize(repair.descricaoDefeito||'---', W-P*2-5);
        doc.text(defL.slice(0,2), P+2.5, y+13);
        y += 26;

        // ── AVISO ──────────────────────────────────────────────
        FL(240,249,255); D(147,197,253,0.4);
        doc.roundedRect(P, y, W-P*2, 16, 1.5, 1.5, 'FD');
        const avisoTitulo = (window.cfgGet ? window.cfgGet('avisoComprovanteTitle') : localStorage.getItem('avisoComprovanteTitle')) || 'Guarde este comprovante!';
        const avisoTexto  = (window.cfgGet ? window.cfgGet('avisoComprovanteTexto') : localStorage.getItem('avisoComprovanteTexto')) || 'Necessario para retirar o aparelho. Aparelhos nao retirados em 90 dias serao descartados.';
        const _ftAviso = parseFloat((window.cfgGet?window.cfgGet('fontAviso'):localStorage.getItem('fontAviso'))||'6.5');
        F('bold',7.5); C(...BL); doc.text(avisoTitulo, P+4, y+7);
        F('normal', _ftAviso); C(60,80,120);
        doc.text(avisoTexto, P+4, y+13, {maxWidth:W-P*2-8});

        loadEl.remove();
        const pdfBlob = doc.output('blob');
        const pNome = (repair.nomeCliente||'cliente').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g,'');
        const fn = 'Comprovante_'+pNome+'_'+idCurto+'.pdf';
        const file = new File([pdfBlob], fn, {type:'application/pdf'});

        if (modo === 'compartilhar') {
            if (navigator.canShare && navigator.canShare({files:[file]})) {
                try { await navigator.share({files:[file], title:fn}); }
                catch(e) { if(e.name!=='AbortError'){ const u=URL.createObjectURL(pdfBlob);const a=document.createElement('a');a.href=u;a.download=fn;a.click();setTimeout(()=>URL.revokeObjectURL(u),5000); } }
            } else {
                const u=URL.createObjectURL(pdfBlob);const a=document.createElement('a');a.href=u;a.download=fn;a.click();setTimeout(()=>URL.revokeObjectURL(u),5000);
            }
        } else if (modo === 'baixar') {
            const u=URL.createObjectURL(pdfBlob);const a=document.createElement('a');a.href=u;a.download=fn;a.click();setTimeout(()=>URL.revokeObjectURL(u),5000);
        } else {
            // fallback: baixar direto
            const u=URL.createObjectURL(pdfBlob);const a=document.createElement('a');a.href=u;a.download=fn;a.click();setTimeout(()=>URL.revokeObjectURL(u),5000);
        }

    } catch(e) {
        loadEl.remove();
        if(e?.name!=='AbortError'){ console.warn('Comprovante:', e); showToast('Erro ao gerar comprovante.'); }
    }
}

// ══════════════════════════════════════════════════════════════
// ORDEM DE SERVIÇO — substitui o antigo gerarGarantiaPDF
// ══════════════════════════════════════════════════════════════
async function gerarGarantiaPDF() {
    if (!_garantiaRepair) return;
    const repair = _garantiaRepair;

    const _loja  = _getLojaConfig(repair.canal);
    const logo   = _loja.logo;
    const tel    = _loja.telefone;
    const insta  = _loja.instagram;
    const end    = _loja.endereco;
    const termos = (window.cfgGet ? window.cfgGet('termosGarantia') : localStorage.getItem('termosGarantia'))
                   || 'Garantia valida conforme as condicoes descritas.';

    const btnSel    = document.querySelector('.rep-gar-dias-btn.selected');
    const diasCustom= document.getElementById('repGarDiasCustom')?.value?.trim();
    const diasGar   = diasCustom || btnSel?.dataset.dias || null;
    if (!diasGar) { showToast('Selecione o prazo de garantia.'); return; }

    const servico  = document.getElementById('repGarServico')?.value?.trim() || repair.descricaoDefeito || '';
    const idCurto  = repair.numero ? String(repair.numero).padStart(4,'0') : (repair.id||'').slice(-4).toUpperCase();
    const tsOk     = repair.timeline?.finalizado?.ts;
    const dEntrada = repair.tsCadastro ? formatDate(repair.tsCadastro) : '---';
    const dSaida   = repair.dataMaxima || (tsOk ? formatDate(tsOk) : formatDate(Date.now()));
    const valorStr = repair.valorCobrado ? 'R$ ' + Number(repair.valorCobrado).toFixed(2).replace('.', ',') : '---';
    const est      = repair.estadoAparelho || {};
    const pNome    = (repair.nomeCliente||'cliente').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g,'');

    closeGarantiaModal();
    const loadEl = _loadingOverlay('Gerando OS...');

    try {
        const jsPDF = await _loadJsPDF();
        const doc   = new jsPDF({ unit: 'mm', format: [210, 297], orientation: 'portrait' });
        const W = 210, H = 297;
        const P = 10; // margem

        // Paleta — azul para combinar com ambas as logos
        const BL   = [30, 58, 138];   // azul principal
        const BLL  = [219, 234, 254]; // azul claro (fundo cards)
        const TL   = [13, 100, 93];   // teal (servico)
        const TLB  = [204, 251, 241]; // teal claro
        const DK   = [15, 23, 42];    // texto escuro
        const GR   = [120, 130, 145]; // cinza label
        const BD   = [210, 215, 225]; // borda
        const BG   = [248, 250, 252]; // fundo card
        const WH   = [255, 255, 255];

        const F  = (st,sz) => { doc.setFont('helvetica',st); doc.setFontSize(sz); };
        const C  = (r,g,b) => doc.setTextColor(r,g,b);
        const D  = (r,g,b,w) => { doc.setDrawColor(r,g,b); doc.setLineWidth(w||0.3); };
        const FL = (r,g,b) => doc.setFillColor(r,g,b);

        const card = (x,y,w,h) => {
            FL(...BG); D(...BD,0.25); doc.roundedRect(x,y,w,h,1.5,1.5,'FD');
        };
        const campo = (lbl,val,x,y,w) => {
            card(x,y,w,12);
            F('normal',5.5); C(...GR); doc.text(lbl.toUpperCase(), x+2.5, y+4.5);
            F('bold',8.5); C(...DK);
            const v = doc.splitTextToSize(String(val||'---'), w-4);
            doc.text(v[0]||'---', x+2.5, y+10);
        };
        const secao = (txt,x,y) => {
            FL(...BL); doc.rect(x,y,2.5,8,'F');
            F('bold',7.5); C(...BL); doc.text(txt, x+5.5, y+6);
        };
        const circ = (lbl,on,x,y) => {
            const r=2.8;
            D(...(on?BL:BD),0.6);
            if(on){ FL(...BL); doc.circle(x+r,y+r,r,'FD'); }
            else  { FL(...WH); doc.circle(x+r,y+r,r,'D'); }
            F(on?'bold':'normal',7); C(...(on?DK:GR));
            doc.text(lbl, x+r*2+2.5, y+r+1.5);
        };

        let y = P;

        // ══════════════════════════════════════════
        // HEADER — OPÇÃO A
        // Logo centralizada full width
        // Contatos em linha abaixo
        // ══════════════════════════════════════════
        const LOGO_MAX_W = W - P*2;  // 190mm
        const LOGO_MAX_H = 32;       // altura máxima da logo

        // Detecta proporção da logo para centralizar corretamente
        let imgW = LOGO_MAX_H * 2.5; // fallback wide
        let imgH = LOGO_MAX_H;

        if (logo) {
            await new Promise(resolve => {
                const tmp = new Image();
                tmp.onload = function() {
                    const ratio = tmp.naturalWidth / tmp.naturalHeight;
                    if (ratio >= 1) {
                        // Wide ou quadrada — limita pela largura
                        imgW = Math.min(LOGO_MAX_W, LOGO_MAX_H * ratio);
                        imgH = imgW / ratio;
                    } else {
                        // Alta — limita pela altura
                        imgH = LOGO_MAX_H;
                        imgW = imgH * ratio;
                    }
                    resolve();
                };
                tmp.onerror = resolve;
                tmp.src = logo;
            });
        }

        // Centraliza a logo horizontalmente
        const logoX = P + (LOGO_MAX_W - imgW) / 2;

        if (logo) {
            try {
                const ext = logo.startsWith('data:image/png')?'PNG':logo.startsWith('data:image/webp')?'WEBP':'JPEG';
                doc.addImage(logo, ext, logoX, y, imgW, imgH, '', 'FAST');
            } catch(e) {}
        }

        y += imgH + 5;

        // Linha separadora fina
        D(...BD, 0.3); doc.line(P, y, W-P, y);
        y += 4;

        // Contatos em linha centralizada
        // Monta os items
        const cItems = [];
        if (tel)   cItems.push(tel);
        if (insta) cItems.push(insta);
        if (end)   cItems.push(end);

        if (cItems.length > 0) {
            F('normal', 7.5); C(...DK);
            // Calcula largura total para centralizar
            const sep = '   |   ';
            const full = cItems.join(sep);
            const tw = doc.getStringUnitWidth(full) * 7.5 / doc.internal.scaleFactor;
            const cx = (W - tw) / 2;

            // Desenha cada item com separador colorido
            let curX = cx;
            cItems.forEach((item, idx) => {
                const iw = doc.getStringUnitWidth(item) * 7.5 / doc.internal.scaleFactor;
                F('bold', 7.5); C(...DK);
                doc.text(item, curX, y);
                curX += iw;
                if (idx < cItems.length - 1) {
                    F('normal', 7.5); C(...BL);
                    const sw = doc.getStringUnitWidth(sep) * 7.5 / doc.internal.scaleFactor;
                    doc.text(sep, curX, y);
                    curX += sw;
                }
            });
            y += 4;
        }

        // Linha azul embaixo do header
        FL(...BL); doc.rect(0, y, W, 2, 'F');
        y += 5;

        // ══════════════════════════════════════════
        // BARRA TITULO
        // ══════════════════════════════════════════
        FL(...BL); doc.roundedRect(P, y, W-P*2, 12, 1.5, 1.5, 'F');
        F('bold', 11); C(...WH); doc.text('ORDEM DE SERVICO', P+5, y+8.5);
        F('normal', 8); C(180,200,240); doc.text('OS No.'+idCurto, W-P*2+P-4, y+8.5, {align:'right'});
        y += 14;

        // Via + tipo
        F('normal', 7); C(...GR); doc.text('1a Via - Loja  |  2a Via - Cliente', P, y+4.5);
        const tipos = [['Manutencao',true],['Compra',false],['Venda',false],['Troca',false]];
        let tx = W-P;
        [...tipos].reverse().forEach(([l,chk]) => {
            const lw = doc.getStringUnitWidth(l)*7/doc.internal.scaleFactor+12;
            tx -= lw; circ(l,chk,tx,y+1);
        });
        y += 11;

        // ══════════════════════════════════════════
        // DATAS + VALOR
        // ══════════════════════════════════════════
        const w4=(W-P*2-9)/4;
        campo('Entrada',  dEntrada,        P,           y, w4);
        campo('Garantia', diasGar+' dias', P+w4+3,      y, w4);
        campo('Saida',    dSaida,          P+(w4+3)*2,  y, w4);
        campo('Valor R$', valorStr,        P+(w4+3)*3,  y, w4);
        y += 15;

        // ══════════════════════════════════════════
        // CLIENTE
        // ══════════════════════════════════════════
        secao('DADOS DO CLIENTE', P, y); y += 11;
        const w2=(W-P*2-4)/2;
        campo('Nome', repair.nomeCliente, P, y, W-P*2); y += 13;
        const endStr = repair.canal==='instagram'
            ? [repair.rua,repair.numeroEndereco,repair.bairro,repair.cidade].filter(Boolean).join(', ')
            : (repair.endereco||'');
        if (endStr){ campo('Endereco', endStr, P, y, W-P*2); y+=13; }
        const cpfLbl = repair.canal==='instagram'?'@Instagram':'CPF / CNPJ';
        const cpfVal = repair.canal==='instagram'?(repair.instagramCliente||'---'):(repair.cpfCliente||'---');
        campo(cpfLbl, cpfVal,                   P,      y, w2);
        campo('Telefone', repair.numeroCliente,  P+w2+4, y, w2);
        y += 13;
        campo('IMEI', repair.imei||'---', P, y, W-P*2); y += 13;

        // ══════════════════════════════════════════
        // APARELHO
        // ══════════════════════════════════════════
        secao('APARELHO', P, y); y += 11;
        campo('Marca / Modelo', repair.modeloAparelho||'---', P,      y, w2);
        campo('Cor',            repair.corAparelho   ||'---', P+w2+4, y, w2);
        y += 13;

        // ══════════════════════════════════════════
        // DIAGNOSTICO
        // ══════════════════════════════════════════
        secao('DIAGNOSTICO', P, y); y += 11;
        const swW=42, dH=32, estW=W-P*2-swW-4;

        card(P, y, swW, dH);
        F('normal',5.5); C(...GR); doc.text('SENHA DE BLOQUEIO', P+2.5, y+5.5);
        if (repair.senhaTipo==='padrao'&&repair.senhaValor) {
            const seq=(repair.senhaValor||'').split('-').map(Number).filter(n=>!isNaN(n));
            const ox=P+8,oy=y+11,g=7;
            const pts=[];
            for(let r=0;r<3;r++) for(let c=0;c<3;c++) pts.push([ox+c*g,oy+r*g]);
            D(...BL,0.7);
            for(let i=0;i<seq.length-1;i++){
                const a=pts[seq[i]-1],b=pts[seq[i+1]-1];
                if(a&&b) doc.line(a[0],a[1],b[0],b[1]);
            }
            pts.forEach(([px,py],idx)=>{
                const on=seq.includes(idx+1);
                FL(...(on?BL:BD)); doc.circle(px,py,on?2.2:1.5,'F');
            });
        } else if (repair.senhaTipo==='pin'||repair.senhaTipo==='senha') {
            F('bold',12); C(...DK); doc.text(String(repair.senhaValor||'---'), P+swW/2, y+dH/2+3, {align:'center'});
        } else {
            F('normal',7.5); C(...GR); doc.text('Sem senha', P+swW/2, y+dH/2+2, {align:'center'});
        }

        const ex=P+swW+4;
        card(ex,y,estW,14);
        F('normal',5.5); C(...GR); doc.text('ESTADO DO APARELHO', ex+2.5, y+5.5);
        const estItens=[['Bateria OK',est.bateriaOk],['Arranhoes',est.arranhoes],['Queda',est.queda],['Liga',est.liga],['Nao liga',est.naoLiga]];
        let ex2=ex+2.5;
        estItens.forEach(([l,chk])=>{ circ(l,chk,ex2,y+7); ex2+=doc.getStringUnitWidth(l)*7/doc.internal.scaleFactor+12; });

        card(ex,y+16,estW,16);
        F('normal',5.5); C(...GR); doc.text('DEFEITO APRESENTADO', ex+2.5, y+21);
        F('bold',8.5); C(...DK);
        const defL=doc.splitTextToSize(repair.descricaoDefeito||'---',estW-5);
        doc.text(defL.slice(0,2), ex+2.5, y+27.5);
        y+=dH+5;

        // ══════════════════════════════════════════
        // SERVICO REALIZADO
        // ══════════════════════════════════════════
        secao('SERVICO REALIZADO / PECAS', P, y); y+=11;
        FL(...TLB); D(...TL,0.4); doc.roundedRect(P,y,W-P*2,20,1.5,1.5,'FD');
        const ps=(servico||'').toLowerCase();
        const itens=[
            ['Troca de Tela',    ps.includes('tela')   ||ps.includes('display')],
            ['Troca de Bateria', ps.includes('bateria')||ps.includes('bater')],
            ['Conector',         ps.includes('conector')||ps.includes('carga')],
            ['Outros',           true],
        ];
        let sx=P+4;
        itens.forEach(([l,chk])=>{ circ(l,chk,sx,y+3.5); sx+=50; });
        F('normal',7.5); C(40,70,65);
        const srvL=doc.splitTextToSize(servico||'---',W-P*2-6);
        doc.text(srvL[0]||'', P+4, y+17);
        y+=25;

        // ══════════════════════════════════════════
        // TERMOS
        // ══════════════════════════════════════════
        const _tFontSz = parseFloat((window.cfgGet ? (window.cfgGet('fontTermosConserto')||window.cfgGet('termosFontSize')) : (localStorage.getItem('fontTermosConserto')||localStorage.getItem('termosFontSize')))||'6.5');
        D(...BD,0.3); doc.line(P,y,W-P,y);
        F('bold',8.5); C(...DK); doc.text('TERMO DE CONTRATO', W/2, y+6, {align:'center'});
        y+=10;
        F('bold', _tFontSz); C(20,20,20);
        const tLines=doc.splitTextToSize(termos,W-P*2);
        doc.text(tLines, P, y);

        loadEl.remove();
        const blob = doc.output('blob');
        const fn   = 'OS_'+pNome+'_'+idCurto+'.pdf';
        await _modalEnvioPDF(repair, blob, fn, 'Enviar OS');

    } catch(e) {
        loadEl.remove();
        if(e?.name!=='AbortError'){ console.warn('OS PDF:',e); showToast('Erro ao gerar OS.'); }
    }
}

// ============================================================
// PHOTO INPUT HELPER
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
// WIRE EVENTS
// ============================================================
// ============================================================
// MODAL FORNECEDOR — Aguardando Peça
// ============================================================
let _fornRepair = null;

function openFornecedorModal(repair) {
    _fornRepair = repair;
    const overlay = document.getElementById('repFornecedorOverlay');
    if (!overlay) {
        // Fallback se modal não existe: vai direto pro step modal
        openStepModal(repair, STATUS.AGUARDANDO_PECA, '📸 Foto: Aguardando Peça', 'Registrar');
        return;
    }
    // Limpa campos
    ['fornPeca','fornNome','fornTel','fornPrevisao'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = repair.fornecedor?.[id.replace('forn','')] || '';
    });
    overlay.classList.add('active');
}

function closeFornecedorModal() {
    document.getElementById('repFornecedorOverlay')?.classList.remove('active');
    _fornRepair = null;
}

async function submitFornecedorModal() {
    if (!_fornRepair) return;
    const peca     = document.getElementById('fornPeca')?.value.trim();
    const nome     = document.getElementById('fornNome')?.value.trim();
    const tel      = document.getElementById('fornTel')?.value.trim();
    const previsao = document.getElementById('fornPrevisao')?.value;
    const custo    = parseFloat(document.getElementById('fornCusto')?.value) || null;

    if (!peca || !nome) { showToast('⚠️ Peça e fornecedor são obrigatórios.'); return; }

    const btn = document.getElementById('repFornecedorSave');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Salvando...'; }

    try {
        const update_data = {
            ..._fornRepair,
            status: STATUS.AGUARDANDO_PECA,
            fornecedor: { peca, nome, tel: tel || null, previsao: previsao || null, custo: custo || null },
            timeline: {
                ..._fornRepair.timeline,
                aguardando_peca: { ts: tsNow(), peca, fornecedor: nome }
            }
        };
        await saveRepair(update_data);
        // Lança custo da peça como despesa automática no financeiro
        if (custo && custo > 0 && typeof window._finSalvarLancamento === 'function') {
            window._finSalvarLancamento({
                tipo: 'despesa',
                descricao: `Peça: ${peca} — ${_fornRepair.nomeCliente || 'Conserto'}`,
                valor: custo,
                recorrencia: 'unico',
                categoria: 'Peça',
                ts: tsNow(),
            });
        }
        closeFornecedorModal();
        showToast('🟡 Aguardando peça registrado!');
    } catch(e) {
        showToast('❌ Erro: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Registrar'; }
    }
}

function wireFornecedorEvents() {
    document.getElementById('repFornecedorClose')?.addEventListener('click', closeFornecedorModal);
    document.getElementById('repFornecedorCancel')?.addEventListener('click', closeFornecedorModal);
    document.getElementById('repFornecedorSave')?.addEventListener('click', submitFornecedorModal);
    document.getElementById('repFornecedorOverlay')?.addEventListener('click', e => {
        if (e.target === document.getElementById('repFornecedorOverlay')) closeFornecedorModal();
    });
}

// ============================================================
// SENHA DO APARELHO — tabs e padrão Android
// ============================================================
window._senhaTipoAtivo = 'nenhuma';
window._ptnSequence    = '';

function _setSenhaTipo(tipo) {
    window._senhaTipoAtivo = tipo;
    document.querySelectorAll('.senha-tipo-tab').forEach(t =>
        t.classList.toggle('senha-tipo-active', t.dataset.tipo === tipo)
    );
    const panels = { pin: 'senhaPinPanel', senha: 'senhaSenhaPanel', padrao: 'senhaPadraoPanel' };
    Object.entries(panels).forEach(([k, id]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = (k === tipo) ? '' : 'none';
    });
}
window._setSenhaTipo = _setSenhaTipo;

function initPatternLock() {
    const wrap     = document.getElementById('ptnWrap');
    const svg      = document.getElementById('ptnSvg');
    const grid     = document.getElementById('ptnDotsGrid');
    const infoEl   = document.getElementById('ptnInfo');
    const clearBtn = document.getElementById('ptnClearBtn');
    if (!wrap || !grid || !svg) return;

    // Posições dos 9 pontos no viewBox 180x180
    const DOT_POS = [
        null,
        {cx:30,cy:30},{cx:90,cy:30},{cx:150,cy:30},
        {cx:30,cy:90},{cx:90,cy:90},{cx:150,cy:90},
        {cx:30,cy:150},{cx:90,cy:150},{cx:150,cy:150},
    ];

    // Criar 9 pontos no grid
    grid.innerHTML = '';
    for (let i = 1; i <= 9; i++) {
        const d = document.createElement('div');
        d.className = 'ptn-dot'; d.dataset.i = i;
        grid.appendChild(d);
    }

    let sequence = [], drawing = false, tempLine = null;

    function clearAll() {
        sequence = []; drawing = false;
        svg.innerHTML = ''; tempLine = null;
        grid.querySelectorAll('.ptn-dot').forEach(d => d.classList.remove('ptn-active'));
        if (infoEl) infoEl.textContent = '';
        window._ptnSequence = '';
    }
    window._ptnRestoreSequence = function(seq) {
        clearAll();
        if (!seq) return;
        const nums = seq.split('-').map(Number).filter(n => n >= 1 && n <= 9);
        if (nums.length < 4) return;
        nums.forEach((n, idx) => {
            const dot = grid.querySelector('.ptn-dot[data-i="' + n + '"]');
            if (!dot) return;
            if (idx > 0) {
                const prev = DOT_POS[nums[idx - 1]];
                const curr = DOT_POS[n];
                if (prev && curr) svg.appendChild(addSvgLine(prev.cx, prev.cy, curr.cx, curr.cy, false));
            }
            sequence.push(n);
            dot.classList.add('ptn-active');
        });
        window._ptnSequence = sequence.join('-');
        if (infoEl) infoEl.textContent = '\u2713 Padr\u00e3o com ' + sequence.length + ' pontos';
    };

    function addSvgLine(x1,y1,x2,y2,dashed) {
        const l = document.createElementNS('http://www.w3.org/2000/svg','line');
        l.setAttribute('x1',x1); l.setAttribute('y1',y1);
        l.setAttribute('x2',x2); l.setAttribute('y2',y2);
        l.setAttribute('stroke','var(--primary-color)');
        l.setAttribute('stroke-width', dashed ? '2' : '3');
        l.setAttribute('stroke-linecap','round');
        l.setAttribute('opacity', dashed ? '0.35' : '0.75');
        if (dashed) l.setAttribute('stroke-dasharray','5,4');
        return l;
    }

    function getDotAt(clientX, clientY) {
        const wr = wrap.getBoundingClientRect();
        const rx = clientX - wr.left, ry = clientY - wr.top;
        for (const dot of grid.querySelectorAll('.ptn-dot')) {
            const dr = dot.getBoundingClientRect();
            const cx = dr.left - wr.left + dr.width/2;
            const cy = dr.top  - wr.top  + dr.height/2;
            if (Math.hypot(rx - cx, ry - cy) < 24) return dot;
        }
        return null;
    }

    function toViewBox(clientX, clientY) {
        const wr = wrap.getBoundingClientRect();
        const scX = 180 / wr.width, scY = 180 / wr.height;
        return { x: (clientX - wr.left) * scX, y: (clientY - wr.top) * scY };
    }

    function activateDot(dot) {
        const i = parseInt(dot.dataset.i);
        if (sequence.includes(i)) return;
        if (sequence.length > 0) {
            const prev = DOT_POS[sequence[sequence.length-1]];
            const curr = DOT_POS[i];
            if (tempLine) { svg.removeChild(tempLine); tempLine = null; }
            svg.appendChild(addSvgLine(prev.cx, prev.cy, curr.cx, curr.cy, false));
        }
        sequence.push(i);
        dot.classList.add('ptn-active');
        window._ptnSequence = sequence.join('-');
        if (infoEl) {
            infoEl.textContent = sequence.length >= 4
                ? `✓ Padrão com ${sequence.length} pontos`
                : `${sequence.length} ponto(s)… (mínimo 4)`;
        }
    }

    function onMove(clientX, clientY) {
        if (!drawing) return;
        const dot = getDotAt(clientX, clientY);
        if (dot && !dot.classList.contains('ptn-active')) activateDot(dot);
        if (sequence.length > 0) {
            if (tempLine) svg.removeChild(tempLine);
            const last = DOT_POS[sequence[sequence.length-1]];
            const vb = toViewBox(clientX, clientY);
            tempLine = addSvgLine(last.cx, last.cy, vb.x, vb.y, true);
            svg.appendChild(tempLine);
        }
    }

    function onEnd() {
        if (!drawing) return;
        drawing = false;
        if (tempLine) { svg.removeChild(tempLine); tempLine = null; }
        if (sequence.length > 0 && sequence.length < 4) {
            if (infoEl) infoEl.textContent = '⚠️ Mínimo 4 pontos. Tente novamente.';
            setTimeout(clearAll, 1300);
        }
    }

    function onStart(clientX, clientY) {
        clearAll(); drawing = true;
        const dot = getDotAt(clientX, clientY);
        if (dot) activateDot(dot);
    }

    wrap.addEventListener('touchstart',  e => { e.preventDefault(); const t=e.touches[0]; onStart(t.clientX,t.clientY); }, {passive:false});
    wrap.addEventListener('touchmove',   e => { e.preventDefault(); const t=e.touches[0]; onMove(t.clientX,t.clientY);  }, {passive:false});
    wrap.addEventListener('touchend',    () => onEnd(), {passive:true});
    wrap.addEventListener('mousedown',   e => onStart(e.clientX, e.clientY));
    wrap.addEventListener('mousemove',   e => onMove(e.clientX,  e.clientY));
    wrap.addEventListener('mouseup',     () => onEnd());
    wrap.addEventListener('mouseleave',  () => { if (drawing) onEnd(); });
    if (clearBtn) clearBtn.addEventListener('click', clearAll);
    clearAll();
}

function wireFormEvents() {
    document.getElementById('repNewBtn')?.addEventListener('click', () => openRepairForm());
    document.getElementById('repFormClose')?.addEventListener('click', closeRepairForm);
    document.getElementById('repFormCancel')?.addEventListener('click', closeRepairForm);
    document.getElementById('repFormOverlay')?.addEventListener('click', e => {
        if (e.target === document.getElementById('repFormOverlay')) closeRepairForm();
    });
    document.getElementById('repFormSaveBtn')?.addEventListener('click', submitRepairForm);

    // Entrada / Adiantamento toggle
    function _atualizarSaldoForm() {
        const v = parseFloat(document.getElementById('repFormValor')?.value) || 0;
        const e = parseFloat(document.getElementById('repFormEntrada')?.value) || 0;
        const lbl = document.getElementById('repFormSaldoLabel');
        if (lbl) lbl.textContent = (v > 0 && e > 0 && e < v) ? `Saldo a receber: R$ ${(v - e).toFixed(2).replace('.', ',')}` : '';
    }
    document.getElementById('repFormEntradaCheck')?.addEventListener('change', function() {
        const sec = document.getElementById('repFormEntradaSection');
        if (sec) sec.style.display = this.checked ? '' : 'none';
        if (!this.checked) { const el = document.getElementById('repFormEntrada'); if (el) el.value = ''; }
        _atualizarSaldoForm();
    });
    document.getElementById('repFormEntrada')?.addEventListener('input', _atualizarSaldoForm);
    document.getElementById('repFormValor')?.addEventListener('input', _atualizarSaldoForm);

    // Senha do aparelho — tabs
    document.querySelectorAll('.senha-tipo-tab').forEach(tab => {
        tab.addEventListener('click', () => _setSenhaTipo(tab.dataset.tipo));
    });
    // Pattern lock
    initPatternLock();

    // Multi-photo: câmera
    const addSlot = document.getElementById('repPhotoAddSlot');
    if (addSlot) {
        // Click no centro abre câmera
        addSlot.addEventListener('click', e => {
            if (!e.target.closest('.rep-photo-gal-btn')) {
                document.getElementById('repFormPhotoInputCamera')?.click();
            }
        });
    }
    // Click no botão galeria
    document.getElementById('repFormPhotoBtnGallery')?.addEventListener('click', e => {
        e.stopPropagation();
        document.getElementById('repFormPhotoInputGallery')?.click();
    });

    async function processFiles(files) {
        for (const file of Array.from(files)) {
            if (repairPhotos.length >= 5) break;
            const blob = await comprimirFoto(file);
            const url  = URL.createObjectURL(blob);
            repairPhotos.push({ blob, url });
        }
        renderPhotosGrid();
    }

    document.getElementById('repFormPhotoInputCamera')?.addEventListener('change', e => {
        processFiles(e.target.files);
        e.target.value = '';
    });
    document.getElementById('repFormPhotoInputGallery')?.addEventListener('change', e => {
        processFiles(e.target.files);
        e.target.value = '';
    });
}

function wireChecklistEvents() {
    document.getElementById('repChecklistClose')?.addEventListener('click',   closeChecklistModal);
    document.getElementById('repChecklistCancel')?.addEventListener('click',  closeChecklistModal);
    document.getElementById('repChecklistConfirm')?.addEventListener('click', submitChecklistModal);
    document.getElementById('repChecklistOverlay')?.addEventListener('click', e => {
        if (e.target === document.getElementById('repChecklistOverlay')) closeChecklistModal();
    });
}

function wireStepEvents() {
    document.getElementById('repStepClose')?.addEventListener('click',  closeStepModal);
    document.getElementById('repStepCancel')?.addEventListener('click',  closeStepModal);
    document.getElementById('repStepSaveBtn')?.addEventListener('click', submitStepModal);
    document.getElementById('repStepOverlay')?.addEventListener('click', e => {
        if (e.target === document.getElementById('repStepOverlay')) closeStepModal();
    });

    // Checkbox "Pular foto"
    const skipCheck  = document.getElementById('repSkipPhotoCheck');
    const skipBanner = document.getElementById('repSkipPhotoBanner');
    if (skipCheck && skipBanner) {
        skipCheck.addEventListener('change', () => {
            skipBanner.style.display = skipCheck.checked ? 'block' : 'none';
        });
    }
    document.getElementById('repSkipPhotoNo')?.addEventListener('click', () => {
        if (skipCheck) skipCheck.checked = false;
        if (skipBanner) skipBanner.style.display = 'none';
    });
    document.getElementById('repSkipPhotoYes')?.addEventListener('click', () => {
        if (skipBanner) skipBanner.style.display = 'none';
        window._stepSkipPhoto = true;
        _updateStepSaveBtn();
    });

    // Handler genérico para adicionar foto ao array
    const onStepBlob = b => {
        if (_stepPhotos.length >= STEP_MAX_PHOTOS) {
            showToast(`⚠️ Máximo de ${STEP_MAX_PHOTOS} fotos por etapa.`);
            return;
        }
        const url = URL.createObjectURL(b);
        _stepPhotos.push({ blob: b, url });
        // Desmarca skip se adicionou foto
        if (skipCheck) skipCheck.checked = false;
        if (skipBanner) skipBanner.style.display = 'none';
        window._stepSkipPhoto = false;
        const notice = document.getElementById('repStepPhotoNotice');
        if (notice) notice.style.display = 'none';
        _renderStepPhotosGrid();
    };

    // Reusar initPhotoInput só para capturar o blob
    const fileHandlerCamera  = document.getElementById('repStepPhotoInputCamera');
    const fileHandlerGallery = document.getElementById('repStepPhotoInputGallery');

    [fileHandlerCamera, fileHandlerGallery].forEach(input => {
        if (!input) return;
        input.addEventListener('change', async () => {
            const files = Array.from(input.files || []);
            if (!files.length) return;
            input.value = '';
            for (const file of files) {
                if (_stepPhotos.length >= STEP_MAX_PHOTOS) break;
                await new Promise((res) => {
                    const reader = new FileReader();
                    reader.onload = e => {
                        const img = new Image();
                        img.onload = () => {
                            const MAX = 1080, Q = 0.75;
                            let w = img.width, h = img.height;
                            if (w > MAX || h > MAX) {
                                const r = Math.min(MAX/w, MAX/h);
                        w = Math.round(w*r); h = Math.round(h*r);
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    canvas.toBlob(blob => { if (blob) { onStepBlob(blob); } res(); }, 'image/webp', Q);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
            }
        });
    });

    document.getElementById('repStepPhotoBtnCamera')?.addEventListener('click',  () => fileHandlerCamera?.click());
    document.getElementById('repStepPhotoBtnGallery')?.addEventListener('click', () => fileHandlerGallery?.click());
}

function wireUndoEvents() {
    document.getElementById('repUndoOverlay')?.addEventListener('click', e => {
        if (e.target === document.getElementById('repUndoOverlay'))
            document.getElementById('repUndoOverlay').classList.remove('active');
    });
}

// ── GARANTIA — Acionar / Finalizar ───────────────────────────────────────────

let _acionandoGarantia = false;
async function acionarGarantia(repair) {
    // Proteção de duplo toque
    if (_acionandoGarantia) return;
    // Se já está em garantia, não reseta o timestamp original
    if (repair.garantiaAtiva) {
        showToast('⚠️ Este conserto já está em garantia.');
        return;
    }
    _acionandoGarantia = true;
    try {
        const tsGarantia = Date.now();
        await saveRepair({
            ...repair,
            garantiaAtiva: true,
            garantiaTs:    tsGarantia,
            status:        STATUS.EM_REPARO,
            timeline: {
                ...repair.timeline,
                garantia: { ts: tsGarantia },
            },
        });
        showToast('🛡️ Garantia acionada — aparelho em reparo!');
    } finally {
        _acionandoGarantia = false;
    }
}

async function finalizarGarantia(repair) {
    // Abre o modal de entrega (com foto), depois limpa garantiaAtiva no submit
    repair._finalizandoGarantia = true;
    openPagamentoModal(repair);
}

function wireAcionarGarantiaEvents() {
    // Modal removido — sem eventos a registrar
}

// ── MODAL DE ANOTAÇÃO INTERNA ─────────────────────────────────
let _anotacaoRepair = null;

function openAnotacaoModal(repair) {
    _anotacaoRepair = repair;
    const overlay = document.getElementById('repAnotacaoOverlay');
    if (!overlay) return;
    const ta = document.getElementById('repAnotacaoTextarea');
    if (ta) ta.value = repair.anotacaoInterna || '';
    overlay.classList.add('active');
    setTimeout(() => ta?.focus(), 100);
}

function closeAnotacaoModal() {
    document.getElementById('repAnotacaoOverlay')?.classList.remove('active');
    _anotacaoRepair = null;
}

async function salvarAnotacao() {
    if (!_anotacaoRepair) return;
    const ta = document.getElementById('repAnotacaoTextarea');
    const texto = ta?.value.trim() || null;
    await saveRepair({ ..._anotacaoRepair, anotacaoInterna: texto });
    closeAnotacaoModal();
    showToast(texto ? '📝 Anotação salva!' : '🗑️ Anotação removida.');
}

function wireAnotacaoEvents() {
    const overlay = document.getElementById('repAnotacaoOverlay');
    if (!overlay) return;
    overlay.querySelector('#repAnotacaoClose')?.addEventListener('click', closeAnotacaoModal);
    overlay.querySelector('#repAnotacaoCancel')?.addEventListener('click', closeAnotacaoModal);
    overlay.querySelector('#repAnotacaoSave')?.addEventListener('click', salvarAnotacao);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeAnotacaoModal(); });
}

function wireGarantiaEvents() {
    document.getElementById('repGarantiaClose')?.addEventListener('click', closeGarantiaModal);
    document.getElementById('repGarantiaCancel')?.addEventListener('click', closeGarantiaModal);
    document.getElementById('repGarantiaOverlay')?.addEventListener('click', e => {
        if (e.target === document.getElementById('repGarantiaOverlay')) closeGarantiaModal();
    });
    document.getElementById('repGarantiaGerar')?.addEventListener('click', gerarGarantiaPDF);

    // Botões de seleção de dias
    document.querySelectorAll('.rep-gar-dias-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.rep-gar-dias-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            const diasCustom = document.getElementById('repGarDiasCustom');
            if (diasCustom) diasCustom.value = ''; // limpa o campo livre ao clicar em opção
        });
    });

    // Campo livre limpa seleção dos botões
    document.getElementById('repGarDiasCustom')?.addEventListener('input', () => {
        document.querySelectorAll('.rep-gar-dias-btn').forEach(b => b.classList.remove('selected'));
    });
}

function wireTipoCycleBtn() {
    const btn = document.getElementById('repTipoCycleBtn');
    if (!btn) return;
    const ciclo = [
        { estado: 'todos',     label: '<i class="bi bi-people-fill"></i> Todos',                                                   cor: ''                          },
        { estado: 'lojista',   label: '<i class="bi bi-buildings-fill"></i> Lojista',                                              cor: 'rgba(59,130,246,.18)'      },
        { estado: 'final',     label: '<i class="bi bi-person-fill"></i> Final',                                                   cor: 'rgba(139,92,246,.18)'      },
        { estado: 'instagram', label: '<i class="bi bi-instagram" style="color:#e1306c;"></i> Instagram',                          cor: 'rgba(225,48,108,.15)'      },
        { estado: 'fisica',    label: '<i class="bi bi-shop-window" style="color:var(--primary-color);"></i> Loja Física',         cor: 'rgba(16,185,129,.15)'      },
    ];
    btn.addEventListener('click', () => {
        const idx = ciclo.findIndex(c => c.estado === activeTipoFilter);
        const next = ciclo[(idx + 1) % ciclo.length];
        activeTipoFilter = next.estado;
        btn.dataset.estado = next.estado;
        btn.innerHTML = next.label;
        btn.style.background = next.cor;
        renderList(getFiltered(activeFilter));
    });
}

function wireFilterBtns() {
    document.querySelectorAll('[data-rep-filter]').forEach(btn => {
        btn.classList.toggle('rep-filter-active', btn.dataset.repFilter === activeFilter);
        btn.addEventListener('click', () => {
            activeFilter = btn.dataset.repFilter;
            document.querySelectorAll('[data-rep-filter]').forEach(b => b.classList.remove('rep-filter-active'));
            // Marca todos os elementos com o mesmo filtro como ativos
            document.querySelectorAll(`[data-rep-filter="${activeFilter}"]`).forEach(b => b.classList.add('rep-filter-active'));
            renderList(getFiltered(activeFilter));
        });
    });
}

function wireSearchInput() {
    const input = document.getElementById('repSearchInput');
    if (!input) return;
    const chipsWrap = document.getElementById('repSearchTypeChips');
    let activeTipo = 'todos';

    // Chips de tipo
    chipsWrap?.querySelectorAll('.rep-search-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            activeTipo = chip.dataset.tipo;
            chipsWrap.querySelectorAll('.rep-search-chip').forEach(c => c.classList.remove('rep-search-chip-active'));
            chip.classList.add('rep-search-chip-active');
            input.dispatchEvent(new Event('input'));
        });
    });

    input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        if (!q) {
            if (chipsWrap) chipsWrap.style.display = 'none';
            activeTipo = 'todos';
            chipsWrap?.querySelectorAll('.rep-search-chip').forEach(c => c.classList.remove('rep-search-chip-active'));
            chipsWrap?.querySelector('[data-tipo="todos"]')?.classList.add('rep-search-chip-active');
            renderList(getFiltered(activeFilter));
            return;
        }
        if (chipsWrap) chipsWrap.style.display = 'flex';
        const qNum = q.replace(/\D/g, '');
        const filtered = allRepairs.filter(r => {
            // Filtro de tipo
            if (activeTipo === 'final'   && r.tipoCliente === 'lojista') return false;
            if (activeTipo === 'lojista' && r.tipoCliente !== 'lojista') return false;
            // Busca textual
            if (r.nomeCliente?.toLowerCase().includes(q)) return true;
            if (r.descricaoDefeito?.toLowerCase().includes(q)) return true;
            if (r.modeloAparelho?.toLowerCase().includes(q)) return true;
            if (r.numeroCliente && qNum && r.numeroCliente.replace(/\D/g,'').includes(qNum)) return true;
            if (r.cpfCliente && qNum && r.cpfCliente.replace(/\D/g,'').includes(qNum)) return true;
            if (r.numero && String(r.numero).includes(q.replace('#',''))) return true;
            return false;
        });
        // Renderiza sem ocultar nenhum card e sem botão "ver mais"
        const container = document.getElementById('repairsList');
        if (!container) return;
        if (!filtered.length) {
            container.innerHTML = `
                <div class="rep-empty">
                    <div style="font-size:2rem;margin-bottom:8px;">🔍</div>
                    <div style="font-weight:600;">Nenhum resultado encontrado</div>
                    <div style="font-size:.8rem;opacity:.6;margin-top:4px;">Tente outro nome, modelo ou defeito</div>
                </div>`;
            return;
        }
        filtered.sort((a, b) => {
            const pa = prazoStatus(a), pb = prazoStatus(b);
            const order = { vencido: 0, proximo: 1, ok: 2 };
            if (order[pa] !== order[pb]) return order[pa] - order[pb];
            return (b.tsCadastro || 0) - (a.tsCadastro || 0);
        });
        container.innerHTML = filtered.map(r => buildCard(r, false)).join('');
        _bindListEvents(container);
    });
}

// ── Loading overlay de upload ─────────────────────────────────
let _saveLoadingEl = null;

function showSaveLoading(msg) {
    if (!_saveLoadingEl) {
        _saveLoadingEl = document.createElement('div');
        _saveLoadingEl.id = 'repSaveLoadingOverlay';
        _saveLoadingEl.innerHTML = `
            <div class="rep-save-loading-box">
                <div class="rep-save-loading-spinner"></div>
                <div class="rep-save-loading-msg" id="repSaveLoadingMsg"></div>
            </div>`;
        document.body.appendChild(_saveLoadingEl);
    }
    const msgEl = _saveLoadingEl.querySelector('#repSaveLoadingMsg');
    if (msgEl) msgEl.textContent = msg || 'Salvando…';
    _saveLoadingEl.style.display = 'flex';
}

function updateSaveLoading(msg) {
    const msgEl = document.getElementById('repSaveLoadingMsg');
    if (msgEl) msgEl.textContent = msg;
}

function hideSaveLoading() {
    if (_saveLoadingEl) _saveLoadingEl.style.display = 'none';
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================
export function initRepairs() {
    if (!window._firebaseDB) {
        // Retry loop — tenta até 30x (9 segundos total) antes de desistir
        if (!window._initRepairsAttempts) window._initRepairsAttempts = 0;
        window._initRepairsAttempts++;
        if (window._initRepairsAttempts <= 30) {
            setTimeout(initRepairs, 300);
        } else {
            console.error('[Repairs] Firebase não disponível após 9s — verifique a conexão.');
        }
        return;
    }
    window._initRepairsAttempts = 0;
    db = window._firebaseDB;
    verificarLicenca();
    pedirPermissaoNotificacao();
    wireFormEvents();
    wireStepEvents();
    wireChecklistEvents();
    wireUndoEvents();
    wireGarantiaEvents();
    wireAcionarGarantiaEvents();
    wireAnotacaoEvents();
    wireFornecedorEvents();
    wireFilterBtns();
    wireTipoCycleBtn();
    wireSearchInput();
    clientesListen(); // listener em tempo real — dispara imediatamente com dados do Firebase
    montarAutocomplete({ inputId: 'repFormNome', telId: 'repFormTel', cpfId: 'repFormCpf', onSelect: (cli) => {
        const tipo = cli.tipoCliente || 'final';
        const valEl = document.getElementById('repFormTipoClienteVal');
        const btnF  = document.getElementById('repFormTipoFinal');
        const btnL  = document.getElementById('repFormTipoLojista');
        if (valEl) valEl.value = tipo;
        if (btnF && btnL) {
            if (tipo === 'lojista') {
                btnL.style.background = 'rgba(59,130,246,.2)'; btnL.style.color = '#60a5fa'; btnL.style.opacity = '1';
                btnF.style.background = 'rgba(255,255,255,.06)'; btnF.style.color = 'rgba(255,255,255,.35)'; btnF.style.opacity = '.7';
            } else {
                btnF.style.background = 'var(--primary-color)'; btnF.style.color = '#fff'; btnF.style.opacity = '1';
                btnL.style.background = 'rgba(255,255,255,.06)'; btnL.style.color = 'rgba(255,255,255,.35)'; btnL.style.opacity = '.7';
            }
        }
    }});
    listenRepairs(items => render(items));
}

export function destroyRepairs() {
    stopListenRepairs();
    if (_clientesListener) { _clientesListener(); _clientesListener = null; }
}

// Auto-init
(function() {
    function selfInit() {
        const rc = document.getElementById('repairsContainer');
        if (!rc) return;
        if (!window._repairsInited) { window._repairsInited = true; initRepairs(); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', selfInit);
    else setTimeout(selfInit, 100);
})();

// Keyboard-aware modals
// Estratégia: quando o teclado abre, rola o campo focado para dentro da área visível
// dentro do sheet do modal — sem deslocar o overlay inteiro (que causava sumiço do topo).
(function() {
    const overlayIds = ['repFormOverlay', 'repStepOverlay', 'repChecklistOverlay', 'repConfirmOverlay', 'repGarantiaOverlay', 'repAnotacaoOverlay'];

    // Retorna o elemento ".rep-modal-sheet" ou ".rep-form-sheet" dentro do overlay ativo
    function getSheet(overlayEl) {
        return overlayEl.querySelector('.rep-modal-sheet, .rep-form-sheet, [class*="-sheet"]') || null;
    }

    function adjust() {
        const vv = window.visualViewport;
        if (!vv) return;
        const focused = document.activeElement;
        if (!focused || !['INPUT','TEXTAREA','SELECT'].includes(focused.tagName)) return;

        // Descobre em qual overlay ativo o campo está
        const overlayEl = overlayIds
            .map(id => document.getElementById(id))
            .find(el => el && el.classList.contains('active') && el.contains(focused));
        if (!overlayEl) return;

        const sheet = getSheet(overlayEl);
        const scrollTarget = sheet || overlayEl;

        // Aguarda o teclado terminar de subir antes de rolar
        setTimeout(() => {
            focused.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 120);
    }

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', adjust);
    }

    // Quando um campo dentro de um modal recebe foco, garante que fique visível
    overlayIds.forEach(id => {
        document.addEventListener('focusin', (e) => {
            const overlay = document.getElementById(id);
            if (!overlay || !overlay.classList.contains('active')) return;
            if (!overlay.contains(e.target)) return;
            setTimeout(() => {
                e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 150);
        });
    });
})();

// Abrir foto em overlay
window._repAbrirFoto = function(url) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.95);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
    ov.innerHTML = `<img src="${url}" crossorigin="anonymous" style="max-width:95vw;max-height:90vh;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.8);">`;
    ov.addEventListener('click', () => ov.remove());
    document.body.appendChild(ov);
};

// Expõe funções globalmente para index.html usar
window.imprimirHTML = imprimirHTML;
// loading funcs live in index.html as inline script
