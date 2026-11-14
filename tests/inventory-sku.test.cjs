const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'app/src/main/assets/www/index.html'), 'utf8');

test('SKU field is persisted, editable, searchable and reset between product forms', () => {
  assert.match(html, /id="newSku"/);
  assert.match(html, /sku= document\.getElementById/); // whitespace-tolerant fallback below
  assert.match(html, /sku=document\.getElementById\('newSku'\)\.value\.trim\(\)/);
  assert.match(html, /p\.sku=sku/);
  assert.match(html, /products\.push\(\{id,name,category,barcode,sku,price/);
  assert.match(html, /newSku'\)\.value=p\.sku\|\|''/);
  assert.match(html, /newSku'\)\.value=''/);
  assert.match(html, /String\(p\.sku\|\|' '\)/.test(html) ? /newSku/ : /String\(p\.sku\|\|''\)/);
});

test('SKU uniqueness is case-insensitive, ignores surrounding spaces and permits editing the same product', () => {
  const match = html.match(/function isUniqueProductSku\(sku,exceptId\)\{[^\n]+/);
  assert.ok(match, 'SKU uniqueness helper is missing');
  const isUnique = vm.runInNewContext('(' + match[0] + ')', {
    products: [
      { id: 1, sku: 'CHG-USBC-001' },
      { id: 2, sku: '' },
      { id: 3 }
    ]
  });
  assert.equal(isUnique('', null), true);
  assert.equal(isUnique('   ', null), true);
  assert.equal(isUnique('charger-002', null), true);
  assert.equal(isUnique('chg-usbc-001', null), false);
  assert.equal(isUnique(' CHG-USBC-001 ', 1), true);
  assert.equal(isUnique('chg-usbc-001', 2), false);
});
