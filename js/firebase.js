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

const MASTER_KEY = "admin123"; 
const MONTHS_SHORT = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

export {
    db,
    collection, addDoc, doc, getDoc, updateDoc, writeBatch,
    serverTimestamp, onSnapshot, getDocs, deleteDoc, setDoc,
    MASTER_KEY,
    MONTHS_SHORT
};