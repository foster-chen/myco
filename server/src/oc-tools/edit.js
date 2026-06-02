'use strict';

const fs = require('fs');
const { resolveFilePath } = require('./resolve-path');

async function executeEdit({ filePath, oldString, newString, replaceAll }) {
  const resolved = resolveFilePath(filePath, process.cwd());

  if (!fs.existsSync(resolved)) {
    return `Error: File does not exist: ${filePath}`;
  }

  const content = fs.readFileSync(resolved, 'utf8');

  if (!content.includes(oldString)) {
    return `Error: oldString not found in content`;
  }

  const count = content.split(oldString).length - 1;
  if (count > 1 && !replaceAll) {
    return `Error: Found ${count} matches for oldString. Use replaceAll: true to replace all occurrences.`;
  }

  let newContent;
  if (replaceAll) {
    newContent = content.split(oldString).join(newString);
  } else {
    const idx = content.indexOf(oldString);
    newContent = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
  }

  fs.writeFileSync(resolved, newContent, 'utf8');
  return `Successfully edited ${filePath}`;
}

module.exports = { executeEdit };