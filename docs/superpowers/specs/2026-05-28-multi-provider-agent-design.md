# Multi-Provider Agent Backend Design

**Date:** 2026-05-28
**Status:** Draft — pending user review

## Problem

Myco's agent sessions are deeply coupled to `@anthropic-ai/claude-agent-sdk`. The SDK's `query()` async-iterator, event shape, permission callbacks, and `~/.claude/` auth infrastructure are embedded throughout `agent-session.js`, `btw.js`, `claude-cli.js`, `myco-mcp.js`, and `anthropic.js`. There is no abstraction layer — the `AgentSession` class is a concrete implementation with Anthropic-specific code baked in.

Users who want to use Alibaba Cloud (DashScope) or Z.AI (Zhipu) models instead of Anthropic's Claude cannot do so without maintaining a separate fork.

## Goal

Allow myco deployments to configure an agent provider other than Anthropic (specifically Alibaba-CN/Zhipu), supplying the provider's API key, and have the full agent loop, auxiliary calls, and MCP tools work through that provider — with zero Anthropic dependency when a non-Anthropic provider is selected.

### Constraints (user-specified)

1. Agent provider is **strictly deployment-level** — no per-session choice.
2. When provider is not Anthropic, the **full agent loop** is replaced with opencode's Vercel AI SDK-based framework; Anthropic path is preserved unchanged.
3. Myco imports **opencode as npm dependency** (`@opencode-ai/agent-sdk`), not by migrating opencode's code into myco. Minimize code, maximize future provider expandability.

## Architecture

### Approach: @opencode-ai/agent-sdk Package

A new public npm package extracted from opencode that provides the agent/LLM/provider resolution layer without Effect dependency. Myco imports this package. When `MYCO_AGENT_PROVIDER` is `anthropic`, the existing Claude SDK path runs unchanged. When it is any other value, the opencode path runs.

```mermaid
flowchart TB
    subgraph myco [Myco AgentSession — Dispatcher]
        cfg[Read MYCO_AGENT_PROVIDER]
        cfg -->|anthropic| sdk[Claude Agent SDK<br/>query loop<br/>existing _ensureIteration]
        cfg -->|alibaba-cn / zhipuai / etc| oc["@opencode-ai/agent-sdk<br/>streamText loop<br/>new _ensureIterationOC"]
    end

    sdk --> events1[_handleEvent → myco events]
    oc --> events2[_adaptOCEvent → myco events]

    events1 --> ws[WS broadcast via attach.js]
    events2 --> ws

    subgraph pkg [@opencode-ai/agent-sdk package]
        resolve[resolveProvider]
        create[createAgent]
        stream[AgentHandle.stream]
        tools[tool helpers]
    end

    oc --> resolve
    oc --> create
    create --> stream
```

### Component 1: @opencode-ai/agent-sdk Package

**Source:** Extracted from opencode's `packages/opencode/src/provider/` and `packages/opencode/src/session/llm.ts`.

**Exports:**

| Export | Purpose | Signature |
|---|---|---|
| `createAgent` | Create an agent session handle | `({ provider, model, apiKey, baseURL?, tools, systemPrompt?, messages?, canUseTool? }) → AgentHandle` |
| `resolveProvider` | Resolve a provider+model to a Vercel AI SDK LanguageModelV3 | `({ providerId, apiKey, baseURL? }) → { sdk, model, options }` |
| `supportedProviders` | List of supported provider IDs | `string[]` |
| `tool` / `jsonSchema` | Vercel AI SDK tool definition helpers | Same as `ai` package exports |

**AgentHandle interface:**

```typescript
interface AgentHandle {
  stream(): AsyncIterable<LLMEvent>;
  write(text: string): void;
  interrupt(): void;
  kill(): void;
  sessionId: string;
}

type LLMEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; result: unknown }
  | { type: "step_start"; index: number }
  | { type: "step_finish"; reason: string; usage: { inputTokens: number; outputTokens: number } }
  | { type: "finish"; reason: string; usage: { inputTokens: number; outputTokens: number } }
  | { type: "error"; error: Error }
```

**What gets extracted from opencode:**

- Provider resolution (`provider.ts` → `resolveSDK`, `BUNDLED_PROVIDERS`, `custom()`)
- Provider transforms (`transform.ts` → message/schema/option normalization: Alibaba-CN `enable_thinking`, Zhipu `thinking: { type: "enabled" }`, Anthropic caching, etc.)
- The `streamText()`-based agent loop (`llm.ts` → `stream()`, `LLMAISDK.toLLMEvents()`)
- Tool schema helpers (`tools.ts` → `jsonSchema`, schema transforms per provider)
- `@ai-sdk/openai-compatible` factory creation for Alibaba/Zhipu endpoints

**What stays in opencode only:**

- Effect service layer (`Context.Service`, `Layer`, dependency injection)
- CLI, TUI, web UI
- Session management, config persistence
- MCP client (myco brings its own MCP)

**Key design decision:** The extracted package uses plain async/await — no Effect runtime. Effect's `Layer` composition is replaced with direct factory functions. The `streamText()` call and event adaptation are the same logic opencode uses internally, wrapped in a simpler callback-based API.

**Supported provider mapping:**

| Provider ID | SDK Package | Base URL | Env Var | Special Config |
|---|---|---|---|---|
| `anthropic` | `@ai-sdk/anthropic` | (SDK default) | `ANTHROPIC_API_KEY` | Caching transforms |
| `alibaba-cn` | `@ai-sdk/openai-compatible` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `DASHSCOPE_API_KEY` | `enable_thinking: true` for reasoning models |
| `alibaba` | `@ai-sdk/openai-compatible` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `DASHSCOPE_API_KEY` | Same thinking config |
| `zhipuai` | `@ai-sdk/openai-compatible` | `https://open.bigmodel.cn/api/paas/v4` | `ZHIPU_API_KEY` | `thinking: { type: "enabled", clear_thinking: false }` |
| `alibaba-coding-plan-cn` | `@ai-sdk/openai-compatible` | `https://coding.dashscope.aliyuncs.com/v1` | `ALIBABA_CODING_PLAN_API_KEY` | — |

### Component 2: Myco AgentSession Adapter

`agent-session.js` becomes a dispatcher. The class stays an `EventEmitter` with the same public interface (`write`, `interrupt`, `kill`, events: `assistant_text`, `tool_use`, `tool_result`, `turn_result`, `menu`, `exit`). Internally it selects the backend based on `MYCO_AGENT_PROVIDER`.

**Changes to `_ensureIteration()`:**

Split into two paths:

1. **Anthropic path** (when `MYCO_AGENT_PROVIDER === 'anthropic'` or unset): existing `query()` + `AsyncMessageQueue` + `_handleEvent()` — completely unchanged.
2. **Non-Anthropic path** (when `MYCO_AGENT_PROVIDER` is any other value): 
   - Calls `agentSdk.createAgent({ provider: providerId, model, apiKey, tools, systemPrompt })` 
   - Gets `AgentHandle` 
   - `handle.stream()` produces `LLMEvent` async iterable 
   - `_adaptOCEvent()` maps `LLMEvent` types to the same myco event names:
     - `LLMEvent.text` → `assistant_text`
     - `LLMEvent.tool_call` → `tool_use`
     - `LLMEvent.tool_result` → `tool_result`
     - `LLMEvent.finish` → `turn_result` (with usage/cost data)
     - `LLMEvent.error` → emit `exit` with descriptive message

**Permission handling adapts per path:**

- Anthropic path: `canUseTool` + `PreToolUse` callbacks (existing, unchanged)
- Non-Anthropic path: `createAgent()` accepts a `canUseTool` callback with the same signature as the Anthropic SDK's — `(toolName, input, context) → Promise<{ behavior: 'allow' | 'deny', updatedInput?, updatedPermissions? }>`. This allows the non-Anthropic path to emit the same `menu` events to the browser for interactive permission prompts. The allow/deny list auto-approval logic (currently in `_preToolUseHook`) is applied before calling `canUseTool` — matching the Anthropic path's two-stage permission flow.

**MCP tools adapt per path:**

- Anthropic path: `createSdkMcpServer()` from `myco-mcp.js` (existing)
- Non-Anthropic path: Vercel AI SDK `dynamicTool()` format. `myco-mcp.js` exports a `createMycoMcpToolsOC()` function that returns tool definitions in `{ tool, jsonSchema }` format.

**Auxiliary calls (btw.js, claude-cli.js, anthropic.js):**

- Anthropic path: existing direct API calls unchanged
- Non-Anthropic path: use `@opencode-ai/agent-sdk`'s `generateText()` (a synchronous helper wrapping `generateText()` from Vercel AI SDK) with the configured provider
- `anthropic.js`'s summarizer/extractor: switches to opencode's `generateText()` when non-Anthropic provider. Model defaults to the configured provider's model; a lighter model can be specified via `MYCO_AUX_MODEL` env var.

**Session resume:**

- Anthropic path: `sdkOpts.resume = sdkSessionId` (existing)
- Non-Anthropic path: session history is passed as a `messages` array to `createAgent()`. Opencode's `streamText()` reconstructs context from the persisted messages. No provider-specific session ID needed.

### Component 3: Deployment & Auth Configuration

**Env vars in `$STATE_DIR/.env`:**

| Variable | Purpose | Default |
|---|---|---|
| `MYCO_AGENT_PROVIDER` | Agent backend selection | `anthropic` |
| `MYCO_AGENT_MODEL` | Override the default model | (empty = provider default) |
| `MYCO_AGENT_API_KEY` | API key for the configured provider | (empty) |
| `MYCO_AUX_MODEL` | Model for auxiliary calls (summarizer, /btw) | (empty = same as MYCO_AGENT_MODEL) |

**API key resolution priority:**

1. `MYCO_AGENT_API_KEY` if set
2. Provider-specific env var (`DASHSCOPE_API_KEY`, `ZHIPU_API_KEY`, `ANTHROPIC_API_KEY`) if set
3. Error at startup: "No API key found for provider <X>"

**Dockerfile changes:**

- The Dockerfile no longer conditionally installs `claude-code` at build time. Instead, `docker-entrypoint.sh` reads `MYCO_AGENT_PROVIDER` at container start (runtime) and:
  - If `anthropic`: verifies `@anthropic-ai/claude-code` is installed (still a global npm dep in the image), sets up `~/.claude/` bind-mount paths
  - If non-Anthropic: skips `~/.claude/` setup entirely. The `@opencode-ai/agent-sdk` + Vercel AI SDK provider packages are always installed in the image (they're small)
- The Dockerfile always installs `@opencode-ai/agent-sdk`, `ai`, `@ai-sdk/openai-compatible`, and `@ai-sdk/anthropic` as production deps in `server/package.json`. The Anthropic SDK dep (`@anthropic-ai/claude-agent-sdk`) remains too — both are present, and runtime selection determines which is used.

**deploy.sh changes:**

- `--set-agent-provider <provider>` — writes `MYCO_AGENT_PROVIDER` to `.env`
- `--set-agent-key <key>` — writes `MYCO_AGENT_API_KEY` to `.env`
- Startup validation: refuses to start if provider is non-Anthropic but no API key is set

**What stays unchanged when provider is Anthropic:**

- `~/.claude/` bind-mount and auth infrastructure
- `settingSources: ['project', 'local', 'user']` in sdkOpts
- `claude-code` global install
- The SDK reads auth from `~/.claude/settings.json` OR from `ANTHROPIC_API_KEY` env var — both work

### Component 4: Error Handling & Testing

**Error handling per provider path:**

- Anthropic path: existing `_isRecoverable()` + retry logic unchanged
- Non-Anthropic path: `@opencode-ai/agent-sdk` exposes error types that myco maps:
  - Rate limit → `rate_limit` event (same as Anthropic)
  - Auth failure → emit `exit` with message like "DASHSCOPE_API_KEY invalid"
  - Stream interrupted → `interrupt()` works the same way
  - Provider unavailable → retry with backoff (same pattern as Anthropic, 3 attempts with `[1000, 4000, 16000]` ms)

**New test coverage:**

| Test File | What It Verifies |
|---|---|
| `test/agent-provider-switch.test.js` | `MYCO_AGENT_PROVIDER` env var selects Anthropic vs opencode path. Mock both backends. |
| `test/alibaba-provider.test.js` | DashScope key resolution, `createOpenAICompatible()` with correct baseURL, `enable_thinking` injection. |
| `test/zhipuai-provider.test.js` | Same for Zhipu: key resolution, baseURL, thinking config. |
| `test/mcp-format-switch.test.js` | MCP tools export in both Anthropic SDK format and Vercel AI SDK `dynamicTool()` format. |
| `test/test.sh` static checks | Assert `MYCO_AGENT_PROVIDER` read in `agent-session.js`; assert `@opencode-ai/agent-sdk` import; assert `myco-mcp.js` exports both MCP formats. |
| Integration smoke | Deploy with `MYCO_AGENT_PROVIDER=alibaba-cn`, verify session completes a full tool-call cycle. |

**What stays unchanged (no edits needed):**

- `attach.js` — WS broadcast layer is provider-agnostic (consumes myco event names, which both paths emit)
- `sessions.js` — session spawn/resume only needs to pass provider config to `AgentSession`
- `auth-sessions.json` — myco's web auth (GitHub OAuth) is unrelated to agent provider auth
- `web/public/app.js` — browser client is unaware of agent backend; renders events by name

## Scope Boundaries

**In scope:**
- Creating `@opencode-ai/agent-sdk` npm package (in opencode repo)
- Modifying `agent-session.js` to add dispatcher + opencode path
- Modifying `myco-mcp.js` to export both MCP formats
- Modifying `btw.js`, `claude-cli.js`, `anthropic.js` for non-Anthropic auxiliary calls
- Adding `MYCO_AGENT_PROVIDER`, `MYCO_AGENT_MODEL`, `MYCO_AGENT_API_KEY`, `MYCO_AUX_MODEL` env vars
- Dockerfile conditional `claude-code` install
- deploy.sh new flags
- Test coverage listed above

**Out of scope (future work):**
- Per-session provider choice (explicitly excluded by user)
- OpenAI Agents SDK integration (fr-52 — separate effort)
- Additional providers beyond Alibaba/Zhipu (supported by architecture but not implemented in first pass)
- OAuth flow for Alibaba/Zhipu (only API key auth for now)
- Native LLM path (`@opencode-ai/llm`) — first pass uses Vercel AI SDK path only