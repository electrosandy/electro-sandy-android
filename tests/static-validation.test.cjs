const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const htmlPath = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'www', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

test('all inline JavaScript blocks parse successfully', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, 'No inline JavaScript block found');
  for (const [index, match] of scripts.entries()) {
    if (match[1].trim()) assert.doesNotThrow(() => new vm.Script(match[1], {filename:'index.html:inline-script-'+index}));
  }
});

test('static HTML element IDs are unique', () => {
  const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicates, []);
});

test('inline event handlers reference declared application functions', () => {
  const handlers = [...html.matchAll(/\bon(?:click|change|input|submit|keydown|keyup)\s*=\s*["']\s*([A-Za-z_$][\w$]*)\s*\(/gi)]
    .map(match => match[1]).filter(name => name !== 'if');
  const missing = [...new Set(handlers)].filter(name => !html.includes('function ' + name + '('));
  assert.deepEqual(missing, []);
});

test('literal DOM element lookups resolve to existing IDs', () => {
  const ids = new Set([...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]));
  const refs = [...html.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)].map(match => match[1]);
  const missing = [...new Set(refs.filter(id => !ids.has(id)))];
  assert.deepEqual(missing, []);
});

test('product photo picker supports up to three images', () => {
  assert.match(html, /id="newImageFile"[^>]*multiple/);
  assert.match(html, /baseImages\.length\+files\.length>3/);
  assert.match(html, /p\.images=allImages;p\.image=allImages\[0\]\|\|''/);
});

test('legacy single product photos remain visible after multi-photo upgrade', () => {
  const match = html.match(/function productImageList\(p\)\{([\s\S]*?)\}\nfunction art\(/);
  assert.ok(match, 'productImageList helper is missing');
  const getImages = vm.runInNewContext(`(function(p){${match[1]} })`);
  const legacy = 'data:image/jpeg;base64,legacy';
  assert.deepEqual(Array.from(getImages({image:legacy})), [legacy]);
});

test('multi-photo normalization deduplicates, validates and caps images', () => {
  const match = html.match(/function productImageList\(p\)\{([\s\S]*?)\}\nfunction art\(/);
  assert.ok(match, 'productImageList helper is missing');
  const getImages = vm.runInNewContext(`(function(p){${match[1]} })`);
  const images = [1,2,3,4].map(n => 'data:image/jpeg;base64,'+n);
  assert.deepEqual(Array.from(getImages({image:images[0],images})), images.slice(0,3));
  assert.deepEqual(Array.from(getImages({images:['javascript:alert(1)',images[1]]})), [images[1]]);
});

test('corrupted or wrongly shaped local JSON cannot stop app startup', () => {
  const start = html.indexOf('function readStoredJSON(');
  const end = html.indexOf('\n\nlet products=', start);
  assert.ok(start >= 0 && end > start, 'safe local JSON reader is missing');
  const source = html.slice(start, end).trim();
  const storage = { value: '{broken', getItem() { return this.value; } };
  const read = vm.runInNewContext('(' + source + ')', { localStorage: storage });
  assert.deepEqual(Array.from(read('es13_products', [])), []);
  storage.value = '{"unexpected":true}';
  assert.deepEqual(Array.from(read('es13_products', [])), []);
  storage.value = '[{"id":1}]';
  assert.equal(JSON.stringify(read('es13_products', [])), '[{"id":1}]');
});

test('startup does not parse localStorage JSON without the safe reader', () => {
  const directReads = [...html.matchAll(/JSON\.parse\(localStorage\.getItem/g)];
  const backupStart = html.indexOf('function savePreRestoreSafetyBackup');
  const backupEnd = html.indexOf('function validUserBackup');
  assert.equal(directReads.length, 2);
  assert.ok(directReads.every(match => match.index >= backupStart && match.index < backupEnd));
  assert.match(html, /readStoredJSON\('es13_products',\[\]\)/);
});

test('product image picker previews selected photos and accepts Android providers with empty MIME types', () => {
  assert.match(html, /onchange="previewNewProductImages\(this\)"/);
  assert.match(html, /function previewNewProductImages\(input\)/);
  assert.match(html, /file\.type&&!String\(file\.type\)\.toLowerCase\(\)\.startsWith\('image\/'\)/);
  assert.match(html, /تعذرت قراءة ملف الصورة/);
  assert.match(html, /صيغة الصورة غير مدعومة على هذا الجهاز/);
});

test('product image picker reports empty selections and verifies saved images', () => {
  assert.match(html, /\[ELECTRO_IMAGES\] picker files=/);
  assert.match(html, /لم يتم استلام أي صورة من منتقي الملفات/);
  assert.match(html, /saved new product images=/);
  assert.match(html, /saved edit images=/);
  assert.match(html, /productImageList\(persisted\)\.length!==allImages\.length/);
  assert.match(html, /renderHomeProducts\(\);/);
});

test('loyalty points input accepts Arabic-Indic, Persian and Western digits', () => {
  assert.match(html, /id="saleRedeemPoints" type="text" inputmode="numeric"/);
  assert.match(html, /normalizeLoyaltyPointsInput\(this\);updateCartTotals\(\)/);
  const helpers = html.match(/function normalizeLoyaltyDigits\(value\)[^\n]+function normalizeLoyaltyPointsInput\(input\)[^\n]+function parseLoyaltyPoints\(value\)[^\n]+/);
  assert.ok(helpers, 'loyalty digit normalization helpers are missing');
  const context = {};
  vm.runInNewContext(helpers[0], context);
  assert.equal(context.parseLoyaltyPoints('123'), 123);
  assert.equal(context.parseLoyaltyPoints('١٢٣'), 123);
  assert.equal(context.parseLoyaltyPoints('۱۲۳'), 123);
  assert.equal(context.parseLoyaltyPoints('٠'), 0);
  assert.equal(context.parseLoyaltyPoints('12a3'), 123);
  assert.equal(context.parseLoyaltyPoints(''), 0);
});

test('checkout and live cart totals use the same normalized loyalty points parser', () => {
  assert.match(html, /requested=parseLoyaltyPoints\(pointsInput\?\.value\)/);
  assert.match(html, /requestedPoints=\(\(\)=>\{let raw=String\(document\.getElementById\('saleRedeemPoints'\)\?\.value\?\?''\)/);
});



test('barcode scan launches the Android camera bridge and remembers its target', () => {
  const start = html.match(/function startBarcodeScan\(target\)\{[^\n]+/);
  assert.ok(start, 'startBarcodeScan handler is missing');
  let scans = 0;
  const context = {
    requireRole: () => true,
    window: { AndroidScanner: { scanBarcode() { scans++; } } },
    toast() {}
  };
  vm.runInNewContext(start[0], context);
  context.startBarcodeScan('sale');
  assert.equal(scans, 1);
  assert.equal(context.barcodeScanTarget, 'sale');
});

test('barcode result adds a matching product to the sale cart', () => {
  const handler = html.match(/function onCameraBarcodeScanned\(code\)\{[^\n]+/);
  assert.ok(handler, 'onCameraBarcodeScanned handler is missing');
  const input = { value: '' };
  const added = [], messages = [];
  const product = { id: 42, name: 'USB-C Charger', barcode: 'ABC-123' };
  const context = {
    barcodeScanTarget: 'sale',
    products: [product],
    document: { getElementById: id => id === 'saleSearch' ? input : null },
    renderSaleProducts() {},
    addCart: id => added.push(id),
    toast: message => messages.push(message)
  };
  vm.runInNewContext(handler[0], context);
  context.onCameraBarcodeScanned(' abc-123 ');
  assert.equal(input.value, 'USB-C Charger');
  assert.deepEqual(added, [42]);
  assert.match(messages.at(-1), /USB-C Charger/);
});

test('unknown barcode is placed in the active product search instead of adding a wrong item', () => {
  const handler = html.match(/function onCameraBarcodeScanned\(code\)\{[^\n]+/);
  assert.ok(handler, 'onCameraBarcodeScanned handler is missing');
  const input = { value: '' }, messages = [];
  let added = 0;
  const context = {
    barcodeScanTarget: 'home',
    products: [{ id: 1, name: 'Existing', barcode: 'KNOWN' }],
    document: { getElementById: id => id === 'homeProductSearch' ? input : null },
    renderHomeProducts() {},
    homeProductQty: {},
    homeAddToSale() { added++; },
    toast: message => messages.push(message)
  };
  vm.runInNewContext(handler[0], context);
  context.onCameraBarcodeScanned('UNKNOWN-99');
  assert.equal(input.value, 'UNKNOWN-99');
  assert.equal(added, 0);
  assert.match(messages.at(-1), /لم يتم العثور/);
});

test('multiple product images survive localStorage serialization and app restart', () => {
  const imageHelper = html.match(/function productImageList\(p\)\{[^\n]+/);
  assert.ok(imageHelper, 'productImageList helper is missing');
  const listImages = vm.runInNewContext('(' + imageHelper[0].replace(/^function productImageList/, 'function') + ')');
  const images = [1, 2, 3].map(n => 'data:image/jpeg;base64,image-' + n);
  const storage = { value: null, getItem() { return this.value; }, setItem(_key, value) { this.value = value; } };
  const originalProduct = { id: 7, name: 'DINEX Type-C 40W', image: images[0], images };
  storage.setItem('es13_products', JSON.stringify([originalProduct]));
  const restoredProducts = JSON.parse(storage.getItem('es13_products'));
  assert.deepEqual(Array.from(listImages(restoredProducts[0])), images);
  assert.equal(restoredProducts[0].image, images[0]);
  assert.deepEqual(Array.from(listImages({ image: images[0] })), [images[0]]);
});
