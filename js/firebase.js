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

// Exportar para uso en otros archivos si usas módulos, 
// o asignar a window si usas scripts globales:
window.db = db;
window.collection = collection;
window.addDoc = addDoc;
window.doc = doc;
window.getDoc = getDoc;
window.updateDoc = updateDoc;
window.writeBatch = writeBatch;
window.serverTimestamp = serverTimestamp;
window.onSnapshot = onSnapshot;
window.getDocs = getDocs;
window.deleteDoc = deleteDoc;
window.setDoc = setDoc;