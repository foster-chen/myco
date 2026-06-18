// Guards the meeting-summary WS frame broadcast in attach.js:
//   1. A meeting-summary listener is registered on the session.
//   2. The listener forwards the payload as { t: 'meeting-summary', ...payload }.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (err) { console.log('  ✗ ' + name + ' — ' + (err && err.stack ? err.stack : err)); failed++; }
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server', 'src', 'attach.js'), 'utf8');

console.log('── meeting-ws-frame ──');

t('attach.js registers a meeting-summary listener on the session', () => {
  assert.ok(/session\.on\(\s*['"]meeting-summary['"]/.test(SRC),
    "attach.js must register session.on('meeting-summary', ...) — mirrors the clarify-reply listener at line ~1705");
});

t('meeting-summary listener broadcasts { t: meeting-summary, ...payload }', () => {
  // The listener is defined as a named const (onMeetingSummary) and
  // registered by reference — mirroring the clarify-reply pattern
  // exactly. Locate the const body, not an inline arrow in session.on.
  const m = SRC.match(/const\s+onMeetingSummary\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\};/);
  assert.ok(m, 'could not locate the onMeetingSummary listener body');
  assert.ok(/meeting-summary/.test(m[0]),
    "listener must broadcast { t: 'meeting-summary', ...payload } to the WS client");
  assert.ok(/ws\.send/.test(m[0]),
    'listener must call ws.send() to forward the frame to the attached client');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
