'use strict';

const assert = require('assert');

const apiKey = process.env.OPENAI_API_KEY || process.env.MYCO_AGENT_API_KEY;
const provider = process.env.MYCO_AGENT_PROVIDER;

if (provider !== 'openai' || !apiKey) {
  console.log('SKIP: agent-session-openai.test.js requires MYCO_AGENT_PROVIDER=openai and an API key');
  process.exit(0);
}

const { Agent, run, setDefaultOpenAIClient } = require('@openai/agents');
const OpenAI = require('openai');
const { createOpenAITools } = require('../server/src/openai-tools/index');
const agentConfig = require('../server/src/agent-config');

const cfg = agentConfig.resolve();
assert.strictEqual(cfg.providerId, 'openai');
assert.ok(cfg.apiKey);
console.log('PASS: agent-config resolves to openai');

const tools = createOpenAITools('test-session', process.cwd());
assert.ok(Array.isArray(tools));
assert.ok(tools.length >= 7);
console.log('PASS: createOpenAITools produces tool array');

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