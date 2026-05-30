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