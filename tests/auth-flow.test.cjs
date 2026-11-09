const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'www', 'index.html'), 'utf8');

function loadFunction(name, context) {
  const line = html.split(/\r?\n/).find(line =>
    line.includes('function ' + name + '(') || line.includes('async function ' + name + '(')
  );
  assert.ok(line, 'Application function ' + name + ' is missing');
  vm.createContext(context);
  vm.runInContext(line, context, { filename: 'index.html:' + name });
  return context;
}

function makeStorage(shouldThrow = false) {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (shouldThrow) throw new Error('storage full');
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); }
  };
}

test('first-run admin setup rejects invalid PIN without writing an account', async () => {
  const messages = [];
  const storage = makeStorage();
  const elements = {
    firstAdminName: { value: 'Admin' },
    firstAdminPin: { value: '12a4' },
    authGate: { style: { display: 'flex' } }
  };
  const context = {
    appUsers: [],
    currentUser: null,
    document: { getElementById: id => elements[id] || null, querySelector: () => ({ disabled: false }) },
    localStorage: storage,
    pinHash: async pin => 'hash-' + pin,
    toast: message => messages.push(message),
    window: {},
    Date
  };
  await loadFunction('setupAdmin', context).setupAdmin();
  assert.equal(storage.getItem('es13_users'), null);
  assert.equal(context.appUsers.length, 0);
  assert.match(messages.at(-1), /PIN/);
});

test('first-run admin setup stores a hashed active administrator and opens the app', async () => {
  const messages = [];
  const storage = makeStorage();
  const button = { disabled: false };
  const elements = {
    firstAdminName: { value: 'Test Admin' },
    firstAdminPin: { value: '4826' },
    authGate: { style: { display: 'flex' } }
  };
  let badgeUpdated = 0, lockArmed = 0, adminRendered = 0;
  const context = {
    appUsers: [],
    currentUser: null,
    document: { getElementById: id => elements[id] || null, querySelector: () => button },
    localStorage: storage,
    pinHash: async pin => 'pbkdf2$test$' + pin,
    toast: message => messages.push(message),
    updateCurrentUserBadge: () => badgeUpdated++,
    armAutoLock: () => lockArmed++,
    renderUserAdmin: () => adminRendered++,
    window: {},
    Date
  };
  await loadFunction('setupAdmin', context).setupAdmin();
  const saved = JSON.parse(storage.getItem('es13_users'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, 'Test Admin');
  assert.equal(saved[0].role, 'admin');
  assert.equal(saved[0].active, true);
  assert.equal(saved[0].pinHash, 'pbkdf2$test$4826');
  assert.equal(context.currentUser.id, saved[0].id);
  assert.equal(elements.authGate.style.display, 'none');
  assert.equal(button.disabled, true);
  assert.equal(badgeUpdated, 1);
  assert.equal(lockArmed, 1);
  assert.equal(adminRendered, 1);
  assert.match(messages.at(-1), /تم إنشاء حساب المدير/);
});

test('first-run admin setup restores the button and reports storage failure', async () => {
  const messages = [];
  const button = { disabled: false };
  const elements = {
    firstAdminName: { value: 'Test Admin' },
    firstAdminPin: { value: '4826' },
    authGate: { style: { display: 'flex' } }
  };
  const context = {
    appUsers: [],
    currentUser: null,
    document: { getElementById: id => elements[id] || null, querySelector: () => button },
    localStorage: makeStorage(true),
    pinHash: async pin => 'hash-' + pin,
    toast: message => messages.push(message),
    window: {},
    Date
  };
  await loadFunction('setupAdmin', context).setupAdmin();
  assert.equal(button.disabled, false);
  assert.equal(context.appUsers.length, 0);
  assert.equal(elements.authGate.style.display, 'flex');
  assert.match(messages.at(-1), /تعذر إنشاء الحساب/);
});

test('PIN login rejects a wrong PIN without creating a session', async () => {
  const messages = [];
  const storage = makeStorage();
  const elements = {
    loginUser: { value: '7' },
    loginPin: { value: '0000' },
    authGate: { style: { display: 'flex' } }
  };
  const context = {
    appUsers: [{ id: 7, name: 'Admin', role: 'admin', active: true, pinHash: 'stored-hash' }],
    currentUser: null,
    document: { getElementById: id => elements[id] || null },
    localStorage: storage,
    verifyPinHash: async () => false,
    toast: message => messages.push(message),
    window: {}
  };
  await loadFunction('loginUser', context).loginUser();
  assert.equal(context.currentUser, null);
  assert.equal(storage.getItem('es13_last_user_id'), null);
  assert.equal(elements.authGate.style.display, 'flex');
  assert.match(messages.at(-1), /PIN غير صحيح/);
});

test('PIN login creates a session and records the last active user', async () => {
  const messages = [];
  const storage = makeStorage();
  const elements = {
    loginUser: { value: '7' },
    loginPin: { value: '4826' },
    authGate: { style: { display: 'flex' } }
  };
  let activity = '', badgeUpdated = 0, lockArmed = 0;
  const context = {
    appUsers: [{ id: 7, name: 'Admin', role: 'admin', active: true, pinHash: 'pbkdf2$stored' }],
    currentUser: null,
    document: { getElementById: id => elements[id] || null },
    localStorage: storage,
    verifyPinHash: async () => true,
    toast: message => messages.push(message),
    updateCurrentUserBadge: () => badgeUpdated++,
    armAutoLock: () => lockArmed++,
    logActivity: (action, detail) => { activity = action + ':' + detail; },
    window: {}
  };
  await loadFunction('loginUser', context).loginUser();
  assert.equal(context.currentUser.id, 7);
  assert.equal(storage.getItem('es13_last_user_id'), '7');
  assert.equal(elements.authGate.style.display, 'none');
  assert.equal(badgeUpdated, 1);
  assert.equal(lockArmed, 1);
  assert.equal(activity, 'تسجيل دخول:Admin • admin');
  assert.match(messages.at(-1), /تم تسجيل الدخول/);
});

test('role-based navigation blocks restricted pages and permits allowed pages', () => {
  const messages = [];
  const pages = ['home', 'stock', 'settings'].map(id => {
    const page = { id, active: false };
    page.classList = { toggle(_name, value) { page.active = value; } };
    return page;
  });
  const buttons = [{ dataset: { go: 'home' }, classList: { toggle(_name, value) { this.active = value; } } }];
  let stockRendered = 0;
  const context = {
    currentUser: { id: 7, role: 'seller' },
    document: { querySelectorAll: selector => selector === '.page' ? pages : buttons },
    toast: message => messages.push(message),
    window: { scrollTo() {} },
    renderStock: () => stockRendered++
  };
  loadFunction('go', context);
  context.go('settings');
  assert.match(messages.at(-1), /غير متاحة/);
  assert.equal(pages.some(page => page.active), false);
  context.go('stock');
  assert.equal(pages.find(page => page.id === 'stock').active, true);
  assert.equal(stockRendered, 1);
});

test('permission guard rejects unauthorized roles and allows the requested role', () => {
  const messages = [];
  const context = { currentUser: { role: 'seller' }, toast: message => messages.push(message) };
  loadFunction('requireRole', context);
  assert.equal(context.requireRole('admin'), false);
  assert.match(messages.at(-1), /ليست لديك صلاحية/);
  assert.equal(context.requireRole('admin', 'seller'), true);
});
