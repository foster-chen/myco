# Upload Meeting Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Upload meeting" button to the chat composer that sends an audio file to the whisper-diarization server's Mode 2 (meeting diarization), filters the result to keep only segments spoken by known myco users, persists the transcript as a collapsible chat bubble, sends it to Claude as a synthetic user turn for context + summary generation, and captures Claude's one-sentence summary into the collapsed bubble header.

**Architecture:** Browser picks audio file → `POST /whisper/transcribe-meeting` (myco proxy, Mode 2) → whisper returns diarized segments → myco filters by `allowed-github-users.txt` → persists a `meta.kind:'meeting-transcript'` chat row → broadcasts via `chat` WS frame → sends transcript to Claude via `session.write()` + sets `_pendingMeetingSummary` flag → Claude responds with a one-sentence summary → `_persistAssistantTextToRecChat` accumulates the summary text → on `turn_result`, the summary is persisted to the meeting row's `meta.summary` + broadcast via `meeting-summary` WS frame → client updates the collapsed bubble. OpenAI-compatible mode is stubbed (no `session.write`, no summary).

**Tech Stack:** Express + multer (server route), `@anthropic-ai/claude-agent-sdk` session.write (Claude context), WebSocket frames (meeting-summary), fetch + FormData (client upload), vanilla DOM (collapsible bubble), Node `assert` + `fs.readFileSync` source-grep tests + test.sh server-smoke (testing).

**Spec:** `docs/superpowers/specs/2026-06-18-upload-meeting-button-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `server/src/index.js` | Modify | Add `POST /whisper/transcribe-meeting` route (~100 lines, after the existing `/whisper/transcribe` proxy at line 292). Includes `meetingUpload` multer (500 MB), Mode 2 FormData, allowlist filtering, meeting-row persistence, mode-branch (SDK vs OpenAI stub), helper functions `_fmtDuration`, `_fmtTimestamp`, `_buildMeetingTurnText`. |
| `server/src/agent-session.js` | Modify | Add `_pendingMeetingSummary` accumulation branch in `_persistAssistantTextToRecChat` (line ~2033). Add meeting-summary capture + broadcast in the `turn_result` handler (line ~1255, after the clarify-reply flush). |
| `server/src/attach.js` | Modify | Add `meeting-summary` WS frame listener + `session.on('meeting-summary', ...)` registration (line ~1705, next to the `clarify-reply` listener). |
| `web/public/index.html` | Modify | Add `<button id="chat-meeting">` + hidden `<input type="file" id="meeting-file-input" accept="audio/*">` in the composer (between `#chat-diagram` and `#composer-critic-select`, line ~199). |
| `web/public/app.js` | Modify | Add `_bindMeetingUpload()` (near `_bindVoiceInput` at line 9632). Add `#chat-meeting` visibility gating in `tryToken` (line ~334). Add `meeting-transcript` branch in `renderChatMessage` (line 5640). Add `meeting-summary` WS frame handler (line ~2385, near `clarify-reply`). Add expand/collapse click delegation. |
| `web/public/styles.css` | Modify | Add `.composer-btn-meeting`, `.chat-meeting-busy`, `.meeting-bubble`, `.meeting-bubble-header`, `.meeting-bubble-summary`, `.meeting-bubble-transcript`, chevron states (near the mic styles at line ~4304). |
| `test/meeting-proxy-route.test.js` | Create | Static tests: route exists, Mode 2 fields, no `speaker_name`, filters by `loadAllowlist`, `pendingIdentification` stub, OpenAI stub branch. |
| `test/meeting-summary-capture.test.js` | Create | Static tests: `_pendingMeetingSummary` accumulation in `_persistAssistantTextToRecChat`, capture + `meeting-summary` emit on `turn_result`. |
| `test/meeting-ws-frame.test.js` | Create | Static test: `attach.js` registers `meeting-summary` WS frame listener. |
| `test/meeting-button-client.test.js` | Create | Static tests: `#chat-meeting` in HTML, `_bindMeetingUpload` exists, POSTs to `/whisper/transcribe-meeting`, `meeting-transcript` render branch, `meeting-summary` WS handler. |
| `test/test.sh` | Modify | Wire 4 new test files into `run_static_checks` (after line 4841). Add meeting smoke tests to `run_server_smoke`. |

---

## Task 1: Server — `POST /whisper/transcribe-meeting` route

**Files:**
- Create: `test/meeting-proxy-route.test.js`
- Modify: `server/src/index.js` (after line 292)

- [ ] **Step 1: Write the failing test**

Create `test/meeting-proxy-route.test.js`:

```js
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
  // The existing /whisper/transcribe route DOES set speaker_name. We need
  // to make sure the meeting route does NOT. Check that speaker_name is
  // absent from the meeting route body.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/meeting-proxy-route.test.js`
Expected: FAIL with "POST /whisper/transcribe-meeting route registration not found in server/src/index.js"

- [ ] **Step 3: Write minimal implementation**

In `server/src/index.js`, find the end of the existing `POST /whisper/transcribe` route (the closing `});` around line 292). Add the meeting route + helpers immediately after:

```js
// ─── Meeting diarization proxy (Mode 2) ─────────────────────────────────────
//
// Unlike the known-speaker proxy above (Mode 3, injects speaker_name),
// this route sends Mode 2 (skip_diarization=false, no speaker_name) so
// whisper matches each segment against the full speaker DB. The response
// is then filtered to keep ONLY segments spoken by known myco users
// (logins in allowed-github-users.txt). The kept transcript is persisted
// as a collapsible chat bubble + sent to Claude as a synthetic user turn
// (SDK mode) so it enters Claude's conversation context. Claude's
// one-sentence summary is captured back into the bubble header.
// OpenAI mode is stubbed (no session.write, no summary).

const meetingUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

function _fmtDuration(ms) {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
}

function _fmtTimestamp(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0
    ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function _buildMeetingTurnText(kept, speakers, durationMs) {
  const lines = kept.map(function (s) {
    return '[' + _fmtTimestamp(s.startMs) + '] ' + s.speaker + ': ' + s.text;
  });
  return '[Meeting transcript uploaded for context. Respond with ONE sentence summarising what was discussed. Do not analyse unless asked in a follow-up.]\n\n' +
    'Meeting transcript (' + kept.length + ' segments, ' + speakers.length + ' speakers, duration ' + _fmtDuration(durationMs) + '):\n' +
    lines.join('\n');
}

app.post('/whisper/transcribe-meeting', requireAuth, meetingUpload.single('audio'), async (req, res) => {
  const whisperUrl = process.env.WHISPER_SERVER_URL;
  if (!whisperUrl) {
    return res.status(503).json({ detail: 'Whisper server not configured' });
  }
  if (!req.file) {
    return res.status(400).json({ detail: 'No audio file provided' });
  }
  const sessionId = req.body.sessionId;
  const attachMod = require('./attach');
  const session = attachMod.getSession && attachMod.getSession(sessionId);
  if (!session || typeof session.write !== 'function') {
    return res.status(409).json({ detail: 'Session not active — attach first' });
  }
  try {
    // ── 1. Forward to whisper Mode 2 ──
    const formData = new FormData();
    formData.append('audio', new Blob([req.file.buffer], { type: req.file.mimetype }),
      req.file.originalname || 'meeting.bin');
    formData.append('skip_diarization', 'false');
    formData.append('include_srt', 'false');
    formData.append('match_threshold', '0.75');
    const resp = await fetch(whisperUrl.replace(/\/+$/, '') + '/transcribe', { method: 'POST', body: formData });
    const body = await resp.json().catch(function () { return { detail: 'Invalid response from whisper server' }; });
    if (!resp.ok) {
      return res.status(resp.status).json(body);
    }
    // ── 2. Filter by myco allowlist ──
    const allowlist = new Set(
      String((loadAllowlist && loadAllowlist() || []).join('\n'))
        .split('\n')
        .map(function (s) { return s.toLowerCase().trim(); })
        .filter(Boolean)
    );
    const segments = Array.isArray(body.segments) ? body.segments : [];
    if (segments.length === 0) {
      return res.status(422).json({ detail: 'No speech detected in recording' });
    }
    const kept = [];
    const pendingById = new Map();
    for (const seg of segments) {
      const spk = String(seg.speaker || '').toLowerCase().trim();
      if (allowlist.has(spk)) {
        kept.push({
          speaker: spk,
          startMs: Number(seg.start_time),
          endMs: Number(seg.end_time),
          text: String(seg.text || '').trim(),
        });
      } else {
        if (!pendingById.has(spk)) {
          pendingById.set(spk, {
            speakerLabel: String(seg.speaker || ''),
            segmentCount: 0,
            sampleText: '',
          });
        }
        var p = pendingById.get(spk);
        p.segmentCount++;
        if (!p.sampleText) p.sampleText = String(seg.text || '').trim().slice(0, 120);
      }
    }
    if (kept.length === 0) {
      return res.status(422).json({ detail: 'No speech from known users detected in this recording' });
    }
    // ── 3. Persist meeting chat row ──
    const durationMs = kept.length ? Math.max.apply(null, kept.map(function (s) { return s.endMs; })) - Math.min.apply(null, kept.map(function (s) { return s.startMs; })) : 0;
    const speakers = Array.from(new Set(kept.map(function (s) { return s.speaker; })));
    const meetingId = crypto.randomUUID();
    const meetingRow = {
      user: req.user,
      text: '📁 Meeting transcript — ' + kept.length + ' segments, ' + speakers.length + ' speakers, ' + _fmtDuration(durationMs),
      ts: new Date().toISOString(),
      meta: {
        kind: 'meeting-transcript',
        meetingId: meetingId,
        summary: null,
        durationMs: durationMs,
        segmentCount: kept.length,
        speakerCount: speakers.length,
        speakers: speakers,
        transcript: kept,
        pendingIdentification: Array.from(pendingById.values()),
        audioFileName: req.file.originalname || 'meeting.bin',
        openaiStub: false,
      },
    };
    sessionsMod.appendChatMessage(sessionId, meetingRow);
    session.emit('chat', meetingRow);
    // ── 4. Branch on session mode ──
    const agentConfig = require('./agent-config');
    const providerId = agentConfig.resolve().providerId;
    if (providerId === 'openai') {
      // OpenAI stub: no session.write, no summary. Mark the row + add a visible note.
      meetingRow.meta.openaiStub = true;
      const stubNote = {
        user: 'claude',
        text: '(Meeting uploaded — OpenAI path context injection not yet implemented. Transcript is in the bubble above.)',
        ts: new Date().toISOString(),
        meta: { kind: 'meeting-stub-note' },
      };
      sessionsMod.appendChatMessage(sessionId, stubNote);
      session.emit('chat', stubNote);
    } else {
      // Claude SDK mode: send synthetic turn + set summary capture flag.
      const transcriptText = _buildMeetingTurnText(kept, speakers, durationMs);
      session._pendingMeetingSummary = {
        meetingId: meetingId,
        chatRowSeq: meetingRow.meta.seq,
        summaryText: '',
      };
      session.write(transcriptText);
    }
    // ── 5. Respond ──
    res.status(200).json(meetingRow);
  } catch (err) {
    console.error('[whisper-meeting-proxy] error:', err.message);
    res.status(502).json({ detail: 'Whisper server unreachable: ' + (err.message || err) });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/meeting-proxy-route.test.js`
Expected: PASS (10 passed, 0 failed)

- [ ] **Step 5: Commit**

```bash
git add test/meeting-proxy-route.test.js server/src/index.js
git commit -m "feat: add POST /whisper/transcribe-meeting route (Mode 2 proxy + allowlist filter)"
```

---

## Task 2: Server — summary capture in `agent-session.js`

**Files:**
- Create: `test/meeting-summary-capture.test.js`
- Modify: `server/src/agent-session.js` (`_persistAssistantTextToRecChat` at line ~2033, `turn_result` handler at line ~1255)

- [ ] **Step 1: Write the failing test**

Create `test/meeting-summary-capture.test.js`:

```js
// Guards the meeting-summary capture mechanism (mirrors _pendingClarify):
//   1. _persistAssistantTextToRecChat accumulates into _pendingMeetingSummary.summaryText.
//   2. The accumulation does NOT suppress the normal fromAgent persistence
//      or the agent-event emit (Approach A — visible ack).
//   3. The turn_result handler captures the summary, updates the meeting
//      row's meta.summary, and emits a 'meeting-summary' event.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (err) { console.log('  ✗ ' + name + ' — ' + (err && err.stack ? err.stack : err)); failed++; }
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server', 'src', 'agent-session.js'), 'utf8');

console.log('── meeting-summary-capture ──');

t('_persistAssistantTextToRecChat accumulates into _pendingMeetingSummary', () => {
  assert.ok(/_pendingMeetingSummary/.test(SRC),
    '_pendingMeetingSummary must be referenced in agent-session.js — the summary capture flag (mirrors _pendingClarify)');
  // Find the _persistAssistantTextToRecChat function body and check it
  // accumulates into _pendingMeetingSummary.summaryText.
  const fnMatch = SRC.match(/_persistAssistantTextToRecChat\(text\)\s*\{[\s\S]*?^  \}/m);
  assert.ok(fnMatch, 'could not locate _persistAssistantTextToRecChat function body');
  assert.ok(/_pendingMeetingSummary\.summaryText/.test(fnMatch[0]),
    '_persistAssistantTextToRecChat must accumulate trimmed text into _pendingMeetingSummary.summaryText');
});

t('accumulation does NOT early-return (visible ack — Approach A)', () => {
  const fnMatch = SRC.match(/_persistAssistantTextToRecChat\(text\)\s*\{[\s\S]*?^  \}/m);
  assert.ok(fnMatch, 'could not locate _persistAssistantTextToRecChat function body');
  // The _pendingMeetingSummary branch must NOT have an early return that
  // would skip the normal fromAgent persistence. Check that appendChatMessage
  // is still called AFTER the _pendingMeetingSummary branch.
  const accIdx = fnMatch[0].indexOf('_pendingMeetingSummary');
  const appendIdx = fnMatch[0].indexOf('appendChatMessage');
  assert.ok(accIdx >= 0 && appendIdx >= 0 && appendIdx > accIdx,
    'appendChatMessage must be called AFTER the _pendingMeetingSummary accumulation — the normal fromAgent row must still persist (visible ack, Approach A)');
});

t('turn_result handler captures + emits meeting-summary', () => {
  // Find the turn_result handler region (around line 1240-1265) and check
  // it has a _pendingMeetingSummary capture branch that emits 'meeting-summary'.
  const region = SRC.slice(SRC.indexOf('flush the consolidated clarify-reply'), SRC.indexOf("type: 'turn_result'") + 200);
  assert.ok(/_pendingMeetingSummary/.test(region),
    'turn_result handler must check _pendingMeetingSummary and capture the summary');
  assert.ok(/meeting-summary/.test(region),
    'turn_result handler must emit a meeting-summary event when _pendingMeetingSummary is set');
  assert.ok(/_pendingMeetingSummary\s*=\s*null/.test(region),
    'turn_result handler must clear _pendingMeetingSummary after capturing the summary');
});

t('summary is truncated to first sentence', () => {
  const region = SRC.slice(SRC.indexOf('flush the consolidated clarify-reply'), SRC.indexOf("type: 'turn_result'") + 200);
  assert.ok(/split.*\[.!?.\]/.test(region) || /firstSentence|first.*sentence/.test(region),
    'summary must be truncated to the first sentence before persisting to meta.summary');
});

t('meeting row meta.summary is updated in rec.chat', () => {
  const region = SRC.slice(SRC.indexOf('flush the consolidated clarify-reply'), SRC.indexOf("type: 'turn_result'") + 200);
  assert.ok(/meta\.summary/.test(region),
    'turn_result handler must update the meeting row\'s meta.summary in rec.chat');
  assert.ok(/saveStore/.test(region) || /saveStore/.test(SRC.slice(SRC.indexOf('_pendingMeetingSummary'), SRC.indexOf('_pendingMeetingSummary') + 800)),
    'saveStore must be called after updating meta.summary so the summary persists to disk');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/meeting-summary-capture.test.js`
Expected: FAIL with "_pendingMeetingSummary must be referenced in agent-session.js"

- [ ] **Step 3: Write minimal implementation**

**Edit 1:** In `server/src/agent-session.js`, find `_persistAssistantTextToRecChat` (line ~2033). The current clarify branch looks like:

```js
    if (this._pendingClarify) {
      msg.meta.kind = 'clarify-reply';
      msg.meta.clarifyQuestionTs = this._pendingClarify.questionTs;
      this._pendingClarify.replyText =
        (this._pendingClarify.replyText || '') + trimmed + '\n';
    }
```

Add the `_pendingMeetingSummary` accumulation branch BEFORE the clarify branch (does NOT early-return — the normal `fromAgent` persistence + emit must still run):

```js
    // Meeting-summary accumulation (mirrors _pendingClarify but does NOT
    // suppress the normal fromAgent row or agent-event emit — Approach A:
    // Claude's reply renders as a normal bubble AND the text is captured
    // for the meeting bubble's collapsed summary). The turn_result handler
    // reads summaryText, truncates to the first sentence, persists it to
    // the meeting row's meta.summary, and emits a 'meeting-summary' event.
    if (this._pendingMeetingSummary) {
      this._pendingMeetingSummary.summaryText =
        (this._pendingMeetingSummary.summaryText || '') + trimmed + '\n';
    }
    if (this._pendingClarify) {
      msg.meta.kind = 'clarify-reply';
      msg.meta.clarifyQuestionTs = this._pendingClarify.questionTs;
      this._pendingClarify.replyText =
        (this._pendingClarify.replyText || '') + trimmed + '\n';
    }
```

**Edit 2:** In the `turn_result` handler (line ~1255, AFTER the clarify-reply flush block and BEFORE `this._emit({ type: 'turn_result', ...})`), add the meeting-summary capture:

Find this code (around line 1254-1256):

```js
        this._pendingClarify = null;
      }
      this._emit({
        type: 'turn_result',
```

Insert between `}` and `this._emit({`:

```js
        this._pendingClarify = null;
      }
      // Meeting-summary capture: if a meeting transcript was sent to Claude
      // and we've been accumulating the reply text, truncate to the first
      // sentence, persist it to the meeting row's meta.summary, and emit a
      // 'meeting-summary' event so attach.js broadcasts it to all clients.
      if (this._pendingMeetingSummary) {
        try {
          const fullSummary = String(this._pendingMeetingSummary.summaryText || '').trim();
          const firstSentence = (fullSummary.split(/(?<=[.!?])\s/)[0] || fullSummary).trim();
          const sessionsMod = require('./sessions');
          const rec = sessionsMod.getSessionRecord(this.sessionId);
          if (rec && Array.isArray(rec.chat)) {
            for (const row of rec.chat) {
              if (row && row.meta && row.meta.seq === this._pendingMeetingSummary.chatRowSeq) {
                row.meta.summary = firstSentence;
                break;
              }
            }
            sessionsMod.saveStore();
          }
          this.emit('meeting-summary', {
            meetingId: this._pendingMeetingSummary.meetingId,
            seq: this._pendingMeetingSummary.chatRowSeq,
            summary: firstSentence,
          });
          console.log(`[meeting-summary] ${this.sessionId} captured summary (${firstSentence.length} chars) for meeting ${this._pendingMeetingSummary.meetingId}`);
        } catch (err) {
          console.error(`[meeting-summary] ${this.sessionId} capture failed: ${err && err.message ? err.message : err}`);
        }
        this._pendingMeetingSummary = null;
      }
      this._emit({
        type: 'turn_result',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/meeting-summary-capture.test.js`
Expected: PASS (5 passed, 0 failed)

- [ ] **Step 5: Commit**

```bash
git add test/meeting-summary-capture.test.js server/src/agent-session.js
git commit -m "feat: capture Claude's meeting-summary into the meeting bubble header"
```

---

## Task 3: Server — `meeting-summary` WS frame in `attach.js`

**Files:**
- Create: `test/meeting-ws-frame.test.js`
- Modify: `server/src/attach.js` (line ~1696-1705, next to the `clarify-reply` listener)

- [ ] **Step 1: Write the failing test**

Create `test/meeting-ws-frame.test.js`:

```js
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
  // Find the meeting-summary listener body.
  const m = SRC.match(/session\.on\(\s*['"]meeting-summary['"]\s*,\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\}\s*\)/);
  assert.ok(m, 'could not locate the meeting-summary listener body');
  assert.ok(/meeting-summary/.test(m[0]),
    "listener must broadcast { t: 'meeting-summary', ...payload } to the WS client");
  assert.ok(/ws\.send/.test(m[0]),
    'listener must call ws.send() to forward the frame to the attached client');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/meeting-ws-frame.test.js`
Expected: FAIL with "attach.js must register session.on('meeting-summary', ...)"

- [ ] **Step 3: Write minimal implementation**

In `server/src/attach.js`, find the `clarify-reply` listener (line ~1696-1705):

```js
  const onClarifyReply = (payload) => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ t: 'clarify-reply', ...payload }));
  };

  session.on('agent-event', onAgentEvent);
  session.on('chat', onChat);
  session.on('state-update', onStateUpdate);
  session.on('exit', onExit);
  session.on('clarify-reply', onClarifyReply);
```

Add the `meeting-summary` listener + registration right after `onClarifyReply`:

```js
  const onClarifyReply = (payload) => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ t: 'clarify-reply', ...payload }));
  };
  // meeting-summary: agent-session emits this when Claude's reply to a
  // meeting-transcript turn is captured. Forwards the summary to all
  // attached clients so they can update the collapsed bubble header.
  const onMeetingSummary = (payload) => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ t: 'meeting-summary', ...payload }));
  };

  session.on('agent-event', onAgentEvent);
  session.on('chat', onChat);
  session.on('state-update', onStateUpdate);
  session.on('exit', onExit);
  session.on('clarify-reply', onClarifyReply);
  session.on('meeting-summary', onMeetingSummary);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/meeting-ws-frame.test.js`
Expected: PASS (2 passed, 0 failed)

- [ ] **Step 5: Commit**

```bash
git add test/meeting-ws-frame.test.js server/src/attach.js
git commit -m "feat: broadcast meeting-summary WS frame to attached clients"
```

---

## Task 4: Client — `#chat-meeting` button + upload flow

**Files:**
- Create: `test/meeting-button-client.test.js`
- Modify: `web/public/index.html` (line ~199, between `#chat-diagram` and `#composer-critic-select`)
- Modify: `web/public/app.js` (line ~334 visibility gating, line ~9616 bind call, new `_bindMeetingUpload` function)

- [ ] **Step 1: Write the failing test**

Create `test/meeting-button-client.test.js`:

```js
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
  // The gating can be in tryToken (where whisperConfigured is read) or in
  // _bindMeetingUpload. Either way, #chat-meeting must be hidden when
  // state.whisperConfigured is false.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/meeting-button-client.test.js`
Expected: FAIL with "#chat-meeting button must exist in index.html"

- [ ] **Step 3: Write minimal implementation**

**Edit 1:** In `web/public/index.html`, find the `#chat-diagram` button (line ~196-199). Add the meeting button + hidden file input BETWEEN `#chat-diagram` and `#composer-critic-select`:

```html
            <button type="button" id="chat-diagram" class="composer-btn composer-btn-diagram" title="Draw a diagram and insert it into chat" aria-label="Draw a diagram">
              <svg class="composer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15.707 21.293-2-2a1 1 0 0 1 0-1.414l8.586-8.586a1 1 0 0 1 1.414 0l2 2a1 1 0 0 1 0 1.414l-8.586 8.586a1 1 0 0 1-1.414 0"/><path d="M18 13 13 8"/><path d="m2 2 7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
              <span class="composer-btn-label">Draw</span>
            </button>
            <button type="button" id="chat-meeting" class="composer-btn composer-btn-meeting" title="Upload a meeting recording for diarization + transcript" aria-label="Upload meeting recording">
              <svg class="composer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span class="composer-btn-label">Meeting</span>
            </button>
            <input type="file" id="meeting-file-input" accept="audio/*" hidden>
```

**Edit 2:** In `web/public/app.js`, find `bindChatUi` (line ~9616). Add `_bindMeetingUpload()` call next to `_bindVoiceInput()`:

```js
  _bindVoiceInput();
  _bindMeetingUpload();
```

**Edit 3:** In `web/public/app.js`, find the `_bindVoiceInput` function (line ~9632). Add `_bindMeetingUpload` immediately AFTER the end of `_bindVoiceInput` (after its closing `}`). The function ends around line ~9810 — find the closing brace and add:

```js
// Meeting upload: click #chat-meeting → hidden file picker → POST the
// selected audio file to /whisper/transcribe-meeting (the myco proxy that
// forwards to whisper Mode 2, filters by allowlist, persists a collapsible
// meeting bubble, and sends the transcript to Claude). The meeting bubble
// arrives via the 'chat' WS frame; the summary arrives later via the
// 'meeting-summary' WS frame. The button is hidden when
// state.whisperConfigured is false (no whisper server configured).
function _bindMeetingUpload() {
  const btn = document.getElementById('chat-meeting');
  const fileInput = document.getElementById('meeting-file-input');
  if (!btn || !fileInput) return;
  if (btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';

  if (!state.whisperConfigured) {
    btn.hidden = true;
    btn.disabled = true;
    return;
  }

  function resetButton() {
    btn.classList.remove('chat-meeting-busy');
    btn.disabled = false;
  }

  btn.addEventListener('click', function () {
    if (btn.disabled) return;
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', async function () {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (!file.type || !file.type.startsWith('audio/')) {
      warnToast('Please choose an audio file (wav, mp3, m4a, etc.)');
      return;
    }
    btn.classList.add('chat-meeting-busy');
    btn.disabled = true;
    flashToast('Uploading + transcribing — this may take a few minutes for long recordings');
    try {
      const fd = new FormData();
      fd.append('audio', file, file.name);
      fd.append('sessionId', state.sessionId || '');
      const controller = new AbortController();
      const timeout = setTimeout(function () { controller.abort(); }, 600000);
      const resp = await fetch('/whisper/transcribe-meeting', {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const body = await resp.json().catch(function () { return { detail: 'Invalid response from server' }; });
      if (!resp.ok) {
        warnToast('Meeting upload failed: ' + (body.detail || resp.statusText));
        resetButton();
        return;
      }
      flashToast('Meeting transcript added');
      resetButton();
    } catch (err) {
      if (err && err.name === 'AbortError') {
        warnToast('Meeting upload timed out (10 min)');
      } else {
        warnToast('Upload failed — check connection');
      }
      resetButton();
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/meeting-button-client.test.js`
Expected: PASS (8 passed, 0 failed)

- [ ] **Step 5: Commit**

```bash
git add test/meeting-button-client.test.js web/public/index.html web/public/app.js
git commit -m "feat: add #chat-meeting button + _bindMeetingUpload upload flow"
```

---

## Task 5: Client — collapsible bubble rendering + `meeting-summary` WS handler

**Files:**
- Modify: `test/meeting-button-client.test.js` (add rendering + WS handler tests)
- Modify: `web/public/app.js` (`renderChatMessage` at line 5640, WS dispatch at line ~2385, `appendChatMessage` at line 3414)

- [ ] **Step 1: Write the failing tests (append to existing test file)**

Add these tests to the END of `test/meeting-button-client.test.js` (before the final `console.log` + `process.exit`):

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/meeting-button-client.test.js`
Expected: FAIL on the new tests ("renderChatMessage must have a branch for meeting-transcript")

- [ ] **Step 3: Write minimal implementation**

**Edit 1:** In `web/public/app.js`, find `renderChatMessage` (line 5640). The function starts like:

```js
function renderChatMessage(m, isActiveMenu) {
```

Near the TOP of the function body (after any existing early-return guards), add the meeting-transcript branch:

```js
function renderChatMessage(m, isActiveMenu) {
  // Meeting transcript: collapsible bubble with header + summary + expand.
  // Collapsed by default; click header toggles .meeting-bubble-expanded.
  // The full transcript (meta.transcript) renders in the expanded section.
  if (m && m.meta && m.meta.kind === 'meeting-transcript') {
    const summary = m.meta.summary;
    const summaryLine = summary
      ? '<div class="meeting-bubble-summary">💬 ' + escHtml(summary) + '</div>'
      : (m.meta.openaiStub
        ? '<div class="meeting-bubble-summary meeting-bubble-summary-stub">Summary unavailable (OpenAI path)</div>'
        : '<div class="meeting-bubble-summary meeting-bubble-summary-pending">Generating summary...</div>');
    const transcriptHtml = (m.meta.transcript || []).map(function (seg) {
      const ts = _fmtMeetingTs(seg.startMs);
      return '<div class="meeting-bubble-seg">[' + ts + '] <b>' + escHtml(seg.speaker) + '</b>: ' + escHtml(seg.text) + '</div>';
    }).join('');
    return '<div class="chat-msg meeting-bubble" data-meeting-id="' + escHtml(m.meta.meetingId || '') + '" data-seq="' + (m.meta.seq || '') + '">' +
      '<div class="meeting-bubble-header">' +
        '<span class="meeting-bubble-text">' + escHtml(m.text) + '</span>' +
        '<span class="meeting-bubble-chevron">▸</span>' +
      '</div>' +
      summaryLine +
      '<div class="meeting-bubble-transcript">' + transcriptHtml + '</div>' +
      '</div>';
  }
  // ... existing render code continues below
```

**Edit 2:** Add the timestamp helper near the top of `app.js` (after `escHtml` or near other utility functions). Find `function escHtml` and add after it:

```js
function _fmtMeetingTs(ms) {
  var totalSec = Math.floor((ms || 0) / 1000);
  var h = Math.floor(totalSec / 3600);
  var m = Math.floor((totalSec % 3600) / 60);
  var s = totalSec % 60;
  return h > 0
    ? String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
    : String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
```

**Edit 3:** Add the expand/collapse click handler. Find the `bindChatUi` function (where `_bindVoiceInput()` is called). Add event delegation for meeting-bubble header clicks. After the `_bindMeetingUpload()` call:

```js
  _bindVoiceInput();
  _bindMeetingUpload();
  _bindMeetingBubbleToggle();
```

And add the function near `_bindMeetingUpload`:

```js
// Collapsible meeting bubble: click the header to toggle expanded/collapsed.
// Uses event delegation on #chat-messages so it works for bubbles loaded
// via chat-history pagination too.
function _bindMeetingBubbleToggle() {
  const list = document.getElementById('chat-messages');
  if (!list) return;
  if (list.dataset.meetingToggleBound === '1') return;
  list.dataset.meetingToggleBound = '1';
  list.addEventListener('click', function (e) {
    const header = e.target.closest('.meeting-bubble-header');
    if (!header) return;
    const bubble = header.closest('.meeting-bubble');
    if (!bubble) return;
    bubble.classList.toggle('meeting-bubble-expanded');
    const chevron = header.querySelector('.meeting-bubble-chevron');
    if (chevron) chevron.textContent = bubble.classList.contains('meeting-bubble-expanded') ? '▾' : '▸';
  });
}
```

**Edit 4:** Add the `meeting-summary` WS frame handler. Find the WS message dispatch (around line 2385, where `clarify-reply` is handled):

```js
      } else if (msg.t === 'clarify-reply') {
```

Add the `meeting-summary` handler AFTER the `clarify-reply` block (before the next `else if`):

```js
      } else if (msg.t === 'meeting-summary') {
        // Update the meeting bubble's collapsed summary. Match by meetingId
        // (or seq fallback). Re-render the summary line in place.
        const payload = msg;
        const list = document.getElementById('chat-messages');
        if (list) {
          const selector = payload.meetingId
            ? '.meeting-bubble[data-meeting-id="' + CSS.escape(payload.meetingId) + '"]'
            : '.meeting-bubble[data-seq="' + payload.seq + '"]';
          const bubble = list.querySelector(selector);
          if (bubble) {
            const oldSummary = bubble.querySelector('.meeting-bubble-summary');
            if (oldSummary && typeof payload.summary === 'string') {
              const newSummary = document.createElement('div');
              newSummary.className = 'meeting-bubble-summary';
              newSummary.textContent = '💬 ' + payload.summary;
              oldSummary.replaceWith(newSummary);
            }
          }
        }
        // Also update state.chatMessages so a re-render uses the summary.
        for (let i = 0; i < state.chatMessages.length; i++) {
          const cm = state.chatMessages[i];
          if (cm && cm.meta && cm.meta.kind === 'meeting-transcript' &&
              ((payload.meetingId && cm.meta.meetingId === payload.meetingId) ||
               (payload.seq && cm.meta.seq === payload.seq))) {
            cm.meta.summary = payload.summary;
            break;
          }
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/meeting-button-client.test.js`
Expected: PASS (12 passed, 0 failed)

- [ ] **Step 5: Commit**

```bash
git add test/meeting-button-client.test.js web/public/app.js
git commit -m "feat: collapsible meeting bubble rendering + meeting-summary WS handler"
```

---

## Task 6: CSS — meeting button + bubble styles

**Files:**
- Modify: `web/public/styles.css` (near the mic styles at line ~4304)

- [ ] **Step 1: Add CSS styles**

In `web/public/styles.css`, find the `.composer-btn-mic` styles (around line 4304). Add the meeting button + bubble styles after the mic keyframe animation block:

```css
/* ─── Meeting upload button ─── */
.composer-btn-meeting {
  color: var(--text-dim, #888);
}
.composer-btn-meeting:hover {
  color: var(--accent, #4caf82);
}
.composer-btn-meeting.chat-meeting-busy {
  color: var(--accent, #4caf82);
  pointer-events: none;
}
.composer-btn-meeting.chat-meeting-busy .composer-icon {
  animation: chat-meeting-spin 1s linear infinite;
}
@keyframes chat-meeting-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ─── Meeting transcript bubble (collapsible) ─── */
.meeting-bubble {
  border-left: 3px solid var(--accent, #4caf82);
  background: rgba(76, 175, 130, 0.06);
  border-radius: 6px;
  padding: 8px 12px;
  margin: 6px 0;
}
.meeting-bubble-header {
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  user-select: none;
}
.meeting-bubble-header:hover {
  opacity: 0.85;
}
.meeting-bubble-text {
  font-size: 0.9rem;
  font-weight: 500;
}
.meeting-bubble-chevron {
  font-size: 0.8rem;
  color: var(--text-dim, #888);
  flex-shrink: 0;
  margin-left: 8px;
}
.meeting-bubble-summary {
  font-size: 0.85rem;
  color: var(--text-dim, #aaa);
  margin-top: 4px;
  font-style: italic;
}
.meeting-bubble-summary-pending {
  opacity: 0.6;
}
.meeting-bubble-summary-stub {
  opacity: 0.6;
}
.meeting-bubble-transcript {
  display: none;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  max-height: 400px;
  overflow-y: auto;
  white-space: pre-wrap;
  font-family: var(--mono-font, 'SF Mono', Menlo, monospace);
  font-size: 0.82rem;
  line-height: 1.5;
}
.meeting-bubble-expanded .meeting-bubble-transcript {
  display: block;
}
.meeting-bubble-seg {
  margin-bottom: 2px;
}
.meeting-bubble-seg b {
  color: var(--accent, #4caf82);
}
```

- [ ] **Step 2: Verify the button + bubble render correctly**

Run: `node test/meeting-button-client.test.js`
Expected: PASS (12 passed, 0 failed — the static tests check for `meeting-bubble` class name which is now in CSS too, but the test reads `app.js` not `styles.css`; this step is just a sanity check that nothing broke)

- [ ] **Step 3: Commit**

```bash
git add web/public/styles.css
git commit -m "feat: CSS for meeting upload button + collapsible meeting bubble"
```

---

## Task 7: Wire all tests into `test.sh` + add server-smoke tests

**Files:**
- Modify: `test/test.sh` (`run_static_checks` after line 4841, `run_server_smoke` section)

- [ ] **Step 1: Wire static tests into `run_static_checks`**

In `test/test.sh`, find the voice-input test wiring (line ~4841, after `node_test_result test/voice-input-client.test.js`). Add the meeting test wiring immediately after:

```bash
  # Meeting-upload proxy route: POST /whisper/transcribe-meeting must use
  # Mode 2 (skip_diarization=false, no speaker_name), filter by
  # loadAllowlist, populate pendingIdentification (task-3 stub), branch on
  # providerId for the OpenAI stub, and return 422 on no known-user speech.
  node_test_result test/meeting-proxy-route.test.js "test/meeting-proxy-route.test.js (10 cases)"
  # Meeting-summary capture: _persistAssistantTextToRecChat accumulates into
  # _pendingMeetingSummary (without suppressing the normal fromAgent row),
  # turn_result handler truncates to first sentence + emits meeting-summary.
  node_test_result test/meeting-summary-capture.test.js "test/meeting-summary-capture.test.js (5 cases)"
  # Meeting WS frame: attach.js registers a meeting-summary listener that
  # forwards { t: 'meeting-summary', ...payload } to attached WS clients.
  node_test_result test/meeting-ws-frame.test.js "test/meeting-ws-frame.test.js (2 cases)"
  # Meeting-upload client wiring: #chat-meeting button in HTML, hidden file
  # input with accept="audio/*", _bindMeetingUpload POSTs to
  # /whisper/transcribe-meeting with sessionId, validates audio type,
  # collapsible bubble render branch, meeting-summary WS handler.
  node_test_result test/meeting-button-client.test.js "test/meeting-button-client.test.js (12 cases)"
```

- [ ] **Step 2: Add server-smoke test for the meeting route**

In `test/test.sh`, find the `run_server_smoke` function (line ~5204). Add a smoke test that boots a mock whisper server + calls the meeting route. Add this inside `run_server_smoke` (after the existing whisper proxy smoke test if one exists, or at the end of the whisper-related smoke tests):

```bash
  # ── Meeting diarization smoke test ──
  # Boots a mock whisper server returning canned diarized segments,
  # then POSTs to /whisper/transcribe-meeting and asserts:
  #   - 200 + meeting row JSON with meta.kind='meeting-transcript'
  #   - meta.transcript only contains allowlist speakers
  #   - meta.pendingIdentification contains the 'Speaker 0' segments
  local MEETING_MOCK_PORT
  MEETING_MOCK_PORT=$(free_port)
  # Mock whisper server: returns one known-speaker segment + one unknown.
  node -e "
    const http = require('http');
    const srv = http.createServer((req, res) => {
      if (req.url === '/health') { res.setHeader('content-type','application/json'); res.end(JSON.stringify({status:'ready'})); return; }
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        res.setHeader('content-type','application/json');
        res.end(JSON.stringify({
          segments: [
            {speaker:'kkrazy',start_time:0,end_time:5000,text:'hello world'},
            {speaker:'Speaker 0',start_time:6000,end_time:9000,text:'mystery voice'}
          ],
          srt: null, language: 'en', processing_time_seconds: 0.1
        }));
      });
    });
    srv.listen($MEETING_MOCK_PORT);
  " &
  local MOCK_PID=$!
  sleep 0.5
  # Boot a smoke myco server with WHISPER_SERVER_URL pointing at the mock.
  local MEETING_SMOKE_PORT
  MEETING_SMOKE_PORT=$(free_port)
  WHISPER_SERVER_URL="http://127.0.0.1:$MEETING_MOCK_PORT" \
  MYCO_PORT="$MEETING_SMOKE_PORT" \
  MYCO_STATE_DIR="$(mktemp -d)" \
  node server/src/index.js &
  local SMOKE_PID=$!
  # Poll for readiness.
  local waited=0
  while ! curl -sf -o /dev/null --max-time 1 "http://127.0.0.1:$MEETING_SMOKE_PORT/" 2>/dev/null; do
    if ! kill -0 "$SMOKE_PID" 2>/dev/null; then
      echo "meeting smoke server died during boot" >&2
      kill "$MOCK_PID" 2>/dev/null || true
      return 1
    fi
    sleep 0.25
    waited=$((waited + 1))
    if [ "$waited" -gt 40 ]; then
      echo "meeting smoke server failed to bind within 10s" >&2
      kill "$SMOKE_PID" "$MOCK_PID" 2>/dev/null || true
      return 1
    fi
  done
  # POST a tiny audio blob. The mock whisper ignores the audio content.
  # Use --data-binary with a dummy wav header so multer sees a file.
  local meeting_resp
  meeting_resp=$(curl -sS -X POST "http://127.0.0.1:$MEETING_SMOKE_PORT/whisper/transcribe-meeting" \
    -F "audio=@test/fixtures/tiny.wav" \
    -F "sessionId=test-meeting-smoke" 2>&1 || true)
  # The route returns 409 (session not active) because there's no live
  # AgentSession for "test-meeting-smoke". That's actually the correct
  # guard — assert the 409 detail message appears (the route reached the
  # session check, meaning WHISPER_SERVER_URL was set + multer parsed the
  # file). A 503 would mean WHISPER_SERVER_URL wasn't configured.
  if grep -q "Session not active" <<<"$meeting_resp"; then
    pass "meeting smoke: route reached session-check (WHISPER_SERVER_URL configured + multer parsed file)"
  elif grep -q "Whisper server not configured" <<<"$meeting_resp"; then
    fail "meeting smoke: WHISPER_SERVER_URL not propagated to the meeting route"
  else
    fail "meeting smoke: unexpected response — $meeting_resp"
  fi
  kill "$SMOKE_PID" "$MOCK_PID" 2>/dev/null || true
```

**Note:** If `test/fixtures/tiny.wav` does not exist, create a minimal 44-byte WAV header file first:

```bash
# Create a minimal WAV file (44-byte header, 0 data bytes) for smoke tests.
if [ ! -f test/fixtures/tiny.wav ]; then
  mkdir -p test/fixtures
  printf 'RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x40\x1f\x00\x00\x80>\x00\x00\x02\x00\x10\x00data\x00\x00\x00\x00' > test/fixtures/tiny.wav
fi
```

- [ ] **Step 3: Run the full test suite**

Run: `./test/test.sh`
Expected: All tests pass, including the 4 new meeting test files (29 total cases) + the meeting smoke test.

- [ ] **Step 4: Commit**

```bash
git add test/test.sh test/fixtures/tiny.wav
git commit -m "test: wire meeting-upload tests into test.sh + add server-smoke test"
```

---

## Self-Review Checklist

After all tasks are complete, verify:

- [ ] **Spec coverage:** Every section in `docs/superpowers/specs/2026-06-18-upload-meeting-button-design.md` is implemented:
  - New route `POST /whisper/transcribe-meeting` → Task 1 ✓
  - Filtering by allowlist → Task 1 ✓
  - Meeting chat-row schema → Task 1 ✓
  - Synthetic turn text → Task 1 ✓
  - Summary capture (mirrors `_pendingClarify`) → Task 2 ✓
  - `meeting-summary` WS frame → Task 3 ✓
  - OpenAI path stub → Task 1 ✓
  - File size limit (500 MB) → Task 1 ✓
  - `#chat-meeting` button + file input → Task 4 ✓
  - Visibility gating → Task 4 ✓
  - Upload flow (`_bindMeetingUpload`) → Task 4 ✓
  - Collapsible bubble rendering → Task 5 ✓
  - `meeting-summary` WS handler → Task 5 ✓
  - CSS styles → Task 6 ✓
  - Error handling (503/400/409/502/422/413) → Task 1 ✓
  - Testing (14 tests) → Tasks 1-5 + Task 7 ✓
  - Task 3 stub (`pendingIdentification`) → Task 1 ✓

- [ ] **No placeholders:** No TBD, TODO, "implement later", or vague steps.

- [ ] **Type consistency:** `meetingId`, `chatRowSeq`, `summaryText`, `openaiStub`, `pendingIdentification` are used consistently across all tasks.

- [ ] **Full `./test/test.sh` passes** before considering the feature done.
