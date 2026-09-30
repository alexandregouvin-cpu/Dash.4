import {
  CATEGORIES, PAYMENT_METHODS, getCategory, getPaymentMethod, formatBRL, digitsToCents, parseAmount,
  todayISO, addDays, monthKey, shiftMonth, formatMonthLabel, formatDayLabel, parseISODate,
  sumCents, filterByDay, filterByMonth, sortExpenses, groupByDay, totalsByCategory, lastNDaysTotals,
  dailyAverage, monthProjection, budgetStatus, crossedThresholds, validateExpense, newId, toCSV, parseBackup,
} from './core.js';
import { load, save } from './storage.js';
import * as notifications from './notifications.js';

const state = load();
const ui = { view: 'today', month: monthKey(todayISO()), historyCategory: '', editingId: null };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function persist() {
  if (!save(state)) toast('Não foi possível salvar no aparelho. Verifique o espaço disponível.');
  notifications.syncShared(state);
}

// ---------- Renderização ----------

function itemHTML(e, { showDate = false } = {}) {
  const cat = getCategory(e.category);
  const pay = getPaymentMethod(e.payment);
  const meta = [showDate ? formatDayLabel(e.date) : null, pay?.label].filter(Boolean).join(' · ');
  return `<li><button class="item" data-edit="${escapeHTML(e.id)}">
    <span class="dot" style="background:${cat.color}22">${cat.emoji}</span>
    <span class="info"><strong>${escapeHTML(e.note || cat.label)}</strong><small>${escapeHTML(e.note ? [cat.label, meta].filter(Boolean).join(' · ') : meta || ' ')}</small></span>
    <span class="value">${formatBRL(e.amount)}</span>
  </button></li>`;
}

function renderToday() {
  const today = todayISO();
  const todays = sortExpenses(filterByDay(state.expenses, today));
  const month = filterByMonth(state.expenses, monthKey(today));
  const todayTotal = sumCents(todays);
  const monthTotal = sumCents(month);

  $('#today-total').textContent = formatBRL(todayTotal);
  $('#month-total').textContent = formatBRL(monthTotal);
  $('#month-avg').textContent = formatBRL(dailyAverage(state.expenses, monthKey(today), today));

  const { dailyLimit, monthlyBudget } = state.settings;
  const limitEl = $('#daily-limit');
  limitEl.hidden = !dailyLimit;
  if (dailyLimit) {
    const left = dailyLimit - todayTotal;
    limitEl.textContent = left >= 0 ? `Ainda cabem ${formatBRL(left)} no limite de hoje` : `${formatBRL(-left)} acima do limite de hoje`;
  }

  const box = $('#budget-box');
  box.hidden = !monthlyBudget;
  if (monthlyBudget) {
    const status = budgetStatus(monthTotal, monthlyBudget);
    const bar = $('#budget-bar');
    bar.style.width = `${Math.min(100, status.ratio * 100)}%`;
    bar.className = status.level;
    $('#budget-text').textContent = status.remaining >= 0
      ? `${Math.round(status.ratio * 100)}% do orçamento · restam ${formatBRL(status.remaining)}`
      : `Orçamento estourado em ${formatBRL(-status.remaining)}`;
  }

  $('#today-list').innerHTML = todays.length
    ? todays.map((e) => itemHTML(e)).join('')
    : '<li class="empty">Nenhum pagamento hoje ainda.<br>Toque em uma categoria acima ou no <b>+</b> para registrar.</li>';
}

function renderMonthNav() {
  for (const el of $$('.month-label')) el.textContent = formatMonthLabel(ui.month);
  for (const btn of $$('[data-month-shift="1"]')) btn.disabled = ui.month >= monthKey(todayISO());
}

function renderHistory() {
  renderMonthNav();
  const used = new Set(filterByMonth(state.expenses, ui.month).map((e) => e.category));
  $('#history-filter').innerHTML = [
    `<button class="chip ${ui.historyCategory ? '' : 'active'}" data-filter="">Todas</button>`,
    ...CATEGORIES.filter((c) => used.has(c.id)).map(
      (c) => `<button class="chip ${ui.historyCategory === c.id ? 'active' : ''}" data-filter="${c.id}">${c.emoji} ${c.label}</button>`,
    ),
  ].join('');

  let list = filterByMonth(state.expenses, ui.month);
  if (ui.historyCategory) list = list.filter((e) => e.category === ui.historyCategory);
  $('#history-total').textContent = list.length ? `${list.length} lançamento(s) · ${formatBRL(sumCents(list))}` : '';
  $('#history-list').innerHTML = list.length
    ? groupByDay(list)
        .map((g) => `<div class="day-head"><span>${formatDayLabel(g.date)}</span><span>${formatBRL(g.total)}</span></div>
          <ul class="list">${g.items.map((e) => itemHTML(e)).join('')}</ul>`)
        .join('')
    : '<p class="empty">Nenhum gasto neste mês.</p>';
}

function renderSummary() {
  renderMonthNav();
  const today = todayISO();
  const month = filterByMonth(state.expenses, ui.month);
  const total = sumCents(month);
  const isCurrent = ui.month === monthKey(today);

  $('#sum-total').textContent = formatBRL(total);
  $('#sum-avg').textContent = formatBRL(dailyAverage(state.expenses, ui.month, today));
  $('#sum-count').textContent = String(month.length);
  $('#sum-proj-label').textContent = isCurrent ? 'Projeção do mês' : 'Maior categoria';
  if (isCurrent) {
    $('#sum-proj').textContent = formatBRL(monthProjection(state.expenses, ui.month, today));
  } else {
    const top = totalsByCategory(month)[0];
    $('#sum-proj').textContent = top ? `${top.category.emoji} ${top.category.label}` : '—';
  }

  const cats = totalsByCategory(month);
  $('#sum-cats').innerHTML = cats.length
    ? cats.map((c) => `<li>
        <div class="bar-head"><span>${c.category.emoji} ${c.category.label}</span><span>${formatBRL(c.total)} · ${Math.round(c.share * 100)}%</span></div>
        <div class="meter"><div style="width:${(c.share * 100).toFixed(1)}%;background:${c.category.color}"></div></div>
      </li>`).join('')
    : '<li class="empty">Sem gastos para mostrar.</li>';

  const end = isCurrent ? today : addDays(`${shiftMonth(ui.month, 1)}-01`, -1);
  const week = lastNDaysTotals(state.expenses, end, 7);
  const max = Math.max(...week.map((d) => d.total), 1);
  $('#sum-week').innerHTML = week.map((d) => {
    const weekday = parseISODate(d.date).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    const short = d.total ? formatBRL(d.total).replace('R$ ', '').replace(/,\d\d$/, '') : '';
    return `<div class="col" title="${formatDayLabel(d.date)}: ${formatBRL(d.total)}">
      <span class="v">${short}</span><div style="height:${(d.total / max) * 100}%"></div><small>${weekday}</small></div>`;
  }).join('');
}

function renderSettings() {
  const form = $('#settings-form');
  const s = state.settings;
  form.monthlyBudget.value = s.monthlyBudget ? formatBRL(s.monthlyBudget).replace('R$ ', '') : '';
  form.dailyLimit.value = s.dailyLimit ? formatBRL(s.dailyLimit).replace('R$ ', '') : '';
  form.budgetAlerts.checked = s.budgetAlerts;
  form.reminderEnabled.checked = s.reminderEnabled;
  form.reminderTime.value = s.reminderTime;
  renderNotifStatus();
}

function renderNotifStatus() {
  const perm = notifications.permission();
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const messages = {
    granted: 'Notificações permitidas neste aparelho.',
    denied: 'Notificações bloqueadas. Libere nas configurações do navegador/celular para este site.',
    default: 'Ative uma opção acima para o app pedir permissão de notificação.',
    unsupported: isIOS && !standalone
      ? 'No iPhone, instale o app na Tela de Início (Compartilhar → Adicionar à Tela de Início) para receber notificações.'
      : 'Este navegador não suporta notificações.',
  };
  $('#notif-status').textContent = messages[perm];
  $('#test-notif').hidden = perm !== 'granted';
  $('#install-hint').textContent = standalone ? '' : isIOS
    ? 'Dica: no Safari, toque em Compartilhar → “Adicionar à Tela de Início” para usar como app.'
    : 'Dica: no menu do navegador, toque em “Instalar app” ou “Adicionar à tela inicial”.';
}

function render() {
  $('#today-label').textContent = parseISODate(todayISO()).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' });
  if (ui.view === 'today') renderToday();
  if (ui.view === 'history') renderHistory();
  if (ui.view === 'summary') renderSummary();
  if (ui.view === 'settings') renderSettings();
}

function showView(view) {
  ui.view = view;
  for (const section of $$('.view')) section.hidden = section.id !== `view-${view}`;
  for (const btn of $$('.tabbar button')) btn.classList.toggle('active', btn.dataset.view === view);
  $('#view-title').textContent = $(`#view-${view}`).dataset.title;
  $('#fab').hidden = view === 'settings';
  window.scrollTo({ top: 0 });
  render();
}

// ---------- Formulário de gasto ----------

const dialog = $('#expense-dialog');
const form = $('#expense-form');
let amountCents = 0;

function setAmount(cents) {
  amountCents = cents;
  form.amount.value = formatBRL(cents);
}

function buildFormOptions() {
  $('#category-grid').innerHTML = CATEGORIES.map((c) => `
    <input type="radio" name="category" id="cat-${c.id}" value="${c.id}">
    <label for="cat-${c.id}"><span>${c.emoji}</span>${c.label}</label>`).join('');
  $('#payment-chips').innerHTML = PAYMENT_METHODS.map((p) => `
    <label style="margin:0"><input type="radio" name="payment" value="${p.id}"><span class="chip">${p.label}</span></label>`).join('');
  $('#quick-cats').innerHTML = CATEGORIES.map((c) => `<button data-quick="${c.id}"><span>${c.emoji}</span>${c.label}</button>`).join('');
}

function openExpense({ id = null, category = '' } = {}) {
  ui.editingId = id;
  const existing = id ? state.expenses.find((e) => e.id === id) : null;
  form.reset();
  for (const el of $$('[data-error]')) el.textContent = '';
  $('#expense-title').textContent = existing ? 'Editar gasto' : 'Novo gasto';
  $('#delete-expense').hidden = !existing;

  const lastPayment = sortExpenses(state.expenses)[0]?.payment;
  const data = existing ?? { amount: 0, category, note: '', date: todayISO(), payment: lastPayment ?? 'pix' };
  setAmount(data.amount);
  form.note.value = data.note ?? '';
  form.date.value = data.date;
  form.date.max = todayISO();
  const cat = form.querySelector(`input[name="category"][value="${data.category}"]`);
  if (cat) cat.checked = true;
  const pay = form.querySelector(`input[name="payment"][value="${data.payment}"]`);
  if (pay) pay.checked = true;

  dialog.showModal();
  // Foco no valor para o teclado numérico já abrir.
  requestAnimationFrame(() => {
    form.amount.focus();
    const end = form.amount.value.length;
    form.amount.setSelectionRange(end, end);
  });
}

function closeExpense() {
  dialog.close();
  ui.editingId = null;
}

async function checkBudgetAlerts(before, after, date) {
  const { budgetAlerts, monthlyBudget, dailyLimit } = state.settings;
  if (!budgetAlerts) return;
  const messages = [];
  for (const t of crossedThresholds(before.month, after.month, monthlyBudget)) {
    messages.push(t >= 1
      ? ['Orçamento do mês estourado 🚨', `Você já gastou ${formatBRL(after.month)} de ${formatBRL(monthlyBudget)}.`]
      : ['80% do orçamento usado ⚠️', `Restam ${formatBRL(monthlyBudget - after.month)} para o resto do mês.`]);
  }
  if (date === todayISO() && crossedThresholds(before.day, after.day, dailyLimit).includes(1)) {
    messages.push(['Limite diário atingido', `Hoje você já gastou ${formatBRL(after.day)} (limite ${formatBRL(dailyLimit)}).`]);
  }
  for (const [title, body] of messages) {
    const sent = await notifications.notify(title, body, `budget-${title}`);
    if (!sent) toast(`${title} — ${body}`);
  }
}

function totalsFor(date) {
  return { month: sumCents(filterByMonth(state.expenses, monthKey(date))), day: sumCents(filterByDay(state.expenses, date)) };
}

// Campo estilo "caixa registradora": cada dígito entra pela direita, apagar remove o último.
// Tratamos a tecla no `beforeinput` para não depender da posição do cursor.
form.amount.addEventListener('beforeinput', (event) => {
  if (event.inputType === 'insertText' && /^\d+$/.test(event.data ?? '')) {
    event.preventDefault();
    setAmount(digitsToCents(String(amountCents) + event.data));
  } else if (event.inputType.startsWith('delete')) {
    event.preventDefault();
    setAmount(Math.floor(amountCents / 10));
  } else if (event.inputType === 'insertText') {
    event.preventDefault(); // ignora letras, vírgula etc.
  }
});
// Reserva para colar/autopreencher ou teclados que não permitem cancelar a entrada.
form.amount.addEventListener('input', () => setAmount(digitsToCents(form.amount.value)));
const caretToEnd = () => requestAnimationFrame(() => {
  const end = form.amount.value.length;
  form.amount.setSelectionRange(end, end);
});
form.amount.addEventListener('focus', caretToEnd);
form.amount.addEventListener('click', caretToEnd);

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const existing = ui.editingId ? state.expenses.find((e) => e.id === ui.editingId) : null;
  const expense = {
    id: existing?.id ?? newId(),
    amount: amountCents,
    category: form.querySelector('input[name="category"]:checked')?.value ?? '',
    note: form.note.value.trim(),
    date: form.date.value,
    payment: form.querySelector('input[name="payment"]:checked')?.value ?? '',
    createdAt: existing?.createdAt ?? Date.now(),
  };
  const errors = validateExpense(expense);
  for (const el of $$('[data-error]')) el.textContent = errors[el.dataset.error] ?? '';
  if (Object.keys(errors).length) return;

  const before = totalsFor(expense.date);
  if (existing) Object.assign(existing, expense);
  else state.expenses.push(expense);
  persist();
  const after = totalsFor(expense.date);
  closeExpense();
  render();
  toast(existing ? 'Gasto atualizado.' : `${getCategory(expense.category).emoji} ${formatBRL(expense.amount)} registrado.`);
  if (!existing) checkBudgetAlerts(before, after, expense.date);
});

$('#delete-expense').addEventListener('click', () => {
  const index = state.expenses.findIndex((e) => e.id === ui.editingId);
  if (index < 0) return;
  const [removed] = state.expenses.splice(index, 1);
  persist();
  closeExpense();
  render();
  toast('Gasto excluído.', 'Desfazer', () => {
    state.expenses.push(removed);
    persist();
    render();
  });
});

dialog.addEventListener('click', (event) => {
  if (event.target === dialog || event.target.closest('[data-close]')) closeExpense();
});

// ---------- Toast ----------

let toastTimer;
function toast(message, actionLabel, action) {
  const el = $('#toast');
  el.innerHTML = '';
  el.append(document.createTextNode(message));
  if (actionLabel) {
    const btn = document.createElement('button');
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => { el.hidden = true; action(); });
    el.append(btn);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, actionLabel ? 5000 : 2500);
}

// ---------- Ajustes ----------

const settingsForm = $('#settings-form');

function onReminded(date) {
  state.settings.lastReminderDate = date;
  save(state);
  notifications.syncShared(state);
}

function refreshReminder() {
  notifications.setupReminder(state, onReminded);
}

settingsForm.addEventListener('change', async (event) => {
  const { name } = event.target;
  const s = state.settings;
  if (name === 'monthlyBudget' || name === 'dailyLimit') {
    const raw = event.target.value.trim();
    const cents = raw ? parseAmount(raw) : 0;
    if (cents === null) {
      toast('Valor inválido. Use, por exemplo, 1.500,00');
      renderSettings();
      return;
    }
    s[name] = cents;
  }
  if (name === 'budgetAlerts' || name === 'reminderEnabled') {
    s[name] = event.target.checked;
    if (event.target.checked) {
      const perm = await notifications.requestPermission();
      if (perm !== 'granted') toast(perm === 'unsupported' ? 'Notificações não suportadas aqui — os avisos aparecerão dentro do app.' : 'Permissão de notificação negada.');
    }
  }
  if (name === 'reminderTime' && event.target.value) s.reminderTime = event.target.value;
  persist();
  renderSettings();
  refreshReminder();
  toast('Ajustes salvos.');
});
settingsForm.addEventListener('submit', (e) => e.preventDefault());

$('#test-notif').addEventListener('click', async () => {
  const ok = await notifications.notify('Tudo certo! 🔔', 'Você vai receber lembretes e alertas de orçamento por aqui.', 'test');
  if (!ok) toast('Não foi possível enviar a notificação.');
});

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('#export-csv').addEventListener('click', () => {
  if (!state.expenses.length) return toast('Ainda não há gastos para exportar.');
  // BOM para o Excel reconhecer acentos.
  download(`gastos-${todayISO()}.csv`, `﻿${toCSV(state.expenses)}`, 'text/csv;charset=utf-8');
});

$('#export-json').addEventListener('click', () => {
  download(`backup-gastos-${todayISO()}.json`, JSON.stringify({ version: 1, ...state }, null, 2), 'application/json');
});

$('#import-json').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const { expenses, settings } = parseBackup(await file.text());
    if (!confirm(`Restaurar ${expenses.length} gasto(s)? Os dados atuais serão substituídos.`)) return;
    state.expenses = expenses;
    if (settings) state.settings = { ...state.settings, ...settings };
    persist();
    render();
    refreshReminder();
    toast('Backup restaurado.');
  } catch (err) {
    toast(`Arquivo inválido: ${err.message}`);
  }
});

$('#clear-data').addEventListener('click', () => {
  if (!state.expenses.length) return toast('Não há gastos para apagar.');
  if (!confirm('Apagar TODOS os gastos? Essa ação não pode ser desfeita (faça um backup antes).')) return;
  state.expenses = [];
  persist();
  render();
  toast('Todos os gastos foram apagados.');
});

// ---------- Navegação e inicialização ----------

document.addEventListener('click', (event) => {
  const tab = event.target.closest('.tabbar button');
  if (tab) return showView(tab.dataset.view);
  const edit = event.target.closest('[data-edit]');
  if (edit) return openExpense({ id: edit.dataset.edit });
  const quick = event.target.closest('[data-quick]');
  if (quick) return openExpense({ category: quick.dataset.quick });
  const shift = event.target.closest('[data-month-shift]');
  if (shift) {
    ui.month = shiftMonth(ui.month, Number(shift.dataset.monthShift));
    ui.historyCategory = '';
    return render();
  }
  const filter = event.target.closest('[data-filter]');
  if (filter) {
    ui.historyCategory = filter.dataset.filter;
    return renderHistory();
  }
});

$('#fab').addEventListener('click', () => openExpense());

// Ao voltar para o app (ex.: virou o dia), atualiza a tela e confere o lembrete.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    render();
    refreshReminder();
  }
});

buildFormOptions();
showView('today');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(refreshReminder).catch((err) => {
    console.warn('Service worker não registrado', err);
    refreshReminder();
  });
} else {
  refreshReminder();
}

// Atalho "Novo gasto" (ícone do app / clique na notificação).
const params = new URLSearchParams(location.search);
if (params.has('novo')) {
  history.replaceState(null, '', location.pathname);
  openExpense();
}
