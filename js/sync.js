// Conta compartilhada: login, "casa" com convite e gastos sincronizados em tempo real (Firebase).
//
// Estrutura no Firestore:
//   households/{casa}                 nome, criador, código de convite, orçamento
//   households/{casa}/members/{uid}   quem participa
//   households/{casa}/expenses/{id}   gastos (mesmos campos do modo local + quem registrou)
//   invites/{código}                  aponta para a casa; só quem tem o código consegue entrar
//   users/{uid}                       casa atual do usuário (para restaurar em outro aparelho)
//
// O SDK só é carregado quando há configuração, então o modo local continua leve.
// Gravações não são aguardadas pela interface: o Firestore aplica na hora no aparelho
// (inclusive offline) e envia ao servidor quando houver internet.

import { firebaseConfig } from './firebase-config.js';

let fb = null; // módulo do SDK
let auth = null;
let db = null;

const EMULATOR_FLAG = 'gastos:emulator'; // só para testes locais

export function isConfigured() {
  return Boolean(firebaseConfig?.apiKey && firebaseConfig?.projectId);
}

export async function init(onUser) {
  if (!isConfigured()) return false;
  if (!fb) {
    fb = await import('./vendor/firebase.js');
    const app = fb.initializeApp(firebaseConfig);
    auth = fb.initializeAuth(app, { persistence: [fb.indexedDBLocalPersistence, fb.browserLocalPersistence] });
    auth.languageCode = 'pt-BR';
    let localCache;
    try {
      localCache = fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() });
    } catch {
      localCache = undefined; // navegador sem IndexedDB: funciona, mas sem cache offline
    }
    db = fb.initializeFirestore(app, localCache ? { localCache } : {});
    let emulator = false;
    try { emulator = localStorage.getItem(EMULATOR_FLAG) === '1'; } catch { /* sem storage */ }
    if (emulator) {
      fb.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      fb.connectFirestoreEmulator(db, '127.0.0.1', 8085);
    }
  }
  fb.onAuthStateChanged(auth, (user) => onUser(user ? publicUser(user) : null));
  return true;
}

function publicUser(user) {
  return { uid: user.uid, email: user.email, name: user.displayName || user.email?.split('@')[0] || 'Você' };
}

function me() {
  if (!auth?.currentUser) throw Object.assign(new Error('Entre na sua conta primeiro.'), { code: 'not-signed-in' });
  return publicUser(auth.currentUser);
}

// ---------- Conta ----------

export async function signUp(name, email, password) {
  const cred = await fb.createUserWithEmailAndPassword(auth, email.trim(), password);
  await fb.updateProfile(cred.user, { displayName: name.trim().slice(0, 40) });
  return publicUser(cred.user);
}

export async function signIn(email, password) {
  const cred = await fb.signInWithEmailAndPassword(auth, email.trim(), password);
  return publicUser(cred.user);
}

export function resetPassword(email) {
  return fb.sendPasswordResetEmail(auth, email.trim());
}

export function logout() {
  return fb.signOut(auth);
}

// ---------- Casa e convite ----------

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I para facilitar ditar

export function newInviteCode(length = 10) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function normalizeCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export async function getUserHousehold() {
  const { uid } = me();
  const snap = await fb.getDoc(fb.doc(db, 'users', uid));
  const hid = snap.exists() ? snap.data().householdId : null;
  if (!hid) return null;
  // Confere se ainda é membro (pode ter saído por outro aparelho).
  const member = await fb.getDoc(fb.doc(db, 'households', hid, 'members', uid));
  return member.exists() ? hid : null;
}

export async function createHousehold(name, settings = {}) {
  const user = me();
  const ref = fb.doc(fb.collection(db, 'households'));
  const code = newInviteCode();
  await fb.setDoc(ref, {
    name: name.trim().slice(0, 40) || 'Nossa casa',
    createdBy: user.uid,
    inviteCode: code,
    monthlyBudget: settings.monthlyBudget || 0,
    dailyLimit: settings.dailyLimit || 0,
    createdAt: fb.serverTimestamp(),
  });
  await fb.setDoc(fb.doc(db, 'households', ref.id, 'members', user.uid), memberDoc(user, ''));
  await fb.setDoc(fb.doc(db, 'invites', code), { householdId: ref.id, createdBy: user.uid, createdAt: fb.serverTimestamp() });
  await fb.setDoc(fb.doc(db, 'users', user.uid), { householdId: ref.id });
  return ref.id;
}

function memberDoc(user, code) {
  return { name: user.name, email: user.email ?? '', code, joinedAt: fb.serverTimestamp() };
}

export async function joinHousehold(rawCode) {
  const user = me();
  const code = normalizeCode(rawCode);
  if (code.length < 6) throw Object.assign(new Error('Código de convite inválido.'), { code: 'invalid-invite' });
  const invite = await fb.getDoc(fb.doc(db, 'invites', code));
  if (!invite.exists()) throw Object.assign(new Error('Convite não encontrado ou já substituído. Peça um novo link.'), { code: 'invalid-invite' });
  const hid = invite.data().householdId;
  await fb.setDoc(fb.doc(db, 'households', hid, 'members', user.uid), memberDoc(user, code));
  await fb.setDoc(fb.doc(db, 'users', user.uid), { householdId: hid });
  return hid;
}

// Gera um novo código; o link antigo deixa de funcionar.
export async function regenerateInvite(hid, oldCode) {
  const user = me();
  const code = newInviteCode();
  await fb.setDoc(fb.doc(db, 'invites', code), { householdId: hid, createdBy: user.uid, createdAt: fb.serverTimestamp() });
  await fb.updateDoc(fb.doc(db, 'households', hid), { inviteCode: code });
  if (oldCode) await fb.deleteDoc(fb.doc(db, 'invites', oldCode)).catch(() => {});
  return code;
}

export async function leaveHousehold(hid) {
  const { uid } = me();
  await fb.deleteDoc(fb.doc(db, 'households', hid, 'members', uid));
  await fb.setDoc(fb.doc(db, 'users', uid), { householdId: null });
}

export function updateHouseholdSettings(hid, patch) {
  const data = {};
  if ('monthlyBudget' in patch) data.monthlyBudget = patch.monthlyBudget;
  if ('dailyLimit' in patch) data.dailyLimit = patch.dailyLimit;
  return fb.updateDoc(fb.doc(db, 'households', hid), data);
}

// cb({ household, members }) a cada mudança na casa ou na lista de membros.
export function watchHousehold(hid, cb, onError) {
  let household = null;
  let members = [];
  const emit = () => household && cb({ household, members });
  const unsubHouse = fb.onSnapshot(fb.doc(db, 'households', hid), (snap) => {
    household = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    emit();
  }, onError);
  const unsubMembers = fb.onSnapshot(fb.collection(db, 'households', hid, 'members'), (snap) => {
    members = snap.docs.map((d) => ({ uid: d.id, name: d.data().name, email: d.data().email }));
    emit();
  }, onError);
  return () => { unsubHouse(); unsubMembers(); };
}

// ---------- Gastos ----------

function toDoc(e, user) {
  const data = {
    amount: e.amount,
    category: e.category,
    note: e.note ?? '',
    date: e.date,
    payment: e.payment ?? '',
    createdAt: e.createdAt ?? Date.now(),
    createdBy: e.createdBy ?? user.uid,
    createdByName: e.createdByName ?? user.name,
    updatedAt: fb.serverTimestamp(),
  };
  if (e.place) data.place = e.place;
  return data;
}

function fromDoc(snap) {
  const d = snap.data();
  const e = {
    id: snap.id,
    amount: d.amount,
    category: d.category,
    note: d.note ?? '',
    date: d.date,
    payment: d.payment ?? '',
    createdAt: d.createdAt ?? 0,
    createdBy: d.createdBy,
    createdByName: d.createdByName,
  };
  if (d.place) e.place = d.place;
  return e;
}

// Gastos a partir de `fromDate` (YYYY-MM-DD). cb(expenses, { added, fromCache }) — `added` traz
// só os gastos novos vindos do servidor (para avisar o que a outra pessoa registrou).
export function watchExpenses(hid, fromDate, cb, onError) {
  const q = fb.query(fb.collection(db, 'households', hid, 'expenses'), fb.where('date', '>=', fromDate));
  let first = true;
  return fb.onSnapshot(q, { includeMetadataChanges: false }, (snap) => {
    const added = first ? [] : snap.docChanges()
      .filter((c) => c.type === 'added' && !c.doc.metadata.hasPendingWrites)
      .map((c) => fromDoc(c.doc));
    first = false;
    cb(snap.docs.map(fromDoc), { added, fromCache: snap.metadata.fromCache });
  }, onError);
}

export function saveExpense(hid, expense) {
  return fb.setDoc(fb.doc(db, 'households', hid, 'expenses', expense.id), toDoc(expense, me()));
}

export function deleteExpense(hid, id) {
  return fb.deleteDoc(fb.doc(db, 'households', hid, 'expenses', id));
}

// Envia vários gastos (ex.: os que já estavam no aparelho). Usa o mesmo id: reenviar não duplica.
export async function uploadExpenses(hid, expenses) {
  const user = me();
  for (let i = 0; i < expenses.length; i += 400) {
    const batch = fb.writeBatch(db);
    for (const e of expenses.slice(i, i + 400)) {
      batch.set(fb.doc(db, 'households', hid, 'expenses', e.id), toDoc({ ...e, createdBy: user.uid, createdByName: user.name }, user));
    }
    await batch.commit();
  }
}

export async function fetchAllExpenses(hid) {
  const snap = await fb.getDocs(fb.collection(db, 'households', hid, 'expenses'));
  return snap.docs.map(fromDoc);
}

// ---------- Mensagens de erro ----------

const MESSAGES = {
  'auth/invalid-email': 'E-mail inválido.',
  'auth/missing-email': 'Informe o e-mail.',
  'auth/email-already-in-use': 'Já existe uma conta com este e-mail. Use “Entrar”.',
  'auth/weak-password': 'Senha fraca: use pelo menos 6 caracteres.',
  'auth/missing-password': 'Informe a senha.',
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'E-mail ou senha incorretos.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  'auth/network-request-failed': 'Sem conexão com a internet.',
  'permission-denied': 'Sem permissão. Verifique se você ainda faz parte desta casa.',
  unavailable: 'Sem conexão com o servidor. Tente de novo quando estiver com internet.',
};

export function errorMessage(err) {
  return MESSAGES[err?.code] ?? (err?.code === 'invalid-invite' || err?.code === 'not-signed-in' ? err.message : `Algo deu errado (${err?.code ?? err?.message ?? 'erro'}).`);
}
