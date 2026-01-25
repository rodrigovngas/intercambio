let eventId = new URLSearchParams(window.location.search).get('id');
let participantsList = [];
let selectedUserDoc = null;
let currentUserId = null; 
let currentTargetId = null;
let currentGiftLabel = ""; 
let linkedProfiles = [];
let isEditingEvent = false;
let editingEventId = null;

export {
    eventId,
    participantsList,
    selectedUserDoc,
    currentUserId,
    currentTargetId,
    currentGiftLabel,
    linkedProfiles,
    isEditingEvent,
    editingEventId
};