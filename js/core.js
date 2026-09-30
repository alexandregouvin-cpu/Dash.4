// Lógica pura do app (sem DOM), testável com `node --test`.
// Valores são sempre guardados em centavos (inteiros) para evitar erros de arredondamento.

export const CATEGORIES = [
  { id: 'alimentacao', label: 'Alimentação', emoji: '🍽️', color: '#f97316' },
  { id: 'mercado', label: 'Mercado', emoji: '🛒', color: '#22c55e' },
  { id: 'combustivel', label: 'Combustível', emoji: '⛽', color: '#ef4444' },
  { id: 'transporte', label: 'Transporte', emoji: '🚌', color: '#3b82f6' },
  { id: 'saude', label: 'Saúde', emoji: '💊', color: '#14b8a6' },
  { id: 'casa', label: 'Casa e contas', emoji: '🏠', color: '#a855f7' },
  { id: 'lazer', label: 'Lazer', emoji: '🎉', color: '#ec4899' },
  { id: 'imprevistos', label: 'Imprevistos', emoji: '⚠️', color: '#eab308' },
  { id: 'outros', label: 'Outros', emoji: '📦', color: '#64748b' },
];

export const PAYMENT_METHODS = [
  { id: 'pix', label: 'Pix' },
  { id: 'debito', label: 'Débito' },
  { id: 'credito', label: 'Crédito' },
  { id: 'dinheiro', label: 'Dinheiro' },
];

const categoryById = new Map(CATEGORIES.map((c) => [c.id, c]));
const paymentById = new Map(PAYMENT_METHODS.map((p) => [p.id, p]));

export function getCategory(id) {
  return categoryById.get(id) ?? categoryById.get('outros');
}

export function getPaymentMethod(id) {
  return paymentById.get(id) ?? null;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatBRL(cents) {
  // Intl usa espaço não separável depois de "R$"; normalizamos para espaço comum.
  return brl.format((cents || 0) / 100).replace(/ /g, ' ');
}

// Converte o que foi digitado num campo "caixa registradora" em centavos:
// cada dígito empurra os anteriores para a esquerda ("1" → 0,01; "1234" → 12,34).
export function digitsToCents(text) {
  const digits = String(text ?? '').replace(/\D/g, '').replace(/^0+/, '').slice(0, 11);
  return digits ? parseInt(digits, 10) : 0;
}

// Aceita formatos livres: "12,34", "1.234,56", "12.5", "R$ 7". Retorna centavos ou null.
export function parseAmount(text) {
  let s = String(text ?? '').replace(/[^\d.,-]/g, '');
  if (!s || s.startsWith('-')) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // O último separador é o decimal; o outro é de milhar.
    const dec = lastComma > lastDot ? ',' : '.';
    const thousands = dec === ',' ? '.' : ',';
    s = s.split(thousands).join('').replace(dec, '.');
  } else if (lastComma > -1) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > -1 && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ''); // "1.234" → milhar
  }
  const value = Number(s);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

const pad = (n) => String(n).padStart(2, '0');

export function toISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO(now = new Date()) {
  return toISODate(now);
}

export function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, days) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function monthKey(iso) {
  return iso.slice(0, 7);
}

export function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function daysInMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function formatMonthLabel(key) {
  const label = parseISODate(`${key}-01`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatDayLabel(iso, today = todayISO()) {
  if (iso === today) return 'Hoje';
  if (iso === addDays(today, -1)) return 'Ontem';
  const label = parseISODate(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function sumCents(expenses) {
  return expenses.reduce((total, e) => total + e.amount, 0);
}

export function filterByDay(expenses, iso) {
  return expenses.filter((e) => e.date === iso);
}

export function filterByMonth(expenses, key) {
  return expenses.filter((e) => monthKey(e.date) === key);
}

export function sortExpenses(expenses) {
  return [...expenses].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

// Agrupa por dia, do mais recente para o mais antigo: [{ date, total, items }]
export function groupByDay(expenses) {
  const groups = new Map();
  for (const e of sortExpenses(expenses)) {
    if (!groups.has(e.date)) groups.set(e.date, []);
    groups.get(e.date).push(e);
  }
  return [...groups].map(([date, items]) => ({ date, total: sumCents(items), items }));
}

// Totais por categoria, do maior para o menor: [{ category, total, count, share }]
export function totalsByCategory(expenses) {
  const totals = new Map();
  for (const e of expenses) {
    const t = totals.get(e.category) ?? { total: 0, count: 0 };
    t.total += e.amount;
    t.count += 1;
    totals.set(e.category, t);
  }
  const grand = sumCents(expenses);
  return [...totals]
    .map(([id, t]) => ({ category: getCategory(id), ...t, share: grand ? t.total / grand : 0 }))
    .sort((a, b) => b.total - a.total);
}

// Totais dos últimos `n` dias terminando em `endISO`, do mais antigo ao mais recente.
export function lastNDaysTotals(expenses, endISO, n = 7) {
  const byDay = new Map();
  for (const e of expenses) byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.amount);
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(endISO, -i);
    days.push({ date, total: byDay.get(date) ?? 0 });
  }
  return days;
}

// Média diária do mês: no mês corrente divide pelos dias já passados; em meses fechados, pelo mês inteiro.
export function dailyAverage(expenses, key, today = todayISO()) {
  const elapsed = monthKey(today) === key ? Number(today.slice(8, 10)) : daysInMonth(key);
  if (key > monthKey(today)) return 0;
  return Math.round(sumCents(filterByMonth(expenses, key)) / elapsed);
}

// Projeção simples de fechamento do mês corrente com base na média diária.
export function monthProjection(expenses, key, today = todayISO()) {
  if (monthKey(today) !== key) return sumCents(filterByMonth(expenses, key));
  return dailyAverage(expenses, key, today) * daysInMonth(key);
}

export const BUDGET_THRESHOLDS = [0.8, 1];

export function budgetStatus(spent, budget) {
  if (!budget) return { ratio: 0, level: 'none', remaining: 0 };
  const ratio = spent / budget;
  const level = ratio >= 1 ? 'over' : ratio >= BUDGET_THRESHOLDS[0] ? 'warn' : 'ok';
  return { ratio, level, remaining: budget - spent };
}

// Quais limites (80%, 100%) foram ultrapassados ao passar de `before` para `after`.
export function crossedThresholds(before, after, budget) {
  if (!budget) return [];
  return BUDGET_THRESHOLDS.filter((t) => before < budget * t && after >= budget * t);
}

// Próximo horário do lembrete diário ("HH:MM") a partir de `now`.
export function nextReminderDate(now, time) {
  const [h, m] = time.split(':').map(Number);
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

// Deve lembrar agora? Já passou do horário, não há gasto hoje e ainda não lembrou hoje.
export function shouldRemind({ now, time, expenses, lastReminderDate }) {
  const today = todayISO(now);
  if (lastReminderDate === today) return false;
  const [h, m] = time.split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return false;
  return !expenses.some((e) => e.date === today);
}

export function validateExpense(e) {
  const errors = {};
  if (!Number.isInteger(e.amount) || e.amount <= 0) errors.amount = 'Informe um valor maior que zero.';
  if (!categoryById.has(e.category)) errors.category = 'Escolha uma categoria.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date ?? '')) errors.date = 'Data inválida.';
  return errors;
}

export function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// CSV com ";" e vírgula decimal, que o Excel/Planilhas em português abrem direto.
export function toCSV(expenses) {
  const header = ['Data', 'Categoria', 'Descrição', 'Pagamento', 'Valor'];
  const rows = sortExpenses(expenses).map((e) => [
    e.date.split('-').reverse().join('/'),
    getCategory(e.category).label,
    e.note ?? '',
    getPaymentMethod(e.payment)?.label ?? '',
    (e.amount / 100).toFixed(2).replace('.', ','),
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\n');
}

// Valida e normaliza um backup JSON importado.
export function parseBackup(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data?.expenses;
  if (!Array.isArray(list)) throw new Error('Arquivo sem lista de gastos.');
  const expenses = list
    .map((e) => ({
      id: String(e.id ?? newId()),
      amount: Math.round(Number(e.amount)),
      category: String(e.category ?? 'outros'),
      note: String(e.note ?? '').slice(0, 120),
      payment: e.payment ? String(e.payment) : '',
      date: String(e.date ?? ''),
      createdAt: Number(e.createdAt) || Date.now(),
    }))
    .filter((e) => Object.keys(validateExpense(e)).length === 0);
  return { expenses, settings: data?.settings && typeof data.settings === 'object' ? data.settings : null };
}
