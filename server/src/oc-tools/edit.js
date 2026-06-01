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

function createEditTool(sessionId, workspaceDir) {
  if (!agentSdk) throw new Error('@opencode-ai/agent-sdk not installed');
  return agentSdk.tool({
    description:
      'Performs exact string replacements in files.\n\nUsage:\n- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file first.\n- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: line number + colon + space (e.g., `1: `). Everything after that space is the actual file content to match. Never include any part of the line number prefix in the oldString or newString.\n- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.\n- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.\n- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.\n- The edit will FAIL if `oldString` is not found in the file with an error "oldString not found in content".\n- The edit will FAIL if `oldString` is found multiple times in the file with an error "Found multiple matches for oldString. Provide more surrounding lines in oldString to identify the correct match."\n- Use `replaceAll` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.',
    inputSchema: agentSdk.jsonSchema({
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'The absolute path to the file to modify.' },
        oldString: { type: 'string', description: 'The text to replace.' },
        newString: { type: 'string', description: 'The text to replace it with (must be different from oldString).' },
        replaceAll: { type: 'boolean', description: 'Replace all occurrences of oldString. Default false.' },
      },
      required: ['filePath', 'oldString', 'newString'],
    }),
    execute: async (input) => {
      const filePath = _resolveFilePath(input.filePath, workspaceDir);
      if (!fs.existsSync(filePath)) {
        return `Error: File does not exist: ${filePath}`;
      }
      const content = fs.readFileSync(filePath, 'utf8');
      const oldString = input.oldString;
      const newString = input.newString;
      const replaceAll = input.replaceAll || false;

      if (!content.includes(oldString)) {
        return `Error: oldString not found in content`;
      }

      const count = content.split(oldString).length - 1;
      if (count > 1 && !replaceAll) {
        return `Error: Found multiple matches for oldString. Provide more surrounding lines in oldString to identify the correct match.`;
      }

      let newContent;
      if (replaceAll) {
        newContent = content.split(oldString).join(newString);
      } else {
        const idx = content.indexOf(oldString);
        newContent = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
      }

      fs.writeFileSync(filePath, newContent, 'utf8');
      return `Successfully edited ${filePath}`;
    },
  });
}

module.exports = { createEditTool };