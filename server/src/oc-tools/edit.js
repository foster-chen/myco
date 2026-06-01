let agentSdk;
try { agentSdk = require('@opencode-ai/agent-sdk'); } catch(e) { agentSdk = null; }

function createEditTool(sessionId, workspaceDir) {
  if (!agentSdk) throw new Error('@opencode-ai/agent-sdk not installed');
  return agentSdk.tool({
    description: 'stub',
    inputSchema: agentSdk.jsonSchema({ type: 'object', properties: {} }),
    execute: async () => 'stub',
  });
}

module.exports = { createEditTool };