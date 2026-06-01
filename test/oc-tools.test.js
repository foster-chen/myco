const assert = require('assert');
const fs = require('fs');
const path = require('path');

(async () => {
  {
    const { createOCTools } = require('../server/src/oc-tools/index');
    const sessionId = 'test-session-reg';
    const workspaceDir = '/tmp/test-oc-tools-wks';
    const tools = createOCTools(sessionId, workspaceDir);
    const expectedToolNames = [
      'mcp__myco__add_plan_items',
      'bash', 'read', 'edit', 'write', 'glob', 'grep', 'webfetch',
    ];
    for (const name of expectedToolNames) {
      assert(tools[name] !== undefined, `tool "${name}" should exist in the tools map`);
      assert(typeof tools[name].description === 'string', `tool "${name}" should have a description`);
      assert(typeof tools[name].inputSchema === 'object', `tool "${name}" should have an inputSchema`);
      assert(typeof tools[name].execute === 'function', `tool "${name}" should have an execute function`);
    }
    console.log('PASS: createOCTools returns all 9 tools with valid shape');
  }

  // ─── Bash test ────────────────────────────────────────────────────
  {
    const { createBashTool } = require('../server/src/oc-tools/bash');
    const sessionId = 'test-session-bash';
    const workspaceDir = process.cwd();
    const bashTool = createBashTool(sessionId, workspaceDir);

    assert(bashTool.description.startsWith('Executes a given bash command in a persistent shell session with optional timeout'), `bash description should start with expected prefix: ${bashTool.description.slice(0, 80)}`);
    const schema = bashTool.inputSchema.jsonSchema;
    assert.strictEqual(schema.type, 'object');
    assert(schema.properties.command, 'bash schema should have command property');
    assert.strictEqual(schema.properties.command.type, 'string');
    assert.deepStrictEqual(schema.required, ['command']);

    const result = await bashTool.execute({ command: 'echo hello-world' });
    assert(result.includes('hello-world'), `bash execute should include output: ${result}`);
    console.log('PASS: bash tool schema + execute works');
  }

  // ─── Read test ────────────────────────────────────────────────────
  {
    const { createReadTool } = require('../server/src/oc-tools/read');
    const tmpDir = '/tmp/oc-tools-test-read';
    fs.mkdirSync(tmpDir, { recursive: true });
    const testFile = path.join(tmpDir, 'test-read.txt');
    fs.writeFileSync(testFile, 'line1\nline2\nline3\n');
    const sessionId = 'test-session-read';
    const readTool = createReadTool(sessionId, tmpDir);

    assert(typeof readTool.description === 'string' && readTool.description.length > 10);
    const schema = readTool.inputSchema.jsonSchema;
    assert.strictEqual(schema.type, 'object');
    assert(schema.properties.filePath);
    assert.deepStrictEqual(schema.required, ['filePath']);

    const result = await readTool.execute({ filePath: testFile });
    assert(result.includes('line1'), `read execute should include file content: ${result}`);
    console.log('PASS: read tool schema + execute works');
  }

  // ─── Edit test ────────────────────────────────────────────────────
  {
    const { createEditTool } = require('../server/src/oc-tools/edit');
    const tmpDir = '/tmp/oc-tools-test-edit';
    fs.mkdirSync(tmpDir, { recursive: true });
    const testFile = path.join(tmpDir, 'test-edit.txt');
    fs.writeFileSync(testFile, 'hello world\nfoo bar\n');
    const sessionId = 'test-session-edit';
    const editTool = createEditTool(sessionId, tmpDir);

    assert(typeof editTool.description === 'string' && editTool.description.length > 10);
    const schema = editTool.inputSchema.jsonSchema;
    assert(schema.properties.filePath);
    assert(schema.properties.oldString);
    assert(schema.properties.newString);
    assert.deepStrictEqual(schema.required, ['filePath', 'oldString', 'newString']);

    const result = await editTool.execute({
      filePath: testFile,
      oldString: 'hello world',
      newString: 'hello universe',
    });
    assert(result.includes('successfully'), `edit should report success: ${result}`);
    const updated = fs.readFileSync(testFile, 'utf8');
    assert(updated.includes('hello universe'), `file should contain new string: ${updated}`);
    console.log('PASS: edit tool schema + execute works');
  }

  // ─── Write test ────────────────────────────────────────────────────
  {
    const { createWriteTool } = require('../server/src/oc-tools/write');
    const tmpDir = '/tmp/oc-tools-test-write';
    const testFile = path.join(tmpDir, 'test-write.txt');
    const sessionId = 'test-session-write';
    const writeTool = createWriteTool(sessionId, tmpDir);

    assert(typeof writeTool.description === 'string' && writeTool.description.length > 10);
    const schema = writeTool.inputSchema;
    assert(schema.properties.filePath);
    assert(schema.properties.content);
    assert.deepStrictEqual(schema.required, ['filePath', 'content']);

    const result = await writeTool.execute({ filePath: testFile, content: 'written content\n' });
    assert(result.includes('successfully') || result.includes('wrote'), `write should report success: ${result}`);
    const written = fs.readFileSync(testFile, 'utf8');
    assert.strictEqual(written, 'written content\n');
    console.log('PASS: write tool schema + execute works');
  }

  console.log('\nAll oc-tools tests passed.');
})();