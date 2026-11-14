const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'app/src/main/assets/www/index.html'), 'utf8');

function oneLine(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'Missing function ' + name);
  const end = html.indexOf('\n', start);
  return html.slice(start, end < 0 ? html.length : end);
}

function transferHarness({ qty = 2, availableSerials = 2, archived = false, saveResult = true } = {}) {
  const fields = {
    fromStock: { value: 'central' },
    toStock: { value: 'van1' },
    transferProduct: { value: '12' },
    transferQty: { value: String(qty) }
  };
  const serials = Array.from({ length: availableSerials }, (_, i) => ({ serial: 'SN' + i, status: 'stock', location: 'central' }));
  const product = { id: 12, name: 'Router', central: 5, van1: 1, van2: 0, archived, serials };
  const stockAudits = [];
  const saved = [];
  const messages = [];
  const context = {
    requireRole: () => true,
    document: { getElementById: id => fields[id] || null },
    products: [product], stockAudits, currentUser: { name: 'Admin' },
    save: extra => { saved.push(extra); return saveResult; },
    renderStockAudit: () => {}, logActivity: () => {}, toast: m => messages.push(m), go: () => {}
  };
  vm.runInNewContext(oneLine('transferStock'), context);
  return { context, product, stockAudits, saved, messages };
}

test('stock transfer changes both locations and writes a traceable movement record', () => {
  const { context, product, stockAudits, saved } = transferHarness();
  context.transferStock();
  assert.equal(product.central, 3);
  assert.equal(product.van1, 3);
  assert.deepEqual(product.serials.map(x => x.location), ['van1', 'van1']);
  assert.equal(stockAudits.length, 1);
  assert.equal(stockAudits[0].kind, 'transfer');
  assert.equal(stockAudits[0].from, 'central');
  assert.equal(stockAudits[0].to, 'van1');
  assert.equal(stockAudits[0].quantity, 2);
  assert.deepEqual(Array.from(stockAudits[0].serials), ['SN0', 'SN1']);
  assert.equal(saved[0][0][0], 'es13_stock_audits');
});

test('stock transfer refuses archived products and insufficient serial inventory', () => {
  const archived = transferHarness({ archived: true });
  archived.context.transferStock();
  assert.equal(archived.product.central, 5);
  assert.equal(archived.stockAudits.length, 0);

  const insufficient = transferHarness({ qty: 2, availableSerials: 1 });
  insufficient.context.transferStock();
  assert.equal(insufficient.product.central, 5);
  assert.equal(insufficient.product.van1, 1);
  assert.equal(insufficient.stockAudits.length, 0);
});

test('stock movement history displays transfer details alongside stocktake entries', () => {
  const render = oneLine('renderStockAudit');
  assert.match(render, /سجل الجرد وحركة المخزون/);
  assert.match(render, /a\.kind==='transfer'/);
  assert.match(render, /a\.productName/);
  assert.match(render, /a\.quantity/);
});
