import { Tool, ModelMessage } from 'ai';
export { jsonSchema, tool } from 'ai';
import { JSONSchema7 } from '@ai-sdk/provider';

type LLMEvent = {
    type: "text";
    delta: string;
} | {
    type: "reasoning";
    delta: string;
} | {
    type: "tool_call";
    id: string;
    name: string;
    input: unknown;
} | {
    type: "tool_result";
    id: string;
    name: string;
    result: unknown;
} | {
    type: "step_start";
    index: number;
} | {
    type: "step_finish";
    reason: string;
    usage: {
        inputTokens?: number;
        outputTokens?: number;
    };
} | {
    type: "finish";
    reason: string;
    usage: {
        inputTokens?: number;
        outputTokens?: number;
    };
} | {
    type: "error";
    error: Error;
};
interface AgentHandle {
    stream(): AsyncIterable<LLMEvent>;
    write(messages: AgentMessage[]): void;
    interrupt(): void;
    kill(): void;
    readonly sessionId: string;
}
type AgentMessage = {
    role: "user";
    content: string | UserContentPart[];
} | {
    role: "assistant";
    content: string | AssistantContentPart[];
} | {
    role: "system";
    content: string;
};
type UserContentPart = {
    type: "text";
    text: string;
} | {
    type: "image";
    image: string | URL;
    mediaType?: string;
};
type AssistantContentPart = {
    type: "text";
    text: string;
} | {
    type: "reasoning";
    text: string;
} | {
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    args: string;
} | {
    type: "tool-result";
    toolCallId: string;
    result: unknown;
};
interface ResolveProviderResult {
    sdk: unknown;
    model: unknown;
    options: Record<string, unknown>;
}
interface GenerateTextResult {
    text: string;
    usage: {
        inputTokens?: number;
        outputTokens?: number;
    };
}
interface CanUseToolFn {
    (toolName: string, input: unknown): Promise<boolean>;
}

declare const supportedProviders: string[];
declare function resolveProvider(input: {
    providerId: string;
    apiKey?: string;
    baseURL?: string;
    modelId?: string;
    isReasoning?: boolean;
}): ResolveProviderResult;

declare function createAgent(input: {
    provider: string;
    model: string;
    apiKey?: string;
    baseURL?: string;
    isReasoning?: boolean;
    tools?: Record<string, Tool>;
    systemPrompt?: string;
    messages?: AgentMessage[];
    canUseTool?: CanUseToolFn;
}): AgentHandle;
declare function generateText(input: {
    provider: string;
    model: string;
    apiKey?: string;
    baseURL?: string;
    isReasoning?: boolean;
    prompt: string;
    instructions?: string;
}): Promise<{
    text: string;
    usage: {
        inputTokens?: number;
        outputTokens?: number;
    };
}>;

declare function applyMessageNormalization(msgs: ModelMessage[], providerId: string, modelId: string, npm: string): ModelMessage[];
declare function applyCaching(msgs: ModelMessage[], providerId: string): ModelMessage[];
declare function applyProviderOptions(providerId: string, modelId: string, npm: string, isReasoning: boolean, sessionId: string): Record<string, unknown>;
declare function applySchemaTransform(providerId: string, modelId: string, schema: JSONSchema7): JSONSchema7;

export { type AgentHandle, type AgentMessage, type AssistantContentPart, type CanUseToolFn, type GenerateTextResult, type LLMEvent, type ResolveProviderResult, type UserContentPart, applyCaching, applyMessageNormalization, applyProviderOptions, applySchemaTransform, createAgent, generateText, resolveProvider, supportedProviders };
