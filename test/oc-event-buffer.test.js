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
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.MYCO_AGENT_API_KEY = 'test-key'
    const { AgentSession } = require('../server/src/agent-session')
    const s = new AgentSession('buf-test-1', { cwd: '/tmp/test-wks' })
    const events = []
    s.on('agent-event', (ev) => { events.push(ev) })

    s._adaptOCEvent({ type: 'text', delta: 'Hello' })
    s._adaptOCEvent({ type: 'text', delta: ' world' })
    s._adaptOCEvent({ type: 'text', delta: '.' })
    assert.strictEqual(events.length, 3, 'per-delta: each text delta emits immediately')
    assert.strictEqual(events[0].type, 'assistant_text')
    assert.strictEqual(events[0].text, 'Hello')
    assert.strictEqual(events[1].type, 'assistant_text')
    assert.strictEqual(events[1].text, ' world')
    assert.strictEqual(events[2].type, 'assistant_text')
    assert.strictEqual(events[2].text, '.')
    assert.strictEqual(s._ocTextBuffer, 'Hello world.', 'text deltas also accumulated in buffer for persist')

    s._flushOCTextBuffer()
    const flushedTextEvents = events.filter(e => e.type === 'assistant_text')
    assert.strictEqual(flushedTextEvents.length, 3, 'flush does NOT emit additional assistant_text (per-delta already emitted)')
    assert.strictEqual(s._ocTextBuffer, '', 'buffer cleared after flush')

    console.log('PASS: per-delta text emit — each delta emits immediately, flush only persists')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.MYCO_AGENT_API_KEY = 'test-key'
    const { AgentSession } = require('../server/src/agent-session')
    const s = new AgentSession('buf-test-2', { cwd: '/tmp/test-wks' })
    const events = []
    s.on('agent-event', (ev) => { events.push(ev) })

    s._adaptOCEvent({ type: 'reasoning', delta: 'The user asked' })
    s._adaptOCEvent({ type: 'reasoning', delta: ' a question.' })
    assert.strictEqual(events.length, 2, 'per-delta: each reasoning delta emits immediately')
    assert.strictEqual(events[0].type, 'reasoning_text')
    assert.strictEqual(events[0].text, 'The user asked')
    assert.strictEqual(events[1].type, 'reasoning_text')
    assert.strictEqual(events[1].text, ' a question.')
    assert.strictEqual(s._ocReasoningBuffer, 'The user asked a question.', 'reasoning deltas accumulated in buffer')

    s._flushOCReasoningBuffer()
    const flushedReasoningEvents = events.filter(e => e.type === 'reasoning_text')
    assert.strictEqual(flushedReasoningEvents.length, 2, 'flush does NOT emit additional reasoning_text (per-delta already emitted)')
    assert.strictEqual(s._ocReasoningBuffer, '', 'reasoning buffer cleared after flush')

    console.log('PASS: per-delta reasoning emit — each delta emits immediately, flush only clears buffer')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.MYCO_AGENT_API_KEY = 'test-key'
    const { AgentSession } = require('../server/src/agent-session')
    const s = new AgentSession('buf-test-3', { cwd: '/tmp/test-wks' })
    const events = []
    s.on('agent-event', (ev) => { events.push(ev) })

    s._adaptOCEvent({ type: 'reasoning', delta: 'I should respond.' })
    s._adaptOCEvent({ type: 'text', delta: 'Hi!' })
    s._adaptOCEvent({ type: 'step_start', index: 0 })

    const reasoningEvents = events.filter(e => e.type === 'reasoning_text')
    const textEvents = events.filter(e => e.type === 'assistant_text')
    const stepEvents = events.filter(e => e.type === 'step_start')

    assert.strictEqual(reasoningEvents.length, 1, 'reasoning emitted per-delta')
    assert.strictEqual(reasoningEvents[0].text, 'I should respond.')
    assert.strictEqual(textEvents.length, 1, 'text emitted per-delta')
    assert.strictEqual(textEvents[0].text, 'Hi!')
    assert.strictEqual(stepEvents.length, 1, 'step_start emitted after buffer flushes')
    assert.strictEqual(s._ocTextBuffer, '', 'text buffer cleared by boundary flush')
    assert.strictEqual(s._ocReasoningBuffer, '', 'reasoning buffer cleared by boundary flush')

    console.log('PASS: per-delta emit at step_start boundary — buffers flushed, no double emit')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.MYCO_AGENT_API_KEY = 'test-key'
    const { AgentSession } = require('../server/src/agent-session')
    const s = new AgentSession('buf-test-4', { cwd: '/tmp/test-wks' })
    const events = []
    s.on('agent-event', (ev) => { events.push(ev) })

    s._adaptOCEvent({ type: 'reasoning', delta: 'Thinking about this.' })
    s._adaptOCEvent({ type: 'text', delta: 'Here is my answer: ' })
    s._adaptOCEvent({ type: 'text', delta: 'the result is 42.' })
    s._adaptOCEvent({ type: 'finish', usage: { inputTokens: 10, outputTokens: 20 } })

    const reasoningEvents = events.filter(e => e.type === 'reasoning_text')
    const textEvents = events.filter(e => e.type === 'assistant_text')
    const turnEvents = events.filter(e => e.type === 'turn_result')

    assert.strictEqual(reasoningEvents.length, 1, 'reasoning emitted per-delta')
    assert.strictEqual(reasoningEvents[0].text, 'Thinking about this.')
    assert.strictEqual(textEvents.length, 2, 'text emitted per-delta (2 deltas)')
    assert.strictEqual(textEvents[0].text, 'Here is my answer: ')
    assert.strictEqual(textEvents[1].text, 'the result is 42.')
    assert.strictEqual(turnEvents.length, 1, 'finish emits turn_result')
    assert.strictEqual(s._ocTextBuffer, '')
    assert.strictEqual(s._ocReasoningBuffer, '')

    console.log('PASS: per-delta emit — reasoning + text separate, no double emit at finish')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.MYCO_AGENT_API_KEY = 'test-key'
    const { AgentSession } = require('../server/src/agent-session')
    const s = new AgentSession('buf-test-5', { cwd: '/tmp/test-wks' })
    const events = []
    s.on('agent-event', (ev) => { events.push(ev) })

    s._adaptOCEvent({ type: 'text', delta: 'Checking the file.' })
    s._adaptOCEvent({ type: 'tool_call', id: 'tc-1', name: 'Bash', input: { command: 'ls' } })

    const textEvents = events.filter(e => e.type === 'assistant_text')
    const toolEvents = events.filter(e => e.type === 'tool_use')

    assert.strictEqual(textEvents.length, 1, 'text emitted per-delta before tool_call')
    assert.strictEqual(textEvents[0].text, 'Checking the file.')
    assert.strictEqual(toolEvents.length, 1, 'tool_call emitted after boundary flush')
    assert.strictEqual(s._ocTextBuffer, '', 'text buffer flushed at tool_call boundary')

    console.log('PASS: per-delta text emit before tool_call boundary')
  })()

  ;(() => {
    resetEnv()
    process.env.MYCO_AGENT_PROVIDER = 'alibaba-cn'
    process.env.MYCO_AGENT_API_KEY = 'test-key'
    const { AgentSession } = require('../server/src/agent-session')
    const s = new AgentSession('buf-test-6', { cwd: '/tmp/test-wks' })

    assert.strictEqual(s._ocReasoningBuffer, '', 'reasoning buffer initialized empty')
    assert.strictEqual(s._ocTextBuffer, '', 'text buffer initialized empty')

    s._adaptOCEvent({ type: 'reasoning', delta: 'R1' })
    s._adaptOCEvent({ type: 'text', delta: 'T1' })

    assert.strictEqual(s._ocReasoningBuffer, 'R1', 'reasoning delta goes to reasoning buffer only')
    assert.strictEqual(s._ocTextBuffer, 'T1', 'text delta goes to text buffer only')

    s._flushOCTextBuffer()
    assert.strictEqual(s._ocReasoningBuffer, 'R1', 'flushing text does NOT clear reasoning buffer')

    s._flushOCReasoningBuffer()
    assert.strictEqual(s._ocReasoningBuffer, '', 'flushing reasoning clears reasoning buffer')
    assert.strictEqual(s._ocTextBuffer, '', 'text buffer already cleared')

    console.log('PASS: text and reasoning buffers are independent')
  })()

  resetEnv()
  console.log('\nAll oc-event-buffer tests passed.')
})()