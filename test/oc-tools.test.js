'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { executeBash } = require('../server/src/oc-tools/bash');
const { executeRead } = require('../server/src/oc-tools/read');
const { executeEdit } = require('../server/src/oc-tools/edit');
const { executeWrite } = require('../server/src/oc-tools/write');
const { executeGlob } = require('../server/src/oc-tools/glob');
const { executeGrep } = require('../server/src/oc-tools/grep');
const { executeWebFetch } = require('../server/src/oc-tools/webfetch');

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-tools-test-'));
  const origCwd = process.cwd();

  try {
    process.chdir(tmpDir);

    const result = await executeBash({ command: 'echo hello', workdir: tmpDir, timeout: 5000 });
    assert(result.includes('hello'));
    console.log('PASS: bash echo');

    fs.writeFileSync(path.join(tmpDir, 'test-read.txt'), 'line1\nline2\nline3\n');
    const readResult = await executeRead({ filePath: path.join(tmpDir, 'test-read.txt'), offset: 1, limit: 2 });
    assert(readResult.includes('2: line2'));
    assert(readResult.includes('3: line3'));
    console.log('PASS: read file with offset');

    const dirResult = await executeRead({ filePath: tmpDir });
    assert(dirResult.includes('test-read.txt'));
    console.log('PASS: read directory');

    fs.writeFileSync(path.join(tmpDir, 'test-edit.txt'), 'foo bar baz');
    const editResult = await executeEdit({ filePath: path.join(tmpDir, 'test-edit.txt'), oldString: 'bar', newString: 'BAR' });
    assert(editResult.includes('Successfully edited'));
    const editContent = fs.readFileSync(path.join(tmpDir, 'test-edit.txt'), 'utf8');
    assert.strictEqual(editContent, 'foo BAR baz');
    console.log('PASS: edit single replacement');

    const writeResult = await executeWrite({ filePath: path.join(tmpDir, 'test-write.txt'), content: 'written content' });
    assert(writeResult.includes('Successfully wrote'));
    const writeContent = fs.readFileSync(path.join(tmpDir, 'test-write.txt'), 'utf8');
    assert.strictEqual(writeContent, 'written content');
    console.log('PASS: write file');

    const globResult = await executeGlob({ pattern: '*.txt', path: tmpDir });
    assert(globResult.includes('test-read.txt'));
    console.log('PASS: glob *.txt');

    await executeGrep({ pattern: 'hello', path: tmpDir, include: '*.txt' });
    console.log('PASS: grep runs without error');

    const wfResult = await executeWebFetch({ url: 'not-a-url' });
    assert(wfResult.includes('Error'));
    console.log('PASS: webfetch rejects invalid URL');

  } finally {
    process.chdir(origCwd);
    try { fs.rmSync(tmpDir, { recursive: true }); } catch (e) { /* ignore */ }
  }

  console.log('All oc-tools tests passed');
}

main().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});