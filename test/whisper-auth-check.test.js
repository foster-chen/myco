// Guards that /auth/check exposes whisperConfigured so the client can
// decide whether to show the #chat-mic voice-input button.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (err) { console.log('  ✗ ' + name + ' — ' + (err && err.stack ? err.stack : err)); failed++; }
}

console.log('── whisper-auth-check ──');

t('/auth/check authenticated branch includes whisperConfigured', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'src', 'index.js'), 'utf8');
  // Find the /auth/check handler's authenticated profile branch.
  const m = src.match(/profile\s*=\s*profileFromToken[\s\S]*?if\s*\(profile\)\s*\{[\s\S]*?return\s+res\.json\(\{[\s\S]*?\}\s*\)/);
  assert.ok(m, 'could not locate the /auth/check authenticated profile branch (if (profile) { return res.json({...}) })');
  assert.ok(/whisperConfigured/.test(m[0]),
    'whisperConfigured field missing from /auth/check authenticated response — must be present so the client can gate #chat-mic');
  assert.ok(/WHISPER_SERVER_URL/.test(m[0]),
    'whisperConfigured must be derived from process.env.WHISPER_SERVER_URL');
});

t('/auth/check does not expose whisperConfigured in share-token branch', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'src', 'index.js'), 'utf8');
  const m = src.match(/shareTok[\s\S]*?return\s+res\.json\(\{[\s\S]*?share:\s*true[\s\S]*?\}\s*\)/);
  if (!m) return; // no share-token branch is fine
  assert.ok(!/whisperConfigured/.test(m[0]),
    'whisperConfigured should NOT appear in the share-token branch — share viewers have no user identity for speaker_name');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
