const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/src/main/assets/www/index.html'), 'utf8');
const java = fs.readFileSync(path.join(root, 'app/src/main/java/com/electrosandy/app/MainActivity.java'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

const expected = [
  'products', 'orders', 'customers', 'purchases', 'cashEntries', 'cashClosings',
  'stockAudits', 'sellerProfile', 'activityLog', 'warranties', 'suppliers', 'returns'
];

test('cloud sync uses the same complete set of twelve categories in JS, Android and Firestore rules', () => {
  const jsMatch = html.match(/const CLOUD_CATEGORIES=(\[[^;]+\]);/);
  assert.ok(jsMatch, 'CLOUD_CATEGORIES is missing');
  const jsCategories = vm.runInNewContext(jsMatch[1]);
  const javaMatch = java.match(/isAllowedCloudCategory\(String category\)[\s\S]*?Arrays\.asList\(([\s\S]*?)\)\.contains/);
  assert.ok(javaMatch, 'Android cloud category allow-list is missing');
  const javaCategories = [...javaMatch[1].matchAll(/"([A-Za-z]+)"/g)].map(match => match[1]);
  const rulesMatch = rules.match(/function validCategory\(category\)[\s\S]*?return category in \[([\s\S]*?)\];/);
  assert.ok(rulesMatch, 'Firestore category allow-list is missing');
  const ruleCategories = [...rulesMatch[1].matchAll(/'([A-Za-z]+)'/g)].map(match => match[1]);
  for (const [label, list] of [['JavaScript', jsCategories], ['Android', javaCategories], ['Firestore', ruleCategories]]) {
    assert.deepEqual([...list].sort(), [...expected].sort(), label + ' category list differs');
    assert.equal(new Set(list).size, 12, label + ' category list contains duplicates');
  }
});

test('cloudSplit preserves all content and never splits a UTF-16 surrogate pair', () => {
  const match = html.match(/function cloudSplit\(value,max=24000\)\{[\s\S]*?\n/);
  assert.ok(match, 'cloudSplit helper is missing');
  const cloudSplit = vm.runInNewContext('(' + match[0].trim() + ')');
  const source = 'a😀b'.repeat(20);
  const chunks = cloudSplit(source, 2);
  assert.equal(chunks.join(''), source);
  assert.ok(chunks.every(chunk => chunk.length <= 2));
  for (const chunk of chunks) {
    assert.ok(!/[\uD800-\uDBFF]$/.test(chunk), 'chunk ends with an unpaired high surrogate');
    assert.ok(!/^[\uDC00-\uDFFF]/.test(chunk), 'chunk starts with an unpaired low surrogate');
  }
  assert.deepEqual(Array.from(cloudSplit('', 10)), ['']);
  const unicodePayload = 'مرحبا😀'.repeat(12000);
  const defaultChunks = cloudSplit(unicodePayload);
  assert.equal(defaultChunks.join(''), unicodePayload);
  assert.ok(defaultChunks.every(chunk => Buffer.byteLength(chunk, 'utf8') <= 100000),
    'every default Firestore chunk must remain under the 100KB UTF-8 rule limit');

});

test('snapshot commit verifies all twelve categories and chunk integrity before moving the current pointer', () => {
  const commit = java.slice(java.indexOf('void cloudCommitSnapshot('), java.indexOf('void cloudDownloadSnapshot('));
  assert.ok(commit.length > 0, 'cloudCommitSnapshot implementation is missing');
  assert.match(commit, /categories\.size\(\) != 12/);
  assert.match(commit, /chunks\.size\(\) != count/);
  assert.match(commit, /indexes\.size\(\) != count/);
  assert.match(commit, /runTransaction\(transaction ->/);
  assert.match(commit, /expectedBase\.equals\(currentId\)/);
  assert.match(commit, /transaction\.set\(snapshotRef, snapshotInfo\)/);
  assert.match(commit, /transaction\.set\(pointerRef, pointer\)/);
  assert.ok(commit.indexOf('verifiedChunks.size() != count') < commit.indexOf('pointerRef'), 'current pointer is touched before chunk verification');
  assert.ok(commit.indexOf('isValidCloudCategoryPayload(category,categoryPayload.toString())') < commit.indexOf('pointerRef'), 'current pointer is touched before JSON payload validation');
  assert.ok(commit.indexOf('transaction.set(snapshotRef, snapshotInfo)') < commit.indexOf('transaction.set(pointerRef, pointer)'),
    'snapshot and pointer must be published in the same transaction');
  assert.doesNotMatch(commit, /snapshotRef\.set\(/, 'snapshot must not be published before base-version validation');
});

test('cloud restore validates every category payload and saves a local safety backup before replacing local data', () => {
  const start = html.indexOf('function onCloudDownloadComplete(');
  const end = html.indexOf('function onCloudDownloadError(', start);
  assert.ok(start >= 0 && end > start, 'cloud restore completion handler is missing');
  const restore = html.slice(start, end);
  assert.match(restore, /CLOUD_CATEGORIES\.forEach/);
  assert.match(restore, /JSON\.parse\(parts\.slice\(0,count\)\.join\(''\)\)/);
  assert.match(restore, /savePreRestoreSafetyBackup\(\)/);
  assert.match(restore, /تم التراجع عن الاسترجاع/);
  assert.ok(restore.indexOf('savePreRestoreSafetyBackup()') < restore.indexOf('localStorage.setItem(k,JSON.stringify(values[i]))'));
});

test('cloud download rechecks the current snapshot pointer before applying a downloaded snapshot', () => {
  const start = java.indexOf('@JavascriptInterface public void cloudDownloadSnapshot(');
  const end = java.indexOf('    }\n    private ValueCallback<Uri[]> fileCallback', start);
  assert.ok(start >= 0 && end > start, 'cloudDownloadSnapshot implementation is missing');
  const download = java.slice(start, end);
  assert.ok(download.includes("snapshotMeta") && download.includes("latestPointer"), "download must re-read the current snapshot pointer");
  assert.match(download, /تغيرت النسخة السحابية أثناء التنزيل/);
  assert.ok(download.indexOf('onCloudDownloadComplete(true') > download.indexOf('latestPointer'), 'download completes before the latest pointer is verified');
});

test('remote snapshot changes received during download are queued and processed afterwards', () => {
  const start = html.indexOf('function onCloudRemoteSnapshotChanged(');
  const end = html.indexOf('cloudInstallStorageWatcher();', start);
  assert.ok(start >= 0 && end > start, 'remote snapshot listener is missing');
  const handler = html.slice(start, end).trim();
  let attempts = 0;
  const context = {
    cloudAuthUid: 'uid',
    cloudOwnerUid: 'uid',
    cloudBaseSnapshotId: 'base',
    currentUser: { role: 'admin' },
    cloudUploadBusy: false,
    cloudDownloadBusy: true,
    cloudPendingRemoteSnapshotId: '',
    cloudAutoSyncEnabled: true,
    cloudLocalDirty: false,
    cloudSyncConflict: false,
    cloudTryPendingRemoteDownload: () => attempts++,
    cloudSetStatus: () => {},
    toast: () => {},
    cloudPersistSyncMeta: () => true,
    cloudRefreshAutoSyncUi: () => {}
  };
  const onRemoteChanged = vm.runInNewContext('(' + handler + ')', context);
  onRemoteChanged('newer-snapshot');
  assert.equal(context.cloudPendingRemoteSnapshotId, 'newer-snapshot');
  assert.equal(attempts, 0, 'a second download must not start while the first is active');
  const restoreStart = html.indexOf('function onCloudDownloadComplete(');
  const restoreEnd = html.indexOf('function onCloudDownloadError(', restoreStart);
  const restore = html.slice(restoreStart, restoreEnd);
  assert.match(restore, /cloudPendingRemoteSnapshotId\)\{if\(cloudAutoSyncEnabled&&!cloudSyncConflict&&!cloudLocalDirty\)cloudTryPendingRemoteDownload\(\)/,
    'a queued remote update must be processed after the active download finishes');
});

test('Android WebView and app viewport disable page pinch zoom', () => {
  assert.match(java, /setSupportZoom\(false\)/);
  assert.match(java, /setBuiltInZoomControls\(false\)/);
  assert.match(java, /setDisplayZoomControls\(false\)/);
  assert.match(html, /maximum-scale=1,user-scalable=no/);
});

test('Firebase unknown auth failures preserve nested exception diagnostics for the user', () => {
  assert.match(java, /causeMessage = cause\.getMessage\(\)/);
  assert.match(html, /خطأ تقني من Firebase؛ التفاصيل:/);
});

test('cloud storage watcher marks category deletion and clear operations as local changes', () => {
  const watcherStart = html.indexOf('function cloudInstallStorageWatcher(){');
  const watcherEnd = html.indexOf('function onCloudRemoteSnapshotChanged', watcherStart);
  assert.ok(watcherStart >= 0 && watcherEnd > watcherStart, 'cloud storage watcher is missing');
  const watcherSource = html.slice(watcherStart, watcherEnd).trim();
  let dirty = 0;
  class FakeStorage {
    constructor() { this.data = {}; }
    setItem(key, value) { this.data[String(key)] = String(value); }
    getItem(key) { return Object.prototype.hasOwnProperty.call(this.data, String(key)) ? this.data[String(key)] : null; }
    removeItem(key) { delete this.data[String(key)]; }
    clear() { this.data = {}; }
  }
  const local = new FakeStorage();
  const context = { Storage: FakeStorage, localStorage: local, cloudMarkLocalDirty: () => dirty++ };
  vm.runInNewContext('(' + watcherSource + ')()', context);
  local.setItem('es13_products', '[]');
  assert.equal(dirty, 1, 'tracked writes must mark local data dirty');
  local.removeItem('es13_products');
  assert.equal(dirty, 2, 'deleting a synchronized category must mark local data dirty');
  local.setItem('es13_orders', '[]');
  local.clear();
  assert.equal(dirty, 4, 'clearing synchronized data must mark local data dirty');
  local.clear();
  assert.equal(dirty, 4, 'clearing storage without synchronized data must not mark it dirty');
  local.setItem('unrelated_preference', 'x');
  assert.equal(dirty, 4, 'unrelated local settings must not trigger cloud synchronization');
});


test('queued remote snapshot is retried after a download failure when automatic sync remains safe', () => {
  const start = html.indexOf('function onCloudDownloadError(');
  const end = html.indexOf('function cloudRefreshAutoSyncUi(', start);
  assert.ok(start >= 0 && end > start, 'cloud download error handler is missing');
  const handler = html.slice(start, end).trim();
  let retried = 0;
  let cleared = false;
  const context = {
    cloudDownloadRequestId: 'request-1',
    cloudDownloadBusy: true,
    cloudDownloadAutomatic: true,
    cloudPendingRemoteSnapshotId: 'newer-snapshot',
    cloudAutoSyncEnabled: true,
    cloudSyncConflict: false,
    cloudLocalDirty: false,
    cloudClearDownloadBuffers: () => { context.cloudDownloadBusy = false; cleared = true; },
    cloudSetStatus: () => {},
    toast: () => {},
    cloudTryPendingRemoteDownload: () => {
      assert.equal(context.cloudDownloadBusy, false, 'retry must wait until the failed download is cleared');
      retried++;
    }
  };
  const onDownloadError = vm.runInNewContext('(' + handler + ')', context);
  onDownloadError('network error', 'request-1');
  assert.equal(cleared, true);
  assert.equal(retried, 1, 'a queued newer snapshot must be retried after failure');
  context.cloudDownloadRequestId = 'request-2';
  context.cloudDownloadBusy = true;
  context.cloudPendingRemoteSnapshotId = 'another-snapshot';
  context.cloudLocalDirty = true;
  onDownloadError('network error', 'request-2');
  assert.equal(retried, 1, 'do not auto-retry over local edits');
});


test('automatic cloud upload retries after an offline chunk or category write failure', () => {
  function runFailureHandler(name, nextName, invoke) {
    const start = html.indexOf('function ' + name + '(');
    const end = html.indexOf('function ' + nextName + '(', start + 1);
    assert.ok(start >= 0 && end > start, name + ' handler is missing');
    const handler = html.slice(start, end).trim();
    const timers = [], retryDelays = [], messages = [];
    const context = {
      cloudSnapshotId: 'snapshot-1',
      cloudUploadBusy: true,
      cloudUploadActive: { category: 'products', count: 1 },
      cloudUploadQueue: [['orders', '[]']],
      cloudUploadPending: 1,
      cloudUploadMode: 'auto',
      cloudAutoSyncEnabled: true,
      cloudUploadFailed: false,
      cloudSetStatus: message => messages.push(message),
      toast: message => messages.push(message),
      cloudScheduleAutoSync: delay => retryDelays.push(delay),
      setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
      AndroidShare: { cloudFinishCategory: () => {} }
    };
    vm.runInNewContext('(' + handler + ')', context)(...invoke);
    assert.equal(context.cloudUploadBusy, false, 'failed upload must release the busy lock');
    assert.equal(context.cloudUploadFailed, true);
    assert.equal(context.cloudUploadQueue.length, 0, 'failed snapshot queue must be discarded');
    assert.equal(timers.length, 1, 'automatic sync should schedule one retry');
    assert.equal(timers[0].delay, 1000, 'retry callback should be deferred briefly');
    timers[0].callback();
    assert.deepEqual(retryDelays, [60000], 'retry should start a fresh snapshot after one minute');
  }
  runFailureHandler('onCloudChunkSaved', 'onCloudCategorySaved',
    ['products', 0, false, 'network unavailable', 'snapshot-1']);
  runFailureHandler('onCloudCategorySaved', 'onCloudSnapshotCommitted',
    ['products', false, 'network unavailable', 'snapshot-1']);
});
