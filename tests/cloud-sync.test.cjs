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
  assert.ok(commit.indexOf('indexes.size() != count') < commit.indexOf('pointerRef'), 'current pointer is touched before chunk verification');
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
