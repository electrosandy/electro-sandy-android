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
