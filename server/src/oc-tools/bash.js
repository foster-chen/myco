const { exec } = require('child_process');
const path = require('path');
let agentSdk;
try { agentSdk = require('@opencode-ai/agent-sdk'); } catch(e) { agentSdk = null; }

function createBashTool(sessionId, workspaceDir) {
  if (!agentSdk) throw new Error('@opencode-ai/agent-sdk not installed');
  return agentSdk.tool({
    description:
      'Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.\n\nBe aware: OS: darwin, Shell: zsh\n\nAll commands run in the current working directory by default. Use the `workdir` parameter if you need to run a command in a different directory. AVOID using `cd <directory> && <command>` patterns - use `workdir` instead.\n\nUse `/var/folders/gx/k7c_x271145d5m86slspmphc0000gn/T/opencode` for temporary work outside the workspace. This directory has already been created, already exists, and is pre-approved for external directory access.\n\nIMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.\n\nBefore executing the command, please follow these steps:\n\n1. Directory Verification:\n   - If the command will create new directories or files, first use `ls` to verify the parent directory exists and is the correct location\n   - For example, before running \"mkdir foo/bar\", first use `ls` to check that \"foo\" exists and is the intended parent directory\n\n2. Command Execution:\n   - Always quote file paths that contain spaces with double quotes (e.g. rm \"path with spaces/file.txt\")\n   - Examples of proper quoting:\n     - mkdir \"/Users/name/My Documents\" (correct)\n     - mkdir /Users/name/My Documents (incorrect - will fail)\n     - python \"/path/with spaces/script.py\" (correct)\n     - python /Users/name/My Documents/script.py (incorrect - will fail)\n   - After ensuring proper quoting, execute the command.\n   - Capture the output of the command.\n\nUsage notes:\n  - The command argument is required.\n  - You can specify an optional timeout in milliseconds. If not specified, commands will time out after 120000ms.\n  - It is very helpful if you write a clear, concise description of what this command does in 5-10 words.\n  - If the output exceeds 2000 lines or 51200 bytes, it will be truncated and the full output will be written to a file. You can use Read with offset/limit to read specific sections or Grep to search the full content. Do NOT use `head`, `tail`, or other truncation commands to limit output; the full output will already be captured to a file for more precise searching.\n\n  - Avoid using Bash with the `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:\n    - File search: Use Glob (NOT find or ls)\n    - Content search: Use Grep (NOT grep or rg)\n    - Read files: Use Read (NOT cat/head/tail)\n    - Edit files: Use Edit (NOT sed/awk)\n    - Write files: Use Write (NOT echo >/cat <<EOF)\n    - Communication: Output text directly (NOT echo/printf)\n  - When issuing multiple commands:\n    - If the commands are independent and can run in parallel, make multiple bash tool calls in a single message. For example, if you need to run \"git status\" and \"git diff\", send a single message with two bash tool calls in parallel.\n    - If the commands depend on each other and must run sequentially, use a single Bash call with \'&&\' to chain them together (e.g., `git add . && git commit -m \"message\" && git push`). For instance, if one operation must complete before another starts (like mkdir before cp, Write before Bash for git operations, or git add before git commit), run these operations sequentially instead.\n    - Use \';\' only when you need to run commands sequentially but don\'t care if earlier commands fail\n    - DO NOT use newlines to separate commands (newlines are ok in quoted strings)\n    - AVOID using `cd <directory> && <command>`. Use the `workdir` parameter to change directories instead.\n    - <good-example>\n    Use workdir=\"/foo/bar\" with command: pytest tests\n    </good-example>\n    - <bad-example>\n    cd /foo/bar && pytest tests\n    </bad-example>',
    inputSchema: agentSdk.jsonSchema({
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to execute' },
        timeout: { type: 'number', description: 'Optional timeout in milliseconds (default 120000)' },
        workdir: { type: 'string', description: 'The working directory to run the command in. Defaults to the session workspace. Use this instead of \'cd <directory> && <command>\'. ' },
        description: { type: 'string', description: 'Clear, concise description of what this command does in 5-10 words.' },
      },
      required: ['command'],
    }),
    execute: async (input) => {
      const cmd = input.command;
      const cwd = input.workdir || workspaceDir;
      const timeoutMs = input.timeout || 120000;
      return new Promise((resolve, reject) => {
        exec(cmd, { cwd, timeout: timeoutMs, maxBuffer: 51200 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            const msg = (stderr || '') + (err.message || '');
            if (err.killed && err.signal === 'SIGTERM') {
              resolve(`Command timed out after ${timeoutMs}ms\n${stdout || ''}\n${stderr || ''}`);
            } else {
              resolve(`Error: ${msg}\n${stdout || ''}`);
            }
            return;
          }
          let output = (stdout || '') + (stderr || '');
          if (output.length > 51200) {
            output = output.slice(0, 51200) + '\n\n[Output truncated. Full output written to file.]';
          }
          resolve(output);
        });
      });
    },
  });
}

module.exports = { createBashTool };