'use strict';

const { tool } = require('@openai/agents');
const { z } = require('zod');

const { executeBash } = require('../oc-tools/bash');
const { executeRead } = require('../oc-tools/read');
const { executeEdit } = require('../oc-tools/edit');
const { executeWrite } = require('../oc-tools/write');
const { executeGlob } = require('../oc-tools/glob');
const { executeGrep } = require('../oc-tools/grep');
const { executeWebFetch } = require('../oc-tools/webfetch');

function createBashTool(workspaceDir) {
  return tool({
    name: 'bash',
    description: 'Executes a bash command in a persistent shell session with optional timeout. Use for running tests, builds, git operations, and other shell tasks.',
    parameters: z.object({
      command: z.string().describe('The bash command to execute'),
      workdir: z.string().optional().describe('Working directory for the command'),
      timeout: z.number().optional().describe('Timeout in milliseconds (default 120000)'),
    }),
    strict: true,
    needsApproval: true,
    execute: async (args) => {
      const enriched = { ...args, workdir: args.workdir || workspaceDir };
      return executeBash(enriched);
    },
  });
}

function createReadTool(workspaceDir) {
  return tool({
    name: 'read_file',
    description: 'Reads a file from the local filesystem. Returns line-numbered content with optional offset and limit for pagination.',
    parameters: z.object({
      filePath: z.string().describe('Path to the file or directory to read'),
      offset: z.number().min(0).optional().describe('1-indexed start line (default 0)'),
      limit: z.number().min(0).optional().describe('Max lines to return (default 2000)'),
    }),
    strict: true,
    execute: async (args) => {
      process.chdir(workspaceDir);
      return executeRead(args);
    },
  });
}

function createEditTool(workspaceDir) {
  return tool({
    name: 'edit_file',
    description: 'Performs exact string replacement in a file. The oldString must match exactly. Use replaceAll to replace all occurrences.',
    parameters: z.object({
      filePath: z.string().describe('Path to the file to modify'),
      oldString: z.string().describe('Exact text to find and replace'),
      newString: z.string().describe('Replacement text'),
      replaceAll: z.boolean().optional().describe('Replace all occurrences (default false)'),
    }),
    strict: true,
    needsApproval: true,
    execute: async (args) => {
      process.chdir(workspaceDir);
      return executeEdit(args);
    },
  });
}

function createWriteTool(workspaceDir) {
  return tool({
    name: 'write_file',
    description: 'Writes content to a file on the local filesystem. Creates parent directories if needed. Overwrites existing content.',
    parameters: z.object({
      filePath: z.string().describe('Path to the file to write (must be absolute)'),
      content: z.string().describe('Content to write'),
    }),
    strict: true,
    needsApproval: true,
    execute: async (args) => {
      process.chdir(workspaceDir);
      return executeWrite(args);
    },
  });
}

function createGlobTool(workspaceDir) {
  return tool({
    name: 'glob',
    description: 'Fast file pattern matching tool. Supports glob patterns like **/*.js. Returns matching file paths sorted alphabetically.',
    parameters: z.object({
      pattern: z.string().describe('Glob pattern to match files against'),
      path: z.string().optional().describe('Directory to search in (defaults to workspace)'),
    }),
    strict: true,
    execute: async (args) => {
      const enriched = { ...args, path: args.path || workspaceDir };
      return executeGlob(enriched);
    },
  });
}

function createGrepTool(workspaceDir) {
  return tool({
    name: 'grep',
    description: 'Search file contents using regular expressions. Uses ripgrep if available, falls back to Node.js implementation.',
    parameters: z.object({
      pattern: z.string().describe('Regex pattern to search for'),
      include: z.string().optional().describe('File glob filter (e.g. *.js, *.{ts,tsx})'),
      path: z.string().optional().describe('Directory to search in (defaults to workspace)'),
    }),
    strict: true,
    execute: async (args) => {
      const enriched = { ...args, path: args.path || workspaceDir };
      return executeGrep(enriched);
    },
  });
}

function createWebFetchTool() {
  return tool({
    name: 'web_fetch',
    description: 'Fetches content from a URL. Supports text, markdown, and HTML output formats. HTTP URLs are auto-upgraded to HTTPS.',
    parameters: z.object({
      url: z.string().describe('Fully-formed URL to fetch'),
      format: z.enum(['text', 'markdown', 'html']).optional().describe('Output format (default markdown)'),
      timeout: z.number().optional().describe('Timeout in seconds, max 120 (default 120)'),
    }),
    strict: true,
    execute: executeWebFetch,
  });
}

module.exports = {
  createBashTool, createReadTool, createEditTool, createWriteTool,
  createGlobTool, createGrepTool, createWebFetchTool,
};