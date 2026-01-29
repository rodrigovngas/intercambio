    // ==========================================
    // 1. IMPORTS & CONFIGURACIÓN FIREBASE
    // ==========================================
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
    import { getFirestore, collection, addDoc, doc, getDoc, updateDoc, writeBatch, serverTimestamp, onSnapshot, getDocs, deleteDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

    const firebaseConfig = {
        apiKey: "AIzaSyAsVkuWgNhpC5cIyRem9ArT8QBNpWtSCX0",
        authDomain: "sorteo-f421d.firebaseapp.com",
        projectId: "sorteo-f421d",
        storageBucket: "sorteo-f421d.firebasestorage.app",
        messagingSenderId: "528703807084",
        appId: "1:528703807084:web:f1b84b8ebc5ec94a044249"
    };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    // ==========================================
    // 2. CONSTANTES Y VARIABLES GLOBALES
    // ==========================================
    const MASTER_KEY = "admin123"; 
    const MONTHS_SHORT = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

    // Iconos SVG reutilizables
    const openEyePaths = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
    const closedEyePaths = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle><line x1="1" y1="1" x2="23" y2="23"></line>';
    const sunIcon = '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
    const moonIcon = '<svg class="icon" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

    // Estado de la aplicación
    let eventId = new URLSearchParams(window.location.search).get('id');
    let participantsList = [];
    let selectedUserDoc = null;
    let currentUserId = null; 
    let currentTargetId = null;
    let currentGiftLabel = ""; 
    let linkedProfiles = [];
    let isEditingEvent = false;
    let editingEventId = null;
    let pendingAdminCallback = null;
    let pendingConfirmAction = null;

    // ==========================================
    // 3. INICIALIZACIÓN (ONLOAD)
    // ==========================================
    window.onload = () => {
        populateDays();
        // Inicializar iconos de contraseña
        document.querySelectorAll('.btn-toggle-pass svg').forEach(svg => { svg.innerHTML = closedEyePaths; });
        
        // Carga inicial
        if (eventId) loadEventData(eventId);
        else document.getElementById('screen-home').classList.remove('hidden');

        // Dark Mode al cargar
        applyTheme(mediaQuery.matches);
    };

    function populateDays() {
        const select = document.getElementById('setup-day');
        for (let i = 1; i <= 31; i++) {
            let val = i < 10 ? "0" + i : i;
            let opt = document.createElement('option');
            opt.value = val; opt.innerText = val; select.appendChild(opt);
        }
    }

    // ==========================================
    // 4. UTILIDADES GENERALES
    // ==========================================
    async function hashString(str) {
        if(!str) return null;
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function makeLinksClickable(text) {
        if (!text) return ""; const urlRegex = /(https?:\/\/[^\s]+)/g;
        return text.replace(urlRegex, (url) => `<a href="${url}" target="_blank">${url}</a>`);
    }

    window.showToast = (message, duration = 3000) => {
        const container = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = 'toast'; el.innerText = message;
        container.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, duration);
    };

    // ==========================================
    // 5. TEMA (DARK MODE & SAFARI)
    // ==========================================
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
    updateSafariTheme();

    // ==========================================
    // 6. NAVEGACIÓN Y PANELES MAESTROS
    // ==========================================
    window.goToMasterPanel = () => {
        document.getElementById('screen-home').classList.add('hidden');
        document.getElementById('screen-master').classList.remove('hidden');
        loadAllEvents();
    };

    window.exitMasterPanel = () => {
        document.getElementById('screen-master').classList.add('hidden');
        document.getElementById('screen-home').classList.remove('hidden');
    };

    window.goToEvent = () => { window.location.href = "?id=" + eventId; };

    // ==========================================
    // 7. GESTIÓN DE EVENTOS (CRUD)
    // ==========================================
    async function loadAllEvents() {
        const listDiv = document.getElementById('master-list-container');
        listDiv.innerHTML = '<div class="spinner"></div>';
        try {
            const snap = await getDocs(collection(db, "events"));
            listDiv.innerHTML = "";
            if(snap.empty) { listDiv.innerHTML = "<p style='text-align:center; color:#9ca3af; margin-top:20px;'>No hay eventos.</p>"; return; }
            snap.forEach(docSnap => {
                const data = docSnap.data(); const id = docSnap.id;
                const titleDisplay = data.title || "Evento sin título";
                const budgetDisplay = data.budget ? data.budget.replace('$', '') : '---';
                let prettyDate = "S/F";
                if (data.date) { const parts = data.date.split('-'); if (parts.length === 3) prettyDate = `${parts[2]}/${MONTHS_SHORT[parseInt(parts[1]) - 1]}`; }
                const div = document.createElement('div'); div.className = 'master-event-card';
                div.innerHTML = `
                    <div class="master-event-info">
                        <h4>${titleDisplay}</h4>
                        <div class="master-event-meta" style="margin-top:5px;">
                            <span style="display:flex; align-items:center; gap:4px;"><svg class="icon icon-sm" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${prettyDate}</span>
                            <span style="display:flex; align-items:center; gap:4px;"><svg class="icon icon-sm" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>${budgetDisplay}</span>
                        </div>
                    </div>
                    <div class="master-actions">
                        <button class="btn-icon-action" onclick="window.location.href='?id=${id}'"><svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>
                        <button class="btn-icon-action" onclick="editEvent('${id}')"><svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                        <button class="btn-icon-action btn-icon-danger" onclick="promptForAdmin(() => deleteGlobalEvent('${id}'))"><svg class="icon icon-sm" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                    </div>`;
                listDiv.appendChild(div);
            });
        } catch(e) { listDiv.innerHTML = `<p style='text-align:center; color:red; font-size:0.8em; padding:20px;'>Error: ${e.message}</p>`; }
    }

    window.showAdminSetup = () => { 
        isEditingEvent = false; editingEventId = null; participantsList = []; renderParticipantsList();
        document.getElementById('setup-title').value = ""; document.getElementById('setup-day').value = "";
        document.getElementById('setup-month').value = ""; document.getElementById('setup-budget').value = "Libre";
        document.getElementById('setup-gift-type').value = ""; document.getElementById('btn-create-event').innerText = "Generar Sorteo";
        const reshuffleBtn = document.getElementById('btn-reshuffle-event'); if (reshuffleBtn) reshuffleBtn.remove();
        document.getElementById('screen-home').classList.add('hidden'); document.getElementById('screen-admin').classList.remove('hidden'); 
    };

    window.editEvent = async (id) => {
        editingEventId = id; isEditingEvent = true;
        const eventSnap = await getDoc(doc(db, "events", id));
        if (!eventSnap.exists()) { showToast("Evento no encontrado"); return; }
        const eventData = eventSnap.data();
        document.getElementById('setup-title').value = eventData.title || "";
        const dateParts = eventData.date ? eventData.date.split('-') : [];
        document.getElementById('setup-day').value = dateParts[2] || "";
        document.getElementById('setup-month').value = dateParts[1] || "";
        document.getElementById('setup-budget').value = eventData.budget || "Libre";
        document.getElementById('setup-gift-type').value = eventData.giftType || "";
        participantsList = [];
        const partsSnap = await getDocs(collection(db, `events/${id}/participants`));
        partsSnap.forEach(docSnap => { const p = docSnap.data(); participantsList.push({ id: docSnap.id, name: p.name, isChild: p.isChild }); });
        renderParticipantsList();
        document.getElementById('btn-create-event').innerText = "Guardar Cambios";
        document.getElementById('screen-master').classList.add('hidden'); document.getElementById('screen-admin').classList.remove('hidden');
        let reshuffleBtn = document.getElementById('btn-reshuffle-event');
        if (!reshuffleBtn) {
            reshuffleBtn = document.createElement('button'); reshuffleBtn.id = 'btn-reshuffle-event';
            reshuffleBtn.className = 'btn-secondary'; reshuffleBtn.style.marginTop = '10px';
            reshuffleBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg> Reasignar Sorteo';
            reshuffleBtn.onclick = () => reshuffleParticipants(id);
            document.getElementById('btn-create-event').parentNode.insertBefore(reshuffleBtn, document.getElementById('btn-create-event').nextSibling);
        }
    };

    // Crear o Actualizar Evento
    document.getElementById('btn-create-event').addEventListener('click', async () => {
        const title = document.getElementById('setup-title').value; const day = document.getElementById('setup-day').value;
        const month = document.getElementById('setup-month').value; const budget = document.getElementById('setup-budget').value;
        const giftType = document.getElementById('setup-gift-type').value; 
        if(participantsList.length < 2) return showToast("Mínimo 2 personas");
        if(!title || !day || !month) return showToast("Completa los datos");
        const fullDate = `${new Date().getFullYear()}-${month}-${day}`;
        const btn = document.getElementById('btn-create-event'); btn.disabled = true; btn.innerHTML = '<div class="spinner" style="width:20px; height:20px; margin:0;"></div>';

        try {
            if (isEditingEvent) {
                await updateDoc(doc(db, "events", editingEventId), { title, date: fullDate, budget, giftType });
                const existingPartsSnap = await getDocs(collection(db, `events/${editingEventId}/participants`));
                const existingIds = existingPartsSnap.docs.map(d => d.id);
                const batch = writeBatch(db);
                for (let p of participantsList) {
                    const participantData = { name: p.name, isChild: p.isChild || false };
                    if (p.id) {
                        batch.update(doc(db, `events/${editingEventId}/participants/${p.id}`), participantData);
                        const index = existingIds.indexOf(p.id); if (index > -1) existingIds.splice(index, 1);
                    } else {
                        const newRef = doc(collection(db, `events/${editingEventId}/participants`));
                        batch.set(newRef, { ...participantData, managedBy: null, targetId: null, targetName: "", wish1: "", wish2: "", wish3: "", extra: "", password: null, secretKey: null, seen: false, revealed: false });
                    }
                }
                for (let removedId of existingIds) batch.delete(doc(db, `events/${editingEventId}/participants/${removedId}`));
                await batch.commit(); showToast("Evento actualizado");
                document.getElementById('screen-admin').classList.add('hidden'); document.getElementById('screen-master').classList.remove('hidden'); loadAllEvents();
            } else {
                const eventRef = await addDoc(collection(db, "events"), { title, date: fullDate, budget, giftType, createdAt: serverTimestamp() });
                let shuffled = [...participantsList];
                for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
                const batch = writeBatch(db); let refs = [];
                for(let p of shuffled) refs.push({ name: p.name, isChild: p.isChild, ref: doc(collection(db, `events/${eventRef.id}/participants`)) });
                for (let i = 0; i < refs.length; i++) {
                    const curr = refs[i]; const next = refs[(i + 1) % refs.length];
                    batch.set(curr.ref, { name: curr.name, isChild: curr.isChild || false, managedBy: null, targetId: next.ref.id, targetName: next.name, wish1: "", wish2: "", wish3: "", extra: "", password: null, secretKey: null, seen: false, revealed: false });
                }
                await batch.commit();
                eventId = eventRef.id; const link = window.location.origin + window.location.pathname + "?id=" + eventId;
                document.getElementById('screen-admin').classList.add('hidden'); document.getElementById('screen-share').classList.remove('hidden');
                document.getElementById('share-link-text').innerText = link;
                renderShareInfo(link);
            }
        } catch(e) { btn.disabled = false; btn.innerText = isEditingEvent ? "Guardar Cambios" : "Generar Sorteo"; showToast("Error: " + e.message); }
    });

    async function reshuffleParticipants(id) {
        openConfirmModal("¿Reasignar sorteo?", "Esto reseteará targets, visto y revelado.", async () => {
            try {
                const partsSnap = await getDocs(collection(db, `events/${id}/participants`));
                let parts = partsSnap.docs.map(d => ({ id: d.id, data: d.data() }));
                for (let i = parts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [parts[i], parts[j]] = [parts[j], parts[i]]; }
                const batch = writeBatch(db);
                for (let i = 0; i < parts.length; i++) {
                    const curr = parts[i]; const next = parts[(i + 1) % parts.length];
                    batch.update(doc(db, `events/${id}/participants/${curr.id}`), { targetId: next.id, targetName: next.data.name, seen: false, revealed: false });
                }
                await batch.commit(); showToast("Sorteo reasignado");
            } catch (e) { showToast("Error al reasignar: " + e.message); }
        });
    }

    window.deleteGlobalEvent = (id) => {
        openConfirmModal("¿Borrar evento?", "Se eliminarán todos los datos permanentemente.", async () => {
            try {
                const partsSnap = await getDocs(collection(db, `events/${id}/participants`));
                const batch = writeBatch(db); partsSnap.forEach(d => batch.delete(d.ref)); await batch.commit(); 
                await deleteDoc(doc(db, "events", id)); showToast("Evento eliminado"); loadAllEvents();
            } catch(e) { showToast("Error al borrar"); }
        });
    }

    window.deleteEvent = () => {
        openConfirmModal("¿Borrar este evento?", "Esta acción eliminará todo permanentemente.", async () => {
            try {
                const snapshot = await getDocs(collection(db, `events/${eventId}/participants`)); 
                const batch = writeBatch(db); snapshot.forEach(doc => batch.delete(doc.ref)); await batch.commit(); 
                await deleteDoc(doc(db, "events", eventId)); showToast("Evento eliminado"); 
                setTimeout(() => window.location.href = window.location.pathname, 1500);
            } catch(e) { showToast("Error al eliminar"); }
        });
    };

    async function loadEventData(id) {
        const snap = await getDoc(doc(db, "events", id)); if(!snap.exists()) return showToast("Evento no encontrado");
        const data = snap.data(); currentGiftLabel = data.giftType || ""; 
        const parts = data.date.split('-'); let prettyDate = `${parts[2]}/${MONTHS_SHORT[parseInt(parts[1]) - 1]}`;
        document.getElementById('event-title-display').innerText = data.title;
        document.getElementById('event-date-display').innerHTML = `<svg class="icon icon-sm" viewBox="0 0 24 24" style="margin-right:5px"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${prettyDate}`;
        document.getElementById('event-budget-display').innerHTML = `<svg class="icon icon-sm" viewBox="0 0 24 24" style="margin-right:5px"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>${data.budget.replace('$', '')}`;

        const giftContainer = document.getElementById('event-gift-container');
        const giftDisplay = document.getElementById('event-gift-display');
        if (data.giftType && data.giftType.trim() !== "") {
            giftDisplay.innerHTML = `<svg class="icon icon-sm" viewBox="0 0 24 24" style="margin-right:5px"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>${data.giftType}`;
            giftContainer.classList.remove('hidden');  
        } else {
            giftContainer.classList.add('hidden');  
            giftDisplay.innerHTML = '';  
        }

        onSnapshot(collection(db, `events/${id}/participants`), (qs) => {
            const list = document.getElementById('names-list'); list.innerHTML = "";
            const isDashboardVisible = !document.getElementById('screen-dashboard').classList.contains('hidden');
            if(isDashboardVisible) return;
            if(!currentUserId) { 
                document.getElementById('screen-home').classList.add('hidden'); 
                document.getElementById('screen-login').classList.remove('hidden'); 
            }
            qs.forEach(d => {
                const p = d.data(); if (p.isChild) return; 
                const div = document.createElement('div'); div.className = 'name-card-user'; 
                div.innerText = p.name;
                if(p.seen) { const badge = document.createElement('div'); badge.className='seen-badge'; div.appendChild(badge); }
                div.onclick = () => prepareAuth(d.id, p);
                list.appendChild(div);
            });
        });
    }

    // ==========================================
    // 8. GESTIÓN DE PARTICIPANTES (UI)
    // ==========================================
    document.getElementById('btn-add-name').addEventListener('click', addNameToList);
    document.getElementById('input-new-name').addEventListener('keypress', (e) => { if(e.key === 'Enter') addNameToList(); });

    function addNameToList() {
        const input = document.getElementById('input-new-name'); const check = document.getElementById('check-is-child');
        const name = input.value.trim(); if(!name) return;
        participantsList.push({ name: name, isChild: check.checked, id: null });
        input.value = ""; check.checked = false; input.focus(); renderParticipantsList();
    }

    function renderParticipantsList() {
        const container = document.getElementById('participants-container'); container.innerHTML = "";
        if(participantsList.length === 0) { container.innerHTML = '<small style="text-align:center; padding:15px; color:#9ca3af;">Agrega nombres arriba</small>'; return; }
        participantsList.forEach((p, index) => {
            const div = document.createElement('div'); div.className = 'name-card-admin';
            const childTag = p.isChild ? `<span class="child-tag">NIÑO</span>` : ``;
            div.innerHTML = `
    <span id="name-span-${index}">${childTag}${p.name}</span>
    <div style="display:flex; gap:5px;">
        <button class="btn-icon-edit" onclick="editName(${index})"><svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="btn-icon-delete" onclick="removeName(${index})"><svg class="icon icon-sm" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
    </div>`;
            container.appendChild(div);
        });
        window.removeName = (index) => { participantsList.splice(index, 1); renderParticipantsList(); };
        window.editName = (index) => {
            const span = document.getElementById(`name-span-${index}`); const originalName = participantsList[index].name;
            const input = document.createElement('input'); input.type = 'text'; input.value = originalName;
            input.autocapitalize = 'sentences'; input.style.width = 'auto'; input.style.marginRight = '5px';
            span.innerHTML = ''; span.appendChild(input); input.focus();
            const save = () => { const newName = input.value.trim(); if (newName) participantsList[index].name = newName; renderParticipantsList(); };
            input.addEventListener('keypress', (e) => { if (e.key === 'Enter') save(); }); input.addEventListener('blur', save);
        };
    }

    // ==========================================
    // 9. AUTENTICACIÓN Y PIN
    // ==========================================
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

    function isValidPIN(pin) { return /^\d{6}$/.test(pin); }

    async function prepareAuth(id, data) {
        selectedUserDoc = { id, data };
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
    }

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

    window.adminOverride = async () => {
        await updateDoc(doc(db, `events/${eventId}/participants/${selectedUserDoc.id}`), { password: null, secretKey: null, managedBy: null, seen: false, revealed: false });
        showToast("Cuenta reseteada"); 
        selectedUserDoc.data.password = null; 
        prepareAuth(selectedUserDoc.id, selectedUserDoc.data);
    };

    window.closeModal = () => {
        const modal = document.getElementById('auth-modal');
        modal.classList.add('modal-closing');
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('modal-closing');
        }, 250);
    };

    // ==========================================
    // 10. DASHBOARD Y PERFIL DE USUARIO
    // ==========================================
    async function enterDashboard(uid, userData) {
        document.getElementById('screen-login').classList.add('hidden');
        document.getElementById('screen-dashboard').classList.remove('hidden');
        if(!userData.seen) updateDoc(doc(db, `events/${eventId}/participants/${uid}`), { seen: true });

        linkedProfiles = [{ id: uid, ...userData }];
        const q = await getDocs(collection(db, `events/${eventId}/participants`));
        q.forEach(docSnap => { if(docSnap.data().managedBy === uid) linkedProfiles.push({ id: docSnap.id, ...docSnap.data() }); });

        const switcher = document.getElementById('profile-switcher'); 
        const select = document.getElementById('select-active-profile');
        if(linkedProfiles.length > 1) {
            switcher.classList.remove('hidden'); select.innerHTML = "";
            linkedProfiles.forEach((p, idx) => { 
                const opt = document.createElement('option'); opt.value = idx; 
                opt.innerText = p.name + (idx === 0 ? " (Tú)" : " (Niño)"); select.appendChild(opt); 
            });
        } else switcher.classList.add('hidden');
        loadProfileIndex(0);
    }

    window.switchProfileView = (idx) => loadProfileIndex(parseInt(idx));

    function loadProfileIndex(index) {
        const profile = linkedProfiles[index]; currentUserId = profile.id; currentTargetId = profile.targetId;
        const extraContainer = document.getElementById('input-container-extra');
        if(currentGiftLabel && currentGiftLabel.trim() !== "") {
            extraContainer.classList.remove('hidden'); 
            document.getElementById('label-extra').innerText = "Tu " + currentGiftLabel; 
            document.getElementById('my-extra').placeholder = `Detalles sobre ${currentGiftLabel}...`;
        } else extraContainer.classList.add('hidden');

        document.getElementById('my-wish-1').value = profile.wish1 || "";
        document.getElementById('my-wish-2').value = profile.wish2 || "";
        document.getElementById('my-wish-3').value = profile.wish3 || "";
        if(document.getElementById('my-extra')) document.getElementById('my-extra').value = profile.extra || "";

        const revealOverlay = document.getElementById('reveal-overlay');
        profile.revealed ? revealOverlay.classList.add('faded') : revealOverlay.classList.remove('faded');

        document.getElementById('target-name').innerText = profile.targetName;
        document.getElementById('target-wishes-list').innerHTML = '<li><div class="spinner" style="border-color:rgba(255,255,255,0.2); border-top-color:white; margin:0;"></div></li>';

        getDoc(doc(db, `events/${eventId}/participants/${profile.targetId}`)).then(d => {
            if(d.exists()) {
                const data = d.data(); const list = document.getElementById('target-wishes-list'); list.innerHTML = ""; 
                if(data.wish1) list.innerHTML += `<li>${makeLinksClickable(data.wish1)}</li>`;
                if(data.wish2) list.innerHTML += `<li>${makeLinksClickable(data.wish2)}</li>`;
                if(data.wish3) list.innerHTML += `<li>${makeLinksClickable(data.wish3)}</li>`;
                if(!data.wish1 && !data.wish2 && !data.wish3) list.innerHTML = "<li><em style='opacity:0.6'>Sin opciones aún.</em></li>";
                const extraDiv = document.getElementById('target-extra-info');
                extraDiv.innerHTML = (currentGiftLabel && data.extra) ? `${currentGiftLabel}: ${makeLinksClickable(data.extra)}` : "";
            }
        });
    }

    document.getElementById('btn-save-wishes').addEventListener('click', async () => {
        const w1 = document.getElementById('my-wish-1').value; 
        const w2 = document.getElementById('my-wish-2').value; 
        const w3 = document.getElementById('my-wish-3').value;
        let extra = !document.getElementById('input-container-extra').classList.contains('hidden') ? document.getElementById('my-extra').value : "";
        const btn = document.getElementById('btn-save-wishes');
        btn.innerHTML = '<div class="spinner" style="width:20px; height:20px; border-width:2px; border-color:rgba(255,255,255,0.2); border-top-color:white; margin:0;"></div>'; 
        btn.disabled = true;
        try {
            await updateDoc(doc(db, `events/${eventId}/participants/${currentUserId}`), { wish1: w1, wish2: w2, wish3: w3, extra: extra });
            const idx = linkedProfiles.findIndex(p => p.id === currentUserId);
            if(idx !== -1) { linkedProfiles[idx].wish1 = w1; linkedProfiles[idx].wish2 = w2; linkedProfiles[idx].wish3 = w3; linkedProfiles[idx].extra = extra; }
            btn.innerText = "¡Guardado!"; showToast("Preferencias guardadas");
            setTimeout(() => { btn.innerText = "Guardar Preferencias"; btn.disabled = false; }, 2000);
        } catch(e) { btn.innerText = "Guardar Preferencias"; btn.disabled = false; showToast("Error al guardar"); }
    });

    // ==========================================
    // 11. UTILIDADES DE ADMIN Y MODALES
    // ==========================================
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

    // ==========================================
    // 12. COMPARTIR Y QR
    // ==========================================
    window.shareEvent = async () => {
        const link = document.getElementById('share-link-text').innerText;

        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'Invitación al intercambio',
                    text: 'Únete a este intercambio 🎁',
                    url: link
                });
            } catch (err) {
            }
        } else {
            navigator.clipboard.writeText(link);
            showToast("Enlace copiado");
        }
    };

    window.copyLink = () => { navigator.clipboard.writeText(document.getElementById('share-link-text').innerText).then(()=>showToast("Enlace copiado")); };

    function renderShareInfo(link) {
        document.getElementById('share-link-text').innerText = link;
        const qrImg = document.getElementById('qr-invite');
        const encodedLink = encodeURIComponent(link);
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodedLink}`;
    }

    toast.classList.add('success');