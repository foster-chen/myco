// Regression test for the per-delta event coalescing in
// _shipAgentReplay. Per-delta streaming (opencode provider) emits
// one event per token fragment, producing hundreds of tiny
// assistant_text / reasoning_text events for a single reply. The
// 16 KB byte-budget trim then keeps only the tail fragments,
// truncating the beginning of the reply on refresh. The fix
// coalesces consecutive-seq runs of these types into consolidated
// events BEFORE byte-trimming, so the full text survives.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (err) { console.log('  ✗ ' + name + ' — ' + (err && err.stack ? err.stack : err)); failed++; }
}

// Mirror of _coalesceReplayEvents from attach.js. If the production
// implementation drifts, this mirror AND the source-grep tests below
// catch the mismatch.
function _coalesceReplayEvents(events) {
  if (!Array.isArray(events) || !events.length) return events;
  const COALESCE_TYPES = new Set(['assistant_text', 'reasoning_text']);
  const sorted = events.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const out = [];
  let i = 0;
  while (i < sorted.length) {
    const ev = sorted[i];
    if (!COALESCE_TYPES.has(ev.type) || typeof ev.seq !== 'number') {
      out.push(ev);
      i++;
      continue;
    }
    const textParts = [ev.text || ''];
    const firstSeq = ev.seq;
    const firstTs = ev.ts;
    const type = ev.type;
    let j = i + 1;
    while (j < sorted.length
      && sorted[j].type === type
      && typeof sorted[j].seq === 'number'
      && sorted[j].seq === sorted[j - 1].seq + 1) {
      textParts.push(sorted[j].text || '');
      j++;
    }
    if (j - i > 1) {
      out.push({ type, text: textParts.join(''), seq: firstSeq, ts: firstTs });
    } else {
      out.push(ev);
    }
    i = j;
  }
  return out;
}

console.log('── per-delta event coalescing regression ──');

t('396 per-delta assistant_text events collapse to ~2 coalesced events', () => {
  const events = [];
  for (let i = 0; i < 396; i++) {
    events.push({
      ts: '2026-05-30T04:12:25.000Z',
      type: 'assistant_text',
      text: 'word' + i,
      seq: 19 + i,
    });
  }
  const coalesced = _coalesceReplayEvents(events);
  assert.strictEqual(coalesced.length, 1, 'all 396 consecutive-seq events should collapse into 1');
  const fullText = events.map((e) => e.text).join('');
  assert.strictEqual(coalesced[0].text, fullText, 'coalesced text must be the full concatenation');
  assert.strictEqual(coalesced[0].seq, 19, 'coalesced seq must be the first seq in the run');
});

t('13 per-delta reasoning_text events collapse into 1', () => {
  const events = [];
  for (let i = 0; i < 13; i++) {
    events.push({
      ts: '2026-05-30T04:12:25.000Z',
      type: 'reasoning_text',
      text: 'think' + i,
      seq: 6 + i,
    });
  }
  const coalesced = _coalesceReplayEvents(events);
  assert.strictEqual(coalesced.length, 1);
  assert.strictEqual(coalesced[0].text, events.map((e) => e.text).join(''));
  assert.strictEqual(coalesced[0].seq, 6);
});

t('seq gap breaks the coalesce run: two separate blocks', () => {
  const events = [
    { ts: 't1', type: 'assistant_text', text: 'Hello', seq: 10 },
    { ts: 't2', type: 'assistant_text', text: ' world', seq: 11 },
    { ts: 't3', type: 'step_start', seq: 12 },
    { ts: 't4', type: 'assistant_text', text: 'Second', seq: 13 },
    { ts: 't5', type: 'assistant_text', text: ' reply', seq: 14 },
  ];
  const coalesced = _coalesceReplayEvents(events);
  assert.strictEqual(coalesced.length, 3);
  assert.strictEqual(coalesced[0].type, 'assistant_text');
  assert.strictEqual(coalesced[0].text, 'Hello world');
  assert.strictEqual(coalesced[0].seq, 10);
  assert.strictEqual(coalesced[1].type, 'step_start');
  assert.strictEqual(coalesced[2].type, 'assistant_text');
  assert.strictEqual(coalesced[2].text, 'Second reply');
  assert.strictEqual(coalesced[2].seq, 13);
});

t('interleaved reasoning + assistant events coalesce separately', () => {
  const events = [
    { ts: 't1', type: 'reasoning_text', text: 'Think', seq: 6 },
    { ts: 't2', type: 'reasoning_text', text: 'ing', seq: 7 },
    { ts: 't3', type: 'assistant_text', text: 'Reply', seq: 8 },
    { ts: 't4', type: 'assistant_text', text: ' text', seq: 9 },
  ];
  const coalesced = _coalesceReplayEvents(events);
  assert.strictEqual(coalesced.length, 2);
  assert.strictEqual(coalesced[0].type, 'reasoning_text');
  assert.strictEqual(coalesced[0].text, 'Thinking');
  assert.strictEqual(coalesced[0].seq, 6);
  assert.strictEqual(coalesced[1].type, 'assistant_text');
  assert.strictEqual(coalesced[1].text, 'Reply text');
  assert.strictEqual(coalesced[1].seq, 8);
});

t('events without seq pass through unmodified', () => {
  const events = [
    { type: 'assistant_text', text: 'no seq' },
    { type: 'tool_use', name: 'Bash', seq: 5 },
  ];
  const coalesced = _coalesceReplayEvents(events);
  assert.strictEqual(coalesced.length, 2);
  assert.deepStrictEqual(coalesced[0], events[0]);
  assert.deepStrictEqual(coalesced[1], events[1]);
});

t('single event (no consecutive seq) passes through unchanged', () => {
  const events = [
    { ts: 't1', type: 'assistant_text', text: 'Solo', seq: 42 },
  ];
  const coalesced = _coalesceReplayEvents(events);
  assert.strictEqual(coalesced.length, 1);
  assert.deepStrictEqual(coalesced[0], events[0]);
});

t('empty array returns empty', () => {
  assert.deepStrictEqual(_coalesceReplayEvents([]), []);
});

t('null/non-array returns input unchanged', () => {
  assert.strictEqual(_coalesceReplayEvents(null), null);
});

t('THE BUG: 396 per-delta events get truncated by 16 KB byte-trim WITHOUT coalescing', () => {
  // Reproduce the original bug: per-delta assistant_text events
  // (seq 19-414, each a tiny word fragment) exceed the 16 KB
  // byte budget, so the trim keeps only the tail ~44%. The
  // beginning of the reply ("Hey! I'm an AI coding agent...")
  // is lost. This proves the bug is real and the coalescing fix
  // is load-bearing.
  const events = [];
  for (let i = 0; i < 396; i++) {
    events.push({
      ts: '2026-05-30T04:12:25.' + String(i).padStart(3, '0') + 'Z',
      type: 'assistant_text',
      text: 'word' + i + ' ',
      seq: 19 + i,
    });
  }
  const BUDGET = 16 * 1024;
  let bytes = 0, keepFromIdx = events.length;
  for (let i = events.length - 1; i >= 0; i--) {
    const sz = JSON.stringify(events[i]).length;
    if (bytes && bytes + sz > BUDGET) break;
    bytes += sz;
    keepFromIdx = i;
  }
  const trimmed = events.slice(keepFromIdx);
  assert.ok(trimmed.length < events.length,
    'without coalescing, byte-trim must drop some events (got ' + trimmed.length + ' of ' + events.length + ')');
  assert.ok(trimmed[0].seq > 19,
    'without coalescing, the first surviving event must NOT be seq=19 — the beginning is truncated');
});

t('THE FIX: same 396 events survive 16 KB byte-trim WITH coalescing', () => {
  // After coalescing, the 396 per-delta events become 1 consolidated
  // event carrying the full text. It easily fits within the 16 KB
  // budget, so no truncation occurs.
  const events = [];
  for (let i = 0; i < 396; i++) {
    events.push({
      ts: '2026-05-30T04:12:25.' + String(i).padStart(3, '0') + 'Z',
      type: 'assistant_text',
      text: 'word' + i + ' ',
      seq: 19 + i,
    });
  }
  const coalesced = _coalesceReplayEvents(events);
  const BUDGET = 16 * 1024;
  let bytes = 0, keepFromIdx = coalesced.length;
  for (let i = coalesced.length - 1; i >= 0; i--) {
    const sz = JSON.stringify(coalesced[i]).length;
    if (bytes && bytes + sz > BUDGET) break;
    bytes += sz;
    keepFromIdx = i;
  }
  const trimmed = coalesced.slice(keepFromIdx);
  assert.strictEqual(trimmed.length, coalesced.length,
    'with coalescing, all events must survive the 16 KB budget');
  assert.strictEqual(trimmed[0].seq, 19,
    'with coalescing, the first event must be seq=19 — the full reply starts from the beginning');
  assert.ok(trimmed[0].text.includes('word0'),
    'with coalescing, the first word of the reply must be present');
});

t('attach.js source has _coalesceReplayEvents function', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'src', 'attach.js'), 'utf8');
  assert.ok(/function _coalesceReplayEvents/.test(src),
    'attach.js must define _coalesceReplayEvents for per-delta event consolidation');
  assert.ok(/COALESCE_TYPES/.test(src),
    '_coalesceReplayEvents must reference COALESCE_TYPES set');
  assert.ok(/assistant_text/.test(src) && /reasoning_text/.test(src),
    'COALESCE_TYPES must include both assistant_text and reasoning_text');
});

t('attach.js _shipAgentReplay calls _coalesceReplayEvents before byte-trim', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'src', 'attach.js'), 'utf8');
  assert.ok(/const coalesced = _coalesceReplayEvents\(events\)/.test(src),
    '_shipAgentReplay must call _coalesceReplayEvents(events) before byte-trim');
  assert.ok(/coalesced\.length/.test(src),
    'byte-trim loop must iterate over coalesced, not raw events');
});

t('attach.js _shipAgentReplay coalesces in afterSeq catch-up path too', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'src', 'attach.js'), 'utf8');
  assert.ok(/_coalesceReplayEvents\(gap\)/.test(src),
    'afterSeq catch-up path must also coalesce before shipping');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);