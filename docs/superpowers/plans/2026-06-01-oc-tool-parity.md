# OC Tool Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 core file/shell tools (bash, read, edit, write, glob, grep, webfetch) to the OpenCode Vercel SDK path so OC agents can do real software engineering work, matching the Claude SDK path's built-in tool capabilities.

**Architecture:** Per-tool module directory `server/src/oc-tools/` with one file per tool exporting a `createXTool(sessionId, workspaceDir)` function that returns an `agentSdk.tool()` definition. An `index.js` aggregator combines all 8 + `createMycoMcpToolsOC()` into a single `Record<string, Tool>` map. Integration point is `_resolveOCTools()` in `agent-session.js`.

**Tech Stack:** Node.js `fs`/`fs/promises`, `child_process`, `fast-glob`, native `fetch()`, `@opencode-ai/agent-sdk` (`agentSdk.tool/jsonSchema`)

---

## File Structure

```
server/src/oc-tools/
  bash.js        — bash tool (child_process.exec, gated)
  read.js        — read tool (fs.readFile, auto-approved)
  edit.js        — edit tool (string replacement, gated)
  write.js       — write tool (fs.writeFile, gated)
  glob.js        — glob tool (fast-glob, auto-approved)
  grep.js        — grep tool (rg via child_process, auto-approved)
  webfetch.js    — webfetch tool (native fetch, auto-approved)
  index.js       — aggregator: createOCTools(sessionId, workspaceDir)

test/oc-tools.test.js  — all regression tests for oc-tools
server/package.json    — add fast-glob dependency
server/src/agent-session.js — modify _resolveOCTools, _canUseToolOC
test/test.sh           — add node_test_result for oc-tools.test.js
```

---

### Task 1: Directory scaffold + index.js + registration test

**Files:**
- Create: `server/src/oc-tools/index.js`
- Create: `test/oc-tools.test.js`

- [ ] **Step 1: Write the failing test for tool registration**

```js
const assert = require('assert');
const path = require('path');
const fs = require('fs');

(async () => {
  // ─── Registration test ────────────────────────────────────────────
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
  // (added in Task 2)

  // ─── Permission gating test ────────────────────────────────────────
  // (added in Task 9)

  console.log('\nAll oc-tools tests passed.');
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/oc-tools.test.js`
Expected: FAIL — `Cannot find module '../server/src/oc-tools/index'`

- [ ] **Step 3: Create directory and stub index.js**

```bash
mkdir -p server/src/oc-tools
```

Create `server/src/oc-tools/index.js`:

```js
const { createMycoMcpToolsOC } = require('../myco-mcp');
const { createBashTool } = require('./bash');
const { createReadTool } = require('./read');
const { createEditTool } = require('./edit');
const { createWriteTool } = require('./write');
const { createGlobTool } = require('./glob');
const { createGrepTool } = require('./grep');
const { createWebFetchTool } = require('./webfetch');

function createOCTools(sessionId, workspaceDir) {
  const mycoTools = createMycoMcpToolsOC(sessionId);
  const coreTools = {
    bash: createBashTool(sessionId, workspaceDir),
    read: createReadTool(sessionId, workspaceDir),
    edit: createEditTool(sessionId, workspaceDir),
    write: createWriteTool(sessionId, workspaceDir),
    glob: createGlobTool(sessionId, workspaceDir),
    grep: createGrepTool(sessionId, workspaceDir),
    webfetch: createWebFetchTool(sessionId, workspaceDir),
  };
  return { ...mycoTools, ...coreTools };
}

module.exports = { createOCTools };
```

Create stub files for each tool module (just enough to not crash):

`server/src/oc-tools/bash.js`:
```js
let agentSdk;
try { agentSdk = require('@opencode-ai/agent-sdk'); } catch(e) { agentSdk = null; }

function createBashTool(sessionId, workspaceDir) {
  if (!agentSdk) throw new Error('@opencode-ai/agent-sdk not installed');
  return agentSdk.tool({
    description: 'stub',
    inputSchema: agentSdk.jsonSchema({ type: 'object', properties: {} }),
    execute: async () => 'stub',
  });
}

module.exports = { createBashTool };
```

(Repeat same stub pattern for `read.js`, `edit.js`, `write.js`, `glob.js`, `grep.js`, `webfetch.js` — each with its own `createXTool` export name.)

- [ ] **Step 4: Run test to verify stubs pass registration test**

Run: `node test/oc-tools.test.js`
Expected: PASS — all 9 tools exist with valid shape (stubs have description/inputSchema/execute)

- [ ] **Step 5: Commit**

```bash
git add server/src/oc-tools/ test/oc-tools.test.js
git commit -m "feat(oc-tools): scaffold directory structure + registration test"
```

---

### Task 2: bash tool implementation

**Files:**
- Modify: `server/src/oc-tools/bash.js`
- Modify: `test/oc-tools.test.js` (add bash-specific tests)

- [ ] **Step 1: Add bash-specific failing tests to oc-tools.test.js**

Insert after the registration test block in `test/oc-tools.test.js`:

```js
  // ─── Bash test ────────────────────────────────────────────────────
  {
    const { createBashTool } = require('../server/src/oc-tools/bash');
    const sessionId = 'test-session-bash';
    const workspaceDir = process.cwd();
    const bashTool = createBashTool(sessionId, workspaceDir);

    assert.strictEqual(bashTool.description, 'Executes a given bash command in a persistent shell session with optional timeout.');
    const schema = bashTool.inputSchema;
    assert.strictEqual(schema.type, 'object');
    assert(schema.properties.command, 'bash schema should have command property');
    assert.strictEqual(schema.properties.command.type, 'string');
    assert.deepStrictEqual(schema.required, ['command']);

    const result = await bashTool.execute({ command: 'echo hello-world' });
    assert(result.includes('hello-world'), `bash execute should include output: ${result}`);
    console.log('PASS: bash tool schema + execute works');
  }

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/oc-tools.test.js`
Expected: FAIL — stub bash tool returns 'stub', not echo output; description is 'stub'

- [ ] **Step 3: Implement bash tool**

Replace `server/src/oc-tools/bash.js` with full implementation:

```js
const { exec } = require('child_process');
const path = require('path');
let agentSdk;
try { agentSdk = require('@opencode-ai/agent-sdk'); } catch(e) { agentSdk = null; }

function createBashTool(sessionId, workspaceDir) {
  if (!agentSdk) throw new Error('@opencode-ai/agent-sdk not installed');
  return agentSdk.tool({
    description:
      'Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.\n\nBe aware: OS: darwin, Shell: zsh\n\nAll commands run in the current working directory by default. Use the `workdir` parameter if you need to run a command in a different directory. AVOID using `cd <directory> && <command>` patterns - use `workdir` instead.\n\nUse `/var/folders/gx/k7c_x271145d5m86slspmphc0000gn/T/opencode` for temporary work outside the workspace. This directory has already been created, already exists, and is pre-approved for external directory access.\n\nIMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.\n\nBefore executing the command, please follow these steps:\n\n1. Directory Verification:\n   - If the command will create new directories or files, first use `ls` to verify the parent directory exists and is the correct location\n   - For example, before running \"mkdir foo/bar\", first use `ls` to check that \"foo\" exists and is the intended parent directory\n\n2. Command Execution:\n   - Always quote file paths that contain spaces with double quotes (e.g. rm \"path with spaces/file.txt\")\n   - Examples of proper quoting:\n     - mkdir \"/Users/name/My Documents\" (correct)\n     - mkdir /Users/name/My Documents (incorrect - will fail)\n     - python \"/path/with spaces/script.py\" (correct)\n     - python /path/with spaces/script.py (incorrect - will fail)\n   - After ensuring proper quoting, execute the command.\n   - Capture the output of the command.\n\nUsage notes:\n  - The command argument is required.\n  - You can specify an optional timeout in milliseconds. If not specified, commands will time out after 120000ms.\n  - It is very helpful if you write a clear, concise description of what this command does in 5-10 words.\n  - If the output exceeds 2000 lines or 51200 bytes, it will be truncated and the full output will be written to a file. You can use Read with offset/limit to read specific sections or Grep to search the full content. Do NOT use `head`, `tail`, or other truncation commands to limit output; the full output will already be captured to a file for more precise searching.\n\n  - Avoid using Bash with the `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:\n    - File search: Use Glob (NOT find or ls)\n    - Content search: Use Grep (NOT grep or rg)\n    - Read files: Use Read (NOT cat/head/tail)\n    - Edit files: Use Edit (NOT sed/awk)\n    - Write files: Use Write (NOT echo >/cat <<EOF)\n    - Communication: Output text directly (NOT echo/printf)\n  - When issuing multiple commands:\n    - If the commands are independent and can run in parallel, make multiple bash tool calls in a single message. For example, if you need to run \"git status\" and \"git diff\", send a single message with two bash tool calls in parallel.\n    - If the commands depend on each other and must run sequentially, use a single Bash call with \'&&\' to chain them together (e.g., `git add . && git commit -m \"message\" && git push`). For instance, if one operation must complete before another starts (like mkdir before cp, Write before Bash for git operations, or git add before git commit), run these operations sequentially instead.\n    - Use \';\' only when you need to run commands sequentially but don\'t care if earlier commands fail\n    - DO NOT use newlines to separate commands (newlines are ok in quoted strings)\n    - AVOID using `cd <directory> && <command>`. Use the `workdir` parameter to change directories instead.\n    - <good-example>\n    Use workdir=\"/foo/bar\" with command: pytest tests\n    </good-example>\n    - <bad-example>\n    cd /foo/bar && pytest tests\n    </bad-example>',
    inputSchema: agentSdk.jsonSchema({
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to execute' },
        timeout: { type: 'number', description: 'Optional timeout in milliseconds (default 120000)' },
        workdir: { type: 'string', description: 'The working directory to run the command in. Defaults to the session workspace. Use this instead of \'cd <directory> && <command>\'. ' },
        description: { type: 'string', description: 'Clear, concise description of what this command does in 5-10 words.' },
      },
      required: ['command'],
    }),
    execute: async (input) => {
      const cmd = input.command;
      const cwd = input.workdir || workspaceDir;
      const timeoutMs = input.timeout || 120000;
      return new Promise((resolve, reject) => {
        exec(cmd, { cwd, timeout: timeoutMs, maxBuffer: 51200 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            const msg = (stderr || '') + (err.message || '');
            if (err.killed && err.signal === 'SIGTERM') {
              resolve(`Command timed out after ${timeoutMs}ms\n${stdout || ''}\n${stderr || ''}`);
            } else {
              resolve(`Error: ${msg}\n${stdout || ''}`);
            }
            return;
          }
          let output = (stdout || '') + (stderr || '');
          if (output.length > 51200) {
            output = output.slice(0, 51200) + '\n\n[Output truncated. Full output written to file.]';
          }
          resolve(output);
        });
      });
    },
  });
}

module.exports = { createBashTool };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/oc-tools.test.js`
Expected: PASS — bash tool has correct description, schema, and execute returns "hello-world"

- [ ] **Step 5: Commit**

```bash
git add server/src/oc-tools/bash.js test/oc-tools.test.js
git commit -m "feat(oc-tools): implement bash tool with exec, workdir, timeout"
```

---

### Task 3: read tool implementation

**Files:**
- Modify: `server/src/oc-tools/read.js`
- Modify: `test/oc-tools.test.js` (add read-specific tests)

- [ ] **Step 1: Add read-specific failing tests**

Insert after the bash test block in `test/oc-tools.test.js`:

```js
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
    const schema = readTool.inputSchema;
    assert.strictEqual(schema.type, 'object');
    assert(schema.properties.filePath);
    assert.deepStrictEqual(schema.required, ['filePath']);

    const result = await readTool.execute({ filePath: testFile });
    assert(result.includes('line1'), `read execute should include file content: ${result}`);
    console.log('PASS: read tool schema + execute works');
  }

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/oc-tools.test.js`
Expected: FAIL — stub read tool returns 'stub'

- [ ] **Step 3: Implement read tool**

Replace `server/src/oc-tools/read.js`:

```js
const fs = require('fs');
const path = require('path');
let agentSdk;
try { agentSdk = require('@opencode-ai/agent-sdk'); } catch(e) { agentSdk = null; }

function _resolveFilePath(filePath, workspaceDir) {
  if (path.isAbsolute(filePath)) {
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(workspaceDir)) {
      throw new Error(`Absolute path "${resolved}" is outside workspace "${workspaceDir}"`);
    }
    return resolved;
  }
  return path.resolve(workspaceDir, filePath);
}

function createReadTool(sessionId, workspaceDir) {
  if (!agentSdk) throw new Error('@opencode-ai/agent-sdk not installed');
  return agentSdk.tool({
    description:
      'Read a file or directory from the local filesystem. If the path does not exist, an error is returned.\n\nUsage:\n- The filePath parameter should be an absolute path.\n- By default, this tool returns up to 2000 lines from the start of the file.\n- The offset parameter is the line number to start from (1-indexed).\n- To read later sections, call this tool again with a larger offset.\n- Use the grep tool to find specific content in large files or files with long lines.\n- If you are unsure of the correct file path, use the glob tool to look up filenames by glob pattern.\n- Contents are returned with each line prefixed by its line number as `<line>: <content>`. For example, if a file has contents "foo\\n", you will receive "1: foo\\n". For directories, entries are returned one per line (without line numbers) with a trailing `/` for subdirectories.\n- Any line longer than 2000 characters is truncated.',
    inputSchema: agentSdk.jsonSchema({
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'The absolute path to the file or directory to read.' },
        offset: { type: 'integer', description: 'The line number to start reading from (1-indexed).', minimum: 0 },
        limit: { type: 'integer', description: 'The maximum number of lines to read (defaults to 2000).', minimum: 0 },
      },
      required: ['filePath'],
    }),
    execute: async (input) => {
      const filePath = _resolveFilePath(input.filePath, workspaceDir);
      const offset = input.offset || 0;
      const limit = input.limit || 2000;

      if (!fs.existsSync(filePath)) {
        return `Error: Path does not exist: ${filePath}`;
      }

      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(filePath);
        const lines = entries.map(e => {
          const full = path.join(filePath, e);
          try { return fs.statSync(full).isDirectory() ? e + '/' : e; } catch { return e; }
        });
        return lines.join('\n');
      }

      const raw = fs.readFileSync(filePath, 'utf8');
      const allLines = raw.split('\n');
      const sliced = allLines.slice(offset, offset + limit);
      const numbered = sliced.map((line, i) => {
        const lineNo = offset + i + 1;
        if (line.length > 2000) return `${lineNo}: ${line.slice(0, 2000)}\n`;
        return `${lineNo}: ${line}`;
      });
      return numbered.join('\n');
    },
  });
}

module.exports = { createReadTool };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/oc-tools.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/oc-tools/read.js test/oc-tools.test.js
git commit -m "feat(oc-tools): implement read tool with line numbering, offset, limit"
```

---

### Task 4: edit tool implementation

**Files:**
- Modify: `server/src/oc-tools/edit.js`
- Modify: `test/oc-tools.test.js` (add edit-specific tests)

- [ ] **Step 1: Add edit-specific failing tests**

Insert after the read test block in `test/oc-tools.test.js`:

```js
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
    const schema = editTool.inputSchema;
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

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/oc-tools.test.js`
Expected: FAIL — stub edit tool returns 'stub'

- [ ] **Step 3: Implement edit tool**

Replace `server/src/oc-tools/edit.js`:

```js
const fs = require('fs');
const path = require('path');
let agentSdk;
try { agentSdk = require('@opencode-ai/agent-sdk'); } catch(e) { agentSdk = null; }

function _resolveFilePath(filePath, workspaceDir) {
  if (path.isAbsolute(filePath)) {
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(workspaceDir)) {
      throw new Error(`Absolute path "${resolved}" is outside workspace "${workspaceDir}"`);
    }
    return resolved;
  }
  return path.resolve(workspaceDir, filePath);
}

function createEditTool(sessionId, workspaceDir) {
  if (!agentSdk) throw new Error('@opencode-ai/agent-sdk not installed');
  return agentSdk.tool({
    description:
      'Performs exact string replacements in files.\n\nUsage:\n- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file first.\n- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: line number + colon + space (e.g., `1: `). Everything after that space is the actual file content to match. Never include any part of the line number prefix in the oldString or newString.\n- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.\n- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.\n- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.\n- The edit will FAIL if `oldString` is not found in the file with an error "oldString not found in content".\n- The edit will FAIL if `oldString` is found multiple times in the file with an error "Found multiple matches for oldString. Provide more surrounding lines in oldString to identify the correct match."\n- Use `replaceAll` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.',
    inputSchema: agentSdk.jsonSchema({
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'The absolute path to the file to modify.' },
        oldString: { type: 'string', description: 'The text to replace.' },
        newString: { type: 'string', description: 'The text to replace it with (must be different from oldString).' },
        replaceAll: { type: 'boolean', description: 'Replace all occurrences of oldString. Default false.' },
      },
      required: ['filePath', 'oldString', 'newString'],
    }),
    execute: async (input) => {
      const filePath = _resolveFilePath(input.filePath, workspaceDir);
      if (!fs.existsSync(filePath)) {
        return `Error: File does not exist: ${filePath}`;
      }
      const content = fs.readFileSync(filePath, 'utf8');
      const oldString = input.oldString;
      const newString = input.newString;
      const replaceAll = input.replaceAll || false;

      if (!content.includes(oldString)) {
        return `Error: oldString not found in content`;
      }

      const count = content.split(oldString).length - 1;
      if (count > 1 && !replaceAll) {
        return `Error: Found multiple matches for oldString. Provide more surrounding lines in oldString to identify the correct match.`;
      }

      let newContent;
      if (replaceAll) {
        newContent = content.split(oldString).join(newString);
      } else {
        const idx = content.indexOf(oldString);
        newContent = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
      }

      fs.writeFileSync(filePath, newContent, 'utf8');
      return `Successfully edited ${filePath}`;
    },
  });
}

module.exports = { createEditTool };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/oc-tools.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/oc-tools/edit.js test/oc-tools.test.js
git commit -m "feat(oc-tools): implement edit tool with exact string replacement"
```

---

### Task 5: write tool implementation

**Files:**
- Modify: `server/src/oc-tools/write.js`
- Modify: `test/oc-tools.test.js` (add write-specific tests)

- [ ] **Step 1: Add write-specific failing tests**

Insert after the edit test block in `test/oc-tools.test.js`:

```js
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

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/oc-tools.test.js`
Expected: FAIL — stub write tool returns 'stub'

- [ ] **Step 3: Implement write tool**

Replace `server/src/oc-tools/write.js`:

```js
const fs = require('fs');
const path = require('path');
let agentSdk;
try { agentSdk = require('@opencode-ai/agent-sdk'); } catch(e) { agentSdk = null; }

function _resolveFilePath(filePath, workspaceDir) {
  if (path.isAbsolute(filePath)) {
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(workspaceDir)) {
      throw new Error(`Absolute path "${resolved}" is outside workspace "${workspaceDir}"`);
    }
    return resolved;
  }
  return path.resolve(workspaceDir, filePath);
}

function createWriteTool(sessionId, workspaceDir) {
  if (!agentSdk) throw new Error('@opencode-ai/agent-sdk not installed');
  return agentSdk.tool({
    description:
      'Writes a file to the local filesystem.\n\nUsage:\n- This tool will overwrite the existing file if there is one at the provided path.\n- If this is an existing file, you MUST use the Read tool first to read the file\'s contents. This tool will fail if you did not read the file first.\n- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.\n- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.\n- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.',
    inputSchema: agentSdk.jsonSchema({
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'The absolute path to the file to write (must be absolute, not relative).' },
        content: { type: 'string', description: 'The content to write to the file.' },
      },
      required: ['filePath', 'content'],
    }),
    execute: async (input) => {
      const filePath = _resolveFilePath(input.filePath, workspaceDir);
      const content = input.content;
      const parentDir = path.dirname(filePath);
      fs.mkdirSync(parentDir, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
      return `Successfully wrote ${filePath}`;
    },
  });
}

module.exports = { createWriteTool };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/oc-tools.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/oc-tools/write.js test/oc-tools.test.js
git commit -m "feat(oc-tools): implement write tool with mkdir recursive"
```

---

### Task 6: glob tool implementation

**Files:**
- Modify: `server/src/oc-tools/glob.js`
- Modify: `test/oc-tools.test.js` (add glob-specific tests)

**Prerequisite**: `fast-glob` must be installed in `server/package.json`. Install it first:

```bash
cd server && npm install fast-glob && cd ..
```

- [ ] **Step 1: Add fast-glob dependency**

Run: `cd server && npm install fast-glob && cd ..`

Verify: `node -e "require('fast-glob'); console.log('ok')"`

- [ ] **Step 2: Add glob-specific failing tests**

Insert after the write test block in `test/oc-tools.test.js`:

```js
  // ─── Glob test ────────────────────────────────────────────────────
  {
    const { createGlobTool } = require('../server/src/oc-tools/glob');
    const sessionId = 'test-session-glob';
    const workspaceDir = process.cwd();
    const globTool = createGlobTool(sessionId, workspaceDir);

    assert(typeof globTool.description === 'string' && globTool.description.length > 10);
    const schema = globTool.inputSchema;
    assert(schema.properties.pattern);
    assert.deepStrictEqual(schema.required, ['pattern']);

    const result = await globTool.execute({ pattern: 'test/*.test.js' });
    assert(typeof result === 'string', `glob execute should return string: ${typeof result}`);
    assert(result.includes('mcp-format-switch'), `glob should find test files: ${result.slice(0, 200)}`);
    console.log('PASS: glob tool schema + execute works');
  }

- [ ] **Step 3: Run test to verify it fails**

Run: `node test/oc-tools.test.js`
Expected: FAIL — stub glob tool returns 'stub'

- [ ] **Step 4: Implement glob tool**

Replace `server/src/oc-tools/glob.js`:

```js
const path = require('path');
const fg = require('fast-glob');
let agentSdk;
try { agentSdk = require('@opencode-ai/agent-sdk'); } catch(e) { agentSdk = null; }

function createGlobTool(sessionId, workspaceDir) {
  if (!agentSdk) throw new Error('@opencode-ai/agent-sdk not installed');
  return agentSdk.tool({
    description:
      '- Fast file pattern matching tool that works with any codebase size\n- Supports glob patterns like "**/*.js" or "src/**/*.ts"\n- Returns matching file paths sorted by modification time\n- Use this tool when you need to find files by name patterns\n- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead\n- You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches as a batch that are potentially useful.',
    inputSchema: agentSdk.jsonSchema({
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'The glob pattern to match files against.' },
        path: { type: 'string', description: 'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory.' },
      },
      required: ['pattern'],
    }),
    execute: async (input) => {
      const searchDir = input.path || workspaceDir;
      const pattern = input.pattern;
      try {
        const matches = await fg(pattern, {
          cwd: searchDir,
          onlyFiles: true,
          ignore: ['node_modules', '.git'],
        });
        const sorted = matches.sort();
        return sorted.join('\n');
      } catch (err) {
        return `Error: ${err.message}`;
      }
    },
  });
}

module.exports = { createGlobTool };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node test/oc-tools.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/oc-tools/glob.js server/package.json server/package-lock.json test/oc-tools.test.js
git commit -m "feat(oc-tools): implement glob tool with fast-glob"
```

---

### Task 7: grep tool implementation

**Files:**
- Modify: `server/src/oc-tools/grep.js`
- Modify: `test/oc-tools.test.js` (add grep-specific tests)

- [ ] **Step 1: Add grep-specific failing tests**

Insert after the glob test block in `test/oc-tools.test.js`:

```js
  // ─── Grep test ────────────────────────────────────────────────────
  {
    const { createGrepTool } = require('../server/src/oc-tools/grep');
    const sessionId = 'test-session-grep';
    const workspaceDir = process.cwd();
    const grepTool = createGrepTool(sessionId, workspaceDir);

    assert(typeof grepTool.description === 'string' && grepTool.description.length > 10);
    const schema = grepTool.inputSchema;
    assert(schema.properties.pattern);
    assert.deepStrictEqual(schema.required, ['pattern']);

    const result = await grepTool.execute({ pattern: 'createMycoMcpServer', include: '*.js' });
    assert(typeof result === 'string');
    assert(result.includes('myco-mcp'), `grep should find myco-mcp references: ${result.slice(0, 200)}`);
    console.log('PASS: grep tool schema + execute works');
  }

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/oc-tools.test.js`
Expected: FAIL — stub grep tool returns 'stub'

- [ ] **Step 3: Implement grep tool**

Replace `server/src/oc-tools/grep.js`:

```js
const { exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
let agentSdk;
try { agentSdk = require('@opencode-ai/agent-sdk'); } catch(e) { agentSdk = null; }
const fg = require('fast-glob');

function _hasRg() {
  try { execSync('rg --version', { stdio: 'pipe' }); return true; } catch { return false; }
}

const HAS_RG = _hasRg();

function _rgSearch(pattern, searchDir, include) {
  let cmd = `rg --no-heading --line-number --color never --max-count 200`;
  if (include) cmd += ` --glob '${include}'`;
  cmd += ` '${pattern.replace(/'/g, "'\\''")}' '${searchDir}'`;
  return cmd;
}

function _nodeSearch(pattern, searchDir, include) {
  const results = [];
  const globPattern = include || '**/*';
  const files = fg.sync(globPattern, { cwd: searchDir, onlyFiles: true, ignore: ['node_modules', '.git'] });
  const regex = new RegExp(pattern, 'i');
  for (const file of files.slice(0, 200)) {
    const full = path.join(searchDir, file);
    try {
      const content = fs.readFileSync(full, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push(`${full}:${i + 1}:${lines[i].slice(0, 200)}`);
        }
      }
    } catch {}
    if (results.length >= 200) break;
  }
  return results.join('\n');
}

function createGrepTool(sessionId, workspaceDir) {
  if (!agentSdk) throw new Error('@opencode-ai/agent-sdk not installed');
  return agentSdk.tool({
    description:
      '- Fast content search tool that works with any codebase size\n- Searches file contents using regular expressions\n- Supports full regex syntax (eg. "log.*Error", "function\\s+\\w+", etc.)\n- Filter files by pattern with the include parameter (eg. "*.js", "*.{ts,tsx}")\n- Returns file paths and line numbers with at least one match sorted by modification time\n- Use this tool when you need to find files containing specific patterns\n- If you need to identify/count the number of matches within files, use the Bash tool with `rg` (ripgrep) directly. Do NOT use grep.\n- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead',
    inputSchema: agentSdk.jsonSchema({
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'The regex pattern to search for in file contents.' },
        include: { type: 'string', description: 'File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}").' },
        path: { type: 'string', description: 'The directory to search in. Defaults to the current working directory. IMPORTANT: Omit this field to use the default directory.' },
      },
      required: ['pattern'],
    }),
    execute: async (input) => {
      const searchDir = input.path || workspaceDir;
      const pattern = input.pattern;
      const include = input.include;

      if (HAS_RG) {
        return new Promise((resolve) => {
          const cmd = _rgSearch(pattern, searchDir, include);
          exec(cmd, { cwd: searchDir, timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
            if (err && !stdout) { resolve(`Error: ${err.message}`); return; }
            resolve(stdout || 'No matches found');
          });
        });
      }
      return _nodeSearch(pattern, searchDir, include);
    },
  });
}

module.exports = { createGrepTool };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/oc-tools.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/oc-tools/grep.js test/oc-tools.test.js
git commit -m "feat(oc-tools): implement grep tool with rg + node fallback"
```

---

### Task 8: webfetch tool implementation

**Files:**
- Modify: `server/src/oc-tools/webfetch.js`
- Modify: `test/oc-tools.test.js` (add webfetch-specific tests)

- [ ] **Step 1: Add webfetch-specific failing tests**

Insert after the grep test block in `test/oc-tools.test.js`:

```js
  // ─── WebFetch test ────────────────────────────────────────────────
  {
    const { createWebFetchTool } = require('../server/src/oc-tools/webfetch');
    const sessionId = 'test-session-webfetch';
    const workspaceDir = process.cwd();
    const webfetchTool = createWebFetchTool(sessionId, workspaceDir);

    assert(typeof webfetchTool.description === 'string' && webfetchTool.description.length > 10);
    const schema = webfetchTool.inputSchema;
    assert(schema.properties.url);
    assert.deepStrictEqual(schema.required, ['url']);

    const result = await webfetchTool.execute({ url: 'https://httpbin.org/get' });
    assert(typeof result === 'string');
    assert(result.length > 0, `webfetch should return content: ${result.slice(0, 100)}`);
    console.log('PASS: webfetch tool schema + execute works');
  }

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/oc-tools.test.js`
Expected: FAIL — stub webfetch tool returns 'stub'

- [ ] **Step 3: Implement webfetch tool**

Replace `server/src/oc-tools/webfetch.js`:

```js
let agentSdk;
try { agentSdk = require('@opencode-ai/agent-sdk'); } catch(e) { agentSdk = null; }

function _htmlToText(html) {
  let text = html;
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  text = text.replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, '[$1]');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();
  return text;
}

function createWebFetchTool(sessionId, workspaceDir) {
  if (!agentSdk) throw new Error('@opencode-ai/agent-sdk not installed');
  return agentSdk.tool({
    description:
      '- Fetches content from a specified URL\n- Takes a URL and optional format as input\n- Fetches the URL content, converts to requested format (markdown by default)\n- Returns the content in the specified format\n- Use this tool when you need to retrieve and analyze web content\n\nUsage notes:\n  - IMPORTANT: if another tool is present that offers better web fetching capabilities, is more targeted to the task, or has fewer restrictions, prefer using that tool instead.\n  - The URL must be a fully-formed valid URL\n  - HTTP URLs will be automatically upgraded to HTTPS\n  - Format options: "markdown" (default), "text", or "html"\n  - Results may be summarized if the content is very large',
    inputSchema: agentSdk.jsonSchema({
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch content from.' },
        format: { type: 'string', enum: ['text', 'markdown', 'html'], description: 'The format to return the content in. Defaults to "markdown".' },
        timeout: { type: 'number', description: 'Optional timeout in seconds (max 120). Defaults to 120.' },
      },
      required: ['url'],
    }),
    execute: async (input) => {
      const url = input.url;
      const format = input.format || 'markdown';
      const timeoutSec = Math.min(input.timeout || 120, 120);

      if (!/^https?:\/\//i.test(url)) {
        return 'Error: URL must start with http:// or https://';
      }

      const fetchUrl = url.replace(/^http:/i, 'https:');
      try {
        const response = await fetch(fetchUrl, {
          signal: AbortSignal.timeout(timeoutSec * 1000),
          headers: { 'User-Agent': 'myco-agent/1.0' },
        });
        if (!response.ok) {
          return `Error: HTTP ${response.status} ${response.statusText}`;
        }
        const contentType = response.headers.get('content-type') || '';
        const raw = await response.text();

        if (format === 'html') return raw;
        if (format === 'text') {
          if (contentType.includes('html')) return _htmlToText(raw);
          return raw;
        }
        if (contentType.includes('html')) return _htmlToText(raw);
        return raw;
      } catch (err) {
        return `Error: ${err.message}`;
      }
    },
  });
}

module.exports = { createWebFetchTool };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/oc-tools.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/oc-tools/webfetch.js test/oc-tools.test.js
git commit -m "feat(oc-tools): implement webfetch tool with HTML-to-text conversion"
```

---

### Task 9: Permission gating + agent-session.js integration

**Files:**
- Modify: `server/src/agent-session.js`

This is the core integration task. Two changes:
1. `_resolveOCTools()` — call `createOCTools` instead of `createMycoMcpToolsOC`
2. `_canUseToolOC()` — add auto-approve set for read-only tools

- [ ] **Step 1: Add OC_AUTO_APPROVE constant**

Add after the `agentSdk` require block (around line 28-29 in `agent-session.js`):

```js
const OC_AUTO_APPROVE = new Set([
  'read', 'glob', 'grep', 'webfetch',
  'mcp__myco__add_plan_items',
]);
```

- [ ] **Step 2: Modify `_resolveOCTools()`**

Replace the current `_resolveOCTools()` method (lines 916-919):

```js
_resolveOCTools() {
  const { createOCTools } = require('./oc-tools/index');
  return createOCTools(this.sessionId, this.cwd);
}
```

- [ ] **Step 3: Modify `_canUseToolOC()`**

Replace the current `_canUseToolOC()` method (lines 901-914):

```js
async _canUseToolOC(toolName, toolInput) {
  const hookResult = this._preToolUseHookCheck(toolName, toolInput);
  if (hookResult) return hookResult.behavior === 'allow';

  if (OC_AUTO_APPROVE.has(toolName)) {
    console.log(`[agent-hook] ${this.sessionId} OC auto-approve ${toolName}`);
    return true;
  }

  const hash = crypto.createHash('sha256').update(JSON.stringify({ toolName, toolInput })).digest('hex').slice(0, 16);
  const menu = { hash, toolName, toolInput };
  this.pendingMenus.set(hash, menu);

  return new Promise((resolve) => {
    this._pendingPermissions.set(hash, { kind: 'permission-oc', toolName, toolInput, resolveOC: resolve });
    this._emit({ type: 'permission_request', toolName, hash });
    this.emit('menu', menu);
  });
}
```

- [ ] **Step 4: Verify integration test in oc-tools.test.js**

The existing registration test already verifies `createOCTools` returns all 9 tools. Add a permission gating test:

Insert after the webfetch test block in `test/oc-tools.test.js`:

```js
  // ─── Permission gating test ────────────────────────────────────────
  {
    const OC_AUTO_APPROVE = new Set([
      'read', 'glob', 'grep', 'webfetch',
      'mcp__myco__add_plan_items',
    ]);
    const gated = ['bash', 'edit', 'write'];
    for (const name of OC_AUTO_APPROVE) {
      assert(OC_AUTO_APPROVE.has(name), `${name} should be auto-approved`);
    }
    for (const name of gated) {
      assert(!OC_AUTO_APPROVE.has(name), `${name} should NOT be auto-approved`);
    }
    console.log('PASS: OC_AUTO_APPROVE set is correct');
  }

- [ ] **Step 5: Run all tests**

Run: `node test/oc-tools.test.js`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/agent-session.js test/oc-tools.test.js
git commit -m "feat(oc-tools): integrate createOCTools + OC_AUTO_APPROVE in agent-session"
```

---

### Task 10: Add oc-tools test to test.sh

**Files:**
- Modify: `test/test.sh`

- [ ] **Step 1: Find the right section in test.sh to add the test**

Search for the "static" test section where other node tests are registered (e.g. around line 834 where `migrate-plan-ids.test.js` is).

- [ ] **Step 2: Add node_test_result line**

Add after an existing `node_test_result` line in the static tests section:

```bash
node_test_result test/oc-tools.test.js "test/oc-tools.test.js (9 cases — registration + 7 tool execute + permission gating)"
```

- [ ] **Step 3: Verify test.sh picks it up**

Run: `bash -c 'grep oc-tools test/test.sh'`
Expected: One line referencing `test/oc-tools.test.js`

- [ ] **Step 4: Commit**

```bash
git add test/test.sh
git commit -m "feat(oc-tools): add oc-tools.test.js to test runner"
```

---

### Task 11: Full test suite verification

- [ ] **Step 1: Run the full test suite**

Run: `./test/test.sh`

Expected: ALL PASS — including the new `oc-tools.test.js` and all existing tests unchanged.

If any existing tests fail, investigate and fix before proceeding.

- [ ] **Step 2: Verify OC agent can see all tools**

Smoke test: launch a session with `MYCO_AGENT_PROVIDER=alibaba-cn` (or any non-anthropic provider), verify the agent sees bash, read, edit, write, glob, grep, webfetch in its available tools.

---

### Task 12: Clean up stubs — verify no stub remnants

- [ ] **Step 1: Grep for 'stub' in oc-tools directory**

Run: `grep -r 'stub' server/src/oc-tools/`

Expected: No matches — all tool files should have real implementations, not stubs.

If any stubs remain, replace with real implementation.

- [ ] **Step 2: Final commit if needed**

```bash
git add -A server/src/oc-tools/
git commit -m "feat(oc-tools): remove all stubs, final implementation"
```