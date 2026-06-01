const { createMycoMcpToolsOC } = require('../myco-mcp');
const { createBashTool } = require('./bash');
const { createReadTool } = require('./read');
const { createEditTool } = require('./edit');
const { createWriteTool } = require('./write');
const { createGlobTool } = require('./glob');
const { createGrepTool } = require('./grep');
const { createWebFetchTool } = require('./webfetch');

function createOCTools(sessionId, workspaceDir) {
  const mycoTools = createMycoMcpToolsOC(sessionId);
  const coreTools = {
    bash: createBashTool(sessionId, workspaceDir),
    read: createReadTool(sessionId, workspaceDir),
    edit: createEditTool(sessionId, workspaceDir),
    write: createWriteTool(sessionId, workspaceDir),
    glob: createGlobTool(sessionId, workspaceDir),
    grep: createGrepTool(sessionId, workspaceDir),
    webfetch: createWebFetchTool(sessionId, workspaceDir),
  };
  return { ...mycoTools, ...coreTools };
}

module.exports = { createOCTools };