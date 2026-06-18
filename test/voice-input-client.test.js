// Guards the client-side voice-input wiring:
//   1. state has whisperConfigured field.
//   2. tryToken reads body.whisperConfigured from /auth/check.
//   3. #chat-mic visibility is toggled based on state.whisperConfigured.
//   4. _bindVoiceInput uses MediaRecorder + getUserMedia (not SpeechRecognition).
//   5. _bindVoiceInput uses Pointer Events for press-and-hold.
//   6. _bindVoiceInput picks mimeType from a preference list (webm;codecs=opus first).
//   7. _bindVoiceInput POSTs to /whisper/transcribe.
//   8. _bindVoiceInput appends transcript via _joinSpoken.
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
  assert.ok(/whisperConfigured/.test(APP),
    'state object must have a whisperConfigured field — added near the state definition (~line 53)');
});

t('tryToken reads body.whisperConfigured from /auth/check', () => {
  const m = APP.match(/async\s+function\s+tryToken[\s\S]*?\n\}/);
  assert.ok(m, 'could not locate tryToken function');
  assert.ok(/whisperConfigured/.test(m[0]),
    'tryToken must read body.whisperConfigured from the /auth/check response and store it on state');
});

t('#chat-mic does NOT have hidden or disabled attrs in index.html', () => {
  const m = HTML.match(/<button[^>]*id="chat-mic"[^>]*>/);
  assert.ok(m, '#chat-mic button not found in index.html');
  assert.ok(!/hidden/.test(m[0]),
    '#chat-mic must not have the hidden attribute in HTML — JS manages visibility based on whisperConfigured. Found: ' + m[0]);
  assert.ok(!/disabled/.test(m[0]),
    '#chat-mic must not have the disabled attribute in HTML — JS manages state. Found: ' + m[0]);
});

t('_bindVoiceInput uses MediaRecorder (not SpeechRecognition)', () => {
  const m = APP.match(/function\s+_bindVoiceInput[\s\S]*?\n\}/);
  assert.ok(m, 'could not locate _bindVoiceInput function');
  assert.ok(/MediaRecorder/.test(m[0]),
    '_bindVoiceInput must use MediaRecorder for audio capture');
  assert.ok(!/SpeechRecognition|webkitSpeechRecognition/.test(m[0]),
    '_bindVoiceInput must NOT use the Web Speech API (SpeechRecognition) — replaced by MediaRecorder + whisper proxy');
});

t('_bindVoiceInput uses getUserMedia for mic access', () => {
  const m = APP.match(/function\s+_bindVoiceInput[\s\S]*?\n\}/);
  assert.ok(m, 'could not locate _bindVoiceInput function');
  assert.ok(/getUserMedia/.test(m[0]),
    '_bindVoiceInput must call navigator.mediaDevices.getUserMedia({audio:true}) to access the microphone');
});

t('_bindVoiceInput uses Pointer Events for press-and-hold', () => {
  const m = APP.match(/function\s+_bindVoiceInput[\s\S]*?\n\}/);
  assert.ok(m, 'could not locate _bindVoiceInput function');
  assert.ok(/pointerdown/.test(m[0]),
    '_bindVoiceInput must listen for pointerdown to start recording');
  assert.ok(/pointerup/.test(m[0]),
    '_bindVoiceInput must listen for pointerup (on window) to stop + transcribe');
  assert.ok(/pointerleave|pointercancel/.test(m[0]),
    '_bindVoiceInput must listen for pointerleave/pointercancel to cancel on slide-off');
});

t('_bindVoiceInput has mimeType preference list with webm;codecs=opus first', () => {
  const m = APP.match(/function\s+_bindVoiceInput[\s\S]*?\n\}/);
  assert.ok(m, 'could not locate _bindVoiceInput function');
  assert.ok(/audio\/webm;codecs=opus/.test(m[0]),
    '_bindVoiceInput must prefer audio/webm;codecs=opus (smallest + speech-optimized)');
});

t('_bindVoiceInput POSTs to /whisper/transcribe', () => {
  const m = APP.match(/function\s+_bindVoiceInput[\s\S]*?\n\}/);
  assert.ok(m, 'could not locate _bindVoiceInput function');
  assert.ok(/\/whisper\/transcribe/.test(m[0]),
    '_bindVoiceInput must POST the audio blob to /whisper/transcribe (the myco proxy)');
});

t('_bindVoiceInput appends transcript via _joinSpoken', () => {
  const m = APP.match(/function\s+_bindVoiceInput[\s\S]*?\n\}/);
  assert.ok(m, 'could not locate _bindVoiceInput function');
  assert.ok(/_joinSpoken/.test(m[0]),
    '_bindVoiceInput must use the existing _joinSpoken() helper to append transcript to #chat-input');
  assert.ok(/dispatchEvent\(new\s+Event\(\s*['"]input['"]/.test(m[0]),
    '_bindVoiceInput must dispatch a synthetic input event after setting textarea value so autoResize + chips re-render');
});

t('styles.css has .chat-mic-transcribing class', () => {
  assert.ok(/chat-mic-transcribing/.test(CSS),
    'styles.css must define a .chat-mic-transcribing class for the spinner state');
});

t('styles.css .composer-btn-mic no longer has WIP strikethrough', () => {
  const m = CSS.match(/\.composer-btn-mic\s*\{[^}]*\}/);
  assert.ok(m, '.composer-btn-mic base rule not found');
  assert.ok(!/line-through/.test(m[0]),
    '.composer-btn-mic must not have text-decoration: line-through — the button is now active');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
