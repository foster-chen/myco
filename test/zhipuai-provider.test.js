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
    process.env.MYCO_AGENT_PROVIDER = 'zhipuai'
    process.env.MYCO_AGENT_API_KEY = 'sk-zhipu-test'
    assert.ok(agentSdk, '@opencode-ai/agent-sdk must be installed')
    const result = agentSdk.resolveProvider({
      providerId: 'zhipuai',
      apiKey: 'sk-zhipu-test',
    })
    assert.ok(result.sdk)
    assert.strictEqual(typeof result.model, 'object')
    assert.ok(result.options)
    console.log('PASS: zhipuai resolveProvider returns sdk+model')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'zhipuai'
    process.env.MYCO_AGENT_API_KEY = 'sk-zhipu-test'
    const cfg = agentConfig.resolve()
    assert.strictEqual(cfg.providerId, 'zhipuai')
    assert.strictEqual(cfg.apiKey, 'sk-zhipu-test')
    assert.strictEqual(cfg.providerPath, 'opencode')
    console.log('PASS: zhipuai agent-config resolves')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'zhipuai'
    process.env.ZHIPU_API_KEY = 'sk-zhipu-env'
    const cfg = agentConfig.resolve()
    assert.strictEqual(cfg.apiKey, 'sk-zhipu-env')
    console.log('PASS: zhipuai falls back to ZHIPU_API_KEY')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'zhipuai'
    assert.throws(() => agentConfig.resolve(), /No API key found for provider zhipuai/)
    console.log('PASS: zhipuai missing key throws')
  })()

  ;(() => {
    assert.ok(agentSdk.supportedProviders.includes('zhipuai'))
    console.log('PASS: zhipuai in supportedProviders')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'zhipuai'
    process.env.MYCO_AGENT_API_KEY = 'key'
    process.env.MYCO_AGENT_MODEL = 'glm-5'
    const cfg = agentConfig.resolve()
    assert.strictEqual(cfg.model, 'glm-5')
    console.log('PASS: zhipuai model override')
  })()

  resetEnv()
  console.log('\nAll zhipuai-provider tests passed.')
})()