// Guards the POST /whisper/transcribe-meeting route:
//   1. Route is registered with requireAuth + multer.
//   2. Outbound form uses Mode 2 (skip_diarization=false, no speaker_name).
//   3. Filters segments by auth.loadAllowlist() (not raw speaker names).
//   4. Populates pendingIdentification for discarded speakers (task-3 stub).
//   5. OpenAI mode branch skips session.write (stub).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (err) { console.log('  ✗ ' + name + ' — ' + (err && err.stack ? err.stack : err)); failed++; }
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server', 'src', 'index.js'), 'utf8');

// Extract the meeting route body (from app.post to the closing );).
function meetingRoute() {
  const m = SRC.match(/app\.post\(\s*['"]\/whisper\/transcribe-meeting['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m, 'POST /whisper/transcribe-meeting route not found in server/src/index.js');
  return m[0];
}

console.log('── meeting-proxy-route ──');

t('POST /whisper/transcribe-meeting route is registered', () => {
  assert.ok(/app\.post\(\s*['"]\/whisper\/transcribe-meeting['"]/.test(SRC),
    'POST /whisper/transcribe-meeting route registration not found in server/src/index.js');
});

t('route uses requireAuth middleware', () => {
  const r = meetingRoute();
  assert.ok(/requireAuth/.test(r),
    'route must use requireAuth middleware (same as /whisper/transcribe)');
});

t('route uses a meetingUpload multer with 500 MB limit', () => {
  assert.ok(/meetingUpload\s*=\s*multer/.test(SRC),
    'meetingUpload multer instance not found — must be separate from whisperUpload (500 MB limit for meetings)');
  assert.ok(/500\s*\*\s*1024\s*\*\s*1024/.test(SRC),
    'meetingUpload must have a 500 MB file size limit (500 * 1024 * 1024)');
});

t('outbound form sets skip_diarization=false (Mode 2)', () => {
  const r = meetingRoute();
  assert.ok(/skip_diarization.*false/.test(r),
    'outbound form must set skip_diarization=false (Mode 2 — meeting diarization)');
});

t('outbound form does NOT set speaker_name (Mode 2, not Mode 3)', () => {
  const r = meetingRoute();
  assert.ok(!/speaker_name/.test(r),
    'meeting route must NOT set speaker_name (Mode 2 matches against full speaker DB, not a single caller)');
});

t('outbound form sets match_threshold explicitly', () => {
  const r = meetingRoute();
  assert.ok(/match_threshold.*0\.75/.test(r),
    'outbound form must set match_threshold=0.75 explicitly (server default is 0.75 but docs say 0.6 — pin it)');
});

t('filters segments by auth.loadAllowlist()', () => {
  const r = meetingRoute();
  assert.ok(/loadAllowlist/.test(r),
    'filtering must cross-reference auth.loadAllowlist() — keeps only segments whose speaker is a myco user login');
});

t('populates pendingIdentification for discarded speakers', () => {
  const r = meetingRoute();
  assert.ok(/pendingIdentification/.test(r),
    'pendingIdentification must be populated for discarded speakers (task-3 stub — stored but not surfaced in UI)');
});

t('OpenAI mode branch skips session.write for meetings', () => {
  const r = meetingRoute();
  assert.ok(/providerId.*openai/.test(r),
    'route must branch on providerId === openai (same check _ensureIteration uses at agent-session.js:293)');
  assert.ok(/openaiStub/.test(r),
    'route must set meta.openaiStub=true in OpenAI mode so the client renders "Summary unavailable" instead of "Generating summary..."');
});

t('returns 422 when no known-user speech detected', () => {
  const r = meetingRoute();
  assert.ok(/422/.test(r),
    'route must return 422 when kept.length === 0 (no known-user speech) — do not persist an empty meeting bubble');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
