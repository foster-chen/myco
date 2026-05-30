// Auto-refresh: polls the active artifact view (plan/arch/test) and
// the workspace (files) view every 5 seconds so TODOs/Bugs/Features
// and the file tree stay current without a manual page refresh.
//
// Static-shape guards on the contract:
//   • Start/stop helpers exist for both artifact + file-tree polling.
//   • Interval cadence is 5s.
//   • document.hidden skip in the poll loop so a backgrounded tab
//     doesn't waste requests.
//   • showArtifactView starts artifact polling + stops file-tree.
//   • showFilesView starts file-tree polling + stops artifact.
//   • hideArtifactView + hideFilesView stop their respective pollers.
//   • Session switch (_resetUiForNewSession) stops both pollers.
//   • loadArtifact accepts {forceHttp:true} to bypass WS cache.

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

console.log('── Auto-refresh: artifact + file-tree polling ──');

t('app.js: _startArtifactAutoRefresh + _stopArtifactAutoRefresh defined', () => {
  assert.ok(/function\s+_startArtifactAutoRefresh\s*\(/.test(APP),
    'start helper must be defined');
  assert.ok(/function\s+_stopArtifactAutoRefresh\s*\(/.test(APP),
    'stop helper must be defined');
});

t('app.js: _startFileTreeAutoRefresh + _stopFileTreeAutoRefresh defined', () => {
  assert.ok(/function\s+_startFileTreeAutoRefresh\s*\(/.test(APP),
    'start helper must be defined');
  assert.ok(/function\s+_stopFileTreeAutoRefresh\s*\(/.test(APP),
    'stop helper must be defined');
});

t('app.js: artifact auto-refresh cadence is 5s (ARTIFACT_AUTO_REFRESH_MS)', () => {
  assert.ok(/ARTIFACT_AUTO_REFRESH_MS\s*=\s*5000/.test(APP),
    'ARTIFACT_AUTO_REFRESH_MS must be 5000 ms');
});

t('app.js: file-tree auto-refresh cadence is 5s (FILE_TREE_AUTO_REFRESH_MS)', () => {
  assert.ok(/FILE_TREE_AUTO_REFRESH_MS\s*=\s*5000/.test(APP),
    'FILE_TREE_AUTO_REFRESH_MS must be 5000 ms');
});

t('app.js: artifact poll skips when document.hidden + when no active view', () => {
  const idx = APP.search(/function\s+_startArtifactAutoRefresh\s*\(/);
  const win = APP.slice(idx, idx + 1500);
  assert.ok(/document\.hidden/.test(win),
    'poll tick must short-circuit when document.hidden');
  assert.ok(/state\.artifactView[\s\S]{0,100}active/.test(win),
    'poll tick must verify artifactView is still active');
  assert.ok(/loadArtifact[\s\S]{0,100}forceHttp/.test(win),
    'poll tick must call loadArtifact with forceHttp:true to bypass WS cache');
});

t('app.js: file-tree poll skips when document.hidden + when files not visible', () => {
  const idx = APP.search(/function\s+_startFileTreeAutoRefresh\s*\(/);
  const win = APP.slice(idx, idx + 1500);
  assert.ok(/document\.hidden/.test(win),
    'poll tick must short-circuit when document.hidden');
  assert.ok(/state\.files[\s\S]{0,100}visible/.test(win),
    'poll tick must verify files view is still visible');
});

t('app.js: artifact stop handler is idempotent + clears handle', () => {
  const idx = APP.search(/function\s+_stopArtifactAutoRefresh\s*\(/);
  const win = APP.slice(idx, idx + 500);
  assert.ok(/if\s*\(\s*!_artifactAutoRefreshHandle\s*\)\s*return/.test(win),
    'stop must early-return when handle is already null');
  assert.ok(/clearInterval/.test(win),
    'stop must clearInterval');
  assert.ok(/_artifactAutoRefreshHandle\s*=\s*null/.test(win),
    'stop must null the handle');
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

t('app.js: showArtifactView starts artifact polling + stops file-tree', () => {
  const idx = APP.search(/function\s+showArtifactView\s*\(/);
  const win = APP.slice(idx, idx + 3500);
  assert.ok(/_startArtifactAutoRefresh\(/.test(win),
    'showArtifactView must start artifact auto-refresh');
  assert.ok(/_stopFileTreeAutoRefresh\(/.test(win),
    'showArtifactView must stop file-tree auto-refresh (mutual exclusion)');
});

t('app.js: hideArtifactView stops artifact polling', () => {
  const idx = APP.search(/function\s+hideArtifactView\s*\(/);
  const win = APP.slice(idx, idx + 1500);
  assert.ok(/_stopArtifactAutoRefresh\(/.test(win),
    'hideArtifactView must stop artifact auto-refresh');
});

t('app.js: showFilesView starts file-tree polling + stops artifact', () => {
  const idx = APP.search(/function\s+showFilesView\s*\(/);
  const win = APP.slice(idx, idx + 1500);
  assert.ok(/_startFileTreeAutoRefresh\(/.test(win),
    'showFilesView must start file-tree auto-refresh');
  assert.ok(/_stopArtifactAutoRefresh\(/.test(win),
    'showFilesView must stop artifact auto-refresh (mutual exclusion)');
});

t('app.js: hideFilesView stops file-tree polling', () => {
  const idx = APP.search(/function\s+hideFilesView\s*\(/);
  const win = APP.slice(idx, idx + 1500);
  assert.ok(/_stopFileTreeAutoRefresh\(/.test(win),
    'hideFilesView must stop file-tree auto-refresh');
});

t('app.js: _resetUiForNewSession stops both pollers', () => {
  const idx = APP.search(/function\s+_resetUiForNewSession\s*\(/);
  const win = APP.slice(idx, idx + 1500);
  assert.ok(/_stopArtifactAutoRefresh\(/.test(win),
    '_resetUiForNewSession must stop artifact auto-refresh');
  assert.ok(/_stopFileTreeAutoRefresh\(/.test(win),
    '_resetUiForNewSession must stop file-tree auto-refresh');
});

t('app.js: loadArtifact accepts {forceHttp:true} option', () => {
  const idx = APP.search(/async function loadArtifact\s*\(/);
  const win = APP.slice(idx, idx + 2500);
  assert.ok(/forceHttp/.test(win),
    'loadArtifact must accept a forceHttp option');
  assert.ok(/!\s*forceHttp/.test(win),
    'loadArtifact must skip cache when forceHttp is truthy');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);