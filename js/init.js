window.onload = () => {
    populateDays();
    if (eventId) loadEventData(eventId);
    else document.getElementById('screen-home').classList.remove('hidden');
};