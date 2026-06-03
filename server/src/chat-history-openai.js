'use strict';

function estimateChars(items) {
  let total = 0;
  for (const item of items) {
    if (item.type === 'message') {
      if (typeof item.content === 'string') {
        total += item.content.length;
      } else if (Array.isArray(item.content)) {
        for (const block of item.content) {
          if (block.type === 'output_text' && typeof block.text === 'string') {
            total += block.text.length;
          }
        }
      }
    } else if (item.type === 'function_call') {
      total += (item.name || '').length;
      total += (item.arguments || '').length;
    } else if (item.type === 'function_call_result') {
      total += (item.output || '').length;
    } else if (item.type === 'reasoning') {
      if (Array.isArray(item.summary)) {
        for (const s of item.summary) {
          if (s.type === 'summary_text' && typeof s.text === 'string') {
            total += s.text.length;
          }
        }
      }
    }
  }
  return total;
}

function splitIntoTurns(items) {
  const turns = [];
  let current = null;
  for (const item of items) {
    if (item.type === 'message' && item.role === 'user') {
      if (current) turns.push(current);
      current = [item];
    } else if (current) {
      current.push(item);
    }
  }
  if (current) turns.push(current);
  return turns;
}

function trimHistoryToBudget(items, maxTokens) {
  const chars = estimateChars(items);
  const budgetChars = maxTokens * 4;
  if (chars <= budgetChars) return items;
  const turns = splitIntoTurns(items);
  let kept = turns.length;
  while (kept > 1) {
    const slice = turns.slice(turns.length - kept);
    const sliceChars = estimateChars(slice.flat());
    if (sliceChars <= budgetChars) return slice.flat();
    kept--;
  }
  return turns.slice(turns.length - 1).flat();
}

function reconstructHistoryFromEvents(events) {
  const items = [];
  let i = 0;
  while (i < events.length) {
    const ev = events[i];
    if (ev.type !== 'turn_start') { i++; continue; }
    const userContent = ev.prompt || '';
    items.push({ type: 'message', role: 'user', content: userContent });
    i++;
    let assistantTextParts = [];
    const toolCalls = [];
    const toolResults = [];
    let reasoningText = '';
    let turnResultText = '';
    while (i < events.length) {
      const e = events[i];
      if (e.type === 'turn_start') break;
      if (e.type === 'turn_result') {
        turnResultText = e.text || '';
        i++;
        break;
      }
      if (e.type === 'assistant_text') {
        assistantTextParts.push(e.text || '');
      } else if (e.type === 'tool_use') {
        toolCalls.push({
          type: 'function_call',
          name: e.name || e.toolName || '',
          call_id: e.id || e.toolCallId || '',
          arguments: typeof e.input === 'string' ? e.input : JSON.stringify(e.input || {}),
        });
      } else if (e.type === 'tool_result') {
        const output = typeof e.content === 'string' ? e.content
          : (typeof e.output === 'string' ? e.output : '');
        toolResults.push({
          type: 'function_call_result',
          call_id: e.tool_use_id || e.toolCallId || '',
          output,
        });
      } else if (e.type === 'reasoning_text') {
        reasoningText = e.text || '';
      }
      i++;
    }
    const combinedAssistantText = assistantTextParts.join('');
    const finalText = combinedAssistantText || turnResultText;
    for (const tc of toolCalls) items.push(tc);
    for (const tr of toolResults) items.push(tr);
    if (reasoningText) {
      items.push({
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: reasoningText }],
      });
    }
    if (finalText) {
      items.push({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: finalText }],
      });
    }
  }
  return items;
}

module.exports = { estimateChars, splitIntoTurns, trimHistoryToBudget, reconstructHistoryFromEvents };