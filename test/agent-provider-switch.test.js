const assert = require('assert')
const agentConfig = require('../server/src/agent-config')

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
    const cfg = agentConfig.resolve()
    assert.strictEqual(cfg.providerPath, 'anthropic')
    console.log('PASS: default (unset) → anthropic path')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'anthropic'
    const cfg = agentConfig.resolve()
    assert.strictEqual(cfg.providerPath, 'anthropic')
    console.log('PASS: MYCO_AGENT_PROVIDER=anthropic → anthropic path')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.MYCO_AGENT_API_KEY = 'test-key'
    const cfg = agentConfig.resolve()
    assert.strictEqual(cfg.providerPath, 'opencode')
    console.log('PASS: MYCO_AGENT_PROVIDER=alibaba-cn → opencode path')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'zhipuai'
    process.env.MYCO_AGENT_API_KEY = 'test-key'
    const cfg = agentConfig.resolve()
    assert.strictEqual(cfg.providerPath, 'opencode')
    console.log('PASS: MYCO_AGENT_PROVIDER=zhipuai → opencode path')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba'
    process.env.MYCO_AGENT_API_KEY = 'test-key'
    const cfg = agentConfig.resolve()
    assert.strictEqual(cfg.providerPath, 'opencode')
    console.log('PASS: MYCO_AGENT_PROVIDER=alibaba → opencode path')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'anthropic'
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    const cfg = agentConfig.resolve()
    assert.strictEqual(cfg.providerPath, 'anthropic')
    assert.strictEqual(cfg.apiKey, 'sk-ant-test')
    console.log('PASS: anthropic with ANTHROPIC_API_KEY')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_API_KEY = 'universal-key'
    process.env.MYCO_AGENT_PROVIDER = 'anthropic'
    const cfg = agentConfig.resolve()
    assert.strictEqual(cfg.apiKey, 'universal-key')
    console.log('PASS: MYCO_AGENT_API_KEY takes priority over provider env var')
  })()

  ;(() => {
    resetEnv()
    const { AgentSession } = require('../server/src/agent-session')
    assert.strictEqual(typeof AgentSession, 'function')
    console.log('PASS: AgentSession loads without error')
  })()

  ;(() => {
    resetEnv()
    const { AgentSession } = require('../server/src/agent-session')
    const s = new AgentSession('test-id', { cwd: '/tmp/test-wks' })
    assert.strictEqual(s._providerPath, 'anthropic')
    console.log('PASS: AgentSession defaults to anthropic path')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.MYCO_AGENT_API_KEY = 'test-key'
    const { AgentSession } = require('../server/src/agent-session')
    const s = new AgentSession('test-id-2', { cwd: '/tmp/test-wks-2' })
    assert.strictEqual(s._providerPath, 'opencode')
    assert.strictEqual(s._providerConfig.providerId, 'alibaba-cn')
    assert.strictEqual(s._providerConfig.apiKey, 'test-key')
    console.log('PASS: AgentSession selects opencode path for alibaba-cn')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'zhipuai'
    process.env.MYCO_AGENT_API_KEY = 'test-key'
    const { AgentSession } = require('../server/src/agent-session')
    const s = new AgentSession('test-id-3', { cwd: '/tmp/test-wks-3' })
    assert.strictEqual(s._providerPath, 'opencode')
    assert.strictEqual(s._providerConfig.providerId, 'zhipuai')
    console.log('PASS: AgentSession selects opencode path for zhipuai')
  })()

  resetEnv()
  console.log('\nAll agent-provider-switch tests passed.')
})()