// Guards the POST /whisper/transcribe proxy route:
//   1. Route exists and is auth-gated (requireAuth).
//   2. Returns 503 when WHISPER_SERVER_URL is unset.
//   3. Injects speaker_name from req.user (NOT from client form data —
//      prevents spoofing another user's speaker embedding).
//   4. Passes include_srt=false (we only need segment text).
//   5. Forwards the audio file to the whisper server via fetch + FormData.
//   6. Relays whisper response status + body to client.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (err) { console.log('  ✗ ' + name + ' — ' + (err && err.stack ? err.stack : err)); failed++; }
}

console.log('── whisper-proxy-route ──');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server', 'src', 'index.js'), 'utf8');

t('POST /whisper/transcribe route is registered', () => {
  assert.ok(/app\.post\(\s*['"]\/whisper\/transcribe['"]/.test(SRC),
    'POST /whisper/transcribe route registration not found in server/src/index.js');
});

t('route is auth-gated via requireAuth', () => {
  const m = SRC.match(/app\.post\(\s*['"]\/whisper\/transcribe['"]\s*,\s*([^)]+)\)/);
  assert.ok(m, 'could not parse route handler args');
  assert.ok(/requireAuth/.test(m[1]),
    'route must use requireAuth middleware so req.user is set — found: ' + m[1]);
});

t('route uses multer for audio file parsing', () => {
  assert.ok(/require\(\s*['"]multer['"]\s*\)/.test(SRC),
    'multer is not required in server/src/index.js');
  const m = SRC.match(/app\.post\(\s*['"]\/whisper\/transcribe['"][\s\S]{0,200}\)/);
  assert.ok(m && /multer|\.single\(\s*['"]audio['"]\s*\)/.test(m[0]),
    'route must use multer.single("audio") to parse the incoming audio file');
});

t('returns 503 when WHISPER_SERVER_URL is unset', () => {
  const m = SRC.match(/app\.post\(\s*['"]\/whisper\/transcribe['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m, 'could not extract route handler body');
  assert.ok(/503/.test(m[0]), 'route must return 503 when WHISPER_SERVER_URL is unset');
  assert.ok(/WHISPER_SERVER_URL/.test(m[0]), 'route must check process.env.WHISPER_SERVER_URL');
});

t('injects speaker_name from req.user (not from client form data)', () => {
  const m = SRC.match(/app\.post\(\s*['"]\/whisper\/transcribe['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m, 'could not extract route handler body');
  // speaker_name must be set from req.user, NOT from req.body or req.file
  assert.ok(/speaker_name['"]?\s*[,:]\s*req\.user/.test(m[0]),
    'speaker_name must be injected from req.user (authenticated login) — prevents spoofing');
  assert.ok(!/req\.body.*speaker_name|speaker_name.*req\.body/.test(m[0]),
    'speaker_name must NOT be read from req.body — that would allow client spoofing');
});

t('passes include_srt=false to whisper', () => {
  const m = SRC.match(/app\.post\(\s*['"]\/whisper\/transcribe['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m, 'could not extract route handler body');
  assert.ok(/include_srt['"]?\s*[,:]\s*['"]?false/.test(m[0]),
    'route must pass include_srt=false — we only need segment text, not subtitles');
});

t('forwards audio blob to whisper server via fetch', () => {
  const m = SRC.match(/app\.post\(\s*['"]\/whisper\/transcribe['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m, 'could not extract route handler body');
  assert.ok(/fetch\(/.test(m[0]), 'route must use fetch() to forward to whisper server');
  assert.ok(/FormData/.test(m[0]), 'route must build a FormData to forward multipart');
  assert.ok(/transcribe/.test(m[0]), 'route must forward to /transcribe endpoint on whisper server');
});

t('relays whisper response status + body to client', () => {
  const m = SRC.match(/app\.post\(\s*['"]\/whisper\/transcribe['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m, 'could not extract route handler body');
  assert.ok(/resp\.status|response\.status/.test(m[0]),
    'route must relay the whisper server HTTP status code to the client');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
