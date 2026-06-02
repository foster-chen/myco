'use strict';

const fg = require('fast-glob');

async function executeGlob({ pattern, path: searchPath }) {
  const cwd = searchPath || process.cwd();
  try {
    const matches = await fg(pattern, { cwd, onlyFiles: true, ignore: ['node_modules', '.git'] });
    return matches.sort().join('\n') || 'No files found';
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

module.exports = { executeGlob };