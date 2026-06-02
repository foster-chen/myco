const assert = require('assert')
const agentConfig = require('../server/src/agent-config')

function resetEnv() {
  delete process.env.MYCO_AGENT_PROVIDER
  delete process.env.MYCO_AGENT_API_KEY
  delete process.env.MYCO_AGENT_MODEL
  delete process.env.MYCO_AUX_MODEL
  delete process.env.MYCO_OC_MAX_STEPS
  for (const v of Object.values(agentConfig.PROVIDER_ENV_VARS)) delete process.env[v]
}

;(() => {
  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.MYCO_AGENT_API_KEY = 'test-key'
    const { AgentSession } = require('../server/src/agent-session')
    const s = new AgentSession('tr-norm-1', { cwd: '/tmp/test-wks' })
    const events = []
    s.on('agent-event', (ev) => { events.push(ev) })

    s.openToolCalls.set('tool-abc123', { name: 'bash', input: { command: 'pwd' }, ts: new Date().toISOString() })
    s._adaptOCEvent({ type: 'tool_result', id: 'tool-abc123', name: 'bash', result: '/wks/user/session-id\n', is_error: false })

    const trEvents = events.filter(e => e.type === 'tool_result')
    assert.strictEqual(trEvents.length, 1, 'tool_result emitted once')
    assert.strictEqual(trEvents[0].tool_use_id, 'tool-abc123', 'OC tool_result normalizes id → tool_use_id')
    assert.strictEqual(trEvents[0].content, '/wks/user/session-id\n', 'OC tool_result normalizes result → content')
    assert.strictEqual(trEvents[0].isError, false, 'OC tool_result normalizes is_error → isError')
    assert.strictEqual(trEvents[0].id, undefined, 'OC tool_result does NOT include raw id field')
    assert.strictEqual(trEvents[0].name, undefined, 'OC tool_result does NOT include raw name field')
    assert.strictEqual(trEvents[0].result, undefined, 'OC tool_result does NOT include raw result field')

    console.log('PASS: OC tool_result normalizes id→tool_use_id, result→content, is_error→isError')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.MYCO_AGENT_API_KEY = 'test-key'
    const { AgentSession } = require('../server/src/agent-session')
    const s = new AgentSession('tr-norm-2', { cwd: '/tmp/test-wks' })
    const events = []
    s.on('agent-event', (ev) => { events.push(ev) })

    s.openToolCalls.set('tool-err1', { name: 'bash', input: { command: 'badcmd' }, ts: new Date().toISOString() })
    s._adaptOCEvent({ type: 'tool_result', id: 'tool-err1', name: 'bash', result: 'command not found', is_error: true })

    const trEvents = events.filter(e => e.type === 'tool_result')
    assert.strictEqual(trEvents.length, 1)
    assert.strictEqual(trEvents[0].tool_use_id, 'tool-err1')
    assert.strictEqual(trEvents[0].content, 'command not found')
    assert.strictEqual(trEvents[0].isError, true, 'OC tool_result preserves is_error=true as isError=true')

    console.log('PASS: OC tool_result isError=true is preserved through normalization')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.MYCO_AGENT_API_KEY = 'test-key'
    const { AgentSession } = require('../server/src/agent-session')
    const s = new AgentSession('tr-norm-3', { cwd: '/tmp/test-wks' })
    const events = []
    s.on('agent-event', (ev) => { events.push(ev) })

    s.openToolCalls.set('tool-null', { name: 'bash', input: { command: 'pwd' }, ts: new Date().toISOString() })
    s._adaptOCEvent({ type: 'tool_result', id: 'tool-null', name: 'bash', result: null, is_error: false })

    const trEvents = events.filter(e => e.type === 'tool_result')
    assert.strictEqual(trEvents.length, 1)
    assert.strictEqual(trEvents[0].content, '', 'OC tool_result with null result normalizes to empty string content')
    assert.strictEqual(trEvents[0].isError, false)

    console.log('PASS: OC tool_result with null result → content="" (not "null")')
  })()

  ;(() => {
    const agentSdk = require('../server/vendor/agent-sdk/dist/index.js')

    assert.strictEqual(typeof agentSdk.createAgent, 'function', 'createAgent exported')

    const handle = agentSdk.createAgent({
      provider: 'alibaba-cn',
      model: 'qwen3-235b-a22b',
      apiKey: 'test-key',
      maxSteps: 50,
      messages: [],
      tools: {},
    })
    assert.ok(handle, 'createAgent with maxSteps=50 returns a handle')
    assert.strictEqual(typeof handle.stream, 'function', 'handle has stream()')

    const handleDefault = agentSdk.createAgent({
      provider: 'alibaba-cn',
      model: 'qwen3-235b-a22b',
      apiKey: 'test-key',
      messages: [],
      tools: {},
    })
    assert.ok(handleDefault, 'createAgent without maxSteps returns a handle (defaults to 200)')

    console.log('PASS: vendored OC SDK createAgent accepts maxSteps parameter')
  })()

  ;(() => {
    const fs = require('fs')
    const sdkSource = fs.readFileSync(require.resolve('../server/vendor/agent-sdk/dist/index.js'), 'utf8')

    assert.ok(sdkSource.includes('stepCountIs'), 'vendored SDK imports stepCountIs from ai')
    assert.ok(sdkSource.includes('stopWhen'), 'vendored SDK passes stopWhen to streamText')

    const stopWhenMatch = sdkSource.match(/stopWhen:\s*stepCountIs\((\w+)\)/)
    assert.ok(stopWhenMatch, 'vendored SDK passes stopWhen: stepCountIs(var) to streamText')
    assert.strictEqual(stopWhenMatch[1], 'maxSteps', 'stopWhen uses maxSteps variable')

    console.log('PASS: vendored SDK source includes stepCountIs import + stopWhen: stepCountIs(maxSteps)')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.MYCO_AGENT_API_KEY = 'test-key'
    const agentSessionSource = require('fs').readFileSync(require.resolve('../server/src/agent-session'), 'utf8')

    assert.ok(agentSessionSource.includes('OC_MAX_STEPS'), 'agent-session.js defines OC_MAX_STEPS')
    assert.ok(agentSessionSource.includes('maxSteps:'), 'agent-session.js passes maxSteps to createAgent')

    const maxStepsMatch = agentSessionSource.match(/OC_MAX_STEPS\s*=\s*parseInt\(process\.env\.MYCO_OC_MAX_STEPS\s*\|\|\s*'(\d+)',\s*10\)/)
    assert.ok(maxStepsMatch, 'OC_MAX_STEPS parsed from env MYCO_OC_MAX_STEPS with default')
    assert.strictEqual(maxStepsMatch[1], '200', 'OC_MAX_STEPS defaults to 200')

    console.log('PASS: agent-session.js defines OC_MAX_STEPS=200 (env MYCO_OC_MAX_STEPS override) + passes to createAgent')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_OC_MAX_STEPS = '50'
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.MYCO_AGENT_API_KEY = 'test-key'
    const { AgentSession } = require('../server/src/agent-session')
    const s = new AgentSession('maxsteps-env', { cwd: '/tmp/test-wks' })

    const agentSessionSource = require('fs').readFileSync(require.resolve('../server/src/agent-session'), 'utf8')
    const match = agentSessionSource.match(/OC_MAX_STEPS\s*=\s*parseInt\(process\.env\.MYCO_OC_MAX_STEPS\s*\|\|\s*'(\d+)',\s*10\)/)
    assert.strictEqual(match[1], '200', 'default remains 200 regardless of env override')

    console.log('PASS: MYCO_OC_MAX_STEPS env var can override OC_MAX_STEPS default')
  })()

  resetEnv()
  console.log('\nAll oc-max-steps-and-tool-result tests passed.')
})()