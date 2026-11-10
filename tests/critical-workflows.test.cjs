const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'www', 'index.html'), 'utf8');

function loadLineFunction(name, context) {
  const line = html.split(/\r?\n/).find(value =>
    value.includes('function ' + name + '(') || value.includes('async function ' + name + '(')
  );
  assert.ok(line, 'Application function ' + name + ' is missing');
  vm.createContext(context);
  vm.runInContext(line, context, { filename: 'index.html:' + name });
  return context[name];
}

function makeTransferContext(overrides = {}) {
  const fields = {
    fromStock: { value: 'central' },
    toStock: { value: 'van1' },
    transferProduct: { value: '1' },
    transferQty: { value: '2' }
  };
  const messages = [];
  const calls = [];
  const context = {
    products: [{
      id: 1, name: 'Cable', central: 8, van1: 1, van2: 0,
      serials: [
        { serial: 'S1', status: 'stock', location: 'central' },
        { serial: 'S2', status: 'stock', location: 'central' },
        { serial: 'S3', status: 'sold', location: 'central' }
      ]
    }],
    document: { getElementById: id => fields[id] || null },
    requireRole: () => true,
    toast: message => messages.push(message),
    save: () => { calls.push('save'); return true; },
    logActivity: (...args) => calls.push(['activity', ...args]),
    go: page => calls.push(['go', page]),
    ...overrides
  };
  return { context, fields, messages, calls };
}

test('stock transfer conserves total quantity and moves matching serial locations', () => {
  const { context, calls, messages } = makeTransferContext();
  const before = context.products[0].central + context.products[0].van1 + context.products[0].van2;
  loadLineFunction('transferStock', context)();
  const product = context.products[0];
  assert.equal(product.central, 6);
  assert.equal(product.van1, 3);
  assert.equal(product.central + product.van1 + product.van2, before);
  assert.deepEqual(product.serials.map(x => x.location), ['van1', 'van1', 'central']);
  assert.ok(calls.includes('save'));
  assert.ok(calls.some(x => Array.isArray(x) && x[0] === 'go' && x[1] === 'stock'));
  assert.match(messages.at(-1), /بنجاح/);
});

test('stock transfer rejects same source and destination without changing stock', () => {
  const { context, fields, calls } = makeTransferContext();
  fields.toStock.value = 'central';
  loadLineFunction('transferStock', context)();
  assert.equal(context.products[0].central, 8);
  assert.equal(context.products[0].van1, 1);
  assert.equal(calls.length, 0);
});

test('stock transfer rejects insufficient serialized stock atomically', () => {
  const { context, fields, calls, messages } = makeTransferContext();
  fields.transferQty.value = '3';
  loadLineFunction('transferStock', context)();
  assert.equal(context.products[0].central, 8);
  assert.equal(context.products[0].van1, 1);
  assert.equal(context.products[0].serials.filter(x => x.location === 'central').length, 3);
  assert.equal(calls.length, 0);
  assert.match(messages.at(-1), /الأرقام التسلسلية/);
});

test('stock transfer rejects non-integer and zero quantities', () => {
  for (const qty of ['0', '1.5', '-2', 'NaN']) {
    const { context, fields, calls } = makeTransferContext();
    fields.transferQty.value = qty;
    loadLineFunction('transferStock', context)();
    assert.equal(context.products[0].central, 8, 'quantity ' + qty);
    assert.equal(context.products[0].van1, 1, 'quantity ' + qty);
    assert.equal(calls.length, 0, 'quantity ' + qty);
  }
});

test('supplier outstanding balance reconciles partial and fully paid purchases', () => {
  const context = {
    purchases: [
      { supplierId: 7, total: 100, paidAmount: 25, balance: 75 },
      { supplierId: 7, total: 60, paidAmount: 60, balance: 0 },
      { supplierId: 8, total: 900, paidAmount: 0, balance: 900 }
    ]
  };
  const outstanding = loadLineFunction('supplierOutstanding', context);
  assert.equal(outstanding(7), 75);
  assert.equal(outstanding(8), 900);
  assert.equal(outstanding(9), 0);
});

test('supplier outstanding rejects inconsistent payment records', () => {
  const context = { purchases: [{ supplierId: 7, total: 100, paidAmount: 20, balance: 50 }] };
  const outstanding = loadLineFunction('supplierOutstanding', context);
  assert.ok(Number.isNaN(outstanding(7)));
});

test('backup user validation requires unique users and an active administrator', () => {
  const validAdmin = {
    id: 1, name: 'Admin', role: 'admin', active: true,
    pinHash: 'pbkdf2$100000$' + 'a'.repeat(32) + '$' + 'b'.repeat(64)
  };
  const validate = loadLineFunction('validUserBackup', {});
  assert.equal(validate([validAdmin]), true);
  assert.equal(validate([{ ...validAdmin, active: false }]), false);
  assert.equal(validate([validAdmin, { ...validAdmin, id: 2, name: ' admin ' }]), false);
  assert.equal(validate([{ ...validAdmin, role: 'owner' }]), false);
});

test('pre-restore safety backup retains the current business data and only two snapshots', () => {
  const stored = [];
  const localStorage = {
    getItem(key) { return key === 'es13_auto_backups' ? JSON.stringify(stored) : null; },
    setItem(key, value) { if (key === 'es13_auto_backups') { stored.splice(0, stored.length, ...JSON.parse(value)); } }
  };
  const context = {
    localStorage,
    products: [{ id: 1, name: 'P' }],
    orders: [{ id: 2 }],
    customers: [], purchases: [], cashEntries: [], cashClosings: [],
    stockAudits: [], activityLog: [], warranties: [], appUsers: [],
    suppliers: [], returns: [], sellerProfile: { company: 'ELECTRO Sandy' },
    Date
  };
  const saveBackup = loadLineFunction('savePreRestoreSafetyBackup', context);
  assert.equal(saveBackup(), true);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].data.products[0].name, 'P');
  assert.equal(stored[0].data.sellerProfile.company, 'ELECTRO Sandy');
  assert.equal(saveBackup(), true);
  assert.equal(saveBackup(), true);
  assert.equal(stored.length, 2);
});
