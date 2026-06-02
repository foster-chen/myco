'use strict';

const { exec } = require('child_process');

async function executeBash({ command, workdir, timeout }) {
  const cwd = workdir || process.cwd();
  const timeoutMs = timeout || 120000;

  return new Promise((resolve) => {
    exec(command, { cwd, timeout: timeoutMs, maxBuffer: 51200 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed && err.signal === 'SIGTERM') {
          resolve(`[Timeout after ${timeoutMs}ms]\n${stdout}\n${stderr}`);
          return;
        }
        resolve(`Error: ${stderr || err.message}\n${stdout}`);
        return;
      }
      const output = stdout + stderr;
      if (output.length > 51200) {
        resolve(output.slice(0, 51200) + '\n[Output truncated...]');
        return;
      }
      resolve(output);
    });
  });
}

module.exports = { executeBash };