// Non-interactive Claude invocation.
//
// Used by the Plan/Arch/Test extractor so extraction shares the running
// container's `claude` auth (whatever ~/.claude/ has configured — claude.ai
// subscription, or ANTHROPIC_API_KEY, or Bedrock, etc.) instead of needing
// a separate API key. Same auth path as the interactive PTY sessions
// Mycelium spawns from pty.js.
//
// Returns the model's text response, or null on any failure (timeout,
// SDK error, no text emitted). Callers must tolerate null so a
// misconfigured host degrades to an empty artifact rather than 500ing.
//
// Phase 7 of the agent-sdk-migration: was a `claude -p` subprocess
// over child_process.spawn. Now uses @anthropic-ai/claude-agent-sdk
// in-process — same auth, no PATH dep, faster (no process startup).

const agentConfig = require('./agent-config');
const DEFAULT_TIMEOUT_MS = 120000;

async function callClaudeCli({ system, userMessage, cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const { providerId, auxModel, apiKey, baseUrl } = agentConfig.resolve();
  if (providerId === 'openai') {
    return callOpenAICli({ system, userMessage, cwd, timeoutMs, model: auxModel, apiKey, baseUrl });
  }
  if (!userMessage) return null;
  const { query } = require('@anthropic-ai/claude-agent-sdk');
  const ac = new AbortController();
  const timer = setTimeout(() => {
    try { ac.abort(); } catch {}
    console.error(`[claude-cli] timed out after ${timeoutMs}ms`);
  }, timeoutMs);

  const options = {
    cwd: cwd || process.cwd(),
    allowedTools: [],          // pure text generation
    permissionMode: 'dontAsk',
    settingSources: [],
    abortSignal: ac.signal,
  };
  if (system) options.appendSystemPrompt = system;

  let stream;
  try {
    stream = query({ prompt: userMessage, options });
  } catch (err) {
    clearTimeout(timer);
    console.error(`[claude-cli] sdk init failed: ${err.message}`);
    return null;
  }
  let finalText = '';
  let assistantText = '';
  try {
    for await (const m of stream) {
      if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
        for (const b of m.message.content) {
          if (b.type === 'text') assistantText += b.text;
        }
      }
      if (m.type === 'result') {
        finalText = typeof m.result === 'string' ? m.result : '';
      }
    }
  } catch (err) {
    clearTimeout(timer);
    if (ac.signal.aborted) return null;
    console.error(`[claude-cli] sdk error: ${err.message || String(err)}`);
    return null;
  }
  clearTimeout(timer);
  const text = (finalText || assistantText).trim();
  return text || null;
}

async function callOpenAICli({ system, userMessage, cwd, timeoutMs, model, apiKey, baseUrl }) {
  const { Agent, run, OpenAIProvider, setDefaultModelProvider } = require('@openai/agents');

  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    try { abortController.abort(); } catch {}
    console.error(`[openai-cli] timed out after ${timeoutMs}ms`);
  }, timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const providerOpts = { apiKey, useResponses: false };
    if (baseUrl) providerOpts.baseURL = baseUrl;
    setDefaultModelProvider(new OpenAIProvider(providerOpts));

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
    const text = (result.finalOutput || '').trim();
    return text || null;
  } catch (err) {
    clearTimeout(timeout);
    if (abortController.signal.aborted) return null;
    console.error(`[openai-cli] error: ${err.message || String(err)}`);
    return null;
  }
}

module.exports = { callClaudeCli, callOpenAICli };
