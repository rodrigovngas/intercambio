// --- PIN LOGIC WITH CUSTOM KEYPAD ---
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

// --- GENERIC VISIBILITY TOGGLE (FOR ADMIN PASS) ---
const openEyePaths = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
const closedEyePaths = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle><line x1="1" y1="1" x2="23" y2="23"></line>';

document.querySelectorAll('.btn-toggle-pass svg').forEach(svg => { svg.innerHTML = closedEyePaths; });

window.toggleFieldVisibility = (inputId) => {
    const input = document.getElementById(inputId);
    const btn = input.closest('.password-wrapper').querySelector('.btn-toggle-pass');
    const svg = btn.querySelector('svg');
    if (input.type === "password") {
        input.type = "text";
        btn.style.color = "var(--primary)";
        svg.innerHTML = openEyePaths;
    } else {
        input.type = "password";
        btn.style.color = "var(--text-sec)";
        svg.innerHTML = closedEyePaths;
    }
};

async function hashString(str) {
    if(!str) return null;
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isValidPIN(pin) { return /^\d{6}$/.test(pin); }

window.showToast = (message, duration = 3000) => {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast'; el.innerText = message;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, duration);
};

let pendingConfirmAction = null;
window.openConfirmModal = (title, message, callback) => {
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-desc').innerText = message;
    pendingConfirmAction = callback;
    document.getElementById('confirm-modal').classList.remove('hidden');
};
window.closeConfirmModal = () => { document.getElementById('confirm-modal').classList.add('hidden'); pendingConfirmAction = null; };
window.executeConfirm = () => { if (pendingConfirmAction) pendingConfirmAction(); closeConfirmModal(); };

window.revealName = () => {
    const overlay = document.getElementById('reveal-overlay');
    overlay.classList.add('faded');
    confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
    if(currentUserId) {
        updateDoc(doc(db, `events/${eventId}/participants/${currentUserId}`), { revealed: true });
        const p = linkedProfiles.find(x => x.id === currentUserId);
        if(p) p.revealed = true;
    }
};

function makeLinksClickable(text) {
    if (!text) return ""; const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, (url) => `<a href="${url}" target="_blank">${url}</a>`);
}