import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { getDatabase, ref, push, update, remove, onValue, off, get, set } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyANdJzvmHr8JVqrjveXbP_ZV6ZRR6fcVQk",
    authDomain: "ctwbybrendon.firebaseapp.com",
    databaseURL: "https://ctwbybrendon-default-rtdb.firebaseio.com",
    projectId: "ctwbybrendon",
    storageBucket: "ctwbybrendon.firebasestorage.app",
    messagingSenderId: "37459949616",
    appId: "1:37459949616:web:bf2e722a491f45880a55f5"
};

// Adicione junto com as outras variáveis globais (perto de userId, products, etc.)
let currentEditingBookipId = null; // Guarda o ID se estiver editando

let app, db, auth, userId = null, isAuthReady = false, areRatesLoaded = false;
let products = [], fuse, selectedAparelhoValue = 0, fecharVendaPrecoBase = 0;
let activeTagFilter = null; // Guarda a etiqueta selecionada (ex: 'Xiaomi')
// --- CORREÇÃO: ADICIONE ESTA LINHA ---
let bookipCartList = []; 
// --- CORREÇÃO: ADICIONE ESTA LINHA ---
let bookipListener = null; 

// ADICIONE ESTA LINHA NOVA:
let editingItemIndex = null; // Controla qual item está sendo editado (null = nenhum)



// Adicione esta variável global
let receiptSettings = {
    header: "WORKCELL TECNOLOGIA\nCNPJ: 00.000.000/0001-00", 
    terms: "Garantia legal de 90 dias." 
};

let currentCalculatorSectionId = 'calculatorHome', productsListener = null, rates = {};
let boletosListener = null;
let installmentNotificationsListener = null;
let generalNotificationsListener = null;
let currentMainSectionId = 'main';
let emprestimoLucroPercentual = 15;
let onlyShowIgnored = false;
let checkedItems = {};
let modificationTracker = {};
let tagTexts = {};
let tags = [];
let tagsListener = null;
let currentlySelectedProductForCalc = null;
let aparelhoQuantity = 1;
let carrinhoDeAparelhos = [];

// Função para trocar visualmente entre Produto e Situação
window.alternarModoInput = function() {
    const tipo = document.querySelector('input[name="tipoInput"]:checked').value;
    const divProd = document.getElementById('camposProduto');
    const divSit = document.getElementById('camposSituacao');
    
    if (tipo === 'situacao') {
        divProd.style.display = 'none';
        divSit.style.display = 'block';
    } else {
        divProd.style.display = 'block';
        divSit.style.display = 'none';
    }
};



// ============================================================
// ============================================================
// SISTEMA DE CONTROLE DE TELA (RECIBO vs GARANTIA) - FINAL
// ============================================================

// FUNÇÃO BLINDADA: ABRIR NOVO RECIBO
window.abrirReciboSimples = function() {
    console.log("Abrindo Recibo Simples...");

    // 1. Configura Variáveis Globais
    window.isSimpleReceiptMode = true;
    window.currentEditingBookipId = null; 
    
    // 2. Chama a Faxina (Limpa campos e zera produtos)
    if(typeof window.resetFormulariosBookip === 'function') {
        window.resetFormulariosBookip();
    }

    // 3. Configura Títulos
    const titulo = document.querySelector('#areaBookipWrapper h3');
    if (titulo) titulo.innerText = "Novo Recibo (Simples)";

    const txtNovo = document.getElementById('txtToggleNovo');
    if (txtNovo) txtNovo.innerHTML = '<i class="bi bi-plus-lg"></i> Novo Recibo';

    // 4. Configura Interface (Esconde busca, mostra toggle)
    const toggle = document.getElementById('toggleModoInputContainer');
    if (toggle) toggle.style.display = 'flex'; 

    const buscaContainer = document.querySelector('#camposProduto .search-wrapper');
    if (buscaContainer) buscaContainer.classList.add('hidden'); 

    // 5. Troca a Tela (Esconde menus, mostra Bookip)
    const menus = document.querySelectorAll('#mainMenu, #documentsHome, .section-content');
    menus.forEach(m => m.style.display = 'none');
    
    const tela = document.getElementById('areaBookipWrapper');
    if (tela) tela.style.display = 'block';
    
    // Garante aba "Novo" ativa visualmente
    const tabToggle = document.getElementById('bookipModeToggle');
    if(tabToggle) {
        tabToggle.checked = false; 
        tabToggle.dispatchEvent(new Event('change'));
    }
};

// 2. CORREÇÃO AUTOMÁTICA DO BOTÃO "GARANTIA"
/// CONFIGURAÇÃO DOS BOTÕES AO CARREGAR A PÁGINA
document.addEventListener('DOMContentLoaded', () => {
    
    // --- BOTÃO GARANTIA (Lógica Blindada) ---
    const btnGarantia = document.getElementById('openBookipView');
    if (btnGarantia) {
        btnGarantia.addEventListener('click', () => {
            console.log("Abrindo Garantia...");
            
            // 1. Reset de Variáveis
            window.isSimpleReceiptMode = false;
            window.currentEditingBookipId = null; 
            
            // 2. Chama a Faxina
            if(typeof window.resetFormulariosBookip === 'function') {
                window.resetFormulariosBookip();
            }

            // 3. Configura Títulos
            const titulo = document.querySelector('#areaBookipWrapper h3');
            if (titulo) titulo.innerText = "Garantia (Bookip)";

            const txtNovo = document.getElementById('txtToggleNovo');
            if (txtNovo) txtNovo.innerHTML = '<i class="bi bi-plus-lg"></i> Nova Garantia';

            // 4. Configura Interface (Garantia precisa da busca e NÃO tem toggle)
            const toggle = document.getElementById('toggleModoInputContainer');
            if (toggle) toggle.style.display = 'none'; 
            
            if(typeof alternarModoInput === 'function') alternarModoInput('produto'); 

            const buscaContainer = document.querySelector('#camposProduto .search-wrapper');
            if (buscaContainer) buscaContainer.classList.remove('hidden'); 

            // 5. Abre a Tela
            // (Usando o método manual para garantir)
            const menus = document.querySelectorAll('#mainMenu, #documentsHome, .section-content');
            menus.forEach(m => m.style.display = 'none');
            
            const tela = document.getElementById('areaBookipWrapper');
            if (tela) tela.style.display = 'block';
            
            const tabToggle = document.getElementById('bookipModeToggle');
            if(tabToggle) {
                tabToggle.checked = false;
                tabToggle.dispatchEvent(new Event('change'));
            }
            
            if(typeof loadBookipHistory === 'function') loadBookipHistory();
        });
    }

    // (Se houver outros listeners aqui dentro, mantenha-os abaixo, mas cuidado para não apagar o '});' final)
});





const APARELHO_FAVORITES_KEY = 'ctwAparelhoFavoritos';
const CHECKED_ITEMS_KEY = 'ctwCheckedItems';
const MAX_FAVORITES = 5;
const CONTRACT_DRAFT_KEY = 'ctwContractDraft';
const TAG_TEXTS_KEY = 'ctwTagTexts';
let draftSaveTimeout;

const safeStorage = {
    getItem(key) { try { return localStorage.getItem(key); } catch (e) { console.warn("Acesso ao localStorage negado.", e); return null; } },
    setItem(key, value) { try { localStorage.setItem(key, value); } catch (e) { console.warn("Acesso ao localStorage negado.", e); } },
    removeItem(key) { try { localStorage.removeItem(key); } catch (e) { console.warn("Acesso ao localStorage negado.", e); } }
};

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

const mainMenu = document.getElementById('mainMenu');
const calculatorContainer = document.getElementById('calculatorContainer');
const contractContainer = document.getElementById('contractContainer');
const stockContainer = document.getElementById('stockContainer');
const adminContainer = document.getElementById('administracao');
const topRightControls = document.getElementById('top-right-controls');

function showMainSection(sectionId) {
    if (!isAuthReady) return;
    
    // Desliga ouvintes antigos para economizar memória
    if (productsListener) { off(getProductsRef(), 'value', productsListener); productsListener = null; }
    if (boletosListener) { off(ref(db, 'boletos'), 'value', boletosListener); boletosListener = null; }

    // 1. Pega o elemento novo (Clientes)
    const clientsContainer = document.getElementById('clientsContainer');

    // 2. Esconde TUDO (Adiciona classe hidden)
    mainMenu.classList.add('hidden');
    calculatorContainer.classList.add('hidden');
    contractContainer.classList.add('hidden');
    stockContainer.classList.add('hidden');
    adminContainer.classList.add('hidden');
    topRightControls.classList.add('hidden');
    
    // Esconde também o container de clientes se ele existir
    if (clientsContainer) clientsContainer.classList.add('hidden');

    // 3. Garante que o display seja none visualmente
    mainMenu.style.display = 'none';
    calculatorContainer.style.display = 'none';
    contractContainer.style.display = 'none';
    stockContainer.style.display = 'none';
    adminContainer.style.display = 'none';
    if (clientsContainer) clientsContainer.style.display = 'none';

    // 4. Mostra APENAS a seção escolhida
    if (sectionId === 'main') {
        mainMenu.classList.remove('hidden');
        mainMenu.style.display = 'flex';
        topRightControls.classList.remove('hidden');
    } 
    else if (sectionId === 'calculator') {
        calculatorContainer.classList.remove('hidden');
        calculatorContainer.style.display = 'block';
        openCalculatorSection('calculatorHome');
    } 
               else if (sectionId === 'contract') {
        contractContainer.classList.remove('hidden');
        contractContainer.style.display = 'block'; 
        
        // CORREÇÃO: Não carregamos o rascunho aqui ainda!
        // Apenas abrimos o menu de escolha.
        
        document.getElementById('documentsHome').style.display = 'flex'; // Garante o display correto
        document.getElementById('areaContratoWrapper').style.display = 'none';
        document.getElementById('areaBookipWrapper').style.display = 'none';
    } 

    else if (sectionId === 'stock') {
        stockContainer.classList.remove('hidden');
        stockContainer.style.display = 'flex';
        loadCheckedItems();
        filterStockProducts();
    } 
    else if (sectionId === 'administracao') {
        adminContainer.classList.remove('hidden');
        adminContainer.style.display = 'flex';
        filterAdminProducts();
    }
    // --- NOVO: LÓGICA DA TELA DE CLIENTES ---
    else if (sectionId === 'clients') {
        if (clientsContainer) {
            clientsContainer.classList.remove('hidden');
            clientsContainer.style.display = 'flex';
            // Chama a função que preenche a tabela (que vamos criar no Bloco 2)
            if (typeof renderClientsTable === 'function') {
                renderClientsTable();
            }
        }
    }

    currentMainSectionId = sectionId;
    safeStorage.setItem('ctwLastSection', sectionId);
}


function renderRatesEditor() {
    const accordionContainer = document.getElementById('ratesAccordion');
    if (!areRatesLoaded || Object.keys(rates).length === 0) { 
        accordionContainer.innerHTML = '<p class="text-center text-secondary">Aguardando carregamento das taxas...</p>'; 
        return; 
    }
    
    // 1. Renderiza as taxas (Código original mantido)
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
                const creditInputs = (brandData.credito || []).map((rate, idx) => `<div class="col-md-4 col-6"><label class="form-label small">${idx + 1}x</label><div class="input-group mb-2"><input type="number" step="0.01" class="form-control form-control-sm" value="${rate}" data-machine="${machine}" data-brand="${brand}" data-type="credito" data-installments="${idx + 1}"><span class="input-group-text">%</span></div></div>`).join('');
                return `<div class="tab-pane fade ${i === 0 ? 'show active' : ''}" id="content-${machine}-${brand}" role="tabpanel"><div class="row mt-3"><div class="col-md-4 col-6"><label class="form-label fw-bold">Débito</label><div class="input-group mb-3"><input type="number" step="0.01" class="form-control" value="${brandData.debito || 0}" data-machine="${machine}" data-brand="${brand}" data-type="debito"><span class="input-group-text">%</span></div></div></div><h5>Crédito</h5><div class="row">${creditInputs}</div></div>`;
            }).join('');
            machineContent = `<ul class="nav nav-tabs" role="tablist">${navTabs}</ul><div class="tab-content">${tabContent}</div>`;
        }
        accordionContainer.insertAdjacentHTML('beforeend', `<div class="accordion-item"><h2 class="accordion-header"><button class="accordion-button ${index > 0 ? 'collapsed' : ''}" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-${machine}">${machine.charAt(0).toUpperCase() + machine.slice(1)}</button></h2><div id="collapse-${machine}" class="accordion-collapse collapse ${index === 0 ? 'show' : ''}" data-bs-parent="#ratesAccordion"><div class="accordion-body">${machineContent}</div></div></div>`);
    });
    
    accordionContainer.querySelectorAll('[data-bs-toggle="tab"]').forEach(triggerEl => { if (!bootstrap.Tab.getInstance(triggerEl)) new bootstrap.Tab(triggerEl); });

    // 2. INSERIR PAINEL DE PADRÕES (NOVO CÓDIGO)
    renderDefaultSettingsPanel(accordionContainer);
}

// --- FUNÇÃO NOVA: PAINEL DE PADRÕES DE MÁQUINA E BANDEIRA ---
function renderDefaultSettingsPanel(container) {
    const savedMachine = safeStorage.getItem('ctwDefaultMachine') || 'pagbank';
    const savedBrand = safeStorage.getItem('ctwDefaultBrand') || '';

    // HTML do Painel
    const panelHtml = `
    <div class="admin-section mt-4" style="border: 1px solid var(--primary-color);">
        <h4 class="text-start mb-3"><i class="bi bi-bookmark-star-fill text-warning"></i> Definir Padrões de Cálculo</h4>
        <p class="text-secondary small">Escolha qual máquina e bandeira devem vir selecionadas automaticamente ao abrir a calculadora.</p>
        
        <div class="mb-3">
            <label class="form-label">Maquininha Padrão</label>
            <select id="defaultMachineSelect" class="form-select">
                <option value="pagbank">PagBank</option>
                <option value="infinity">InfinityPay</option>
                <option value="valorante">Valorante</option>
            </select>
        </div>

        <div class="mb-3 hidden" id="defaultBrandContainer">
            <label class="form-label">Bandeira Padrão</label>
            <select id="defaultBrandSelect" class="form-select">
                </select>
        </div>

        <button id="saveDefaultsBtn" class="btn btn-warning w-100 fw-bold" style="color: #000;"><i class="bi bi-check-circle-fill"></i> Salvar Padrão</button>
    </div>
    `;
    
    container.insertAdjacentHTML('afterend', panelHtml);

    // Lógica dos Selects
    const machineSelect = document.getElementById('defaultMachineSelect');
    const brandSelect = document.getElementById('defaultBrandSelect');
    const brandContainer = document.getElementById('defaultBrandContainer');
    const saveBtn = document.getElementById('saveDefaultsBtn');

    // 1. Carrega Máquina Salva
    machineSelect.value = savedMachine;

    // 2. Função para atualizar as bandeiras baseada na máquina
    const updateBrands = () => {
        const machine = machineSelect.value;
        brandSelect.innerHTML = '';
        
        if (machine === 'pagbank') {
            brandContainer.classList.add('hidden');
        } else {
            brandContainer.classList.remove('hidden');
            // Pega as bandeiras disponíveis nessa máquina direto do objeto 'rates'
            if (rates[machine]) {
                const availableBrands = Object.keys(rates[machine]);
                availableBrands.forEach(brand => {
                    const option = document.createElement('option');
                    option.value = brand;
                    option.textContent = brand.charAt(0).toUpperCase() + brand.slice(1);
                    if (brand === savedBrand) option.selected = true;
                    brandSelect.appendChild(option);
                });
            }
        }
    };

    machineSelect.addEventListener('change', updateBrands);
    updateBrands(); // Roda ao abrir

    // 3. Botão Salvar
    saveBtn.addEventListener('click', () => {
        const machine = machineSelect.value;
        const brand = (machine !== 'pagbank') ? brandSelect.value : '';
        
        safeStorage.setItem('ctwDefaultMachine', machine);
        safeStorage.setItem('ctwDefaultBrand', brand);
        
        showCustomModal({ message: `Padrão salvo! Agora a calculadora abrirá com ${machine.charAt(0).toUpperCase() + machine.slice(1)} ${brand ? '- ' + brand.toUpperCase() : ''}.` });
    });
}




function openFlagModal(machineSelectElement) {
    const flagModalOverlay = document.getElementById('flagSelectorModalOverlay');
    const flagModalButtons = document.getElementById('flagSelectorButtons');
    const machineValue = machineSelectElement.value;
    const sectionNumber = machineSelectElement.id.replace('machine', '');
    
    // CORREÇÃO AQUI: Adicionei 'const' para declarar a variável. Antes estava sem nada e travava.
    const activeBrandSelect = document.getElementById(`brand${sectionNumber}`);
    
    if (machineValue === 'pagbank' || !activeBrandSelect) { 
        if (flagModalOverlay.classList.contains('active')) closeFlagModal(); 
        return; 
    }
    
    flagModalButtons.innerHTML = '';
    Array.from(activeBrandSelect.options).forEach(option => {
        const brand = option.value;
        // Proteção extra caso flagData não tenha a bandeira
        const data = (typeof flagData !== 'undefined' && flagData[brand]) ? flagData[brand] : { name: brand, icon: 'bi-question-circle' };
        
        const button = document.createElement('button');
        button.className = 'btn-flag'; 
        button.dataset.value = brand; 
        button.innerHTML = `<i class="bi ${data.icon}"></i> ${data.name}`;
        
        button.onclick = () => { 
            activeBrandSelect.value = brand; 
            activeBrandSelect.dispatchEvent(new Event('change', { bubbles: true })); 
            closeFlagModal(); 
        };
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

function escapeHtml(text) { const map = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'}; return text ? text.toString().replace(/[&<>"']/g, m => map[m]) : ''; }
function parseBrazilianCurrencyToFloat(valueString) { let cleaned = String(valueString).replace(/R\$?\s?|💰|\$\s?/g, '').trim(); if (cleaned.includes(',')) { cleaned = cleaned.replace(/\./g, '').replace(',', '.'); } return parseFloat(cleaned); }

function openCalculatorSection(sectionId) {
    if (!sectionId || !document.getElementById(sectionId)) sectionId = 'calculatorHome';
    
    // 1. Esconde tudo primeiro
    ['calculatorHome', 'fecharVenda', 'repassarValores', 'calcularEmprestimo', 'calcularPorAparelho'].forEach(id => {
        document.getElementById(id).style.display = 'none';
    });

    if (sectionId !== 'calcularPorAparelho') {
        currentlySelectedProductForCalc = null;
    }

    // 2. Limpeza ao entrar na aba
    if (sectionId === 'calcularPorAparelho') {
        carrinhoDeAparelhos = [];
        renderCarrinho();
        const inputEntrada = document.getElementById('entradaAparelho');
        const inputExtra = document.getElementById('valorExtraAparelho');
        if(inputEntrada) inputEntrada.value = '';
        if(inputExtra) inputExtra.value = '';
    }

    // 3. Mostra a seção
    document.getElementById(sectionId).style.display = 'flex';
    currentCalculatorSectionId = sectionId;
    
    // --- LÓGICA DE PADRÕES ---
    const defaultMachine = safeStorage.getItem('ctwDefaultMachine');
    const defaultBrand = safeStorage.getItem('ctwDefaultBrand');

    // Mapeamento de qual select pertence a qual seção
    const sectionMap = {
        'fecharVenda': { m: 'machine1', b: 'brand1', init: () => { updateInstallmentsOptions(); updateFecharVendaUI(); } },
        'repassarValores': { m: 'machine2', b: 'brand2', init: () => updateRepassarValoresUI() },
        'calcularEmprestimo': { m: 'machine4', b: 'brand4', init: () => updateCalcularEmprestimoUI() },
        'calcularPorAparelho': { m: 'machine3', b: 'brand3', init: () => updateCalcularPorAparelhoUI() }
    };

    const config = sectionMap[sectionId];

    // Se a seção tem configuração de máquina/bandeira
    if (config) {
        const mSelect = document.getElementById(config.m);
        const bSelect = document.getElementById(config.b);

        // A. Aplica os valores nos selects (mesmo que ainda invisíveis)
        if (defaultMachine && mSelect) {
            mSelect.value = defaultMachine;
        }
        if (defaultMachine !== 'pagbank' && defaultBrand && bSelect) {
            bSelect.value = defaultBrand;
        }

        // B. Roda a inicialização da tela (Isso vai ler os selects e desenhar os botões)
        config.init();

        // C. Correção Final: Se não for PagBank, garante que o botão da bandeira mostre o ícone certo
        if (defaultMachine && defaultMachine !== 'pagbank' && defaultBrand) {
            const sectionNum = config.m.replace('machine', '');
            // Pequeno delay para garantir que o DOM atualizou
            setTimeout(() => {
                updateFlagDisplay(sectionNum);
            }, 50);
        }
    }
    
    safeStorage.setItem('ctwLastCalcSub', sectionId);
}


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
    if (parseInt(installmentsSlider.value) > max) {
        installmentsSlider.value = 0;
    }
    renderQuickInstallmentButtons();
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
    } else {
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
    const machineSelect = document.getElementById("machine3");
    
    // Configura a visualização das bandeiras
    document.getElementById("flagDisplayContainer3").style.display = (machineSelect.value !== "pagbank") ? 'block' : 'none';
    updateFlagDisplay('3');
    
    // Mostra os favoritos
    renderAparelhoFavorites();
    
    // Apenas recalcula o que já está na tela (sem apagar nada)
    calculateAparelho();
}



function getRate(machine, brand, installments) { 
    if (!areRatesLoaded || !rates[machine]) return undefined; 
    if (machine === 'pagbank') return installments === 0 ? rates.pagbank.debito : rates.pagbank.credito[installments - 1]; 
    const rateSet = (machine === 'infinity' && brand === 'hiper') ? rates.infinity.hiper : rates[machine][brand === 'hiper' ? 'hipercard' : brand]; 
    return rateSet ? (installments === 0 ? rateSet.debito : rateSet.credito[installments - 1]) : undefined; 
}

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
    
    // Verificação de segurança para variáveis globais
    if (typeof areRatesLoaded !== 'undefined' && !areRatesLoaded) return;
    
    // 1. PEGA O VALOR DIGITADO (PRINCIPAL)
    const valorInput = parseFloat(document.getElementById("repassarValue").value);

    // Validação: Se não digitou nada ou valor inválido, limpa e sai
    if (isNaN(valorInput) || valorInput <= 0) {
        resultDiv.innerHTML = "";
        if(exportContainer) exportContainer.style.display = 'none';
        return;
    }

    // 2. PEGA O LUCRO EXTRA (OCULTO)
    // Se o campo existir, pega o valor. Se não, assume 0.
    const elExtra = document.getElementById("repassarExtra");
    let valorExtra = 0;
    if (elExtra) {
        valorExtra = parseFloat(elExtra.value);
        if (isNaN(valorExtra)) valorExtra = 0; // Proteção contra valor vazio
    }

    // 3. SOMA TUDO (Esse é o valor real que será calculado)
    const valorDesejado = valorInput + valorExtra;
    
    const machine = document.getElementById("machine2").value; 
    const brand = document.getElementById("brand2").value;
    
    let maxInstallments = 0;
    if (typeof rates !== 'undefined' && rates[machine]) {
        switch(machine) {
            case "pagbank": maxInstallments = 18; break;
            case "infinity": maxInstallments = 12; break;
            case "valorante": maxInstallments = 21; break;
        }
    }
    
    let tableRows = "";
    
    // Cálculo Débito
    const debitTax = getRate(machine, brand, 0);
    if(debitTax !== null && debitTax !== undefined) {
        const valorBrutoDebito = valorDesejado / (1 - debitTax / 100);
        tableRows += `<tr class="debit-row"><td>Débito</td><td>-</td><td>${valorBrutoDebito.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td></tr>`;
    }
    
    // Cálculo Crédito (Com sua lógica original de arredondamento)
    const arredondarAtivo = safeStorage.getItem('ctwArredondarEnabled') === 'true';
    for (let i = 1; i <= maxInstallments; i++) {
        const creditTax = getRate(machine, brand, i);
        if (creditTax !== undefined) {
            const valorBrutoBase = valorDesejado / (1 - creditTax / 100);
            let valorParcela = valorBrutoBase / i;
            let valorTotalFinal = valorBrutoBase;

            if (arredondarAtivo) {
                valorParcela = Math.floor(valorParcela) + 0.90;
                valorTotalFinal = valorParcela * i;
            }
            
            tableRows += `<tr class="copyable-row" data-installments="${i}" data-parcela="${valorParcela.toFixed(2)}" data-total="${valorTotalFinal.toFixed(2)}"><td>${i}x</td><td>${valorParcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td><td>${valorTotalFinal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td></tr>`;
        }
    }
    
    if (tableRows) {
        resultDiv.innerHTML = `<div class="table-responsive"><table class="table results-table"><thead><tr><th>Parcelas</th><th>Valor da Parcela</th><th>Total a Passar</th></tr></thead><tbody>${tableRows}</tbody></table></div>`;
        if(exportContainer) exportContainer.style.display = 'block';
    } else {
        resultDiv.innerHTML = "";
        if(exportContainer) exportContainer.style.display = 'none';
    }
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
    
    const arredondarAtivo = safeStorage.getItem('ctwArredondarEnabled') === 'true';
    for (let i = 1; i <= maxInstallments; i++) {
        const creditTax = getRate(machine, brand, i);
        if (creditTax !== undefined) {
            const valorBrutoBase = valorDesejado / (1 - creditTax / 100);
            let valorParcela = valorBrutoBase / i;
            let valorTotalFinal = valorBrutoBase;

            if (arredondarAtivo) {
                valorParcela = Math.floor(valorParcela) + 0.90;
                valorTotalFinal = valorParcela * i;
            }

            tableRows += `<tr class="copyable-row" data-installments="${i}" data-parcela="${valorParcela.toFixed(2)}" data-total="${valorTotalFinal.toFixed(2)}"><td>${i}x</td><td>${valorParcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td><td>${valorTotalFinal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td></tr>`;
        }
    }
    
    if (tableRows) {
        resultDiv.innerHTML = `<div class="table-responsive"><table class="table results-table"><thead><tr><th>Parcelas</th><th>Valor da Parcela</th><th>Total a Passar</th></tr></thead><tbody>${tableRows}</tbody></table></div>`;
    } else {
        resultDiv.innerHTML = "";
    }
    exportContainer.style.display = tableRows.trim() !== "" ? 'block' : 'none';
}

function renderCarrinho() {
    const container = document.getElementById('carrinhoAparelhosContainer');
    if (!container) return;

    container.innerHTML = '';

    // Se estiver vazio, esconde e sai
    if (carrinhoDeAparelhos.length === 0) {
        return;
    }

    // Cria um card bonito para cada produto na lista
    carrinhoDeAparelhos.forEach((product, index) => {
        
        // Lógica da data
        let dateInfo = "Verificado hoje";
        if (product.lastCheckedTimestamp) {
            dateInfo = "Verificado em " + new Date(product.lastCheckedTimestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        }

        // Lógica das Cores
        let colorsHtml = '';
        if (product.cores && product.cores.length > 0) {
            colorsHtml = product.cores.map(c => 
                `<div class="color-pill" title="${c.nome}">
                    <div class="color-swatch-sm" style="background-color:${c.hex};"></div>
                    <span>${c.nome}</span>
                </div>`
            ).join('');
        } else {
            colorsHtml = '<span class="text-secondary small ms-1">Sem cores definidas</span>';
        }

        // HTML do Card Unificado (COM O BOTÃO DE FAVORITAR)
        const cardHtml = `
        <div class="product-action-card">
            
            <div class="product-action-header">
                <div class="product-action-info" style="flex: 1;">
                    <h5 class="mb-1 text-start">${escapeHtml(product.nome)}</h5>
                    <div class="product-action-date text-start"><i class="bi bi-clock-history"></i> ${dateInfo}</div>
                </div>
                
                <button class="btn-remove-card" onclick="removerDoCarrinho(${index})" title="Remover item">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>
            
            <div class="product-action-colors">
                ${colorsHtml}
            </div>

            <div class="product-action-buttons">
                <button class="btn-action-sm edit-price-btn" data-index="${index}">
                    <i class="bi bi-cash-coin"></i> Editar Valor
                </button>
                <button class="btn-action-sm edit-colors-btn" data-id="${product.id}">
                    <i class="bi bi-palette"></i> Editar Cores
                </button>
            </div>

            <div class="mt-2 pt-2 border-top border-secondary border-opacity-10 text-center">
                 <button class="btn btn-sm text-warning w-100 save-favorite-shortcut" data-index="${index}" style="background: transparent; border: none; font-size: 0.9rem;">
                    <i class="bi bi-star-fill"></i> Salvar este cálculo como atalho
                </button>
            </div>
        </div>
        `;

        container.insertAdjacentHTML('beforeend', cardHtml);
    });
}




function removerDoCarrinho(index) {
    carrinhoDeAparelhos.splice(index, 1);
    renderCarrinho();
    calculateAparelho();
}
// LINHA MÁGICA: Torna a função visível para o botão do HTML
window.removerDoCarrinho = removerDoCarrinho;



function calculateAparelho() {
    if (!areRatesLoaded) return;
    const resultDiv = document.getElementById('resultCalcularPorAparelho');
    const exportContainer = document.getElementById('exportAparelhoContainer');
    const entradaValue = parseFloat(document.getElementById('entradaAparelho').value) || 0;
    const extraValue = parseFloat(document.getElementById('valorExtraAparelho').value) || 0;

    if (carrinhoDeAparelhos.length === 0) {
        resultDiv.innerHTML = '<div class="alert alert-warning d-flex align-items-center mt-3 w-100" style="max-width: 400px; margin: 1rem auto;"><i class="bi bi-exclamation-triangle-fill me-3"></i>Adicione um aparelho para calcular.</div>';
        exportContainer.style.display = 'none';
        return;
    }
    
    const valorTotalProdutos = carrinhoDeAparelhos.reduce((total, p) => total + parseFloat(p.valor), 0);
    const valorTotalAparelho = valorTotalProdutos + extraValue;
    const valorBaseParaCalculo = valorTotalAparelho - entradaValue;

    const precoTotalDisplay = document.getElementById('aparelhoPrecoTotalDisplay');
    if(precoTotalDisplay) {
        precoTotalDisplay.innerHTML = `Preço Total (com extra): ${valorTotalAparelho.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
    }
    
    let headerHtml = ``;
    if (entradaValue > 0) {
        headerHtml += `<div class="alert alert-info d-flex align-items-center w-100" style="max-width: 400px; margin-top: 1rem;"><i class="bi bi-info-circle-fill me-3"></i><div><strong>Entrada de ${entradaValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} aplicada.</strong><br><small>O valor das parcelas abaixo já considera este abatimento.</small></div></div>`;
    }

    if (valorBaseParaCalculo < 0) {
        resultDiv.innerHTML = headerHtml + '<div class="alert alert-danger d-flex align-items-center mt-3 w-100" style="max-width: 400px; margin: 1rem auto;"><i class="bi bi-x-circle-fill me-3"></i>O valor da entrada não pode ser maior que o valor total.</div>';
        exportContainer.style.display = 'none';
        return;
    }

    if (valorBaseParaCalculo <= 0) {
        resultDiv.innerHTML = headerHtml + '<div class="alert alert-success d-flex align-items-center mt-3 w-100" style="max-width: 400px; margin: 1rem auto;"><i class="bi bi-check-circle-fill me-3"></i>Valor quitado com a entrada.</div>';
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
        tableRows += `<tr class="debit-row copyable-row" data-installments="Débito" data-parcela="${valorBrutoDebito.toFixed(2)}" data-total="${valorBrutoDebito.toFixed(2)}"><td>Débito</td><td>-</td><td>${valorBrutoDebito.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td></tr>`;
    }

    const arredondarAtivo = safeStorage.getItem('ctwArredondarEnabled') === 'true';
    for (let i = 1; i <= maxInstallments; i++) {
        const creditTax = getRate(machine, brand, i);
        if (creditTax !== undefined) {
            const valorBrutoBase = valorBaseParaCalculo / (1 - creditTax / 100);
            let valorParcela = valorBrutoBase / i;
            let valorTotalFinal = valorBrutoBase;

            if (arredondarAtivo) {
                valorParcela = Math.floor(valorParcela) + 0.90;
                valorTotalFinal = valorParcela * i;
            }
            
            tableRows += `<tr class="copyable-row" data-installments="${i}" data-parcela="${valorParcela.toFixed(2)}" data-total="${valorTotalFinal.toFixed(2)}"><td>${i}x</td><td>${valorParcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td><td>${valorTotalFinal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td></tr>`;
        }
    }

        // ... (parte anterior do calculateAparelho continua igual) ...

    let finalHtml = headerHtml;
    if(tableRows) {
        // ... (código do html da tabela) ...
        finalHtml += `
        <div class="d-flex justify-content-end align-items-center mb-2 px-2">
            <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="multiSelectToggle">
                <label class="form-check-label small" for="multiSelectToggle">Selecionar Vários</label>
            </div>
        </div>`;
        finalHtml += `<div class="table-responsive"><table class="table results-table"><thead><tr><th>Parcelas</th><th>Valor da Parcela</th><th>Total a Passar</th></tr></thead><tbody>${tableRows}</tbody></table></div>`;
    }
    resultDiv.innerHTML = finalHtml;
    exportContainer.style.display = tableRows.trim() !== "" ? 'block' : 'none';
    
    // REMOVEMOS A PARTE QUE SALVAVA O RASCUNHO AQUI
}


function handleProductSelectionForAparelho(product) {
    // Adiciona ao carrinho
    carrinhoDeAparelhos.push({ ...product }); 
    
    // Limpa a busca
    document.getElementById('aparelhoSearch').value = ''; 
    document.getElementById('aparelhoResultsContainer').innerHTML = '';
    
    // Configurações iniciais
    if (carrinhoDeAparelhos.length === 1) {
        document.getElementById('valorExtraAparelho').value = '40';
    }
    if (carrinhoDeAparelhos.length === 2) {
        showCustomModal({ message: "Múltiplos produtos: Textos de etiqueta desativados." });
    }

    // Esconde a nota antiga (pois agora tudo estará no carrinho unificado)
    document.getElementById('aparelhoInfoNote').classList.add('hidden');
    document.getElementById('aparelhoInfoNote').innerHTML = '';

    // Atualiza a tela unificada
    renderCarrinho();
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
async function exportResultsToImage(resultsContainerId, fileName = 'calculo-taxas.png', customTitle = '') {
    try {
        const resultsEl = document.getElementById(resultsContainerId);
        if (!resultsEl || !resultsEl.innerHTML.trim()) {
            showCustomModal({ message: "Não há resultados para exportar." });
            return;
        }

        // 1. Container Principal
        const exportContainer = document.createElement('div');
        exportContainer.className = 'export-container-temp';
        
        // CONFIGURAÇÃO: 1080 x 1350 (Vertical 4:5)
        exportContainer.style.position = 'fixed';
        exportContainer.style.left = '-9999px';
        exportContainer.style.top = '0';
        exportContainer.style.width = '1080px';
        exportContainer.style.minHeight = '1350px';
        exportContainer.style.padding = '60px';
        exportContainer.style.boxSizing = 'border-box';
        
        // Cores (Fundo Branco Forçado)
        const style = getComputedStyle(document.body);
        const primaryColor = style.getPropertyValue('--primary-color').trim() || '#EF5350';
        const bgColor = '#ffffff';
        const textColor = '#000000';
        const subTextColor = '#555555';
        const cardBg = '#f8f9fa';
        const cardBorder = '#e9ecef';

        exportContainer.style.background = bgColor;
        exportContainer.style.fontFamily = "'Poppins', sans-serif";
        exportContainer.style.color = textColor;
        exportContainer.style.display = 'flex';
        exportContainer.style.flexDirection = 'column';
        exportContainer.style.justifyContent = 'space-between';

        // 2. Processar Entrada e Título
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = resultsEl.innerHTML;
        
        let entradaValor = '';
        let alertsAndTitle = ''; // Conteúdo HTML extra (alertas, etc)
        
        // Separa o valor da entrada para colocar no topo
        Array.from(tempDiv.children).forEach(child => {
            const text = child.innerText || '';
            // Se for o alerta de entrada, extrai o valor e não renderiza embaixo
            if (child.classList.contains('alert') && (text.includes('Entrada') || text.includes('entrada'))) {
                const match = text.match(/R\$\s?[\d.,]+/);
                if(match) entradaValor = match[0];
                return; 
            }
            // Outros elementos (Títulos H4 antigos ou Alertas de erro)
            if (child.tagName !== 'DIV' && child.tagName !== 'H4' || (!child.querySelector('table') && child.tagName !== 'H4')) {
                // Estiliza alertas restantes
                if(child.classList.contains('alert')) {
                    child.style.background = '#f1f3f5';
                    child.style.borderLeft = `6px solid ${primaryColor}`;
                    child.style.color = textColor;
                    child.style.fontSize = '1.2rem';
                    child.style.padding = '15px';
                    child.style.marginBottom = '20px';
                    child.style.borderRadius = '12px';
                    child.className = '';
                }
                alertsAndTitle += child.outerHTML;
            }
        });

        // 3. Montar Cabeçalho
        const displayTitle = customTitle || "ORÇAMENTO PERSONALIZADO";
        const headerDiv = document.createElement('div');
        headerDiv.style.textAlign = 'center';
        headerDiv.style.marginBottom = '30px';
        
        let entradaBadge = '';
        if(entradaValor) {
            entradaBadge = `
            <div style="margin-top: 20px; font-size: 1.4rem; color: #fff; background: #222; padding: 8px 30px; border-radius: 50px; display: inline-block; font-weight: 700; box-shadow: 0 5px 15px rgba(0,0,0,0.2);">
                ENTRADA: <span style="color: ${primaryColor};">${entradaValor}</span>
            </div>`;
        }

        headerDiv.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center;">
                <div style="font-size: 3rem; font-weight: 900; color: ${textColor}; letter-spacing: -1px; text-transform: uppercase; margin-bottom: 10px;">WORKCELL <span style="color:${primaryColor}">TECNOLOGIA</span></div>
                
                <div style="
                    background: ${primaryColor}; 
                    color: #fff; 
                    font-size: 1.6rem; 
                    font-weight: 800; 
                    letter-spacing: 1px; 
                    text-transform: uppercase; 
                    padding: 8px 35px; 
                    border-radius: 60px; 
                    box-shadow: 0 8px 20px rgba(0,0,0,0.15);
                    display: inline-block;
                ">
                    ${displayTitle}
                </div>
                ${entradaBadge}
            </div>
        `;
        
        // 4. Montar Tabela (2 Colunas)
        const contentDiv = document.createElement('div');
        contentDiv.style.width = '100%';
        contentDiv.style.flex = '1';
        
        const rows = Array.from(tempDiv.querySelectorAll('tbody tr'));
        let columnsHtml = '';
        
        // Função auxiliar para criar os cards
        const renderCards = (list) => list.map(row => {
            const cells = row.querySelectorAll('td');
            const parcelas = cells[0].innerText;
            const valorParcela = cells[1].innerText;
            const total = cells[2].innerText;
            
            const isHighlight = parcelas.includes('Débito') || parcelas === '1x';
            const borderStyle = isHighlight ? `2px solid ${primaryColor}` : `1px solid ${cardBorder}`;
            const badgeStyle = `background: ${primaryColor}; color: #fff;`;

            return `
            <div class="list-item" style="border: ${borderStyle}; background: ${cardBg};">
                <div class="parcela-badge" style="${badgeStyle}">${parcelas}</div>
                <div class="info-group">
                    <div class="label" style="color: ${subTextColor}">Parcela</div>
                    <div class="value-main" style="color: ${textColor}">${valorParcela}</div>
                </div>
                <div class="info-group text-end">
                    <div class="label" style="color: ${subTextColor}">Total</div>
                    <div class="value-sub" style="color: ${primaryColor}">${total}</div>
                </div>
            </div>`;
        }).join('');

        // Divide em 2 colunas se tiver mais de 6 itens
        if (rows.length > 6) {
            const splitIndex = Math.ceil(rows.length / 2); 
            const col1Rows = rows.slice(0, splitIndex);
            const col2Rows = rows.slice(splitIndex);
            columnsHtml = `
            <div class="columns-wrapper">
                <div class="column">${renderCards(col1Rows)}</div>
                <div class="column">${renderCards(col2Rows)}</div>
            </div>`;
        } else {
            columnsHtml = `<div class="list-container">${renderCards(rows)}</div>`;
        }

        const styles = `
            <style>
                .columns-wrapper { display: flex; gap: 30px; width: 100%; align-items: flex-start; }
                .column { flex: 1; display: flex; flex-direction: column; gap: 15px; }
                .list-container { display: flex; flex-direction: column; gap: 15px; width: 100%; }
                .list-item { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-radius: 14px; position: relative; box-shadow: 0 3px 8px rgba(0,0,0,0.04); height: 80px; box-sizing: border-box; }
                .parcela-badge { position: absolute; top: 50%; left: -15px; transform: translateY(-50%); font-weight: 800; width: 55px; height: 55px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1rem; box-shadow: 0 4px 10px rgba(0,0,0,0.2); z-index: 2; border: 4px solid #fff; }
                .info-group { display: flex; flex-direction: column; margin-left: 30px; }
                .text-end { align-items: flex-end; margin-left: 0; }
                .label { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px; }
                .value-main { font-size: 1.4rem; font-weight: 700; letter-spacing: -0.5px; }
                .value-sub { font-size: 1.1rem; font-weight: 600; }
            </style>
        `;
        
        contentDiv.innerHTML = styles + alertsAndTitle + columnsHtml;

        // 5. Rodapé
        const footerDiv = document.createElement('div');
        footerDiv.style.marginTop = '40px';
        footerDiv.style.textAlign = 'center';
        footerDiv.innerHTML = `
            <div style="display: inline-block; background: #000; color: #fff; padding: 10px 30px; border-radius: 50px; font-size: 1.1rem; font-weight: 600; box-shadow: 0 10px 20px rgba(0,0,0,0.1);">Válido por tempo limitado ⚠️</div>
            <div style="margin-top: 15px; font-size: 0.9rem; color: #aaa;">Gerado via App Central Workcell</div>
        `;

        exportContainer.appendChild(headerDiv);
        exportContainer.appendChild(contentDiv);
        exportContainer.appendChild(footerDiv);
        document.body.appendChild(exportContainer);

        // 6. Gerar Imagem
        await new Promise(resolve => setTimeout(resolve, 300)); // Delay para garantir renderização
        const canvas = await html2canvas(exportContainer, { backgroundColor: null, scale: 1, logging: false });
        const link = document.createElement('a');
        link.download = fileName;
        link.href = canvas.toDataURL("image/png");
        link.click();
        
        document.body.removeChild(exportContainer);

    } catch (error) {
        console.error('Erro na exportação:', error);
        showCustomModal({ message: 'Erro ao criar imagem. Tente novamente.' });
        // Limpeza de emergência
        const oldContainer = document.querySelector('.export-container-temp');
        if(oldContainer) document.body.removeChild(oldContainer);
    }
}


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

function loadRatesFromDB() { 
    const ratesRef = ref(db, 'rates'); 
    onValue(ratesRef, (snapshot) => { 
        if (snapshot.exists()) { 
            rates = snapshot.val(); 
            areRatesLoaded = true; 
            updateInstallmentsOptions(); 
            console.log("Taxas carregadas."); 
            
            // --- CORREÇÃO: RECALCULAR ASSIM QUE AS TAXAS CHEGAREM ---
            // Se o usuário estiver na tela de "Calcular por Aparelho", forçamos o cálculo agora
            // pois antes ele pode ter falhado por falta de taxas.
            if (currentCalculatorSectionId === 'calcularPorAparelho') {
                calculateAparelho();
            }
            // Se estiver em outras telas que precisam de recálculo imediato
            if (currentCalculatorSectionId === 'fecharVenda') calculateFecharVenda();
            // ---------------------------------------------------------

            if (currentMainSectionId === 'administracao' && document.getElementById('adminModeToggle')?.checked) renderRatesEditor(); 
        } else { 
            console.error("ERRO: As taxas não foram encontradas."); 
            showCustomModal({ message: "Erro crítico: Não foi possível carregar as taxas." }); 
        } 
    }, (error) => { 
        console.error("Erro ao carregar taxas:", error); 
        showCustomModal({ message: `Erro ao carregar taxas: ${error.message}` }); 
    }); 
}
 //fim da funcao

const getProductsRef = () => ref(db, 'products');

function loadProductsFromDB() {
    if (!db || !isAuthReady) return;
    
    const searchContainers = [document.getElementById('vendaSearchResultsContainer'), document.getElementById('aparelhoResultsContainer')];
    searchContainers.forEach(c => showSkeletonLoader(c));
    
    if (productsListener) off(getProductsRef(), 'value', productsListener);
    
    productsListener = onValue(getProductsRef(), (snapshot) => {
        searchContainers.forEach(c => hideSkeletonLoader(c));
        const data = snapshot.val(); 
        products = data ? Object.keys(data).map(key => ({ id: key, ...data[key] })) : [];
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

async function updateProductInDB(id, data) { 
    try { 
        await update(ref(db, `products/${id}`), data); 
    } catch (error) { 
        console.error(`Erro ao atualizar: ${error.message}`); 
    } 
}

function renderAdminProductList(filteredList = products) {
    const container = document.getElementById('productsListContainer');
    if (!container) return;
    const tags = getTagList();
    if (filteredList.length === 0) {
        container.innerHTML = `
        <div class="text-center p-5">
            <i class="bi bi-journal-x" style="font-size: 4rem; color: var(--text-secondary);"></i>
            <h5 class="mt-3">Nenhum produto encontrado</h5>
            <p class="text-secondary">Adicione um novo produto para começar.</p>
        </div>`;
    } else {
        container.innerHTML = filteredList.map(product => {
            const tagOptions = tags.map(tag => `<option value="${escapeHtml(tag)}" ${product.tag === tag ? 'selected' : ''}>${escapeHtml(tag)}</option>`).join('');
            return `
            <div class="admin-product-accordion" data-id="${product.id}">
                <div class="admin-product-header">
                    <h6 class="product-name-title mb-0">${escapeHtml(product.nome)}</h6>
                    <i class="bi bi-chevron-down"></i>
                </div>
                <div class="admin-product-body">
                    <div class="admin-product-card-grid">
                        <div class="form-group full-width">
                            <label class="form-label">Nome do Produto</label>
                            <input type="text" class="form-control" value="${escapeHtml(product.nome)}" data-field="nome">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Valor</label>
                            <input type="text" class="form-control" value="${(product.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}" data-field="valor">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Qtd.</label>
                            <input type="number" class="form-control text-center" value="${product.quantidade || 0}" data-field="quantidade" min="0" step="1">
                        </div>
                        <div class="form-group full-width">
                            <label class="form-label">Etiqueta</label>
                            <select class="form-select" data-field="tag">${tagOptions}</select>
                        </div>
                    </div>
                    <div class="admin-product-actions">
                        <div class="form-check form-switch">
                            <input class="form-check-input ignore-toggle-switch-admin" type="checkbox" role="switch" id="ignore-admin-${product.id}" data-id="${product.id}" ${product.ignorarContagem ? 'checked' : ''}>
                            <label class="form-check-label" for="ignore-admin-${product.id}">Ignorar</label>
                        </div>
                        <button class="btn btn-sm btn-outline-danger delete-product-btn" data-id="${product.id}"><i class="bi bi-trash"></i> Apagar</button>
                    </div>
                </div>
            </div>`;
        }).join('');
    }
}

function filterAdminProducts() { 
    const searchTerm = document.getElementById('adminSearchInput').value; 
    renderAdminProductList(!fuse || !searchTerm ? products : fuse.search(searchTerm).map(r => r.item)); 
}

async function importFromPasteOrFile(content) {
    const lines = content.split('\n').filter(line => line.trim());
    const productsToImport = lines.map(line => {
        const parts = line.split('-').map(p => p.trim());
        if (parts.length >= 2) {
            const nome = parts[0];
            const valor = parseBrazilianCurrencyToFloat(parts[1]);
            const quantidade = parts.length > 2 ? parseInt(parts[2], 10) : 1;
            if (nome && !isNaN(valor) && !isNaN(quantidade)) {
                return { nome, valor, quantidade, cores: [], ignorarContagem: false, tag: 'Nenhuma' };
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

function exportProducts(format) { 
    const dataStr = format === 'txt' ? products.map(p => `${p.nome} - ${(p.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`).join('\n') : JSON.stringify(products.map(({id, ...rest}) => rest), null, 2); 
    const blob = new Blob([dataStr], { type: `text/${format === 'txt' ? 'plain' : 'json'}` }); 
    const a = document.createElement('a'); 
    a.href = URL.createObjectURL(blob); 
    a.download = `products.${format}`; 
    document.body.appendChild(a); 
    a.click(); 
    document.body.removeChild(a); 
    URL.revokeObjectURL(a.href); 
}

function showCustomModal({ message, onConfirm, onCancel, showPassword = false, confirmText = 'OK', cancelText = 'Cancelar' }) {
        const isInformational = typeof onConfirm !== 'function' && typeof onCancel !== 'function' && !showPassword;
    
    if (isInformational) {
        const toast = document.getElementById('toastNotification');
        
        // 1. Define o Ícone baseado no texto (Inteligência simples)
        let icon = '<i class="bi bi-info-circle-fill" style="color: var(--primary-color);"></i>'; // Padrão
        toast.className = ''; // Limpa classes antigas (success/error)
        
        const msgLower = message.toLowerCase();
        if (msgLower.includes('sucesso') || msgLower.includes('copiado') || msgLower.includes('salvo') || msgLower.includes('atualizado')) {
            icon = '<i class="bi bi-check-circle-fill"></i>';
            toast.classList.add('success');
        } else if (msgLower.includes('erro') || msgLower.includes('falha') || msgLower.includes('inválido')) {
            icon = '<i class="bi bi-x-circle-fill"></i>';
            toast.classList.add('error');
        }

        // 2. Monta o HTML da Ilha
        toast.innerHTML = `${icon} <span>${message}</span>`;
        
        // 3. Ativa a Animação
        if (toast.currentTimeout) clearTimeout(toast.currentTimeout);
        
        // Pequeno delay para garantir que a animação de "entrada" funcione se já estiver visível
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        // 4. Vibraçãozinha de satisfação (Já que adicionamos haptics!)
        if (navigator.vibrate) navigator.vibrate(20);

        toast.currentTimeout = setTimeout(() => {
            toast.classList.remove('show');
        }, 2500); // Fica visível por 2.5s
        
        return;
    }


    const overlay = document.getElementById('customModalOverlay');
    const messageEl = document.getElementById('customModalMessage');
    const passInput = document.getElementById('customModalPasswordInput');
    const okBtn = overlay.querySelector('.btn-ok');
    const cancelBtn = overlay.querySelector('.btn-cancel');
    const buttonsContainer = document.getElementById('customModalButtons');

    const closeModal = () => {
        overlay.classList.remove('active');
    };

    messageEl.textContent = message;
    passInput.value = '';
    passInput.classList.toggle('hidden', !showPassword);
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

    overlay.classList.add('active');
    if (showPassword) {
        passInput.focus();
    }
}

async function deleteAllProducts() { 
    showCustomModal({ 
        message: "Para excluir TODOS os produtos, digite 'excluir'.", 
        showPassword: true, 
        confirmText: "Excluir", 
        onConfirm: async (password) => { 
            if (password === "excluir") { 
                showCustomModal({ 
                    message: "Ação IRREVERSÍVEL. Apagar TUDO?", 
                    confirmText: 'SIM, EXCLUIR', 
                    onConfirm: async () => { 
                        try { 
                            await remove(getProductsRef()); 
                            showCustomModal({message: 'Todos os produtos foram excluídos.'}); 
                        } catch (error) { 
                            showCustomModal({ message: `Erro: ${error.message}` }); 
                        } 
                    }, 
                    onCancel: () => {} 
                }); 
            } else showCustomModal({ message: "Senha incorreta." }); 
        }, 
        onCancel: () => {} 
    }); 
}

function displayDynamicSearchResults(searchTerm, resultsContainerId, onItemClick) { 
    const resultsContainer = document.getElementById(resultsContainerId); 
    resultsContainer.innerHTML = ''; 
    
    // 1. FILTRO DE ETIQUETA (O "Funil" Principal)
    let filteredList = products;
    if (activeTagFilter) {
        // Só deixa passar produtos que têm a etiqueta IGUALZINHA a selecionada
        filteredList = products.filter(p => p.tag === activeTagFilter);
    }

    // 2. FILTRO DE TEXTO (Dentro do que sobrou)
    let finalResults = [];
    
    if (searchTerm && searchTerm.length >= 1) {
        // Cria uma busca nova APENAS dentro da lista filtrada
        const fuseLocal = new Fuse(filteredList, {
            keys: ['nome'],
            threshold: 0.3,
            ignoreLocation: true
        });
        finalResults = fuseLocal.search(searchTerm).map(r => r.item);
    } else if (activeTagFilter) {
        // Se não digitou nada, mostra todos da etiqueta
        finalResults = filteredList;
    }

    // 3. Renderiza
    if (finalResults.length === 0) {
        // Mensagem inteligente de "Não encontrado"
        if (activeTagFilter && searchTerm) {
             resultsContainer.innerHTML = `<div class="list-group-item bg-transparent text-secondary border-0 small">Não achei "${searchTerm}" dentro de "${activeTagFilter}".</div>`;
        } else if (activeTagFilter) {
             resultsContainer.innerHTML = `<div class="list-group-item bg-transparent text-secondary border-0 small">Nenhum produto com a etiqueta "${activeTagFilter}".</div>`;
        }
        return; 
    }
    
    // Limita a 15 resultados
    finalResults.slice(0, 15).forEach(product => { 
        const a = document.createElement('a'); 
        a.href = '#'; 
        a.className = 'list-group-item list-group-item-action border-bottom border-secondary border-opacity-10'; 
        a.style.backgroundColor = 'var(--glass-bg)';
        a.style.color = 'var(--text-color)';
        a.innerHTML = `<div class="d-flex justify-content-between"><span>${escapeHtml(product.nome)}</span> <span class="fw-bold text-success">${(product.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></div>`; 
        a.onclick = (e) => { e.preventDefault(); onItemClick(product); }; 
        resultsContainer.appendChild(a); 
    }); 
}

function setupFuse() {
    fuse = new Fuse(products, {
        keys: ['nome'],
        includeScore: true,
        // CONFIGURAÇÃO TURBINADA:
        threshold: 0.2,       // Deixamos bem mais rigoroso (antes era 0.3).
        ignoreLocation: true, // O SEGREDO: Ignora se tem emoji no começo, foca só se as letras batem.
        minMatchCharLength: 2,
        useExtendedSearch: true // Entende melhor palavras separadas
    });
}


let currentEditingProductId = null;

// --- DADOS DAS BANDEIRAS (Correção para o botão funcionar) ---
const flagData = {
    visa: { name: 'Visa', icon: 'bi-credit-card-2-front' },
    mastercard: { name: 'Mastercard', icon: 'bi-credit-card-2-back' },
    hiper: { name: 'Hiper', icon: 'bi-credit-card' },
    hipercard: { name: 'Hipercard', icon: 'bi-credit-card' },
    elo: { name: 'Elo', icon: 'bi-credit-card' },
    amex: { name: 'Amex', icon: 'bi-credit-card' }
};

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
    const container = document.getElementById('stockTableBody');
    if (!container) return;
    
    // --- CÓDIGO NOVO: ATUALIZA A BARRA DE PROGRESSO ---
    // 1. Pega apenas produtos que contam (ignora os "ignorarContagem")
    const totalInventory = products.filter(p => !p.ignorarContagem);
    const totalCount = totalInventory.length;
    
    // 2. Conta quantos desses estão marcados no checkedItems
    const checkedCount = totalInventory.reduce((acc, p) => {
        return acc + (checkedItems[p.id]?.checked ? 1 : 0);
    }, 0);

    // 3. Calcula a porcentagem
    const percent = totalCount > 0 ? (checkedCount / totalCount) * 100 : 0;

    // 4. Atualiza a tela
    const bar = document.getElementById('stockProgressBar');
    const text = document.getElementById('stockProgressText');
    
    if (bar) bar.style.width = `${percent}%`;
    if (text) text.innerHTML = `<span style="color: var(--text-color);">${checkedCount}</span> de ${totalCount} conferidos (${Math.round(percent)}%)`;
    // --------------------------------------------------

    const sortedList = [...list].sort((a, b) => {
        const aIsChecked = checkedItems[a.id]?.checked || false;
        const bIsChecked = checkedItems[b.id]?.checked || false;
        if (aIsChecked !== bIsChecked) {
            return aIsChecked ? 1 : -1;
        }
        return a.nome.localeCompare(b.nome);
    });
    
    if (sortedList.length === 0) {
        container.innerHTML = `<div class="text-center p-5"><i class="bi bi-box-seam" style="font-size: 3rem; color: var(--text-secondary);"></i><h5 class="mt-3">Nenhum produto para exibir.</h5><p class="text-secondary">Verifique os filtros ou adicione produtos na Administração.</p></div>`;
    } else {
        container.innerHTML = sortedList.map(product => {
            const isChecked = checkedItems[product.id]?.checked || false;
            const cardClass = isChecked ? 'is-checked' : 'not-checked';
            return `
            <div class="stock-item-card ${cardClass}" data-id="${product.id}">
                <div class="stock-item-main">
                    <div class="product-info">
                        <div class="product-name">${escapeHtml(product.nome)}</div>
                        <div class="product-colors-display">${(product.cores || []).map(cor => `<div class="color-swatch-sm" style="background-color:${cor.hex};" title="${cor.nome}"></div>`).join('')}</div>
                    </div>
                    <div class="form-check form-switch d-flex align-items-center">
                        <input class="form-check-input stock-checked-toggle" type="checkbox" title="Marcar como conferido" id="check-${product.id}" data-id="${product.id}" ${isChecked ? 'checked' : ''}>
                    </div>
                </div>
                <div class="stock-item-controls">
                    <div class="input-group input-group-sm">
                        <button class="btn btn-outline-secondary stock-qty-btn" data-change="-1" aria-label="Diminuir">-</button>
                        <input type="number" class="form-control text-center stock-qty-input px-1" value="${product.quantidade || 0}" min="0" step="1" style="max-width: 70px;">
                        <button class="btn btn-outline-secondary stock-qty-btn" data-change="1" aria-label="Aumentar">+</button>
                    </div>
                    <div class="d-flex align-items-center gap-2">
                        <button class="btn btn-sm btn-secondary open-color-picker-btn" data-id="${product.id}" title="Editar Cores"><i class="bi bi-palette-fill"></i></button>
                        <button class="btn btn-sm btn-secondary ignore-toggle-btn" data-id="${product.id}" title="${product.ignorarContagem ? 'Mostrar na contagem' : 'Ignorar na contagem'}">
                            <i class="bi ${product.ignorarContagem ? 'bi-eye-slash-fill' : 'bi-eye-fill'}"></i>
                        </button>
                    </div>
                </div>
            </div>`;
        }).join('');
    }
}


function filterStockProducts() {
    const searchTerm = document.getElementById('stockSearchInput').value;
    let baseList;
    
    // Filtra primeiro quem está ignorado ou não
    if (onlyShowIgnored) {
        baseList = products.filter(p => p.ignorarContagem);
    } else {
        baseList = products.filter(p => !p.ignorarContagem);
    }

    // Configuração de busca ESPECIAL para o estoque (Mais exata)
    const fuseInstance = new Fuse(baseList, { 
        keys: ['nome'], 
        threshold: 0.2,       // Rigoroso: Evita mostrar "X7" quando digita "F7"
        ignoreLocation: true, // Ignora os emojis atrapalhando o começo da frase
        useExtendedSearch: true 
    });

    // Se não tiver nada escrito, mostra tudo. Se tiver, usa a busca inteligente.
    const filtered = !searchTerm ? baseList : fuseInstance.search(searchTerm).map(r => r.item);
    
    renderStockList(filtered);
}


function generateStockReport() {
    const reportPreview = document.getElementById('reportPreview');
    const visibleProducts = onlyShowIgnored ? products.filter(p => p.ignorarContagem) : products.filter(p => !p.ignorarContagem);
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
                </tr>`;
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
        </div>`).join('');
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
    </div>`).join('');
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
    document.getElementById('aparelhoQuantity').value = favData.quantity || 1;
    aparelhoQuantity = favData.quantity || 1;
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
    
    const entrada = parseFloat(document.getElementById('valorEntrada').value) || 0;
    const numParcelas = parseInt(document.getElementById('numeroParcelas').value, 10) || 0;
    const tipoParcela = document.getElementById('tipoParcela').value;
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
    
    const today = new Date();
    const dateOptions = { day: '2-digit', month: 'long', year: 'numeric' };
    document.getElementById('previewLocalData').textContent = `Goiânia, ${today.toLocaleDateString('pt-BR', dateOptions)}`;
}

// --- CARREGAR CONFIGURAÇÕES (ATUALIZADO) ---
// --- CARREGAR CONFIGURAÇÕES (ATUALIZADO COM IMAGENS) ---
function loadSettingsFromDB() {
    if (!db || !isAuthReady) return;
    onValue(ref(db, 'settings'), (snapshot) => {
        if (snapshot.exists()) {
            receiptSettings = snapshot.val();
        }
        
        // Preenche Texto
        const headerInput = document.getElementById('settingHeaderInput');
        const termsInput = document.getElementById('settingTermsInput');
        const msgInput = document.getElementById('settingEmailMsgInput');
        
        if (headerInput) headerInput.value = receiptSettings.header || '';
        if (termsInput) termsInput.value = receiptSettings.terms || '';
        if (msgInput) msgInput.value = receiptSettings.emailMessage || '';

        // Preenche Imagens (Preview)
        const imgLogo = document.getElementById('previewLogo');
        const imgSig = document.getElementById('previewSignature');

        if (imgLogo && receiptSettings.logoBase64) {
            imgLogo.src = receiptSettings.logoBase64;
            imgLogo.style.display = 'block';
        }
        if (imgSig && receiptSettings.signatureBase64) {
            imgSig.src = receiptSettings.signatureBase64;
            imgSig.style.display = 'block';
        }
    });
}


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

function setupNotificationListeners() {
    const todayStr = new Date().toISOString().split('T')[0];

    const generalNotifsRef = ref(db, 'scheduled_notifications');
    if (generalNotificationsListener) off(generalNotifsRef, 'value', generalNotificationsListener);
    generalNotificationsListener = onValue(generalNotifsRef, (snapshot) => {
        let generalNotifications = [];
        if (snapshot.exists()) {
            const data = snapshot.val();
            Object.keys(data).forEach(key => {
                const notif = data[key];
                if (notif.date === todayStr) {
                    generalNotifications.push({
                        isGeneral: true,
                        message: `<div class="d-flex align-items-start"><i class="bi bi-megaphone-fill me-2 text-info"></i> <div style="white-space: pre-wrap;"><strong>Aviso:</strong> ${escapeHtml(notif.text)}</div></div>`
                    });
                }
            });
        }
        checkForDueInstallments(generalNotifications);
    });
}

function checkForDueInstallments(initialNotifications = []) {
    if (!db || !isAuthReady) return;
    const boletosRef = ref(db, 'boletos');
    
    // 1. Carrega a lista de notificações que ESSE usuário já limpou
    const dismissedKey = 'ctwDismissedNotifs';
    let dismissedList = [];
    try {
        dismissedList = JSON.parse(safeStorage.getItem(dismissedKey) || '[]');
    } catch (e) {
        dismissedList = [];
    }

    if (installmentNotificationsListener) off(boletosRef, 'value', installmentNotificationsListener);
    
    installmentNotificationsListener = onValue(boletosRef, (snapshot) => {
        const notifications = [...initialNotifications];
        
        if (snapshot.exists()) {
            const data = snapshot.val();
            
            // Datas para comparação (Zerar horas para comparar apenas dia/mês/ano)
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const yesterday = new Date(today);
            yesterday.setDate(today.getDate() - 1); // Pega o dia de ontem

            for (const key in data) {
                const boleto = data[key];
                const baseDate = boleto.primeiroVencimento ? new Date(boleto.primeiroVencimento + 'T00:00:00') : new Date(boleto.criadoEm);
                
                for (let i = 0; i < boleto.numeroParcelas; i++) {
                    let dueDate;
                    // Lógica de cálculo da data
                    if(boleto.primeiroVencimento) {
                        dueDate = new Date(baseDate);
                        if (boleto.tipoParcela === 'mensais') {
                            dueDate.setMonth(baseDate.getMonth() + i);
                        } else {
                            dueDate.setDate(baseDate.getDate() + (i * 7));
                        }
                    } else {
                        dueDate = new Date(baseDate);
                        if (boleto.tipoParcela === 'mensais') {
                            dueDate.setMonth(baseDate.getMonth() + i + 1);
                        } else {
                            dueDate.setDate(baseDate.getDate() + ((i + 1) * 7));
                        }
                    }
                    dueDate.setHours(0, 0, 0, 0);
                    
                    // 2. Verifica se vence HOJE ou venceu ONTEM
                    const isToday = dueDate.getTime() === today.getTime();
                    const isYesterday = dueDate.getTime() === yesterday.getTime();

                    if (isToday || isYesterday) {
                        const notificationId = `${key}_${i}`; // ID único: idBoleto + numeroParcela
                        
                        // 3. Só mostra se o usuário NÃO limpou essa notificação antes
                        if (!dismissedList.includes(notificationId)) {
                            const timeText = isToday ? '<span class="text-warning fw-bold">Vence Hoje</span>' : '<span class="text-danger fw-bold">Venceu Ontem</span>';
                            
                            notifications.push({
                                isGeneral: false,
                                notificationId: notificationId,
                                boletoId: key,
                                message: `<strong>${escapeHtml(boleto.compradorNome)}:</strong> Parcela ${i + 1}/${boleto.numeroParcelas}. ${timeText}`
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
        
        notificationList.innerHTML = notifications.map(notif => {
            if (notif.isGeneral) {
                return `<div class="list-group-item bg-transparent text-light border-secondary">${notif.message}</div>`;
            } else {
                // DESIGN NOVO: Botão redondo, discreto e alinhado
                return `
                <div class="list-group-item list-group-item-action notification-item d-flex justify-content-between align-items-center bg-transparent border-secondary text-light p-3 mb-2" id="notif-item-${notif.notificationId}" style="border-radius: 12px; border: 1px solid rgba(255,255,255,0.1) !important;">
                    <div class="flex-grow-1 pe-3" style="cursor: pointer;" onclick="verBoletoDeNotificacao('${notif.boletoId}')">
                        ${notif.message}
                    </div>
                    <button class="dismiss-notif-btn text-secondary" data-id="${notif.notificationId}" title="Limpar notificação" style="background: rgba(255,255,255,0.05); border: none; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.2s;">
                        <i class="bi bi-x-lg" style="font-size: 0.9rem;"></i>
                    </button>
                </div>`;
            }
        }).join('') + '<div class="text-secondary small text-center mt-3" style="opacity: 0.6;">As notificações limpas somem apenas para você.</div>';
        
        // Lógica do botão limpar
        document.querySelectorAll('.dismiss-notif-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const notifId = e.currentTarget.dataset.id;
                
                // Salva no LocalStorage
                const dismissedKey = 'ctwDismissedNotifs';
                let dismissedList = [];
                try { dismissedList = JSON.parse(safeStorage.getItem(dismissedKey) || '[]'); } catch(err) { dismissedList = []; }

                if (!dismissedList.includes(notifId)) {
                    dismissedList.push(notifId);
                    safeStorage.setItem(dismissedKey, JSON.stringify(dismissedList));
                }

                // Efeito visual de remover
                const itemRow = document.getElementById(`notif-item-${notifId}`);
                if (itemRow) {
                    itemRow.style.opacity = '0';
                    setTimeout(() => itemRow.remove(), 300);
                }

                // Atualiza o contador
                const currentCount = parseInt(badge.textContent || '0');
                const newCount = Math.max(0, currentCount - 1);
                if (newCount > 0) {
                    badge.textContent = newCount;
                } else {
                    badge.classList.add('hidden');
                    notificationList.innerHTML = '<div class="list-group-item bg-transparent text-secondary text-center border-0 p-4">Nenhuma notificação pendente.</div>';
                }
            });
        });

    } else {
        badge.classList.add('hidden');
        notificationList.innerHTML = '<div class="list-group-item bg-transparent text-secondary text-center border-0 p-4">Nenhuma notificação pendente.</div>';
    }
}
// --- FUNÇÕES RECUPERADAS (ESSENCIAIS PARA O ADMIN) ---
function getTagList() {
    return (typeof tags !== 'undefined' && Array.isArray(tags)) ? tags : ['Nenhuma'];
}

async function saveTagList(newTags) {
    try {
        await update(ref(db), { 'tags': newTags });
        tags = newTags;
        populateTagSelects();
        if (typeof renderSearchChips === 'function') renderSearchChips(); 
    } catch (error) {
        console.error("Erro ao salvar tags:", error);
        showCustomModal({ message: "Erro ao salvar etiquetas." });
    }
}

function populateTagSelects() {
    const tagList = getTagList();
    const newProductSelect = document.getElementById('newProductTag');
    if (newProductSelect) {
        const currentVal = newProductSelect.value;
        newProductSelect.innerHTML = tagList.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
        if (tagList.includes(currentVal)) newProductSelect.value = currentVal;
    }
}

async function updateTagNameInProducts(oldName, newName) {
    if (!products || products.length === 0) return;
    const updates = {};
    products.forEach(p => {
        if (p.tag === oldName) {
            updates[`products/${p.id}/tag`] = newName;
        }
    });
    if (Object.keys(updates).length > 0) {
        await update(ref(db), updates);
    }
}
// -----------------------------------------------------

function renderTagManagementUI() {
    const container = document.getElementById('adminTagsContent');
    if (!container) return;
    const tags = getTagList();

    const optionsHtml = `
    <div class="admin-section w-100">
        <h4 class="text-start"><i class="bi bi-clipboard-check-fill"></i> Opções de Cópia</h4>
        <div class="form-check form-switch bg-dark p-3 rounded-3 mb-4 d-flex justify-content-between align-items-center">
            <label class="form-check-label" for="invertCopyOrderToggle">
                <strong class="fs-5">Inverter Ordem do Texto Copiado</strong>
                <p class="text-secondary small mb-0">Coloca o nome do produto antes dos valores da parcela.</p>
            </label>
            <input class="form-check-input" type="checkbox" role="switch" id="invertCopyOrderToggle" style="width: 4em; height: 2em;">
        </div>
    </div>
    `;

    let tagsHtml = tags.map(tag => {
        if (tag === 'Nenhuma') return '';
        const savedText = tagTexts[tag] || '';
        return `
        <div class="p-3 mb-2 rounded" style="background-color: rgba(0,0,0,0.2);">
            <div class="mb-2">
                <label class="form-label small">Nome da Etiqueta</label>
                <input type="text" class="form-control form-control-sm tag-name-input" value="${escapeHtml(tag)}" data-original-name="${escapeHtml(tag)}">
            </div>
            <div class="mb-3">
                <label class="form-label small">Texto Personalizado</label>
                <textarea class="form-control form-control-sm tag-text-input" rows="3" placeholder="Texto para ${escapeHtml(tag)}">${escapeHtml(savedText)}</textarea>
            </div>
            <div class="text-end">
                <button class="btn btn-sm btn-outline-danger delete-tag-btn" data-tag="${escapeHtml(tag)}"><i class="bi bi-trash"></i></button>
                <button class="btn btn-sm btn-primary save-tag-btn" data-tag="${escapeHtml(tag)}"><i class="bi bi-save-fill"></i> Salvar</button>
            </div>
        </div>
        `;
    }).join('');
    
    container.innerHTML = `
    ${optionsHtml}
    <div class="admin-section w-100">
        <h4 class="text-start"><i class="bi bi-tags-fill"></i> Gerenciar Etiquetas e Textos</h4>
        <p class="text-start text-secondary">Adicione, edite ou remova etiquetas e seus textos personalizados.</p>
        <div class="p-3 mb-4 rounded" style="background-color: rgba(0,0,0,0.2);">
            <form id="addTagForm">
                <label class="form-label">Adicionar Nova Etiqueta</label>
                <div class="d-flex gap-2">
                    <input type="text" class="form-control" id="newTagName" placeholder="Nome da nova etiqueta" required>
                    <button type="submit" class="btn btn-success"><i class="bi bi-plus-lg"></i> Adicionar</button>
                </div>
            </form>
        </div>
        <div id="tag-editor-list">
            ${tagsHtml}
        </div>
    </div>
    `;

    const invertToggle = document.getElementById('invertCopyOrderToggle');
    if (invertToggle) {
        invertToggle.checked = safeStorage.getItem('ctwInvertCopyOrder') === 'true';
        invertToggle.addEventListener('change', () => {
            safeStorage.setItem('ctwInvertCopyOrder', invertToggle.checked);
            showCustomModal({ message: `Ordem de cópia ${invertToggle.checked ? 'ATIVADA' : 'DESATIVADA'}.` });
        });
    }
}


// --- FUNÇÃO PARA DESENHAR OS CHIPS DE FILTRO ---
function renderSearchChips() {
    const container = document.getElementById('searchChipsContainer');
    const searchInput = document.getElementById('aparelhoSearch');
    if (!container) return;

    const activeTags = (typeof tags !== 'undefined' ? tags : []).filter(t => t !== 'Nenhuma');

    if (activeTags.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    container.innerHTML = '';

    activeTags.forEach(tag => {
        const btn = document.createElement('button');
        btn.className = 'chip-btn';
        if (activeTagFilter === tag) btn.classList.add('active'); // Mantém aceso se já estava
        btn.textContent = tag;
        
        btn.addEventListener('click', () => {
            // 1. Lógica de Alternar (Ligar/Desligar)
            if (activeTagFilter === tag) {
                activeTagFilter = null; // Desliga se clicar no mesmo
                btn.classList.remove('active');
            } else {
                activeTagFilter = tag; // Liga o novo
                // Apaga luz dos outros
                container.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
            
            // 2. Dispara a busca (Agora usando o filtro real)
            // Mesmo que o input esteja vazio, ele vai filtrar pela tag
            const currentSearchTerm = searchInput.value;
            displayDynamicSearchResults(currentSearchTerm, 'aparelhoResultsContainer', handleProductSelectionForAparelho);
        });
        
        container.appendChild(btn);
    });
}


function loadTagsFromDB() {
    if (!db || !isAuthReady) return;
    const tagsRef = ref(db, 'tags');
    if (tagsListener) off(tagsRef, 'value', tagsListener);
    
    tagsListener = onValue(tagsRef, (snapshot) => {
        if (snapshot.exists()) {
            tags = snapshot.val();
            if (!Array.isArray(tags) || !tags.includes('Nenhuma')) {
                // Se der erro no formato, reseta para o básico
                tags = ['Nenhuma', 'Apple', 'Samsung', 'Xiaomi', 'Motorola'];
            }
        } else {
            tags = ['Nenhuma', 'Apple', 'Samsung', 'Xiaomi', 'Motorola'];
            update(ref(db), { 'tags': tags });
        }
        
        // Atualiza os selects do Admin
        if (typeof populateTagSelects === 'function') populateTagSelects(); 
        
        // Atualiza a tela de Admin se estiver aberta
        if (document.getElementById('adminTagsContent') && !document.getElementById('adminTagsContent').classList.contains('hidden')) {
            renderTagManagementUI();
        }

        // NOVO: Atualiza os Chips na calculadora
        renderSearchChips();

    }, (error) => {
        console.error("Firebase Read Error (Tags):", error);
        tags = [];
    });
}


function renderScheduledNotificationsAdminList() {
    const listContainer = document.getElementById('scheduledNotificationsList');
    if (!listContainer) return;
    const notifsRef = ref(db, 'scheduled_notifications');
    
    onValue(notifsRef, (snapshot) => {
        listContainer.innerHTML = '';
        if (snapshot.exists()) {
            const data = snapshot.val();
            const notificationsArray = Object.keys(data).map(key => ({ id: key, ...data[key] }));
            notificationsArray.sort((a, b) => new Date(b.date) - new Date(a.date));

            if (notificationsArray.length === 0) {
                 listContainer.innerHTML = '<p class="text-secondary text-center">Nenhuma notificação agendada.</p>';
                 return;
            }
            listContainer.innerHTML = notificationsArray.map(notif => `
                <div class="d-flex justify-content-between align-items-center p-3 border-bottom" style="border-color: var(--glass-border) !important;">
                    <div>
                        <p class="mb-1" style="white-space: pre-wrap;"><strong>${escapeHtml(notif.text)}</strong></p>
                        <small class="text-secondary">Para o dia: ${new Date(notif.date + 'T12:00:00').toLocaleDateString('pt-BR')}</small>
                    </div>
                    <button class="btn btn-sm btn-outline-danger delete-notification-btn" data-id="${notif.id}"><i class="bi bi-trash"></i></button>
                </div>
            `).join('');
        } else {
            listContainer.innerHTML = '<p class="text-secondary text-center">Nenhuma notificação agendada.</p>';
        }
    });
}
function loadTagTexts() {
    try {
        const stored = safeStorage.getItem(TAG_TEXTS_KEY);
        tagTexts = stored ? JSON.parse(stored) : {};
    } catch (e) {
        console.error("Erro ao carregar textos das etiquetas:", e);
        tagTexts = {};
    }
}

// --- FUNÇÕES DE TEMA DE COR ---
function applyColorTheme(color) {
    // Remove qualquer cor anterior
    document.body.removeAttribute('data-color');
    
    // Se não for 'red' (padrão), aplica a nova cor
    if (color && color !== 'red') {
        document.body.setAttribute('data-color', color);
    }
    
    // Salva na memória
    safeStorage.setItem('ctwColorTheme', color);
    
    // Atualiza visual dos botões no modal (Checkmark)
    document.querySelectorAll('.theme-option-btn').forEach(btn => {
        btn.innerHTML = ''; // Limpa ícones antigos
        btn.classList.remove('active');
        if (btn.dataset.color === color) {
            btn.classList.add('active');
            btn.innerHTML = '<i class="bi bi-check-lg"></i>';
        }
    });
}
async function main() {
    try {
        setupPWA();
        applyTheme(safeStorage.getItem('theme') || 'dark');
        applyColorTheme(safeStorage.getItem('ctwColorTheme') || 'red');

        app = initializeApp(firebaseConfig); 
        auth = getAuth(app); 
        db = getDatabase(app);
        
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
                isAuthReady = true;
                
                // Carrega tudo
                loadRatesFromDB();
                loadProductsFromDB();
                loadTagsFromDB();
                loadTagTexts();
                loadSettingsFromDB(); 
                setupNotificationListeners();
                
                const loadingOverlay = document.getElementById('loadingOverlay');
                if(loadingOverlay) loadingOverlay.style.opacity = '0';
                
                // Lógica Simples de Navegação
                const lastSection = safeStorage.getItem('ctwLastSection');
                
                if (lastSection && lastSection !== 'main') {
                    showMainSection(lastSection);
                } else {
                    showMainSection('main');
                }

                setTimeout(() => {
                    if(loadingOverlay) loadingOverlay.style.display = 'none';
                }, 500);
            } else {
                await signInAnonymously(auth);
            }
        });
    } catch (error) { 
        console.error("Erro:", error); 
    }
}

    

document.addEventListener('DOMContentLoaded', () => {
    const notificationOffcanvasEl = document.getElementById('notificationPanel');
    const notificationOffcanvas = bootstrap.Offcanvas.getOrCreateInstance(notificationOffcanvasEl);
    
        // --- CORREÇÃO VISUAL: ESCONDER CONTROLES QUANDO A ABA ABRIR ---
    const controlsPanel = document.getElementById('top-right-controls');
    
    notificationOffcanvasEl.addEventListener('show.bs.offcanvas', () => {
        // Esconde suavemente o sino e o tema
        if(controlsPanel) {
            controlsPanel.style.opacity = '0';
            controlsPanel.style.pointerEvents = 'none'; // Impede cliques acidentais
        }
    });
    
    notificationOffcanvasEl.addEventListener('hidden.bs.offcanvas', () => {
        // Mostra de volta quando fechar
        if(controlsPanel) {
            controlsPanel.style.opacity = '1';
            controlsPanel.style.pointerEvents = 'auto';
        }
    });
    // -------------------------------------------------------------

        // --- LÓGICA DE MÁSCARA DE DINHEIRO (R$) AO VIVO ---
    
    const moneyInput = document.getElementById('editPriceInput');

    moneyInput.addEventListener('input', (e) => {
        let value = e.target.value;
        
        // 1. Remove tudo que não for dígito (0-9)
        value = value.replace(/\D/g, "");
        
        // 2. Divide por 100 para considerar os centavos
        // Ex: se digitou "259900", vira 2599.00
        const floatValue = (parseFloat(value) / 100);
        
        if(isNaN(floatValue)) {
            e.target.value = "";
            return;
        }

        // 3. Formata como moeda brasileira
        e.target.value = floatValue.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        });
    });

    // --- AJUSTE NO BOTÃO "CONFIRMAR" PARA LER O VALOR FORMATADO ---
    
    // ATENÇÃO: Você precisa substituir o seu listener do "confirmEditPriceBtn" antigo por este novo,
    // pois agora ele precisa "limpar" o R$ antes de salvar no banco de dados.

    // Remova o listener antigo do 'confirmEditPriceBtn' e coloque este:
       // ATUALIZAÇÃO: BOTÃO "CONFIRMAR EDIÇÃO DE PREÇO" (Salva no Banco de Dados)
    document.getElementById('confirmEditPriceBtn').addEventListener('click', async () => {
        const index = document.getElementById('editPriceProductIndex').value;
        const itemCarrinho = carrinhoDeAparelhos[index]; // O item no carrinho
        const productId = itemCarrinho.id; // Precisamos do ID para salvar no banco
        
        // Pega o valor do campo e limpa a formatação (R$)
        let rawValue = document.getElementById('editPriceInput').value;
        rawValue = rawValue.replace(/\D/g, ""); // Remove tudo que não é número
        const cleanValue = parseFloat(rawValue) / 100;

        if (!isNaN(cleanValue) && cleanValue > 0) {
            try {
                // 1. ATUALIZA NO BANCO DE DADOS (Oficial)
                await updateProductInDB(productId, { valor: cleanValue });

                // 2. Atualiza o item que já está no carrinho localmente para refletir a mudança
                itemCarrinho.valor = cleanValue;

                // 3. Atualiza também na lista geral de produtos (na memória) para buscas futuras
                const produtoNaMemoria = products.find(p => p.id === productId);
                if (produtoNaMemoria) {
                    produtoNaMemoria.valor = cleanValue;
                }

                // 4. Recalcula e redesenha a tela
                renderCarrinho();
                calculateAparelho();
                
                closePriceModal();
                showCustomModal({ message: "Preço atualizado no sistema com sucesso!" });

            } catch (error) {
                console.error(error);
                showCustomModal({ message: "Erro ao salvar no banco de dados." });
            }
        } else {
            showCustomModal({ message: "Valor inválido." });
        }
    });


    
    
    document.getElementById('notification-bell').addEventListener('click', () => notificationOffcanvas.toggle());
    
    // LISTENER PARA O NOVO CARD (Cores e Preço)
        // LISTENER ATUALIZADO PARA O CARRINHO UNIFICADO
    // Mudamos de 'aparelhoInfoNote' para 'carrinhoAparelhosContainer'
        // LISTENER DO CARRINHO (Editar Valor, Editar Cores E FAVORITAR)
    const carrinhoContainer = document.getElementById('carrinhoAparelhosContainer');
    
    if (carrinhoContainer) {
        carrinhoContainer.addEventListener('click', (e) => {
            // 1. Botão Editar Cores
            const colorBtn = e.target.closest('.edit-colors-btn');
            if (colorBtn) { 
                e.preventDefault(); 
                openColorPicker(colorBtn.dataset.id); 
                return;
            }

            // 2. Botão Editar Valor
            const priceBtn = e.target.closest('.edit-price-btn');
            if (priceBtn) {
                e.preventDefault();
                const index = priceBtn.dataset.index;
                const item = carrinhoDeAparelhos[index];
                document.getElementById('editPriceInput').value = item.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                document.getElementById('editPriceProductIndex').value = index;
                document.getElementById('editPriceModalOverlay').classList.add('active');
                setTimeout(() => document.getElementById('editPriceInput').focus(), 100);
                return;
            }

            // 3. NOVO: Botão Salvar Favorito (A Estrelinha)
            const favBtn = e.target.closest('.save-favorite-shortcut');
            if (favBtn) {
                e.preventDefault();
                const favorites = getAparelhoFavorites();
                
                // Limite de favoritos (opcional, mas bom ter)
                if (Object.keys(favorites).length >= 5) {
                    showCustomModal({ message: `Limite de 5 favoritos atingido. Remova um antigo para salvar este.` });
                    return;
                }

                // Abre o modal para dar nome
                document.getElementById('favoriteNameInput').value = ''; 
                document.getElementById('favoriteNameModalOverlay').classList.add('active');
                setTimeout(() => document.getElementById('favoriteNameInput').focus(), 100);
            }
        });
    }



    // Lógica do Modal de Editar Preço
    const closePriceModal = () => document.getElementById('editPriceModalOverlay').classList.remove('active');
    document.getElementById('cancelEditPriceBtn').addEventListener('click', closePriceModal);
    
    document.getElementById('confirmEditPriceBtn').addEventListener('click', () => {
        const index = document.getElementById('editPriceProductIndex').value;
        const newVal = parseFloat(document.getElementById('editPriceInput').value);
        if (!isNaN(newVal) && newVal > 0) {
            carrinhoDeAparelhos[index].valor = newVal; // Atualiza valor
            renderCarrinho();
            calculateAparelho();
            // Atualiza visualmente o preço no card
            const cardPriceEl = document.querySelector('.product-action-header .text-success');
            if(cardPriceEl) cardPriceEl.textContent = newVal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            closePriceModal();
            showCustomModal({ message: "Valor atualizado!" });
        } else {
            showCustomModal({ message: "Valor inválido." });
        }
    });
    
    document.getElementById('notificationList').addEventListener('click', (e) => {
        const item = e.target.closest('.notification-item');
        if (item) {
            e.preventDefault();
            const boletoId = item.dataset.boletoId;
            const notificationId = item.dataset.notificationId;
            const todayStr = new Date().toISOString().split('T')[0];
            const viewedNotifsKey = `viewedNotifications_${todayStr}`;
            let viewedNotifs = JSON.parse(safeStorage.getItem(viewedNotifsKey) || '[]');
            
            if (!viewedNotifs.includes(notificationId)) {
                viewedNotifs.push(notificationId);
                safeStorage.setItem(viewedNotifsKey, JSON.stringify(viewedNotifs));
            }
            item.remove();
            
            const badge = document.querySelector('#notification-bell .notification-badge');
            const currentCount = parseInt(badge.textContent || '0');
            const newCount = Math.max(0, currentCount - 1);

            if (newCount > 0) {
                badge.textContent = newCount;
            } else {
                badge.classList.add('hidden');
                const hasGeneralNotifications = !!document.querySelector('#notificationList .list-group-item:not(.notification-item)');
                if (!hasGeneralNotifications) {
                    document.getElementById('notificationList').innerHTML = '<div class="list-group-item text-center">Nenhuma notificação hoje.</div>';
                }
            }
            
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

    const savedTheme = safeStorage.getItem('theme') || 'dark';
    applyTheme(savedTheme);
    themeToggleCheckbox.addEventListener('change', toggleTheme);

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

    document.getElementById('backFromStock').addEventListener('click', () => showMainSection('main'));
    document.getElementById('backFromAdmin').addEventListener('click', () => showMainSection('main'));

    // ... outros botões acima ...
    document.getElementById('backFromStock').addEventListener('click', () => showMainSection('main'));
    
    // ESTA É A LINHA DE REFERÊNCIA 👇
    document.getElementById('backFromAdmin').addEventListener('click', () => showMainSection('main'));

    // =======================================================
    // >>> COLE O BLOCO 3 AQUI (NESSE ESPAÇO) <<<
    // =======================================================

    // --- BOTÕES DA TELA DE CLIENTES ---

    // 1. Botão que está DENTRO da Administração para ir aos Clientes
    const btnAdminClients = document.getElementById('btnAdminClients');
    if (btnAdminClients) {
        btnAdminClients.addEventListener('click', () => {
            showMainSection('clients');
        });
    }

    // 2. Botão Voltar (Da tela de Clientes volta para Administração)
    const btnBackFromClients = document.getElementById('backFromClients');
    if (btnBackFromClients) {
        btnBackFromClients.addEventListener('click', () => {
            showMainSection('administracao'); 
        });
    }

    // 3. Campo de Busca na tabela
    const clientSearchInput = document.getElementById('clientSearchInput');
    if (clientSearchInput) {
        clientSearchInput.addEventListener('input', (e) => {
            renderClientsTable(e.target.value);
        });
    }
    
    // 4. Botão Importar (Ainda sem função, só avisa)
    const btnImport = document.getElementById('btnImportClients');
    if(btnImport) {
        btnImport.addEventListener('click', () => {
            showCustomModal({ message: "Aguarde o próximo passo para importar CSV!" });
        });
    }
    // =======================================================

    // ... o resto do código continua (goToAdminFromEmptyState etc) ...
    document.getElementById('goToAdminFromEmptyState').addEventListener('click', () => showMainSection('administracao'));

    document.getElementById('goToAdminFromEmptyState').addEventListener('click', () => showMainSection('administracao'));
    // Botão Voltar do Sub-menu da Calculadora
    document.getElementById('backFromCalculatorHome').addEventListener('click', () => showMainSection('main'));

    ['openFecharVenda', 'openRepassarValores', 'openCalcularEmprestimo', 'openCalcularPorAparelho'].forEach(id => { document.getElementById(id).addEventListener('click', () => openCalculatorSection(id.replace('open', '').charAt(0).toLowerCase() + id.slice(5))); });
    ['backFromFecharVenda', 'backFromRepassarValores', 'backFromCalcularEmprestimo', 'backFromCalcularPorAparelho'].forEach(id => { document.getElementById(id).addEventListener('click', () => openCalculatorSection('calculatorHome')); });

    const installmentsSlider = document.getElementById('installments1');
    const installmentsValueDisplay = document.getElementById('installments1Value');
    installmentsSlider.addEventListener('input', () => {
        const value = installmentsSlider.value;
        installmentsValueDisplay.textContent = (value === '0') ? 'Débito' : `${value}x`;
        updateFecharVendaUI();
    });

    document.getElementById('machine1').addEventListener('change', (event) => { // Adicionamos o 'event'
    updateInstallmentsOptions(); 
    updateFecharVendaUI(); 
    // Adicionamos a checagem 'event.isTrusted'
    if(event.isTrusted && document.getElementById('machine1').value !== 'pagbank') {
        openFlagModal(document.getElementById('machine1'));
    } 
});
    document.getElementById('brand1').addEventListener('change', updateFecharVendaUI);
    document.getElementById('vendaModeToggle').addEventListener('change', updateFecharVendaUI);
    document.querySelectorAll('input[name="manualMode"]').forEach(radio => radio.addEventListener('change', updateFecharVendaUI));
    document.getElementById('vendaProdutoSearch').addEventListener('input', () => displayDynamicSearchResults(document.getElementById('vendaProdutoSearch').value, 'vendaSearchResultsContainer', handleProductSelectionForVenda));
    document.getElementById('fecharVendaValue').addEventListener('input', calculateFecharVenda);
    document.getElementById('resultFecharVenda').addEventListener('change', e => { if (e.target && e.target.id === 'descontarFoneCheckbox') calculateFecharVenda(); });
    document.getElementById('entradaAVistaCheckbox').addEventListener('change', toggleEntradaAVistaUI);
    document.getElementById('valorEntradaAVista').addEventListener('input', calculateFecharVenda);
    document.getElementById('valorPassadoNoCartao').addEventListener('input', calculateFecharVenda);

    document.getElementById('aparelhoSearch').addEventListener('input', () => {
        const searchTerm = document.getElementById('aparelhoSearch').value;
        if (currentlySelectedProductForCalc && searchTerm !== currentlySelectedProductForCalc.nome) {
            currentlySelectedProductForCalc = null;
        }
        displayDynamicSearchResults(searchTerm, 'aparelhoResultsContainer', handleProductSelectionForAparelho);
    });
    document.getElementById('entradaAparelho').addEventListener('input', calculateAparelho);
    document.getElementById('valorExtraAparelho').addEventListener('input', calculateAparelho);
    document.getElementById('toggleValorExtraBtn').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const container = document.getElementById('valorExtraContainer');
        btn.classList.toggle('is-active');
        container.classList.toggle('is-active');
    });

    document.getElementById('machine3').addEventListener('change', (event) => {
    updateCalcularPorAparelhoUI(); 
    if(event.isTrusted && document.getElementById('machine3').value !== 'pagbank') {
        openFlagModal(document.getElementById('machine3'));
    }
});
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

    // --- CÓDIGO DO PASSO 3: Lógica de Seleção Múltipla e Cópia (CORRIGIDO) ---

    // 1. Cria o Botão Flutuante (se ainda não existir)
    let fab = document.getElementById('fabCopyMulti');
    
    if (!fab) {
        fab = document.createElement('button');
        fab.id = 'fabCopyMulti';
        fab.className = 'btn btn-primary';
        fab.innerHTML = '<i class="bi bi-clipboard-check"></i> Copiar Seleção';
        // CORREÇÃO: Força ele a começar invisível
        fab.style.display = 'none'; 
        document.body.appendChild(fab);
        
        // Ação do Botão Flutuante
        fab.addEventListener('click', () => {
            const selectedRows = document.querySelectorAll('#resultCalcularPorAparelho .copyable-row.is-selected');
            if (selectedRows.length === 0) return;

            // Coleta dados
            let simulations = [];
            selectedRows.forEach(row => {
                const inst = row.dataset.installments;
                const parc = parseFloat(row.dataset.parcela).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                
                let lineText = '';
                if (inst === 'Débito') {
                    lineText = `Débito: ${parc}`;
                } else {
                    lineText = `${inst}x de ${parc}`; 
                }
                simulations.push(lineText);
            });

            // Monta o bloco com "Ou"
            let simulationBlock = simulations.map((text, index) => {
                return index === 0 ? text : `Ou ${text}`;
            }).join('\n');

            // Dados do Produto
            const productCounts = carrinhoDeAparelhos.reduce((acc, product) => {
                acc[product.nome] = (acc[product.nome] || 0) + 1;
                return acc;
            }, {});
            const produtoNome = Object.entries(productCounts)
                .map(([nome, qtd]) => qtd > 1 ? `${qtd}x ${nome}` : nome)
                .join(' e ');

            // Dados da Entrada
            const entradaValue = parseFloat(document.getElementById('entradaAparelho').value) || 0;
            let entradaText = '';
            if (entradaValue > 0) {
                const entradaFormatted = entradaValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                entradaText = `\n*_+${entradaFormatted} no dinheiro ou pix_*`;
            }

            // Dados da Etiqueta
            let customText = '';
            if (carrinhoDeAparelhos.length === 1) {
                const produtoUnico = carrinhoDeAparelhos[0];
                if (produtoUnico.tag && produtoUnico.tag !== 'Nenhuma' && tagTexts[produtoUnico.tag]) {
                    customText = `\n\n${tagTexts[produtoUnico.tag]}`;
                }
            }

            // Montagem Final
            let textToCopy;
            const invertOrder = safeStorage.getItem('ctwInvertCopyOrder') === 'true';
            
            if (invertOrder) {
                textToCopy = `${produtoNome}\n${simulationBlock}${entradaText}${customText}`;
            } else {
                textToCopy = `${simulationBlock}${entradaText}\n\n${produtoNome}${customText}`;
            }

            // Copiar
            const textArea = document.createElement("textarea");
            textArea.value = textToCopy;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                showCustomModal({ message: 'Simulações copiadas!' });
            } catch (err) {
                showCustomModal({ message: 'Erro ao copiar.' });
            }
            document.body.removeChild(textArea);
            
            // Limpa a seleção e esconde o botão
            selectedRows.forEach(r => r.classList.remove('is-selected'));
            fab.style.display = 'none';
        });
    }

    // 2. O Novo Event Listener da Tabela
    document.getElementById('resultCalcularPorAparelho').addEventListener('click', (e) => {
        const toggle = document.getElementById('multiSelectToggle');
        const isMultiMode = toggle && toggle.checked;
        const row = e.target.closest('.copyable-row');
        
        if (!row || carrinhoDeAparelhos.length === 0) return;

        if (isMultiMode) {
            // MODO SELEÇÃO MÚLTIPLA
            row.classList.toggle('is-selected');
            
            const count = document.querySelectorAll('#resultCalcularPorAparelho .copyable-row.is-selected').length;
            const fabBtn = document.getElementById('fabCopyMulti');
            
            // CORREÇÃO: Só mostra se count > 0
            if (count > 0) {
                fabBtn.style.display = 'block';
                fabBtn.innerHTML = `<i class="bi bi-clipboard-check"></i> Copiar (${count})`;
            } else {
                fabBtn.style.display = 'none';
            }
            
        } else {
            // MODO CLÁSSICO (Cópia única)
            // Esconde o botão múltiplo se alguém clicar no modo simples por engano
            document.getElementById('fabCopyMulti').style.display = 'none';
            document.querySelectorAll('#resultCalcularPorAparelho .copyable-row.is-selected').forEach(r => r.classList.remove('is-selected'));

            // Lógica original de cópia única...
            const installments = row.dataset.installments;
            const parcelaValue = parseFloat(row.dataset.parcela);
            const totalValue = parseFloat(row.dataset.total);
            const entradaValue = parseFloat(document.getElementById('entradaAparelho').value) || 0;
            
            const parcelaFormatted = parcelaValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const totalFormatted = totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            
            const productCounts = carrinhoDeAparelhos.reduce((acc, product) => {
                acc[product.nome] = (acc[product.nome] || 0) + 1;
                return acc;
            }, {});
            const produtoNome = Object.entries(productCounts)
                .map(([nome, qtd]) => qtd > 1 ? `${qtd}x ${nome}` : nome)
                .join(' e ');

            let entradaText = '';
            if (entradaValue > 0) {
                const entradaFormatted = entradaValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                entradaText = `\n*_+${entradaFormatted} no dinheiro ou pix_*`;
            }
            
            let customText = '';
            if (carrinhoDeAparelhos.length === 1) {
                const produtoUnico = carrinhoDeAparelhos[0];
                if (produtoUnico.tag && produtoUnico.tag !== 'Nenhuma' && tagTexts[produtoUnico.tag]) {
                    customText = `\n\n${tagTexts[produtoUnico.tag]}`;
                }
            }
            
            let textToCopy;
            const invertOrder = safeStorage.getItem('ctwInvertCopyOrder') === 'true';
            const simulationBlock = `${installments}x ${parcelaFormatted}\n_(Total: ${totalFormatted})_${entradaText}`;
            
            if (invertOrder) {
                textToCopy = `${produtoNome}\n${simulationBlock}${customText}`;
            } else {
                textToCopy = `${simulationBlock}\n ${produtoNome}${customText}`;
            }
            
            const textArea = document.createElement("textarea");
            textArea.value = textToCopy;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            showCustomModal({ message: 'Simulação copiada!' });
        }
    });

    // CORREÇÃO EXTRA: Esconder o botão ao sair da seção
    // Procure no seu código onde tem "backFromCalcularPorAparelho"
    // e adicione essa linha dentro do evento de click:
    document.getElementById('backFromCalcularPorAparelho').addEventListener('click', () => {
         const fabBtn = document.getElementById('fabCopyMulti');
         if(fabBtn) fabBtn.style.display = 'none';
         // Limpa seleções visuais
         document.querySelectorAll('.copyable-row.is-selected').forEach(r => r.classList.remove('is-selected'));
    });

    ['resultRepassarValores', 'resultCalcularEmprestimo'].forEach(containerId => {
        document.getElementById(containerId).addEventListener('click', (e) => {
            const row = e.target.closest('.copyable-row');
            if (!row) return;

            const installments = row.dataset.installments;
            const parcelaValue = parseFloat(row.dataset.parcela);
            const totalValue = parseFloat(row.dataset.total);
            
            const parcelaFormatted = parcelaValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const totalFormatted = totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

            const textToCopy = `${installments}x de ${parcelaFormatted}\n_(Total: ${totalFormatted})_`;
            
            const textArea = document.createElement("textarea");
            textArea.value = textToCopy;
            textArea.style.position = "fixed";
            textArea.style.top = "0";
            textArea.style.left = "0";
            textArea.style.opacity = "0";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                const successful = document.execCommand('copy');
                if (successful) {
                    showCustomModal({ message: 'Simulação copiada!' });
                } else {
                    showCustomModal({ message: 'Falha ao copiar.' });
                }
            } catch (err) {
                console.error('Erro ao copiar:', err);
                showCustomModal({ message: 'Erro ao copiar.' });
            }
            document.body.removeChild(textArea);
        });
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
    
        // --- CORREÇÃO DO BOTÃO SALVAR FAVORITO ---
    document.getElementById('confirmSaveFavoriteBtn').addEventListener('click', () => {
        const favoriteName = document.getElementById('favoriteNameInput').value.trim();
        const favorites = getAparelhoFavorites();

        // 1. Validação do Nome
        if (!favoriteName) {
            showCustomModal({ message: "Por favor, digite um nome para o favorito." });
            return;
        }
        if (favorites[favoriteName]) {
            showCustomModal({ message: "Já existe um favorito com este nome. Escolha outro." });
            return;
        }

        // 2. Validação do Carrinho (Precisa ter algo na tela pra salvar)
        if (carrinhoDeAparelhos.length === 0) {
             showCustomModal({ message: "Não há nenhum produto na tela para salvar." });
             closeFavoriteNameModal();
             return;
        }

        // 3. Monta os dados do Favorito baseados no PRIMEIRO item do carrinho
        // (Assumindo que o atalho é focado no produto principal)
        const produtoPrincipal = carrinhoDeAparelhos[0];

        const favoriteData = {
            productName: produtoPrincipal.nome, // Pega o nome real do objeto, não da busca
            entryValue: parseFloat(document.getElementById('entradaAparelho').value) || 0,
            additionalValue: parseFloat(document.getElementById('valorExtraAparelho').value) || 0,
            // Salvamos também o preço editado, caso você tenha mudado
            savedPrice: produtoPrincipal.valor 
        };

        // 4. Salva e Atualiza
        favorites[favoriteName] = favoriteData;
        saveAparelhoFavorites(favorites);
        renderAparelhoFavorites();
        
        closeFavoriteNameModal();
        showCustomModal({ message: "Atalho salvo com sucesso!" });
    });

    
    cancelSaveFavoriteBtn.addEventListener('click', closeFavoriteNameModal);
    favoriteNameModal.addEventListener('click', (e) => { if (e.target === favoriteNameModal) closeFavoriteNameModal(); });

   document.getElementById('machine2').addEventListener('change', (event) => {
    updateRepassarValoresUI(); 
    if(event.isTrusted && document.getElementById('machine2').value !== 'pagbank') {
        openFlagModal(document.getElementById('machine2'));
    }
});
    document.getElementById('brand2').addEventListener('change', updateRepassarValoresUI);
    document.getElementById('repassarValue').addEventListener('input', calculateRepassarValores);

// --- OUVINTES DO LUCRO EXTRA (REPASSAR) ---
const inputRepassarExtra = document.getElementById('repassarExtra');
if (inputRepassarExtra) {
    // Garante que o valor 40 esteja lá
    if(!inputRepassarExtra.value) inputRepassarExtra.value = "40";
    inputRepassarExtra.addEventListener('input', calculateRepassarValores);
}

const btnToggleRepassar = document.getElementById('toggleRepassarExtraBtn');
if (btnToggleRepassar) {
    btnToggleRepassar.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const container = document.getElementById('repassarExtraContainer');
        btn.classList.toggle('is-active');
        container.classList.toggle('is-active');
    });
}




    document.getElementById('emprestimoValue').addEventListener('input', calculateEmprestimo);
    document.getElementById('machine4').addEventListener('change', (event) => {
    updateCalcularEmprestimoUI(); 
    if(event.isTrusted && document.getElementById('machine4').value !== 'pagbank') {
        openFlagModal(document.getElementById('machine4'));
    }
});
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
        const tag = document.getElementById('newProductTag').value;
        
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
        
        const newProduct = { nome, valor, quantidade, cores, ignorarContagem: false, tag: tag };
        
        try {
            await push(getProductsRef(), newProduct);
            showCustomModal({ message: `Produto "${nome}" adicionado com sucesso!`});
            e.target.reset();
            document.getElementById('newProductTag').value = 'Nenhuma';
        } catch (error) {
            showCustomModal({ message: `Erro ao adicionar produto: ${error.message}` });
        }
    });

    document.getElementById('deleteAllProductsBtn').addEventListener('click', deleteAllProducts);
        // --- C: SALVAR CONFIGURAÇÕES DE RECIBO ---
        // --- BOTÃO SALVAR CONFIGURAÇÕES (ATUALIZADO) ---
        // --- BOTÃO SALVAR CONFIGURAÇÕES (ATUALIZADO COM UPLOAD) ---
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', () => {
            showCustomModal({
                message: "Senha de Administrador:",
                showPassword: true,
                confirmText: "Salvar",
                onConfirm: async (password) => {
                    if (password === "220390") {
                        const btnOriginalText = saveSettingsBtn.innerHTML;
                        saveSettingsBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Salvando...';
                        
                        try {
                            const header = document.getElementById('settingHeaderInput').value;
                            const terms = document.getElementById('settingTermsInput').value;
                            const emailMessage = document.getElementById('settingEmailMsgInput').value;

// LINHA NOVA CORRIGIDA:
let updates = { header, terms, emailMessage, shareMessage: emailMessage };


                            // Processa Logo (se tiver selecionado nova)
                            const logoInput = document.getElementById('uploadLogoInput');
                            if (logoInput.files && logoInput.files[0]) {
                                const logoBase64 = await processarImagemParaBase64(logoInput.files[0], 300); // Max 300px
                                updates.logoBase64 = logoBase64;
                            }

                            // Processa Assinatura (se tiver selecionado nova)
                            const sigInput = document.getElementById('uploadSignatureInput');
                            if (sigInput.files && sigInput.files[0]) {
                                const sigBase64 = await processarImagemParaBase64(sigInput.files[0], 300); // Max 300px
                                updates.signatureBase64 = sigBase64;
                            }

                            // Salva no Firebase
                            await update(ref(db, 'settings'), updates);
                            
                            // Atualiza localmente para ver na hora
                            receiptSettings = { ...receiptSettings, ...updates };
                            
                            showCustomModal({ message: "Configurações e Imagens salvas!" });
                            saveSettingsBtn.innerHTML = btnOriginalText;

                        } catch (error) {
                            console.error(error);
                            showCustomModal({ message: "Erro ao salvar: " + error.message });
                            saveSettingsBtn.innerHTML = btnOriginalText;
                        }
                    } else {
                        showCustomModal({ message: "Senha incorreta." });
                    }
                },
                onCancel: () => {}
            });
        });
    }


    const productsListContainer = document.getElementById('productsListContainer');
    productsListContainer.addEventListener('click', e => {
        const header = e.target.closest('.admin-product-header');
        if (header) {
            e.preventDefault();
            const accordionItem = header.parentElement;
            if (!accordionItem.classList.contains('is-open')) {
                const openItems = productsListContainer.querySelectorAll('.admin-product-accordion.is-open');
                openItems.forEach(item => {
                    if (item !== accordionItem) {
                        item.classList.remove('is-open');
                    }
                });
            }
            accordionItem.classList.toggle('is-open');
            return;
        }

        const deleteBtn = e.target.closest('.delete-product-btn');
        if (deleteBtn) {
            e.preventDefault();
            const id = deleteBtn.dataset.id;
            showCustomModal({ message: "Excluir este produto?", onConfirm: async () => await remove(ref(db, `products/${id}`)), onCancel: () => {} });
            return;
        }
    });
    
    productsListContainer.addEventListener('change', e => {
        if (e.target.matches('.form-control, .form-select')) {
            const card = e.target.closest('.admin-product-accordion');
            if (card) {
                const { field } = e.target.dataset;
                const id = card.dataset.id;
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

    
    //comeco
    
    // --- D: NAVEGAÇÃO DO ADMIN (ATUALIZADA) ---
document.getElementById('admin-nav-buttons').addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    const buttonElement = e.target;
    const targetId = buttonElement.dataset.adminSection;

    if (buttonElement.classList.contains('active')) return;

    const switchAdminTab = (id, btn) => {
        // Esconde todas as abas
        document.getElementById('adminProductsContent').classList.add('hidden');
        document.getElementById('adminRatesContent').classList.add('hidden');
        document.getElementById('adminTagsContent').classList.add('hidden');
        document.getElementById('adminNotificationsContent').classList.add('hidden');
        document.getElementById('adminSettingsContent').classList.add('hidden'); // NOVA ABA

        // Remove active dos botões
        document.querySelectorAll('#admin-nav-buttons button').forEach(b => b.classList.remove('active'));

        // Mostra a aba certa
        document.getElementById(id).classList.remove('hidden');
        btn.classList.add('active');

        if (id === 'adminRatesContent') renderRatesEditor();
        if (id === 'adminTagsContent') renderTagManagementUI();
        if (id === 'adminNotificationsContent') renderScheduledNotificationsAdminList();

        // Se abriu a aba de config, preenche os dados
        if (id === 'adminSettingsContent') {
            document.getElementById('settingHeaderInput').value = receiptSettings.header || '';
            document.getElementById('settingTermsInput').value = receiptSettings.terms || '';
        }
    };

    if (targetId === 'adminNotificationsContent' || targetId === 'adminSettingsContent') {
        // Pede senha para Notificações E Configurações
        showCustomModal({
            message: "Acesso Restrito. Senha:",
            showPassword: true,
            confirmText: "Acessar",
            onConfirm: (password) => {
                if (password === "220390") {
                    switchAdminTab(targetId, buttonElement);
                } else {
                    showCustomModal({ message: "Senha incorreta." });
                }
            },
            onCancel: () => {}
        });
    } else {
        switchAdminTab(targetId, buttonElement);
    }
});

    
    
    document.getElementById('scheduleNotificationForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = document.getElementById('notificationText').value.trim();
        const date = document.getElementById('notificationDate').value;
        if (!text || !date) {
            showCustomModal({ message: "Por favor, preencha o texto e a data." });
            return;
        }
        const newNotification = {
            text: text,
            date: date,
            createdAt: new Date().toISOString()
        };
        try {
            await push(ref(db, 'scheduled_notifications'), newNotification);
            showCustomModal({ message: "Notificação agendada com sucesso!" });
            e.target.reset();
        } catch (error) {
            showCustomModal({ message: `Erro ao agendar: ${error.message}` });
        }
    });
    
    document.getElementById('administracao').addEventListener('click', e => {
        const deleteBtn = e.target.closest('.delete-notification-btn');
        if (deleteBtn) {
            const notifId = deleteBtn.dataset.id;
            showCustomModal({
                message: "Tem certeza que deseja apagar esta notificação?",
                confirmText: "Apagar",
                onConfirm: async () => {
                    await remove(ref(db, `scheduled_notifications/${notifId}`));
                    showCustomModal({ message: "Notificação apagada." });
                },
                onCancel: () => {}
            });
        }
    });

    document.getElementById('administracao').addEventListener('submit', e => {
        if (e.target.id === 'addTagForm') {
            e.preventDefault();
            const input = document.getElementById('newTagName');
            const newTag = input.value.trim();
            if (newTag && newTag.toLowerCase() !== "nenhuma") {
                const currentTags = getTagList();
                if (!currentTags.find(t => t.toLowerCase() === newTag.toLowerCase())) {
                    saveTagList([...currentTags, newTag]);
                    input.value = '';
                } else {
                    showCustomModal({ message: 'Essa etiqueta já existe.' });
                }
            }
        }
    });
    
    document.getElementById('administracao').addEventListener('click', e => {
        const deleteBtn = e.target.closest('.delete-tag-btn');
        const saveBtn = e.target.closest('.save-tag-btn');
        if (deleteBtn) {
            const tagToDelete = deleteBtn.dataset.tag;
            showCustomModal({
                message: "Digite a senha de administrador para excluir.",
                showPassword: true,
                confirmText: "Confirmar",
                onConfirm: (password) => {
                    if (password !== "220390") {
                        showCustomModal({ message: "Senha incorreta." });
                        return;
                    }
                    showCustomModal({
                        message: `Tem certeza que quer remover a etiqueta "${tagToDelete}"?`,
                        confirmText: 'Remover',
                        onConfirm: async () => {
                            let currentTags = getTagList();
                            currentTags = currentTags.filter(t => t !== tagToDelete);
                            await saveTagList(currentTags);
                            delete tagTexts[tagToDelete];
                            safeStorage.setItem(TAG_TEXTS_KEY, JSON.stringify(tagTexts));
                        },
                        onCancel: () => {}
                    });
                },
                onCancel: () => {}
            });
        }
        if (saveBtn) {
            const originalName = saveBtn.dataset.tag;
            const container = saveBtn.closest('div.p-3');
            const newNameInput = container.querySelector('.tag-name-input');
            const newName = newNameInput.value.trim();
            if(originalName !== newName) {
                showCustomModal({
                    message: "Digite a senha de administrador para editar o nome.",
                    showPassword: true,
                    confirmText: "Confirmar",
                    onConfirm: (password) => {
                        if (password !== "220390") {
                            showCustomModal({ message: "Senha incorreta." });
                            newNameInput.value = originalName;
                            return;
                        }
                        saveTagChanges(originalName, container);
                    },
                    onCancel: () => {
                        newNameInput.value = originalName;
                    }
                });
            } else {
                saveTagChanges(originalName, container);
            }
        }
    });
    
    async function saveTagChanges(originalName, container) {
        const newName = container.querySelector('.tag-name-input').value.trim();
        const newText = container.querySelector('.tag-text-input').value.trim();
        
        if (!newName) {
            showCustomModal({ message: 'O nome da etiqueta não pode ficar em branco.' });
            return;
        }
        
        const currentTags = getTagList();
        if (newName !== originalName && currentTags.find(t => t.toLowerCase() === newName.toLowerCase())) {
            showCustomModal({ message: 'Já existe uma etiqueta com esse nome.' });
            return;
        }
        
        const index = currentTags.indexOf(originalName);
        if (index > -1) {
            currentTags[index] = newName;
        }
        
        delete tagTexts[originalName];
        tagTexts[newName] = newText;
        await saveTagList(currentTags);
        safeStorage.setItem(TAG_TEXTS_KEY, JSON.stringify(tagTexts));
        
        if (originalName !== newName) {
            await updateTagNameInProducts(originalName, newName);
        } else {
            showCustomModal({ message: 'Etiqueta salva!' });
        }
    }

    const flagModalOverlay = document.getElementById('flagSelectorModalOverlay');
    document.getElementById('closeFlagModalBtn').addEventListener('click', closeFlagModal);
    flagModalOverlay.addEventListener('click', (e) => { if (e.target === flagModalOverlay) closeFlagModal(); });
    ['flagDisplayButton1', 'flagDisplayButton2', 'flagDisplayButton3', 'flagDisplayButton4'].forEach(id => { document.getElementById(id).addEventListener('click', (e) => { const sectionNumber = id.replace('flagDisplayButton', ''); openFlagModal(document.getElementById(`machine${sectionNumber}`)); }); });

    document.addEventListener('click', (e) => { document.querySelectorAll('.search-wrapper').forEach(wrapper => { if (!wrapper.contains(e.target)) { const resultsContainer = wrapper.querySelector('.search-results-container'); if (resultsContainer) resultsContainer.innerHTML = ''; } }); });

    document.getElementById('stockSearchInput').addEventListener('input', filterStockProducts);
    document.getElementById('generateReportBtn').addEventListener('click', generateStockReport);
    document.getElementById('toggleIgnoredBtn').addEventListener('click', (e) => {
        onlyShowIgnored = !onlyShowIgnored;
        const btn = e.currentTarget;
        const icon = btn.querySelector('i');
        document.getElementById('stockSearchInput').value = '';
        if (onlyShowIgnored) {
            btn.title = "Mostrar produtos visíveis";
            icon.className = 'bi bi-eye-fill';
            btn.classList.add('active');
        } else {
            btn.title = "Mostrar produtos ignorados";
            icon.className = 'bi bi-eye-slash-fill';
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
        const card = inputElement.closest('.stock-item-card');
        if (!card) return;
        const id = card.dataset.id;
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
                        if (e.target.classList.contains('stock-checked-toggle')) {
                const id = e.target.dataset.id;
                const isChecked = e.target.checked;
                if (isChecked) {
                    const timestamp = Date.now();
                    checkedItems[id] = { checked: true, timestamp: timestamp };
                    updateProductInDB(id, { lastCheckedTimestamp: timestamp });
                    // Adiciona a notificação toast
                    const product = products.find(p => p.id === id);
                    if (product) {
                        showCustomModal({ message: `Produto "${product.nome}" conferido e salvo!`});
                    }
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
            const ignoreBtn = e.target.closest('.ignore-toggle-btn');
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
            if (ignoreBtn) {
                const id = ignoreBtn.dataset.id;
                const product = products.find(p => p.id === id);
                if (product) {
                    const newIgnoredState = !product.ignorarContagem;
                    updateProductInDB(id, { ignorarContagem: newIgnoredState });
                }
            }
        });
    }

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
        // --- CORREÇÃO: SALVAR COR E ATUALIZAR O CARRINHO IMEDIATAMENTE ---
    document.getElementById('saveColorPicker').addEventListener('click', () => {
        if (currentEditingProductId) {
            const newTimestamp = Date.now();
            
            // 1. Atualiza no Banco de Dados (Para o futuro)
            updateProductInDB(currentEditingProductId, { 
                cores: tempSelectedColors,
                lastCheckedTimestamp: newTimestamp
            });
            
            // 2. Atualiza o produto que JÁ ESTÁ no carrinho (Para o presente)
            // Percorre o carrinho e atualiza todos os itens que têm esse ID
            let houveMudancaNoCarrinho = false;
            carrinhoDeAparelhos.forEach(item => {
                if (item.id === currentEditingProductId) {
                    item.cores = [...tempSelectedColors]; // Copia as cores novas
                    item.lastCheckedTimestamp = newTimestamp;
                    houveMudancaNoCarrinho = true;
                }
            });

            // 3. Se mudou algo no carrinho, redesenha a tela e SALVA O RASCUNHO
            if (houveMudancaNoCarrinho) {
                renderCarrinho();      // Atualiza o visual (ex: Preto -> Verde)
                calculateAparelho();   // Força salvar o rascunho novo no navegador
            }
        }
        document.getElementById('colorPickerModalOverlay').classList.remove('active');
    });


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
                populatePreview();
                document.body.classList.add('print-only-contract');
                window.print();
            })
            .catch((error) => {
                console.error("Erro ao salvar contrato: ", error);
                showCustomModal({ message: `Falha ao salvar o contrato: ${error.message}` });
            });
    });

    document.getElementById('exportRepassarBtn').addEventListener('click', () => {
        exportResultsToImage('resultRepassarValores', 'repassar-valores.png');
    });
       document.getElementById('exportEmprestimoBtn').addEventListener('click', () => {
        const valorBase = parseFloat(document.getElementById('emprestimoValue').value) || 0;
        if (valorBase <= 0) {
            showCustomModal({ message: "Insira um valor base para exportar." });
            return;
        }
        
        // AQUI ESTÁ A MÁGICA: Passamos o texto direto, sem HTML
        const titulo = `VOCÊ RECEBE NA HORA: ${valorBase.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
        
        exportResultsToImage('resultCalcularEmprestimo', 'calculo-emprestimo.png', titulo);
    });

        document.getElementById('exportAparelhoBtn').addEventListener('click', () => {
        if (carrinhoDeAparelhos.length === 0) {
            showCustomModal({ message: "Adicione um aparelho para exportar." });
            return;
        }

        const productCounts = carrinhoDeAparelhos.reduce((acc, product) => {
            acc[product.nome] = (acc[product.nome] || 0) + 1;
            return acc;
        }, {});
        const aparelhoNome = Object.entries(productCounts)
            .map(([nome, qtd]) => qtd > 1 ? `${qtd}x ${nome}` : nome)
            .join(' e ');

        // Passa apenas o nome do aparelho como título
        const fileName = aparelhoNome.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'calculo-aparelho';
        exportResultsToImage('resultCalcularPorAparelho', `${fileName}.png`, aparelhoNome);
    });

    
    window.addEventListener('afterprint', () => {
        document.body.classList.remove('print-only-contract', 'print-only-report');
    });

    main();
    
    const arredondarToggle = document.getElementById('arredondarToggle');
    if (arredondarToggle) {
        arredondarToggle.checked = safeStorage.getItem('ctwArredondarEnabled') === 'true';
        arredondarToggle.addEventListener('change', () => {
            safeStorage.setItem('ctwArredondarEnabled', arredondarToggle.checked);
            showCustomModal({ message: `Arredondamento ${arredondarToggle.checked ? 'ATIVADO' : 'DESATIVADO'}.` });
        });
    }
    
    document.addEventListener('backbutton', function (e) {
        e.preventDefault();
        const currentSection = document.querySelector('.container:not(.hidden):not([style*="display: none"])');
        if (currentSection && currentSection.id !== 'mainMenu' && currentSection.id !== 'calculatorHome') {
            showMainSection('main');
        } else if (currentSection && currentSection.id === 'calculatorHome') {
            showMainSection('main');
        } else {
            if(navigator.app){
                navigator.app.exitApp();
            }
        }
    }, false);
    
    window.addEventListener('popstate', function () {
        const currentSection = document.querySelector('.container:not(.hidden):not([style*="display: none"])');
        if (currentSection && currentSection.id !== 'mainMenu') {
            showMainSection('main');
            history.pushState(null, null, location.href);
        }
    });
    history.pushState(null, null, location.href);

    // Visibility Toggles for Machines
    const DISABLED_MACHINES_KEY = 'disabledMachines';
    function getDisabledMachines() {
        try {
            const disabled = localStorage.getItem(DISABLED_MACHINES_KEY);
            return disabled ? JSON.parse(disabled) : [];
        } catch (e) {
            console.error('Erro ao ler as maquininhas desativadas do localStorage:', e);
            return [];
        }
    }

    function saveDisabledMachines(disabled) {
        try {
            localStorage.setItem(DISABLED_MACHINES_KEY, JSON.stringify(disabled));
        } catch (e) {
            console.error('Erro ao salvar as maquininhas desativadas no localStorage:', e);
        }
    }

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
            if (isSelectedOptionHidden) {
                const firstVisibleOption = select.querySelector('option:not([hidden])');
                if (firstVisibleOption) {
                    select.value = firstVisibleOption.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        });
    }

    function setupVisibilityToggles() {
        const toggles = document.querySelectorAll('.visibility-toggle');
        toggles.forEach(toggle => {
            const machineName = toggle.dataset.machine;
            const disabledMachines = getDisabledMachines();
            toggle.checked = !disabledMachines.includes(machineName);
            toggle.addEventListener('change', () => {
                const currentDisabled = getDisabledMachines();
                if (toggle.checked) {
                    const newDisabled = currentDisabled.filter(m => m !== machineName);
                    saveDisabledMachines(newDisabled);
                } else {
                    if (!currentDisabled.includes(machineName)) {
                        currentDisabled.push(machineName);
                        saveDisabledMachines(currentDisabled);
                    }
                }
                updateMachineVisibility();
            });
        });
    }
    
    setupVisibilityToggles();
    updateMachineVisibility();
    
        // --- LÓGICA DO SELETOR DE TEMAS ---
    const themeModal = document.getElementById('themeSelectorModal');
    
    // Abrir Modal
    const paletteBtn = document.getElementById('theme-palette-btn');
    if (paletteBtn) {
        paletteBtn.addEventListener('click', () => {
            themeModal.classList.add('active');
        });
    }
    
    // Fechar Modal
    const closeThemeBtn = document.getElementById('closeThemeModal');
    if (closeThemeBtn) {
        closeThemeBtn.addEventListener('click', () => {
            themeModal.classList.remove('active');
        });
    }
    
    // Clicar nas cores
    document.querySelectorAll('.theme-option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            applyColorTheme(btn.dataset.color);
            // Pequeno delay para fechar o modal
            setTimeout(() => themeModal.classList.remove('active'), 200);
        });
    });
    
    
    //logica book
    
        // --- LÓGICA DE ABAS (CONTRATO vs BOOKIP) ---
    



    // --- TOGGLE NOVO / HISTÓRICO DO BOOKIP ---
        // --- TOGGLE NOVO / HISTÓRICO DO BOOKIP (CORRIGIDO) ---
    const bookipToggle = document.getElementById('bookipModeToggle');
    // Pegamos o novo container de busca que criamos no HTML
    const searchContainer = document.getElementById('bookipSearchContainer');

    if(bookipToggle) {
        bookipToggle.addEventListener('change', (e) => {
            const showHistory = e.target.checked;
            
            // Alterna as telas principais
            document.getElementById('newBookipContent').classList.toggle('hidden', showHistory);
            document.getElementById('historyBookipContent').classList.toggle('hidden', !showHistory);
            
            // Alterna a barra de busca separadamente (Segurança contra erro de impressão)
            if (searchContainer) {
                searchContainer.classList.toggle('hidden', !showHistory);
            }

            if (showHistory) {
                loadBookipHistory();
            }
        });
    }



    // ============================================================
    // CORREÇÃO: LÓGICA DE BUSCA E ADIÇÃO DE ITENS NO BOOKIP
    // ============================================================
    
    const inputBuscaBookip = document.getElementById('bookipProductSearch');
    const containerResultados = document.getElementById('bookipSearchResults');
    const btnAddLista = document.getElementById('btnAdicionarItemLista');
    const listaVisual = document.getElementById('bookipListaItens');
    const totalDisplay = document.getElementById('bookipTotalDisplay');

    // 1. Lógica da Busca (Consertada)
    if (inputBuscaBookip && containerResultados) {
        inputBuscaBookip.addEventListener('input', (e) => {
            const termo = e.target.value.toLowerCase();
            
            // Se digitar, já joga pro nome do produto caso não selecione nada
            document.getElementById('bookipProdNomeTemp').value = e.target.value;
            
            containerResultados.innerHTML = '';
            
            if (termo.length < 1) {
                containerResultados.style.display = 'none';
                return;
            }

            // Filtra os produtos salvos
            const filtrados = products.filter(p => p.nome.toLowerCase().includes(termo));

            if (filtrados.length > 0) {
                containerResultados.style.display = 'block';
                                filtrados.slice(0, 5).forEach(p => { 
                    const item = document.createElement('a');
                    item.className = 'list-group-item list-group-item-action';
                    // AQUI A CORREÇÃO: Força usar as cores do tema (Fundo do input e Cor do texto)
                    item.style.cssText = "cursor: pointer; background-color: var(--input-bg); color: var(--text-color); border-color: var(--glass-border);";
                    
                    item.innerHTML = `
                        <div class="d-flex justify-content-between align-items-center">
                            <strong>${p.nome}</strong>
                            <span class="fw-bold text-success">R$ ${parseFloat(p.valor).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                        </div>`;
                    
                    item.addEventListener('click', () => {


                                            // AQUI A MÁGICA: Chama a função que limpa o emoji antes de preencher
                    document.getElementById('bookipProdNomeTemp').value = limparTextoEmoji(p.nome);


                        document.getElementById('bookipProdValorTemp').value = p.valor;
                        const cor = (p.cores && p.cores.length > 0) ? p.cores[0].nome : '';
                        document.getElementById('bookipProdCorTemp').value = cor;
                        
                        inputBuscaBookip.value = p.nome;
                        containerResultados.style.display = 'none';
                    });
                    
                    containerResultados.appendChild(item);
                });



            } else {
                containerResultados.style.display = 'none';
            }
        });

        // Fecha a busca se clicar fora
        document.addEventListener('click', (e) => {
            if (!inputBuscaBookip.contains(e.target) && !containerResultados.contains(e.target)) {
                containerResultados.style.display = 'none';
            }
        });
    }

        // ============================================================
    // 2. LÓGICA DE ADICIONAR / EDITAR PRODUTO NA LISTA (ATUALIZADO)
    // ============================================================
    
    if (btnAddLista) {
        btnAddLista.addEventListener('click', (e) => {
            e.preventDefault(); 

            // 1. DESCOBRE O MODO (PRODUTO vs SITUAÇÃO)
            // Tenta pegar o radio selecionado. Se não existir (erro defensivo), assume 'produto'.
            const radioAtivo = document.querySelector('input[name="tipoInput"]:checked');
            const modo = radioAtivo ? radioAtivo.value : 'produto';

            let itemObjeto = null;

            if (modo === 'situacao') {
                // --- MODO SITUAÇÃO: Pega o texto do relato ---
                const campoTexto = document.getElementById('sitDescricao');
                const texto = campoTexto ? campoTexto.value.trim() : "";

                if (!texto) {
                    showCustomModal({ message: "Por favor, descreva a situação ocorrida." });
                    return;
                }

                // Cria o objeto especial "Situação"
                itemObjeto = { 
                    nome: texto, 
                    qtd: 1, 
                    valor: 0, 
                    cor: "", 
                    obs: "", 
                    isSituation: true // <--- A CHAVE QUE O PDF VAI LER PARA MUDAR O VISUAL
                };

                // Limpa o campo de texto após adicionar
                if(campoTexto) campoTexto.value = "";

            } else {
                // --- MODO PRODUTO: Lógica Original ---
                const nomeInput = document.getElementById('bookipProdNomeTemp');
                const qtdInput = document.getElementById('bookipProdQtdTemp');
                const valorInput = document.getElementById('bookipProdValorTemp');
                const corInput = document.getElementById('bookipProdCorTemp');
                const obsInput = document.getElementById('bookipProdObsTemp');

                const nome = nomeInput.value.trim();
                const qtd = parseInt(qtdInput.value) || 1;


                            // --- CORREÇÃO DE VALOR (Lê R$ corretamente) ---
            let valorRaw = valorInput.value;
            let valorFinal = 0;
            
            if (valorRaw.includes(',') || valorRaw.includes('.')) {
                // Tira o ponto de milhar e troca vírgula por ponto (1.500,00 -> 1500.00)
                valorRaw = valorRaw.replace(/\./g, '').replace(',', '.');
                valorFinal = parseFloat(valorRaw);
            } else {
                valorFinal = parseFloat(valorRaw);
            }
            if(isNaN(valorFinal)) valorFinal = 0;
            
            // Agora use 'valorFinal' no seu objeto, em vez de 'valor'
            // Ex: valor: valorFinal,




                const cor = corInput.value;
                const obs = obsInput.value;

                if (!nome) {
                    showCustomModal({ message: "Digite ou busque o nome do produto." });
                    return;
                }

            // CRIA O OBJETO (Corrigido para usar valorFinal)
            itemObjeto = { 
                nome, 
                qtd, 
                valor: valorFinal, // <--- O SEGREDO TÁ AQUI (antes era 'valor')
                cor, 
                obs,
                isSituation: false 
            };


                // Limpa os campos de produto
                if(inputBuscaBookip) inputBuscaBookip.value = '';
                nomeInput.value = '';
                valorInput.value = '';
                corInput.value = '';
                obsInput.value = '';
                qtdInput.value = '1';
            }

            // --- 2. SALVA NA LISTA (Igual para os dois modos) ---

            if (editingItemIndex !== null) {
                // MODO EDIÇÃO: Atualiza o item existente
                bookipCartList[editingItemIndex] = itemObjeto;
                editingItemIndex = null; 
                
                // Reseta o botão para o estado normal
                btnAddLista.innerHTML = '<i class="bi bi-plus-lg"></i> Adicionar à Lista';
                btnAddLista.classList.remove('btn-warning');
                btnAddLista.classList.add('btn-primary');
                
                showCustomModal({ message: "Item atualizado!" });
            } else {
                // MODO NOVO: Adiciona ao final da lista
                bookipCartList.push(itemObjeto);
            }

            // Atualiza o visual da lista na tela
            atualizarListaVisualBookip();
        });
    }


// FERRAMENTA: Limpa Emojis 🧹
function limparTextoEmoji(texto) {
    if (!texto) return "";
    return texto.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '')
                .replace(/\s+/g, ' ').trim();
}

// MÁSCARA: Formata R$ ao digitar 💰
const inputValorBookip = document.getElementById('bookipProdValorTemp');
if (inputValorBookip) {
    inputValorBookip.type = "text"; 
    inputValorBookip.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, ""); // Só números
        if (value === "") { e.target.value = ""; return; }
        // Divide por 100 pra virar centavos
        e.target.value = (parseFloat(value) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    });
}



    // 3. Função para Atualizar a Lista Visual (USANDO SEU CSS NOVO)
    function atualizarListaVisualBookip() {
        if (!listaVisual) return;
        
        listaVisual.innerHTML = ''; 
        let total = 0;

        if (bookipCartList.length === 0) {
            listaVisual.innerHTML = `
                <div class="text-center p-4" style="opacity: 0.6;">
                    <i class="bi bi-cart-x" style="font-size: 2rem;"></i>
                    <p class="mb-0 small text-secondary">Lista vazia.</p>
                </div>`;
        } else {
            bookipCartList.forEach((item, index) => {
                const subtotal = item.valor * item.qtd;
                total += subtotal;

                // Cria o elemento usando as classes do CSS que você acabou de colar
                const li = document.createElement('div');
                li.className = 'bookip-item-card'; 
                
                // Formatação dos detalhes
                let detalhes = [];
                if(item.qtd > 1) detalhes.push(`x${item.qtd}`);
                if(item.cor) detalhes.push(item.cor);
                if(item.obs) detalhes.push(item.obs);
                const detalhesTexto = detalhes.join(' | ');

                li.innerHTML = `
                    <div class="bk-info">
                        <div class="bk-title">${item.nome}</div>
                        <div class="bk-details">${detalhesTexto}</div>
                    </div>

                    <div class="bk-actions-area">
                        <div class="bk-price">R$ ${subtotal.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</div>
                        
                        <div class="bk-buttons">
                            <button class="btn-icon-circle btn-edit-c edit-item-bookip" data-index="${index}" title="Editar">
                                <i class="bi bi-pencil-fill" style="font-size: 0.8rem;"></i>
                            </button>

                            <button class="btn-icon-circle btn-del-c remove-item-bookip" data-index="${index}" title="Remover">
                                <i class="bi bi-trash-fill" style="font-size: 0.8rem;"></i>
                            </button>
                        </div>
                    </div>
                `;
                listaVisual.appendChild(li);
            });
        }

        if (totalDisplay) {
            totalDisplay.innerText = total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        }

        // --- ATIVAR BOTÕES ---

        // 1. Remover
        document.querySelectorAll('.remove-item-bookip').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                // Se estava editando esse, cancela a edição
                if (editingItemIndex === idx) {
                    editingItemIndex = null;
                    btnAddLista.innerHTML = '<i class="bi bi-plus-lg"></i> Adicionar o Produto';
                    btnAddLista.classList.remove('btn-warning');
                    btnAddLista.classList.add('btn-primary');
                    document.getElementById('bookipProdNomeTemp').value = '';
                    document.getElementById('bookipProdValorTemp').value = '';
                }
                
                bookipCartList.splice(idx, 1);
                atualizarListaVisualBookip();
            });
        });

        // 2. Editar (A Lógica do Lápis)
        document.querySelectorAll('.edit-item-bookip').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                const item = bookipCartList[idx];

                // Devolve os dados para os campos de cima
                document.getElementById('bookipProdNomeTemp').value = item.nome;
                document.getElementById('bookipProdQtdTemp').value = item.qtd;
                document.getElementById('bookipProdValorTemp').value = item.valor;
                document.getElementById('bookipProdCorTemp').value = item.cor;
                document.getElementById('bookipProdObsTemp').value = item.obs;

                editingItemIndex = idx; // Marca qual estamos mexendo

                // Muda o botão principal para "Salvar Alteração" (Amarelo)
                btnAddLista.innerHTML = '<i class="bi bi-check-lg"></i> Salvar Alteração';
                btnAddLista.classList.remove('btn-primary');
                btnAddLista.classList.add('btn-warning');

                // Rola a tela para cima suavemente
                document.getElementById('bookipProdNomeTemp').scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        });
    }


    // ============================================================

// CARREGAR HISTÓRICO (VERSÃO MASTER: TUDO INCLUSO 🏆)
// ============================================================
function loadBookipHistory() {
    // Verificações de segurança originais
    if (!db || !isAuthReady) return;
    
    // NOTA: Se o seu banco for separado por usuário, lembre-se de usar 'bookips/' + userId
    // Mas mantive exatamente como você mandou:
    const bookipsRef = ref(db, 'bookips'); 
    const container = document.getElementById('historyBookipContent');
    
    // Variáveis de controle
    let listaCompletaCache = []; 
    let listaFiltradaCache = []; 
    let itensVisiveis = 50;      
    const incremento = 50;       

    // Loading...
    container.innerHTML = '<div class="text-center p-4"><div class="spinner-border text-primary"></div><p class="mt-2 text-secondary">Carregando histórico...</p></div>';

    // Remove listener antigo para não duplicar
    if (typeof bookipListener !== 'undefined' && bookipListener) {
        off(bookipsRef, 'value', bookipListener);
    }

    // Novo Listener do Firebase
    bookipListener = onValue(bookipsRef, (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.val();
            // 1. Transforma em lista
            listaCompletaCache = Object.keys(data).map(key => ({ id: key, ...data[key] }));
            
            // ==========================================================
            // 2. ORDENAÇÃO INTELIGENTE (MODIFICADO AQUI)
            // ==========================================================
            listaCompletaCache.sort((a, b) => {
                // Passo A: Normaliza a Data do Documento (YYYY-MM-DD)
                const getData = (item) => {
                    if (item.dataVenda) return item.dataVenda; 
                    if (item.criadoEm) return new Date(item.criadoEm).toISOString().split('T')[0];
                    return '0000-00-00';
                };

                const dataA = getData(a);
                const dataB = getData(b);

                // PRIORIDADE 1: DATA DO DOCUMENTO
                // Se B for maior (futuro), B vem primeiro
                if (dataB > dataA) return 1;
                if (dataB < dataA) return -1;

                // PRIORIDADE 2: HORA DA CRIAÇÃO (Desempate)
                // Se as datas são iguais, o cadastro mais recente (hora) vem primeiro
                const horaA = a.criadoEm ? new Date(a.criadoEm).getTime() : 0;
                const horaB = b.criadoEm ? new Date(b.criadoEm).getTime() : 0;
                
                return horaB - horaA; 
            });
            // ==========================================================
            
            // 3. Configura e aplica filtros
            configurarFiltros();
            aplicarFiltrosCombinados();
        } else {
            container.innerHTML = '<p class="text-center text-secondary mt-4">Nenhum recibo salvo.</p>';
        }
    });

    // --- FUNÇÕES INTERNAS DE FILTRO ---
    function configurarFiltros() {
        const searchInput = document.getElementById('bookipHistorySearch');
        const dateInput = document.getElementById('bookipHistoryDate');
        const iconDisplay = document.getElementById('calendarIconDisplay');

        if (searchInput) searchInput.oninput = aplicarFiltrosCombinados;
        if (dateInput) {
            dateInput.onchange = aplicarFiltrosCombinados;
            if (iconDisplay && iconDisplay.parentElement) {
                iconDisplay.parentElement.onclick = function() {
                    if (dateInput.showPicker) dateInput.showPicker();
                    else dateInput.focus();
                };
            }
        }
    }

    function aplicarFiltrosCombinados() {
        const elTexto = document.getElementById('bookipHistorySearch');
        const elData = document.getElementById('bookipHistoryDate');
        const elIcone = document.getElementById('calendarIconDisplay');

        const termo = elTexto ? elTexto.value.toLowerCase().trim() : '';
        const dataFiltro = elData ? elData.value : ''; 

        // Visual do ícone de data
        if (elIcone) {
            if (dataFiltro) {
                elIcone.className = "bi bi-calendar-check-fill";
                elIcone.style.color = "var(--primary-color)"; 
                elIcone.style.filter = "drop-shadow(0 0 5px rgba(0,255,0,0.3))";
            } else {
                elIcone.className = "bi bi-calendar-event";
                elIcone.style.color = "rgba(255, 255, 255, 0.5)";
                elIcone.style.filter = "none";
            }
        }

        // Lógica de Filtragem
        listaFiltradaCache = listaCompletaCache.filter(item => {
            const nDoc = (item.docNumber || '').toLowerCase();
            const nome = (item.nome || '').toLowerCase();
            const cpf = (item.cpf || '').toLowerCase();
            const email = (item.email || '').toLowerCase(); 
            const telLimpo = (item.tel || '').toLowerCase().replace(/\D/g, ''); 
            const telOriginal = (item.tel || '').toLowerCase();
            
            const matchTexto = termo === '' || nDoc.includes(termo) || nome.includes(termo) || cpf.includes(termo) || email.includes(termo) || telOriginal.includes(termo) || telLimpo.includes(termo);

            let matchData = true;
            if (dataFiltro) {
                let dataItem = item.dataVenda || '';
                if (!dataItem && item.criadoEm) dataItem = item.criadoEm.split('T')[0];
                matchData = (dataItem === dataFiltro);
            }
            return matchTexto && matchData;
        });

        itensVisiveis = 50; // Reseta paginação ao filtrar
        renderizarLote();
    }

    // --- RENDERIZAÇÃO NA TELA ---
    function renderizarLote() {
        const fatia = listaFiltradaCache.slice(0, itensVisiveis);
        const temMais = listaFiltradaCache.length > itensVisiveis;

        if (fatia.length === 0) {
            container.innerHTML = `<div class="text-center p-4 opacity-75"><i class="bi bi-search" style="font-size: 2rem;"></i><p class="mt-2 text-secondary small">Nada encontrado.</p></div>`;
            return;
        }

        let html = `<div class="accordion w-100 history-accordion" id="bookipAccordion">` + 
        fatia.map(item => {
            let dataVisual = '---';
            if (item.dataVenda) {
                 const p = item.dataVenda.split('-'); 
                 dataVisual = `${p[2]}/${p[1]}/${p[0]}`;
            } else if (item.criadoEm) {
                 dataVisual = new Date(item.criadoEm).toLocaleDateString('pt-BR');
            }
            
            const docNum = item.docNumber || '---';

            // =========================================================
            // LÓGICA DE CORES 🎨
            // =========================================================
            let badgeClass = 'bg-primary'; // Azul (Padrão / Garantia)
            
            // 1. SITUAÇÃO (Prioridade: Amarelo)
            const isSituacao = (item.type === 'situacao') || (item.items && item.items[0] && item.items[0].isSituation);
            
            // 2. RECIBO (Verde)
            const isRecibo = (item.type === 'recibo');

            if (isSituacao) {
                badgeClass = 'bg-warning text-dark'; // Amarelo
            } else if (isRecibo) {
                badgeClass = 'bg-success'; // Verde
            }
            // =========================================================

            // --- CÓDIGO NOVO (Lógica Visual de Envio) ---
            const foiEnviado = (item.statusEnvio === true);
            
            // Define se a borda fica verde e o fundo claro
            const styleCard = foiEnviado ? 'border-left: 6px solid #28a745; background-color: #f0fff4;' : '';
            
            // Define se o botão fica cinza (check) ou amarelo (email)
            const classBtnEnvio = foiEnviado ? 'btn-dark' : 'btn-warning';
            const iconBtnEnvio = foiEnviado ? 'bi-check-circle-fill text-success' : 'bi-envelope-at-fill';
            const titleBtnEnvio = foiEnviado ? 'Já enviado (Reenviar)' : 'PDF/Email';
            // --------------------------------------------


                        return `
            <div class="accordion-item" style="${styleCard}">



                <h2 class="accordion-header" id="head-bk-${item.id}">
                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-bk-${item.id}">
                        <span class="badge ${badgeClass} me-2">Doc ${docNum}</span> 
                        <span class="text-truncate" style="max-width: 150px;">${item.nome}</span> 
                        <span class="ms-auto small text-secondary">${dataVisual}</span>
                    </button>
                </h2>
                <div id="collapse-bk-${item.id}" class="accordion-collapse collapse" data-bs-parent="#bookipAccordion">
                    <div class="accordion-body">
                        <p><strong>Cliente:</strong> ${item.nome}</p>
                        <ul class="list-unstyled small mb-3">
                            ${(item.items || []).map(i => `<li>${i.qtd}x ${i.nome} - R$ ${parseFloat(i.valor).toFixed(2)}</li>`).join('')}
                        </ul>
                        <div class="d-flex justify-content-end gap-2 mt-2">
                            <button class="btn btn-sm btn-info edit-bookip-btn" data-id="${item.id}" title="Editar"><i class="bi bi-pencil-square"></i></button>

<button class="btn btn-sm ${classBtnEnvio} email-history-btn" data-id="${item.id}" title="${titleBtnEnvio}"><i class="bi ${iconBtnEnvio}"></i></button>


                            <button class="btn btn-sm btn-primary print-old-bookip" data-id="${item.id}" title="Imprimir"><i class="bi bi-printer"></i></button>
                            <button class="btn btn-sm btn-outline-danger delete-bookip-btn" data-id="${item.id}" title="Apagar"><i class="bi bi-trash"></i></button>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('') + `</div>`;

        if (temMais) {
            html += `<div class="text-center py-3"><button id="btnLoadMoreBookip" class="btn btn-outline-primary rounded-pill px-4">Ver Mais</button></div>`;
        }

        container.innerHTML = html;
        reativarListeners();
        
        const btnMore = document.getElementById('btnLoadMoreBookip');
        if (btnMore) btnMore.addEventListener('click', () => { itensVisiveis += incremento; renderizarLote(); });
    }

    // --- REATIVAR BOTÕES INTERNOS ---
    function reativarListeners() {
        container.querySelectorAll('.edit-bookip-btn').forEach(b => b.addEventListener('click', e => carregarDadosParaEdicao(listaCompletaCache.find(i => i.id === e.target.closest('button').dataset.id))));
        container.querySelectorAll('.email-history-btn').forEach(b => b.addEventListener('click', e => gerarPdfDoHistorico(listaCompletaCache.find(i => i.id === e.target.closest('button').dataset.id), b)));
        container.querySelectorAll('.print-old-bookip').forEach(b => b.addEventListener('click', e => printBookip(listaCompletaCache.find(i => i.id === e.target.closest('button').dataset.id))));
        container.querySelectorAll('.delete-bookip-btn').forEach(b => b.addEventListener('click', e => {
            const id = e.target.closest('button').dataset.id;
            showCustomModal({message: "Apagar?", confirmText: "Sim", onConfirm: async () => { await remove(ref(db, `bookips/${id}`)); showCustomModal({message: "Apagado."}); }, onCancel: ()=>{}});
        }));
    }
}

    // --- FUNÇÃO AUXILIAR: CARREGAR DADOS NO FORMULÁRIO ---
        // --- FUNÇÃO AUXILIAR: CARREGAR DADOS NO FORMULÁRIO (CORRIGIDA) ---
    function carregarDadosParaEdicao(item) {
        if(!item) return;

        // 1. Marca que estamos editando
        currentEditingBookipId = item.id;

        // 2. Muda visualmente para a aba "Novo"
        const toggle = document.getElementById('bookipModeToggle');
        if(toggle) {
            toggle.checked = false;
            toggle.dispatchEvent(new Event('change'));
        }

        // 3. Preenche os campos do cliente
        const campos = {
            'bookipNome': item.nome,
            'bookipCpf': item.cpf,
            'bookipTelefone': item.tel,
            'bookipEndereco': item.end,
            'bookipEmail': item.email,
            'bookipDataManual': item.dataVenda
        };
        
        for (let id in campos) {
            const el = document.getElementById(id);
            if(el) el.value = campos[id] || '';
        }

        // 4. Preenche a lista de itens
        bookipCartList = item.items || [];
        atualizarListaVisualBookip(); 

        // 5. Pagamento (Checkboxes)
        document.querySelectorAll('.check-pagamento').forEach(chk => chk.checked = false);
        if(item.pagamento) {
            const formas = item.pagamento.split(', ');
            formas.forEach(forma => {
                const chk = Array.from(document.querySelectorAll('.check-pagamento')).find(c => c.value === forma);
                if(chk) chk.checked = true;
            });
        }

        // 6. Garantia
        const selectGarantia = document.getElementById('bookipGarantiaSelect');
        const inputGarantia = document.getElementById('bookipGarantiaCustomInput');
        if(selectGarantia) {
            const dias = parseInt(item.diasGarantia);
            const isPadrao = [30, 120, 180, 365].includes(dias);
            if(isPadrao) {
                selectGarantia.value = dias;
                if(inputGarantia) inputGarantia.classList.add('hidden');
            } else {
                selectGarantia.value = 'custom';
                if(inputGarantia) {
                    inputGarantia.value = dias;
                    inputGarantia.classList.remove('hidden');
                }
            }
        }

        // 7. CORREÇÃO DO ERRO: Muda o botão certo (Adicionar à Lista)
        // Usamos o ID que o sistema realmente usa para adicionar itens
        const btnAdd = document.getElementById('btnAdicionarItemLista');
        if (btnAdd) {
            btnAdd.innerHTML = '<i class="bi bi-pencil-square"></i> Salvar Alteração';
            btnAdd.classList.remove('btn-primary');
            btnAdd.classList.add('btn-warning');
        }

        showCustomModal({ message: "Dados carregados! Edite os itens ou o cliente e salve." });
    }



    // --- LÓGICA DE SALVAR E GARANTIA (NOVO) ---
        // --- LÓGICA DE SALVAR E GARANTIA (NOVO) ---
    const garantiaSelect = document.getElementById('bookipGarantiaSelect');
    const garantiaInput = document.getElementById('bookipGarantiaCustomInput');
    
    if (garantiaSelect && garantiaInput) {
        garantiaSelect.addEventListener('change', () => {
            if (garantiaSelect.value === 'custom') {
                // Remove a classe 'hidden' para mostrar o campo
                garantiaInput.classList.remove('hidden');
                garantiaInput.focus();
            } else {
                // Adiciona a classe 'hidden' para esconder
                garantiaInput.classList.add('hidden');
                garantiaInput.value = ''; // Limpa se esconder
            }
        });
    }





    // ============================================================
// ============================================================
// FLUXO DE GARANTIA LAPIDADO (SALVAR -> DEPOIS OPÇÕES)
// ============================================================

let lastSavedBookipData = null; // Guarda os dados na memória após salvar

// 1. AÇÃO: CLICAR EM "FINALIZAR E SALVAR"
const btnSave = document.getElementById('btnSaveBookip');
if (btnSave) {
    btnSave.addEventListener('click', async () => {
        // Validação Básica
        if (bookipCartList.length === 0) {
            showCustomModal({ message: "A lista está vazia! Adicione itens primeiro." });
            return;
        }

        // Feedback visual
        const originalText = btnSave.innerHTML;
        btnSave.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Salvando...';
        btnSave.disabled = true;

        try {
            // --- BLOCO CIRÚRGICO: CAPTURAR PAGAMENTO ---
            const pags = [];
            document.querySelectorAll('.check-pagamento:checked').forEach(c => pags.push(c.value));
            const txtPag = pags.length > 0 ? pags.join(', ') : 'Não informado';
            // --------------------------------------------

            let dias = 365;
            const sel = document.getElementById('bookipGarantiaSelect').value;
            if (sel === 'custom') dias = parseInt(document.getElementById('bookipGarantiaCustomInput').value) || 0;
            else dias = parseInt(sel);

            const dataManualInput = document.getElementById('bookipDataManual').value;
            const dataFinalVenda = dataManualInput ? dataManualInput : new Date().toISOString().split('T')[0];

            // =========================================================
            // 🧠 NOVIDADE: DETECTA O TIPO DO DOCUMENTO PARA A COR
            // =========================================================
            let docType = 'garantia'; // O padrão é Azul (Garantia)
            
            // 1. Se tiver qualquer item marcado como "Situação", vira Situação (Amarelo)
            const temSituacao = bookipCartList.some(i => i.isSituation === true);
            
            if (temSituacao) {
                docType = 'situacao';
            } 
            // 2. Se não for situação e a chave "Modo Simples" estiver ligada, vira Recibo (Verde)
            else if (window.isSimpleReceiptMode === true) {
                docType = 'recibo';
            }
            // =========================================================

            // ---------------------------------------------------------
            // CORREÇÃO: GERAÇÃO DO NÚMERO DOC (EVITA DUPLICIDADE)
            // ---------------------------------------------------------
            const snapshot = await get(ref(db, 'bookips'));
            let docNumberFormatted = '001';

            if (currentEditingBookipId) {
                // MODO EDIÇÃO: Tenta manter o número original
                if (snapshot.exists()) {
                    const todos = snapshot.val();
                    const itemAtual = todos[currentEditingBookipId];
                    if (itemAtual && itemAtual.docNumber) {
                        docNumberFormatted = itemAtual.docNumber;
                    }
                }
            } else {
                // MODO NOVO: Procura o MAIOR número existente e soma +1
                let maiorNumero = 0;
                
                if (snapshot.exists()) {
                    const todos = snapshot.val();
                    Object.values(todos).forEach(item => {
                        const num = parseInt(item.docNumber || '0', 10);
                        if (!isNaN(num) && num > maiorNumero) {
                            maiorNumero = num;
                        }
                    });
                }
                
                docNumberFormatted = String(maiorNumero + 1).padStart(3, '0');
            }
            // ---------------------------------------------------------

            // Objeto Final
            const dados = {
                docNumber: docNumberFormatted,
                type: docType,
                nome: document.getElementById('bookipNome').value || 'Consumidor',
                cpf: document.getElementById('bookipCpf').value || '',
                tel: document.getElementById('bookipTelefone').value || '',
                end: document.getElementById('bookipEndereco').value || '',
                email: document.getElementById('bookipEmail').value || '',
                items: bookipCartList,
                
                pagamento: txtPag, // <--- ADICIONE ESTA LINHA AQUI
                
                diasGarantia: dias,
                dataVenda: dataFinalVenda,
                criadoEm: new Date().toISOString()
            };

            // SALVA NO FIREBASE
            if (currentEditingBookipId) {
                // Atualiza existente
                await update(ref(db, `bookips/${currentEditingBookipId}`), dados);
                dados.id = currentEditingBookipId;
            } else {
                // Cria novo
                const newRef = await push(ref(db, 'bookips'), dados);
                dados.id = newRef.key;
            }

            // SALVA CLIENTE (ROBÔ)
            await salvarClienteAutomatico({
                nome: dados.nome, cpf: dados.cpf, tel: dados.tel, end: dados.end, email: dados.email
            });

            // SUCESSO!
            lastSavedBookipData = dados; // Guarda na memória

            // Toca vibração se tiver no celular
            if (navigator.vibrate) navigator.vibrate(50);

            // ALTERA A TELA (Esconde Salvar -> Mostra Opções)
            document.getElementById('saveActionContainer').classList.add('hidden');
            document.getElementById('postSaveOptions').classList.remove('hidden');
            
            // Restaura botão salvar
            btnSave.innerHTML = originalText;
            btnSave.disabled = false;

        } catch (error) {
            console.error(error);
            showCustomModal({ message: "Erro ao salvar: " + error.message });
            btnSave.innerHTML = originalText;
            btnSave.disabled = false;
        }
    });
}



// 2. AÇÃO: CLICAR EM "IMPRIMIR" (PÓS-SALVO)
const btnPostPrint = document.getElementById('btnPostPrint');
if (btnPostPrint) {
    btnPostPrint.addEventListener('click', () => {
        if (lastSavedBookipData) {
            printBookip(lastSavedBookipData);
        } else {
            showCustomModal({ message: "Erro: Nenhum dado salvo encontrado." });
        }
    });
}

// 3. AÇÃO: CLICAR EM "COMPARTILHAR / PDF" (PÓS-SALVO)
const btnPostShare = document.getElementById('btnPostShare');
if (btnPostShare) {
    btnPostShare.addEventListener('click', () => {
        if (lastSavedBookipData) {
            // Truque de copiar e-mail antes
            if (lastSavedBookipData.email) {
                navigator.clipboard.writeText(lastSavedBookipData.email).catch(()=>{});
                showCustomModal({ message: "E-mail copiado! Gerando PDF..." });
            }
            
            // Usa a função existente de PDF do histórico
            gerarPdfDoHistorico(lastSavedBookipData, btnPostShare);
        }
    });
}

// 4. AÇÃO: CLICAR EM "COMEÇAR NOVA GARANTIA" (RESETAR)
const btnNewCycle = document.getElementById('btnNewBookipCycle');
if (btnNewCycle) {
    btnNewCycle.addEventListener('click', () => {
        // 1. ESCONDE O POP-UP (Adiciona a classe hidden)
        const popup = document.getElementById('postSaveOptions');
        if(popup) popup.classList.add('hidden');

        // 2. MOSTRA O BOTÃO DE SALVAR DE VOLTA
        const saveContainer = document.getElementById('saveActionContainer');
        if(saveContainer) saveContainer.classList.remove('hidden');

        // 3. LIMPA OS CAMPOS DO FORMULÁRIO
        document.getElementById('bookipNome').value = '';
        document.getElementById('bookipCpf').value = '';
        document.getElementById('bookipTelefone').value = '';
        document.getElementById('bookipEndereco').value = '';
        document.getElementById('bookipEmail').value = '';
        document.getElementById('bookipProductSearch').value = '';
        // Limpa campos temporários de produto também
        document.getElementById('bookipProdNomeTemp').value = '';
        document.getElementById('bookipProdValorTemp').value = '';
        document.getElementById('bookipProdQtdTemp').value = '1';
        
        // 4. LIMPA A LISTA DE PRODUTOS
        bookipCartList = [];
        if(typeof atualizarListaVisualBookip === 'function') atualizarListaVisualBookip();
        
        // 5. RESETA OS CHECKBOXES DE PAGAMENTO
        document.querySelectorAll('.check-pagamento').forEach(c => c.checked = false);
        
        // 6. RESETA VARIÁVEIS INTERNAS
        lastSavedBookipData = null;
        currentEditingBookipId = null; // Sai do modo de edição
        
        // 7. RESETA O TEXTO DO BOTÃO SALVAR (Caso estivesse editando antes)
        const btnSave = document.getElementById('btnSaveBookip');
        if(btnSave) {
            btnSave.innerHTML = '<i class="bi bi-check-circle-fill"></i> Finalizar e Salvar Documento';
            btnSave.classList.remove('btn-info'); // Remove cor azul de edição
            btnSave.classList.add('btn-success'); // Volta para verde
            btnSave.disabled = false;
        }

        // 8. ROLA A TELA SUAVEMENTE PARA O TOPO (Para começar de novo)
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}


// ============================================================
// FUNÇÃO EXTRA: GERAR PDF A PARTIR DO HISTÓRICO


 // --- FUNÇÃO AUXILIAR: REDIMENSIONAR IMAGEM PARA BASE64 ---
function processarImagemParaBase64(file, maxWidth = 300) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scaleSize = maxWidth / img.width;
                canvas.width = maxWidth;
                canvas.height = img.height * scaleSize;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                // Converte para texto (Base64) com qualidade 0.7 para ficar leve
                resolve(canvas.toDataURL('image/png', 0.7)); 
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
}

// --- FUNÇÃO INTELIGENTE: SALVAR/ATUALIZAR CLIENTE ---
// --- FUNÇÃO DEPURADORA: SALVAR CLIENTE COM ALERTAS ---
async function salvarClienteAutomatico(dados) {
    // Alerta 1: Saber se a função foi chamada
    // alert("ROBÔ INICIADO: " + dados.nome); 

    if (!dados.nome) {
        alert("ROBÔ ERRO: Nome vazio!");
        return;
    }

    // 1. Cria ID
    let clienteId = '';
    const cpfLimpo = (dados.cpf || '').replace(/\D/g, '');

    if (cpfLimpo.length > 5) {
        clienteId = cpfLimpo;
    } else {
        const nomeLimpo = dados.nome.toLowerCase().replace(/[^a-z0-9]/g, '');
        const telLimpo = (dados.tel || '').replace(/\D/g, '');
        clienteId = `${nomeLimpo}_${telLimpo}`;
    }

    if (!clienteId) {
        alert("ROBÔ ERRO: Não consegui criar ID (faltou nome/tel/cpf)");
        return;
    }

    // 2. Dados
    const dadosCliente = {
        id: clienteId,
        nome: dados.nome,
        cpf: dados.cpf || '',
        tel: dados.tel || '',
        end: dados.end || '',
        email: dados.email || '',
        ultimoCompra: new Date().toISOString()
    };

    // 3. Tenta Salvar
    try {
        // Usando SET em vez de UPDATE para garantir (força bruta)
        await set(ref(db, `clientes/${clienteId}`), dadosCliente);
        // alert("ROBÔ SUCESSO! Cliente salvo na pasta: " + clienteId); 
        console.log("Cliente salvo: " + clienteId);
    } catch (e) {
        alert("ROBÔ FALHOU AO GRAVAR NO BANCO: " + e.message);
    }
}

//=======================================
// AUTOCOMPLETE DE CLIENTES (VERSÃO FINAL LIMPA)
// ============================================================
let dbClientsCache = []; 

/// 1. Carrega os clientes do Banco e Atualiza a Tabela
if (typeof db !== 'undefined') {
    const clientsRef = ref(db, 'clientes');
    onValue(clientsRef, (snapshot) => {
        if (snapshot.exists()) {
            // Transforma o objeto do banco em uma lista
            const dados = snapshot.val();
            dbClientsCache = Object.values(dados);
        } else {
            dbClientsCache = [];
        }

        // --- A MÁGICA ACONTECE AQUI ---
        // Verifica se a tela de Clientes está aberta. Se estiver, atualiza a tabela agora!
        const container = document.getElementById('clientsContainer');
        if (container && !container.classList.contains('hidden') && typeof renderClientsTable === 'function') {
            renderClientsTable();
        }
    });
}


// 2. Lógica de Pesquisa
// ============================================================
// 🕵️‍♂️ AUTOCOMPLETE UNIVERSAL (NOME, CPF, TELEFONE)
// ============================================================
function ativarAutocomplete() {
    // Configuração dos campos que queremos monitorar
    const campos = [
        { idInput: 'bookipNome',     tipo: 'nome' },
        { idInput: 'bookipCpf',      tipo: 'cpf' },
        { idInput: 'bookipTelefone', tipo: 'tel' }
    ];

    campos.forEach(campo => {
        const input = document.getElementById(campo.idInput);
        if (!input) return;

        // 1. Cria a lista de sugestões dinamicamente (sem mexer no HTML)
        let listaUl = document.getElementById(`sugestao-${campo.idInput}`);
        if (!listaUl) {
            listaUl = document.createElement('ul');
            listaUl.id = `sugestao-${campo.idInput}`;
            listaUl.className = "list-group position-absolute w-100 shadow";
            listaUl.style.zIndex = "9999";
            listaUl.style.display = "none";
            listaUl.style.maxHeight = "200px";
            listaUl.style.overflowY = "auto";
            // Adiciona a lista logo depois do input
            input.parentNode.appendChild(listaUl);
            // Garante que o pai tenha posição relativa para a lista ficar embaixo
            input.parentNode.style.position = "relative"; 
        }

        // 2. Ouve o que você digita
        input.addEventListener('input', (e) => {
            const termo = e.target.value.toLowerCase().trim();
            const termoLimpo = termo.replace(/[^a-z0-9]/g, ''); // Tira pontos e traços para comparar

            listaUl.style.display = 'none';
            listaUl.innerHTML = '';

            if (termoLimpo.length < 2) return; // Só busca se tiver 2+ caracteres/números

            // 3. Filtra a base de clientes (dbClientsCache)
            const encontrados = window.dbClientsCache.filter(c => {
                const nomeDb = (c.nome || '').toLowerCase();
                const cpfDb = (c.cpf || '').replace(/[^a-z0-9]/g, '');
                const telDb = (c.tel || '').replace(/[^a-z0-9]/g, '');

                // Lógica de Busca Inteligente
                if (campo.tipo === 'nome') {
                    return nomeDb.includes(termo);
                } else if (campo.tipo === 'cpf') {
                    return cpfDb.includes(termoLimpo);
                } else if (campo.tipo === 'tel') {
                    return telDb.includes(termoLimpo);
                }
                return false;
            });

            // 4. Mostra os resultados
            if (encontrados.length > 0) {
                listaUl.innerHTML = encontrados.slice(0, 5).map(c => `
                    <li class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" 
                        style="cursor: pointer;"
                        onclick='preencherCliente("${c.id}", "sugestao-${campo.idInput}")'>
                        <div>
                            <strong>${c.nome}</strong><br>
                            <small class="text-secondary">${c.cpf || 'S/ CPF'} - ${c.tel || 'S/ Tel'}</small>
                        </div>
                        <i class="bi bi-box-arrow-in-down-left text-primary"></i>
                    </li>
                `).join('');
                listaUl.style.display = 'block';
            }
        });

        // Fecha se clicar fora
        document.addEventListener('click', (e) => {
            if (e.target !== input && e.target !== listaUl) {
                listaUl.style.display = 'none';
            }
        });
    });
}

// Inicia a função assim que o código carrega
ativarAutocomplete();

// 3. Função de Preencher (Pequeno ajuste para fechar a lista certa)
window.preencherCliente = function(id, idListaParaFechar) {
    const cliente = window.dbClientsCache.find(c => c.id === id);
    
    if (cliente) {
        // Preenche os campos se estiverem vazios ou substitui (decisão de UX)
        // Aqui vou mandar substituir tudo para garantir os dados certos
        document.getElementById('bookipNome').value = cliente.nome || '';
        document.getElementById('bookipCpf').value = cliente.cpf || '';
        document.getElementById('bookipTelefone').value = cliente.tel || '';
        document.getElementById('bookipEndereco').value = cliente.end || '';
        document.getElementById('bookipEmail').value = cliente.email || '';
        
        // Esconde a lista que foi clicada
        if(idListaParaFechar) {
            document.getElementById(idListaParaFechar).style.display = 'none';
        }
        
        // Feedback Visual (Piscadinha verde em todos os campos preenchidos)
        ['bookipNome', 'bookipCpf', 'bookipTelefone'].forEach(id => {
            const el = document.getElementById(id);
            if(el) {
                el.classList.add('is-valid');
                setTimeout(() => el.classList.remove('is-valid'), 1000);
            }
        });
    }
};

// Inicia a função
ativarAutocomplete();

// 3. Função de Preencher
window.preencherCliente = function(id) {
    const cliente = dbClientsCache.find(c => c.id === id);
    if (cliente) {
        document.getElementById('bookipNome').value = cliente.nome || '';
        document.getElementById('bookipCpf').value = cliente.cpf || '';
        document.getElementById('bookipTelefone').value = cliente.tel || '';
        document.getElementById('bookipEndereco').value = cliente.end || '';
        document.getElementById('bookipEmail').value = cliente.email || '';
        
        // Esconde a lista
        document.getElementById('clientSuggestionsList').style.display = 'none';
        
        // Faz o campo piscar verde rapidinho pra confirmar
        const inputNome = document.getElementById('bookipNome');
        inputNome.classList.add('is-valid');
        setTimeout(() => inputNome.classList.remove('is-valid'), 1000);
    }
};

// ============================================================
// LÓGICA DA TELA DE CLIENTES (TABELA E EXCLUSÃO)
// ============================================================

// ============================================================
// MÓDULO DE CLIENTES (FINAL - PROTEGIDO CONTRA ERROS)
// ============================================================

// 1. Variável Global (Janela para os dados)
window.dbClientsCache = []; 

// 2. Conexão com o Banco (Atualiza lista automaticamente)
if (typeof db !== 'undefined') {
    const clientsRef = ref(db, 'clientes');
    onValue(clientsRef, (snapshot) => {
        if (snapshot.exists()) {
            const dados = snapshot.val();
            window.dbClientsCache = Object.values(dados);
        } else {
            window.dbClientsCache = [];
        }
        // Se a tela estiver aberta, atualiza visualmente
        const container = document.getElementById('clientsContainer');
        if (container && !container.classList.contains('hidden')) {
            if(typeof renderClientsTable === 'function') renderClientsTable();
        }
    });
}

// 3. Função Visual: Desenhar Tabela
// 3. Função Visual OTIMIZADA (Para listas gigantes)
window.renderClientsTable = function(filterText = '') {
    const tbody = document.getElementById('clientsTableBody');
    const countEl = document.getElementById('totalClientsCount');
    
    if (!tbody) return;

    let lista = window.dbClientsCache || [];

    // 1. Filtra (A busca continua rápida na memória)
    if (filterText) {
        const term = filterText.toLowerCase();
        lista = lista.filter(c => 
            (c.nome && c.nome.toLowerCase().includes(term)) || 
            (c.cpf && c.cpf.includes(term))
        );
    }

    // 2. Ordena
    lista.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

    // Atualiza contador (Mostra o total real)
    if (countEl) countEl.innerText = `${lista.length} clientes`;

    // Se vazio
    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="2" class="text-center py-5"><i class="bi bi-person-x" style="font-size: 2rem; color: var(--text-secondary); opacity: 0.5;"></i><p class="text-secondary mt-2 mb-0 small">Nenhum cliente encontrado.</p></td></tr>`;
        return;
    }

    // === O SEGREDO DA PERFORMANCE AQUI ===
    // Só desenha os primeiros 50 itens para não travar o celular
    const limiteVisual = 50;
    const listaVisivel = lista.slice(0, limiteVisual);
    const temMais = lista.length > limiteVisual;

    // Gera HTML só do que é visível
    let html = listaVisivel.map(c => `
        <tr>
            <td class="ps-2">
                <div style="font-weight: 600; font-size: 1rem;">${c.nome}</div>
                <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 3px; display: flex; align-items: center; gap: 8px;">
                    <span><i class="bi bi-card-heading"></i> ${c.cpf || '---'}</span>
                    <span style="opacity: 0.3;">|</span>
                    <span><i class="bi bi-whatsapp"></i> ${c.tel || '---'}</span>
                </div>
            </td>
            <td class="text-end pe-2" style="white-space: nowrap; width: 1px;">
                <div class="d-flex justify-content-end gap-2">
                    <button class="client-action-btn btn-edit-theme" onclick="editarCliente('${c.id}')" title="Editar"><i class="bi bi-pencil-fill"></i></button>
                    <button class="client-action-btn btn-delete-theme" onclick="excluirCliente('${c.id}')" title="Excluir"><i class="bi bi-trash-fill"></i></button>
                </div>
            </td>
        </tr>
    `).join('');

    // Se tiver mais de 50, adiciona um aviso no final da tabela
    if (temMais) {
        html += `
        <tr>
            <td colspan="2" class="text-center py-3 text-secondary" style="font-size: 0.85rem; border: none;">
                <i class="bi bi-info-circle"></i> Exibindo os primeiros ${limiteVisual} resultados. <br>
                <strong>Use a busca para encontrar o resto.</strong>
            </td>
        </tr>`;
    }

    tbody.innerHTML = html;
};

// 4. Ações: Excluir e Editar
window.excluirCliente = function(id) {
    showCustomModal({
        message: "Apagar este cliente?",
        confirmText: "Apagar",
        onConfirm: async () => {
            try { await remove(ref(db, `clientes/${id}`)); showCustomModal({ message: "Apagado!" }); } 
            catch (e) { showCustomModal({ message: "Erro: " + e.message }); }
        },
        onCancel: () => {}
    });
};

window.editarCliente = function(id) {
    const cliente = window.dbClientsCache.find(c => c.id === id);
    if (!cliente) return;
    document.getElementById('editClientId').value = cliente.id;
    document.getElementById('editClientName').value = cliente.nome || '';
    document.getElementById('editClientCpf').value = cliente.cpf || '';
    document.getElementById('editClientTel').value = cliente.tel || '';
    document.getElementById('editClientAddress').value = cliente.end || '';
    document.getElementById('editClientEmail').value = cliente.email || '';
    document.getElementById('editClientModalOverlay').classList.add('active');
};

// 5. ATIVAÇÃO DOS BOTÕES (COM PROTEÇÃO DE ESCOPO {})
// O uso de { } evita o erro "Identifier already declared"
{
    // Botão Fechar Modal
    const btnClose = document.getElementById('closeEditClientModal');
    if (btnClose) {
        const newBtn = btnClose.cloneNode(true);
        btnClose.parentNode.replaceChild(newBtn, btnClose);
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('editClientModalOverlay').classList.remove('active');
        });
    }

    // Botão Salvar Edição
    const form = document.getElementById('formEditClient');
    if (form) {
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);
        newForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('editClientId').value;
            const btn = newForm.querySelector('button[type="submit"]');
            const txt = btn.innerHTML;
            btn.innerHTML = 'Salvando...'; btn.disabled = true;

            const novosDados = {
                id: id, 
                nome: document.getElementById('editClientName').value,
                cpf: document.getElementById('editClientCpf').value,
                tel: document.getElementById('editClientTel').value,
                end: document.getElementById('editClientAddress').value,
                email: document.getElementById('editClientEmail').value,
                ultimoCompra: new Date().toISOString()
            };

            try {
                await update(ref(db, `clientes/${id}`), novosDados);
                showCustomModal({ message: "Atualizado!" });
                document.getElementById('editClientModalOverlay').classList.remove('active');
            } catch (err) { showCustomModal({ message: "Erro: " + err.message }); } 
            finally { btn.innerHTML = txt; btn.disabled = false; }
        });
    }
}

// 6. LÓGICA DE IMPORTAÇÃO CSV (PROTEGIDA)
{
    const btnImport = document.getElementById('btnImportClients');
    const fileInput = document.getElementById('csvFileInput');

    if (btnImport && fileInput) {
        // Limpa listeners antigos
        const newBtn = btnImport.cloneNode(true);
        btnImport.parentNode.replaceChild(newBtn, btnImport);
        
        newBtn.addEventListener('click', () => {
            fileInput.value = ''; 
            fileInput.click();
        });

        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (evt) => processarCSV(evt.target.result);
                reader.readAsText(file);
            }
        };
    }

    async function processarCSV(csvText) {
        const linhas = csvText.split('\n');
        // Remove cabeçalho e linhas vazias
        const dados = linhas.slice(1).filter(l => l.trim() !== '');
        
        if (dados.length === 0) {
            showCustomModal({ message: "Arquivo vazio." });
            return;
        }

        // Detecta separador (; ou ,)
        const sep = dados[0].includes(';') ? ';' : ',';
        const updates = {};
        let count = 0;

        showCustomModal({ message: `Processando ${dados.length} linhas...` });

        dados.forEach(linha => {
            const cols = linha.split(sep);
            // Mapeamento: 0=Name, 1=Email, 2=Phone, 3=Tax(CPF), 4=Address
            if (cols.length >= 4) {
                const clean = (t) => t ? t.replace(/["\r]/g, '').trim() : '';
                
                const nome = clean(cols[0]);
                const email = clean(cols[1]);
                let tel = clean(cols[2]).replace(/\D/g, ''); // Limpa tel
                const cpfOrig = clean(cols[3]);
                const end = clean(cols[4]);

                if (nome) {
                    // Cria ID: Se tiver CPF válido (>5 dígitos), usa ele. Senão Nome+Tel
                    const cpfLimpo = cpfOrig.replace(/\D/g, '');
                    let id = (cpfLimpo.length > 5) ? cpfLimpo : `${nome.toLowerCase().replace(/[^a-z0-9]/g, '')}_${tel}`;

                    if (id) {
                        updates[`clientes/${id}`] = {
                            id: id, nome: nome, email: email, tel: tel, cpf: cpfOrig, end: end,
                            origem: 'CSV', ultimoCompra: new Date().toISOString()
                        };
                        count++;
                    }
                }
            }
        });

        if (count > 0) {
            try {
                await update(ref(db), updates);
                showCustomModal({ message: `${count} clientes importados!` });
            } catch (e) { showCustomModal({ message: "Erro: " + e.message }); }
        } else {
            showCustomModal({ message: "Nenhum dado válido." });
        }
    }
}


// ============================================================

// CORREÇÃO FINAL: AÇÃO DO BOTÃO "COMEÇAR NOVA GARANTIA"
// ============================================================
// CORREÇÃO DEFINITIVA: RESET TOTAL (NOVA GARANTIA)
// ============================================================
// AÇÃO DO BOTÃO: RECARREGAR PÁGINA E VOLTAR PARA GARANTIA
// ============================================================
// ============================================================
// ===========================================================
// ============================================================
// CORREÇÃO DEFINITIVA: RESET TOTAL + RECRIAR BOTÃO DE ENVIAR
// ============================================================
document.addEventListener('click', function(e) {
    const btn = e.target.closest('#btnNewBookipCycle');
    
    if (btn) {
        e.preventDefault(); 
        console.log("♻️ Iniciando ciclo de Nova Garantia...");

        // 1. LIMPA VARIÁVEIS NA MEMÓRIA
        try { lastSavedBookipData = null; } catch(e) {}
        try { currentEditingBookipId = null; } catch(e) {}
        try { editingItemIndex = null; } catch(e) {}
        try { bookipCartList = []; } catch(e) {}

        // 2. LIMPA CAMPOS DE TEXTO
        const areaGarantia = document.getElementById('newBookipContent');
        if (areaGarantia) {
            areaGarantia.querySelectorAll('input, textarea, select').forEach(c => c.value = '');
        }
        document.getElementById('bookipProdQtdTemp').value = '1';

        // 3. LIMPA A LISTA DE PRODUTOS (VISUAL)
        const lista = document.getElementById('bookipListaItens');
        const total = document.getElementById('bookipTotalDisplay');
        if(lista) lista.innerHTML = '<li class="list-group-item text-center text-muted small bg-transparent">Nenhum item adicionado.</li>';
        if(total) total.innerText = 'R$ 0,00';

        // 4. RESTAURA BOTÕES (ADICIONAR E SALVAR)
        const btnAdd = document.getElementById('btnAdicionarItemLista');
        if (btnAdd) {
            btnAdd.innerHTML = '<i class="bi bi-plus-lg"></i> Adicionar à Lista';
            btnAdd.className = 'btn btn-primary btn-sm w-100'; 
        }

        const btnSave = document.getElementById('btnSaveBookip');
        if(btnSave) {
            btnSave.innerHTML = '<i class="bi bi-check-circle-fill"></i> Finalizar e Salvar Documento';
            btnSave.className = 'btn btn-success w-100 py-3 fw-bold';
            btnSave.disabled = false;
        }

        // ============================================================
        // 5. O PULO DO GATO: RESETAR O BOTÃO DE ENVIAR (btnPostShare)
        // Isso remove a memória do PDF antigo
        // ============================================================
        const oldShareBtn = document.getElementById('btnPostShare');
        if (oldShareBtn) {
            // Clona o botão para matar todos os eventos antigos (inclusive o do PDF velho)
            const newShareBtn = oldShareBtn.cloneNode(true);
            oldShareBtn.parentNode.replaceChild(newShareBtn, oldShareBtn);

            // Reseta a aparência dele
            newShareBtn.innerHTML = '<i class="bi bi-whatsapp fs-2 d-block mb-2 text-success"></i> <span class="small text-light">Enviar</span>';
            newShareBtn.className = 'btn btn-dark w-100 p-3 border-secondary';
            newShareBtn.disabled = false;

            // Re-adiciona a lógica original (gerar NOVO pdf quando clicar)
            newShareBtn.addEventListener('click', () => {
                if (typeof lastSavedBookipData !== 'undefined' && lastSavedBookipData) {
                    // Copia email se tiver
                    if (lastSavedBookipData.email) {
                        navigator.clipboard.writeText(lastSavedBookipData.email).catch(()=>{});
                        showCustomModal({ message: "E-mail copiado! Gerando PDF..." });
                    }
                    // Gera o PDF com os dados NOVOS
                    gerarPdfDoHistorico(lastSavedBookipData, newShareBtn);
                } else {
                    showCustomModal({ message: "Salve o documento antes de enviar." });
                }
            });
        }
        // ============================================================

        // 6. TROCA AS TELAS (Esconde popup, mostra formulário)
        const popup = document.getElementById('postSaveOptions');
        if(popup) {
            popup.classList.add('hidden'); 
            popup.style.display = 'none'; // Força bruta CSS
        }
        
        const saveContainer = document.getElementById('saveActionContainer');
        if(saveContainer) {
            saveContainer.classList.remove('hidden');
            saveContainer.style.display = 'block';
        }

        // 7. FINALIZAÇÃO
        document.querySelectorAll('.check-pagamento').forEach(c => c.checked = false);
        document.getElementById('areaBookipWrapper').scrollIntoView({ behavior: 'smooth' });
    }
});

// LÓGICA DOS ATALHOS (INTELIGENTE E EXCLUSIVA)
// ============================================================
const setupProductTags = () => {
    const btnNovo = document.getElementById('tagAddNovo');
    const btnSemi = document.getElementById('tagAddSeminovo');
    const inputNome = document.getElementById('bookipProdNomeTemp');

    const suffixNovo = ' - Novo / Lacrado';
    const suffixSemi = ' - Seminovo';

    // Função que atualiza as cores dos botões
    const updateVisuals = () => {
        const val = inputNome.value;
        
        // Se tiver o texto Novo, acende o botão Novo
        if (val.includes(suffixNovo)) {
            btnNovo.classList.add('active');
            btnNovo.innerHTML = '<i class="bi bi-check"></i> Novo / Lacrado'; // Adiciona check
        } else {
            btnNovo.classList.remove('active');
            btnNovo.innerHTML = '+ Novo / Lacrado';
        }

        // Se tiver o texto Seminovo, acende o botão Seminovo
        if (val.includes(suffixSemi)) {
            btnSemi.classList.add('active');
            btnSemi.innerHTML = '<i class="bi bi-check"></i> Seminovo'; // Adiciona check
        } else {
            btnSemi.classList.remove('active');
            btnSemi.innerHTML = '+ Seminovo';
        }
    };

    // Ação ao clicar no NOVO
    if (btnNovo && inputNome) {
        btnNovo.addEventListener('click', () => {
            let text = inputNome.value;
            // 1. Remove SEMINOVO se existir (limpa o rival)
            text = text.replace(suffixSemi, '');
            
            // 2. Se já tem NOVO, remove (desmarca). Se não tem, adiciona.
            if (text.includes(suffixNovo)) {
                text = text.replace(suffixNovo, '');
            } else {
                text += suffixNovo;
            }
            
            inputNome.value = text;
            updateVisuals();
        });
    }

    // Ação ao clicar no SEMINOVO
    if (btnSemi && inputNome) {
        btnSemi.addEventListener('click', () => {
            let text = inputNome.value;
            // 1. Remove NOVO se existir (limpa o rival)
            text = text.replace(suffixNovo, '');

            // 2. Se já tem SEMINOVO, remove (desmarca). Se não tem, adiciona.
            if (text.includes(suffixSemi)) {
                text = text.replace(suffixSemi, '');
            } else {
                text += suffixSemi;
            }

            inputNome.value = text;
            updateVisuals();
        });
    }
    
    // Ouve se o usuário digitar manualmente para atualizar os botões
    if(inputNome) {
        inputNome.addEventListener('input', updateVisuals);
    }
};
// Inicia a função
setupProductTags();


    // ============================================================
    // NOVA LÓGICA: SUB-MENU DE DOCUMENTOS
    // ============================================================

    // ============================================================
    // CÓDIGO NOVO: SUB-MENU DE DOCUMENTOS
    // ============================================================

    // 1. Função que troca as telas (Menu -> Contrato -> Garantia)
    window.openDocumentsSection = function(subSectionId) {
        // Pega os elementos da tela
        const docHome = document.getElementById('documentsHome');
        const areaContrato = document.getElementById('areaContratoWrapper');
        const areaBookip = document.getElementById('areaBookipWrapper');

        // Esconde tudo primeiro (para não ficar um em cima do outro)
        if(docHome) docHome.style.display = 'none';
        if(areaContrato) areaContrato.style.display = 'none';
        if(areaBookip) areaBookip.style.display = 'none';

        // Mostra só o que você escolheu
        if (subSectionId === 'home') {
            if(docHome) docHome.style.display = 'flex'; // Mostra o Menu
        } 
        else if (subSectionId === 'contrato') {
            if(areaContrato) {
                areaContrato.style.display = 'block';
                // Carrega o rascunho (se tiver)
                if(typeof loadContractDraft === 'function') loadContractDraft(); 
            }
        } 
        else if (subSectionId === 'bookip') {
            if(areaBookip) areaBookip.style.display = 'block';
        }
    };

    // 2. Faz os botões clicarem de verdade
    
    // Botão Voltar (Seta) -> Vai para o Menu Principal
    const btnBackDoc = document.getElementById('backFromDocumentsHome');
    if (btnBackDoc) {
        btnBackDoc.onclick = function() { showMainSection('main'); };
    }

    // Botão "Contrato de Venda"
    const btnOpenContrato = document.getElementById('openContratoView');
    if (btnOpenContrato) {
        btnOpenContrato.onclick = function() { window.openDocumentsSection('contrato'); };
    }

    // Botão "Garantia (Bookip)"
    const btnOpenBookip = document.getElementById('openBookipView');
    if (btnOpenBookip) {
        btnOpenBookip.onclick = function() { window.openDocumentsSection('bookip'); };
    }

    // Botão Voltar (dentro do Contrato) -> Volta pro Menu Doc
    const btnBackFromContrato = document.getElementById('backFromContratoView');
    if (btnBackFromContrato) {
        btnBackFromContrato.onclick = function() { window.openDocumentsSection('home'); };
    }

    // Botão Voltar (dentro da Garantia) -> Volta pro Menu Doc
    const btnBackFromBookip = document.getElementById('backFromBookipView');
    if (btnBackFromBookip) {
        btnBackFromBookip.onclick = function() { window.openDocumentsSection('home'); };
    }

// ============================================================


// ============================================================
// ============================================================
// ============================================================
// 2. FUNÇÃO IMPRIMIR
// ============================================================
function printBookip(dados) {
    try {
        if (!dados) { alert("Erro: Sem dados."); return; }
        const htmlRecibo = getReciboHTML(dados);
        const preview = document.getElementById('bookipPreview');
        if(preview) {
            preview.innerHTML = htmlRecibo;
            document.body.classList.add('print-bookip');
            
            // Delay maior para garantir que imagens carreguem antes de imprimir
            setTimeout(() => { 
                window.print(); 
                setTimeout(() => document.body.classList.remove('print-bookip'), 1500); 
            }, 600);
        }
    } catch (e) { alert("Erro: " + e.message); document.body.classList.remove('print-bookip'); }
}


// GERADOR DE PDF (DESIGN VERDE + MODO SITUAÇÃO LIMPO)
// ============================================================
// ============================================================
// GERADOR DE PDF (DESIGN VERDE ORIGINAL + CORREÇÃO DE QUEBRA)
// ============================================================
function getReciboHTML(dados) {
    // 1. VERIFICAÇÕES DE MODO (RECIBO vs GARANTIA vs SITUAÇÃO)
    const isSimple = (window.isSimpleReceiptMode === true);
    const isSituation = (dados.type === 'situacao') || (dados.items && dados.items[0] && dados.items[0].isSituation);

    // 2. CONFIGURAÇÕES (Design Mantido)
    const settings = (typeof receiptSettings !== 'undefined' && receiptSettings) ? receiptSettings : {};
    const headerHtml = (settings.header || "WORKCELL TECNOLOGIA").replace(/\n/g, '<br>');
    const rawTerms = (settings.terms || "Garantia legal de 90 dias.");
    
    // CORREÇÃO: Adicionado 'page-break-inside: avoid' em cada linha dos termos
    const termsHtml = rawTerms.split('\n').map(line => {
        if(!line || line.trim() === '') return '<div style="height: 5px;"></div>'; 
        return `<div style="margin-bottom: 3px; text-align: justify; page-break-inside: avoid;">${line}</div>`;
    }).join('');
    
    const logoUrl = settings.logoBase64 || "https://i.imgur.com/H6BjyBS.png"; 
    const signatureUrl = settings.signatureBase64 || "https://i.imgur.com/Bh3fVLM.jpeg";

    // 3. DATAS
    let hoje, dataCompra;
    if (dados.dataVenda) {
        try {
            const partes = dados.dataVenda.split('-');
            hoje = new Date(partes[0], partes[1] - 1, partes[2]);
            dataCompra = `${partes[2]}/${partes[1]}/${partes[0]}`;
        } catch (e) { hoje = new Date(); dataCompra = hoje.toLocaleDateString('pt-BR'); }
    } else {
        hoje = dados.criadoEm ? new Date(dados.criadoEm) : new Date();
        dataCompra = hoje.toLocaleDateString('pt-BR');
    }

    // 4. GARANTIA
    const dias = parseInt(dados.diasGarantia) || 0;
    let dataVencimento = "S/ Garantia";
    let txtGarantia = "Sem Garantia";
    
    if (dias > 0) {
        const validade = new Date(hoje);
        validade.setDate(hoje.getDate() + dias);
        dataVencimento = validade.toLocaleDateString('pt-BR');
        if (dias === 365) txtGarantia = "1 Ano";
        else if (dias === 180) txtGarantia = "6 Meses";
        else if (dias === 30) txtGarantia = "30 Dias";
        else txtGarantia = `${dias} Dias`;
    }
    const docNum = dados.docNumber || '---';

    // 5. LÓGICA DA TABELA
    let tableHeaderHTML = '';
    let tableBodyHTML = '';
    let totalGeral = 0;

    if (isSituation) {
        const relato = (dados.items && dados.items[0]) ? dados.items[0].nome : "Sem relato.";
        tableHeaderHTML = `<th style="padding: 8px; text-align: left; color: #ffffff !important; font-size: 10pt; font-weight: bold;">Situação Ocorrida:</th>`;
        tableBodyHTML = `<tr><td style="padding: 15px; border-bottom: 1px solid #eee; font-size: 10pt; text-align: justify; line-height: 1.5;">${relato.replace(/\n/g, '<br>')}</td></tr>`;
    } else {
        let lista = (dados.items && Array.isArray(dados.items)) ? dados.items : [];
        totalGeral = lista.reduce((acc, i) => acc + (parseFloat(i.valor||0) * (parseInt(i.qtd)||1)), 0);
        tableHeaderHTML = `
            <th style="padding: 8px; text-align: left; color: #ffffff !important; font-size: 10pt; font-weight: bold;">Item</th>
            <th style="padding: 8px; text-align: center; color: #ffffff !important; font-size: 10pt; font-weight: bold;">Qtd</th>
            <th style="padding: 8px; text-align: right; color: #ffffff !important; font-size: 10pt; font-weight: bold;">Unit</th>
            <th style="padding: 8px; text-align: right; color: #ffffff !important; font-size: 10pt; font-weight: bold;">Total</th>`;
        tableBodyHTML = lista.map(item => `
            <tr style="page-break-inside: avoid;">
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-size: 10pt;">
                    <strong>${item.nome}</strong><br><span style="color:#666; font-size:8.5pt;">${item.cor||''} ${item.obs||''}</span>
                </td>
                <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${item.qtd}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">R$ ${parseFloat(item.valor).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">R$ ${(item.valor * item.qtd).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
            </tr>`).join('');
    }

    const tituloLinha1 = isSituation ? "RELATÓRIO DE" : (isSimple ? "RECIBO DE" : "Comprovante de");
    const tituloLinha2 = isSituation ? "SITUAÇÃO" : (isSimple ? "VENDA / PEDIDO" : "compra / Garantia");
    
    const showTotal = !isSituation;
    const showGarantiaRow = !isSituation;
    const showVenceRow = !isSituation && !isSimple;

    // CORREÇÃO INTELIGENTE: PERFEITO NO PDF (SEM CORTES) E FLUIDO NA IMPRESSORA (SEM BURACOS)
    const sectionTermos = (isSimple || isSituation) ? "" : `
        <style>
            /* Regra Padrão (Para o PDF gerado via imagem/tela) */
            .termos-garantia {
                page-break-inside: avoid; /* Segura o bloco junto no PDF */
            }

            /* Regra Específica para Impressão Física (Ctrl+P) */
            @media print {
                .termos-garantia {
                    page-break-inside: auto !important; /* Permite quebrar suavemente no papel */
                    margin-top: 5px !important; /* Ajusta margem pra economizar papel */
                }
            }
        </style>

        <div class="termos-garantia" style="border-top: 1px solid #000; padding-top: 10px; margin-top: 10px;">
            <div style="margin-bottom: 10px;">
                <strong style="font-size: 10pt; text-transform: uppercase;">Termos de Garantia</strong>
            </div>
            <div style="font-size: 9pt; line-height: 1.3; color: #333; text-align: justify;">${termsHtml}</div>
        </div>`;


    return `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #000; background: #fff; padding: 20px 30px; width: 750px; margin: 0 auto; box-sizing: border-box;">
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <tr>
                    <td style="width: 30%; vertical-align: top;"><img src="${logoUrl}" style="width: 160px; height: auto; object-fit: contain;"></td>
                    <td style="width: 70%; text-align: right; vertical-align: top; font-size: 9pt; color: #444;">
                        <div style="font-size: 20pt; color: #000; line-height: 1.1;">${tituloLinha1}</div>
                        <div style="font-size: 20pt; font-weight: bold; color: #000; margin-bottom: 8px; line-height: 1.1;">${tituloLinha2}</div>
                        ${headerHtml}
                    </td>
                </tr>
            </table>

            <table style="width: 100%; border-top: 1px solid #ccc; margin-bottom: 20px; border-collapse: collapse;">
                <tr>
                    <td style="width: 60%; vertical-align: top; padding-top: 15px; padding-right: 15px;">
                        <div style="font-size: 11pt; font-weight: bold; margin-bottom: 5px;">${dados.nome}</div>
                        <div style="font-size: 10pt; line-height: 1.4;">
                            <strong>CPF:</strong> ${dados.cpf || 'Não inf.'}<br>
                            <strong>Número:</strong> ${dados.tel || 'Não inf.'}<br>
                            <strong>E-mail:</strong> ${dados.email || 'Não inf.'}<br>
                            <strong>Endereço:</strong> ${dados.end || 'Não inf.'}
                        </div>
                    </td>
                    <td style="width: 40%; vertical-align: top; padding-top: 15px; text-align: right;">
                        <table style="width: auto; border-collapse: collapse; font-size: 10pt; float: right;">
                            <tr><td style="text-align: right; font-weight: bold; padding-bottom:4px;">Doc Nº:</td><td style="padding-left:10px; padding-bottom:4px;">${docNum}</td></tr>
                            <tr><td style="text-align: right; padding-bottom:4px;">Data:</td><td style="padding-left:10px; padding-bottom:4px;">${dataCompra}</td></tr>
                            ${showGarantiaRow ? `<tr><td style="text-align: right; padding-bottom:4px;">Garantia:</td><td style="padding-left:10px; padding-bottom:4px;">${txtGarantia}</td></tr>` : ''}
                            ${showVenceRow ? `<tr><td style="text-align: right; padding-left:10px; padding-bottom:4px;">Vence:</td><td style="padding-left:10px; padding-bottom:4px;">${dataVencimento}</td></tr>` : ''}
                        </table>
                    </td>
                </tr>
            </table>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 5px;">
                <thead>
                    <tr style="background-color: #6da037 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact;">
                        ${tableHeaderHTML}
                    </tr>
                </thead>
                <tbody>${tableBodyHTML}</tbody>
            </table>

            ${showTotal ? `
            <div style="margin-top: 10px; margin-bottom: 25px; border-top: 1px solid #eee; padding-top: 10px;">
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="text-align: left; vertical-align: middle; font-size: 10pt; color: #444;">
                            <strong>Forma de Pagamento:</strong> <span style="color: #000; font-weight: 500;">${dados.pagamento || 'Não informado'}</span>
                        </td>
                        
                        <td style="text-align: right; vertical-align: middle;">
                            <div style="display: inline-block; background-color: #f2f2f2; padding: 10px 20px; font-size: 12pt; font-weight: bold; border-radius: 4px;">
                                Total: <span style="color: #2e7d32;">R$ ${totalGeral.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                            </div>
                        </td>
                    </tr>
                </table>
            </div>` : '<div style="height:30px;"></div>'}

            ${sectionTermos}

            <div style="width: 100%; text-align: right; margin-top: 40px; page-break-inside: avoid;">
                <img src="${signatureUrl}" style="width: 200px; height: auto; display: inline-block;">
            </div>
        </div>
    `;
}

// 3. FUNÇÃO PDF FINAL (COM CÓPIA DE E-MAIL AUTOMÁTICA)
// ============================================================
async function gerarPdfDoHistorico(dados, botao) {
    // ============================================================
    // 0. CÓPIA DE E-MAIL BLINDADA (COM FALLBACK) 🛡️
    // ============================================================
    if (dados.email && dados.email.trim() !== '') {
        const textToCopy = dados.email.trim();

        // 🔧 Função de emergência: Usa o método antigo (execCommand) 
        // que funciona mesmo quando o navegador bloqueia o clipboard moderno.
        const copiarJeitoAntigo = (texto) => {
            try {
                const textArea = document.createElement("textarea");
                textArea.value = texto;
                
                // Esconde o elemento mas mantém ele "visível" pro sistema selecionar
                textArea.style.position = "fixed";
                textArea.style.left = "-9999px";
                textArea.style.top = "0";
                
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                // console.log('Cópia via fallback:', successful);
            } catch (e) {
                console.error("Erro no método antigo:", e);
            }
        };

        // Tenta o jeito moderno primeiro
        if (navigator.clipboard && navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(textToCopy);
                         } catch (err) {
                // Se der erro ou o usuário cancelar, NÃO BAIXA MAIS AUTOMATICAMENTE.
                console.warn("Compartilhamento cancelado ou falhou:", err);

                // Se não for apenas um cancelamento do usuário (AbortError), avisa.
                if (err.name !== 'AbortError') {
                    alert("Não foi possível abrir o compartilhamento direto.");
                }
                
                // Opcional: Reseta o botão para "Enviar" caso queira tentar de novo
                novoBotao.innerHTML = '<i class="bi bi-whatsapp"></i> Tentar Novamente';
            }

        } else {
            // Se o navegador for velho e nem tiver clipboard, vai direto no plano B
            copiarJeitoAntigo(textToCopy);
        }
    }

    // ============================================================
    // INÍCIO DA GERAÇÃO DO PDF
    // ============================================================

    const textoOriginal = botao.innerHTML;
    botao.innerHTML = 'Aguarde...';
    botao.disabled = true;

    // --- CORTINA DE LOADING ---
    const spinnerStyle = document.createElement('style');
    spinnerStyle.id = 'workcell-spinner-style';
    spinnerStyle.textContent = `
        .workcell-spinner {
            border: 4px solid #f3f3f3; border-top: 4px solid #6da037; border-radius: 50%;
            width: 50px; height: 50px; animation: spin 1s linear infinite; margin-bottom: 25px;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .loading-container { font-family: sans-serif; text-align: center; }
        .loading-title { color: #333; font-size: 20px; font-weight: bold; margin-bottom: 10px; }
        .loading-subtitle { color: #666; font-size: 14px; }
    `;
    if (!document.getElementById('workcell-spinner-style')) {
        document.head.appendChild(spinnerStyle);
    }

    const loadingOverlay = document.createElement('div');
    loadingOverlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(255, 255, 255, 0.98); z-index: 2147483647;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: 30px; box-sizing: border-box;
    `;
    loadingOverlay.innerHTML = `
        <div class="workcell-spinner"></div>
        <div class="loading-container">
            <div class="loading-title" id="loadingTxt">Iniciando...</div>
            <div class="loading-subtitle">Por favor, não feche o app.</div>
        </div>
    `;
    document.body.appendChild(loadingOverlay);

    const updateLoading = (txt) => { const el = document.getElementById('loadingTxt'); if(el) el.innerText = txt; };

    updateLoading("Preparando documento...");

    // --- 1. CONFIGURAÇÕES FINAIS ---
    
    // A. Nome do Arquivo
    const nomeClienteLimpo = (dados.nome || 'Cliente')
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") 
        .replace(/[^a-zA-Z0-9\s]/g, '') 
        .trim()
        .replace(/\s+/g, '_');

    const numeroDoc = dados.docNumber || '000';
    const nomeFinalArquivo = `DocGarantia&comprovante_${nomeClienteLimpo}_${numeroDoc}.pdf`;

    // B. Mensagem (Puxa do Admin)
    const settings = (typeof receiptSettings !== 'undefined' && receiptSettings) ? receiptSettings : {};
    const msgSalva = settings.emailMessage || settings.shareMessage || settings.msgEnvio || "";
    
    // Corpo do E-mail
    const textoCompartilhamento = msgSalva ? `Olá ${dados.nome},\n\n${msgSalva}` : `Olá ${dados.nome},`;
    
    // C. Título do E-mail
    const tituloCompartilhamento = "Documento Workcell Tecnologia";

    // --- GERAÇÃO HTML ---
    const containerTemp = document.createElement('div');
    // MUDANÇA: 'left: -9999px' joga para fora da tela e 'position: fixed' evita esticar o site
        containerTemp.style.cssText = "position: fixed; top: 0; left: -9999px; width: 794px; background: white; z-index: -100; margin: 0; padding: 0; letter-spacing: 0.2px; font-variant-ligatures: none;";

    
    if (typeof getReciboHTML === 'function') {
        containerTemp.innerHTML = getReciboHTML(dados);
    } else {
        alert("Erro: Fábrica não encontrada.");
        removerLoading();
        botao.innerHTML = textoOriginal;
        botao.disabled = false;
        return;
    }
    document.body.appendChild(containerTemp);

    function removerLoading() {
        if(document.body.contains(containerTemp)) document.body.removeChild(containerTemp);
        if(document.body.contains(loadingOverlay)) document.body.removeChild(loadingOverlay);
    }

    try {
        window.scrollTo(0,0);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise(resolve => setTimeout(resolve, 2500));

        updateLoading("Processando imagens...");

        const fullCanvas = await html2canvas(containerTemp, {
            scale: 1.5, 
            useCORS: true,
            scrollY: 0,
            windowWidth: 794,
            backgroundColor: '#ffffff'
        });

        const pdfRatio = 297 / 210; 
        const pageHeightPixels = Math.floor(fullCanvas.width * pdfRatio);
        const margemSeguranca = 50; 
        
        // AQUI: Diminuímos 15px da altura útil para criar o respiro no final da folha
        const contentHeightPerPage = pageHeightPixels - (margemSeguranca * 2) - 15;

        const totalHeight = fullCanvas.height;
        let currentHeight = 0;
        let pageCount = 1;
        
        const printContainer = document.createElement('div');
        printContainer.style.width = '794px'; 
        
        while (currentHeight < totalHeight) {
            updateLoading(`Gerando página ${pageCount}...`);
            
            const pageCanvas = document.createElement('canvas');
            pageCanvas.width = fullCanvas.width;
            pageCanvas.height = pageHeightPixels;

            const ctx = pageCanvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

            const heightLeft = totalHeight - currentHeight;
            const sliceHeight = Math.min(contentHeightPerPage, heightLeft);

            // --- AJUSTE CIRÚRGICO PÁGINA 2+ ---
            // Se for página 2 ou mais, desce 15px (ajusteVisual) para não colar no topo
            const ajusteVisual = (pageCount > 1) ? 20 : 0; 

            ctx.drawImage(
                fullCanvas, 
                0, currentHeight, fullCanvas.width, sliceHeight,
                0, margemSeguranca + ajusteVisual, fullCanvas.width, sliceHeight 
            );

            if (sliceHeight >= contentHeightPerPage) {
                 ctx.fillStyle = '#ffffff';
                 ctx.fillRect(0, pageHeightPixels - margemSeguranca, pageCanvas.width, margemSeguranca);
            }

            const imgSlice = document.createElement('img');
            imgSlice.src = pageCanvas.toDataURL('image/jpeg', 0.95);
            imgSlice.style.width = '100%'; 
            imgSlice.style.display = 'block';
            
            const pageDiv = document.createElement('div');
            pageDiv.style.cssText = "position: relative; width: 100%; margin: 0; padding: 0; page-break-after: always;";
            pageDiv.appendChild(imgSlice);
            
            printContainer.appendChild(pageDiv);

            currentHeight += sliceHeight;
            pageCount++;
        }

        updateLoading("Finalizando PDF...");

        const opt = {
            margin:       0, 
            filename:     nomeFinalArquivo,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 1, useCORS: true }, 
            jsPDF:        { unit: 'px', format: [794, 1123], orientation: 'portrait' } 
        };

                // ... (Mantenha o código acima igual, até chegar nesta linha abaixo) ...
        const blob = await html2pdf().set(opt).from(printContainer).output('blob');
        
        // --- DAQUI PRA BAIXO É O CÓDIGO NOVO ---
        
        const file = new File([blob], nomeFinalArquivo, { type: 'application/pdf' });
        removerLoading();

        // 1. O BOTÃO VIRA "ENVIAR" (Verde)
        botao.innerHTML = '<i class="bi bi-whatsapp"></i> Enviar PDF'; 
        botao.classList.remove('btn-primary', 'btn-warning', 'btn-secondary', 'btn-dark'); 
        botao.classList.add('btn-success'); 
        botao.disabled = false; 

        // 2. PREPARA O NOVO CLIQUE (Limpa eventos antigos)
        const novoBotao = botao.cloneNode(true);
        botao.parentNode.replaceChild(novoBotao, botao);

        // 3. CLIQUE DE ENVIO
        novoBotao.addEventListener('click', async () => {
            try {
                let compartilhou = false;

                // Tenta compartilhar nativo
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: tituloCompartilhamento,
                        text: textoCompartilhamento
                    });
                    compartilhou = true;
                } else {
                    throw new Error("Share não suportado, indo para download.");
                }

                // --- SE DEU CERTO: MARCA TUDO ---
                if (compartilhou) {
                    // A. Visual do Botão
                    novoBotao.innerHTML = '<i class="bi bi-check-circle-fill"></i> Enviado!';
                    novoBotao.classList.remove('btn-success');
                    novoBotao.classList.add('btn-dark'); 
                    
                    // B. Visual da Lista (Borda Verde)
                    const cardPai = novoBotao.closest('.list-group-item') || novoBotao.closest('.card') || novoBotao.parentNode.parentNode;
                    if (cardPai) {
                        cardPai.style.borderLeft = "6px solid #28a745"; 
                        cardPai.style.backgroundColor = "#f0fff4"; 
                    }

                    // C. Salva no Firebase (Memória Eterna)
                    if (dados.id || dados.docId) {
                        marcarComoEnviadoNoBanco(dados.id || dados.docId);
                    }
                }

            } catch (err) {
                // Apenas avisa no console, NÃO baixa mais nada
                console.warn("Compartilhamento cancelado ou erro:", err);
                
                // Opcional: Se quiser que o botão volte a ficar verde pra tentar de novo:
                // novoBotao.innerHTML = '<i class="bi bi-whatsapp"></i> Enviar PDF';
            }

        });

        // Vibra para avisar que está pronto
        if (navigator.vibrate) navigator.vibrate(100);

    } catch (e) {
        removerLoading();
        alert("Erro ao gerar: " + e.message);
        console.error(e);
        botao.innerHTML = textoOriginal;
        botao.disabled = false;
    }
}


        
// =====================================

// ==============
// ============================================================
// 🧹 FAXINA DO FIREBASE (GLOBAL)
// ============================================================
window.limparImportacaoErrada = async function() {
    // 1. Verificação de Segurança do Banco
    if (!db) {
        alert("Erro: O Banco de Dados ainda não conectou. Tente novamente em 5 segundos.");
        return;
    }

    // 2. Senha de Segurança
    showCustomModal({
        message: "⚠️ ZONA DE PERIGO ⚠️\n\nIsso vai escanear o Firebase e apagar clientes que parecem erros (ex: nome '12929' ou sem telefone).\n\nDigite a senha:",
        showPassword: true,
        confirmText: "INICIAR VARREDURA",
        onConfirm: (password) => {
            if (password === "220390") {
                executarVarreduraReal();
            } else {
                showCustomModal({ message: "Senha incorreta." });
            }
        },
        onCancel: () => {}
    });
};

async function executarVarreduraReal() {
    const loadingToast = document.getElementById('toastNotification');
    if(loadingToast) {
        loadingToast.innerHTML = '<i class="spinner-border spinner-border-sm"></i> Escaneando Firebase...';
        loadingToast.classList.add('show');
    }

    try {
        // 1. Baixa TUDO da pasta clientes
        const snapshot = await get(ref(db, 'clientes'));
        
        if (!snapshot.exists()) {
            showCustomModal({ message: "O banco de dados de clientes está vazio." });
            return;
        }

        const clientes = snapshot.val();
        const updates = {};
        let contador = 0;
        let amostra = [];

        // 2. O Algoritmo de Detecção de "Lixo"
        Object.keys(clientes).forEach(key => {
            const c = clientes[key];
            const nome = String(c.nome || '').trim();
            const tel = String(c.tel || '').replace(/\D/g, ''); // Só números
            const cpf = String(c.cpf || '');

            // CRITÉRIO 1: O Nome é puramente numérico? (Ex: "159700", "12.90")
            // Regex: Só aceita números, pontos, traços e espaços. Sem letras.
            const nomePareceCodigo = /^[0-9\s.-]+$/.test(nome) && nome.length > 0;

            // CRITÉRIO 2: Sem telefone E nome curto (Ex: "Eu", "A")
            const cadastroIncompleto = (tel.length < 6) && (nome.length < 3);

            // CRITÉRIO 3: Nome contém palavras de erro de arquivo (Opcional)
            const nomeInvalido = nome.toLowerCase().includes("undefined") || nome.toLowerCase().includes("null");

            if (nomePareceCodigo || cadastroIncompleto || nomeInvalido) {
                // Marca para deletar (null apaga no Firebase)
                updates[`clientes/${key}`] = null;
                contador++;
                
                // Guarda 3 exemplos para te mostrar antes de apagar
                if (amostra.length < 3) amostra.push(`${nome} (ID: ${key})`);
            }
        });

        if(loadingToast) loadingToast.classList.remove('show');

        // 3. Resultado
        if (contador === 0) {
            showCustomModal({ message: "Tudo limpo! Não encontrei nenhum cadastro com erro." });
        } else {
            showCustomModal({
                message: `🚨 ENCONTREI ${contador} ERROS!\n\nExemplos:\n- ${amostra.join('\n- ')}\n\nTem certeza que deseja EXCLUIR DEFINITIVAMENTE esses ${contador} registros do Firebase?`,
                confirmText: "SIM, APAGAR AGORA",
                onConfirm: async () => {
                    await update(ref(db), updates);
                    showCustomModal({ message: `Pronto! ${contador} registros de lixo foram apagados.` });
                    // Atualiza a tabela se estiver aberta
                    if (typeof renderClientsTable === 'function') renderClientsTable();
                },
                onCancel: () => {
                    showCustomModal({ message: "Cancelado. Nada foi apagado." });
                }
            });
        }

    } catch (error) {
        console.error(error);
        alert("Erro técnico: " + error.message);
    }
}


// ============================================================
// ============================================================
// 🪄 MÁGICA: IMPORTAR DADOS DO WHATSAPP (VERSÃO FINAL BLINDADA)
// ==============================================// ============================================================
// 🪄 MÁGICA: IMPORTAR DADOS DO WHATSAPP (VERSÃO FINAL COM ATIVADOR)
// ============================================================

// 1. Função de Abrir a Janela
window.abrirModalColarZap = function() {
    console.log("Abrindo janela do Zap..."); // Aviso no console pra gente saber que funcionou

    const modalHtml = `
    <div class="custom-modal-overlay active" id="modalZapOverlay" style="z-index: 10000;">
        <div class="custom-modal-content" style="max-width: 90%; width: 400px;">
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h5 class="mb-0 text-success"><i class="bi bi-whatsapp"></i> Colar Dados</h5>
                <button class="btn-back" id="btnFecharZap"><i class="bi bi-x-lg"></i></button>
            </div>
            <p class="text-secondary small text-start">Copie a mensagem inteira do cliente e cole abaixo:</p>
            <textarea id="textoZapInput" class="form-control mb-3" rows="8" placeholder="Ex: *Nome*: João..."></textarea>
            <button class="btn btn-success w-100" id="btnProcessarZap">
                <i class="bi bi-magic"></i> Preencher Automático
            </button>
        </div>
    </div>`;

    // Remove anterior se existir
    const existente = document.getElementById('containerModalZap');
    if (existente) existente.remove();

    const div = document.createElement('div');
    div.id = 'containerModalZap';
    div.innerHTML = modalHtml;
    document.body.appendChild(div);

    // Ativa os botões de dentro da janela (Fechar e Processar)
    setTimeout(() => {
        document.getElementById('textoZapInput').focus();
        document.getElementById('btnFecharZap').onclick = function() { 
            document.getElementById('containerModalZap').remove(); 
        };
        document.getElementById('btnProcessarZap').onclick = window.processarTextoZap;
    }, 100);
};

// 2. O Robô Inteligente (Que acha o nome mesmo sem rótulo)
window.processarTextoZap = function() {
    const texto = document.getElementById('textoZapInput').value;
    if (!texto.trim()) { alert("Cole o texto primeiro!"); return; }

    const linhas = texto.split('\n').map(l => l.trim()).filter(l => l !== '');
    const extrair = (chave) => {
        const regex = new RegExp(`${chave}[\\s\\*\\:]+([^\n]+)`, 'i');
        const match = texto.match(regex);
        return match ? match[1].trim() : '';
    };

    // --- LÓGICA DE DETECÇÃO ---
    let nome = extrair('Nome completo') || extrair('Nome') || extrair('Comprador') || extrair('Cliente');

    // Se não achou nome, tenta pegar a primeira linha válida (pulando CPF/Tel/Email)
    if (!nome && linhas.length > 0) {
        for (let i = 0; i < Math.min(linhas.length, 5); i++) {
            let linha = linhas[i];
            const soNumeros = linha.replace(/\D/g, '');
            const ehCPF = soNumeros.length >= 11;
            const ehTel = linha.includes('(') || (soNumeros.length >= 8 && soNumeros.length <= 13);
            const ehEmail = linha.includes('@');
            const ehLixo = linha.includes('Dados') || linha.includes('👇') || linha.includes(':');

            if (!ehCPF && !ehTel && !ehEmail && !ehLixo && linha.length > 2) {
                nome = linha.replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2580-\u27BF]|\uD83E[\uDD10-\uDDFF]/g, '').trim();
                break;
            }
        }
    }

    // CPF, Tel, Email
    let cpf = extrair('CPF').replace(/\D/g, ''); 
    if (!cpf) { const m = texto.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/); if(m) cpf = m[0].replace(/\D/g, ''); }
    if(cpf.length > 3) cpf = cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");

    let tel = extrair('Whatsapp') || extrair('Telefone') || extrair('Celular');
    if (!tel) { const m = texto.match(/\(?\d{2}\)?\s?9?\d{4}-?\d{4}/); if(m) tel = m[0]; }
    tel = tel ? tel.replace(/\D/g, '') : '';

    const mEmail = texto.match(/[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}/);
    let email = mEmail ? mEmail[0] : '';

    // Endereço e CEP
    const mCep = texto.match(/\b\d{5}[-.]?\d{3}\b/);
    let cepEncontrado = mCep ? mCep[0] : '';
    
    let endereco = '';
    const camposEnd = [extrair('Rua'), extrair('Número'), extrair('Setor'), extrair('Bairro'), extrair('Cidade')];
    endereco = camposEnd.filter(c => c).join(', ');
    
    if (cepEncontrado) {
        if (!endereco) endereco = `CEP: ${cepEncontrado}`;
        else if (!endereco.includes(cepEncontrado)) endereco += ` (${cepEncontrado})`;
    }

    // Preenche
    if (nome) document.getElementById('bookipNome').value = nome;
    if (cpf) document.getElementById('bookipCpf').value = cpf;
    if (tel) document.getElementById('bookipTelefone').value = tel;
    if (email) document.getElementById('bookipEmail').value = email;
    if (endereco.length > 5) document.getElementById('bookipEndereco').value = endereco;

    // Fecha janela
    document.getElementById('containerModalZap').remove();
    
    if (typeof showCustomModal === 'function') showCustomModal({ message: "Dados Processados! ✅" });
    else alert("Dados Processados!");
};

// 3. ATIVADOR DO BOTÃO (O SEGREDO!)
// Isso procura o botão pelo ID e liga ele na força bruta
setTimeout(() => {
    const btnZap = document.getElementById('btnZapMagico');
    if (btnZap) {
        btnZap.addEventListener('click', (e) => {
            e.preventDefault(); // Evita recarregar se estiver num form
            window.abrirModalColarZap();
        });
        console.log("Botão Zap CONECTADO com sucesso!");
    } else {
        console.error("ERRO: Não achei o botão com id='btnZapMagico' no HTML");
    }
}, 1000); // Espera 1 segundo pra garantir que o HTML carregou

// ============================================================
// FUNÇÃO DE FAXINA (LIMPA TUDO PARA EVITAR BUGS DE EDIÇÃO)
// ============================================================
// FUNÇÃO DE FAXINA (LIMPA TUDO: DADOS E VISUAL)
// ============================================================
window.resetFormulariosBookip = function() {
    console.log("🧹 Executando faxina completa...");

    // 1. Limpa Campos de Texto do Cliente
    const camposCliente = ['bookipNome', 'bookipCpf', 'bookipTelefone', 'bookipEndereco', 'bookipEmail', 'bookipDataManual'];
    camposCliente.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    // 2. Limpa Campos de Produto (Temp)
    const camposProd = ['bookipProductSearch', 'bookipProdNomeTemp', 'bookipProdValorTemp', 'bookipProdCorTemp', 'bookipProdObsTemp'];
    camposProd.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    
    // Reseta quantidade para 1
    const qtd = document.getElementById('bookipProdQtdTemp');
    if (qtd) qtd.value = '1';

    // 3. Limpa Descrição de Situação
    const sit = document.getElementById('sitDescricao');
    if (sit) sit.value = '';

    // 4. Reseta Checkboxes de Pagamento
    document.querySelectorAll('.check-pagamento').forEach(c => c.checked = false);

    // 5. Restaura o Botão de Salvar (Verde)
    const btnSave = document.getElementById('btnSaveBookip');
    if (btnSave) {
        btnSave.innerHTML = '<i class="bi bi-check-circle-fill"></i> Finalizar e Salvar Documento';
        btnSave.classList.remove('btn-warning', 'btn-info'); 
        btnSave.classList.add('btn-success'); 
        btnSave.disabled = false;
    }
    
    // 6. Restaura o Botão de Adicionar Item (Azul)
    const btnAdd = document.getElementById('btnAdicionarItemLista');
    if (btnAdd) {
        btnAdd.innerHTML = '<i class="bi bi-plus-lg"></i> Adicionar à Lista';
        btnAdd.classList.remove('btn-warning');
        btnAdd.classList.add('btn-primary');
    }

    // 7. ZERA A LISTA NA MEMÓRIA E NA TELA (O Pulo do Gato)
    if (typeof bookipCartList !== 'undefined') {
        bookipCartList = []; 
    } else {
        window.bookipCartList = [];
    }
    
    // Força apagar os itens da tela visualmente
    if (typeof window.atualizarListaVisualBookip === 'function') {
        window.atualizarListaVisualBookip();
    } else if (typeof atualizarListaVisualBookip === 'function') {
        atualizarListaVisualBookip();
    }

    // 8. Esconde opções de pós-salvamento e mostra o form
    const postSave = document.getElementById('postSaveOptions');
    if(postSave) postSave.classList.add('hidden');
    
    const saveContainer = document.getElementById('saveActionContainer');
    if(saveContainer) saveContainer.classList.remove('hidden');
};

// ============================================================
// ============================================================
// ============================================================
// ============================================================
// SOLUÇÃO CONTROLE REMOTO (BOTÃO FÍSICO = BOTÃO VIRTUAL)
// ============================================================

document.addEventListener('DOMContentLoaded', () => {

    // 1. AVISA O CELULAR QUE NAVEGAMOS (CRIA O HISTÓRICO)
    // Sem isso, o botão voltar fecha o app.
    const botoesQueAbremTelas = document.querySelectorAll('.btn-menu, .btn-action-sm, #btnAdminClients');
    
    botoesQueAbremTelas.forEach(btn => {
        btn.addEventListener('click', () => {
            // Empurra um estado novo para o histórico
            history.pushState({ time: Date.now() }, '', '');
        });
    });

    // 2. QUANDO APERTAR VOLTAR NO CELULAR...
    window.onpopstate = function(event) {
        
        // Estratégia: Achar qual tela está aberta e clicar no botão 'Voltar' dela.
        
        // Lista de telas possíveis (baseada no seu index.html)
        const telas = [
            'fecharVenda', 'repassarValores', 'calcularEmprestimo', 'calcularPorAparelho', // Telas Calc
            'calculatorHome', // Menu Calc
            'areaContratoWrapper', 'areaBookipWrapper', // Telas Docs
            'documentsHome', // Menu Docs
            'stockContainer', 'administracao', 'clientsContainer' // Outros
        ];

        let clicouEmAlgo = false;

        // Procura qual tela está visível agora
        for (let id of telas) {
            const tela = document.getElementById(id);
            // Se a tela existe e está visível (sem display:none e sem classe hidden)
            if (tela && !tela.classList.contains('hidden') && tela.style.display !== 'none') {
                
                // Procura o botão de voltar DENTRO dessa tela
                // No seu HTML, eles tem a classe .btn-back ou .btn-back-custom
                const botaoVoltarDaTela = tela.querySelector('.btn-back, button[aria-label="Voltar"], button[id^="backFrom"]');
                
                if (botaoVoltarDaTela) {
                    console.log(`📱 Celular apertou voltar -> Clicando automagicamente em: ${botaoVoltarDaTela.id}`);
                    botaoVoltarDaTela.click(); // SIMULA O CLIQUE FÍSICO
                    clicouEmAlgo = true;
                    break; // Paramos de procurar
                }
            }
        }

        // Se não achou nenhum botão para clicar, significa que estamos no Menu Principal.
        // Deixamos o histórico vazio para o navegador decidir (fechar ou minimizar).
        if (!clicouEmAlgo) {
            // Se quiser forçar ir pro menu principal sempre, descomente abaixo:
            // if(typeof showMainSection === 'function') showMainSection('main');
        }
    };

    // 3. GARANTIA DE INÍCIO
    history.replaceState(null, '', '');
});



// ============================================================
// FUNÇÃO AUXILIAR: ATUALIZA STATUS NO FIREBASE
// ============================================================
// ============================================================
// CORREÇÃO: SALVAR NO REALTIME DATABASE (Compatível com seu histórico)
// ============================================================
async function marcarComoEnviadoNoBanco(idDocumento) {
    if (!idDocumento) return;

    try {
        // 1. Cria a referência para o item específico dentro da pasta 'bookips'
        // ATENÇÃO: O 'db' aqui deve ser o mesmo objeto que você usa no loadBookipHistory
        // Se der erro de 'ref is not defined', certifique-se que importou { ref, update } do firebase
        const itemRef = ref(db, `bookips/${idDocumento}`);
        
        // 2. Atualiza apenas o status
        await update(itemRef, {
            statusEnvio: true,
            dataEnvio: new Date().toISOString()
        });
        
        console.log("✅ (Realtime DB) Status salvo com sucesso!");
    } catch (error) {
        console.error("Erro ao atualizar no Realtime DB:", error);
        // Tenta mostrar o erro na tela pra ajudar a debugar
        alert("Erro ao salvar status: " + error.message);
    }
}



        });