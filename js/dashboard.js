window.loadDashboard = async () => {
    try {
        const eventSnap = await getDoc(doc(db, "events", eventId));
        if (!eventSnap.exists()) {
            showToast("Evento no encontrado");
            return;
        }

        const eventData = eventSnap.data();
        document.getElementById('event-title').innerText = eventData.title || '';
        document.getElementById('event-date').innerText = eventData.date || '';
        document.getElementById('event-budget').innerText = eventData.budget || '';
        document.getElementById('event-gift-type').innerText = eventData.giftType || '';

        const partsSnap = await getDocs(collection(db, `events/${eventId}/participants`));
        linkedProfiles = [];
        let myProfile = null;

        partsSnap.forEach(d => {
            const p = d.data();
            const profile = { id: d.id, ...p };
            linkedProfiles.push(profile);
            if (d.id === currentUserId) myProfile = profile;
        });

        document.getElementById('screen-dashboard').classList.remove('hidden');

        if (!myProfile) {
            showToast("Perfil no encontrado");
            return;
        }

        if (myProfile.target) {
            const target = linkedProfiles.find(p => p.id === myProfile.target);
            if (target) {
                document.getElementById('assigned-name').innerText = target.name;
                document.getElementById('assigned-container').classList.remove('hidden');
            }
        }

        renderParticipantsStatus();
    } catch (e) {
        showToast("Error cargando tablero");
    }
};

window.renderParticipantsStatus = () => {
    const list = document.getElementById('participants-status');
    list.innerHTML = '';

    linkedProfiles.forEach(p => {
        const li = document.createElement('li');
        li.className = 'participant-status';
        li.innerHTML = `
            <span>${p.name}</span>
            <span class="${p.revealed ? 'revealed' : 'hidden-status'}">
                ${p.revealed ? 'Revelado' : 'Oculto'}
            </span>
        `;
        list.appendChild(li);
    });
};