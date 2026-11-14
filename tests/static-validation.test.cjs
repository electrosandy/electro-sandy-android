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


test('backup validation requires core datasets and rejects malformed optional datasets', () => {
  const arrays = html.match(/function validBackupArrays\(data,required\)\{[^\n]+/);
  assert.ok(arrays, 'validBackupArrays helper is missing');
  const validate = vm.runInNewContext('(' + arrays[0] + ')');
  const core = { products: [], orders: [], customers: [], purchases: [], cashEntries: [] };
  assert.equal(validate(core, Object.keys(core)), true, 'legacy backups may omit newer optional datasets');
  assert.equal(validate({ ...core, returns: {} }, Object.keys(core)), false);
  assert.equal(validate({ ...core, products: {} }, Object.keys(core)), false);
  assert.equal(validate({ ...core, returns: [] }, Object.keys(core)), true);
  assert.equal(validate(null, Object.keys(core)), false);
});

test('backup user validation requires unique users and an active administrator', () => {
  const users = html.match(/function validUserBackup\(list\)\{[^\n]+/);
  assert.ok(users, 'validUserBackup helper is missing');
  const validate = vm.runInNewContext('(' + users[0] + ')');
  const dollar = String.fromCharCode(36);
  const admin = { id: 1, name: 'Admin', role: 'admin', active: true, pinHash: ['pbkdf2', '120000', 'a'.repeat(32), 'b'.repeat(64)].join(dollar) };
  assert.equal(validate([admin]), true);
  assert.equal(validate([{ ...admin, active: false }]), false);
  assert.equal(validate([{ ...admin, pinHash: 'invalid' }]), false);
  assert.equal(validate([admin, { ...admin, id: 2, name: ' admin ' }]), false);
  assert.equal(validate([admin, { ...admin, id: 1, name: 'Second' }]), false);
  assert.equal(validate([]), false);
});

test('exported backup preserves all business datasets and product photo payloads', () => {
  const declaration = html.match(/function exportBackup\(\)\{[\s\S]*?\n\}/);
  assert.ok(declaration, 'exportBackup handler is missing');
  let exported = null;
  const product = { id: 7, image: 'data:image/jpeg;base64,first', images: ['data:image/jpeg;base64,first', 'data:image/jpeg;base64,second'] };
  const context = {
    requireRole: role => role === 'admin',
    products: [product], orders: [], customers: [], purchases: [], cashEntries: [],
    cashClosings: [], stockAudits: [], activityLog: [], warranties: [], appUsers: [],
    suppliers: [], returns: [], sellerProfile: { company: 'ELECTRO Sandy' },
    saveTextFile: (name, content, mime) => { exported = { name, data: JSON.parse(content), mime }; }
  };
  vm.runInNewContext(declaration[0], context);
  context.exportBackup();
  assert.ok(exported, 'backup export did not invoke the file saver');
  assert.equal(exported.mime, 'application/json');
  assert.equal(exported.data.app, 'ELECTRO Sandy');
  assert.equal(exported.data.schemaVersion, 1);
  assert.deepEqual(Array.from(exported.data.data.products[0].images), product.images);
  assert.equal(exported.data.data.products[0].image, product.image);
  for (const key of ['orders','customers','purchases','cashEntries','cashClosings','stockAudits','activityLog','warranties','users','suppliers','returns']) {
    assert.ok(Array.isArray(exported.data.data[key]), 'backup is missing dataset: ' + key);
  }
  assert.deepEqual(exported.data.data.sellerProfile, context.sellerProfile);
});

test('backup restore rolls back every stored key when one write fails', () => {
  const start = html.indexOf('function importBackup(file)');
  const end = html.indexOf('\nfunction restoreAutoBackup()', start);
  assert.ok(start >= 0 && end > start, 'importBackup handler is missing');
  const source = html.slice(start, end);
  const arrays = html.match(/function validBackupArrays\(data,required\)\{[^\n]+/);
  const validateArrays = vm.runInNewContext('(' + arrays[0] + ')');
  const original = {
    es13_products: '[{"id":1}]',
    es13_orders: '[]',
    es13_customers: '[]',
    es13_purchases: '[]',
    es13_cash: '[]',
    es13_cash_closings: '[]',
    es13_stock_audits: '[]',
    es13_activity_log: '[]',
    es13_warranties: '[]',
    es13_users: '[]',
    es13_suppliers: '[]',
    es13_returns: '[]',
    es13_seller_profile: '{}'
  };
  const storage = {
    values: { ...original },
    failed: false,
    getItem(key) { return this.values[key] ?? null; },
    setItem(key, value) {
      if (key === 'es13_returns' && !this.failed) { this.failed = true; throw new Error('quota'); }
      this.values[key] = value;
    },
    removeItem(key) { delete this.values[key]; }
  };
  const backup = {
    products: [{ id: 2, images: ['data:image/jpeg;base64,photo'] }],
    orders: [], customers: [], purchases: [], cashEntries: [], sellerProfile: { company: 'ELECTRO Sandy' }
  };
  const messages = [];
  const context = {
    requireRole: () => true,
    validBackupArrays: validateArrays,
    document: { getElementById: () => ({ value: '' }) },
    FileReader: class { readAsText() { this.result = JSON.stringify({ data: backup }); this.onload(); } },
    localStorage: storage,
    confirm: () => true,
    savePreRestoreSafetyBackup: () => true,
    toast: message => messages.push(message),
    currentUser: { id: 1 }, cart: {},
    products: [{ id: 1 }], orders: [], customers: [], purchases: [], cashEntries: [],
    cashClosings: [], stockAudits: [], activityLog: [], warranties: [], appUsers: [],
    suppliers: [], returns: [], sellerProfile: {},
    renderLogin() {}, renderSaleProducts() {}, renderCart() {}, renderProducts() {},
    renderHomeProducts() {}, renderStock() {}, renderTransfer() {}, renderStockAudit() {},
    renderCustomerSelect() {}, renderCustomers() {}, renderReports() {}, renderWarranties() {},
    renderUserAdmin() {}, renderSuppliers() {}, renderReturns() {}, renderPurchases() {},
    renderCash() {}, refresh() {}
  };
  vm.runInNewContext(source, context);
  context.importBackup({ size: 10 });
  assert.deepEqual(storage.values, original, 'all previous localStorage values must be restored');
  assert.ok(messages.some(message => message.includes('مساحة التخزين')));
});

test('backup restore imports product photos and all core datasets', () => {
  const start = html.indexOf('function importBackup(file)');
  const end = html.indexOf('\nfunction restoreAutoBackup()', start);
  assert.ok(start >= 0 && end > start, 'importBackup handler is missing');
  const photo = 'data:image/jpeg;base64,restored';
  const arrays = html.match(/function validBackupArrays\(data,required\)\{[^\n]+/);
  const validateArrays = vm.runInNewContext('(' + arrays[0] + ')');
  const messages = [];
  const backup = {
    products: [{ id: 9, image: photo, images: [photo] }],
    orders: [{ id: 8 }], customers: [{ id: 7 }], purchases: [{ id: 6 }],
    cashEntries: [{ id: 5 }], sellerProfile: { company: 'ELECTRO Sandy' }
  };
  const storage = {
    values: {},
    getItem(key) { return this.values[key] ?? null; },
    setItem(key, value) { this.values[key] = value; },
    removeItem(key) { delete this.values[key]; }
  };
  const context = {
    requireRole: () => true,
    validBackupArrays: validateArrays,
    document: { getElementById: () => ({ value: '' }) },
    FileReader: class { readAsText() { this.result = JSON.stringify({ data: backup }); this.onload(); } },
    localStorage: storage, confirm: () => true,
    savePreRestoreSafetyBackup: () => true, toast: message => messages.push(message),
    currentUser: { id: 1 }, cart: {},
    products: [], orders: [], customers: [], purchases: [], cashEntries: [],
    cashClosings: [], stockAudits: [], activityLog: [], warranties: [],
    appUsers: [{ id: 1, active: true }], suppliers: [], returns: [], sellerProfile: {},
    renderLogin() {}, renderSaleProducts() {}, renderCart() {}, renderProducts() {},
    renderHomeProducts() {}, renderStock() {}, renderTransfer() {}, renderStockAudit() {},
    renderCustomerSelect() {}, renderCustomers() {}, renderReports() {}, renderWarranties() {},
    renderUserAdmin() {}, renderSuppliers() {}, renderReturns() {}, renderPurchases() {},
    renderCash() {}, refresh() {}
  };
  vm.runInNewContext(html.slice(start, end), context);
  context.importBackup({ size: 10 });
  assert.ok(storage.values.es13_products, 'restore did not write product data: ' + messages.join(' | '));
  assert.equal(JSON.parse(storage.values.es13_products)[0].images[0], photo);
  assert.deepEqual(JSON.parse(storage.values.es13_orders), backup.orders);
  assert.deepEqual(JSON.parse(storage.values.es13_customers), backup.customers);
  assert.deepEqual(JSON.parse(storage.values.es13_purchases), backup.purchases);
  assert.deepEqual(JSON.parse(storage.values.es13_cash), backup.cashEntries);
  assert.equal(JSON.parse(storage.values.es13_seller_profile).company, 'ELECTRO Sandy');
  assert.equal(context.products[0].images[0], photo);
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

test('product image picker previews selected photos through blob URLs and accepts Android providers with empty MIME types', () => {
  assert.match(html, /onchange="previewNewProductImages\(this\)"/);
  assert.match(html, /function previewNewProductImages\(input\)/);
  assert.match(html, /URL\.createObjectURL\(file\)/);
  assert.match(html, /file\.type&&!String\(file\.type\)\.toLowerCase\(\)\.startsWith\('image\/'\)/);
  assert.match(html, /تعذر عرض الصورة بعد تجهيزها؛ حاول اختيارها مرة أخرى/);
  assert.match(html, /تعذر قراءة الصورة؛ جرّب حفظها بصيغة JPG أو PNG/);
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




function createImageCompressionHarness(options = {}) {
  const state = { canvasWidth: null, canvasHeight: null, quality: null, mime: null, drawArgs: null };
  class FakeImage {
    constructor() {
      this.width = options.imageWidth ?? 1800;
      this.height = options.imageHeight ?? 1200;
    }
    set src(value) {
      if (options.imageError) this.onerror(new Error('decode failed'));
      else this.onload();
    }
  }
  const context2d = options.noCanvasContext ? null : {
    drawImage(...args) { state.drawArgs = args; }
  };
  const document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        set width(value) { state.canvasWidth = value; },
        get width() { return state.canvasWidth; },
        set height(value) { state.canvasHeight = value; },
        get height() { return state.canvasHeight; },
        getContext(type) { assert.equal(type, '2d'); return context2d; },
        toDataURL(mime, quality) {
          state.mime = mime;
          state.quality = quality;
          if (options.output !== undefined) return options.output;
          return 'data:image/jpeg;base64,' + 'x'.repeat(120);
        }
      };
    }
  };
  const URL = {
    createObjectURL() {
      if (options.urlError) throw new Error('blob access denied');
      return 'blob:fake-image';
    },
    revokeObjectURL() {}
  };
  const context = { URL, Image: FakeImage, document, console: { info() {} } };
  const fn = html.match(/function compressProductImage\(file,done,fail\)\{[^\n]+/);
  assert.ok(fn, 'compressProductImage handler is missing');
  vm.runInNewContext(fn[0], context);
  return {
    state,
    compress(file = { size: 2048, type: options.fileType ?? 'image/jpeg' }) {
      return new Promise((resolve, reject) => context.compressProductImage(file, resolve, reject));
    }
  };
}

test('product image compression downsizes large images to 900px and encodes JPEG at quality 0.76', async () => {
  const harness = createImageCompressionHarness({ imageWidth: 1800, imageHeight: 1200 });
  const output = await harness.compress();
  assert.equal(harness.state.canvasWidth, 900);
  assert.equal(harness.state.canvasHeight, 600);
  assert.equal(harness.state.mime, 'image/jpeg');
  assert.equal(harness.state.quality, 0.76);
  assert.match(output, /^data:image\/jpeg;base64,/);
  assert.equal(harness.state.drawArgs[1], 0);
  assert.equal(harness.state.drawArgs[2], 0);
  assert.equal(harness.state.drawArgs[3], 900);
  assert.equal(harness.state.drawArgs[4], 600);
});

test('product image compression preserves small image dimensions without upscaling', async () => {
  const harness = createImageCompressionHarness({ imageWidth: 400, imageHeight: 300 });
  await harness.compress();
  assert.equal(harness.state.canvasWidth, 400);
  assert.equal(harness.state.canvasHeight, 300);
});

test('product image compression rejects inaccessible, non-image and unreadable files', async () => {
  await assert.rejects(createImageCompressionHarness({ urlError: true }).compress(), /تعذر فتح ملف الصورة من الهاتف/);
  await assert.rejects(createImageCompressionHarness({ fileType: 'text/plain' }).compress(), /الملف المختار ليس صورة قابلة للقراءة/);
  await assert.rejects(createImageCompressionHarness({ imageError: true }).compress(), /تعذر قراءة الصورة؛ جرّب حفظها بصيغة JPG أو PNG/);
});

test('product image compression rejects invalid dimensions, missing canvas context and invalid JPEG output', async () => {
  await assert.rejects(createImageCompressionHarness({ imageWidth: 0, imageHeight: 120 }).compress(), /أبعاد الصورة غير صالحة/);
  await assert.rejects(createImageCompressionHarness({ noCanvasContext: true }).compress(), /canvas unavailable/);
  await assert.rejects(createImageCompressionHarness({ output: 'data:image/png;base64,' + 'x'.repeat(120) }).compress(), /تعذر تحويل الصورة إلى ملف صالح/);
});

test('barcode scan launches the Android camera bridge and remembers its target', () => {
  const start = html.match(/function startBarcodeScan\(target\)\{[^\n]+/);
  assert.ok(start, 'startBarcodeScan handler is missing');
  let scans = 0;
  const scanner = { scanBarcode() { scans++; } };
  const context = {
    requireRole: () => true,
    window: { AndroidScanner: scanner },
    AndroidScanner: scanner,
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

test('printed invoices include seller, customer, item, discount, returns, paid amount and remaining balance safely', () => {
  const match = html.match(/function printInvoice\(id\)\{[\s\S]*?\n\}/);
  assert.ok(match, 'printInvoice handler is missing');
  let printed = null;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
  const order = {
    id: 7, invoiceNo: 'INV-007', date: '2026-11-12',
    customerInfo: { name: '<img src=x onerror=1>', phone: '0600000000', address: 'Tangier' },
    sellerInfo: { company: 'ELECTRO Sandy', name: 'Seller', phone: '0611111111', address: 'Morocco', ice: 'ICE-1' },
    payment: 'نقداً وجزئياً', source: 'central',
    items: [{ name: '<script>alert(1)</script>', qty: 2, unitPrice: 100, lineTotal: 200, serials: ['SN-1'], warrantyMonths: 12 }],
    subtotal: 220, total: 200, discountAmount: 20, discountPercent: 9.09,
    returnedAmount: 10, paidAmount: 125, balance: 75,
    loyaltyPointsRedeemed: 0, loyaltyDiscountAmount: 0
  };
  const context = {
    orders: [order], sellerProfile: {}, statementEscape: escape,
    document: { body: { classList: { contains: () => false } } },
    printHtmlDocument: (source, title) => { printed = { source, title }; }
  };
  vm.runInNewContext(match[0], context);
  context.printInvoice(7);
  assert.ok(printed, 'invoice HTML was not sent to the print handler');
  for (const value of ['ELECTRO Sandy', 'INV-007', 'Seller', '0600000000', 'Tangier', 'SN-1', '220.00 DH', '20.00 DH', '10.00 DH', '125.00 DH', '75.00 DH', '190.00 DH']) {
    assert.ok(printed.source.includes(value), 'printed invoice is missing: ' + value);
  }
  assert.ok(printed.source.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(printed.source.includes('&lt;img src=x onerror=1&gt;'));
  assert.equal(printed.source.includes('<script>alert(1)</script>'), false);
  assert.equal(printed.source.includes('<img src=x onerror=1>'), false);
  assert.match(printed.title, /INV-007/);
});

test('printed period report rejects missing, invalid and reversed dates before generating output', () => {
  const reportStart = html.indexOf('function printPeriodReport(){');
  const reportEnd = html.indexOf('function financialSummary', reportStart);
  assert.ok(reportStart >= 0 && reportEnd > reportStart, 'printPeriodReport handler is missing');
  const report = html.slice(reportStart, reportEnd).trim();
  const run = (from, to) => {
    const messages = [];
    let printCalls = 0;
    const fields = { reportFrom: { value: from }, reportTo: { value: to } };
    const context = {
      document: { getElementById: id => fields[id] || null },
      toast: message => messages.push(message),
      orders: [], returns: [], cashEntries: [],
      periodDate: () => null, periodSaleReceipts: () => 0,
      printHtmlDocument: () => { printCalls++; }
    };
    vm.runInNewContext(report, context);
    context.printPeriodReport();
    return { messages, printCalls };
  };
  assert.deepEqual(run('', '2026-11-12'), { messages: ['حدد فترة التقرير أولاً'], printCalls: 0 });
  assert.deepEqual(run('2026-02-30', '2026-03-01'), { messages: ['تاريخ الفترة غير صالح'], printCalls: 0 });
  assert.deepEqual(run('2026-11-13', '2026-11-12'), { messages: ['تاريخ البداية خاصو يكون قبل تاريخ النهاية'], printCalls: 0 });
});

test('period report CSV export rejects missing, invalid and reversed dates', () => {
  const start = html.indexOf('function exportPeriodReport(){');
  const end = html.indexOf('function financialSummary', start);
  assert.ok(start >= 0 && end > start, 'exportPeriodReport handler is missing');
  const handler = html.slice(start, end).trim();
  const run = (from, to) => {
    const messages = [];
    let exports = 0;
    const fields = { reportFrom: { value: from }, reportTo: { value: to } };
    const context = {
      document: { getElementById: id => fields[id] || null },
      toast: message => messages.push(message),
      orders: [], periodDate: () => null,
      saveTextFile: () => { exports++; }
    };
    vm.runInNewContext(handler, context);
    context.exportPeriodReport();
    return { messages, exports };
  };
  assert.deepEqual(run('', '2026-11-12'), { messages: ['حدد فترة التقرير أولاً'], exports: 0 });
  assert.deepEqual(run('2026-02-30', '2026-03-01'), { messages: ['تاريخ الفترة غير صالح'], exports: 0 });
  assert.deepEqual(run('not-a-date', '2026-03-01'), { messages: ['تاريخ الفترة غير صالح'], exports: 0 });
  assert.deepEqual(run('2026-11-13', '2026-11-12'), { messages: ['تاريخ البداية خاصو يكون قبل تاريخ النهاية'], exports: 0 });
});

test('printed period report accepts a valid date range and handles empty results', () => {
  const reportStart = html.indexOf('function printPeriodReport(){');
  const reportEnd = html.indexOf('function financialSummary', reportStart);
  assert.ok(reportStart >= 0 && reportEnd > reportStart, 'printPeriodReport handler is missing');
  const report = html.slice(reportStart, reportEnd).trim();
  const fields = { reportFrom: { value: '2026-11-01' }, reportTo: { value: '2026-11-12' } };
  let printed = null;
  const context = {
    document: { getElementById: id => fields[id] || null },
    toast() {}, orders: [], returns: [], cashEntries: [],
    periodDate: () => null, periodSaleReceipts: () => 0,
    statementEscape: value => String(value ?? ''),
    printHtmlDocument: (html, title) => { printed = { html, title }; }
  };
  vm.runInNewContext(report, context);
  context.printPeriodReport();
  assert.ok(printed, 'valid period should generate a report');
  assert.match(printed.html, /لا توجد فواتير/);
  assert.match(printed.html, /لا توجد مرتجعات/);
});

test('printed warranty report escapes stored text and explains an empty register', () => {
  const match = html.match(/function printWarranties\(\)\{[^\n]+/);
  assert.ok(match, 'printWarranties handler is missing');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
  let printed = null;
  const context = { warranties: [], statementEscape: escape, printHtmlDocument: source => { printed = source; } };
  vm.runInNewContext(match[0], context);
  context.printWarranties();
  assert.ok(printed.includes('لا توجد سجلات ضمان'));
  context.warranties = [{ productName: '<img src=x>', serial: 'SN-9', invoiceNo: 'INV-9', customer: '<script>x</script>', months: 12, expiresAt: 'invalid-date', status: 'active' }];
  context.printWarranties();
  assert.ok(printed.includes('&lt;img src=x&gt;'));
  assert.ok(printed.includes('&lt;script&gt;x&lt;/script&gt;'));
  assert.ok(printed.includes('SN-9'));
  assert.ok(printed.includes('—'));
  assert.equal(printed.includes('<script>x</script>'), false);
});

test('printed financial report includes discounts, returns, net, paid and remaining amounts safely', () => {
  const match = html.match(/function printFinancialReport\(\)\{[^\n]+/);
  assert.ok(match, 'printFinancialReport handler is missing');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
  let printed = null;
  const order = { invoiceNo: 'INV-10', date: '2026-11-12', customerInfo: { name: '<b>Client</b>' }, subtotal: 250, discountAmount: 25, returnedAmount: 20, total: 225, paidAmount: 150, balance: 75 };
  const context = {
    orders: [order], statementEscape: escape,
    financialSummary: () => ({ sales: 205, cost: 100, grossProfit: 105, cashBalance: 150, bankBalance: 0, expenses: 10, profit: 95 }),
    printHtmlDocument: source => { printed = source; }
  };
  vm.runInNewContext(match[0], context);
  context.printFinancialReport();
  for (const value of ['INV-10', '250.00', '25.00', '20.00', '225.00', '205.00', '150.00', '75.00']) {
    assert.ok(printed.includes(value), 'financial report missing ' + value);
  }
  assert.ok(printed.includes('&lt;b&gt;Client&lt;/b&gt;'));
  assert.equal(printed.includes('<b>Client</b>'), false);
});

test('native invoice printing bridge delegates HTML to Android PrintManager', () => {
  const match = html.match(/function printHtmlDocument\(html,title\)\{[^\n]+/);
  assert.ok(match, 'printHtmlDocument handler is missing');
  let received = null;
  const context = {
    window: { AndroidShare: { printHtml: (source, title) => { received = { source, title }; } } },
    toast() {}
  };
  vm.runInNewContext(match[0], context);
  assert.equal(context.printHtmlDocument('<html>invoice</html>', 'Invoice 1'), true);
  assert.deepEqual(received, { source: '<html>invoice</html>', title: 'Invoice 1' });
});

test('automatic lock clears the active session and opens the PIN login gate after inactivity', () => {
  const lock = html.match(/function lockApp\(\)\{[^\n]+/);
  const arm = html.match(/function armAutoLock\(\)\{[^\n]+/);
  assert.ok(lock && arm, 'auto-lock handlers are missing');
  let timerId = 0, timerCallback = null, cleared = [];
  const storage = new Map([['es13_auto_lock_minutes', '1']]);
  const authGate = { style: {} };
  let loginRendered = false;
  const context = {
    currentUser: { id: 9, name: 'Admin' }, inactivityTimer: null,
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    Date: { now: () => 1000 },
    setTimeout: callback => { timerCallback = callback; return ++timerId; },
    clearTimeout: id => cleared.push(id),
    renderLogin() { loginRendered = true; },
    document: { getElementById: id => id === 'authGate' ? authGate : null },
    toast() {}
  };
  vm.runInNewContext('let inactivityTimer=null,lastActivityAt=Date.now();' + lock[0] + arm[0], context);
  context.armAutoLock();
  assert.equal(timerId, 1);
  assert.equal(typeof timerCallback, 'function');
  timerCallback();
  assert.equal(context.currentUser, null);
  assert.equal(storage.get('es13_last_user_id'), '9');
  assert.equal(loginRendered, true);
  assert.equal(authGate.style.display, 'flex');
  assert.deepEqual(cleared, [null, 1]);
});

test('biometric login is enabled only after native authentication succeeds', () => {
  const match = html.match(/let biometricSetupPending=false;function toggleBiometricLogin\(\)[^\n]+/);
  assert.ok(match, 'biometric handlers are missing');
  const storage = new Map();
  let nativeCalls = 0;
  const biometric = { authenticateBiometric() { nativeCalls++; } };
  const context = {
    window: { AndroidBiometric: biometric }, AndroidBiometric: biometric,
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    requireRole: role => role === 'admin',
    toast() {}
  };
  vm.runInNewContext(match[0], context);
  context.toggleBiometricLogin();
  assert.equal(nativeCalls, 1);
  assert.equal(storage.has('es13_biometric_enabled'), false);
  context.onBiometricAuthenticated();
  assert.equal(storage.get('es13_biometric_enabled'), '1');
  context.toggleBiometricLogin();
  assert.equal(storage.has('es13_biometric_enabled'), false);
  context.toggleBiometricLogin();
  context.onBiometricError('cancelled');
  assert.equal(storage.has('es13_biometric_enabled'), false);
  assert.equal(vm.runInNewContext('biometricSetupPending', context), false);
});

test('Android native bridge routes biometric success and failure and uses Android PrintManager', () => {
  const javaPath = path.join(__dirname, '..', 'app', 'src', 'main', 'java', 'com', 'electrosandy', 'app', 'MainActivity.java');
  const java = fs.readFileSync(javaPath, 'utf8');
  assert.match(java, /@JavascriptInterface\s+public void authenticateBiometric\(\)/);
  assert.match(java, /window\.onBiometricAuthenticated\(\)/);
  assert.match(java, /window\.onBiometricError\(/);
  assert.match(java, /new BiometricPrompt\(main, ContextCompat\.getMainExecutor\(main\)/);
  assert.match(java, /BiometricManager\.from\(main\)\.canAuthenticate\(BiometricManager\.Authenticators\.BIOMETRIC_WEAK\)/);
  assert.match(java, /البصمة غير متاحة على هذا الجهاز؛ استعمل رمز PIN/);
  assert.match(java, /manager\.print\(/);
  assert.match(java, /createPrintDocumentAdapter\(jobName/);
});

test('successful biometric login restores only the last active saved user', () => {
  const match = html.match(/let biometricSetupPending=false;function toggleBiometricLogin\(\)[^\n]+/);
  assert.ok(match, 'biometric handlers are missing');
  const user = { id: 42, name: 'Admin', role: 'admin', active: true };
  const storage = new Map([['es13_last_user_id', '42'], ['es13_biometric_enabled', '1']]);
  const authGate = { style: { display: 'flex' } };
  const events = [];
  let nativeCalls = 0;
  const biometric = { authenticateBiometric() { nativeCalls++; } };
  const context = {
    currentUser: null, appUsers: [user],
    window: { AndroidBiometric: biometric, AndroidShare: { cloudCheckAuth() {} } },
    AndroidBiometric: biometric, AndroidShare: { cloudCheckAuth() {} },
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    document: { getElementById: id => id === 'authGate' ? authGate : null },
    updateCurrentUserBadge() {}, armAutoLock() {},
    logActivity: (action, detail) => events.push({ action, detail }),
    toast() {}
  };
  vm.runInNewContext(match[0], context);
  context.loginWithBiometric();
  assert.equal(nativeCalls, 1);
  context.onBiometricAuthenticated();
  assert.equal(context.currentUser.id, 42);
  assert.equal(authGate.style.display, 'none');
  assert.equal(events.length, 1);
  assert.match(events[0].action, /دخول بالبصمة/);
});



test('native product image picker normalizes supported Android image formats to JPEG', () => {
  const javaPath = path.join(__dirname, '..', 'app', 'src', 'main', 'java', 'com', 'electrosandy', 'app', 'MainActivity.java');
  const manifestPath = path.join(__dirname, '..', 'app', 'src', 'main', 'AndroidManifest.xml');
  const gradlePath = path.join(__dirname, '..', 'app', 'build.gradle');
  const providerPath = path.join(__dirname, '..', 'app', 'src', 'main', 'res', 'xml', 'product_image_paths.xml');
  const java = fs.readFileSync(javaPath, 'utf8');
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  const gradle = fs.readFileSync(gradlePath, 'utf8');
  const provider = fs.readFileSync(providerPath, 'utf8');
  assert.match(java, /new Intent\(Intent\.ACTION_GET_CONTENT\)/);
  assert.match(java, /intent\.setType\("image\/\*"/);
  assert.match(java, /Intent\.EXTRA_ALLOW_MULTIPLE/);
  assert.match(java, /ImageDecoder\.decodeBitmap/);
  assert.match(java, /BitmapFactory\.decodeStream/);
  assert.match(java, /new ExifInterface\(in\)/);
  assert.match(java, /Bitmap\.CompressFormat\.JPEG/);
  assert.match(java, /getPackageName\(\) \+ "\.fileprovider"/);
  assert.match(java, /selected\.length > 3/);
  assert.match(manifest, /androidx\.core\.content\.FileProvider/);
  assert.match(manifest, /\$\{applicationId\}\.fileprovider/);
  assert.match(gradle, /androidx\.exifinterface:exifinterface/);
  assert.match(provider, /cache-path name="product_images" path="product-images\/"\s*\//);
  assert.match(html, /accept="image\/\*"[^>]*multiple/);
});
