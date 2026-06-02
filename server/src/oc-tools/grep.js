'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const fg = require('fast-glob');

let HAS_RG = false;
try {
  execSync('rg --version', { stdio: 'pipe' });
  HAS_RG = true;
} catch (e) {
  HAS_RG = false;
}

function rgSearch(pattern, include, cwd) {
  let cmd = `rg --no-heading --line-number --color never --max-count 200`;
  if (include) cmd += ` --glob '${include}'`;
  cmd += ` '${pattern}' '${cwd}'`;
  try {
    const result = execSync(cmd, { cwd, maxBuffer: 51200 * 1024, timeout: 30000, encoding: 'utf8' });
    return result || 'No matches found';
  } catch (err) {
    if (err.status === 1) return 'No matches found';
    return `Error: ${err.stderr || err.message}`;
  }
}

async function nodeSearch(pattern, include, cwd) {
  const globPattern = include || '**/*';
  try {
    const files = await fg(globPattern, { cwd, onlyFiles: true, ignore: ['node_modules', '.git'] });
    const regex = new RegExp(pattern, 'i');
    const results = [];
    for (const file of files) {
      if (results.length >= 200) break;
      try {
        const content = fs.readFileSync(path.join(cwd, file), 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            const truncated = lines[i].length > 200 ? lines[i].slice(0, 200) + '...' : lines[i];
            results.push(`${file}:${i + 1}:${truncated}`);
            if (results.length >= 200) break;
          }
        }
      } catch (e) { /* skip unreadable files */ }
    }
    return results.join('\n') || 'No matches found';
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

async function executeGrep({ pattern, include, path: searchPath }) {
  const cwd = searchPath || process.cwd();
  if (HAS_RG) {
    return rgSearch(pattern, include, cwd);
  }
  return nodeSearch(pattern, include, cwd);
}

module.exports = { executeGrep };