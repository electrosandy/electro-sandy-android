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

test('archived products are hidden from sale search and cannot be added to the cart', () => {
  const sale = oneLine('renderSaleProducts');
  assert.match(sale, /!p\.archived/);
  const add = oneLine('addCart');
  const messages = [];
  const context = {
    requireRole: () => true,
    products: [{ id: 7, archived: true, central: 3 }],
    cart: {},
    document: { getElementById: () => ({ value: 'central' }) },
    toast: message => messages.push(message)
  };
  vm.runInNewContext(add, context);
  context.addCart(7);
  assert.deepEqual(context.cart, {});
  assert.ok(messages.some(x => x.includes('مؤرشف')));
});

test('product management search includes SKU and archive controls preserve records', () => {
  const render = oneLine('renderProducts');
  assert.match(render, /String\(p\.sku\|\|''\)/);
  assert.match(render, /toggleProductArchive/);
  const products = [{ id: 9, name: 'Archived charger', archived: false }];
  const events = [];
  const context = {
    requireRole: () => true, products, cart: {},
    confirm: () => true,
    save: () => true,
    renderProducts: () => events.push('products'),
    renderSaleProducts: () => events.push('sales'),
    renderHomeProducts: () => events.push('home'),
    logActivity: (...args) => events.push(args),
    toast: message => events.push(message)
  };
  vm.runInNewContext(oneLine('toggleProductArchive'), context);
  context.toggleProductArchive(9);
  assert.equal(products.length, 1, 'archive must not delete the product record');
  assert.equal(products[0].archived, true);
  assert.ok(events.includes('sales'));
  assert.ok(events.some(x => Array.isArray(x) && x[0] === 'أرشفة منتج'));
});

test('product with a non-empty cart cannot be archived and failed saves roll back archive state', () => {
  const messages = [];
  const p = { id: 4, name: 'Test', archived: false };
  const context = {
    requireRole: () => true, products: [p], cart: { 4: 1 },
    confirm: () => true, save: () => false,
    renderProducts() {}, renderSaleProducts() {}, renderHomeProducts() {},
    logActivity() {}, toast: message => messages.push(message)
  };
  vm.runInNewContext(oneLine('toggleProductArchive'), context);
  context.toggleProductArchive(4);
  assert.equal(p.archived, false);
  assert.ok(messages.length > 0);
  context.cart[4] = 0;
  context.toggleProductArchive(4);
  assert.equal(p.archived, false, 'failed storage write must roll back the archive flag');
});
