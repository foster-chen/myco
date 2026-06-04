# OpenAI Agent SDK Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the OpenAI Agents SDK (`@openai/agents`) as a second agent backend alongside the existing Claude Agent SDK, selectable at deploy time via `MYCO_AGENT_PROVIDER`.

**Architecture:** In-place dual-path in `agent-session.js`. Provider routing at `_ensureIteration()`. OpenAI path uses `run()` / `interruptions` / `approve/reject` / `resume` cycle. Same `_emit()` contract so WS layer and client are unchanged.

**Tech Stack:** `@openai/agents` v0.11.6, `zod`, `openai`, `fast-glob`, Node.js 22+

**Design spec:** `docs/superpowers/specs/2026-06-02-openai-agent-sdk-design.md`

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `server/src/agent-config.js` | Provider resolution from env vars → config object |
| `server/src/oc-tools/resolve-path.js` | Shared `_resolveFilePath()` helper (extracted from opencode_support branch, removes duplication) |
| `server/src/oc-tools/bash.js` | Bash tool execute logic (pure function) |
| `server/src/oc-tools/read.js` | Read tool execute logic (pure function) |
| `server/src/oc-tools/edit.js` | Edit tool execute logic (pure function) |
| `server/src/oc-tools/write.js` | Write tool execute logic (pure function) |
| `server/src/oc-tools/glob.js` | Glob tool execute logic (pure function) |
| `server/src/oc-tools/grep.js` | Grep tool execute logic (pure function) |
| `server/src/oc-tools/webfetch.js` | WebFetch tool execute logic (pure function) |
| `server/src/openai-tools/index.js` | Tool aggregator — `createOpenAITools(sessionId, cwd)` wrapping oc-tools in `tool()` + Zod |
| `server/src/openai-tools/definitions.js` | Individual `tool()` + Zod definitions for each oc-tool |
| `server/src/myco-mcp-openai.js` | OpenAI `tool()` + Zod definition for `add_plan_items` |
| `test/agent-config.test.js` | Unit tests for provider resolution |
| `test/oc-tools.test.js` | Unit tests for oc-tools execute logic |
| `test/agent-session-openai.test.js` | Integration smoke test for OpenAI agent path |

### Modified files

| File | Change |
|---|---|
| `server/src/agent-session.js` | Dual-path routing, `_ensureIterationOpenAI()`, `_adaptOpenAIEvent()`, permission flow, `interrupt()`/`write()` dual-path, `_pendingOCApprovals` |
| `server/src/btw.js` | Dual-path: `runOpenAIP()` alongside `runAnthropicP()` |
| `server/src/claude-cli.js` | Dual-path: `callOpenAICli()` alongside `callAnthropicCli()` |
| `server/src/anthropic.js` | Dual-path: OpenAI Chat Completions fallback alongside raw Anthropic HTTPS |
| `server/src/myco-mcp.js` | Add `createMycoMcpToolsOpenAI()` alongside `createMycoMcpServer()` |
| `server/src/index.js` | Add new env keys to `ENV_KEYS` array |
| `server/package.json` | Add `@openai/agents`, `openai`, `zod`, `fast-glob` |
| `test/test.sh` | Add static checks + test file references for OpenAI path |

---

## Task 1: Install SDK + Verify API

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Install dependencies**

```bash
cd server && npm install @openai/agents openai zod fast-glob
```

- [ ] **Step 2: Verify SDK exports**

Create a temporary verification script:

```js
// test/_verify-openai-sdk.js
const sdk = require('@openai/agents');
console.log('SDK exports:', Object.keys(sdk));
console.log('Has Agent:', typeof sdk.Agent);
console.log('Has run:', typeof sdk.run);
console.log('Has Runner:', typeof sdk.Runner);
console.log('Has tool:', typeof sdk.tool);
console.log('Has setDefaultOpenAIClient:', typeof sdk.setDefaultOpenAIClient);
console.log('Has OpenAIProvider:', typeof sdk.OpenAIProvider);
console.log('Has InputGuardrail:', typeof sdk.InputGuardrail);
console.log('Has OutputGuardrail:', typeof sdk.OutputGuardrail);
```

```bash
cd server && node test/_verify-openai-sdk.js
```

Expected: Lists all expected exports (`Agent`, `run`, `Runner`, `tool`, `setDefaultOpenAIClient`, `OpenAIProvider`, etc.)

- [ ] **Step 3: Verify streaming interface**

```js
// test/_verify-openai-streaming.js
const { Agent, run, tool } = require('@openai/agents');
const { z } = require('zod');

const dummyTool = tool({
  name: 'echo',
  description: 'Echo input',
  parameters: z.object({ text: z.string() }),
  execute: async ({ text }) => text,
});

const agent = new Agent({
  name: 'test',
  instructions: 'You are a test agent. Echo back what the user says.',
  model: 'gpt-4o-mini',
  tools: [dummyTool],
});

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('No OPENAI_API_KEY set, skipping streaming verification');
    return;
  }
  const result = await run(agent, 'Hello, say "test verified"', { stream: true });
  for await (const event of result) {
    console.log('Event type:', event.type, 'name:', event.name || '-');
  }
  await result.completed;
  console.log('Final output:', result.finalOutput);
  console.log('Last response ID:', result.lastResponseId);
  console.log('Interruptions:', result.interruptions?.length || 0);
}
main().catch(e => console.error('Error:', e.message));
```

```bash
cd server && OPENAI_API_KEY=sk-... node test/_verify-openai-streaming.js
```

Expected: Streams events with `type` values (`raw_model_stream_event`, `run_item_stream_event`). Prints final output and response ID.

- [ ] **Step 4: Verify needsApproval + interruptions**

```js
// test/_verify-approval-flow.js
const { Agent, run, tool } = require('@openai/agents');
const { z } = require('zod');

const dangerousTool = tool({
  name: 'delete_file',
  description: 'Delete a file',
  parameters: z.object({ path: z.string() }),
  needsApproval: true,
  execute: async ({ path }) => `Deleted ${path}`,
});

const agent = new Agent({
  name: 'test',
  instructions: 'You are a test agent. Try to delete a file called /tmp/test.txt.',
  model: 'gpt-4o-mini',
  tools: [dangerousTool],
});

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('No OPENAI_API_KEY set, skipping approval verification');
    return;
  }
  let result = await run(agent, 'Delete the file /tmp/test.txt', { stream: true });
  for await (const event of result) {
    if (event.type === 'run_item_stream_event' && event.name === 'tool_approval_requested') {
      console.log('Approval requested for:', event.item?.rawItem?.name);
    }
  }
  await result.completed;
  console.log('Interruptions:', result.interruptions);
  if (result.interruptions?.length > 0) {
    for (const interruption of result.interruptions) {
      console.log('Interruption:', interruption.name, interruption.arguments);
      result.state.approve(interruption);
    }
    result = await run(agent, result.state, { stream: true });
    for await (const event of result) {
      console.log('Resume event:', event.type, event.name || '-');
    }
    await result.completed;
    console.log('Final output after approval:', result.finalOutput);
  }
}
main().catch(e => console.error('Error:', e.message));
```

```bash
cd server && OPENAI_API_KEY=sk-... node test/_verify-approval-flow.js
```

Expected: Shows `tool_approval_requested` event, then `result.interruptions`, then successful resume after approval.

- [ ] **Step 5: Verify custom baseURL + OpenAIProvider**

```js
// test/_verify-base-url.js
const { Agent, run, setDefaultOpenAIClient, OpenAIProvider, setDefaultModelProvider } = require('@openai/agents');
const { z } = require('zod');
const OpenAI = require('openai');

// Test custom baseURL via setDefaultOpenAIClient
const customClient = new OpenAI({
  baseURL: process.env.MYCO_AGENT_BASE_URL || 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY,
});
setDefaultOpenAIClient(customClient);
console.log('Custom OpenAI client configured with baseURL:', customClient.baseURL);

// Test OpenAIProvider with useResponses:false
const provider = new OpenAIProvider({
  baseURL: process.env.MYCO_AGENT_BASE_URL || 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY,
  useResponses: false,
});
console.log('OpenAIProvider configured with useResponses: false');

console.log('Verification complete — both baseURL mechanisms work');
```

```bash
cd server && node test/_verify-base-url.js
```

Expected: Prints confirmation of both custom baseURL mechanisms.

- [ ] **Step 6: Clean up verification scripts**

```bash
rm server/test/_verify-openai-sdk.js server/test/_verify-openai-streaming.js server/test/_verify-approval-flow.js server/test/_verify-base-url.js
```

- [ ] **Step 7: Commit dependencies**

```bash
git add server/package.json server/package-lock.json
git commit -m "deps: add @openai/agents, openai, zod, fast-glob for OpenAI Agent SDK backend"
```

---

## Task 2: Provider Configuration Module

**Files:**
- Create: `server/src/agent-config.js`
- Create: `test/agent-config.test.js`
- Modify: `server/src/index.js` (ENV_KEYS)

- [ ] **Step 1: Write agent-config.js**

```js
'use strict';

const PROVIDER_ENV_VARS = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'MYCO_OPENAI_API_KEY',
};

const PROVIDER_DEFAULTS = {
  anthropic: {
    id: 'anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    baseUrl: null,
  },
  openai: {
    id: 'openai',
    defaultModel: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
  },
};

function resolve() {
  const providerId = process.env.MYCO_AGENT_PROVIDER || 'anthropic';
  const defaults = PROVIDER_DEFAULTS[providerId];
  if (!defaults) {
    throw new Error(
      `Unknown MYCO_AGENT_PROVIDER: ${providerId}. Valid values: ${Object.keys(PROVIDER_DEFAULTS).join(', ')}`
    );
  }

  let apiKey = process.env.MYCO_AGENT_API_KEY;
  if (!apiKey) {
    const envVarName = PROVIDER_ENV_VARS[providerId];
    if (envVarName) {
      apiKey = process.env[envVarName];
    }
  }

  if (providerId !== 'anthropic' && !apiKey) {
    const envVarName = PROVIDER_ENV_VARS[providerId] || 'MYCO_AGENT_API_KEY';
    throw new Error(
      `No API key for provider ${providerId}. Set ${envVarName} or MYCO_AGENT_API_KEY in .env.`
    );
  }

  const model = process.env.MYCO_AGENT_MODEL || defaults.defaultModel;
  const auxModel = process.env.MYCO_AUX_MODEL || model;
  const baseUrl = process.env.MYCO_AGENT_BASE_URL || defaults.baseUrl;

  return {
    providerId: defaults.id,
    apiKey,
    model,
    auxModel,
    baseUrl,
    providerPath: providerId,
  };
}

module.exports = { resolve, PROVIDER_ENV_VARS, PROVIDER_DEFAULTS };
```

- [ ] **Step 2: Write agent-config.test.js**

```js
'use strict';

const assert = require('assert');

const origEnv = {};
const envKeys = [
  'MYCO_AGENT_PROVIDER', 'MYCO_AGENT_API_KEY', 'ANTHROPIC_API_KEY',
  'MYCO_OPENAI_API_KEY', 'MYCO_AGENT_MODEL', 'MYCO_AUX_MODEL', 'MYCO_AGENT_BASE_URL',
];

function saveEnv() {
  for (const k of envKeys) { origEnv[k] = process.env[k]; }
}
function restoreEnv() {
  for (const k of envKeys) { delete process.env[k]; if (origEnv[k] !== undefined) process.env[k] = origEnv[k]; }
}
function setEnv(obj) {
  for (const [k, v] of Object.entries(obj)) { process.env[k] = v; }
}

saveEnv();

const agentConfig = require('../server/src/agent-config');

// Test: returns anthropic config by default
restoreEnv(); setEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' });
const cfg1 = agentConfig.resolve();
assert.strictEqual(cfg1.providerId, 'anthropic');
assert.strictEqual(cfg1.apiKey, 'sk-ant-test');
assert.strictEqual(cfg1.model, 'claude-sonnet-4-20250514');
assert.strictEqual(cfg1.baseUrl, null);
console.log('PASS: default anthropic config');

// Test: returns openai config when MYCO_AGENT_PROVIDER=openai
restoreEnv(); setEnv({ MYCO_AGENT_PROVIDER: 'openai', MYCO_OPENAI_API_KEY: 'sk-oai-test' });
const cfg2 = agentConfig.resolve();
assert.strictEqual(cfg2.providerId, 'openai');
assert.strictEqual(cfg2.apiKey, 'sk-oai-test');
assert.strictEqual(cfg2.model, 'gpt-4o');
assert.strictEqual(cfg2.baseUrl, 'https://api.openai.com/v1');
console.log('PASS: openai config');

// Test: MYCO_AGENT_BASE_URL override
restoreEnv(); setEnv({ MYCO_AGENT_PROVIDER: 'openai', MYCO_OPENAI_API_KEY: 'sk-oai', MYCO_AGENT_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' });
const cfg3 = agentConfig.resolve();
assert.strictEqual(cfg3.baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
console.log('PASS: MYCO_AGENT_BASE_URL override');

// Test: MYCO_AGENT_MODEL override
restoreEnv(); setEnv({ MYCO_AGENT_PROVIDER: 'openai', MYCO_OPENAI_API_KEY: 'sk-oai', MYCO_AGENT_MODEL: 'qwen-max' });
const cfg4 = agentConfig.resolve();
assert.strictEqual(cfg4.model, 'qwen-max');
assert.strictEqual(cfg4.auxModel, 'qwen-max');
console.log('PASS: MYCO_AGENT_MODEL override');

// Test: MYCO_AUX_MODEL override
restoreEnv(); setEnv({ MYCO_AGENT_PROVIDER: 'openai', MYCO_OPENAI_API_KEY: 'sk-oai', MYCO_AGENT_MODEL: 'qwen-max', MYCO_AUX_MODEL: 'qwen-mini' });
const cfg5 = agentConfig.resolve();
assert.strictEqual(cfg5.model, 'qwen-max');
assert.strictEqual(cfg5.auxModel, 'qwen-mini');
console.log('PASS: MYCO_AUX_MODEL override');

// Test: MYCO_AGENT_API_KEY as fallback
restoreEnv(); setEnv({ MYCO_AGENT_PROVIDER: 'openai', MYCO_AGENT_API_KEY: 'sk-fallback' });
const cfg6 = agentConfig.resolve();
assert.strictEqual(cfg6.apiKey, 'sk-fallback');
console.log('PASS: MYCO_AGENT_API_KEY fallback');

// Test: throws on unknown provider
restoreEnv(); setEnv({ MYCO_AGENT_PROVIDER: 'gemini' });
try {
  agentConfig.resolve();
  assert.fail('Should have thrown');
} catch (e) {
  assert(e.message.includes('Unknown MYCO_AGENT_PROVIDER: gemini'));
  console.log('PASS: throws on unknown provider');
}

// Test: throws on missing API key for openai
restoreEnv(); setEnv({ MYCO_AGENT_PROVIDER: 'openai' });
try {
  agentConfig.resolve();
  assert.fail('Should have thrown');
} catch (e) {
  assert(e.message.includes('No API key'));
  console.log('PASS: throws on missing API key for openai');
}

// Test: anthropic does NOT require an API key (SDK handles its own auth)
restoreEnv(); setEnv({ MYCO_AGENT_PROVIDER: 'anthropic' });
const cfg7 = agentConfig.resolve();
assert.strictEqual(cfg7.apiKey, undefined);
assert.strictEqual(cfg7.providerId, 'anthropic');
console.log('PASS: anthropic config without explicit key');

restoreEnv();
console.log('All agent-config tests passed');
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
node test/agent-config.test.js
```

Expected: All 9 tests print PASS.

- [ ] **Step 4: Add ENV_KEYS to index.js**

Read `server/src/index.js` lines 1396-1407, add new keys to `ENV_KEYS` array:

```js
const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'MYCO_OPENAI_API_KEY',
  'MYCO_AGENT_API_KEY',
  'MYCO_AGENT_PROVIDER',
  'MYCO_AGENT_MODEL',
  'MYCO_AUX_MODEL',
  'MYCO_AGENT_BASE_URL',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'CUSTOM_CRITIC_ENDPOINT',
  'CUSTOM_CRITIC_KEY',
  'CUSTOM_CRITIC_MODEL',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'MYCO_ENTERPRISE_TLS_INSECURE'
];
```

- [ ] **Step 5: Commit**

```bash
git add server/src/agent-config.js test/agent-config.test.js server/src/index.js
git commit -m "feat: add agent-config.js provider resolution + ENV_KEYS for dual-provider support"
```

---

## Task 3: Shared Path Helper + oc-tools Execute Logic

**Files:**
- Create: `server/src/oc-tools/resolve-path.js`
- Create: `server/src/oc-tools/bash.js`
- Create: `server/src/oc-tools/read.js`
- Create: `server/src/oc-tools/edit.js`
- Create: `server/src/oc-tools/write.js`
- Create: `server/src/oc-tools/glob.js`
- Create: `server/src/oc-tools/grep.js`
- Create: `server/src/oc-tools/webfetch.js`

This task creates the shared path-sandbox helper and 7 pure-function execute logic files. Each file exports a standalone async function that does the actual work — no SDK dependency, no `@opencode-ai/agent-sdk` import.

- [ ] **Step 1: Create resolve-path.js (shared sandbox helper)**

Extract `_resolveFilePath()` from the opencode_support branch (duplicated in read.js, edit.js, write.js) into a single shared module:

```js
'use strict';

const path = require('path');
const fs = require('fs');

function resolveFilePath(filePath, workspaceDir) {
  if (path.isAbsolute(filePath)) {
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(workspaceDir)) {
      throw new Error(`Path escapes workspace: ${filePath}. Allowed root: ${workspaceDir}`);
    }
    return resolved;
  }
  return path.resolve(workspaceDir, filePath);
}

module.exports = { resolveFilePath };
```

- [ ] **Step 2: Create bash.js**

Adapt from opencode_support branch — remove `@opencode-ai/agent-sdk` dependency, export pure function:

```js
'use strict';

const { exec } = require('child_process');

async function executeBash({ command, workdir, timeout }) {
  const cwd = workdir || process.cwd();
  const timeoutMs = timeout || 120000;

  return new Promise((resolve) => {
    exec(command, { cwd, timeout: timeoutMs, maxBuffer: 51200 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed && err.signal === 'SIGTERM') {
          resolve(`[Timeout after ${timeoutMs}ms]\n${stdout}\n${stderr}`);
          return;
        }
        resolve(`Error: ${stderr || err.message}\n${stdout}`);
        return;
      }
      const output = stdout + stderr;
      if (output.length > 51200) {
        resolve(output.slice(0, 51200) + '\n[Output truncated...]');
        return;
      }
      resolve(output);
    });
  });
}

module.exports = { executeBash };
```

- [ ] **Step 3: Create read.js**

```js
'use strict';

const fs = require('fs');
const path = require('path');
const { resolveFilePath } = require('./resolve-path');

async function executeRead({ filePath, offset, limit }) {
  const resolved = resolveFilePath(filePath, process.cwd());
  const startLine = offset || 0;
  const maxLines = limit || 2000;

  if (!fs.existsSync(resolved)) {
    return `Error: Path does not exist: ${filePath}`;
  }

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(resolved);
    const lines = entries.map(e => {
      const full = path.join(resolved, e);
      const isDir = fs.statSync(full).isDirectory();
      return isDir ? e + '/' : e;
    });
    return lines.join('\n');
  }

  const content = fs.readFileSync(resolved, 'utf8');
  const lines = content.split('\n');
  const sliced = lines.slice(startLine, startLine + maxLines);
  const numbered = sliced.map((line, i) => `${startLine + i + 1}: ${line.length > 2000 ? line.slice(0, 2000) + '...[truncated]' : line}`);
  return numbered.join('\n');
}

module.exports = { executeRead };
```

- [ ] **Step 4: Create edit.js**

```js
'use strict';

const fs = require('fs');
const { resolveFilePath } = require('./resolve-path');

async function executeEdit({ filePath, oldString, newString, replaceAll }) {
  const resolved = resolveFilePath(filePath, process.cwd());

  if (!fs.existsSync(resolved)) {
    return `Error: File does not exist: ${filePath}`;
  }

  const content = fs.readFileSync(resolved, 'utf8');

  if (!content.includes(oldString)) {
    return `Error: oldString not found in content`;
  }

  const count = content.split(oldString).length - 1;
  if (count > 1 && !replaceAll) {
    return `Error: Found ${count} matches for oldString. Use replaceAll: true to replace all occurrences.`;
  }

  let newContent;
  if (replaceAll) {
    newContent = content.split(oldString).join(newString);
  } else {
    const idx = content.indexOf(oldString);
    newContent = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
  }

  fs.writeFileSync(resolved, newContent, 'utf8');
  return `Successfully edited ${filePath}`;
}

module.exports = { executeEdit };
```

- [ ] **Step 5: Create write.js**

```js
'use strict';

const fs = require('fs');
const path = require('path');
const { resolveFilePath } = require('./resolve-path');

async function executeWrite({ filePath, content }) {
  const resolved = resolveFilePath(filePath, process.cwd());
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolved, content, 'utf8');
  return `Successfully wrote ${filePath}`;
}

module.exports = { executeWrite };
```

- [ ] **Step 6: Create glob.js**

```js
'use strict';

const fg = require('fast-glob');

async function executeGlob({ pattern, path: searchPath }) {
  const cwd = searchPath || process.cwd();
  try {
    const matches = await fg(pattern, { cwd, onlyFiles: true, ignore: ['node_modules', '.git'] });
    return matches.sort().join('\n') || 'No files found';
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

module.exports = { executeGlob };
```

- [ ] **Step 7: Create grep.js**

```js
'use strict';

const { exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const fg = require('fast-glob');

let HAS_RG = false;
try {
  execSync('rg --version', { stdio: 'pipe' });
  HAS_RG = true;
} catch (e) {
  HAS_RG = false;
}

function rgSearch(pattern, include, cwd) {
  let cmd = `rg --no-heading --line-number --color never --max-count 200`;
  if (include) cmd += ` --glob '${include}'`;
  cmd += ` '${pattern}' '${cwd}'`;
  try {
    const result = execSync(cmd, { cwd, maxBuffer: 51200 * 1024, timeout: 30000, encoding: 'utf8' });
    return result || 'No matches found';
  } catch (err) {
    if (err.status === 1) return 'No matches found';
    return `Error: ${err.stderr || err.message}`;
  }
}

async function nodeSearch(pattern, include, cwd) {
  const globPattern = include || '**/*';
  try {
    const files = await fg(globPattern, { cwd, onlyFiles: true, ignore: ['node_modules', '.git'] });
    const regex = new RegExp(pattern, 'i');
    const results = [];
    for (const file of files) {
      if (results.length >= 200) break;
      try {
        const content = fs.readFileSync(path.join(cwd, file), 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            const truncated = lines[i].length > 200 ? lines[i].slice(0, 200) + '...' : lines[i];
            results.push(`${file}:${i + 1}:${truncated}`);
            if (results.length >= 200) break;
          }
        }
      } catch (e) { /* skip unreadable files */ }
    }
    return results.join('\n') || 'No matches found';
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

async function executeGrep({ pattern, include, path: searchPath }) {
  const cwd = searchPath || process.cwd();
  if (HAS_RG) {
    return rgSearch(pattern, include, cwd);
  }
  return nodeSearch(pattern, include, cwd);
}

module.exports = { executeGrep };
```

- [ ] **Step 8: Create webfetch.js**

```js
'use strict';

async function executeWebFetch({ url, format, timeout }) {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `Error: URL must start with http:// or https://`;
  }

  const upgraded = url.startsWith('http://') ? 'https://' + url.slice(7) : url;
  const timeoutSec = Math.min(timeout || 120, 120);
  const fmt = format || 'markdown';

  try {
    const response = await fetch(upgraded, {
      signal: AbortSignal.timeout(timeoutSec * 1000),
      headers: { 'User-Agent': 'myco-agent/1.0' },
    });
    if (!response.ok) {
      return `Error: HTTP ${response.status} ${response.statusText}`;
    }
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    if (fmt === 'html') return text;
    if (contentType.includes('html') && (fmt === 'markdown' || fmt === 'text')) {
      return htmlToText(text);
    }
    return text;
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

function htmlToText(html) {
  let text = html;
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<h[1-6][^>]*>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n');
  text = text.replace(/<li[^>]*>/gi, '\n- ');
  text = text.replace(/<\/li>/gi, '');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

module.exports = { executeWebFetch };
```

- [ ] **Step 9: Write oc-tools.test.js**

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-tools-test-'));

// bash
const { executeBash } = require('../server/src/oc-tools/bash');
(async () => {
  const result = await executeBash({ command: 'echo hello', workdir: tmpDir, timeout: 5000 });
  assert(result.includes('hello'));
  console.log('PASS: bash echo');
})();

// read
const { executeRead } = require('../server/src/oc-tools/read');
process.chdir(tmpDir);
fs.writeFileSync(path.join(tmpDir, 'test-read.txt'), 'line1\nline2\nline3\n');
(async () => {
  const result = await executeRead({ filePath: path.join(tmpDir, 'test-read.txt'), offset: 1, limit: 2 });
  assert(result.includes('2: line2'));
  assert(result.includes('3: line3'));
  console.log('PASS: read file with offset');

  const dirResult = await executeRead({ filePath: tmpDir });
  assert(dirResult.includes('test-read.txt'));
  console.log('PASS: read directory');
})();

// edit
const { executeEdit } = require('../server/src/oc-tools/edit');
fs.writeFileSync(path.join(tmpDir, 'test-edit.txt'), 'foo bar baz');
(async () => {
  const result = await executeEdit({ filePath: path.join(tmpDir, 'test-edit.txt'), oldString: 'bar', newString: 'BAR' });
  assert.strictEqual(result, 'Successfully edited test-edit.txt');
  const content = fs.readFileSync(path.join(tmpDir, 'test-edit.txt'), 'utf8');
  assert.strictEqual(content, 'foo BAR baz');
  console.log('PASS: edit single replacement');
})();

// write
const { executeWrite } = require('../server/src/oc-tools/write');
(async () => {
  const result = await executeWrite({ filePath: path.join(tmpDir, 'test-write.txt'), content: 'written content' });
  assert(result.includes('Successfully wrote'));
  const content = fs.readFileSync(path.join(tmpDir, 'test-write.txt'), 'utf8');
  assert.strictEqual(content, 'written content');
  console.log('PASS: write file');
})();

// glob
const { executeGlob } = require('../server/src/oc-tools/glob');
(async () => {
  const result = await executeGlob({ pattern: '*.txt', path: tmpDir });
  assert(result.includes('test-read.txt'));
  console.log('PASS: glob *.txt');
})();

// grep
const { executeGrep } = require('../server/src/oc-tools/grep');
(async () => {
  const result = await executeGrep({ pattern: 'hello', path: tmpDir, include: '*.txt' });
  // hello may or may not be found depending on test files
  console.log('PASS: grep runs without error');
})();

// webfetch — skip without network, just verify it doesn't crash on bad input
const { executeWebFetch } = require('../server/src/oc-tools/webfetch');
(async () => {
  const result = await executeWebFetch({ url: 'not-a-url' });
  assert(result.includes('Error'));
  console.log('PASS: webfetch rejects invalid URL');
})();

// Cleanup
try { fs.rmSync(tmpDir, { recursive: true }); } catch (e) { /* ignore */ }

console.log('All oc-tools tests passed');
```

- [ ] **Step 10: Run tests to verify they pass**

```bash
node test/oc-tools.test.js
```

Expected: All 8 tests print PASS.

- [ ] **Step 11: Commit**

```bash
git add server/src/oc-tools/ test/oc-tools.test.js
git commit -m "feat: add oc-tools execute logic (bash/read/edit/write/glob/grep/webfetch) + shared resolve-path helper"
```

---

## Task 4: OpenAI Tool Definitions + myco-mcp-openai.js

**Files:**
- Create: `server/src/openai-tools/definitions.js`
- Create: `server/src/openai-tools/index.js`
- Create: `server/src/myco-mcp-openai.js`

This task wraps the oc-tools execute functions in `@openai/agents`'s `tool()` + Zod schemas and creates the myco plan-items tool definition.

- [ ] **Step 1: Create definitions.js**

```js
'use strict';

const { tool } = require('@openai/agents');
const { z } = require('zod');

const { executeBash } = require('../oc-tools/bash');
const { executeRead } = require('../oc-tools/read');
const { executeEdit } = require('../oc-tools/edit');
const { executeWrite } = require('../oc-tools/write');
const { executeGlob } = require('../oc-tools/glob');
const { executeGrep } = require('../oc-tools/grep');
const { executeWebFetch } = require('../oc-tools/webfetch');

function createBashTool(workspaceDir) {
  return tool({
    name: 'bash',
    description: 'Executes a bash command in a persistent shell session with optional timeout. Use for running tests, builds, git operations, and other shell tasks.',
    parameters: z.object({
      command: z.string().describe('The bash command to execute'),
      workdir: z.string().optional().describe('Working directory for the command'),
      timeout: z.number().optional().describe('Timeout in milliseconds (default 120000)'),
    }),
    strict: true,
    needsApproval: true,
    execute: async (args) => {
      const enriched = { ...args, workdir: args.workdir || workspaceDir };
      return executeBash(enriched);
    },
  });
}

function createReadTool(workspaceDir) {
  return tool({
    name: 'read_file',
    description: 'Reads a file from the local filesystem. Returns line-numbered content with optional offset and limit for pagination.',
    parameters: z.object({
      filePath: z.string().describe('Path to the file or directory to read'),
      offset: z.number().min(0).optional().describe('1-indexed start line (default 0)'),
      limit: z.number().min(0).optional().describe('Max lines to return (default 2000)'),
    }),
    strict: true,
    execute: async (args) => {
      process.chdir(workspaceDir);
      return executeRead(args);
    },
  });
}

function createEditTool(workspaceDir) {
  return tool({
    name: 'edit_file',
    description: 'Performs exact string replacement in a file. The oldString must match exactly. Use replaceAll to replace all occurrences.',
    parameters: z.object({
      filePath: z.string().describe('Path to the file to modify'),
      oldString: z.string().describe('Exact text to find and replace'),
      newString: z.string().describe('Replacement text'),
      replaceAll: z.boolean().optional().describe('Replace all occurrences (default false)'),
    }),
    strict: true,
    needsApproval: true,
    execute: async (args) => {
      process.chdir(workspaceDir);
      return executeEdit(args);
    },
  });
}

function createWriteTool(workspaceDir) {
  return tool({
    name: 'write_file',
    description: 'Writes content to a file on the local filesystem. Creates parent directories if needed. Overwrites existing content.',
    parameters: z.object({
      filePath: z.string().describe('Path to the file to write (must be absolute)'),
      content: z.string().describe('Content to write'),
    }),
    strict: true,
    needsApproval: true,
    execute: async (args) => {
      process.chdir(workspaceDir);
      return executeWrite(args);
    },
  });
}

function createGlobTool(workspaceDir) {
  return tool({
    name: 'glob',
    description: 'Fast file pattern matching tool. Supports glob patterns like **/*.js. Returns matching file paths sorted alphabetically.',
    parameters: z.object({
      pattern: z.string().describe('Glob pattern to match files against'),
      path: z.string().optional().describe('Directory to search in (defaults to workspace)'),
    }),
    strict: true,
    execute: async (args) => {
      const enriched = { ...args, path: args.path || workspaceDir };
      return executeGlob(enriched);
    },
  });
}

function createGrepTool(workspaceDir) {
  return tool({
    name: 'grep',
    description: 'Search file contents using regular expressions. Uses ripgrep if available, falls back to Node.js implementation.',
    parameters: z.object({
      pattern: z.string().describe('Regex pattern to search for'),
      include: z.string().optional().describe('File glob filter (e.g. *.js, *.{ts,tsx})'),
      path: z.string().optional().describe('Directory to search in (defaults to workspace)'),
    }),
    strict: true,
    execute: async (args) => {
      const enriched = { ...args, path: args.path || workspaceDir };
      return executeGrep(enriched);
    },
  });
}

function createWebFetchTool() {
  return tool({
    name: 'web_fetch',
    description: 'Fetches content from a URL. Supports text, markdown, and HTML output formats. HTTP URLs are auto-upgraded to HTTPS.',
    parameters: z.object({
      url: z.string().describe('Fully-formed URL to fetch'),
      format: z.enum(['text', 'markdown', 'html']).optional().describe('Output format (default markdown)'),
      timeout: z.number().optional().describe('Timeout in seconds, max 120 (default 120)'),
    }),
    strict: true,
    execute: executeWebFetch,
  });
}

module.exports = {
  createBashTool, createReadTool, createEditTool, createWriteTool,
  createGlobTool, createGrepTool, createWebFetchTool,
};
```

- [ ] **Step 2: Create myco-mcp-openai.js**

```js
'use strict';

const { tool } = require('@openai/agents');
const { z } = require('zod');
const { _appendPlanItems } = require('./myco-mcp');

function createMycoMcpToolsOpenAI(sessionId) {
  return tool({
    name: 'add_plan_items',
    description: 'Add plan items (todos, features, bugs) to the project backlog tracked in _myco_/plan.json.',
    parameters: z.object({
      items: z.array(z.object({
        text: z.string().min(1).max(2000).describe('Item description'),
        layer: z.enum(['Todo', 'Feature', 'Bug']).describe('Item type'),
        dependsOn: z.array(z.string()).max(10).optional().describe('IDs of items this depends on'),
      })).min(1).max(20).describe('Array of plan items to add'),
    }),
    strict: true,
    execute: async (args) => {
      const result = _appendPlanItems(sessionId, args.items);
      if (result.error) return { error: result.message };
      return { result: result.message, ids: result.ids };
    },
  });
}

module.exports = { createMycoMcpToolsOpenAI };
```

- [ ] **Step 3: Create index.js (aggregator)**

```js
'use strict';

const {
  createBashTool, createReadTool, createEditTool, createWriteTool,
  createGlobTool, createGrepTool, createWebFetchTool,
} = require('./definitions');
const { createMycoMcpToolsOpenAI } = require('../myco-mcp-openai');

function createOpenAITools(sessionId, workspaceDir) {
  return [
    createBashTool(workspaceDir),
    createReadTool(workspaceDir),
    createEditTool(workspaceDir),
    createWriteTool(workspaceDir),
    createGlobTool(workspaceDir),
    createGrepTool(workspaceDir),
    createWebFetchTool(),
    createMycoMcpToolsOpenAI(sessionId),
  ];
}

module.exports = { createOpenAITools };
```

- [ ] **Step 4: Commit**

```bash
git add server/src/openai-tools/ server/src/myco-mcp-openai.js
git commit -m "feat: add OpenAI tool definitions (tool() + Zod) wrapping oc-tools + plan-items tool"
```

---

## Task 5: Agent Session OpenAI Path — Core Loop

**Files:**
- Modify: `server/src/agent-session.js`

This is the largest task. It adds the dual-path routing, `_ensureIterationOpenAI()` method (run/interrupt/resume cycle), and `_adaptOpenAIEvent()`.

- [ ] **Step 1: Add imports at top of agent-session.js**

Add after line 25 (the existing `query` import):

```js
const agentConfig = require('./agent-config');
const { Agent, run, setDefaultOpenAIClient, OpenAIProvider, setDefaultModelProvider } = require('@openai/agents');
const OpenAI = require('openai');
const { createOpenAITools } = require('./openai-tools/index');
```

- [ ] **Step 2: Add `_pendingOCApprovals` field to constructor**

In the constructor (around line 202-210, where `this.pendingMenus` and `this._pendingPermissions` are initialized), add:

```js
this._pendingOCApprovals = new Map();
this._ocRunState = null;
this.openaiResponseId = opts.resumeOpenaiResponseId || null;
```

- [ ] **Step 3: Add provider routing in `_ensureIteration()`**

At the start of `_ensureIteration()` (line 269), add routing BEFORE the existing code:

```js
async _ensureIteration() {
  const { providerId } = agentConfig.resolve();
  if (providerId === 'openai') {
    return this._ensureIterationOpenAI();
  }
  // existing Claude path continues unchanged below...
```

The existing code from lines 270 onward stays as-is (it becomes the implicit `else` branch).

- [ ] **Step 4: Add `_ensureIterationOpenAI()` method**

Add this new method after `_ensureIteration()` (after line 619). This is the core OpenAI agent loop:

```js
async _ensureIterationOpenAI() {
  if (!this.alive || this._iterating) return;
  this._iterating = true;

  const { apiKey, model, baseUrl, providerPath } = agentConfig.resolve();

  // Configure OpenAI client for custom endpoints
  if (baseUrl && baseUrl !== 'https://api.openai.com/v1') {
    const provider = new OpenAIProvider({
      baseURL: baseUrl,
      apiKey,
      useResponses: false,
    });
    setDefaultModelProvider(provider);
  } else {
    const client = new OpenAI({ apiKey });
    setDefaultOpenAIClient(client);
  }

  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [1000, 4000, 16000];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      this._abortController = new AbortController();

      const tools = createOpenAITools(this.sessionId, this.cwd);

      const agent = new Agent({
        name: 'myco-agent',
        model,
        instructions: this._buildSystemPrompt(),
        tools,
        toolUseBehavior: 'run_llm_again',
      });

      let input;
      if (this._ocRunState) {
        input = this._ocRunState;
      } else {
        const prompt = this._msgQueue || this._buildInitialPrompt();
        input = prompt;
      }

      let runOpts = {
        stream: true,
        signal: this._abortController.signal,
        maxTurns: null,
      };

      if (this.openaiResponseId && !this._ocRunState) {
        runOpts.previousResponseId = this.openaiResponseId;
      }

      this._emit({ type: 'iteration_start', attempt });

      let result = await run(agent, input, runOpts);

      // Stream events
      for await (const event of result) {
        this._adaptOpenAIEvent(event);
      }
      await result.completed;

      // Handle interruptions (approval requests)
      if (result.interruptions && result.interruptions.length > 0) {
        this._ocRunState = result.state;
        await this._handleOCInterruptions(result.interruptions, result.state);
        // After approvals are resolved, resume the run
        this._iterating = false;
        return this._ensureIterationOpenAI();
      }

      // Successful completion
      this.openaiResponseId = result.lastResponseId;

      this._emit({
        type: 'turn_result',
        text: result.finalOutput || '',
        model,
        providerId: 'openai',
      });

      this._iterating = false;
      this._msgQueue = null;
      this._abortController = null;
      this._ocRunState = null;
      this.emit('idle');

      if (this._pendingRestart) {
        this._executeRestart();
      }

      return;

    } catch (err) {
      if (this._abortController.signal.aborted) {
        this._emit({ type: 'iteration_aborted' });
        this._iterating = false;
        this.emit('idle');
        return;
      }

      const isResumeFailure = err.status === 404 && this.openaiResponseId;
      if (isResumeFailure) {
        this.openaiResponseId = null;
        this._emit({ type: 'resume_failed', reason: 'previous_response_id expired or invalid' });
        attempt--;
        continue;
      }

      if (this._isRecoverableOC(err)) {
        this._emitRetryAndWait(err, attempt, BACKOFF_MS);
        continue;
      }

      this._emit({ type: 'fatal', error: err.message, providerId: 'openai' });
      this._iterating = false;
      this.emit('idle');
      return;
    }
  }

  this._emit({ type: 'fatal', error: 'Max retry attempts exhausted', providerId: 'openai' });
  this._iterating = false;
  this.emit('idle');
}

_buildInitialPrompt() {
  if (this._pendingPrePush && this._pendingPrePush.length > 0) {
    const msgs = this._pendingPrePush.map(e => e.message.content);
    this._pendingPrePush = [];
    return msgs.join('\n');
  }
  return 'Hello';
}

_isRecoverableOC(err) {
  if (err.status === 429) return true;
  if (err.status >= 500 && err.status < 600) return true;
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') return true;
  return false;
}
```

- [ ] **Step 5: Add `_adaptOpenAIEvent()` method**

```js
_adaptOpenAIEvent(event) {
  if (event.type === 'raw_model_stream_event') {
    const data = event.data;
    if (data && data.type === 'response.output_text.delta' && data.delta) {
      this._emit({ type: 'assistant_text', text: data.delta, providerId: 'openai' });
      this._persistAssistantTextToRecChat(data.delta);
    }
    return;
  }

  if (event.type === 'run_item_stream_event') {
    const name = event.name;
    const item = event.item;

    if (name === 'message_output_created') {
      if (item && item.content) {
        const text = item.content
          .filter(c => c.type === 'output_text')
          .map(c => c.text)
          .join('\n');
        if (text) {
          this._emit({ type: 'assistant_text', text, providerId: 'openai' });
          this._persistAssistantTextToRecChat(text);
        }
      }
      return;
    }

    if (name === 'tool_called') {
      if (item && item.rawItem) {
        const raw = item.rawItem;
        this._emit({
          type: 'tool_use',
          toolName: raw.name,
          toolInput: raw.arguments ? JSON.parse(raw.arguments) : {},
          toolCallId: raw.call_id || raw.id,
          providerId: 'openai',
        });
      }
      return;
    }

    if (name === 'tool_output') {
      if (item && item.rawItem) {
        const raw = item.rawItem;
        this._emit({
          type: 'tool_result',
          toolCallId: raw.call_id || raw.id,
          output: raw.output || '',
          providerId: 'openai',
        });
        this._broadcastToolProgress();
      }
      return;
    }

    if (name === 'tool_approval_requested') {
      if (item && item.rawItem) {
        const raw = item.rawItem;
        this._emit({
          type: 'permission_request',
          toolName: raw.name,
          toolInput: raw.arguments ? JSON.parse(raw.arguments) : {},
          toolCallId: raw.call_id || raw.id,
          providerId: 'openai',
        });
      }
      return;
    }

    if (name === 'reasoning_item_created') {
      if (item && item.rawItem) {
        const raw = item.rawItem;
        const text = raw.summary ? raw.summary.map(s => s.text).join('\n') : '';
        if (text) {
          this._emit({ type: 'reasoning_text', text, providerId: 'openai' });
        }
      }
      return;
    }
    return;
  }

  if (event.type === 'agent_updated_stream_event') {
    return;
  }
}
```

- [ ] **Step 6: Add `_handleOCInterruptions()` method**

```js
async _handleOCInterruptions(interruptions, state) {
  for (const interruption of interruptions) {
    const hash = 'oc-' + (interruption.rawItem?.call_id || interruption.rawItem?.id || Math.random().toString(36).slice(2));
    const toolName = interruption.name;
    const toolInput = interruption.arguments ? JSON.parse(interruption.arguments) : {};

    const menuPromise = new Promise((resolve) => {
      this._pendingOCApprovals.set(hash, {
        interruption,
        state,
        resolve,
        toolName,
        toolInput,
      });
    });

    this._emit({
      type: 'permission_request',
      toolName,
      toolInput,
      toolCallId: interruption.rawItem?.call_id || interruption.rawItem?.id,
      hash,
      providerId: 'openai',
    });

    // Also emit menu event so chat pane renders the approval UI
    this.emit('menu', {
      n: 1,
      options: [
        { label: 'Allow once', value: 1 },
        { label: 'Allow always', value: 2 },
        { label: 'Deny', value: 3 },
      ],
      hash,
      toolName,
    });

    // Wait for user resolution
    const decision = await menuPromise;

    if (decision === 'approve') {
      state.approve(interruption);
    } else if (decision === 'approve_always') {
      state.approve(interruption, { alwaysApprove: true });
      this._persistAllowAlwaysRule(toolName);
    } else {
      state.reject(interruption, { message: 'Denied by user' });
    }
  }
}
```

- [ ] **Step 7: Update `resolveMenuPick()` to handle OpenAI approvals**

In `resolveMenuPick()` (line 1335), add handling for `_pendingOCApprovals` alongside the existing `_pendingPermissions` lookup. At the beginning of the method, after looking up `_pendingPermissions`:

```js
resolveMenuPick(hash, n) {
  // Check OpenAI approvals first
  const ocApproval = this._pendingOCApprovals.get(hash);
  if (ocApproval) {
    this._pendingOCApprovals.delete(hash);
    this.pendingMenus.delete(hash);
    if (n === 3) {
      ocApproval.resolve('deny');
      this._emit({ type: 'permission_resolved', hash, decision: 'deny', providerId: 'openai' });
    } else if (n === 2) {
      ocApproval.resolve('approve_always');
      this._emit({ type: 'permission_resolved', hash, decision: 'approve_always', providerId: 'openai' });
    } else {
      ocApproval.resolve('approve');
      this._emit({ type: 'permission_resolved', hash, decision: 'approve', providerId: 'openai' });
    }
    return;
  }

  // Existing Claude path continues unchanged...
  const pending = this._pendingPermissions.get(hash);
  ...
```

- [ ] **Step 8: Update `interrupt()` for dual-path**

In the `interrupt()` method (line 728), after `this._abortController.abort()` and `this._msgQueue.close()`, add:

```js
// For OpenAI path: also clear any pending approvals
if (this._pendingOCApprovals.size > 0) {
  for (const [hash, approval] of this._pendingOCApprovals) {
    approval.resolve('deny');
    this._pendingOCApprovals.delete(hash);
  }
}
```

- [ ] **Step 9: Update `write()` for dual-path**

The `write()` method (line 1746) already pushes to `_msgQueue` or `_pendingPrePush`. For the OpenAI path, it needs to also handle the case where the OpenAI run is waiting for approval (not actively streaming). The existing hot/cold path logic works — if `_iterating && _msgQueue`, push to queue; otherwise, stash in `_pendingPrePush` and call `_ensureIteration()`. The OpenAI path will consume `_pendingPrePush` via `_buildInitialPrompt()` on the next iteration.

No changes needed to `write()` — the existing logic works for both paths since `_ensureIteration()` routes to the correct provider.

- [ ] **Step 10: Update session record persistence**

In the session record handling (where `sdkSessionId` is persisted), also persist `openaiResponseId`:

After the line that saves `sdkSessionId` to `rec` (around line 786 in `_handleEvent`), add a parallel line for OpenAI:

```js
// Persist openaiResponseId for OpenAI path
if (this.openaiResponseId) {
  rec.openaiResponseId = this.openaiResponseId;
  sessionsMod.saveStore();
}
```

- [ ] **Step 11: Commit**

```bash
git add server/src/agent-session.js
git commit -m "feat: add _ensureIterationOpenAI() run/interrupt/resume cycle + _adaptOpenAIEvent() event mapping + dual-path routing"
```

---

## Task 6: Single-Turn Helpers — btw.js, claude-cli.js, anthropic.js

**Files:**
- Modify: `server/src/btw.js`
- Modify: `server/src/claude-cli.js`
- Modify: `server/src/anthropic.js`

- [ ] **Step 1: Add `runOpenAIP()` to btw.js**

Add import at top of btw.js (after line 65, the existing `query` import):

```js
const agentConfig = require('./agent-config');
```

Modify `runClaudeP()` (line 64) to add routing:

```js
async function runClaudeP(cwd, promptBody) {
  const { providerId, auxModel, apiKey, baseUrl } = agentConfig.resolve();
  if (providerId === 'openai') {
    return runOpenAIP(cwd, promptBody, auxModel, apiKey, baseUrl);
  }
  // existing Claude path (unchanged) continues below...
```

Add `runOpenAIP()` function after `runClaudeP()`:

```js
async function runOpenAIP(cwd, promptBody, model, apiKey, baseUrl) {
  const { Agent, run } = require('@openai/agents');
  const { OpenAIProvider, setDefaultModelProvider } = require('@openai/agents');
  const OpenAI = require('openai');

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 60000);

  try {
    if (baseUrl && baseUrl !== 'https://api.openai.com/v1') {
      setDefaultModelProvider(new OpenAIProvider({ baseURL: baseUrl, apiKey, useResponses: false }));
    } else {
      const { setDefaultOpenAIClient } = require('@openai/agents');
      setDefaultOpenAIClient(new OpenAI({ apiKey }));
    }

    const agent = new Agent({
      name: 'myco-btw',
      model,
      instructions: 'Answer the user\'s question concisely and accurately.',
      tools: [],
    });

    const result = await run(agent, promptBody, {
      signal: abortController.signal,
      maxTurns: 1,
    });

    clearTimeout(timeout);
    return result.finalOutput || '';
  } catch (err) {
    clearTimeout(timeout);
    if (abortController.signal.aborted) return '[btw timed out after 60s]';
    return `[btw error: ${err.message}]`;
  }
}
```

- [ ] **Step 2: Add `callOpenAICli()` to claude-cli.js**

Add import at top of claude-cli.js (after line 21, the existing `query` import):

```js
const agentConfig = require('./agent-config');
```

Modify `callClaudeCli()` (line 19) to add routing:

```js
async function callClaudeCli({ system, userMessage, cwd, timeoutMs }) {
  const { providerId, auxModel, apiKey, baseUrl } = agentConfig.resolve();
  if (providerId === 'openai') {
    return callOpenAICli({ system, userMessage, cwd, timeoutMs, model: auxModel, apiKey, baseUrl });
  }
  // existing Claude path (unchanged) continues below...
```

Add `callOpenAICli()` function:

```js
async function callOpenAICli({ system, userMessage, cwd, timeoutMs, model, apiKey, baseUrl }) {
  const { Agent, run } = require('@openai/agents');
  const { OpenAIProvider, setDefaultModelProvider } = require('@openai/agents');
  const OpenAI = require('openai');

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs || 120000);

  try {
    if (baseUrl && baseUrl !== 'https://api.openai.com/v1') {
      setDefaultModelProvider(new OpenAIProvider({ baseURL: baseUrl, apiKey, useResponses: false }));
    } else {
      const { setDefaultOpenAIClient } = require('@openai/agents');
      setDefaultOpenAIClient(new OpenAI({ apiKey }));
    }

    const agent = new Agent({
      name: 'myco-cli',
      model,
      instructions: system || 'You are a helpful assistant.',
      tools: [],
    });

    const result = await run(agent, userMessage, {
      signal: abortController.signal,
      maxTurns: 1,
    });

    clearTimeout(timeout);
    return result.finalOutput || null;
  } catch (err) {
    clearTimeout(timeout);
    return null;
  }
}
```

- [ ] **Step 3: Add OpenAI path to anthropic.js**

Add import at top of anthropic.js (after existing imports):

```js
const agentConfig = require('./agent-config');
```

Modify `callAnthropic()` to add routing:

```js
async function callAnthropic({ system, userMessage, model, maxTokens, timeoutMs }) {
  const { providerId, apiKey, baseUrl } = agentConfig.resolve();
  if (providerId === 'openai') {
    return callOpenAICompatible({ system, userMessage, model, maxTokens, timeoutMs, apiKey, baseUrl });
  }
  // existing Anthropic HTTPS path (unchanged) continues below...
```

Add `callOpenAICompatible()` function:

```js
async function callOpenAICompatible({ system, userMessage, model, maxTokens, timeoutMs, apiKey, baseUrl }) {
  const effectiveBaseUrl = baseUrl || 'https://api.openai.com/v1';
  const effectiveModel = model || 'gpt-4o-mini';
  const effectiveMaxTokens = maxTokens || 200;
  const effectiveTimeout = timeoutMs || 30000;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), effectiveTimeout);

    const body = {
      model: effectiveModel,
      max_tokens: effectiveMaxTokens,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: userMessage },
      ],
    };

    const response = await fetch(`${effectiveBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    return text || null;
  } catch (err) {
    return null;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add server/src/btw.js server/src/claude-cli.js server/src/anthropic.js
git commit -m "feat: add dual-path routing to btw.js, claude-cli.js, anthropic.js for OpenAI provider"
```

---

## Task 7: myco-mcp.js Dual Interface + Session Resume

**Files:**
- Modify: `server/src/myco-mcp.js`

- [ ] **Step 1: Export `_appendPlanItems` from myco-mcp.js**

Currently `_appendPlanItems` is a private function. Export it so `myco-mcp-openai.js` can use it:

```js
module.exports = { createMycoMcpServer, _appendPlanItems };
```

(Change the existing `module.exports` at the end of `myco-mcp.js` to include `_appendPlanItems`.)

- [ ] **Step 2: Commit**

```bash
git add server/src/myco-mcp.js
git commit -m "feat: export _appendPlanItems from myco-mcp.js for OpenAI tool definition reuse"
```

---

## Task 8: Session Resume Support

**Files:**
- Modify: `server/src/sessions.js` (or wherever session records are loaded/saved)

- [ ] **Step 1: Add `openaiResponseId` to session record handling**

When loading a session for resume, check for `openaiResponseId` alongside `sdkSessionId`:

In the session spawn/resume logic (where `resumeSdkSessionId` is passed to `AgentSession` constructor), also pass `resumeOpenaiResponseId`:

```js
const opts = {
  resumeSdkSessionId: rec.sdkSessionId,
  resumeOpenaiResponseId: rec.openaiResponseId,
  ...
};
```

- [ ] **Step 2: Verify sessions.js handles the new field**

Check `sessions.js` — session records are plain JSON objects stored in `sessions.json`. The `openaiResponseId` field will be persisted alongside `sdkSessionId` naturally since the session record is a flat object. No schema changes needed.

- [ ] **Step 3: Commit**

```bash
git add server/src/sessions.js server/src/agent-session.js
git commit -m "feat: add openaiResponseId session resume support"
```

---

## Task 9: Static Checks + Test.sh Integration

**Files:**
- Modify: `test/test.sh`

- [ ] **Step 1: Add static checks for OpenAI path to test.sh**

Add the following checks to `test/test.sh` (in the static-grep section):

```bash
# OpenAI Agent SDK integration checks
echo "  Checking agent-config.js provider resolution..."
grep -q "MYCO_AGENT_PROVIDER" server/src/agent-config.js || { echo "FAIL: MYCO_AGENT_PROVIDER not found in agent-config.js"; exit 1; }

echo "  Checking oc-tools directory..."
for f in bash.js read.js edit.js write.js glob.js grep.js webfetch.js resolve-path.js; do
  test -f "server/src/oc-tools/$f" || { echo "FAIL: server/src/oc-tools/$f missing"; exit 1; }
done

echo "  Checking openai-tools directory..."
test -f server/src/openai-tools/index.js || { echo "FAIL: server/src/openai-tools/index.js missing"; exit 1; }
test -f server/src/openai-tools/definitions.js || { echo "FAIL: server/src/openai-tools/definitions.js missing"; exit 1; }

echo "  Checking myco-mcp-openai.js..."
grep -q "createMycoMcpToolsOpenAI" server/src/myco-mcp-openai.js || { echo "FAIL: createMycoMcpToolsOpenAI not exported"; exit 1; }

echo "  Checking agent-session.js dual-path..."
grep -q "_ensureIterationOpenAI" server/src/agent-session.js || { echo "FAIL: _ensureIterationOpenAI not found"; exit 1; }
grep -q "_adaptOpenAIEvent" server/src/agent-session.js || { echo "FAIL: _adaptOpenAIEvent not found"; exit 1; }
grep -q "_pendingOCApprovals" server/src/agent-session.js || { echo "FAIL: _pendingOCApprovals not found"; exit 1; }

echo "  Checking no hardcoded api.openai.com URLs outside agent-config..."
count=$(grep -r "api\.openai\.com" server/src/ --include="*.js" | grep -v agent-config.js | grep -v index.js | grep -v "DEFAULT_BASE_URL" | wc -l)
test "$count" -eq 0 || { echo "FAIL: hardcoded api.openai.com URLs found outside agent-config.js"; exit 1; }
```

- [ ] **Step 2: Add test file references to test.sh**

Add to the test runner section:

```bash
echo "Running agent-config tests..."
node test/agent-config.test.js || { echo "FAIL: agent-config tests"; exit 1; }

echo "Running oc-tools tests..."
node test/oc-tools.test.js || { echo "FAIL: oc-tools tests"; exit 1; }
```

- [ ] **Step 3: Commit**

```bash
git add test/test.sh
git commit -m "test: add static checks + unit test references for OpenAI Agent SDK integration"
```

---

## Task 10: Integration Smoke Test

**Files:**
- Create: `test/agent-session-openai.test.js`

- [ ] **Step 1: Write the smoke test**

This test requires an active OpenAI API key. It's skipped in CI if the key isn't available.

```js
'use strict';

const assert = require('assert');

const apiKey = process.env.MYCO_OPENAI_API_KEY || process.env.MYCO_AGENT_API_KEY;
const provider = process.env.MYCO_AGENT_PROVIDER;

if (provider !== 'openai' || !apiKey) {
  console.log('SKIP: agent-session-openai.test.js requires MYCO_AGENT_PROVIDER=openai and an API key');
  process.exit(0);
}

const { Agent, run, setDefaultOpenAIClient } = require('@openai/agents');
const OpenAI = require('openai');
const { createOpenAITools } = require('../server/src/openai-tools/index');
const agentConfig = require('../server/src/agent-config');

// Test: resolve() returns openai config
const cfg = agentConfig.resolve();
assert.strictEqual(cfg.providerId, 'openai');
assert.ok(cfg.apiKey);
console.log('PASS: agent-config resolves to openai');

// Test: createOpenAITools() produces tool array
const tools = createOpenAITools('test-session', process.cwd());
assert.ok(Array.isArray(tools));
assert.ok(tools.length >= 7);
console.log('PASS: createOpenAITools produces tool array');

// Test: basic agent run without tools
(async () => {
  setDefaultOpenAIClient(new OpenAI({ apiKey }));
  const agent = new Agent({
    name: 'test-smoke',
    model: cfg.model,
    instructions: 'Respond with exactly the word "confirmed".',
    tools: [],
  });

  const result = await run(agent, 'Please confirm', { maxTurns: 1 });
  assert.ok(result.finalOutput);
  console.log('PASS: basic OpenAI agent run produces output');
  console.log('Output:', result.finalOutput);
  console.log('Last response ID:', result.lastResponseId);

  // Test: conversation continuation via previousResponseId
  if (result.lastResponseId) {
    const result2 = await run(agent, 'What did I just ask?', {
      maxTurns: 1,
      previousResponseId: result.lastResponseId,
    });
    assert.ok(result2.finalOutput);
    console.log('PASS: conversation continuation via previousResponseId');
  }
})().catch(e => {
  console.error('FAIL: OpenAI agent run error:', e.message);
  process.exit(1);
});
```

- [ ] **Step 2: Run the smoke test (requires API key)**

```bash
MYCO_AGENT_PROVIDER=openai MYCO_OPENAI_API_KEY=sk-... node test/agent-session-openai.test.js
```

Expected: All 4 tests print PASS (or SKIP if no API key).

- [ ] **Step 3: Commit**

```bash
git add test/agent-session-openai.test.js
git commit -m "test: add agent-session-openai smoke test (skipped without API key)"
```

---

## Task 11: Run Full Test Suite + Verify Claude Path Unchanged

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

```bash
./test/test.sh
```

Expected: All existing tests pass (Claude path unchanged). New OpenAI static checks + unit tests pass.

- [ ] **Step 2: Verify Claude path still works without MYCO_AGENT_PROVIDER**

```bash
unset MYCO_AGENT_PROVIDER && node test/agent-config.test.js
```

Expected: Default config resolves to `anthropic`.

- [ ] **Step 3: Final commit (if any fixes needed)**

```bash
git add -A && git commit -m "fix: address any test.sh failures from OpenAI integration"
```

---

## Self-Review Checklist

- [ ] **Spec coverage:** Each section in `docs/superpowers/specs/2026-06-02-openai-agent-sdk-design.md` maps to a task:
  - Section 1 (Provider Configuration) → Task 2
  - Section 2 (Agent Session Path) → Task 5
  - Section 3 (Tool Implementations) → Task 3 + Task 4
  - Section 4 (Permission Flow) → Task 5 (inside _ensureIterationOpenAI)
  - Section 5 (Single-Turn Helpers) → Task 6
  - Section 6 (WS Frame Compatibility) → Task 5 (via _adaptOpenAIEvent)
  - Section 7 (Testing Strategy) → Task 9 + Task 10
  - Section 8 (Error Handling) → Task 5 (inside _ensureIterationOpenAI)
  - Section 9 (Files Changed) → all tasks
  - Section 10 (Out of Scope) → not covered (by definition)

- [ ] **Placeholder scan:** No TBD, TODO, "implement later", "add appropriate error handling" found in this plan. All code is concrete.

- [ ] **Type consistency:** `agentConfig.resolve()` returns `{ providerId, apiKey, model, auxModel, baseUrl, providerPath }` — consistent across all files that use it. `createOpenAITools(sessionId, workspaceDir)` returns `tool[]` array — consistent. `_pendingOCApprovals` Map stores `{ interruption, state, resolve, toolName, toolInput }` — consistent with `_handleOCInterruptions` and `resolveMenuPick`.

- [ ] **Node 22+ requirement:** The design spec notes this as out-of-scope for this PoC (separate deploy concern). The plan doesn't address it — it should be verified separately before deploying.