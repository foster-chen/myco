const path = require('path');
const fg = require('fast-glob');
let agentSdk;
try { agentSdk = require('@opencode-ai/agent-sdk'); } catch(e) { agentSdk = null; }

function createGlobTool(sessionId, workspaceDir) {
  if (!agentSdk) throw new Error('@opencode-ai/agent-sdk not installed');
  return agentSdk.tool({
    description:
      '- Fast file pattern matching tool that works with any codebase size\n- Supports glob patterns like "**/*.js" or "src/**/*.ts"\n- Returns matching file paths sorted by modification time\n- Use this tool when you need to find files by name patterns\n- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead\n- You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches as a batch that are potentially useful.',
    inputSchema: agentSdk.jsonSchema({
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'The glob pattern to match files against.' },
        path: { type: 'string', description: 'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory.' },
      },
      required: ['pattern'],
    }),
    execute: async (input) => {
      const searchDir = input.path || workspaceDir;
      const pattern = input.pattern;
      try {
        const matches = await fg(pattern, {
          cwd: searchDir,
          onlyFiles: true,
          ignore: ['node_modules', '.git'],
        });
        const sorted = matches.sort();
        return sorted.join('\n');
      } catch (err) {
        return `Error: ${err.message}`;
      }
    },
  });
}

module.exports = { createGlobTool };