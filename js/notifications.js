// Notificações: lembrete diário para registrar gastos e alertas de orçamento.
//
// Como funciona em cada situação:
// - App aberto (ou em segundo plano recente): um timer dispara o lembrete no horário escolhido.
// - Ao abrir o app depois do horário: se não houver gasto no dia, o lembrete é mostrado.
// - App instalado no Android/Chrome: o service worker recebe "periodic sync" e mostra o
//   lembrete mesmo com o app fechado (o sistema decide o momento exato, geralmente ~1x ao dia).
// O service worker não acessa o localStorage, então compartilhamos um pequeno estado via Cache API.

import { nextReminderDate, shouldRemind, todayISO } from './core.js';

const STATE_CACHE = 'gastos-shared-state';
const STATE_URL = './__state.json';

let reminderTimer = null;

export function isSupported() {
  return 'Notification' in globalThis;
}

export function permission() {
  return isSupported() ? Notification.permission : 'unsupported';
}

export async function requestPermission() {
  if (!isSupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}

export async function notify(title, body, tag) {
  if (permission() !== 'granted') return false;
  const options = { body, tag, icon: './icons/icon-192.png', badge: './icons/badge-96.png', lang: 'pt-BR' };
  try {
    // No Android, `new Notification()` não funciona: é obrigatório passar pelo service worker.
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, { ...options, data: { url: './' } });
      return true;
    }
    new Notification(title, options);
    return true;
  } catch (err) {
    console.warn('Falha ao notificar', err);
    return false;
  }
}

async function readShared() {
  try {
    const cache = await caches.open(STATE_CACHE);
    const res = await cache.match(STATE_URL);
    return res ? await res.json() : {};
  } catch {
    return {};
  }
}

// Envia ao service worker o que ele precisa para decidir sozinho se lembra o usuário.
// Retorna a data do último lembrete conhecida por qualquer um dos lados.
export async function syncShared(state) {
  const shared = await readShared();
  const lastReminderDate = [shared.lastReminderDate, state.settings.lastReminderDate].filter(Boolean).sort().pop() ?? '';
  const lastExpenseDate = state.expenses.reduce((max, e) => (e.date > max ? e.date : max), '');
  try {
    const cache = await caches.open(STATE_CACHE);
    const payload = {
      reminderEnabled: state.settings.reminderEnabled,
      reminderTime: state.settings.reminderTime,
      lastExpenseDate,
      lastReminderDate,
    };
    await cache.put(STATE_URL, new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } }));
  } catch {
    // Cache API indisponível (ex.: navegação privada): segue só com o timer local.
  }
  return lastReminderDate;
}

async function registerPeriodicSync(enabled) {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg?.periodicSync) return false;
    if (!enabled) {
      await reg.periodicSync.unregister('daily-reminder');
      return false;
    }
    const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (status.state !== 'granted') return false;
    await reg.periodicSync.register('daily-reminder', { minInterval: 12 * 60 * 60 * 1000 });
    return true;
  } catch {
    return false;
  }
}

// Verifica agora e agenda o próximo lembrete. `onReminded` persiste a data do lembrete.
export async function setupReminder(state, onReminded) {
  clearTimeout(reminderTimer);
  const { reminderEnabled, reminderTime } = state.settings;
  const lastReminderDate = await syncShared(state);
  await registerPeriodicSync(reminderEnabled && permission() === 'granted');
  if (!reminderEnabled || permission() !== 'granted') return;

  const check = async () => {
    const now = new Date();
    if (shouldRemind({ now, time: reminderTime, expenses: state.expenses, lastReminderDate: state.settings.lastReminderDate })) {
      await notify('Registrou seus gastos de hoje? 💸', 'Leva 10 segundos: toque para anotar o que você pagou hoje.', 'daily-reminder');
      onReminded(todayISO(now));
    }
  };

  if (lastReminderDate !== state.settings.lastReminderDate) onReminded(lastReminderDate);
  await check();

  const delay = nextReminderDate(new Date(), reminderTime) - Date.now();
  reminderTimer = setTimeout(() => setupReminder(state, onReminded), Math.min(delay + 1000, 2 ** 31 - 1));
}
