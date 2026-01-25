const MONTHS_SHORT = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

// --- VARIABLES GLOBALES DE ESTADO ---
let eventId = new URLSearchParams(window.location.search).get('id');
let participantsList = [];
let selectedUserDoc = null;
let currentUserId = null; 
let currentTargetId = null;
let currentGiftLabel = ""; 
let linkedProfiles = [];
let isEditingEvent = false;
let editingEventId = null;

// --- CARGA INICIAL ---
window.onload = () => {
    populateDays();
    if (eventId) loadEventData(eventId);
    else document.getElementById('screen-home').classList.remove('hidden');
};

function populateDays() {
    const select = document.getElementById('setup-day');
    for (let i = 1; i <= 31; i++) {
        let val = i < 10 ? "0" + i : i;
        let opt = document.createElement('option');
        opt.value = val; opt.innerText = val; select.appendChild(opt);
    }
}

window.goToEvent = () => { window.location.href = "?id=" + eventId; };

// --- PANELES MAESTROS Y GESTIÓN DE EVENTOS ---
window.goToMasterPanel = () => {
    document.getElementById('screen-home').classList.add('hidden');
    document.getElementById('screen-master').classList.remove('hidden');
    loadAllEvents();
};
window.exitMasterPanel = () => {
    document.getElementById('screen-master').classList.add('hidden');
    document.getElementById('screen-home').classList.remove('hidden');
};

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

window.deleteGlobalEvent = (id) => {
    openConfirmModal("¿Borrar evento?", "Se eliminarán todos los datos permanentemente.", async () => {
        try {
            const partsSnap = await getDocs(collection(db, `events/${id}/participants`));
            const batch = writeBatch(db); partsSnap.forEach(d => batch.delete(d.ref)); await batch.commit(); 
            await deleteDoc(doc(db, "events", id)); showToast("Evento eliminado"); loadAllEvents();
        } catch(e) { showToast("Error al borrar"); }
    });
}

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

window.showAdminSetup = () => { 
    isEditingEvent = false; editingEventId = null; participantsList = []; renderParticipantsList();
    document.getElementById('setup-title').value = ""; document.getElementById('setup-day').value = "";
    document.getElementById('setup-month').value = ""; document.getElementById('setup-budget').value = "Libre";
    document.getElementById('setup-gift-type').value = ""; document.getElementById('btn-create-event').innerText = "Generar Sorteo";
    const reshuffleBtn = document.getElementById('btn-reshuffle-event'); if (reshuffleBtn) reshuffleBtn.remove();
    document.getElementById('screen-home').classList.add('hidden'); document.getElementById('screen-admin').classList.remove('hidden'); 
};

// --- GESTIÓN DE PARTICIPANTES ---
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

// --- CREACIÓN / ACTUALIZACIÓN DEL SORTEO ---
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
            renderShareInfo(link); // En ui.js
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

// --- DATA FETCHING (Vista de Usuario) ---
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
            div.onclick = () => prepareAuth(d.id, p); // En auth.js
            list.appendChild(div);
        });
    });
}

// --- DASHBOARD & PERFIL ---
window.enterDashboard = async (uid, userData) => {
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

window.loadProfileIndex = (index) => {
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