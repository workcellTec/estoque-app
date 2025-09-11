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
let products = [], fuse;
let onlyShowIgnored = false;
// ... (e todas as outras variáveis globais que você já tinha)

// --- FUNÇÕES ---
// ... (Todas as suas funções de Lógica, Cálculo, UI, Firebase, etc., que estavam no HTML original vão aqui) ...

// --- LÓGICA DE ESTOQUE ---
function filterStockProducts() {
    const searchTerm = document.getElementById('stockSearchInput').value;
    
    let baseList;
    if (onlyShowIgnored) {
        baseList = products.filter(p => p.ignorarContagem);
    } else {
        baseList = products.filter(p => !p.ignorarContagem);
    }
    
    // Ordena a lista base alfabeticamente
    baseList.sort((a, b) => a.nome.localeCompare(b.nome));

    const fuseInstance = new Fuse(baseList, { keys: ['nome'], threshold: 0.4 });
    const filtered = !searchTerm ? baseList : fuseInstance.search(searchTerm).map(r => r.item);

    renderStockList(filtered);
}

function renderStockList(list) {
    const container = document.getElementById('stockTableBody');
    if (!container) return;
    
    // A lista já vem pré-ordenada por nome. Agora aplicamos a ordenação por 'checked'
    const sortedList = [...list].sort((a, b) => {
        const aIsChecked = checkedItems[a.id]?.checked || false;
        const bIsChecked = checkedItems[b.id]?.checked || false;
        if (aIsChecked !== bIsChecked) return aIsChecked ? 1 : -1;
        return 0; // Mantém a ordem alfabética se o status 'checked' for igual
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

// --- EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
    // ... (todos os seus event listeners)
    
    // Listener do Botão de Ignorados
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

    // Listener para os cliques nos cards de estoque
    const stockListContainer = document.getElementById('stockTableBody');
    if (stockListContainer) {
        stockListContainer.addEventListener('click', e => {
            const ignoreBtn = e.target.closest('.ignore-toggle-btn');
            if (ignoreBtn) {
                const id = ignoreBtn.dataset.id;
                const product = products.find(p => p.id === id);
                if (product) {
                    const newIgnoredState = !product.ignorarContagem;
                    updateProductInDB(id, { ignorarContagem: newIgnoredState });
                }
            }
            // ... (outros listeners de clique que já estavam aqui)
        });
        
        // ... (listeners de 'change' que já estavam aqui)
    }

    main();
});