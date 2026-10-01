import {
  CATEGORIES, PAYMENT_METHODS, getCategory, getPaymentMethod, formatBRL, digitsToCents, parseAmount,
  todayISO, addDays, monthKey, shiftMonth, formatMonthLabel, formatDayLabel, parseISODate,
  sumCents, filterByDay, filterByMonth, sortExpenses, groupByDay, totalsByCategory, lastNDaysTotals,
  dailyAverage, monthProjection, budgetStatus, crossedThresholds, validateExpense, newId, toCSV, parseBackup,
  nearbyHistoryPlaces, totalsByPlace, normalizePlace, formatDistance, totalsByPerson,
} from './core.js';
import { load, save } from './storage.js';
import * as notifications from './notifications.js';
import * as places from './places.js';
import * as sync from './sync.js';

const state = load();
const ui = { view: 'today', month: monthKey(todayISO()), historyCategory: '', editingId: null, place: null, position: null, autoCategory: false };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Conta compartilhada (Firebase). Sem casa ativa, o app usa só os dados deste aparelho.
const shared = {
  status: sync.isConfigured() ? 'loading' : 'off', // off | loading | signedOut | noHouse | house
  user: null,
  hid: null,
  household: null,
  members: [],
  expenses: [],
  loaded: false,
  windowStart: '',
  unsubs: [],
};

const isShared = () => shared.status === 'house';
const expenses = () => (isShared() ? shared.expenses : pendingHouse() ? [] : state.expenses);
// Orçamento: na conta compartilhada vale o da casa; no aparelho, o dos ajustes locais.
const budget = () => (isShared() && shared.household
  ? { monthlyBudget: shared.household.monthlyBudget || 0, dailyLimit: shared.household.dailyLimit || 0 }
  : { monthlyBudget: state.settings.monthlyBudget, dailyLimit: state.settings.dailyLimit });
const viewState = () => ({ expenses: expenses(), settings: state.settings });
const memberNames = () => Object.fromEntries(shared.members.map((m) => [m.uid, m.name]));

function persist() {
  if (!save(state)) toast('Não foi possível salvar no aparelho. Verifique o espaço disponível.');
  notifications.syncShared(viewState());
}

function syncError(err) {
  console.warn(err);
  toast(sync.errorMessage(err));
}

// Grava um gasto novo ou editado na fonte de dados atual.
function storeExpense(expense) {
  if (isShared()) {
    sync.saveExpense(shared.hid, expense).catch(syncError);
    // O Firestore aplica na hora no aparelho; o snapshot atualiza a tela. Atualizamos já para não piscar.
    const i = shared.expenses.findIndex((e) => e.id === expense.id);
    if (i >= 0) shared.expenses[i] = { ...expense };
    else shared.expenses.push({ createdBy: shared.user.uid, createdByName: shared.user.name, ...expense });
    return;
  }
  const existing = state.expenses.find((e) => e.id === expense.id);
  if (existing) {
    Object.assign(existing, expense);
    if (!expense.place) delete existing.place;
  } else {
    state.expenses.push(expense);
  }
  persist();
}

function removeExpense(id) {
  const list = expenses();
  const index = list.findIndex((e) => e.id === id);
  if (index < 0) return null;
  const [removed] = list.splice(index, 1);
  if (isShared()) sync.deleteExpense(shared.hid, id).catch(syncError);
  else persist();
  return removed;
}

// ---------- Renderização ----------

function itemHTML(e, { showDate = false } = {}) {
  const cat = getCategory(e.category);
  const pay = getPaymentMethod(e.payment);
  const title = e.note || e.place?.name || cat.label;
  const meta = [
    title !== cat.label ? cat.label : null,
    e.place?.name && e.place.name !== title ? `📍 ${e.place.name}` : null,
    showDate ? formatDayLabel(e.date) : null,
    pay?.label,
    isShared() && e.createdBy && e.createdBy !== shared.user?.uid ? `👤 ${memberNames()[e.createdBy] ?? e.createdByName}` : null,
  ].filter(Boolean).join(' · ');
  return `<li><button class="item" data-edit="${escapeHTML(e.id)}">
    <span class="dot" style="background:${cat.color}22">${cat.emoji}</span>
    <span class="info"><strong>${escapeHTML(title)}</strong><small>${escapeHTML(meta) || '&nbsp;'}</small></span>
    <span class="value">${formatBRL(e.amount)}</span>
  </button></li>`;
}

function renderToday() {
  const today = todayISO();
  const todays = sortExpenses(filterByDay(expenses(), today));
  const month = filterByMonth(expenses(), monthKey(today));
  const todayTotal = sumCents(todays);
  const monthTotal = sumCents(month);

  $('#today-total').textContent = formatBRL(todayTotal);
  $('#month-total').textContent = formatBRL(monthTotal);
  $('#month-avg').textContent = formatBRL(dailyAverage(expenses(), monthKey(today), today));
  $('#hero-label').textContent = isShared() ? `Gasto hoje · ${shared.household?.name ?? 'casa'}` : 'Gasto hoje';

  const { dailyLimit, monthlyBudget } = budget();
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
    : (isShared() && !shared.loaded) || pendingHouse() ? '<li class="empty">Sincronizando…</li>' : '<li class="empty">Nenhum pagamento hoje ainda.<br>Toque em uma categoria acima ou no <b>+</b> para registrar.</li>';
}

function renderMonthNav() {
  for (const el of $$('.month-label')) el.textContent = formatMonthLabel(ui.month);
  for (const btn of $$('[data-month-shift="1"]')) btn.disabled = ui.month >= monthKey(todayISO());
}

function renderHistory() {
  renderMonthNav();
  const used = new Set(filterByMonth(expenses(), ui.month).map((e) => e.category));
  $('#history-filter').innerHTML = [
    `<button class="chip ${ui.historyCategory ? '' : 'active'}" data-filter="">Todas</button>`,
    ...CATEGORIES.filter((c) => used.has(c.id)).map(
      (c) => `<button class="chip ${ui.historyCategory === c.id ? 'active' : ''}" data-filter="${c.id}">${c.emoji} ${c.label}</button>`,
    ),
  ].join('');

  let list = filterByMonth(expenses(), ui.month);
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
  const month = filterByMonth(expenses(), ui.month);
  const total = sumCents(month);
  const isCurrent = ui.month === monthKey(today);

  $('#sum-total').textContent = formatBRL(total);
  $('#sum-avg').textContent = formatBRL(dailyAverage(expenses(), ui.month, today));
  $('#sum-count').textContent = String(month.length);
  $('#sum-proj-label').textContent = isCurrent ? 'Projeção do mês' : 'Maior categoria';
  if (isCurrent) {
    $('#sum-proj').textContent = formatBRL(monthProjection(expenses(), ui.month, today));
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

  const people = isShared() && shared.members.length > 1 ? totalsByPerson(month, memberNames()) : [];
  $('#sum-people-card').hidden = !people.length;
  $('#sum-people').innerHTML = people.map((pp) => `<li>
      <div class="bar-head"><span>👤 ${escapeHTML(pp.uid === shared.user?.uid ? `${pp.name} (você)` : pp.name)} <small class="muted">(${pp.count}x)</small></span><span>${formatBRL(pp.total)} · ${Math.round((pp.total / total) * 100)}%</span></div>
      <div class="meter"><div style="width:${((pp.total / total) * 100).toFixed(1)}%;background:var(--primary)"></div></div>
    </li>`).join('');

  const topPlaces = totalsByPlace(month).slice(0, 5);
  $('#sum-places-card').hidden = !topPlaces.length;
  $('#sum-places').innerHTML = topPlaces.map((pl) => `<li>
      <div class="bar-head"><span>📍 ${escapeHTML(pl.name)} <small class="muted">(${pl.count}x)</small></span><span>${formatBRL(pl.total)}</span></div>
      <div class="meter"><div style="width:${((pl.total / topPlaces[0].total) * 100).toFixed(1)}%;background:var(--primary)"></div></div>
    </li>`).join('');

  const end = isCurrent ? today : addDays(`${shiftMonth(ui.month, 1)}-01`, -1);
  const week = lastNDaysTotals(expenses(), end, 7);
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
  const b = budget();
  // Não sobrescreve um campo que está sendo digitado (a casa pode atualizar a tela a qualquer momento).
  const setValue = (input, value) => { if (document.activeElement !== input) input.value = value; };
  setValue(form.monthlyBudget, b.monthlyBudget ? formatBRL(b.monthlyBudget).replace('R$ ', '') : '');
  setValue(form.dailyLimit, b.dailyLimit ? formatBRL(b.dailyLimit).replace('R$ ', '') : '');
  form.budgetAlerts.checked = s.budgetAlerts;
  form.autoPlace.checked = s.autoPlace;
  form.reminderEnabled.checked = s.reminderEnabled;
  form.reminderTime.value = s.reminderTime;
  $('#budget-scope').textContent = isShared() ? 'Vale para todos da casa.' : '';
  $('#budget-scope').hidden = !isShared();
  $('#clear-data').hidden = isShared(); // na conta compartilhada, apagar tudo afetaria a outra pessoa
  $('#data-hint').textContent = isShared()
    ? 'Os gastos ficam na conta compartilhada e também guardados neste aparelho para uso offline.'
    : 'Tudo fica salvo só neste aparelho. Faça backup de vez em quando.';
  renderNotifStatus();
  renderAccount();
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
  const existing = id ? expenses().find((e) => e.id === id) : null;
  form.reset();
  for (const el of $$('[data-error]')) el.textContent = '';
  $('#expense-title').textContent = existing ? 'Editar gasto' : 'Novo gasto';
  $('#delete-expense').hidden = !existing;

  const lastPayment = sortExpenses(expenses())[0]?.payment;
  const data = existing ?? { amount: 0, category, note: '', date: todayISO(), payment: lastPayment ?? 'pix' };
  setAmount(data.amount);
  form.note.value = data.note ?? '';
  form.date.value = data.date;
  form.date.max = todayISO();
  const cat = form.querySelector(`input[name="category"][value="${data.category}"]`);
  if (cat) cat.checked = true;
  const pay = form.querySelector(`input[name="payment"][value="${data.payment}"]`);
  if (pay) pay.checked = true;
  resetPlace(existing?.place ?? null);
  ui.autoCategory = !data.category;

  dialog.showModal();
  if (!existing && state.settings.autoPlace) suggestFromHistory();
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
  const { budgetAlerts } = state.settings;
  const { monthlyBudget, dailyLimit } = budget();
  if (!budgetAlerts) return;
  const messages = [];
  for (const t of crossedThresholds(before.month, after.month, monthlyBudget)) {
    messages.push(t >= 1
      ? ['Orçamento do mês estourado 🚨', `${isShared() ? 'A casa já gastou' : 'Você já gastou'} ${formatBRL(after.month)} de ${formatBRL(monthlyBudget)}.`]
      : ['80% do orçamento usado ⚠️', `Restam ${formatBRL(monthlyBudget - after.month)} para o resto do mês.`]);
  }
  if (date === todayISO() && crossedThresholds(before.day, after.day, dailyLimit).includes(1)) {
    messages.push(['Limite diário atingido', `Hoje ${isShared() ? 'a casa já gastou' : 'você já gastou'} ${formatBRL(after.day)} (limite ${formatBRL(dailyLimit)}).`]);
  }
  for (const [title, body] of messages) {
    const sent = await notifications.notify(title, body, `budget-${title}`);
    if (!sent) toast(`${title} — ${body}`);
  }
}

function totalsFor(date, list = expenses()) {
  return { month: sumCents(filterByMonth(list, monthKey(date))), day: sumCents(filterByDay(list, date)) };
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
  const existing = ui.editingId ? expenses().find((e) => e.id === ui.editingId) : null;
  const expense = {
    id: existing?.id ?? newId(),
    amount: amountCents,
    category: form.querySelector('input[name="category"]:checked')?.value ?? '',
    note: form.note.value.trim(),
    date: form.date.value,
    payment: form.querySelector('input[name="payment"]:checked')?.value ?? '',
    createdAt: existing?.createdAt ?? Date.now(),
  };
  // Na conta compartilhada, editar não muda quem registrou.
  if (existing?.createdBy) Object.assign(expense, { createdBy: existing.createdBy, createdByName: existing.createdByName });
  const place = currentPlace();
  if (place) expense.place = place;
  const errors = validateExpense(expense);
  for (const el of $$('[data-error]')) el.textContent = errors[el.dataset.error] ?? '';
  if (Object.keys(errors).length) return;
  if (pendingHouse()) return toast('Conectando à conta compartilhada… tente salvar de novo em instantes.');

  const before = totalsFor(expense.date);
  storeExpense(expense);
  const after = totalsFor(expense.date);
  closeExpense();
  render();
  toast(existing ? 'Gasto atualizado.' : `${getCategory(expense.category).emoji} ${formatBRL(expense.amount)} registrado.`);
  if (!existing) checkBudgetAlerts(before, after, expense.date);
});

$('#delete-expense').addEventListener('click', () => {
  const removed = removeExpense(ui.editingId);
  if (!removed) return;
  closeExpense();
  render();
  toast('Gasto excluído.', 'Desfazer', () => {
    storeExpense(removed);
    render();
  });
});

dialog.addEventListener('click', (event) => {
  if (event.target === dialog || event.target.closest('[data-close]')) closeExpense();
});

// ---------- Local do gasto ----------

let placeRequest = 0; // descarta respostas de buscas antigas
let suggestions = { history: [], osm: [] };

function placeStatus(text) {
  const el = $('#place-status');
  el.textContent = text ?? '';
  el.hidden = !text;
}

function resetPlace(place) {
  placeRequest++;
  ui.place = place;
  ui.position = null;
  suggestions = { history: [], osm: [] };
  form.placeName.value = place?.name ?? '';
  placeStatus('');
  $('#place-suggestions').hidden = true;
  $('#place-suggestions').innerHTML = '';
  $('#locate').disabled = !places.isSupported();
}

// O nome pode ter sido digitado ou editado: mantém as coordenadas conhecidas daquele momento.
function currentPlace() {
  const name = form.placeName.value.trim();
  if (!name) return null;
  const coords = ui.place?.lat != null ? ui.place : ui.position;
  return normalizePlace({ name, lat: coords?.lat, lon: coords?.lon, address: ui.place?.name === name ? ui.place.address : '' });
}

function suggestionHTML(p, index, source) {
  const cat = p.category ? getCategory(p.category) : null;
  const details = [
    cat?.label,
    formatDistance(p.distance),
    source === 'history' ? `${p.count}x aqui` : p.address,
  ].filter(Boolean).join(' · ');
  return `<li><button type="button" class="suggestion" data-place="${source}:${index}">
    <span>${cat?.emoji ?? '📍'}</span>
    <span class="info"><strong>${escapeHTML(p.name)}</strong><small>${escapeHTML(details)}</small></span>
  </button></li>`;
}

function renderSuggestions() {
  const { history, osm } = suggestions;
  const box = $('#place-suggestions');
  let html = '';
  if (history.length) {
    html += `<p class="suggest-title">Já usados aqui</p><ul class="suggestions">${history.map((p, i) => suggestionHTML(p, i, 'history')).join('')}</ul>`;
  }
  if (osm.length) {
    html += `<p class="suggest-title">Por perto</p><ul class="suggestions">${osm.map((p, i) => suggestionHTML(p, i, 'osm')).join('')}</ul>
      <p class="osm-credit">Dados © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">colaboradores do OpenStreetMap</a></p>`;
  }
  box.innerHTML = html;
  box.hidden = !html;
}

function selectPlace(source, index) {
  const p = suggestions[source]?.[index];
  if (!p) return;
  ui.place = { name: p.name, lat: p.lat, lon: p.lon, address: p.address };
  form.placeName.value = p.name;
  // Sugere a categoria só se o usuário ainda não escolheu uma manualmente.
  const checked = form.querySelector('input[name="category"]:checked');
  if (p.category && (!checked || ui.autoCategory)) {
    form.querySelector(`input[name="category"][value="${p.category}"]`).checked = true;
    ui.autoCategory = true;
    $('[data-error="category"]').textContent = '';
  }
  if (source === 'history' && p.note && !form.note.value.trim()) form.note.value = p.note;
  $('#place-suggestions').hidden = true;
  placeStatus('');
}

async function locate({ searchOSM }) {
  const request = ++placeRequest;
  const stale = () => request !== placeRequest || !dialog.open;
  $('#locate').disabled = true;
  suggestions = { history: [], osm: [] };
  renderSuggestions();
  placeStatus('Obtendo sua localização…');
  try {
    const position = await places.getPosition();
    if (stale()) return;
    ui.position = position;
    suggestions.history = nearbyHistoryPlaces(expenses(), position).slice(0, 3);
    renderSuggestions();
    const imprecise = position.accuracy > 300 ? `Localização imprecisa (±${formatDistance(position.accuracy)}).` : '';
    if (!searchOSM) {
      placeStatus(suggestions.history.length ? imprecise : '');
      return;
    }
    placeStatus(`Buscando lugares por perto… ${imprecise}`);
    const known = new Set(suggestions.history.map((p) => p.name.toLowerCase()));
    const found = await places.searchNearby(position);
    if (stale()) return;
    suggestions.osm = found.filter((p) => !known.has(p.name.toLowerCase())).slice(0, 8);
    renderSuggestions();
    placeStatus(suggestions.history.length || suggestions.osm.length
      ? imprecise
      : 'Nenhum estabelecimento encontrado aqui. Digite o nome do local — a posição será salva junto.');
  } catch (err) {
    if (!stale()) placeStatus(err.message);
  } finally {
    if (request === placeRequest) $('#locate').disabled = false;
  }
}

// Com a opção ligada: sugere lugares do histórico sem usar a internet.
async function suggestFromHistory() {
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    if (perm && perm.state !== 'granted') return; // não abre pedido de permissão sozinho
  } catch { /* navegador sem Permissions API: segue */ }
  locate({ searchOSM: false });
}

$('#locate').addEventListener('click', () => locate({ searchOSM: true }));
$('#place-suggestions').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-place]');
  if (!btn) return;
  const [source, index] = btn.dataset.place.split(':');
  selectPlace(source, Number(index));
});
// Escolher a categoria manualmente impede que uma sugestão de lugar a substitua.
$('#category-grid').addEventListener('change', () => { ui.autoCategory = false; });

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
  notifications.syncShared(viewState());
}

function refreshReminder() {
  notifications.setupReminder(viewState(), onReminded);
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
    if (isShared()) {
      shared.household[name] = cents;
      sync.updateHouseholdSettings(shared.hid, { [name]: cents }).catch(syncError);
    } else {
      s[name] = cents;
    }
  }
  if (name === 'autoPlace') {
    s.autoPlace = event.target.checked;
    // Pede a permissão agora, para a sugestão automática funcionar depois.
    if (s.autoPlace) places.getPosition().catch((err) => toast(err.message));
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

// Na conta compartilhada, exporta todos os gastos da casa (não só os carregados na tela).
async function allExpensesForExport() {
  if (!isShared()) return state.expenses;
  try {
    return await sync.fetchAllExpenses(shared.hid);
  } catch {
    toast('Sem conexão: exportando só os gastos já carregados neste aparelho.');
    return shared.expenses;
  }
}

$('#export-csv').addEventListener('click', async () => {
  const list = await allExpensesForExport();
  if (!list.length) return toast('Ainda não há gastos para exportar.');
  // BOM para o Excel reconhecer acentos.
  download(`gastos-${todayISO()}.csv`, `\ufeff${toCSV(list)}`, 'text/csv;charset=utf-8');
});

$('#export-json').addEventListener('click', async () => {
  const list = await allExpensesForExport();
  const settings = { ...state.settings, ...budget() };
  download(`backup-gastos-${todayISO()}.json`, JSON.stringify({ version: 1, expenses: list, settings }, null, 2), 'application/json');
});

$('#import-json').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const backup = parseBackup(await file.text());
    if (isShared()) {
      // Na conta compartilhada só adiciona (ou atualiza) gastos; não apaga os da outra pessoa.
      if (!confirm(`Adicionar ${backup.expenses.length} gasto(s) do backup à conta compartilhada?`)) return;
      await sync.uploadExpenses(shared.hid, backup.expenses);
      toast('Backup enviado para a conta compartilhada.');
      return;
    }
    if (!confirm(`Restaurar ${backup.expenses.length} gasto(s)? Os dados atuais serão substituídos.`)) return;
    state.expenses = backup.expenses;
    if (backup.settings) {
      // Preferências da conta compartilhada são do aparelho; não vêm do backup.
      const { householdId, householdUid, migratedTo, pendingInvite, ...rest } = backup.settings;
      state.settings = { ...state.settings, ...rest };
    }
    persist();
    render();
    refreshReminder();
    toast('Backup restaurado.');
  } catch (err) {
    toast(err.code ? sync.errorMessage(err) : `Arquivo inválido: ${err.message}`);
  }
});

$('#clear-data').addEventListener('click', () => {
  if (isShared()) return;
  if (!state.expenses.length) return toast('Não há gastos para apagar.');
  if (!confirm('Apagar TODOS os gastos? Essa ação não pode ser desfeita (faça um backup antes).')) return;
  state.expenses = [];
  persist();
  render();
  toast('Todos os gastos foram apagados.');
});

// ---------- Conta compartilhada ----------

const accountBox = $('#account-box');
const account = { tab: 'signin', busy: false, error: '', lastHTML: '' };

const initials = (name) => String(name).trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
const inviteLink = (code) => `${location.origin}${location.pathname}?convite=${code}`;
// Casa salva neste aparelho mas o SDK ainda carregando: não mostra os gastos locais por engano.
const pendingHouse = () => shared.status === 'loading' && Boolean(state.settings.householdId);

function renderAccount() {
  if (shared.status === 'off') {
    accountBox.hidden = true;
    return;
  }
  accountBox.hidden = false;
  const err = account.error ? `<p class="error">${escapeHTML(account.error)}</p>` : '';
  const busy = account.busy ? 'disabled' : '';
  const invite = state.settings.pendingInvite;
  let html = '<h2 class="card-title">Conta compartilhada</h2>';

  if (shared.status === 'loading') {
    html += '<p class="hint">Conectando…</p>';
  } else if (shared.status === 'signedOut') {
    const signup = account.tab === 'signup';
    html += invite
      ? '<div class="banner">📩 Você recebeu um convite para dividir os gastos. Entre ou crie sua conta para participar.</div>'
      : '<p class="hint">Entre para dividir os gastos com outra pessoa: vocês veem e registram na mesma conta, em tempo real.</p>';
    html += `<div class="tabs">
        <button type="button" class="chip ${signup ? '' : 'active'}" data-account="tab-signin">Entrar</button>
        <button type="button" class="chip ${signup ? 'active' : ''}" data-account="tab-signup">Criar conta</button>
      </div>
      <form data-account-form="${signup ? 'signup' : 'signin'}" novalidate>
        ${signup ? '<label>Seu nome<input name="name" autocomplete="name" maxlength="40" placeholder="Como a outra pessoa vai ver você"></label>' : ''}
        <label>E-mail<input name="email" type="email" autocomplete="email" inputmode="email"></label>
        <label>Senha<input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="${signup ? 'Pelo menos 6 caracteres' : ''}"></label>
        ${err}
        <button class="btn primary" ${busy}>${signup ? 'Criar conta' : 'Entrar'}</button>
        ${signup ? '' : '<button type="button" class="link-btn" data-account="reset">Esqueci a senha</button>'}
      </form>`;
  } else if (shared.status === 'noHouse') {
    const join = `<form data-account-form="join" novalidate>
        <label>Tenho um código de convite<input name="code" value="${escapeHTML(invite)}" autocomplete="off" autocapitalize="characters" placeholder="Ex.: K7QX2M9PLA"></label>
        <button class="btn ${invite ? 'primary' : 'secondary'}" ${busy}>Entrar na casa</button>
      </form>`;
    const create = `<form data-account-form="create" novalidate>
        <label>${invite ? 'Ou crie uma nova casa' : 'Crie a sua casa e depois convide a outra pessoa'}<input name="name" maxlength="40" placeholder="Ex.: Nossa casa"></label>
        <button class="btn ${invite ? 'secondary' : 'primary'}" ${busy}>Criar casa</button>
      </form>`;
    html += `<p>Olá, <b>${escapeHTML(shared.user.name)}</b>! ${invite ? 'Confirme o convite para entrar na casa.' : ''}</p>
      ${err}${invite ? join + create : create + join}
      <button type="button" class="link-btn" data-account="logout">Sair da conta (${escapeHTML(shared.user.email ?? '')})</button>`;
  } else if (shared.status === 'house') {
    const h = shared.household;
    const me = shared.user.uid;
    const members = [...shared.members].sort((a, b) => (a.uid === me ? -1 : b.uid === me ? 1 : a.name.localeCompare(b.name)));
    const otherInvite = invite && h && invite !== h.inviteCode;
    html += `<div class="house"><span>🏠</span><div><strong>${escapeHTML(h?.name ?? 'Carregando…')}</strong>
        <small class="muted">${members.length ? `${members.length} pessoa${members.length === 1 ? '' : 's'} · gastos sincronizados` : 'Conectando…'}</small></div></div>
      <ul class="members">${members.map((m) => `<li><span class="avatar">${escapeHTML(initials(m.name))}</span>${escapeHTML(m.name)}${m.uid === me ? ' <small class="muted">(você)</small>' : ''}</li>`).join('')}</ul>
      ${otherInvite ? `<div class="banner">📩 Você abriu um convite para outra casa.<br><button type="button" class="link-btn" data-account="switch">Trocar para a casa do convite</button> · <button type="button" class="link-btn" data-account="dismiss-invite">Ignorar</button></div>` : ''}
      ${h ? `<p class="hint">${members.length > 1 ? 'Para convidar mais alguém' : 'Convide quem vai dividir os gastos com você'}, envie o link. Código:</p>
      <p class="invite-code">${escapeHTML(h.inviteCode)}</p>
      <div class="row-actions">
        <button type="button" class="btn primary" data-account="share">Enviar convite</button>
        <button type="button" class="btn secondary" data-account="copy">Copiar link</button>
      </div>` : ''}
      <label class="switch" style="margin-top:12px"><input type="checkbox" data-account="partner-alerts" ${state.settings.partnerAlerts ? 'checked' : ''}> Avisar quando outra pessoa registrar um gasto</label>
      ${err}
      <button type="button" class="link-btn" data-account="new-invite">Gerar novo código (o link antigo para de funcionar)</button>
      <div class="row-actions">
        <button type="button" class="btn danger" data-account="leave">Sair da casa</button>
        <button type="button" class="btn secondary" data-account="logout">Sair da conta</button>
      </div>`;
  }
  // Só redesenha se algo mudou e mantém o que já foi digitado (ex.: ao mostrar um erro).
  if (html === account.lastHTML) return;
  const fieldKey = (input) => (input.name === 'email' ? 'email' : `${input.form?.dataset.accountForm}:${input.name}`);
  const typed = new Map();
  for (const input of accountBox.querySelectorAll('input[name]')) {
    if (input.value) typed.set(fieldKey(input), input.value);
  }
  accountBox.innerHTML = html;
  account.lastHTML = html;
  for (const input of accountBox.querySelectorAll('input[name]')) {
    if (typed.has(fieldKey(input))) input.value = typed.get(fieldKey(input));
  }
}

function setAccount(patch) {
  Object.assign(account, patch);
  renderAccount();
}

// Mostra a tela certa depois de qualquer mudança de conta/casa.
function refreshAll() {
  render();
  if (ui.view !== 'settings') renderAccount();
  refreshReminder();
}

async function onUser(user) {
  shared.user = user;
  account.error = '';
  account.tab = 'signin'; // ao sair da conta, volta para "Entrar"
  if (!user) {
    detach();
    shared.status = 'signedOut';
    refreshAll();
    return;
  }
  const cached = state.settings.householdUid === user.uid ? state.settings.householdId : '';
  if (cached) {
    attach(cached);
    return;
  }
  shared.status = 'loading';
  renderAccount();
  let hid = null;
  try {
    hid = await sync.getUserHousehold();
  } catch (err) {
    account.error = sync.errorMessage(err);
  }
  if (shared.user?.uid !== user.uid) return; // trocou de conta no meio do caminho
  if (hid) {
    attach(hid);
  } else {
    shared.status = 'noHouse';
    refreshAll();
    if (state.settings.pendingInvite) showView('settings');
  }
}

function desiredWindowStart() {
  // Últimos 12 meses ou o mês que estiver aberto no histórico, o que for mais antigo.
  const recent = `${shiftMonth(monthKey(todayISO()), -11)}-01`;
  const viewed = `${ui.month}-01`;
  return viewed < recent ? viewed : recent;
}

function subscribeExpenses() {
  shared.expensesUnsub?.();
  shared.windowStart = desiredWindowStart();
  shared.expensesUnsub = sync.watchExpenses(shared.hid, shared.windowStart, (list, { added }) => {
    const before = shared.expenses;
    shared.expenses = list;
    shared.loaded = true;
    onRemoteAdded(added, before);
    render();
    notifications.syncShared(viewState());
  }, onWatchError);
}

function ensureWindow() {
  if (isShared() && desiredWindowStart() < shared.windowStart) subscribeExpenses();
}

function attach(hid, { justJoined = false } = {}) {
  detach(false);
  shared.hid = hid;
  shared.status = 'house';
  state.settings.householdId = hid;
  state.settings.householdUid = shared.user.uid;
  save(state);
  shared.unsubs.push(sync.watchHousehold(hid, ({ household, members }) => {
    shared.household = household;
    shared.members = members;
    render();
  }, onWatchError));
  subscribeExpenses();
  refreshAll();
  if (justJoined) offerMigration(hid);
}

function detach(forget = true) {
  shared.expensesUnsub?.();
  shared.expensesUnsub = null;
  for (const unsub of shared.unsubs) unsub();
  shared.unsubs = [];
  Object.assign(shared, { hid: null, household: null, members: [], expenses: [], loaded: false, windowStart: '' });
  if (forget) {
    state.settings.householdId = '';
    state.settings.householdUid = '';
    save(state);
  }
}

function onWatchError(err) {
  if (err?.code === 'permission-denied' && isShared()) {
    // Saiu da casa por outro aparelho (ou a casa não existe mais).
    detach();
    shared.status = 'noHouse';
    toast('Você não faz parte desta casa. Entre com um convite ou crie outra.');
    refreshAll();
    return;
  }
  syncError(err);
}

// Gastos que chegaram do servidor, registrados por outra pessoa.
function onRemoteAdded(added, before) {
  const others = added.filter((e) => e.createdBy && e.createdBy !== shared.user?.uid);
  if (!others.length) return;
  if (state.settings.partnerAlerts) {
    const names = memberNames();
    const visible = document.visibilityState === 'visible';
    const messages = others.length <= 3
      ? others.map((e) => {
        const cat = getCategory(e.category);
        return [`${names[e.createdBy] ?? e.createdByName} registrou um gasto`, `${cat.emoji} ${formatBRL(e.amount)} em ${cat.label}${e.note ? ` — ${e.note}` : ''}`, `partner-${e.id}`];
      })
      : [[`${others.length} novos gastos na casa`, `Total de ${formatBRL(sumCents(others))}. Toque para ver.`, 'partner-many']];
    for (const [title, body, tag] of messages) {
      // Com o app aberto, aviso dentro do app; em segundo plano, notificação do celular.
      if (visible) toast(`${title}: ${body}`);
      else notifications.notify(title, body, tag).then((sent) => { if (!sent) toast(`${title}: ${body}`); });
    }
  }
  const today = todayISO();
  checkBudgetAlerts(totalsFor(today, before), totalsFor(today, shared.expenses), today);
}

async function offerMigration(hid) {
  const local = state.expenses;
  if (!local.length || state.settings.migratedTo === hid) return;
  if (!confirm(`Enviar os ${local.length} gasto(s) que já estão neste aparelho para a conta compartilhada?`)) return;
  try {
    await sync.uploadExpenses(hid, local);
    state.settings.migratedTo = hid;
    save(state);
    toast(`${local.length} gasto(s) enviados para a casa.`);
  } catch (err) {
    syncError(err);
  }
}

async function runAccount(task) {
  setAccount({ busy: true, error: '' });
  try {
    await task();
    setAccount({ busy: false });
  } catch (err) {
    console.warn(err);
    setAccount({ busy: false, error: sync.errorMessage(err) });
  }
}

accountBox.addEventListener('submit', (event) => {
  event.preventDefault();
  const f = event.target;
  const kind = f.dataset.accountForm;
  const value = (name) => f.elements[name]?.value.trim() ?? '';
  if (kind === 'signin') {
    runAccount(() => sync.signIn(value('email'), f.elements.password.value));
  } else if (kind === 'signup') {
    if (!value('name')) return setAccount({ error: 'Informe seu nome.' });
    runAccount(async () => {
      const user = await sync.signUp(value('name'), value('email'), f.elements.password.value);
      // O aviso de login chega antes de o nome ser salvo: atualiza só o nome.
      if (shared.user?.uid === user.uid) shared.user.name = user.name;
      account.lastHTML = ''; // força redesenhar com o nome
    });
  } else if (kind === 'join') {
    runAccount(async () => {
      const hid = await sync.joinHousehold(value('code'));
      state.settings.pendingInvite = '';
      attach(hid, { justJoined: true });
      toast('Pronto! Agora vocês compartilham os gastos.');
    });
  } else if (kind === 'create') {
    runAccount(async () => {
      const hid = await sync.createHousehold(value('name'), state.settings);
      attach(hid, { justJoined: true });
      toast('Casa criada. Agora envie o convite para a outra pessoa.');
    });
  }
});

accountBox.addEventListener('change', (event) => {
  if (event.target.dataset.account === 'partner-alerts') {
    state.settings.partnerAlerts = event.target.checked;
    save(state);
    if (event.target.checked) notifications.requestPermission();
  }
});

async function shareInvite() {
  const url = inviteLink(shared.household.inviteCode);
  const text = `Vamos controlar nossos gastos juntos? Abra o link, crie sua conta e entre na casa “${shared.household.name}”.`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Convite — Controle de Gastos', text, url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  copyInvite();
}

async function copyInvite() {
  const url = inviteLink(shared.household.inviteCode);
  try {
    await navigator.clipboard.writeText(url);
    toast('Link do convite copiado.');
  } catch {
    prompt('Copie o link do convite:', url);
  }
}

accountBox.addEventListener('click', (event) => {
  const action = event.target.closest('[data-account]')?.dataset.account;
  if (!action || action === 'partner-alerts') return;
  if (action === 'tab-signin' || action === 'tab-signup') {
    setAccount({ tab: action.slice(4), error: '' });
  } else if (action === 'reset') {
    const email = accountBox.querySelector('input[name="email"]')?.value.trim();
    if (!email) return setAccount({ error: 'Digite seu e-mail acima e toque de novo em “Esqueci a senha”.' });
    runAccount(async () => {
      await sync.resetPassword(email);
      toast(`Enviamos um link para redefinir a senha para ${email}.`);
    });
  } else if (action === 'logout') {
    if (!confirm('Sair da conta neste aparelho? Os gastos compartilhados continuam salvos na conta.')) return;
    detach();
    runAccount(() => sync.logout());
  } else if (action === 'share') {
    shareInvite();
  } else if (action === 'copy') {
    copyInvite();
  } else if (action === 'new-invite') {
    if (!confirm('Gerar um novo código? O link enviado antes deixa de funcionar (quem já entrou continua na casa).')) return;
    runAccount(() => sync.regenerateInvite(shared.hid, shared.household.inviteCode));
  } else if (action === 'leave') {
    if (!confirm('Sair da casa? Você deixa de ver os gastos compartilhados; eles continuam para quem ficar.')) return;
    const hid = shared.hid;
    runAccount(async () => {
      await sync.leaveHousehold(hid);
      detach();
      shared.status = 'noHouse';
      refreshAll();
    });
  } else if (action === 'switch') {
    if (!confirm('Sair da casa atual e entrar na casa do convite?')) return;
    const hid = shared.hid;
    const code = state.settings.pendingInvite;
    runAccount(async () => {
      await sync.leaveHousehold(hid);
      detach();
      shared.status = 'noHouse';
      const newHid = await sync.joinHousehold(code);
      state.settings.pendingInvite = '';
      attach(newHid, { justJoined: true });
    });
  } else if (action === 'dismiss-invite') {
    state.settings.pendingInvite = '';
    save(state);
    renderAccount();
  }
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
    ensureWindow();
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

const params = new URLSearchParams(location.search);

// Link de convite: guarda o código até a pessoa entrar na conta.
if (params.has('convite')) {
  state.settings.pendingInvite = sync.normalizeCode(params.get('convite'));
  save(state);
  history.replaceState(null, '', location.pathname);
  if (sync.isConfigured()) showView('settings');
  else toast('Este app ainda não está com a conta compartilhada configurada.');
}

// Atalho "Novo gasto" (ícone do app / clique na notificação).
if (params.has('novo')) {
  history.replaceState(null, '', location.pathname);
  openExpense();
}

if (sync.isConfigured()) {
  sync.init(onUser).catch((err) => {
    console.warn('Conta compartilhada indisponível', err);
    shared.status = 'off';
    detach(false);
    toast('Não foi possível carregar a conta compartilhada. Usando os dados deste aparelho.');
    refreshAll();
  });
}
