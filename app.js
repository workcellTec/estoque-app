

/* --- extracted script blocks (original attributes shown) --- */

/* original script attrs: type="module" */

// --- IMPORTAÇÕES DO FIREBASE ---
    import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
    import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
    import { getDatabase, ref, push, update, remove, onValue, off } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js";

    // --- CONFIGURAÇÃO DO FIREBASE ---
    const firebaseConfig = {
        apiKey: "AIzaSyANdJzvmHr8JVqrjveXbP_ZV6ZRR6fcVQk",
        authDomain: "ctwbybrendon.firebaseapp.com",
        databaseURL: "https://ctwbybrendon-default-rtdb.firebaseio.com",
        projectId: "ctwbybrendon",
        storageBucket: "ctwbybrendon.firebasestorage.app",
        messagingSenderId: "37459949616",
        appId: "1:37459949616:web:bf2e722a491f45880a55f5"
    };

    // --- VARIÁVEIS GLOBAIS ---
    let app, db, auth, userId = null, isAuthReady = false, areRatesLoaded = false;
    let products = [], fuse, selectedAparelhoValue = 0, fecharVendaPrecoBase = 0;
    let currentCalculatorSectionId = 'calculatorHome', productsListener = null, rates = {};
    let boletosListener = null;
    let notificationsListener = null;
    let currentMainSectionId = 'main';
    let emprestimoLucroPercentual = 15;
    let showIgnoredInStock = false;
    let checkedItems = {};
    let modificationTracker = {}; // Para rastrear mudanças de contagem
    const APARELHO_FAVORITES_KEY = 'ctwAparelhoFavoritos';
    const CHECKED_ITEMS_KEY = 'ctwCheckedItems';
    const MAX_FAVORITES = 5;
    const CONTRACT_DRAFT_KEY = 'ctwContractDraft';
    let draftSaveTimeout;

    // --- UTILITÁRIO DE ARMAZENAMENTO SEGURO ---
    const safeStorage = {
        getItem(key) { try { return localStorage.getItem(key); } catch (e) { console.warn("Acesso ao localStorage negado.", e); return null; } },
        setItem(key, value) { try { localStorage.setItem(key, value); } catch (e) { console.warn("Acesso ao localStorage negado.", e); } },
        removeItem(key) { try { localStorage.removeItem(key); } catch (e) { console.warn("Acesso ao localStorage negado.", e); } }
    };

    // --- FUNÇÕES DE TEMA (MODO NOTURNO/CLARO) ---
    const themeToggleCheckbox = document.getElementById('theme-toggle-checkbox');
    function applyTheme(theme) { 
        document.body.dataset.theme = theme;
        const isLight = theme === 'light';
        if (themeToggleCheckbox.checked !== isLight) {
            themeToggleCheckbox.checked = isLight;
        }
        safeStorage.setItem('theme', theme); 
    }
    function toggleTheme() { 
        const isLight = themeToggleCheckbox.checked;
        applyTheme(isLight ? 'light' : 'dark'); 
    }

    // --- NOVA NAVEGAÇÃO PRINCIPAL ---
    const mainMenu = document.getElementById('mainMenu');
    const calculatorContainer = document.getElementById('calculatorContainer');
    const contractContainer = document.getElementById('contractContainer');
    const stockContainer = document.getElementById('stockContainer');
    const adminContainer = document.getElementById('administracao');
    const topRightControls = document.getElementById('top-right-controls');

    function showMainSection(sectionId) {
        if (!isAuthReady) return;

        // Detach listeners from other sections to save resources
        if (productsListener) { off(getProductsRef(), 'value', productsListener); productsListener = null; }
        if (boletosListener) { off(ref(db, 'boletos'), 'value', boletosListener); boletosListener = null; }

        mainMenu.classList.add('hidden');
        calculatorContainer.classList.add('hidden');
        contractContainer.classList.add('hidden');
        stockContainer.classList.add('hidden');
        adminContainer.classList.add('hidden');
        topRightControls.classList.add('hidden');
        
        mainMenu.style.display = 'none';
        calculatorContainer.style.display = 'none';
        contractContainer.style.display = 'none';
        stockContainer.style.display = 'none';
        adminContainer.style.display = 'none';

        if (sectionId === 'main') {
            mainMenu.classList.remove('hidden');
            mainMenu.style.display = 'flex';
            topRightControls.classList.remove('hidden');
        } else if (sectionId === 'calculator') {
            calculatorContainer.classList.remove('hidden');
            calculatorContainer.style.display = 'block';
            openCalculatorSection('calculatorHome'); 
        } else if (sectionId === 'contract') {
            contractContainer.classList.remove('hidden');
            contractContainer.style.display = 'flex';
            loadContractDraft();
            const toggle = document.getElementById('boletoModeToggle');
            if (toggle.checked) {
                toggle.checked = false;
                toggle.dispatchEvent(new Event('change'));
            }
        } else if (sectionId === 'stock') {
            stockContainer.classList.remove('hidden');
            stockContainer.style.display = 'flex';
            loadCheckedItems();
            filterStockProducts(); 
        } else if (sectionId === 'administracao') {
            adminContainer.classList.remove('hidden');
            adminContainer.style.display = 'flex';
            filterAdminProducts();
        }
        currentMainSectionId = sectionId;
    }

    // --- FUNÇÕES DE ADMINISTRAÇÃO (TAXAS) ---
    function renderRatesEditor() {
        const accordionContainer = document.getElementById('ratesAccordion');
        if (!areRatesLoaded || Object.keys(rates).length === 0) { accordionContainer.innerHTML = '<p class="text-center text-secondary">Aguardando carregamento das taxas...</p>'; return; }
        accordionContainer.innerHTML = '';
        Object.keys(rates).forEach((machine, index) => {
            const machineData = rates[machine], isPagBank = machine === 'pagbank';
            let machineContent = '';
            if (isPagBank) {
                let creditInputs = (machineData.credito || []).map((rate, i) => `<div class="col-md-4 col-6"><label class="form-label small">${i + 1}x</label><div class="input-group mb-2"><input type="number" step="0.01" class="form-control form-control-sm" value="${rate}" data-machine="${machine}" data-type="credito" data-installments="${i + 1}"><span class="input-group-text">%</span></div></div>`).join('');
                machineContent = `<div class="row"><div class="col-md-4 col-6"><label class="form-label fw-bold">Débito</label><div class="input-group mb-3"><input type="number" step="0.01" class="form-control" value="${machineData.debito || 0}" data-machine="${machine}" data-type="debito"><span class="input-group-text">%</span></div></div></div><h5>Crédito</h5><div class="row">${creditInputs}</div>`;
            } else {
                const brands = Object.keys(machineData);
                const navTabs = brands.map((brand, i) => `<li class="nav-item"><a class="nav-link ${i === 0 ? 'active' : ''}" id="tab-${machine}-${brand}" data-bs-toggle="tab" href="#content-${machine}-${brand}" role="tab">${brand.charAt(0).toUpperCase() + brand.slice(1)}</a></li>`).join('');
                const tabContent = brands.map((brand, i) => {
                    const brandData = machineData[brand];
                    const creditInputs = (brandData.credito || []).map((idx, rate) => `<div class="col-md-4 col-6"><label class="form-label small">${idx + 1}x</label><div class="input-group mb-2"><input type="number" step="0.01" class="form-control form-control-sm" value="${rate}" data-machine="${machine}" data-brand="${brand}" data-type="credito" data-installments="${idx + 1}"><span class="input-group-text">%</span></div></div>`).join('');
                    return `<div class="tab-pane fade ${i === 0 ? 'show active' : ''}" id="content-${machine}-${brand}" role="tabpanel"><div class="row mt-3"><div class="col-md-4 col-6"><label class="form-label fw-bold">Débito</label><div class="input-group mb-3"><input type="number" step="0.01" class="form-control" value="${brandData.debito || 0}" data-machine="${machine}" data-brand="${brand}" data-type="debito"><span class="input-group-text">%</span></div></div></div><h5>Crédito</h5><div class="row">${creditInputs}</div></div>`;
                }).join('');
                machineContent = `<ul class="nav nav-tabs" role="tablist">${navTabs}</ul><div class="tab-content">${tabContent}</div>`;
            }
            accordionContainer.insertAdjacentHTML('beforeend', `<div class="accordion-item"><h2 class="accordion-header"><button class="accordion-button ${index > 0 ? 'collapsed' : ''}" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-${machine}">${machine.charAt(0).toUpperCase() + machine.slice(1)}</button></h2><div id="collapse-${machine}" class="accordion-collapse collapse ${index === 0 ? 'show' : ''}" data-bs-parent="#ratesAccordion"><div class="accordion-body">${machineContent}</div></div></div>`);
        });
        accordionContainer.querySelectorAll('[data-bs-toggle="tab"]').forEach(triggerEl => { if (!bootstrap.Tab.getInstance(triggerEl)) new bootstrap.Tab(triggerEl); });
    }
    async function saveRates() {
        const updatedRates = JSON.parse(JSON.stringify(rates));
        let hasError = false;
        document.querySelectorAll('#adminRatesContent input[type="number"]').forEach(input => {
            const { machine, brand, type, installments } = input.dataset;
            const value = parseFloat(input.value);
            if (isNaN(value)) { hasError = true; return; }
            if (brand) { if (type === 'debito') updatedRates[machine][brand].debito = value; else if (type === 'credito') updatedRates[machine][brand].credito[parseInt(installments) - 1] = value; } 
            else { if (type === 'debito') updatedRates[machine].debito = value; else if (type === 'credito') updatedRates[machine].credito[parseInt(installments) - 1] = value; }
        });
        if (hasError) { showCustomModal({ message: "Corrija campos inválidos." }); return; }
        try { await update(ref(db, 'rates'), updatedRates); showCustomModal({ message: "Taxas atualizadas!" }); } 
        catch (error) { console.error("Erro ao salvar taxas:", error); showCustomModal({ message: `Erro ao salvar: ${error.message}` }); }
    }

    // --- FUNÇÕES DO MODAL DE BANDEIRAS ---
    let activeBrandSelect = null;
    const flagData = { visa: { name: 'Visa', icon: 'bi-credit-card' }, mastercard: { name: 'Mastercard', icon: 'bi-credit-card-2-front-fill' }, hiper: { name: 'Hiper', icon: 'bi-card-heading' }, hipercard: { name: 'Hipercard', icon: 'bi-card-heading' }, elo: { name: 'Elo', icon: 'bi-credit-card-fill' }, amex: { name: 'Amex', icon: 'bi-person-badge' } };
    function openFlagModal(machineSelectElement) {
        const flagModalOverlay = document.getElementById('flagSelectorModalOverlay'), flagModalButtons = document.getElementById('flagSelectorButtons');
        const machineValue = machineSelectElement.value, sectionNumber = machineSelectElement.id.replace('machine', '');
        activeBrandSelect = document.getElementById(`brand${sectionNumber}`);
        if (machineValue === 'pagbank' || !activeBrandSelect) { if (flagModalOverlay.classList.contains('active')) closeFlagModal(); return; }
        flagModalButtons.innerHTML = ''; 
        Array.from(activeBrandSelect.options).forEach(option => {
            const brand = option.value, data = flagData[brand] || { name: brand.charAt(0).toUpperCase() + brand.slice(1), icon: 'bi-question-circle' };
            const button = document.createElement('button');
            button.className = 'btn-flag'; button.dataset.value = brand; button.innerHTML = `<i class="bi ${data.icon}"></i> ${data.name}`;
            button.onclick = () => { activeBrandSelect.value = brand; activeBrandSelect.dispatchEvent(new Event('change', { bubbles: true })); closeFlagModal(); };
            flagModalButtons.appendChild(button);
        });
        flagModalOverlay.classList.add('active');
    }
    function closeFlagModal() { document.getElementById('flagSelectorModalOverlay').classList.remove('active'); }
    function updateFlagDisplay(sectionNumber) {
        const brandSelect = document.getElementById(`brand${sectionNumber}`), displayButton = document.getElementById(`flagDisplayButton${sectionNumber}`);
        if (!brandSelect || !displayButton) return;
        const selectedBrand = brandSelect.value, data = flagData[selectedBrand] || { name: 'Select', icon: 'bi-question-circle'};
        displayButton.innerHTML = `<i class="bi ${data.icon}"></i> ${data.name}`;
    }

    // --- FUNÇÕES UTILITÁRIAS E DE UI ---
    function escapeHtml(text) { const map = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'}; return text ? text.toString().replace(/[&<>"']/g, m => map[m]) : ''; }
    function parseBrazilianCurrencyToFloat(valueString) { let cleaned = String(valueString).replace(/R\$?\s?|💰|\$\s?/g, '').trim(); if (cleaned.includes(',')) { cleaned = cleaned.replace(/\./g, '').replace(',', '.'); } return parseFloat(cleaned); }
    function openCalculatorSection(sectionId) { 
        if (!sectionId || !document.getElementById(sectionId)) sectionId = 'calculatorHome'; 

        ['calculatorHome', 'fecharVenda', 'repassarValores', 'calcularEmprestimo', 'calcularPorAparelho'].forEach(id => { 
            const el = document.getElementById(id);
            if (el) el.style.display = 'none'; 
        }); 
        document.getElementById(sectionId).style.display = 'flex'; 
        currentCalculatorSectionId = sectionId; 
        
        const sectionInitializers = { 
            fecharVenda: () => { updateInstallmentsOptions(); updateFecharVendaUI(); }, 
            repassarValores: () => { updateRepassarValoresUI(); }, 
            calcularEmprestimo: () => { updateCalcularEmprestimoUI(); },
            calcularPorAparelho: () => { updateCalcularPorAparelhoUI(); }
        }; 
        if (sectionInitializers[sectionId]) sectionInitializers[sectionId](); 
    }
    
    // --- FUNÇÕES DE ATALHO DE PARCELAS ---
    function renderQuickInstallmentButtons() {
        const container = document.getElementById('quickInstallmentsContainer');
        const installmentsSlider = document.getElementById("installments1");
        const maxInstallments = parseInt(installmentsSlider.max);
        const quickValues = [8, 10, 12, 18];

        container.innerHTML = '';

        quickValues.forEach(value => {
            if (value <= maxInstallments) {
                const btn = document.createElement('button');
                btn.className = 'quick-installment-btn';
                btn.textContent = `${value}x`;
                btn.dataset.value = value;
                btn.addEventListener('click', () => {
                    installmentsSlider.value = value;
                    installmentsSlider.dispatchEvent(new Event('input', { bubbles: true }));
                });
                container.appendChild(btn);
            }
        });
    }

    function updateQuickButtonsActiveState() {
        const installmentsSlider = document.getElementById("installments1");
        const currentValue = installmentsSlider.value;
        document.querySelectorAll('.quick-installment-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.value === currentValue);
        });
    }

    function updateInstallmentsOptions() { 
        const installmentsSlider = document.getElementById("installments1");
        const machine = document.getElementById("machine1").value; 
        if (!areRatesLoaded) { 
            installmentsSlider.disabled = true;
            return; 
        } 
        installmentsSlider.disabled = false;
        
        let max = 0; 
        if (rates[machine]) { 
            switch(machine) { 
                case "pagbank": max = 18; break; 
                case "infinity": max = 12; break; 
                case "valorante": max = 21; break; 
            } 
        } 
        installmentsSlider.max = max;
        // If current value is higher than new max, reset it
        if (parseInt(installmentsSlider.value) > max) {
            installmentsSlider.value = 0;
        }
        
        renderQuickInstallmentButtons(); // Renderiza os botões de atalho
        // Trigger input event to update display and calculation
        installmentsSlider.dispatchEvent(new Event('input'));
    }
    function toggleEntradaAVistaUI() {
        const isProdutoMode = document.getElementById('vendaModeToggle').checked, isEntradaChecked = document.getElementById('entradaAVistaCheckbox').checked;
        const entradaContainer = document.getElementById('entradaAVistaContainer'), finalValueContainer = document.getElementById('fecharVendaInputs'), entradaToggleContainer = document.getElementById('entradaAVistaToggleContainer');
        entradaToggleContainer.classList.toggle('hidden', !isProdutoMode || fecharVendaPrecoBase <= 0);
        if (isProdutoMode && isEntradaChecked) { entradaContainer.classList.remove('hidden'); finalValueContainer.classList.add('hidden'); document.getElementById('fecharVendaValue').value = ''; } 
        else { entradaContainer.classList.add('hidden'); finalValueContainer.classList.remove('hidden'); document.getElementById('valorEntradaAVista').value = ''; document.getElementById('valorPassadoNoCartao').value = ''; }
        calculateFecharVenda();
    }
    function updateFecharVendaUI() {
        const produtoContainer = document.getElementById('vendaPorProdutoContainer'), manualContainer = document.getElementById('manualModeContainer'), flagDisplayContainer = document.getElementById("flagDisplayContainer1");
        const valueLabel = document.getElementById('fecharVendaValueLabel'), valueInput = document.getElementById('fecharVendaValue');
        const isProdutoMode = document.getElementById('vendaModeToggle').checked, installments = parseInt(document.getElementById("installments1").value, 10), manualMode = document.querySelector('input[name="manualMode"]:checked').value, machine = document.getElementById("machine1").value;
        if (isProdutoMode) { 
            manualContainer.classList.add('hidden'); 
            produtoContainer.classList.remove('hidden'); 
        } 
        else { 
            manualContainer.classList.remove('hidden'); 
            produtoContainer.classList.add('hidden'); 
            document.getElementById('vendaProdutoSearch').value = ''; 
            document.getElementById('vendaSearchResultsContainer').innerHTML = ''; 
            document.getElementById('fecharVendaPrecoBase').value = ''; 
            fecharVendaPrecoBase = 0; 
            document.getElementById('entradaAVistaCheckbox').checked = false; 
        }
        toggleEntradaAVistaUI();
        if (!isProdutoMode) { valueLabel.innerHTML = (installments > 0 && manualMode === 'parcela') ? '<i class="bi bi-currency-dollar"></i> Valor da Parcela (R$)' : '<i class="bi bi-currency-dollar"></i> Valor Total da Venda (R$)'; valueInput.placeholder = (installments > 0 && manualMode === 'parcela') ? "Digite o valor da parcela" : "Digite o valor total"; }
        flagDisplayContainer.style.display = (machine !== "pagbank") ? 'block' : 'none';
        updateFlagDisplay('1'); calculateFecharVenda();
        updateQuickButtonsActiveState();
    }
    function updateRepassarValoresUI() { const machine = document.getElementById("machine2").value; document.getElementById("flagDisplayContainer2").style.display = (machine !== "pagbank") ? 'block' : 'none'; updateFlagDisplay('2'); calculateRepassarValores(); }
    function updateCalcularEmprestimoUI() { const machine = document.getElementById("machine4").value; document.getElementById("flagDisplayContainer4").style.display = (machine !== "pagbank") ? 'block' : 'none'; updateFlagDisplay('4'); calculateEmprestimo(); }
    function updateCalcularPorAparelhoUI() { 
        const machine = document.getElementById("machine3").value; 
        document.getElementById("flagDisplayContainer3").style.display = (machine !== "pagbank") ? 'block' : 'none'; 
        updateFlagDisplay('3'); 
        renderAparelhoFavorites();
        calculateAparelho(); 
    }
    
    // --- FUNÇÕES DE CÁLCULO ---
    function getRate(machine, brand, installments) { if (!areRatesLoaded || !rates[machine]) return undefined; if (machine === 'pagbank') return installments === 0 ? rates.pagbank.debito : rates.pagbank.credito[installments - 1]; const rateSet = (machine === 'infinity' && brand === 'hiper') ? rates.infinity.hiper : rates[machine][brand === 'hiper' ? 'hipercard' : brand]; return rateSet ? (installments === 0 ? rateSet.debito : rateSet.credito[installments - 1]) : undefined; }
    function calculateFecharVenda() { 
        if (!areRatesLoaded) return;
        const resultDiv = document.getElementById("resultFecharVenda"), isProdutoMode = document.getElementById('vendaModeToggle').checked, isEntradaAVista = document.getElementById('entradaAVistaCheckbox').checked;
        const installments = parseInt(document.getElementById("installments1").value, 10), tax = getRate(document.getElementById("machine1").value, document.getElementById("brand1").value, installments); 
        const foneDescontado = document.getElementById('descontarFoneCheckbox')?.checked || false, valorDesconto = 15;
        let checkboxHtml = '';
        if (tax === undefined || tax === null) { resultDiv.innerHTML = `<div class="alert alert-warning d-flex align-items-center"><i class="bi bi-exclamation-triangle-fill me-3"></i>Taxa não disponível.</div>`; return; } 
        if (isProdutoMode && fecharVendaPrecoBase > 0) checkboxHtml = `<div class="form-check form-check-inline mt-3 w-100" style="max-width: 400px; margin-left: auto; margin-right: auto; text-align: left; padding-left: 2.5em;"><input class="form-check-input" type="checkbox" id="descontarFoneCheckbox" ${foneDescontado ? 'checked' : ''}><label class="form-check-label" for="descontarFoneCheckbox">Descontar fone Bluetooth (${valorDesconto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})</label></div>`;
        if (isProdutoMode && isEntradaAVista) {
            const valorEntrada = parseFloat(document.getElementById('valorEntradaAVista').value) || 0, valorCartao = parseFloat(document.getElementById('valorPassadoNoCartao').value) || 0;
            if (fecharVendaPrecoBase <= 0) { resultDiv.innerHTML = `<div class="alert alert-info d-flex align-items-center"><i class="bi bi-info-circle-fill me-3"></i>Selecione um produto.</div>`; return; }
            if (valorCartao <= 0) { resultDiv.innerHTML = checkboxHtml || ""; return; }
            const liquidCartao = valorCartao * (1 - tax / 100);
            let totalRecebido = valorEntrada + liquidCartao;
            if (foneDescontado) totalRecebido -= valorDesconto;
            const lucroExtra = totalRecebido - fecharVendaPrecoBase;
            resultDiv.innerHTML = `<div class="alert alert-success fs-5 w-100 text-start" style="max-width: 400px; margin: 0 auto;"><div class="d-flex align-items-start"><i class="bi bi-check-circle-fill me-3 fs-4"></i><div><strong>Valor Total Recebido: ${totalRecebido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong><br/><small class="text-secondary">sendo ${valorEntrada.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} à vista + ${valorCartao.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} (tax. ${tax.toFixed(2)}%)</small><br/><strong class="mt-2 d-block">Lucro Extra: <span class="lucro-extra-valor">${lucroExtra.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></strong></div></div></div>` + checkboxHtml;
            return;
        }
        const inputValue = parseFloat(document.getElementById("fecharVendaValue").value);
        if (isNaN(inputValue) || inputValue <= 0) { resultDiv.innerHTML = checkboxHtml || ""; return; } 
        const manualMode = document.querySelector('input[name="manualMode"]:checked').value;
        let totalValue = (!isProdutoMode && manualMode === 'parcela' && installments > 0) ? inputValue * installments : inputValue; 
        const liquid = totalValue * (1 - tax / 100); 
        let liquidExibido = liquid, lucroExtraHtml = ''; 
        if (isProdutoMode && fecharVendaPrecoBase > 0) {
            if (foneDescontado) liquidExibido -= valorDesconto;
            const lucroExtra = liquidExibido - fecharVendaPrecoBase;
            lucroExtraHtml = `<hr class="my-2" style="border-color: rgba(255,255,255,0.2);"><strong>Lucro Extra: <span class="${lucroExtra >= 0 ? 'text-success' : 'text-danger'}">${lucroExtra.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></strong>`;
        } 
        resultDiv.innerHTML = `<div class="alert alert-success fs-5 w-100 text-start d-flex align-items-start" style="max-width: 400px; margin: 0 auto;"><i class="bi bi-check-circle-fill me-3 fs-4"></i><div><strong>Valor Líquido: ${liquidExibido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong><br/><small class="text-secondary">Taxa: ${tax.toFixed(2)}% (${installments === 0 ? "Débito" : `${installments}x`})</small>${lucroExtraHtml}</div></div>` + checkboxHtml;
    }
    function calculateRepassarValores() { 
        const resultDiv = document.getElementById("resultRepassarValores");
        const exportContainer = document.getElementById('exportRepassarContainer');
        if (!areRatesLoaded) return; 
        const valorDesejado = parseFloat(document.getElementById("repassarValue").value); 
        if (isNaN(valorDesejado) || valorDesejado <= 0) { 
            resultDiv.innerHTML = ""; 
            exportContainer.style.display = 'none';
            return; 
        } 
        const machine = document.getElementById("machine2").value, brand = document.getElementById("brand2").value; 
        let maxInstallments = 0; 
        if (rates[machine]) { 
            switch(machine) { 
                case "pagbank": maxInstallments = 18; break; 
                case "infinity": maxInstallments = 12; break; 
                case "valorante": maxInstallments = 21; break; 
            } 
        } 
        
        let tableRows = "";
        const debitTax = getRate(machine, brand, 0); 
        if(debitTax !== null && debitTax !== undefined) { 
            const valorBrutoDebito = valorDesejado / (1 - debitTax / 100); 
            tableRows += `<tr class="debit-row"><td>Débito</td><td>-</td><td>${valorBrutoDebito.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td></tr>`; 
        } 
        for (let i = 1; i <= maxInstallments; i++) { 
            const creditTax = getRate(machine, brand, i); 
            if (creditTax !== undefined) { 
                const valorBrutoCredit = valorDesejado / (1 - creditTax / 100), valorParcela = valorBrutoCredit / i; 
                tableRows += `<tr><td>${i}x</td><td>${valorParcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td><td>${valorBrutoCredit.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td></tr>`; 
            } 
        } 

        if (tableRows) {
            resultDiv.innerHTML = `<div class="table-responsive"><table class="table results-table"><thead><tr><th>Parcelas</th><th>Valor da Parcela</th><th>Total a Passar</th></tr></thead><tbody>${tableRows}</tbody></table></div>`;
        } else {
            resultDiv.innerHTML = "";
        }
        
        exportContainer.style.display = tableRows.trim() !== "" ? 'block' : 'none';
    }
    function calculateEmprestimo() {
        const resultDiv = document.getElementById("resultCalcularEmprestimo");
        const exportContainer = document.getElementById('exportEmprestimoContainer');
        if (!areRatesLoaded) return;
        const valorBase = parseFloat(document.getElementById("emprestimoValue").value) || 0;
        const lucro = valorBase * (emprestimoLucroPercentual / 100);
        const valorDesejado = valorBase + lucro;
        
        const lucroDisplay = document.getElementById("emprestimoLucroDisplay");
        const valorLiquidoDisplay = document.getElementById("valorLiquidoDisplay");

        lucroDisplay.innerHTML = `🟢 Lucro ${emprestimoLucroPercentual}% = <span>${lucro.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>`;

        if (valorBase <= 0) { 
            valorLiquidoDisplay.innerHTML = "";
            resultDiv.innerHTML = ""; 
            exportContainer.style.display = 'none';
            return; 
        }
        
        valorLiquidoDisplay.innerHTML = `<div class="alert alert-info d-flex align-items-center w-100" style="max-width: 400px; margin: 0 auto;"><i class="bi bi-info-circle-fill me-3"></i><div>Valor líquido a receber: <strong>${valorDesejado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></div></div>`;
        
        const machine = document.getElementById("machine4").value;
        const brand = document.getElementById("brand4").value;
        let maxInstallments = 0;
        if (rates[machine]) { switch (machine) { case "pagbank": maxInstallments = 18; break; case "infinity": maxInstallments = 12; break; case "valorante": maxInstallments = 21; break; } }
        
        let tableRows = "";
        const debitTax = getRate(machine, brand, 0);
        if (debitTax !== null && debitTax !== undefined) { 
            const valorBrutoDebito = valorDesejado / (1 - debitTax / 100); 
            tableRows += `<tr class="debit-row"><td>Débito</td><td>-</td><td>${valorBrutoDebito.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td></tr>`; 
        }
        for (let i = 1; i <= maxInstallments; i++) { 
            const creditTax = getRate(machine, brand, i); 
            if (creditTax !== undefined) { 
                const valorBrutoCredit = valorDesejado / (1 - creditTax / 100); 
                const valorParcela = valorBrutoCredit / i; 
                tableRows += `<tr><td>${i}x</td><td>${valorParcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td><td>${valorBrutoCredit.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td></tr>`; 
            } 
        }

        if (tableRows) {
            resultDiv.innerHTML = `<div class="table-responsive"><table class="table results-table"><thead><tr><th>Parcelas</th><th>Valor da Parcela</th><th>Total a Passar</th></tr></thead><tbody>${tableRows}</tbody></table></div>`;
        } else {
            resultDiv.innerHTML = "";
        }
        
        exportContainer.style.display = tableRows.trim() !== "" ? 'block' : 'none';
    }
    function calculateAparelho() {
        if (!areRatesLoaded) return;
        const resultDiv = document.getElementById('resultCalcularPorAparelho');
        const exportContainer = document.getElementById('exportAparelhoContainer');
        const entradaValue = parseFloat(document.getElementById('entradaAparelho').value) || 0;
        const extraValue = parseFloat(document.getElementById('valorExtraAparelho').value) || 0;

        if (isNaN(selectedAparelhoValue) || selectedAparelhoValue <= 0) {
            resultDiv.innerHTML = '<div class="alert alert-warning d-flex align-items-center mt-3 w-100" style="max-width: 400px;"><i class="bi bi-exclamation-triangle-fill me-3"></i>Selecione um aparelho.</div>';
            exportContainer.style.display = 'none';
            return;
        }

        const valorTotalAparelho = selectedAparelhoValue + extraValue;
        const valorBaseParaCalculo = valorTotalAparelho - entradaValue;
        
        let headerHtml = `<h4 class="mt-4">Preço Total: ${valorTotalAparelho.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</h4>`;
        if (entradaValue > 0) {
             headerHtml += `<div class="alert alert-info d-flex align-items-center w-100" style="max-width: 400px;"><i class="bi bi-info-circle-fill me-3"></i><div><strong>Entrada:</strong> ${entradaValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}<br><strong>Valor a Parcelar:</strong> ${valorBaseParaCalculo.toLocaleString('pt-BR', { style: 'currency', 'currency': 'BRL' })}</div></div>`;
        }

        if (valorBaseParaCalculo < 0) {
            resultDiv.innerHTML = headerHtml + '<div class="alert alert-danger d-flex align-items-center mt-3 w-100" style="max-width: 400px;"><i class="bi bi-x-circle-fill me-3"></i>O valor da entrada não pode ser maior que o valor do aparelho.</div>';
            exportContainer.style.display = 'none';
            return;
        }
        
        if (valorBaseParaCalculo <= 0) {
            resultDiv.innerHTML = headerHtml + '<div class="alert alert-success d-flex align-items-center mt-3 w-100" style="max-width: 400px;"><i class="bi bi-check-circle-fill me-3"></i>Aparelho quitado com a entrada.</div>';
            exportContainer.style.display = 'none';
            return;
        }
        
        const machine = document.getElementById("machine3").value;
        const brand = document.getElementById("brand3").value;
        let maxInstallments = 0;
        if (rates[machine]) { switch(machine) { case "pagbank": maxInstallments = 18; break; case "infinity": maxInstallments = 12; break; case "valorante": maxInstallments = 21; break; } }
        
        let tableRows = "";
        const debitTax = getRate(machine, brand, 0);
        if (debitTax !== null && debitTax !== undefined) { 
            const valorBrutoDebito = valorBaseParaCalculo / (1 - debitTax / 100); 
            tableRows += `<tr class="debit-row"><td>Débito</td><td>-</td><td>${valorBrutoDebito.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td></tr>`; 
        }
        for (let i = 1; i <= maxInstallments; i++) { 
            const creditTax = getRate(machine, brand, i); 
            if (creditTax !== undefined) { 
                const valorBrutoCredit = valorBaseParaCalculo / (1 - creditTax / 100), valorParcela = valorBrutoCredit / i; 
                tableRows += `<tr><td>${i}x</td><td>${valorParcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td><td>${valorBrutoCredit.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td></tr>`; 
            } 
        }
        
        let finalHtml = headerHtml;
        if(tableRows) {
            finalHtml += `<div class="table-responsive"><table class="table results-table"><thead><tr><th>Parcelas</th><th>Valor da Parcela</th><th>Total a Passar</th></tr></thead><tbody>${tableRows}</tbody></table></div>`;
        }
        resultDiv.innerHTML = finalHtml;
        exportContainer.style.display = tableRows.trim() !== "" ? 'block' : 'none';
    }
    function handleProductSelectionForAparelho(product) { 
        document.getElementById('saveAparelhoFavoriteBtn').classList.remove('hidden');
        selectedAparelhoValue = parseFloat(product.valor); 
        document.getElementById('aparelhoSearch').value = `${product.nome}`; 
        document.getElementById('aparelhoResultsContainer').innerHTML = ''; 
        document.getElementById('entradaAparelho').value = ''; 
        document.getElementById('valorExtraAparelho').value = ''; 

        const infoNoteEl = document.getElementById('aparelhoInfoNote');
        
        if (product.lastCheckedTimestamp) {
            const date = new Date(product.lastCheckedTimestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            const colorsString = (product.cores && product.cores.length > 0) 
                ? product.cores.map(c => c.nome).join(', ') 
                : 'Nenhuma cor cadastrada';
            
            infoNoteEl.innerHTML = `<i class="bi bi-info-circle"></i> Última checagem em ${date} - Cores: ${colorsString}`;
            infoNoteEl.classList.remove('hidden');
        } else {
            infoNoteEl.classList.add('hidden');
        }

        calculateAparelho(); 
    }
    function handleProductSelectionForVenda(product) { 
        fecharVendaPrecoBase = parseFloat(product.valor); 
        document.getElementById('fecharVendaPrecoBase').value = fecharVendaPrecoBase.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); 
        document.getElementById('vendaProdutoSearch').value = product.nome; 
        document.getElementById('vendaSearchResultsContainer').innerHTML = ''; 
        if (!document.getElementById('entradaAVistaCheckbox').checked) { 
            const tax = getRate(document.getElementById("machine1").value, document.getElementById("brand1").value, parseInt(document.getElementById("installments1").value, 10)); 
            document.getElementById('fecharVendaValue').value = (tax !== undefined) ? (fecharVendaPrecoBase / (1 - tax / 100)).toFixed(2) : fecharVendaPrecoBase.toFixed(2); 
        } 
        updateFecharVendaUI(); 
    }
    
    // --- FUNÇÃO DE EXPORTAÇÃO DE IMAGEM (ATUALIZADA) ---
    async function exportResultsToImage(resultsContainerId, fileName = 'calculo-taxas.png', headerHtml = '') {
        const resultsEl = document.getElementById(resultsContainerId);
        if (!resultsEl || !resultsEl.innerHTML.trim()) {
            showCustomModal({ message: "Não há resultados para exportar." });
            return;
        }

        const exportContainer = document.createElement('div');
        exportContainer.className = 'export-container-temp'; 
        exportContainer.style.position = 'absolute';
        exportContainer.style.left = '-9999px';
        exportContainer.style.padding = '25px';
        exportContainer.style.borderRadius = 'var(--border-radius)';
        exportContainer.style.width = 'auto';
        exportContainer.style.maxWidth = '600px';
        
        const isLightTheme = document.body.dataset.theme === 'light';
        exportContainer.style.backgroundColor = isLightTheme ? '#ffffff' : '#1A1A1A';
        exportContainer.dataset.theme = document.body.dataset.theme;

        const textColor = isLightTheme ? '#000000' : '#FFFFFF';
        const headerColor = isLightTheme ? '#333333' : '#DDDDDD';
        const exportStyles = `
            <style>
                .export-container-temp { color: ${textColor} !important; }
                .results-table { --bs-table-color: ${textColor}; --bs-table-border-color: rgba(255,255,255,0.2); }
                .results-table th, .results-table td { color: ${textColor} !important; font-weight: 500 !important; }
                .results-table th { color: ${headerColor} !important; }
                .results-table .debit-row td { font-weight: 600 !important; }
                h4 { color: ${textColor} !important; }
            </style>
        `;

        exportContainer.innerHTML = exportStyles + headerHtml + resultsEl.innerHTML;
        
        document.body.appendChild(exportContainer);
        document.body.classList.add('exporting-image');
        
        try {
            await new Promise(resolve => setTimeout(resolve, 100));

            const canvas = await html2canvas(exportContainer, {
                backgroundColor: null,
                scale: 2,
                useCORS: true,
                logging: false
            });

            const link = document.createElement('a');
            link.download = fileName;
            link.href = canvas.toDataURL("image/png").replace("image/png", "image/octet-stream");
            link.click();
        } catch (error) {
            console.error('Erro ao exportar imagem:', error);
            showCustomModal({ message: 'Ocorreu um erro ao gerar a imagem.' });
        } finally {
            document.body.classList.remove('exporting-image');
            if(document.body.contains(exportContainer)){
                 document.body.removeChild(exportContainer);
            }
        }
    }

    // --- LÓGICA DO FIREBASE ---
    function showSkeletonLoader(container) {
        if(!container) return;
        container.classList.add('is-loading');
        let skeletonHTML = '';
        for(let i=0; i<3; i++) {
            skeletonHTML += '<div class="skeleton skeleton-item"></div>';
        }
        container.innerHTML = skeletonHTML;
    }
    function hideSkeletonLoader(container) {
        if(!container) return;
        container.classList.remove('is-loading');
        container.innerHTML = '';
    }

    function loadRatesFromDB() { const ratesRef = ref(db, 'rates'); onValue(ratesRef, (snapshot) => { if (snapshot.exists()) { rates = snapshot.val(); areRatesLoaded = true; updateInstallmentsOptions(); console.log("Taxas carregadas."); if (currentCalculatorSectionId === 'administracao' && document.getElementById('adminModeToggle').checked) renderRatesEditor(); } else { console.error("ERRO: As taxas não foram encontradas."); showCustomModal({ message: "Erro crítico: Não foi possível carregar as taxas." }); } }, (error) => { console.error("Erro ao carregar taxas:", error); showCustomModal({ message: `Erro ao carregar taxas: ${error.message}` }); }); }
    const getProductsRef = () => ref(db, 'products');
    function loadProductsFromDB() { 
        if (!db || !isAuthReady) return; 

        const searchContainers = [document.getElementById('vendaSearchResultsContainer'), document.getElementById('aparelhoResultsContainer')];
        searchContainers.forEach(c => showSkeletonLoader(c));

        if (productsListener) off(getProductsRef(), 'value', productsListener); 
        productsListener = onValue(getProductsRef(), (snapshot) => { 
            searchContainers.forEach(c => hideSkeletonLoader(c));
            const data = snapshot.val(); products = data ? Object.keys(data).map(key => ({ id: key, ...data[key] })) : []; 
            setupFuse(); 
            
            const aparelhoContent = document.getElementById('aparelhoContentWrapper');
            const aparelhoEmptyState = document.getElementById('aparelhoEmptyStateWrapper');

            if (products.length === 0) {
                if (aparelhoContent) aparelhoContent.classList.add('hidden');
                if (aparelhoEmptyState) aparelhoEmptyState.classList.remove('hidden');
            } else {
                if (aparelhoContent) aparelhoContent.classList.remove('hidden');
                if (aparelhoEmptyState) aparelhoEmptyState.classList.add('hidden');
            }
            
            const placeholderText = products.length > 0 ? `Pesquisar entre ${products.length} produtos...` : 'Nenhum produto cadastrado'; 
            document.getElementById('vendaProdutoSearch').placeholder = placeholderText; 
            document.getElementById('aparelhoSearch').placeholder = placeholderText; 
            if(document.getElementById('adminSearchInput')) document.getElementById('adminSearchInput').placeholder = `Filtrar ${products.length} produtos...`; 
            if (currentMainSectionId === 'administracao') filterAdminProducts(); 
            if (currentMainSectionId === 'stock') filterStockProducts();
        }, (error) => {
            console.error("Firebase Read Error:", error);
            searchContainers.forEach(c => hideSkeletonLoader(c));
        }); 
    }
    async function updateProductInDB(id, data) { try { await update(ref(db, `products/${id}`), data); } catch (error) { console.error(`Erro ao atualizar: ${error.message}`); } }
    
    // --- FUNÇÕES DE ADMINISTRAÇÃO (PRODUTOS) ---
    function renderAdminTable(filteredList = products) {
        const tableBody = document.getElementById('productsTableBody');
        if (!tableBody) return;
        if (filteredList.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="3" class="text-center p-5">
                        <i class="bi bi-journal-x" style="font-size: 4rem; color: var(--text-secondary);"></i>
                        <h5 class="mt-3">Nenhum produto encontrado</h5>
                        <p class="text-secondary">Adicione um novo produto abaixo para começar a gerir a sua lista.</p>
                    </td>
                </tr>
            `;
        } else {
             tableBody.innerHTML = filteredList.flatMap(product => [
                `<tr class="product-data-row" data-id="${product.id}">
                    <td><input type="text" class="form-control form-control-sm" value="${escapeHtml(product.nome)}" data-field="nome"></td>
                    <td><input type="text" class="form-control form-control-sm" value="${(product.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}" data-field="valor"></td>
                    <td><input type="number" class="form-control form-control-sm text-center" value="${product.quantidade || 0}" data-field="quantidade" min="0" step="1"></td>
                </tr>`,
                `<tr class="product-separator-row" data-id="${product.id}">
                    <td colspan="3">
                         <button class="btn-toggle-menu" data-id="${product.id}" aria-label="Abrir menu de ações">
                            <i class="bi bi-chevron-down"></i>
                         </button>
                    </td>
                </tr>`,
                `<tr class="acoes-produto" data-id="${product.id}">
                    <td colspan="3">
                        <div class="action-menu-content">
                            <div class="form-check form-switch">
                              <input class="form-check-input ignore-toggle-switch-admin" type="checkbox" role="switch" id="ignore-admin-${product.id}" data-id="${product.id}" ${product.ignorarContagem ? 'checked' : ''}>
                              <label class="form-check-label" for="ignore-admin-${product.id}">Ignorar na contagem</label>
                            </div>
                            <button class="btn btn-sm btn-danger delete-product-btn" data-id="${product.id}"><i class="bi bi-trash"></i> Apagar</button>
                        </div>
                    </td>
                </tr>`
            ]).join('');
        }
    }
    function filterAdminProducts() { const searchTerm = document.getElementById('adminSearchInput').value; renderAdminTable(!fuse || !searchTerm ? products : fuse.search(searchTerm).map(r => r.item)); }
    async function importFromPasteOrFile(content) {
        const lines = content.split('\n').filter(line => line.trim());
        const productsToImport = lines.map(line => {
             const parts = line.split('-').map(p => p.trim());
            if (parts.length >= 2) {
                const nome = parts[0];
                const valor = parseBrazilianCurrencyToFloat(parts[1]);
                const quantidade = parts.length > 2 ? parseInt(parts[2], 10) : 1;
                
                if (nome && !isNaN(valor) && !isNaN(quantidade)) {
                    return { nome, valor, quantidade, cores: [], ignorarContagem: false };
                }
            }
            return null;
        }).filter(Boolean);

        if (productsToImport.length > 0) {
            try {
                const updates = {};
                productsToImport.forEach(p => {
                    const newKey = push(getProductsRef()).key;
                    updates[newKey] = p;
                });
                await update(getProductsRef(), updates);
                showCustomModal({ message: `${productsToImport.length} produtos importados!` });
            } catch (error) {
                showCustomModal({ message: `Erro ao importar: ${error.message}` });
            }
        } else {
            showCustomModal({ message: 'Nenhum produto válido encontrado.' });
        }
    }
    function exportProducts(format) { const dataStr = format === 'txt' ? products.map(p => `${p.nome} - ${(p.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`).join('\n') : JSON.stringify(products.map(({id, ...rest}) => rest), null, 2); const blob = new Blob([dataStr], { type: `text/${format === 'txt' ? 'plain' : 'json'}` }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `products.${format}`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href); }
    
    function showCustomModal({ message, onConfirm, onCancel, showPassword = false, confirmText = 'OK', cancelText = 'Cancelar' }) {
        const overlay = document.getElementById('customModalOverlay');
        const messageEl = document.getElementById('customModalMessage');
        const passInput = document.getElementById('customModalPasswordInput');
        const okBtn = overlay.querySelector('.btn-ok');
        const cancelBtn = overlay.querySelector('.btn-cancel');
        const buttonsContainer = document.getElementById('customModalButtons');

        if (overlay.dataset.timerId) {
            clearTimeout(parseInt(overlay.dataset.timerId));
            delete overlay.dataset.timerId;
        }

        const closeModal = () => {
            overlay.classList.remove('active');
        };
        
        messageEl.textContent = message;
        passInput.value = '';
        passInput.classList.toggle('hidden', !showPassword);

        const isInformational = typeof onConfirm !== 'function' && typeof onCancel !== 'function';

        if (isInformational) {
            buttonsContainer.classList.add('hidden');
            const timerId = setTimeout(closeModal, 3000);
            overlay.dataset.timerId = timerId;
        } else {
            buttonsContainer.classList.remove('hidden');
            
            if (typeof onConfirm === 'function') {
                okBtn.textContent = confirmText;
                okBtn.style.display = 'inline-flex';
                okBtn.onclick = () => {
                    closeModal();
                    onConfirm(passInput.value);
                };
            } else {
                okBtn.style.display = 'none';
            }

            if (typeof onCancel === 'function') {
                cancelBtn.textContent = cancelText;
                cancelBtn.style.display = 'inline-flex';
                cancelBtn.onclick = () => {
                    closeModal();
                    onCancel();
                };
            } else {
                cancelBtn.style.display = 'none';
            }
        }

        overlay.classList.add('active');
        if (showPassword) {
            passInput.focus();
        }
    }

    async function deleteAllProducts() { showCustomModal({ message: "Para excluir TODOS os produtos, digite 'excluir'.", showPassword: true, confirmText: "Excluir", onConfirm: async (password) => { if (password === "excluir") { showCustomModal({ message: "Ação IRREVERSÍVEL. Apagar TUDO?", confirmText: 'SIM, EXCLUIR', onConfirm: async () => { try { await remove(getProductsRef()); showCustomModal({message: 'Todos os produtos foram excluídos.'}); } catch (error) { showCustomModal({ message: `Erro: ${error.message}` }); } }, onCancel: () => {} }); } else showCustomModal({ message: "Senha incorreta." }); }, onCancel: () => {} }); }
    function displayDynamicSearchResults(searchTerm, resultsContainerId, onItemClick) { const resultsContainer = document.getElementById(resultsContainerId); resultsContainer.innerHTML = ''; if (!fuse || !searchTerm || searchTerm.length < 2) return; const results = fuse.search(searchTerm); results.slice(0, 10).forEach(result => { const product = result.item; const a = document.createElement('a'); a.href = '#'; a.className = 'list-group-item list-group-item-action'; a.textContent = `${product.nome} - ${(product.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`; a.onclick = (e) => { e.preventDefault(); onItemClick(product); }; resultsContainer.appendChild(a); }); }
    function setupFuse() {
        fuse = new Fuse(products, {
            keys: ['nome'],
            includeScore: true,
            threshold: 0.3,
            minMatchCharLength: 2,
        });
    }
    
    // --- LÓGICA DE ESTOQUE E CORES ---
    let currentEditingProductId = null;
    let tempSelectedColors = [];
    const colorPalette = [
        { nome: 'Preto', hex: '#212121' }, { nome: 'Branco', hex: '#FFFFFF' }, { nome: 'Cinza Espacial', hex: '#535559' }, { nome: 'Prata', hex: '#E0E0E0' },
        { nome: 'Dourado', hex: '#FFD700' }, { nome: 'Rosê', hex: '#E0BFB8' }, { nome: 'Rosa', hex: '#FFC0CB' }, { nome: 'Rosa Claro', hex: '#FFD1DC' },
        { nome: 'Titânio Natural', hex: '#8A837E' }, { nome: 'Titânio Azul', hex: '#2E435E' }, { nome: 'Titânio Branco', hex: '#F5F5F7'}, { nome: 'Titânio Preto', hex: '#4A4A4A'},
        { nome: 'Azul', hex: '#1565C0' }, { nome: 'Azul-Céu', hex: '#87CEEB' }, { nome: 'Azul-Sierra', hex: '#A9C2D8' }, { nome: 'Verde', hex: '#2E7D32' },
        { nome: 'Verde-Menta', hex: '#98FF98' }, { nome: 'Verde-Alpino', hex: '#597D61' }, { nome: 'Roxo', hex: '#6A1B9A' }, { nome: 'Roxo Profundo', hex: '#4B0082'},
        { nome: 'Lilás', hex: '#C8A2C8' }, { nome: 'Vermelho', hex: '#C62828' }, { nome: 'Laranja', hex: '#F57C00' }, { nome: 'Coral', hex: '#FF7F50' },
        { nome: 'Amarelo', hex: '#FBC02D' }, { nome: 'Creme', hex: '#FFFDD0' }, { nome: 'Grafite', hex: '#455A64' }
    ];
    
    function loadCheckedItems() {
        const stored = safeStorage.getItem(CHECKED_ITEMS_KEY);
        checkedItems = stored ? JSON.parse(stored) : {};
    }
    function saveCheckedItems() {
        safeStorage.setItem(CHECKED_ITEMS_KEY, JSON.stringify(checkedItems));
    }

    function renderStockList(list) {
        const tableBody = document.getElementById('stockTableBody');
        if (!tableBody) return;
        
        const sortedList = [...list].sort((a, b) => {
            const aIsChecked = checkedItems[a.id]?.checked || false;
            const bIsChecked = checkedItems[b.id]?.checked || false;
            if (aIsChecked !== bIsChecked) {
                return aIsChecked ? 1 : -1; // Not checked items first
            }
            return a.nome.localeCompare(b.nome); // Then sort by name
        });

        if (sortedList.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="4" class="text-center p-5"><i class="bi bi-box-seam" style="font-size: 3rem; color: var(--text-secondary);"></i><h5 class="mt-3">Nenhum produto para exibir.</h5><p class="text-secondary">Verifique os filtros ou adicione produtos na Administração.</p></td></tr>`;
        } else {
            tableBody.innerHTML = sortedList.map(product => {
                const isChecked = checkedItems[product.id]?.checked || false;
                const rowClass = isChecked ? 'is-checked' : 'not-checked';

                return `
                <tr data-id="${product.id}" class="${rowClass}">
                    <td class="align-middle product-name-cell">
                        <div>${escapeHtml(product.nome)}</div>
                        <div class="product-colors-display">${(product.cores || []).map(cor => `<div class="color-swatch-sm" style="background-color:${cor.hex};" title="${cor.nome}"></div>`).join('')}</div>
                    </td>
                    <td class="text-center align-middle">
                         <div class="input-group input-group-sm justify-content-center">
                            <button class="btn btn-outline-secondary stock-qty-btn" data-change="-1" aria-label="Diminuir">-</button>
                            <input type="number" class="form-control text-center stock-qty-input px-1" value="${product.quantidade || 0}" min="0" step="1" style="max-width: 60px; font-weight: bold;">
                            <button class="btn btn-outline-secondary stock-qty-btn" data-change="1" aria-label="Aumentar">+</button>
                        </div>
                    </td>
                    <td class="text-center align-middle">
                        <div class="d-flex justify-content-center align-items-center gap-2">
                            <button class="btn btn-sm btn-secondary open-color-picker-btn" data-id="${product.id}" title="Editar Cores"><i class="bi bi-palette-fill"></i></button>
                            <div class="form-check form-switch" title="Ignorar na contagem">
                                <input class="form-check-input ignore-toggle-switch-stock" type="checkbox" role="switch" id="ignore-stock-${product.id}" data-id="${product.id}" ${product.ignorarContagem ? 'checked' : ''}>
                            </div>
                        </div>
                    </td>
                    <td class="text-center align-middle">
                         <div class="form-check d-flex justify-content-center">
                            <input class="form-check-input stock-checked-toggle" type="checkbox" title="Marcar como conferido" id="check-${product.id}" data-id="${product.id}" ${isChecked ? 'checked' : ''}>
                        </div>
                    </td>
                </tr>
            `}).join('');
        }
    }

    function filterStockProducts() {
        const searchTerm = document.getElementById('stockSearchInput').value;
        let visibleProducts = showIgnoredInStock ? products : products.filter(p => !p.ignorarContagem);
        
        const fuseInstance = new Fuse(visibleProducts, { keys: ['nome'], threshold: 0.4 });
        const filtered = !searchTerm ? visibleProducts : fuseInstance.search(searchTerm).map(r => r.item);

        renderStockList(filtered);
    }

    function generateStockReport() {
        const reportPreview = document.getElementById('reportPreview');
        const visibleProducts = showIgnoredInStock ? products : products.filter(p => !p.ignorarContagem);
        const searchTerm = document.getElementById('stockSearchInput').value;
        
        const fuseInstance = new Fuse(visibleProducts, { keys: ['nome'], threshold: 0.4 });
        const filteredProducts = !searchTerm ? visibleProducts : fuseInstance.search(searchTerm).map(r => r.item);
        
        const today = new Date();
        const dateString = today.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        const timeString = today.toLocaleTimeString('pt-BR');

        let reportHTML = `
            <h3>Relatório de Estoque</h3>
            <p>Gerado em: ${dateString} às ${timeString}</p>
            <table>
                <thead>
                    <tr>
                        <th style="width: 50%;">Produto</th>
                        <th style="width: 30%;">Cores Disponíveis</th>
                        <th style="width: 20%; text-align: center;">Quantidade</th>
                    </tr>
                </thead>
                <tbody>
                    ${filteredProducts.map(p => {
                        const isChecked = checkedItems[p.id]?.checked || false;
                        const rowStyle = !isChecked ? 'style="color: red !important;"' : '';
                        const notCheckedIndicator = !isChecked ? ' <strong style="color: red !important;">(NÃO CONFERIDO)</strong>' : '';
                        return `
                            <tr ${rowStyle}>
                                <td>${escapeHtml(p.nome)}${notCheckedIndicator}</td>
                                <td>${(p.cores || []).map(c => c.nome).join(', ') || '-'}</td>
                                <td style="text-align: center;">${p.quantidade || 0}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
            <p style="text-align: left; font-size: 8pt; color: #555; margin-top: 15px;">* Itens em vermelho não foram marcados como conferidos.</p>
        `;
        reportPreview.innerHTML = reportHTML;
        
        document.body.classList.add('print-only-report');
        window.print();
    }

    function openColorPicker(productId) {
        currentEditingProductId = productId;
        const product = products.find(p => p.id === productId);
        if (!product) return;

        tempSelectedColors = [...(product.cores || [])];
        
        document.getElementById('colorPickerProductName').textContent = product.nome;
        renderColorPickerPalette();
        renderSelectedColors();

        document.getElementById('customColorNameInput').value = '';
        document.getElementById('customColorHexInput').value = '#CCCCCC';

        document.getElementById('colorPickerModalOverlay').classList.add('active');
    }

    function renderColorPickerPalette() {
        const paletteContainer = document.getElementById('colorPalette');
        paletteContainer.innerHTML = colorPalette.map(color => {
            const isSelected = tempSelectedColors.some(sc => sc.hex.toLowerCase() === color.hex.toLowerCase());
            return `<div class="color-swatch-lg ${isSelected ? 'selected' : ''}" style="background-color: ${color.hex}" data-hex="${color.hex}" data-nome="${color.nome}" title="${color.nome}"></div>`;
        }).join('');
    }

    function renderSelectedColors() {
        const selectedContainer = document.getElementById('selectedColors');
        if (tempSelectedColors.length === 0) {
            selectedContainer.innerHTML = '<p class="text-secondary small">Nenhuma cor selecionada.</p>';
        } else {
            selectedContainer.innerHTML = tempSelectedColors.map(color => `
                <div class="selected-color-tag">
                    <div class="color-swatch-sm" style="background-color: ${color.hex}"></div>
                    <span>${color.nome}</span>
                    <span class="remove-color-btn" data-hex="${color.hex}">&times;</span>
                </div>
            `).join('');
        }
    }

    function toggleColorSelection(hex, nome) {
        const index = tempSelectedColors.findIndex(c => c.hex.toLowerCase() === hex.toLowerCase());
        if (index > -1) {
            tempSelectedColors.splice(index, 1);
        } else {
            tempSelectedColors.push({ nome, hex });
        }
        renderColorPickerPalette();
        renderSelectedColors();
    }
    
    // --- LÓGICA DE FAVORITOS (APARELHO) ---
    function getAparelhoFavorites() { return JSON.parse(safeStorage.getItem(APARELHO_FAVORITES_KEY) || '{}'); }
    function saveAparelhoFavorites(favorites) { safeStorage.setItem(APARELHO_FAVORITES_KEY, JSON.stringify(favorites)); }
    function renderAparelhoFavorites() {
        const container = document.getElementById('aparelhoFavoritosContainer');
        if (!container) return;
        const favorites = getAparelhoFavorites();
        const favoriteNames = Object.keys(favorites);
        if (favoriteNames.length === 0) { container.innerHTML = ''; return; }
        container.innerHTML = favoriteNames.map(name => `
            <div class="favorito">
                <button class="favorito-btn" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>
                <span class="remove-favorito-btn" data-name="${escapeHtml(name)}">🗑️</span>
            </div>
        `).join('');
    }
    function applyAparelhoFavorite(name) {
        const favorites = getAparelhoFavorites();
        const favData = favorites[name];
        if (!favData) return;
        const product = products.find(p => p.nome === favData.productName);
        if (!product) { showCustomModal({ message: `Produto "${favData.productName}" não encontrado.` }); return; }
        
        handleProductSelectionForAparelho(product);
        document.getElementById('entradaAparelho').value = favData.entryValue || '';
        document.getElementById('valorExtraAparelho').value = favData.additionalValue || '';

        const toggleBtn = document.getElementById('toggleValorExtraBtn');
        const extraContainer = document.getElementById('valorExtraContainer');
        if (favData.additionalValue > 0) {
            toggleBtn.classList.add('is-active');
            extraContainer.classList.add('is-active');
        } else {
            toggleBtn.classList.remove('is-active');
            extraContainer.classList.remove('is-active');
        }
        calculateAparelho();
    }
    function removeAparelhoFavorite(name) {
        const favorites = getAparelhoFavorites();
        delete favorites[name];
        saveAparelhoFavorites(favorites);
        renderAparelhoFavorites();
    }

    // --- LÓGICA DE REGISTRO PWA ---
    function setupPWA() {
        const manifestData = document.getElementById('manifest-data').textContent;
        const manifestBlob = new Blob([manifestData], {type: 'application/json'});
        const manifestURL = URL.createObjectURL(manifestBlob);
        document.querySelector('link[rel="manifest"]').setAttribute('href', manifestURL);
        
        if ('serviceWorker' in navigator) {
            const swScript = document.getElementById('sw-script').textContent;
            const swBlob = new Blob([swScript], {type: 'text/javascript'});
            const swURL = URL.createObjectURL(swBlob);
            navigator.serviceWorker.register(swURL).then(reg => console.log('Service Worker registrado:', reg)).catch(err => console.log('Falha no registro do SW:', err));
        }
    }
    
    // --- LÓGICA DO FORMULÁRIO DE CONTRATO ---
    function formatCurrency(value) {
        return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function calculateContractPayments() {
        const total = parseFloat(document.getElementById('valorTotal').value) || 0;
        const entrada = parseFloat(document.getElementById('valorEntrada').value) || 0;
        const parcelas = parseInt(document.getElementById('numeroParcelas').value, 10) || 0;
        
        const saldo = total - entrada;
        document.getElementById('saldoRestante').value = saldo > 0 ? formatCurrency(saldo) : '0,00';
        
        if (parcelas > 0 && saldo > 0) {
            const valorParcela = saldo / parcelas;
            document.getElementById('valorParcela').value = formatCurrency(valorParcela);
        } else {
            document.getElementById('valorParcela').value = '0,00';
        }
    }

    function numeroPorExtenso(numero, tipo = 'normal') {
        const unidades = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
        const especiais = ["dez", "onze", "doze", "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
        const dezenas = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
        const centenas = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

        const converterGrupo = (n) => {
            if (n === 0) return "";
            if (n === 100) return "cem";
            if (n < 0) return "";

            let str = "";
            let c = Math.floor(n / 100);
            let d = Math.floor((n % 100) / 10);
            let u = n % 10;

            if (c > 0) {
                str += centenas[c];
                if (n % 100 !== 0) str += " e ";
            }

            if (d === 1) {
                str += especiais[u];
            } else {
                if (d > 1) {
                    str += dezenas[d];
                    if (u > 0) str += " e ";
                }
                if (u > 0) {
                    str += unidades[u];
                }
            }
            return str;
        };

        if (tipo === 'moeda') {
            const valor = parseFloat(numero) || 0;
            if (valor === 0) return "zero reais";
            const parteInteira = Math.floor(valor);
            const parteDecimal = Math.round((valor - parteInteira) * 100);

            let strInteira = "";
            if (parteInteira > 0) {
                const mil = Math.floor(parteInteira / 1000);
                const resto = parteInteira % 1000;

                if (mil > 0) {
                    strInteira += (mil === 1 ? "mil" : converterGrupo(mil) + " mil");
                    if (resto > 0) strInteira += (resto < 100 || resto % 100 === 0 ? " e " : " ");
                }
                if (resto > 0) {
                    strInteira += converterGrupo(resto);
                }
                strInteira += (parteInteira === 1 ? " real" : " reais");
            }
            
            let strDecimal = "";
            if (parteDecimal > 0) {
                strDecimal += converterGrupo(parteDecimal);
                strDecimal += (parteDecimal === 1 ? " centavo" : " centavos");
            }
            
            if (strInteira && strDecimal) return strInteira + " e " + strDecimal;
            return strInteira || strDecimal || "zero reais";
        } else {
             if (numero === 0) return "zero";
            return converterGrupo(numero);
        }
    }
    
    function saveContractDraft() {
        const draftStatus = document.getElementById('draftStatus');
        const formData = {};
        document.querySelectorAll('#contractForm input, #contractForm select').forEach(input => {
            if(input.id) {
                formData[input.id] = input.value;
            }
        });
        safeStorage.setItem(CONTRACT_DRAFT_KEY, JSON.stringify(formData));

        if (draftStatus) {
            draftStatus.textContent = 'Rascunho salvo!';
            clearTimeout(draftSaveTimeout);
            draftSaveTimeout = setTimeout(() => {
                draftStatus.textContent = '';
            }, 2000);
        }
    }

    function loadContractDraft() {
        const savedDraft = safeStorage.getItem(CONTRACT_DRAFT_KEY);
        if (savedDraft) {
            const formData = JSON.parse(savedDraft);
            for (const key in formData) {
                const input = document.getElementById(key);
                if (input) {
                    input.value = formData[key];
                }
            }
            calculateContractPayments();
             showCustomModal({ message: 'Rascunho anterior carregado.'});
        }
    }

    function clearContractDraft(clearStorage = true) {
        document.getElementById('contractForm').reset();
        calculateContractPayments();
        if(clearStorage) {
            safeStorage.removeItem(CONTRACT_DRAFT_KEY);
            showCustomModal({ message: 'Rascunho apagado.'});
        }
    }

    function populatePreview() {
        // PARTE INTOCÁVEL DO CONTRATO
        document.getElementById('contractPreview').innerHTML = `
            <h4>CONTRATO DE COMPRA E VENDA DE SMARTPHONE</h4>
            <p>Pelo presente instrumento particular, as partes a seguir identificadas firmam o presente CONTRATO DE COMPRA E VENDA, mediante as cláusulas e condições abaixo:</p>
            <div class="section-title" style="text-transform: none; text-align: left;">VENDEDOR</div>
            <p>Workcell Tecnologia LTDA – CNPJ nº 50.299.715/0001-65, com sede em Av. Goiás, n° 4118 - loja 05 posto - St. Crimeia Oeste, Goiânia - GO, 74563-220.</p>
            <div class="section-title" style="text-transform: none; text-align: left;">COMPRADOR</div>
            <p style="margin-bottom: 24pt;">
                Nome: <span id="previewNome"></span><br>
                CPF: <span id="previewCpf"></span> RG: <span id="previewRg"></span><br>
                Endereço: <span id="previewEndereco"></span>
            </p>
            <div class="section-title">CLÁUSULA 1 – DO OBJETO</div>
            <p>O presente contrato tem por objeto a venda do(s) smartphone(s) descrito(s) abaixo:</p>
            <p style="margin-bottom: 24pt;">
                Modelo: <span id="previewModelo"></span><br>
                IMEI(s): <span id="previewImei"></span><br>
                Valor total: R$ <span id="previewValorTotal"></span>
            </p>
            <div class="section-title">CLÁUSULA 2 – DO PAGAMENTO</div>
            <p>2.1 O valor total da compra é de R$ <span id="previewValorTotal2"></span> (<span id="previewValorExtenso"></span>), sendo pago da seguinte forma:</p>
            <p id="clausulaPagamentoB"></p>
            <p style="margin-bottom: 24pt;">
                2.2 O não pagamento de qualquer parcela na data de vencimento acarretará:<br>
                Multa de 2% (dois por cento) sobre o valor da parcela em atraso;<br>
                Juros de mora de 1% (um por cento) ao mês;<br>
                Correção monetária conforme índice legal aplicável.
            </p>
            <div class="section-title">CLÁUSULA 3 – DA PROPRIEDADE</div>
            <p>3.1 A propriedade do smartphone somente será transferida ao COMPRADOR após a quitação integral de todas as parcelas.</p>
            <p>3.2 Em caso de inadimplência, o COMPRADOR será notificado pelo VENDEDOR e terá o prazo de 5 (cinco) dias corridos para regularizar o pagamento.</p>
            <p style="margin-bottom: 24pt;">3.3 Caso não haja a regularização no prazo informado, o VENDEDOR poderá proceder ao bloqueio remoto do aparelho, impedindo seu uso até a quitação ou negociação da dívida, sem prejuízo da cobrança das parcelas vencidas e demais encargos previstos neste contrato.</p>
            <div class="section-title">CLÁUSULA 4 – DAS GARANTIAS</div>
            <p>4.1 O aparelho possui garantia legal de 1 (um) ano para qualquer defeito de fabricação pelo fabricante, contados a partir da entrega do produto.</p>
            <p style="margin-bottom: 24pt;">4.2 A garantia não cobre mau uso, quedas, molhar, oxidação ou violação do aparelho.</p>
            <div class="section-title">CLÁUSULA 5 – DA RESCISÃO</div>
            <p style="margin-bottom: 24pt;">5.1 O não cumprimento de qualquer obrigação contratual poderá resultar na rescisão imediata deste contrato, com a cobrança das parcelas vencidas e vincendas, além das penalidades cabíveis.</p>
            <div class="section-title">CLÁUSULA 6 – DO FORO</div>
            <p>As partes elegem o foro da comarca de Goiânia para dirimir quaisquer dúvidas oriundas deste contrato.</p>
            <p style="margin-top: 24pt;">E por estarem de acordo, firmam o presente contrato em 2 (duas) vias de igual teor.</p>
            <p style="margin-top: 40pt;">Local e data: <span id="previewLocalData"></span></p>
            <div style="text-align: center; margin-top: 40pt;">
                <div class="signature-line" style="margin-bottom: 5px;"></div>
                <p style="margin-bottom: 5pt; margin-top:0;">Assinatura VENDEDOR</p>
            </div>
            <div style="text-align: center; margin-top: 20pt;">
                <div class="signature-line" style="margin-bottom: 5px;"></div>
                <p style="margin-bottom: 5pt; margin-top:0;">Assinatura COMPRADOR</p>
            </div>
        `;
        
        // DADOS GERAIS
        document.getElementById('previewNome').textContent = document.getElementById('compradorNome').value;
        document.getElementById('previewCpf').textContent = document.getElementById('compradorCpf').value;
        document.getElementById('previewRg').textContent = document.getElementById('compradorRg').value;
        document.getElementById('previewEndereco').textContent = document.getElementById('compradorEndereco').value;
        document.getElementById('previewModelo').textContent = document.getElementById('produtoModelo').value;
        document.getElementById('previewImei').textContent = document.getElementById('produtoImei').value;

        const total = parseFloat(document.getElementById('valorTotal').value) || 0;
        document.getElementById('previewValorTotal').textContent = formatCurrency(total);
        document.getElementById('previewValorTotal2').textContent = formatCurrency(total);
        document.getElementById('previewValorExtenso').textContent = numeroPorExtenso(total, 'moeda');

        // LÓGICA DA CLÁUSULA DE PAGAMENTO (MODIFICÁVEL)
        const entrada = parseFloat(document.getElementById('valorEntrada').value) || 0;
        const numParcelas = parseInt(document.getElementById('numeroParcelas').value, 10) || 0;
        const tipoParcela = document.getElementById('tipoParcela').value; // 'mensais' ou 'semanais'
        const primeiroVencimento = document.getElementById('primeiroVencimento').value;
        const saldo = total - entrada;
        const valorParcela = numParcelas > 0 ? saldo / numParcelas : 0;
        
        let textoClausulaB = `a) Entrada no valor de R$ ${formatCurrency(entrada)}, paga no ato da assinatura deste contrato;<br>
                              b) O saldo restante de R$ ${formatCurrency(saldo)}, dividido em ${numeroPorExtenso(numParcelas)} (${numParcelas}) parcelas ${tipoParcela} de R$ ${formatCurrency(valorParcela)}, a serem pagas através de boleto bancário emitido pelo VENDEDOR`;

        if (primeiroVencimento) {
            const [ano, mes, dia] = primeiroVencimento.split('-');
            const dataFormatada = `${dia}/${mes}/${ano}`;
            textoClausulaB += `, com o primeiro vencimento em ${dataFormatada}.`;
        } else {
            textoClausulaB += '.';
        }

        document.getElementById('clausulaPagamentoB').innerHTML = textoClausulaB;
        
        // DATA DO CONTRATO
        const today = new Date();
        const dateOptions = { day: '2-digit', month: 'long', year: 'numeric' };
        document.getElementById('previewLocalData').textContent = `Goiânia, ${today.toLocaleDateString('pt-BR', dateOptions)}`;
    }
    
    // --- LÓGICA DE HISTÓRICO DE BOLETOS ---
    function loadBoletosHistory() {
        if (!db || !isAuthReady) return;
        const boletosRef = ref(db, 'boletos');
        const historyContainer = document.getElementById('historyBoletoContent');

        historyContainer.innerHTML = '<div class="text-center p-4"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Carregando...</span></div></div>';

        if (boletosListener) off(boletosRef, 'value', boletosListener);

        boletosListener = onValue(boletosRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                renderBoletosHistory(data);
            } else {
                historyContainer.innerHTML = `<div class="text-center p-5">
                    <i class="bi bi-journal-x" style="font-size: 4rem; color: var(--text-secondary);"></i>
                    <h5 class="mt-3">Nenhum formulário no histórico</h5>
                    <p class="text-secondary">Crie um novo formulário para vê-lo aqui.</p>
                </div>`;
            }
        }, (error) => {
            console.error("Firebase Read Error (Boletos):", error);
            historyContainer.innerHTML = `<div class="alert alert-danger">Erro ao carregar o histórico.</div>`;
        });
    }

    function renderBoletosHistory(data) {
        const historyContainer = document.getElementById('historyBoletoContent');
        const boletosArray = Object.keys(data).map(key => ({ id: key, ...data[key] }));
        
        // Sort by creation date, newest first
        boletosArray.sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));

        if (boletosArray.length === 0) {
             historyContainer.innerHTML = `<div class="text-center p-5">...</div>`;
             return;
        }

        historyContainer.innerHTML = `<div class="accordion w-100 history-accordion" id="boletosAccordion">${boletosArray.map(boleto => {
            const telefoneLimpo = boleto.compradorTelefone ? boleto.compradorTelefone.replace(/\D/g, '') : '';
            const whatsappLink = telefoneLimpo ? `https://wa.me/55${telefoneLimpo}` : '';
            const telefoneHtml = whatsappLink ? `<a href="${whatsappLink}" target="_blank" class="btn btn-sm btn-success"><i class="bi bi-whatsapp"></i> ${escapeHtml(boleto.compradorTelefone)}</a>` : '(Não informado)';
            
            return `
            <div class="accordion-item">
                <h2 class="accordion-header" id="heading-${boleto.id}">
                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-${boleto.id}" aria-expanded="false" aria-controls="collapse-${boleto.id}">
                       ${escapeHtml(boleto.compradorNome)} - ${new Date(boleto.criadoEm).toLocaleDateString('pt-BR')}
                    </button>
                </h2>
                <div id="collapse-${boleto.id}" class="accordion-collapse collapse" aria-labelledby="heading-${boleto.id}" data-bs-parent="#boletosAccordion">
                    <div class="accordion-body">
                        <p><strong>Comprador:</strong> ${escapeHtml(boleto.compradorNome)}<br>
                        <strong>CPF:</strong> ${escapeHtml(boleto.compradorCpf)}<br>
                        <strong>Telefone:</strong> ${telefoneHtml}</p>
                        <p><strong>Produto:</strong> ${escapeHtml(boleto.produtoModelo)}<br>
                        <strong>IMEI:</strong> ${escapeHtml(boleto.produtoImei)}</p>
                        <p><strong>Valor Total:</strong> R$ ${escapeHtml(boleto.valorTotal.toLocaleString('pt-BR', {minimumFractionDigits: 2}))}<br>
                        <strong>Entrada:</strong> R$ ${escapeHtml(boleto.valorEntrada.toLocaleString('pt-BR', {minimumFractionDigits: 2}))}<br>
                        <strong>Parcelas:</strong> ${boleto.numeroParcelas}x de R$ ${boleto.valorParcela}</p>
                        <hr style="border-color: var(--glass-border);">
                        <div class="text-end">
                            <button class="btn btn-sm btn-outline-danger delete-boleto-btn" data-id="${boleto.id}"><i class="bi bi-trash"></i> Excluir</button>
                        </div>
                    </div>
                </div>
            </div>`
        }).join('')}</div>`;

        // Add event listeners for delete buttons
        historyContainer.querySelectorAll('.delete-boleto-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const boletoId = e.currentTarget.dataset.id;
                showCustomModal({
                    message: "Tem certeza que deseja excluir este registro do histórico? Esta ação não pode ser desfeita.",
                    confirmText: "Sim, Excluir",
                    onConfirm: async () => {
                        try {
                            await remove(ref(db, `boletos/${boletoId}`));
                            showCustomModal({ message: "Registro excluído com sucesso." });
                        } catch (error) {
                            showCustomModal({ message: `Erro ao excluir: ${error.message}` });
                        }
                    },
                    onCancel: () => {}
                });
            });
        });
    }

    // --- LÓGICA DE NOTIFICAÇÕES ---
    function checkForDueInstallments() {
        if (!db || !isAuthReady) return;
        const boletosRef = ref(db, 'boletos');

        const todayStr = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"
        const viewedNotifsKey = `viewedNotifications_${todayStr}`;
        
        // Cleanup old notification keys from localStorage
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('viewedNotifications_') && key !== viewedNotifsKey) {
                safeStorage.removeItem(key);
            }
        });

        if (notificationsListener) off(boletosRef, 'value', notificationsListener);

        notificationsListener = onValue(boletosRef, (snapshot) => {
            const viewedNotifs = JSON.parse(safeStorage.getItem(viewedNotifsKey) || '[]');
            const notifications = [];
            if (snapshot.exists()) {
                const data = snapshot.val();
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                for (const key in data) {
                    const boleto = data[key];
                    const baseDate = boleto.primeiroVencimento ? new Date(boleto.primeiroVencimento + 'T00:00:00') : new Date(boleto.criadoEm);

                    for (let i = 0; i < boleto.numeroParcelas; i++) {
                        let dueDate;
                        if(boleto.primeiroVencimento) {
                             dueDate = new Date(baseDate);
                             if (boleto.tipoParcela === 'mensais') {
                                dueDate.setMonth(baseDate.getMonth() + i);
                            } else { // semanais
                                dueDate.setDate(baseDate.getDate() + (i * 7));
                            }
                        } else {
                             dueDate = new Date(baseDate);
                             if (boleto.tipoParcela === 'mensais') {
                                dueDate.setMonth(baseDate.getMonth() + i + 1);
                            } else { // semanais
                                dueDate.setDate(baseDate.getDate() + ((i + 1) * 7));
                            }
                        }
                        
                        dueDate.setHours(0, 0, 0, 0);

                        if (dueDate.getTime() === today.getTime()) {
                            const notificationId = `${key}_${i}`; // boletoId_parcelaIndex
                            if (!viewedNotifs.includes(notificationId)) {
                                 notifications.push({
                                    notificationId: notificationId,
                                    boletoId: key,
                                    message: `<strong>${escapeHtml(boleto.compradorNome)}:</strong> Parcela ${i + 1}/${boleto.numeroParcelas} vence hoje.`
                                });
                            }
                        }
                    }
                }
            }
            updateNotificationUI(notifications);
        });
    }

    function updateNotificationUI(notifications) {
        const badge = document.querySelector('#notification-bell .notification-badge');
        const notificationList = document.getElementById('notificationList');

        if (notifications.length > 0) {
            badge.textContent = notifications.length;
            badge.classList.remove('hidden');
            notificationList.innerHTML = notifications.map(notif => 
                `<a href="#" class="list-group-item list-group-item-action notification-item" data-boleto-id="${notif.boletoId}" data-notification-id="${notif.notificationId}">${notif.message}</a>`
            ).join('');
        } else {
            badge.classList.add('hidden');
            notificationList.innerHTML = '<div class="list-group-item text-center">Nenhuma notificação hoje.</div>';
        }
    }


    // --- FUNÇÃO PRINCIPAL E INICIALIZAÇÃO ---
    async function main() {
        try {
            setupPWA();
            applyTheme(safeStorage.getItem('theme') || 'dark');
            app = initializeApp(firebaseConfig); auth = getAuth(app); db = getDatabase(app);
            onAuthStateChanged(auth, async (user) => {
                if (user) { 
                    userId = user.uid; 
                    isAuthReady = true; 
                    loadRatesFromDB(); 
                    loadProductsFromDB();
                    checkForDueInstallments();

                    const loadingOverlay = document.getElementById('loadingOverlay');
                    loadingOverlay.style.opacity = '0';
                    setTimeout(() => {
                        loadingOverlay.style.display = 'none';
                        showMainSection('main');
                    }, 500);

                } 
                else await signInAnonymously(auth);
            });
        } catch (error) { console.error("Firebase Init Error:", error); document.body.innerHTML = `<h1>Erro ao conectar.</h1><p>${error.message}</p>`; }
    }
    
    // --- EVENT LISTENERS ---
    document.addEventListener('DOMContentLoaded', () => {
        // --- Notificações ---
        const notificationOffcanvasEl = document.getElementById('notificationPanel');
        const notificationOffcanvas = bootstrap.Offcanvas.getOrCreateInstance(notificationOffcanvasEl);
        document.getElementById('notification-bell').addEventListener('click', () => notificationOffcanvas.toggle());
        document.getElementById('notificationList').addEventListener('click', (e) => {
             const item = e.target.closest('.notification-item');
             if (item) {
                 e.preventDefault();
                 const boletoId = item.dataset.boletoId;
                 const notificationId = item.dataset.notificationId;

                 // Mark as viewed
                 const todayStr = new Date().toISOString().split('T')[0];
                 const viewedNotifsKey = `viewedNotifications_${todayStr}`;
                 let viewedNotifs = JSON.parse(safeStorage.getItem(viewedNotifsKey) || '[]');
                 if (!viewedNotifs.includes(notificationId)) {
                    viewedNotifs.push(notificationId);
                    safeStorage.setItem(viewedNotifsKey, JSON.stringify(viewedNotifs));
                 }

                 // Visually remove notification and update badge
                 item.remove();
                 const remainingItems = document.querySelectorAll('#notificationList .notification-item').length;
                 const badge = document.querySelector('#notification-bell .notification-badge');
                 if (remainingItems > 0) {
                    badge.textContent = remainingItems;
                 } else {
                    badge.classList.add('hidden');
                    document.getElementById('notificationList').innerHTML = '<div class="list-group-item text-center">Nenhuma notificação hoje.</div>';
                 }

                 // Navigate to history
                 showMainSection('contract');
                 
                 setTimeout(() => {
                    const toggle = document.getElementById('boletoModeToggle');
                    if (!toggle.checked) {
                        toggle.checked = true;
                        toggle.dispatchEvent(new Event('change'));
                    }
                    setTimeout(() => {
                        const accordionButton = document.querySelector(`#heading-${boletoId} button`);
                        if (accordionButton) {
                            const collapseEl = document.getElementById(accordionButton.getAttribute('data-bs-target').substring(1));
                            const bsCollapse = bootstrap.Collapse.getOrCreateInstance(collapseEl, { toggle: false });
                            bsCollapse.show();
                            
                            collapseEl.addEventListener('shown.bs.collapse', () => {
                                accordionButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, { once: true });
                        }
                    }, 300); 
                 }, 100);
                 
                 notificationOffcanvas.hide();
             }
        });
        
        // --- Tema ---
        const savedTheme = safeStorage.getItem('theme') || 'dark';
        applyTheme(savedTheme);
        themeToggleCheckbox.addEventListener('change', toggleTheme);


        // --- Nova Navegação ---
        document.getElementById('goToCalculator').addEventListener('click', () => showMainSection('calculator'));
        document.getElementById('goToContract').addEventListener('click', () => showMainSection('contract'));
        document.getElementById('goToStock').addEventListener('click', () => {
             showCustomModal({ 
                message: "Digite a senha para acessar o Estoque:", 
                showPassword: true,
                confirmText: "Acessar",
                onConfirm: (password) => {
                    if (password === "220390") {
                        showMainSection('stock');
                    } else {
                        showCustomModal({ message: "Senha incorreta." });
                    }
                }, 
                onCancel: () => {} 
            });
        });
        document.getElementById('goToAdmin').addEventListener('click', () => showMainSection('administracao'));
        document.getElementById('backFromContract').addEventListener('click', () => showMainSection('main'));
        document.getElementById('backFromStock').addEventListener('click', () => showMainSection('main'));
        document.getElementById('backFromAdmin').addEventListener('click', () => showMainSection('main'));
        document.getElementById('goToAdminFromEmptyState').addEventListener('click', () => showMainSection('administracao'));


        // --- Navegação da Calculadora ---
        ['openFecharVenda', 'openRepassarValores', 'openCalcularEmprestimo', 'openCalcularPorAparelho'].forEach(id => { document.getElementById(id).addEventListener('click', () => openCalculatorSection(id.replace('open', '').charAt(0).toLowerCase() + id.slice(5))); });
        ['backFromFecharVenda', 'backFromRepassarValores', 'backFromCalcularEmprestimo', 'backFromCalcularPorAparelho'].forEach(id => { document.getElementById(id).addEventListener('click', () => openCalculatorSection('calculatorHome')); });
        
        // --- Listeners da Calculadora (existentes) ---
        const installmentsSlider = document.getElementById('installments1');
        const installmentsValueDisplay = document.getElementById('installments1Value');
        installmentsSlider.addEventListener('input', () => {
            const value = installmentsSlider.value;
            installmentsValueDisplay.textContent = (value === '0') ? 'Débito' : `${value}x`;
            updateFecharVendaUI();
        });

        document.getElementById('machine1').addEventListener('change', () => { updateInstallmentsOptions(); updateFecharVendaUI(); if(document.getElementById('machine1').value !== 'pagbank') openFlagModal(document.getElementById('machine1')); });
        document.getElementById('brand1').addEventListener('change', updateFecharVendaUI);
        document.getElementById('vendaModeToggle').addEventListener('change', updateFecharVendaUI); 
        document.querySelectorAll('input[name="manualMode"]').forEach(radio => radio.addEventListener('change', updateFecharVendaUI));
        document.getElementById('vendaProdutoSearch').addEventListener('input', () => displayDynamicSearchResults(document.getElementById('vendaProdutoSearch').value, 'vendaSearchResultsContainer', handleProductSelectionForVenda));
        document.getElementById('fecharVendaValue').addEventListener('input', calculateFecharVenda);
        document.getElementById('resultFecharVenda').addEventListener('change', e => { if (e.target && e.target.id === 'descontarFoneCheckbox') calculateFecharVenda(); });
        document.getElementById('entradaAVistaCheckbox').addEventListener('change', toggleEntradaAVistaUI);
        document.getElementById('valorEntradaAVista').addEventListener('input', calculateFecharVenda);
        document.getElementById('valorPassadoNoCartao').addEventListener('input', calculateFecharVenda);
        
        document.getElementById('aparelhoSearch').addEventListener('input', () => displayDynamicSearchResults(document.getElementById('aparelhoSearch').value, 'aparelhoResultsContainer', handleProductSelectionForAparelho));
        document.getElementById('entradaAparelho').addEventListener('input', calculateAparelho);
        document.getElementById('valorExtraAparelho').addEventListener('input', calculateAparelho);
        document.getElementById('toggleValorExtraBtn').addEventListener('click', (e) => {
            const btn = e.currentTarget;
            const container = document.getElementById('valorExtraContainer');
            btn.classList.toggle('is-active');
            container.classList.toggle('is-active');
        });
        document.getElementById('machine3').addEventListener('change', () => { updateCalcularPorAparelhoUI(); if(document.getElementById('machine3').value !== 'pagbank') openFlagModal(document.getElementById('machine3')); });
        document.getElementById('brand3').addEventListener('change', updateCalcularPorAparelhoUI);
        
        document.getElementById('aparelhoFavoritosContainer').addEventListener('click', e => {
            const favoriteBtn = e.target.closest('.favorito-btn');
            const removeBtn = e.target.closest('.remove-favorito-btn');
            if (favoriteBtn) {
                applyAparelhoFavorite(favoriteBtn.dataset.name);
            } else if (removeBtn) {
                removeAparelhoFavorite(removeBtn.dataset.name);
            }
        });

        const favoriteNameModal = document.getElementById('favoriteNameModalOverlay');
        const favoriteNameInput = document.getElementById('favoriteNameInput');
        const confirmSaveFavoriteBtn = document.getElementById('confirmSaveFavoriteBtn');
        const cancelSaveFavoriteBtn = document.getElementById('cancelSaveFavoriteBtn');
        const closeFavoriteNameModal = () => favoriteNameModal.classList.remove('active');

        document.getElementById('saveAparelhoFavoriteBtn').addEventListener('click', () => {
            const favorites = getAparelhoFavorites();
            if (Object.keys(favorites).length >= MAX_FAVORITES) {
                showCustomModal({ message: `Você já tem ${MAX_FAVORITES} favoritos. Remova um para salvar outro.` });
                return;
            }
            favoriteNameInput.value = '';
            favoriteNameModal.classList.add('active');
            favoriteNameInput.focus();
        });

        confirmSaveFavoriteBtn.addEventListener('click', () => {
            const favoriteName = favoriteNameInput.value.trim();
            const favorites = getAparelhoFavorites();
            if (!favoriteName) {
                showCustomModal({ message: "Por favor, digite um nome para o favorito." });
                return;
            }
            if (favorites[favoriteName]) {
                showCustomModal({ message: "Já existe um favorito com este nome." });
                return;
            }
            const favoriteData = {
                productName: document.getElementById('aparelhoSearch').value,
                entryValue: parseFloat(document.getElementById('entradaAparelho').value) || 0,
                additionalValue: parseFloat(document.getElementById('valorExtraAparelho').value) || 0
            };
            favorites[favoriteName] = favoriteData;
            saveAparelhoFavorites(favorites);
            renderAparelhoFavorites();
            closeFavoriteNameModal();
        });

        cancelSaveFavoriteBtn.addEventListener('click', closeFavoriteNameModal);
        favoriteNameModal.addEventListener('click', (e) => { if (e.target === favoriteNameModal) closeFavoriteNameModal(); });

        document.getElementById('machine2').addEventListener('change', () => { updateRepassarValoresUI(); if(document.getElementById('machine2').value !== 'pagbank') openFlagModal(document.getElementById('machine2')); });
        document.getElementById('brand2').addEventListener('change', updateRepassarValoresUI);
        document.getElementById('repassarValue').addEventListener('input', calculateRepassarValores);
        
        document.getElementById('emprestimoValue').addEventListener('input', calculateEmprestimo);
        document.getElementById('machine4').addEventListener('change', () => { updateCalcularEmprestimoUI(); if(document.getElementById('machine4').value !== 'pagbank') openFlagModal(document.getElementById('machine4')); });
        document.getElementById('brand4').addEventListener('change', updateCalcularEmprestimoUI);
        
        const lucroModalOverlay = document.getElementById('lucroModalOverlay');
        const lucroPercentInput = document.getElementById('lucroPercentInput');
        const closeLucroModal = () => lucroModalOverlay.classList.remove('active');

        document.getElementById('openLucroModalBtn').addEventListener('click', () => {
            lucroPercentInput.value = emprestimoLucroPercentual;
            lucroModalOverlay.classList.add('active');
            lucroPercentInput.focus();
        });
        
        document.getElementById('saveLucroBtn').addEventListener('click', () => {
            const newPercent = parseFloat(lucroPercentInput.value);
            if (!isNaN(newPercent) && newPercent >= 0) {
                emprestimoLucroPercentual = newPercent;
                calculateEmprestimo();
                closeLucroModal();
            } else {
                showCustomModal({ message: 'Por favor, insira um valor de lucro válido.' });
            }
        });

        document.getElementById('cancelLucroBtn').addEventListener('click', closeLucroModal);
        lucroModalOverlay.addEventListener('click', (e) => { if (e.target === lucroModalOverlay) closeLucroModal(); });


        document.getElementById('adminSearchInput').addEventListener('input', filterAdminProducts);
        
        document.getElementById('addProductForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const nome = document.getElementById('newProductName').value.trim();
            const valorStr = document.getElementById('newProductValue').value;
            const quantidade = parseInt(document.getElementById('newProductQuantity').value) || 1;
            const coresStr = document.getElementById('newProductColors').value.trim();

            if (!nome || !valorStr) {
                showCustomModal({ message: "Nome e Valor são obrigatórios." });
                return;
            }

            const valor = parseBrazilianCurrencyToFloat(valorStr);
            if (isNaN(valor)) {
                 showCustomModal({ message: "Valor inválido." });
                 return;
            }
            
            const cores = coresStr.split(',')
                .map(nomeCor => nomeCor.trim())
                .filter(Boolean)
                .map(nomeCor => {
                    const paletaCor = colorPalette.find(p => p.nome.toLowerCase() === nomeCor.toLowerCase());
                    return paletaCor || { nome: nomeCor, hex: '#cccccc' };
                });

            const newProduct = { nome, valor, quantidade, cores, ignorarContagem: false };

            try {
                await push(getProductsRef(), newProduct);
                showCustomModal({ message: `Produto "${nome}" adicionado com sucesso!`});
                e.target.reset();
            } catch (error) {
                showCustomModal({ message: `Erro ao adicionar produto: ${error.message}` });
            }
        });

        document.getElementById('deleteAllProductsBtn').addEventListener('click', deleteAllProducts);
        
        const productsTableBody = document.getElementById('productsTableBody');
        productsTableBody.addEventListener('click', e => {
            const deleteBtn = e.target.closest('.delete-product-btn');
            
            if (deleteBtn) {
                e.preventDefault();
                const id = deleteBtn.dataset.id;
                showCustomModal({ message: "Excluir este produto?", onConfirm: async () => await remove(ref(db, `products/${id}`)), onCancel: () => {} });
                return;
            }

            const toggleBtn = e.target.closest('.btn-toggle-menu');
            if (toggleBtn) {
                e.preventDefault();
                const separatorRow = toggleBtn.closest('.product-separator-row');
                const dataRow = separatorRow.previousElementSibling;
                const actionRow = separatorRow.nextElementSibling;
                const wasActive = separatorRow.classList.contains('is-active');

                productsTableBody.querySelectorAll('.is-active').forEach(el => el.classList.remove('is-active'));

                if (!wasActive) {
                    dataRow.classList.add('is-active');
                    separatorRow.classList.add('is-active');
                    actionRow.classList.add('is-active');
                }
            }
        });

        productsTableBody.addEventListener('change', e => {
            if (e.target.matches('input.form-control')) {
                const dataRow = e.target.closest('.product-data-row');
                if (dataRow) {
                    const { field } = e.target.dataset;
                    const id = dataRow.dataset.id;
                    let value;
                    if (field === 'valor') {
                        value = parseBrazilianCurrencyToFloat(e.target.value);
                    } else if (field === 'quantidade') {
                        value = parseInt(e.target.value, 10);
                        if (isNaN(value) || value < 0) value = 0;
                    } else {
                        value = e.target.value;
                    }

                    if (id && field && value !== undefined) {
                        updateProductInDB(id, { [field]: value });
                    }
                }
            }
            if (e.target.matches('.ignore-toggle-switch-admin')) {
                 const id = e.target.dataset.id;
                 const isChecked = e.target.checked;
                 updateProductInDB(id, { ignorarContagem: isChecked });
            }
        });
        
        document.getElementById('adminModeToggle').addEventListener('change', (e) => {
            const showRates = e.target.checked;
            document.getElementById('adminProductsContent').style.display = showRates ? 'none' : 'block';
            document.getElementById('adminRatesContent').style.display = showRates ? 'block' : 'none';
            if (showRates) renderRatesEditor();
        });
        document.getElementById('saveRatesBtn').addEventListener('click', saveRates);

        const flagModalOverlay = document.getElementById('flagSelectorModalOverlay');
        document.getElementById('closeFlagModalBtn').addEventListener('click', closeFlagModal);
        flagModalOverlay.addEventListener('click', (e) => { if (e.target === flagModalOverlay) closeFlagModal(); });
        ['flagDisplayButton1', 'flagDisplayButton2', 'flagDisplayButton3', 'flagDisplayButton4'].forEach(id => { document.getElementById(id).addEventListener('click', (e) => { const sectionNumber = id.replace('flagDisplayButton', ''); openFlagModal(document.getElementById(`machine${sectionNumber}`)); }); });
        document.addEventListener('click', (e) => { document.querySelectorAll('.search-wrapper').forEach(wrapper => { if (!wrapper.contains(e.target)) { const resultsContainer = wrapper.querySelector('.search-results-container'); if (resultsContainer) resultsContainer.innerHTML = ''; } }); });
        
        // --- Listeners de Estoque ---
        document.getElementById('stockSearchInput').addEventListener('input', filterStockProducts);
        document.getElementById('generateReportBtn').addEventListener('click', generateStockReport);
        document.getElementById('toggleIgnoredBtn').addEventListener('click', (e) => {
            showIgnoredInStock = !showIgnoredInStock;
            const btn = e.currentTarget;
            const icon = btn.querySelector('i');
            if (showIgnoredInStock) {
                btn.title = "Ocultar ignorados";
                icon.className = 'bi bi-eye';
                btn.classList.add('active');
            } else {
                btn.title = "Mostrar ignorados";
                icon.className = 'bi bi-eye-slash';
                btn.classList.remove('active');
            }
            filterStockProducts();
        });
        document.getElementById('resetCountBtn').addEventListener('click', () => {
             showCustomModal({ 
                message: "Tem certeza que deseja resetar o status de todos os itens para 'não conferido'?", 
                confirmText: "Sim, Resetar",
                onConfirm: () => {
                    checkedItems = {};
                    saveCheckedItems();
                    filterStockProducts();
                }, 
                onCancel: () => {} 
            });
        });

        const stockTableBody = document.getElementById('stockTableBody');
        const handleStockUpdate = (inputElement) => {
            const row = inputElement.closest('tr');
            if (!row) return;
            const id = row.dataset.id;
            const product = products.find(p => p.id === id);
            if (!product) return;
            
            const oldValue = product.quantidade || 0;
            let newValue = parseInt(inputElement.value, 10);
            if (isNaN(newValue) || newValue < 0) {
                newValue = 0;
                inputElement.value = 0;
            }

            if (oldValue !== newValue) {
                updateProductInDB(id, { quantidade: newValue });
                modificationTracker[id] = { ...modificationTracker[id], quantity: true };
            }
        };

        if(stockTableBody) {
             stockTableBody.addEventListener('change', e => {
                if (e.target.classList.contains('stock-qty-input')) {
                    handleStockUpdate(e.target);
                }
                if (e.target.classList.contains('ignore-toggle-switch-stock')) {
                    const id = e.target.dataset.id;
                    const isChecked = e.target.checked;
                    updateProductInDB(id, { ignorarContagem: isChecked }).then(() => {
                         setTimeout(filterStockProducts, 150); 
                    });
                }
                if (e.target.classList.contains('stock-checked-toggle')) {
                    const id = e.target.dataset.id;
                    const isChecked = e.target.checked;
                    
                    if (isChecked) {
                        const timestamp = Date.now();
                        checkedItems[id] = { checked: true, timestamp: timestamp };
                        updateProductInDB(id, { lastCheckedTimestamp: timestamp });
                    } else {
                        delete checkedItems[id];
                        updateProductInDB(id, { lastCheckedTimestamp: null });
                    }
                    saveCheckedItems();
                    delete modificationTracker[id]; 
                    filterStockProducts(); 
                }
            });
            stockTableBody.addEventListener('click', e => {
                const qtyButton = e.target.closest('.stock-qty-btn');
                const colorButton = e.target.closest('.open-color-picker-btn');

                if (qtyButton) {
                    const change = parseInt(qtyButton.dataset.change, 10);
                    const input = qtyButton.parentElement.querySelector('.stock-qty-input');
                    if(!input) return;
                    let currentValue = parseInt(input.value, 10);
                    if (isNaN(currentValue)) currentValue = 0;
                    const newValue = Math.max(0, currentValue + change);
                    input.value = newValue;
                    handleStockUpdate(input);
                }

                if (colorButton) {
                    const id = colorButton.dataset.id;
                    openColorPicker(id);
                }
            });
        }
        
        // --- Listeners do Seletor de Cores ---
        const colorPickerModal = document.getElementById('colorPickerModalOverlay');
        document.getElementById('colorPalette').addEventListener('click', e => {
            const swatch = e.target.closest('.color-swatch-lg');
            if (swatch) {
                toggleColorSelection(swatch.dataset.hex, swatch.dataset.nome);
            }
        });
        document.getElementById('selectedColors').addEventListener('click', e => {
             const removeBtn = e.target.closest('.remove-color-btn');
             if(removeBtn) {
                 toggleColorSelection(removeBtn.dataset.hex);
             }
        });
        document.getElementById('addCustomColorBtn').addEventListener('click', () => {
            const nameInput = document.getElementById('customColorNameInput');
            const hexInput = document.getElementById('customColorHexInput');
            const nome = nameInput.value.trim();
            const hex = hexInput.value;
            if (nome) {
                toggleColorSelection(hex, nome);
                nameInput.value = '';
            } else {
                showCustomModal({message: "Por favor, digite um nome para a cor personalizada."});
            }
        });
        document.getElementById('cancelColorPicker').addEventListener('click', () => colorPickerModal.classList.remove('active'));
        document.getElementById('saveColorPicker').addEventListener('click', () => {
            if (currentEditingProductId) {
                const product = products.find(p => p.id === currentEditingProductId);
                
                updateProductInDB(currentEditingProductId, { cores: tempSelectedColors });
                modificationTracker[currentEditingProductId] = { ...modificationTracker[currentEditingProductId], color: true };

                if (modificationTracker[currentEditingProductId]?.quantity) {
                    const timestamp = Date.now();
                    checkedItems[currentEditingProductId] = { checked: true, timestamp: timestamp };
                    saveCheckedItems();
                    updateProductInDB(currentEditingProductId, { lastCheckedTimestamp: timestamp });
                    delete modificationTracker[currentEditingProductId];
                    filterStockProducts();
                }
            }
            colorPickerModal.classList.remove('active');
        });

        // --- Listeners do Formulário de Contrato ---
        document.getElementById('boletoModeToggle').addEventListener('change', (e) => {
            const showHistory = e.target.checked;
            document.getElementById('newBoletoContent').classList.toggle('hidden', showHistory);
            document.getElementById('historyBoletoContent').classList.toggle('hidden', !showHistory);
            if (showHistory) {
                loadBoletosHistory();
            }
        });

        document.getElementById('contractForm').addEventListener('input', () => {
             calculateContractPayments();
             saveContractDraft();
        });
        document.getElementById('btnLimparCampos').addEventListener('click', () => clearContractDraft(true));
        document.getElementById('btnApagarRascunho').addEventListener('click', () => {
            safeStorage.removeItem(CONTRACT_DRAFT_KEY);
            showCustomModal({ message: 'Rascunho apagado.' });
        });
        
        document.getElementById('btnImprimir').addEventListener('click', () => {
            const contractForm = document.getElementById('contractForm');
            if (!contractForm.checkValidity()) {
                showCustomModal({ message: "Por favor, preencha todos os campos obrigatórios." });
                contractForm.reportValidity();
                return;
            }

            const boletosRef = ref(db, 'boletos');
            const boletoData = {
                compradorNome: document.getElementById('compradorNome').value,
                compradorCpf: document.getElementById('compradorCpf').value,
                compradorRg: document.getElementById('compradorRg').value,
                compradorTelefone: document.getElementById('compradorTelefone').value,
                compradorEndereco: document.getElementById('compradorEndereco').value,
                produtoModelo: document.getElementById('produtoModelo').value,
                produtoImei: document.getElementById('produtoImei').value,
                valorTotal: parseFloat(document.getElementById('valorTotal').value) || 0,
                valorEntrada: parseFloat(document.getElementById('valorEntrada').value) || 0,
                saldoRestante: document.getElementById('saldoRestante').value,
                numeroParcelas: parseInt(document.getElementById('numeroParcelas').value, 10) || 0,
                valorParcela: document.getElementById('valorParcela').value,
                tipoParcela: document.getElementById('tipoParcela').value,
                primeiroVencimento: document.getElementById('primeiroVencimento').value,
                criadoEm: new Date().toISOString()
            };

            push(boletosRef, boletoData)
                .then(() => {
                    showCustomModal({ message: 'Contrato salvo no banco de dados!' });
                    // Após salvar, continua com a impressão
                    populatePreview();
                    document.body.classList.add('print-only-contract');
                    window.print();
                })
                .catch((error) => {
                    console.error("Erro ao salvar contrato: ", error);
                    showCustomModal({ message: `Falha ao salvar o contrato: ${error.message}` });
                });
        });

        // --- Event Listeners for Export Buttons ---
        document.getElementById('exportRepassarBtn').addEventListener('click', () => {
            exportResultsToImage('resultRepassarValores', 'repassar-valores.png');
        });

        document.getElementById('exportEmprestimoBtn').addEventListener('click', () => {
            const valorBase = parseFloat(document.getElementById('emprestimoValue').value) || 0;
            if (valorBase <= 0) {
                showCustomModal({ message: "Insira um valor base para exportar." });
                return;
            }
            const header = `<h4 class="text-center mb-3" style="width: 100%; grid-column: 1 / -1;">Você Recebe na Hora: ${valorBase.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</h4>`;
            exportResultsToImage('resultCalcularEmprestimo', 'calculo-emprestimo.png', header);
        });

        document.getElementById('exportAparelhoBtn').addEventListener('click', () => {
            const aparelhoNome = document.getElementById('aparelhoSearch').value.trim();
            if (!aparelhoNome) {
                showCustomModal({ message: "Selecione um aparelho para exportar." });
                return;
            }
            const header = `<h4 class="text-center mb-3" style="width: 100%; grid-column: 1 / -1;">${escapeHtml(aparelhoNome)}</h4>`;
            const fileName = aparelhoNome.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'calculo-aparelho';
            exportResultsToImage('resultCalcularPorAparelho', `${fileName}.png`, header);
        });
        
        window.addEventListener('afterprint', () => {
            document.body.classList.remove('print-only-contract', 'print-only-report');
        });

        main();
        
        // Intercepta botão voltar do Android
        document.addEventListener('backbutton', function (e) {
          e.preventDefault();
          const currentSection = document.querySelector('.container:not(.hidden):not([style*="display: none"])');
          if (currentSection && currentSection.id !== 'mainMenu' && currentSection.id !== 'calculatorHome') {
             // Se estiver em uma sub-seção da calculadora ou no estoque/contrato, volta para o menu principal
            showMainSection('main');
          } else if (currentSection && currentSection.id === 'calculatorHome') {
            showMainSection('main');
          }
          else {
            // se já está no menu principal, fecha o app normalmente
            if(navigator.app){
                navigator.app.exitApp();
            }
          }
        }, false);

        // Suporte para navegadores (popstate do histórico)
        window.addEventListener('popstate', function () {
            const currentSection = document.querySelector('.container:not(.hidden):not([style*="display: none"])');
            if (currentSection && currentSection.id !== 'mainMenu') {
                showMainSection('main');
                history.pushState(null, null, location.href);
            }
        });

        // Garante que sempre tenha um histórico inicial
        history.pushState(null, null, location.href);

    });
/* original script attrs:  */

document.addEventListener('DOMContentLoaded', () => {
        const DISABLED_MACHINES_KEY = 'disabledMachines';

        // Função para obter a lista de maquininhas desativadas do localStorage
        function getDisabledMachines() {
            try {
                const disabled = localStorage.getItem(DISABLED_MACHINES_KEY);
                return disabled ? JSON.parse(disabled) : [];
            } catch (e) {
                console.error('Erro ao ler as maquininhas desativadas do localStorage:', e);
                return [];
            }
        }

        // Função para salvar a lista de maquininhas desativadas
        function saveDisabledMachines(disabled) {
            try {
                localStorage.setItem(DISABLED_MACHINES_KEY, JSON.stringify(disabled));
            } catch (e) {
                console.error('Erro ao salvar as maquininhas desativadas no localStorage:', e);
            }
        }

        // Função para atualizar a visibilidade das opções nos selects
        function updateMachineVisibility() {
            const disabledMachines = getDisabledMachines();
            const selects = document.querySelectorAll('#machine1, #machine2, #machine3, #machine4');

            selects.forEach(select => {
                let isSelectedOptionHidden = false;
                for (const option of select.options) {
                    const machineValue = option.value;
                    const shouldBeHidden = disabledMachines.includes(machineValue);
                    option.hidden = shouldBeHidden;

                    if (option.selected && shouldBeHidden) {
                        isSelectedOptionHidden = true;
                    }
                }
                
                // Se a opção selecionada foi ocultada, seleciona a primeira visível
                if (isSelectedOptionHidden) {
                    const firstVisibleOption = select.querySelector('option:not([hidden])');
                    if (firstVisibleOption) {
                        select.value = firstVisibleOption.value;
                        // Dispara o evento change para que a UI se atualize conforme a nova seleção
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
            });
        }

        // Função para configurar os switches de visibilidade
        function setupVisibilityToggles() {
            const toggles = document.querySelectorAll('.visibility-toggle');

            toggles.forEach(toggle => {
                const machineName = toggle.dataset.machine;
                const disabledMachines = getDisabledMachines();
                // O switch está checado se a maquininha NÃO ESTIVER na lista de desativadas
                toggle.checked = !disabledMachines.includes(machineName);

                toggle.addEventListener('change', () => {
                    const currentDisabled = getDisabledMachines();
                    if (toggle.checked) {
                        // Se checado, remove da lista de desativadas
                        const newDisabled = currentDisabled.filter(m => m !== machineName);
                        saveDisabledMachines(newDisabled);
                    } else {
                        // Se não checado, adiciona à lista de desativadas (se já não estiver)
                        if (!currentDisabled.includes(machineName)) {
                            currentDisabled.push(machineName);
                            saveDisabledMachines(currentDisabled);
                        }
                    }
                    // Aplica a mudança de visibilidade imediatamente
                    updateMachineVisibility();
                });
            });
        }

        // Execução inicial
        setupVisibilityToggles();
        updateMachineVisibility();
    });
