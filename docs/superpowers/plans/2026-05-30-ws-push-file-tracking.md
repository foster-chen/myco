# WS Push File-Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 5s HTTP polling for artifacts and file-tree with WS push (instant updates) + a 30s backfill poll for file-tree (insurance for external changes).

**Architecture:** Server emits `state-update { kind: 'file-tree-change', path }` on agent `tool_result` events for file-writing tools. Client handles the new WS frame by reloading the file tree. Artifact polling is removed entirely because WS `state-update { kind: 'artifact' }` already covers all mutation paths. File-tree backfill poll reduced from 5s to 30s.

**Tech Stack:** Node.js server (Express + WS), vanilla JS client, existing `session.emit('state-update')` plumbing.

---

### Task 1: Server — add file-tree-change emit on tool_result

**Files:**
- Modify: `server/src/agent-session.js:783-793` (opencode tool_result path)
- Modify: `server/src/agent-session.js:973-1005` (Anthropic tool_result path)

The agent session already sees every `tool_use` / `tool_result` event. We need to emit a `state-update { kind: 'file-tree-change' }` when a file-writing tool completes. The challenge: for the Anthropic path, `openToolCalls` stores `{ name, summary, ts }` but NOT `input` — we need the full `input` to extract `file_path`. Solution: store `input` in `openToolCalls` for both paths.

- [ ] **Step 1: Write the failing test**

Create `test/ws-push-file-tree.test.js`:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (err) { console.log('  ✗ ' + name + ' — ' + (err && err.stack ? err.stack : err)); failed++; }
}

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'server', 'src', 'agent-session.js'), 'utf8');

console.log('── WS push: file-tree-change on tool_result ──');

t('agent-session.js: FILE_WRITING_TOOL_NAMES set exists', () => {
  assert.ok(/FILE_WRITING_TOOL_NAMES/.test(SRC),
    'FILE_WRITING_TOOL_NAMES must be defined');
  assert.ok(/Write/.test(SRC.match(/FILE_WRITING_TOOL_NAMES[\s\S]{0,200}/)[0]),
    'must include Write');
  assert.ok(/Edit/.test(SRC.match(/FILE_WRITING_TOOL_NAMES[\s\S]{0,200}/)[0]),
    'must include Edit');
  assert.ok(/MultiEdit/.test(SRC.match(/FILE_WRITING_TOOL_NAMES[\s\S]{0,200}/)[0]),
    'must include MultiEdit');
});

t('agent-session.js: emits file-tree-change state-update', () => {
  assert.ok(/state-update.*file-tree-change/.test(SRC) || /file-tree-change.*state-update/.test(SRC),
    'must emit state-update with kind file-tree-change');
});

t('agent-session.js: Bash emits path:null', () => {
  const idx = SRC.search(/file-tree-change/);
  assert.ok(idx > -1, 'file-tree-change emit must exist');
  const win = SRC.slice(idx - 200, idx + 400);
  assert.ok(/path\s*:\s*null/.test(win),
    'Bash tool must emit path:null (generic recheck signal)');
});

t('agent-session.js: file-writing tools emit path from input', () => {
  const idx = SRC.search(/file-tree-change/);
  const win = SRC.slice(idx - 200, idx + 400);
  assert.ok(/input\.file_path/.test(win) || /file_path/.test(win),
    'Write/Edit/MultiEdit must emit path from input.file_path');
});

t('agent-session.js: skips emit on error tool_result', () => {
  const idx = SRC.search(/file-tree-change/);
  const win = SRC.slice(idx - 400, idx + 400);
  assert.ok(/is_error|isError/.test(win),
    'must check is_error/isError and skip emit on failed tool calls');
});

t('agent-session.js: openToolCalls stores input for Anthropic path', () => {
  const idx = SRC.search(/openToolCalls\.set\(block\.id/);
  if (idx === -1) {
    const idx2 = SRC.search(/openToolCalls\.set/);
    const win = SRC.slice(idx2, idx2 + 300);
    assert.ok(/input/.test(win),
      'openToolCalls.set must include input field');
  } else {
    const win = SRC.slice(idx, idx + 300);
    assert.ok(/input/.test(win),
      'openToolCalls.set for Anthropic path must include input field');
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/ws-push-file-tree.test.js`
Expected: FAIL — `FILE_WRITING_TOOL_NAMES` is not yet defined, `file-tree-change` emit doesn't exist.

- [ ] **Step 3: Add FILE_WRITING_TOOL_NAMES constant**

In `server/src/agent-session.js`, add after line 143 (after `_matchingInputFor`):

```js
const FILE_WRITING_TOOL_NAMES = ['Write', 'Edit', 'MultiEdit'];
```

- [ ] **Step 4: Store input in openToolCalls for Anthropic path**

In `server/src/agent-session.js` line 974-978, the Anthropic `tool_use` handler currently stores `{ name, summary, ts }`. Add `input`:

```js
this.openToolCalls.set(block.id, {
  name: block.name,
  input: block.input,
  summary: _summariseToolInput(block.name, block.input),
  ts: new Date().toISOString(),
});
```

- [ ] **Step 5: Add file-tree-change emit to opencode tool_result path**

In `server/src/agent-session.js` lines 787-793 (the opencode `tool_result` handler), add after the existing `this.openToolCalls.delete(event.id)` and `this._emit(...)`. The `event.name` is available directly in the opencode path:

```js
case 'tool_result':
  this._flushOCTextBuffer();
  this._flushOCReasoningBuffer();
  this.openToolCalls.delete(event.id);
  this._emit({ type: 'tool_result', id: event.id, name: event.name, result: event.result });
  if (FILE_WRITING_TOOL_NAMES.includes(event.name) && !event.is_error) {
    this.emit('state-update', { kind: 'file-tree-change', path: (event.input && event.input.file_path) || null });
  }
  if (event.name === 'Bash' && !event.is_error) {
    this.emit('state-update', { kind: 'file-tree-change', path: null });
  }
  this._broadcastToolProgress();
  break;
```

- [ ] **Step 6: Add file-tree-change emit to Anthropic tool_result path**

In `server/src/agent-session.js` lines 990-1006 (the Anthropic `tool_result` handler), the tool info is in `openToolCalls` — but `openToolCalls.delete` at line 993 removes it before we can read `name` and `input`. We must read the info BEFORE the delete, then emit after:

```js
if (m.type === 'user' && m.message && Array.isArray(m.message.content)) {
  for (const block of m.message.content) {
    if (block.type === 'tool_result') {
      const toolInfo = this.openToolCalls.get(block.tool_use_id);
      this.openToolCalls.delete(block.tool_use_id);
      const content = typeof block.content === 'string'
        ? block.content
        : (Array.isArray(block.content)
          ? block.content.map((c) => c.text || '').join('')
          : '');
      this._emit({
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content,
        isError: !!block.is_error,
      });
      if (toolInfo && !block.is_error) {
        if (FILE_WRITING_TOOL_NAMES.includes(toolInfo.name)) {
          this.emit('state-update', { kind: 'file-tree-change', path: (toolInfo.input && toolInfo.input.file_path) || null });
        }
        if (toolInfo.name === 'Bash') {
          this.emit('state-update', { kind: 'file-tree-change', path: null });
        }
      }
      this._broadcastToolProgress();
    }
  }
  return;
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `node test/ws-push-file-tree.test.js`
Expected: PASS — all 6 assertions green.

- [ ] **Step 8: Commit**

```bash
git add server/src/agent-session.js test/ws-push-file-tree.test.js
git commit -m "feat: emit file-tree-change state-update on agent tool_result for file-writing tools"
```

---

### Task 2: Client — add file-tree-change WS handler + remove artifact polling + reduce backfill

**Files:**
- Modify: `web/public/app.js:7645-7680` (remove artifact auto-refresh block)
- Modify: `web/public/app.js:7529-7532` (remove `_startArtifactAutoRefresh` call in `showArtifactView`)
- Modify: `web/public/app.js:7558-7559` (remove `_stopArtifactAutoRefresh` call in `hideArtifactView`)
- Modify: `web/public/app.js:7610-7642` (remove `forceHttp` from `loadArtifact`)
- Modify: `web/public/app.js:1235-1237` (remove `_stopArtifactAutoRefresh` from `_resetUiForNewSession`)
- Modify: `web/public/app.js:9014-9015` (remove `_stopArtifactAutoRefresh` from `showFilesView`)
- Modify: `web/public/app.js:6406-6444` (add `file-tree-change` handler in `_applyStateUpdate`)
- Modify: `web/public/app.js:7667` (change `FILE_TREE_AUTO_REFRESH_MS` from 5000 to 30000)

- [ ] **Step 1: Write the failing test — update artifact-file-tree-autorefresh.test.js**

Rewrite `test/artifact-file-tree-autorefresh.test.js` to reflect the new design:

```js
// WS push + backfill poll: file-tree changes are pushed via WS
// state-update { kind: 'file-tree-change' } on agent tool_result
// events for file-writing tools (Write/Edit/MultiEdit/Bash). Artifact
// changes are already covered by WS state-update { kind: 'artifact' }
// so no polling is needed. A 30s backfill poll for the file tree
// catches external changes the server can't observe.
//
// Static-shape guards on the contract:
//   • _startFileTreeAutoRefresh / _stopFileTreeAutoRefresh exist.
//   • Interval cadence is 30s (insurance backfill).
//   • document.hidden skip in the poll loop.
//   • showFilesView starts file-tree polling.
//   • hideFilesView stops file-tree polling.
//   • Session switch stops the poller.
//   • No artifact auto-refresh functions exist (WS push covers it).
//   • loadArtifact does NOT accept forceHttp (removed).
//   • _applyStateUpdate handles file-tree-change WS frame.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (err) { console.log('  ✗ ' + name + ' — ' + (err && err.stack ? err.stack : err)); failed++; }
}

const APP = fs.readFileSync(
  path.join(__dirname, '..', 'web', 'public', 'app.js'), 'utf8');

console.log('── WS push file-tracking: client-side ──');

t('app.js: NO _startArtifactAutoRefresh (removed)', () => {
  assert.ok(!/function\s+_startArtifactAutoRefresh\s*\(/.test(APP),
    '_startArtifactAutoRefresh must be removed (WS push covers artifacts)');
});

t('app.js: NO _stopArtifactAutoRefresh (removed)', () => {
  assert.ok(!/function\s+_stopArtifactAutoRefresh\s*\(/.test(APP),
    '_stopArtifactAutoRefresh must be removed');
});

t('app.js: NO ARTIFACT_AUTO_REFRESH_MS (removed)', () => {
  assert.ok(!/ARTIFACT_AUTO_REFRESH_MS/.test(APP),
    'ARTIFACT_AUTO_REFRESH_MS must be removed');
});

t('app.js: _startFileTreeAutoRefresh + _stopFileTreeAutoRefresh defined', () => {
  assert.ok(/function\s+_startFileTreeAutoRefresh\s*\(/.test(APP),
    'start helper must be defined');
  assert.ok(/function\s+_stopFileTreeAutoRefresh\s*\(/.test(APP),
    'stop helper must be defined');
});

t('app.js: file-tree backfill cadence is 30s (FILE_TREE_AUTO_REFRESH_MS)', () => {
  assert.ok(/FILE_TREE_AUTO_REFRESH_MS\s*=\s*30000/.test(APP),
    'FILE_TREE_AUTO_REFRESH_MS must be 30000 ms (backfill insurance)');
});

t('app.js: file-tree poll skips when document.hidden', () => {
  const idx = APP.search(/function\s+_startFileTreeAutoRefresh\s*\(/);
  const win = APP.slice(idx, idx + 1500);
  assert.ok(/document\.hidden/.test(win),
    'poll tick must short-circuit when document.hidden');
  assert.ok(/state\.files[\s\S]{0,100}visible/.test(win),
    'poll tick must verify files view is still visible');
});

t('app.js: file-tree stop handler is idempotent + clears handle', () => {
  const idx = APP.search(/function\s+_stopFileTreeAutoRefresh\s*\(/);
  const win = APP.slice(idx, idx + 500);
  assert.ok(/if\s*\(\s*!_fileTreeAutoRefreshHandle\s*\)\s*return/.test(win),
    'stop must early-return when handle is already null');
  assert.ok(/clearInterval/.test(win),
    'stop must clearInterval');
  assert.ok(/_fileTreeAutoRefreshHandle\s*=\s*null/.test(win),
    'stop must null the handle');
});

t('app.js: showFilesView starts file-tree polling (NO artifact reference)', () => {
  const idx = APP.search(/function\s+showFilesView\s*\(/);
  const win = APP.slice(idx, idx + 1500);
  assert.ok(/_startFileTreeAutoRefresh\(/.test(win),
    'showFilesView must start file-tree auto-refresh');
  assert.ok(!/_startArtifactAutoRefresh\(/.test(win),
    'showFilesView must NOT reference artifact auto-refresh (removed)');
  assert.ok(!/_stopArtifactAutoRefresh\(/.test(win),
    'showFilesView must NOT reference artifact auto-refresh (removed)');
});

t('app.js: hideFilesView stops file-tree polling', () => {
  const idx = APP.search(/function\s+hideFilesView\s*\(/);
  const win = APP.slice(idx, idx + 1500);
  assert.ok(/_stopFileTreeAutoRefresh\(/.test(win),
    'hideFilesView must stop file-tree auto-refresh');
});

t('app.js: showArtifactView does NOT call artifact auto-refresh (removed)', () => {
  const idx = APP.search(/function\s+showArtifactView\s*\(/);
  const win = APP.slice(idx, idx + 3500);
  assert.ok(!/_startArtifactAutoRefresh\(/.test(win),
    'showArtifactView must NOT start artifact auto-refresh (removed)');
});

t('app.js: hideArtifactView does NOT call artifact auto-refresh (removed)', () => {
  const idx = APP.search(/function\s+hideArtifactView\s*\(/);
  const win = APP.slice(idx, idx + 1500);
  assert.ok(!/_stopArtifactAutoRefresh\(/.test(win),
    'hideArtifactView must NOT stop artifact auto-refresh (removed)');
});

t('app.js: _resetUiForNewSession stops file-tree poller (NO artifact reference)', () => {
  const idx = APP.search(/function\s+_resetUiForNewSession\s*\(/);
  const win = APP.slice(idx, idx + 1500);
  assert.ok(/_stopFileTreeAutoRefresh\(/.test(win),
    '_resetUiForNewSession must stop file-tree auto-refresh');
  assert.ok(!/_stopArtifactAutoRefresh\(/.test(win),
    '_resetUiForNewSession must NOT reference artifact auto-refresh (removed)');
});

t('app.js: loadArtifact does NOT accept forceHttp option', () => {
  assert.ok(!/forceHttp/.test(APP),
    'loadArtifact must NOT have a forceHttp option (removed)');
});

t('app.js: _applyStateUpdate handles file-tree-change', () => {
  const idx = APP.search(/function\s+_applyStateUpdate\s*\(/);
  const win = APP.slice(idx, idx + 3000);
  assert.ok(/file-tree-change/.test(win),
    '_applyStateUpdate must handle kind === file-tree-change');
  assert.ok(/loadFileTree/.test(win),
    'file-tree-change handler must call loadFileTree');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/artifact-file-tree-autorefresh.test.js`
Expected: FAIL — artifact auto-refresh functions still exist, `forceHttp` still present, `FILE_TREE_AUTO_REFRESH_MS` is 5000, `file-tree-change` handler not yet in `_applyStateUpdate`.

- [ ] **Step 3: Remove artifact auto-refresh functions from app.js**

Remove the entire block at `web/public/app.js` lines 7645-7662 (the `_startArtifactAutoRefresh`, `_stopArtifactAutoRefresh`, `_artifactAutoRefreshHandle`, `ARTIFACT_AUTO_REFRESH_MS` definitions). Delete:

```js
// Auto-refresh: polls the active artifact view every 5 seconds so
// TODOs/Bugs/Features stay current without a manual page refresh.
let _artifactAutoRefreshHandle = null;
const ARTIFACT_AUTO_REFRESH_MS = 5000;
function _startArtifactAutoRefresh() {
  if (_artifactAutoRefreshHandle) return;
  _artifactAutoRefreshHandle = setInterval(() => {
    if (document.hidden) return;
    const active = state.artifactView && state.artifactView.active;
    if (!active || !state.activeId) return;
    loadArtifact(active, { forceHttp: true }).catch(() => {});
  }, ARTIFACT_AUTO_REFRESH_MS);
}
function _stopArtifactAutoRefresh() {
  if (!_artifactAutoRefreshHandle) return;
  clearInterval(_artifactAutoRefreshHandle);
  _artifactAutoRefreshHandle = null;
}
```

- [ ] **Step 4: Remove forceHttp from loadArtifact**

In `web/public/app.js` line ~7598, change the `loadArtifact` signature back to:

```js
async function loadArtifact(type) {
```

Remove the `{ forceHttp } = {}` destructuring. At line ~7621, restore the original cache-first logic by removing the `forceHttp` bypass:

Change `if (!forceHttp && cachedHas)` back to `if (cachedHas)`.

Remove the comment block about `forceHttp` at lines 7598-7610 (the "When forceHttp is set..." comment). Restore the original comment:

```js
  // Prefer the cache populated by the artifacts-init / state-update WS
  // frames — that's the freshest authoritative state. Tab switches are
  // instant + always in sync without an HTTP round-trip.
```

- [ ] **Step 5: Remove artifact auto-refresh call sites**

Remove `_startArtifactAutoRefresh()` call from `showArtifactView` (line 7531). Remove the comment on lines 7529-7530.

Remove `_stopFileTreeAutoRefresh()` call from `showArtifactView` (line 7532) — file-tree polling is only relevant when files view is visible, not artifact view. The mutual exclusion is no longer needed since artifact has no polling.

Remove `_stopArtifactAutoRefresh()` call from `hideArtifactView` (line 7559). Remove the comment on line 7558.

Remove `_stopArtifactAutoRefresh()` call from `_resetUiForNewSession` (line 1236). Keep `_stopFileTreeAutoRefresh()` (line 1237). Update the comment at line 1235 to:

```js
  // Auto-refresh: stop file-tree backfill from the previous session.
```

Remove `_stopArtifactAutoRefresh()` call from `showFilesView` (line 9015). Keep `_startFileTreeAutoRefresh()` (line 9014). Update the comment at lines 9012-9013 to:

```js
  // Auto-refresh: start 30s backfill poll so external changes are caught.
```

- [ ] **Step 6: Change FILE_TREE_AUTO_REFRESH_MS to 30000**

In `web/public/app.js` line 7667, change:

```js
const FILE_TREE_AUTO_REFRESH_MS = 5000;
```

to:

```js
const FILE_TREE_AUTO_REFRESH_MS = 30000;
```

Update the comment at line 7664-7665:

```js
// Auto-refresh: 30s backfill poll for the file tree so external changes
// (git ops outside the agent, manual edits, CI) are caught. Agent-driven
// changes are pushed instantly via WS state-update { kind: 'file-tree-change' }.
```

- [ ] **Step 7: Add file-tree-change handler to _applyStateUpdate**

In `web/public/app.js` function `_applyStateUpdate` (line ~6406), add a new `kind` handler after the `runQueue` handler (after line ~6444):

```js
  if (msg.kind === 'file-tree-change') {
    if (state.files.visible && state.activeId) {
      loadFileTree(state.files.currentPath || '.');
    }
    return;
  }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `node test/artifact-file-tree-autorefresh.test.js`
Expected: PASS — all 14 assertions green.

- [ ] **Step 9: Commit**

```bash
git add web/public/app.js test/artifact-file-tree-autorefresh.test.js
git commit -m "feat: replace artifact polling with WS push, add file-tree-change WS handler, reduce backfill to 30s"
```

---

### Task 3: Update test.sh grep guards

**Files:**
- Modify: `test/test.sh:2975-2989`

- [ ] **Step 1: Write the failing test — add a grep guard assertion**

Add a step in `test/test.sh` that checks for the `file-tree-change` handler in `app.js`. This is a grep guard, not a separate test file, so the "failing test" step is adding the guard to test.sh and verifying the existing test.sh still passes after the code changes from Task 2.

First, read the current test.sh section at lines 2975-2989.

- [ ] **Step 2: Remove artifact auto-refresh grep guards and update file-tree guards**

In `test/test.sh` lines 2975-2989, replace the entire block. Remove the `node_test_result` for the old autorefresh test (it still runs but the test file itself was rewritten in Task 2 — the `node_test_result` line stays). Remove the `_startArtifactAutoRefresh` and `_stopArtifactAutoRefresh` grep guards. Update the description comments. Add grep guards for `file-tree-change` and `FILE_WRITING_TOOL_NAMES`:

Replace lines 2975-2989 with:

```bash
  # WS push: artifacts are covered by state-update WS frames (no polling).
  # File-tree changes are pushed via WS state-update { kind: 'file-tree-change' }
  # on agent tool_result for file-writing tools, with a 30s backfill poll
  # for external changes.
  node_test_result test/artifact-file-tree-autorefresh.test.js "test/artifact-file-tree-autorefresh.test.js (14 cases)"
  node_test_result test/ws-push-file-tree.test.js "test/ws-push-file-tree.test.js (6 cases)"
  grep -qF '_startFileTreeAutoRefresh()' web/public/app.js \
    && pass "app.js: showFilesView calls _startFileTreeAutoRefresh" \
    || fail "app.js: showFilesView missing _startFileTreeAutoRefresh"
  grep -qF '_stopFileTreeAutoRefresh()' web/public/app.js \
    && pass "app.js: hideFilesView calls _stopFileTreeAutoRefresh" \
    || fail "app.js: hideFilesView missing _stopFileTreeAutoRefresh"
  grep -qF 'file-tree-change' web/public/app.js \
    && pass "app.js: _applyStateUpdate handles file-tree-change" \
    || fail "app.js: _applyStateUpdate missing file-tree-change handler"
  grep -qF 'FILE_WRITING_TOOL_NAMES' server/src/agent-session.js \
    && pass "agent-session.js: FILE_WRITING_TOOL_NAMES defined" \
    || fail "agent-session.js: missing FILE_WRITING_TOOL_NAMES"
```

- [ ] **Step 3: Run the full test suite**

Run: `./test/test.sh`
Expected: PASS — all tests green, no failures in the new grep guards or the existing suite.

- [ ] **Step 4: Commit**

```bash
git add test/test.sh
git commit -m "test: update grep guards for WS push file-tracking (remove artifact polling guards, add file-tree-change + FILE_WRITING_TOOL_NAMES)"
```

---

### Task 4: Verify full test suite passes

- [ ] **Step 1: Run the complete test suite**

Run: `./test/test.sh`
Expected: ALL tests green — no failures, no warnings in the new assertions.

- [ ] **Step 2: Verify server-side WS push works in a smoke test**

Start a local myco server and attach via browser. Run an agent session that calls `Write` or `Edit`. Verify the files view updates instantly (within 1s) when the tool completes, without waiting for a 30s backfill poll. Verify artifact views (plan/test) update instantly on UI mutations (delete, vote) without any polling.

This is a manual verification step — no automated test for this. The static-shape tests in Tasks 1-3 cover the structural contract; the smoke test confirms the runtime behavior.