window.loadAllEvents = async () => {
    const container = document.getElementById('events-list');
    container.innerHTML = '';
    try {
        const snap = await getDocs(collection(db, "events"));
        if (snap.empty) {
            container.innerHTML = '<p class="empty-msg">No hay eventos creados</p>';
            return;
        }
        snap.forEach(docSnap => {
            const e = docSnap.data();
            const item = document.createElement('div');
            item.className = 'event-item';
            item.innerHTML = `
                <div class="event-info">
                    <h3>${e.title || 'Evento sin título'}</h3>
                    <p>${e.date || ''}</p>
                </div>
                <div class="event-actions">
                    <button class="btn-secondary" onclick="promptForAdmin(() => editEvent('${docSnap.id}'))">
                        Editar
                    </button>
                    <button class="btn-danger" onclick="promptForAdmin(() => deleteGlobalEvent('${docSnap.id}'))">
                        Borrar
                    </button>
                </div>
            `;
            container.appendChild(item);
        });
    } catch (e) {
        showToast("Error cargando eventos");
    }
};

window.openMasterPanel = () => {
    document.getElementById('screen-login').classList.add('hidden');
    document.getElementById('screen-admin').classList.add('hidden');
    document.getElementById('screen-dashboard').classList.add('hidden');
    document.getElementById('screen-master').classList.remove('hidden');
    loadAllEvents();
};

document.getElementById('btn-open-master')?.addEventListener('click', () => {
    promptForAdmin(() => {
        openMasterPanel();
    });
});