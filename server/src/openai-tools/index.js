'use strict';

const {
  createBashTool, createReadTool, createEditTool, createWriteTool,
  createGlobTool, createGrepTool, createWebFetchTool,
} = require('./definitions');
const { createMycoMcpToolsOpenAI } = require('../myco-mcp-openai');

function createOpenAITools(sessionId, workspaceDir) {
  return [
    createBashTool(workspaceDir),
    createReadTool(workspaceDir),
    createEditTool(workspaceDir),
    createWriteTool(workspaceDir),
    createGlobTool(workspaceDir),
    createGrepTool(workspaceDir),
    createWebFetchTool(),
    createMycoMcpToolsOpenAI(sessionId),
  ];
}

module.exports = { createOpenAITools };