import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBRL, digitsToCents, parseAmount, addDays, shiftMonth, daysInMonth, groupByDay, totalsByCategory,
  lastNDaysTotals, dailyAverage, monthProjection, budgetStatus, crossedThresholds, nextReminderDate,
  shouldRemind, validateExpense, toCSV, parseBackup, getCategory,
} from '../js/core.js';

const e = (amount, category, date, extra = {}) => ({ id: `${date}-${amount}`, amount, category, date, createdAt: 0, ...extra });

test('formatBRL formata centavos em reais', () => {
  assert.equal(formatBRL(0), 'R$ 0,00');
  assert.equal(formatBRL(1234), 'R$ 12,34');
  assert.equal(formatBRL(123456789), 'R$ 1.234.567,89');
});

test('digitsToCents funciona como caixa registradora', () => {
  assert.equal(digitsToCents(''), 0);
  assert.equal(digitsToCents('1'), 1);
  assert.equal(digitsToCents('R$ 12,345'), 12345);
  assert.equal(digitsToCents('R$ 0,005'), 5);
});

test('parseAmount aceita formatos brasileiros e internacionais', () => {
  assert.equal(parseAmount('12,34'), 1234);
  assert.equal(parseAmount('1.234,56'), 123456);
  assert.equal(parseAmount('1,234.56'), 123456);
  assert.equal(parseAmount('12.5'), 1250);
  assert.equal(parseAmount('1.500'), 150000);
  assert.equal(parseAmount('R$ 7'), 700);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('-5'), null);
  assert.equal(parseAmount('0'), null);
});

test('datas: addDays, shiftMonth e daysInMonth atravessam limites', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(daysInMonth('2028-02'), 29);
});

test('groupByDay agrupa e ordena do mais recente', () => {
  const groups = groupByDay([e(100, 'mercado', '2026-09-01'), e(200, 'lazer', '2026-09-03'), e(50, 'outros', '2026-09-01')]);
  assert.deepEqual(groups.map((g) => [g.date, g.total]), [['2026-09-03', 200], ['2026-09-01', 150]]);
});

test('totalsByCategory soma, conta e calcula participação', () => {
  const totals = totalsByCategory([e(300, 'mercado', '2026-09-01'), e(100, 'combustivel', '2026-09-01'), e(100, 'mercado', '2026-09-02')]);
  assert.equal(totals[0].category.id, 'mercado');
  assert.equal(totals[0].total, 400);
  assert.equal(totals[0].count, 2);
  assert.equal(totals[0].share, 0.8);
  assert.equal(getCategory('inexistente').id, 'outros');
});

test('lastNDaysTotals preenche dias sem gasto com zero', () => {
  const days = lastNDaysTotals([e(500, 'mercado', '2026-09-30'), e(100, 'mercado', '2026-09-28')], '2026-09-30', 3);
  assert.deepEqual(days, [{ date: '2026-09-28', total: 100 }, { date: '2026-09-29', total: 0 }, { date: '2026-09-30', total: 500 }]);
});

test('média diária e projeção usam dias decorridos no mês corrente', () => {
  const list = [e(1000, 'mercado', '2026-09-01'), e(2000, 'mercado', '2026-09-10')];
  assert.equal(dailyAverage(list, '2026-09', '2026-09-10'), 300);
  assert.equal(monthProjection(list, '2026-09', '2026-09-10'), 9000);
  assert.equal(dailyAverage(list, '2026-09', '2026-10-05'), 100); // mês fechado: 30 dias
  assert.equal(dailyAverage(list, '2026-11', '2026-10-05'), 0); // mês futuro
});

test('orçamento: status e cruzamento de limites', () => {
  assert.equal(budgetStatus(500, 1000).level, 'ok');
  assert.equal(budgetStatus(800, 1000).level, 'warn');
  assert.equal(budgetStatus(1200, 1000).level, 'over');
  assert.equal(budgetStatus(100, 0).level, 'none');
  assert.deepEqual(crossedThresholds(700, 850, 1000), [0.8]);
  assert.deepEqual(crossedThresholds(700, 1000, 1000), [0.8, 1]);
  assert.deepEqual(crossedThresholds(850, 900, 1000), []);
  assert.deepEqual(crossedThresholds(0, 900, 0), []);
});

test('lembrete: próximo horário e quando lembrar', () => {
  const now = new Date(2026, 8, 30, 20, 0);
  assert.equal(nextReminderDate(now, '21:00').getTime(), new Date(2026, 8, 30, 21, 0).getTime());
  assert.equal(nextReminderDate(now, '08:30').getTime(), new Date(2026, 9, 1, 8, 30).getTime());

  const late = new Date(2026, 8, 30, 21, 30);
  assert.equal(shouldRemind({ now: late, time: '21:00', expenses: [], lastReminderDate: '' }), true);
  assert.equal(shouldRemind({ now, time: '21:00', expenses: [], lastReminderDate: '' }), false); // ainda não deu o horário
  assert.equal(shouldRemind({ now: late, time: '21:00', expenses: [e(1, 'outros', '2026-09-30')], lastReminderDate: '' }), false);
  assert.equal(shouldRemind({ now: late, time: '21:00', expenses: [], lastReminderDate: '2026-09-30' }), false);
});

test('validateExpense aponta campos inválidos', () => {
  assert.deepEqual(validateExpense(e(100, 'mercado', '2026-09-30')), {});
  assert.deepEqual(Object.keys(validateExpense({ amount: 0, category: 'x', date: '' })).sort(), ['amount', 'category', 'date']);
});

test('toCSV usa ; e vírgula decimal, escapando textos', () => {
  const csv = toCSV([e(1234, 'alimentacao', '2026-09-30', { note: 'Almoço; "bom"', payment: 'pix' })]);
  assert.equal(csv, 'Data;Categoria;Descrição;Pagamento;Valor\n30/09/2026;Alimentação;"Almoço; ""bom""";Pix;12,34');
});

test('parseBackup aceita backup do app e descarta itens inválidos', () => {
  const text = JSON.stringify({ settings: { monthlyBudget: 1000 }, expenses: [e(100, 'mercado', '2026-09-30'), { amount: -1 }] });
  const { expenses, settings } = parseBackup(text);
  assert.equal(expenses.length, 1);
  assert.equal(settings.monthlyBudget, 1000);
  assert.throws(() => parseBackup('{"foo":1}'));
});
