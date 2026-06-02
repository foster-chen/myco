'use strict';

const path = require('path');
const fs = require('fs');

function realpath(p) {
  try { return fs.realpathSync(p); } catch (e) { return p; }
}

function resolveRealPath(p) {
  const real = realpath(p);
  if (real !== p) return real;
  let dir = path.dirname(p);
  const base = path.basename(p);
  const realDir = realpath(dir);
  return path.join(realDir, base);
}

function resolveFilePath(filePath, workspaceDir) {
  const realWorkspace = realpath(workspaceDir);
  if (path.isAbsolute(filePath)) {
    const resolved = resolveRealPath(path.resolve(filePath));
    if (!resolved.startsWith(realWorkspace)) {
      throw new Error(`Path escapes workspace: ${filePath}. Allowed root: ${workspaceDir}`);
    }
    return resolved;
  }
  return resolveRealPath(path.resolve(realWorkspace, filePath));
}

module.exports = { resolveFilePath };