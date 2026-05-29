# Multi-Provider Agent Backend Implementation Plan

**Goal:** Allow myco deployments to use Alibaba-CN/Zhipu LLMs via @opencode-ai/agent-sdk, with Anthropic path unchanged.

**Architecture:** AgentSession dispatcher selects backend at runtime via MYCO_AGENT_PROVIDER env var.

**Tech Stack:** @opencode-ai/agent-sdk (new npm package), ai (Vercel AI SDK v6), @ai-sdk/openai-compatible, @ai-sdk/anthropic, Node.js

---

### Task 1: Create @opencode-ai/agent-sdk npm package

**Files:**
- Create: `packages/agent-sdk/` in opencode repo
- Create: `packages/agent-sdk/package.json`
- Create: `packages/agent-sdk/src/index.ts`
- Create: `packages/agent-sdk/src/provider.ts`
- Create: `packages/agent-sdk/src/transform.ts`
- Create: `packages/agent-sdk/src/llm.ts`
- Create: `packages/agent-sdk/src/tools.ts`
- Create: `packages/agent-sdk/src/types.ts`

- [ ] **Step 1 = Write failing test**

Test that `resolveProvider({ providerId: 'alibaba-cn', apiKey: 'test-key' })` returns a LanguageModelV3 with correct baseURL and thinking config.

```typescript
import { resolveProvider } from '@opencode-ai/agent-sdk'

test('resolveProvider returns correct config for alibaba-cn', async () => {
  const result = await resolveProvider({ providerId: 'alibaba-cn', apiKey: 'test-key' })
  expect(result.sdk).toBeDefined()
  expect(result.model).toBeDefined()
  expect(result.options.openaiCompatible?.enable_thinking).toBe(true)
})
```

- [ ] **Step 2 = Run test to verify it fails**

Run: `cd packages/agent-sdk && npm test`

Expected: FAIL — package doesn't exist yet.

- [ ] **Step 3 = Extract provider resolution from opencode**

Port `BUNDLED_PROVIDERS`, `resolveSDK()`, `custom()` from `packages/opencode/src/provider/provider.ts` into `packages/agent-sdk/src/provider.ts`. Replace Effect Layer composition with plain factory functions. The `resolveProvider()` function directly calls `createOpenAICompatible()`, `createAnthropic()`, etc. based on provider ID mapping.

- [ ] **Step 4 = Extract provider transforms**

Port `ProviderTransform.message()`, `ProviderTransform.schema()`, `ProviderTransform.providerOptions()` from `packages/opencode/src/provider/transform.ts` into `packages/agent-sdk/src/transform.ts`. Keep Alibaba-CN thinking, Zhipu thinking, Anthropic caching logic. Strip Effect dependencies — use plain functions.

- [ ] **Step 5 = Extract agent loop**

Port `LLMAISDK.toLLMEvents()`, `stream()` from `packages/opencode/src/session/llm.ts` and `packages/opencode/src/session/llm/ai-sdk.ts` into `packages/agent-sdk/src/llm.ts`. The `createAgent()` factory wraps `streamText()` and returns an `AgentHandle` with `stream()`, `write()`, `interrupt()`, `kill()`. Multi-turn conversation via `write()` pushing messages and `stream()` yielding an ongoing async iterable.

- [ ] **Step 6 = Extract tool helpers**

Port `jsonSchema`, `tool()`, schema transform per provider from `packages/opencode/src/session/tools.ts` into `packages/agent-sdk/src/tools.ts`.

- [ ] **Step 7 = Wire up exports in index.ts**

Export `createAgent`, `resolveProvider`, `supportedProviders`, `tool`, `jsonSchema`, `AgentHandle`, `LLMEvent` types.

- [ ] **Step 8 = Configure package.json**

Set name to `@opencode-ai/agent-sdk`, version `0.1.0`, add dependencies: `ai@^6.0.168`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`, `@ai-sdk/alibaba`. Set `private: false`, add `exports` map.

- [ ] **Step 9 = Run test to verify it passes**

Run: `cd packages/agent-sdk && npm test`

Expected: PASS — resolveProvider works for alibaba-cn, zhipuai, anthropic.

- [ ] **Step 10 = Publish to npm**

Run: `npm publish --access public` from `packages/agent-sdk/`.

Verify: `npm info @opencode-ai/agent-sdk` shows the package.

---

### Task 2: Add @opencode-ai/agent-sdk dependency to myco

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1 = Write failing test**

Test that `require('@opencode-ai/agent-sdk')` resolves in myco's server.

```javascript
const agentSdk = require('@opencode-ai/agent-sdk')
assert(typeof agentSdk.createAgent === 'function')
assert(typeof agentSdk.resolveProvider === 'function')
assert(agentSdk.supportedProviders.includes('alibaba-cn'))
assert(agentSdk.supportedProviders.includes('zhipuai'))
```

- [ ] **Step 2 = Run test to verify it fails**

Run: `node -e "const s = require('@opencode-ai/agent-sdk'); console.log(s.supportedProviders)"`

Expected: FAIL — package not yet installed.

- [ ] **Step 3 = Add dependency to package.json**

Add `"@opencode-ai/agent-sdk": "^0.1.0"` and `"ai": "^6.0.168"` to `server/package.json` dependencies.

- [ ] **Step 4 = Install and verify**

Run: `cd server && npm install`

Run: `node -e "const s = require('@opencode-ai/agent-sdk'); console.log(s.supportedProviders)"`

Expected: PASS — prints array containing alibaba-cn, zhipuai, anthropic.

- [ ] **Step 5 = Commit**

Commit: `deps: add @opencode-ai/agent-sdk + ai for multi-provider support`

---

### Task 3: Implement AgentSession dispatcher in agent-session.js

**Files:**
- Modify: `server/src/agent-session.js`

- [ ] **Step 1 = Write failing test**

Test that AgentSession selects Anthropic path when MYCO_AGENT_PROVIDER=anthropic and opencode path when MYCO_AGENT_PROVIDER=alibaba-cn. Mock both backends.

```javascript
// test/agent-provider-switch.test.js
process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
process.env.MYCO_AGENT_API_KEY = 'test-key'
const { AgentSession } = require('../server/src/agent-session')
const session = new AgentSession('test-session', { cwd: '/tmp/test-wks' })
// Verify session._providerPath === 'opencode'
// Verify session emits events with correct names when mock stream yields LLMEvents
```

- [ ] **Step 2 = Run test to verify it fails**

Run: `node test/agent-provider-switch.test.js`

Expected: FAIL — `_providerPath` property doesn't exist yet.

- [ ] **Step 3 = Add provider config reading to AgentSession constructor**

In the constructor (L143-224), add:
```javascript
this._providerPath = (process.env.MYCO_AGENT_PROVIDER || 'anthropic') === 'anthropic' ? 'anthropic' : 'opencode'
this._providerConfig = {
  providerId: process.env.MYCO_AGENT_PROVIDER || 'anthropic',
  apiKey: resolveApiKey(), // new helper that follows priority chain
  model: process.env.MYCO_AGENT_MODEL || null,
  auxModel: process.env.MYCO_AUX_MODEL || null,
}
```

Add `resolveApiKey()` helper function that follows the priority chain:
1. MYCO_AGENT_API_KEY
2. Provider-specific env var (DASHSCOPE_API_KEY, ZHIPU_API_KEY, ANTHROPIC_API_KEY)
3. Throw error if none found

- [ ] **Step 4 = Split _ensureIteration into two paths**

Refactor `_ensureIteration()` (L258-479) to check `this._providerPath`:
- If `'anthropic'`: call existing `_ensureIterationAnthropic()` (rename of current method, unchanged body)
- If `'opencode'`: call `_ensureIterationOC()` (new method)

- [ ] **Step 5 = Implement _ensureIterationOC()**

New method that:
1. Creates AbortController
2. Calls `agentSdk.createAgent({ provider: this._providerConfig.providerId, model: this._providerConfig.model, apiKey: this._providerConfig.apiKey, tools: this._resolveOCTools(), systemPrompt: this._readSystemPrompt(), canUseTool: this._canUseToolOC.bind(this) })`
3. Stores `this._ocHandle = handle`
4. Iterates `handle.stream()` with `for await (const event of this._ocHandle.stream())`
5. Calls `_adaptOCEvent(event)` to map LLMEvent → myco events
6. Handles retry/recovery same pattern as Anthropic path (3 attempts, backoff)

- [ ] **Step 6 = Implement _adaptOCEvent()**

New method mapping LLMEvent types to myco events:
- LLMEvent.text → emit('agent-event', { type: 'assistant_text', text: event.delta })
- LLMEvent.tool_call → emit('agent-event', { type: 'tool_use', ... })
- LLMEvent.tool_result → emit('agent-event', { type: 'tool_result', ... })
- LLMEvent.finish → emit('agent-event', { type: 'turn_result', ... })
- LLMEvent.error → emit('exit', { reason: event.error.message })
- LLMEvent.reasoning → emit('agent-event', { type: 'assistant_text', text: event.delta, meta: { reasoning: true } })

- [ ] **Step 7 = Implement _canUseToolOC()**

Adapter for opencode path permission handling. Has same two-stage flow as Anthropic:
1. Apply auto-allow/deny logic (port from `_preToolUseHook`) — return `{ behavior: 'allow' }` or `{ behavior: 'deny' }` immediately if tool matches allow/deny list
2. If no auto-decision: create Promise, store in `pendingMenus`, emit `menu` event for browser to resolve
3. Resolve menu pick calls `resolveMenuPick()` which resolves the stored Promise

- [ ] **Step 8 = Implement _resolveOCTools()**

New method that collects myco's tool definitions (MCP + built-in) and returns them in opencode's `tool/jsonSchema` format. Calls `myco-mcp.createMycoMcpToolsOC()` for MCP tools.

- [ ] **Step 9 = Adapt write() for opencode path**

In `write()` (L1393-1413), check `this._providerPath`:
- If `'anthropic'`: existing `_msgQueue.write()` logic
- If `'opencode'`: `this._ocHandle.write(text)` then kick `_ensureIterationOC()` if not iterating

- [ ] **Step 10 = Adapt interrupt() and kill() for opencode path**

In `interrupt()` (L555-563): if opencode path, call `this._ocHandle.interrupt()`
In `kill()` (L1424-1434): if opencode path, call `this._ocHandle.kill()`

- [ ] **Step 11 = Run test to verify it passes**

Run: `node test/agent-provider-switch.test.js`

Expected: PASS — AgentSession selects correct path, emits correct events.

- [ ] **Step 12 = Commit**

Commit: `feat: add AgentSession dispatcher for multi-provider agent backend`

---

### Task 4: Adapt myco-mcp.js for dual MCP format

**Files:**
- Modify: `server/src/myco-mcp.js`

- [ ] **Step 1 = Write failing test**

Test that myco-mcp exports both Anthropic SDK format and Vercel AI SDK format.

```javascript
// test/mcp-format-switch.test.js
const mcp = require('../server/src/myco-mcp')
const anthropicServer = mcp.createMycoMcpServer('test-session')
assert(typeof anthropicServer === 'object') // Anthropic SDK MCP server
const ocTools = mcp.createMycoMcpToolsOC('test-session')
assert(typeof ocTools === 'object') // Vercel AI SDK tool map
assert(ocTools['mcp__myco__add_plan_items'] !== undefined)
```

- [ ] **Step 2 = Run test to verify it fails**

Run: `node test/mcp-format-switch.test.js`

Expected: FAIL — `createMycoMcpToolsOC` doesn't exist yet.

- [ ] **Step 3 = Add createMycoMcpToolsOC() function**

New export in `myco-mcp.js` that converts `add_plan_items` tool definition from Anthropic SDK `tool()` format to Vercel AI SDK `dynamicTool()` + `jsonSchema()` format. Uses `agentSdk.tool` and `agentSdk.jsonSchema` from @opencode-ai/agent-sdk.

- [ ] **Step 4 = Run test to verify it passes**

Run: `node test/mcp-format-switch.test.js`

Expected: PASS — both MCP formats work.

- [ ] **Step 5 = Commit**

Commit: `feat: add dual MCP format export to myco-mcp for multi-provider support`

---

### Task 5: Adapt auxiliary calls for multi-provider

**Files:**
- Modify: `server/src/btw.js`
- Modify: `server/src/claude-cli.js`
- Modify: `server/src/anthropic.js`

- [ ] **Step 1 = Write failing test**

Test that `runClaudeP()` in btw.js works with both Anthropic and opencode paths.

```javascript
// test/auxiliary-provider-switch.test.js
process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
process.env.MYCO_AGENT_API_KEY = 'test-key'
const btw = require('../server/src/btw')
// Verify that runClaudeP calls opencode's generateText instead of Anthropic query()
```

- [ ] **Step 2 = Run test to verify it fails**

Run: `node test/auxiliary-provider-switch.test.js`

Expected: FAIL — btw.js still only uses Anthropic SDK.

- [ ] **Step 3 = Modify btw.js**

In `runClaudeP()` (L64-105), add provider path check:
- Anthropic: existing `query()` call unchanged
- Non-Anthropic: use `agentSdk.generateText()` (new export from @opencode-ai/agent-sdk) with configured provider and model (or MYCO_AUX_MODEL override). Same timeout/abort logic.

- [ ] **Step 4 = Modify claude-cli.js**

Same pattern as btw.js — add provider path check in the main `query()` call (L28-35).

- [ ] **Step 5 = Modify anthropic.js**

Add `callAnthropicAPI()` function that works with any provider:
- Anthropic path: existing direct HTTPS call to api.anthropic.com unchanged
- Non-Anthropic path: use `agentSdk.generateText()` with configured provider

The function signature changes to accept a `providerConfig` parameter alongside the existing `prompt`/`instructions` parameters.

- [ ] **Step 6 = Run test to verify it passes**

Run: `node test/auxiliary-provider-switch.test.js`

Expected: PASS — auxiliary calls work with both providers.

- [ ] **Step 7 = Commit**

Commit: `feat: adapt auxiliary calls (btw, claude-cli, anthropic) for multi-provider`

---

### Task 6: Add env var config and startup validation

**Files:**
- Create: `server/src/agent-config.js`
- Modify: `server/src/index.js`

- [ ] **Step 1 = Write failing test**

Test that agent-config.js reads env vars correctly and validates missing keys.

```javascript
// test/agent-config.test.js
process.env.MYCO_AGENT_PROVIDER = 'zhipuai'
delete process.env.MYCO_AGENT_API_KEY
delete process.env.ZHIPU_API_KEY
const config = require('../server/src/agent-config')
assert.throws(() => config.resolve(), /No API key found for provider zhipuai/)
```

- [ ] **Step 2 = Run test to verify it fails**

Run: `node test/agent-config.test.js`

Expected: FAIL — agent-config.js doesn't exist.

- [ ] **Step 3 = Create agent-config.js**

New module that:
- Exports `resolve()` → returns `{ providerId, apiKey, model, auxModel, providerPath }`
- Implements the priority chain: MYCO_AGENT_API_KEY → provider-specific env var → throw error
- Exports `PROVIDER_ENV_VARS` map: `{ anthropic: 'ANTHROPIC_API_KEY', 'alibaba-cn': 'DASHSCOPE_API_KEY', zhipuai: 'ZHIPU_API_KEY', ... }`

- [ ] **Step 4 = Add startup validation to index.js**

In server startup (L1-30 of index.js), call `agentConfig.resolve()` and log the resolved provider. If validation throws, log error and exit process with code 1.

- [ ] **Step 5 = Run test to verify it passes**

Run: `node test/agent-config.test.js`

Expected: PASS — config resolves correctly, throws on missing key.

- [ ] **Step 6 = Commit**

Commit: `feat: add agent-config module with env var resolution and startup validation`

---

### Task 7: Update Dockerfile and deploy.sh

**Files:**
- Modify: `docker/Dockerfile`
- Modify: `docker/docker-entrypoint.sh`
- Modify: `scripts/deploy.sh`

- [ ] **Step 1 = Write failing test**

Static check in test.sh that verifies Dockerfile installs @opencode-ai/agent-sdk and docker-entrypoint.sh references MYCO_AGENT_PROVIDER.

- [ ] **Step 2 = Run test to verify it fails**

Run: `./test/test.sh`

Expected: FAIL on new static checks.

- [ ] **Step 3 = Update Dockerfile**

Add `@opencode-ai/agent-sdk`, `ai`, `@ai-sdk/openai-compatible`, `@ai-sdk/anthropic` to `server/package.json` dependencies (they're always present in the image). Keep `@anthropic-ai/claude-code` global install for Anthropic path.

- [ ] **Step 4 = Update docker-entrypoint.sh**

Add conditional logic that reads `MYCO_AGENT_PROVIDER`:
- If `anthropic`: run existing `~/.claude/` setup
- If non-Anthropic: skip `~/.claude/` setup

- [ ] **Step 5 = Update deploy.sh**

Add two new flags:
- `--set-agent-provider <provider>`: writes `MYCO_AGENT_PROVIDER` to `$STATE_DIR/.env`
- `--set-agent-key <key>`: writes `MYCO_AGENT_API_KEY` to `$STATE_DIR/.env`

- [ ] **Step 6 = Run test to verify it passes**

Run: `./test/test.sh`

Expected: PASS — all static checks pass.

- [ ] **Step 7 = Commit**

Commit: `feat: update Dockerfile, entrypoint, and deploy.sh for multi-provider config`

---

### Task 8: Add provider-specific test coverage

**Files:**
- Create: `test/alibaba-provider.test.js`
- Create: `test/zhipuai-provider.test.js`
- Modify: `test/test.sh`

- [ ] **Step 1 = Write alibaba-provider.test.js**

Test DashScope key resolution, createOpenAICompatible baseURL, enable_thinking injection for reasoning models.

- [ ] **Step 2 = Write zhipuai-provider.test.js**

Test Zhipu key resolution, baseURL, thinking config injection.

- [ ] **Step 3 = Wire both tests into test.sh**

Add `node test/alibaba-provider.test.js` and `node test/zhipuai-provider.test.js` blocks to `./test/test.sh`.

- [ ] **Step 4 = Run all tests**

Run: `./test/test.sh`

Expected: PASS — all tests pass including new provider tests.

- [ ] **Step 5 = Commit**

Commit: `test: add alibaba and zhipu provider tests`

---

### Task 9: Final integration test and verification

**Files:**
- Modify: `test/test.sh`

- [ ] **Step 1 = Add integration smoke to test.sh**

Add a test block that:
1. Starts myco server with `MYCO_AGENT_PROVIDER=alibaba-cn` and mock API key
2. Creates a session
3. Sends a chat message
4. Verifies `assistant_text` event emitted
5. Verifies `tool_use` → `tool_result` cycle completes
6. Verifies `turn_result` event emitted with usage data

- [ ] **Step 2 = Run full test suite**

Run: `./test/test.sh`

Expected: PASS — all existing + new tests pass.

- [ ] **Step 3 = Verify Anthropic path still works**

Run: `./test/test.sh` with `MYCO_AGENT_PROVIDER=anthropic` (or unset)

Expected: PASS — Anthropic path unchanged, all existing tests still pass.

- [ ] **Step 4 = Final commit**

Commit: `test: add integration smoke for multi-provider agent backend`