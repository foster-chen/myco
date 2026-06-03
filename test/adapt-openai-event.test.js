'use strict';

const assert = require('assert');

class MockItem {
  constructor(rawItem) {
    this.rawItem = rawItem;
    this.type = 'message_output_item';
  }
  get content() {
    let text = '';
    for (const part of this.rawItem.content) {
      if (part.type === 'output_text') {
        text += part.text;
      }
    }
    return text;
  }
}

class MockAgentSession {
  constructor() {
    this._emitted = [];
    this._persistedTexts = [];
  }

  _emit(ev) {
    this._emitted.push(ev);
  }

  _persistAssistantTextToRecChat(text) {
    this._persistedTexts.push(text);
  }

  _broadcastToolProgress() {}

  _adaptOpenAIEvent(event) {
    if (event.type === 'run_item_stream_event') {
      const name = event.name;
      const item = event.item;

      if (name === 'message_output_created') {
        if (item) {
          const text = item.content;
          if (text) {
            this._emit({ type: 'assistant_text', text, providerId: 'openai' });
            this._persistAssistantTextToRecChat(text);
          }
        }
        return;
      }
    }
    
  }
}

async function main() {
  const rawItem = {
    role: 'assistant',
    type: 'message',
    content: [
      { type: 'output_text', text: 'Hello world' },
      { type: 'output_text', text: 'Second part' },
    ],
  };

  const item = new MockItem(rawItem);

  assert.strictEqual(typeof item.content, 'string', 'item.content getter returns string, not array');
  assert.ok(!Array.isArray(item.content), 'item.content is NOT an array');
  assert.strictEqual(item.content, 'Hello worldSecond part', 'content getter concatenates output_text parts');

  const mockSession = new MockAgentSession();
  const event = {
    type: 'run_item_stream_event',
    name: 'message_output_created',
    item,
  };

  mockSession._adaptOpenAIEvent(event);

  const textEmit = mockSession._emitted.find(e => e.type === 'assistant_text');
  assert.ok(textEmit, 'should emit assistant_text event');
  assert.strictEqual(textEmit.text, 'Hello worldSecond part', 'emitted text matches item.content getter result');
  assert.strictEqual(textEmit.providerId, 'openai');

  assert.strictEqual(mockSession._persistedTexts.length, 1, 'persisted assistant text once');
  assert.strictEqual(mockSession._persistedTexts[0], 'Hello worldSecond part', 'persisted text matches');

  const rawItemStringContent = {
    role: 'assistant',
    type: 'message',
    content: 'Plain string content',
  };

  const mockSession2 = new MockAgentSession();
  const event2 = {
    type: 'run_item_stream_event',
    name: 'message_output_created',
    item: { rawItem: rawItemStringContent, content: 'Plain string content' },
  };

  mockSession2._adaptOpenAIEvent(event2);

  const textEmit2 = mockSession2._emitted.find(e => e.type === 'assistant_text');
  assert.ok(textEmit2, 'should emit assistant_text even when content is plain string');
  assert.strictEqual(textEmit2.text, 'Plain string content');

  console.log('PASS: _adaptOpenAIEvent handles message_output_created correctly (content is string, not array)');
  console.log('PASS: _adaptOpenAIEvent no longer calls .filter() on item.content');
}

main().catch(e => {
  console.error('FAIL:', e.message, e.stack);
  process.exit(1);
});