const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'www', 'index.html'), 'utf8');

function oneLineFunction(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'Missing application function: ' + name);
  const end = html.indexOf('\n', start);
  return html.slice(start, end < 0 ? html.length : end);
}

function blockFunction(name, nextName) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'Missing application function: ' + name);
  const end = html.indexOf('function ' + nextName + '(', start + 1);
  assert.ok(end > start, 'Could not locate end of ' + name);
  const close = html.lastIndexOf('}', end);
  assert.ok(close > start, 'Could not locate closing brace for ' + name);
  return html.slice(start, close + 1);
}

function purchaseHarness({ mode = 'partial', paid = 30, method = 'bank', supplier = true } = {}) {
  const fields = {
    purchaseSupplier: { value: supplier ? '7' : '' },
    purchaseProduct: { value: '3' },
    purchaseQty: { value: '3' },
    purchasePrice: { value: '20' },
    purchaseSerials: { value: '' },
    purchasePaymentMode: { value: mode },
    purchasePaymentMethod: { value: method },
    purchasePaid: { value: String(paid) }
  };
  const product = { id: 3, name: 'Test item', central: 2, van1: 0, van2: 0, costPrice: 10, costBasisVerified: true, serials: [] };
  const purchases = [];
  const cashEntries = [];
  const messages = [];
  const context = vm.createContext({
    Math, Number, String, Array, Set, Date,
    document: { getElementById: id => fields[id] || null },
    products: [product],
    suppliers: supplier ? [{ id: 7, name: 'Test supplier' }] : [],
    purchases,
    cashEntries,
    currentUser: { name: 'Tester' },
    requireRole: () => true,
    save: () => true,
    toast: message => messages.push(message),
    togglePurchasePayment: () => {},
    renderPurchases: () => {},
    renderCash: () => {},
    logActivity: () => {}
  });
  vm.runInContext(oneLineFunction('addPurchase'), context);
  context.addPurchase();
  return { product, purchases, cashEntries, messages };
}

test('partial supplier purchase updates stock, weighted cost, payable and bank outflow', () => {
  const { product, purchases, cashEntries } = purchaseHarness();
  assert.equal(product.central, 5);
  assert.equal(product.costPrice, 16);
  assert.equal(product.costBasisVerified, true);
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].total, 60);
  assert.equal(purchases[0].paidAmount, 30);
  assert.equal(purchases[0].balance, 30);
  assert.equal(purchases[0].paymentHistory[0].method, 'bank');
  assert.equal(cashEntries.length, 1);
  assert.equal(cashEntries[0].type, 'out');
  assert.equal(cashEntries[0].method, 'bank');
  assert.equal(cashEntries[0].amount, 30);
});

test('deferred supplier purchase updates stock without recording an immediate cash or bank payment', () => {
  const { product, purchases, cashEntries } = purchaseHarness({ mode: 'deferred', paid: 0 });
  assert.equal(product.central, 5);
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].paidAmount, 0);
  assert.equal(purchases[0].balance, 60);
  assert.equal(purchases[0].paymentHistory.length, 0);
  assert.equal(cashEntries.length, 0);
});

test('invalid partial payment is rejected before stock or purchase data changes', () => {
  const { product, purchases, cashEntries, messages } = purchaseHarness({ mode: 'partial', paid: 60 });
  assert.equal(product.central, 2);
  assert.equal(purchases.length, 0);
  assert.equal(cashEntries.length, 0);
  assert.ok(messages.length > 0);
});

test('deferred purchase without a supplier is rejected', () => {
  const { product, purchases, cashEntries, messages } = purchaseHarness({ mode: 'deferred', paid: 0, supplier: false });
  assert.equal(product.central, 2);
  assert.equal(purchases.length, 0);
  assert.equal(cashEntries.length, 0);
  assert.ok(messages.length > 0);
});

test('financial summary separates original mixed receipts, debt collections, refunds, purchases and expenses', () => {
  const order = {
    id: 11, payment: 'مختلط / Mixte', total: 100, paidAmount: 70,
    paidCashAmount: 40, paidBankAmount: 30, balance: 20,
    createdAt: '2026-11-08T10:00:00.000Z',
    costMethod: 'weighted_average_verified', costTotal: 60, returnedAmount: 10,
    returnCostTotal: 6, customerId: 4
  };
  const entries = [
    { id: 1, relatedOrderId: 11, amount: 10, type: 'in', method: 'cash', entryKind: 'debt_payment', note: 'أداء دين الفاتورة ES-11' },
    { id: 2, relatedOrderId: 11, amount: 10, type: 'out', method: 'cash', entryKind: 'sale_refund', note: 'استرجاع فاتورة نقدي ES-11' },
    { id: 3, amount: 15, type: 'out', method: 'bank', relatedPurchaseId: 99, note: 'أداء شراء' },
    { id: 4, amount: 4, type: 'out', method: 'cash', note: 'مصاريف نقل' },
    { id: 5, amount: 5, type: 'in', method: 'bank', note: 'إيداع بنكي' }
  ];
  const context = vm.createContext({ Math, Number, String, Array, Date, orders: [order], cashEntries: entries });
  vm.runInContext([
    oneLineFunction('orderPaidMethodBalances'),
    oneLineFunction('orderInitialPaidMethodBalances'),
    blockFunction('financialSummary', 'renderReports')
  ].join('\n'), context);
  const summary = context.financialSummary();
  assert.equal(summary.sales, 90);
  assert.equal(summary.cost, 54);
  assert.equal(summary.grossProfit, 36);
  assert.equal(summary.expenses, 4);
  assert.equal(summary.cashBalance, 36);
  assert.equal(summary.bankBalance, 20);
  assert.equal(summary.debt, 20);
});


function returnHarness({ qty = 1, alreadyReturned = 0 } = {}) {
  const fields = {
    returnInvoice: { value: '11' },
    returnItem: { value: '0' },
    returnQty: { value: String(qty) },
    returnReason: { value: 'Damaged item' },
    returnSerials: { value: '' }
  };
  const item = { productId: 3, name: 'Test item', qty: 2, returnedQty: alreadyReturned, unitPrice: 50, unitCost: 20, serials: [] };
  const order = {
    id: 11, invoiceNo: 'ES-11', total: 100, subtotal: 100, discountPercent: 0,
    loyaltyDiscountAmount: 0, balance: 20, paidAmount: 80,
    paidCashAmount: 50, paidBankAmount: 30, payment: 'مختلط / Mixte',
    source: 'central', returnedAmount: alreadyReturned * 50,
    returnedBaseAmount: alreadyReturned * 50, cashRefundTotal: 0,
    returnCostTotal: alreadyReturned * 20, costMethod: 'weighted_average_verified',
    costTotal: 40, loyaltyPointsRedeemed: 0, loyaltyPointsRestored: 0,
    loyaltyPointsEarned: 10, loyaltyPointsReversed: 0, customerId: 4,
    items: [item]
  };
  const product = { id: 3, central: 2, van1: 0, van2: 0, costPrice: 20, costBasisVerified: true, serials: [] };
  const customer = { id: 4, loyaltyPoints: 10 };
  const returns = [];
  const cashEntries = [];
  const messages = [];
  const context = vm.createContext({
    Math, Number, String, Array, Set, Date,
    document: { getElementById: id => fields[id] || null },
    orders: [order], products: [product], customers: [customer],
    returns, cashEntries, warranties: [],
    requireRole: () => true, save: () => true,
    toast: message => messages.push(message),
    renderReturns: () => {}, renderReports: () => {}, renderCash: () => {},
    renderStock: () => {}, renderProducts: () => {}, renderHomeProducts: () => {},
    logActivity: () => {}
  });
  vm.runInContext([
    oneLineFunction('orderPaidMethodBalances'),
    blockFunction('recordReturn', 'saveSupplier')
  ].join('\n'), context);
  context.recordReturn();
  return { item, order, product, customer, returns, cashEntries, messages };
}

test('mixed-payment return restores stock, offsets debt and splits the cash refund proportionally', () => {
  const { item, order, product, customer, returns, cashEntries } = returnHarness();
  assert.equal(item.returnedQty, 1);
  assert.equal(product.central, 3);
  assert.equal(order.balance, 0);
  assert.equal(order.returnedAmount, 50);
  assert.equal(order.paidAmount, 50);
  assert.equal(order.paidCashAmount, 31.25);
  assert.equal(order.paidBankAmount, 18.75);
  assert.equal(cashEntries.length, 2);
  assert.equal(cashEntries.find(x => x.method === 'cash').amount, 18.75);
  assert.equal(cashEntries.find(x => x.method === 'bank').amount, 11.25);
  assert.equal(customer.loyaltyPoints, 5);
  assert.equal(returns.length, 1);
  assert.equal(returns[0].refund, 50);
});

test('return exceeding the remaining item quantity is rejected without changing stock or balances', () => {
  const { item, order, product, returns, cashEntries, messages } = returnHarness({ qty: 1, alreadyReturned: 2 });
  assert.equal(item.returnedQty, 2);
  assert.equal(product.central, 2);
  assert.equal(order.paidAmount, 80);
  assert.equal(order.balance, 20);
  assert.equal(returns.length, 0);
  assert.equal(cashEntries.length, 0);
  assert.ok(messages.length > 0);
});


function checkoutHarness({ cash = 40, bank = 30, redeem = 20 } = {}) {
  const fields = {
    saleSource: { value: 'central' }, saleDiscount: { value: '0' },
    payment: { value: 'مختلط / Mixte' }, saleCustomer: { value: '4' },
    saleRedeemPoints: { value: String(redeem) },
    saleCashAmount: { value: String(cash) }, saleBankAmount: { value: String(bank) }
  };
  const product = { id: 3, name: 'Test item', price: 100, central: 5, van1: 0, van2: 0, costPrice: 50, costBasisVerified: true, warrantyMonths: 0, serials: [] };
  const customer = { id: 4, name: 'Test customer', phone: '', address: '', loyaltyPoints: 50 };
  const cart = { 3: 1 }, orders = [], warranties = [], messages = [];
  const context = vm.createContext({
    Math, Number, String, Array, Object, Date,
    document: { getElementById: id => fields[id] || null },
    products: [product], customers: [customer], cart, orders, warranties,
    sellerProfile: { company: 'ELECTRO Sandy' },
    currentUser: { id: 1, name: 'Tester', role: 'admin' },
    requireRole: () => true, save: () => true,
    addCalendarMonths: date => date,
    toggleSalePaymentFields: () => {}, renderCart: () => {}, renderSaleProducts: () => {},
    logActivity: () => {}, toast: message => messages.push(message)
  });
  vm.runInContext(oneLineFunction('checkout'), context);
  context.checkout();
  return { product, customer, orders, messages, context };
}

test('mixed sale applies loyalty redemption and earns points only on the amount paid', () => {
  const { product, customer, orders } = checkoutHarness();
  const order = orders[0];
  assert.equal(product.central, 4);
  assert.equal(order.total, 98);
  assert.equal(order.loyaltyPointsRedeemed, 20);
  assert.equal(order.loyaltyDiscountAmount, 2);
  assert.equal(order.paidCashAmount, 40);
  assert.equal(order.paidBankAmount, 30);
  assert.equal(order.paidAmount, 70);
  assert.equal(order.balance, 28);
  assert.equal(order.loyaltyPointsEarned, 7);
  assert.equal(customer.loyaltyPoints, 37);
});

test('mixed sale rejects payments above the discounted invoice total without mutating stock or loyalty', () => {
  const { product, customer, orders, messages } = checkoutHarness({ cash: 90, bank: 20, redeem: 0 });
  assert.equal(product.central, 5);
  assert.equal(customer.loyaltyPoints, 50);
  assert.equal(orders.length, 0);
  assert.ok(messages.length > 0);
});

function supplierPaymentHarness() {
  const supplier = { id: 7, name: 'Test supplier' };
  const purchases = [
    { id: 1, supplierId: 7, total: 20, paidAmount: 0, balance: 20, paymentHistory: [], createdAt: '2026-11-01T00:00:00.000Z' },
    { id: 2, supplierId: 7, total: 30, paidAmount: 0, balance: 30, paymentHistory: [], createdAt: '2026-11-02T00:00:00.000Z' }
  ];
  const cashEntries = [], messages = [];
  const context = vm.createContext({
    Math, Number, String, Array, Date,
    suppliers: [supplier], purchases, cashEntries,
    currentUser: { name: 'Tester' },
    requireRole: () => true, askPaymentMethod: () => 'bank', prompt: () => '35',
    save: () => true, toast: message => messages.push(message),
    renderPurchases: () => {}, renderCash: () => {}, renderSuppliers: () => {},
    logActivity: () => {}
  });
  vm.runInContext([
    oneLineFunction('supplierOutstanding'),
    blockFunction('paySupplier', 'editSupplier')
  ].join('\n'), context);
  context.paySupplier(7);
  return { purchases, cashEntries, messages };
}

test('supplier payment allocates oldest payable first and records one bank outflow', () => {
  const { purchases, cashEntries } = supplierPaymentHarness();
  assert.equal(purchases[0].paidAmount, 20);
  assert.equal(purchases[0].balance, 0);
  assert.equal(purchases[1].paidAmount, 15);
  assert.equal(purchases[1].balance, 15);
  assert.equal(purchases[0].paymentHistory[0].method, 'bank');
  assert.equal(purchases[1].paymentHistory[0].method, 'bank');
  assert.equal(cashEntries.length, 1);
  assert.equal(cashEntries[0].amount, 35);
  assert.equal(cashEntries[0].method, 'bank');
  assert.equal(cashEntries[0].allocations.length, 2);
});


test('daily cash closing records the computed expected balance and blocks a duplicate close', () => {
  const fields = { actualCash: { value: '60' }, cashCloseResult: { textContent: '' } };
  const cashClosings = [], messages = [];
  const context = vm.createContext({
    Math, Number, String, Array, Date,
    document: { getElementById: id => fields[id] || null },
    cashClosings, requireRole: () => true,
    localDayKey: value => {
      const d = value instanceof Date ? value : new Date(value);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    },
    calculateCashExpectedForDay: () => 55,
    orders: [], cashEntries: [], save: () => true,
    logActivity: () => {}, toast: message => messages.push(message)
  });
  vm.runInContext(oneLineFunction('closeDailyCash'), context);
  context.closeDailyCash();
  assert.equal(cashClosings.length, 1);
  assert.equal(cashClosings[0].expected, 55);
  assert.equal(cashClosings[0].actual, 60);
  assert.equal(cashClosings[0].difference, 5);
  assert.match(fields.cashCloseResult.textContent, /55\.00 DH/);
  context.closeDailyCash();
  assert.equal(cashClosings.length, 1);
  assert.ok(messages.some(message => String(message).includes('من قبل')));
});

test('backup user validation requires a unique active administrator and a supported PIN hash', () => {
  const validAdmin = {
    id: 1, name: 'Admin', role: 'admin', active: true,
    pinHash: 'pbkdf2$120000$' + 'a'.repeat(32) + '$' + 'b'.repeat(64)
  };
  const context = vm.createContext({ Math, Number, String, Array, Set });
  vm.runInContext(oneLineFunction('validUserBackup'), context);
  assert.equal(context.validUserBackup([validAdmin]), true);
  assert.equal(context.validUserBackup([{ ...validAdmin, role: 'seller' }]), false);
  assert.equal(context.validUserBackup([{ ...validAdmin, pinHash: 'bad-hash' }]), false);
  assert.equal(context.validUserBackup([validAdmin, { ...validAdmin, id: 2, name: 'Other' }]), true);
  assert.equal(context.validUserBackup([validAdmin, { ...validAdmin, name: 'Admin' }]), false);
});


test('customer debt collection updates bank balance, invoice history and loyalty points', () => {
  const order = {
    id: 21, invoiceNo: 'ES-21', total: 100, payment: 'دين / Crédit',
    paidAmount: 0, paidCashAmount: 0, paidBankAmount: 0, balance: 100,
    customerId: 4, loyaltyPointsEarned: 0
  };
  const customer = { id: 4, loyaltyPoints: 0 };
  const cashEntries = [], messages = [];
  const context = vm.createContext({
    Math, Number, String, Array, Date,
    orders: [order], customers: [customer], cashEntries,
    currentUser: { name: 'Tester' },
    requireRole: () => true, askPaymentMethod: () => 'bank',
    prompt: () => '50', save: () => true,
    renderReports: () => {}, renderCash: () => {},
    logActivity: () => {}, toast: message => messages.push(message)
  });
  vm.runInContext([
    oneLineFunction('orderPaidMethodBalances'),
    blockFunction('payDebt', 'showDebtHistory')
  ].join('\n'), context);
  context.payDebt(21);
  assert.equal(order.paidAmount, 50);
  assert.equal(order.paidCashAmount, 0);
  assert.equal(order.paidBankAmount, 50);
  assert.equal(order.balance, 50);
  assert.equal(order.paymentHistory.length, 1);
  assert.equal(order.paymentHistory[0].method, 'bank');
  assert.equal(customer.loyaltyPoints, 5);
  assert.equal(cashEntries.length, 1);
  assert.equal(cashEntries[0].type, 'in');
  assert.equal(cashEntries[0].method, 'bank');
  assert.equal(cashEntries[0].amount, 50);
});


test('automatic lock timer uses the saved inactivity period and supports disabling it', () => {
  function timerFor(minutes) {
    let scheduled = null;
    const context = vm.createContext({
      Math, Number, String, Date,
      currentUser: { id: 1 }, inactivityTimer: 12, lastActivityAt: 0,
      localStorage: { getItem: () => minutes === null ? null : String(minutes) },
      clearTimeout: () => {},
      setTimeout: (callback, delay) => { scheduled = { callback, delay }; return 99; },
      lockApp: () => {}
    });
    vm.runInContext(oneLineFunction('armAutoLock'), context);
    context.armAutoLock();
    return { scheduled, lastActivityAt: context.lastActivityAt };
  }
  assert.equal(timerFor(5).scheduled.delay, 5 * 60000);
  assert.equal(timerFor(null).scheduled.delay, 10 * 60000);
  assert.equal(timerFor(0).scheduled, null);
});

test('automatic lock clears the active user session and displays the login gate', () => {
  const authGate = { style: { display: 'none' } }, messages = [];
  const context = vm.createContext({
    Math, Number, String, Date,
    currentUser: { id: 1 }, inactivityTimer: 44,
    localStorage: { setItem: () => {} },
    clearTimeout: () => {}, renderLogin: () => {},
    document: { getElementById: id => id === 'authGate' ? authGate : null },
    toast: message => messages.push(message)
  });
  vm.runInContext(oneLineFunction('lockApp'), context);
  context.lockApp();
  assert.equal(context.currentUser, null);
  assert.equal(authGate.style.display, 'flex');
  assert.ok(messages.length > 0);
});


test('pre-restore safety backup stores all current business data and verifies the saved snapshot', () => {
  const storage = new Map();
  const context = vm.createContext({
    Math, Number, String, Array, Date,
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    products: [{ id: 1 }], orders: [{ id: 2 }], customers: [{ id: 3 }],
    purchases: [{ id: 4 }], cashEntries: [{ id: 5 }], cashClosings: [{ date: '2026-11-08' }],
    stockAudits: [], activityLog: [], warranties: [], appUsers: [{ id: 6 }],
    suppliers: [{ id: 7 }], returns: [{ id: 8 }],
    sellerProfile: { company: 'ELECTRO Sandy' }
  });
  vm.runInContext(oneLineFunction('savePreRestoreSafetyBackup'), context);
  assert.equal(context.savePreRestoreSafetyBackup(), true);
  const saved = JSON.parse(storage.get('es13_auto_backups'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].data.products[0].id, 1);
  assert.equal(saved[0].data.cashClosings[0].date, '2026-11-08');
  assert.equal(saved[0].data.returns[0].id, 8);
  assert.equal(saved[0].data.sellerProfile.company, 'ELECTRO Sandy');
});

test('pre-restore safety backup fails closed when storage cannot save the snapshot', () => {
  const context = vm.createContext({
    Math, Number, String, Array, Date,
    localStorage: { getItem: () => '[]', setItem: () => { throw new Error('quota'); } },
    products: [], orders: [], customers: [], purchases: [], cashEntries: [],
    cashClosings: [], stockAudits: [], activityLog: [], warranties: [],
    appUsers: [], suppliers: [], returns: [], sellerProfile: {}
  });
  vm.runInContext(oneLineFunction('savePreRestoreSafetyBackup'), context);
  assert.equal(context.savePreRestoreSafetyBackup(), false);
});


test('failed local save rolls business arrays back to the last persisted snapshot', () => {
  const storage = new Map([
    ['es13_products', JSON.stringify([{ id: 1, name: 'Saved product' }])],
    ['es13_orders', JSON.stringify([{ id: 2 }])],
    ['es13_customers', JSON.stringify([{ id: 3 }])],
    ['es13_purchases', JSON.stringify([{ id: 4 }])],
    ['es13_cash', JSON.stringify([{ id: 5 }])],
    ['es13_seller_profile', JSON.stringify({ company: 'Saved shop' })]
  ]);
  const context = vm.createContext({
    Math, Number, String, Array, Date, JSON,
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => {
        if (key === 'es13_orders') throw new Error('quota');
        storage.set(key, String(value));
      },
      removeItem: key => storage.delete(key)
    },
    products: [{ id: 99 }], orders: [{ id: 98 }], customers: [{ id: 97 }],
    purchases: [{ id: 96 }], cashEntries: [{ id: 95 }],
    sellerProfile: { company: 'Unsaved shop' },
    warranties: [], returns: [], suppliers: [], stockAudits: [], cashClosings: [],
    cloudSyncConflict: false, cloudAutoSyncEnabled: true,
    cloudRefreshAutoSyncUi: () => {}, cloudSetStatus: () => {},
    toast: () => {}, refresh: () => {}
  });
  vm.runInContext(oneLineFunction('save'), context);
  assert.equal(context.save(), false);
  assert.equal(context.products[0].id, 1);
  assert.equal(context.products[0].name, 'Saved product');
  assert.equal(context.orders[0].id, 2);
  assert.equal(context.customers[0].id, 3);
  assert.equal(context.purchases[0].id, 4);
  assert.equal(context.cashEntries[0].id, 5);
  assert.equal(context.sellerProfile.company, 'Saved shop');
  assert.equal(context.cloudSyncConflict, true);
  assert.equal(context.cloudAutoSyncEnabled, false);
});



function periodReportHarness() {
  const fields = {
    reportFrom: { value: '2026-11-08' },
    reportTo: { value: '2026-11-08' },
    periodReportResult: { innerHTML: '', textContent: '' },
    periodReportRows: { innerHTML: '' }
  };
  const order = {
    id: 11, invoiceNo: 'ES-11', date: '2026-11-08', customer: 'Test customer',
    total: 100, paidAmount: 70, paidCashAmount: 43.75, paidBankAmount: 26.25,
    balance: 30, payment: 'مختلط / Mixte', createdAt: '2026-11-08T12:00:00',
    costMethod: 'weighted_average_verified', costTotal: 60, returnedAmount: 10
  };
  const returnRows = [{
    id: 1, orderId: 11, refund: 10, costReturned: 6,
    createdAt: '2026-11-08T13:00:00'
  }];
  const entries = [
    { id: 1, relatedOrderId: 11, amount: 10, type: 'in', method: 'cash', entryKind: 'debt_payment', createdAt: '2026-11-08T12:30:00' },
    { id: 2, relatedOrderId: 11, amount: 6.25, type: 'out', method: 'cash', entryKind: 'sale_refund', createdAt: '2026-11-08T13:00:00' },
    { id: 3, relatedOrderId: 11, amount: 3.75, type: 'out', method: 'bank', entryKind: 'sale_refund', createdAt: '2026-11-08T13:00:00' },
    { id: 4, amount: 4, type: 'out', method: 'cash', note: 'مصاريف نقل', createdAt: '2026-11-08T14:00:00' },
    { id: 5, amount: 5, type: 'in', method: 'bank', note: 'إيداع بنكي', createdAt: '2026-11-08T14:00:00' },
    { id: 6, amount: 3, type: 'out', method: 'bank', note: 'رسوم بنكية', createdAt: '2026-11-08T14:00:00' }
  ];
  const messages = [];
  const context = vm.createContext({
    Math, Number, String, Array, Date,
    document: { getElementById: id => fields[id] || null },
    orders: [order], returns: returnRows, cashEntries: entries,
    periodDate: x => { const d = new Date(x.createdAt || x.id || x.date || 0); return Number.isNaN(d.getTime()) ? null : d; },
    statementEscape: x => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    toast: message => messages.push(message)
  });
  vm.runInContext([
    oneLineFunction('orderPaidMethodBalances'),
    oneLineFunction('orderInitialPaidMethodBalances'),
    oneLineFunction('periodSaleReceipts'),
    blockFunction('renderPeriodReport', 'printPeriodReport')
  ].join('\n'), context);
  return { fields, order, returnRows, entries, messages, context };
}

test('period report separates net sales, returns, known cost, cash and bank flows', () => {
  const { fields, context } = periodReportHarness();
  context.renderPeriodReport();
  const html = fields.periodReportResult.innerHTML;
  assert.match(html, /المبيعات الصافية<strong>90\.00 DH/);
  assert.match(html, /المرتجعات خلال الفترة<strong>10\.00 DH/);
  assert.match(html, /تكلفة البضاعة الصافية المعروفة<strong>54\.00 DH/);
  assert.match(html, /الربح الإجمالي المعروف<strong>36\.00 DH/);
  assert.match(html, /المصاريف المسجلة<strong>7\.00 DH/);
  assert.match(html, /مصاريف الصندوق<strong>4\.00 DH/);
  assert.match(html, /مصاريف البنك<strong>3\.00 DH/);
  assert.match(html, /مداخيل الصندوق<strong>50\.00 DH/);
  assert.match(html, /مداخيل البنك<strong>35\.00 DH/);
  assert.match(html, /ديون الفواتير<strong>30\.00 DH/);
  assert.equal(fields.periodReportRows.innerHTML.includes('ES-11'), true);
});

test('period CSV export filters by selected dates and safely quotes customer data', () => {
  const fields = {
    reportFrom: { value: '2026-11-08' },
    reportTo: { value: '2026-11-08' }
  };
  const saved = [];
  const context = vm.createContext({
    Math, Number, String, Array, Date,
    document: { getElementById: id => fields[id] || null },
    orders: [
      { id: 11, invoiceNo: 'ES-11', date: '2026-11-08', customerInfo: { name: 'Ali "A"' }, total: 100, paidAmount: 70, balance: 30, createdAt: '2026-11-08T12:00:00' },
      { id: 12, invoiceNo: 'ES-12', date: '2026-11-09', customer: 'Outside period', total: 50, paidAmount: 50, balance: 0, createdAt: '2026-11-09T12:00:00' }
    ],
    periodDate: x => { const d = new Date(x.createdAt || x.id || x.date || 0); return Number.isNaN(d.getTime()) ? null : d; },
    saveTextFile: (...args) => saved.push(args),
    toast: () => {}
  });
  vm.runInContext(blockFunction('exportPeriodReport', 'financialSummary'), context);
  context.exportPeriodReport();
  assert.equal(saved.length, 1);
  assert.equal(saved[0][0], 'ELECTRO-Sandy-periode-2026-11-08-2026-11-08.csv');
  assert.match(saved[0][1], /"Ali ""A"""/);
  assert.match(saved[0][1], /ES-11/);
  assert.doesNotMatch(saved[0][1], /ES-12|Outside period/);
});

test('period CSV export rejects a reversed date range without creating a file', () => {
  const fields = {
    reportFrom: { value: '2026-11-09' },
    reportTo: { value: '2026-11-08' }
  };
  const saved = [], messages = [];
  const context = vm.createContext({
    Math, Number, String, Array, Date,
    document: { getElementById: id => fields[id] || null },
    orders: [], periodDate: () => null,
    saveTextFile: (...args) => saved.push(args),
    toast: message => messages.push(message)
  });
  vm.runInContext(blockFunction('exportPeriodReport', 'financialSummary'), context);
  context.exportPeriodReport();
  assert.equal(saved.length, 0);
  assert.deepEqual(messages, ['تاريخ البداية خاصو يكون قبل تاريخ النهاية']);
});

function cashEntryHarness({ amount = '125', note = 'مصاريف نقل', type = 'out', method = 'cash', allowed = true } = {}) {
  const fields = {
    cashAmount: { value: amount },
    cashNote: { value: note, valueSetter: null },
    cashType: { value: type },
    cashMethod: { value: method }
  };
  const cashEntries = [], messages = [], activities = [];
  const context = vm.createContext({
    Math, Number, String, Array, Date,
    document: { getElementById: id => fields[id] || null },
    cashEntries,
    requireRole: () => allowed,
    save: () => true,
    renderCash: () => {},
    logActivity: (...args) => activities.push(args),
    toast: message => messages.push(message),
    currentUser: { name: 'Tester' }
  });
  vm.runInContext(oneLineFunction('addCashEntry'), context);
  context.addCashEntry();
  return { cashEntries, messages, activities, fields };
}

test('manual cash income is recorded only in the selected cash account', () => {
  const { cashEntries, fields } = cashEntryHarness({ amount: '125', note: 'مبيعات أخرى', type: 'in', method: 'cash' });
  assert.equal(cashEntries.length, 1);
  assert.equal(cashEntries[0].type, 'in');
  assert.equal(cashEntries[0].method, 'cash');
  assert.equal(cashEntries[0].amount, 125);
  assert.equal(fields.cashNote.value, '');
});

test('manual bank expense is recorded only in the selected bank account', () => {
  const { cashEntries } = cashEntryHarness({ amount: '80.5', type: 'out', method: 'bank' });
  assert.equal(cashEntries.length, 1);
  assert.equal(cashEntries[0].type, 'out');
  assert.equal(cashEntries[0].method, 'bank');
  assert.equal(cashEntries[0].amount, 80.5);
});

test('invalid manual cash entry is rejected without changing balances', () => {
  for (const options of [{ amount: '0' }, { amount: '-5' }, { note: '   ' }, { type: 'transfer' }, { method: 'other' }]) {
    const { cashEntries, messages } = cashEntryHarness(options);
    assert.equal(cashEntries.length, 0);
    assert.ok(messages.length > 0);
  }
});

test('manual cash entry requires administrator permission', () => {
  const { cashEntries, messages } = cashEntryHarness({ allowed: false });
  assert.equal(cashEntries.length, 0);
  assert.equal(messages.length, 0);
});


// Backup import and cloud restore integration harnesses.
function backupImportHarness({ backup, failKey = null } = {}) {
  const storage = new Map();
  const old = {
    products: [{ id: 1, name: 'Local product' }], orders: [{ id: 10 }],
    customers: [], purchases: [], cashEntries: [], cashClosings: [],
    stockAudits: [], activityLog: [], warranties: [], suppliers: [], returns: [],
    sellerProfile: { company: 'Local shop' }
  };
  const keyMap = {
    products: 'es13_products', orders: 'es13_orders', customers: 'es13_customers',
    purchases: 'es13_purchases', cashEntries: 'es13_cash', cashClosings: 'es13_cash_closings',
    stockAudits: 'es13_stock_audits', activityLog: 'es13_activity_log',
    warranties: 'es13_warranties', suppliers: 'es13_suppliers', returns: 'es13_returns',
    sellerProfile: 'es13_seller_profile'
  };
  for (const [name, key] of Object.entries(keyMap)) storage.set(key, JSON.stringify(old[name]));
  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => {
      if (key === failKey) throw new Error('quota');
      storage.set(key, String(value));
    },
    removeItem: key => storage.delete(key)
  };
  const fields = { backupFile: { value: 'backup.json' } };
  const messages = [];
  class FakeFileReader {
    readAsText(file) { this.result = file.content; this.onload(); }
  }
  const context = vm.createContext({
    Math, Number, String, Array, Set, Date, JSON, FileReader: FakeFileReader,
    localStorage, document: { getElementById: id => fields[id] || null },
    products: old.products, orders: old.orders, customers: old.customers,
    purchases: old.purchases, cashEntries: old.cashEntries, cashClosings: old.cashClosings,
    stockAudits: old.stockAudits, activityLog: old.activityLog, warranties: old.warranties,
    appUsers: [{ id: 1, name: 'Admin', role: 'admin', active: true, pinHash: 'fallback-a' }],
    suppliers: old.suppliers, returns: old.returns, sellerProfile: old.sellerProfile,
    currentUser: { id: 1, role: 'admin' }, cart: {},
    requireRole: () => true, confirm: () => true, toast: message => messages.push(message),
    renderLogin: () => {}, renderSaleProducts: () => {}, renderCart: () => {},
    renderProducts: () => {}, renderHomeProducts: () => {}, renderStock: () => {},
    renderTransfer: () => {}, renderStockAudit: () => {}, renderCustomerSelect: () => {},
    renderCustomers: () => {}, renderReports: () => {}, renderWarranties: () => {},
    renderUserAdmin: () => {}, renderSuppliers: () => {}, renderReturns: () => {},
    renderPurchases: () => {}, renderCash: () => {}, refresh: () => {}
  });
  vm.runInContext(oneLineFunction('savePreRestoreSafetyBackup'), context);
  vm.runInContext(oneLineFunction('validUserBackup'), context);
  vm.runInContext(blockFunction('importBackup', 'restoreAutoBackup'), context);
  const content = JSON.stringify(backup);
  context.importBackup({ size: Buffer.byteLength(content), content });
  return { context, storage, messages, fields, old };
}

function validBackupFixture() {
  return {
    app: 'ELECTRO Sandy', schemaVersion: 1,
    data: {
      products: [{ id: 2, name: 'Restored product' }], orders: [{ id: 20 }],
      customers: [{ id: 30 }], purchases: [{ id: 40 }], cashEntries: [{ id: 50 }],
      cashClosings: [{ date: '2026-11-08' }], stockAudits: [{ id: 60 }],
      activityLog: [{ id: 70 }], warranties: [{ id: 80 }],
      users: [{ id: 1, name: 'Admin', role: 'admin', active: true, pinHash: 'fallback-a' }],
      suppliers: [{ id: 90 }], returns: [{ id: 100 }],
      sellerProfile: { company: 'Restored shop' }
    }
  };
}

test('backup import restores all business categories and preserves a pre-restore safety copy', () => {
  const { context, storage, messages } = backupImportHarness({ backup: validBackupFixture() });
  assert.equal(context.products[0].id, 2);
  assert.equal(context.orders[0].id, 20);
  assert.equal(context.purchases[0].id, 40);
  assert.equal(context.cashEntries[0].id, 50);
  assert.equal(context.cashClosings[0].date, '2026-11-08');
  assert.equal(context.suppliers[0].id, 90);
  assert.equal(context.returns[0].id, 100);
  const safety = JSON.parse(storage.get('es13_auto_backups'));
  assert.equal(safety[0].data.products[0].id, 1);
  assert.ok(messages.includes('تم استرجاع النسخة الاحتياطية بنجاح'));
});

test('backup import rolls back already-written categories when a storage write fails', () => {
  const { context, storage, messages } = backupImportHarness({
    backup: validBackupFixture(), failKey: 'es13_orders'
  });
  assert.equal(context.products[0].id, 1);
  assert.equal(JSON.parse(storage.get('es13_products'))[0].id, 1);
  assert.ok(messages.some(message => message.includes('تعذر الاسترجاع بسبب مساحة التخزين')));
});

test('backup import rejects an incomplete backup without replacing local data', () => {
  const invalid = { data: { products: [], orders: [], customers: [], purchases: [], cashEntries: [] } };
  const { context, storage, messages } = backupImportHarness({ backup: invalid });
  assert.equal(context.products[0].id, 1);
  assert.equal(JSON.parse(storage.get('es13_products'))[0].id, 1);
  assert.equal(storage.has('es13_auto_backups'), false);
  assert.ok(messages.some(message => message.includes('معلومات البائع غير موجودة')));
});

function extractTestFunction(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'Missing application function: ' + name);
  const open = html.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === String.fromCharCode(92)) escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error('Could not extract application function: ' + name);
}

function cloudRestoreHarness({ dirtyDuringDownload = false, missingCategory = null } = {}) {
  const categories = ['products','orders','customers','purchases','cashEntries','cashClosings',
    'stockAudits','sellerProfile','activityLog','warranties','suppliers','returns'];
  const remote = {
    products: [{ id: 2, name: 'Cloud product' }], orders: [{ id: 20 }],
    customers: [], purchases: [{ id: 40 }], cashEntries: [{ id: 50 }],
    cashClosings: [], stockAudits: [], sellerProfile: { company: 'Cloud shop' },
    activityLog: [], warranties: [], suppliers: [], returns: []
  };
  const storage = new Map();
  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  };
  const parts = {}, expected = {};
  for (const category of categories) {
    if (category === missingCategory) continue;
    parts[category] = [JSON.stringify(remote[category])];
    expected[category] = 1;
  }
  const messages = [], statuses = [];
  const context = vm.createContext({
    Math, Number, String, Array, Set, Date, JSON, Object,
    CLOUD_CATEGORIES: categories,
    currentUser: { id: 1, role: 'admin' }, cloudDownloadAutomatic: false,
    cloudAuthenticated: true, cloudAuthUid: 'account-1', cloudDownloadUid: 'account-1',
    cloudDownloadLocalUserId: 1, cloudLocalRevision: dirtyDuringDownload ? 2 : 0,
    cloudDownloadLocalRevision: 0, cloudDownloadRequestId: 'request-1', cloudDownloadBusy: true,
    cloudDownloadParts: parts, cloudDownloadExpected: expected, cloudApplyingRemote: false,
    cloudSyncConflict: false, cloudAutoSyncEnabled: true, cloudBaseSnapshotId: 'old-snapshot',
    cloudPendingRemoteSnapshotId: '', cloudPersistSyncMeta: (key, value) => { storage.set(key, value); return true; },
    cloudRememberOwner: () => true, savePreRestoreSafetyBackup: () => true,
    cloudSetStatus: message => statuses.push(message), toast: message => messages.push(message),
    localStorage, products: [{ id: 1, name: 'Local product' }], orders: [], customers: [],
    purchases: [], cashEntries: [], cashClosings: [], stockAudits: [], sellerProfile: { company: 'Local shop' },
    activityLog: [], warranties: [], suppliers: [], returns: [], cart: {},
    renderSaleProducts: () => {}, renderCart: () => {}, renderProducts: () => {},
    renderHomeProducts: () => {}, renderStock: () => {}, renderTransfer: () => {},
    renderCustomerSelect: () => {}, renderCustomers: () => {}, renderReports: () => {},
    renderWarranties: () => {}, renderSuppliers: () => {}, renderReturns: () => {},
    renderPurchases: () => {}, renderCash: () => {}, refresh: () => {},
    cloudRefreshAutoSyncUi: () => {}
  });
  vm.runInContext(extractTestFunction('cloudClearDownloadBuffers'), context);
  vm.runInContext(extractTestFunction('onCloudDownloadComplete'), context);
  return { context, storage, messages, statuses, remote };
}

test('cloud restore downloads all twelve categories and replaces local data only after validation', () => {
  const { context, messages, statuses, remote } = cloudRestoreHarness();
  context.onCloudDownloadComplete(true, 'snapshot-2', 'request-1');
  assert.equal(context.products[0].id, remote.products[0].id);
  assert.equal(context.sellerProfile.company, 'Cloud shop');
  assert.equal(context.cloudBaseSnapshotId, 'snapshot-2');
  assert.equal(context.cloudDownloadBusy, false);
  assert.ok(messages.includes('تم استرجاع بيانات السحابة'));
  assert.ok(statuses.some(status => status.includes('تم استرجاع النسخة السحابية بنجاح')));
});

test('cloud restore refuses to overwrite local changes made while the download was running', () => {
  const { context, messages } = cloudRestoreHarness({ dirtyDuringDownload: true });
  context.onCloudDownloadComplete(true, 'snapshot-2', 'request-1');
  assert.equal(context.products[0].id, 1);
  assert.equal(context.cloudSyncConflict, true);
  assert.equal(context.cloudAutoSyncEnabled, false);
  assert.ok(messages.includes('تغيرت البيانات أثناء التنزيل؛ لم نستبدلها بالنسخة السحابية'));
});

test('cloud restore rejects an incomplete remote category without changing local data', () => {
  const { context, messages, statuses } = cloudRestoreHarness({ missingCategory: 'suppliers' });
  context.onCloudDownloadComplete(true, 'snapshot-2', 'request-1');
  assert.equal(context.products[0].id, 1);
  assert.equal(context.cloudDownloadBusy, false);
  assert.ok(statuses.some(status => status.includes('تعذر استرجاع النسخة')));
  assert.ok(messages.includes('النسخة السحابية غير صالحة'));
});
