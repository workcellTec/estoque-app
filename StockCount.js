// ============================================================
// 📦 STOCK COUNT — Contagem Rápida com IA em Segundo Plano
// v3 — múltiplas fotos por produto, marca como conferido,
//       badge "já fotografado hoje", autocomplete busca
// ============================================================
(function () {
    'use strict';

    const GROQ_KEY_STORAGE = 'ctwGroqApiKey';
    const SC_TODAY_KEY     = 'scFotografadosHoje'; // localStorage — { id: dateStr }

    // ── Lê chave Groq com 2 fallbacks ──
    function getGroqKey() {
        if (window.safeStorage?.getItem) {
            const k = window.safeStorage.getItem(GROQ_KEY_STORAGE);
            if (k) return k;
        }
        try { const k = localStorage.getItem(GROQ_KEY_STORAGE); if (k) return k; } catch(e) {}
        return '';
    }

    // ── Produtos fotografados hoje ──
    function _getTodayStr() {
        return new Date().toISOString().slice(0, 10); // "2025-03-14"
    }
    function _getFotografadosHoje() {
        try { return JSON.parse(localStorage.getItem(SC_TODAY_KEY) || '{}'); } catch(e) { return {}; }
    }
    function _marcarFotografadoHoje(id) {
        const dados = _getFotografadosHoje();
        dados[id] = _getTodayStr();
        try { localStorage.setItem(SC_TODAY_KEY, JSON.stringify(dados)); } catch(e) {}
    }
    function _foiFotografadoHoje(id) {
        const dados = _getFotografadosHoje();
        return dados[id] === _getTodayStr();
    }

    // ── Marca produto como conferido (replica o toggle do app.js) ──
    function _marcarComoConferido(id) {
        try {
            const timestamp = Date.now();
            // Atualiza checkedItems (objeto vivo exposto pelo app.js)
            if (window.checkedItems) {
                window.checkedItems[id] = { checked: true, timestamp };
            }
            // Persiste no localStorage
            if (typeof window.saveCheckedItems === 'function') {
                window.saveCheckedItems();
            } else {
                // Fallback: salva direto
                try {
                    const key = 'ctwCheckedItems';
                    const ci = JSON.parse(localStorage.getItem(key) || '{}');
                    ci[id] = { checked: true, timestamp };
                    localStorage.setItem(key, JSON.stringify(ci));
                } catch(e) {}
            }
            // Persiste no Firebase
            if (typeof window.updateProductInDB === 'function') {
                window.updateProductInDB(id, { lastCheckedTimestamp: timestamp });
            }
        } catch(e) { console.error('StockCount _marcarComoConferido:', e); }
    }

    // ── Estado ──
    const _queue = [];
    let _processing = false;
    let _erros = [];
    let _inputCam = null;
    let _jobAtual = null; // { id, nome, btn, fotos:[] }
    let _badgeEl = null;

    // ── INIT ──
    function init() {
        _injetarCSS();
        _injetarInputCamera();
        _injetarBadge();
        _observarEstoque();
        _initAutoComplete();
    }

    // ── CSS ──
    function _injetarCSS() {
        if (document.getElementById('scStyles')) return;
        const s = document.createElement('style');
        s.id = 'scStyles';
        s.textContent = `
            @keyframes scPulse { 0%,100%{opacity:1} 50%{opacity:.6} }
            .sc-cam-btn {
                width:34px; height:34px; border-radius:8px; border:none; cursor:pointer;
                background:rgba(0,184,148,.18); color:#00b894;
                display:flex; align-items:center; justify-content:center; font-size:.95rem;
                flex-shrink:0; transition:background .2s; position:relative;
            }
            .sc-cam-btn:active { background:rgba(0,184,148,.35); }
            .sc-cam-btn.sc-busy { background:rgba(251,146,60,.15); color:#fb923c; animation:scPulse 1.4s infinite; }
            .sc-cam-btn.sc-done-today {
                background:rgba(74,222,128,.15); color:#4ade80;
                border:1px solid rgba(74,222,128,.3);
            }
            /* Badge de quantidade de fotos no botão */
            .sc-foto-count {
                position:absolute; top:-5px; right:-5px;
                background:#fb923c; color:#000;
                font-size:.6rem; font-weight:700; min-width:16px; height:16px;
                border-radius:8px; display:flex; align-items:center; justify-content:center;
                padding:0 3px; pointer-events:none;
            }
            #scBadge {
                display:none; position:fixed; bottom:76px; right:14px; z-index:9999;
                background:#00b894; color:#000; border-radius:20px;
                padding:5px 13px; font-size:.76rem; font-weight:700;
                box-shadow:0 4px 14px rgba(0,0,0,.35);
                animation:scPulse 1.4s infinite;
            }
            .sc-erros-banner {
                background:rgba(251,146,60,.1); border:1px solid rgba(251,146,60,.35);
                border-radius:12px; padding:10px 14px; margin-bottom:10px; font-size:.8rem;
            }
            /* Autocomplete */
            #scAutoComplete {
                position:absolute; left:0; right:0; top:100%;
                background:var(--card-bg,#1a1a2e); border:1px solid var(--glass-border,rgba(255,255,255,.1));
                border-top:none; border-radius:0 0 12px 12px; z-index:1000;
                max-height:260px; overflow-y:auto; box-shadow:0 8px 24px rgba(0,0,0,.4);
            }
            .sc-ac-item {
                padding:10px 14px; cursor:pointer; font-size:.85rem;
                border-bottom:1px solid rgba(255,255,255,.05);
                color:var(--text-color,#fff); display:flex; align-items:center; gap:8px;
            }
            .sc-ac-item:last-child { border-bottom:none; }
            .sc-ac-item:hover, .sc-ac-item.sc-ac-active { background:rgba(0,184,148,.15); }
            .sc-ac-dot { width:10px; height:10px; border-radius:50%; border:1px solid rgba(255,255,255,.2); flex-shrink:0; }
            .sc-ac-nome { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .sc-ac-qty { font-size:.75rem; color:var(--text-secondary,#999); flex-shrink:0; }
            .sc-ac-today { font-size:.68rem; background:rgba(74,222,128,.2); color:#4ade80; border-radius:6px; padding:1px 5px; flex-shrink:0; }
            #scSearchWrap { position:relative; flex:1; min-width:180px; }
        `;
        document.head.appendChild(s);
    }

    // ── INPUT CÂMERA ──
    // Permite múltiplas fotos: cada click adiciona 1 foto ao job atual
    function _injetarInputCamera() {
        _inputCam = document.createElement('input');
        _inputCam.type = 'file';
        _inputCam.accept = 'image/*';
        _inputCam.capture = 'environment';
        _inputCam.style.display = 'none';
        document.body.appendChild(_inputCam);

        _inputCam.addEventListener('change', async e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file || !_jobAtual) return;

            const job = _jobAtual;
            job.fotos = job.fotos || [];
            job.fotos.push(file);
            const nFotos = job.fotos.length;

            // Atualiza badge de contagem no botão
            if (job.btn) {
                let badge = job.btn.querySelector('.sc-foto-count');
                if (!badge) { badge = document.createElement('span'); badge.className = 'sc-foto-count'; job.btn.appendChild(badge); }
                badge.textContent = nFotos;
                job.btn.classList.add('sc-busy');
                job.btn.querySelector('i').className = 'bi bi-hourglass-split';
                job.btn.title = `${nFotos} foto(s) — processando...`;
            }

            // Enfileira o job (cria ou atualiza)
            await _enfileirar(job.id, job.nome, job.fotos, job.btn);
        });
    }

    // ── BADGE ──
    function _injetarBadge() {
        _badgeEl = document.createElement('div');
        _badgeEl.id = 'scBadge';
        _badgeEl.innerHTML = '⏳ Detectando cores... <span id="scBadgeN">0</span>';
        document.body.appendChild(_badgeEl);
    }
    function _atualizarBadge() {
        if (!_badgeEl) return;
        const n = _queue.length;
        _badgeEl.style.display = n > 0 ? 'block' : 'none';
        const el = document.getElementById('scBadgeN');
        if (el) el.textContent = n;
    }

    // ── MUTATION OBSERVER — injeta botão 📷 ──
    function _observarEstoque() {
        const body = document.getElementById('stockTableBody');
        if (!body) { setTimeout(_observarEstoque, 600); return; }
        _adicionarBotoes(body);
        new MutationObserver(() => _adicionarBotoes(body)).observe(body, { childList: true });
        // Poll extra: re-injeta a cada 2s por 20s para garantir que o badge "hoje"
        // aparece mesmo quando os cards já estavam renderizados ao carregar
        let polls = 0;
        const poller = setInterval(() => {
            _adicionarBotoes(body);
            if (++polls >= 10) clearInterval(poller);
        }, 2000);
    }

    function _adicionarBotoes(body) {
        body.querySelectorAll('.stock-item-card[data-id]').forEach(card => {
            if (card.querySelector('.sc-cam-btn')) return;
            const id = card.dataset.id;
            const product = (window.products || []).find(p => p.id === id);
            if (!product) return;

            const jaHoje = _foiFotografadoHoje(id);
            const btn = document.createElement('button');
            btn.className = 'sc-cam-btn' + (jaHoje ? ' sc-done-today' : '');
            btn.title = jaHoje ? 'Já fotografado hoje — toque para fotografar de novo' : 'Detectar cores por foto';
            btn.innerHTML = jaHoje
                ? '<i class="bi bi-camera-fill"></i>'
                : '<i class="bi bi-camera-fill"></i>';

            if (jaHoje) {
                // Mostra ícone de check verde com câmera
                btn.innerHTML = '<i class="bi bi-camera-fill"></i>';
                const dot = document.createElement('span');
                dot.className = 'sc-foto-count';
                dot.style.background = '#4ade80';
                dot.textContent = '✓';
                btn.appendChild(dot);
            }

            btn.addEventListener('click', e => {
                e.stopPropagation();
                _abrirCamera(id, product.nome, btn);
            });

            const controles = card.querySelector('.d-flex.align-items-center.gap-2');
            if (controles) controles.appendChild(btn);
        });
    }

    // ── ABRIR CÂMERA ──
    function _abrirCamera(id, nome, btn) {
        if (!getGroqKey()) {
            if (typeof window.showCustomModal === 'function') {
                window.showCustomModal({ message: '🔑 Chave Groq não configurada.\n\nVá em Administração → Taxas → "IA para Scan de Estoque", cole a chave e toque em Salvar.' });
            }
            return;
        }
        // Mantém o job ativo para receber múltiplas fotos
        if (!_jobAtual || _jobAtual.id !== id) {
            _jobAtual = { id, nome, btn, fotos: [] };
        } else {
            _jobAtual.btn = btn; // atualiza referência do botão
        }
        _inputCam.click();
    }

    // ── FILA ──
    async function _enfileirar(id, nome, fotos, btn) {
        // Prepara todas as fotos
        const fotosProcessadas = [];
        for (const file of fotos) {
            const r = await _redimensionar(file) || await _fileToBase64(file);
            if (r) fotosProcessadas.push(r);
        }
        if (fotosProcessadas.length === 0) { _registrarErro(id, nome, 'Erro ao ler imagens'); _resetarBtn(btn, false); return; }

        // Remove job anterior do mesmo produto e substitui
        const idx = _queue.findIndex(q => q.id === id);
        if (idx > -1) _queue.splice(idx, 1);
        _queue.push({ id, nome, fotos: fotosProcessadas, btn });
        _atualizarBadge();
        if (!_processing) _processarFila();
    }

    async function _processarFila() {
        if (_queue.length === 0) { _processing = false; _atualizarBadge(); return; }
        _processing = true;
        const job = _queue[0];
        try {
            // Analisa todas as fotos e une cores + soma quantidades
            const todasCores = [];
            let totalQtd = 0;
            for (const foto of job.fotos) {
                const res = await _detectarCores(foto.b64, foto.mime, job.nome);
                if (res && res.cores) {
                    res.cores.forEach(c => {
                        if (!todasCores.some(x => x.hex.toLowerCase() === c.hex.toLowerCase())) todasCores.push(c);
                    });
                    totalQtd += (res.quantidade || 0);
                }
            }

            _queue.shift();

            if (todasCores.length > 0 || totalQtd > 0) {
                // Mostra card de confirmação antes de salvar
                _mostrarCardConfirmacao(job, todasCores, totalQtd);
            } else {
                _registrarErro(job.id, job.nome, 'IA não identificou cores');
                _resetarBtn(job.btn, false);
            }
        } catch (err) {
            console.error('StockCount:', err);
            _queue.shift();
            _registrarErro(job.id, job.nome, err.message || 'Erro');
            _resetarBtn(job.btn, false);
        }
        _atualizarBadge();
        _atualizarPainelErros();
        // NÃO chama filterStockProducts aqui — destruiria o card de confirmação
        // filterStockProducts é chamado dentro de _salvarResultado, após o usuário confirmar
        await new Promise(r => setTimeout(r, 500));
        _processarFila();
    }

    // ── CARD DE CONFIRMAÇÃO ──
    // Aparece no card do produto no estoque para o usuário confirmar antes de salvar
    function _mostrarCardConfirmacao(job, cores, quantidade) {
        // Reseta o botão para estado "aguardando confirmação"
        if (job.btn) {
            job.btn.classList.remove('sc-busy');
            const badge = job.btn.querySelector('.sc-foto-count');
            if (badge) badge.remove();
            job.btn.innerHTML = '<i class="bi bi-check2-circle" style="color:#facc15"></i>';
            job.btn.title = 'Aguardando confirmação...';
        }

        // Remove card anterior do mesmo produto se existir
        const existente = document.getElementById(`scConfirm_${job.id}`);
        if (existente) existente.remove();

        // Encontra o card do produto no estoque
        const prodCard = document.querySelector(`.stock-item-card[data-id="${job.id}"]`);
        if (!prodCard) {
            // Card não visível — salva direto
            _salvarResultado(job.id, cores, quantidade, job.btn);
            return;
        }

        const coresHtml = cores.map(c =>
            `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,.08);border-radius:6px;padding:2px 7px;font-size:.75rem;">
                <span style="width:10px;height:10px;border-radius:50%;background:${c.hex};border:1px solid rgba(255,255,255,.2);flex-shrink:0;"></span>
                ${c.nome}
            </span>`
        ).join('');

        const confirmaEl = document.createElement('div');
        confirmaEl.id = `scConfirm_${job.id}`;
        confirmaEl.style.cssText = 'background:rgba(250,204,21,.08);border:1px solid rgba(250,204,21,.35);border-radius:10px;padding:10px 12px;margin-top:8px;';
        confirmaEl.innerHTML = `
            <div style="font-size:.78rem;font-weight:700;color:#facc15;margin-bottom:6px;">
                <i class="bi bi-cpu-fill"></i> IA detectou — confirme antes de salvar
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
                <span style="font-size:.75rem;color:var(--text-secondary);">Qtd:</span>
                <div style="display:flex;align-items:center;gap:4px;">
                    <button id="scQDec_${job.id}" style="width:24px;height:24px;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:#fff;cursor:pointer;font-size:.9rem;display:flex;align-items:center;justify-content:center;">−</button>
                    <input id="scQInput_${job.id}" type="number" value="${quantidade}" min="0" style="width:55px;text-align:center;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#fff;font-size:.85rem;padding:2px 4px;">
                    <button id="scQInc_${job.id}" style="width:24px;height:24px;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:#fff;cursor:pointer;font-size:.9rem;display:flex;align-items:center;justify-content:center;">+</button>
                </div>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px;">${coresHtml || '<span style="font-size:.75rem;color:var(--text-secondary)">Nenhuma cor detectada</span>'}</div>
            <div style="display:flex;gap:8px;">
                <button id="scConfirmOk_${job.id}" style="flex:1;background:#4ade80;color:#000;border:none;border-radius:8px;padding:6px;font-size:.8rem;font-weight:700;cursor:pointer;">
                    <i class="bi bi-check-lg"></i> Confirmar
                </button>
                <button id="scConfirmX_${job.id}" style="background:rgba(248,113,113,.15);color:#f87171;border:1px solid rgba(248,113,113,.3);border-radius:8px;padding:6px 10px;font-size:.8rem;cursor:pointer;">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>`;

        prodCard.appendChild(confirmaEl);

        // Eventos dos botões +/-
        document.getElementById(`scQDec_${job.id}`)?.addEventListener('click', () => {
            const inp = document.getElementById(`scQInput_${job.id}`);
            if (inp) inp.value = Math.max(0, (parseInt(inp.value) || 0) - 1);
        });
        document.getElementById(`scQInc_${job.id}`)?.addEventListener('click', () => {
            const inp = document.getElementById(`scQInput_${job.id}`);
            if (inp) inp.value = (parseInt(inp.value) || 0) + 1;
        });

        // Confirmar
        document.getElementById(`scConfirmOk_${job.id}`)?.addEventListener('click', () => {
            const qtdFinal = parseInt(document.getElementById(`scQInput_${job.id}`)?.value) || quantidade;
            confirmaEl.remove();
            _salvarResultado(job.id, cores, qtdFinal, job.btn);
        });

        // Cancelar
        document.getElementById(`scConfirmX_${job.id}`)?.addEventListener('click', () => {
            confirmaEl.remove();
            _resetarBtn(job.btn, false);
            if (job.btn) {
                job.btn.innerHTML = '<i class="bi bi-camera-fill"></i>';
                job.btn.title = 'Detectar cores por foto';
                job.btn.classList.remove('sc-busy');
            }
        });
    }

    async function _salvarResultado(id, cores, quantidade, btn) {
        try {
            console.log('[StockCount] Salvando:', id, 'cores:', cores.length, 'qtd:', quantidade);
            // Garante que a função está disponível (pode não estar se app.js ainda não executou)
            const updateFn = window.updateProductInDB;
            if (typeof updateFn === 'function') {
                // Sempre substitui cores E quantidade no Firebase (nunca soma)
                const updates = {};
                if (cores && cores.length > 0) updates.cores = cores;
                updates.quantidade = quantidade; // substitui mesmo se for 0
                await updateFn(id, updates);
                console.log('[StockCount] Firebase atualizado:', updates);
            } else {
                console.error('[StockCount] window.updateProductInDB não disponível!');
            }
            _marcarComoConferido(id);
            _marcarFotografadoHoje(id);
            _erros = _erros.filter(e => e.id !== id);
            _resetarBtn(btn, true);
            if (typeof window.filterStockProducts === 'function') window.filterStockProducts();
        } catch(e) {
            console.error('[StockCount] Erro ao salvar:', e);
            _registrarErro(id, '?', e.message);
        }
    }

    function _resetarBtn(btn, sucesso) {
        // Re-busca o botão no DOM caso ele tenha sido re-renderizado
        let b = btn;
        if (b && !document.body.contains(b)) {
            // btn foi destruído pela re-renderização — não faz nada
            // o _adicionarBotoes vai re-criar com o estado correto via _foiFotografadoHoje
            return;
        }
        if (!b) return;

        b.classList.remove('sc-busy');
        const badge = b.querySelector('.sc-foto-count');
        if (badge) badge.remove();

        if (sucesso === true) {
            b.classList.add('sc-done-today');
            b.innerHTML = '<i class="bi bi-camera-fill"></i>';
            b.title = 'Cores atualizadas! Toque para fotografar novamente.';
            const dot = document.createElement('span');
            dot.className = 'sc-foto-count';
            dot.style.background = '#4ade80';
            dot.textContent = '✓';
            b.appendChild(dot);
        } else {
            b.innerHTML = '<i class="bi bi-exclamation-circle-fill" style="color:#f87171"></i>';
            b.title = 'Falhou — toque para tentar de novo';
        }
        if (_jobAtual && b === _jobAtual.btn) _jobAtual = null;
    }

    // ── GROQ ──
    async function _detectarCores(b64, mime, nomeProduto) {
        const key = getGroqKey();
        if (!key) throw new Error('Chave Groq não configurada');

        const prompt = `Foto de prateleira com caixas de celulares.

Foque APENAS nas caixas do produto: "${nomeProduto}"
Ignore qualquer outro modelo/marca visível.

Para CADA caixa do "${nomeProduto}" que você encontrar:
- Leia a COR escrita na etiqueta (ex: "Midnight Black", "Coral Green", "Glacier Blue", "Lavender Purple")
- Conte 1 unidade por caixa física

Responda SOMENTE com JSON:
{"cores":["Midnight Black","Coral Green"],"quantidade":3}

Se não encontrar esse produto: {"cores":[],"quantidade":0}`;

        const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
            body: JSON.stringify({
                model: 'meta-llama/llama-4-scout-17b-16e-instruct',
                max_completion_tokens: 200,
                temperature: 0.05,
                response_format: { type: 'json_object' },
                messages: [{ role: 'user', content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }
                ]}]
            })
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error?.message || `Erro HTTP ${resp.status}`);
        }

        const data = await resp.json();
        const texto = (data.choices?.[0]?.message?.content || '').trim();
        console.log(`StockCount [${nomeProduto}]:`, texto);
        const parsed = JSON.parse(texto.replace(/```json|```/gi, '').trim());
        const coresRaw = Array.isArray(parsed?.cores) ? parsed.cores : [];
        const cores = coresRaw.map(c => _mapearCor(c)).filter(Boolean)
            .filter((c, i, arr) => arr.findIndex(x => x.hex.toLowerCase() === c.hex.toLowerCase()) === i);
        const quantidade = parseInt(parsed?.quantidade) || 0;
        return { cores, quantidade };
    }

    // ── AUTOCOMPLETE ──
    function _initAutoComplete() {
        const input = document.getElementById('stockSearchInput');
        if (!input) { setTimeout(_initAutoComplete, 800); return; }

        const parent = input.parentElement;
        if (document.getElementById('scSearchWrap')) return;
        const wrap = document.createElement('div');
        wrap.id = 'scSearchWrap';
        wrap.style.cssText = 'position:relative; flex:1; min-width:180px;';
        parent.insertBefore(wrap, input);
        wrap.appendChild(input);
        input.style.flex = '';
        input.style.minWidth = '';

        let dropEl = null, activeIdx = -1;

        function _fechar() { if (dropEl) { dropEl.remove(); dropEl = null; } activeIdx = -1; }

        function _abrir(itens) {
            _fechar();
            if (!itens.length) return;
            dropEl = document.createElement('div');
            dropEl.id = 'scAutoComplete';
            itens.forEach((p, i) => {
                const coresHtml = (p.cores || []).slice(0, 6).map(c =>
                    `<span class="sc-ac-dot" style="background:${c.hex}" title="${c.nome}"></span>`).join('');
                const jaHoje = _foiFotografadoHoje(p.id);
                const div = document.createElement('div');
                div.className = 'sc-ac-item';
                div.innerHTML = `
                    <span style="display:flex;gap:3px">${coresHtml}</span>
                    <span class="sc-ac-nome">${p.nome}</span>
                    <span class="sc-ac-qty">${p.quantidade || 0} un.</span>
                    ${jaHoje ? '<span class="sc-ac-today">📷 hoje</span>' : ''}`;
                div.addEventListener('mousedown', e => { e.preventDefault(); _selecionar(p); });
                div.addEventListener('touchstart', e => { e.preventDefault(); _selecionar(p); }, { passive: false });
                dropEl.appendChild(div);
            });
            wrap.appendChild(dropEl);
        }

        function _selecionar(p) {
            input.value = p.nome; _fechar();
            if (typeof window.filterStockProducts === 'function') window.filterStockProducts();
        }

        function _destacar(idx) {
            if (!dropEl) return;
            dropEl.querySelectorAll('.sc-ac-item').forEach((el, i) => el.classList.toggle('sc-ac-active', i === idx));
            activeIdx = idx;
        }

        input.addEventListener('input', () => {
            const t = input.value.trim().toLowerCase();
            if (t.length < 1) { _fechar(); return; }
            const matches = (window.products || [])
                .filter(p => p.nome && p.nome.toLowerCase().includes(t) && !p.ignorarContagem)
                .slice(0, 8);
            _abrir(matches);
        });

        input.addEventListener('keydown', e => {
            if (!dropEl) return;
            const items = dropEl.querySelectorAll('.sc-ac-item');
            if (e.key === 'ArrowDown') { e.preventDefault(); _destacar(Math.min(activeIdx + 1, items.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); _destacar(Math.max(activeIdx - 1, 0)); }
            else if (e.key === 'Enter' && activeIdx >= 0) {
                e.preventDefault();
                const matches = (window.products || []).filter(p => p.nome && p.nome.toLowerCase().includes(input.value.trim().toLowerCase()) && !p.ignorarContagem).slice(0, 8);
                if (matches[activeIdx]) _selecionar(matches[activeIdx]);
            } else if (e.key === 'Escape') _fechar();
        });

        input.addEventListener('blur', () => setTimeout(_fechar, 150));
        input.addEventListener('focus', () => { if (input.value.trim().length >= 1) input.dispatchEvent(new Event('input')); });
    }

    // ── PAINEL DE ERROS ──
    function _registrarErro(id, nome, motivo) {
        _erros = _erros.filter(e => e.id !== id);
        _erros.push({ id, nome, motivo });
        _atualizarPainelErros();
    }

    function _atualizarPainelErros() {
        const body = document.getElementById('stockTableBody');
        if (!body) return;
        let painel = document.getElementById('scErrosPainel');
        if (_erros.length === 0) { if (painel) painel.remove(); return; }
        if (!painel) { painel = document.createElement('div'); painel.id = 'scErrosPainel'; body.parentElement?.insertBefore(painel, body); }
        const esc = s => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
        painel.innerHTML = `<div class="sc-erros-banner">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <strong style="color:#fb923c;font-size:.82rem"><i class="bi bi-exclamation-triangle-fill"></i> ${_erros.length} produto(s) sem cor — corrija manualmente</strong>
                <button onclick="document.getElementById('scErrosPainel').remove()" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:1rem">✕</button>
            </div>
            ${_erros.map(e => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-top:1px solid rgba(255,255,255,.05);font-size:.75rem"><span>${esc(e.nome)}</span><span style="color:var(--text-secondary)">${esc(e.motivo)}</span></div>`).join('')}
        </div>`;
    }

    // ── UTILITÁRIOS ──
    function _redimensionar(file) {
        return new Promise(resolve => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                URL.revokeObjectURL(url);
                const MAX = 1024;
                let w = img.width, h = img.height;
                if (w > MAX || h > MAX) { if (w > h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; } }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                canvas.toBlob(blob => { const r = new FileReader(); r.onload = () => resolve({ b64: r.result.split(',')[1], mime: 'image/jpeg' }); r.readAsDataURL(blob); }, 'image/jpeg', 0.82);
            };
            img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
            img.src = url;
        });
    }

    function _fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve({ b64: r.result.split(',')[1], mime: file.type || 'image/jpeg' });
            r.onerror = reject;
            r.readAsDataURL(file);
        });
    }

    function _mapearCor(c) {
        if (!c) return null;
        const p = window.colorPalette || [], l = c.toLowerCase().trim();

        // 1. Correspondência exata com a paleta
        const ex = p.find(x => x.nome.toLowerCase() === l);
        if (ex) return ex;

        // 2. Paleta contém o nome completo (substring bidirecional)
        for (const x of p) {
            if (l.includes(x.nome.toLowerCase()) || x.nome.toLowerCase().includes(l)) return x;
        }

        // 3. Multi-palavra: verifica a palavra de cor DOMINANTE
        // "Coral Green" → green domina → Verde
        // "Midnight Black" → black domina → Preto
        // "Glacier Blue" → blue domina → Azul
        // "Lavender Purple" → purple domina → Roxo
        const multiWord = [
            // Verdes — qualquer combinação com green/verde ganha
            { test: /\bgreen\b|\bverde\b/i,    nome: 'Verde' },
            { test: /\bblue\b|\bazul\b/i,     nome: 'Azul' },
            { test: /\bblack\b|\bpreto\b/i,   nome: 'Preto' },
            { test: /\bwhite\b|\bbranco\b/i,  nome: 'Branco' },
            { test: /\bgold\b|\bdourado\b/i,  nome: 'Dourado' },
            { test: /\byellow\b|\bamarelo\b/i,nome: 'Amarelo' },
            { test: /\bpurple\b|\broxo\b/i,   nome: 'Roxo' },
            { test: /\bpink\b|\brosa\b/i,     nome: 'Rosa' },
            { test: /\bgray\b|\bgrey\b|\bcinza\b/i, nome: 'Grafite' },
            { test: /\bsilver\b|\bprata\b/i,  nome: 'Prata' },
            { test: /\bred\b|\bvermelho\b/i,  nome: 'Vermelho' },
            { test: /\borange\b|\blaranja\b/i,nome: 'Laranja' },
        ];
        // Só aplica multi-palavra se a string tiver pelo menos 2 palavras
        if (l.includes(' ')) {
            for (const rule of multiWord) {
                if (rule.test.test(l)) {
                    const found = p.find(x => x.nome === rule.nome);
                    if (found) return found;
                }
            }
        }

        // 4. Keyword único (fallback para cores de uma palavra)
        const kw = {
            'preto':'Preto','black':'Preto','branco':'Branco','white':'Branco',
            'cinza':'Grafite','gray':'Grafite','grey':'Grafite','prata':'Prata','silver':'Prata',
            'azul':'Azul','blue':'Azul','verde':'Verde','green':'Verde',
            'roxo':'Roxo','purple':'Roxo','rosa':'Rosa','pink':'Rosa',
            'dourado':'Dourado','gold':'Dourado','amarelo':'Amarelo','yellow':'Amarelo',
            'laranja':'Laranja','orange':'Laranja','vermelho':'Vermelho','red':'Vermelho',
            'titanio':'Titanio Natural','titanium':'Titanio Natural',
            'lavender':'Lilas','midnight':'Preto','glacier':'Azul',
            'coral':'Coral', // só entra aqui se for palavra única "coral"
        };
        for (const [k, nome] of Object.entries(kw)) {
            if (l.includes(k)) { const f = p.find(x => x.nome === nome); if (f) return f; }
        }

        return { nome: c, hex: '#888888' };
    }

    // ── START ──
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
    } else {
        setTimeout(init, 1000);
    }
})();
