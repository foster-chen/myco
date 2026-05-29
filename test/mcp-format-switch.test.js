const assert = require('assert')

;(() => {
  ;(() => {
    const mcp = require('../server/src/myco-mcp')
    assert(typeof mcp.createMycoMcpServer === 'function')
    console.log('PASS: createMycoMcpServer exists')
  })()

  ;(() => {
    const mcp = require('../server/src/myco-mcp')
    assert(typeof mcp.createMycoMcpToolsOC === 'function')
    const ocTools = mcp.createMycoMcpToolsOC('test-session')
    assert(typeof ocTools === 'object')
    assert(ocTools['mcp__myco__add_plan_items'] !== undefined)
    const toolDef = ocTools['mcp__myco__add_plan_items']
    assert(typeof toolDef.description === 'string')
    assert(typeof toolDef.inputSchema === 'object')
    assert(typeof toolDef.execute === 'function')
    console.log('PASS: createMycoMcpToolsOC returns valid tool map')
  })()

  ;(() => {
    const mcp = require('../server/src/myco-mcp')
    assert.strictEqual(mcp.MYCO_MCP_TOOL_PREFIX, 'mcp__myco__')
    console.log('PASS: MYCO_MCP_TOOL_PREFIX constant')
  })()

  console.log('\nAll mcp-format-switch tests passed.')
})()