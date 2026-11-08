const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

process.env.TZ = 'UTC';
const htmlPath = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'www', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const lines = html.split(/\r?\n/);
function sourceLine(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'Missing application function: ' + name);
  const end = html.indexOf('\n', start);
  return html.slice(start, end < 0 ? html.length : end);
}

const context = vm.createContext({ Math, Number, String, Array, Date });
vm.runInContext([
  "function localDayKey(value){let d=value instanceof Date?value:new Date(value);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}",
  sourceLine('orderPaidMethodBalances'),
  sourceLine('orderInitialPaidMethodBalances'),
  sourceLine('calculateCashExpectedForDay')
].join('\n'), context);

const initialMethods = (order, entries=[]) =>
  context.orderInitialPaidMethodBalances(order, order.paidAmount, entries);
const dayCash = (orders, entries, day='2026-11-08') =>
  context.calculateCashExpectedForDay(day, orders, entries);
const orderBase = (overrides={}) => ({
  id: 1,
  payment: 'مختلط / Mixte',
  total: 100,
  paidAmount: 70,
  balance: 30,
  paidCashAmount: 40,
  paidBankAmount: 30,
  createdAt: '2026-11-08T10:00:00.000Z',
  ...overrides
});
const entry = (overrides={}) => ({
  id: 10, relatedOrderId: 1, amount: 10, type: 'in',
  method: 'cash', entryKind: 'debt_payment',
  createdAt: '2026-11-08T11:00:00.000Z',
  ...overrides
});

test('mixed initial payment keeps cash and bank split', () => {
  const o = orderBase();
  assert.deepEqual(JSON.parse(JSON.stringify(initialMethods(o))), {cash:40, bank:30});
  assert.equal(dayCash([o], []), 40);
});

test('same-day mixed-sale debt collection is counted once', () => {
  const o = orderBase({paidAmount:80, paidCashAmount:50, paidBankAmount:30, balance:20});
  const e = entry({amount:10});
  assert.deepEqual(JSON.parse(JSON.stringify(initialMethods(o,[e]))), {cash:40, bank:30});
  assert.equal(dayCash([o],[e]), 50);
});

test('same-day collection on a credit-only invoice is not counted as a sale receipt twice', () => {
  const o = orderBase({payment:'دين / Crédit', total:50, paidAmount:20, balance:30, paidCashAmount:20, paidBankAmount:0});
  const e = entry({amount:20});
  assert.deepEqual(JSON.parse(JSON.stringify(initialMethods(o,[e]))), {cash:0, bank:0});
  assert.equal(dayCash([o],[e]), 20);
});

test('cash refund is deducted once after restoring gross initial cash receipt', () => {
  const o = orderBase({payment:'نقداً / Espèces', total:100, paidAmount:80, balance:0, paidCashAmount:80, paidBankAmount:0});
  const refund = entry({amount:20, type:'out', entryKind:'sale_refund', note:'استرجاع فاتورة نقدي ES-1'});
  assert.deepEqual(JSON.parse(JSON.stringify(initialMethods(o,[refund]))), {cash:100, bank:0});
  assert.equal(dayCash([o],[refund]), 80);
});

test('mixed debt collection followed by a split refund preserves the original sale split', () => {
  const o = orderBase({paidAmount:64, paidCashAmount:40, paidBankAmount:24, balance:20});
  const debt = entry({amount:10});
  const cashRefund = entry({amount:10, type:'out', entryKind:'sale_refund', note:'استرجاع فاتورة نقدي ES-1'});
  const bankRefund = entry({amount:6, method:'bank', type:'out', entryKind:'sale_refund', note:'استرجاع فاتورة بتحويل ES-1'});
  const entries = [debt,cashRefund,bankRefund];
  assert.deepEqual(JSON.parse(JSON.stringify(initialMethods(o,entries))), {cash:40, bank:30});
  assert.equal(dayCash([o],entries), 40);
});

test('bank-only refund does not alter expected cash', () => {
  const o = orderBase({payment:'تحويل / Virement', total:100, paidAmount:70, balance:0, paidCashAmount:0, paidBankAmount:70});
  const refund = entry({amount:30, method:'bank', type:'out', entryKind:'sale_refund', note:'استرجاع فاتورة بتحويل ES-1'});
  assert.deepEqual(JSON.parse(JSON.stringify(initialMethods(o,[refund]))), {cash:0, bank:100});
  assert.equal(dayCash([o],[refund]), 0);
});

test('prior debt collections are excluded from the sale base and from today cash flow', () => {
  const o = orderBase({paidAmount:120, balance:30, paidCashAmount:90, paidBankAmount:30});
  const prior = entry({amount:50, createdAt:'2026-11-07T11:00:00.000Z'});
  assert.equal(dayCash([o],[prior]), 40);
});
