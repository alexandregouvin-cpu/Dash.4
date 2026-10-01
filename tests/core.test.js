import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBRL, digitsToCents, parseAmount, addDays, shiftMonth, daysInMonth, groupByDay, totalsByCategory,
  lastNDaysTotals, dailyAverage, monthProjection, budgetStatus, crossedThresholds, nextReminderDate,
  shouldRemind, validateExpense, toCSV, parseBackup, getCategory,
  distanceMeters, formatDistance, categoryFromOSMTags, parseOverpassPlaces, nearbyHistoryPlaces, totalsByPlace, normalizePlace,
  totalsByPerson,
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
  const csv = toCSV([e(1234, 'alimentacao', '2026-09-30', { note: 'Almoço; "bom"', payment: 'pix', place: { name: 'Bar do Zé' } })]);
  assert.equal(csv, 'Data;Categoria;Descrição;Local;Pagamento;Valor\n30/09/2026;Alimentação;"Almoço; ""bom""";Bar do Zé;Pix;12,34');
});

test('parseBackup aceita backup do app e descarta itens inválidos', () => {
  const text = JSON.stringify({ settings: { monthlyBudget: 1000 }, expenses: [e(100, 'mercado', '2026-09-30', { place: { name: 'Extra', lat: -23.5, lon: -46.6 } }), { amount: -1 }] });
  const { expenses, settings } = parseBackup(text);
  assert.equal(expenses.length, 1);
  assert.deepEqual(expenses[0].place, { name: 'Extra', lat: -23.5, lon: -46.6 });
  assert.equal(settings.monthlyBudget, 1000);
  assert.throws(() => parseBackup('{"foo":1}'));
});

// Av. Paulista (MASP) e pontos próximos
const masp = { lat: -23.5614, lon: -46.6559 };

test('distanceMeters e formatDistance', () => {
  assert.equal(Math.round(distanceMeters(masp, masp)), 0);
  const d = distanceMeters(masp, { lat: -23.5614 + 0.001, lon: -46.6559 }); // ~111 m
  assert.ok(d > 105 && d < 117, String(d));
  assert.equal(formatDistance(42), '40 m');
  assert.equal(formatDistance(1530), '1,5 km');
});

test('categoryFromOSMTags mapeia o tipo de estabelecimento', () => {
  assert.equal(categoryFromOSMTags({ amenity: 'fuel' }), 'combustivel');
  assert.equal(categoryFromOSMTags({ shop: 'supermarket' }), 'mercado');
  assert.equal(categoryFromOSMTags({ shop: 'bakery' }), 'alimentacao');
  assert.equal(categoryFromOSMTags({ amenity: 'pharmacy' }), 'saude');
  assert.equal(categoryFromOSMTags({ healthcare: 'laboratory' }), 'saude');
  assert.equal(categoryFromOSMTags({ amenity: 'parking' }), 'transporte');
  assert.equal(categoryFromOSMTags({ leisure: 'fitness_centre' }), 'lazer');
  assert.equal(categoryFromOSMTags({ shop: 'clothes' }), null);
});

test('parseOverpassPlaces ordena por distância, usa centro de áreas e remove repetidos', () => {
  const json = { elements: [
    { type: 'way', center: { lat: -23.5624, lon: -46.6559 }, tags: { name: 'Pão de Açúcar', shop: 'supermarket', 'addr:street': 'Av. Paulista', 'addr:housenumber': '1000' } },
    { type: 'node', lat: -23.5615, lon: -46.6559, tags: { name: 'Posto Shell', amenity: 'fuel' } },
    { type: 'node', lat: -23.5630, lon: -46.6559, tags: { name: 'posto shell', amenity: 'fuel' } },
    { type: 'node', lat: -23.5616, lon: -46.6559, tags: { amenity: 'bench' } },
  ] };
  const places = parseOverpassPlaces(json, masp);
  assert.deepEqual(places.map((p) => [p.name, p.category]), [['Posto Shell', 'combustivel'], ['Pão de Açúcar', 'mercado']]);
  assert.equal(places[1].address, 'Av. Paulista, 1000');
  assert.deepEqual(parseOverpassPlaces({}, masp), []);
});

test('nearbyHistoryPlaces sugere lugares já usados por perto com a categoria mais comum', () => {
  const near = { name: 'Padaria Real', lat: -23.5615, lon: -46.6560 };
  const list = [
    e(800, 'alimentacao', '2026-09-28', { place: near, note: 'café' }),
    e(900, 'alimentacao', '2026-09-29', { place: { ...near, name: 'padaria real' } }),
    e(500, 'mercado', '2026-09-30', { place: near }),
    e(9000, 'combustivel', '2026-09-30', { place: { name: 'Posto longe', lat: -23.60, lon: -46.70 } }),
    e(100, 'outros', '2026-09-30', { place: { name: 'Sem coordenadas' } }),
  ];
  const found = nearbyHistoryPlaces(list, masp);
  assert.equal(found.length, 1);
  assert.equal(found[0].count, 3);
  assert.equal(found[0].category, 'alimentacao');
  assert.deepEqual(totalsByPlace(list).map((p) => [p.name, p.total]), [['Posto longe', 9000], ['Padaria Real', 2200], ['Sem coordenadas', 100]]);
});

test('normalizePlace exige nome e valida coordenadas', () => {
  assert.equal(normalizePlace({ name: '  ' }), null);
  assert.equal(normalizePlace(null), null);
  assert.deepEqual(normalizePlace({ name: ' Bar ', lat: 91, lon: 0 }), { name: 'Bar' });
  assert.deepEqual(normalizePlace({ name: 'Bar', lat: '-23.5', lon: '-46.6' }), { name: 'Bar', lat: -23.5, lon: -46.6 });
});

test('totalsByPerson soma por quem registrou e usa o nome atual do membro', () => {
  const list = [
    e(1000, 'mercado', '2026-10-01', { createdBy: 'ana', createdByName: 'Ana' }),
    e(3000, 'lazer', '2026-10-01', { createdBy: 'bia', createdByName: 'Bia' }),
    e(500, 'outros', '2026-10-02', { createdBy: 'ana', createdByName: 'Ana' }),
    e(100, 'outros', '2026-10-02'),
  ];
  assert.deepEqual(
    totalsByPerson(list, { ana: 'Ana Paula' }).map((p) => [p.name, p.total, p.count]),
    [['Bia', 3000, 1], ['Ana Paula', 1500, 2], ['Sem autor', 100, 1]],
  );
});
