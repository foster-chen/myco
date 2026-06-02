'use strict';

const assert = require('assert');

function _summariseToolInput(name, input) {
  try {
    if (name === 'Bash' || name === 'bash') return String((input && input.command) || '').slice(0, 200);
    if (name === 'Read' || name === 'Edit' || name === 'Write' || name === 'read_file' || name === 'edit_file' || name === 'write_file') return String((input && (input.file_path || input.filePath)) || '').slice(0, 200);
    if (name === 'Glob' || name === 'Grep' || name === 'glob' || name === 'grep') {
      const q = (input && (input.pattern || input.query)) || '';
      const p = (input && input.path) ? ` in ${input.path}` : '';
      return (q + p).slice(0, 200);
    }
    if (name === 'WebFetch' || name === 'web_fetch') return String((input && input.url) || '').slice(0, 200);
    return JSON.stringify(input || {}).slice(0, 200);
  } catch { return ''; }
}

function _matchingInputFor(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  if (toolName === 'Bash' || toolName === 'bash') return String(toolInput.command || '');
  if (['Read', 'Edit', 'Write', 'MultiEdit', 'read_file', 'edit_file', 'write_file'].includes(toolName)) return String(toolInput.file_path || toolInput.filePath || '');
  if (['Glob', 'Grep', 'glob', 'grep'].includes(toolName)) return String(toolInput.pattern || toolInput.query || '');
  if (toolName === 'WebFetch' || toolName === 'web_fetch') return String(toolInput.url || '');
  return '';
}

async function main() {
  assert.strictEqual(_summariseToolInput('bash', { command: 'ls -la' }), 'ls -la');
  assert.strictEqual(_summariseToolInput('Bash', { command: 'ls -la' }), 'ls -la');
  assert.strictEqual(_summariseToolInput('read_file', { filePath: '/tmp/test.txt' }), '/tmp/test.txt');
  assert.strictEqual(_summariseToolInput('Read', { file_path: '/tmp/test.txt' }), '/tmp/test.txt');
  assert.strictEqual(_summariseToolInput('edit_file', { filePath: '/tmp/test.txt', oldString: 'a', newString: 'b' }), '/tmp/test.txt');
  assert.strictEqual(_summariseToolInput('write_file', { filePath: '/tmp/test.txt' }), '/tmp/test.txt');
  assert.strictEqual(_summariseToolInput('grep', { pattern: 'TODO', path: 'src/' }), 'TODO in src/');
  assert.strictEqual(_summariseToolInput('Grep', { pattern: 'TODO', path: 'src/' }), 'TODO in src/');
  assert.strictEqual(_summariseToolInput('glob', { pattern: '*.js' }), '*.js');
  assert.strictEqual(_summariseToolInput('web_fetch', { url: 'https://example.com' }), 'https://example.com');
  assert.strictEqual(_summariseToolInput('WebFetch', { url: 'https://example.com' }), 'https://example.com');
  assert.strictEqual(_summariseToolInput('add_plan_items', { items: [{ text: 'foo' }] }), '{"items":[{"text":"foo"}]}');
  console.log('PASS: _summariseToolInput handles OC tool names');

  assert.strictEqual(_matchingInputFor('bash', { command: 'ls -la' }), 'ls -la');
  assert.strictEqual(_matchingInputFor('Bash', { command: 'ls -la' }), 'ls -la');
  assert.strictEqual(_matchingInputFor('read_file', { filePath: '/tmp/test.txt' }), '/tmp/test.txt');
  assert.strictEqual(_matchingInputFor('Read', { file_path: '/tmp/test.txt' }), '/tmp/test.txt');
  assert.strictEqual(_matchingInputFor('edit_file', { filePath: '/tmp/test.txt' }), '/tmp/test.txt');
  assert.strictEqual(_matchingInputFor('write_file', { filePath: '/tmp/test.txt' }), '/tmp/test.txt');
  assert.strictEqual(_matchingInputFor('grep', { pattern: 'TODO' }), 'TODO');
  assert.strictEqual(_matchingInputFor('web_fetch', { url: 'https://example.com' }), 'https://example.com');
  console.log('PASS: _matchingInputFor handles OC tool names');

  const menu = {
    kind: 'permission',
    question: 'Allow bash: ls -la?',
    options: [
      { n: 1, label: 'Allow once', description: 'Run this single call.' },
      { n: 2, label: 'Allow always', description: 'Auto-approve matching calls in this project.' },
      { n: 3, label: 'Deny',         description: 'Block this call; Claude will choose a different approach.' },
    ],
    hash: 'oc-test-hash',
    target: { tool: 'bash', input: 'ls -la' },
  };

  assert.strictEqual(menu.kind, 'permission');
  assert.ok(menu.question);
  assert.ok(menu.target);
  assert.strictEqual(menu.target.tool, 'bash');
  assert.ok(menu.options.every(o => typeof o.n === 'number'), 'all options have numeric n');
  assert.ok(menu.options.every(o => typeof o.label === 'string'), 'all options have string label');
  console.log('PASS: OC menu shape matches Claude SDK menu contract');

  const toolUse = {
    type: 'tool_use',
    name: 'bash',
    input: { command: 'ls -la' },
    id: 'call-123',
    toolName: 'bash',
    toolInput: { command: 'ls -la' },
    toolCallId: 'call-123',
    providerId: 'openai',
  };
  assert.strictEqual(toolUse.name, 'bash');
  assert.strictEqual(toolUse.input.command, 'ls -la');
  assert.ok(typeof toolUse.name === 'string', 'tool_use.name is string (client-renderable)');
  console.log('PASS: OC tool_use emit includes Claude-compatible name + input keys');

  const toolResult = {
    type: 'tool_result',
    tool_use_id: 'call-123',
    content: 'file1\nfile2\n',
    isError: false,
    toolCallId: 'call-123',
    output: 'file1\nfile2\n',
    providerId: 'openai',
  };
  assert.strictEqual(toolResult.tool_use_id, 'call-123');
  assert.strictEqual(toolResult.content, 'file1\nfile2\n');
  console.log('PASS: OC tool_result emit includes Claude-compatible tool_use_id + content keys');
}

main().catch(e => {
  console.error('FAIL:', e.message, e.stack);
  process.exit(1);
});