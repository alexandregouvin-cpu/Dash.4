// Testes das regras de segurança. Rodam no emulador: npm run test:rules
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, serverTimestamp } from 'firebase/firestore';

let env;
const HID = 'casa1';
const CODE = 'ABCDEFGH23';

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-gastos',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8085 },
  });
});
after(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const expense = (uid, extra = {}) => ({
  amount: 1234, category: 'mercado', note: '', date: '2026-10-01', payment: 'pix',
  createdAt: Date.now(), createdBy: uid, createdByName: 'Ana', updatedAt: serverTimestamp(), ...extra,
});

// Casa criada pela Ana (seguindo o mesmo passo a passo do app).
async function createHouse() {
  const db = as('ana');
  await assertSucceeds(setDoc(doc(db, 'households', HID), { name: 'Casa', createdBy: 'ana', inviteCode: CODE, monthlyBudget: 0, dailyLimit: 0, createdAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(db, 'households', HID, 'members', 'ana'), { name: 'Ana', email: 'a@x.com', code: '', joinedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(db, 'invites', CODE), { householdId: HID, createdBy: 'ana', createdAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(db, 'users', 'ana'), { householdId: HID }));
}

test('criador monta a casa e grava gastos', async () => {
  await createHouse();
  const db = as('ana');
  await assertSucceeds(setDoc(doc(db, 'households', HID, 'expenses', 'e1'), expense('ana')));
  await assertSucceeds(getDocs(collection(db, 'households', HID, 'expenses')));
  await assertSucceeds(getDoc(doc(db, 'households', HID)));
});

test('com o código de convite, a outra pessoa entra e vê os gastos', async () => {
  await createHouse();
  const db = as('bia');
  await assertSucceeds(getDoc(doc(db, 'invites', CODE)));
  await assertSucceeds(setDoc(doc(db, 'households', HID, 'members', 'bia'), { name: 'Bia', email: 'b@x.com', code: CODE, joinedAt: serverTimestamp() }));
  await assertSucceeds(getDocs(collection(db, 'households', HID, 'expenses')));
  await assertSucceeds(setDoc(doc(db, 'households', HID, 'expenses', 'e2'), expense('bia', { createdByName: 'Bia' })));
});

test('sem convite válido ninguém entra nem lê', async () => {
  await createHouse();
  await assertSucceeds(setDoc(doc(as('ana'), 'households', HID, 'expenses', 'e1'), expense('ana')));
  const db = as('intruso');
  await assertFails(getDoc(doc(db, 'households', HID)));
  await assertFails(getDocs(collection(db, 'households', HID, 'expenses')));
  await assertFails(getDoc(doc(db, 'households', HID, 'expenses', 'e1')));
  await assertFails(setDoc(doc(db, 'households', HID, 'members', 'intruso'), { name: 'X', code: '', joinedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db, 'households', HID, 'members', 'intruso'), { name: 'X', code: 'ERRADO1234', joinedAt: serverTimestamp() }));
  await assertFails(getDocs(collection(db, 'invites'))); // não dá para listar convites
  await assertFails(getDoc(doc(db, 'users', 'ana')));
  await assertFails(getDoc(doc(anon(), 'invites', CODE)));
});

test('não dá para colocar outra pessoa na casa nem se passar por ela', async () => {
  await createHouse();
  const db = as('bia');
  await assertFails(setDoc(doc(db, 'households', HID, 'members', 'carlos'), { name: 'C', code: CODE, joinedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(db, 'households', HID, 'members', 'bia'), { name: 'Bia', code: CODE, joinedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db, 'households', HID, 'expenses', 'e9'), expense('carlos'))); // autor que não é da casa
  await assertSucceeds(setDoc(doc(db, 'households', HID, 'expenses', 'e10'), expense('ana'))); // desfazer exclusão de gasto da Ana
});

test('convite de outra casa não serve para esta', async () => {
  await createHouse();
  const other = as('zeca');
  await assertSucceeds(setDoc(doc(other, 'households', 'casa2'), { name: 'Outra', createdBy: 'zeca', inviteCode: 'ZZZZZZZZ22', monthlyBudget: 0, dailyLimit: 0 }));
  await assertSucceeds(setDoc(doc(other, 'households', 'casa2', 'members', 'zeca'), { name: 'Zeca', code: '', joinedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(other, 'invites', 'ZZZZZZZZ22'), { householdId: 'casa2', createdBy: 'zeca' }));
  await assertFails(setDoc(doc(other, 'households', HID, 'members', 'zeca'), { name: 'Zeca', code: 'ZZZZZZZZ22', joinedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(other, 'invites', 'FAKE123456'), { householdId: HID, createdBy: 'zeca' })); // não é membro
});

test('gastos inválidos são recusados', async () => {
  await createHouse();
  const db = as('ana');
  const ref = (id) => doc(db, 'households', HID, 'expenses', id);
  await assertFails(setDoc(ref('a'), expense('ana', { amount: -5 })));
  await assertFails(setDoc(ref('b'), expense('ana', { amount: 12.5 })));
  await assertFails(setDoc(ref('c'), expense('ana', { category: 'cassino' })));
  await assertFails(setDoc(ref('d'), expense('ana', { date: 'ontem' })));
  await assertFails(setDoc(ref('e'), expense('ana', { note: 'x'.repeat(121) })));
  await assertFails(setDoc(ref('f'), expense('ana', { extra: true })));
  await assertSucceeds(setDoc(ref('g'), expense('ana', { place: { name: 'Posto', lat: -23.5, lon: -46.6 } })));
});

test('membro edita gasto do outro sem trocar o autor; quem sai perde acesso', async () => {
  await createHouse();
  await assertSucceeds(setDoc(doc(as('bia'), 'households', HID, 'members', 'bia'), { name: 'Bia', code: CODE, joinedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(as('ana'), 'households', HID, 'expenses', 'e1'), expense('ana')));
  const bia = as('bia');
  await assertSucceeds(setDoc(doc(bia, 'households', HID, 'expenses', 'e1'), expense('ana', { amount: 999 })));
  await assertFails(setDoc(doc(bia, 'households', HID, 'expenses', 'e1'), expense('bia', { amount: 999 })));
  await assertSucceeds(updateDoc(doc(bia, 'households', HID), { monthlyBudget: 300000 }));
  await assertFails(updateDoc(doc(bia, 'households', HID), { createdBy: 'bia' }));
  await assertSucceeds(deleteDoc(doc(bia, 'households', HID, 'members', 'bia')));
  await assertFails(getDocs(collection(bia, 'households', HID, 'expenses')));
  await assertFails(deleteDoc(doc(bia, 'households', HID, 'members', 'ana'))); // não remove os outros
});
