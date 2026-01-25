const MASTER_KEY = "admin123"; 
let pendingAdminCallback = null;

async function hashString(str) {
    if(!str) return null;
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isValidPIN(pin) { return /^\d{6}$/.test(pin); }

// --- LÓGICA DEL PIN (TECLADO) ---
window.addPinDigit = (digit, type) => {
    const inputId = type === 'reg' ? 'reg-pin' : 'login-pin';
    const dotsId = type === 'reg' ? 'dots-reg' : 'dots-login';
    const input = document.getElementById(inputId);
    let val = input.value;
    
    if(val.length >= 6) return;
    
    val += digit;
    input.value = val;
    updatePinDots(val.length, dotsId);

    if(type === 'login' && val.length === 6) {
        setTimeout(() => {
            doLogin();
        }, 100); 
    }
};

window.backspacePin = (type) => {
    const inputId = type === 'reg' ? 'reg-pin' : 'login-pin';
    const dotsId = type === 'reg' ? 'dots-reg' : 'dots-login';
    const input = document.getElementById(inputId);
    let val = input.value;
    if(val.length > 0) {
        val = val.slice(0, -1);
        input.value = val;
        updatePinDots(val.length, dotsId);
    }
};

function updatePinDots(count, containerId) {
    const container = document.getElementById(containerId);
    const dots = container.querySelectorAll('.pin-dot');
    dots.forEach((dot, idx) => {
        if(idx < count) dot.classList.add('filled');
        else dot.classList.remove('filled');
    });
}

// --- LOGIN & REGISTRO ---
window.prepareAuth = async (id, data) => {
    selectedUserDoc = { id, data }; // Variable global definida en main.js
    const m = document.getElementById('auth-modal');
    document.getElementById('form-register').classList.add('hidden'); 
    document.getElementById('form-login').classList.add('hidden'); 
    document.getElementById('admin-override-box').classList.add('hidden'); 
    document.getElementById('claim-children-section').classList.add('hidden'); 
    
    ['reg-pin', 'login-pin'].forEach(pid => document.getElementById(pid).value = '');
    document.querySelectorAll('.pin-dot').forEach(d => d.classList.remove('filled'));

    m.classList.remove('hidden'); 
    document.getElementById('modal-title').innerText = `Hola, ${data.name}`;

    if(!data.password) {
        document.getElementById('form-register').classList.remove('hidden');
        const listDiv = document.getElementById('children-list-check'); 
        const section = document.getElementById('claim-children-section');
        listDiv.innerHTML = '<div class="spinner" style="width:20px; height:20px; border-width:2px;"></div>';
        
        const q = await getDocs(collection(db, `events/${eventId}/participants`));
        listDiv.innerHTML = ""; let foundChild = false;
        q.forEach(docSnap => {
            const kid = docSnap.data();
            if(kid.isChild && docSnap.id !== id && !kid.managedBy && !kid.password) {
                foundChild = true;
                const div = document.createElement('div');
                div.innerHTML = `<label style="display:flex; align-items:center; margin:0; text-transform:none; font-weight:500; cursor:pointer;"><input type="checkbox" class="child-claim-checkbox" value="${docSnap.id}"> ${kid.name}</label>`;
                listDiv.appendChild(div);
            }
        });
        if(foundChild && !data.isChild) section.classList.remove('hidden'); 
    } else {
        document.getElementById('form-login').classList.remove('hidden'); 
        document.getElementById('admin-override-box').classList.remove('hidden');
    }
};

window.doRegister = async () => {
    const pin = document.getElementById('reg-pin').value; 
    if(!isValidPIN(pin)) return showToast("El PIN debe ser de 6 números.");
    const btn = document.querySelector('#form-register .btn-accent');
    btn.disabled = true; btn.innerText = "Guardando...";

    try {
        const hPin = await hashString(pin);
        const childrenIds = Array.from(document.querySelectorAll('.child-claim-checkbox:checked')).map(c => c.value);
        const batch = writeBatch(db);
        batch.update(doc(db, `events/${eventId}/participants/${selectedUserDoc.id}`), { password: hPin });
        childrenIds.forEach(kidId => batch.update(doc(db, `events/${eventId}/participants/${kidId}`), { managedBy: selectedUserDoc.id }));
        await batch.commit(); 
        window.closeModal(); 
        selectedUserDoc.data.password = hPin;
        enterDashboard(selectedUserDoc.id, { ...selectedUserDoc.data });
    } catch(e) { showToast("Error al registrar"); } finally { btn.disabled = false; btn.innerText = "Guardar y Entrar"; }
};

window.doLogin = async () => {
    const pinInput = document.getElementById('login-pin').value;
    const container = document.getElementById('dots-login');

    if (pinInput.length < 6) return;

    const hInput = await hashString(pinInput);
    
    if(hInput === selectedUserDoc.data.password) {
        window.closeModal(); 
        enterDashboard(selectedUserDoc.id, selectedUserDoc.data);
    } else {
        if(navigator.vibrate) navigator.vibrate(200); 
        container.classList.add('shake-error');
        setTimeout(() => {
            container.classList.remove('shake-error');
            document.getElementById('login-pin').value = ''; 
            updatePinDots(0, 'dots-login');
        }, 500);
    }
};

// --- ADMIN ---
window.promptForAdmin = (callback) => {
    pendingAdminCallback = callback;
    const m = document.getElementById('admin-modal');
    const input = document.getElementById('admin-input-pass');
    input.value = ''; input.type = 'password'; 
    const btn = input.closest('.password-wrapper').querySelector('.btn-toggle-pass');
    btn.style.color = 'var(--text-sec)';
    m.classList.remove('hidden');
    setTimeout(() => input.focus(), 100);
};

window.closeAdminModal = () => { document.getElementById('admin-modal').classList.add('hidden'); pendingAdminCallback = null; };

window.submitAdminAuth = () => {
    const val = document.getElementById('admin-input-pass').value; 
    const callbackToRun = pendingAdminCallback;
    if(val === MASTER_KEY) {
        closeAdminModal(); 
        if(callbackToRun) callbackToRun();
    } else {
        showToast("Contraseña incorrecta");
        document.getElementById('admin-input-pass').value = '';
    }
};

window.adminOverride = async () => {
    await updateDoc(doc(db, `events/${eventId}/participants/${selectedUserDoc.id}`), { password: null, secretKey: null, managedBy: null, seen: false, revealed: false });
    showToast("Cuenta reseteada"); 
    selectedUserDoc.data.password = null; 
    prepareAuth(selectedUserDoc.id, selectedUserDoc.data);
};