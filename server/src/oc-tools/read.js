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

function createReadTool(sessionId, workspaceDir) {
  if (!agentSdk) throw new Error('@opencode-ai/agent-sdk not installed');
  return agentSdk.tool({
    description:
      'Read a file or directory from the local filesystem. If the path does not exist, an error is returned.\n\nUsage:\n- The filePath parameter should be an absolute path.\n- By default, this tool returns up to 2000 lines from the start of the file.\n- The offset parameter is the line number to start from (1-indexed).\n- To read later sections, call this tool again with a larger offset.\n- Use the grep tool to find specific content in large files or files with long lines.\n- If you are unsure of the correct file path, use the glob tool to look up filenames by glob pattern.\n- Contents are returned with each line prefixed by its line number as `<line>: <content>`. For example, if a file has contents "foo\\n", you will receive "1: foo\\n". For directories, entries are returned one per line (without line numbers) with a trailing `/` for subdirectories.\n- Any line longer than 2000 characters is truncated.',
    inputSchema: agentSdk.jsonSchema({
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'The absolute path to the file or directory to read.' },
        offset: { type: 'integer', description: 'The line number to start reading from (1-indexed).', minimum: 0 },
        limit: { type: 'integer', description: 'The maximum number of lines to read (defaults to 2000).', minimum: 0 },
      },
      required: ['filePath'],
    }),
    execute: async (input) => {
      const filePath = _resolveFilePath(input.filePath, workspaceDir);
      const offset = input.offset || 0;
      const limit = input.limit || 2000;

      if (!fs.existsSync(filePath)) {
        return `Error: Path does not exist: ${filePath}`;
      }

      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(filePath);
        const lines = entries.map(e => {
          const full = path.join(filePath, e);
          try { return fs.statSync(full).isDirectory() ? e + '/' : e; } catch { return e; }
        });
        return lines.join('\n');
      }

      const raw = fs.readFileSync(filePath, 'utf8');
      const allLines = raw.split('\n');
      const sliced = allLines.slice(offset, offset + limit);
      const numbered = sliced.map((line, i) => {
        const lineNo = offset + i + 1;
        if (line.length > 2000) return `${lineNo}: ${line.slice(0, 2000)}\n`;
        return `${lineNo}: ${line}`;
      });
      return numbered.join('\n');
    },
  });
}

module.exports = { createReadTool };