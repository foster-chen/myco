# OpenAI Agent SDK Integration — Implementation Summary

## Goal

Add the OpenAI Agents SDK (`@openai/agents` v0.11.6) as a second agent backend alongside the existing Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`). Selectable at deploy time via `MYCO_AGENT_PROVIDER` env var. The architecture is an **in-place dual-path** in `agent-session.js` — the same `_emit()` contract so the WS layer and browser client are completely unchanged.

**Base commit:** `a8e4554` (fix(fr-91 r3): one admin UI)
**Branch:** `openai_agent_sdk`
**Head commit:** `3cca95a` (test: add agent-session-openai smoke test)
**Total:** 10 commits, 27 files changed, 3397 insertions, 34 deletions

---

## Commits (chronological)

| SHA | Message |
|---|---|
| `59bd5e0` | deps: add @openai/agents, openai, zod, fast-glob for OpenAI Agent SDK backend |
| `dbceaee` | feat: add agent-config.js provider resolution + ENV_KEYS for dual-provider support |
| `95431b7` | feat: add oc-tools execute logic (bash/read/edit/write/glob/grep/webfetch) + shared resolve-path helper |
| `ae36d18` | feat: export _appendPlanItems from myco-mcp.js for OpenAI tool definition reuse |
| `2a513fb` | feat: add OpenAI tool definitions (tool() + Zod) wrapping oc-tools + plan-items tool |
| `24680e9` | feat: add _ensureIterationOpenAI() run/interrupt/resume cycle + _adaptOpenAIEvent() event mapping + dual-path routing |
| `d4c2c87` | feat: add dual-path routing to btw.js, claude-cli.js, anthropic.js for OpenAI provider |
| `4b87a3a` | feat: add openaiResponseId session resume support |
| `a8ee2b6` | test: add static checks + unit test references for OpenAI Agent SDK integration |
| `3cca95a` | test: add agent-session-openai smoke test (skipped without API key) |

---

## New Files (14)

### `server/src/agent-config.js` (59 lines)

Central provider resolution module. Reads env vars and returns a config object used by all OpenAI-path code.

```
resolve() → { providerId, apiKey, model, auxModel, baseUrl, providerPath }
```

- **Line 3-6:** `PROVIDER_ENV_VARS` — maps provider id → env var name (`anthropic` → `ANTHROPIC_API_KEY`, `openai` → `MYCO_OPENAI_API_KEY`)
- **Line 8-19:** `PROVIDER_DEFAULTS` — per-provider defaults (model, baseUrl). Anthropic default model: `claude-sonnet-4-20250514`, baseUrl: null. OpenAI default model: `gpt-4o`, baseUrl: `https://api.openai.com/v1`
- **Line 21-57:** `resolve()` — reads `MYCO_AGENT_PROVIDER` (default `'anthropic'`), resolves API key from `MYCO_AGENT_API_KEY` then provider-specific env var, throws on unknown provider or missing key for non-anthropic providers. Model from `MYCO_AGENT_MODEL`, auxModel from `MYCO_AUX_MODEL`, baseUrl from `MYCO_AGENT_BASE_URL`
- **Line 38:** Anthropic is exempted from the API-key-required check because the Claude Agent SDK handles its own auth via `~/.claude/` config

### `server/src/oc-tools/resolve-path.js` (31 lines)

Shared path-sandbox helper. Prevents path traversal outside workspace.

- **Line 6-8:** `realpath(p)` — `fs.realpathSync` with catch fallback (handles macOS `/var` → `/private/var` symlink and non-existent paths)
- **Line 10-17:** `resolveRealPath(p)` — resolves symlinks for both the path itself and its parent directory
- **Line 19-29:** `resolveFilePath(filePath, workspaceDir)` — if absolute, resolve and verify it starts within workspace; if relative, resolve against workspace. Throws on path escape.

### `server/src/oc-tools/bash.js` (29 lines)

Pure-function Bash tool executor. No SDK dependency.

- **Line 5-27:** `executeBash({ command, workdir, timeout })` — runs `child_process.exec` with cwd, timeout, 51MB maxBuffer. Timeout → `[Timeout after Nms]`. Error → `Error: stderr`. Output >51200 chars → truncation. Always resolves (never rejects).

### `server/src/oc-tools/read.js` (34 lines)

Pure-function Read tool executor.

- **Line 7-32:** `executeRead({ filePath, offset, limit })` — uses `resolveFilePath` for sandboxing. If path doesn't exist → error string. If directory → list entries with `/` suffix. If file → read, slice by offset/limit, number lines. Lines >2000 chars truncated.

### `server/src/oc-tools/edit.js` (36 lines)

Pure-function Edit tool executor.

- **Line 6-34:** `executeEdit({ filePath, oldString, newString, replaceAll })` — uses `resolveFilePath`. Missing file → error. oldString not found → error. Multiple matches without replaceAll → error. Single replacement via `indexOf` + splice; replaceAll via `split/join`. Writes result to disk.

### `server/src/oc-tools/write.js` (15 lines)

Pure-function Write tool executor.

- **Line 7-13:** `executeWrite({ filePath, content })` — uses `resolveFilePath`. Creates parent dirs via `fs.mkdirSync({ recursive: true })`. Writes content. Returns success message.

### `server/src/oc-tools/glob.js` (15 lines)

Pure-function Glob tool executor.

- **Line 5-13:** `executeGlob({ pattern, path })` — uses `fast-glob` with `onlyFiles: true`, ignores `node_modules` and `.git`. Returns sorted matches joined by `\n`, or `'No files found'`.

### `server/src/oc-tools/grep.js` (63 lines)

Pure-function Grep tool executor with ripgrep fallback.

- **Line 8-14:** `HAS_RG` — runtime check for `rg` availability
- **Line 16-27:** `rgSearch(pattern, include, cwd)` — ripgrep with `--no-heading --line-number --max-count 200`. Exit code 1 = no matches.
- **Line 29-53:** `nodeSearch(pattern, include, cwd)` — Node.js fallback using `fast-glob` + regex. Max 200 results, lines >200 chars truncated.
- **Line 55-61:** `executeGrep({ pattern, include, path })` — dispatches to `rgSearch` or `nodeSearch` based on `HAS_RG`.

### `server/src/oc-tools/webfetch.js` (56 lines)

Pure-function WebFetch tool executor.

- **Line 3-31:** `executeWebFetch({ url, format, timeout })` — validates URL scheme, upgrades HTTP→HTTPS, fetches with `AbortSignal.timeout`. HTML content → `htmlToText()` conversion. Plain text/JSON → raw return.
- **Line 33-54:** `htmlToText(html)` — strips scripts/styles, converts HTML entities, formats links as `[text](url)`.

### `server/src/openai-tools/definitions.js` (135 lines)

Wraps each oc-tool execute function in `@openai/agents`'s `tool()` + Zod schemas.

- **Line 3-4:** Imports `tool` from `@openai/agents` and `z` from `zod`
- **Line 6-12:** Imports all 7 oc-tool execute functions
- **Line 14-30:** `createBashTool(workspaceDir)` — `needsApproval: true`, enriches args with default workdir
- **Line 32-47:** `createReadTool(workspaceDir)` — calls `process.chdir(workspaceDir)` before execute (sets cwd for `resolveFilePath`)
- **Line 49-66:** `createEditTool(workspaceDir)` — `needsApproval: true`, `process.chdir(workspaceDir)`
- **Line 68-83:** `createWriteTool(workspaceDir)` — `needsApproval: true`, `process.chdir(workspaceDir)`
- **Line 85-99:** `createGlobTool(workspaceDir)` — enriches args with default path
- **Line 101-116:** `createGrepTool(workspaceDir)` — enriches args with default path
- **Line 118-130:** `createWebFetchTool()` — no workspace dependency, direct `executeWebFetch`

**Key:** Tools with `needsApproval: true` (bash, edit, write) trigger the OpenAI SDK's `interruptions` flow handled by `_handleOCInterruptions()`.

### `server/src/openai-tools/index.js` (22 lines)

Tool aggregator. Returns all 8 tools as a flat array.

- **Line 9-20:** `createOpenAITools(sessionId, workspaceDir)` — creates 7 oc-tool wrappers + 1 `add_plan_items` MCP tool. Returns array.

### `server/src/myco-mcp-openai.js` (27 lines)

OpenAI `tool()` definition for `add_plan_items`, reusing existing `_appendPlanItems` logic.

- **Line 3-5:** Imports `tool`, `zod`, `_appendPlanItems` from `myco-mcp.js`
- **Line 7-25:** `createMycoMcpToolsOpenAI(sessionId)` — `add_plan_items` tool with Zod schema for items array. Execute calls `_appendPlanItems`. Error check uses `!result.ok` (matching actual return shape `{ ok, message, ids }`).

### `test/agent-config.test.js` (88 lines)

9 unit tests for provider resolution. Uses save/restore/set env helpers.

- **Line 25-31:** Test 1: default anthropic config (ANTHROPIC_API_KEY → apiKey, model claude-sonnet-4, baseUrl null)
- **Line 33-39:** Test 2: openai config (MYCO_OPENAI_API_KEY → apiKey, model gpt-4o, baseUrl api.openai.com)
- **Line 41-44:** Test 3: MYCO_AGENT_BASE_URL override (dashscope URL)
- **Line 46-50:** Test 4: MYCO_AGENT_MODEL override (qwen-max, auxModel same)
- **Line 52-56:** Test 5: MYCO_AUX_MODEL override (model qwen-max, auxModel qwen-mini)
- **Line 58-61:** Test 6: MYCO_AGENT_API_KEY fallback (generic key)
- **Line 63-70:** Test 7: throws on unknown provider (gemini)
- **Line 72-79:** Test 8: throws on missing API key for openai
- **Line 81-85:** Test 9: anthropic without explicit key (apiKey undefined, providerId anthropic)

### `test/oc-tools.test.js` (71 lines)

8 unit tests for oc-tools. Uses temp directory, sequential async main().

- **Line 22-24:** Test 1: bash echo
- **Line 26-30:** Test 2: read file with offset
- **Line 32-34:** Test 3: read directory
- **Line 36-41:** Test 4: edit single replacement
- **Line 43-47:** Test 5: write file
- **Line 49-51:** Test 6: glob *.txt
- **Line 53-54:** Test 7: grep runs without error
- **Line 56-58:** Test 8: webfetch rejects invalid URL

### `test/agent-session-openai.test.js` (54 lines)

Integration smoke test. **Skips (exit 0)** if `MYCO_AGENT_PROVIDER !== 'openai'` or no API key.

- **Line 8-11:** Skip guard
- **Line 18-21:** Test 1: agent-config resolves to openai
- **Line 23-26:** Test 2: createOpenAITools produces tool array (>= 7)
- **Line 28-50:** Tests 3-4: basic OpenAI agent run + conversation continuation via previousResponseId

---

## Modified Files (7)

### `server/src/agent-session.js` (+334 lines)

**The most critical file.** All OpenAI additions are additive — existing Claude path (lines 278-928) is completely unchanged.

#### Added at top (line 26):
```js
const agentConfig = require('./agent-config');
```

#### Added in constructor (lines 223-225):
```js
this._pendingOCApprovals = new Map();
this._ocRunState = null;
this.openaiResponseId = opts.resumeOpenaiResponseId || null;
```
- `_pendingOCApprovals` — OpenAI equivalent of `_pendingPermissions`. Stores `{ interruption, state, resolve, toolName, toolInput }` keyed by `hash`.
- `_ocRunState` — holds `result.state` across approval interruptions so `_ensureIterationOpenAI()` can resume after approval.
- `openaiResponseId` — OpenAI equivalent of `sdkSessionId`. Used for conversation continuation via `previousResponseId`.

#### Provider routing at start of `_ensureIteration()` (lines 274-277):
```js
const { providerId } = agentConfig.resolve();
if (providerId === 'openai') {
  return this._ensureIterationOpenAI();
}
```
Routes to OpenAI path before the existing code. If provider is anthropic, existing code runs as-is.

#### New method `_ensureIterationOpenAI()` (lines 629-753):

The core OpenAI agent loop. Lazy-loads SDK modules (no top-level imports):

- **Lines 635-637:** Lazy requires of `@openai/agents`, `openai`, `openai-tools/index`
- **Lines 641-653:** OpenAI client config — custom `baseUrl` uses `OpenAIProvider` with `useResponses: false`; default uses `setDefaultOpenAIClient(new OpenAI({ apiKey }))`
- **Lines 659-662:** 3-attempt retry loop with `[1000, 4000, 16000]` backoff
- **Lines 664-670:** Per-attempt setup: fresh AbortController, tools from `createOpenAITools`
- **Lines 672-678:** Agent creation: name `myco-agent`, model from config, instructions from `_buildSystemPrompt()`, `toolUseBehavior: 'run_llm_again'`
- **Lines 680-687:** Input selection: if `_ocRunState` exists (resume after approval) → use that; otherwise `_msgQueue || _buildInitialPrompt()`
- **Lines 689-697:** Run options: stream=true, abort signal, `previousResponseId` for conversation continuation if `openaiResponseId` exists
- **Lines 701-705:** Stream events → `_adaptOpenAIEvent()`; await `result.completed`
- **Lines 707-713:** Interruption handling: if `result.interruptions.length > 0`, save `result.state` to `_ocRunState`, call `_handleOCInterruptions()`, then recursively call `_ensureIterationOpenAI()` to resume
- **Lines 715-729:** Success: persist `openaiResponseId`, emit `turn_result`, clear state, emit idle
- **Lines 731-746:** Error handling: abort → emit `iteration_aborted`; resume failure (404 + openaiResponseId) → clear ID, retry; recoverable (429, 5xx, ECONNRESET/ETIMEDOUT) → retry with backoff; fatal → emit `fatal`
- **Lines 748-753:** Exhausted retries → emit `fatal`

#### New helper methods (lines 755-837):

- **`_buildInitialPrompt()`** (lines 755-760): If `_pendingPrePush` exists, concatenate message contents; otherwise return `'Hello'`
- **`_buildSystemPrompt()`** (lines 762-764): Returns minimal system prompt with cwd reference
- **`_isRecoverableOC(err)`** (lines 766-770): 429, 5xx, ECONNRESET/ETIMEDOUT → true
- **`_emitRetryAndWaitOC(err, attempt, backoffMs)`** (lines 772-776): Emits retry event, waits with exponential backoff

#### New method `_adaptOpenAIEvent()` (lines 778-871):

Maps OpenAI SDK stream events to the same `_emit()` shapes the WS layer already handles. All emits include `providerId: 'openai'`.

- **Lines 780-786:** `raw_model_stream_event` → if `response.output_text.delta` → emit `assistant_text` + `_persistAssistantTextToRecChat`
- **Lines 790-801:** `run_item_stream_event` name `message_output_created` → emit `assistant_text` from `output_text` content items
- **Lines 804-818:** name `tool_called` → emit `tool_use` with `rawItem.name`, `rawItem.arguments` (JSON.parse with catch), `rawItem.call_id`
- **Lines 820-833:** name `tool_output` → emit `tool_result` + `_broadcastToolProgress()`
- **Lines 836-849:** name `tool_approval_requested` → emit `permission_request`
- **Lines 852-862:** name `reasoning_item_created` → emit `reasoning_text` from summary
- **Lines 866-869:** `agent_updated_stream_event` → ignored

#### New method `_handleOCInterruptions()` (lines 873-920):

OpenAI approval flow. Creates pending promises in `_pendingOCApprovals`, emits menu events, awaits user decision, calls `state.approve/reject`.

- **Line 875:** Generates hash with `'oc-'` prefix + call_id or random bytes
- **Lines 881-889:** Stores `{ interruption, state, resolve, toolName, toolInput }` in `_pendingOCApprovals`
- **Lines 891-897:** Emits `permission_request` with hash
- **Lines 899-909:** Emits `menu` event with Allow once / Allow always / Deny options
- **Line 911:** Awaits `menuPromise` for user resolution
- **Lines 913-918:** `approve` → `state.approve(interruption)`; `approve_always` → `state.approve(interruption, { alwaysApprove: true })`; else → `state.reject(interruption, { message: 'Denied by user' })`

#### OC approval handling in `resolveMenuPick()` (lines 1647-1662):

Added at the **start** of the method, before the existing `_pendingPermissions` lookup:

```js
const ocApproval = this._pendingOCApprovals.get(hash);
if (ocApproval) {
  this._pendingOCApprovals.delete(hash);
  this.pendingMenus.delete(hash);
  if (n === 3) ocApproval.resolve('deny') + emit deny
  else if (n === 2) ocApproval.resolve('approve_always') + emit approve_always
  else ocApproval.resolve('approve') + emit approve
  return true;
}
```

#### OC approval cleanup in `interrupt()` (lines 1037-1042):

After existing abort/close calls, deny-resolve all pending OC approvals.

#### OC approval cleanup in `kill()` (lines 2117-2122):

Same cleanup as interrupt().

#### `openaiResponseId` persistence (lines 1086-1089):

After `sdkSessionId` persistence, also persists `openaiResponseId` to `rec` and calls `saveStore()`.

### `server/src/btw.js` (+40 lines)

- **Line 11:** Added `const agentConfig = require('./agent-config');`
- **Lines 65-68:** Added routing at start of `runClaudeP()` — if `providerId === 'openai'`, call `runOpenAIP()` and return
- **Lines 112-149:** New `runOpenAIP(cwd, promptBody, model, apiKey, baseUrl)` — lazy-loads SDK, configures client (baseURL routing), creates `Agent` with `ASSISTANT_INSTRUCTIONS`, runs single-turn, returns text or error string

### `server/src/claude-cli.js` (+47 lines)

- **Line 17:** Added `const agentConfig = require('./agent-config');`
- **Lines 21-24:** Added routing at start of `callClaudeCli()` — if `providerId === 'openai'`, call `callOpenAICli()` and return
- **Lines 74-113:** New `callOpenAICli({ system, userMessage, cwd, timeoutMs, model, apiKey, baseUrl })` — same pattern as `runOpenAIP`, returns null on failure (not error string)
- **Line 115:** Updated module.exports to `{ callClaudeCli, callOpenAICli }`

### `server/src/anthropic.js` (+48 lines)

- **Line 10:** Added `const agentConfig = require('./agent-config');`
- **Lines 17-20:** Added routing at start of `callAnthropic()` — if `providerId === 'openai'`, call `callOpenAICompatible()` and return
- **Lines 65-105:** New `callOpenAICompatible({ system, userMessage, model, maxTokens, timeoutMs, apiKey, baseUrl })` — uses native `fetch()` to OpenAI Chat Completions endpoint. No SDK dependency (raw HTTP). Returns null on failure.
- **Line 107:** Updated module.exports to `{ callAnthropic, callOpenAICompatible, DEFAULT_MODEL }`

### `server/src/myco-mcp.js` (1 line changed)

- **Line 152:** Changed `module.exports = { createMycoMcpServer, MYCO_MCP_TOOL_PREFIX };` → added `_appendPlanItems` to exports so `myco-mcp-openai.js` can call it.

### `server/src/sessions.js` (1 line added)

- **Line 783:** Added `resumeOpenaiResponseId: rec.openaiResponseId || null,` to the `spawnAgent()` opts in `ensureLiveSession()`, so session resume passes the OpenAI response ID alongside the Claude SDK session ID.

### `server/src/index.js` (6 lines added)

- **Lines 1397-1402:** Added 6 new keys to `ENV_KEYS` array: `MYCO_OPENAI_API_KEY`, `MYCO_AGENT_API_KEY`, `MYCO_AGENT_PROVIDER`, `MYCO_AGENT_MODEL`, `MYCO_AUX_MODEL`, `MYCO_AGENT_BASE_URL`. These env vars are now persisted to `.env` via the env-sync mechanism.

### `test/test.sh` (+48 lines)

- **Lines 1617-1659:** New `test_openai_sdk_static()` function with static grep checks for:
  - `MYCO_AGENT_PROVIDER` in agent-config.js
  - All 8 oc-tools files exist
  - openai-tools index.js + definitions.js exist
  - `createMycoMcpToolsOpenAI` exported from myco-mcp-openai.js
  - `_ensureIterationOpenAI`, `_adaptOpenAIEvent`, `_pendingOCApprovals` in agent-session.js
  - No hardcoded `api.openai.com` URLs outside agent-config.js
- **Line 1687:** `test_openai_sdk_static` registered in `run_static_checks()`
- **Lines 2633-2634:** Added `node_test_result` call-sites for `agent-config.test.js` (9 cases) and `oc-tools.test.js` (8 cases)

### `server/package.json` (6 lines changed)

Added 4 new dependencies:
- `@openai/agents`: `^0.11.6`
- `openai`: `^6.41.0`
- `zod`: `^4.4.3`
- `fast-glob`: `^3.3.3`

---

## Architecture Flow

```mermaid
flowchart TB
  subgraph Config [Provider Resolution — agent-config.js]
    ENV[MYCO_AGENT_PROVIDER env var] --> RESOLVE[resolve()]
    RESOLVE --> |anthropic| CLAUDE_PATH[Claude Agent SDK path]
    RESOLVE --> |openai| OAI_PATH[OpenAI Agents SDK path]
  end

  subgraph AgentSession [agent-session.js — Dual Path]
    ENSURE[_ensureIteration] --> |providerId=anthropic| CLAUDE_LOOP[Claude query() loop — unchanged]
    ENSURE --> |providerId=openai| OAI_LOOP[_ensureIterationOpenAI]
    OAI_LOOP --> ADAPT[_adaptOpenAIEvent]
    OAI_LOOP --> INTERRUPT[_handleOCInterruptions]
    INTERRUPT --> APPROVE_MAP[_pendingOCApprovals Map]
    APPROVE_MAP --> RESOLVE_MENU[resolveMenuPick — n=1/2/3]
    RESOLVE_MENU --> |approve| STATE_APPROVE[state.approve]
    RESOLVE_MENU --> |deny| STATE_REJECT[state.reject]
  end

  subgraph Tools [Tool Execution]
    OAI_DEFS[openai-tools/definitions.js] --> OC_TOOLS[oc-tools/ — pure execute functions]
    MCP_OAI[myco-mcp-openai.js] --> MCP[myco-mcp.js _appendPlanItems]
    OC_TOOLS --> RESOLVE_PATH[oc-tools/resolve-path.js — sandbox helper]
  end

  subgraph SingleTurn [Single-Turn Helpers]
    BTW[btw.js runClaudeP] --> |openai| BTW_OAI[runOpenAIP]
    CLI[claude-cli.js callClaudeCli] --> |openai| CLI_OAI[callOpenAICli]
    ANTH[anthropic.js callAnthropic] --> |openai| ANTH_OAI[callOpenAICompatible — raw fetch]
  end

  subgraph Emit [WS Frame Contract — unchanged]
    ADAPT --> |same _emit shapes| WS[WebSocket /attach/:id]
    CLAUDE_LOOP --> WS
  end
```

---

## Key Design Decisions

1. **Lazy SDK imports in agent-session.js.** OpenAI modules (`@openai/agents`, `openai`) are required inside `_ensureIterationOpenAI()`, not at the top. This ensures the anthropic-only path never loads them and avoids crashes on systems without the package.

2. **`_pendingOCApprovals` mirrors `_pendingPermissions` pattern.** The OpenAI approval flow uses the same hash-based Map pattern as the Claude `canUseTool` flow, but resolves via `state.approve/reject` instead of SDK canUseTool promises. `resolveMenuPick()` checks `_pendingOCApprovals` first (before `_pendingPermissions`).

3. **`openaiResponseId` mirrors `sdkSessionId`.** Both are persisted to `rec` in sessions.json and passed on resume. OpenAI uses `previousResponseId` for conversation continuation; Claude uses `resume` SDK option.

4. **`useResponses: false` for custom endpoints.** The `OpenAIProvider` with `useResponses: false` is used for non-standard baseURLs (DashScope, etc.) because those endpoints typically don't support the Responses API. Standard OpenAI uses `setDefaultOpenAIClient`.

5. **oc-tools are pure functions with no SDK dependency.** This decouples the tool execution logic from the agent SDK, allowing reuse across SDKs and easier testing.

6. **`resolveFilePath` handles macOS symlink quirks.** Uses `fs.realpathSync` to resolve `/var` → `/private/var` on macOS, with catch fallback for non-existent paths (write operations).

7. **`myco-mcp-openai.js` error check uses `!result.ok` not `result.error`.** The actual `_appendPlanItems` return shape is `{ ok, message, ids }`, not `{ error, message }`. This was corrected during implementation.

8. **Existing Claude path is 100% unchanged.** All additions are additive: new methods, new routing at start of methods, new Map fields. No existing line of Claude-path code was modified.

---

## Notable Findings During Implementation

- **SDK export differences:** The `@openai/agents` v0.11.6 does not export `InputGuardrail`/`OutputGuardrail` as classes. Instead it uses `defineInputGuardrail`/`defineOutputGuardrangle`/`defineToolInputGuardrail`/`defineToolOutputGuardrail`. This doesn't affect the PoC since guardrails aren't used.
- **`_buildSystemPrompt()` is minimal.** The current implementation returns a short string. A follow-up could extract the full Claude system prompt construction (including CLAUDE.md content injection) for richer OpenAI agent instructions.
- **`_emitRetryAndWaitOC` returns a Promise** (not void like `_emitRetryAndWait`). This is intentional — the OpenAI retry loop needs to `await` the backoff delay.

---

## How to Activate the OpenAI Path

Set these env vars in `$MYCO_STATE_DIR/.env` (or via deploy.sh --set-oauth pattern):

```bash
MYCO_AGENT_PROVIDER=openai
MYCO_OPENAI_API_KEY=sk-...
# Optional overrides:
MYCO_AGENT_MODEL=gpt-4o           # default: gpt-4o
MYCO_AUX_MODEL=gpt-4o-mini        # default: same as MYCO_AGENT_MODEL
MYCO_AGENT_BASE_URL=https://api.openai.com/v1  # default: https://api.openai.com/v1
MYCO_AGENT_API_KEY=sk-...          # fallback key (used if provider-specific key is absent)
```

To switch back to Claude: unset `MYCO_AGENT_PROVIDER` or set it to `anthropic`.

---

## What Remains (Out of Scope for this PoC)

- Node.js 22+ requirement verification (the OpenAI Agents SDK may need it)
- Full `./test/test.sh` run to verify no regressions in the Claude path
- Live API integration testing with an actual OpenAI key
- Rich system prompt construction for the OpenAI path (currently minimal)
- Dockerfile / deploy.sh changes to support the new env vars
- Client-side `providerId` rendering (showing which provider is active in the UI)