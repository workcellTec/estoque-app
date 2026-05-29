import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getDatabase, ref, set, get, push, update, remove, onValue }
    from "https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signInAnonymously, onAuthStateChanged, signOut }
    from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";

// AMÉRICACell — Firebase Project: vortexcell-america
const firebaseConfig = {
    apiKey:            "AIzaSyBMo_Z5rhnBJYcKcaYeNvGFOwGrG8tnMWc",
    authDomain:        "vortexcell-america.firebaseapp.com",
    databaseURL:       "https://vortexcell-america-default-rtdb.firebaseio.com",
    projectId:         "vortexcell-america",
    storageBucket:     "vortexcell-america.firebasestorage.app",
    messagingSenderId: "129201935282",
    appId:             "1:129201935282:web:b97af4b3ce3768e9698aab"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getDatabase(app);

window._firebaseDB = db;

// Expõe as funções do Firebase Database diretamente via window
// Isso evita problemas de cache duplo entre static import (module) e dynamic import (script normal)
window._firebaseFn = { ref, set, get, push, update, remove, onValue };

let _readyDispatched = false;

onAuthStateChanged(auth, (user) => {
    if (user && !_readyDispatched) {
        _readyDispatched = true;
        window._firebaseAuthJaDisparou = true;
        console.log('[Firebase] Auth pronta, uid:', user.uid);
        window.dispatchEvent(new Event('firebaseReady'));
    }
});

// Inicia login anônimo — onAuthStateChanged acima reage quando concluído
signInAnonymously(auth).catch(error => {
    console.error('[Firebase] Erro na auth anônima:', error);
    // Dispara mesmo assim para não travar o app
    if (!_readyDispatched) {
        _readyDispatched = true;
        window.dispatchEvent(new Event('firebaseReady'));
    }
});

window._firebaseLogin = (email, pass) =>
    signInWithEmailAndPassword(auth, email, pass)
        .catch(error => { alert("Falha no login: " + error.message); });

window._firebaseLogout = () =>
    signOut(auth).catch(error => console.error("Erro ao sair:", error));
