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

test('camera barcode scanner matches internal SKU as well as barcode', () => {
  const fields = { saleSearch: { value: '' } };
  const calls = [];
  const context = {
    products: [{ id: 5, name: 'USB charger', sku: 'CHG-USB-01', barcode: '12345' }],
    barcodeScanTarget: 'sale',
    document: { getElementById: id => fields[id] || null },
    renderSaleProducts: () => calls.push('render'),
    addCart: id => calls.push(id),
    toast: () => {}
  };
  vm.runInNewContext(oneLine('onCameraBarcodeScanned'), context);
  context.onCameraBarcodeScanned(' chg-usb-01 ');
  assert.equal(fields.saleSearch.value, 'USB charger');
  assert.deepEqual(calls, ['render', 5]);
});

test('home quick scan matches SKU and archived products are excluded from home search', () => {
  const fields = { homeProductSearch: { value: 'CHG-USB-01' } };
  const calls = [];
  const context = {
    products: [{ id: 5, name: 'USB charger', sku: 'CHG-USB-01', barcode: '12345' }],
    document: { getElementById: id => fields[id] || null },
    homeProductQty: {},
    homeAddToSale: id => calls.push(id),
    renderHomeProducts: () => calls.push('render'),
    toast: () => {}
  };
  vm.runInNewContext(oneLine('scanHomeBarcode'), context);
  context.scanHomeBarcode();
  assert.deepEqual(calls, [5, 'render']);
  assert.match(oneLine('renderHomeProducts'), /!p\.archived/);
  assert.match(oneLine('renderHomeProducts'), /String\(p\.sku\|\|''\)/);
});
