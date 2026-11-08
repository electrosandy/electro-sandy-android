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
  const ids = new Set([...html.matchAll(/\\bid\\s*=\\s*["']([^"']+)["']/gi)].map(match => match[1]));
  const refs = [...html.matchAll(/getElementById\\(\\s*["']([^"']+)["']\\s*\\)/g)].map(match => match[1]);
  const missing = [...new Set(refs.filter(id => !ids.has(id)))];
  assert.deepEqual(missing, []);
});
