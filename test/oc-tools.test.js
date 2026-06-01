const assert = require('assert');

(async () => {
  {
    const { createOCTools } = require('../server/src/oc-tools/index');
    const sessionId = 'test-session-reg';
    const workspaceDir = '/tmp/test-oc-tools-wks';
    const tools = createOCTools(sessionId, workspaceDir);
    const expectedToolNames = [
      'mcp__myco__add_plan_items',
      'bash', 'read', 'edit', 'write', 'glob', 'grep', 'webfetch',
    ];
    for (const name of expectedToolNames) {
      assert(tools[name] !== undefined, `tool "${name}" should exist in the tools map`);
      assert(typeof tools[name].description === 'string', `tool "${name}" should have a description`);
      assert(typeof tools[name].inputSchema === 'object', `tool "${name}" should have an inputSchema`);
      assert(typeof tools[name].execute === 'function', `tool "${name}" should have an execute function`);
    }
    console.log('PASS: createOCTools returns all 9 tools with valid shape');
  }

  console.log('\nAll oc-tools tests passed.');
})();