const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (err) { console.log('  ✗ ' + name + ' — ' + (err && err.stack ? err.stack : err)); failed++; }
}

console.log('── voice-input-client ──');

const APP = fs.readFileSync(path.join(__dirname, '..', 'web', 'public', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'web', 'public', 'styles.css'), 'utf8');

t('state object has whisperConfigured field', () => {
  assert.ok(/whisperConfigured/.test(APP), 'state object must have a whisperConfigured field');
});

t('tryToken reads body.whisperConfigured from /auth/check', () => {
  const m = APP.match(/async\s+function\s+tryToken[\s\S]*?\n\}/);
  assert.ok(m, 'could not locate tryToken function');
  assert.ok(/whisperConfigured/.test(m[0]), 'tryToken must read body.whisperConfigured');
});

t('#chat-mic does NOT have hidden or disabled attrs in index.html', () => {
  const m = HTML.match(/<button[^>]*id="chat-mic"[^>]*>/);
  assert.ok(m, '#chat-mic button not found in index.html');
  assert.ok(!/hidden/.test(m[0]), '#chat-mic must not have hidden attr. Found: ' + m[0]);
  assert.ok(!/disabled/.test(m[0]), '#chat-mic must not have disabled attr. Found: ' + m[0]);
});

t('styles.css has .chat-mic-transcribing class', () => {
  assert.ok(/chat-mic-transcribing/.test(CSS), 'styles.css must define .chat-mic-transcribing');
});

t('styles.css .composer-btn-mic no longer has WIP strikethrough', () => {
  const m = CSS.match(/\.composer-btn-mic\s*\{[^}]*\}/);
  assert.ok(m, '.composer-btn-mic base rule not found');
  assert.ok(!/line-through/.test(m[0]), '.composer-btn-mic must not have text-decoration: line-through');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
