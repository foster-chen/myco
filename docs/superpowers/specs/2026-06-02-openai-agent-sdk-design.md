# OpenAI Agent SDK Integration — Design Spec

**Date:** 2026-06-02  
**Feature:** fr-52 (OpenAI Agents SDK backend)  
**Branch target:** `openai_agent_sdk`  
**Approach:** In-place dual-path (Approach A)  

---

## Goal

Make myco agent-agnostic by adding the OpenAI Agents SDK (`@openai/agents`) as a second agent backend alongside the existing Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`). The provider is selected at deploy time via `MYCO_AGENT_PROVIDER` — no per-session or per-user switching. The OpenAI path supports any OpenAI-compatible API endpoint (Alibaba Cloud, DeepSeek, etc.) via `MYCO_AGENT_BASE_URL`.

**Key constraint:** No dependency on OpenCode (`@opencode-ai/agent-sdk`) or Vercel AI SDK (`ai`). The OpenAI Agents SDK is used directly.

**Verified API:** The `@openai/agents` JS SDK (v0.11.6) API has been verified. Key findings that differ from initial assumptions:
- Tool definition uses `tool()` + Zod schemas (not `function_tool()` + JSON Schema)
- Permission flow uses `needsApproval` + `result.interruptions` + `result.state.approve/reject` + `run(agent, result.state)` (not guardrails + pre-tool hooks)
- Streaming events: `raw_model_stream_event` (text deltas), `run_item_stream_event` (with names: `message_output_created`, `tool_called`, `tool_output`, `tool_approval_requested`, `reasoning_item_created`)
- Custom baseURL: `setDefaultOpenAIClient(new OpenAI({ baseURL }))` or `OpenAIProvider({ baseURL, useResponses: false })`
- OpenAI-compatible endpoints should use `OpenAIProvider({ useResponses: false })` for Chat Completions API
- Requires Node.js 22+ (not Node 20)
- Conversation continuation via `previousResponseId` option on `run()`

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Provider scope | Dual-provider, deploy-time selection | Zero regression risk (Claude path unchanged), matches fr-52 PoC scope |
| Conversation model | `previous_response_id` (SDK-native) | Matches current Claude `resume: sdkSessionId` pattern — remote-managed input, local output mirror |
| Tool implementation | Reuse oc-tools execute logic, wrap in `tool()` + Zod schema format | 80% of tool code is execution logic that's identical across providers. Only the SDK wrapper differs |
| Permission flow | `needsApproval` + `result.interruptions` + `approve/reject` + resume | Multi-step run/interrupt/resume cycle. Same chat-pane UX (Allow once/always/deny) |
| Agent-agnostic endpoint support | `MYCO_AGENT_BASE_URL` for any OpenAI-compatible API | Alibaba Cloud Model Studio, DeepSeek, etc. all expose OpenAI-compatible endpoints |
| Architecture | In-place dual-path in agent-session.js | Minimal diff, proven pattern (opencode_support branch), easy to refactor to adapter layer when provider #3 arrives |

---

## 1. Provider Configuration

**New file:** `server/src/agent-config.js`

Resolves provider config from env vars at deploy time.

```js
function resolve() {
  const provider = process.env.MYCO_AGENT_PROVIDER || 'anthropic';
  const providers = {
    anthropic: {
      id: 'anthropic',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      defaultModel: 'claude-sonnet-4-20250514',
      baseUrl: null,
    },
    openai: {
      id: 'openai',
      apiKeyEnv: 'MYCO_OPENAI_API_KEY',
      defaultModel: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
    },
  };
  const cfg = providers[provider];
  if (!cfg) throw new Error(`Unknown MYCO_AGENT_PROVIDER: ${provider}`);
  return {
    providerId: cfg.id,
    apiKey: process.env[cfg.apiKeyEnv] || process.env.MYCO_AGENT_API_KEY,
    model: process.env.MYCO_AGENT_MODEL || cfg.defaultModel,
    auxModel: process.env.MYCO_AUX_MODEL || cfg.defaultModel,
    baseUrl: process.env.MYCO_AGENT_BASE_URL || cfg.baseUrl,
  };
}
```

**Env vars:**

| Variable | Default | Purpose |
|---|---|---|
| `MYCO_AGENT_PROVIDER` | `'anthropic'` | Select provider: `'anthropic'` or `'openai'` |
| `MYCO_OPENAI_API_KEY` | — | OpenAI API key (primary for openai provider) |
| `MYCO_AGENT_API_KEY` | — | Fallback API key for any provider |
| `MYCO_AGENT_MODEL` | provider default | Override the model used for agent sessions |
| `MYCO_AUX_MODEL` | provider default | Override the model for single-turn calls (/btw, /next rerank, summarizer) |
| `MYCO_AGENT_BASE_URL` | provider default | Custom OpenAI-compatible API endpoint |

**Admin UI:** New keys added to `server/src/index.js` `ENV_KEYS` array so `/config/env` endpoints can read/write them.

**Example deploy configurations:**

| Provider | Env vars |
|---|---|
| Anthropic (default) | None (existing behavior) |
| OpenAI direct | `MYCO_AGENT_PROVIDER=openai`, `MYCO_OPENAI_API_KEY=sk-...` |
| Alibaba Cloud | `MYCO_AGENT_PROVIDER=openai`, `MYCO_AGENT_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`, `MYCO_OPENAI_API_KEY=dashscope-key`, `MYCO_AGENT_MODEL=qwen-max` |
| DeepSeek | `MYCO_AGENT_PROVIDER=openai`, `MYCO_AGENT_BASE_URL=https://api.deepseek.com/v1`, `MYCO_OPENAI_API_KEY=ds-key`, `MYCO_AGENT_MODEL=deepseek-chat` |

---

## 2. OpenAI Agent Session Path

**File:** `server/src/agent-session.js`

The existing `_ensureIteration()` becomes a router:

```js
async _ensureIteration() {
  const { providerId } = agentConfig.resolve();
  if (providerId === 'openai') {
    return this._ensureIterationOpenAI();
  }
  return this._ensureIterationAnthropic(); // existing code, unchanged
}
```

### `_ensureIterationOpenAI()` — new method (~250-300 lines)

The OpenAI SDK uses a **run/interrupt/resume** cycle for tools that need human approval, fundamentally different from Claude's `canUseTool` callback that pauses mid-stream. The implementation must handle this multi-step pattern.

```
1. Create an OpenAI Agent instance with:
   - name: 'myco-agent'
   - model: from agentConfig.resolve().model
   - instructions: system prompt (from existing `_buildSystemPrompt()` method in agent-session.js)
   - tools: from createOpenAITools(sessionId, cwd) (7 oc-tools + myco plan-items)
   - handoffs: none (single-agent, no multi-agent orchestration in PoC)

2. Configure OpenAI client with:
   - For standard OpenAI: setDefaultOpenAIClient(new OpenAI({ apiKey, baseURL }))
   - For OpenAI-compatible endpoints: OpenAIProvider({ baseURL, apiKey, useResponses: false })

3. Run/interrupt/resume cycle:
   a. Call run(agent, input, { stream: true, previousResponseId, signal, maxTurns })
   b. Iterate streaming events: for await (const event of result) { _adaptOpenAIEvent(event) }
   c. await result.completed
   d. If result.interruptions.length > 0:
      - For each interruption: emit permission_request event to chat pane
      - Wait for user to resolve via resolveMenuPick()
      - Call result.state.approve(interruption) or result.state.reject(interruption)
      - Resume: run(agent, result.state, { stream: true, signal })
      - Go back to step b (iterate streaming events from resumed run)
   e. Store result.lastResponseId as this.openaiResponseId
   f. Emit turn_result
   g. Advance run-queue if applicable

4. Retry logic (same 3-attempt pattern as Claude path):
   - Recoverable: rate-limit (429), 5xx, ECONNRESET
   - Non-recoverable: auth error (401), 400 (context exceeded)
   - Exponential backoff: 1s, 4s, 16s

5. Resume/failure fallback:
   - If previousResponseId references an expired/deleted conversation (404):
     clear openaiResponseId, retry fresh
   - Same pattern as Claude's fr-44 resume-failure fallback
```

### `_adaptOpenAIEvent(event)` — event mapping

| OpenAI SDK event | myco `_emit()` type | Notes |
|---|---|---|
| `raw_model_stream_event` (type: `response.output_text.delta`) | `assistant_text` | Streaming text delta from Responses API |
| `run_item_stream_event` (name: `tool_called`) | `tool_use` | Tool invocation with name + args |
| `run_item_stream_event` (name: `tool_output`) | `tool_result` | Tool execution result |
| `run_item_stream_event` (name: `message_output_created`) | `assistant_text` | Complete message output (dedup against deltas) |
| `run_item_stream_event` (name: `tool_approval_requested`) | `permission_request` | Tool paused for human approval |
| `run_item_stream_event` (name: `reasoning_item_created`) | `reasoning_text` | Reasoning/thinking item (new type) |
| `agent_updated_stream_event` | (internal, no emit) | Agent switch notification (not used in single-agent PoC) |
| Stream error / run error | `fatal` or `retry_attempt` | Depends on error type |
| `result.interruptions` (post-stream) | `permission_request` | Approval interruptions resolved via chat pane |

### Other session method changes

- `interrupt()` → for OpenAI: abort via AbortController signal on the active run() call
- `write(msg)` → for OpenAI: push message into `_msgQueue` (same queue mechanism, different consumption)
- `resolveMenuPick(hash, n)` → resolves pending permission Promise for both paths (shared)
- Session record (`sessions.json`) gains `openaiResponseId` field alongside existing `sdkSessionId`

---

## 3. Tool Implementations

**New directory:** `server/src/oc-tools/` (7 files)

Tool execute logic (the pure functions that do the actual work — `exec()`, `fs.readFileSync()`, etc.) is extracted from the opencode_support branch's oc-tools and adapted to work as standalone functions with no SDK dependency. These are then wrapped in `@openai/agents`'s `tool()` function with Zod parameter schemas. Not a wholesale copy — the execute logic is reused, the SDK wrapper is rewritten.

| Tool | File | OpenAI function name | Execute logic |
|---|---|---|---|
| Bash | `bash.js` | `bash` | `child_process.exec()` with timeout |
| Read | `read.js` | `read_file` | `fs.readFileSync()` + line formatting |
| Edit | `edit.js` | `edit_file` | Exact string replacement |
| Write | `write.js` | `write_file` | `fs.writeFileSync()` |
| Glob | `glob.js` | `glob` | `fast-glob` pattern matching |
| Grep | `grep.js` | `grep` | `ripgrep` (child process) or Node fallback |
| WebFetch | `webfetch.js` | `web_fetch` | `fetch()` HTTP GET |

Each tool is defined as:

```js
import { tool } from '@openai/agents';
import { z } from 'zod';
import { executeBash } from './oc-tools/bash.js';

export const bashTool = tool({
  name: 'bash',
  description: 'Executes a bash command in a persistent shell session...',
  parameters: z.object({
    command: z.string().describe('The command to execute'),
    timeout: z.number().optional().describe('Timeout in milliseconds'),
    workdir: z.string().optional().describe('Working directory'),
  }),
  strict: true,
  needsApproval: true,  // Requires human approval (bash is dangerous)
  execute: executeBash,
});
```

**Aggregator:** `createOpenAITools(sessionId, cwd)` returns an array of all 7 tools + the myco plan-items tool, suitable for the Agent's `tools` config.

**Package dependency:** `fast-glob`, `zod`, `openai` added to `server/package.json`.

**Key design choice:** Tool execute functions are pure — no SDK dependency. The `function_tool()` wrapper is the only SDK-specific part. This makes the execute logic portable across providers.

---

## 4. Permission Flow

The OpenAI Agents SDK uses a fundamentally different permission mechanism from Claude's `canUseTool` callback. Claude pauses the stream internally when a permission menu is needed; the OpenAI SDK returns a result with `interruptions` that must be resolved before resuming the run.

### `needsApproval` on tool definitions (marks tools for human approval)

Tools marked `needsApproval: true` (or with an async predicate) will pause the agent run when called. The run completes with `result.interruptions` containing each pending approval.

```
Tool approval marking:
├── needsApproval: false (default) — read_file, glob, grep, web_fetch, add_plan_items
│   (matches Claude path: mcp__myco__* auto-approval)
├── needsApproval: true — bash, edit_file, write_file
│   (dangerous tools require human approval)
└── needsApproval: async predicate — for dynamic approval decisions
```

### Run/interrupt/resume cycle

```
1. run(agent, input, { stream: true }) → StreamedRunResult
2. Iterate streaming events, emit _adaptOpenAIEvent() for each
3. await result.completed
4. Check result.interruptions:
   a. If interruptions.length > 0:
      - For each interruption:
        - Emit permission_request event with tool name + args
        - Store interruption reference in this._pendingOCApprovals Map (keyed by hash)
        - Wait for user to click in chat pane (resolveMenuPick)
      - For each resolved interruption:
        - "Allow once" → result.state.approve(interruption)
        - "Allow always" → result.state.approve(interruption, { alwaysApprove: true })
          + persist rule to .claude/settings.local.json
        - "Deny" → result.state.reject(interruption, { message: 'Denied' })
      - Resume: result = run(agent, result.state, { stream: true })
      - Go back to step 2
   b. If no interruptions:
      - Store result.lastResponseId as this.openaiResponseId
      - Emit turn_result
      - Advance run-queue
```

### How it differs from Claude's flow

| Aspect | Claude SDK | OpenAI Agents SDK |
|---|---|---|
| When approval happens | During stream via `canUseTool` callback | After stream completes, via `result.interruptions` |
| How stream pauses | SDK pauses internally, resumes when callback returns | Run returns with interruptions, must call `run(agent, state)` to resume |
| Multiple approvals | Sequential via `canUseTool` calls | All pending at once in `result.interruptions`, resolved one by one |
| Resume mechanism | Callback return value `{behavior: 'allow'|'deny'}` | `result.state.approve/reject` + `run(agent, state)` |

### Chat pane integration (shared between both paths)

- `resolveMenuPick(hash, n)` works for both paths — resolves the pending Promise
- For OpenAI path: the resolve also calls `result.state.approve/reject` on the corresponding interruption
- "Allow always" updates `.claude/settings.local.json` (same file, same format, works for both providers)
- `_preToolUseHookCheck()` (shared logic extracted from Claude's `_preToolUseHook`) checks the allow/deny list for both paths — for OpenAI, it's used to dynamically set `needsApproval` predicates

---

## 5. Single-Turn Helpers

### `btw.js` — dual-path

```
runClaudeP(cwd, promptBody):
  if provider === 'openai': return runOpenAIP(cwd, promptBody)
  else: return runAnthropicP(cwd, promptBody)  // existing code

runOpenAIP(cwd, promptBody):
  Uses run() from @openai/agents with:
    - agent: lightweight single-turn Agent (no tools, no memory)
    - input: promptBody (string)
    - maxTurns: 1 (single turn, no tool loop)
    - model: auxModel from agentConfig
  Returns text response or error fallback
  60s timeout via AbortController signal
```

### `claude-cli.js` — dual-path

```
callClaudeCli({system, userMessage, cwd, timeoutMs}):
  if provider === 'openai': return callOpenAICli(...)
  else: return callAnthropicCli(...)  // existing code

callOpenAICli(...):
  Uses run() from @openai/agents with:
    - agent: single-turn Agent with instructions = system prompt
    - input: userMessage
    - tools: [] (no tools)
    - maxTurns: 1
```

### `anthropic.js` — dual-path

Existing `callAnthropic()` does raw HTTPS to `api.anthropic.com/v1/messages`. For the OpenAI path, replace with `fetch()` to the OpenAI Chat Completions API at `{baseUrl}/chat/completions` using `MYCO_AGENT_BASE_URL` (not hardcoded `api.openai.com`). Uses Chat Completions (not Responses) since this is a simple single-message call. Same function signature — simple HTTP call for summarizer/extractor.

### `myco-mcp.js` — dual interface

```
createMycoMcpServer(sessionId) → existing Claude SDK MCP server (unchanged)
createMycoMcpToolsOpenAI(sessionId) → array of tool() definitions for add_plan_items
```

The OpenAI path uses `tool()` + Zod schema instead of `createSdkMcpServer()` + `tool()` + `jsonSchema()`. Same tool semantics, different definition format.

---

## 6. WS Frame Compatibility

All `_emit()` event types stay identical across providers. The WS layer (`attach.js`) and client (`app.js`) receive the same `agent-event` frames regardless of provider. **Zero client-side changes needed.**

**New `_emit()` types for OpenAI path:**
- `reasoning_text` — maps from OpenAI's `reasoning_item_created` (reasoning/thinking output)
- `permission_request` — also emitted from `result.interruptions` (post-stream approval requests)

---

## 7. Testing Strategy

### Static checks in `./test/test.sh`

- `MYCO_AGENT_PROVIDER` env var recognized in `agent-config.js` (valid values: `'anthropic'`, `'openai'`)
- `oc-tools/` directory exists with 7 tool files
- `myco-mcp-openai.js` exports `createMycoMcpToolsOpenAI()`
- `_ensureIterationOpenAI` and `_adaptOpenAIEvent` methods exist on `AgentSession`
- No hardcoded `api.openai.com` URLs outside of `agent-config.js` defaults

### Unit tests (`test/agent-config.test.js`)

- `resolve()` returns anthropic config by default
- `resolve()` returns openai config when `MYCO_AGENT_PROVIDER=openai`
- `resolve()` uses `MYCO_AGENT_BASE_URL` when set
- `resolve()` uses `MYCO_AGENT_MODEL` override
- `resolve()` throws on unknown provider
- `resolve()` uses `MYCO_AGENT_API_KEY` as fallback

### Integration smoke test (`test/agent-session-openai.test.js`)

- Requires `MYCO_AGENT_PROVIDER=openai` + valid API key
- Spawns a session, sends message, verifies `assistant_text` and `turn_result` events
- Skipped in CI if no API key available

### oc-tools tests (`test/oc-tools.test.js`)

- Each tool's execute function works independently (no SDK dependency)
- bash, read, edit, write, glob, grep, webfetch tested with real files/commands

### Cross-provider compatibility test

- Verify `_emit()` event types identical for both providers
- Verify `resolveMenuPick()` works for both paths

---

## 8. Error Handling

All error paths follow the same 3-attempt retry + exponential backoff pattern established in the Claude path.

| Error | HTTP status | Handling |
|---|---|---|
| Rate limiting | 429 | Retry with exponential backoff (3 attempts) |
| Context window exceeded | 400 `max_context_length_exceeded` | Emit `fatal` + restart fresh |
| API key invalid | 401 | Emit `fatal`, no retry |
| Conversation expired | 404 (invalid `previous_response_id`) | Clear `openaiResponseId`, retry fresh |
| Connection errors | ECONNRESET, timeout | Retry with exponential backoff |
| Provider endpoint unreachable | Custom `MYCO_AGENT_BASE_URL` down | Same connection error handling |

---

## 9. Files Changed

### New files

| File | Purpose |
|---|---|
| `server/src/agent-config.js` | Provider resolution (env vars → config object) |
| `server/src/oc-tools/bash.js` | Bash tool execute logic |
| `server/src/oc-tools/read.js` | Read tool execute logic |
| `server/src/oc-tools/edit.js` | Edit tool execute logic |
| `server/src/oc-tools/write.js` | Write tool execute logic |
| `server/src/oc-tools/glob.js` | Glob tool execute logic |
| `server/src/oc-tools/grep.js` | Grep tool execute logic |
| `server/src/oc-tools/webfetch.js` | WebFetch tool execute logic |
| `server/src/oc-tools/index.js` | Tool aggregator + `createOpenAITools()` |
| `server/src/myco-mcp-openai.js` | OpenAI tool definitions for plan items |
| `test/agent-config.test.js` | Unit tests for provider config |
| `test/oc-tools.test.js` | Unit tests for oc-tools |
| `test/agent-session-openai.test.js` | Integration smoke test for OpenAI path |

### Modified files

| File | Change |
|---|---|
| `server/src/agent-session.js` | Add `_ensureIterationOpenAI()` (run/interrupt/resume cycle), `_adaptOpenAIEvent()` (verified event names), `_canUseToolOpenAI()` (needsApproval + interruptions), `_preToolUseHookCheck()` (extracted shared), routing in `_ensureIteration()`, `interrupt()` + `write()` dual-path, `resolveMenuPick()` shared, `_pendingOCApprovals` Map, `openaiResponseId` field |
| `server/src/btw.js` | Dual-path: `runOpenAIP()` alongside `runAnthropicP()` |
| `server/src/claude-cli.js` | Dual-path: `callOpenAICli()` alongside `callAnthropicCli()` |
| `server/src/anthropic.js` | Dual-path: OpenAI Responses API fallback alongside raw Anthropic HTTPS |
| `server/src/myco-mcp.js` | Add `createMycoMcpToolsOpenAI()` alongside `createMycoMcpServer()` |
| `server/src/index.js` | Add new env keys to `ENV_KEYS` array |
| `server/package.json` | Add `@openai/agents`, `openai`, `zod`, `fast-glob` dependencies |
| `test/test.sh` | Add static checks + test file references for OpenAI path |

### Unchanged files

All client-side files (`web/public/`), `attach.js`, `sessions.js`, `artifacts.js`, `auth.js`, `logCapture.js`, `slashcmds.js`, `runQueue.js`, `whatsnext.js`, `menu.js` — these only consume `_emit()` events and don't touch the SDK directly.

---

## 10. Out of Scope (PoC Phase)

- Multi-agent orchestration via OpenAI handoffs (single agent only)
- OpenAI Assistants API / thread-based sessions (using `previous_response_id` instead)
- Provider selection per-session or per-user (deploy-time only)
- Provider hot-swapping without container restart (requires config reload)
- Output guardrails (input guardrail only for PoC)
- MCP tool server integration via OpenAI SDK (plan items tool defined as `function_tool` directly)
- Provider #3+ support (refactor to adapter layer when needed)
- Node.js version upgrade to 22+ (required by @openai/agents — current Dockerfile uses Node 20; upgrade is a separate deploy concern)