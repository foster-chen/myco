"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  applyCaching: () => applyCaching,
  applyMessageNormalization: () => applyMessageNormalization,
  applyProviderOptions: () => applyProviderOptions,
  applySchemaTransform: () => applySchemaTransform,
  createAgent: () => createAgent,
  generateText: () => generateText,
  jsonSchema: () => import_ai2.jsonSchema,
  resolveProvider: () => resolveProvider,
  supportedProviders: () => supportedProviders,
  tool: () => import_ai2.tool
});
module.exports = __toCommonJS(index_exports);
var import_ai2 = require("ai");

// src/provider.ts
var import_anthropic = require("@ai-sdk/anthropic");
var import_openai_compatible = require("@ai-sdk/openai-compatible");
var BUNDLED_PROVIDERS = {
  anthropic: {
    npm: "@ai-sdk/anthropic",
    factory: (opts) => (0, import_anthropic.createAnthropic)(opts),
    envVar: "ANTHROPIC_API_KEY",
    providerOptions: () => ({
      headers: {
        "anthropic-beta": "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14"
      }
    })
  },
  "alibaba-cn": {
    npm: "@ai-sdk/openai-compatible",
    factory: (opts) => (0, import_openai_compatible.createOpenAICompatible)({
      ...opts,
      name: "alibaba-cn",
      baseURL: opts.baseURL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1"
    }),
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    envVar: "DASHSCOPE_API_KEY",
    providerOptions: (modelId, isReasoning) => {
      const opts = {};
      if (isReasoning && !modelId.includes("kimi-k2-thinking")) {
        opts.enable_thinking = true;
      }
      return opts;
    }
  },
  alibaba: {
    npm: "@ai-sdk/openai-compatible",
    factory: (opts) => (0, import_openai_compatible.createOpenAICompatible)({
      ...opts,
      name: "alibaba",
      baseURL: opts.baseURL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    }),
    baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    envVar: "DASHSCOPE_API_KEY",
    providerOptions: (modelId, isReasoning) => {
      const opts = {};
      if (isReasoning && !modelId.includes("kimi-k2-thinking")) {
        opts.enable_thinking = true;
      }
      return opts;
    }
  },
  zhipuai: {
    npm: "@ai-sdk/openai-compatible",
    factory: (opts) => (0, import_openai_compatible.createOpenAICompatible)({
      ...opts,
      name: "zhipuai",
      baseURL: opts.baseURL ?? "https://open.bigmodel.cn/api/paas/v4"
    }),
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    envVar: "ZHIPU_API_KEY",
    providerOptions: () => ({
      thinking: { type: "enabled", clear_thinking: false }
    })
  },
  "alibaba-coding-plan-cn": {
    npm: "@ai-sdk/openai-compatible",
    factory: (opts) => (0, import_openai_compatible.createOpenAICompatible)({
      ...opts,
      name: "alibaba-coding-plan-cn",
      baseURL: opts.baseURL ?? "https://coding.dashscope.aliyuncs.com/v1"
    }),
    baseURL: "https://coding.dashscope.aliyuncs.com/v1",
    envVar: "ALIBABA_CODING_PLAN_API_KEY"
  }
};
var supportedProviders = Object.keys(BUNDLED_PROVIDERS);
function resolveProvider(input) {
  const spec = BUNDLED_PROVIDERS[input.providerId];
  if (!spec) {
    throw new Error(
      `Unknown provider: "${input.providerId}". Supported: ${supportedProviders.join(", ")}`
    );
  }
  const apiKey = input.apiKey ?? process.env[spec.envVar];
  if (!apiKey) {
    throw new Error(
      `No API key for provider "${input.providerId}". Set ${spec.envVar} env var or pass apiKey.`
    );
  }
  const opts = { apiKey };
  const baseURL = input.baseURL ?? spec.baseURL;
  if (baseURL) opts.baseURL = baseURL;
  const sdk = spec.factory(opts);
  const modelId = input.modelId ?? "default";
  const sdkObj = sdk;
  const model = sdkObj.languageModel(modelId);
  const providerOpts = spec.providerOptions ? spec.providerOptions(modelId, input.isReasoning ?? false) : {};
  const sdkOptionKey = resolveSdkOptionKey(spec.npm, input.providerId);
  const options = sdkOptionKey && Object.keys(providerOpts).length > 0 ? { [sdkOptionKey]: providerOpts } : providerOpts;
  return { sdk, model, options };
}
function resolveSdkOptionKey(npm, providerId) {
  switch (npm) {
    case "@ai-sdk/anthropic":
      return "anthropic";
    case "@ai-sdk/openai-compatible":
      return "openaiCompatible";
  }
  const dotSplit = providerId.split(".")[0];
  return dotSplit !== providerId ? dotSplit : void 0;
}

// src/llm.ts
var import_ai = require("ai");
var import_crypto = require("crypto");

// src/transform.ts
function sanitizeSurrogates(content) {
  return content.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "\uFFFD"
  );
}
function applyMessageNormalization(msgs, providerId, modelId, npm) {
  msgs = msgs.map((msg) => {
    switch (msg.role) {
      case "system":
        msg.content = sanitizeSurrogates(msg.content);
        return msg;
      case "user":
        if (typeof msg.content === "string") {
          msg.content = sanitizeSurrogates(msg.content);
        } else {
          msg.content = msg.content.map((part) => {
            if (part.type === "text") {
              return { ...part, text: sanitizeSurrogates(part.text) };
            }
            return part;
          });
        }
        return msg;
      case "assistant":
        if (typeof msg.content === "string") {
          msg.content = sanitizeSurrogates(msg.content);
        } else {
          msg.content = msg.content.map((part) => {
            if (part.type === "text" || part.type === "reasoning") {
              return { ...part, text: sanitizeSurrogates(part.text) };
            }
            return part;
          });
        }
        return msg;
      case "tool":
        if (!Array.isArray(msg.content)) return msg;
        msg.content = msg.content.map((content) => {
          if (content.type === "tool-result") {
            if (content.output.type === "text" || content.output.type === "error-text") {
              content.output.value = sanitizeSurrogates(content.output.value);
            }
          }
          return content;
        });
        return msg;
    }
    return msg;
  });
  if (npm === "@ai-sdk/anthropic") {
    msgs = msgs.map((msg) => {
      if (typeof msg.content === "string") {
        if (msg.content === "") return void 0;
        return msg;
      }
      if (!Array.isArray(msg.content)) return msg;
      const filtered = msg.content.filter((part) => {
        if (part.type === "text") return part.text !== "";
        if (part.type === "reasoning") {
          const opts = part.providerOptions?.anthropic;
          return part.text.trim().length > 0 || opts?.signature != null || opts?.redactedData != null;
        }
        return true;
      });
      if (filtered.length === 0) return void 0;
      return { ...msg, content: filtered };
    }).filter((msg) => msg !== void 0 && msg.content !== "");
  }
  if (npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic") {
    msgs = msgs.flatMap((msg) => {
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) return [msg];
      const parts = msg.content;
      const first = parts.findIndex((part) => part.type === "tool-call");
      if (first === -1) return [msg];
      if (!parts.slice(first).some((part) => part.type !== "tool-call")) return [msg];
      return [
        { ...msg, content: parts.filter((part) => part.type !== "tool-call") },
        { ...msg, content: parts.filter((part) => part.type === "tool-call") }
      ];
    });
  }
  return msgs;
}
function applyCaching(msgs, providerId) {
  const system = msgs.filter((msg) => msg.role === "system").slice(0, 2);
  const final = msgs.filter((msg) => msg.role !== "system").slice(-2);
  const seen = /* @__PURE__ */ new Map();
  const unique = [...system, ...final].filter((msg) => {
    if (seen.has(msg)) return false;
    seen.set(msg, msg);
    return true;
  });
  for (const msg of unique) {
    const useMessageLevel = providerId === "anthropic" || providerId.includes("bedrock");
    if (!useMessageLevel && Array.isArray(msg.content) && msg.content.length > 0) {
      const lastContent = msg.content[msg.content.length - 1];
      if (lastContent && typeof lastContent === "object" && "type" in lastContent) {
        const partType = lastContent.type;
        if (partType === "tool-approval-request" || partType === "tool-approval-response") {
          continue;
        }
        const partAny = lastContent;
        partAny.providerOptions = {
          ...partAny.providerOptions ?? {},
          anthropic: { cacheControl: { type: "ephemeral" } },
          openaiCompatible: { cache_control: { type: "ephemeral" } }
        };
        continue;
      }
    }
    const msgAny = msg;
    msgAny.providerOptions = {
      ...msgAny.providerOptions ?? {},
      anthropic: { cacheControl: { type: "ephemeral" } },
      openaiCompatible: { cache_control: { type: "ephemeral" } }
    };
  }
  return msgs;
}
function applyProviderOptions(providerId, modelId, npm, isReasoning, sessionId) {
  const result = {};
  if (npm === "@ai-sdk/openai-compatible") {
    if (["zai", "zhipuai"].some((id) => providerId.includes(id))) {
      result.thinking = { type: "enabled", clear_thinking: false };
    }
  }
  if (providerId === "alibaba-cn" && isReasoning && npm === "@ai-sdk/openai-compatible") {
    if (!modelId.toLowerCase().includes("kimi-k2-thinking")) {
      result.enable_thinking = true;
    }
  }
  if (providerId === "anthropic") {
    result.toolStreaming = false;
  }
  return result;
}
function applySchemaTransform(providerId, modelId, schema) {
  if (providerId === "moonshotai" || modelId.toLowerCase().includes("kimi")) {
    schema = sanitizeMoonshotSchema(schema);
  }
  if (providerId === "google" || modelId.includes("gemini")) {
    schema = sanitizeGeminiSchema(schema);
  }
  return schema;
}
function sanitizeMoonshotSchema(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeMoonshotSchema);
  if ("$ref" in obj && typeof obj.$ref === "string") {
    return { $ref: obj.$ref };
  }
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = sanitizeMoonshotSchema(value);
  }
  if (Array.isArray(result.items)) result.items = result.items[0] ?? {};
  return result;
}
function isPlainObject(node) {
  return typeof node === "object" && node !== null && !Array.isArray(node);
}
function hasCombiner(node) {
  return isPlainObject(node) && (Array.isArray(node.anyOf) || Array.isArray(node.oneOf) || Array.isArray(node.allOf));
}
function hasSchemaIntent(node) {
  if (!isPlainObject(node)) return false;
  if (hasCombiner(node)) return true;
  return [
    "type",
    "properties",
    "items",
    "prefixItems",
    "enum",
    "const",
    "$ref",
    "additionalProperties",
    "patternProperties",
    "required",
    "not",
    "if",
    "then",
    "else"
  ].some((key) => key in node);
}
function sanitizeGeminiSchema(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeGeminiSchema);
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "enum" && Array.isArray(value)) {
      result[key] = value.map((v) => String(v));
      if (result.type === "integer" || result.type === "number") {
        result.type = "string";
      }
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizeGeminiSchema(value);
    } else {
      result[key] = value;
    }
  }
  if (result.type === "object" && result.properties && Array.isArray(result.required)) {
    result.required = result.required.filter(
      (f) => f in result.properties
    );
  }
  if (result.type === "array" && !hasCombiner(result)) {
    if (result.items == null) result.items = {};
    if (isPlainObject(result.items) && !hasCombiner(result.items) && !hasSchemaIntent(result.items)) {
      result.items.type = "string";
    }
  }
  if (result.type && result.type !== "object" && !hasCombiner(result)) {
    delete result.properties;
    delete result.required;
  }
  return result;
}

// src/llm-events.ts
function adapterState() {
  return {
    step: 0,
    text: 0,
    reasoning: 0,
    currentTextID: void 0,
    currentReasoningID: void 0,
    toolNames: {}
  };
}
function extractUsage(value) {
  if (!value || typeof value !== "object") return void 0;
  const item = value;
  const entries = Object.entries({
    inputTokens: item.inputTokens,
    outputTokens: item.outputTokens,
    totalTokens: item.totalTokens,
    reasoningTokens: item.outputTokenDetails?.reasoningTokens ?? item.reasoningTokens,
    cacheReadInputTokens: item.inputTokenDetails?.cacheReadTokens ?? item.cachedInputTokens,
    cacheWriteInputTokens: item.inputTokenDetails?.cacheWriteTokens
  }).filter((entry) => entry[1] !== void 0);
  return entries.length === 0 ? void 0 : Object.fromEntries(entries);
}
function toLLMEvents(state, event) {
  switch (event.type) {
    case "start":
      return [];
    case "start-step":
      return [{ type: "step_start", index: state.step }];
    case "finish-step":
      const stepIdx = state.step++;
      return [
        {
          type: "step_finish",
          reason: event.finishReason ?? "unknown",
          usage: extractUsage(event.usage) ?? { inputTokens: void 0, outputTokens: void 0 }
        }
      ];
    case "finish":
      Object.assign(state, adapterState());
      return [
        {
          type: "finish",
          reason: event.finishReason ?? "unknown",
          usage: extractUsage(event.totalUsage) ?? { inputTokens: void 0, outputTokens: void 0 }
        }
      ];
    case "text-delta":
      return [{ type: "text", delta: event.text }];
    case "reasoning-delta":
      return [{ type: "reasoning", delta: event.text }];
    case "tool-call":
      state.toolNames[event.toolCallId] = event.toolName;
      return [{ type: "tool_call", id: event.toolCallId, name: event.toolName, input: event.input }];
    case "tool-result":
      const name = state.toolNames[event.toolCallId] ?? "unknown";
      delete state.toolNames[event.toolCallId];
      return [{ type: "tool_result", id: event.toolCallId, name, result: event.output }];
    case "error":
      const err = event.error instanceof Error ? event.error : new Error(String(event.error));
      return [{ type: "error", error: err }];
    case "abort":
    case "source":
    case "file":
    case "raw":
    case "tool-output-denied":
    case "tool-approval-request":
    case "text-start":
    case "text-end":
    case "reasoning-start":
    case "reasoning-end":
    case "tool-input-start":
    case "tool-input-delta":
    case "tool-input-end":
      return [];
    default:
      return [];
  }
}

// src/llm.ts
function toModelMessages(messages) {
  return messages.map((msg) => {
    if (msg.role === "system") {
      return { role: "system", content: msg.content };
    }
    if (msg.role === "user") {
      const content = typeof msg.content === "string" ? msg.content : msg.content.map((part) => {
        if (part.type === "text") return { type: "text", text: part.text };
        if (part.type === "image") {
          return {
            type: "image",
            image: part.image,
            ...part.mediaType ? { mediaType: part.mediaType } : {}
          };
        }
        return part;
      });
      return { role: "user", content };
    }
    if (msg.role === "assistant") {
      const content = typeof msg.content === "string" ? msg.content : msg.content.map((part) => {
        if (part.type === "text") return { type: "text", text: part.text };
        if (part.type === "reasoning") return { type: "reasoning", text: part.text };
        if (part.type === "tool-call") {
          return {
            type: "tool-call",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            args: part.args
          };
        }
        if (part.type === "tool-result") {
          return {
            type: "tool-result",
            toolCallId: part.toolCallId,
            result: part.result
          };
        }
        return part;
      });
      return { role: "assistant", content };
    }
    return msg;
  });
}
function createAgent(input) {
  const sessionId = (0, import_crypto.randomUUID)();
  const resolved = resolveProvider({
    providerId: input.provider,
    modelId: input.model,
    apiKey: input.apiKey,
    baseURL: input.baseURL,
    isReasoning: input.isReasoning ?? false
  });
  const pendingMessages = [...input.messages ?? []];
  let interruptSignal;
  let killed = false;
  const asyncIterable = {
    [Symbol.asyncIterator]() {
      return createStreamIterator();
    }
  };
  async function* createStreamIterator() {
    if (killed) return;
    const messages = [...pendingMessages];
    const modelMessages = toModelMessages(messages);
    const npm = getNpmFromProvider(input.provider);
    const transformed = applyMessageNormalization(
      modelMessages,
      input.provider,
      input.model,
      npm
    );
    if (input.provider === "anthropic" || input.provider === "google-vertex-anthropic") {
      applyCaching(transformed, input.provider);
    }
    const providerOpts = applyProviderOptions(
      input.provider,
      input.model,
      npm,
      input.isReasoning ?? false,
      sessionId
    );
    const mergedProviderOptions = {
      ...resolved.options,
      ...Object.keys(providerOpts).length > 0 ? providerOpts : {}
    };
    interruptSignal = new AbortController();
    const allMessages = input.systemPrompt ? [
      { role: "system", content: input.systemPrompt },
      ...transformed
    ] : transformed;
    const tools = input.tools ?? {};
    const toolNames = Object.keys(tools).length > 0 ? Object.keys(tools) : void 0;
    const result = await (0, import_ai.streamText)({
      model: resolved.model,
      messages: allMessages,
      tools: Object.keys(tools).length > 0 ? tools : void 0,
      activeTools: toolNames,
      providerOptions: mergedProviderOptions,
      abortSignal: interruptSignal.signal,
      onError(error) {
        console.error("[agent-sdk] stream error:", error);
      }
    });
    const state = adapterState();
    for await (const event of result.fullStream) {
      if (killed) return;
      const llmEvents = toLLMEvents(state, event);
      for (const llmEvent of llmEvents) {
        yield llmEvent;
      }
    }
  }
  return {
    sessionId,
    stream() {
      return asyncIterable;
    },
    write(messages) {
      pendingMessages.push(...messages);
    },
    interrupt() {
      interruptSignal?.abort();
    },
    kill() {
      killed = true;
      interruptSignal?.abort();
    }
  };
}
async function generateText(input) {
  const resolved = resolveProvider({
    providerId: input.provider,
    modelId: input.model,
    apiKey: input.apiKey,
    baseURL: input.baseURL,
    isReasoning: input.isReasoning ?? false
  });
  const npm = getNpmFromProvider(input.provider);
  const providerOpts = applyProviderOptions(
    input.provider,
    input.model,
    npm,
    input.isReasoning ?? false,
    "generate-text"
  );
  const mergedProviderOptions = {
    ...resolved.options,
    ...Object.keys(providerOpts).length > 0 ? providerOpts : {}
  };
  const result = await (0, import_ai.generateText)({
    model: resolved.model,
    prompt: input.prompt,
    system: input.instructions,
    providerOptions: mergedProviderOptions
  });
  return {
    text: result.text,
    usage: {
      inputTokens: result.usage?.inputTokens ?? void 0,
      outputTokens: result.usage?.outputTokens ?? void 0
    }
  };
}
function getNpmFromProvider(providerId) {
  switch (providerId) {
    case "anthropic":
      return "@ai-sdk/anthropic";
    case "alibaba-cn":
    case "alibaba":
    case "zhipuai":
    case "alibaba-coding-plan-cn":
      return "@ai-sdk/openai-compatible";
    default:
      return "";
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  applyCaching,
  applyMessageNormalization,
  applyProviderOptions,
  applySchemaTransform,
  createAgent,
  generateText,
  jsonSchema,
  resolveProvider,
  supportedProviders,
  tool
});
//# sourceMappingURL=index.cjs.map