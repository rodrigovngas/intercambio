// --- ICONOS & HELPERS UI ---
const openEyePaths = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
const closedEyePaths = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle><line x1="1" y1="1" x2="23" y2="23"></line>';
const sunIcon = '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
const moonIcon = '<svg class="icon" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

// Inicializar iconos de contraseña
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

window.makeLinksClickable = (text) => {
    if (!text) return ""; const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, (url) => `<a href="${url}" target="_blank">${url}</a>`);
};

// --- TOAST ---
window.showToast = (message, duration = 3000) => {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast'; el.innerText = message;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, duration);
};

// --- MODALES (Confirmación & Cierre General) ---
let pendingConfirmAction = null;

window.openConfirmModal = (title, message, callback) => {
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-desc').innerText = message;
    pendingConfirmAction = callback;
    document.getElementById('confirm-modal').classList.remove('hidden');
};
window.closeConfirmModal = () => { document.getElementById('confirm-modal').classList.add('hidden'); pendingConfirmAction = null; };
window.executeConfirm = () => { if (pendingConfirmAction) pendingConfirmAction(); closeConfirmModal(); };

window.closeModal = () => {
    const modal = document.getElementById('auth-modal');
    modal.classList.add('modal-closing');
    setTimeout(() => {
        modal.classList.add('hidden');       
        modal.classList.remove('modal-closing'); 
    }, 250);
};

// --- ANIMACIONES & CONFETTI (Reveal) ---
window.revealName = () => {
    const overlay = document.getElementById('reveal-overlay');
    overlay.classList.add('faded');
    confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
    if(currentUserId) {
        // Nota: currentUserId debe ser accesible globalmente o importado
        updateDoc(doc(db, `events/${eventId}/participants/${currentUserId}`), { revealed: true });
        const p = linkedProfiles.find(x => x.id === currentUserId);
        if(p) p.revealed = true;
    }
};

// --- TEMA & UI VISUAL (Dark Mode / Safari) ---
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
const btn = document.getElementById('btn-dark-mode');
const metaTheme = document.getElementById('theme-color-meta');

function applyTheme(isDark) {
  document.body.classList.toggle('dark-mode', isDark);

  if (btn) {
    btn.innerHTML = isDark ? sunIcon : moonIcon;
    btn.style.color = getComputedStyle(document.documentElement)
      .getPropertyValue(isDark ? '--text-main' : '--text-sec');

    btn.classList.remove('spin-anim');
    void btn.offsetWidth;
    btn.classList.add('spin-anim');
  }

  if (metaTheme) {
    metaTheme.setAttribute('content', isDark ? '#000000' : '#ffffff');
  }
}

window.toggleDarkMode = () => {
  const isDark = document.body.classList.contains('dark-mode');
  applyTheme(!isDark);
};

if (mediaQuery.addEventListener) {
  mediaQuery.addEventListener('change', e => applyTheme(e.matches));
} else {
  mediaQuery.addListener(e => applyTheme(e.matches)); 
}

function updateSafariTheme() {
    const isDark = document.body.classList.contains('dark-mode');
    const metaTheme = document.getElementById('theme-color-meta');
    const appleBlack = '#000000'; 
    const appleWhite = '#ffffff'; 
    const appleGray  = '#f3f4f6';

    const colorTop = isDark ? appleBlack : appleWhite;
    const colorBottom = isDark ? appleBlack : appleGray;

    if (metaTheme) metaTheme.setAttribute('content', colorTop);
    document.documentElement.style.backgroundColor = colorBottom;
}

const observer = new MutationObserver(() => updateSafariTheme());
observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

// Ejecución inmediata al cargar UI
applyTheme(mediaQuery.matches);
updateSafariTheme();
// Si existiera el elemento toast para inicializar clase success:
// toast.classList.add('success'); // (Línea suelta original del final)

// --- COMPARTIR & QR ---
window.shareEvent = async () => {
    const link = document.getElementById('share-link-text').innerText;
    if (navigator.share) {
        try {
            await navigator.share({
                title: 'Invitación al intercambio',
                text: 'Únete a este intercambio 🎁',
                url: link
            });
        } catch (err) { }
    } else {
        navigator.clipboard.writeText(link);
        showToast("Enlace copiado");
    }
};

window.copyLink = () => { navigator.clipboard.writeText(document.getElementById('share-link-text').innerText).then(()=>showToast("Enlace copiado")); };

window.renderShareInfo = (link) => {
    document.getElementById('share-link-text').innerText = link;
    const qrImg = document.getElementById('qr-invite');
    const encodedLink = encodeURIComponent(link);
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodedLink}`;
};