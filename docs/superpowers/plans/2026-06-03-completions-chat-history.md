# Completions-Only Chat History Context — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all Responses API functionality from the OpenAI SDK path and replace server-managed conversation state (`previousResponseId`) with client-side chat history context (`MemorySession` + `rec.openaiHistory`).

**Architecture:** The OpenAI SDK's `MemorySession` auto-accumulates `AgentInputItem[]` history across `run()` calls within a live process. After each successful turn, the history is trimmed and persisted to `rec.openaiHistory` in `sessions.json`. On respawn (container restart), history is rehydrated from `rec.openaiHistory` into a fresh `MemorySession`. If `rec.openaiHistory` is empty (migration case), history is reconstructed from `events.jsonl`. Provider setup is simplified to always use `OpenAIProvider({ useResponses: false })` — no dual-branch `setDefaultOpenAIClient` vs `OpenAIProvider` pattern.

**Tech Stack:** Node.js, `@openai/agents` SDK (Agent, run, OpenAIProvider, setDefaultModelProvider, MemorySession), `sessions.json` persistence, `events.jsonl` fallback.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `server/src/chat-history-openai.js` | Pure functions: `trimHistoryToBudget()`, `estimateChars()`, `splitIntoTurns()`, `reconstructHistoryFromEvents()`. No SDK dependency for conversion logic — just transforms event objects into `AgentInputItem[]` shape. |
| `test/chat-history-openai.test.js` | Unit tests for all `chat-history-openai.js` exports. |

### Modified files

| File | Changes |
|---|---|
| `server/src/agent-session.js` | Remove `openaiResponseId` field, `_persistOpenaiResponseId()`, `previousResponseId`, 404 handler, `setDefaultOpenAIClient` import. Add `_openaiSession` (MemorySession), `_openaiHistoryItems` (from rec), `_persistOpenaiHistory()`. Change provider setup to single `OpenAIProvider({ useResponses: false })`. Pass `session` to `run()`. Remove `raw_model_stream_event` handler. Remove 200-char truncation on `turn_start`. Add context-overflow recovery. |
| `server/src/sessions.js` | Replace `resumeOpenaiResponseId` with `resumeOpenaiHistory` in spawn options. Add migration: if `rec.openaiResponseId` exists but `rec.openaiHistory` is empty, reconstruct from events.jsonl. |
| `server/src/btw.js` | Replace `setDefaultOpenAIClient(new OpenAI({ apiKey }))` with `setDefaultModelProvider(new OpenAIProvider({ apiKey, useResponses: false }))`. |
| `server/src/claude-cli.js` | Same as btw.js. |
| `server/src/index.js` | Add `MYCO_CONTEXT_MAX_TOKENS` to `ENV_KEYS`. |
| `test/agent-session-openai.test.js` | Replace `setDefaultOpenAIClient` with `OpenAIProvider, setDefaultModelProvider`. Remove `previousResponseId` / `lastResponseId` test. Add `MemorySession`-based history accumulation test. |
| `test/adapt-openai-event.test.js` | Remove `response.output_text.delta` mock. Update for Completions-mode events (remove `raw_model_stream_event` branch). |
| `test/test.sh` | Remove static check for `_persistOpenaiResponseId`. Add checks for `_openaiSession`, `_persistOpenaiHistory`, `chat-history-openai.js`, absence of `openaiResponseId` / `setDefaultOpenAIClient`. |

### Deleted files

| File | Reason |
|---|---|
| `temp.py` | One-off Responses API test with hardcoded key. |

---

## Task 1: Create `chat-history-openai.js` module and tests

**Files:**
- Create: `server/src/chat-history-openai.js`
- Create: `test/chat-history-openai.test.js`

This module provides pure functions for history trimming, turn splitting, token estimation, and event→AgentInputItem conversion. No SDK imports — just plain JS data transformations.

- [ ] **Step 1: Write failing tests for `chat-history-openai.js`**

Create `test/chat-history-openai.test.js`:

```js
'use strict';

const assert = require('assert');
const {
  trimHistoryToBudget,
  estimateChars,
  splitIntoTurns,
  reconstructHistoryFromEvents,
} = require('../server/src/chat-history-openai');

const MAX_TOKENS = 32000;

function makeItems(n) {
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push({ type: 'message', role: 'user', content: `User message ${i}` });
    items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `Assistant reply ${i}` }] });
  }
  return items;
}

assert.ok(typeof estimateChars === 'function', 'estimateChars is a function');
assert.ok(typeof splitIntoTurns === 'function', 'splitIntoTurns is a function');
assert.ok(typeof trimHistoryToBudget === 'function', 'trimHistoryToBudget is a function');
assert.ok(typeof reconstructHistoryFromEvents === 'function', 'reconstructHistoryFromEvents is a function');

console.log('PASS: all exports exist');

const shortItems = makeItems(3);
const chars = estimateChars(shortItems);
assert.ok(typeof chars === 'number', 'estimateChars returns a number');
assert.ok(chars > 0, 'estimateChars returns positive number for non-empty items');
console.log('PASS: estimateChars works on non-empty items');

const turns = splitIntoTurns(shortItems);
assert.strictEqual(turns.length, 3, 'splitIntoTurns splits 3 user→assistant pairs into 3 turns');
for (const turn of turns) {
  assert.ok(turn.length >= 2, 'each turn has at least user + assistant items');
  assert.strictEqual(turn[0].role, 'user', 'first item in each turn is user message');
}
console.log('PASS: splitIntoTurns groups by user→assistant boundaries');

const withinBudget = trimHistoryToBudget(shortItems, MAX_TOKENS);
assert.strictEqual(withinBudget.length, shortItems.length, 'items within budget are returned unchanged');
console.log('PASS: trimHistoryToBudget returns all items when under budget');

const longItems = makeItems(20);
const tinyBudget = 500;
const trimmed = trimHistoryToBudget(longItems, tinyBudget);
assert.ok(trimmed.length < longItems.length, 'over-budget items are trimmed');
assert.strictEqual(trimmed[0].role, 'user', 'trimmed items start with a user message (turn boundary preserved)');
console.log('PASS: trimHistoryToBudget drops oldest turns when over budget');

const singleTurn = trimHistoryToBudget(makeItems(1), 1);
assert.strictEqual(singleTurn.length, 2, 'never trim below 1 turn');
console.log('PASS: trimHistoryToBudget keeps at least 1 turn');

const events = [
  { type: 'turn_start', prompt: 'Fix the login bug' },
  { type: 'assistant_text', text: 'I will look at the login code.' },
  { type: 'tool_use', name: 'bash', id: 'call_abc', input: { command: 'grep -r login' } },
  { type: 'tool_result', tool_use_id: 'call_abc', content: 'login found in auth.js' },
  { type: 'assistant_text', text: 'The bug is in auth.js.' },
  { type: 'turn_result', text: 'The bug is in auth.js on line 42.' },
  { type: 'turn_start', prompt: 'Fix it now' },
  { type: 'assistant_text', text: 'I will fix the bug.' },
  { type: 'turn_result', text: 'Bug fixed.' },
];

const reconstructed = reconstructHistoryFromEvents(events);
assert.ok(Array.isArray(reconstructed), 'reconstructHistoryFromEvents returns an array');
assert.ok(reconstructed.length >= 4, 'reconstructed items include user + assistant + tool calls');
const firstUser = reconstructed.find(i => i.role === 'user');
assert.ok(firstUser, 'reconstructed history contains user message');
assert.strictEqual(firstUser.content, 'Fix the login bug', 'user content matches turn_start prompt');
const firstToolCall = reconstructed.find(i => i.type === 'function_call');
assert.ok(firstToolCall, 'reconstructed history contains tool call');
assert.strictEqual(firstToolCall.name, 'bash', 'tool call name preserved');
assert.strictEqual(firstToolCall.call_id, 'call_abc', 'tool call id preserved');
console.log('PASS: reconstructHistoryFromEvents converts events to AgentInputItem[]');

console.log('ALL PASS');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/chat-history-openai.test.js`
Expected: FAIL — module doesn't exist yet

- [ ] **Step 3: Create `server/src/chat-history-openai.js`**

```js
'use strict';

function estimateChars(items) {
  let total = 0;
  for (const item of items) {
    if (item.type === 'message') {
      if (typeof item.content === 'string') {
        total += item.content.length;
      } else if (Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part.type === 'output_text' && typeof part.text === 'string') {
            total += part.text.length;
          } else if (typeof part === 'string') {
            total += part.length;
          }
        }
      }
    } else if (item.type === 'function_call') {
      total += (item.name || '').length;
      total += (item.arguments || '').length;
    } else if (item.type === 'function_call_result') {
      total += typeof item.output === 'string' ? item.output.length : 0;
    } else if (item.type === 'reasoning') {
      if (Array.isArray(item.summary)) {
        for (const s of item.summary) {
          total += (s.text || '').length;
        }
      }
    }
  }
  return total;
}

function splitIntoTurns(items) {
  const turns = [];
  let currentTurn = [];
  for (const item of items) {
    if (item.type === 'message' && item.role === 'user' && currentTurn.length > 0) {
      turns.push(currentTurn);
      currentTurn = [];
    }
    currentTurn.push(item);
  }
  if (currentTurn.length > 0) {
    turns.push(currentTurn);
  }
  return turns;
}

function trimHistoryToBudget(items, maxTokens) {
  const maxChars = maxTokens * 4;
  if (items.length === 0) return items;
  const totalChars = estimateChars(items);
  if (totalChars <= maxChars) return items;
  const turns = splitIntoTurns(items);
  let kept = turns;
  while (kept.length > 1 && estimateChars(kept.flat()) > maxChars) {
    kept = kept.slice(1);
  }
  return kept.flat();
}

function reconstructHistoryFromEvents(events) {
  const turns = [];
  let currentTurn = null;

  for (const ev of events) {
    if (ev.type === 'turn_start') {
      if (currentTurn) turns.push(currentTurn);
      currentTurn = {
        userMsg: ev.prompt || '',
        assistantTexts: [],
        toolCalls: [],
        toolResults: [],
        reasoningTexts: [],
        turnResultText: null,
      };
      continue;
    }
    if (!currentTurn) continue;

    if (ev.type === 'assistant_text') {
      currentTurn.assistantTexts.push(ev.text || '');
    } else if (ev.type === 'tool_use') {
      currentTurn.toolCalls.push({
        type: 'function_call',
        name: ev.name,
        call_id: ev.id || ev.toolCallId,
        arguments: JSON.stringify(ev.input || {}),
      });
    } else if (ev.type === 'tool_result') {
      currentTurn.toolResults.push({
        type: 'function_call_result',
        call_id: ev.tool_use_id || ev.toolCallId,
        output: typeof ev.content === 'string' ? ev.content : (ev.output || ''),
      });
    } else if (ev.type === 'reasoning_text') {
      currentTurn.reasoningTexts.push(ev.text || '');
    } else if (ev.type === 'turn_result') {
      currentTurn.turnResultText = ev.text || '';
    }
  }
  if (currentTurn) turns.push(currentTurn);

  const items = [];
  for (const turn of turns) {
    items.push({ type: 'message', role: 'user', content: turn.userMsg });

    const assistantText = turn.assistantTexts.length > 0
      ? turn.assistantTexts.join('')
      : (turn.turnResultText || '');

    const hasToolCalls = turn.toolCalls.length > 0;

    if (hasToolCalls) {
      const contentParts = [];
      if (assistantText) {
        contentParts.push({ type: 'output_text', text: assistantText });
      }
      for (const tc of turn.toolCalls) {
        contentParts.push(tc);
      }
      const assistantItem = {
        type: 'message',
        role: 'assistant',
        content: contentParts.length > 0 ? contentParts : [{ type: 'output_text', text: assistantText || '' }],
      };
      items.push(assistantItem);
      for (const tr of turn.toolResults) {
        items.push(tr);
      }
      const finalAssistantText = turn.assistantTexts.slice(turn.toolCalls.length).join('');
      if (finalAssistantText && !contentParts.some(p => p.type === 'output_text' && p.text === finalAssistantText)) {
        items.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: finalAssistantText }],
        });
      }
    } else {
      items.push({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: assistantText }],
      });
    }

    if (turn.reasoningTexts.length > 0) {
      items.push({
        type: 'reasoning',
        summary: turn.reasoningTexts.map(t => ({ type: 'summary_text', text: t })),
      });
    }
  }
  return items;
}

module.exports = {
  trimHistoryToBudget,
  estimateChars,
  splitIntoTurns,
  reconstructHistoryFromEvents,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/chat-history-openai.test.js`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/chat-history-openai.js test/chat-history-openai.test.js
git commit -m "feat: add chat-history-openai module with trimming and event reconstruction"
```

---

## Task 2: Remove Responses API from `agent-session.js` — field, imports, and dead code

**Files:**
- Modify: `server/src/agent-session.js`

This task removes all Responses API artifacts from `AgentSession` that won't be replaced by Completions equivalents. The next task adds the Completions replacements.

- [ ] **Step 1: Remove `this.openaiResponseId` field**

In `server/src/agent-session.js:243`, remove:

```js
this.openaiResponseId = opts.resumeOpenaiResponseId || null;
```

- [ ] **Step 2: Remove `_persistOpenaiResponseId()` method**

In `server/src/agent-session.js:779-791`, remove the entire `_persistOpenaiResponseId()` method:

```js
_persistOpenaiResponseId() {
    if (!this.openaiResponseId) return;
    try {
      const sessionsMod = require('./sessions');
      const rec = sessionsMod.getSessionRecord && sessionsMod.getSessionRecord(this.sessionId);
      if (rec) {
        rec.openaiResponseId = this.openaiResponseId;
        sessionsMod.saveStore();
      }
    } catch (err) {
      console.error(`[agent-session] failed to persist openaiResponseId: ${err.message}`);
    }
  }
```

- [ ] **Step 3: Remove `openaiResponseId` persist in `_handleEvent` Claude path**

In `server/src/agent-session.js:1123-1126`, remove:

```js
if (this.openaiResponseId) {
    rec.openaiResponseId = this.openaiResponseId;
    sessionsMod.saveStore();
  }
```

- [ ] **Step 4: Remove `previousResponseId` logic**

In `server/src/agent-session.js:700-702`, remove:

```js
if (this.openaiResponseId && !this._ocRunState) {
    runOpts.previousResponseId = this.openaiResponseId;
  }
```

- [ ] **Step 5: Remove `this.openaiResponseId = result.lastResponseId` and `_persistOpenaiResponseId()` call**

In `server/src/agent-session.js:720-721`, remove:

```js
this.openaiResponseId = result.lastResponseId;
this._persistOpenaiResponseId();
```

- [ ] **Step 6: Remove 404 resume-failure handler**

In `server/src/agent-session.js:750-756`, remove:

```js
const isResumeFailure = err.status === 404 && this.openaiResponseId;
if (isResumeFailure) {
    this.openaiResponseId = null;
    this._emit({ type: 'resume_failed', reason: 'previous_response_id expired or invalid' });
    attempt--;
    continue;
  }
```

- [ ] **Step 7: Remove `setDefaultOpenAIClient` import and `OpenAI` import**

In `server/src/agent-session.js:654`, change from:

```js
const { Agent, run, setDefaultOpenAIClient, OpenAIProvider, setDefaultModelProvider } = require('@openai/agents');
const OpenAI = require('openai');
```

To:

```js
const { Agent, run, OpenAIProvider, setDefaultModelProvider } = require('@openai/agents');
```

- [ ] **Step 8: Remove `raw_model_stream_event` handler from `_adaptOpenAIEvent()`**

In `server/src/agent-session.js:820-827`, remove the entire `raw_model_stream_event` block:

```js
if (event.type === 'raw_model_stream_event') {
      const data = event.data;
      if (data && data.type === 'response.output_text.delta' && data.delta) {
        this._emit({ type: 'assistant_text', text: data.delta, providerId: 'openai' });
        this._persistAssistantTextToRecChat(data.delta);
      }
      return;
    }
```

- [ ] **Step 9: Commit**

```bash
git add server/src/agent-session.js
git commit -m "feat(openai): remove Responses API — openaiResponseId, previousResponseId, 404 handler, raw_model_stream_event"
```

---

## Task 3: Add Completions-only provider setup + MemorySession + history persistence to `agent-session.js`

**Files:**
- Modify: `server/src/agent-session.js`

This task replaces the removed Responses API code with Completions-only equivalents.

- [ ] **Step 1: Add `_openaiSession` and `_openaiHistoryItems` fields in constructor**

In `server/src/agent-session.js`, after the line where `this.openaiResponseId` was removed (around line 243), add:

```js
this._openaiHistoryItems = opts.resumeOpenaiHistory || null;
this._openaiSession = null;
```

- [ ] **Step 2: Replace dual-branch provider setup with single `OpenAIProvider({ useResponses: false })`**

In `server/src/agent-session.js`, replace the current provider setup block (lines 658-668):

```js
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
```

With:

```js
const providerOpts = { apiKey, useResponses: false };
      if (baseUrl) providerOpts.baseURL = baseUrl;
      setDefaultModelProvider(new OpenAIProvider(providerOpts));
```

- [ ] **Step 3: Initialize `MemorySession` and load history**

In `server/src/agent-session.js`, after the provider setup and before the retry loop, add:

```js
if (!this._openaiSession) {
        const { MemorySession } = require('@openai/agents');
        this._openaiSession = new MemorySession();
        if (this._openaiHistoryItems && this._openaiHistoryItems.length > 0) {
          const chatHistory = require('./chat-history-openai');
          const maxTokens = parseInt(process.env.MYCO_CONTEXT_MAX_TOKENS || '32000', 10);
          const trimmed = chatHistory.trimHistoryToBudget(this._openaiHistoryItems, maxTokens);
          this._openaiSession.setItems(trimmed);
        }
      }
```

- [ ] **Step 4: Pass `session` to `run()`**

In the `runOpts` block (around line 694-698), change from:

```js
let runOpts = {
            stream: true,
            signal: this._abortController.signal,
            maxTurns: null,
          };
```

To:

```js
let runOpts = {
            stream: true,
            signal: this._abortController.signal,
            maxTurns: null,
            session: this._openaiSession,
          };
```

- [ ] **Step 5: Add `_persistOpenaiHistory()` method**

After the spot where `_persistOpenaiResponseId()` was removed, add:

```js
_persistOpenaiHistory() {
    try {
      const sessionsMod = require('./sessions');
      const rec = sessionsMod.getSessionRecord && sessionsMod.getSessionRecord(this.sessionId);
      if (rec && this._openaiSession) {
        const items = this._openaiSession.getItems();
        const chatHistory = require('./chat-history-openai');
        const maxTokens = parseInt(process.env.MYCO_CONTEXT_MAX_TOKENS || '32000', 10);
        rec.openaiHistory = chatHistory.trimHistoryToBudget(items, maxTokens);
        sessionsMod.saveStore();
      }
    } catch (err) {
      console.error(`[agent-session] failed to persist openaiHistory: ${err.message}`);
    }
  }
```

- [ ] **Step 6: Call `_persistOpenaiHistory()` after successful run**

In the success path after `result.completed` (where `this.openaiResponseId = result.lastResponseId` and `this._persistOpenaiResponseId()` were removed), add:

```js
this._persistOpenaiHistory();
```

- [ ] **Step 7: Add context-overflow recovery**

In the `catch (err)` block, after the abort check and where the 404 resume-failure handler was removed, add:

```js
if (err.status === 400 && this._openaiSession) {
        const chatHistory = require('./chat-history-openai');
        const maxTokens = parseInt(process.env.MYCO_CONTEXT_MAX_TOKENS || '32000', 10);
        const halfBudget = Math.floor(maxTokens / 2);
        const items = this._openaiSession.getItems();
        const trimmed = chatHistory.trimHistoryToBudget(items, halfBudget);
        this._openaiSession.setItems(trimmed);
        this._emit({ type: 'context_overflow', reason: err.message, providerId: 'openai' });
        attempt--;
        continue;
      }
```

- [ ] **Step 8: Commit**

```bash
git add server/src/agent-session.js
git commit -m "feat(openai): add Completions-only provider, MemorySession, _persistOpenaiHistory, context-overflow recovery"
```

---

## Task 4: Fix `turn_start` prompt truncation

**Files:**
- Modify: `server/src/agent-session.js`

- [ ] **Step 1: Remove 200-char cap from `turn_start` event**

In `server/src/agent-session.js:2154`, change from:

```js
this._emit({ type: 'turn_start', prompt: trimmed.slice(0, 200) });
```

To:

```js
this._emit({ type: 'turn_start', prompt: trimmed });
```

- [ ] **Step 2: Commit**

```bash
git add server/src/agent-session.js
git commit -m "fix(openai): remove 200-char truncation on turn_start prompt for full history reconstruction"
```

---

## Task 5: Update `sessions.js` — spawn options and migration

**Files:**
- Modify: `server/src/sessions.js`

- [ ] **Step 1: Replace `resumeOpenaiResponseId` with `resumeOpenaiHistory` in spawn options**

In `server/src/sessions.js:1052`, change from:

```js
resumeOpenaiResponseId: rec.openaiResponseId || null,
```

To:

```js
resumeOpenaiHistory: rec.openaiHistory || null,
```

- [ ] **Step 2: Add migration logic — reconstruct history when `openaiResponseId` exists but `openaiHistory` is empty**

In `server/src/sessions.js`, in the `ensureLive()` function, before the `spawnAgent` call (around line 1048), add migration logic:

```js
if (rec.openaiResponseId && !rec.openaiHistory) {
    try {
      const chatHistory = require('./chat-history-openai');
      const eventsPath = path.join(rec.absCwd || '', '_myco_', 'events.jsonl');
      if (fs.existsSync(eventsPath)) {
        const lines = fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean);
        const events = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        const maxTokens = parseInt(process.env.MYCO_CONTEXT_MAX_TOKENS || '32000', 10);
        const items = chatHistory.reconstructHistoryFromEvents(events);
        rec.openaiHistory = chatHistory.trimHistoryToBudget(items, maxTokens);
        delete rec.openaiResponseId;
        sessionsMod.saveStore();
        console.log(`[ensureLive] migrated ${sessionId} from openaiResponseId to openaiHistory (${items.length} items)`);
      }
    } catch (migrateErr) {
      console.error(`[ensureLive] openaiHistory migration failed for ${sessionId}: ${migrateErr.message}`);
    }
  }
```

- [ ] **Step 3: Commit**

```bash
git add server/src/sessions.js
git commit -m "feat(sessions): replace resumeOpenaiResponseId with resumeOpenaiHistory + migration from events.jsonl"
```

---

## Task 6: Update `btw.js` and `claude-cli.js` — Completions-only provider

**Files:**
- Modify: `server/src/btw.js`
- Modify: `server/src/claude-cli.js`

- [ ] **Step 1: Update `btw.js` imports and provider setup**

In `server/src/btw.js:113`, change from:

```js
const { Agent, run, setDefaultOpenAIClient, OpenAIProvider, setDefaultModelProvider } = require('@openai/agents');
const OpenAI = require('openai');
```

To:

```js
const { Agent, run, OpenAIProvider, setDefaultModelProvider } = require('@openai/agents');
```

In `server/src/btw.js:120-124`, change from:

```js
if (baseUrl && baseUrl !== 'https://api.openai.com/v1') {
      setDefaultModelProvider(new OpenAIProvider({ baseURL: baseUrl, apiKey, useResponses: false }));
    } else {
      setDefaultOpenAIClient(new OpenAI({ apiKey }));
    }
```

To:

```js
const providerOpts = { apiKey, useResponses: false };
    if (baseUrl) providerOpts.baseURL = baseUrl;
    setDefaultModelProvider(new OpenAIProvider(providerOpts));
```

- [ ] **Step 2: Update `claude-cli.js` imports and provider setup**

In `server/src/claude-cli.js:75`, change from:

```js
const { Agent, run, setDefaultOpenAIClient, OpenAIProvider, setDefaultModelProvider } = require('@openai/agents');
const OpenAI = require('openai');
```

To:

```js
const { Agent, run, OpenAIProvider, setDefaultModelProvider } = require('@openai/agents');
```

In `server/src/claude-cli.js:85-89`, change from:

```js
if (baseUrl && baseUrl !== 'https://api.openai.com/v1') {
      setDefaultModelProvider(new OpenAIProvider({ baseURL: baseUrl, apiKey, useResponses: false }));
    } else {
      setDefaultOpenAIClient(new OpenAI({ apiKey }));
    }
```

To:

```js
const providerOpts = { apiKey, useResponses: false };
    if (baseUrl) providerOpts.baseURL = baseUrl;
    setDefaultModelProvider(new OpenAIProvider(providerOpts));
```

- [ ] **Step 3: Commit**

```bash
git add server/src/btw.js server/src/claude-cli.js
git commit -m "feat(openai): btw.js and claude-cli.js use Completions-only OpenAIProvider"
```

---

## Task 7: Add `MYCO_CONTEXT_MAX_TOKENS` to ENV_KEYS

**Files:**
- Modify: `server/src/index.js`

- [ ] **Step 1: Add env var to ENV_KEYS array**

In `server/src/index.js:1455-1471`, add `MYCO_CONTEXT_MAX_TOKENS` to the `ENV_KEYS` array:

Change from:

```js
const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'MYCO_AGENT_API_KEY',
  'MYCO_AGENT_PROVIDER',
  'MYCO_AGENT_MODEL',
  'MYCO_AUX_MODEL',
  'MYCO_AGENT_BASE_URL',
  'GEMINI_API_KEY',
  'CUSTOM_CRITIC_ENDPOINT',
  'CUSTOM_CRITIC_KEY',
  'CUSTOM_CRITIC_MODEL',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'MYCO_ENTERPRISE_TLS_INSECURE'
];
```

To:

```js
const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'MYCO_AGENT_API_KEY',
  'MYCO_AGENT_PROVIDER',
  'MYCO_AGENT_MODEL',
  'MYCO_AUX_MODEL',
  'MYCO_AGENT_BASE_URL',
  'MYCO_CONTEXT_MAX_TOKENS',
  'GEMINI_API_KEY',
  'CUSTOM_CRITIC_ENDPOINT',
  'CUSTOM_CRITIC_KEY',
  'CUSTOM_CRITIC_MODEL',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'MYCO_ENTERPRISE_TLS_INSECURE'
];
```

- [ ] **Step 2: Commit**

```bash
git add server/src/index.js
git commit -m "feat: add MYCO_CONTEXT_MAX_TOKENS to ENV_KEYS"
```

---

## Task 8: Delete `temp.py`

**Files:**
- Delete: `temp.py`

- [ ] **Step 1: Delete the file**

```bash
git rm temp.py
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore: delete temp.py (Responses API test with hardcoded key)"
```

---

## Task 9: Update test files

**Files:**
- Modify: `test/agent-session-openai.test.js`
- Modify: `test/adapt-openai-event.test.js`

- [ ] **Step 1: Update `test/agent-session-openai.test.js`**

Replace the entire file content. Remove `setDefaultOpenAIClient` / `OpenAI` / `previousResponseId` / `lastResponseId`. Replace with `OpenAIProvider` / `setDefaultModelProvider` / `MemorySession`-based history test.

```js
'use strict';

const assert = require('assert');

const apiKey = process.env.OPENAI_API_KEY || process.env.MYCO_AGENT_API_KEY;
const provider = process.env.MYCO_AGENT_PROVIDER;

if (provider !== 'openai' || !apiKey) {
  console.log('SKIP: agent-session-openai.test.js requires MYCO_AGENT_PROVIDER=openai and an API key');
  process.exit(0);
}

const { Agent, run, OpenAIProvider, setDefaultModelProvider } = require('@openai/agents');
const { createOpenAITools } = require('../server/src/openai-tools/index');
const agentConfig = require('../server/src/agent-config');
const chatHistory = require('../server/src/chat-history-openai');

const cfg = agentConfig.resolve();
assert.strictEqual(cfg.providerId, 'openai');
assert.ok(cfg.apiKey);
console.log('PASS: agent-config resolves to openai');

const tools = createOpenAITools('test-session', process.cwd());
assert.ok(Array.isArray(tools));
assert.ok(tools.length >= 7);
console.log('PASS: createOpenAITools produces tool array');

(async () => {
  setDefaultModelProvider(new OpenAIProvider({ apiKey, useResponses: false }));
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

  assert.ok(result.history, 'result.history is present');
  assert.ok(Array.isArray(result.history), 'result.history is an array');
  console.log('PASS: result.history contains conversation items');

  const trimmed = chatHistory.trimHistoryToBudget(result.history, 32000);
  assert.ok(Array.isArray(trimmed), 'trimHistoryToBudget returns array');
  console.log('PASS: chat-history-openai.trimHistoryToBudget works on real history');
})().catch(e => {
  console.error('FAIL: OpenAI agent run error:', e.message);
  process.exit(1);
});
```

- [ ] **Step 2: Update `test/adapt-openai-event.test.js`**

Remove the `raw_model_stream_event` branch from `MockAgentSession._adaptOpenAIEvent()`. The Completions path no longer emits `assistant_text` from raw stream events.

Change `MockAgentSession._adaptOpenAIEvent()` from:

```js
_adaptOpenAIEvent(event) {
    if (event.type === 'run_item_stream_event') {
      const name = event.name;
      const item = event.item;

      if (name === 'message_output_created') {
        if (item) {
          const text = item.content;
          if (text) {
            this._emit({ type: 'assistant_text', text, providerId: 'openai' });
            this._persistAssistantTextToRecChat(text);
          }
        }
        return;
      }
    }
    if (event.type === 'raw_model_stream_event') {
      const data = event.data;
      if (data && data.type === 'response.output_text.delta' && data.delta) {
        this._emit({ type: 'assistant_text', text: data.delta, providerId: 'openai' });
        this._persistAssistantTextToRecChat(data.delta);
      }
      return;
    }
  }
```

To:

```js
_adaptOpenAIEvent(event) {
    if (event.type === 'run_item_stream_event') {
      const name = event.name;
      const item = event.item;

      if (name === 'message_output_created') {
        if (item) {
          const text = item.content;
          if (text) {
            this._emit({ type: 'assistant_text', text, providerId: 'openai' });
            this._persistAssistantTextToRecChat(text);
          }
        }
        return;
      }
    }
  }
```

Also remove any tests that rely on `raw_model_stream_event` with `response.output_text.delta`. The file currently doesn't have an explicit test for that case, but verify none exists.

- [ ] **Step 3: Run tests to verify**

Run: `node test/agent-session-openai.test.js` (will SKIP if no API key set)
Run: `node test/adapt-openai-event.test.js`
Expected: PASS (adapt test should pass without the raw_model_stream_event branch)

- [ ] **Step 4: Commit**

```bash
git add test/agent-session-openai.test.js test/adapt-openai-event.test.js
git commit -m "test(openai): update tests for Completions-only — remove Responses API references"
```

---

## Task 10: Update `test.sh` static checks

**Files:**
- Modify: `test/test.sh`

- [ ] **Step 1: Remove `_persistOpenaiResponseId` static check**

In `test/test.sh:1666-1669`, remove:

```bash
echo "  Checking _persistOpenaiResponseId method..."
  grep -q "_persistOpenaiResponseId" server/src/agent-session.js \
    && pass "agent-session.js: _persistOpenaiResponseId method present" \
    || fail "agent-session.js: _persistOpenaiResponseId method missing"
```

- [ ] **Step 2: Add new static checks for Completions-only path**

After the removed block, add:

```bash
echo "  Checking _openaiSession field in AgentSession..."
  grep -q "this._openaiSession" server/src/agent-session.js \
    && pass "agent-session.js: _openaiSession field present" \
    || fail "agent-session.js: _openaiSession field missing"

  echo "  Checking _persistOpenaiHistory method..."
  grep -q "_persistOpenaiHistory" server/src/agent-session.js \
    && pass "agent-session.js: _persistOpenaiHistory method present" \
    || fail "agent-session.js: _persistOpenaiHistory method missing"

  echo "  Checking chat-history-openai.js exports..."
  grep -q "module.exports" server/src/chat-history-openai.js \
    && pass "chat-history-openai.js: module.exports present" \
    || fail "chat-history-openai.js: module.exports missing"

  echo "  Checking no openaiResponseId in agent-session.js..."
  grep -q "openaiResponseId" server/src/agent-session.js \
    && fail "agent-session.js: openaiResponseId still present (should be removed)" \
    || pass "agent-session.js: openaiResponseId removed"

  echo "  Checking no setDefaultOpenAIClient in agent-session.js..."
  grep -q "setDefaultOpenAIClient" server/src/agent-session.js \
    && fail "agent-session.js: setDefaultOpenAIClient still present (should be removed)" \
    || pass "agent-session.js: setDefaultOpenAIClient removed"

  echo "  Checking no previousResponseId in agent-session.js..."
  grep -q "previousResponseId" server/src/agent-session.js \
    && fail "agent-session.js: previousResponseId still present (should be removed)" \
    || pass "agent-session.js: previousResponseId removed"

  echo "  Checking openaiHistory in sessions.js..."
  grep -q "openaiHistory" server/src/sessions.js \
    && pass "sessions.js: openaiHistory referenced" \
    || fail "sessions.js: openaiHistory not referenced"

  echo "  Checking no setDefaultOpenAIClient in btw.js..."
  grep -q "setDefaultOpenAIClient" server/src/btw.js \
    && fail "btw.js: setDefaultOpenAIClient still present (should be removed)" \
    || pass "btw.js: setDefaultOpenAIClient removed"

  echo "  Checking no setDefaultOpenAIClient in claude-cli.js..."
  grep -q "setDefaultOpenAIClient" server/src/claude-cli.js \
    && fail "claude-cli.js: setDefaultOpenAIClient still present (should be removed)" \
    || pass "claude-cli.js: setDefaultOpenAIClient removed"

  echo "  Checking MYCO_CONTEXT_MAX_TOKENS in ENV_KEYS..."
  grep -q "MYCO_CONTEXT_MAX_TOKENS" server/src/index.js \
    && pass "index.js: MYCO_CONTEXT_MAX_TOKENS in ENV_KEYS" \
    || fail "index.js: MYCO_CONTEXT_MAX_TOKENS missing from ENV_KEYS"

  echo "  Checking no temp.py (Responses API test with hardcoded key)..."
  test -f temp.py \
    && fail "temp.py still exists (should be deleted)" \
    || pass "temp.py deleted"
```

- [ ] **Step 3: Commit**

```bash
git add test/test.sh
git commit -m "test: update static checks — remove Responses API checks, add Completions-only checks"
```

---

## Task 11: Run full test suite and verify

**Files:** None (verification only)

- [ ] **Step 1: Run `./test/test.sh`**

Run: `./test/test.sh`
Expected: All static checks pass, all existing tests pass.

- [ ] **Step 2: Verify no `openaiResponseId` / `setDefaultOpenAIClient` / `previousResponseId` remain in any server file**

Run: `grep -r "openaiResponseId\|setDefaultOpenAIClient\|previousResponseId" server/src/ test/`
Expected: No matches (except possibly in test assertions that intentionally test the absence)

- [ ] **Step 3: Verify `chat-history-openai.test.js` passes standalone**

Run: `node test/chat-history-openai.test.js`
Expected: ALL PASS

---

## Self-Review Checklist

### 1. Spec coverage

| Spec section | Covered by task? |
|---|---|
| §1 — Responses API removal (table of what to remove) | Task 2 |
| §1 — What to replace (Responses → Completions) | Task 3, 6 |
| §1 — What stays (unchanged) | No task needed — unchanged |
| §2 — Architecture diagram | Task 3 (MemorySession), Task 5 (migration) |
| §2 — Primary path: `result.history` + `MemorySession` | Task 3 |
| §2 — Fallback path: events.jsonl → AgentInputItem[] | Task 1 (reconstructHistoryFromEvents), Task 5 (migration) |
| §2 — History persistence: `rec.openaiHistory` | Task 3, 5 |
| §2 — `turn_start` prompt truncation fix | Task 4 |
| §3 — Changes to `_ensureIterationOpenAI()` | Task 2 + 3 |
| §4 — History trimming strategy | Task 1 (trimHistoryToBudget), Task 3 |
| §5 — Respawn / cross-restart recovery | Task 5 (migration in sessions.js) |
| §6 — `_adaptOpenAIEvent()` changes | Task 2 (remove raw_model_stream_event) |
| §7 — Error handling: 404 removal + context overflow | Task 2 (404), Task 3 (context overflow) |
| §8 — Files changed (new + modified + deleted) | Tasks 1-10 |
| §9 — Testing strategy | Task 1, 9, 10, 11 |
| §10 — Migration path | Task 5 |
| §11 — Out of scope | Not implemented (correctly out of scope) |

### 2. Placeholder scan

- No "TBD", "TODO", "implement later" found
- No "add appropriate error handling" without specifics
- All code blocks contain actual implementation code
- All steps specify exact file paths and line references

### 3. Type consistency

- `_openaiSession` — used as `MemorySession` instance in Task 3 Steps 3-6, consistent across all references
- `_openaiHistoryItems` — set from `opts.resumeOpenaiHistory` in constructor, used as `AgentInputItem[]` in Task 3 Step 3
- `_persistOpenaiHistory()` — defined in Task 3 Step 5, called in Task 3 Step 6, consistent
- `rec.openaiHistory` — written in Task 3 Step 5 and Task 5 Step 2, read in Task 5 Step 1, consistent field name
- `resumeOpenaiHistory` — spawn option in Task 5 Step 1, consumed in Task 3 Step 1, consistent
- `trimHistoryToBudget()` — imported from `chat-history-openai` in Task 3, defined in Task 1, signature `(items, maxTokens)` consistent
- `reconstructHistoryFromEvents()` — imported in Task 5, defined in Task 1, signature `(events)` consistent