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

// Region anchor: the turn_result handler lives after the "flush the
// consolidated clarify-reply" comment. We search for `type: 'turn_result'`
// STARTING FROM that comment (two-arg indexOf) because the file has an
// EARLIER `type: 'turn_result'` emit in the OpenAI-compatible code path
// (~line 722) that precedes the flush comment — a plain indexOf would
// resolve to that earlier occurrence, making slice(start>end) return ''.
const FLUSH_IDX = SRC.indexOf('flush the consolidated clarify-reply');
function turnResultRegion() {
  return SRC.slice(FLUSH_IDX, SRC.indexOf("type: 'turn_result'", FLUSH_IDX) + 200);
}

console.log('── meeting-summary-capture ──');

t('_persistAssistantTextToRecChat accumulates into _pendingMeetingSummary', () => {
  assert.ok(/_pendingMeetingSummary/.test(SRC),
    '_pendingMeetingSummary must be referenced in agent-session.js — the summary capture flag (mirrors _pendingClarify)');
  const fnMatch = SRC.match(/_persistAssistantTextToRecChat\(text\)\s*\{[\s\S]*?^  \}/m);
  assert.ok(fnMatch, 'could not locate _persistAssistantTextToRecChat function body');
  assert.ok(/_pendingMeetingSummary\.summaryText/.test(fnMatch[0]),
    '_persistAssistantTextToRecChat must accumulate trimmed text into _pendingMeetingSummary.summaryText');
});

t('accumulation does NOT early-return (visible ack — Approach A)', () => {
  const fnMatch = SRC.match(/_persistAssistantTextToRecChat\(text\)\s*\{[\s\S]*?^  \}/m);
  assert.ok(fnMatch, 'could not locate _persistAssistantTextToRecChat function body');
  const accIdx = fnMatch[0].indexOf('_pendingMeetingSummary');
  const appendIdx = fnMatch[0].indexOf('appendChatMessage');
  assert.ok(accIdx >= 0 && appendIdx >= 0 && appendIdx > accIdx,
    'appendChatMessage must be called AFTER the _pendingMeetingSummary accumulation — the normal fromAgent row must still persist (visible ack, Approach A)');
});

t('turn_result handler captures + emits meeting-summary', () => {
  const region = turnResultRegion();
  assert.ok(/_pendingMeetingSummary/.test(region),
    'turn_result handler must check _pendingMeetingSummary and capture the summary');
  assert.ok(/meeting-summary/.test(region),
    'turn_result handler must emit a meeting-summary event when _pendingMeetingSummary is set');
  assert.ok(/_pendingMeetingSummary\s*=\s*null/.test(region),
    'turn_result handler must clear _pendingMeetingSummary after capturing the summary');
});

t('summary is truncated to first sentence', () => {
  const region = turnResultRegion();
  assert.ok(/split.*[.!?.]/.test(region) || /firstSentence|first.*sentence/.test(region),
    'summary must be truncated to the first sentence before persisting to meta.summary');
});

t('meeting row meta.summary is updated in rec.chat', () => {
  const region = turnResultRegion();
  assert.ok(/meta\.summary/.test(region),
    'turn_result handler must update the meeting row\'s meta.summary in rec.chat');
  assert.ok(/saveStore/.test(region) || /saveStore/.test(SRC.slice(SRC.indexOf('_pendingMeetingSummary'), SRC.indexOf('_pendingMeetingSummary') + 800)),
    'saveStore must be called after updating meta.summary so the summary persists to disk');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
