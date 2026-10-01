// Ponto de entrada do pacote do Firebase usado pelo app (gerado em js/vendor/firebase.js).
// Para atualizar: npm install && npm run build:firebase
export { initializeApp } from 'firebase/app';
export {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, connectAuthEmulator,
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail, updateProfile,
} from 'firebase/auth';
export {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  doc, collection, query, where, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot,
  writeBatch, serverTimestamp,
} from 'firebase/firestore';
