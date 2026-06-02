'use strict';

const { tool } = require('@openai/agents');
const { z } = require('zod');
const { _appendPlanItems } = require('./myco-mcp');

function createMycoMcpToolsOpenAI(sessionId) {
  return tool({
    name: 'add_plan_items',
    description: 'Add plan items (todos, features, bugs) to the project backlog tracked in _myco_/plan.json.',
    parameters: z.object({
      items: z.array(z.object({
        text: z.string().min(1).max(2000).describe('Item description'),
        layer: z.enum(['Todo', 'Feature', 'Bug']).describe('Item type'),
        dependsOn: z.array(z.string()).max(10).optional().describe('IDs of items this depends on'),
      })).min(1).max(20).describe('Array of plan items to add'),
    }),
    strict: true,
    execute: async (args) => {
      const result = _appendPlanItems(sessionId, args.items);
      if (!result.ok) return { error: result.message };
      return { result: result.message, ids: result.ids };
    },
  });
}

module.exports = { createMycoMcpToolsOpenAI };