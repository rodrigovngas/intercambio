window.participantsList = [];
window.isEditingEvent = false;
window.editingEventId = null;

window.addParticipant = () => {
    const nameInput = document.getElementById('participant-name');
    const isChild = document.getElementById('participant-child').checked;
    const name = nameInput.value.trim();
    if (!name) return;
    participantsList.push({ name, isChild });
    nameInput.value = '';
    document.getElementById('participant-child').checked = false;
    renderParticipantsList();
};

window.removeParticipant = (index) => {
    participantsList.splice(index, 1);
    renderParticipantsList();
};

window.renderParticipantsList = () => {
    const list = document.getElementById('participants-list');
    list.innerHTML = '';
    participantsList.forEach((p, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${p.name}${p.isChild ? ' 👶' : ''}</span>
            <button class="btn-icon" onclick="removeParticipant(${idx})">
                <svg class="icon" viewBox="0 0 24 24">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        `;
        list.appendChild(li);
    });
};

window.resetEventForm = () => {
    document.getElementById('setup-title').value = '';
    document.getElementById('setup-day').value = '';
    document.getElementById('setup-month').value = '';
    document.getElementById('setup-budget').value = 'Libre';
    document.getElementById('setup-gift-type').value = '';
    participantsList = [];
    renderParticipantsList();
    isEditingEvent = false;
    editingEventId = null;
    document.getElementById('btn-create-event').innerText = 'Crear Evento';
    const reshuffleBtn = document.getElementById('btn-reshuffle-event');
    if (reshuffleBtn) reshuffleBtn.remove();
};

window.createOrUpdateEvent = async () => {
    const title = document.getElementById('setup-title').value.trim();
    const day = document.getElementById('setup-day').value;
    const month = document.getElementById('setup-month').value;
    const budget = document.getElementById('setup-budget').value;
    const giftType = document.getElementById('setup-gift-type').value;

    if (!title || participantsList.length < 2) {
        showToast("Completa el título y agrega al menos 2 participantes");
        return;
    }

    const date = month && day ? `2024-${month}-${day}` : '';

    try {
        let eventRef;
        if (isEditingEvent && editingEventId) {
            eventRef = doc(db, "events", editingEventId);
            await updateDoc(eventRef, { title, date, budget, giftType });
            const snap = await getDocs(collection(db, `events/${editingEventId}/participants`));
            const batch = writeBatch(db);
            snap.forEach(d => batch.delete(d.ref));
            await batch.commit();
        } else {
            eventRef = await addDoc(collection(db, "events"), {
                title, date, budget, giftType
            });
            editingEventId = eventRef.id;
        }

        const partsCol = collection(db, `events/${editingEventId}/participants`);
        for (const p of participantsList) {
            await addDoc(partsCol, {
                name: p.name,
                isChild: p.isChild,
                revealed: false
            });
        }

        shuffleParticipants(editingEventId);
        showToast(isEditingEvent ? "Evento actualizado" : "Evento creado");
        resetEventForm();
        document.getElementById('screen-admin').classList.add('hidden');
        document.getElementById('screen-master').classList.remove('hidden');
        loadAllEvents();
    } catch (e) {
        showToast("Error al guardar evento");
    }
};

document.getElementById('btn-create-event')?.addEventListener('click', createOrUpdateEvent);