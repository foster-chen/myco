const assert = require('assert')
const agentConfig = require('../server/src/agent-config')
let agentSdk;
try { agentSdk = require('../server/node_modules/@opencode-ai/agent-sdk'); } catch(e) { agentSdk = null; }

function resetEnv() {
  delete process.env.MYCO_AGENT_PROVIDER
  delete process.env.MYCO_AGENT_API_KEY
  delete process.env.MYCO_AGENT_MODEL
  delete process.env.MYCO_AUX_MODEL
  for (const v of Object.values(agentConfig.PROVIDER_ENV_VARS)) delete process.env[v]
}

;(() => {
  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.MYCO_AGENT_API_KEY = 'sk-dashscope-test'
    assert.ok(agentSdk, '@opencode-ai/agent-sdk must be installed')
    const result = agentSdk.resolveProvider({
      providerId: 'alibaba-cn',
      apiKey: 'sk-dashscope-test',
    })
    assert.ok(result.sdk)
    assert.strictEqual(typeof result.model, 'object')
    assert.ok(result.options)
    console.log('PASS: alibaba-cn resolveProvider returns sdk+model')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.MYCO_AGENT_API_KEY = 'sk-dashscope-test'
    const cfg = agentConfig.resolve()
    assert.strictEqual(cfg.providerId, 'alibaba-cn')
    assert.strictEqual(cfg.apiKey, 'sk-dashscope-test')
    assert.strictEqual(cfg.providerPath, 'opencode')
    console.log('PASS: alibaba-cn agent-config resolves')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.DASHSCOPE_API_KEY = 'sk-dashscope-env'
    const cfg = agentConfig.resolve()
    assert.strictEqual(cfg.apiKey, 'sk-dashscope-env')
    console.log('PASS: alibaba-cn falls back to DASHSCOPE_API_KEY')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    assert.throws(() => agentConfig.resolve(), /No API key found for provider alibaba-cn/)
    console.log('PASS: alibaba-cn missing key throws')
  })()

  ;(() => {
    assert.ok(agentSdk.supportedProviders.includes('alibaba-cn'))
    console.log('PASS: alibaba-cn in supportedProviders')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.MYCO_AGENT_API_KEY = 'key'
    process.env.MYCO_AGENT_MODEL = 'qwen3-235b-a22b'
    const cfg = agentConfig.resolve()
    assert.strictEqual(cfg.model, 'qwen3-235b-a22b')
    console.log('PASS: alibaba-cn model override')
  })()

  resetEnv()
  console.log('\nAll alibaba-provider tests passed.')
})()