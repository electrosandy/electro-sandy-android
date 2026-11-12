const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} = require('@firebase/rules-unit-testing');
const {
  doc,
  getDoc,
  setDoc,
  deleteDoc
} = require('firebase/firestore');

const projectId = 'demo-electro-sandy';
const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const categories = [
  'products', 'orders', 'customers', 'purchases',
  'cashEntries', 'cashClosings', 'stockAudits', 'sellerProfile',
  'activityLog', 'warranties', 'suppliers', 'returns'
];

let testEnv;

function snapshotMeta(overrides = {}) {
  return {
    snapshotId: 'snapshot-1',
    categories: [...categories],
    updatedAt: 1794000000,
    ...overrides
  };
}

function snapshot(overrides = {}) {
  return {
    snapshotId: 'snapshot-1',
    categories: [...categories],
    categoryCount: 12,
    createdAt: 1794000000,
    schemaVersion: 1,
    status: 'READY',
    ...overrides
  };
}

function ownerDb(uid = 'shop-owner') {
  return testEnv.authenticatedContext(uid).firestore();
}

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules }
  });
});

test.after(async () => {
  if (testEnv) await testEnv.cleanup();
});

test('only the authenticated shop owner can read the current snapshot pointer', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'shops/shop-owner/snapshotMeta/current'), snapshotMeta());
  });

  await assertSucceeds(getDoc(doc(ownerDb(), 'shops/shop-owner/snapshotMeta/current')));
  await assertFails(getDoc(doc(ownerDb('another-user'), 'shops/shop-owner/snapshotMeta/current')));
  await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'shops/shop-owner/snapshotMeta/current')));
});

test('shop owner can publish valid snapshot metadata but cannot publish malformed metadata', async () => {
  const db = ownerDb();
  await assertSucceeds(setDoc(doc(db, 'shops/shop-owner/snapshotMeta/current'), snapshotMeta()));

  await assertFails(setDoc(
    doc(db, 'shops/shop-owner/snapshotMeta/current'),
    snapshotMeta({ snapshotId: 'INVALID_ID' })
  ));
  await assertFails(setDoc(
    doc(db, 'shops/shop-owner/snapshotMeta/current'),
    snapshotMeta({ categories: categories.slice(1) })
  ));
  await assertFails(setDoc(
    doc(db, 'shops/shop-owner/snapshotMeta/current'),
    snapshotMeta({ categories: [...categories, 'unexpected'] })
  ));
  await assertFails(setDoc(
    doc(db, 'shops/shop-owner/snapshotMeta/current'),
    snapshotMeta({ extra: true })
  ));
  await assertFails(setDoc(
    doc(ownerDb('another-user'), 'shops/shop-owner/snapshotMeta/current'),
    snapshotMeta()
  ));
});

test('snapshot documents require all twelve categories and the supported schema/status', async () => {
  const db = ownerDb();
  await assertSucceeds(setDoc(
    doc(db, 'shops/shop-owner/snapshots/snapshot-1'),
    snapshot()
  ));

  const invalidCases = [
    ['snapshot-2', { categoryCount: 11 }],
    ['snapshot-3', { schemaVersion: 2 }],
    ['snapshot-4', { status: 'UPLOADING' }],
    ['snapshot-5', { categories: [...categories.slice(0, 11), 'unknown'] }]
  ];
  for (const [id, overrides] of invalidCases) {
    await assertFails(setDoc(
      doc(db, 'shops/shop-owner/snapshots/' + id),
      snapshot({ ...overrides, snapshotId: id })
    ));
  }
  await assertFails(setDoc(
    doc(db, 'shops/shop-owner/snapshots/snapshot-6'),
    snapshot({ snapshotId: 'wrong-id' })
  ));
  await assertFails(setDoc(
    doc(ownerDb('another-user'), 'shops/shop-owner/snapshots/foreign'),
    snapshot({ snapshotId: 'foreign' })
  ));
});

test('only allow-listed category metadata can be written with valid chunk counts', async () => {
  const db = ownerDb();
  await assertSucceeds(setDoc(
    doc(db, 'shops/shop-owner/snapshots/snapshot-1/meta/products'),
    { chunkCount: 2, updatedAt: 1794000000 }
  ));
  await assertFails(setDoc(
    doc(db, 'shops/shop-owner/snapshots/snapshot-1/meta/unknownCategory'),
    { chunkCount: 1, updatedAt: 1794000000 }
  ));
  await assertFails(setDoc(
    doc(db, 'shops/shop-owner/snapshots/snapshot-1/meta/orders'),
    { chunkCount: 0, updatedAt: 1794000000 }
  ));
  await assertFails(setDoc(
    doc(db, 'shops/shop-owner/snapshots/snapshot-1/meta/orders'),
    { chunkCount: 10001, updatedAt: 1794000000 }
  ));
  await assertFails(setDoc(
    doc(db, 'shops/shop-owner/snapshots/snapshot-1/meta/orders'),
    { chunkCount: 1, updatedAt: 1794000000, extra: true }
  ));
});

test('chunk writes enforce six-digit IDs, bounded indexes and payload size', async () => {
  const db = ownerDb();
  const base = 'shops/shop-owner/snapshots/snapshot-1/data/products/chunks/';
  await assertSucceeds(setDoc(
    doc(db, base + '000000'),
    { index: 0, data: '[{"id":"p1"}]', updatedAt: 1794000000 }
  ));
  await assertFails(setDoc(
    doc(db, base + 'chunk-0'),
    { index: 0, data: '[]', updatedAt: 1794000000 }
  ));
  await assertFails(setDoc(
    doc(db, base + '000001'),
    { index: 10000, data: '[]', updatedAt: 1794000000 }
  ));
  await assertFails(setDoc(
    doc(db, base + '000002'),
    { index: 1, data: 'x'.repeat(100001), updatedAt: 1794000000 }
  ));
  await assertFails(setDoc(
    doc(db, 'shops/shop-owner/snapshots/snapshot-1/data/notAllowed/chunks/000000'),
    { index: 0, data: '[]', updatedAt: 1794000000 }
  ));
});

test('snapshot, metadata and chunk deletion remain denied to clients', async () => {
  const db = ownerDb();
  await testEnv.withSecurityRulesDisabled(async context => {
    const adminDb = context.firestore();
    await setDoc(doc(adminDb, 'shops/shop-owner/snapshots/snapshot-1'), snapshot());
    await setDoc(doc(adminDb, 'shops/shop-owner/snapshots/snapshot-1/meta/products'), {
      chunkCount: 1, updatedAt: 1794000000
    });
    await setDoc(doc(adminDb, 'shops/shop-owner/snapshots/snapshot-1/data/products/chunks/000000'), {
      index: 0, data: '[]', updatedAt: 1794000000
    });
  });

  await assertFails(deleteDoc(doc(db, 'shops/shop-owner/snapshots/snapshot-1')));
  await assertFails(deleteDoc(doc(db, 'shops/shop-owner/snapshots/snapshot-1/meta/products')));
  await assertFails(deleteDoc(doc(db, 'shops/shop-owner/snapshots/snapshot-1/data/products/chunks/000000')));
  await assertFails(deleteDoc(doc(db, 'shops/shop-owner/snapshotMeta/current')));
});

test('all unrecognized Firestore paths are denied', async () => {
  const db = ownerDb();
  await assertFails(setDoc(doc(db, 'shops/shop-owner/privateData/record'), { secret: true }));
  await assertFails(getDoc(doc(db, 'otherCollection/record')));
});
