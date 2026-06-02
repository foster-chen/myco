'use strict';

const fs = require('fs');
const path = require('path');
const { resolveFilePath } = require('./resolve-path');

async function executeRead({ filePath, offset, limit }) {
  const resolved = resolveFilePath(filePath, process.cwd());
  const startLine = offset || 0;
  const maxLines = limit || 2000;

  if (!fs.existsSync(resolved)) {
    return `Error: Path does not exist: ${filePath}`;
  }

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(resolved);
    const lines = entries.map(e => {
      const full = path.join(resolved, e);
      const isDir = fs.statSync(full).isDirectory();
      return isDir ? e + '/' : e;
    });
    return lines.join('\n');
  }

  const content = fs.readFileSync(resolved, 'utf8');
  const lines = content.split('\n');
  const sliced = lines.slice(startLine, startLine + maxLines);
  const numbered = sliced.map((line, i) => `${startLine + i + 1}: ${line.length > 2000 ? line.slice(0, 2000) + '...[truncated]' : line}`);
  return numbered.join('\n');
}

module.exports = { executeRead };