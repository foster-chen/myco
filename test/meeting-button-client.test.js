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

t('#chat-meeting has disabled attr in index.html (WIP gate)', () => {
  const m = HTML.match(/<button[^>]*id="chat-meeting"[^>]*>/);
  assert.ok(m, '#chat-meeting button not found in index.html');
  assert.ok(/disabled/.test(m[0]),
    '#chat-meeting must have the disabled attribute in HTML — WIP feature gate (meeting upload not yet released). Found: ' + m[0]);
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

t('renderChatMessage has a meeting-transcript branch', () => {
  assert.ok(/meeting-transcript/.test(APP),
    'renderChatMessage (or the render path) must have a branch for meta.kind === "meeting-transcript" that renders a collapsible bubble');
  assert.ok(/meeting-bubble/.test(APP),
    'render path must use a "meeting-bubble" CSS class for the collapsible bubble container');
});

t('meeting bubble has expand/collapse toggle', () => {
  assert.ok(/meeting-bubble.*expand|toggle.*meeting|collapsed|expanded/.test(APP),
    'meeting bubble must have an expand/collapse toggle (click on header toggles a class)');
});

t('meeting-summary WS frame handler exists in app.js', () => {
  assert.ok(/meeting-summary/.test(APP),
    "app.js must handle the 'meeting-summary' WS frame (updates the meeting bubble's collapsed summary)");
});

t('meeting-summary handler updates meta.summary by meetingId or seq', () => {
  const m = APP.match(/meeting-summary[\s\S]{0,800}/);
  assert.ok(m, 'could not locate meeting-summary handler region');
  assert.ok(/summary/.test(m[0]),
    'meeting-summary handler must update the summary on the matched meeting bubble');
  assert.ok(/meetingId|seq/.test(m[0]),
    'meeting-summary handler must match the bubble by meetingId or seq');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
