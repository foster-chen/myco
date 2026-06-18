// Guards the client-side meeting-upload wiring:
//   1. #chat-meeting button exists in index.html.
//   2. #meeting-file-input hidden file input exists with accept="audio/*".
//   3. _bindMeetingUpload is called from bindChatUi.
//   4. _bindMeetingUpload POSTs to /whisper/transcribe-meeting.
//   5. #chat-meeting visibility is gated on state.whisperConfigured.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (err) { console.log('  ✗ ' + name + ' — ' + (err && err.stack ? err.stack : err)); failed++; }
}

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'public', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '..', 'web', 'public', 'app.js'), 'utf8');

console.log('── meeting-button-client ──');

t('#chat-meeting button exists in index.html', () => {
  assert.ok(/id="chat-meeting"/.test(HTML),
    '#chat-meeting button must exist in index.html (composer, between #chat-diagram and #composer-critic-select)');
});

t('#meeting-file-input hidden file input exists with accept="audio/*"', () => {
  assert.ok(/id="meeting-file-input"/.test(HTML),
    '#meeting-file-input hidden file input must exist in index.html');
  assert.ok(/accept="audio\/\*"/.test(HTML),
    '#meeting-file-input must have accept="audio/*" to filter for audio files in the picker');
});

t('_bindMeetingUpload is called from bindChatUi', () => {
  assert.ok(/_bindMeetingUpload\(\)/.test(APP),
    '_bindMeetingUpload() must be called from bindChatUi (next to _bindVoiceInput at line ~9616)');
});

t('_bindMeetingUpload function is defined', () => {
  assert.ok(/function _bindMeetingUpload/.test(APP),
    'function _bindMeetingUpload must be defined in app.js');
});

t('_bindMeetingUpload POSTs to /whisper/transcribe-meeting', () => {
  const m = APP.match(/function _bindMeetingUpload[\s\S]*?^}/m);
  assert.ok(m, 'could not locate _bindMeetingUpload function body');
  assert.ok(/\/whisper\/transcribe-meeting/.test(m[0]),
    '_bindMeetingUpload must POST to /whisper/transcribe-meeting (the myco proxy)');
});

t('#chat-meeting visibility gated on state.whisperConfigured', () => {
  assert.ok(/chat-meeting/.test(APP),
    '#chat-meeting must be referenced in app.js for visibility gating');
  assert.ok(/whisperConfigured/.test(APP),
    'state.whisperConfigured must be used to gate #chat-meeting visibility (same as #chat-mic from task 1)');
});

t('_bindMeetingUpload sends sessionId in the form data', () => {
  const m = APP.match(/function _bindMeetingUpload[\s\S]*?^}/m);
  assert.ok(m, 'could not locate _bindMeetingUpload function body');
  assert.ok(/sessionId/.test(m[0]),
    '_bindMeetingUpload must include sessionId in the form data (the server needs it to find the live AgentSession for session.write)');
});

t('_bindMeetingUpload validates file type is audio', () => {
  const m = APP.match(/function _bindMeetingUpload[\s\S]*?^}/m);
  assert.ok(m, 'could not locate _bindMeetingUpload function body');
  assert.ok(/audio/.test(m[0]),
    '_bindMeetingUpload must validate the selected file type is audio (file.type.startsWith("audio/") or similar)');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
