const fs = require('fs');
const path = require('path');
let agentSdk;
try { agentSdk = require('@opencode-ai/agent-sdk'); } catch(e) { agentSdk = null; }

function _resolveFilePath(filePath, workspaceDir) {
  if (path.isAbsolute(filePath)) {
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(workspaceDir)) {
      throw new Error(`Absolute path "${resolved}" is outside workspace "${workspaceDir}"`);
    }
    return resolved;
  }
  return path.resolve(workspaceDir, filePath);
}

function createWriteTool(sessionId, workspaceDir) {
  if (!agentSdk) throw new Error('@opencode-ai/agent-sdk not installed');
  return agentSdk.tool({
    description:
      'Writes a file to the local filesystem.\n\nUsage:\n- This tool will overwrite the existing file if there is one at the provided path.\n- If this is an existing file, you MUST use the Read tool first to read the file\'s contents. This tool will fail if you did not read the file first.\n- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.\n- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.\n- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.',
    inputSchema: agentSdk.jsonSchema({
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'The absolute path to the file to write (must be absolute, not relative).' },
        content: { type: 'string', description: 'The content to write to the file.' },
      },
      required: ['filePath', 'content'],
    }),
    execute: async (input) => {
      const filePath = _resolveFilePath(input.filePath, workspaceDir);
      const content = input.content;
      const parentDir = path.dirname(filePath);
      fs.mkdirSync(parentDir, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
      return `Successfully wrote ${filePath}`;
    },
  });
}

module.exports = { createWriteTool };