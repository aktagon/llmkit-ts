// Code generated — DO NOT EDIT.

//
//
//
//

import type { Capability } from "./types.ts";
import type { ModelInfo } from "./structs.ts";


import { Capabilities } from "./types.ts";


export const compiledInModels: ModelInfo[] = [
  { id: "claude-haiku-4-5-20251001", provider: { name: "anthropic", apiKey: "" }, capabilities: [Capabilities.ChatCompletion, Capabilities.ToolCalling], displayName: "Claude Haiku 4.5", contextWindow: 200000, maxOutput: 64000 },
  { id: "claude-opus-4-5-20251101", provider: { name: "anthropic", apiKey: "" }, capabilities: [Capabilities.ChatCompletion, Capabilities.ToolCalling], displayName: "Claude Opus 4.5", contextWindow: 200000, maxOutput: 64000 },
  { id: "claude-opus-4-6", provider: { name: "anthropic", apiKey: "" }, capabilities: [Capabilities.ChatCompletion, Capabilities.ToolCalling], displayName: "Claude Opus 4.6", contextWindow: 1000000, maxOutput: 128000 },
  { id: "claude-opus-4-7", provider: { name: "anthropic", apiKey: "" }, capabilities: [Capabilities.ChatCompletion, Capabilities.ToolCalling], displayName: "Claude Opus 4.7", contextWindow: 1000000, maxOutput: 128000 },
  { id: "claude-sonnet-4-5-20250929", provider: { name: "anthropic", apiKey: "" }, capabilities: [Capabilities.ChatCompletion, Capabilities.ToolCalling], displayName: "Claude Sonnet 4.5", contextWindow: 1000000, maxOutput: 64000 },
  { id: "claude-sonnet-4-6", provider: { name: "anthropic", apiKey: "" }, capabilities: [Capabilities.ChatCompletion, Capabilities.ToolCalling], displayName: "Claude Sonnet 4.6", contextWindow: 1000000, maxOutput: 128000 },
  { id: "gemini-2.5-flash", provider: { name: "google", apiKey: "" }, capabilities: [Capabilities.ChatCompletion, Capabilities.Reasoning, Capabilities.ToolCalling], displayName: "Gemini 2.5 Flash", description: "Stable version of Gemini 2.5 Flash", contextWindow: 1048576, maxOutput: 65536 },
  { id: "gemini-2.5-flash-lite", provider: { name: "google", apiKey: "" }, capabilities: [Capabilities.ChatCompletion, Capabilities.ToolCalling], displayName: "Gemini 2.5 Flash-Lite", description: "Stable version of Gemini 2.5 Flash-Lite", contextWindow: 1048576, maxOutput: 65536 },
  { id: "gemini-2.5-pro", provider: { name: "google", apiKey: "" }, capabilities: [Capabilities.ChatCompletion, Capabilities.Reasoning, Capabilities.ToolCalling], displayName: "Gemini 2.5 Pro", description: "Stable release of Gemini 2.5 Pro", contextWindow: 1048576, maxOutput: 65536 },
  { id: "gemini-3-pro-image-preview", provider: { name: "google", apiKey: "" }, capabilities: [Capabilities.ImageGeneration], displayName: "Nano Banana Pro", description: "Gemini 3 Pro Image Preview", contextWindow: 131072, maxOutput: 32768 },
  { id: "gemini-3-pro-preview", provider: { name: "google", apiKey: "" }, capabilities: [Capabilities.ChatCompletion, Capabilities.Reasoning, Capabilities.ToolCalling], displayName: "Gemini 3 Pro Preview", description: "Gemini 3 Pro Preview", contextWindow: 1048576, maxOutput: 65536 },
  { id: "gemini-3.1-flash-image-preview", provider: { name: "google", apiKey: "" }, capabilities: [Capabilities.ImageGeneration], displayName: "Nano Banana 2", description: "Gemini 3.1 Flash Image Preview", contextWindow: 65536, maxOutput: 65536 },
  { id: "gpt-4o", provider: { name: "openai", apiKey: "" }, capabilities: [Capabilities.ChatCompletion, Capabilities.ToolCalling] },
  { id: "gpt-4o-mini", provider: { name: "openai", apiKey: "" }, capabilities: [Capabilities.ChatCompletion, Capabilities.ToolCalling] },
  { id: "gpt-5", provider: { name: "openai", apiKey: "" }, capabilities: [Capabilities.ChatCompletion, Capabilities.Reasoning, Capabilities.ToolCalling] },
  { id: "gpt-image-1", provider: { name: "openai", apiKey: "" }, capabilities: [Capabilities.ImageGeneration] },
  { id: "o1", provider: { name: "openai", apiKey: "" }, capabilities: [Capabilities.ChatCompletion, Capabilities.Reasoning] },
  { id: "o3", provider: { name: "openai", apiKey: "" }, capabilities: [Capabilities.ChatCompletion, Capabilities.Reasoning, Capabilities.ToolCalling] },
  { id: "o4-mini", provider: { name: "openai", apiKey: "" }, capabilities: [Capabilities.ChatCompletion, Capabilities.Reasoning, Capabilities.ToolCalling] },
];




export const ontologyCapabilities: Record<string, Record<string, Capability[]>> = {
  "anthropic": {
    "claude-haiku-4-5-20251001": [Capabilities.ChatCompletion, Capabilities.ToolCalling],
    "claude-opus-4-5-20251101": [Capabilities.ChatCompletion, Capabilities.ToolCalling],
    "claude-opus-4-6": [Capabilities.ChatCompletion, Capabilities.ToolCalling],
    "claude-opus-4-7": [Capabilities.ChatCompletion, Capabilities.ToolCalling],
    "claude-sonnet-4-5-20250929": [Capabilities.ChatCompletion, Capabilities.ToolCalling],
    "claude-sonnet-4-6": [Capabilities.ChatCompletion, Capabilities.ToolCalling],
  },
  "google": {
    "gemini-2.5-flash": [Capabilities.ChatCompletion, Capabilities.Reasoning, Capabilities.ToolCalling],
    "gemini-2.5-flash-lite": [Capabilities.ChatCompletion, Capabilities.ToolCalling],
    "gemini-2.5-pro": [Capabilities.ChatCompletion, Capabilities.Reasoning, Capabilities.ToolCalling],
    "gemini-3-pro-image-preview": [Capabilities.ImageGeneration],
    "gemini-3-pro-preview": [Capabilities.ChatCompletion, Capabilities.Reasoning, Capabilities.ToolCalling],
    "gemini-3.1-flash-image-preview": [Capabilities.ImageGeneration],
  },
  "openai": {
    "gpt-4o": [Capabilities.ChatCompletion, Capabilities.ToolCalling],
    "gpt-4o-mini": [Capabilities.ChatCompletion, Capabilities.ToolCalling],
    "gpt-5": [Capabilities.ChatCompletion, Capabilities.Reasoning, Capabilities.ToolCalling],
    "gpt-image-1": [Capabilities.ImageGeneration],
    "o1": [Capabilities.ChatCompletion, Capabilities.Reasoning],
    "o3": [Capabilities.ChatCompletion, Capabilities.Reasoning, Capabilities.ToolCalling],
    "o4-mini": [Capabilities.ChatCompletion, Capabilities.Reasoning, Capabilities.ToolCalling],
  },
};




export interface CatalogueConfig {
  endpoint: string;
  pagination: string;
  parserKind: string;
  specUrl?: string;
  specFormat?: string;
}

export const catalogueByProvider: Record<string, CatalogueConfig> = {
  "anthropic": { endpoint: "/v1/models", pagination: "CursorByLastID", parserKind: "ParseAnthropicModels", specUrl: "https://github.com/anthropics/anthropic-sdk-typescript/blob/main/api.md", specFormat: "OpenAPI3" },
  "cerebras": { endpoint: "/v1/models", pagination: "PaginationNone", parserKind: "ParseOpenAICohortModels" },
  "deepseek": { endpoint: "/v1/models", pagination: "PaginationNone", parserKind: "ParseOpenAICohortModels" },
  "fireworks": { endpoint: "/v1/models", pagination: "PaginationNone", parserKind: "ParseOpenAICohortModels" },
  "google": { endpoint: "/v1beta/models", pagination: "CursorOpaqueToken", parserKind: "ParseGoogleModels", specUrl: "https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta", specFormat: "GoogleDiscovery" },
  "grok": { endpoint: "/v1/models", pagination: "PaginationNone", parserKind: "ParseOpenAICohortModels" },
  "groq": { endpoint: "/v1/models", pagination: "PaginationNone", parserKind: "ParseOpenAICohortModels" },
  "mistral": { endpoint: "/v1/models", pagination: "PaginationNone", parserKind: "ParseOpenAICohortModels", specUrl: "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/openapi.yaml", specFormat: "OpenAPI3" },
  "moonshot": { endpoint: "/v1/models", pagination: "PaginationNone", parserKind: "ParseOpenAICohortModels" },
  "openai": { endpoint: "/v1/models", pagination: "PaginationNone", parserKind: "ParseOpenAICohortModels", specUrl: "https://github.com/openai/openai-openapi/blob/master/openapi.yaml", specFormat: "OpenAPI3" },
  "openrouter": { endpoint: "/v1/models", pagination: "PaginationNone", parserKind: "ParseOpenAICohortModels", specUrl: "https://openrouter.ai/openapi.json", specFormat: "OpenAPI3" },
  "qwen": { endpoint: "/v1/models", pagination: "PaginationNone", parserKind: "ParseOpenAICohortModels" },
  "together": { endpoint: "/v1/models", pagination: "PaginationNone", parserKind: "ParseOpenAICohortModels", specUrl: "https://raw.githubusercontent.com/togethercomputer/openapi/main/openapi.yaml", specFormat: "OpenAPI3" },
};
