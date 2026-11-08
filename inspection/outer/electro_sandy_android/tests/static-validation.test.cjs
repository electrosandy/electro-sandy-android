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
  const match = html.match(/function readStoredJSON\(key,fallback\)\{[\s\S]*?\}/);
  assert.ok(match, 'safe local JSON reader is missing');
  const storage = { value: '{broken', getItem() { return this.value; } };
  const read = vm.runInNewContext('(' + match[0] + ')', { localStorage: storage });
  assert.deepEqual(Array.from(read('es13_products', [])), []);
  storage.value = '{"unexpected":true}';
  assert.deepEqual(Array.from(read('es13_products', [])), []);
  storage.value = '[{"id":1}]';
  assert.deepEqual(Array.from(read('es13_products', [])), [{id:1}]);
});

test('startup does not parse localStorage JSON without the safe reader', () => {
  assert.doesNotMatch(html, /JSON\.parse\(localStorage\.getItem/);
  assert.match(html, /readStoredJSON\('es13_products',\[\]\)/);
});
