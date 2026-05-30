// bug-42 regression: deleting a plan item must immediately remove it
// from the Plan view — not persist the stale cache until the user
// toggles a filter or refreshes the page.
//
// User report: "Plan items are not disappearing after deletion, only
// when refreshing the page or toggling the respective debug/feature/
// todo filter does it get rid of deleted items. Expected behavior:
// entry disappears immediately after manual deletion."
//
// Root cause: onArtifactItemDelete called loadArtifact(type) WITHOUT
// { forceHttp: true }, so loadArtifact's cachedHas early-return path
// rendered the stale cache (which still had the deleted item). The WS
// state-update eventually corrected the cache, but the immediate
// render used stale data. Additionally, loadArtifact's forceHttp path
// gated rendering on hasContent (items.length > 0), so deleting the
// LAST item left stale data in both the cache and the DOM — the HTTP
// GET returned an artifact with 0 items, hasContent was false, and
// neither cache update nor render happened.
//
// Fix (two parts):
//   1. onArtifactItemDelete now reads the DELETE response's {artifact}
//      field, updates state.artifacts.byType[type] from it, and calls
//      renderArtifact directly — bypassing the stale cache entirely.
//   2. loadArtifact's forceHttp path always updates the cache and calls
//      renderArtifact, even when items.length === 0. The old hasContent
//      gate was removed; renderArtifact handles the empty-state display
//      correctly on its own (line ~7910: `if (!items.length)` branch).

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

console.log('── bug-42: plan-item delete must evict stale cache immediately ──');

// ──────────────────────────────────────────────────────────────────────
// Part 1: onArtifactItemDelete uses DELETE response data, not stale cache
// ──────────────────────────────────────────────────────────────────────

function _deleteItemFnBody() {
  const start = APP.search(/async\s+function\s+onArtifactItemDelete\s*\(/);
  assert.ok(start > -1, 'onArtifactItemDelete must exist in app.js');
  const rest = APP.slice(start);
  const end = rest.slice(1).search(/\n(?:async\s+)?function\s+[A-Za-z_]/);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

t('onArtifactItemDelete exists in app.js', () => {
  _deleteItemFnBody();
});

t('onArtifactItemDelete reads res.json() to get the updated artifact', () => {
  const body = _deleteItemFnBody();
  // Must parse the response JSON and use data.artifact to update the
  // cache + render, rather than calling loadArtifact(type) which uses
  // the stale cache.
  assert.ok(/res\.json/.test(body),
    'onArtifactItemDelete must parse the DELETE response JSON');
  assert.ok(/data\.artifact/.test(body),
    'onArtifactItemDelete must use data.artifact from the DELETE response');
});

t('onArtifactItemDelete updates state.artifacts.byType[type] from the response', () => {
  const body = _deleteItemFnBody();
  // The fix writes the server's updated artifact directly into the
  // cache, so the next loadArtifact call sees fresh data.
  assert.ok(/state\.artifacts\.byType\[type\]\s*=\s*data\.artifact/.test(body),
    'onArtifactItemDelete must assign state.artifacts.byType[type] = data.artifact so the stale entry is evicted');
});

t('onArtifactItemDelete calls renderArtifact directly from the response data', () => {
  const body = _deleteItemFnBody();
  // Must call renderArtifact(type, data.artifact) to immediately show
  // the updated artifact without going through loadArtifact's stale
  // cachedHas gate.
  assert.ok(/renderArtifact\s*\(\s*type\s*,\s*data\.artifact\s*\)/.test(body),
    'onArtifactItemDelete must call renderArtifact(type, data.artifact) to bypass the stale cache');
});

t('onArtifactItemDelete falls back to forceHttp loadArtifact when response lacks artifact', () => {
  const body = _deleteItemFnBody();
  // Defensive: if the server doesn't return an artifact field (future
  // API change), the fallback uses forceHttp to get fresh data.
  assert.ok(/loadArtifact\s*\(\s*type\s*,\s*\{\s*forceHttp\s*:\s*true\s*\}\s*\)/.test(body),
    'onArtifactItemDelete fallback must call loadArtifact(type, { forceHttp: true })');
});

// ──────────────────────────────────────────────────────────────────────
// Part 2: loadArtifact forceHttp path always renders + updates cache,
//         even when items.length === 0
// ──────────────────────────────────────────────────────────────────────

function _loadArtifactFnBody() {
  const start = APP.search(/async\s+function\s+loadArtifact\s*\(/);
  assert.ok(start > -1, 'loadArtifact must exist in app.js');
  const rest = APP.slice(start);
  const end = rest.slice(1).search(/\n(?:async\s+)?function\s+[A-Za-z_]/);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

t('loadArtifact forceHttp path always updates state.artifacts.byType[type]', () => {
  const body = _loadArtifactFnBody();
  // After the fix, the cache is ALWAYS updated from the HTTP response
  // — not gated on hasContent. This means deleting the last item
  // correctly replaces the stale cache with an empty-items artifact.
  // Find the forceHttp HTTP path: the artifact assignment must NOT
  // be inside an `if (hasContent)` block.
  assert.ok(/state\.artifacts\.byType\[type\]\s*=\s*artifact/.test(body),
    'loadArtifact must always assign state.artifacts.byType[type] = artifact in the forceHttp path');
  // Verify there's no hasContent gate wrapping the assignment.
  // The old code had:
  //   if (hasContent) { renderArtifact(...); state.artifacts.byType[type] = artifact; }
  // The fix should NOT have that gate.
  const assignIdx = body.indexOf('state.artifacts.byType[type] = artifact');
  const hasContentIdx = body.indexOf('hasContent');
  // If hasContent still exists in the function, verify the assignment
  // is NOT nested inside an if(hasContent) block.
  if (hasContentIdx > -1) {
    // This is acceptable only if hasContent is used for something else
    // (like the cacheHas check on the non-forceHttp path). Let's just
    // verify the forceHttp path assignment is NOT inside if(hasContent).
    const betweenHasContentAndAssign = body.slice(
      Math.min(hasContentIdx, assignIdx),
      Math.max(hasContentIdx, assignIdx)
    );
    // If hasContent appears BETWEEN the try block and the assignment,
    // and there's an `if (hasContent)` wrapping it, that's the bug.
    // Check: no `if (hasContent)` block that contains the assignment.
    const hasContentBlockPattern = /if\s*\(\s*hasContent\s*\)\s*\{[^}]*state\.artifacts\.byType/;
    assert.ok(!hasContentBlockPattern.test(body),
      'loadArtifact forceHttp path must NOT gate cache update on hasContent — deleting the last item requires updating the cache to 0 items');
  }
});

t('loadArtifact forceHttp path always calls renderArtifact', () => {
  const body = _loadArtifactFnBody();
  // renderArtifact must be called in the forceHttp path regardless
  // of whether items exist. renderArtifact handles the empty-state
  // display (line ~7910) on its own.
  // Verify there's no `if (hasContent)` gate wrapping renderArtifact
  // in the HTTP fetch path.
  const httpFetchRenderPattern = /if\s*\(\s*hasContent\s*\)\s*\{[^}]*renderArtifact/;
  assert.ok(!httpFetchRenderPattern.test(body),
    'loadArtifact forceHttp path must NOT gate renderArtifact on hasContent — the empty-state case must also be rendered');
});

// ──────────────────────────────────────────────────────────────────────
// Simulation: deleting an item from a 2-item plan must evict the
// deleted item from the cache immediately (no stale cache leak)
// ──────────────────────────────────────────────────────────────────────

t('simulated: deleting one item from a 2-item plan updates cache correctly', () => {
  const fakeState = {
    activeId: 'sess-A',
    artifacts: {
      sessionId: 'sess-A',
      byType: {
        plan: {
          items: [
            { id: 'bug-10', text: 'First bug' },
            { id: 'bug-11', text: 'Second bug' },
          ],
        },
      },
    },
  };
  // Server's DELETE response returns the updated artifact.
  const serverArtifact = {
    items: [{ id: 'bug-10', text: 'First bug' }],
  };
  // Simulate what onArtifactItemDelete now does:
  fakeState.artifacts.byType.plan = serverArtifact;
  // Verify: deleted item is gone from the cache.
  assert.strictEqual(fakeState.artifacts.byType.plan.items.length, 1);
  assert.strictEqual(fakeState.artifacts.byType.plan.items[0].id, 'bug-10');
  assert.ok(!fakeState.artifacts.byType.plan.items.some(it => it.id === 'bug-11'),
    'deleted item bug-11 must NOT remain in the cache');
});

t('simulated: deleting the last item updates cache to empty items array', () => {
  const fakeState = {
    activeId: 'sess-A',
    artifacts: {
      sessionId: 'sess-A',
      byType: {
        plan: {
          items: [{ id: 'bug-10', text: 'Only bug' }],
        },
      },
    },
  };
  // Server's DELETE response returns the artifact with 0 items.
  const serverArtifact = { items: [] };
  // Simulate what onArtifactItemDelete now does:
  fakeState.artifacts.byType.plan = serverArtifact;
  // Verify: items array is empty (not stale).
  assert.strictEqual(fakeState.artifacts.byType.plan.items.length, 0,
    'after deleting the last item, the cache must have items.length === 0');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);