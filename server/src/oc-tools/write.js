'use strict';

const fs = require('fs');
const path = require('path');
const { resolveFilePath } = require('./resolve-path');

async function executeWrite({ filePath, content }) {
  const resolved = resolveFilePath(filePath, process.cwd());
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolved, content, 'utf8');
  return `Successfully wrote ${filePath}`;
}

module.exports = { executeWrite };