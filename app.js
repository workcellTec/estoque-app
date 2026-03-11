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
// ============================================================
// ⚡ LAZY LOADER — carrega scripts pesados só quando precisar
// html2pdf (~1.8MB) e html2canvas (~1.4MB) só são baixados
// quando o usuário tentar gerar um PDF pela primeira vez
// ============================================================
const _loadedScripts = new Set();
async function lazyLoadScript(url) {
    if (_loadedScripts.has(url)) return;
    if (document.querySelector(`script[src="${url}"]`)) {
        _loadedScripts.add(url);
        return;
    }
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => { _loadedScripts.add(url); resolve(); };
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

async function garantirPdfLibs() {
    await Promise.all([
        lazyLoadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'),
        lazyLoadScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'),
    ]);
}



// ============================================================
// 👥 SISTEMA DE PERFIS EM NUVEM (FIREBASE)
// ============================================================

// O perfil ATUAL (quem sou eu) continua salvo só no meu celular
let currentUserProfile = localStorage.getItem('ctwUserProfile') || '';
// A lista de perfis agora é uma variável que vem do banco
let teamProfilesList = {}; 
window.teamProfilesList = teamProfilesList; // expõe desde o início

// Adicione junto com suas variáveis globais
let isSystemSwitching = false; // 🔒 Trava de segurança para o toggle


// ============================================================

// ============================================================
// 🚀 SISTEMA DE EQUIPE (CACHE + VISUAL GRID + ORDENAÇÃO)
// ============================================================

// 1. Salva no celular
function salvarCacheEquipe(dados) {
    if(!dados) return;
    localStorage.setItem('cache_equipe_local', JSON.stringify(dados));
}

// 2. Carrega do celular (Instantâneo)
function carregarCacheEquipe() {
    const cache = localStorage.getItem('cache_equipe_local');
    if (cache) {
        try {
            const dados = JSON.parse(cache);
            // Popula teamProfilesList imediatamente (antes do Firebase responder)
            teamProfilesList = dados;
            window.teamProfilesList = dados; // expõe para módulos externos
            if (typeof renderizarEquipeNaTela === 'function') {
                renderizarEquipeNaTela(dados);
                console.log("⚡ Equipe carregada do Cache!");
            }
        } catch (e) { console.error("Erro cache", e); }
    }
}

// 3. O Desenhista (Cria o HTML bonito)
function renderizarEquipeNaTela(listaPerfis) {
    // Mostra o modal de perfil agora que os dados carregaram do Firebase
    if (window._pendingProfileModal) {
        window._pendingProfileModal = false;
        setTimeout(() => {
            const modal = document.getElementById('profileSelectorModal');
            if (modal) modal.classList.add('active');
        }, 300);
    }
    const container = document.getElementById('profilesList');
    if(!container) return;
    
    container.innerHTML = ''; 

    // A. Converte Objeto em Array
    let arrayPerfis = Object.entries(listaPerfis).map(([key, value]) => {
        return { id: key, ...value };
    });

    // B. ORDENAÇÃO (Admin -> Ordem de Chegada)
    arrayPerfis.sort((a, b) => {
        // Regra 1: Admin/Dono CONTINUA no topo (Opcional, se não quiser avisa)
        const aAdmin = (a.role === 'admin' || a.role === 'dono') ? 1 : 0;
        const bAdmin = (b.role === 'admin' || b.role === 'dono') ? 1 : 0;
        
        if (aAdmin > bAdmin) return -1;
        if (aAdmin < bAdmin) return 1;

        // Regra 2: Ordem de CRIAÇÃO (Quem foi criado antes aparece antes)
        // Se não tiver data (perfis antigos), usa o ID do Firebase que também é cronológico
        const dataA = a.createdAt || a.id;
        const dataB = b.createdAt || b.id;
        
        // Compara as datas (Texto simples funciona para data ISO)
        return dataA.localeCompare(dataB);
    });

    // C. Desenha os cartões
    arrayPerfis.forEach(perfil => {
        const nome = perfil.name;
        
        const cores = ['#EF5350', '#2979FF', '#00E676', '#FFD600', '#AB47BC', '#FF7043'];
        const cor = cores[nome.length % cores.length];
        const inicial = nome.charAt(0).toUpperCase();

        const card = document.createElement('div');
        card.className = 'team-card'; 

        // Foto: Firebase (sincronizado) → localStorage (cache) → inicial
        const _avFirebase = perfil.avatarUrl || null;
        const _avLsKey    = 'ctwAvatar_' + nome.toLowerCase().replace(/\s+/g, '_');
        const _avUrl      = _avFirebase || localStorage.getItem(_avLsKey) || null;
        const _avHtml     = _avUrl
            ? `<img src="${_avUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="${nome}">`
            : inicial;

        card.innerHTML = `
            <div onclick="setProfile('${nome}')" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; cursor: pointer;">
                <div class="team-avatar" style="background: ${cor}; overflow:hidden; padding:0;">${_avHtml}</div>
                <div class="text-truncate w-100 fw-bold" style="color: var(--text-color); font-size: 0.9rem;">${nome}</div>
                <div class="mt-1 d-flex gap-1 justify-content-center flex-wrap">
                    ${nome === currentUserProfile ? '<span class="badge bg-success" style="font-size: 0.6rem">VOCÊ</span>' : ''}
                    ${perfil.role === 'admin' || perfil.role === 'dono' ? '<span class="badge bg-primary" style="font-size: 0.6rem">ADMIN</span>' : ''}
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}


// 4. Conexão Principal (Listener)
function setupTeamProfilesListener() {
    const db = getDatabase();
    const profilesRef = ref(db, 'team_profiles');

    carregarCacheEquipe(); // Carrega rápido

    onValue(profilesRef, (snapshot) => { // Ouve o banco
        const data = snapshot.val();
        if (data) {
            teamProfilesList = data;
            window.teamProfilesList = data; // expõe para módulos externos (Favorites.js, syncSheetProfile, etc.)
            salvarCacheEquipe(data);
            renderizarEquipeNaTela(data);
            // Recarrega avatar quando Firebase confirmar os dados (inclui avatarUrl)
            if (typeof window._loadAvatar === 'function') setTimeout(window._loadAvatar, 100);
            // Se o sheet estiver aberto, atualiza o avatar lá também
            setTimeout(function() {
                var sheet = document.getElementById('ctwProfileSheet');
                if (sheet && sheet.style.display !== 'none' && typeof syncSheetProfile === 'function') {
                    syncSheetProfile();
                }
            }, 150);
            // Recarrega favoritos do Firebase para o perfil atual
            if (typeof window._onFavsFirebaseUpdate === 'function') {
                setTimeout(window._onFavsFirebaseUpdate, 200);
            }
            // Re-popula o select de atribuição se o modal de edição de cliente estiver aberto
            setTimeout(function() {
                var atribEl = document.getElementById('editClientAtribuido');
                var overlay = document.getElementById('editClientModalOverlay');
                if (!atribEl || !overlay || !overlay.classList.contains('active')) return;
                var valorAtual = atribEl.value;
                var nomes = Object.values(data).map(function(p){ return p.name; }).filter(Boolean).sort();
                atribEl.innerHTML = '<option value="">— Nenhum (notifica todos) —</option>'
                    + nomes.map(function(n){ return '<option value="' + n + '"' + (n === valorAtual ? ' selected' : '') + '>' + n + '</option>'; }).join('');
                if (valorAtual && !nomes.includes(valorAtual)) {
                    atribEl.innerHTML += '<option value="' + valorAtual + '" selected>' + valorAtual + ' ⚠️</option>';
                }
            }, 150);
        } else {
            const container = document.getElementById('profilesList');
            if(container) container.innerHTML = '<div class="text-center text-muted py-4">Nenhum perfil encontrado.</div>';
        }
    });
}

// SUBSTITUA A FUNÇÃO window.setProfile POR ESTA:

// setProfileConfirmed: chamado após senha validada (ou perfil sem senha)
window.setProfileConfirmed = function(name) {
    currentUserProfile = name;
    localStorage.setItem('ctwUserProfile', name);
    
    const displayMenu = document.getElementById('displayProfileName');
    if(displayMenu) displayMenu.innerText = name;
    
    const tituloPrincipal = document.querySelector('#mainMenu h2');
    if(tituloPrincipal) {
        tituloPrincipal.innerHTML = `Bem-vindo(a), <span class="text-primary">${name}</span><br/>O que você quer fazer?`;
    }

    // Mostra o X do modal (bloqueado para primeiro acesso)
    var closeBtn = document.getElementById('profileModalCloseBtn');
    if(closeBtn) closeBtn.style.display = '';

    // Fecha o modal e confirma
    setTimeout(() => {
        const modal = document.getElementById('profileSelectorModal');
        if(modal) modal.classList.remove('active');
        if(typeof showCustomModal === 'function') showCustomModal({ message: `Perfil definido: ${name} 🚀` });
        // Sincroniza sheet v2 (nome + avatar)
        if(typeof window.syncSheetProfile === 'function') window.syncSheetProfile();
        // Carrega avatar para o perfil selecionado
        if(typeof window._loadAvatar === 'function') window._loadAvatar();
        // Carrega favoritos do Firebase para este perfil
        if(typeof window._loadFavsForProfile === 'function') window._loadFavsForProfile(name);
        if(typeof setupTeamProfilesListener === 'function') setupTeamProfilesListener();
    }, 200);
};

// ============================================================
// 🚪 SAIR DO PERFIL — bloqueia app e exige novo login
// ============================================================
window.sairDoPerfil = function() {
    if (typeof showCustomModal === 'function') {
        showCustomModal({
            message: 'Deseja sair do perfil atual?',
            confirmText: 'Sair',
            cancelText: 'Cancelar',
            onConfirm: function() {
                // 1. Limpa o perfil salvo
                currentUserProfile = '';
                localStorage.removeItem('ctwUserProfile');

                // 2. Atualiza display
                var displayMenu = document.getElementById('displayProfileName');
                if (displayMenu) displayMenu.innerText = 'Visitante';
                var sheetName = document.getElementById('ctwSheetProfileName');
                if (sheetName) sheetName.innerText = 'Visitante';
                var navLabel = document.getElementById('ctwNavProfileLabel');
                if (navLabel) navLabel.innerText = 'Perfil';

                // 3. Limpa avatar da tela
                var avImg  = document.getElementById('avatarPhotoImg');
                var avIcon = document.getElementById('avatarPhotoIcon');
                if (avImg)  { avImg.src = ''; avImg.style.display = 'none'; }
                if (avIcon) avIcon.style.display = '';

                // 4. (sheet já fechado antes de chamar esta função)

                // 5. Esconde o X do modal para forçar seleção
                setTimeout(function() {
                    var closeBtn = document.getElementById('profileModalCloseBtn');
                    if (closeBtn) closeBtn.style.display = 'none';

                    // 6. Abre o seletor de perfil obrigatório
                    var modal = document.getElementById('profileSelectorModal');
                    if (modal) modal.classList.add('active');
                }, 200);
            },
            onCancel: function() {}
        });
    }
};


// setProfile: verifica se perfil tem senha antes de confirmar
window.setProfile = function(name) {
    // Busca o perfil no cache
    var perfil = null;
    if(teamProfilesList) {
        Object.values(teamProfilesList).forEach(function(p) {
            if(p.name === name) perfil = p;
        });
    }

    if(perfil && perfil.senha) {
        // Pede a senha via modal inline
        window._showPasswordModal(name, function(senhaDigitada) {
            if(senhaDigitada === perfil.senha) {
                window.setProfileConfirmed(name);
            } else {
                if(typeof showCustomModal === 'function')
                    showCustomModal({ message: '❌ Senha incorreta. Tente novamente.' });
            }
        });
    } else {
        window.setProfileConfirmed(name);
    }
};

// Modal inline de senha para seleção de perfil
window._showPasswordModal = function(userName, onConfirm) {
    var existing = document.getElementById('_profilePwdOverlay');
    if(existing) existing.remove();

    var ov = document.createElement('div');
    ov.id = '_profilePwdOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:25000;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:20px;';
    ov.innerHTML = '<div style="background:var(--bg-color,#0b1325);border:1px solid var(--glass-border);border-radius:20px;padding:24px;width:100%;max-width:340px;display:flex;flex-direction:column;gap:14px;">'
        + '<div style="font-weight:700;font-size:1rem;color:var(--text-color);">&#x1F510; Senha de ' + userName + '</div>'
        + '<input id="_profilePwdInput" type="password" class="form-control" placeholder="Digite sua senha" autocomplete="current-password" style="text-align:center;letter-spacing:4px;font-size:1.1rem;">'
        + '<div style="display:flex;gap:10px;">'
        + '<button id="_profilePwdCancel" class="btn btn-outline-secondary flex-fill">Cancelar</button>'
        + '<button id="_profilePwdConfirm" class="btn btn-primary flex-fill">Entrar</button>'
        + '</div></div>';
    document.body.appendChild(ov);

    var input = document.getElementById('_profilePwdInput');
    setTimeout(function() { if(input) input.focus(); }, 80);

    function doConfirm() {
        var val = (input ? input.value : '');
        ov.remove();
        onConfirm(val);
    }
    document.getElementById('_profilePwdConfirm').addEventListener('click', doConfirm);
    document.getElementById('_profilePwdCancel').addEventListener('click', function() { ov.remove(); });
    if(input) input.addEventListener('keydown', function(e) { if(e.key === 'Enter') doConfirm(); });
};


// SUBSTITUA A FUNÇÃO window.criarNovoPerfil POR ESTA:

window.criarNovoPerfil = function() {
    if(typeof showCustomModal === 'function') {
        // Truque para o modal de senha/input ficar ACIMA do modal de perfil
        const modalInput = document.getElementById('customModalOverlay');
        if(modalInput) modalInput.style.zIndex = "20005"; // Mais alto que o perfil (20000)

        showCustomModal({
            message: "Nome do novo membro da equipe:",
            showPassword: true, 
            confirmText: "Salvar e Entrar",
            onConfirm: (novoNome) => {
                if(novoNome && novoNome.trim() !== "") {
                    const nomeLimpo = novoNome.trim();
                    
                    // 1. Salva no Firebase
                    push(ref(db, 'team_profiles'), {
                        name: nomeLimpo,
                        createdAt: new Date().toISOString()
                    }).then(() => {
                        // 2. A MÁGICA: Já seleciona e fecha a janela na hora!
                        setProfile(nomeLimpo);
                        
                        // Restaura o z-index original do modal
                        if(modalInput) modalInput.style.zIndex = ""; 
                    }).catch(err => alert("Erro ao criar: " + err.message));
                }
            },
            onCancel: () => {
                // Restaura o z-index se cancelar
                if(modalInput) modalInput.style.zIndex = ""; 
            }
        });
        
        // Ajuste visual do input
        setTimeout(() => {
            const input = document.getElementById('customModalPasswordInput');
            if(input) { input.type = "text"; input.placeholder = "Ex: Vendedor Tarde"; input.focus(); }
        }, 50);
    }
}

// 4. Apagar (Remove do Firebase para todos)
window.apagarPerfil = function(key, nome) {
    if(confirm(`Tem certeza que deseja remover "${nome}" da equipe? Isso sumirá para todos.`)) {
        const profileRef = ref(db, `team_profiles/${key}`);
        remove(profileRef).catch(err => alert("Erro ao apagar: " + err.message));
    }
}

// 5. Inicialização
document.addEventListener('DOMContentLoaded', () => {
    
    if (!currentUserProfile) {
        // Sem perfil: bloqueia acesso — aguarda Firebase carregar perfis
        window._pendingProfileModal = true;
        // Esconde o botão X para forçar seleção de perfil
        setTimeout(function() {
            var closeBtn = document.getElementById('profileModalCloseBtn');
            if(closeBtn) closeBtn.style.display = 'none';
        }, 100);
    } else {
        // Já tem perfil — garante que X do modal fica visível
        setTimeout(function() {
            var closeBtn = document.getElementById('profileModalCloseBtn');
            if(closeBtn) closeBtn.style.display = '';
        }, 100);
        // --- SE JÁ TEM USUÁRIO, MOSTRA O NOME NOS LUGARES CERTOS ---
        
        // 1. Texto pequeno "Usuário: Brendon" (Mantém o original)
        const topoTitulo = document.querySelector('.d-flex.flex-column small');
        if(topoTitulo) topoTitulo.innerText = "Usuário: " + currentUserProfile;

        // 2. No Menu do Avatar (Cartão de Visita) - NOVO
        const displayMenu = document.getElementById('displayProfileName');
        if(displayMenu) displayMenu.innerText = currentUserProfile;

        // 3. Título Principal "Bem-vindo(a), Brendon" - NOVO
        const tituloPrincipal = document.querySelector('#mainMenu h2');
        if(tituloPrincipal) {
            tituloPrincipal.innerHTML = `Bem-vindo(a), <span class="text-primary">${currentUserProfile}</span><br/>O que você quer fazer?`;
        }
    }
});



// Adicione junto com as outras variáveis globais (perto de userId, products, etc.)
let currentEditingBookipId = null; // Guarda o ID se estiver editando




// === FUNÇÃO MÁGICA DE CARREGAMENTO (Cria a tela sozinha) ===
function toggleLoader(show, text = 'Aguarde...') {
    let loader = document.getElementById('loaderMagico');
    
    // Se a tela não existir, cria ela agora mesmo!
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'loaderMagico';
        // Estilo forçado para garantir que apareça em cima de tudo (Z-Index alto)
        loader.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 2147483647; display: none; flex-direction: column; align-items: center; justify-content: center; backdrop-filter: blur(5px);";
        loader.innerHTML = '<div class="spinner-border text-primary" style="width: 4rem; height: 4rem;" role="status"></div><h4 class="mt-4 text-white" id="loaderTexto" style="font-weight: 300;">Processando...</h4>';
        document.body.appendChild(loader);
    }
    
    const txt = document.getElementById('loaderTexto');
    if (txt) txt.innerText = text;

    if (show) {
        loader.style.display = 'flex';
    } else {
        loader.style.display = 'none';
    }
}


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
let currentEditingBoletoId = null;
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



// → Movido para bookip.js: abrirReciboSimples

// O botão de garantia agora é controlado pelo código novo que adicionamos anteriormente.






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

window.applyTheme = function(theme) {
    document.body.dataset.theme = theme;
    if (typeof safeStorage !== 'undefined') {
        safeStorage.setItem('ctwTheme', theme);
    }

    // --- AJUSTE DA BARRA DE STATUS ---
    const metaTheme = document.getElementById('status-bar-color');
    if (metaTheme) {
        // Se for tema light, barra branca. Se for dark, usa a cor do azul profundo do seu CSS
        const corStatus = (theme === 'light') ? '#FFFFFF' : '#0B1120';
        metaTheme.setAttribute('content', corStatus);
    }
};


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

    // Hook v2: controla visibilidade do top bar (busca global)
    // Roda aqui dentro pois os listeners chamam esta função diretamente,
    // não window.showMainSection — então o interceptor externo não basta
    (function() {
        if (localStorage.getItem('ctwMenuStyle') !== 'v2') return;
        var topBar = document.getElementById('ctwTopBar');
        if (!topBar) return;
        topBar.style.display = (sectionId === 'main') ? 'block' : 'none';
    })();

    // Desliga ouvintes antigos
    if (productsListener) { off(getProductsRef(), 'value', productsListener); productsListener = null; }
    if (boletosListener) { off(ref(db, 'boletos'), 'value', boletosListener); boletosListener = null; }

    // 1. Identifica os elementos
    const clientsContainer = document.getElementById('clientsContainer');
    
    // SUB-MENUS DA CALCULADORA
    const subMenusCalculadora = [
        'fecharVenda', 
        'repassarValores', 
        'emprestarValores', 
        'calcularEmprestimo', 
        'calcularPorAparelho'
    ];

    // 2. Esconde os Containers Principais
    mainMenu.classList.add('hidden');
    calculatorContainer.classList.add('hidden');
    contractContainer.classList.add('hidden');
    stockContainer.classList.add('hidden');
    adminContainer.classList.add('hidden');
    topRightControls.classList.add('hidden');
    
    if (clientsContainer) clientsContainer.classList.add('hidden');
    const repairsContainer = document.getElementById('repairsContainer');
    if (repairsContainer) { repairsContainer.classList.add('hidden'); repairsContainer.style.display = 'none'; }

    mainMenu.style.display = 'none';
    calculatorContainer.style.display = 'none';
    contractContainer.style.display = 'none';
    stockContainer.style.display = 'none';
    adminContainer.style.display = 'none';
    if (clientsContainer) clientsContainer.style.display = 'none';

    // 3. LIMPEZA DOS FANTASMAS
    subMenusCalculadora.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // 4. Mostra a seção escolhida (COM OTIMIZAÇÃO DE PERFORMANCE)
    if (sectionId === 'main') {
        mainMenu.classList.remove('hidden');
        mainMenu.style.display = 'flex';
        topRightControls.classList.remove('hidden');
        // Garante que o estilo correto (clássico ou 2.0) esteja visível
        if (typeof window._reapplyMenuStyle === 'function') window._reapplyMenuStyle();
    } 
    else if (sectionId === 'calculator') {
        calculatorContainer.classList.remove('hidden');
        calculatorContainer.style.display = 'block'; 
        
        // Joga o processamento para depois da renderização visual
        requestAnimationFrame(() => {
            openCalculatorSection('calculatorHome');
        });
    } 
    else if (sectionId === 'contract') {
        contractContainer.classList.remove('hidden');
        contractContainer.style.display = 'block';
        const _dh = document.getElementById('documentsHome');
        const _ac = document.getElementById('areaContratoWrapper');
        const _ab = document.getElementById('areaBookipWrapper');
        if (_dh) { _dh.classList.remove('hidden'); _dh.style.display = 'flex'; }
        if (_ac) { _ac.classList.add('hidden');    _ac.style.display = 'none'; }
        if (_ab) { _ab.classList.add('hidden');    _ab.style.display = 'none'; }
    } 
    else if (sectionId === 'stock') {
        stockContainer.classList.remove('hidden');
        stockContainer.style.display = 'flex';
        
        // OTIMIZAÇÃO: Carrega os dados pesados apenas após a tela aparecer
        requestAnimationFrame(() => {
            loadCheckedItems();
            filterStockProducts();
        });
    } 
    else if (sectionId === 'administracao') {
        adminContainer.classList.remove('hidden');
        adminContainer.style.display = 'flex';
        
        // OTIMIZAÇÃO: Renderiza a lista administrativa no próximo quadro
        requestAnimationFrame(() => {
            filterAdminProducts();
        });
    }
    else if (sectionId === 'repairs') {
        const _rc = document.getElementById('repairsContainer');
        if (_rc) { _rc.classList.remove('hidden'); _rc.style.display = 'flex'; }
        // Init module — com retry caso módulo ainda não tiver carregado
        function _tryInitRepairs(attempts) {
            if (window._repairsInited) return;
            if (window._repairsModule) {
                window._repairsInited = true;
                window._repairsModule.initRepairs();
            } else if (attempts > 0) {
                setTimeout(function() { _tryInitRepairs(attempts - 1); }, 300);
            }
        }
        _tryInitRepairs(10); // tenta por até 3s
    }
    else if (sectionId === 'clients') {
        if (clientsContainer) {
            clientsContainer.classList.remove('hidden');
            clientsContainer.style.display = 'flex';
            
            // OTIMIZAÇÃO: Renderiza a tabela de clientes no próximo quadro
            if (typeof renderClientsTable === 'function') {
                requestAnimationFrame(() => {
                    renderClientsTable();
                });
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
    
    // 1. Esconde tudo primeiro (ADICIONEI 'emprestarValores' AQUI NA LISTA)
    ['calculatorHome', 'fecharVenda', 'repassarValores', 'calcularEmprestimo', 'calcularPorAparelho', 'emprestarValores'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.style.display = 'none';
    });

    if (sectionId !== 'calcularPorAparelho') {
        currentlySelectedProductForCalc = null;
    }

    // ... o resto da função continua igual ...


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
    
    // Verifica se as taxas já carregaram
    if (!areRatesLoaded) {
        installmentsSlider.disabled = true;
        return;
    }
    
    installmentsSlider.disabled = false;
    let max = 0;
    
    // Define o limite de parcelas para cada máquina
    if (rates[machine]) {
        switch(machine) {
            case "pagbank": max = 18; break;
            case "infinity": max = 12; break;
            case "valorante": max = 21; break;
            case "nubank": max = 12; break; // <--- ADICIONADO AQUI
        }
    }
    
    installmentsSlider.max = max;
    
    // Se a parcela selecionada anteriormente for maior que o novo máximo, volta para 0
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
    
    const inputValue = parseBrazilianCurrencyToFloat(document.getElementById("fecharVendaValue").value);

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
            case "nubank": maxInstallments = 12; break; // <--- ADICIONE ESSA LINHA
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

    if (rates[machine]) { switch (machine) {
case "pagbank": maxInstallments = 18; break;
case "infinity": maxInstallments = 12; break;
case "valorante": maxInstallments = 21; break; 
case "nubank": maxInstallments = 12; break; // <--- ADICIONE ESSA LINHA
    } }
    
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

        // --- COLAR ISTO NO LUGAR DO ANTIGO 'const cardHtml' ---
        const cardHtml = `
        <div class="product-action-card" data-index="${index}">
            
            <div class="product-action-header">
                <div class="product-action-info" style="flex: 1;">
                    <h5 class="mb-1 text-start">${escapeHtml(product.nome)}</h5>
                    <div class="product-action-date text-start"><i class="bi bi-clock-history"></i> ${dateInfo}</div>
                </div>
                
                <button class="btn-settings-toggle" title="Opções do Sistema (Valor/Cores)">
                    <i class="bi bi-gear-fill"></i>
                </button>

                <button class="btn-remove-card" onclick="removerDoCarrinho(${index})" title="Remover item">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>
            
            <div class="product-action-colors">
                ${colorsHtml}
            </div>

            <div class="product-admin-panel">
                <span class="admin-warning-label"><i class="bi bi-exclamation-triangle"></i> Editar Cadastro no Sistema</span>
                
                <div class="product-action-buttons">
                    <button class="btn-action-sm edit-name-btn" data-index="${index}" data-id="${product.id}">
                        <i class="bi bi-pencil"></i> Nome
                    </button>
                    <button class="btn-action-sm edit-price-btn" data-index="${index}">
                        <i class="bi bi-cash-coin"></i> Valor
                    </button>
                    <button class="btn-action-sm edit-colors-btn" data-id="${product.id}">
                        <i class="bi bi-palette"></i> Cores
                    </button>
                </div>
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
        if (rates[machine]) { 
        switch(machine) { 
            case "pagbank": maxInstallments = 18; break; 
            case "infinity": maxInstallments = 12; break; 
            case "valorante": maxInstallments = 21; break; 
            case "nubank": maxInstallments = 12; break; // Adicionado Nubank
        } 
    }

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

    toggleLoader(true, 'Criando Imagem...'); // LIGA A TELA


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
        await garantirPdfLibs();
        await new Promise(resolve => setTimeout(resolve, 300)); // Delay para garantir renderização
        const canvas = await html2canvas(exportContainer, { backgroundColor: null, scale: 1, logging: false });
        const link = document.createElement('a');
        link.download = fileName;
        link.href = canvas.toDataURL("image/png");
        link.click();
        
        document.body.removeChild(exportContainer);
    toggleLoader(false); // DESLIGA A TELA (Sucesso)



    } catch (error) {
        console.error('Erro na exportação:', error);
        showCustomModal({ message: 'Erro ao criar imagem. Tente novamente.' });
        // Limpeza de emergência
        const oldContainer = document.querySelector('.export-container-temp');
        if(oldContainer) document.body.removeChild(oldContainer);

        toggleLoader(false); // DESLIGA A TELA (Erro)

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

            // --- INSTALADOR AUTOMÁTICO NUBANK ---
            // Verifica se o Nubank existe na nuvem. Se não, envia agora.
            if (!rates.nubank) {
                const nubankRates = {
                    debito: 0,
                    credito: [4.20, 6.09, 7.01, 7.91, 8.80, 9.67, 12.59, 13.42, 14.25, 15.06, 15.87, 16.53]
                };
                // Envia para o Firebase
                update(ref(db, 'rates/nubank'), {
                    visa: nubankRates, mastercard: nubankRates, elo: nubankRates,
                    hipercard: nubankRates, hiper: nubankRates, amex: nubankRates
                });
            }
            // ------------------------------------

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
        // Hint "não cadastrado?" — apenas para a busca de aparelho
        if (searchTerm && searchTerm.length >= 2 && resultsContainerId === 'aparelhoResultsContainer') {
            const hint = document.createElement('a');
            hint.href = '#';
            hint.className = 'search-not-found-hint';
            hint.innerHTML = `🤨🤔Hmm... <strong>"${escapeHtml(searchTerm)}"</strong> parece não estar cadastrado. <span class="hint-action-link">Adicionar agora?</span>`;
            hint.onclick = (e) => { e.preventDefault(); openQuickAddModal(searchTerm, 'aparelho'); };
            resultsContainer.appendChild(hint);
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

    // Hint "não cadastrado?" — exibido perto do campo de busca
    const stockHint = document.getElementById('stockNotFoundHint');
    if (stockHint) {
        if (searchTerm && searchTerm.length >= 2 && filtered.length === 0) {
            stockHint.innerHTML = `<a href="#" class="search-not-found-hint stock-hint" id="stockAddHintLink">Hmm... <strong>"${escapeHtml(searchTerm)}"</strong> parece não estar cadastrado. <span class="hint-action-link">Adicionar agora?</span></a>`;
            const link = document.getElementById('stockAddHintLink');
            if (link) link.onclick = (e) => { e.preventDefault(); openQuickAddModal(searchTerm, 'stock'); };
        } else {
            stockHint.innerHTML = '';
        }
    }

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

// ============================================================
// QUICK ADD PRODUCT MODAL
// ============================================================
let _quickAddContext = 'aparelho'; // 'aparelho' ou 'stock'
let _quickAddColors = [];

function renderQuickAddColors() {
    const palette = document.getElementById('quickAddColorPalette');
    const selected = document.getElementById('quickAddSelectedColors');
    if (!palette || !selected) return;
    palette.innerHTML = colorPalette.map(c => {
        const isSel = _quickAddColors.some(s => s.hex.toLowerCase() === c.hex.toLowerCase());
        return `<div class="quick-swatch ${isSel ? 'selected' : ''}" style="background:${c.hex};" title="${c.nome}" data-hex="${c.hex}" data-nome="${c.nome}"></div>`;
    }).join('');
    selected.innerHTML = _quickAddColors.length === 0
        ? '<span class="text-secondary" style="font-size:0.75rem;">Nenhuma cor selecionada</span>'
        : _quickAddColors.map(c => `
            <div class="selected-color-tag">
                <div class="color-swatch-sm" style="background:${c.hex};"></div>
                <span>${c.nome}</span>
                <span class="remove-color-btn" data-hex="${c.hex}">&times;</span>
            </div>`).join('');
    palette.querySelectorAll('.quick-swatch').forEach(el => {
        el.addEventListener('click', () => {
            const hex = el.dataset.hex; const nome = el.dataset.nome;
            const idx = _quickAddColors.findIndex(c => c.hex.toLowerCase() === hex.toLowerCase());
            if (idx > -1) _quickAddColors.splice(idx, 1); else _quickAddColors.push({ nome, hex });
            renderQuickAddColors();
        });
    });
    selected.querySelectorAll('.remove-color-btn').forEach(el => {
        el.addEventListener('click', () => {
            _quickAddColors = _quickAddColors.filter(c => c.hex.toLowerCase() !== el.dataset.hex.toLowerCase());
            renderQuickAddColors();
        });
    });
}

function openQuickAddModal(searchTerm, context) {
    _quickAddContext = context || 'aparelho';
    _quickAddColors = [];
    document.getElementById('quickAddProductName').value = searchTerm || '';
    document.getElementById('quickAddProductValue').value = '';
    document.getElementById('quickAddProductQty').value = '1';
    renderQuickAddColors();
    document.getElementById('quickAddModalOverlay').classList.add('active');
    setTimeout(() => document.getElementById('quickAddProductValue').focus(), 150);
}
window.openQuickAddModal = openQuickAddModal;

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
    // Resolve URL base para que ícones relativos funcionem dentro do blob manifest
    const base = window.location.href.replace(/\/[^\/]*$/, '/');
    let manifestData = document.getElementById('manifest-data').textContent;
    // Substitui caminhos relativos de ícones por URLs absolutas
    manifestData = manifestData
        .replace(/"icon-192\.png"/g,  '"' + base + 'icon-192.png"')
        .replace(/"icon-512\.png"/g,  '"' + base + 'icon-512.png"')
        .replace(/"icon-1024\.png"/g, '"' + base + 'icon-1024.png"');
    const manifestBlob = new Blob([manifestData], {type: 'application/json'});
    const manifestURL = URL.createObjectURL(manifestBlob);
    document.querySelector('link[rel="manifest"]').setAttribute('href', manifestURL);
    
    if ('serviceWorker' in navigator) {
        // Usa URL relativa — funciona tanto em github.io/repo/ quanto em domínio próprio
        const swUrl = new URL('sw.js', window.location.href).href;
        navigator.serviceWorker.register(swUrl)
            .then(reg => console.log('✅ SW registrado:', reg.scope))
            .catch(err => console.warn('SW falhou:', err));
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
    try {
        const previewContainer = document.getElementById('contractPreview');
        if (!previewContainer) return; 

        // 1. MONTA O TEXTO DO CONTRATO
        previewContainer.innerHTML = `
            <h4 style="text-align: center; font-weight: bold;">CONTRATO PARTICULAR DE LOCAÇÃO DE BEM MÓVEL (SMARTPHONE)<br>COM OPÇÃO DE AQUISIÇÃO, GARANTIAS E CONFISSÃO DE DÍVIDA</h4>

            <p>Pelo presente instrumento particular, as partes abaixo identificadas:</p>

            <p><strong>LOCADORA:</strong><br>
            WHORKCELL TECNOLOGIA E SERVIÇOS LTDA, pessoa jurídica de direito privado, inscrita no CNPJ nº 50.299.715/0001-65, com sede em Av. Goiás, nº 4118, sala 05, St. Crimeia Oeste, Goiânia – GO, doravante denominada simplesmente LOCADORA.</p>

            <p><strong>LOCATÁRIO:</strong><br>
            Nome: <strong id="prevNome"></strong><br>
            CPF: <strong id="prevCPF"></strong><br>
            RG: <strong id="prevRG"></strong><br>
            Endereço: <strong id="prevEndereco"></strong><br>
            Telefone/WhatsApp: <strong id="prevTelefone"></strong><br>
            Doravante denominado simplesmente LOCATÁRIO.</p>

            <p>As partes têm entre si justo e contratado o que segue:</p>

            <div class="section-title" style="font-weight: bold; margin-top: 15px;">CLÁUSULA 1 – DO OBJETO</div>
            <p>1.1. O presente contrato tem por objeto a locação de bem móvel consistente em aparelho celular com as seguintes características:<br>
            Marca/Modelo: <strong id="prevModelo"></strong><br>
            IMEI: <strong id="prevIMEI"></strong><br>
            Estado: <strong id="prevEstado"></strong><br>
            Acessórios inclusos: <strong id="prevAcessorios"></strong></p>
            <p>1.2. O bem permanecerá, durante toda a vigência contratual, como propriedade exclusiva da LOCADORA, não se operando qualquer transferência dominial até eventual aquisição final.</p>

            <div class="section-title" style="font-weight: bold; margin-top: 15px;">CLÁUSULA 2 – DA NATUREZA JURÍDICA</div>
            <p>2.1. As partes reconhecem expressamente que o presente instrumento configura contrato de locação de bem móvel, nos termos dos artigos 565 e seguintes do Código Civil Brasileiro.<br>
            2.2. O presente contrato não constitui compra e venda parcelada, financiamento ou operação de crédito.<br>
            2.3. A eventual transferência de propriedade somente ocorrerá após a quitação integral das obrigações assumidas pelo LOCATÁRIO.</p>

            <div class="section-title" style="font-weight: bold; margin-top: 15px;">CLÁUSULA 3 – DO PRAZO</div>
            <p>3.1. O prazo da locação é de <strong id="prevPrazo"></strong> meses, iniciando-se na data de assinatura deste instrumento.<br>
            3.2. O contrato poderá ser rescindido antecipadamente nas hipóteses previstas neste instrumento.</p>

            <div class="section-title" style="font-weight: bold; margin-top: 15px;">CLÁUSULA 4 – DO PREÇO E FORMA DE PAGAMENTO</div>
            <p>4.1. Pela locação do bem, o LOCATÁRIO pagará à LOCADORA:<br>
            Entrada: R$ <strong id="prevEntrada"></strong> e <strong id="prevQtdParcelas"></strong> parcelas mensais de R$ <strong id="prevValorParcela"></strong>.<br>
            4.2. O pagamento será realizado mediante boleto bancário com vencimento todo dia <strong id="prevVencimento"></strong> de cada mês.<br>
            4.3. O não recebimento do boleto não exime o LOCATÁRIO da obrigação de pagamento na data de vencimento.<br>
            4.4. O atraso implicará incidência de multa, juros e correção monetária conforme legislação vigente.</p>

            <div class="section-title" style="font-weight: bold; margin-top: 15px;">CLÁUSULA 5 – DA POSSE E CONDIÇÃO DE FIEL DEPOSITÁRIO</div>
            <p>5.1. O LOCATÁRIO recebe o bem na qualidade de possuidor direto e fiel depositário, obrigando-se a zelar pela sua guarda, conservação e integridade.<br>
            5.2. O LOCATÁRIO compromete-se a restituir o bem sempre que solicitado pela LOCADORA nas hipóteses previstas neste contrato.<br>
            5.3. A não devolução injustificada do bem poderá caracterizar ilícito civil e, quando cabível, ilícito penal.</p>

            <div class="section-title" style="font-weight: bold; margin-top: 15px;">CLÁUSULA 6 – DAS OBRIGAÇÕES DO LOCATÁRIO</div>
            <p>O LOCATÁRIO obriga-se a:<br>
            I – Utilizar o aparelho de forma adequada e exclusivamente para fins lícitos;<br>
            II – Não alienar, ceder, emprestar, sublocar ou transferir o bem a terceiros;<br>
            III – Não oferecer o bem em garantia ou penhor;<br>
            IV – Não adulterar IMEI, hardware ou software para ocultar identificação;<br>
            V – Comunicar imediatamente à LOCADORA qualquer perda, furto, roubo ou dano relevante;<br>
            VI – Manter seus dados cadastrais atualizados.</p>

            <div class="section-title" style="font-weight: bold; margin-top: 15px;">CLÁUSULA 7 – RESPONSABILIDADE POR PERDA, ROUBO OU DANOS</div>
            <p>7.1. O LOCATÁRIO responderá integralmente pela perda, furto, roubo ou danos ao aparelho.<br>
            7.2. Tais eventos não extinguem a obrigação de pagamento das parcelas restantes.</p>

            <div class="section-title" style="font-weight: bold; margin-top: 15px;">CLÁUSULA 8 – DO BLOQUEIO REMOTO E MONITORAMENTO</div>
            <p>8.1. O LOCATÁRIO autoriza expressamente a instalação e utilização de sistemas de segurança, rastreamento e bloqueio remoto do aparelho.<br>
            8.2. Em caso de inadimplência, a LOCADORA poderá restringir funcionalidades do dispositivo, independentemente de autorização judicial.</p>

            <div class="section-title" style="font-weight: bold; margin-top: 15px;">CLÁUSULA 9 – DA INADIMPLÊNCIA</div>
            <p>9.1. O atraso superior a 1 dia implicará mora automática do LOCATÁRIO.<br>
            9.2. Em caso de inadimplemento, a LOCADORA poderá:<br>
            I – Considerar rescindido o contrato;<br>
            II – Exigir a devolução imediata do bem;<br>
            III – Realizar bloqueio remoto do aparelho;<br>
            IV – Promover a inscrição do nome do LOCATÁRIO nos órgãos de proteção ao crédito;<br>
            V – Protestar o débito;<br>
            VI – Promover cobrança judicial ou extrajudicial.<br>
            9.3. As parcelas pagas não serão devolvidas, por corresponderem à contraprestação pelo uso do bem.</p>

            <div class="section-title" style="font-weight: bold; margin-top: 15px;">CLÁUSULA 10 – DA CONFISSÃO DE DÍVIDA</div>
            <p>10.1. O LOCATÁRIO reconhece a certeza, liquidez e exigibilidade das obrigações financeiras decorrentes deste contrato.<br>
            10.2. O presente instrumento constitui título executivo extrajudicial, nos termos do artigo 784 do Código de Processo Civil.</p>

            <div class="section-title" style="font-weight: bold; margin-top: 15px;">CLÁUSULA 11 – DA BUSCA E APREENSÃO</div>
            <p>11.1. Em caso de inadimplemento e não devolução voluntária do bem, a LOCADORA poderá promover a retomada do aparelho pelas vias judiciais cabíveis.<br>
            11.2. O LOCATÁRIO compromete-se a informar a localização do bem sempre que solicitado.</p>

            <div class="section-title" style="font-weight: bold; margin-top: 15px;">CLÁUSULA 12 – DA OPÇÃO DE AQUISIÇÃO</div>
            <p>12.1. Após a quitação integral de todas as parcelas, o LOCATÁRIO poderá exercer a opção de aquisição <br> definitiva do bem.<br>
            12.2. A transferência da propriedade será formalizada mediante termo de quitação emitido pela LOCADORA.</p>

            <div class="section-title" style="font-weight: bold; margin-top: 15px;">CLÁUSULA 13 – DA PROTEÇÃO DE DADOS (LGPD)</div>
            <p>13.1. O LOCATÁRIO autoriza o tratamento de seus dados pessoais pela LOCADORA para execução deste contrato, análise de crédito e cobrança, nos termos da Lei nº 13.709/2018.</p>

            <div class="section-title" style="font-weight: bold; margin-top: 15px;">CLÁUSULA 14 – DA IRREVOGABILIDADE E IRRETRATABILIDADE</div>
            <p>14.1. O presente contrato é celebrado em caráter irrevogável e irretratável, obrigando as partes e seus sucessores.</p>

            <div class="section-title" style="font-weight: bold; margin-top: 15px;">CLÁUSULA 15 – DA ASSINATURA DIGITAL</div>
            <p>15.1. As partes reconhecem como válida a assinatura eletrônica ou digital realizada por plataformas certificadas, produzindo os mesmos efeitos jurídicos da assinatura manuscrita.</p>

            <div class="section-title" style="font-weight: bold; margin-top: 15px;">CLÁUSULA 16 – DO FORO</div>
            <p>16.1. Fica eleito o foro da comarca de Goiânia - Goiás, renunciando a qualquer outro  por mais <br> privilegiado que seja.</p>

            <p style="font-weight: bold;">DECLARAÇÃO FINAL</p>
            <p>O LOCATÁRIO declara ter recebido o aparelho em perfeito estado de funcionamento, com todos os acessórios informados, e que leu, compreendeu e concorda integralmente com todas as cláusulas deste contrato.</p>

            <br>
            <p style="text-align: center;">Goiânia - GO, <strong id="prevDataAtual"></strong></p>

            <br><br>
            <p style="text-align: center;">_________________________________________________________________<br>
            <strong>LOCADORA:</strong> WORKCELL TECNOLOGIA E SERVIÇOS LTDA – CNPJ: 50.299.715/0001-65</p>

            <br><br>
            <p style="text-align: center;">_________________________________________________________________<br>
            <strong>LOCATÁRIO:</strong> <strong id="prevAssinaturaNome"></strong><br>
            CPF: <strong id="prevAssinaturaCPF"></strong></p>
        `;

        // 2. CONECTA O QUE FOI DIGITADO COM OS "IDs ORIGINAIS"
        const safeSet = (idSpan, idInput) => {
            const span = document.getElementById(idSpan);
            const input = document.getElementById(idInput);
            if (span && input) {
                span.textContent = input.value;
            }
        };

        const dataDeHoje = new Date().toLocaleDateString('pt-BR');
        const spanData = document.getElementById('prevDataAtual');
        if (spanData) spanData.textContent = dataDeHoje;

        // Puxando dos IDs originais que o seu JS gosta:
        safeSet('prevNome', 'compradorNome');
        safeSet('prevAssinaturaNome', 'compradorNome');
        safeSet('prevCPF', 'compradorCpf');
        safeSet('prevAssinaturaCPF', 'compradorCpf');
        safeSet('prevRG', 'compradorRg');
        safeSet('prevEndereco', 'compradorEndereco');
        safeSet('prevTelefone', 'compradorTelefone');
        safeSet('prevModelo', 'produtoModelo');
        safeSet('prevIMEI', 'produtoImei');
        
        // Puxando dos campos novos que criei pra você
        safeSet('prevEstado', 'aparelhoEstado');
        safeSet('prevAcessorios', 'aparelhoAcessorios');
        safeSet('prevPrazo', 'contratoPrazo');
        
        // Puxando das finanças usando seus IDs
        safeSet('prevEntrada', 'valorEntrada');
        safeSet('prevQtdParcelas', 'numeroParcelas');
        safeSet('prevValorParcela', 'valorParcela');
        
        // Extrai apenas o dia (ex: 10) da data completa que o usuário selecionar
        const dataVenc = document.getElementById('primeiroVencimento')?.value;
        let diaVenc = "";
        if (dataVenc) {
            const parts = dataVenc.split('-');
            if(parts.length === 3) diaVenc = parts[2];
        }
        const spanVenc = document.getElementById('prevVencimento');
        if (spanVenc) spanVenc.textContent = diaVenc;

    } catch (error) {
        console.error("Erro no contrato:", error);
    }
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
        const telefoneHtml = whatsappLink ? `<a href="${whatsappLink}" target="_blank" class="btn btn-sm btn-success py-0"><i class="bi bi-whatsapp"></i> ${escapeHtml(boleto.compradorTelefone)}</a>` : '(Não informado)';
        return `
        <div class="accordion-item">
            <h2 class="accordion-header" id="heading-${boleto.id}">
                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-${boleto.id}" aria-expanded="false" aria-controls="collapse-${boleto.id}">
                    ${escapeHtml(boleto.compradorNome)} — ${new Date(boleto.criadoEm).toLocaleDateString('pt-BR')}
                </button>
            </h2>
            <div id="collapse-${boleto.id}" class="accordion-collapse collapse" aria-labelledby="heading-${boleto.id}" data-bs-parent="#boletosAccordion">
                <div class="accordion-body">
                    <p class="mb-1"><strong>Comprador:</strong> ${escapeHtml(boleto.compradorNome)}</p>
                    <p class="mb-1"><strong>CPF:</strong> ${escapeHtml(boleto.compradorCpf || '—')}</p>
                    <p class="mb-2"><strong>Telefone:</strong> ${telefoneHtml}</p>
                    <p class="mb-1"><strong>Produto:</strong> ${escapeHtml(boleto.produtoModelo || '—')}</p>
                    <p class="mb-2"><strong>IMEI:</strong> ${escapeHtml(boleto.produtoImei || '—')}</p>
                    <p class="mb-1"><strong>Valor Total:</strong> R$ ${Number(boleto.valorTotal||0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                    <p class="mb-1"><strong>Entrada:</strong> R$ ${Number(boleto.valorEntrada||0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                    <p class="mb-2"><strong>Parcelas:</strong> ${boleto.numeroParcelas}x de R$ ${boleto.valorParcela}</p>
                    <hr style="border-color: var(--glass-border); margin: 8px 0;">
                    <div class="d-flex gap-2 flex-wrap justify-content-end">
                        <button class="btn btn-sm btn-primary editar-boleto-btn" data-id="${boleto.id}"><i class="bi bi-pencil-fill"></i> Editar</button>
                        <button class="btn btn-sm btn-success reenviar-boleto-btn" data-id="${boleto.id}"><i class="bi bi-share-fill"></i> Reenviar</button>
                        <button class="btn btn-sm btn-outline-danger delete-boleto-btn" data-id="${boleto.id}"><i class="bi bi-trash"></i> Excluir</button>
                    </div>
                </div>
            </div>
        </div>`
    }).join('')}</div>`;

    // --- EDITAR ---
    historyContainer.querySelectorAll('.editar-boleto-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const boletoId = e.currentTarget.dataset.id;
            const boleto = boletosArray.find(b => b.id === boletoId);
            if (!boleto) return;

            // Guarda ID no campo hidden do formulário (mais seguro que variável JS)
            const hiddenId = document.getElementById('editingBoletoId');
            if (hiddenId) hiddenId.value = boletoId;
            window.currentEditingBoletoId = boletoId; // mantém compatibilidade

            // Preenche o formulário
            document.getElementById('compradorNome').value = boleto.compradorNome || '';
            document.getElementById('compradorCpf').value = boleto.compradorCpf || '';
            document.getElementById('compradorRg').value = boleto.compradorRg || '';
            document.getElementById('compradorTelefone').value = boleto.compradorTelefone || '';
            document.getElementById('compradorEndereco').value = boleto.compradorEndereco || '';
            document.getElementById('produtoModelo').value = boleto.produtoModelo || '';
            document.getElementById('produtoImei').value = boleto.produtoImei || '';
            document.getElementById('valorTotal').value = boleto.valorTotal || '';
            document.getElementById('valorEntrada').value = boleto.valorEntrada || '';
            document.getElementById('numeroParcelas').value = boleto.numeroParcelas || '';
            document.getElementById('tipoParcela').value = boleto.tipoParcela || 'mensais';
            document.getElementById('primeiroVencimento').value = boleto.primeiroVencimento || '';
            document.getElementById('valorTotal').dispatchEvent(new Event('input'));

            // Troca para aba "Novo" SEM disparar o change (evita re-render do histórico)
            const toggle = document.getElementById('boletoModeToggle');
            if (toggle && toggle.checked) {
                toggle.checked = false;
                // Troca as divs manualmente sem chamar loadBoletosHistory
                const newContent = document.getElementById('newBoletoContent');
                const histContent = document.getElementById('historyBoletoContent');
                if (newContent) newContent.classList.remove('hidden');
                if (histContent) histContent.classList.add('hidden');
            }

            // Atualiza o botão para indicar edição
            const btnImprimir = document.getElementById('btnImprimir');
            if (btnImprimir) {
                btnImprimir.innerHTML = '<i class="bi bi-save-fill"></i> Salvar Alterações';
                btnImprimir.classList.remove('btn-primary');
                btnImprimir.classList.add('btn-warning');
            }

            // Banner de alerta de edição
            let banner = document.getElementById('editingBannerBoleto');
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'editingBannerBoleto';
                banner.style.cssText = 'background:#f0ad4e;color:#000;padding:8px 12px;border-radius:8px;margin-bottom:10px;font-weight:bold;display:flex;justify-content:space-between;align-items:center;';
                const form = document.getElementById('contractForm');
                if (form) form.parentNode.insertBefore(banner, form);
            }
            banner.innerHTML = '<span>✏️ Editando contrato de <strong>' + escapeHtml(boleto.compradorNome || '') + '</strong></span>' +
                '<button type="button" onclick="cancelarEdicaoBoleto()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;">✕</button>';
            banner.style.display = 'flex';
        });
    });

    // --- REENVIAR ---
    historyContainer.querySelectorAll('.reenviar-boleto-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const boletoId = e.currentTarget.dataset.id;
            const boleto = boletosArray.find(b => b.id === boletoId);
            if (!boleto) return;

            // Preenche o preview com os dados do boleto
            document.getElementById('compradorNome').value = boleto.compradorNome || '';
            document.getElementById('compradorCpf').value = boleto.compradorCpf || '';
            document.getElementById('compradorRg').value = boleto.compradorRg || '';
            document.getElementById('compradorTelefone').value = boleto.compradorTelefone || '';
            document.getElementById('compradorEndereco').value = boleto.compradorEndereco || '';
            document.getElementById('produtoModelo').value = boleto.produtoModelo || '';
            document.getElementById('produtoImei').value = boleto.produtoImei || '';
            document.getElementById('valorTotal').value = boleto.valorTotal || '';
            document.getElementById('valorEntrada').value = boleto.valorEntrada || '';
            document.getElementById('numeroParcelas').value = boleto.numeroParcelas || '';
            document.getElementById('tipoParcela').value = boleto.tipoParcela || 'mensais';
            document.getElementById('primeiroVencimento').value = boleto.primeiroVencimento || '';

            populatePreview();

            const tempDiv = document.createElement('div');
            tempDiv.style.cssText = 'font-family: Times New Roman, serif; font-size: 10pt; line-height: 1.5; color: #000; background: #fff; padding: 20px; width: 750px; box-sizing: border-box;';
            tempDiv.innerHTML = document.getElementById('contractPreview').innerHTML;

            const titulo = tempDiv.querySelector('h4');
            if (titulo) titulo.style.cssText = 'font-size: 10.5pt; font-weight: bold; color: #000; text-align: center; margin-bottom: 16pt; line-height: 1.4;';

            tempDiv.querySelectorAll('p, div, strong, span').forEach(el => {
                el.style.wordBreak = 'keep-all';
                el.style.overflowWrap = 'break-word';
                el.style.pageBreakInside = 'avoid';
            });

            const nomeArq = 'Contrato-' + (boleto.compradorNome || 'cliente').split(' ')[0] + '.pdf';
            await garantirPdfLibs();
          const opt = {
                margin: [10, 10, 10, 10],
                filename: nomeArq,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            showCustomModal({ message: 'Gerando PDF, aguarde...' });

            html2pdf().set(opt).from(tempDiv).output('blob').then(async function(pdfBlob) {
                const file = new File([pdfBlob], nomeArq, { type: 'application/pdf' });
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({
                            files: [file],
                            title: 'Contrato Workcell Tecnologia',
                            text: 'Olá ' + (boleto.compradorNome || 'Cliente') + ', segue seu contrato em anexo.'
                        });
                    } catch(err) {
                        if (err.name !== 'AbortError') {
                            const url = URL.createObjectURL(pdfBlob);
                            const a = document.createElement('a');
                            a.href = url; a.download = nomeArq; a.click();
                            URL.revokeObjectURL(url);
                        }
                    }
                } else {
                    const url = URL.createObjectURL(pdfBlob);
                    const a = document.createElement('a');
                    a.href = url; a.download = nomeArq; a.click();
                    URL.revokeObjectURL(url);
                }
            }).catch(err => showCustomModal({ message: 'Erro ao gerar PDF: ' + err.message }));
        });
    });

    // --- EXCLUIR ---
    historyContainer.querySelectorAll('.delete-boleto-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const boletoId = e.currentTarget.dataset.id;
            const boleto = boletosArray.find(b => b.id === boletoId);
            const nomeCliente = boleto ? boleto.compradorNome : 'este registro';
            showCustomModal({
                message: 'Tem certeza que deseja excluir o contrato de <strong>' + escapeHtml(nomeCliente) + '</strong>? Esta ação NÃO pode ser desfeita.',
                confirmText: "Sim, Excluir",
                onConfirm: async () => {
                    showCustomModal({
                        message: 'CONFIRMAÇÃO FINAL: Apagar o contrato de <strong>' + escapeHtml(nomeCliente) + '</strong> permanentemente?',
                        confirmText: "Apagar Definitivamente",
                        onConfirm: async () => {
                            try {
                                await remove(ref(db, 'boletos/' + boletoId));
                                showCustomModal({ message: "Registro excluído com sucesso." });
                            } catch (error) {
                                showCustomModal({ message: 'Erro ao excluir: ' + error.message });
                            }
                        },
                        onCancel: () => {}
                    });
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

    // Aniversários (aguarda 5s para dbClientsCache estar preenchido)
    setTimeout(() => window.checarAniversariosHoje && window.checarAniversariosHoje(), 5000);
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
                                clienteNome: boleto.compradorNome || '',
                                clienteTel: boleto.compradorTelefone || '',
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


// SUBSTITUA A FUNÇÃO updateNotificationUI POR ESTA:

function updateNotificationUI(notifications) {
    // Guarda TODAS as notificações (sem filtro) para referência
    window._currentNotifications = notifications || [];

    // Aplica filtro de preferência antes de mostrar
    notifications = typeof window.filterNotifsByPref === 'function'
        ? window.filterNotifsByPref(notifications || [])
        : (notifications || []);

    console.log("🔔 Notificações:", notifications.length, "| pref:", window.getNotifPref?.() || 'all');

    const oldBadge = document.querySelector('#notification-bell .notification-badge');
    const avatarBadge = document.getElementById('avatar-badge');
    const menuArea = document.getElementById('menu-notification-area');
    const menuText = document.getElementById('menu-notification-text');

    if (notifications.length > 0) {
        // Push nativo
        window.dispararNotificacaoNativa && window.dispararNotificacaoNativa(notifications);

        if (avatarBadge) { avatarBadge.classList.remove('hidden'); avatarBadge.style.display = 'block'; }
        if (oldBadge) { oldBadge.textContent = notifications.length; oldBadge.classList.remove('hidden'); }

        let texto = 'Nova notificação';
        if (notifications[0]?.message) {
            const d = document.createElement('div');
            d.innerHTML = notifications[0].message;
            texto = d.textContent.trim();
        }
        if (menuArea) { menuArea.classList.remove('hidden'); menuArea.style.display = 'block'; }
        if (menuText) { menuText.innerText = texto; localStorage.setItem('sys_ultimo_aviso', texto); }
    } else {
        window._currentNotifications = [];
        if (avatarBadge) avatarBadge.classList.add('hidden');
        if (menuArea) menuArea.classList.add('hidden');
        if (oldBadge) oldBadge.classList.add('hidden');
        localStorage.removeItem('sys_ultimo_aviso');
        // Remove balões se não há notificações
        const existing = document.getElementById('notif-balloons-container');
        if (existing) existing.remove();
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

// ============================================================
// ============================================================
// 🤖 FUNÇÃO DE TEMA (ESPECIAL PARA ANDROID)
// ============================================================
window.applyColorTheme = function(color) {
    if (!color) return;

    // 1. Aplica o atributo para o CSS reagir
    document.body.removeAttribute('data-color');
    if (color !== 'red') { // 'red' é o padrão, se for outro, aplica
        document.body.setAttribute('data-color', color);
    }
    
    // 2. Salva na memória (com segurança)
    try {
        if (typeof safeStorage !== 'undefined') {
            safeStorage.setItem('ctwColorTheme', color);
        } else {
            localStorage.setItem('ctwColorTheme', color);
        }
    } catch (e) { console.warn('Erro ao salvar tema:', e); }

    // 3. Feedback Visual nos botões
    const btns = document.querySelectorAll('.theme-option-btn');
    if (btns) {
        btns.forEach(btn => {
            btn.innerHTML = ''; 
            btn.classList.remove('active');
            if (btn.dataset.color === color) {
                btn.classList.add('active');
                btn.innerHTML = '<i class="bi bi-check-lg"></i>';
            }
        });
    }

    // 4. LÓGICA "AMBIENT MODE" (Barra de Status Android)
    // O Android precisa de um tempinho para entender que a cor do fundo mudou
    setTimeout(() => {
        const metaTheme = document.getElementById('status-bar-color');
        
        if (metaTheme) {
            // Pega o estilo computado do corpo da página
            const style = getComputedStyle(document.body);
            
            // Tenta pegar a variável --tertiary-color
            let androidColor = style.getPropertyValue('--tertiary-color').trim();

            // Se a variável estiver vazia, pega a cor de fundo bruta (background-color)
            if (!androidColor || androidColor === 'rgba(0, 0, 0, 0)') {
                androidColor = style.backgroundColor;
            }

            // Se ainda assim falhar, forçamos a cor padrão do seu tema (Dark Blue)
            // Isso evita que fique branco ou preto padrão
            if (!androidColor || androidColor === 'rgba(0, 0, 0, 0)') {
                androidColor = '#0B1120'; 
            }

            // Aplica na Meta Tag do Android
            metaTheme.setAttribute('content', androidColor);
            
            // Console log para você debugar se precisar
            // console.log('Android Theme Applied:', androidColor);
        }
    }, 100); // 100ms é o tempo ideal para o motor do Chrome atualizar
};

// 5. Garante que rode ao abrir o App (Autocorreção)
(function() {
    // Espera 200ms para garantir que o HTML carregou
    setTimeout(() => {
        const salvo = localStorage.getItem('ctwColorTheme') || 'red';
        if(window.applyColorTheme) window.applyColorTheme(salvo);
    }, 200);
})();




async function main() {
    try {
        setupPWA();
        applyTheme(safeStorage.getItem('theme') || 'dark');
        applyColorTheme(safeStorage.getItem('ctwColorTheme') || 'red');

        // BOOT ANIMATION — carrossel de recursos do app
        (function runBootAnimation() {
            const track = document.getElementById('carouselTrack');
            const label = document.getElementById('carouselLabel');
            const msg   = document.getElementById('bootMsg');
            if (!track) return;

            // Emojis e labels dos recursos do app
            const items = [
                { emoji: '🧮', text: 'Calculadora de taxas'     },
                { emoji: '📋', text: 'Contratos e boletos'       },
                { emoji: '👥', text: 'Cadastro de clientes'      },
                { emoji: '📦', text: 'Estoque de produtos'       },
                { emoji: '🔔', text: 'Notificações em tempo real'},
                { emoji: '🎂', text: 'Aniversários dos clientes' },
                { emoji: '📊', text: 'Histórico de vendas'       },
                { emoji: '🏷️', text: 'Etiquetas personalizadas'  },
                { emoji: '💳', text: 'Controle de parcelas'      },
                { emoji: '📱', text: 'Funciona no celular'       },
            ];

            let current = 0;

            function showItem(i) {
                const item = items[i % items.length];

                // Limpa e cria novo item com animação
                track.innerHTML = '';
                track.style.animation = 'none';
                track.offsetHeight; // reflow para reiniciar animação
                track.style.animation = '';

                const el = document.createElement('div');
                el.className = 'ctw-carousel-item';
                el.textContent = item.emoji;
                track.appendChild(el);

                // Atualiza label com fade
                if (label) {
                    label.style.opacity = '0';
                    setTimeout(() => {
                        label.textContent = item.text;
                        label.style.opacity = '1';
                    }, 150);
                }
            }

            // Status messages paralelo ao carrossel
            const msgs = [
                'Preparando tudo pra você...',
                'Conectando ao servidor...',
                'Quase pronto...',
            ];
            let msgIdx = 0;

            showItem(0);

            const iv = setInterval(() => {
                current++;
                showItem(current);

                // Troca msg a cada 3 itens
                if (current % 3 === 0 && msg) {
                    msgIdx = (msgIdx + 1) % msgs.length;
                    msg.textContent = msgs[msgIdx];
                }
            }, 900);

            // Para quando o loading sumir
            const overlay = document.getElementById('loadingOverlay');
            if (overlay) {
                new MutationObserver((_, obs) => {
                    if (overlay.style.opacity === '0') {
                        clearInterval(iv);
                        if (label) { label.style.opacity='0'; label.textContent = ''; }
                        if (msg)   msg.textContent = '✓ Pronto!';
                        obs.disconnect();
                    }
                }).observe(overlay, { attributes: true, attributeFilter: ['style'] });
            }
        })();

        app = initializeApp(firebaseConfig); 
        auth = getAuth(app); 
        db = getDatabase(app);
        
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
                isAuthReady = true;
                // Expõe db AGORA — depois do auth, quando db está pronto
                window._firebaseDB = db;
                window._dbRef    = ref;    // expõe ref() para módulos IIFE
                window._dbUpdate = update; // expõe update() para módulos IIFE

                // PERFORMANCE: esconde loading IMEDIATAMENTE após auth
                // dados carregam em background sem bloquear a UI
                const loadingOverlay = document.getElementById('loadingOverlay');
                
                // Navega já
                const lastSection = safeStorage.getItem('ctwLastSection');
                if (lastSection && lastSection !== 'main') {
                    showMainSection(lastSection);
                } else {
                    showMainSection('main');
                }

                // Fade out rápido
                if (loadingOverlay) {
                    loadingOverlay.style.opacity = '0';
                    setTimeout(() => { loadingOverlay.style.display = 'none'; }, 300);
                }

                // Carrega dados em background — paralelo, sem travar a UI
                setTimeout(() => {
                    loadRatesFromDB();
                    loadProductsFromDB();
                    loadTagsFromDB();
                    loadTagTexts();
                    loadSettingsFromDB();
                    setupNotificationListeners();
                    setupTeamProfilesListener();
                }, 50);
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


    
    
    document.getElementById('notification-bell').addEventListener('click', (e) => {
    e.stopPropagation();
    window.toggleNotifBalloons();
});
    
    // LISTENER PARA O NOVO CARD (Cores e Preço)
        // LISTENER ATUALIZADO PARA O CARRINHO UNIFICADO
    // Mudamos de 'aparelhoInfoNote' para 'carrinhoAparelhosContainer'
        // LISTENER DO CARRINHO (Editar Valor, Editar Cores E FAVORITAR)
    const carrinhoContainer = document.getElementById('carrinhoAparelhosContainer');
    
    if (carrinhoContainer) {
        carrinhoContainer.addEventListener('click', (e) => {

            // --- CÓDIGO NOVO: CLIQUE DA ENGRENAGEM ---
            const gearBtn = e.target.closest('.btn-settings-toggle');
            if (gearBtn) {
                e.preventDefault();
                const card = gearBtn.closest('.product-action-card');
                const panel = card.querySelector('.product-admin-panel');
                
                // Liga/Desliga
                panel.classList.toggle('active');
                gearBtn.classList.toggle('active');
                return; // Para aqui e não executa o resto
            }

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

            // 3. Botão Editar Nome
            const nameBtn = e.target.closest('.edit-name-btn');
            if (nameBtn) {
                e.preventDefault();
                const index = nameBtn.dataset.index;
                const item = carrinhoDeAparelhos[index];
                document.getElementById('editNameInput').value = item.nome;
                document.getElementById('editNameProductId').value = nameBtn.dataset.id;
                document.getElementById('editNameProductIndex').value = index;
                document.getElementById('editNameModalOverlay').classList.add('active');
                setTimeout(() => { const el = document.getElementById('editNameInput'); el.focus(); el.select(); }, 100);
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

    // Lógica do Modal de Editar Nome
    const closeNameModal = () => { const m = document.getElementById('editNameModalOverlay'); if(m) m.classList.remove('active'); };
    const _cancelEditNameBtn = document.getElementById('cancelEditNameBtn');
    const _confirmEditNameBtn = document.getElementById('confirmEditNameBtn');
    const _editNameModalOverlay = document.getElementById('editNameModalOverlay');
    if (_cancelEditNameBtn) _cancelEditNameBtn.addEventListener('click', closeNameModal);
    if (_editNameModalOverlay) _editNameModalOverlay.addEventListener('click', (e) => { if (e.target.id === 'editNameModalOverlay') closeNameModal(); });
    if (_confirmEditNameBtn) _confirmEditNameBtn.addEventListener('click', async () => {
        const newName = document.getElementById('editNameInput').value.trim();
        const productId = document.getElementById('editNameProductId').value;
        const index = document.getElementById('editNameProductIndex').value;
        if (!newName) { showCustomModal({ message: 'O nome não pode ficar vazio.' }); return; }
        try {
            await updateProductInDB(productId, { nome: newName });
            // Atualiza carrinho
            if (carrinhoDeAparelhos[index]) carrinhoDeAparelhos[index].nome = newName;
            // Atualiza lista em memória
            const p = products.find(p => p.id === productId);
            if (p) p.nome = newName;
            renderCarrinho();
            calculateAparelho();
            closeNameModal();
            showCustomModal({ message: `Nome atualizado para "${newName}" com sucesso!` });
        } catch (err) {
            showCustomModal({ message: 'Erro ao salvar o nome.' });
        }
    });

    // Lógica do Modal Quick Add Produto
    const closeQuickAddModal = () => { const m = document.getElementById('quickAddModalOverlay'); if(m) m.classList.remove('active'); };
    const _cancelQuickAddBtn = document.getElementById('cancelQuickAddBtn');
    const _confirmQuickAddBtn = document.getElementById('confirmQuickAddBtn');
    const _quickAddModalOverlay = document.getElementById('quickAddModalOverlay');
    if (_cancelQuickAddBtn) _cancelQuickAddBtn.addEventListener('click', closeQuickAddModal);
    if (_quickAddModalOverlay) _quickAddModalOverlay.addEventListener('click', (e) => { if (e.target.id === 'quickAddModalOverlay') closeQuickAddModal(); });
    if (_confirmQuickAddBtn) _confirmQuickAddBtn.addEventListener('click', async () => {
        const nome = document.getElementById('quickAddProductName').value.trim();
        const valorRaw = document.getElementById('quickAddProductValue').value;
        const quantidade = parseInt(document.getElementById('quickAddProductQty').value) || 1;
        if (!nome) { showCustomModal({ message: 'O nome é obrigatório.' }); return; }
        const valor = parseBrazilianCurrencyToFloat(valorRaw);
        if (isNaN(valor) || valor <= 0) { showCustomModal({ message: 'Informe um valor válido.' }); return; }
        const newProduct = { nome, valor, quantidade, cores: [..._quickAddColors], ignorarContagem: false, tag: 'Nenhuma' };
        try {
            const newRef = await push(getProductsRef(), newProduct);
            const saved = { ...newProduct, id: newRef.key };
            closeQuickAddModal();
            const aparelhoInput = document.getElementById('aparelhoSearch');
            const stockInput = document.getElementById('stockSearchInput');
            if (_quickAddContext === 'aparelho') {
                if (aparelhoInput) { aparelhoInput.value = ''; document.getElementById('aparelhoResultsContainer').innerHTML = ''; }
                handleProductSelectionForAparelho(saved);
            } else {
                if (stockInput) { stockInput.value = ''; }
                const hint = document.getElementById('stockNotFoundHint');
                if (hint) hint.innerHTML = '';
                filterStockProducts();
            }
            showCustomModal({ message: `"${nome}" adicionado ao sistema com sucesso!` });
        } catch (err) {
            showCustomModal({ message: `Erro ao salvar: ${err.message}` });
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


    // Tema escuro e Claro

    // 1. Usa a chave correta 'ctwTheme' (antes estava 'theme' e dava erro)
    const savedTheme = safeStorage.getItem('ctwTheme') || 'dark';
    
    // 2. Aplica o tema visualmente no site
    applyTheme(savedTheme);
    
    // 3. A CORREÇÃO MÁGICA: Sincroniza o botão
    if (themeToggleCheckbox) {
        // Se o tema salvo for 'light', força o botão a ficar MARCADO.
        // Se for 'dark', força a ficar DESMARCADO.
        themeToggleCheckbox.checked = (savedTheme === 'light');
        
        // Garante que o evento só seja adicionado uma vez
        themeToggleCheckbox.removeEventListener('change', toggleTheme);
        themeToggleCheckbox.addEventListener('change', toggleTheme);
    }


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
    document.getElementById('goToRepairs')?.addEventListener('click', () => showMainSection('repairs'));
    // v2 cards
    document.getElementById('goToRepairs2')?.addEventListener('click', () => showMainSection('repairs'));

    document.getElementById('backFromStock').addEventListener('click', () => showMainSection('main'));
    document.getElementById('backFromAdmin').addEventListener('click', () => showMainSection('main'));
    document.getElementById('backFromRepairs')?.addEventListener('click', () => showMainSection('main'));

   


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
        fab.style.display = 'none'; // Começa invisível
        document.body.appendChild(fab);
        
        // Ação do Botão Flutuante (CORRIGIDA E COMPLETA)
        fab.onclick = () => {
            const selectedRows = document.querySelectorAll('#resultCalcularPorAparelho .copyable-row.is-selected');
            if (selectedRows.length === 0) return;

            // 1. Gera Texto (COM CÁLCULO DO TOTAL)
            let simulations = [];
            selectedRows.forEach(r => {
                const i = r.dataset.installments; // Ex: "10" ou "Débito"
                const valParcela = parseFloat(r.dataset.parcela); // Ex: 100.00
                
                // Formata Parcela
                const p = valParcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                
                // Calcula Total (Parcela * Vezes)
                const qtd = (i === 'Débito') ? 1 : parseInt(i);
                const totalCalc = valParcela * qtd;
                const t = totalCalc.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

                if (i === 'Débito') {
                    simulations.push(`Débito: ${p}\n_(Total: ${t})_`);
                } else {
                    // Formato: 10x R$ 100,00 (Total: R$ 1.000,00)
                    simulations.push(`${i}x ${p}\n_(Total: ${t})_`);
                }
            });

            // Junta com "Ou" e quebra de linha
            const simulationBlock = simulations.map((t, i) => i === 0 ? t : `\nOu ${t}`).join('\n');

            // 2. Dados do Produto (Nome e Quantidade)
            const productCounts = carrinhoDeAparelhos.reduce((acc, product) => {
                acc[product.nome] = (acc[product.nome] || 0) + 1;
                return acc;
            }, {});
            const produtoNome = Object.entries(productCounts)
                .map(([nome, qtd]) => qtd > 1 ? `${qtd}x ${nome}` : nome)
                .join(' e ');

            // 3. Dados da Entrada
            const entradaValue = parseFloat(document.getElementById('entradaAparelho').value) || 0;
            let entradaText = '';
            if (entradaValue > 0) {
                const entradaFormatted = entradaValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                entradaText = `\n*_+${entradaFormatted} no dinheiro ou pix_*`;
            }

            // 4. Etiqueta Personalizada
            let customText = '';
            if (carrinhoDeAparelhos.length === 1) {
                const produtoUnico = carrinhoDeAparelhos[0];
                if (produtoUnico.tag && produtoUnico.tag !== 'Nenhuma' && tagTexts[produtoUnico.tag]) {
                    customText = `\n\n${tagTexts[produtoUnico.tag]}`;
                }
            }

            // 5. Montagem Final (Verifica ordem invertida)
            let textToCopy;
            const invertOrder = safeStorage.getItem('ctwInvertCopyOrder') === 'true';
            
            if (invertOrder) {
                textToCopy = `${produtoNome}\n${simulationBlock}${entradaText}${customText}`;
            } else {
                textToCopy = `${simulationBlock}${entradaText}\n\n${produtoNome}${customText}`;
            }

            // 6. Copiar para área de transferência
            const textArea = document.createElement("textarea");
            textArea.value = textToCopy;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                
                // Salva no histórico se a função existir
                if(window.salvarHistoricoAparelho) {
                    window.salvarHistoricoAparelho(textToCopy, `Vários (${selectedRows.length}) - ${produtoNome}`);
                }
                
                showCustomModal({ message: 'Simulações copiadas!' });
            } catch (err) {
                showCustomModal({ message: 'Erro ao copiar.' });
            }
            document.body.removeChild(textArea);
            
            // Limpa a seleção visual e esconde o botão
            selectedRows.forEach(r => r.classList.remove('is-selected'));
            fab.style.display = 'none';
        };
    }




document.getElementById('resultCalcularPorAparelho').addEventListener('click', (e) => {
    const toggle = document.getElementById('multiSelectToggle');
    const isMultiMode = toggle && toggle.checked;
    const row = e.target.closest('.copyable-row');
    
    if (!row || carrinhoDeAparelhos.length === 0) return;

    // =================================================================
    // MODO 1: SELEÇÃO MÚLTIPLA
    // =================================================================
    if (isMultiMode) {
        row.classList.toggle('is-selected');
        
        const count = document.querySelectorAll('#resultCalcularPorAparelho .copyable-row.is-selected').length;
        const fabBtn = document.getElementById('fabCopyMulti');
        
        if (count > 0) {
            fabBtn.style.display = 'block';
            fabBtn.innerHTML = `<i class="bi bi-clipboard-check"></i> Copiar (${count})`;
            
            // Adiciona a ação de clique (que estava faltando no seu código original)
            fabBtn.onclick = () => {
                const selectedRows = document.querySelectorAll('#resultCalcularPorAparelho .copyable-row.is-selected');
                if (selectedRows.length === 0) return;

                // 1. Gera Texto (CORRIGIDO COM TOTAL E FORMATAÇÃO)
                let simulations = [];
                selectedRows.forEach(r => {
                    const i = r.dataset.installments;
                    const valParcela = parseFloat(r.dataset.parcela);
                    
                    // Formata valor da parcela
                    const p = valParcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                    
                    // Calcula o total matematicamente (Parcela x Vezes)
                    const qtd = (i === 'Débito') ? 1 : parseInt(i);
                    const totalCalc = valParcela * qtd;
                    const t = totalCalc.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

                    if (i === 'Débito') {
                        simulations.push(`Débito: ${p}\n_(Total: ${t})_`);
                    } else {
                        // Formato: 2x R$ 1.200,00
                        //          (Total: R$ 2.400,00)
                        simulations.push(`${i}x ${p}\n_(Total: ${t})_`);
                    }
                });
                
                // Adiciona uma quebra de linha extra (\n) antes do "Ou"
                const simulationBlock = simulations.map((t, i) => i === 0 ? t : `\nOu ${t}`).join('\n');

                
                // 2. Dados
                const productCounts = carrinhoDeAparelhos.reduce((acc, product) => { acc[product.nome] = (acc[product.nome] || 0) + 1; return acc; }, {});
                const produtoNome = Object.entries(productCounts).map(([nome, qtd]) => qtd > 1 ? `${qtd}x ${nome}` : nome).join(' e ');
                const entradaVal = parseFloat(document.getElementById('entradaAparelho').value) || 0;
                const entradaText = entradaVal > 0 ? `\n*_+${entradaVal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} no dinheiro ou pix_*` : '';
                
                let customText = '';
                if (carrinhoDeAparelhos.length === 1 && carrinhoDeAparelhos[0].tag && tagTexts[carrinhoDeAparelhos[0].tag]) {
                    customText = `\n\n${tagTexts[carrinhoDeAparelhos[0].tag]}`;
                }

                // 3. Monta Texto Final
                const invertOrder = typeof safeStorage !== 'undefined' ? safeStorage.getItem('ctwInvertCopyOrder') === 'true' : localStorage.getItem('ctwInvertCopyOrder') === 'true';
                const textToCopy = invertOrder ? `${produtoNome}\n${simulationBlock}${entradaText}${customText}` : `${simulationBlock}${entradaText}\n\n${produtoNome}${customText}`;

                // 4. Copia
                const textArea = document.createElement("textarea");
                textArea.value = textToCopy;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);

                // --- SALVA NO HISTÓRICO COM TÍTULO COMPLETO ---
                if(window.salvarHistoricoAparelho) {
                    window.salvarHistoricoAparelho(textToCopy, `Vários (${count} opções) - ${produtoNome}`);
                }
                
                showCustomModal({ message: 'Copiado e salvo! 💾' });
                selectedRows.forEach(r => r.classList.remove('is-selected'));
                fabBtn.style.display = 'none';
            };

        } else {
            fabBtn.style.display = 'none';
        }
        
    } else {
        // =================================================================
        // MODO 2: CLÁSSICO (Cópia única)
        // =================================================================
        document.getElementById('fabCopyMulti').style.display = 'none';
        document.querySelectorAll('#resultCalcularPorAparelho .copyable-row.is-selected').forEach(r => r.classList.remove('is-selected'));

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
        const invertOrder = typeof safeStorage !== 'undefined' ? safeStorage.getItem('ctwInvertCopyOrder') === 'true' : localStorage.getItem('ctwInvertCopyOrder') === 'true';
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

        // --- SALVA NO HISTÓRICO COM O VALOR NO TÍTULO ---
        // Aqui está o pulo do gato: Salvamos "12x R$ 200 - iPhone" como título
        if(window.salvarHistoricoAparelho) {
            const tituloComValor = `${installments}x ${parcelaFormatted} • ${produtoNome}`;
            window.salvarHistoricoAparelho(textToCopy, tituloComValor);
        }

        showCustomModal({ message: 'Simulação copiada!' });
    }
});

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
        const deleteNotifBtn = e.target.closest('.delete-notification-btn');
        if (deleteNotifBtn) {
            const notifId = deleteNotifBtn.dataset.id;
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
        const deleteTagBtn = e.target.closest('.delete-tag-btn');
        const saveTagBtn = e.target.closest('.save-tag-btn');
        if (deleteTagBtn) {
            const tagToDelete = deleteTagBtn.dataset.tag;
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
        if (saveTagBtn) {
            const originalName = saveTagBtn.dataset.tag;
            const container = saveTagBtn.closest('div.p-3');
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
            criadoEm: new Date().toISOString(),
            criadoPor: currentUserProfile || 'Desconhecido'
        };

        // Popula o conteúdo do contrato
        populatePreview();

        // Cria um elemento temporário com o HTML do contrato estilizado
        const tempDiv = document.createElement('div');
        tempDiv.style.cssText = 'font-family: Times New Roman, serif; font-size: 10pt; line-height: 1.5; color: #000; background: #fff; padding: 20px; width: 750px; box-sizing: border-box;';
        tempDiv.innerHTML = document.getElementById('contractPreview').innerHTML;

        // Corrige o título
        const titulo = tempDiv.querySelector('h4');
        if (titulo) {
            titulo.style.cssText = 'font-size: 10.5pt; font-weight: bold; color: #000; text-align: center; margin-bottom: 16pt; line-height: 1.4;';
        }

        // Evita corte de palavras em todos os elementos
        tempDiv.querySelectorAll('p, div, strong, span') .forEach(el => {
            el.style.wordBreak = 'keep-all';
            el.style.overflowWrap = 'break-word';
            el.style.pageBreakInside = 'avoid';
        });

        // Garante que os campos strong tenham o valor correto
        tempDiv.querySelectorAll('strong[id]').forEach(el => {
            const original = document.getElementById(el.id);
            if (original) el.textContent = original.textContent;
        });

        const nomeCliente = document.getElementById('compradorNome').value || 'contrato';
        const nomeArquivo = 'Contrato-' + nomeCliente.split(' ')[0] + '.pdf';

        garantirPdfLibs(); // carrega libs em paralelo (já estarão prontas quando html2pdf rodar)
        const opt = {
            margin: [10, 10, 10, 10],
            filename: nomeArquivo,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        showCustomModal({ message: 'Gerando PDF, aguarde...' });

        html2pdf().set(opt).from(tempDiv).output('blob').then(async function(pdfBlob) {
            // Salva ou atualiza no Firebase
            // Lê o ID do campo hidden (mais confiável que variável JS)
            const hiddenIdEl = document.getElementById('editingBoletoId');
            const editId = (hiddenIdEl && hiddenIdEl.value) ? hiddenIdEl.value : window.currentEditingBoletoId;

            if (editId) {
                // EDITANDO registro existente - atualiza sem criar novo
                update(ref(db, 'boletos/' + editId), boletoData).catch(function(e) {
                    console.error("Erro ao atualizar contrato: ", e);
                });
                // Reseta estado de edição
                if (hiddenIdEl) hiddenIdEl.value = '';
                window.currentEditingBoletoId = null;
                const btnImprimir2 = document.getElementById('btnImprimir');
                if (btnImprimir2) {
                    btnImprimir2.innerHTML = '<i class="bi bi-printer"></i> Imprimir e Salvar';
                    btnImprimir2.classList.remove('btn-warning');
                    btnImprimir2.classList.add('btn-primary');
                }
                const banner2 = document.getElementById('editingBannerBoleto');
                if (banner2) banner2.style.display = 'none';
            } else {
                // NOVO registro
                push(boletosRef, boletoData).catch(function(error) {
                    console.error("Erro ao salvar contrato: ", error);
                });
            }

            const nomeCliente2 = document.getElementById('compradorNome').value || 'Cliente';
            const file = new File([pdfBlob], nomeArquivo, { type: 'application/pdf' });

            // Tenta compartilhar (celular)
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({
                        files: [file],
                        title: 'Contrato Workcell Tecnologia',
                        text: 'Olá ' + nomeCliente2 + ', segue seu contrato em anexo.'
                    });
                    showCustomModal({ message: 'Contrato compartilhado e salvo! ✅' });
                } catch(e) {
                    if (e.name !== 'AbortError') {
                        const url = URL.createObjectURL(pdfBlob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = nomeArquivo;
                        a.click();
                        URL.revokeObjectURL(url);
                        showCustomModal({ message: 'Contrato salvo! ✅' });
                    }
                }
            } else {
                const url = URL.createObjectURL(pdfBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = nomeArquivo;
                a.click();
                URL.revokeObjectURL(url);
                showCustomModal({ message: 'Contrato salvo! ✅' });
            }
        }).catch(function(error) {
            console.error("Erro ao gerar PDF:", error);
            showCustomModal({ message: 'Erro ao gerar PDF: ' + error.message });
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
//






















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
    
    
// --- TOGGLE NOVO / HISTÓRICO (CORRIGIDO E SEM BUG VISUAL) ---
const bookipToggle = document.getElementById('bookipModeToggle');

if (bookipToggle) {
    bookipToggle.addEventListener('change', (e) => {
        const isHistoryMode = e.target.checked; // true = Histórico, false = Novo

        // 1. Elementos da Aba "NOVO" (Formulário)
        const newContent = document.getElementById('newBookipContent');
        if (newContent) {
            // Se estiver no histórico, ESCONDE o conteúdo novo
            newContent.classList.toggle('hidden', isHistoryMode);
        }

        // 2. Elementos da Aba "HISTÓRICO" (Lista + Busca + Filtros)
        const historyContent = document.getElementById('historyBookipContent');
        const searchContainer = document.getElementById('bookipSearchContainer');
        const filterBar = document.getElementById('filterBarProfiles');

        // Esses elementos só aparecem se isHistoryMode for TRUE
        if (historyContent) historyContent.classList.toggle('hidden', !isHistoryMode);
        if (searchContainer) searchContainer.classList.toggle('hidden', !isHistoryMode);
        if (filterBar) filterBar.classList.toggle('hidden', !isHistoryMode);

        // 3. LÓGICA DE DADOS (Mantendo a correção do Bug de Edição)
        if (isHistoryMode) {
            // --- Entrou no Histórico ---
            if (typeof loadBookipHistory === 'function') loadBookipHistory();
        } else {
            // --- Entrou no Novo (Formulário) ---
            
            // Verifica a TRAVA DO SISTEMA
            if (window.isSystemSwitching) {
                // Foi o botão editar que mandou vir pra cá?
                console.log("🔒 Modo Edição: Mantendo dados.");
                window.isSystemSwitching = false; // Destrava para o futuro
            } else {
                // Foi o dedo do usuário?
                console.log("🧹 Clique Manual: Limpando tudo.");
                if (typeof window.resetFormulariosBookip === 'function') {
                    window.resetFormulariosBookip();
                }
            }
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


                        // --- VERSÃO BLINDADA: Formata Valor + Some com a Lista ---
try {
    // 1. Formata o valor
    var valParaFormatar = parseFloat(p.valor || 0);
    var campoValor = document.getElementById('bookipProdValorTemp');
    
    if(campoValor) {
        campoValor.value = valParaFormatar.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        campoValor.dispatchEvent(new Event('input')); // Acorda a máscara
    }

    // 2. FORÇA BRUTA: Some com a lista de resultados
    var listaResultados = document.getElementById('bookipSearchResults');
    if(listaResultados) {
        listaResultados.style.display = 'none'; // Esconde visualmente
        listaResultados.innerHTML = '';         // Limpa o conteúdo pra garantir
    }
    
    // 3. Limpa o campo de busca também (opcional, fica mais limpo)
    document.getElementById('bookipProductSearch').value = '';

} catch (erro) {
    console.log("Erro ao selecionar produto:", erro);
    // Mesmo com erro, tenta esconder a lista pra não travar a tela
    document.getElementById('bookipSearchResults').style.display = 'none';
}
// ---------------------------------------------------------
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


                // --- CORREÇÃO DE EDIÇÃO (Auto-Formatador) ---
// Pega o valor do item (se der erro, assume 0)
let valBruto = parseFloat(item.valor || 0); 

let campoInput = document.getElementById('bookipProdValorTemp');

// 1. Formata e joga no input (ex: 2.500,00)
campoInput.value = valBruto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 2. Acorda a máscara para permitir edição manual depois
campoInput.dispatchEvent(new Event('input'));
// ------------------------------------------------




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
// Adicione isso no final da função atualizarListaVisualBookip
if(typeof salvarRascunhoBookip === 'function') window.salvarRascunhoBookip();

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

    // Expõe função para a busca global navegar direto para um item,
    // superando o "Ver Mais" ao expandir itensVisiveis até o item aparecer
    window._bookipNavigateTo = function(id) {
        var idx = listaFiltradaCache.findIndex(function(i) { return i.id === id; });
        if (idx === -1) {
            // Item não está no filtro ativo — tenta na lista completa
            idx = listaCompletaCache ? listaCompletaCache.findIndex(function(i) { return i.id === id; }) : -1;
            if (idx === -1) return false;
            // Reseta filtros e refiltra
            listaFiltradaCache = listaCompletaCache.slice();
        }
        // Garante que o item está dentro dos visíveis
        if (idx >= itensVisiveis) {
            itensVisiveis = idx + 1;
            renderizarLote();
        }
        return true;
    };

    // Loading...
    container.innerHTML = '<div class="text-center p-4"><div class="spinner-border text-primary"></div><p class="mt-2 text-secondary">Carregando histórico...</p></div>';

// --- CRIA BARRA DE FILTROS ---
        // --- CRIA BARRA DE FILTROS (Com Seleção Automática) ---
        if (!document.getElementById('filterBarProfiles')) {
            // Define qual botão começa aceso
            const filtroAtual = window.activeProfileFilter || 'todos';
            const clsTodos = filtroAtual === 'todos' ? 'btn-light active fw-bold' : 'btn-outline-light';
            const clsMeus = filtroAtual !== 'todos' ? 'btn-light active fw-bold' : 'btn-outline-light';

            const filterHTML = `
<div id="filterBarProfiles" class="d-flex gap-2 mb-3 overflow-auto pb-2 align-items-center justify-content-between">
    
    <div class="d-flex gap-2">
        <button class="btn btn-sm ${clsTodos} filter-profile-btn" onclick="filtrarHistoricoPorPerfil('todos', this)" style="border-radius: 20px; padding: 5px 15px;">Todos</button>
        <button class="btn btn-sm ${clsMeus} filter-profile-btn" onclick="filtrarHistoricoPorPerfil('MEUS_ARQUIVOS_DINAMICO', this)" style="border-radius: 20px; padding: 5px 15px;">
            <i class="bi bi-person-fill me-1"></i> Meus Arquivos
        </button>
    </div>
    
    <button class="btn btn-sm btn-outline-danger" onclick="abrirLixeiraModal()" style="border-radius: 20px; padding: 5px 15px;" title="Ver Lixeira">
        <i class="bi bi-trash"></i> Lixeira
    </button>

</div>`;


            const searchBox = document.getElementById('bookipSearchContainer');
            if(searchBox) searchBox.insertAdjacentHTML('beforebegin', filterHTML);
        }



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

        // Lógica de Filtragem CORRIGIDA
        listaFiltradaCache = listaCompletaCache.filter(item => {
            const nDoc = (item.docNumber || '').toLowerCase();
            const nome = (item.nome || '').toLowerCase();
            const cpf = (item.cpf || '').toLowerCase();
            const email = (item.email || '').toLowerCase(); 
            const telLimpo = (item.tel || '').toLowerCase().replace(/\D/g, ''); 
            const telOriginal = (item.tel || '').toLowerCase();

            // Pega o nome de TODOS os produtos dessa venda
            const produtosTexto = (item.items || []).map(p => p.nome).join(' ').toLowerCase(); 
            
            const matchTexto = termo === '' || 
                               nDoc.includes(termo) || 
                               nome.includes(termo) || 
                               cpf.includes(termo) || 
                               email.includes(termo) || 
                               telOriginal.includes(termo) || 
                               telLimpo.includes(termo) ||
                               produtosTexto.includes(termo);

            let matchData = true;
            if (dataFiltro) {
                let dataItem = item.dataVenda || '';
                if (!dataItem && item.criadoEm) dataItem = item.criadoEm.split('T')[0];
                matchData = (dataItem === dataFiltro);
            }

            // --- AQUI ESTÁ A CORREÇÃO (O FILTRO DE PERFIL AGORA FUNCIONA) ---
            let matchPerfil = true;
            // Se o filtro NÃO for 'todos', verifica se o criador é igual ao filtro ativo
            if (window.activeProfileFilter && window.activeProfileFilter !== 'todos') {
                matchPerfil = item.criadoPor === window.activeProfileFilter;
            }

            // Retorna apenas se TUDO for verdadeiro (Texto E Data E Perfil)
            return matchTexto && matchData && matchPerfil;
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
            // --- 1. TRATAMENTO DE DATA ---
            let dataVisual = '---';
            let dataVendaObj = new Date();

            if (item.dataVenda) {
                 const p = item.dataVenda.split('-'); 
                 // Cria data segura (Ano, Mês-1, Dia)
                 dataVendaObj = new Date(p[0], p[1]-1, p[2]);
                 dataVisual = `${p[2]}/${p[1]}/${p[0]}`;
            } else if (item.criadoEm) {
                 dataVendaObj = new Date(item.criadoEm);
                 dataVisual = dataVendaObj.toLocaleDateString('pt-BR');
            }


            // --- CIRÚRGICO: Pega a hora ---
            let horaVisual = '';
            if (item.criadoEm) {
                try {
                    const d = new Date(item.criadoEm);
                    horaVisual = d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
                } catch(e) {}
            }
            // ------------------------------

            
            const docNum = item.docNumber || '---';

            // --- 2. SEMÁFORO INTELIGENTE (Separação Recibo vs Garantia) ---
            const diasGarantia = parseInt(item.diasGarantia) || 0;
            const dataVencimento = new Date(dataVendaObj);
            dataVencimento.setDate(dataVendaObj.getDate() + diasGarantia);
            
            const hoje = new Date();
            // Zera as horas para comparar apenas datas (evita bugs de fuso)
            hoje.setHours(0,0,0,0);
            dataVencimento.setHours(0,0,0,0);

            const diferencaTempo = dataVencimento - hoje;
            const diasRestantes = Math.ceil(diferencaTempo / (1000 * 60 * 60 * 24));

            // CORES PADRÃO
            let corStatus = '#0d6efd'; // Azul (Padrão para Recibos/Neutro)
            let textoStatus = 'Recibo';
            let textoCor = '#0d6efd'; // Cor do texto do status

            // Lógica de Prioridade
            const isSituacao = (item.type === 'situacao') || (item.items && item.items[0] && item.items[0].isSituation);
            const isRecibo = (item.type === 'recibo');

            if (isSituacao) {
                // SITUAÇÃO: Amarelo
                corStatus = '#ffc107'; 
                textoStatus = 'Situação';
                textoCor = '#b58900'; // Amarelo mais escuro para ler melhor
            } 
            else if (isRecibo) {
                 // RECIBO: Azul (Neutro - Não confunde com garantia)
                 corStatus = '#0d6efd'; 
                 textoStatus = 'Recibo Simples';
                 textoCor = '#0d6efd';
            } 
            else if (diasGarantia > 0) {
                // GARANTIA: Aqui entra o Semáforo
                if (diasRestantes < 0) {
                    corStatus = '#dc3545'; // Vermelho
                    textoStatus = `Vencida há ${Math.abs(diasRestantes)} dias`;
                    textoCor = '#dc3545';
                } else if (diasRestantes <= 7) {
                    corStatus = '#fd7e14'; // Laranja
                    textoStatus = `Vence em ${diasRestantes} dias!`;
                    textoCor = '#fd7e14';
                } else {
                    corStatus = '#198754'; // Verde
                    textoStatus = 'Garantia Ativa';
                    textoCor = '#198754';
                }
            } else {
                // Caso não tenha dias definidos mas não seja recibo explícito
                textoStatus = 'Sem Garantia';
            }

            // --- 3. VISUAL DO CARTÃO ---
            const foiEnviado = (item.statusEnvio === true);
            
            // Fundo verde claro APENAS se enviado (Feedback de ação)
            const fundoCard = foiEnviado ? '#f0fff4' : '#fff';
            
            // A Borda Esquerda é quem manda no Status (Semáforo)
            const styleCard = `border-left: 6px solid ${corStatus}; background-color: ${fundoCard};`;
            
            // Botões
            const classBtnEnvio = foiEnviado ? 'btn-dark' : 'btn-warning';
            const iconBtnEnvio = foiEnviado ? 'bi-check-circle-fill text-success' : 'bi-envelope-at-fill';
            const titleBtnEnvio = foiEnviado ? 'Já enviado (Reenviar)' : 'PDF/Email';

                                    return `
            <div class="accordion-item" style="${styleCard}">
                <h2 class="accordion-header" id="head-bk-${item.id}">
                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-bk-${item.id}">
                        
                        <span class="badge me-2" style="background-color: ${corStatus}; color: ${isSituacao ? '#000' : '#fff'};">Doc ${docNum}</span> 
                        
                        <div class="d-flex flex-column text-truncate" style="max-width: 160px;">
                            <span class="fw-bold">${item.nome}</span>
                            <span style="font-size: 0.75rem; color: ${textoCor}; font-weight: 700; text-transform: uppercase;">${textoStatus}</span>
                        </div>

                        <div class="text-end ms-auto" style="min-width: 80px;">
                            <small class="d-block text-secondary" style="font-size: 0.7rem;">${dataVisual}</small>

                            <small class="d-block text-secondary" style="font-size: 0.65rem; opacity: 0.8;">${horaVisual}</small>


                            <span class="badge bg-secondary bg-opacity-25 text-light border border-secondary border-opacity-25" style="font-size: 0.65rem; font-weight: normal; letter-spacing: 0.5px;">
                                <i class="bi bi-person me-1"></i>${item.criadoPor || 'Geral'}
                            </span>
                        </div>
                        </button>
                </h2>
                
                <div id="collapse-bk-${item.id}" class="accordion-collapse collapse" data-bs-parent="#bookipAccordion">
                    <div class="accordion-body">
                        
                        <div class="mb-2">
                            <strong>Cliente:</strong> ${item.nome}<br>
                            ${item.tel ? `<small class="text-secondary"><i class="bi bi-whatsapp text-success me-1"></i> ${item.tel}</small>` : ''}
                        </div>

                        <ul class="list-unstyled small mb-3">
                            ${(item.items || []).map(i => `<li>${i.qtd}x ${i.nome} - R$ ${parseFloat(i.valor).toFixed(2)}</li>`).join('')}
                        </ul>
                        
                        <div class="d-flex justify-content-end gap-2 mt-2 flex-wrap">

                            ${(() => {
                                const telLimpo = (item.tel || '').replace(/\D/g, '');
                                if (telLimpo.length >= 8) {
                                    const numFinal = telLimpo.length <= 11 ? '55' + telLimpo : telLimpo;
                                    return `<a href="https://wa.me/${numFinal}" target="_blank" class="btn btn-sm btn-success" title="Abrir WhatsApp"><i class="bi bi-whatsapp"></i></a>`;
                                }
                                return ''; 
                            })()}

                            <button class="btn btn-sm btn-dark btn-copy-nf" data-id="${item.id}" title="Copiar dados para NF" style="font-weight: bold;">NF</button>

                            <button class="btn btn-sm btn-info edit-bookip-btn" data-id="${item.id}" title="Editar"><i class="bi bi-pencil-square"></i></button>

                            <button class="btn btn-sm ${classBtnEnvio} email-history-btn" data-id="${item.id}" title="${titleBtnEnvio}"><i class="bi ${iconBtnEnvio}"></i></button>

                            ${item.fotoUrl ? `
                            <button class="btn btn-sm btn-outline-info btn-ver-foto" 
                                data-foto="${item.fotoUrl}" 
                                data-nome="${item.nome || 'Cliente'}"
                                title="Ver foto do produto">
                                <i class="bi bi-image"></i>
                            </button>` : ''}

                            <button class="btn btn-sm btn-outline-primary btn-download-seguro" data-id="${item.id}" title="Baixar PDF">
                                <i class="bi bi-download"></i>
                            </button>

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
        container.querySelectorAll('.btn-ver-foto').forEach(b => b.addEventListener('click', e => {
            const btn = e.target.closest('button');
            const fotoUrl = btn.dataset.foto;
            const nome = btn.dataset.nome || 'Produto';
            window.abrirFotoBookip(fotoUrl, nome);
        }));
        container.querySelectorAll('.print-old-bookip').forEach(b => b.addEventListener('click', e => printBookip(listaCompletaCache.find(i => i.id === e.target.closest('button').dataset.id))));


container.querySelectorAll('.delete-bookip-btn').forEach(b => b.addEventListener('click', e => {
    const id = e.target.closest('button').dataset.id;
    
    showCustomModal({
        message: "Deseja mover este documento para a Lixeira?", 
        confirmText: "Mover p/ Lixeira", 
        onConfirm: async () => { 
            // Agora chama a função de lixeira em vez de apagar direto
            await moverParaLixeira(id); 
        }, 
        onCancel: ()=>{}
    });
}));


        // --- LÓGICA DO BOTÃO NF (COM NOTIFICAÇÃO NATIVA) ---
        container.querySelectorAll('.btn-copy-nf').forEach(btn => {
            btn.addEventListener('click', e => {
                const id = e.target.closest('button').dataset.id;
                const item = listaCompletaCache.find(i => i.id === id);

                if (item) {
                    let textoNF = `Gerar NF\n`;
                    textoNF += `Nome: ${item.nome || ''}\n`;
                    textoNF += `CPF: ${item.cpf || 'Não informado'}\n`;
                    
                    // Prioriza celular, se não tiver tenta telefone fixo
                    textoNF += `Numero: ${item.tel || item.telefone || 'Não informado'}\n`; 
                    
                    // Usa endereço completo se tiver
                    const enderecoCompleto = item.end ? item.end : (item.cep ? `CEP: ${item.cep}` : 'Não informado');
                    textoNF += `Endereço/Cep: ${enderecoCompleto}\n\n`; 

                    textoNF += `--- ITENS ---\n`;
                    
                    let totalGeralNota = 0;

                    if (item.items && item.items.length > 0) {
                        item.items.forEach((prod, index) => {
                            const qtd = parseInt(prod.qtd) || 1;
                            const valorUnit = parseFloat(prod.valor) || 0;
                            const valorTotalItem = qtd * valorUnit;
                            
                            totalGeralNota += valorTotalItem;

                            let linhaProduto = '';
                            if (qtd > 1) {
                                // Se for mais de 1: Mostra (Unitário) e Total
                                linhaProduto = `${qtd}x ${prod.nome} (R$ ${valorUnit.toFixed(2)} un.) ➤ R$ ${valorTotalItem.toFixed(2)}`;
                            } else {
                                // Se for apenas 1: Mostra direto o valor
                                linhaProduto = `${qtd}x ${prod.nome} - R$ ${valorTotalItem.toFixed(2)}`;
                            }

                            textoNF += `Produto: ${linhaProduto}\n`;
                            textoNF += `Cor: ${prod.cor || 'Padrão'}\n`;
                            textoNF += `Imei/Obs: ${prod.obs || '---'}\n`; 
                            
                            if (index < item.items.length - 1) textoNF += `\n`; 
                        });
                    }
                    
                    textoNF += `----------------\n`;
                    textoNF += `Valor Total: R$ ${totalGeralNota.toFixed(2)}\n`;
                    textoNF += `Forma de pagamento: ${item.pagamento || 'Não informado'}`;

                    navigator.clipboard.writeText(textoNF).then(() => {
                        // AQUI ESTÁ A CORREÇÃO: Usando sua função nativa
                        if (typeof showCustomModal === 'function') {
                            showCustomModal({ message: "Dados para NF Copiados com sucesso! 📋" });
                        } else {
                            alert(" Dados para NF Copiados!"); // Fallback só por segurança
                        }
                    });
                }
            });
        });



// --- NOVO: Listener para o Botão de Download Seguro ---
container.querySelectorAll('.btn-download-seguro').forEach(b => {
    b.addEventListener('click', e => {
        const btn = e.target.closest('button');
        const id = btn.dataset.id;
        // Pega os dados da memória (seguro e rápido)
        const item = listaCompletaCache.find(i => i.id === id);
        
        if(item) {
            // Chama a função mestre ativando o modo "Apenas Baixar" (true)
            gerarPdfDoHistorico(item, btn, true);
}
    });
});

    }
}

// --- FUNÇÃO AUXILIAR: CARREGAR DADOS NO FORMULÁRIO (CORRIGIDA DE VERDADE) ---
function carregarDadosParaEdicao(item) {
    if (!item) return;

    // 1. Mata o rascunho antigo
    localStorage.removeItem('ctwBookipDraft_Smart_v2');

    // 2. PRIMEIRO: Troca a aba e deixa o sistema limpar o que quiser
    const toggle = document.getElementById('bookipModeToggle');
    if (toggle && toggle.checked) {
        window.isSystemSwitching = true; // Trava o sistema
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change')); // Dispara o reset()
    }

    // 3. AGORA SIM: Injetamos os dados nas variáveis CERTAS (Sem 'window.')
    // Usamos setTimeout para garantir que rodamos DEPOIS do reset da aba
    setTimeout(() => {
        
        // A. ID CORRETO (Sem 'window.') - Isso corrige a Duplicação
        // Agora o botão Salvar vai ler essa variável aqui.
        currentEditingBookipId = item.id;

        // B. LISTA CORRETA (Sem 'window.') - Isso corrige a Edição de Produto
        // Agora a função de desenho vai ler essa lista aqui.
        bookipCartList = item.items || [];
        
        // C. Atualiza o Visual da Lista (Agora vai funcionar pq a lista tá certa)
        if (typeof atualizarListaVisualBookip === 'function') {
            atualizarListaVisualBookip();
        }

        // D. Preenche os campos do Formulário
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
            if (el) el.value = campos[id] || '';
        }

        // E. Restaura Pagamentos
        document.querySelectorAll('.check-pagamento').forEach(chk => chk.checked = false);
        if (item.pagamento) {
            const formasSalvas = item.pagamento.split(/,\s*/).map(s => s.trim().toLowerCase());
            document.querySelectorAll('.check-pagamento').forEach(chk => {
                const valCheck = chk.value.toLowerCase();
                if (formasSalvas.some(s => valCheck.includes(s) || s.includes(valCheck))) {
                    chk.checked = true;
                }
            });
        }

        // F. Restaura Garantia
        const selectGarantia = document.getElementById('bookipGarantiaSelect');
        const inputGarantia = document.getElementById('bookipGarantiaCustomInput');
        if (selectGarantia) {
            const dias = parseInt(item.diasGarantia);
            const isPadrao = [30, 120, 180, 365].includes(dias);
            if (isPadrao) {
                selectGarantia.value = dias;
                if (inputGarantia) inputGarantia.classList.add('hidden');
            } else {
                selectGarantia.value = 'custom';
                if (inputGarantia) {
                    inputGarantia.value = dias;
                    inputGarantia.classList.remove('hidden');
                }
            }
        }

        // G. Ajusta o Botão Salvar (Para Amarelo)
        const btnAdd = document.getElementById('btnAdicionarItemLista');
        if (btnAdd) {
            btnAdd.innerHTML = '<i class="bi bi-pencil-square"></i> Salvar Alteração';
            btnAdd.classList.remove('btn-primary');
            btnAdd.classList.add('btn-warning');
        }

        // H. Restaura a Foto (se existir)
        if (item.fotoUrl) {
            window._bookipFotoUrl  = item.fotoUrl;
            window._bookipFotoBlob = null;
            var imgEl   = document.getElementById('bookipPhotoImg');
            var preview = document.getElementById('bookipPhotoPreview');
            var lbl     = document.getElementById('bookipPhotoBtnLabel');
            if (imgEl)   imgEl.src = item.fotoUrl;
            if (preview) preview.classList.remove('hidden');
            if (lbl)     lbl.textContent = 'Substituir foto';
        } else {
            window._bookipFotoUrl  = '';
            window._bookipFotoBlob = null;
            var preview2 = document.getElementById('bookipPhotoPreview');
            if (preview2) preview2.classList.add('hidden');
        }

        // I. Finalização
        window.scrollTo({ top: 0, behavior: 'smooth' });
        window.isSystemSwitching = false; // Destrava

        console.log("✅ Edição carregada. ID Interno:", currentEditingBookipId);

    }, 50); // 50ms é o tempo para o reset passar e a gente entrar com os dados

    showCustomModal({ message: "Dados carregados! Edite e salve." });
}

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
                criadoEm: new Date().toISOString(),
criadoPor: currentUserProfile || "Desconhecido",
                fotoUrl: window._bookipFotoUrl || "",
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

            // UPLOAD FOTO via Imgur (se houver blob pendente)
            if (window._bookipFotoBlob) {
                const fotoUrl = await window.uploadFotoCloudinary(window._bookipFotoBlob);
                if (fotoUrl) {
                    dados.fotoUrl = fotoUrl;
                    window._bookipFotoUrl = fotoUrl;
                    await update(ref(db, 'bookips/' + dados.id), { fotoUrl });
                }
                window._bookipFotoBlob = null;
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

// ============================================================
// ============================================================
// 4. AÇÃO: BOTÕES DE "NOVA GARANTIA" (CORREÇÃO FINAL: VARIÁVEL DE DADOS)
// ============================================================

const botoesReset = ['btnNewBookipCycle', 'btnResetSuccess'];

botoesReset.forEach(idBotao => {
    const btn = document.getElementById(idBotao);
    
    if (btn) {
        btn.onclick = function(e) {
            if(e) e.preventDefault();
            console.log("🔄 Reiniciando ciclo e RESETANDO botões de ação...");

            // 1. Faxina de Dados (Chama a função e limpa a variável local também)
            if(typeof window.resetFormulariosBookip === 'function') {
                window.resetFormulariosBookip();
            }
            // FORÇA LIMPEZA DA VARIÁVEL LOCAL (Importante!)
            if(typeof lastSavedBookipData !== 'undefined') {
                lastSavedBookipData = null;
            }

            // 2. Esconde o Banner de Sucesso
            const popup = document.getElementById('postSaveOptions');
            if(popup) popup.classList.add('hidden');

            // 3. Mostra o botão de Salvar novamente
            const saveContainer = document.getElementById('saveActionContainer');
            if(saveContainer) saveContainer.classList.remove('hidden');

            // 4. Reset de Abas (Volta para "Novo")
            const toggle = document.getElementById('bookipModeToggle');
            if(toggle && toggle.checked) {
                toggle.checked = false; 
                toggle.dispatchEvent(new Event('change'));
            }

            // ============================================================
            // O PULO DO GATO: RESETAR O BOTÃO "SALVAR ONLINE"
            // (Agora lendo a variável correta: lastSavedBookipData)
            // ============================================================
            const btnShareAntigo = document.getElementById('btnPostShare');
            if(btnShareAntigo) {
                // Clona para matar eventos velhos
                const btnShareNovo = btnShareAntigo.cloneNode(true);
                
                // Restaura o visual original
                btnShareNovo.innerHTML = '<i class="bi bi-whatsapp fs-2 d-block mb-2 text-success"></i> <span class="small text-light">Salvar Online</span>';
                btnShareNovo.className = 'btn btn-dark w-100 p-3 border-secondary';
                btnShareNovo.disabled = false;
                
                // Adiciona a lógica de GERAR com a variável correta
                btnShareNovo.onclick = function() {
                    // CORREÇÃO AQUI: Removemos o "window." para ler a variável do módulo
                    if (typeof lastSavedBookipData !== 'undefined' && lastSavedBookipData) {
                        
                        // Copia e-mail se tiver
                        if (lastSavedBookipData.email) {
                            navigator.clipboard.writeText(lastSavedBookipData.email).catch(()=>{});
                            if(typeof showCustomModal === 'function') showCustomModal({ message: "E-mail copiado! Gerando PDF..." });
                        }
                        
                        // GERA O PDF NOVO
                        if(typeof gerarPdfDoHistorico === 'function') {
                            gerarPdfDoHistorico(lastSavedBookipData, btnShareNovo);
                        }
                    } else {
                        // Se cair aqui, tenta recuperar do window por segurança
                        if(window.lastSavedBookipData) {
                             gerarPdfDoHistorico(window.lastSavedBookipData, btnShareNovo);
                        } else {
                             alert("Erro: Nenhum dado salvo encontrado. Salve novamente.");
                        }
                    }
                };

                // Substitui o botão velho pelo novo
                btnShareAntigo.parentNode.replaceChild(btnShareNovo, btnShareAntigo);
            }

            // (Opcional) Reseta o visual do card pai se ficou verde
            const cardShare = document.getElementById('btnPostShare')?.closest('.col-6');
            if(cardShare) { // Tenta pegar o novo ou o velho
                const cardReal = document.getElementById('btnPostShare').closest('.col-6') || cardShare;
                if (cardReal) {
                    cardReal.style.border = ''; 
                    cardReal.style.backgroundColor = '';
                }
            }
            // Remove borda verde do card pai do botão (caso exista classe específica)
            const parentCard = document.getElementById('btnPostShare')?.parentElement; 
            if(parentCard) {
                 parentCard.style.borderLeft = ""; 
                 parentCard.style.backgroundColor = "";
            }

            // 5. Rola para o topo
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
    }
});


// ============================================================

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
        criadoPor: currentUserProfile || 'Desconhecido',
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


// 1 Função de Preencher  (Pequeno ajuste para fechar a lista certa)
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

// ============================================================
// AUTOCOMPLETE PARA O FORMULÁRIO DE BOLETO/CONTRATO
// ============================================================
function ativarAutocompleteBoleto() {
    var campos = [
        { idInput: 'compradorNome', tipo: 'nome' },
        { idInput: 'compradorCpf',  tipo: 'cpf' },
        { idInput: 'compradorTelefone', tipo: 'tel' }
    ];

    campos.forEach(function(campo) {
        var input = document.getElementById(campo.idInput);
        if (!input) return;

        var listaId = 'sug-boleto-' + campo.idInput;
        var listaUl = document.getElementById(listaId);
        if (!listaUl) {
            listaUl = document.createElement('ul');
            listaUl.id = listaId;
            listaUl.className = 'list-group position-absolute w-100 shadow';
            listaUl.style.cssText = 'z-index:9999;display:none;max-height:200px;overflow-y:auto;';
            input.parentNode.style.position = 'relative';
            input.parentNode.appendChild(listaUl);
        }

        input.addEventListener('input', function(e) {
            var termo = e.target.value.toLowerCase().trim();
            var termoLimpo = termo.replace(/[^a-z0-9]/g, '');
            listaUl.style.display = 'none';
            listaUl.innerHTML = '';
            if (termoLimpo.length < 2) return;

            var cache = window.dbClientsCache || [];
            var encontrados = cache.filter(function(c) {
                var nomeDb = (c.nome || '').toLowerCase();
                var cpfDb = (c.cpf || '').replace(/[^0-9]/g, '');
                var telDb = (c.tel || '').replace(/[^0-9]/g, '');
                if (campo.tipo === 'nome') return nomeDb.includes(termo);
                if (campo.tipo === 'cpf') return cpfDb.includes(termoLimpo);
                if (campo.tipo === 'tel') return telDb.includes(termoLimpo);
                return false;
            });

            if (encontrados.length > 0) {
                listaUl.innerHTML = encontrados.slice(0, 5).map(function(c) {
                    return '<li class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" style="cursor:pointer;" onclick="preencherClienteBoleto(\'' + c.id + '\',\'' + listaId + '\')">' +
                        '<div><strong>' + escapeHtml(c.nome) + '</strong><br><small class="text-secondary">' + (c.cpf || 'S/ CPF') + ' — ' + (c.tel || 'S/ Tel') + '</small></div>' +
                        '<i class="bi bi-box-arrow-in-down-left text-primary"></i></li>';
                }).join('');
                listaUl.style.display = 'block';
            }
        });

        document.addEventListener('click', function(e) {
            if (e.target !== input) listaUl.style.display = 'none';
        });
    });
}

window.preencherClienteBoleto = function(id, idLista) {
    var cliente = (window.dbClientsCache || []).find(function(c) { return c.id === id; });
    if (!cliente) return;
    var set = function(elId, val) { var el = document.getElementById(elId); if (el) el.value = val || ''; };
    set('compradorNome', cliente.nome);
    set('compradorCpf', cliente.cpf);
    set('compradorTelefone', cliente.tel);
    set('compradorEndereco', cliente.end);
    if (idLista) { var l = document.getElementById(idLista); if (l) l.style.display = 'none'; }
    // Feedback visual
    ['compradorNome','compradorCpf','compradorTelefone'].forEach(function(fid) {
        var el = document.getElementById(fid);
        if (el) { el.classList.add('is-valid'); setTimeout(function() { el.classList.remove('is-valid'); }, 1200); }
    });
};

// Inicia quando a aba de contrato for aberta
setTimeout(ativarAutocompleteBoleto, 800);


// Conexão com o Banco (Atualiza lista automaticamente - dbClientsCache)
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
    const editBirthEl = document.getElementById('editClientBirthdate');
    if (editBirthEl) {
        editBirthEl.value = cliente.dataNascimento || '';
        if (typeof window._bdSetValor === 'function')
            window._bdSetValor('editClientBirthdate','editClientBirthdateBtn','editClientBirthdateLabel', cliente.dataNascimento || '');
    }
    // Popular select com perfis reais — múltiplos fallbacks
    const atribEl = document.getElementById('editClientAtribuido');
    if (atribEl) {
        const valorAtual = cliente.atribuidoA || '';

        // Fonte 1: teamProfilesList (Firebase/cache)
        // Fonte 2: cache_equipe_local no localStorage
        // Fonte 3: pelo menos o usuário atual
        let perfis = Object.values(window.teamProfilesList || {}).map(p => p.name).filter(Boolean);
        if (!perfis.length) {
            try {
                const cacheRaw = localStorage.getItem('cache_equipe_local');
                if (cacheRaw) {
                    const cacheData = JSON.parse(cacheRaw);
                    perfis = Object.values(cacheData).map(p => p.name).filter(Boolean);
                    // Atualiza teamProfilesList enquanto estamos aqui
                    window.teamProfilesList = cacheData;
                }
            } catch(e) {}
        }
        if (!perfis.length) {
            // Fallback final: usuário atual
            const current = window.currentUserProfile || localStorage.getItem('ctwUserProfile') || '';
            if (current) perfis = [current];
        }
        perfis.sort();

        atribEl.innerHTML = '<option value="">— Nenhum (notifica todos) —</option>'
            + perfis.map(n => `<option value="${n}"${n === valorAtual ? ' selected' : ''}>${n}</option>`).join('');

        // Valor legado não encontrado na lista
        if (valorAtual && !perfis.includes(valorAtual)) {
            atribEl.innerHTML += `<option value="${valorAtual}" selected>${valorAtual} ⚠️</option>`;
        }
    }
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
                dataNascimento: (document.getElementById('editClientBirthdate')?.value) || '',
                atribuidoA: document.getElementById('editClientAtribuido')?.value || '',
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
        const docHome = document.getElementById('documentsHome');
        const areaContrato = document.getElementById('areaContratoWrapper');
        const areaBookip = document.getElementById('areaBookipWrapper');

        // Esconde tudo (adiciona hidden E zera style)
        [docHome, areaContrato, areaBookip].forEach(el => {
            if (el) { el.classList.add('hidden'); el.style.display = ''; }
        });

        if (subSectionId === 'home') {
            if (docHome) { docHome.classList.remove('hidden'); docHome.style.display = 'flex'; }
        } 
        else if (subSectionId === 'contrato') {
            if (areaContrato) {
                areaContrato.classList.remove('hidden');
                areaContrato.style.display = 'block';
                if (typeof loadContractDraft === 'function') loadContractDraft();
            }
        } 
        else if (subSectionId === 'bookip') {
            if (areaBookip) {
                areaBookip.classList.remove('hidden');
                areaBookip.style.display = 'block';
            }
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

    // ============================================================
    // CONTROLES DE NAVEGAÇÃO (GARANTIA E CONTRATO) - VERSÃO FINAL
    // ============================================================

    // 1. Botão "Garantia (Bookip)"
    const btnOpenBookip = document.getElementById('openBookipView');
    if (btnOpenBookip) {
        btnOpenBookip.onclick = function() { 
            console.log("Abrindo Garantia (Modo Inteligente)...");

            // --- A. CONFIGURAÇÃO VISUAL (Que estava no código antigo) ---
            window.isSimpleReceiptMode = false;
            window.currentEditingBookipId = null;
            
            // Ajusta Títulos
            const titulo = document.querySelector('#areaBookipWrapper h3');
            if (titulo) titulo.innerText = "Garantia (Bookip)";
            
            const txtNovo = document.getElementById('txtToggleNovo');
            if (txtNovo) txtNovo.innerHTML = '<i class="bi bi-plus-lg"></i> Nova Garantia';

            // Mostra busca e esconde toggle de recibo simples
            const toggleSimples = document.getElementById('toggleModoInputContainer');
            if (toggleSimples) toggleSimples.style.display = 'none'; 
            
            const buscaContainer = document.querySelector('#camposProduto .search-wrapper');
            if (buscaContainer) buscaContainer.classList.remove('hidden'); 

            // Reseta a aba para "Novo" (sem apagar dados)
            const tabToggle = document.getElementById('bookipModeToggle');
            if(tabToggle && tabToggle.checked) {
                tabToggle.checked = false; 
                tabToggle.dispatchEvent(new Event('change'));
            }

            // --- B. ABRE A TELA ---
            window.openDocumentsSection('bookip'); 
            
            // --- C. VERIFICA O RASCUNHO (Com atraso seguro) ---
            setTimeout(() => {
                if(typeof checarRascunhoAoAbrir === 'function') {
                    checarRascunhoAoAbrir();
                } else {
                    // Fallback: Se não tiver rascunho pra checar, ativa o monitoramento agora
                    if(typeof ativarSalvamentoAutomatico === 'function') window.ativarSalvamentoAutomatico();
                }
            }, 300);
        };
    }

    // 2. Botão Voltar (dentro da Garantia)
    const btnBackFromBookip = document.getElementById('backFromBookipView');
    if (btnBackFromBookip) {
        btnBackFromBookip.onclick = function() { window.openDocumentsSection('home'); };
    }

    // 3. Botão Voltar (dentro do Contrato)
    const btnBackFromContrato = document.getElementById('backFromContratoView');
    if (btnBackFromContrato) {
        btnBackFromContrato.onclick = function() { window.openDocumentsSection('home'); };
    }

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


// Cancela edição de boleto sem perder dados
window.cancelarEdicaoBoleto = function() {
    const hiddenIdEl = document.getElementById('editingBoletoId');
    if (hiddenIdEl) hiddenIdEl.value = '';
    window.currentEditingBoletoId = null;
    const btn = document.getElementById('btnImprimir');
    if (btn) {
        btn.innerHTML = '<i class="bi bi-printer"></i> Imprimir e Salvar';
        btn.classList.remove('btn-warning');
        btn.classList.add('btn-primary');
    }
    const banner = document.getElementById('editingBannerBoleto');
    if (banner) banner.style.display = 'none';
};

// GERADOR DE PDF (DESIGN VERDE + CORREÇÃO DE QUEBRA)
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
    // 👇 ADICIONADO class="no-break" AQUI
    return `<div class="no-break" style="margin-bottom: 3px; text-align: justify; page-break-inside: avoid;">${line}</div>`;
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
<tr class="no-break" style="page-break-inside: avoid;">

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

    // CORREÇÃO: FONTE SEGURA E SEM JUSTIFICAR (RESOLVE O AMONTOADO E O CORTE)
    const sectionTermos = (isSimple || isSituation) ? "" : `
        <style>
            .termos-wrapper {
                page-break-inside: avoid;
                margin-top: 15px;
                border-top: 1px solid #000;
                padding-top: 10px;
                background-color: #fff; /* Garante fundo limpo */
            }

            .termos-texto {
                /* 1. USE FONTE DE SISTEMA (Métricas perfeitas, sem cortes) */
                font-family: Arial, Helvetica, sans-serif !important;
                font-size: 9pt !important;
                color: #000 !important;
                
                /* 2. O SEGREDO DO "AMONTOADO": NUNCA JUSTIFICAR EM HTML2CANVAS */
                text-align: left !important; 
                
                /* 3. O SEGREDO DO CORTE: Altura generosa */
                line-height: 1.5 !important; 
                
                /* 4. GARANTIA EXTRA: Um leve respiro entre as letras */
                letter-spacing: 0.3px !important;
                
                /* Reseta qualquer renderização exótica */
                font-variant-ligatures: none !important;
                text-rendering: auto !important;
                display: block !important;
                width: 100% !important;
            }
        </style>

        <div class="termos-wrapper">
            <div style="margin-bottom: 8px;">
                <strong style="font-size: 10pt; text-transform: uppercase; font-family: Arial, sans-serif;">Termos de Garantia</strong>
            </div>
            <div class="termos-texto">
                ${termsHtml}
            </div>
        </div>`;



    return `
        <div style="font-family: 'Segoe UI',






Arial, sans-serif; color: #000; background: #fff; padding: 20px 30px; width: 750px; margin: 0 auto; box-sizing: border-box;">
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


// ============================================================
// FUNÇÃO MESTRA: GERAR PDF (UNIFICADA: BAIXAR E ENVIAR)
// ============================================================
async function gerarPdfDoHistorico(dados, botao, apenasBaixar = false) {
    await garantirPdfLibs();
    
    // --- 0. PREPARAÇÃO (Copiar E-mail se existir, apenas se for modo Envio) ---
    if (!apenasBaixar && dados.email && dados.email.trim() !== '') {
        try {
            if (navigator.clipboard) await navigator.clipboard.writeText(dados.email.trim());
        } catch (e) {}
    }

    // --- 1. FEEDBACK VISUAL (LOADING) ---
    const textoOriginal = botao.innerHTML;
    // Muda o texto dependendo da ação
    botao.innerHTML = apenasBaixar 
        ? '<span class="spinner-border spinner-border-sm"></span> Baixando...' 
        : '<span class="spinner-border spinner-border-sm"></span> Processando...';
    
    botao.disabled = true;

    // Loader Global ou Local
    if(typeof toggleLoader === 'function') {
        toggleLoader(true, apenasBaixar ? "Baixando PDF..." : "Gerando PDF...");
    } else {
        // Fallback caso não tenha loader global
        const loadingOverlay = document.createElement('div');
        loadingOverlay.id = "tempLoadingPdf";
        loadingOverlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(255, 255, 255, 0.98); z-index: 2147483647; display: flex; flex-direction: column; align-items: center; justify-content: center;`;
        loadingOverlay.innerHTML = `<div class="spinner-border text-primary" style="width: 3rem; height: 3rem;"></div><div class="mt-3">${apenasBaixar ? "Baixando..." : "Preparando..."}</div>`;
        document.body.appendChild(loadingOverlay);
    }

    const removerLoading = () => {
        if(typeof toggleLoader === 'function') toggleLoader(false);
        const tmp = document.getElementById("tempLoadingPdf");
        if(tmp) tmp.remove();
        const tmpContainer = document.getElementById("pdf-dl-fix-final");
        if(tmpContainer) tmpContainer.remove();
    };

    try {
        // PRE-AQUECE POPPINS (evita letras emboladas com font-display:swap)
        const _fw = document.createElement('div');
        _fw.style.cssText = 'position:fixed;top:0;left:0;opacity:0.01;pointer-events:none;z-index:99999;font-family:Poppins,sans-serif;';
        _fw.innerHTML = '<b style="font-weight:300">.</b><b style="font-weight:400">.</b><b style="font-weight:600">.</b><b style="font-weight:700">.</b>';
        document.body.appendChild(_fw);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        document.body.removeChild(_fw);

        // --- A. MONTA O HTML ESCONDIDO ---
        const containerTemp = document.createElement('div');
        // Mantém fixo em 794px (A4) e fora da tela
        containerTemp.style.cssText = "position: fixed; top: 0; left: -9999px; width: 794px; background: white; z-index: -100;";
        
        if (typeof getReciboHTML === 'function') {
            containerTemp.innerHTML = getReciboHTML(dados);
            
            // CSS para garantir preto absoluto e remover sombras
            const styleFix = document.createElement('style');
            styleFix.innerHTML = `
                #pdf-dl-fix-final, #pdf-dl-fix-final * { 
                    color: #000000 !important; 
                    text-shadow: none !important;
                    letter-spacing: normal !important; 
                    word-spacing: normal !important;
                    font-kerning: auto !important;
                    font-variant-ligatures: none !important;
                } 
                #pdf-dl-fix-final th { color: #ffffff !important; }
            `;
            containerTemp.id = 'pdf-dl-fix-final';
            containerTemp.appendChild(styleFix);
        } else {
            throw new Error("Layout do documento não encontrado.");
        }
        document.body.appendChild(containerTemp);

        // --- B. RENDERIZA COMO IMAGEM (CAPTURA) ---
        window.scrollTo(0,0);
        await new Promise(r => setTimeout(r, 2000)); // Tempo para fontes
        await new Promise(r => requestAnimationFrame(r)); // Frame extra para reflow

        // 🔥 ESCALA 2 + PNG = O equilíbrio perfeito para Android (Nitidez sem travar)
        const fullCanvas = await html2canvas(containerTemp, {
            scale: 4, 
            useCORS: true,
            windowWidth: 794,
            backgroundColor: '#ffffff'
        });

        // --- C. PAGINAÇÃO MANUAL (CORREÇÃO DE CORTE + TARJA BRANCA) ---
        const pdfRatio = 297 / 210; 
        const pageHeightPixels = Math.floor(fullCanvas.width * pdfRatio);
        const margemSeguranca = 100;
        const contentHeightPerPage = pageHeightPixels - (margemSeguranca * 2) - 15;
        const totalHeight = fullCanvas.height;
        let currentHeight = 0;
        let pageCount = 1;

        const printContainer = document.createElement('div');
        printContainer.style.width = '794px';

        // Função que procura uma linha branca próxima ao corte ideal
        // para não cortar no meio de uma linha de texto
        function encontrarCorteSeguro(canvas, corteIdeal, margem) {
            var ctx2 = canvas.getContext('2d');
            var largura = canvas.width;
            // Procura até 80px acima do corte ideal por uma linha quase branca
            var melhor = corteIdeal;
            for (var y = corteIdeal; y > corteIdeal - 80; y--) {
                var pixels = ctx2.getImageData(0, y, largura, 1).data;
                var ehBranco = true;
                for (var p = 0; p < pixels.length; p += 4) {
                    // Se algum pixel não for quase branco (>240), não é linha branca
                    if (pixels[p] < 240 || pixels[p+1] < 240 || pixels[p+2] < 240) {
                        ehBranco = false;
                        break;
                    }
                }
                if (ehBranco) { melhor = y; break; }
            }
            return melhor;
        }

        while (currentHeight < totalHeight) {
            var pageCanvas = document.createElement('canvas');
            pageCanvas.width = fullCanvas.width;
            pageCanvas.height = pageHeightPixels;
            var ctx = pageCanvas.getContext('2d');

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

            var heightLeft = totalHeight - currentHeight;
            var corteIdeal = Math.min(contentHeightPerPage, heightLeft);

            // Se não é a última página, tenta encontrar um corte em linha branca
            var sliceHeight = corteIdeal;
            if (heightLeft > corteIdeal) {
                sliceHeight = encontrarCorteSeguro(fullCanvas, currentHeight + corteIdeal, margemSeguranca) - currentHeight;
                if (sliceHeight <= 0) sliceHeight = corteIdeal;
            }

            var margemTopo = (pageCount > 1) ? margemSeguranca + 40 : margemSeguranca;

            ctx.drawImage(
                fullCanvas,
                0, currentHeight, fullCanvas.width, sliceHeight,
                0, margemTopo, fullCanvas.width, sliceHeight
            );

            // Tarja branca no topo para limpar qualquer resíduo
            if (pageCount > 1) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, pageCanvas.width, margemTopo - 2);
            }

            var imgSlice = document.createElement('img');
            imgSlice.src = pageCanvas.toDataURL('image/jpeg', 0.95);
            imgSlice.style.width = '100%';
            imgSlice.style.display = 'block';

            var pageDiv = document.createElement('div');
            pageDiv.style.cssText = 'position: relative; width: 100%; margin: 0; padding: 0; page-break-after: always;';
            pageDiv.appendChild(imgSlice);
            printContainer.appendChild(pageDiv);

            currentHeight += sliceHeight;
            pageCount++;
        }

        // --- D. GERA O ARQUIVO PDF ---
        const nomeClienteLimpo = (dados.nome || 'Cliente').replace(/[^a-z0-9]/gi, '_');
        const nomeFinalArquivo = `Doc_${nomeClienteLimpo}_${dados.docNumber || '000'}.pdf`;

        // Substitua o bloco const opt por este:
const opt = {
    margin: 0, 
    filename: nomeFinalArquivo,
    image: { type: 'jpeg', quality: 0.95 }, // <--- Mudar para jpeg
    html2canvas: { scale: 4, useCORS: true }, // <--- Mudar para 4
    jsPDF: { unit: 'px', format: [794, 1123], orientation: 'portrait' } 
};


        const worker = html2pdf().set(opt).from(printContainer);

        // ==========================================
        // 🛣️ ROTA 1: APENAS BAIXAR (DOWNLOAD)
        // ==========================================
        if (apenasBaixar) {
            await worker.save(); // Baixa direto
            
            removerLoading();
            botao.innerHTML = textoOriginal;
            botao.disabled = false;
            
            if(typeof showCustomModal === 'function') {
                showCustomModal({ message: "Download concluído! Verifique seus arquivos. 📂" });
            }
            return; // Encerra a função aqui
        }

        // ==========================================
        // 🛣️ ROTA 2: COMPARTILHAR / ENVIAR (WHATSAPP)
        // ==========================================
        const pdfBlob = await worker.output('blob');
        const file = new File([pdfBlob], nomeFinalArquivo, { type: 'application/pdf' });
        
        removerLoading();

        // Configura o botão para estado de "Pronto para Enviar"
        botao.innerHTML = '<i class="bi bi-whatsapp"></i> Enviar PDF'; 
        botao.classList.remove('btn-primary', 'btn-outline-primary', 'btn-secondary', 'btn-dark'); 
        botao.classList.add('btn-success'); 
        botao.disabled = false; 

        // Clone para limpar listeners antigos
        const novoBotao = botao.cloneNode(true);
        botao.parentNode.replaceChild(novoBotao, botao);

        // Evento de Clique para Compartilhar
        novoBotao.addEventListener('click', async () => {
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                const settings = (typeof receiptSettings !== 'undefined') ? receiptSettings : {};
                const saudacao = 'Olá ' + (dados.nome || 'Cliente') + ',';
                const corpoMensagem = settings.shareMessage || 'segue seu documento em anexo.';
                const fotoMsg = dados.fotoUrl ? '\n\n📷 Foto do produto: ' + dados.fotoUrl : '';
                const textoCompleto = saudacao + '\n\n' + corpoMensagem + fotoMsg;

                try {
                    await navigator.share({
                        files: [file],
                        title: "Documento Workcell Tecnologia",
                        text: textoCompleto
                    });
                    
                    // Sucesso Visual
                    novoBotao.innerHTML = '<i class="bi bi-check-circle-fill"></i> Enviado!';
                    novoBotao.classList.replace('btn-success', 'btn-dark');
                    
                    const card = novoBotao.closest('.list-group-item') || novoBotao.closest('.card');
                    if(card) { card.style.borderLeft = "6px solid #28a745"; card.style.backgroundColor = "#f0fff4"; }
                    
                    if((dados.id || dados.docId) && typeof marcarComoEnviadoNoBanco === 'function') {
                        marcarComoEnviadoNoBanco(dados.id || dados.docId);
                    }
                } catch (err) {
                    console.log("Compartilhamento cancelado", err);
                    if (err.name !== 'AbortError') {
                        // Se der erro real no share, oferece download
                        alert("Não foi possível abrir o WhatsApp direto. O arquivo será baixado.");
                        const link = document.createElement('a');
                        link.href = window.URL.createObjectURL(pdfBlob);
                        link.download = nomeFinalArquivo;
                        link.click();
                    }
                }
            } else {
                // Fallback para PC
                const link = document.createElement('a');
                link.href = window.URL.createObjectURL(pdfBlob);
                link.download = nomeFinalArquivo;
                link.click();
            }
        });

    } catch (e) {
        removerLoading();
        console.error(e);
        const msg = "Erro ao processar PDF: " + e.message;
        if (typeof showCustomModal === 'function') {
            showCustomModal({message: msg});
        } else {
            alert(msg);
        }
        botao.innerHTML = textoOriginal;
        botao.disabled = false;
    }
}

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

    // Data de Nascimento
    // Tenta extrair via rótulo
    let dataNasc = extrair('Data de Nascimento') || extrair('Nascimento') || extrair('Nasc') || extrair('Data Nasc') || extrair('Dt Nasc') || extrair('Aniversário');
    
    // Se não achou por rótulo, procura padrão de data no texto (DD/MM/AAAA ou DD-MM-AAAA)
    if (!dataNasc) {
        const mData = texto.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);
        if (mData) dataNasc = mData[0];
    }
    
    // Converte para formato YYYY-MM-DD que o input type="date" exige
    let dataNascISO = '';
    if (dataNasc) {
        // Limpa e tenta parse
        const partes = dataNasc.replace(/[\/-]/g, '/').split('/');
        if (partes.length === 3) {
            const [d, m, a] = partes.map(p => p.trim().replace(/\D/g,''));
            if (d && m && a && a.length === 4) {
                dataNascISO = a + '-' + m.padStart(2,'0') + '-' + d.padStart(2,'0');
            }
        }
    }

    // Preenche
    if (nome) document.getElementById('bookipNome').value = nome;
    if (cpf) document.getElementById('bookipCpf').value = cpf;
    if (tel) document.getElementById('bookipTelefone').value = tel;
    if (email) document.getElementById('bookipEmail').value = email;
    if (endereco.length > 5) document.getElementById('bookipEndereco').value = endereco;
    if (dataNascISO) {
        const nascEl = document.getElementById('bookipNascimento');
        if (nascEl) nascEl.value = dataNascISO;
        if (typeof window._bdSetValor === 'function')
            window._bdSetValor('bookipNascimento','bookipNascimentoBtn','bookipNascimentoLabel', dataNascISO);
    }

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
// ============================================================
// FUNÇÃO DE FAXINA (LIMPA TUDO: DADOS, VISUAL E RASCUNHO)
// ============================================================
window.resetFormulariosBookip = function() {
    console.log("🧹 Executando faxina completa...");

    // 👇 CORREÇÃO CRÍTICA AQUI 👇
    // Removi o 'window.' para ele limpar a variável REAL do módulo app.js
    currentEditingBookipId = null; 
    // 👆 AGORA ELE LIMPA DE VERDADE 👆

    // Garante que o rascunho velho morra quando você pede um novo.
    if(typeof limparRascunhoBookipDefinitivo === 'function') {
        limparRascunhoBookipDefinitivo();
    }

    // 1. Limpa Campos de Texto do Cliente
    // Limpa foto
    window._bookipFotoUrl = '';
    window._bookipFotoBlob = null;
    const _photoPreview = document.getElementById('bookipPhotoPreview');
    const _photoBtnLabel = document.getElementById('bookipPhotoBtnLabel');
    const _photoInput = document.getElementById('bookipPhotoInput');
    if (_photoPreview) _photoPreview.classList.add('hidden');
    if (_photoBtnLabel) _photoBtnLabel.textContent = 'Da galeria';
    if (_photoInput) _photoInput.value = '';

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

    // 7. ZERA A LISTA NA MEMÓRIA E NA TELA
    // Mesma coisa aqui: limpamos a variável direta, sem 'window' se possível, ou ambas por segurança
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

    console.log("✅ Sistema limpo e pronto para novo cadastro (ID: null).");
};






    // --- GATILHOS CORRIGIDOS: EMPRESTAR VALORES ---
    // ============================================================
    
    // 1. Botões de Navegação
    const btnOpenEmprestar = document.getElementById('openEmprestarValores');
    if(btnOpenEmprestar) btnOpenEmprestar.addEventListener('click', () => openCalculatorSection('emprestarValores'));
    
    const btnBackEmprestar = document.getElementById('backFromEmprestarValores');
    if(btnBackEmprestar) btnBackEmprestar.addEventListener('click', () => openCalculatorSection('calculatorHome'));

    // 2. OUVINTE GERAL (Atualiza a conta se mexer em QUALQUER coisa)
    const itensParaVigiar = ['emprestarValorBase', 'emprestarLucroReais', 'emprestarEntrada', 'machine5', 'brand5'];
    
    itensParaVigiar.forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            // "input" serve para quando você digita números
            el.addEventListener('input', calculateEmprestarValores);
            // "change" é CRUCIAL para quando você troca a maquininha ou bandeira
            el.addEventListener('change', calculateEmprestarValores);
        }
    });

    // 3. Lógica Especial da Maquininha (Troca Visual + Recalculo)
    const maquina5 = document.getElementById('machine5');
    if(maquina5) {
        maquina5.addEventListener('change', (event) => {
            // 1. Atualiza a visibilidade da bandeira
            const containerFlag = document.getElementById("flagDisplayContainer5");
            if(containerFlag) {
                 if(maquina5.value !== "pagbank") {
                    containerFlag.style.display = 'block';
                    // Tenta atualizar o ícone da bandeira se a função existir
                    if(typeof updateFlagDisplay === 'function') updateFlagDisplay('5');
                } else {
                    containerFlag.style.display = 'none';
                }
            }
            
            // 2. Abre o modal de bandeiras (se não for pagbank e for clique real do usuário)
            if(event.isTrusted && maquina5.value !== 'pagbank' && typeof openFlagModal === 'function') {
                openFlagModal(maquina5);
            }

            // 3. FORÇA O CÁLCULO IMEDIATAMENTE
            calculateEmprestarValores();
        });
    }

    // 4. Botão de Exportar
    const btnExportEmprestimo = document.getElementById('exportEmprestarBtn');
    if(btnExportEmprestimo) {
        // Clona para garantir que não tenha eventos duplicados
        const newBtn = btnExportEmprestimo.cloneNode(true);
        btnExportEmprestimo.parentNode.replaceChild(newBtn, btnExportEmprestimo);
        
        newBtn.addEventListener('click', () => {
            const nomeProd = document.getElementById('emprestarNomeProduto').value;
            const titulo = nomeProd ? nomeProd : "Simulação de Empréstimo";
            exportResultsToImage('resultEmprestarValores', 'simulacao-emprestimo.png', titulo);
        });
    }




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

// ============================================================
// FUNÇÕES DA CALCULADORA "EMPRESTAR VALORES" (FINAL DO ARQUIVO)
// ============================================================
// FUNÇÃO: EMPRESTAR VALORES (CÁLCULO REVERSO + COLUNA LUCRO)
// ============================================================
// FUNÇÃO: EMPRESTAR VALORES (CORREÇÃO DE VISIBILIDADE MODO CLARO)
// ============================================================
function calculateEmprestarValores() {
    const resultDiv = document.getElementById("resultEmprestarValores");
    const exportContainer = document.getElementById('exportEmprestarContainer');
    
    // 1. Pega os valores
    const valorInvestido = parseFloat(document.getElementById("emprestarValorBase").value) || 0;
    const lucroDesejado = parseFloat(document.getElementById("emprestarLucroReais").value) || 0;
    const valorEntrada = parseFloat(document.getElementById("emprestarEntrada").value) || 0;
    
    // Configurações da Máquina
    const machineEl = document.getElementById("machine5");
    const brandEl = document.getElementById("brand5");
    const machine = machineEl ? machineEl.value : 'valorante';
    const brand = brandEl ? brandEl.value : 'visa';
    
    if (valorInvestido <= 0 && lucroDesejado <= 0) {
        if(resultDiv) resultDiv.innerHTML = "";
        if(exportContainer) exportContainer.style.display = 'none';
        return;
    }

    // 2. META
    const valorLiquidoMeta = valorInvestido + lucroDesejado;

    // 3. ENTRADA VISUAL
    let entradaHtml = '';
    if (valorEntrada > 0) {
        entradaHtml = `
        <div style="display: flex; justify-content: center; width: 100%; margin-bottom: 20px;">
            <div style="background-color: #000; color: #28a745; padding: 12px 35px; border-radius: 50px; font-size: 2rem; font-weight: 800; box-shadow: 0 4px 15px rgba(0,0,0,0.2); text-align: center; line-height: 1;">
                ENTRADA: R$ ${valorEntrada.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
            </div>
        </div>`;
    }

    // 4. AVISO
    const avisoHtml = `
        <div style="margin-top: 15px; margin-bottom: 50px; padding: 15px 10px; background-color: #f8f9fa; border-radius: 12px; text-align: center; border: 1px solid #e9ecef; width: 90%; max-width: 450px; margin-left: auto; margin-right: auto;">
            <h5 style="color: #000; font-weight: 800; text-transform: uppercase; font-size: 11px; letter-spacing: 1px; margin-bottom: 8px;">CONDIÇÕES VÁLIDAS POR TEMPO LIMITADO</h5>
            <p style="color: #555; font-size: 10px; margin: 0; line-height: 2.0; font-weight: 600; letter-spacing: 0.5px;">Os valores apresentados são uma estimativa e podem sofrer alterações sem aviso prévio. Consulte a disponibilidade.</p>
        </div>
    `;

    // 5. TABELA
    let tableRows = "";
    
    for (let i = 1; i <= 12; i++) {
        const taxa = (typeof getRate === 'function') ? getRate(machine, brand, i) : 0;
        
        let valorBrutoTotal = 0;
        if(taxa < 100) {
             valorBrutoTotal = valorLiquidoMeta / (1 - (taxa / 100));
        }

        let valorParcela = valorBrutoTotal / i;
        let lucroParaExibir = valorBrutoTotal - valorInvestido;
        

        tableRows += `
        <tr class="copyable-row">
            <td class="fw-bold" style="font-size: 1.1rem;">${i}x</td>
            <td class="text-primary fw-bold" style="font-size: 1.1rem;">${valorParcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
            <td class="text-secondary small">${valorBrutoTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
            
            <td class="text-success fw-bold small text-end" style="font-size: 0.85rem; border-left: 1px solid #333;">
                Lucro: ${lucroParaExibir.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </td>
        </tr>`;
    }

    // 6. RENDERIZA
    if (resultDiv) {
        resultDiv.innerHTML = `
        ${entradaHtml}
        ${avisoHtml}
        <div class="table-responsive w-100" style="max-width: 500px;">
            <table class="table results-table table-hover align-middle">
                <thead>
                    <tr>
                        <th style="font-size: 1.1rem;">X</th>
                        <th style="font-size: 1.1rem;">Parcela</th>
                        <th style="font-size: 1.1rem;">Total</th>
                        <th class="text-success text-end" style="font-size: 0.9rem;">Lucro</th>
                    </tr>
                </thead>
                <tbody>${tableRows}</tbody>
            </table>
        </div>
        `;
        if(exportContainer) exportContainer.style.display = 'block';
    }
}


// ============================================================
// FUNÇÃO QUE FALTAVA: LIMPAR FORMULÁRIO DE GARANTIA
// ============================================================
function resetGarantiaForm() {
    // 1. Limpa os campos de texto (Nome, CPF, Aparelho, IMEI, Valor)
    const camposParaLimpar = [
        'warrantyClientName', 
        'warrantyClientCPF', 
        'warrantyDevice', 
        'warrantyIMEI', 
        'warrantyValue'
    ];

    camposParaLimpar.forEach(id => {
        const elemento = document.getElementById(id);
        if (elemento) elemento.value = '';
    });

    // 2. Reseta Data e Hora para o momento atual (pra não ficar em branco)
    const agora = new Date();
    
    const inputData = document.getElementById('warrantyDate');
    if (inputData) inputData.valueAsDate = agora;

    const inputHora = document.getElementById('warrantyTime');
    if (inputHora) {
        const horas = String(agora.getHours()).padStart(2, '0');
        const minutos = String(agora.getMinutes()).padStart(2, '0');
        inputHora.value = `${horas}:${minutos}`;
    }

    // 3. Foca no primeiro campo (Nome do Cliente) para agilizar
    const inputNome = document.getElementById('warrantyClientName');
    if (inputNome) inputNome.focus();
}

// ==========================================
// FUNÇÃO DEFINITIVA: SALVAR TAXAS
// ==========================================
async function salvarTaxasDefinitivo() {
    console.log("🟢 Cliquei no botão salvar!");

    const btn = document.getElementById('saveRatesBtn');
    if (!btn) {
        console.error("🔴 Botão saveRatesBtn não encontrado no DOM!");
        return;
    }

    // 1. Feedback Visual
    const textoOriginal = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Salvando...';
    btn.disabled = true;

    try {
        // 2. Coleta inputs. Note que usamos "input[type=number]" dentro do accordion
        const inputs = document.querySelectorAll('#ratesAccordion input[type="number"]');
        console.log(`🔍 Encontrados ${inputs.length} campos de taxa para processar.`);

        const updates = {};
        let contadorMudancas = 0;

        inputs.forEach(input => {
            // Pega os dados dos atributos data- (que é como seu renderRatesEditor cria)
            const machine = input.dataset.machine;
            const type = input.dataset.type; // 'debito' ou 'credito'
            const brand = input.dataset.brand; // 'visa', etc (pode ser null no pagbank)
            const installments = input.dataset.installments ? parseInt(input.dataset.installments) : 0;
            
            let val = parseFloat(input.value);
            if (isNaN(val)) val = 0;

            // Monta o caminho do Firebase
            let path = '';

            if (machine === 'pagbank') {
                if (type === 'debito') {
                    path = `rates/pagbank/debito`;
                } else if (type === 'credito' && installments > 0) {
                    // Firebase array indexa do 0 (parcela 1 = index 0)
                    path = `rates/pagbank/credito/${installments - 1}`;
                }
            } else {
                // Outras máquinas (Infinity, Valorante, Nubank)
                if (brand) {
                    if (type === 'debito') {
                        path = `rates/${machine}/${brand}/debito`;
                    } else if (type === 'credito' && installments > 0) {
                        path = `rates/${machine}/${brand}/credito/${installments - 1}`;
                    }
                }
            }

            if (path) {
                updates[path] = val;
                contadorMudancas++;
            }
        });

        // 3. Envia para o Firebase
        if (contadorMudancas > 0) {
            console.log("📤 Enviando atualizações para o Firebase...", updates);
            // IMPORTANTE: db, ref e update devem ter sido importados no topo do arquivo
            await update(ref(db), updates);
            
            showCustomModal({ message: "Taxas salvas com sucesso! ✅" });
            
            // Recarrega para garantir que a memória local está atualizada
            if (typeof loadRatesFromDB === 'function') loadRatesFromDB();
        } else {
            console.warn("⚠️ Nenhuma taxa válida encontrada para salvar.");
            showCustomModal({ message: "Nenhum dado encontrado para salvar." });
        }

    } catch (error) {
        console.error("🔴 Erro fatal ao salvar:", error);
        showCustomModal({ message: "Erro ao salvar: " + error.message });
    } finally {
        // 4. Restaura o botão
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// ATIVADOR DO BOTÃO (Listener)
// Colocamos um listener direto no documento para garantir que pegue o clique
document.addEventListener('click', function(e) {
    // Verifica se clicou no botão ou no ícone dentro dele
    const target = e.target.closest('#saveRatesBtn');
    
    if (target) {
        e.preventDefault(); // Evita comportamento padrão se houver form
        salvarTaxasDefinitivo();
    }
});

// ============================================================
// 🧠 NOVO SISTEMA DE RASCUNHO (OPÇÃO 1: DESCARTÁVEL)
// ============================================================
const BOOKIP_DRAFT_KEY = 'ctwBookipDraft_Smart_v2';
let timerRascunhoBookip = null;

// 1. MONITORAMENTO (Salva sozinho quando para de digitar)
window.ativarSalvamentoAutomatico = function() {
    const container = document.getElementById('areaBookipWrapper');
    if(!container) return;

    // Badge Visual (O aviso "Salvando...")
    let badge = document.getElementById('badgeRascunhoStatus');
    if (!badge) {
        const header = container.querySelector('h3');
        if(header) {
            badge = document.createElement('span');
            badge.id = 'badgeRascunhoStatus';
            badge.className = 'badge bg-transparent text-secondary ms-2 fw-normal animate__animated animate__fadeIn';
            badge.style.fontSize = '0.75rem';
            header.appendChild(badge);
        }
    }

    // Função de Gatilho (Debounce)
    const gatilho = () => {
        if(badge) {
            badge.className = 'badge bg-warning text-dark ms-2';
            badge.innerHTML = '<i class="bi bi-pencil-fill"></i> ...';
        }
        clearTimeout(timerRascunhoBookip);
        timerRascunhoBookip = setTimeout(executarSalvamentoReal, 1000); // Salva após 1s
    };

    // Adiciona ouvintes em TUDO (Inputs, Selects, Checkboxes)
    container.querySelectorAll('input, select, textarea').forEach(el => {
        el.removeEventListener('input', gatilho);
        el.addEventListener('input', gatilho);
        // Para checkboxes e selects, usa 'change' também
        el.removeEventListener('change', gatilho); 
        el.addEventListener('change', gatilho);
    });
};

// 2. EXECUTAR SALVAMENTO (Grava no LocalStorage)
function executarSalvamentoReal() {
    
    // 👇 CORREÇÃO 1: REMOVI O "window."
    // Verifica a variável local. Se ela existir e não for nula, é porque estamos editando.
    // Nesse caso, o rascunho é ignorado para não salvar por cima.
    if (typeof currentEditingBookipId !== 'undefined' && currentEditingBookipId !== null) {
        return; 
    }

    // Pega os pagamentos
    const pags = [];
    document.querySelectorAll('.check-pagamento:checked').forEach(c => pags.push(c.value));

    const dados = {
        nome: document.getElementById('bookipNome')?.value || '',
        cpf: document.getElementById('bookipCpf')?.value || '',
        tel: document.getElementById('bookipTelefone')?.value || '',
        end: document.getElementById('bookipEndereco')?.value || '',
        email: document.getElementById('bookipEmail')?.value || '',
        dataManual: document.getElementById('bookipDataManual')?.value || '',
        garantia: document.getElementById('bookipGarantiaSelect')?.value,
        garantiaCustom: document.getElementById('bookipGarantiaCustomInput')?.value,
        pagamentos: pags,
        
        // 👇 CORREÇÃO 2: LISTA DE PRODUTOS
        // Usa a variável local 'bookipCartList' em vez de 'window.bookipCartList'
        // Isso garante que o rascunho salve os produtos que estão na memória
        listaProdutos: typeof bookipCartList !== 'undefined' ? bookipCartList : [], 
        
        timestamp: Date.now()
    };

    // Verifica se tem algum dado preenchido
    const temAlgumDado = dados.nome || dados.cpf || dados.tel || dados.email || dados.listaProdutos.length > 0;

    if (temAlgumDado) {
        localStorage.setItem(BOOKIP_DRAFT_KEY, JSON.stringify(dados));
        
        const badge = document.getElementById('badgeRascunhoStatus');
        if(badge) {
            badge.className = 'badge bg-success text-white ms-2';
            badge.innerHTML = '<i class="bi bi-cloud-check"></i> Rascunho Salvo';
        }
    }
}

// 3. VERIFICAR AO ABRIR (A Lógica Inteligente - Mensagem Limpa)
window.checarRascunhoAoAbrir = function() {
    const salvo = localStorage.getItem(BOOKIP_DRAFT_KEY);
    
    // Se não tem nada salvo, só liga o monitoramento e sai
    if (!salvo) {
        window.ativarSalvamentoAutomatico();
        return;
    }

    const dados = JSON.parse(salvo);
    
    // Pergunta se quer usar o rascunho
    showCustomModal({
        // 👇 AQUI ESTÁ A CORREÇÃO: MENSAGEM LIMPA SEM HTML 👇
        message: `Havia um documento não finalizado para ${dados.nome || 'Cliente sem nome'}. Deseja continuar ele?`,
        confirmText: "Sim, recuperar",
        cancelText: "Não, apagar",
        onConfirm: () => {
            // --- RECUPERAÇÃO ---
            if(document.getElementById('bookipNome')) document.getElementById('bookipNome').value = dados.nome;
            if(document.getElementById('bookipCpf')) document.getElementById('bookipCpf').value = dados.cpf;
            if(document.getElementById('bookipTelefone')) document.getElementById('bookipTelefone').value = dados.tel;
            if(document.getElementById('bookipEndereco')) document.getElementById('bookipEndereco').value = dados.end;
            if(document.getElementById('bookipEmail')) document.getElementById('bookipEmail').value = dados.email;
            if(document.getElementById('bookipDataManual')) document.getElementById('bookipDataManual').value = dados.dataManual;

            // Recupera Garantia
            const selGar = document.getElementById('bookipGarantiaSelect');
            if(selGar) {
                selGar.value = dados.garantia || '365';
                const inputGar = document.getElementById('bookipGarantiaCustomInput');
                if(inputGar) {
                    inputGar.value = dados.garantiaCustom || '';
                    if(dados.garantia === 'custom') inputGar.classList.remove('hidden');
                }
            }

            // Recupera Pagamentos
            document.querySelectorAll('.check-pagamento').forEach(c => c.checked = false);
            if (dados.pagamentos) {
                dados.pagamentos.forEach(val => {
                    const check = document.querySelector(`.check-pagamento[value="${val}"]`);
                    if (check) check.checked = true;
                });
            }

            // Recupera Itens
            window.bookipCartList = dados.listaProdutos || [];
            if (typeof atualizarListaVisualBookip === 'function') atualizarListaVisualBookip();

            window.ativarSalvamentoAutomatico();
            showCustomModal({ message: "Rascunho recuperado! 📂" });
        },
        onCancel: () => {
            // --- DESTRUIÇÃO ---
            localStorage.removeItem(BOOKIP_DRAFT_KEY);
            
            if(typeof resetFormulariosBookip === 'function') resetFormulariosBookip();
            
            const badge = document.getElementById('badgeRascunhoStatus');
            if(badge) badge.innerHTML = '';
            
            window.ativarSalvamentoAutomatico();
        }
    });
};

// 4. LIMPEZA FINAL (Chamar após salvar no Firebase)
window.limparRascunhoBookipDefinitivo = function() {
    localStorage.removeItem(BOOKIP_DRAFT_KEY);
    const badge = document.getElementById('badgeRascunhoStatus');
    if(badge) badge.innerHTML = ''; 
};

// Inicia ao carregar (para garantir que os listeners existam)
document.addEventListener('DOMContentLoaded', () => {
    // Se a tela já estiver aberta, ativa
    if(document.getElementById('areaBookipWrapper')?.style.display !== 'none') {
        window.ativarSalvamentoAutomatico();
    }
});



// 🖨️ IMPRESSÃO QUE RESPEITA O DESIGN MAS DESTRAVA AS PÁGINAS
// ============================================================
window.imprimirUniversal = function() {
    // 1. Identifica qual documento está na tela
    const contratoDiv = document.getElementById('contractPreview');
    const bookipDiv = document.getElementById('bookipPreview');
    
    let conteudo = "";
    let titulo = "Documento";

    // Verifica quem tem texto
    if (contratoDiv && contratoDiv.innerHTML.replace(/<[^>]*>?/gm, '').trim().length > 20) {
        conteudo = contratoDiv.innerHTML;
        titulo = "Contrato";
    } else if (bookipDiv && bookipDiv.innerHTML.replace(/<[^>]*>?/gm, '').trim().length > 20) {
        conteudo = bookipDiv.innerHTML;
        titulo = "Garantia";
    } else {
        alert("Nada para imprimir! Gere o documento primeiro.");
        return;
    }

    // 2. Abre uma janela nova (Clone)
    const janela = window.open('', '_blank', 'height=900,width=800');
    
    // 3. Monta o HTML puxando o seu CSS original + A Correção de Rolagem
    janela.document.write(`
        <html>
            <head>
                <title>${titulo}</title>
                <link rel="stylesheet" href="style.css?v=${Date.now()}">
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
                
                <style>
                    /* AQUI ESTÁ O SEGRED0: DESTRAVA SÓ NESSA JANELA */
                    html, body {
                        height: auto !important;
                        overflow: visible !important;
                        background: white !important;
                        color: black !important;
                        display: block !important;
                    }
                    /* Remove botões e coisas inúteis se tiverem vindo junto */
                    .no-print, button, .btn { display: none !important; }
                    
                    /* Ajustes de margem para papel */
                    @page { margin: 10mm; }
                    body { padding: 20px; }
                </style>
            </head>
            <body>
                ${conteudo}
                <script>
                    // Espera carregar o CSS antes de imprimir
                    window.onload = function() {
                        setTimeout(() => {
                            window.print();
                            // window.close(); // Se quiser fechar sozinho depois
                        }, 1000);
                    };
                </script>
            </body>
        </html>
    `);
    janela.document.close();
};


// --- CORREÇÃO FINAL (BLINDADA) ---
// Funciona mesmo se o botão for criado depois
document.addEventListener('click', function(e) {
    // Verifica se clicou no botão de Gerar Relatório (ou no ícone dentro dele)
    if (e.target && (e.target.id === 'generateReportBtn' || e.target.closest('#generateReportBtn'))) {
        
        // 1. Limpa o lixo dos outros documentos
        const lixo = ['bookipPreview', 'contractPreview'];
        lixo.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = ''; 
        });

        // 2. Garante que não tem travas no corpo do site
        document.body.classList.remove('print-only-contract', 'print-only-bookip');
        
        // (Opcional) Console log para você saber que limpou
        console.log("Lixeira de impressão esvaziada!");
    }
});
// ============================================================
// 🔍 FUNÇÃO DE CLIQUE NO FILTRO (Adicione ao final do app.js)
// ============================================================
window.filtrarHistoricoPorPerfil = function(perfil, btn) {
    // 1. Define qual perfil filtrar
    if (perfil === 'MEUS_ARQUIVOS_DINAMICO') {
        if (!currentUserProfile) {
            // Se o usuário não tiver logado/escolhido perfil
            if(typeof showCustomModal === 'function') showCustomModal({ message: "Selecione seu perfil no menu primeiro." });
            else alert("Selecione seu perfil primeiro.");
            return;
        }
        window.activeProfileFilter = currentUserProfile;
    } else {
        window.activeProfileFilter = 'todos';
    }

    // 2. Atualiza visual dos botões (Pinta o ativo de branco)
    document.querySelectorAll('.filter-profile-btn').forEach(b => {
        b.classList.remove('btn-light', 'active', 'fw-bold');
        b.classList.add('btn-outline-light');
    });
    
    if(btn) {
        btn.classList.remove('btn-outline-light');
        btn.classList.add('btn-light', 'active', 'fw-bold');
    }

    // 3. Força a atualização da lista (Chama a função que já existe no seu código)
    // Disparar um evento no campo de busca obriga o filtro a rodar de novo
    const searchInput = document.getElementById('bookipHistorySearch');
    if(searchInput) {
        searchInput.dispatchEvent(new Event('input'));
    }
};


// --- MÁSCARA DE DINHEIRO RÁPIDA ---
const inputVenda = document.getElementById('fecharVendaValue');
if (inputVenda) {
    inputVenda.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, ""); // Só deixa números
        if (value === "") { e.target.value = ""; return; }
        
        // Formata: Divide por 100 e coloca virgula/ponto
        e.target.value = (parseFloat(value) / 100).toLocaleString('pt-BR', {
            minimumFractionDigits: 2, maximumFractionDigits: 2
        });
        
        // Chama o cálculo automaticamente
        calculateFecharVenda();
    });
}


// ============================================================
// 📜 HISTÓRICO DE SIMULAÇÕES (CALCULAR POR APARELHO)
// ============================================================
const HISTORICO_KEY = 'ctwSimulacoesHistory';

// 1. Salva automaticamente
window.salvarHistoricoAparelho = function(texto, titulo) {
    if (!texto) return;
    let lista = JSON.parse(localStorage.getItem(HISTORICO_KEY) || '[]');
    
    // Evita salvar duplicado se clicar 2x seguidas
    if(lista.length > 0 && lista[0].texto === texto) return;

    lista.unshift({
        id: Date.now(),
        data: new Date().toISOString(),
        titulo: titulo || "Simulação",
        texto: texto
    });

    // Mantém só os últimos 30
    if (lista.length > 30) lista = lista.slice(0, 30);
    localStorage.setItem(HISTORICO_KEY, JSON.stringify(lista));
};

// 2. Abre a janelinha (Versão Visual Melhorada)
window.abrirHistoricoAparelho = function() {
    let lista = JSON.parse(localStorage.getItem(HISTORICO_KEY) || '[]');
    
    let htmlItens = lista.length === 0 
        ? '<div class="text-center p-5 text-secondary"><i class="bi bi-clock-history fs-1"></i><p class="mt-2">Nada aqui ainda.</p></div>'
        : lista.map(item => {
            const dataObj = new Date(item.data);
            const dataStr = dataObj.toLocaleDateString('pt-BR');
            const horaStr = dataObj.toLocaleTimeString('pt-BR').slice(0,5);
            
            // Lógica visual: Se tiver o separador "•", a gente quebra em duas linhas
            let destaque = item.titulo;
            let detalhe = "";
            
            if (item.titulo.includes('•')) {
                const partes = item.titulo.split('•');
                destaque = partes[0].trim(); // A parte do valor (Ex: 12x R$ 200)
                detalhe = partes[1].trim();  // A parte do nome (Ex: iPhone 11)
            }

            return `
            <div class="mb-2 p-3 rounded-3" onclick="copiarItemHistorico('${item.id}')" 
                 style="cursor: pointer; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); transition: all 0.2s;">
                
                <div class="d-flex justify-content-between align-items-start">
                    <div style="flex: 1;">
                        <div class="fw-bold text-success mb-1" style="font-size: 1.1rem;">${destaque}</div>
                        ${detalhe ? `<div class="text-light opacity-75 small"><i class="bi bi-phone"></i> ${detalhe}</div>` : ''}
                    </div>
                    
                    <div class="text-end ms-2">
                        <small class="d-block text-secondary" style="font-size: 0.7rem;">${dataStr}</small>
                        <small class="d-block text-secondary" style="font-size: 0.7rem;">${horaStr}</small>
                    </div>
                </div>
                
                <div class="mt-2 pt-2 border-top border-secondary border-opacity-25 d-flex justify-content-end">
                    <small class="text-info" style="font-size: 0.75rem;"><i class="bi bi-clipboard"></i> Toque para copiar</small>
                </div>
            </div>`;
        }).join('');

    const modalHtml = `
    <div class="custom-modal-overlay active" id="modalHistApp" style="z-index: 10000; display: flex;">
        <div class="custom-modal-content" style="width: 450px; max-height: 85vh; display: flex; flex-direction: column; background: #1a1d21;">
            <div class="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom border-secondary border-opacity-25">
                <h5 class="mb-0 text-white"><i class="bi bi-clock-history text-warning me-2"></i>Histórico</h5>
                <button class="btn-back" onclick="document.getElementById('modalHistApp').remove()"><i class="bi bi-x-lg"></i></button>
            </div>
            <div class="overflow-auto flex-grow-1 px-1">${htmlItens}</div>
            <button class="btn btn-outline-danger btn-sm mt-3 w-100" onclick="localStorage.removeItem('${HISTORICO_KEY}'); document.getElementById('modalHistApp').remove();">
                <i class="bi bi-trash"></i> Limpar Histórico
            </button>
        </div>
    </div>`;

    // Remove anterior se existir para não duplicar
    const anterior = document.getElementById('modalHistApp');
    if(anterior) anterior.remove();

    const div = document.createElement('div');
    div.innerHTML = modalHtml;
    document.body.appendChild(div.firstElementChild);
};

// 3. Copia do histórico
window.copiarItemHistorico = function(id) {
    let lista = JSON.parse(localStorage.getItem(HISTORICO_KEY) || '[]');
    const item = lista.find(i => i.id == id);
    if(item) {
        const txt = document.createElement("textarea");
        txt.value = item.texto;
        document.body.appendChild(txt);
        txt.select();
        document.execCommand('copy');
        document.body.removeChild(txt);
        document.getElementById('modalHistApp').remove();
        showCustomModal({ message: "Copiado novamente! ✅" });
    }
};

// ============================================================



// ============================================================
// 🗑️ SISTEMA DE LIXEIRA (SOFT DELETE)
// ============================================================

// 1. MOVER PARA LIXEIRA (Substitui o apagar imediato)
async function moverParaLixeira(id) {
    try {
        // Pega o item original
        const snapshot = await get(ref(db, `bookips/${id}`));
        if (snapshot.exists()) {
            const dados = snapshot.val();
            
            // Adiciona data de exclusão
            dados.deletedAt = Date.now(); 
            dados.originalId = id; // Guarda o ID original por segurança

            // 1. Salva na pasta de lixo
            await set(ref(db, `trash_bookips/${id}`), dados);
            
            // 2. Remove da pasta principal
            await remove(ref(db, `bookips/${id}`));
            
            showCustomModal({ message: "Item movido para a lixeira! 🗑️" });
        }
    } catch (error) {
        console.error(error);
        alert("Erro ao mover para lixeira: " + error.message);
    }
}

// ============================================================
// CORREÇÃO: PENDURAR AS FUNÇÕES NO 'WINDOW' PARA O BOTÃO FUNCIONAR
// ============================================================

// 2. RESTAURAR DA LIXEIRA (Agora visível para o botão)
window.restaurarDaLixeira = async function(id) {
    try {
        const snapshot = await get(ref(db, `trash_bookips/${id}`));
        if (snapshot.exists()) {
            const dados = snapshot.val();
            
            // Remove dados de controle da lixeira
            if(dados.deletedAt) delete dados.deletedAt;
            if(dados.originalId) delete dados.originalId;

            // 1. Devolve para pasta principal (bookips)
            await set(ref(db, `bookips/${id}`), dados);
            
            // 2. Remove da lixeira
            await remove(ref(db, `trash_bookips/${id}`));
            
            // Recarrega a lista para sumir o item restaurado
            abrirLixeiraModal(); 
            
            // Atualiza o histórico principal se estiver aberto atrás
            if(typeof loadBookipHistory === 'function') loadBookipHistory();

            showCustomModal({ message: "Item restaurado com sucesso! ♻️" });
        }
    } catch (error) {
        console.error(error);
        alert("Erro ao restaurar: " + error.message);
    }
};

window.excluirPermanente = async function(id) {
    // 1. O NOME CERTO É 'modalLixeiraOverlay', não 'trashModal'
    const modalEl = document.getElementById('modalLixeiraOverlay');
    
    if (modalEl) {
        console.log("Lixeira encontrada, removendo agora...");
        // Remove o elemento inteiro da tela na hora!
        modalEl.remove(); 
        
        // Limpa o fundo escuro se o Bootstrap tiver criado um
        const backdrop = document.querySelector('.modal-backdrop');
        if (backdrop) backdrop.remove();
        
        // Destrava o scroll do site
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
    }

    // 2. AGORA CHAMA O "TEM CERTEZA"
    showCustomModal({
        message: "Tem certeza? Isso apagará o item PARA SEMPRE.",
        confirmText: "Sim, Adeus",
        onConfirm: async () => {
            try {
                // Deleta do Firebase usando o caminho que está no seu app.js
                await remove(ref(db, `trash_bookips/${id}`));
                
                // Recarrega a lixeira para mostrar que o item sumiu
                abrirLixeiraModal();
                
                showCustomModal({ message: "Item apagado permanentemente." });
            } catch (error) {
                alert("Erro ao excluir: " + error.message);
                abrirLixeiraModal(); // Tenta voltar se der erro
            }
        },
        onCancel: () => {
            // Se desistir de apagar, mostra a lixeira de volta
            abrirLixeiraModal();
        }
    });
};




// 4. LIMPEZA AUTOMÁTICA (15 DIAS)
async function limparLixeiraAutomatico() {
    const snapshot = await get(ref(db, 'trash_bookips'));
    if (!snapshot.exists()) return;

    const lixo = snapshot.val();
    const agora = Date.now();
    const DIAS_EM_MS = 15 * 24 * 60 * 60 * 1000; // 15 dias em milissegundos

    const updates = {};
    let count = 0;

    Object.keys(lixo).forEach(key => {
        const item = lixo[key];
        if (item.deletedAt && (agora - item.deletedAt > DIAS_EM_MS)) {
            updates[`trash_bookips/${key}`] = null; // Marca para deletar
            count++;
        }
    });

    if (count > 0) {
        await update(ref(db), updates);
        console.log(`🧹 Faxina: ${count} itens antigos removidos da lixeira.`);
    }
}

// Roda a limpeza apenas após autenticação estar pronta
setTimeout(function() {
    if (typeof db !== 'undefined' && typeof isAuthReady !== 'undefined' && isAuthReady) {
        limparLixeiraAutomatico();
    }
}, 8000); 


// ============================================================
// 🗑️ INTERFACE DA LIXEIRA (ADICIONAR NO FINAL DO ARQUIVO)
// ============================================================

window.abrirLixeiraModal = function() {
    // 1. Cria o Modal na hora (HTML Dinâmico)
    const modalHtml = `
    <div class="custom-modal-overlay active" id="modalLixeiraOverlay" style="z-index: 10000; display: flex;">
        <div class="custom-modal-content" style="width: 500px; max-height: 85vh; display: flex; flex-direction: column; background: #1a1d21;">
            <div class="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom border-secondary border-opacity-25">
                <h5 class="mb-0 text-white"><i class="bi bi-trash text-danger me-2"></i>Lixeira (Recuperar)</h5>
                <button class="btn-back" onclick="document.getElementById('modalLixeiraOverlay').remove()"><i class="bi bi-x-lg"></i></button>
            </div>
            
            <div id="listaLixeiraContent" class="overflow-auto flex-grow-1 px-1">
                <div class="text-center p-4"><div class="spinner-border text-light"></div></div>
            </div>
            
            <div class="mt-3 pt-2 border-top border-secondary border-opacity-25 text-center">
                <small class="text-secondary">Itens com mais de 15 dias são apagados sozinhos.</small>
            </div>
        </div>
    </div>`;

    // Remove anterior se existir para não duplicar
    const anterior = document.getElementById('modalLixeiraOverlay');
    if(anterior) anterior.remove();

    const div = document.createElement('div');
    div.innerHTML = modalHtml;
    document.body.appendChild(div.firstElementChild);

    // 2. Carrega os dados do Firebase (Pasta trash_bookips)
    // ATENÇÃO: Certifique-se que 'db', 'ref' e 'onValue' estão importados/disponíveis
    const trashRef = ref(db, 'trash_bookips');
    
    onValue(trashRef, (snapshot) => {
        const container = document.getElementById('listaLixeiraContent');
        if(!container) return; // Se o modal já fechou, para tudo

        if (!snapshot.exists()) {
            container.innerHTML = '<div class="text-center p-5 text-secondary"><i class="bi bi-check-circle fs-1"></i><p class="mt-2">Lixeira vazia.</p></div>';
            return;
        }

        const data = snapshot.val();
        const lista = Object.keys(data).map(key => ({ id: key, ...data[key] }));
        
        // Ordena: Excluídos mais recentemente primeiro
        lista.sort((a, b) => b.deletedAt - a.deletedAt);

        container.innerHTML = lista.map(item => {
            const dataDel = item.deletedAt ? new Date(item.deletedAt).toLocaleDateString() : '---';
            
            // Calcula dias restantes para exclusão automática
            const diasPassados = Math.floor((Date.now() - item.deletedAt) / (1000 * 60 * 60 * 24));
            const diasRestantes = 15 - diasPassados;
            
            // Calcula valor total do documento para exibir
            const totalDoc = (item.items || []).reduce((acc, i) => acc + (parseFloat(i.valor||0) * (parseInt(i.qtd)||1)), 0);

            return `
            <div class="mb-2 p-3 rounded-3 d-flex justify-content-between align-items-center" 
                 style="background: rgba(220, 53, 69, 0.1); border: 1px solid rgba(220, 53, 69, 0.3);">
                
                <div class="text-start">
                    <div class="fw-bold text-light">${item.nome || 'Sem Nome'}</div>
                    <div class="small text-secondary">Doc: ${item.docNumber || '---'} • R$ ${totalDoc.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</div>
                    <div class="small text-danger" style="font-size: 0.75rem;">
                        Apagado em: ${dataDel} (Expira em ${diasRestantes} dias)
                    </div>
                </div>

                <div class="d-flex gap-2">
                    <button class="btn btn-sm btn-success" onclick="restaurarDaLixeira('${item.id}')" title="Restaurar">
                        <i class="bi bi-arrow-counterclockwise"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="excluirPermanente('${item.id}')" title="Excluir Agora">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
            </div>`;
        }).join('');
    }, { onlyOnce: true }); // Lê apenas uma vez para economizar dados
};

// ============================================================
// CORREÇÃO: LÓGICA DO SELECT DE GARANTIA (Manual vs Padrão)
// ============================================================
const selectGarantia = document.getElementById('bookipGarantiaSelect');
const inputGarantiaManual = document.getElementById('bookipGarantiaCustomInput');

if (selectGarantia && inputGarantiaManual) {
    selectGarantia.addEventListener('change', function() {
        if (this.value === 'custom') {
            // Se escolheu Manual, mostra o campo e já coloca o cursor lá
            inputGarantiaManual.classList.remove('hidden');
            inputGarantiaManual.focus();
        } else {
            // Se escolheu outra coisa, esconde o campo
            inputGarantiaManual.classList.add('hidden');
            inputGarantiaManual.value = ''; // Opcional: limpa o valor
        }
    });
}

        });


// → Movido para bookip.js: abrirFotoBookip

// ============================================================
// EXPORTS — expõe funções para os módulos externos
// Necessário porque app.js é type="module" e funções são locais
// ============================================================
window.showMainSection       = showMainSection;
window.showCustomModal       = showCustomModal;

// ============================================================
// 🔔 PREFERÊNCIAS DE NOTIFICAÇÃO — painel granular
// ============================================================
(function() {
    var PREFS_KEY = 'ctwNotifPrefs';

    function getPrefs() {
        try {
            var raw = safeStorage.getItem(PREFS_KEY);
            if (raw) { var p = JSON.parse(raw); return { aniversarios: p.aniversarios !== false, reparos: p.reparos !== false, boletos: p.boletos !== false }; }
        } catch(e) {}
        return { aniversarios: true, reparos: true, boletos: true };
    }
    function savePrefs(p) { safeStorage.setItem(PREFS_KEY, JSON.stringify(p)); }

    function updateLabels(prefs) {
        var parts = ['📢'];
        if (prefs.aniversarios) parts.push('🎂');
        if (prefs.reparos)      parts.push('🔧');
        if (prefs.boletos)      parts.push('💸');
        var label = parts.join(' ');
        var el1 = document.getElementById('notifPrefLabel');
        var el2 = document.getElementById('notifPrefLabelSheet');
        if (el1) el1.textContent = label;
        if (el2) el2.textContent = label;
    }

    // Abre/fecha painel bottom-sheet
    window.toggleNotifPref = function() {
        var existing = document.getElementById('_notifPrefPanel');
        if (existing) { existing.remove(); return; }
        var prefs = getPrefs();
        var cur = Object.assign({}, prefs);

        var panel = document.createElement('div');
        panel.id = '_notifPrefPanel';
        panel.style.cssText = 'position:fixed;inset:0;z-index:30000;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.65);backdrop-filter:blur(6px);';

        function cbHtml(on) {
            return on ? '<span style="width:22px;height:22px;border-radius:6px;background:var(--primary-color,#00e5ff);display:flex;align-items:center;justify-content:center;font-size:.85rem;color:#000;font-weight:900;">✓</span>'
                      : '<span style="width:22px;height:22px;border-radius:6px;border:2px solid rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;"></span>';
        }

        function row(id, icon, bg, color, title, sub, key) {
            return '<div id="_np_' + id + '" style="display:flex;align-items:center;gap:14px;padding:14px 22px;cursor:pointer;">'
                + '<div style="width:42px;height:42px;border-radius:12px;background:' + bg + ';color:' + color + ';display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0;">' + icon + '</div>'
                + '<div style="flex:1;"><div style="font-size:.9rem;font-weight:600;">' + title + '</div><div style="font-size:.72rem;color:var(--text-secondary,#8899aa);">' + sub + '</div></div>'
                + '<div id="_npcb_' + key + '">' + cbHtml(cur[key]) + '</div>'
                + '</div>';
        }

        panel.innerHTML = '<div style="background:var(--bg-color,#0b1325);border-radius:24px 24px 0 0;padding:0 0 env(safe-area-inset-bottom,16px);width:100%;max-width:480px;">'
            + '<style>@keyframes _npUp{from{transform:translateY(100%)}to{transform:translateY(0)}}</style>'
            + '<div style="animation:_npUp .28s cubic-bezier(.34,1.56,.64,1);">'
            + '<div style="width:40px;height:4px;background:rgba(255,255,255,.15);border-radius:99px;margin:14px auto 18px;"></div>'
            + '<div style="font-weight:700;font-size:1rem;color:var(--text-color,#fff);padding:0 22px 14px;display:flex;align-items:center;gap:8px;"><i class="bi bi-bell-fill" style="color:var(--primary-color,#00e5ff);"></i> Preferências de Notificação</div>'
            + '<div style="display:flex;align-items:center;gap:14px;padding:14px 22px;opacity:.5;">'
            +   '<div style="width:42px;height:42px;border-radius:12px;background:rgba(0,229,255,.12);color:#00e5ff;display:flex;align-items:center;justify-content:center;font-size:1.3rem;">📢</div>'
            +   '<div style="flex:1;"><div style="font-size:.9rem;font-weight:600;">Avisos do administrador</div><div style="font-size:.72rem;color:var(--text-secondary,#8899aa);">Comunicados e novidades</div></div>'
            +   '<span style="font-size:.65rem;font-weight:700;padding:2px 8px;border-radius:99px;background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3);">Obrigatório</span>'
            + '</div>'
            + '<div style="height:1px;background:rgba(255,255,255,.07);margin:0 22px;"></div>'
            + row('aniv','🎂','rgba(251,146,60,.12)','#fb923c','Aniversários de clientes','Alerta no dia do aniversário','aniversarios')
            + row('rep','🔧','rgba(168,85,247,.12)','#a855f7','Alertas de reparo','Prazos próximos e vencidos','reparos')
            + row('bol','💸','rgba(239,68,68,.12)','#ef4444','Boletos vencendo','Parcelas próximas do vencimento','boletos')
            + '<button id="_npSaveBtn" style="width:calc(100% - 32px);margin:14px 16px 0;padding:14px;border:none;border-radius:14px;background:var(--primary-color,#00e5ff);color:#000;font-weight:700;font-size:.95rem;cursor:pointer;">Salvar preferências</button>'
            + '</div></div>';

        panel.addEventListener('click', function(e) { if (e.target === panel) panel.remove(); });
        document.body.appendChild(panel);

        ['aniversarios','reparos','boletos'].forEach(function(key) {
            var idMap = { aniversarios:'aniv', reparos:'rep', boletos:'bol' };
            document.getElementById('_np_' + idMap[key]).addEventListener('click', function() {
                cur[key] = !cur[key];
                document.getElementById('_npcb_' + key).innerHTML = cbHtml(cur[key]);
            });
        });
        document.getElementById('_npSaveBtn').addEventListener('click', function() {
            savePrefs(cur);
            updateLabels(cur);
            panel.remove();
            if (typeof window.updateNotificationUI === 'function') window.updateNotificationUI(window._currentNotifications || []);
        });
    };

    window.getNotifPref = function() { return getPrefs(); };

    window.filterNotifsByPref = function(notifications) {
        var prefs = getPrefs();
        return notifications.filter(function(n) {
            if (n.isGeneral)  return true;
            if (n.isBirthday) return prefs.aniversarios;
            if (n.repairId)   return prefs.reparos;
            if (n.boletoId)   return prefs.boletos;
            return true;
        });
    };

    function init() { updateLabels(getPrefs()); }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 500);
    }
})();

// ============================================================
// 📸 AVATAR DO USUÁRIO
// ============================================================
(function() {

    var CLD_URL    = 'https://api.cloudinary.com/v1_1/dmvynrze6/image/upload';
    var CLD_PRESET = 'g8rdi3om';

    function comprimirAvatar(file) {
        return new Promise(function(resolve, reject) {
            var img = new Image();
            var objectUrl = URL.createObjectURL(file);
            img.onload = function() {
                URL.revokeObjectURL(objectUrl);
                var MAX = 256, w = img.width, h = img.height, side = Math.min(w, h);
                var canvas = document.createElement('canvas');
                canvas.width = MAX; canvas.height = MAX;
                canvas.getContext('2d').drawImage(img, (w-side)/2, (h-side)/2, side, side, 0, 0, MAX, MAX);
                canvas.toBlob(function(blob) { resolve(blob); }, 'image/webp', 0.82);
            };
            img.onerror = function() { URL.revokeObjectURL(objectUrl); reject(new Error('Imagem inválida')); };
            img.src = objectUrl;
        });
    }

    async function uploadCloudinary(blob) {
        var fd = new FormData();
        fd.append('file', blob, 'avatar.webp');
        fd.append('upload_preset', CLD_PRESET);
        fd.append('folder', 'bookip_fotos');
        var r = await fetch(CLD_URL, { method: 'POST', body: fd });
        if (!r.ok) throw new Error('Cloudinary HTTP ' + r.status);
        var data = await r.json();
        if (!data.secure_url) throw new Error('Cloudinary sem URL');
        return data.secure_url;
    }

    function getCacheKey(nome) {
        return 'ctwAvatar_' + (nome || '').toLowerCase().replace(/\s+/g, '_');
    }

    // Aplica a foto nos elementos da tela
    function aplicarAvatar(url) {
        var img  = document.getElementById('avatarPhotoImg');
        var icon = document.getElementById('avatarPhotoIcon');
        if (!img) return;
        if (url) {
            img.src = url;
            img.style.display = 'block';
            if (icon) icon.style.display = 'none';
        } else {
            img.style.display = 'none';
            if (icon) icon.style.display = '';
        }
    }

    // Carrega avatar: teamProfilesList → localStorage
    function loadAvatar() {
        var nome = localStorage.getItem('ctwUserProfile') || '';
        if (!nome) { aplicarAvatar(null); return; }

        // 1. teamProfilesList (já em memória, vindo do Firebase)
        var lista = window.teamProfilesList || {};
        for (var id in lista) {
            if ((lista[id].name || '').toLowerCase() === nome.toLowerCase()) {
                if (lista[id].avatarUrl) {
                    aplicarAvatar(lista[id].avatarUrl);
                    // Atualiza cache local com o valor do Firebase
                    localStorage.setItem(getCacheKey(nome), lista[id].avatarUrl);
                    return;
                }
                break;
            }
        }
        // 2. Cache localStorage
        aplicarAvatar(localStorage.getItem(getCacheKey(nome)) || null);
    }

    // Salva no Firebase em background (não bloqueia a UX)
    function salvarFirebaseBackground(nome, url) {
        // Tenta imediatamente; se não puder, agenda retry
        function tentar(vez) {
            if (vez > 20) return;
            var _db     = window._firebaseDB;
            var _ref    = window._dbRef;
            var _update = window._dbUpdate;
            var lista   = window.teamProfilesList || {};
            var profId  = null;

            for (var id in lista) {
                if ((lista[id].name || '').toLowerCase() === nome.toLowerCase()) { profId = id; break; }
            }
            // Fallback cache_equipe_local
            if (!profId) {
                try {
                    var c = JSON.parse(localStorage.getItem('cache_equipe_local') || '{}');
                    for (var cid in c) {
                        if ((c[cid].name || '').toLowerCase() === nome.toLowerCase()) { profId = cid; break; }
                    }
                } catch(e) {}
            }

            if (!_db || !_ref || !_update || !profId) {
                setTimeout(function() { tentar(vez + 1); }, 2000);
                return;
            }

            _update(_ref(_db, 'team_profiles/' + profId), { avatarUrl: url })
                .then(function() {
                    console.log('[Avatar] ✅ Firebase salvo para', nome);
                    // Atualiza memória local para que outros reads encontrem
                    if (window.teamProfilesList && window.teamProfilesList[profId]) {
                        window.teamProfilesList[profId].avatarUrl = url;
                    }
                })
                .catch(function(e) { console.warn('[Avatar] Firebase erro:', e.message); });
        }
        tentar(1);
    }

    function initAvatar() {
        loadAvatar();
        var input = document.getElementById('avatarPhotoInput');
        if (!input) return;

        input.addEventListener('change', async function(e) {
            var file = e.target.files[0];
            input.value = '';
            if (!file) return;
            try {
                var blob = await comprimirAvatar(file);
                var nome = localStorage.getItem('ctwUserProfile') || '';

                // 1. Preview imediato
                var previewUrl = URL.createObjectURL(blob);
                aplicarAvatar(previewUrl);

                // 2. Upload Cloudinary
                var url = await uploadCloudinary(blob);

                // 3. Salvar localmente E em memória (garante exibição imediata no sheet)
                localStorage.setItem(getCacheKey(nome), url);
                // Atualiza teamProfilesList em memória para syncSheetProfile encontrar
                var lista = window.teamProfilesList || {};
                for (var id in lista) {
                    if ((lista[id].name || '').toLowerCase() === nome.toLowerCase()) {
                        window.teamProfilesList[id].avatarUrl = url;
                        break;
                    }
                }
                aplicarAvatar(url);

                // 4. Salvar no Firebase em background (não bloqueia)
                salvarFirebaseBackground(nome, url);

            } catch(err) {
                console.error('[Avatar] erro:', err.message);
                if (typeof showCustomModal === 'function') {
                    showCustomModal({ message: '❌ Erro ao processar foto.' });
                }
            }
        });
    }

    // Recarrega ao trocar perfil
    if (typeof window.setProfile === 'function') {
        var _orig = window.setProfile;
        window.setProfile = function(nome) { _orig(nome); setTimeout(loadAvatar, 300); };
    }

    window._loadAvatar = loadAvatar;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(initAvatar, 400); });
    } else {
        setTimeout(initAvatar, 400);
    }
})();

window.setupNotificationListeners = setupNotificationListeners;
window.escapeHtml            = typeof escapeHtml === 'function' ? escapeHtml : (s) => s;
window.updateNotificationUI  = updateNotificationUI;
// db exposto via window._firebaseDB no onAuthStateChanged (ver abaixo)


// ============================================================
// 👥 GERENCIAMENTO DE PERFIS — painel no admin, senha 220390
// ============================================================
(function() {
    var ADMIN_SENHA = '220390';

    // Abre o painel com verificação de senha
    window.abrirGerenciarPerfis = function() {
        var ov = document.createElement('div');
        ov.id = '_gPerfisSenhaOv';
        ov.style.cssText = 'position:fixed;inset:0;z-index:25000;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;padding:20px;';
        ov.innerHTML = `
            <div style="background:var(--bg-color,#0b1325);border:1px solid var(--glass-border);border-radius:20px;padding:24px;width:100%;max-width:340px;display:flex;flex-direction:column;gap:14px;">
                <div style="font-weight:700;font-size:1rem;color:var(--text-color);">🔐 Senha do Administrador</div>
                <input id="_gPerfisSenhaInput" type="password" class="form-control" placeholder="Senha de acesso" style="text-align:center;letter-spacing:4px;font-size:1.1rem;" autocomplete="off">
                <div style="display:flex;gap:10px;">
                    <button id="_gPerfisSenhaCancel" class="btn btn-outline-secondary flex-fill">Cancelar</button>
                    <button id="_gPerfisSenhaOk"     class="btn btn-primary flex-fill">Entrar</button>
                </div>
            </div>
        `;
        document.body.appendChild(ov);
        var inp = document.getElementById('_gPerfisSenhaInput');
        setTimeout(function(){ if(inp) inp.focus(); }, 80);

        function check() {
            var val = inp ? inp.value.trim() : '';
            ov.remove();
            if(val === ADMIN_SENHA) {
                _renderPerfilPanel();
            } else {
                if(typeof showCustomModal === 'function') showCustomModal({ message: '❌ Senha incorreta.' });
            }
        }
        document.getElementById('_gPerfisSenhaOk').addEventListener('click', check);
        document.getElementById('_gPerfisSenhaCancel').addEventListener('click', function(){ ov.remove(); });
        if(inp) inp.addEventListener('keydown', function(e){ if(e.key==='Enter') check(); });
    };

    function _renderPerfilPanel() {
        var existing = document.getElementById('_gPerfisPanel');
        if(existing) existing.remove();

        var panel = document.createElement('div');
        panel.id = '_gPerfisPanel';
        panel.style.cssText = 'position:fixed;inset:0;z-index:24000;background:var(--bg-color,#0b1325);display:flex;flex-direction:column;overflow:hidden;';

        panel.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--glass-border);flex-shrink:0;">
                <span style="font-weight:700;font-size:1.05rem;color:var(--text-color);">👥 Perfis e Usuários</span>
                <button id="_gPerfisClose" style="background:rgba(255,255,255,.08);border:none;color:var(--text-secondary);border-radius:50%;width:32px;height:32px;font-size:.85rem;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
            </div>
            <div id="_gPerfisList" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch;"></div>
            <div style="padding:14px 16px 20px;border-top:1px solid var(--glass-border);flex-shrink:0;">
                <button id="_gPerfisAddBtn" class="btn btn-outline-success w-100 py-2">
                    <i class="bi bi-plus-lg"></i> Adicionar Novo Perfil
                </button>
            </div>
        `;
        document.body.appendChild(panel);

        document.getElementById('_gPerfisClose').addEventListener('click', function(){ panel.remove(); });
        document.getElementById('_gPerfisAddBtn').addEventListener('click', _addPerfil);
        _loadPerfis();
    }

    function _loadPerfis() {
        var container = document.getElementById('_gPerfisList');
        if(!container) return;
        if(!teamProfilesList || Object.keys(teamProfilesList).length === 0) {
            container.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:40px 0;">Nenhum perfil encontrado.</div>';
            return;
        }
        var arr = Object.entries(teamProfilesList).map(function(e){ return Object.assign({id:e[0]}, e[1]); });
        arr.sort(function(a,b){ return (a.createdAt||a.id).localeCompare(b.createdAt||b.id); });

        container.innerHTML = '';
        arr.forEach(function(p) {
            var card = document.createElement('div');
            card.style.cssText = 'background:var(--glass-bg);border:1px solid var(--glass-border);border-radius:16px;padding:14px 16px;display:flex;align-items:center;gap:12px;';
            var cores = ['#EF5350','#2979FF','#00E676','#FFD600','#AB47BC','#FF7043'];
            var cor = cores[p.name.length % cores.length];
            var temSenha = !!p.senha;
            var isCurrent = p.name === currentUserProfile;

            card.innerHTML = `
                <div style="width:42px;height:42px;border-radius:50%;background:${cor};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.1rem;color:#fff;flex-shrink:0;">${p.name.charAt(0).toUpperCase()}</div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;font-size:.9rem;color:var(--text-color);">${p.name} ${isCurrent ? '<span style="font-size:.6rem;background:#10b981;color:#fff;padding:1px 6px;border-radius:999px;vertical-align:middle;">VOCÊ</span>' : ''}</div>
                    <div style="font-size:.72rem;color:var(--text-secondary);margin-top:2px;">${temSenha ? '🔐 Senha definida' : '🔓 Sem senha'}</div>
                </div>
                <button data-pid="${p.id}" data-pname="${p.name}" data-psenha="${p.senha||''}" class="_gPerfisEditBtn" style="background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.25);color:#3b82f6;border-radius:8px;padding:6px 10px;font-size:.72rem;cursor:pointer;white-space:nowrap;">✏️ Editar</button>
                <button data-pid="${p.id}" data-pname="${p.name}" class="_gPerfisDelBtn" style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);color:#ef4444;border-radius:8px;padding:6px 10px;font-size:.72rem;cursor:pointer;">🗑</button>
            `;
            container.appendChild(card);
        });

        container.querySelectorAll('._gPerfisEditBtn').forEach(function(btn){
            btn.addEventListener('click', function(){ _editPerfil(btn.dataset.pid, btn.dataset.pname, btn.dataset.psenha); });
        });
        container.querySelectorAll('._gPerfisDelBtn').forEach(function(btn){
            btn.addEventListener('click', function(){ _deletePerfil(btn.dataset.pid, btn.dataset.pname); });
        });
    }

    function _editPerfil(pid, nome, senhaAtual) {
        var ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;z-index:26000;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:20px;';
        ov.innerHTML = `
            <div style="background:var(--bg-color,#0b1325);border:1px solid var(--glass-border);border-radius:20px;padding:24px;width:100%;max-width:360px;display:flex;flex-direction:column;gap:16px;">

                <div style="font-weight:700;font-size:1rem;color:var(--text-color);">✏️ Editar Perfil</div>

                <!-- Nome -->
                <div>
                    <label style="font-size:.75rem;color:var(--text-secondary);margin-bottom:4px;display:block;">Nome</label>
                    <input id="_editPerfilNome" class="form-control" type="text" value="${nome}" autocomplete="off">
                </div>

                <!-- Bloco de senha -->
                <div style="background:rgba(255,255,255,0.04);border:1px solid var(--glass-border);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;">

                    ${senhaAtual ? `
                    <!-- Tem senha: mostra status + opções -->
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-size:1.1rem;">🔐</span>
                        <span style="font-size:.78rem;color:var(--text-color);font-weight:600;">Senha definida</span>
                    </div>

                    <div id="_editSenhaOpcoes" style="display:flex;flex-direction:column;gap:8px;">
                        <button id="_btnAlterarSenha" style="background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.3);color:#3b82f6;border-radius:8px;padding:8px;font-size:.75rem;cursor:pointer;font-weight:600;">
                            🔄 Alterar senha
                        </button>
                        <button id="_btnRemoverSenha" style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:#ef4444;border-radius:8px;padding:8px;font-size:.75rem;cursor:pointer;font-weight:600;">
                            🔓 Remover senha (deixar sem senha)
                        </button>
                    </div>

                    <div id="_novaSenhaContainer" style="display:none;">
                        <label style="font-size:.72rem;color:var(--text-secondary);margin-bottom:4px;display:block;">Nova senha</label>
                        <input id="_editPerfilSenha" class="form-control" type="password" placeholder="Digite a nova senha..." autocomplete="new-password">
                    </div>

                    <div id="_removerSenhaConfirm" style="display:none;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:10px;font-size:.75rem;color:#ef4444;line-height:1.4;">
                        ⚠️ A senha será <strong>removida</strong> ao salvar. Este perfil ficará sem proteção.
                    </div>
                    ` : `
                    <!-- Sem senha: mostra campo direto -->
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">
                        <span style="font-size:1.1rem;">🔓</span>
                        <span style="font-size:.78rem;color:var(--text-secondary);">Sem senha definida</span>
                    </div>
                    <label style="font-size:.72rem;color:var(--text-secondary);margin-bottom:2px;display:block;">Definir senha (opcional)</label>
                    <input id="_editPerfilSenha" class="form-control" type="password" placeholder="Deixe vazio para continuar sem senha..." autocomplete="new-password">
                    `}
                </div>

                <div style="display:flex;gap:10px;">
                    <button id="_editPerfilCancel" class="btn btn-outline-secondary flex-fill">Cancelar</button>
                    <button id="_editPerfilSave"   class="btn btn-primary flex-fill">💾 Salvar</button>
                </div>
            </div>
        `;
        document.body.appendChild(ov);

        var nomeInp  = document.getElementById('_editPerfilNome');
        var senhaInp = document.getElementById('_editPerfilSenha');
        setTimeout(function(){ if(nomeInp) nomeInp.focus(); }, 80);

        // Lógica dos botões de senha (só existe se já tiver senha)
        var _removerSenha = false;
        if (senhaAtual) {
            document.getElementById('_btnAlterarSenha').addEventListener('click', function() {
                _removerSenha = false;
                document.getElementById('_novaSenhaContainer').style.display = 'block';
                document.getElementById('_removerSenhaConfirm').style.display = 'none';
                document.getElementById('_editSenhaOpcoes').style.display = 'none';
                setTimeout(function(){ if(senhaInp) senhaInp.focus(); }, 60);
            });
            document.getElementById('_btnRemoverSenha').addEventListener('click', function() {
                _removerSenha = true;
                document.getElementById('_removerSenhaConfirm').style.display = 'block';
                document.getElementById('_novaSenhaContainer').style.display = 'none';
                document.getElementById('_editSenhaOpcoes').style.display = 'none';
            });
        }

        document.getElementById('_editPerfilCancel').addEventListener('click', function(){ ov.remove(); });
        document.getElementById('_editPerfilSave').addEventListener('click', function(){
            var novoNome  = nomeInp.value.trim();
            var novaSenha = senhaInp ? senhaInp.value : '';
            if(!novoNome) { alert('Nome obrigatório.'); return; }

            var updates = { name: novoNome };

            if (_removerSenha) {
                // Remove explicitamente a senha do Firebase
                updates.senha = null;
            } else if (novaSenha) {
                updates.senha = novaSenha;
            } else if (senhaAtual && !_removerSenha) {
                updates.senha = senhaAtual; // mantém a existente
            }

            update(ref(db, 'team_profiles/' + pid), updates).then(function(){
                if(nome === currentUserProfile && novoNome !== nome) {
                    currentUserProfile = novoNome;
                    localStorage.setItem('ctwUserProfile', novoNome);
                }
                ov.remove();
                _loadPerfis();
                var msg = _removerSenha ? '✅ Senha removida! Perfil sem proteção.' : '✅ Perfil atualizado!';
                if(typeof showCustomModal === 'function') showCustomModal({ message: msg });
            }).catch(function(e){ alert('Erro: ' + e.message); });
        });
    }

    function _deletePerfil(pid, nome) {
        // Modal estilizado de confirmação com senha de admin
        var ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;z-index:26000;background:rgba(0,0,0,.9);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);';
        ov.innerHTML = `
            <div style="background:var(--bg-color,#0b1325);border:1px solid rgba(239,68,68,.35);border-radius:20px;padding:24px;width:100%;max-width:340px;display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center;">

                <!-- Ícone de perigo -->
                <div style="width:60px;height:60px;border-radius:50%;background:rgba(239,68,68,.15);border:2px solid rgba(239,68,68,.3);display:flex;align-items:center;justify-content:center;font-size:1.8rem;">
                    🗑️
                </div>

                <!-- Título -->
                <div style="display:flex;flex-direction:column;gap:4px;">
                    <span style="font-size:1rem;font-weight:700;color:#ef4444;">Excluir perfil?</span>
                    <span style="font-size:.82rem;color:var(--text-color);font-weight:600;">"${nome}"</span>
                    <span style="font-size:.73rem;color:var(--text-secondary);line-height:1.4;margin-top:2px;">
                        Essa ação é irreversível e vai remover<br>este perfil para <strong>toda a equipe</strong>.
                    </span>
                </div>

                <!-- Campo de senha -->
                <div style="width:100%;text-align:left;">
                    <label style="font-size:.72rem;color:var(--text-secondary);margin-bottom:6px;display:block;">🔑 Confirme com a senha de administrador:</label>
                    <input id="_deletePerfilSenha" class="form-control" type="password"
                           placeholder="••••••"
                           autocomplete="off"
                           style="text-align:center;letter-spacing:6px;font-size:1.1rem;">
                    <div id="_deletePerfilErro" style="display:none;margin-top:6px;font-size:.72rem;color:#ef4444;font-weight:600;">
                        ❌ Senha incorreta. Tente novamente.
                    </div>
                </div>

                <!-- Botões -->
                <div style="display:flex;gap:10px;width:100%;">
                    <button id="_deletePerfilCancel" style="
                        flex:1;padding:10px;border-radius:10px;
                        background:rgba(255,255,255,0.06);
                        border:1px solid var(--glass-border);
                        color:var(--text-color);font-size:.85rem;
                        font-weight:600;cursor:pointer;">
                        Cancelar
                    </button>
                    <button id="_deletePerfilConfirm" style="
                        flex:1;padding:10px;border-radius:10px;
                        background:rgba(239,68,68,.2);
                        border:1px solid rgba(239,68,68,.4);
                        color:#ef4444;font-size:.85rem;
                        font-weight:700;cursor:pointer;">
                        🗑️ Excluir
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(ov);

        var senhaInp = document.getElementById('_deletePerfilSenha');
        var erroDiv  = document.getElementById('_deletePerfilErro');
        setTimeout(function(){ if(senhaInp) senhaInp.focus(); }, 80);

        document.getElementById('_deletePerfilCancel').addEventListener('click', function(){ ov.remove(); });

        document.getElementById('_deletePerfilConfirm').addEventListener('click', function(){
            if(senhaInp.value !== '220390') {
                erroDiv.style.display = 'block';
                senhaInp.value = '';
                senhaInp.focus();
                // Shake animation
                senhaInp.style.transition = 'transform 0.08s';
                var shakes = ['-6px','6px','-4px','4px','0px'];
                var i = 0;
                var shake = setInterval(function(){
                    senhaInp.style.transform = 'translateX(' + shakes[i++] + ')';
                    if(i >= shakes.length) { clearInterval(shake); senhaInp.style.transform = ''; }
                }, 60);
                return;
            }
            // Senha correta — exclui
            ov.remove();
            remove(ref(db, 'team_profiles/' + pid)).then(function(){
                if(nome === currentUserProfile) {
                    currentUserProfile = '';
                    localStorage.removeItem('ctwUserProfile');
                }
                _loadPerfis();
                if(typeof showCustomModal === 'function') showCustomModal({ message: '✅ Perfil "' + nome + '" removido.' });
            }).catch(function(e){ alert('Erro: ' + e.message); });
        });

        // Enter no campo de senha confirma
        senhaInp.addEventListener('keydown', function(e){
            if(e.key === 'Enter') document.getElementById('_deletePerfilConfirm').click();
        });
    }

    function _addPerfil() {
        var ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;z-index:26000;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:20px;';
        ov.innerHTML = `
            <div style="background:var(--bg-color,#0b1325);border:1px solid var(--glass-border);border-radius:20px;padding:24px;width:100%;max-width:360px;display:flex;flex-direction:column;gap:14px;">
                <div style="font-weight:700;font-size:1rem;color:var(--text-color);">➕ Novo Perfil</div>
                <div>
                    <label style="font-size:.75rem;color:var(--text-secondary);margin-bottom:4px;display:block;">Nome</label>
                    <input id="_addPerfilNome" class="form-control" type="text" placeholder="Ex: Carlos" autocomplete="off">
                </div>
                <div>
                    <label style="font-size:.75rem;color:var(--text-secondary);margin-bottom:4px;display:block;">Senha (opcional)</label>
                    <input id="_addPerfilSenha" class="form-control" type="password" placeholder="Deixe vazio para sem senha" autocomplete="new-password">
                </div>
                <div style="display:flex;gap:10px;">
                    <button id="_addPerfilCancel" class="btn btn-outline-secondary flex-fill">Cancelar</button>
                    <button id="_addPerfilSave"   class="btn btn-primary flex-fill">Criar</button>
                </div>
            </div>
        `;
        document.body.appendChild(ov);
        var nomeInp  = document.getElementById('_addPerfilNome');
        var senhaInp = document.getElementById('_addPerfilSenha');
        setTimeout(function(){ if(nomeInp) nomeInp.focus(); }, 80);

        document.getElementById('_addPerfilCancel').addEventListener('click', function(){ ov.remove(); });
        document.getElementById('_addPerfilSave').addEventListener('click', function(){
            var nome  = nomeInp.value.trim();
            var senha = senhaInp.value;
            if(!nome) { alert('Nome obrigatório.'); return; }
            var data = { name: nome, createdAt: new Date().toISOString() };
            if(senha) data.senha = senha;
            push(ref(db, 'team_profiles'), data).then(function(){
                ov.remove();
                _loadPerfis();
                if(typeof showCustomModal === 'function') showCustomModal({ message: '✅ Perfil "' + nome + '" criado!' });
            }).catch(function(e){ alert('Erro: ' + e.message); });
        });
    }
})();

// ============================================================
// NOTIFICAÇÕES — "Ver contrato" usa a navegação da busca global
// (overlay Sherlock + vence barreira do "Ver Mais")
// ============================================================
(function() {
    function hookVerBoleto() {
        window.verBoletoDeNotificacao = function(boletoId) {
            if (!boletoId) return;
            // Fecha balões antes de navegar
            var container = document.getElementById('notif-balloons-container');
            if (container && typeof closeBalloons === 'function') closeBalloons(container);
            // Usa o mesmo navigate da busca global (com Sherlock overlay)
            if (typeof window._ctwNavigate === 'function') {
                window._ctwNavigate('boleto', boletoId);
            } else {
                // Fallback básico
                if (typeof window.showMainSection === 'function') window.showMainSection('contract');
                setTimeout(function() {
                    if (typeof window.openDocumentsSection === 'function') window.openDocumentsSection('contrato');
                    var t = document.getElementById('boletoModeToggle');
                    if (t && !t.checked) { t.checked = true; t.dispatchEvent(new Event('change')); }
                }, 300);
            }
        };
    }
    // Aguarda Favorites.js carregar (que define verBoletoDeNotificacao primeiro)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(hookVerBoleto, 800); });
    } else {
        setTimeout(hookVerBoleto, 800);
    }
})();
(function() {
    var STYLE_KEY = 'ctwMenuStyle'; // 'classic' | 'v2'

    function isV2() {
        return (localStorage.getItem(STYLE_KEY) || 'classic') === 'v2';
    }

    // Aplica o estilo sem animação (usado no boot)
    function applyMenuStyle(style) {
        var isCards = (style === 'v2');

        // Pares: [classic element id, v2 element id]
        var pairs = [
            ['menuClassic',     'menuCards'],
            ['calcMenuClassic', 'calcMenuCards'],
            ['docsMenuClassic', 'docsMenuCards'],
        ];
        pairs.forEach(function(p) {
            var classic = document.getElementById(p[0]);
            var cards   = document.getElementById(p[1]);
            if (classic) {
                // Remove inline style que possa ter ficado
                classic.style.removeProperty('display');
                classic.classList.toggle('ctw-menu-hide', isCards);
            }
            if (cards) {
                cards.style.removeProperty('display');
                cards.classList.toggle('ctw-menu-hide', !isCards);
            }
        });

        // Label do botão no dropdown
        var lbl = document.getElementById('style20MenuLabel');
        var sub = document.getElementById('style20MenuSub');
        if (lbl) lbl.textContent = isCards ? 'Voltar ao estilo clássico' : 'Testar novo estilo 2.0';
        if (sub) sub.textContent = isCards ? 'Layout em lista original'  : 'Novo layout visual';
    }

    // Vincula os botões duplicados do v2 aos IDs originais
    function wireV2Buttons() {
        var map = {
            'goToCalculator2':        'goToCalculator',
            'goToRepairs2':           'goToRepairs',
            'goToContract2':          'goToContract',
            'goToStock2':             'goToStock',
            'goToAdmin2':             'goToAdmin',
            'openFecharVenda2':       'openFecharVenda',
            'openRepassarValores2':   'openRepassarValores',
            'openEmprestarValores2':  'openEmprestarValores',
            'openCalcularEmprestimo2':'openCalcularEmprestimo',
            'openCalcularPorAparelho2':'openCalcularPorAparelho',
            'openContratoView2':      'openContratoView',
            'openBookipView2':        'openBookipView',
            'openReciboView2':        null, // usa onclick direto
        };

        Object.keys(map).forEach(function(v2Id) {
            var btn = document.getElementById(v2Id);
            if (!btn) return;
            var targetId = map[v2Id];
            if (targetId) {
                btn.addEventListener('click', function() {
                    var orig = document.getElementById(targetId);
                    if (orig) orig.click();
                });
            } else if (v2Id === 'openReciboView2') {
                btn.addEventListener('click', function() {
                    if (typeof window.abrirReciboSimples === 'function') window.abrirReciboSimples();
                });
            }
        });
    }

    // Ativa/desativa com tela de loading
    window.ativarEstilo20 = function() {
        var next = isV2() ? 'classic' : 'v2';

        // Fecha o dropdown do perfil
        var dropdowns = document.querySelectorAll('.dropdown-menu.show');
        dropdowns.forEach(function(d) { d.classList.remove('show'); });

        // Mostra boot overlay
        var overlay = document.getElementById('loadingOverlay');
        var bootMsg = document.getElementById('bootMsg');
        if (overlay) {
            if (bootMsg) bootMsg.textContent = next === 'v2' ? '✨ Ativando Estilo 2.0...' : '↩️ Voltando ao estilo clássico...';
            overlay.style.opacity = '0';
            overlay.style.display = 'flex';
            overlay.style.transition = 'opacity 0.2s';
            void overlay.offsetHeight;
            overlay.style.opacity = '1';
        }

        setTimeout(function() {
            // Salva preferência
            localStorage.setItem(STYLE_KEY, next);
            // Limpa cache de navegação para evitar conflitos
            try { localStorage.removeItem('ctwLastSection'); } catch(e) {}

            // Aplica
            applyMenuStyle(next);

            // Mostra/oculta bottom nav
            if (typeof window.setCtwNavVisible === 'function') window.setCtwNavVisible(next === 'v2');

            // Volta para o menu principal
            if (typeof showMainSection === 'function') showMainSection('main');

            // Esconde overlay
            if (overlay) {
                overlay.style.opacity = '0';
                setTimeout(function() {
                    overlay.style.display = 'none';
                    overlay.style.transition = '';
                    overlay.style.opacity = '';
                }, 300);
            }
        }, 1100);
    };

    // Boot: aplica sem animação
    function init() {
        wireV2Buttons();
        applyMenuStyle(isV2() ? 'v2' : 'classic');
    }

    // Executa assim que DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Re-aplica depois do auth (showMainSection pode re-renderizar o menu)
    window._reapplyMenuStyle = function() {
        applyMenuStyle(isV2() ? 'v2' : 'classic');
    };
})();



// → Movido para bookip.js: comprimirFotoBookip, uploadFotoCloudinary, initBookipPhoto

// ============================================================
// BUSCA GLOBAL
// ============================================================
(function() {
    var _bookipsCache = [];
    var _boletosCache = [];
    var _repairsCache = [];
    var _activeFilter = 'all';

    function setupCaches() {
        if (typeof db === 'undefined' || typeof onValue === 'undefined') {
            setTimeout(setupCaches, 800);
            return;
        }
        onValue(ref(db, 'bookips'), function(snap) {
            if (snap.exists()) {
                _bookipsCache = Object.entries(snap.val()).map(function(e) {
                    return Object.assign({ id: e[0] }, e[1]);
                });
            }
        });
        onValue(ref(db, 'boletos'), function(snap) {
            if (snap.exists()) {
                _boletosCache = Object.entries(snap.val()).map(function(e) {
                    return Object.assign({ id: e[0] }, e[1]);
                });
            }
        });
        onValue(ref(db, 'manutencao'), function(snap) {
            if (snap.exists()) {
                _repairsCache = Object.entries(snap.val()).map(function(e) {
                    return Object.assign({ id: e[0] }, e[1]);
                });
            } else {
                _repairsCache = [];
            }
        });
    }

    function norm(s) {
        return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function hl(text, q) {
        if (!q || !text) return text || '';
        var esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return text.replace(new RegExp('(' + esc + ')', 'gi'), '<span class="gs-hl">$1</span>');
    }

    function search(q) {
        var nq = norm(q);
        if (nq.length < 2) return [];
        var results = [];
        var af = _activeFilter;

        if (af === 'all' || af === 'cliente') {
            (window.dbClientsCache || []).forEach(function(c) {
                if (norm([c.nome, c.cpf, c.tel, c.email].join(' ')).indexOf(nq) >= 0) {
                    results.push({ type: 'cliente', id: c.id, title: c.nome || 'Sem nome', sub: [c.tel, c.cpf].filter(Boolean).join(' - '), data: c });
                }
            });
        }
        if (af === 'all' || af === 'bookip') {
            _bookipsCache.forEach(function(b) {
                var prods = (b.items || []).map(function(i) { return i.nome; }).join(' ');
                if (norm([b.nome, b.cpf, b.tel, prods].join(' ')).indexOf(nq) >= 0) {
                    results.push({ type: 'bookip', id: b.id, title: b.nome || 'Sem nome', sub: prods || b.dataVenda || '', data: b });
                }
            });
        }
        if (af === 'all' || af === 'boleto') {
            _boletosCache.forEach(function(b) {
                if (norm([b.compradorNome, b.compradorCpf, b.compradorTelefone, b.produtoModelo, b.produtoImei].join(' ')).indexOf(nq) >= 0) {
                    results.push({ type: 'boleto', id: b.id, title: b.compradorNome || 'Sem nome', sub: [b.produtoModelo, b.produtoImei].filter(Boolean).join(' - ') || (b.numeroParcelas ? b.numeroParcelas + ' parcelas' : ''), data: b });
                }
            });
        }
        if (af === 'all' || af === 'conserto') {
            _repairsCache.forEach(function(r) {
                if (norm([r.nomeCliente, r.descricaoDefeito, r.numeroCliente].join(' ')).indexOf(nq) >= 0) {
                    var statusLabels = { loja_sem_analise: 'Levar ao Técnico', em_reparo: 'Em Reparo', loja_reparado: 'Finalizado Loja', finalizado: 'Entregue' };
                    results.push({ type: 'conserto', id: r.id, title: r.nomeCliente || 'Sem nome', sub: (r.descricaoDefeito || '') + (r.status ? ' · ' + (statusLabels[r.status] || r.status) : ''), data: r });
                }
            });
        }
        return results.slice(0, 30);
    }

    function renderResults(results, q) {
        var cont = document.getElementById('gsResults');
        var stat = document.getElementById('gsStatus');
        if (!cont) return;
        if (!results.length) {
            stat.textContent = 'Nenhum resultado';
            cont.innerHTML = '<div class="gs-empty">Nada encontrado para "' + q + '"</div>';
            return;
        }
        stat.textContent = results.length + (results.length > 1 ? ' resultados' : ' resultado');
        var icons = { cliente: '&#128101;', bookip: '&#128210;', boleto: '&#128203;' , conserto: '🔧' };
        var tags = { cliente: 'Cliente', bookip: 'Bookip', boleto: 'Contrato' };
        cont.innerHTML = results.map(function(r) {
            return '<div class="gs-card" data-type="' + r.type + '" data-id="' + r.id + '">' +
                '<div class="gs-card-icon gs-ic-' + r.type + '">' + icons[r.type] + '</div>' +
                '<div class="gs-card-body"><div class="gs-card-title">' + hl(r.title, q) + '</div>' +
                (r.sub ? '<div class="gs-card-sub">' + r.sub + '</div>' : '') + '</div>' +
                '<span class="gs-card-tag gs-tag-' + r.type + '">' + tags[r.type] + '</span></div>';
        }).join('');
        cont.querySelectorAll('.gs-card').forEach(function(card) {
            card.addEventListener('click', function() {
                fechar();
                setTimeout(function() { navigate(card.dataset.type, card.dataset.id); }, 280);
            });
        });
    }

    // Helper: mostra/esconde overlay Sherlock
    function gsNavShow(msg) {
        var ov = document.getElementById('gsNavOverlay');
        if (!ov) return;
        var msgEl = document.getElementById('gsNavMsg');
        if (msgEl) msgEl.textContent = msg || 'Encontrando...';
        ov.style.display = 'flex';
    }
    function gsNavHide() {
        var ov = document.getElementById('gsNavOverlay');
        if (ov) { ov.style.opacity = '0'; ov.style.transition = 'opacity 0.3s'; setTimeout(function() { ov.style.display = 'none'; ov.style.opacity = '1'; ov.style.transition = ''; }, 320); }
    }

    function navigate(type, id) {

        // Aplica glow no elemento encontrado
        function applyGlow(el) {
            if (!el) return;
            el.classList.remove('gs-result-highlight');
            void el.offsetWidth;
            el.classList.add('gs-result-highlight');
            setTimeout(function() { el.classList.remove('gs-result-highlight'); }, 5500);
        }

        if (type === 'cliente') {
            gsNavShow('Abrindo cliente...');
            if (typeof window.showMainSection === 'function') window.showMainSection('clients');
            setTimeout(function() {
                if (typeof window.editarCliente === 'function') window.editarCliente(id);
                gsNavHide();
            }, 500);

        } else if (type === 'conserto') {
            gsNavShow('Abrindo conserto...');
            if (typeof window.showMainSection === 'function') window.showMainSection('repairs');
            setTimeout(function() {
                gsNavHide();
                // Scroll to repair card if visible
                var card = document.querySelector('[data-rep-id="' + id + '"]');
                if (card) {
                    card.closest('.rep-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 600);
        } else if (type === 'bookip') {
            gsNavShow('Encontrando garantia...');
            if (typeof window.showMainSection === 'function') window.showMainSection('contract');
            setTimeout(function() {
                if (typeof window.openDocumentsSection === 'function') window.openDocumentsSection('bookip');
                var t = document.getElementById('bookipModeToggle');
                if (t && !t.checked) { t.checked = true; t.dispatchEvent(new Event('change')); }

                // Aguarda histórico carregar, depois supera "Ver Mais" se necessário
                var attempts = 0;
                function tryFind() {
                    attempts++;
                    // Tenta suplantar barreira do ver mais
                    if (typeof window._bookipNavigateTo === 'function') {
                        window._bookipNavigateTo(id);
                    }
                    var collapseEl = document.getElementById('collapse-bk-' + id);
                    if (collapseEl) {
                        if (window.bootstrap) {
                            bootstrap.Collapse.getOrCreateInstance(collapseEl, { toggle: false }).show();
                            collapseEl.addEventListener('shown.bs.collapse', function() {
                                collapseEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                setTimeout(function() { applyGlow(collapseEl.closest('.accordion-item') || collapseEl); }, 200);
                            }, { once: true });
                        } else {
                            collapseEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            applyGlow(collapseEl);
                        }
                        gsNavHide();
                    } else if (attempts < 12) {
                        setTimeout(tryFind, 300);
                    } else {
                        gsNavHide();
                    }
                }
                setTimeout(tryFind, 500);
            }, 300);

        } else if (type === 'boleto') {
            gsNavShow('Encontrando contrato...');
            if (typeof window.showMainSection === 'function') window.showMainSection('contract');
            setTimeout(function() {
                if (typeof window.openDocumentsSection === 'function') window.openDocumentsSection('contrato');
                var t = document.getElementById('boletoModeToggle');
                if (t && !t.checked) { t.checked = true; t.dispatchEvent(new Event('change')); }

                var attempts = 0;
                function tryFindBoleto() {
                    attempts++;
                    var heading = document.getElementById('heading-' + id);
                    var btn = heading ? heading.querySelector('button') : null;
                    if (btn && window.bootstrap) {
                        var target = btn.getAttribute('data-bs-target');
                        if (target) {
                            var el = document.querySelector(target);
                            if (el) {
                                bootstrap.Collapse.getOrCreateInstance(el, { toggle: false }).show();
                                el.addEventListener('shown.bs.collapse', function() {
                                    heading.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    setTimeout(function() { applyGlow(heading.closest('.accordion-item') || heading); }, 200);
                                }, { once: true });
                                gsNavHide();
                                return;
                            }
                        }
                    }
                    if (attempts < 12) {
                        setTimeout(tryFindBoleto, 300);
                    } else {
                        if (typeof window.verBoletoDeNotificacao === 'function') window.verBoletoDeNotificacao(id);
                        gsNavHide();
                    }
                }
                setTimeout(tryFindBoleto, 500);
            }, 300);
        }
    }

    // Expõe navigate para uso externo (notificações, etc.)
    window._ctwNavigate = navigate;

    function abrir() {
        var o = document.getElementById('gsOverlay');
        var i = document.getElementById('gsInput');
        if (!o) return;
        o.classList.remove('gs-hidden');
        setTimeout(function() { if (i) i.focus(); }, 150);
        setupCaches();
    }

    function fechar() {
        var o = document.getElementById('gsOverlay');
        if (!o) return;
        o.classList.add('gs-hidden');
        ['gsInput','gsResults','gsStatus','gsClearBtn'].forEach(function(id) {
            var el = document.getElementById(id);
            if (!el) return;
            if (id === 'gsInput') el.value = '';
            else if (id === 'gsResults') el.innerHTML = '';
            else if (id === 'gsStatus') el.textContent = 'Digite para buscar';
            else if (id === 'gsClearBtn') el.classList.add('gs-hidden');
        });
    }

    function init() {
        var btn = document.getElementById('globalSearchBtn');
        var input = document.getElementById('gsInput');
        if (btn) btn.addEventListener('click', abrir);
        var cancel = document.getElementById('gsCancelBtn');
        if (cancel) cancel.addEventListener('click', fechar);
        var bd = document.getElementById('gsBackdrop');
        if (bd) bd.addEventListener('click', fechar);
        var clearBtn = document.getElementById('gsClearBtn');
        if (clearBtn) clearBtn.addEventListener('click', function() {
            if (input) { input.value = ''; input.focus(); }
            clearBtn.classList.add('gs-hidden');
            var r = document.getElementById('gsResults'); if (r) r.innerHTML = '';
            var s = document.getElementById('gsStatus'); if (s) s.textContent = 'Digite para buscar';
        });

        document.querySelectorAll('.gs-filter').forEach(function(f) {
            f.addEventListener('click', function() {
                document.querySelectorAll('.gs-filter').forEach(function(x) { x.classList.remove('active'); });
                f.classList.add('active');
                _activeFilter = f.dataset.filter;
                var q = input ? input.value.trim() : '';
                if (q.length >= 2) renderResults(search(q), q);
            });
        });

        if (input) {
            var timer;
            input.addEventListener('input', function() {
                var q = input.value.trim();
                var cb = document.getElementById('gsClearBtn');
                if (cb) cb.classList.toggle('gs-hidden', !q);
                clearTimeout(timer);
                var s = document.getElementById('gsStatus');
                var r = document.getElementById('gsResults');
                if (q.length < 2) {
                    if (r) r.innerHTML = '';
                    if (s) s.textContent = q.length === 1 ? 'Continue digitando...' : 'Digite para buscar';
                    return;
                }
                if (s) s.textContent = 'Buscando...';
                timer = setTimeout(function() { renderResults(search(q), q); }, 280);
            });
        }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') { var o = document.getElementById('gsOverlay'); if (o && !o.classList.contains('gs-hidden')) fechar(); }
        });
    }

    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();


// ============================================================
// BOTTOM NAV — Estilo 2.0
// ============================================================
(function() {
    function isV2() { return localStorage.getItem('ctwMenuStyle') === 'v2'; }

    // Sincroniza o badge do sino com as notificações existentes
    function syncNavBadge() {
        var badge   = document.getElementById('ctwNavBellBadge');
        var notifs  = window._currentNotifications || [];
        var oldBadgeHidden = document.querySelector('#notification-bell .notification-badge')?.classList.contains('hidden');
        var count = notifs.length;
        if (!badge) return;
        if (count > 0 && !oldBadgeHidden) {
            badge.textContent = count > 9 ? '9+' : count;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }

    // Atualiza nome no sheet
    function syncSheetProfile() {
        var nameEl  = document.getElementById('ctwSheetProfileName');
        var navLbl  = document.getElementById('ctwNavProfileLabel');
        var headEl  = document.getElementById('ctwTopHeaderName');
        var name    = localStorage.getItem('ctwUserProfile') || 'visitante';
        if (nameEl)  nameEl.textContent  = name;
        if (navLbl)  navLbl.textContent  = name.split(' ')[0];
        if (headEl)  headEl.textContent  = name;

        // ── Avatar: busca URL diretamente sem depender de _loadAvatar ──
        var img  = document.getElementById('avatarPhotoImg');
        var icon = document.getElementById('avatarPhotoIcon');
        if (img) {
            // 1. Firebase (teamProfilesList)
            var avatarUrl = null;
            var lista = window.teamProfilesList || {};
            for (var id in lista) {
                if ((lista[id].name || '').toLowerCase() === name.toLowerCase()) {
                    avatarUrl = lista[id].avatarUrl || null;
                    break;
                }
            }
            // 2. localStorage (cache)
            if (!avatarUrl) {
                avatarUrl = localStorage.getItem('ctwAvatar_' + name.toLowerCase().replace(/\s+/g, '_')) || null;
            }
            // Aplicar
            if (avatarUrl) {
                img.src = avatarUrl;
                img.style.display = 'block';
                if (icon) icon.style.display = 'none';
            } else {
                img.style.display = 'none';
                if (icon) icon.style.display = '';
            }
        }
    }

    // Atualiza label do botão de estilo no sheet
    function syncSheetStyleLabel() {
        var lbl = document.getElementById('ctwSheetStyleLabel');
        var sub = document.getElementById('ctwSheetStyleSub');
        var v2  = isV2();
        if (lbl) lbl.textContent = v2 ? 'Voltar ao estilo clássico' : 'Ativar estilo 2.0';
        if (sub) sub.textContent = v2 ? 'Layout em lista original' : 'Novo layout visual';
    }

    // Marca botão ativo conforme seção atual
    function setNavActive(btnId) {
        document.querySelectorAll('.ctw-nav-btn').forEach(function(b) {
            b.classList.remove('ctw-nav-active');
        });
        var btn = document.getElementById(btnId);
        if (btn) btn.classList.add('ctw-nav-active');
    }

    // Mostra/oculta a barra
    window.setCtwNavVisible = function(visible) {
        var nav    = document.getElementById('ctwBottomNav');
        var topBar = document.getElementById('ctwTopBar');
        if (!nav) return;
        if (visible) {
            nav.classList.remove('ctw-menu-hide');
            if (topBar) topBar.style.display = 'block';
        } else {
            nav.classList.add('ctw-menu-hide');
            if (topBar) topBar.style.display = 'none';
        }
        // Aplica padding e esconde elementos duplicados do topo
        document.body.classList.toggle('ctw-v2-active', visible);
    };

    // Expõe syncSheetProfile para acesso externo
    window.syncSheetProfile = syncSheetProfile;

    // Abre profile sheet
    window.openCtwSheet = function() {
        var sheet = document.getElementById('ctwProfileSheet');
        if (!sheet) return;
        syncSheetProfile();
        syncSheetStyleLabel();
        sheet.style.display = 'flex';
        sheet.style.alignItems = 'flex-end';
        void sheet.offsetHeight;
        sheet.classList.add('ctw-sheet-open');
        sheet.addEventListener('click', function onBdClick(e) {
            if (e.target === sheet) { window.closeCtwSheet(); }
            sheet.removeEventListener('click', onBdClick);
        });
    };

    // Fecha profile sheet
    window.closeCtwSheet = function() {
        var sheet = document.getElementById('ctwProfileSheet');
        if (!sheet) return;
        sheet.classList.remove('ctw-sheet-open');
        setTimeout(function() { sheet.style.display = 'none'; }, 280);
    };

    var _navInitialized = false; // guard: listeners só registrados UMA vez

    function initBottomNav() {
        if (!isV2()) return; // só ativa em v2

        // Mostra a barra (sempre, mesmo se já inicializado)
        window.setCtwNavVisible(true);

        // Listeners só registrados uma vez — evita N disparos no sino
        if (_navInitialized) return;
        _navInitialized = true;

        // Top pill busca → dispara o mesmo globalSearchBtn
        var topSearch = document.getElementById('ctwTopSearchBtn');
        if (topSearch) {
            topSearch.addEventListener('click', function() {
                var gsBtn = document.getElementById('globalSearchBtn');
                if (gsBtn) gsBtn.click();
            });
        }

        // Botão HOME
        var homeBtn = document.getElementById('ctwNavHome');
        if (homeBtn) {
            homeBtn.addEventListener('click', function() {
                setNavActive('ctwNavHome');
                if (typeof showMainSection === 'function') showMainSection('main');
                else if (typeof window.showMainSection === 'function') window.showMainSection('main');
            });
        }

        // Botão SINO — lógica simples sem guard que bloqueava o re-abrir
        var bellBtn = document.getElementById('ctwNavBell');
        if (bellBtn) {
            bellBtn.addEventListener('click', function() {
                syncNavBadge();
                if (typeof window.toggleNotifBalloons === 'function') {
                    window.toggleNotifBalloons();
                }
            });
        }

        // Botão PERFIL
        var profileBtn = document.getElementById('ctwNavProfile');
        if (profileBtn) {
            profileBtn.addEventListener('click', function() {
                setNavActive('ctwNavProfile');
                window.openCtwSheet();
            });
        }

        // Sincroniza badge quando notificações mudam
        var origUpdate = window.updateNotificationUI;
        if (typeof origUpdate === 'function') {
            window.updateNotificationUI = function(notifications) {
                origUpdate(notifications);
                setTimeout(syncNavBadge, 50);
            };
        }

        // Sincroniza badge na inicialização
        syncNavBadge();
        syncSheetProfile();

        // Marca home como ativo por padrão
        setNavActive('ctwNavHome');
    }

    // Helper: remove container órfão de balões do sino
    function limparBaloes() {
        var c = document.getElementById('notif-balloons-container');
        if (c) {
            // Remove imediatamente sem animação (usuário já saiu da tela)
            try { c.remove(); } catch(e) {}
        }
    }

    // Intercepta showMainSection para atualizar botão ativo, top bar e limpar balões
    var _origShow = window.showMainSection;
    window.showMainSection = function(sectionId) {
        // Sempre limpa balões ao navegar (evita container órfão no DOM)
        limparBaloes();

        if (typeof _origShow === 'function') _origShow(sectionId);
        if (!isV2()) return;

        var topBar = document.getElementById('ctwTopBar');
        if (sectionId === 'main') {
            setNavActive('ctwNavHome');
            if (topBar) topBar.style.display = 'block';
        } else {
            setNavActive('');
            if (topBar) topBar.style.display = 'none';
        }
    };

    // Expõe re-aplicação para quando o estilo muda
    var _origReapply = window._reapplyMenuStyle;
    window._reapplyMenuStyle = function() {
        if (typeof _origReapply === 'function') _origReapply();
        var v2 = isV2();
        window.setCtwNavVisible(v2);
        if (v2) {
            initBottomNav();
            setNavActive('ctwNavHome');
        }
    };

    // Init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initBottomNav);
    } else {
        initBottomNav();
    }
})();

// ============================================================
// PROMO BANNER — Sugestão de migrar para o Layout 2.0
// Lógica:
//   · Sem registro  → aparece imediatamente (novo deploy / primeira vez)
//   · "Sim"         → ativa v2, grava 'accepted', nunca mais aparece
//   · "Não" (1ª vez)→ aguarda 3 dias
//   · "Não" (2ª vez+)→ aguarda 4 dias (ciclo fixo)
// ============================================================
(function() {
    var PROMO_STATUS_KEY  = 'ctwV2PromoStatus';   // 'accepted' | ausente
    var PROMO_NEXT_KEY    = 'ctwV2PromoNext';      // timestamp ms | ausente
    var PROMO_REFUSALS_KEY = 'ctwV2PromoRefusals'; // número inteiro

    var DELAY_FIRST = 3 * 24 * 60 * 60 * 1000;  // 3 dias em ms
    var DELAY_LOOP  = 4 * 24 * 60 * 60 * 1000;  // 4 dias em ms

    function isV2Active() {
        return localStorage.getItem('ctwMenuStyle') === 'v2';
    }

    function shouldShow() {
        if (isV2Active())                                          return false;
        if (localStorage.getItem(PROMO_STATUS_KEY) === 'accepted') return false;

        var next = localStorage.getItem(PROMO_NEXT_KEY);
        if (!next) return true;                    // sem registro = mostra agora
        return Date.now() >= parseInt(next, 10);   // passou do prazo?
    }

    function showBanner() {
        var banner = document.getElementById('v2PromoBanner');
        if (!banner) return;
        banner.style.display = 'flex';

        var btnYes = document.getElementById('v2PromoBtnYes');
        var btnNo  = document.getElementById('v2PromoBtnNo');

        function closeBanner() {
            banner.style.animation = 'v2PromoFadeIn .25s ease reverse forwards';
            setTimeout(function() { banner.style.display = 'none'; banner.style.animation = ''; }, 260);
        }

        if (btnYes) {
            btnYes.onclick = function() {
                closeBanner();
                // Marca como aceito
                localStorage.setItem(PROMO_STATUS_KEY, 'accepted');
                // Ativa layout 2.0 (usa a mesma função do app)
                setTimeout(function() {
                    if (typeof window.ativarEstilo20 === 'function') {
                        // ativarEstilo20 é um toggle — garante que estamos ativando, não desativando
                        if (!isV2Active()) window.ativarEstilo20();
                    }
                }, 300);
            };
        }

        if (btnNo) {
            btnNo.onclick = function() {
                closeBanner();
                var refusals = parseInt(localStorage.getItem(PROMO_REFUSALS_KEY) || '0', 10);
                refusals += 1;
                localStorage.setItem(PROMO_REFUSALS_KEY, String(refusals));
                var delay = refusals === 1 ? DELAY_FIRST : DELAY_LOOP;
                localStorage.setItem(PROMO_NEXT_KEY, String(Date.now() + delay));
            };
        }

        // Toque no fundo escuro = mesmo que "Não"
        banner.addEventListener('click', function(e) {
            if (e.target === banner && btnNo) btnNo.click();
        }, { once: true });
    }

    // Aguarda um tick depois do login para não conflitar com animações do app
    var _origConfirmed = window.setProfileConfirmed;
    window.setProfileConfirmed = function(name) {
        if (typeof _origConfirmed === 'function') _origConfirmed(name);
        setTimeout(function() {
            if (shouldShow()) showBanner();
        }, 900); // pequeno delay para o usuário ver a tela principal primeiro
    };
})();
