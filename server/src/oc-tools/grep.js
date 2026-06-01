const { exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
let agentSdk;
try { agentSdk = require('@opencode-ai/agent-sdk'); } catch(e) { agentSdk = null; }
const fg = require('fast-glob');

function _hasRg() {
  try { execSync('rg --version', { stdio: 'pipe' }); return true; } catch { return false; }
}

const HAS_RG = _hasRg();

function _rgSearch(pattern, searchDir, include) {
  let cmd = `rg --no-heading --line-number --color never --max-count 200`;
  if (include) cmd += ` --glob '${include}'`;
  cmd += ` '${pattern.replace(/'/g, "'\\''")}' '${searchDir}'`;
  return cmd;
}

function _nodeSearch(pattern, searchDir, include) {
  const results = [];
  const globPattern = include ? `**/${include}` : '**/*';
  const files = fg.sync(globPattern, { cwd: searchDir, onlyFiles: true, ignore: ['node_modules', '.git'] });
  const regex = new RegExp(pattern, 'i');
  for (const file of files.slice(0, 200)) {
    const full = path.join(searchDir, file);
    try {
      const content = fs.readFileSync(full, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push(`${full}:${i + 1}:${lines[i].slice(0, 200)}`);
        }
      }
    } catch {}
    if (results.length >= 200) break;
  }
  return results.join('\n');
}

function createGrepTool(sessionId, workspaceDir) {
  if (!agentSdk) throw new Error('@opencode-ai/agent-sdk not installed');
  return agentSdk.tool({
    description:
      '- Fast content search tool that works with any codebase size\n- Searches file contents using regular expressions\n- Supports full regex syntax (eg. "log.*Error", "function\\s+\\w+", etc.)\n- Filter files by pattern with the include parameter (eg. "*.js", "*.{ts,tsx}")\n- Returns file paths and line numbers with at least one match sorted by modification time\n- Use this tool when you need to find files containing specific patterns\n- If you need to identify/count the number of matches within files, use the Bash tool with `rg` (ripgrep) directly. Do NOT use grep.\n- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead',
    inputSchema: agentSdk.jsonSchema({
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'The regex pattern to search for in file contents.' },
        include: { type: 'string', description: 'File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}").' },
        path: { type: 'string', description: 'The directory to search in. Defaults to the current working directory. IMPORTANT: Omit this field to use the default directory.' },
      },
      required: ['pattern'],
    }),
    execute: async (input) => {
      const searchDir = input.path || workspaceDir;
      const pattern = input.pattern;
      const include = input.include;

      if (HAS_RG) {
        return new Promise((resolve) => {
          const cmd = _rgSearch(pattern, searchDir, include);
          exec(cmd, { cwd: searchDir, timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
            if (err && !stdout) { resolve(`Error: ${err.message}`); return; }
            resolve(stdout || 'No matches found');
          });
        });
      }
      return _nodeSearch(pattern, searchDir, include);
    },
  });
}

module.exports = { createGrepTool };