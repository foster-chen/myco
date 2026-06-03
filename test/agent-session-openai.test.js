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