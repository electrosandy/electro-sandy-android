const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const {
  doc,
  getDoc,
  setDoc,
  runTransaction
} = require('firebase/firestore');

const projectId = 'demo-electro-sandy-sync';
const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const categories = [
  'products', 'orders', 'customers', 'purchases',
  'cashEntries', 'cashClosings', 'stockAudits', 'sellerProfile',
  'activityLog', 'warranties', 'suppliers', 'returns'
];
const uid = 'shop-owner';
const now = 1794000000;
let env;

function ref(db, path) { return doc(db, path); }
function snapshotPath(id) { return `shops/${uid}/snapshots/${id}`; }
function pointerPath() { return `shops/${uid}/snapshotMeta/current`; }

async function uploadSnapshot(db, id, recordsByCategory) {
  for (const category of categories) {
    const payload = JSON.stringify(recordsByCategory[category] || []);
    await setDoc(ref(db, `${snapshotPath(id)}/meta/${category}`), {
      chunkCount: 1, updatedAt: now
    });
    await setDoc(ref(db, `${snapshotPath(id)}/data/${category}/chunks/000000`), {
      index: 0, data: payload, updatedAt: now
    });
  }
}

async function validateSnapshot(db, id) {
  for (const category of categories) {
    const meta = await getDoc(ref(db, `${snapshotPath(id)}/meta/${category}`));
    if (!meta.exists()) return false;
    const count = meta.data().chunkCount;
    if (!Number.isInteger(count) || count < 1 || count > 10000) return false;
    for (let index = 0; index < count; index++) {
      const chunkId = String(index).padStart(6, '0');
      const chunk = await getDoc(ref(db, `${snapshotPath(id)}/data/${category}/chunks/${chunkId}`));
      if (!chunk.exists()) return false;
      const value = chunk.data();
      if (value.index !== index || typeof value.data !== 'string' ||
          Buffer.byteLength(value.data, 'utf8') > 100000) return false;
      try { JSON.parse(value.data); } catch { return false; }
    }
  }
  return true;
}

async function commitSnapshot(db, id, expectedBaseId) {
  if (!(await validateSnapshot(db, id))) return false;
  const pointer = ref(db, pointerPath());
  const snapshot = ref(db, snapshotPath(id));
  return runTransaction(db, async transaction => {
    const current = await transaction.get(pointer);
    const currentId = current.exists() ? current.data().snapshotId : '';
    if (currentId !== expectedBaseId) return false;
    transaction.set(snapshot, {
      snapshotId: id, categories: [...categories], categoryCount: 12,
      createdAt: now + 1, schemaVersion: 1, status: 'READY'
    });
    transaction.set(pointer, {
      snapshotId: id, categories: [...categories], updatedAt: now + 1
    });
    return true;
  });
}

async function downloadSnapshot(db) {
  const pointer = await getDoc(ref(db, pointerPath()));
  assert.equal(pointer.exists(), true, 'a current snapshot pointer must exist');
  const id = pointer.data().snapshotId;
  const result = {};
  for (const category of categories) {
    const meta = await getDoc(ref(db, `${snapshotPath(id)}/meta/${category}`));
    assert.equal(meta.exists(), true, `missing metadata for ${category}`);
    const chunks = [];
    for (let index = 0; index < meta.data().chunkCount; index++) {
      const chunk = await getDoc(ref(db,
        `${snapshotPath(id)}/data/${category}/chunks/${String(index).padStart(6, '0')}`));
      assert.equal(chunk.exists(), true, `missing chunk for ${category}`);
      chunks.push(chunk.data().data);
    }
    result[category] = JSON.parse(chunks.join(''));
  }
  return result;
}

function allRecords(overrides = {}) {
  return Object.fromEntries(categories.map(category => [category, overrides[category] || []]));
}

async function seedSnapshot(id, records) {
  await env.withSecurityRulesDisabled(async context => {
    const adminDb = context.firestore();
    await uploadSnapshot(adminDb, id, records);
    await setDoc(ref(adminDb, snapshotPath(id)), {
      snapshotId: id, categories: [...categories], categoryCount: 12,
      createdAt: now, schemaVersion: 1, status: 'READY'
    });
    await setDoc(ref(adminDb, pointerPath()), {
      snapshotId: id, categories: [...categories], updatedAt: now
    });
  });
}

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules }
  });
});

test.after(async () => {
  if (env) await env.cleanup();
});

test.beforeEach(async () => {
  await env.clearFirestore();
});

test('two independent clients: stale base commit is rejected and cannot replace the winner pointer', async () => {
  const deviceA = env.authenticatedContext(uid).firestore();
  const deviceB = env.authenticatedContext(uid).firestore();

  await seedSnapshot('base-1', allRecords());

  await uploadSnapshot(deviceA, 'device-a-2', allRecords({
    products: [{ id: 'p1', name: 'A update' }]
  }));
  await uploadSnapshot(deviceB, 'device-b-2', allRecords({
    products: [{ id: 'p1', name: 'B update' }]
  }));

  const [aResult, bResult] = await Promise.all([
    commitSnapshot(deviceA, 'device-a-2', 'base-1'),
    commitSnapshot(deviceB, 'device-b-2', 'base-1')
  ]);
  assert.equal([aResult, bResult].filter(Boolean).length, 1,
    'exactly one device may commit from the same base snapshot');

  const pointer = await getDoc(ref(deviceA, pointerPath()));
  assert.ok(['device-a-2', 'device-b-2'].includes(pointer.data().snapshotId));
  assert.equal(pointer.data().snapshotId, aResult ? 'device-a-2' : 'device-b-2');
  const winner = aResult ? 'device-a-2' : 'device-b-2';
  const loser = aResult ? 'device-b-2' : 'device-a-2';
  assert.equal((await getDoc(ref(deviceA, snapshotPath(winner)))).exists(), true);
  assert.equal((await getDoc(ref(deviceA, snapshotPath(loser)))).exists(), false,
    'a rejected stale client must not leave an orphan snapshot document');
});

test('a committed full snapshot carries deletions to the other client without resurrecting removed records', async () => {
  const deviceA = env.authenticatedContext(uid).firestore();
  const deviceB = env.authenticatedContext(uid).firestore();

  await seedSnapshot('base-1', allRecords({
    products: [{ id: 'keep', name: 'Keep' }, { id: 'delete-me', name: 'Old item' }]
  }));

  await uploadSnapshot(deviceA, 'after-delete', allRecords({
    products: [{ id: 'keep', name: 'Keep' }]
  }));
  assert.equal(await commitSnapshot(deviceA, 'after-delete', 'base-1'), true);

  const pointer = await getDoc(ref(deviceB, pointerPath()));
  assert.equal(pointer.data().snapshotId, 'after-delete');
  const products = await getDoc(ref(deviceB,
    `${snapshotPath('after-delete')}/data/products/chunks/000000`));
  const restoredProducts = JSON.parse(products.data().data);
  assert.deepEqual(restoredProducts.map(item => item.id), ['keep']);
  assert.equal(restoredProducts.some(item => item.id === 'delete-me'), false,
    'a record removed in the new full snapshot must not reappear on the receiving client');
});

test('offline sale, purchase and return records synchronize after reconnection to the second client', async () => {
  const deviceA = env.authenticatedContext(uid).firestore();
  const deviceB = env.authenticatedContext(uid).firestore();
  await seedSnapshot('base-1', allRecords());

  // These are the complete local business records accumulated while device A was offline.
  const offlineBusinessData = allRecords({
    products: [{ id: 'p1', central: 7 }],
    orders: [{ id: 'sale-1', productId: 'p1', quantity: 2, total: 200, paidAmount: 200 }],
    purchases: [{ id: 'purchase-1', productId: 'p1', quantity: 5, total: 350 }],
    returns: [{ id: 'return-1', orderId: 'sale-1', productId: 'p1', quantity: 1, refund: 100 }],
    cashEntries: [
      { id: 'cash-sale', type: 'in', amount: 200 },
      { id: 'cash-refund', type: 'out', amount: 100 }
    ]
  });

  await uploadSnapshot(deviceA, 'reconnected-1', offlineBusinessData);
  assert.equal(await commitSnapshot(deviceA, 'reconnected-1', 'base-1'), true);

  const received = await downloadSnapshot(deviceB);
  assert.deepEqual(received.orders, offlineBusinessData.orders);
  assert.deepEqual(received.purchases, offlineBusinessData.purchases);
  assert.deepEqual(received.returns, offlineBusinessData.returns);
  assert.deepEqual(received.cashEntries, offlineBusinessData.cashEntries);
  assert.deepEqual(received.products, offlineBusinessData.products);
});

test('incomplete or malformed snapshots are never published as the current pointer', async () => {
  const db = env.authenticatedContext(uid).firestore();
  await seedSnapshot('base-1', allRecords());

  await uploadSnapshot(db, 'broken-2', allRecords());
  await setDoc(ref(db, `${snapshotPath('broken-2')}/meta/returns`), {
    chunkCount: 2, updatedAt: now
  });
  assert.equal(await commitSnapshot(db, 'broken-2', 'base-1'), false);
  const pointer = await getDoc(ref(db, pointerPath()));
  assert.equal(pointer.data().snapshotId, 'base-1');
});
