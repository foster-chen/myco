const assert = require('assert')
const { resolve, PROVIDER_ENV_VARS, PROVIDER_PATHS } = require('../server/src/agent-config')

function resetEnv() {
  delete process.env.MYCO_AGENT_PROVIDER
  delete process.env.MYCO_AGENT_API_KEY
  delete process.env.MYCO_AGENT_MODEL
  delete process.env.MYCO_AUX_MODEL
  for (const v of Object.values(PROVIDER_ENV_VARS)) delete process.env[v]
}

;(() => {
  ;(() => {
    resetEnv()
    const cfg = resolve()
    assert.strictEqual(cfg.providerId, 'anthropic')
    assert.strictEqual(cfg.providerPath, 'anthropic')
    assert.strictEqual(cfg.apiKey, undefined)
    assert.strictEqual(cfg.model, null)
    console.log('PASS: default resolves to anthropic path')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'anthropic'
    process.env.ANTHROPIC_API_KEY = 'sk-ant-xxx'
    const cfg = resolve()
    assert.strictEqual(cfg.providerPath, 'anthropic')
    assert.strictEqual(cfg.apiKey, 'sk-ant-xxx')
    console.log('PASS: anthropic with env var')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.MYCO_AGENT_API_KEY = 'dash-xxx'
    const cfg = resolve()
    assert.strictEqual(cfg.providerId, 'alibaba-cn')
    assert.strictEqual(cfg.providerPath, 'opencode')
    assert.strictEqual(cfg.apiKey, 'dash-xxx')
    console.log('PASS: alibaba-cn with MYCO_AGENT_API_KEY')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.DASHSCOPE_API_KEY = 'dash-env-xxx'
    const cfg = resolve()
    assert.strictEqual(cfg.apiKey, 'dash-env-xxx')
    console.log('PASS: alibaba-cn falls back to DASHSCOPE_API_KEY')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'zhipuai'
    process.env.MYCO_AGENT_API_KEY = 'zhipu-xxx'
    const cfg = resolve()
    assert.strictEqual(cfg.providerId, 'zhipuai')
    assert.strictEqual(cfg.providerPath, 'opencode')
    assert.strictEqual(cfg.apiKey, 'zhipu-xxx')
    console.log('PASS: zhipuai with MYCO_AGENT_API_KEY')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'zhipuai'
    process.env.ZHIPU_API_KEY = 'zhipu-env-xxx'
    const cfg = resolve()
    assert.strictEqual(cfg.apiKey, 'zhipu-env-xxx')
    console.log('PASS: zhipuai falls back to ZHIPU_API_KEY')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'zhipuai'
    assert.throws(() => resolve(), /No API key found for provider zhipuai/)
    console.log('PASS: missing key throws')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    assert.throws(() => resolve(), /No API key found for provider alibaba-cn/)
    console.log('PASS: alibaba-cn missing key throws')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.MYCO_AGENT_API_KEY = 'key'
    process.env.MYCO_AGENT_MODEL = 'qwen3-235b-a22b'
    process.env.MYCO_AUX_MODEL = 'qwen-plus'
    const cfg = resolve()
    assert.strictEqual(cfg.model, 'qwen3-235b-a22b')
    assert.strictEqual(cfg.auxModel, 'qwen-plus')
    console.log('PASS: model overrides')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.MYCO_AGENT_API_KEY = 'key'
    process.env.MYCO_AGENT_MODEL = 'qwen3-235b-a22b'
    const cfg = resolve()
    assert.strictEqual(cfg.auxModel, 'qwen3-235b-a22b')
    console.log('PASS: auxModel defaults to model')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.MYCO_AGENT_API_KEY = 'key'
    const cfg = resolve()
    assert.strictEqual(cfg.auxModel, null)
    console.log('PASS: auxModel null when both unset')
  })()

  ;(() => {
    assert.strictEqual(PROVIDER_ENV_VARS['alibaba-cn'], 'DASHSCOPE_API_KEY')
    assert.strictEqual(PROVIDER_ENV_VARS['zhipuai'], 'ZHIPU_API_KEY')
    assert.strictEqual(PROVIDER_ENV_VARS['anthropic'], 'ANTHROPIC_API_KEY')
    assert.strictEqual(PROVIDER_PATHS['anthropic'], 'anthropic')
    assert.strictEqual(PROVIDER_PATHS['alibaba-cn'], undefined)
    console.log('PASS: PROVIDER_ENV_VARS and PROVIDER_PATHS maps')
  })()

  resetEnv()
  console.log('\nAll agent-config tests passed.')
})()