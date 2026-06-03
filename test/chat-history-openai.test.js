'use strict';

const assert = require('assert');

const mod = require('../server/src/chat-history-openai');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (err) { console.log('  ✗ ' + name + ' — ' + (err && err.stack ? err.stack : err)); failed++; }
}

t('exports all four functions', () => {
  assert.strictEqual(typeof mod.estimateChars, 'function');
  assert.strictEqual(typeof mod.splitIntoTurns, 'function');
  assert.strictEqual(typeof mod.trimHistoryToBudget, 'function');
  assert.strictEqual(typeof mod.reconstructHistoryFromEvents, 'function');
});

const sampleItems = [
  { type: 'message', role: 'user', content: 'Hello there' },
  { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hi! How can I help?' }] },
  { type: 'function_call', name: 'read_file', call_id: 'call_1', arguments: '{"path":"/foo/bar"}' },
  { type: 'function_call_result', call_id: 'call_1', output: 'file contents here' },
  { type: 'message', role: 'user', content: 'What is 2+2?' },
  { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Simple arithmetic' }] },
  { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '4' }] },
];

t('estimateChars returns 0 for empty array', () => {
  assert.strictEqual(mod.estimateChars([]), 0);
});

t('estimateChars counts string content from user messages', () => {
  const items = [{ type: 'message', role: 'user', content: 'abc' }];
  assert.strictEqual(mod.estimateChars(items), 3);
});

t('estimateChars counts output_text from assistant messages', () => {
  const items = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] }];
  assert.strictEqual(mod.estimateChars(items), 5);
});

t('estimateChars counts function_call name + arguments', () => {
  const items = [{ type: 'function_call', name: 'read', call_id: 'c1', arguments: '{"a":1}' }];
  assert.strictEqual(mod.estimateChars(items), 4 + 7);
});

t('estimateChars counts function_call_result output', () => {
  const items = [{ type: 'function_call_result', call_id: 'c1', output: 'out' }];
  assert.strictEqual(mod.estimateChars(items), 3);
});

t('estimateChars counts reasoning summary text', () => {
  const items = [{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'think' }] }];
  assert.strictEqual(mod.estimateChars(items), 5);
});

t('estimateChars returns positive number for sample items', () => {
  assert.ok(mod.estimateChars(sampleItems) > 0);
});

t('splitIntoTurns returns empty for empty array', () => {
  const turns = mod.splitIntoTurns([]);
  assert.strictEqual(turns.length, 0);
});

t('splitIntoTurns groups by user message boundaries', () => {
  const turns = mod.splitIntoTurns(sampleItems);
  assert.strictEqual(turns.length, 2);
  assert.strictEqual(turns[0][0].role, 'user');
  assert.strictEqual(turns[0][0].content, 'Hello there');
  assert.strictEqual(turns[1][0].role, 'user');
  assert.strictEqual(turns[1][0].content, 'What is 2+2?');
});

t('splitIntoTurns first turn includes assistant + tool items', () => {
  const turns = mod.splitIntoTurns(sampleItems);
  assert.strictEqual(turns[0].length, 4);
  assert.strictEqual(turns[0][0].type, 'message');
  assert.strictEqual(turns[0][1].type, 'message');
  assert.strictEqual(turns[0][2].type, 'function_call');
  assert.strictEqual(turns[0][3].type, 'function_call_result');
});

t('splitIntoTurns second turn includes reasoning + assistant', () => {
  const turns = mod.splitIntoTurns(sampleItems);
  assert.strictEqual(turns[1].length, 3);
  assert.strictEqual(turns[1][0].type, 'message');
  assert.strictEqual(turns[1][1].type, 'reasoning');
  assert.strictEqual(turns[1][2].type, 'message');
});

t('trimHistoryToBudget returns all items when under budget', () => {
  const chars = mod.estimateChars(sampleItems);
  const tokens = Math.ceil(chars / 4) + 100;
  const result = mod.trimHistoryToBudget(sampleItems, tokens);
  assert.strictEqual(result.length, sampleItems.length);
});

t('trimHistoryToBudget drops oldest turns when over budget', () => {
  const chars = mod.estimateChars(sampleItems);
  const tinyBudget = Math.ceil(chars / 4) - 5;
  const result = mod.trimHistoryToBudget(sampleItems, tinyBudget);
  assert.ok(result.length < sampleItems.length);
  assert.strictEqual(result[0].role, 'user');
  assert.strictEqual(result[0].content, 'What is 2+2?');
});

t('trimHistoryToBudget keeps at least 1 turn', () => {
  const result = mod.trimHistoryToBudget(sampleItems, 1);
  assert.ok(result.length >= 1);
  assert.strictEqual(result[0].role, 'user');
});

const sampleEvents = [
  { type: 'turn_start', prompt: 'Read the file' },
  { type: 'assistant_text', text: 'I will read it' },
  { type: 'tool_use', name: 'read_file', id: 'call_1', input: { path: '/foo' } },
  { type: 'tool_result', tool_use_id: 'call_1', content: 'file contents', output: 'file contents' },
  { type: 'assistant_text', text: 'Here is the result' },
  { type: 'turn_result', text: 'Here is the result' },
  { type: 'turn_start', prompt: 'Summarize it' },
  { type: 'reasoning_text', text: 'Need to compress', providerId: 'openai' },
  { type: 'assistant_text', text: 'Short summary' },
  { type: 'turn_result', text: 'Short summary' },
];

t('reconstructHistoryFromEvents converts events to AgentInputItem[]', () => {
  const items = mod.reconstructHistoryFromEvents(sampleEvents);
  assert.ok(Array.isArray(items));
  assert.ok(items.length > 0);
});

t('reconstructHistoryFromEvents preserves user prompts', () => {
  const items = mod.reconstructHistoryFromEvents(sampleEvents);
  const userItems = items.filter(i => i.type === 'message' && i.role === 'user');
  assert.strictEqual(userItems.length, 2);
  assert.strictEqual(userItems[0].content, 'Read the file');
  assert.strictEqual(userItems[1].content, 'Summarize it');
});

t('reconstructHistoryFromEvents preserves tool calls with name and call_id', () => {
  const items = mod.reconstructHistoryFromEvents(sampleEvents);
  const calls = items.filter(i => i.type === 'function_call');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].name, 'read_file');
  assert.strictEqual(calls[0].call_id, 'call_1');
});

t('reconstructHistoryFromEvents preserves tool results', () => {
  const items = mod.reconstructHistoryFromEvents(sampleEvents);
  const results = items.filter(i => i.type === 'function_call_result');
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].call_id, 'call_1');
  assert.strictEqual(results[0].output, 'file contents');
});

t('reconstructHistoryFromEvents preserves reasoning', () => {
  const items = mod.reconstructHistoryFromEvents(sampleEvents);
  const reasoning = items.filter(i => i.type === 'reasoning');
  assert.strictEqual(reasoning.length, 1);
  assert.strictEqual(reasoning[0].summary[0].text, 'Need to compress');
});

t('reconstructHistoryFromEvents coalesces assistant text into single message', () => {
  const items = mod.reconstructHistoryFromEvents(sampleEvents);
  const assistants = items.filter(i => i.type === 'message' && i.role === 'assistant');
  assert.strictEqual(assistants.length, 2);
  assert.strictEqual(assistants[0].content[0].text, 'I will read itHere is the result');
});

t('reconstructHistoryFromEvents handles simple text-only turn', () => {
  const events = [
    { type: 'turn_start', prompt: 'Hi' },
    { type: 'assistant_text', text: 'Hello!' },
    { type: 'turn_result', text: 'Hello!' },
  ];
  const items = mod.reconstructHistoryFromEvents(events);
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].type, 'message');
  assert.strictEqual(items[0].role, 'user');
  assert.strictEqual(items[1].type, 'message');
  assert.strictEqual(items[1].role, 'assistant');
  assert.strictEqual(items[1].content[0].text, 'Hello!');
});

t('reconstructHistoryFromEvents returns empty for empty events', () => {
  const items = mod.reconstructHistoryFromEvents([]);
  assert.strictEqual(items.length, 0);
});

t('reconstructHistoryFromEvents uses turn_result text as fallback when no assistant_text', () => {
  const events = [
    { type: 'turn_start', prompt: 'Hi' },
    { type: 'turn_result', text: 'Hello!' },
  ];
  const items = mod.reconstructHistoryFromEvents(events);
  const assistants = items.filter(i => i.type === 'message' && i.role === 'assistant');
  assert.strictEqual(assistants.length, 1);
  assert.strictEqual(assistants[0].content[0].text, 'Hello!');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);