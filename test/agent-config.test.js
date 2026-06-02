'use strict';

const assert = require('assert');

const origEnv = {};
const envKeys = [
  'MYCO_AGENT_PROVIDER', 'MYCO_AGENT_API_KEY', 'ANTHROPIC_API_KEY',
  'MYCO_OPENAI_API_KEY', 'MYCO_ALIBABA_CN_API_KEY',
  'MYCO_AGENT_MODEL', 'MYCO_AUX_MODEL', 'MYCO_AGENT_BASE_URL',
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

restoreEnv(); setEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' });
const cfg1 = agentConfig.resolve();
assert.strictEqual(cfg1.providerId, 'anthropic');
assert.strictEqual(cfg1.apiKey, 'sk-ant-test');
assert.strictEqual(cfg1.model, 'claude-sonnet-4-20250514');
assert.strictEqual(cfg1.baseUrl, null);
console.log('PASS: default anthropic config');

restoreEnv(); setEnv({ MYCO_AGENT_PROVIDER: 'openai', MYCO_OPENAI_API_KEY: 'sk-oai-test' });
const cfg2 = agentConfig.resolve();
assert.strictEqual(cfg2.providerId, 'openai');
assert.strictEqual(cfg2.apiKey, 'sk-oai-test');
assert.strictEqual(cfg2.model, 'gpt-4o');
assert.strictEqual(cfg2.baseUrl, 'https://api.openai.com/v1');
console.log('PASS: openai config');

restoreEnv(); setEnv({ MYCO_AGENT_PROVIDER: 'openai', MYCO_OPENAI_API_KEY: 'sk-oai', MYCO_AGENT_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' });
const cfg3 = agentConfig.resolve();
assert.strictEqual(cfg3.baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
console.log('PASS: MYCO_AGENT_BASE_URL override');

restoreEnv(); setEnv({ MYCO_AGENT_PROVIDER: 'openai', MYCO_OPENAI_API_KEY: 'sk-oai', MYCO_AGENT_MODEL: 'qwen-max' });
const cfg4 = agentConfig.resolve();
assert.strictEqual(cfg4.model, 'qwen-max');
assert.strictEqual(cfg4.auxModel, 'qwen-max');
console.log('PASS: MYCO_AGENT_MODEL override');

restoreEnv(); setEnv({ MYCO_AGENT_PROVIDER: 'openai', MYCO_OPENAI_API_KEY: 'sk-oai', MYCO_AGENT_MODEL: 'qwen-max', MYCO_AUX_MODEL: 'qwen-mini' });
const cfg5 = agentConfig.resolve();
assert.strictEqual(cfg5.model, 'qwen-max');
assert.strictEqual(cfg5.auxModel, 'qwen-mini');
console.log('PASS: MYCO_AUX_MODEL override');

restoreEnv(); setEnv({ MYCO_AGENT_PROVIDER: 'openai', MYCO_AGENT_API_KEY: 'sk-fallback' });
const cfg6 = agentConfig.resolve();
assert.strictEqual(cfg6.apiKey, 'sk-fallback');
console.log('PASS: MYCO_AGENT_API_KEY fallback');

restoreEnv(); setEnv({ MYCO_AGENT_PROVIDER: 'gemini' });
try {
  agentConfig.resolve();
  assert.fail('Should have thrown');
} catch (e) {
  assert(e.message.includes('Unknown MYCO_AGENT_PROVIDER: gemini'));
  console.log('PASS: throws on unknown provider');
}

restoreEnv(); setEnv({ MYCO_AGENT_PROVIDER: 'openai' });
try {
  agentConfig.resolve();
  assert.fail('Should have thrown');
} catch (e) {
  assert(e.message.includes('No API key'));
  console.log('PASS: throws on missing API key for openai');
}

restoreEnv(); setEnv({ MYCO_AGENT_PROVIDER: 'anthropic' });
const cfg7 = agentConfig.resolve();
assert.strictEqual(cfg7.apiKey, undefined);
assert.strictEqual(cfg7.providerId, 'anthropic');
console.log('PASS: anthropic config without explicit key');

restoreEnv(); setEnv({ MYCO_AGENT_PROVIDER: 'alibaba-cn', MYCO_AGENT_API_KEY: 'sk-dash-test' });
const cfg8 = agentConfig.resolve();
assert.strictEqual(cfg8.providerId, 'openai');
assert.strictEqual(cfg8.apiKey, 'sk-dash-test');
assert.strictEqual(cfg8.model, 'glm-5.1');
assert.strictEqual(cfg8.baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
console.log('PASS: alibaba-cn config routes through openai path');

restoreEnv(); setEnv({ MYCO_AGENT_PROVIDER: 'alibaba-cn', MYCO_ALIBABA_CN_API_KEY: 'sk-dash-specific' });
const cfg9 = agentConfig.resolve();
assert.strictEqual(cfg9.apiKey, 'sk-dash-specific');
console.log('PASS: alibaba-cn provider-specific API key');

restoreEnv();
console.log('All agent-config tests passed');