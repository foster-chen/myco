# Voice Input Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the existing disabled `#chat-mic` button to record audio on press-and-hold, send it to the whisper-diarization server's known-speaker mode via a myco proxy, and append the transcript to the chat composer textarea.

**Architecture:** Browser records audio via `MediaRecorder` → POSTs to myco's new `POST /whisper/transcribe` route → myco injects `speaker_name=<authenticated user>` and forwards to `WHISPER_SERVER_URL` → whisper returns transcript segments → myco relays JSON → browser concatenates segment texts and appends to `#chat-input`. The myco proxy solves the whisper server's lack of CORS and prevents `speaker_name` spoofing. Button visibility is gated on `WHISPER_SERVER_URL` being set, surfaced to the client via `/auth/check`.

**Tech Stack:** Express + multer (server), Pointer Events + MediaRecorder + fetch (client), Node `assert` + `fs.readFileSync` source-grep tests (test).

**Spec:** `docs/superpowers/specs/2026-06-17-voice-input-button-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `server/package.json` | Modify | Add `multer` dependency for multipart parsing |
| `server/src/index.js` | Modify | Add `whisperConfigured` to `/auth/check` (line ~248); add `POST /whisper/transcribe` route (~40 lines) |
| `web/public/index.html` | Modify | Remove `hidden` + `disabled` from `#chat-mic` (line 188-191) |
| `web/public/app.js` | Modify | Add `whisperConfigured` to `state` (line ~53); read it in `tryToken` (line ~332); toggle `#chat-mic` visibility; **rewrite** `_bindVoiceInput()` (line 9630-9711) |
| `web/public/styles.css` | Modify | Remove WIP styling from `.composer-btn-mic` (line 4411-4458); add `.chat-mic-transcribing` class |
| `test/whisper-auth-check.test.js` | Create | Static test: `/auth/check` exposes `whisperConfigured` |
| `test/whisper-proxy-route.test.js` | Create | Static test: proxy route exists + injects `speaker_name` from `req.user` |
| `test/voice-input-client.test.js` | Create | Static test: client has `whisperConfigured` state, MediaRecorder, pointer events, mimeType preference, transcript append |

---

## Task 1: Server — expose `whisperConfigured` on `/auth/check`

**Files:**
- Create: `test/whisper-auth-check.test.js`
- Modify: `server/src/index.js:243-248`

- [ ] **Step 1: Write the failing test**

Create `test/whisper-auth-check.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/whisper-auth-check.test.js`
Expected: FAIL with "whisperConfigured field missing from /auth/check authenticated response"

- [ ] **Step 3: Write minimal implementation**

In `server/src/index.js`, find the authenticated profile branch of `/auth/check` (around line 243-248). It currently looks like:

```js
  if (profile) {
    return res.json({
      ok: true, required: isAuthRequired(),
      user: profile.login,
      name: profile.name || null,
      avatar_url: profile.avatarUrl || null,
    });
  }
```

Change to:

```js
  if (profile) {
    return res.json({
      ok: true, required: isAuthRequired(),
      user: profile.login,
      name: profile.name || null,
      avatar_url: profile.avatarUrl || null,
      whisperConfigured: !!process.env.WHISPER_SERVER_URL,
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/whisper-auth-check.test.js`
Expected: PASS (2 passed, 0 failed)

- [ ] **Step 5: Commit**

```bash
git add test/whisper-auth-check.test.js server/src/index.js
git commit -m "feat: expose whisperConfigured on /auth/check for voice-input gating"
```

---

## Task 2: Server — add `multer` dependency

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Add multer to server dependencies**

In `server/package.json`, add `"multer"` to the `dependencies` object (alphabetical order, after `"marked"`):

```json
    "marked": "^18.0.3",
    "multer": "^1.4.5-lts.1",
    "openai": "^6.41.0",
```

- [ ] **Step 2: Install**

Run: `cd server && npm install`
Expected: multer installs without errors.

- [ ] **Step 3: Verify require works**

Run: `node -e "require('multer'); console.log('multer OK')"`
Expected: `multer OK`

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "deps: add multer for multipart audio upload parsing"
```

---

## Task 3: Server — add `POST /whisper/transcribe` proxy route

**Files:**
- Create: `test/whisper-proxy-route.test.js`
- Modify: `server/src/index.js` (add route after the `/auth/check` block, ~line 252)

- [ ] **Step 1: Write the failing test**

Create `test/whisper-proxy-route.test.js`:

```js
// Guards the POST /whisper/transcribe proxy route:
//   1. Route exists and is auth-gated (requireAuth).
//   2. Returns 503 when WHISPER_SERVER_URL is unset.
//   3. Injects speaker_name from req.user (NOT from client form data —
//      prevents spoofing another user's speaker embedding).
//   4. Passes include_srt=false (we only need segment text).
//   5. Forwards the audio file to the whisper server.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/whisper-proxy-route.test.js`
Expected: FAIL with "POST /whisper/transcribe route registration not found"

- [ ] **Step 3: Write minimal implementation**

In `server/src/index.js`, add the multer require near the top (after the other `require()` calls, around line 85 where `const http = require('http')` is):

```js
const multer = require('multer');
```

Then add the route after the `/auth/check` handler (after line 251, before the OAuth section). Place it after the closing of `/auth/check`:

```js
// ─── Whisper diarization proxy ──────────────────────────────────────────────
//
// The browser cannot reach the whisper-diarization server directly (no CORS),
// so we proxy through myco. The server injects speaker_name from the
// authenticated user's login — the client never sends it, preventing
// spoofing of another user's speaker embedding. Returns 503 if
// WHISPER_SERVER_URL is not configured.

const whisperUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

app.post('/whisper/transcribe', requireAuth, whisperUpload.single('audio'), async (req, res) => {
  const whisperUrl = process.env.WHISPER_SERVER_URL;
  if (!whisperUrl) {
    return res.status(503).json({ detail: 'Whisper server not configured' });
  }
  if (!req.file) {
    return res.status(400).json({ detail: 'No audio file provided' });
  }
  try {
    const formData = new FormData();
    formData.append('audio', new Blob([req.file.buffer], { type: req.file.mimetype }),
      req.file.originalname || 'voice.webm');
    formData.append('speaker_name', req.user);
    formData.append('include_srt', 'false');
    const resp = await fetch(whisperUrl.replace(/\/+$/, '') + '/transcribe', {
      method: 'POST',
      body: formData,
    });
    const body = await resp.text();
    res.status(resp.status);
    res.type(resp.headers.get('content-type') || 'application/json');
    res.send(body);
  } catch (err) {
    console.error('[whisper-proxy] error:', err.message);
    res.status(502).json({ detail: 'Whisper server unreachable: ' + (err.message || err) });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/whisper-proxy-route.test.js`
Expected: PASS (8 passed, 0 failed)

- [ ] **Step 5: Commit**

```bash
git add test/whisper-proxy-route.test.js server/src/index.js
git commit -m "feat: add POST /whisper/transcribe proxy route with server-side speaker_name injection"
```

---

## Task 4: Client — add `whisperConfigured` to state + read in `tryToken`

**Files:**
- Create: `test/voice-input-client.test.js`
- Modify: `web/public/app.js` (state definition ~line 53, tryToken ~line 332)

- [ ] **Step 1: Write the failing test**

Create `test/voice-input-client.test.js`:

```js
// Guards the client-side voice-input wiring:
//   1. state has whisperConfigured field.
//   2. tryToken reads body.whisperConfigured from /auth/check.
//   3. #chat-mic visibility is toggled based on state.whisperConfigured.
//   4. _bindVoiceInput uses MediaRecorder + getUserMedia (not SpeechRecognition).
//   5. _bindVoiceInput uses Pointer Events for press-and-hold.
//   6. _bindVoiceInput picks mimeType from a preference list (webm;codecs=opus first).
//   7. _bindVoiceInput POSTs to /whisper/transcribe.
//   8. _bindVoiceInput appends transcript to #chat-input via _joinSpoken.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/voice-input-client.test.js`
Expected: FAIL with "state object must have a whisperConfigured field" (and several others)

- [ ] **Step 3: Add `whisperConfigured` to state**

In `web/public/app.js`, find the `state` object definition (around line 53). Add `whisperConfigured: false,` to the object (place it near other boolean flags like `chatUserScrolledUp` or similar — exact placement within the object doesn't matter as long as it's a top-level field on `state`).

- [ ] **Step 4: Read `whisperConfigured` in `tryToken`**

In `web/public/app.js`, find `tryToken()` (around line 320-342). Inside the `if (body.ok && body.user)` block (around line 331-333), after `state.chatUser = body.user;`, add:

```js
      state.chatUser = body.user;
      state.whisperConfigured = !!body.whisperConfigured;
```

- [ ] **Step 5: Run test to verify partial pass**

Run: `node test/voice-input-client.test.js`
Expected: "state object has whisperConfigured" passes + "tryToken reads body.whisperConfigured" passes. The remaining tests still fail (they test _bindVoiceInput, index.html, styles.css — covered in later tasks).

- [ ] **Step 6: Commit**

```bash
git add test/voice-input-client.test.js web/public/app.js
git commit -m "feat: read whisperConfigured from /auth/check into state for voice-input gating"
```

---

## Task 5: HTML — unhide `#chat-mic`

**Files:**
- Modify: `web/public/index.html:188-191`

- [ ] **Step 1: Remove `hidden` and `disabled` attributes from `#chat-mic`**

In `web/public/index.html`, find the `#chat-mic` button (line 188-191). It currently looks like:

```html
            <button type="button" id="chat-mic" class="composer-btn composer-btn-mic" title="Voice input — in progress · coming soon" aria-label="Voice input (in progress)" aria-pressed="false" aria-disabled="true" disabled hidden>
              <svg class="composer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 19v3"/></svg>
              <span class="composer-btn-label">Speak</span>
```

Change to (remove `disabled`, `hidden`, `aria-disabled="true"`, and update the title/aria-label to reflect the now-active state):

```html
            <button type="button" id="chat-mic" class="composer-btn composer-btn-mic" title="Hold to record voice input" aria-label="Voice input (hold to record)" aria-pressed="false">
              <svg class="composer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 19v3"/></svg>
              <span class="composer-btn-label">Speak</span>
```

- [ ] **Step 2: Verify the test from Task 4 passes this check**

Run: `node test/voice-input-client.test.js`
Expected: "#chat-mic does NOT have hidden or disabled attrs" passes now.

- [ ] **Step 3: Commit**

```bash
git add web/public/index.html
git commit -m "feat: unhide #chat-mic button (JS manages visibility based on whisperConfigured)"
```

---

## Task 6: CSS — update mic button styles (remove WIP, add transcribing state)

**Files:**
- Modify: `web/public/styles.css:4401-4458` (replace lines 4401-4443; keep 4444-4458)

- [ ] **Step 1: Replace the WIP base + hover + disabled rules with clean active styling**

In `web/public/styles.css`, find the block starting at the comment `/* … Voice input button …` (line ~4401) through the second `.composer-btn-mic:hover` override (line 4443). This includes:
- Lines 4401-4410: comment describing WIP state (now stale)
- Lines 4411-4421: `.composer-btn-mic` base rule (strikethrough, dashed border, opacity 0.45)
- Lines 4422-4424: `.composer-btn-mic .composer-icon` (opacity 0.7)
- Lines 4425-4430: `.composer-btn-mic:hover` (no hover lift)
- Lines 4431-4436: `.composer-btn-mic:disabled` (pointer-events: auto for tooltip)
- Lines 4437-4439: retired "soon" badge comment
- Lines 4440-4443: second `.composer-btn-mic:hover` (conflicting override)

Replace ALL of the above (lines 4401-4443) with:

```css
/* Voice input button — press-and-hold to record, release to transcribe.
   Hidden via JS when WHISPER_SERVER_URL is not configured. Recording
   state (.chat-mic-recording) and transcribing state (.chat-mic-transcribing)
   are compound-class modifiers below. */
.composer-btn-mic {
  border: 1px solid var(--border-soft, rgba(128, 128, 128, 0.3));
  position: relative;
}
.composer-btn-mic:hover {
  background: rgba(255, 255, 255, .07);
}
```

**Do NOT touch** lines 4444-4458 — these are the existing recording state + pulse animation + `[hidden]` rule, all of which are still correct:

```css
.composer-btn-mic.chat-mic-recording { ... }       /* line 4444 — KEEP */
.composer-btn-mic.chat-mic-recording:hover { ... }  /* line 4450 — KEEP */
@keyframes chat-mic-pulse { ... }                    /* line 4454 — KEEP */
.composer-btn-mic[hidden] { display: none !important; }  /* line 4458 — KEEP */
```

- [ ] **Step 2: Add `.chat-mic-transcribing` class**

After the `.composer-btn-mic.chat-mic-recording:hover` rule (line 4453, before `@keyframes chat-mic-pulse`), insert:

```css
.composer-btn-mic.chat-mic-transcribing {
  background: rgba(80, 140, 255, .18);
  color: #80aaff;
  border-color: rgba(80, 140, 255, .45);
  cursor: wait;
  pointer-events: none;
}
.composer-btn-mic.chat-mic-transcribing .composer-icon {
  animation: conn-spin .9s linear infinite;
}
```

This reuses the existing `@keyframes conn-spin` (defined at line 1017) for the spinner on the mic icon.

- [ ] **Step 3: Verify the test from Task 4 passes these checks**

Run: `node test/voice-input-client.test.js`
Expected: "styles.css has .chat-mic-transcribing class" passes + ".composer-btn-mic no longer has WIP strikethrough" passes.

- [ ] **Step 4: Commit**

```bash
git add web/public/styles.css
git commit -m "style: activate mic button (remove WIP styling) + add transcribing spinner state"
```

---

## Task 7: Client — rewrite `_bindVoiceInput()` with MediaRecorder + whisper proxy

**Files:**
- Modify: `web/public/app.js:9630-9711` (replace the entire `_bindVoiceInput` function)

- [ ] **Step 1: Replace `_bindVoiceInput()` with the new implementation**

In `web/public/app.js`, find the existing `_bindVoiceInput()` function (starts at line 9630). It currently uses the Web Speech API (`SpeechRecognition`). Replace the ENTIRE function body (from `function _bindVoiceInput() {` to its closing `}`) with:

```js
function _bindVoiceInput() {
  const btn = document.getElementById('chat-mic');
  const input = document.getElementById('chat-input');
  if (!btn || !input) return;
  if (btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';

  // Hide button if whisper server isn't configured (WHISPER_SERVER_URL
  // unset on the server). The /auth/check response sets state.whisperConfigured.
  if (!state.whisperConfigured) {
    btn.hidden = true;
    btn.disabled = true;
    return;
  }

  let mediaRecorder = null;
  let mediaStream = null;
  let audioChunks = [];
  let recordStartTs = 0;
  let recording = false;
  let cancelled = false;
  let pendingPointerUp = null;

  const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

  function pickMimeType() {
    for (const t of MIME_TYPES) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  }

  function extFor(mime) {
    if (mime.includes('webm')) return 'webm';
    if (mime.includes('mp4')) return 'mp4';
    return 'bin';
  }

  function stopStreamTracks() {
    if (mediaStream) {
      mediaStream.getTracks().forEach(function (t) { t.stop(); });
      mediaStream = null;
    }
  }

  function resetButton() {
    btn.classList.remove('chat-mic-recording', 'chat-mic-transcribing');
    btn.disabled = false;
  }

  async function startRecording() {
    cancelled = false;
    audioChunks = [];
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      warnToast('Microphone access denied — check browser permissions');
      return false;
    }
    const mime = pickMimeType();
    try {
      mediaRecorder = mime
        ? new MediaRecorder(mediaStream, { mimeType: mime, audioBitsPerSecond: 64000 })
        : new MediaRecorder(mediaStream, { audioBitsPerSecond: 64000 });
    } catch (err) {
      warnToast('Recording failed: ' + (err.message || err));
      stopStreamTracks();
      return false;
    }
    mediaRecorder.ondataavailable = function (e) {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onerror = function () {
      warnToast('Recording failed');
      stopStreamTracks();
      resetButton();
      recording = false;
    };
    mediaRecorder.start();
    recordStartTs = Date.now();
    recording = true;
    btn.classList.add('chat-mic-recording');
    return true;
  }

  function cancelRecording() {
    cancelled = true;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    stopStreamTracks();
    recording = false;
    resetButton();
  }

  async function stopAndTranscribe() {
    if (!recording || cancelled) return;
    recording = false;
    var duration = Date.now() - recordStartTs;
    if (duration < 200) {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      stopStreamTracks();
      resetButton();
      return;
    }
    var mime = mediaRecorder ? mediaRecorder.mimeType : '';
    var stopped = new Promise(function (resolve) {
      if (!mediaRecorder || mediaRecorder.state === 'inactive') { resolve(); return; }
      mediaRecorder.onstop = resolve;
      mediaRecorder.stop();
    });
    await stopped;
    stopStreamTracks();
    if (audioChunks.length === 0) {
      warnToast('Recording failed — no audio captured');
      resetButton();
      return;
    }
    var blob = new Blob(audioChunks, { type: mime || 'audio/webm' });
    btn.classList.remove('chat-mic-recording');
    btn.classList.add('chat-mic-transcribing');
    btn.disabled = true;
    try {
      var fd = new FormData();
      fd.append('audio', blob, 'voice.' + extFor(mime));
      var resp = await fetch('/whisper/transcribe', { method: 'POST', body: fd });
      var body = await resp.json().catch(function () { return { detail: 'Invalid response from server' }; });
      if (!resp.ok) {
        warnToast('Transcription failed: ' + (body.detail || resp.statusText));
        resetButton();
        return;
      }
      var segments = body.segments || [];
      var text = segments.map(function (s) { return (s.text || '').trim(); })
        .filter(Boolean).join(' ');
      if (!text) {
        warnToast('No speech detected');
        resetButton();
        return;
      }
      var next = _joinSpoken(input.value, text);
      if (next !== input.value) {
        input.value = next;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        try {
          var end = input.value.length;
          input.setSelectionRange(end, end);
        } catch (e) {}
      }
      flashToast('Transcript added');
    } catch (err) {
      warnToast('Transcription service unavailable');
    } finally {
      resetButton();
    }
  }

  // Pointer Events for unified mouse + touch press-and-hold.
  // pointerdown on button → start. pointerup on window → stop + transcribe.
  // pointerleave/pointercancel on button → cancel + discard.
  // Do NOT use setPointerCapture — it suppresses pointerleave.
  btn.addEventListener('pointerdown', async function (e) {
    e.preventDefault();
    if (recording) return;
    btn.disabled = true;
    var ok = await startRecording();
    if (!ok) { resetButton(); return; }
    pendingPointerUp = function () {
      window.removeEventListener('pointerup', pendingPointerUp);
      pendingPointerUp = null;
      stopAndTranscribe();
    };
    window.addEventListener('pointerup', pendingPointerUp);
  });

  btn.addEventListener('pointerleave', function () {
    if (!recording || cancelled) return;
    if (pendingPointerUp) {
      window.removeEventListener('pointerup', pendingPointerUp);
      pendingPointerUp = null;
    }
    cancelRecording();
  });

  btn.addEventListener('pointercancel', function () {
    if (!recording || cancelled) return;
    if (pendingPointerUp) {
      window.removeEventListener('pointerup', pendingPointerUp);
      pendingPointerUp = null;
    }
    cancelRecording();
  });
}
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `node test/voice-input-client.test.js`
Expected: PASS (all 11 tests pass)

- [ ] **Step 3: Commit**

```bash
git add web/public/app.js
git commit -m "feat: rewrite _bindVoiceInput with MediaRecorder + whisper proxy (press-and-hold)"
```

---

## Task 8: Run full test suite

**Files:**
- None (verification only)

- [ ] **Step 1: Run the full myco test suite**

Run: `./test/test.sh`
Expected: All tests pass, including the 3 new test files (`whisper-auth-check.test.js`, `whisper-proxy-route.test.js`, `voice-input-client.test.js`).

- [ ] **Step 2: Fix any failures**

If any test fails, fix the issue and re-run. Common things to check:
- The new test files are auto-discovered by test.sh (they match `test/*.test.js`).
- No static-check guards in test.sh are violated by the new code.
- The multer require doesn't break the server boot.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "test: fix any regressions from voice-input button integration"
```

---

## Self-Review Checklist

After implementing all tasks, verify:

- [ ] `POST /whisper/transcribe` returns 503 when `WHISPER_SERVER_URL` is unset
- [ ] `POST /whisper/transcribe` injects `speaker_name` from `req.user` (not from client form data)
- [ ] `/auth/check` response includes `whisperConfigured: bool`
- [ ] `#chat-mic` is hidden when `state.whisperConfigured` is false
- [ ] `#chat-mic` is visible + enabled when `state.whisperConfigured` is true
- [ ] Press-and-hold on `#chat-mic` starts recording (red pulse)
- [ ] Release on button stops recording + sends to whisper (spinner)
- [ ] Slide-off button cancels recording (discard, no toast)
- [ ] Recording < 200ms is silently cancelled
- [ ] Successful transcript is appended to `#chat-input` (with leading space if non-empty)
- [ ] Synthetic `input` event fires after textarea update (so autoResize + chips re-render)
- [ ] Mic permission denied → `warnToast` + button resets
- [ ] Whisper error → `warnToast` with detail + button resets
- [ ] Empty transcript → `warnToast("No speech detected")` + button resets
- [ ] MediaStream tracks are always stopped on every exit path (mic light off)
- [ ] Audio format preference: `audio/webm;codecs=opus` first
- [ ] All 3 new test files pass standalone (`node test/<name>.test.js`)
- [ ] Full `./test/test.sh` passes
